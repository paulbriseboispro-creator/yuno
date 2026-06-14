-- RGPD data retention policy.
-- Automatically purges personal data after defined retention periods.
--
-- Retention windows (CNIL / ePrivacy compliant):
--   - security_logs          : 12 months
--   - visitor_sessions/events: 13 months (analytics, IAB TCF2 standard)
--   - live_visitor_pings     :  1 hour   (realtime, no long-term value)
--   - guest_claim_otps       : 24 hours  (short-lived tokens)
--   - mfa_pending            : 15 minutes → handled by app; purge stragglers after 1 hour

-- 1. Purge function — runs via pg_cron.
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

  -- Stale MFA pending entries: 1 hour (belt-and-suspenders after 15-min app TTL)
  DELETE FROM public.mfa_pending
  WHERE created_at < now() - interval '1 hour';

  -- Staff rate limit windows: already cleaned by its own cron, but purge anything older than 1 day
  DELETE FROM public.staff_pin_rate_limits
  WHERE window_start < now() - interval '1 day';
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_personal_data() FROM PUBLIC, anon, authenticated;

-- 2. Schedule via pg_cron (daily at 03:00 UTC, low-traffic window).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'rgpd-purge-expired-personal-data',
      '0 3 * * *',
      $$SELECT public.purge_expired_personal_data()$$
    );
  END IF;
END $$;
