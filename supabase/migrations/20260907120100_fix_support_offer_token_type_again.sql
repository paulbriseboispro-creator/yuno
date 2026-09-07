-- Correctif de 20260907120000 : la réécriture de
-- accept_support_offer_from_invitation y est repartie du corps d'origine
-- (20260824190000) et a perdu le cast du jeton posé par 20260824191000
-- (`platform_invitations.token` est un uuid). `supabase db lint --linked` l'a
-- relevé aussitôt (« operator does not exist: uuid = text »). On redépose la
-- version castée, avec la lecture NULL-aware de `expires_at`.

CREATE OR REPLACE FUNCTION public.accept_support_offer_from_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token uuid;
  v_inv   public.platform_invitations%ROWTYPE;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;

  BEGIN
    v_token := _token::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invitation_not_found';
  END;

  SELECT * INTO v_inv FROM public.platform_invitations WHERE token = v_token;
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

REVOKE ALL ON FUNCTION public.accept_support_offer_from_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_support_offer_from_invitation(text) TO authenticated;
