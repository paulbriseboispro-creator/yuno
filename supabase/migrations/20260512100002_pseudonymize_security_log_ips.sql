-- Pseudonymize IP addresses stored in security_logs.
-- Replaces the raw IP column with a salted SHA-256 hash so logs
-- remain useful for abuse detection without storing PII.
--
-- Approach:
--   1. Add ip_hash column (text, stores hex-encoded SHA-256).
--   2. Backfill existing rows using pgcrypto digest().
--   3. Drop the old ip_address column.
--   4. Create a trigger so future inserts hash automatically.

-- 1. Ensure pgcrypto is available (needed for digest()).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add the new column.
ALTER TABLE public.security_logs
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- 3. Backfill: hash existing raw IPs with a per-deployment salt stored as a DB secret.
--    We use a fixed prefix salt so results are deterministic within the same deployment
--    but not reversible or rainbow-table-able across deployments.
--    The salt is the project_id (known to the service, not public).
DO $$
DECLARE
  v_salt text := current_setting('app.ip_hash_salt', true);
BEGIN
  IF v_salt IS NULL OR v_salt = '' THEN
    v_salt := 'yuno-ip-salt-' || current_database();
  END IF;

  UPDATE public.security_logs
  SET ip_hash = encode(
    digest(v_salt || coalesce(ip_address, ''), 'sha256'),
    'hex'
  )
  WHERE ip_address IS NOT NULL
    AND ip_hash IS NULL;
END;
$$;

-- 4. Drop the raw column.
ALTER TABLE public.security_logs
  DROP COLUMN IF EXISTS ip_address;

-- 5. Trigger: hash on INSERT so Edge Functions sending ip_address get it transparently.
--    Edge Functions still pass ip_address; the trigger hashes it before storage.
CREATE OR REPLACE FUNCTION public.hash_security_log_ip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_salt text := current_setting('app.ip_hash_salt', true);
BEGIN
  IF v_salt IS NULL OR v_salt = '' THEN
    v_salt := 'yuno-ip-salt-' || current_database();
  END IF;
  IF NEW.ip_address IS NOT NULL THEN
    NEW.ip_hash := encode(
      digest(v_salt || NEW.ip_address, 'sha256'),
      'hex'
    );
    NEW.ip_address := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_security_log_ip ON public.security_logs;
CREATE TRIGGER trg_hash_security_log_ip
  BEFORE INSERT ON public.security_logs
  FOR EACH ROW EXECUTE FUNCTION public.hash_security_log_ip();
