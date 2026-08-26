-- ============================================================================
-- L'invitation owner peut proposer l'assistance Yuno (mode support).
--
-- Même mécanique que platform_invitations (20260824190000) : l'admin coche
-- « proposer l'assistance » à l'envoi, et à l'acceptation le nouveau owner
-- voit l'écran de consentement (SupportOfferScreen). S'il accepte, un grant
-- admin_support_grants directement actif est créé — c'est le pro qui consent,
-- jamais l'admin qui s'auto-attribue l'accès.
--
-- Le RPC porte un nom distinct : accept_support_offer_from_invitation(_token
-- text) existe déjà pour platform_invitations et une surcharge serait
-- indistinguable (même type d'argument).
-- ============================================================================

ALTER TABLE public.owner_invitations
  ADD COLUMN IF NOT EXISTS offer_support_help boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invited_by uuid NULL,
  ADD COLUMN IF NOT EXISTS accepted_by uuid NULL;

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
     AND expires_at > now()
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

REVOKE ALL ON FUNCTION public.accept_support_offer_from_owner_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_support_offer_from_owner_invitation(text) TO authenticated;
