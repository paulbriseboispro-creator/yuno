
-- 1. Schéma privé pour les helpers internes (idempotent)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- 2. Fonction qui lit le CRON_SECRET depuis Vault
CREATE OR REPLACE FUNCTION private.get_cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.get_cron_secret() FROM PUBLIC, anon, authenticated;

-- 3. Helper pour reprogrammer un job edge function avec le header x-cron-secret
CREATE OR REPLACE FUNCTION private.reschedule_edge_cron(
  p_job_name text,
  p_schedule text,
  p_function_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyZWRtZ2hpcWVzeXJtanF2eGVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1MjEzNzIsImV4cCI6MjA3OTA5NzM3Mn0.yMINnsInt5HIFY5mXvrIrLPXW9_738AD4F1HtNBEs4c';
  v_url text := 'https://kredmghiqesyrmjqvxen.supabase.co/functions/v1/' || p_function_path;
  v_command text;
BEGIN
  -- Unschedule any existing job with this name (ignore if not found)
  BEGIN
    PERFORM cron.unschedule(p_job_name);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Build the command. Headers are computed at execution time via private.get_cron_secret().
  v_command := format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer %s',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('triggered_at', now())
    );
  $cmd$, v_url, v_anon_key);

  PERFORM cron.schedule(p_job_name, p_schedule, v_command);
END;
$$;

REVOKE ALL ON FUNCTION private.reschedule_edge_cron(text, text, text) FROM PUBLIC, anon, authenticated;

-- 4. Reprogrammer les 16 jobs edge protégés par le CRON_SECRET
SELECT private.reschedule_edge_cron('archive-expired-orders-hourly',     '0 * * * *',     'archive-expired-orders');
SELECT private.reschedule_edge_cron('cart-abandonment-check',            '*/30 * * * *', 'cart-abandonment-check');
SELECT private.reschedule_edge_cron('cleanup-expired-orders-hourly',     '0 * * * *',     'cleanup-expired-orders');
SELECT private.reschedule_edge_cron('cleanup-expired-invoices-daily',    '0 3 * * *',     'cleanup-expired-invoices');
SELECT private.reschedule_edge_cron('cleanup-pending-purchases',         '*/15 * * * *', 'cleanup-pending-purchases');
SELECT private.reschedule_edge_cron('event-reminder-hourly',             '0 * * * *',     'event-reminder');
SELECT private.reschedule_edge_cron('inactivity-reminder-weekly',        '0 14 * * 1',    'inactivity-reminder');
SELECT private.reschedule_edge_cron('process-scheduled-campaigns',       '*/5 * * * *',  'process-scheduled-campaigns');
SELECT private.reschedule_edge_cron('send-event-recap-hourly',           '0 * * * *',     'send-event-recap');
SELECT private.reschedule_edge_cron('send-low-ticket-alert-hourly',      '0 * * * *',     'send-low-ticket-alert');
SELECT private.reschedule_edge_cron('send-missed-you-weekly',            '0 15 * * 3',    'send-missed-you');
SELECT private.reschedule_edge_cron('send-next-event-recommendation',    '0 10 * * *',    'send-next-event-recommendation');
SELECT private.reschedule_edge_cron('send-owner-night-summary',          '0 8 * * *',     'send-owner-night-summary');
SELECT private.reschedule_edge_cron('send-owner-weekly-report',          '0 9 * * 1',     'send-owner-weekly-report');
SELECT private.reschedule_edge_cron('send-pre-night-checklist',          '0 16 * * *',    'send-pre-night-checklist');
SELECT private.reschedule_edge_cron('weekly-digest',                     '0 10 * * 1',    'weekly-digest');

-- Note: process-scheduled-campaigns-every-5min was a duplicate of process-scheduled-campaigns
-- → unschedule it so we don't fire the same job twice
DO $$
BEGIN
  PERFORM cron.unschedule('process-scheduled-campaigns-every-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;
