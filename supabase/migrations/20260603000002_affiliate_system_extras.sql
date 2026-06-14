-- ============================================================
-- AFFILIATE SYSTEM — extras
-- 1. Temporary metadata table for pending invitations
-- 2. pg_cron schedule for recurring event generation
-- ============================================================

-- 1. Temp metadata for affiliate invitations (stores city/type/commission
--    between invite email sent and user acceptance)
CREATE TABLE affiliate_invitations_meta (
  invitation_token text PRIMARY KEY,
  affiliate_name text NOT NULL,
  affiliate_type text NOT NULL DEFAULT 'independent'
    CHECK (affiliate_type IN ('yuno_internal', 'city_agency', 'independent')),
  city text,
  commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE affiliate_invitations_meta ENABLE ROW LEVEL SECURITY;
-- Only service role can access (no public policies needed)

-- Auto-cleanup: delete metadata for expired invitations (older than 15 days)
CREATE OR REPLACE FUNCTION cleanup_affiliate_invitation_meta()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM affiliate_invitations_meta
  WHERE created_at < now() - interval '15 days';
END;
$$;

-- 2. pg_cron: run create-affiliate-recurring-events daily at 06:00 UTC
-- (same pattern as existing reschedule_edge_cron)
SELECT cron.schedule(
  'create-affiliate-recurring-events',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/create-affiliate-recurring-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
