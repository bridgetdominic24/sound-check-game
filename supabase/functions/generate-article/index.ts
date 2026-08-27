// generate-article — Sound Check Supabase edge function
// Generates a press article headline + body in the requested outlet's voice,
// runs the text through moderate-content for safety, then inserts the result
// into industry_articles using the service role key.
//
// Request body (JSON):
//   trigger_type      string   — e.g. "number_one_streak"
//   trigger_key       string   — unique dedup key; duplicate → 200 {duplicate:true}
//   outlet            string   — Velour | Room Service | Chartwell | Undertone | AirTime
//   facts             object   — free-form context passed to the AI prompt
//   target_player_id  string?  — player the article is about (rumor target)
//   expires_week      number?  — game week the rumor stops having effects (current + 3)
//   is_rumor          boolean? — true → stored as type='rumor'
//
// Response (JSON):
//   headline      string
//   content       string
//   duplicate     boolean  (true = trigger_key already exists, no insert done)
//   capped        boolean  (true = weekly server cap hit, no insert done)
//   blocked       boolean  (true = moderation rejected the content)
//   error         string   (only on hard failure)

import Anthropic from 'npm:@anthropic-ai/sdk@0.20.9';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

// Max AI-generated articles inserted server-wide per game week (rumors count)
const WEEKLY_CAP = 30;

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

// ── helpers ───────────────────────────────────────────────────────────────────

const supabaseHeaders = () => ({
  'Content-Type': 'application/json',
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
});

async function moderateText(text: string): Promise<boolean> {
  // Calls the existing moderate-content edge function.
  // Returns true = content is safe, false = blocked.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/moderate-content`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ text }),
      }
    );
    if (!res.ok) {
      // If the moderation function itself errors, be conservative and allow
      console.warn('[generate-article] moderate-content returned', res.status, '— allowing');
      return true;
    }
    const data = await res.json();
    // The moderate-content function returns { safe: boolean } or { blocked: boolean }
    if (typeof data.safe === 'boolean') return data.safe;
    if (typeof data.blocked === 'boolean') return !data.blocked;
    return true; // unknown format — allow
  } catch (e) {
    console.warn('[generate-article] moderate-content error:', e);
    return true; // network failure — allow so articles still work offline
  }
}

