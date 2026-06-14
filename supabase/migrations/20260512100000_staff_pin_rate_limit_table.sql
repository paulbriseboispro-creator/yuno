-- Distributed rate limiting for staff PIN login.
-- Replaces the in-memory Map which resets per Edge Function instance.

CREATE TABLE IF NOT EXISTS public.staff_pin_rate_limits (
  ip_address text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_address)
);

-- Expire rows older than 15 minutes automatically via a lightweight cron.
-- Falls back to cleanup-on-read in the Edge Function.
ALTER TABLE public.staff_pin_rate_limits ENABLE ROW LEVEL SECURITY;

-- Only the service role (Edge Functions) may read/write this table.
-- anon and authenticated users have no access.
CREATE POLICY "Service role only" ON public.staff_pin_rate_limits
  FOR ALL TO authenticated USING (false);

-- Atomic upsert: increments attempts within the active window, or resets on a new window.
-- Returns the current attempt count after incrementing.
CREATE OR REPLACE FUNCTION public.upsert_staff_pin_rate_limit(
  p_ip text,
  p_window_cutoff timestamptz,
  p_max_attempts integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
BEGIN
  INSERT INTO public.staff_pin_rate_limits (ip_address, attempts, window_start)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip_address) DO UPDATE
    SET
      attempts = CASE
        WHEN staff_pin_rate_limits.window_start < p_window_cutoff
        THEN 1
        ELSE LEAST(staff_pin_rate_limits.attempts + 1, p_max_attempts + 1)
      END,
      window_start = CASE
        WHEN staff_pin_rate_limits.window_start < p_window_cutoff
        THEN now()
        ELSE staff_pin_rate_limits.window_start
      END
  RETURNING attempts INTO v_attempts;

  RETURN v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_staff_pin_rate_limit(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;

-- pg_cron job: clean up expired rate limit windows every 5 minutes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-staff-pin-rate-limits',
      '*/5 * * * *',
      $$DELETE FROM public.staff_pin_rate_limits WHERE window_start < now() - interval '15 minutes'$$
    );
  END IF;
END $$;
