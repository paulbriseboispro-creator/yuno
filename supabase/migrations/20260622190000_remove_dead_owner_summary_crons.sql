-- Remove two dead cron jobs that POST to edge functions which were never
-- implemented: `send-owner-night-summary` (daily 08:00) and
-- `send-owner-weekly-report` (Monday 09:00). Both have no function folder under
-- supabase/functions/ and no source anywhere in the repo, so the cron has been
-- hitting a 404 on every fire. Unscheduling stops the silent failures.
--
-- If/when these owner digest emails are actually built, re-add the schedule in a
-- new migration alongside the deployed function.

DO $$
BEGIN
  PERFORM cron.unschedule('send-owner-night-summary');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('send-owner-weekly-report');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;
