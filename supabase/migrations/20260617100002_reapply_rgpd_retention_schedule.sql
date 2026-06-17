-- RE-APPLY (2026-06-17): GDPR (RGPD) data retention purge + pg_cron schedule.
--
-- The original 2026-05-12 migration (20260512100003) is recorded as applied but never
-- touched the live schema: purge_expired_personal_data() did not exist and no cron job
-- named 'rgpd-purge-expired-personal-data' was scheduled, so personal data was never
-- purged. pg_cron and supabase_vault are both installed on this project.
--
-- FIX vs the original: the staff_pin_rate_limits table does not exist on this project
-- (its 2026-05-12 migration also never applied), so its DELETE is guarded with to_regclass
-- to keep the purge from aborting.
--
-- Retention windows (CNIL / ePrivacy aligned):
--   security_logs            : 12 months
--   visitor_sessions/events  : 13 months (analytics, IAB TCF2 standard)
--   live_visitor_pings       :  1 hour
--   guest_claim_otps         : 24 hours (short-lived OTP tokens)
--   mfa_pending              :  1 hour  (belt-and-suspenders after the 15-min app TTL)

CREATE OR REPLACE FUNCTION public.purge_expired_personal_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security audit logs: 12 months
  DELETE FROM public.security_logs
  WHERE created_at < now() - interval '12 months';

  -- Visitor analytics: 13 months
  DELETE FROM public.visitor_sessions
  WHERE created_at < now() - interval '13 months';

  DELETE FROM public.visitor_events
  WHERE created_at < now() - interval '13 months';

  -- Live pings: 1 hour
  DELETE FROM public.live_visitor_pings
  WHERE last_seen < now() - interval '1 hour';

  -- OTP tokens: 24 hours
  DELETE FROM public.guest_claim_otps
  WHERE created_at < now() - interval '24 hours';

  -- Stale MFA pending entries: 1 hour (belt-and-suspenders after 15-min app TTL).
  -- This is also where plaintext setup secrets live, so purging them promptly matters.
  DELETE FROM public.mfa_pending
  WHERE created_at < now() - interval '1 hour';

  -- Staff rate limit windows: optional table, guard so a missing table can't abort the purge.
  IF to_regclass('public.staff_pin_rate_limits') IS NOT NULL THEN
    DELETE FROM public.staff_pin_rate_limits
    WHERE window_start < now() - interval '1 day';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_personal_data() FROM PUBLIC, anon, authenticated;

-- Schedule via pg_cron (daily at 03:00 UTC, low-traffic window).
-- cron.schedule upserts by jobname, so this is safe to re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'rgpd-purge-expired-personal-data',
      '0 3 * * *',
      $cron$SELECT public.purge_expired_personal_data()$cron$
    );
  END IF;
END $$;
