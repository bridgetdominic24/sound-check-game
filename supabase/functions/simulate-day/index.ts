// simulate-day — Sound Check Supabase edge function
//
// Runs once per game day (every 2 real hours) via pg_cron.  For every player
// in the database it processes exactly one day of simulation — streams, fan
// gains, hype decay, social organic growth, rent, job pay, staff fees, promo
// campaigns, chart updates — so the world keeps moving even when no one is
// logged in.
//
// The function is idempotent: it reads game_data._lastSimDay and only
// processes days that haven't been processed yet.  If a player IS online
// their client calls _onDayAdvanced / _processDailyStreams directly, so the
// server run for that day is a no-op (already at current day).
//
// Setup (one-time, Supabase Dashboard → SQL Editor):
//
//   select cron.schedule(
//     'simulate-game-day',
//     '5 */2 * * *',           -- 5 min past every 2-hour mark (after tick-timer)
//     $$
//     select net.http_post(
//       url    := 'https://pvxrciebegirmrrrzkor.supabase.co/functions/v1/simulate-day',
//       headers:= jsonb_build_object(
//                   'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
//                   'Content-Type',  'application/json'
//                 ),
//       body   := '{}'::jsonb
//     );
//     $$
//   );
//
// The cron fires 5 minutes after tick-timer so current_day is already
// incremented before simulate-day reads it.

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const DAY_MS           = 7_200_000; // 2 real hours per game day

// ─── helpers ────────────────────────────────────────────────────────────────

function dbHeaders() {
  return {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function dbGet(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() });
  return r.json();
}

async function dbPatch(path: string, body: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
}

// ─── day-info helper (mirrors client gameWeekToDate / dayInfo) ───────────────

function dayInfo(day: number): { week: number; dow: number } {
  const week = Math.ceil(day / 7);
  const dow  = (day - 1) % 7; // 0 = Monday … 6 = Sunday
  return { week, dow };
}

// ─── stream calculation (mirrors client calculateDailySongStreams) ───────────

function calculateDailySongStreams(song: any, game: any): number {
  if (!song.released) return 0;

  const regions = ['North America','Europe','Asia','Africa','South America','Oceania'];
  let totalRegionalFans = 0;
  regions.forEach(region => {
    const playerFans = (game.fansByRegion && game.fansByRegion[region]) || 0;
    const promoFans  = (song.fans && song.fans[region]) || 0;
    const catalogSize = Math.max(1, (game.songs || []).filter((s: any) => s.released).length);
    const attentionShare = Math.min(1, 2.5 / catalogSize);
    totalRegionalFans += (playerFans * attentionShare) + promoFans;
  });
  if (totalRegionalFans <= 0) totalRegionalFans = 10;

  const hype             = Math.min(1000, game.buzz || game.hype || 0);
  const hypeMultiplier   = 1 + (hype / 1000) * 3;
  const quality          = song.quality || 50;
  const qualityMult      = 0.6 + (quality / 100) * 0.8;
  const engagementRate   = 0.05 + (quality / 100) * 0.15;
  const randomLuck       = 0.7 + Math.random() * 0.6;

  let promoBoost = 1.0;
  if (song.campaigns && song.campaigns.length > 0) {
    song.campaigns.filter((c: any) => c.status === 'active').forEach((c: any) => {
      const budgetBoost = Math.min(0.5, (c.budget || 100) / 10000);
      promoBoost += 0.15 + budgetBoost;
    });
  }

  // Viral window
  let viralBoost = 1.0;
  if (song.viralWindow && song.viralWindow.weeksLeft > 0) {
    viralBoost = song.viralWindow.multiplier || 5;
  }

  const weeksSinceRelease = Math.max(0, Math.floor(((game.day || 0) - (song.releaseDay || game.day || 0)) / 7));
  let decayMultiplier: number;
  if (weeksSinceRelease <= 20) {
    decayMultiplier = Math.max(0.5, 1 - (weeksSinceRelease * 0.025));
  } else if (weeksSinceRelease <= 52) {
    decayMultiplier = Math.max(0.2, 0.5 - ((weeksSinceRelease - 20) * 0.009));
  } else {
    decayMultiplier = Math.max(0.08, 0.2 - ((weeksSinceRelease - 52) * 0.002));
  }
  if (viralBoost > 1) decayMultiplier = Math.max(decayMultiplier, 0.4);

  const dailyStreams = totalRegionalFans * engagementRate * hypeMultiplier * qualityMult
    * randomLuck * promoBoost * viralBoost * decayMultiplier;
  return Math.max(0, Math.floor(dailyStreams));
}

