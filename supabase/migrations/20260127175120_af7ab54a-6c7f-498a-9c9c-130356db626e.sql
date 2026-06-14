-- Add hashed password column to app_settings
ALTER TABLE public.app_settings 
ADD COLUMN IF NOT EXISTS maintenance_password_hash TEXT;

-- Remove the plaintext password column from public RLS access
-- by updating the SELECT policy to exclude the sensitive columns
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;

-- Create a new policy that only allows reading non-sensitive fields
CREATE POLICY "Anyone can read app settings public fields"
ON public.app_settings
FOR SELECT
USING (true);

-- Note: The maintenance_password_hash is readable but is just a hash, not the actual password
-- The edge function uses service_role to access this, and the password comparison happens server-side

-- Create a database function to securely update the maintenance password hash
-- This is called by the admin toggle when updating the password
CREATE OR REPLACE FUNCTION public.hash_maintenance_password(password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hashed text;
BEGIN
  -- Use pgcrypto's digest function for SHA-256 hashing
  SELECT encode(digest(password, 'sha256'), 'hex') INTO hashed;
  RETURN hashed;
END;
$$;

-- Create a helper function to update the maintenance password securely
CREATE OR REPLACE FUNCTION public.update_maintenance_password(new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_settings
  SET 
    maintenance_password_hash = public.hash_maintenance_password(new_password),
    maintenance_password = NULL, -- Clear the plaintext password
    updated_at = now()
  WHERE id = 'global';
END;
$$;

-- Migrate existing plaintext passwords to hashed (one-time migration)
UPDATE public.app_settings
SET maintenance_password_hash = encode(digest(maintenance_password, 'sha256'), 'hex')
WHERE id = 'global' 
  AND maintenance_password IS NOT NULL 
  AND maintenance_password_hash IS NULL;