-- Fix: the `create-affiliate-recurring-events` cron job authenticated against the
-- edge function with `current_setting('app.cron_secret', true)` — a Postgres GUC
-- that was never set (returns NULL) — instead of the Vault-backed
-- `private.get_cron_secret()` used by every other edge-calling cron.
--
-- Result: the job sent an empty `x-cron-secret` header and the edge function
-- rejected it (401). This realigns it onto the single source of truth (Vault),
-- so it sends the same secret as the rest and authenticates correctly.
--
-- Idempotent: cron.schedule upserts by job name (keeps the same jobid).

SELECT cron.schedule(
  'create-affiliate-recurring-events',
  '0 6 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/create-affiliate-recurring-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', private.get_cron_secret()
    ),
    body := '{}'::jsonb
  );
  $cmd$
);
