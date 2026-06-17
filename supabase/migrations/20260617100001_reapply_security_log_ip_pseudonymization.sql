-- RE-APPLY (2026-06-17): pseudonymize IP addresses in security_logs.
--
-- The original 2026-05-12 migration (20260512100002) is recorded as applied but never
-- touched the live schema: security_logs still stores raw ip_address, no ip_hash column,
-- no hashing trigger. Raw client IPs are PII under GDPR — we keep a salted SHA-256 hash
-- for abuse detection instead of the raw value.
--
-- FIX vs the original: the 2026-05-12 version DROPPED the ip_address column while edge
-- functions (mfa, delete-account) still INSERT ip_address into security_logs, and its own
-- trigger referenced NEW.ip_address. Dropping the column would have broken every such
-- insert. Here we KEEP the column (so existing inserts keep working) but the BEFORE INSERT
-- trigger hashes it into ip_hash and nulls the raw value, so no raw IP is ever persisted.

-- 1. pgcrypto for digest() (Supabase standard schema = extensions).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Hash column.
ALTER TABLE public.security_logs
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- 3. Backfill: hash existing raw IPs, then null the raw column so no PII remains.
DO $$
DECLARE
  v_salt text := current_setting('app.ip_hash_salt', true);
BEGIN
  IF v_salt IS NULL OR v_salt = '' THEN
    v_salt := 'yuno-ip-salt-' || current_database();
  END IF;

  UPDATE public.security_logs
  SET ip_hash = encode(
        extensions.digest(v_salt || coalesce(ip_address, ''), 'sha256'),
        'hex'
      )
  WHERE ip_address IS NOT NULL
    AND ip_hash IS NULL;

  -- Erase the raw IPs we just hashed.
  UPDATE public.security_logs
  SET ip_address = NULL
  WHERE ip_address IS NOT NULL;
END;
$$;

-- 4. Trigger: hash on INSERT so Edge Functions that still send ip_address get it
--    transparently pseudonymized. The raw value is nulled before storage.
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
      extensions.digest(v_salt || NEW.ip_address, 'sha256'),
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