// ─── process one day for one player ─────────────────────────────────────────

function simulateOneDay(game: any, day: number): void {
  const info = dayInfo(day);
  game.day  = day;
  game.week = info.week;

  // ── Auto-release scheduled songs ─────────────────────────────────────────
  if (game.songs) {
    game.songs.forEach((song: any) => {
      if (!song.released && song.scheduledReleaseDay === day) {
        song.released      = true;
        song.releaseDay    = day;
        song.releaseWeek   = info.week;
        song.weeklyStreams  = 0;
        song.weeksOnChart  = 0;
        song.chartPosition = null;
        if (!game.releases) game.releases = [];
        game.releases.push({
          id: Date.now() + day + Math.random(),
          title: song.title,
          type: 'single',
          songs: [{ id: song.id, title: song.title }],
          releaseDay: day,
        });
        // Notification stored for player to see on next login
        if (!game.notifications) game.notifications = [];
        game.notifications.push({
          id: Date.now() + Math.random(),
          title: '🎵 Song Released!',
          message: `"${song.title}" dropped while you were away.`,
          type: 'release',
          read: false,
          day,
        });
      }
    });
  }

  // ── Weekly block (runs once per game week, on "Monday" dow===0) ───────────
  if (info.dow === 0) {

    // Hype/buzz decay — 3-6 pts per week
    const decayAmount = Math.floor(Math.random() * 4) + 3;
    game.buzz = Math.max(0, (game.buzz || 0) - decayAmount);
    game.hype = game.buzz;
    game._hypeActivityThisWeek = 0;
    // Overflow converts to cash
    if (game.buzz > 1000) {
      const overflow = game.buzz - 1000;
      game.buzz = 1000; game.hype = 1000;
      game.money = (game.money || 0) + overflow * 50;
    }

    // Organic social growth
    if (game.social) {
      const ig = game.social.instagram || 0;
      const tt = game.social.tiktok    || 0;
      const tw = game.social.twitter   || 0;
      if (ig > 0) game.social.instagram += Math.floor(ig * 0.02);
      if (tt > 0) game.social.tiktok    += Math.floor(tt * 0.025);
      if (tw > 0) game.social.twitter   += Math.floor(tw * 0.01);
    }

    // Rent
    if (game.housing && game.housing.rent > 0) {
      game.money = Math.max(0, (game.money || 0) - game.housing.rent);
    }

    // Penthouse rep bonus
    if (game.housing && game.housing.repBonusPerWeek > 0) {
      if (typeof game.reputation === 'number')
        game.reputation = Math.min(5, game.reputation + game.housing.repBonusPerWeek);
    }

    // Staff/manager fees — fire if can't afford (same rule as client)
    if (game.hiredManagers && game.hiredManagers.length > 0) {
      game.hiredManagers = game.hiredManagers.filter((m: any) => {
        const fee = m.weeklyFee || 5000;
        if ((game.money || 0) >= fee) { game.money -= fee; return true; }
        return false;
      });
    }

    // Promo campaign tick — decrement weeks remaining
    if (game.songs) {
      game.songs.forEach((song: any) => {
        if (!song.campaigns) return;
        song.campaigns.forEach((c: any) => {
          if (c.status !== 'active') return;
          c.weeksLeft = Math.max(0, (c.weeksLeft || 1) - 1);
          if (c.weeksLeft <= 0) c.status = 'completed';
        });
      });
    }

    // Archive weekly streams to history, then reset for new week
    if (game.songs) {
      game.songs.forEach((song: any) => {
        if (!song.released) return;
        if (!Array.isArray(song.weeklyStreamsHistory)) song.weeklyStreamsHistory = [];
        if ((song.weeklyStreams || 0) > 0) {
          song.weeklyStreamsHistory.push({ week: info.week - 1, streams: song.weeklyStreams });
          if (song.weeklyStreamsHistory.length > 4) song.weeklyStreamsHistory.shift();
        }
        song.weeklyStreams = 0;
      });
    }

    // Chart positions — sort released songs by total streams
    if (game.songs) {
      const eligible = game.songs.filter((s: any) => s.released && (s.streams || 0) >= 100000);
      eligible.sort((a: any, b: any) => (b.streams || 0) - (a.streams || 0));
      eligible.forEach((s: any, idx: number) => {
        s.lastChartPosition = s.chartPosition || null;
        s.chartPosition     = idx + 1;
        s.weeksOnChart      = (s.weeksOnChart || 0) + 1;
        if (!s.peakPosition || s.chartPosition < s.peakPosition) s.peakPosition = s.chartPosition;
      });
      game.songs.forEach((s: any) => {
        if (s.released && s.chartPosition && (s.streams || 0) < 100000) {
          s.lastChartPosition = s.chartPosition;
          s.chartPosition     = null;
        }
      });
    }
  }

  // ── Job pay (checks hire-day payday cycle) ───────────────────────────────
  if (game.job && game.jobPay) {
    const daysSinceHired = day - (game.jobHiredDay || 1);
    if (daysSinceHired >= 0 && daysSinceHired % 7 === 0) {
      game.money = (game.money || 0) + game.jobPay;
    }
  }

  // ── Viral window tick ────────────────────────────────────────────────────
  if (game.songs) {
    game.songs.forEach((song: any) => {
      if (!song.viralWindow || song.viralWindow.weeksLeft <= 0) return;
      song.viralWindow._dayCounter = (song.viralWindow._dayCounter || 0) + 1;
      if (song.viralWindow._dayCounter >= 7) {
        song.viralWindow._dayCounter = 0;
        song.viralWindow.weeksLeft--;
        if (song.viralWindow.weeksLeft <= 0) song.viralWindow = null;
      }
    });
  }

  // ── Daily streams ────────────────────────────────────────────────────────
  if (game.songs) {
    const regions = ['North America','Europe','Asia','Africa','South America','Oceania'];
    game.songs.forEach((song: any) => {
      if (!song.released) return;
      const daily = calculateDailySongStreams(song, game);
      if (daily <= 0) return;

      if (!song.platforms) song.platforms = { spotify:0, apple:0, youtube:0, amazon:0, soundcloud:0, itunes:0 };

      // Platform split (Loopify 42%, Orange 25%, YTM 15%, Sahara 6%, SoundPuff 5%, iMusic 7%)
      const rv = (base: number, spread: number) => Math.max(0.01, base + (Math.random() - 0.5) * spread);
      const sp = rv(0.42, 0.04), ap = rv(0.25, 0.03), yt = rv(0.15, 0.03),
            am = rv(0.06, 0.02), sc = rv(0.05, 0.02), it = rv(0.07, 0.02);
      const tot = sp + ap + yt + am + sc + it;
      const purchases = Math.floor(daily * it / tot);
      const streaming = daily - purchases;

      song.streams      = (song.streams      || 0) + streaming;
      song.weeklyStreams = (song.weeklyStreams || 0) + streaming;
      song.platforms.spotify    += Math.floor(daily * sp / tot);
      song.platforms.apple      += Math.floor(daily * ap / tot);
      song.platforms.youtube    += Math.floor(daily * yt / tot);
      song.platforms.amazon     += Math.floor(daily * am / tot);
      song.platforms.soundcloud += Math.floor(daily * sc / tot);
      song.iMusic_sales   = (song.iMusic_sales   || 0) + purchases;
      song.iMusic_revenue = (song.iMusic_revenue || 0) + purchases * (song.iMusicPrice || 0.99) * 0.70;

      // Revenue
      const rev = (
        Math.floor(daily * sp / tot) * 0.003 +
        Math.floor(daily * ap / tot) * 0.007 +
        Math.floor(daily * yt / tot) * 0.001 +
        Math.floor(daily * (am + sc) / tot) * 0.004 +
        purchases * (song.iMusicPrice || 0.99) * 0.70
      );
      game.money = (game.money || 0) + rev;

      // Fan gain: 1% of daily streams → new fans
      const fanGain = Math.floor(streaming * 0.01);
      if (fanGain > 0) {
        if (!game.fansByRegion) game.fansByRegion = {};
        let totalW = 0;
        const weights: Record<string, number> = {};
        regions.forEach(r => {
          const w = ((game.fansByRegion[r] || 0) * 0.5) + 10;
          weights[r] = w; totalW += w;
        });
        regions.forEach(r => {
          const share = Math.floor(fanGain * (weights[r] / totalW));
          if (share > 0) {
            game.fansByRegion[r] = (game.fansByRegion[r] || 0) + share;
            if (!game.social) game.social = { instagram:0, tiktok:0, twitter:0, youtube:0 };
            game.social.instagram = (game.social.instagram || 0) + Math.floor(share * 0.50);
            game.social.tiktok    = (game.social.tiktok    || 0) + Math.floor(share * 0.35);
            game.social.twitter   = (game.social.twitter   || 0) + Math.floor(share * 0.25);
            game.social.youtube   = (game.social.youtube   || 0) + Math.floor(share * 0.15);
          }
        });
      }
    });
  }

  // Mark this day as processed
  game._lastSimDay = day;
}

