-- Ensure pgcrypto is available (it already is for digest()).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Switch hash_maintenance_password to use bcrypt (salted, slow KDF) instead of unsalted SHA-256.
CREATE OR REPLACE FUNCTION public.hash_maintenance_password(password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hashed text;
BEGIN
  -- bcrypt with cost 10 (work factor); produces a salted hash like $2a$10$...
  SELECT crypt(password, gen_salt('bf', 10)) INTO hashed;
  RETURN hashed;
END;
$function$;

-- update_maintenance_password keeps the same signature, now stores bcrypt hashes.
-- (Definition unchanged — it already calls hash_maintenance_password.)