-- Liens d'aperçu démo : accès MULTI-RÔLES + langue par défaut.
--
-- Évolution de demo_preview_links (20260705120000) : un lien peut désormais donner
-- accès à PLUSIEURS dashboards démo (target_accounts text[]) que le destinataire
-- peut parcourir via le switch de la bannière, et porte une langue par défaut
-- (en/fr/es) appliquée à l'ouverture.

ALTER TABLE public.demo_preview_links
  ADD COLUMN IF NOT EXISTS target_accounts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

-- Backfill : les liens existants (mono-rôle) deviennent des listes à un élément.
UPDATE public.demo_preview_links
  SET target_accounts = ARRAY[target_account]
  WHERE cardinality(target_accounts) = 0 AND target_account IS NOT NULL;

-- target_account (mono) devient facultatif : on garde la colonne comme "rôle
-- principal" (1er de la liste) pour compat, mais la vérité est target_accounts.
ALTER TABLE public.demo_preview_links ALTER COLUMN target_account DROP NOT NULL;

-- Contrainte de langue (ajoutée à part pour rester idempotent-friendly).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demo_preview_links_language_check'
  ) THEN
    ALTER TABLE public.demo_preview_links
      ADD CONSTRAINT demo_preview_links_language_check CHECK (language IN ('en', 'fr', 'es'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Les 3 RPC changent de signature (retour target_accounts[] + language) →
-- DROP puis CREATE (CREATE OR REPLACE ne peut pas changer le type de retour).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_demo_preview_link_public(text);
DROP FUNCTION IF EXISTS public.create_demo_preview_link(text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.verify_demo_preview_password(text, text);

-- RPC 1 — rendu public du gate (anon).
CREATE OR REPLACE FUNCTION public.get_demo_preview_link_public(p_token text)
RETURNS TABLE (
  label text,
  target_accounts text[],
  language text,
  is_valid boolean,
  invalid_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.demo_preview_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM public.demo_preview_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::text[], NULL::text, false, 'not_found'::text;
    RETURN;
  END IF;

  label := link.label;
  target_accounts := link.target_accounts;
  language := link.language;
  is_valid := true;
  invalid_reason := NULL;

  IF (NOT link.is_active) OR (link.revoked_at IS NOT NULL) THEN
    is_valid := false; invalid_reason := 'revoked';
  ELSIF link.expires_at IS NOT NULL AND link.expires_at < now() THEN
    is_valid := false; invalid_reason := 'expired';
  ELSIF link.failed_attempts > 10 THEN
    is_valid := false; invalid_reason := 'locked';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_demo_preview_link_public(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_demo_preview_link_public(text) TO anon, authenticated;

-- RPC 2 — création (super admin only), multi-rôles + langue.
CREATE OR REPLACE FUNCTION public.create_demo_preview_link(
  p_label text,
  p_password text,
  p_target_accounts text[],
  p_language text DEFAULT 'en',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (id uuid, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'label required';
  END IF;
  IF length(coalesce(p_password, '')) < 4 THEN
    RAISE EXCEPTION 'password too short';
  END IF;
  IF p_target_accounts IS NULL OR cardinality(p_target_accounts) = 0 THEN
    RAISE EXCEPTION 'at least one role required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_target_accounts) a
    WHERE a NOT IN ('owner','organizer','bde','promoter','agency','dj',
                    'affiliate','bouncer','barman','cloakroom','vip_host')
  ) THEN
    RAISE EXCEPTION 'invalid target_account';
  END IF;
  IF coalesce(p_language, 'en') NOT IN ('en','fr','es') THEN
    RAISE EXCEPTION 'invalid language';
  END IF;

  INSERT INTO public.demo_preview_links
    (label, target_accounts, target_account, language, password_hash, created_by, expires_at)
  VALUES (
    btrim(p_label),
    p_target_accounts,
    p_target_accounts[1],
    coalesce(p_language, 'en'),
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    auth.uid(),
    p_expires_at
  )
  RETURNING demo_preview_links.id, demo_preview_links.token INTO id, token;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_demo_preview_link(text, text, text[], text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_demo_preview_link(text, text, text[], text, timestamptz) TO authenticated;

-- RPC 3 — vérification du mot de passe (service role only).
CREATE OR REPLACE FUNCTION public.verify_demo_preview_password(p_token text, p_password text)
RETURNS TABLE (ok boolean, target_accounts text[], language text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.demo_preview_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM public.demo_preview_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, 'not_found'::text; RETURN;
  END IF;
  IF (NOT link.is_active) OR (link.revoked_at IS NOT NULL) THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, 'revoked'::text; RETURN;
  END IF;
  IF link.expires_at IS NOT NULL AND link.expires_at < now() THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, 'expired'::text; RETURN;
  END IF;
  IF link.failed_attempts > 10 THEN
    RETURN QUERY SELECT false, NULL::text[], NULL::text, 'locked'::text; RETURN;
  END IF;

  IF extensions.crypt(coalesce(p_password, ''), link.password_hash) <> link.password_hash THEN
    UPDATE public.demo_preview_links
      SET failed_attempts = failed_attempts + 1
      WHERE id = link.id;
    RETURN QUERY SELECT false, NULL::text[], NULL::text, 'wrong_password'::text; RETURN;
  END IF;

  UPDATE public.demo_preview_links
    SET used_count = used_count + 1,
        last_used_at = now(),
        failed_attempts = 0
    WHERE id = link.id;

  RETURN QUERY SELECT true, link.target_accounts, link.language, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_demo_preview_password(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_demo_preview_password(text, text) TO service_role;
