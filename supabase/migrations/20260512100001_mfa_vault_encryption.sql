-- Migrate MFA TOTP secrets from base64 (mfa_secrets.secret_encrypted)
-- to Supabase Vault (pgsodium AES-256 encryption at rest).
--
-- Approach:
--   1. Add vault_secret_id column to mfa_secrets.
--   2. Create service-role-only wrapper RPCs for store/get/delete.
--   3. Backfill existing base64 secrets into Vault and clear the old column.
--
-- Edge Functions call store_mfa_totp_secret / get_mfa_totp_secret via supabaseAdmin.rpc().

-- 1. Schema change -------------------------------------------------------

ALTER TABLE public.mfa_secrets
  ADD COLUMN IF NOT EXISTS vault_secret_id uuid;

-- 2. Store wrapper (service_role only) ------------------------------------

CREATE OR REPLACE FUNCTION public.store_mfa_totp_secret(
  p_user_id  uuid,
  p_secret   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_old_vault_id uuid;
  v_new_vault_id uuid;
BEGIN
  -- Delete the old vault entry if one exists.
  SELECT vault_secret_id INTO v_old_vault_id
  FROM public.mfa_secrets
  WHERE user_id = p_user_id;

  IF v_old_vault_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old_vault_id;
  END IF;

  -- Create a new encrypted secret in Vault.
  v_new_vault_id := vault.create_secret(
    p_secret,
    'mfa_totp_' || p_user_id::text,
    'TOTP secret for user ' || p_user_id::text
  );

  -- Upsert mfa_secrets: store vault ID, clear the old base64 column.
  INSERT INTO public.mfa_secrets (user_id, vault_secret_id, secret_encrypted)
  VALUES (p_user_id, v_new_vault_id, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET vault_secret_id  = v_new_vault_id,
        secret_encrypted = NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.store_mfa_totp_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.store_mfa_totp_secret(uuid, text) TO service_role;

-- 3. Get wrapper (service_role only) --------------------------------------

CREATE OR REPLACE FUNCTION public.get_mfa_totp_secret(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT ds.decrypted_secret
  FROM   vault.decrypted_secrets ds
  JOIN   public.mfa_secrets ms ON ms.vault_secret_id = ds.id
  WHERE  ms.user_id = p_user_id
  LIMIT  1;
$$;

REVOKE ALL ON FUNCTION public.get_mfa_totp_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_mfa_totp_secret(uuid) TO service_role;

-- 4. Delete wrapper (called when user disables MFA) -----------------------

CREATE OR REPLACE FUNCTION public.delete_mfa_totp_secret(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_vault_id uuid;
BEGIN
  SELECT vault_secret_id INTO v_vault_id
  FROM public.mfa_secrets
  WHERE user_id = p_user_id;

  IF v_vault_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_vault_id;
  END IF;

  DELETE FROM public.mfa_secrets WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_mfa_totp_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_mfa_totp_secret(uuid) TO service_role;

-- 5. Backfill existing base64 secrets ------------------------------------
-- base64 is reversible: convert_from(decode(col, 'base64'), 'UTF8')

DO $$
DECLARE
  r          RECORD;
  v_vault_id uuid;
BEGIN
  FOR r IN
    SELECT user_id, secret_encrypted
    FROM   public.mfa_secrets
    WHERE  secret_encrypted IS NOT NULL
      AND  vault_secret_id  IS NULL
  LOOP
    BEGIN
      v_vault_id := vault.create_secret(
        convert_from(decode(r.secret_encrypted, 'base64'), 'UTF8'),
        'mfa_totp_' || r.user_id::text,
        'TOTP secret (backfilled from base64)'
      );
      UPDATE public.mfa_secrets
      SET vault_secret_id  = v_vault_id,
          secret_encrypted = NULL
      WHERE user_id = r.user_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'MFA backfill failed for user %: %', r.user_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
