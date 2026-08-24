-- Invitation organisateur : proposer l'assistance Yuno dès le départ.
--
-- Un pro invité par nous est, presque par définition, quelqu'un qu'on
-- accompagne. Attendre qu'il découvre seul le bouton « Demander à Yuno de tout
-- configurer » dans ses réglages, c'est le laisser buter sur la billetterie un
-- soir de mise en vente. La proposition doit arriver au moment où il ouvre son
-- compte.
--
-- On ne pré-accorde RIEN : la case cochée par l'admin ne fait que PROPOSER.
-- Le pro voit l'offre et ses garanties au moment où il accepte son invitation,
-- et c'est son clic à lui qui ouvre la porte. Un consentement donné par
-- procuration n'aurait aucune valeur — ni juridique, ni pour la confiance.

ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS offer_support_help boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.platform_invitations.offer_support_help IS
  'L''admin propose l''assistance Yuno à ce pro. PROPOSITION seulement : '
  'l''accès n''existe que si le pro l''accorde lui-même à l''acceptation.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Accorder l'accès depuis la page d'acceptation d'invitation.
--
-- `request_support_help()` existe déjà pour un pro installé, mais elle refuse
-- une session support et cherche un admin au hasard. Ici on connaît l'invitant :
-- c'est lui qui pourra ouvrir la session, et le lien avec l'invitation est
-- conservé dans le motif — pour que le journal du pro raconte quelque chose de
-- vrai (« accepté à l'ouverture du compte ») et pas un motif générique.
-- ─────────────────────────────────────────────────────────────────────────────
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
     AND expires_at > now()
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
