-- Demo preview links: password-gated, read-only demo dashboard access.
--
-- Paul (super admin) génère un lien unique par personne (ex. « Noah ») protégé par un
-- mot de passe qui lui est propre (ex. « el sorbo »). Le destinataire ouvre le lien,
-- saisit son mot de passe, et atterrit dans un dashboard démo EN LECTURE SEULE (owner,
-- organizer, dj, promoteur, staff…). La lecture seule est imposée côté client ; côté
-- base, on se contente de stocker le lien + un hash bcrypt du mot de passe.
--
-- Le chemin anonyme (rendu du gate + vérification du mot de passe) passe par des RPC
-- SECURITY DEFINER + l'edge function de redeem (service role). La table elle-même reste
-- verrouillée par RLS (seul le super admin la gère depuis le dashboard), donc aucun
-- risque d'énumération de jetons ni de fuite de hash.
--
-- Miroir volontaire de public.onboarding_links (20260701130000).

CREATE TABLE IF NOT EXISTS public.demo_preview_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Jeton public opaque (64 hex). Le mot de passe, lui, n'est JAMAIS dans l'URL.
  token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  -- Nom de la personne à qui on envoie le lien (ex. « Noah »). Affiché sur le gate.
  label TEXT NOT NULL,
  -- Type de compte démo ciblé → email démo côté edge function.
  target_account TEXT NOT NULL CHECK (target_account IN (
    'owner', 'organizer', 'bde', 'promoter', 'agency', 'dj',
    'affiliate', 'bouncer', 'barman', 'cloakroom', 'vip_host'
  )),
  -- bcrypt via pgcrypto : extensions.crypt(pw, extensions.gen_salt('bf', 10)).
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE,          -- NULL = pas d'expiration
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_count INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,   -- anti brute-force (blocage > 10)
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT demo_preview_links_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_demo_preview_links_token ON public.demo_preview_links (token);
CREATE INDEX IF NOT EXISTS idx_demo_preview_links_created_by ON public.demo_preview_links (created_by);

-- ---------------------------------------------------------------------------
-- RLS : seul le super admin gère les liens depuis le dashboard. Le chemin anonyme
-- de redeem n'emprunte JAMAIS ces policies (il passe par les RPC + service role).
-- ---------------------------------------------------------------------------
ALTER TABLE public.demo_preview_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage demo preview links"
  ON public.demo_preview_links FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- RPC 1 — rendu public du gate (anon). Renvoie le nom + le type de compte + la
-- validité, JAMAIS le hash ni le mot de passe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_demo_preview_link_public(p_token text)
RETURNS TABLE (
  label text,
  target_account text,
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
    RETURN QUERY SELECT NULL::text, NULL::text, false, 'not_found'::text;
    RETURN;
  END IF;

  label := link.label;
  target_account := link.target_account;
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

-- ---------------------------------------------------------------------------
-- RPC 2 — création d'un lien (super admin only). Hash le mot de passe côté base :
-- le hash ne transite jamais côté client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_demo_preview_link(
  p_label text,
  p_password text,
  p_target_account text,
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
  IF p_target_account NOT IN (
    'owner','organizer','bde','promoter','agency','dj',
    'affiliate','bouncer','barman','cloakroom','vip_host'
  ) THEN
    RAISE EXCEPTION 'invalid target_account';
  END IF;

  INSERT INTO public.demo_preview_links (label, target_account, password_hash, created_by, expires_at)
  VALUES (
    btrim(p_label),
    p_target_account,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    auth.uid(),
    p_expires_at
  )
  RETURNING demo_preview_links.id, demo_preview_links.token INTO id, token;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_demo_preview_link(text, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_demo_preview_link(text, text, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC 3 — vérification du mot de passe (service role UNIQUEMENT, appelée par
-- l'edge function de redeem). Compare le hash, gère le compteur anti brute-force,
-- incrémente used_count. Le hash ne quitte jamais Postgres.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_demo_preview_password(p_token text, p_password text)
RETURNS TABLE (ok boolean, target_account text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link public.demo_preview_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM public.demo_preview_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, 'not_found'::text; RETURN;
  END IF;
  IF (NOT link.is_active) OR (link.revoked_at IS NOT NULL) THEN
    RETURN QUERY SELECT false, NULL::text, 'revoked'::text; RETURN;
  END IF;
  IF link.expires_at IS NOT NULL AND link.expires_at < now() THEN
    RETURN QUERY SELECT false, NULL::text, 'expired'::text; RETURN;
  END IF;
  IF link.failed_attempts > 10 THEN
    RETURN QUERY SELECT false, NULL::text, 'locked'::text; RETURN;
  END IF;

  IF extensions.crypt(coalesce(p_password, ''), link.password_hash) <> link.password_hash THEN
    UPDATE public.demo_preview_links
      SET failed_attempts = failed_attempts + 1
      WHERE id = link.id;
    RETURN QUERY SELECT false, NULL::text, 'wrong_password'::text; RETURN;
  END IF;

  UPDATE public.demo_preview_links
    SET used_count = used_count + 1,
        last_used_at = now(),
        failed_attempts = 0
    WHERE id = link.id;

  RETURN QUERY SELECT true, link.target_account, NULL::text;
END;
$$;

-- Service role uniquement : ni anon ni authenticated ne peuvent brute-forcer la RPC.
REVOKE EXECUTE ON FUNCTION public.verify_demo_preview_password(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_demo_preview_password(text, text) TO service_role;
