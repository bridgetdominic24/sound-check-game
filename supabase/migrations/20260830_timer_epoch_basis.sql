-- Add epoch_basis to global_timer so the server-side tick function can
-- compute the correct current_day even when no client is online.
--
-- epoch_basis = the number of complete 2-hour blocks (floor(unix_ms / 7200000))
-- that had elapsed since the Unix epoch when current_day was 1.
-- Correct day at any moment: floor(unix_now_ms / 7200000) - epoch_basis + 1
--
-- We back-calculate this from the row's existing current_day so the value is
-- consistent with however many days have already been processed.

alter table global_timer
  add column if not exists epoch_basis bigint;

-- Back-fill from the existing current_day using "now" as the anchor.
-- This is a one-time calculation; the tick function will never change epoch_basis.
update global_timer
  set epoch_basis = floor(extract(epoch from now()) * 1000.0 / 7200000)
                    - current_day + 1
  where id = 'main'
    and epoch_basis is null;