// ── main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      trigger_type,
      trigger_key,
      outlet,
      facts,
      target_player_id,
      expires_week,
      is_rumor,
    } = body;

    if (!trigger_type || !trigger_key || !outlet || !OUTLET_VOICES[outlet]) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid fields: trigger_type, trigger_key, outlet required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hdrs = supabaseHeaders();

    // ── 1. Dedup check ────────────────────────────────────────────────────────
    const dedupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/industry_articles?trigger_key=eq.${encodeURIComponent(trigger_key)}&select=id&limit=1`,
      { headers: hdrs }
    );
    const dedupRows = await dedupRes.json();
    if (Array.isArray(dedupRows) && dedupRows.length > 0) {
      console.log('[generate-article] Dedup hit for', trigger_key);
      return new Response(
        JSON.stringify({ duplicate: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 2. Weekly cap check ───────────────────────────────────────────────────
    // "game week" = ISO calendar week of real time so the cap rolls without
    // needing to track in-game week server-side.
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
    weekStart.setUTCHours(0, 0, 0, 0);

    const capRes = await fetch(
      `${SUPABASE_URL}/rest/v1/industry_articles?generated=eq.true&inserted_at=gte.${weekStart.toISOString()}&select=id`,
      { headers: hdrs }
    );
    const capRows = await capRes.json();
    if (Array.isArray(capRows) && capRows.length >= WEEKLY_CAP) {
      console.log('[generate-article] Weekly cap hit:', capRows.length);
      return new Response(
        JSON.stringify({ capped: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 3. Generate prose with Claude Haiku ───────────────────────────────────
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
      `or numerical formulas. Sound like a real article.\n\n` +
      `IMPORTANT CONTENT RULES:\n` +
      `- Never reference real money, family, relationships/cheating, health, or cruel personal topics.\n` +
      `- For rumor pieces: base the speculation only on the career event described in the facts.\n` +
      `- Keep any negative framing light, gossipy, and firmly in "music industry" territory.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
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

    // ── 4. Moderation check ───────────────────────────────────────────────────
    const combinedText = headline + ' ' + content;
    const safe = await moderateText(combinedText);
    if (!safe) {
      console.warn('[generate-article] Content blocked by moderation for', trigger_key);
      return new Response(
        JSON.stringify({ blocked: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 5. Insert into industry_articles ──────────────────────────────────────
    const insertPayload: Record<string, unknown> = {
      source:      outlet.toLowerCase().replace(/\s+/g, '-'),
      week:        facts?.game_week ?? null,
      timestamp:   Date.now(),
      type:        is_rumor ? 'rumor' : trigger_type,
      artist_name: String(facts?.artist || ''),
      player_id:   facts?.player_id ?? null,
      headline,
      preview:     content.split('.')[0] + '.',
      content,
      trigger_key,
      generated:   true,
      inserted_at: now.toISOString(),
    };

    // Rumor-specific fields (nullable — no impact on non-rumor rows)
    if (target_player_id)             insertPayload.target_player_id = target_player_id;
    if (typeof expires_week === 'number') insertPayload.expires_week = expires_week;
    if (is_rumor)                     insertPayload.is_rumor = true;

    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/industry_articles`,
      {
        method: 'POST',
        headers: {
          ...hdrs,
          'Prefer': 'resolution=ignore-duplicates',  // no-op if trigger_key race
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

    console.log('[generate-article] Inserted article for', trigger_key, is_rumor ? '(rumor)' : '');

    // ── 6. Notifications (rumors only) ───────────────────────────────────────
    // After a successful rumor insert, notify the target artist and their label owner.
    if (is_rumor && target_player_id) {
      try {
        // Fetch target player's user_id and signed_label info
        const playerRes = await fetch(
          `${SUPABASE_URL}/rest/v1/players?id=eq.${encodeURIComponent(target_player_id)}&select=user_id,signed_label&limit=1`,
          { headers: hdrs }
        );
        const playerRows = playerRes.ok ? await playerRes.json() : [];
        const targetPlayer = Array.isArray(playerRows) ? playerRows[0] : null;

        const artistUserId: string | null = targetPlayer?.user_id ?? null;
        const labelId: string | null = targetPlayer?.signed_label?.label_id ?? null;

        const notifTimestamp = Date.now();
        const artistName = String(facts?.artist || 'You');

        // Notify the artist
        if (artistUserId) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/notifications`,
            {
              method: 'POST',
              headers: hdrs,
              body: JSON.stringify({
                user_id:     artistUserId,
                type:        'press_mention',
                platform:    'system',
                fromuserid:  null,
                fromusername: 'Room Service',
                message:     `Room Service wrote about you: "${headline}"`,
                article_id:  null, // populated below if available
                timestamp:   notifTimestamp,
                read:        false,
              }),
            }
          ).catch(e => console.warn('[generate-article] Artist notif error:', e));
        }

        // Notify the label owner if the artist is signed
        if (labelId) {
          const labelRes = await fetch(
            `${SUPABASE_URL}/rest/v1/labels?id=eq.${encodeURIComponent(labelId)}&select=owner_id&limit=1`,
            { headers: hdrs }
          );
          const labelRows = labelRes.ok ? await labelRes.json() : [];
          const labelOwnerUserId: string | null =
            Array.isArray(labelRows) && labelRows[0]?.owner_id ? labelRows[0].owner_id : null;

          if (labelOwnerUserId) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/notifications`,
              {
                method: 'POST',
                headers: hdrs,
                body: JSON.stringify({
                  user_id:     labelOwnerUserId,
                  type:        'press_request',
                  platform:    'system',
                  fromuserid:  null,
                  fromusername: 'Room Service',
                  message:     `Room Service is asking about ${artistName} — issue a statement?`,
                  article_id:  null,
                  timestamp:   notifTimestamp,
                  read:        false,
                }),
              }
            ).catch(e => console.warn('[generate-article] Label notif error:', e));
          }
        }
      } catch (notifErr) {
        // Notifications are best-effort — never fail the whole request over them
        console.warn('[generate-article] Notification step error:', notifErr);
      }
    }

    return new Response(
      JSON.stringify({ headline, content }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[generate-article] Error:', err);
    return new Response(
      JSON.stringify({ error: String((err as Error).message || err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
