-- Schedule simulate-day edge function every 2 hours, 5 minutes after the
-- hour (so tick-timer has already advanced current_day before we read it).
--
-- pg_cron + pg_net must be enabled in your Supabase project.
-- Enable them: Supabase Dashboard → Database → Extensions → search "cron" and "http".
--
-- After running this migration the function will fire automatically.
-- You can also trigger it manually:
--   curl -X POST https://pvxrciebegirmrrrzkor.supabase.co/functions/v1/simulate-day \
--        -H "Authorization: Bearer <SERVICE_ROLE_KEY>"

select cron.schedule(
  'simulate-game-day',
  '5 */2 * * *',   -- every 2 hours at :05 past the hour (UTC)
  $$
  select net.http_post(
    url     := 'https://pvxrciebegirmrrrzkor.supabase.co/functions/v1/simulate-day',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
  $$
);
