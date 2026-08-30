// tick-timer — Sound Check Supabase edge function
//
// Advances global_timer.current_day to the correct value based on real time,
// even when no game client is online.  Called on a pg_cron schedule every
// 30 minutes so the timer never drifts more than 30 minutes behind.
//
// How it works:
//   epoch_basis = the 2-hour epoch-block index when current_day was 1
//   correct_day = floor(Date.now() / DAY_MS) - epoch_basis + 1
//
// The function only ever increases current_day; it never goes backwards.
// When it advances the day the realtime subscription on any connected clients
// fires exactly as if a player had advanced it — they see the new day
// immediately.  Offline players get the correct server day on next login
// and their catch-up logic replays the missed days normally.
//
// Setup (one-time, Supabase Dashboard → SQL Editor):
//   Run supabase/migrations/20260830_timer_epoch_basis.sql first.
//   Then schedule this function:
//
//   select cron.schedule(
//     'tick-game-timer',
//     '*/30 * * * *',
//     $$
//     select net.http_post(
//       url    := 'https://pvxrciebegirmrrrzkor.supabase.co/functions/v1/tick-timer',
//       headers:= jsonb_build_object(
//                   'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
//                   'Content-Type',  'application/json'
//                 ),
//       body   := '{}'::jsonb
//     );
//     $$
//   );
//
//   Or trigger it manually:
//   curl -X POST https://pvxrciebegirmrrrzkor.supabase.co/functions/v1/tick-timer \
//        -H "Authorization: Bearer <SERVICE_ROLE_KEY>"

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const DAY_MS = 7_200_000; // 2 real hours per game day — matches client DAY_MS

Deno.serve(async (_req: Request) => {
  try {
    // Read current timer state
    const readRes = await fetch(
      `${SUPABASE_URL}/rest/v1/global_timer?id=eq.main&select=current_day,epoch_basis`,
      {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!readRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to read timer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rows = await readRes.json() as { current_day: number; epoch_basis: number | null }[];
    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'No timer row found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let { current_day, epoch_basis } = rows[0];
    const now = Date.now();
    const currentEpochBlock = Math.floor(now / DAY_MS);

    // If epoch_basis is missing (migration not yet run), back-fill it now
    if (epoch_basis == null) {
      epoch_basis = currentEpochBlock - current_day + 1;
      await fetch(
        `${SUPABASE_URL}/rest/v1/global_timer?id=eq.main`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ epoch_basis }),
        }
      );
    }

    // Compute the day that should be current right now
    const target_day = currentEpochBlock - epoch_basis + 1;

    if (target_day <= current_day) {
      // Already up-to-date — nothing to do
      return new Response(
        JSON.stringify({ advanced: false, current_day, target_day }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Advance current_day to the correct value.
    // Use a conditional update (lt) so concurrent client advances can't cause
    // current_day to go backward.
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/global_timer?id=eq.main&current_day=lt.${target_day}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          current_day: target_day,
          current_week: Math.ceil(target_day / 7),
        }),
      }
    );

    if (!updateRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to update timer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        advanced: true,
        from: current_day,
        to: target_day,
        days_advanced: target_day - current_day,
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
