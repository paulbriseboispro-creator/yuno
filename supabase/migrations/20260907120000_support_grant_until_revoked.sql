-- Accès assisté : l'autorisation vaut JUSQU'À RÉVOCATION, plus 7 jours.
--
-- La fenêtre de 7 jours forçait le pro à re-consentir chaque semaine pendant
-- une configuration qui en prend plusieurs (WOH : accord du 29/08, expiré le
-- 05/09, chantier toujours en cours). Le consentement reste la porte — le pro
-- (ou l'admin) coupe l'accès en un clic via revoke_support_grant — mais il ne
-- se referme plus tout seul. Les SESSIONS gardent leurs 12 heures : c'est le
-- jeton qui est court, pas l'accord.
--
-- Modèle : `expires_at` devient NULLABLE, NULL = « jusqu'à révocation ».
-- C'est la valeur par défaut désormais ; les accords ouverts existants sont
-- alignés (c'est ce qui rend l'accès WOH sans nouvelle demande de
-- consentement — l'accord donné n'a jamais été retiré). Les quatre RPC qui
-- lisaient `expires_at > now()` traitent NULL comme « toujours valable ».

ALTER TABLE public.admin_support_grants
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT NULL;

UPDATE public.admin_support_grants
   SET expires_at = NULL
 WHERE status IN ('pending', 'active');

-- ── approve_support_grant : NULL n'est jamais périmé ────────────────────────

CREATE OR REPLACE FUNCTION public.approve_support_grant(_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.admin_support_grants%ROWTYPE;
BEGIN
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  SELECT * INTO g FROM public.admin_support_grants WHERE id = _grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_not_found'; END IF;
  IF g.target_user_id <> auth.uid() THEN RAISE EXCEPTION 'not_grant_target'; END IF;
  IF g.status <> 'pending' THEN RAISE EXCEPTION 'grant_not_pending'; END IF;
  IF g.expires_at IS NOT NULL AND g.expires_at <= now() THEN
    RAISE EXCEPTION 'grant_expired';
  END IF;

  UPDATE public.admin_support_grants
     SET status = 'active', approved_at = now()
   WHERE id = _grant_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (_grant_id, g.target_user_id, auth.uid(), 'grant_approved');
END;
$$;

-- ── request_support_help : « déjà un accès ouvert » inclut les accords sans fin

CREATE OR REPLACE FUNCTION public.request_support_help(_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin uuid;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- Une session support ne peut pas se prolonger toute seule en « demandant de
  -- l'aide » au nom du pro.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden';
  END IF;

  -- Déjà un accès ouvert : ne pas empiler les grants.
  SELECT id INTO v_id
    FROM public.admin_support_grants
   WHERE target_user_id = v_uid
     AND status IN ('pending', 'active')
     AND (expires_at IS NULL OR expires_at > now())
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- `requested_by` est NOT NULL : on l'attribue au super admin. En pratique il
  -- n'y en a qu'un (Paul) ; le champ dit « qui pourra ouvrir la session », pas
  -- « qui a demandé » — c'est `initiated_by` qui porte cette nuance.
  SELECT ur.user_id INTO v_admin
    FROM public.user_roles ur
   WHERE ur.role = 'admin'
   ORDER BY ur.created_at
   LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no_support_contact'; END IF;

  INSERT INTO public.admin_support_grants
    (target_user_id, requested_by, status, reason, approved_at, initiated_by)
  VALUES
    (v_uid, v_admin, 'active', NULLIF(btrim(coalesce(_reason, '')), ''), now(), 'client')
  RETURNING id INTO v_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (v_id, v_uid, v_uid, 'help_requested');

  RETURN v_id;
END;
$$;

-- ── accept_support_offer_from_invitation (invitations plateforme) ───────────

CREATE OR REPLACE FUNCTION public.accept_support_offer_from_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.platform_invitations%ROWTYPE;
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;

  SELECT * INTO v_inv FROM public.platform_invitations WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found'; END IF;
  IF NOT v_inv.offer_support_help THEN RAISE EXCEPTION 'no_offer_on_invitation'; END IF;

  -- L'invitation doit avoir été acceptée PAR CE COMPTE : sans ce contrôle, un
  -- jeton d'invitation qui fuite permettrait d'ouvrir un accès sur un tiers.
  IF v_inv.accepted_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_invitation_recipient';
  END IF;

  -- Déjà un accès en cours : ne pas empiler.
  SELECT id INTO v_id
    FROM public.admin_support_grants
   WHERE target_user_id = v_uid
     AND status IN ('pending', 'active')
     AND (expires_at IS NULL OR expires_at > now())
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.admin_support_grants
    (target_user_id, requested_by, status, reason, approved_at, initiated_by)
  VALUES (
    v_uid,
    v_inv.invited_by,
    'active',
    'Accepté à l''ouverture du compte : configuration par l''équipe Yuno.',
    now(),
    'client'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (v_id, v_uid, v_uid, 'help_accepted_at_signup');

  RETURN v_id;
END;
$$;

-- ── accept_support_offer_from_owner_invitation (invitations club) ───────────

CREATE OR REPLACE FUNCTION public.accept_support_offer_from_owner_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inv   public.owner_invitations%ROWTYPE;
  v_admin uuid;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;

  SELECT * INTO v_inv FROM public.owner_invitations WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found'; END IF;
  IF NOT v_inv.offer_support_help THEN RAISE EXCEPTION 'no_offer_on_invitation'; END IF;

  -- L'invitation doit avoir été acceptée PAR CE COMPTE : sans ce contrôle, un
  -- jeton d'invitation qui fuite permettrait d'ouvrir un accès sur un tiers.
  IF v_inv.accepted_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_invitation_recipient';
  END IF;

  SELECT id INTO v_id
    FROM public.admin_support_grants
   WHERE target_user_id = v_uid
     AND status IN ('pending', 'active')
     AND (expires_at IS NULL OR expires_at > now())
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Les vieilles lignes n'ont pas invited_by : repli sur le premier admin,
  -- comme request_support_help (20260824120006).
  v_admin := v_inv.invited_by;
  IF v_admin IS NULL THEN
    SELECT ur.user_id INTO v_admin
      FROM public.user_roles ur
     WHERE ur.role = 'admin'
     ORDER BY ur.created_at
     LIMIT 1;
  END IF;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no_support_contact'; END IF;

  INSERT INTO public.admin_support_grants
    (target_user_id, requested_by, status, reason, approved_at, initiated_by)
  VALUES (
    v_uid,
    v_admin,
    'active',
    'Accepté à l''ouverture du compte : configuration par l''équipe Yuno.',
    now(),
    'client'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.admin_support_audit (grant_id, target_user_id, actor_id, action)
  VALUES (v_id, v_uid, v_uid, 'help_accepted_at_signup');

  RETURN v_id;
END;
$$;
