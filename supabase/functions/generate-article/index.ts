// generate-article — Sound Check Supabase edge function
// Generates a press article headline + body in the requested outlet's voice,
// then inserts it into industry_articles using the service role key.
//
// Request body (JSON):
//   trigger_type  string  — e.g. "number_one_streak"
//   trigger_key   string  — unique dedup key; duplicate → 200 {duplicate:true}
//   outlet        string  — Velour | Room Service | Chartwell | Undertone | AirTime
//   facts         object  — free-form context passed to the AI prompt
//
// Response (JSON):
//   headline      string
//   content       string
//   duplicate     boolean  (true = trigger_key already exists, no insert done)
//   capped        boolean  (true = weekly server cap hit, no insert done)
//   error         string   (only on hard failure)

import Anthropic from 'npm:@anthropic-ai/sdk@0.20.9';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

// Max AI-generated articles inserted server-wide per game week
const WEEKLY_CAP = 10;

// Outlet voice instructions — the AI writes prose; it never decides game effects
const OUTLET_VOICES: Record<string, string> = {
  'Velour': `You are a writer for Velour, a prestigious music magazine with an elegant, refined voice.
Write in polished, literary prose. Avoid slang. Celebrate artistry and longevity.
Think Pitchfork at its most tasteful meets The New Yorker.`,

  'Room Service': `You are a writer for Room Service, a cheeky celebrity gossip outlet.
Write in a chatty, knowing tone — a little catty, heavy on innuendo, light on facts.
Use phrases like "sources close to", "word on the street", "we're just asking".
Keep it fun and never outright cruel.`,

  'Chartwell': `You are a writer for Chartwell, a dry business-of-music trade publication.
Write in factual, understated prose. Focus on streams, chart positions, commercial implications.
No hyperbole. Short declarative sentences. Think Billboard meets The Economist.`,

  'Undertone': `You are a writer for Undertone, a warm music-discovery blog.
Write with genuine enthusiasm and warmth — you love music and you love finding new artists.
Use evocative, sensory language. Make the reader feel like they just found something special.`,

  'AirTime': `You are a writer for AirTime, a bright mainstream radio/pop-culture website.
Write in upbeat, exclamation-friendly prose. Keep it accessible and celebratory.
Think Ryan Seacrest introducing a Number One. Energy, positivity, brief.`,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { trigger_type, trigger_key, outlet, facts } = body;

    if (!trigger_type || !trigger_key || !outlet || !OUTLET_VOICES[outlet]) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid fields: trigger_type, trigger_key, outlet required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseHeaders = {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    };

    // ── 1. Dedup check ────────────────────────────────────────────
    const dedupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/industry_articles?trigger_key=eq.${encodeURIComponent(trigger_key)}&select=id&limit=1`,
      { headers: supabaseHeaders }
    );
    const dedupRows = await dedupRes.json();
    if (Array.isArray(dedupRows) && dedupRows.length > 0) {
      console.log('[generate-article] Dedup hit for', trigger_key);
      return new Response(
        JSON.stringify({ duplicate: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 2. Weekly cap check ───────────────────────────────────────
    // "game week" here means ISO calendar week of real time, which keeps the
    // cap rolling without needing to track the in-game week server-side.
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
    weekStart.setUTCHours(0, 0, 0, 0);

    const capRes = await fetch(
      `${SUPABASE_URL}/rest/v1/industry_articles?generated=eq.true&inserted_at=gte.${weekStart.toISOString()}&select=id`,
      { headers: supabaseHeaders }
    );
    const capRows = await capRes.json();
    if (Array.isArray(capRows) && capRows.length >= WEEKLY_CAP) {
      console.log('[generate-article] Weekly cap hit:', capRows.length);
      return new Response(
        JSON.stringify({ capped: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 3. Generate prose with Claude Haiku ──────────────────────
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const factsText = Object.entries(facts || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const systemPrompt = OUTLET_VOICES[outlet];

    const userPrompt =
      `Write a short press article about the following music industry event.\n\n` +
      `Event type: ${trigger_type}\n` +
      `Facts:\n${factsText}\n\n` +
      `Format your response as JSON with exactly two fields:\n` +
      `  "headline": a punchy headline (max 12 words)\n` +
      `  "content": the article body (2–3 sentences, 60–120 words)\n\n` +
      `Write entirely in the outlet's voice. Do NOT mention game mechanics, multipliers, ` +
      `or numerical formulas. Sound like a real article.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    // Parse the JSON response (strip markdown fences if present)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Model did not return valid JSON: ' + rawText.slice(0, 200));
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const headline: string = (parsed.headline || '').trim();
    const content: string  = (parsed.content  || '').trim();

    if (!headline || !content) {
      throw new Error('Model returned empty headline or content.');
    }

    // ── 4. Insert into industry_articles ─────────────────────────
    const insertPayload = {
      source: outlet.toLowerCase().replace(/\s+/g, '-'),
      week: facts?.game_week ?? null,
      timestamp: Date.now(),
      type: trigger_type,
      artist_name: String(facts?.artist || ''),
      player_id: facts?.player_id ?? null,
      headline,
      preview: content.split('.')[0] + '.',   // first sentence as preview
      content,
      trigger_key,
      generated: true,
      inserted_at: now.toISOString(),
    };

    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/industry_articles`,
      {
        method: 'POST',
        headers: {
          ...supabaseHeaders,
          'Prefer': 'resolution=ignore-duplicates',  // no-op if trigger_key already exists
        },
        body: JSON.stringify(insertPayload),
      }
    );

    if (!insertRes.ok && insertRes.status !== 409) {
      const errBody = await insertRes.text();
      throw new Error(`Insert failed (${insertRes.status}): ${errBody}`);
    }

    // 409 = duplicate trigger_key from a race — treat as dedup
    if (insertRes.status === 409) {
      return new Response(
        JSON.stringify({ duplicate: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[generate-article] Inserted article for', trigger_key);
    return new Response(
      JSON.stringify({ headline, content }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[generate-article] Error:', err);
    return new Response(
      JSON.stringify({ error: String(err.message || err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