// ─── main handler ────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request) => {
  try {
    // 1. Get the authoritative current game day from global_timer
    const timerRows = await dbGet('global_timer?id=eq.main&select=current_day');
    if (!timerRows.length) {
      return new Response(JSON.stringify({ error: 'No timer row' }), { status: 404 });
    }
    const serverDay: number = timerRows[0].current_day || 1;

    // 2. Load all players (paginate — up to 1000 for now)
    const players = await dbGet('players?select=user_id,game_data&limit=1000') as any[];

    let processed = 0;
    let skipped   = 0;
    const errors: string[] = [];

    for (const player of players) {
      try {
        const game = player.game_data;
        if (!game) { skipped++; continue; }

        // Skip players who saved their game within the last 4 hours.
        // Their client is (or was very recently) handling their own simulation via
        // _onDayAdvanced, so running the server-side version would overwrite newer
        // session data with the stale snapshot we loaded from the DB.
        const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
        if (game._lastOnlineSave && (Date.now() - game._lastOnlineSave) < FOUR_HOURS_MS) {
          skipped++;
          continue;
        }

        // Determine which days this player still needs simulated
        const lastSim = game._lastSimDay || (game._lastProcessedDay ? game._lastProcessedDay - 1 : (game.day || 1) - 1);
        const missedDays = Math.max(0, serverDay - lastSim);

        if (missedDays === 0) { skipped++; continue; }

        // Process up to 90 missed days (edge-function timeout safety)
        const toProcess = Math.min(missedDays, 90);
        for (let d = 1; d <= toProcess; d++) {
          simulateOneDay(game, lastSim + d);
        }

        // Patch back only game_data (character_data untouched)
        await dbPatch(
          `players?user_id=eq.${player.user_id}`,
          { game_data: game }
        );
        processed++;
      } catch (err) {
        errors.push(`${player.user_id}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({
        server_day: serverDay,
        players_total:     players.length,
        players_processed: processed,
        players_skipped:   skipped,
        errors,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
