-- FIX (2026-06-17): purge_expired_personal_data referenced visitor_events.created_at,
-- but that table's timestamp column is "ts". The original 2026-05-12 retention migration
-- carried the same wrong column name; it was never noticed because that migration never
-- actually ran against the live schema. Correct the column so the daily cron purge works.

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
  WHERE ts < now() - interval '13 months';

  -- Live pings: 1 hour
  DELETE FROM public.live_visitor_pings
  WHERE last_seen < now() - interval '1 hour';

  -- OTP tokens: 24 hours
  DELETE FROM public.guest_claim_otps
  WHERE created_at < now() - interval '24 hours';

  -- Stale MFA pending entries: 1 hour (also where plaintext setup secrets live).
  DELETE FROM public.mfa_pending
  WHERE created_at < now() - interval '1 hour';

  -- Staff rate limit windows: optional table, guarded.
  IF to_regclass('public.staff_pin_rate_limits') IS NOT NULL THEN
    DELETE FROM public.staff_pin_rate_limits
    WHERE window_start < now() - interval '1 day';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_personal_data() FROM PUBLIC, anon, authenticated;
