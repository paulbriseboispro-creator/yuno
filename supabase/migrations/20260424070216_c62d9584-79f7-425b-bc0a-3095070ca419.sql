-- Server-side verifier so the edge function can delegate password checking to Postgres
-- (which already has bcrypt via pgcrypto). Returns true on match, with transparent upgrade
-- of legacy unsalted SHA-256 hashes to bcrypt on a successful login.
CREATE OR REPLACE FUNCTION public.verify_maintenance_password(plain text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  stored text;
  legacy_hex text;
  is_match boolean := false;
BEGIN
  IF plain IS NULL OR length(plain) = 0 OR length(plain) > 200 THEN
    RETURN false;
  END IF;

  SELECT maintenance_password_hash INTO stored
  FROM public.app_settings
  WHERE id = 'global';

  IF stored IS NULL OR length(stored) = 0 THEN
    RETURN false;
  END IF;

  -- bcrypt hashes start with $2a$, $2b$, or $2y$
  IF stored LIKE '$2_$%' THEN
    is_match := (crypt(plain, stored) = stored);
    RETURN is_match;
  END IF;

  -- Legacy unsalted SHA-256 hex (64 chars). Verify, then upgrade to bcrypt on match.
  legacy_hex := encode(digest(plain, 'sha256'), 'hex');
  IF legacy_hex = stored THEN
    UPDATE public.app_settings
    SET maintenance_password_hash = crypt(plain, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = 'global';
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- Lock down access: only service role (edge functions) should call this.
REVOKE ALL ON FUNCTION public.verify_maintenance_password(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_maintenance_password(text) TO service_role;