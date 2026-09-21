-- =============================================================================
-- Équipe d'un organisateur : la porte d'entrée du membre
-- =============================================================================
-- Un membre accepté (admin / editor / scanner) avait déjà ses droits EN BASE
-- (`is_org_team_member`, `org_member_has_permission` : événements, guest list,
-- tables, analytique, clients, manifeste de scan). Ce qui manquait, c'est la
-- question que le front doit poser au premier écran : « pour QUEL organisateur
-- est-ce que je travaille ? ».
--
-- Elle ne se répond pas par un SELECT direct sur `org_members` : la policy
-- « Members view their membership » rend bien la ligne du membre, mais le NOM
-- de l'organisation vit dans `profiles` de l'organisateur, qu'aucune policy
-- n'ouvre à son équipe. Le front affichait donc une organisation sans nom, ou
-- rien du tout. D'où cette fonction SECURITY DEFINER, qui rend l'identité
-- MINIMALE de l'organisation (nom, logo) et rien d'autre : pas d'email, pas de
-- SIRET, pas d'IBAN, pas de compte Stripe.
--
-- Elle ne rend QUE les lignes de l'appelant (`member_user_id = auth.uid()`) :
-- ce n'est pas un annuaire des équipes, c'est la réponse à « de quoi suis-je
-- membre ».
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_org_memberships()
RETURNS TABLE (
  organizer_user_id uuid,
  organization_name text,
  organization_logo_url text,
  role text,
  can_view_finance boolean,
  can_refund boolean,
  can_export boolean,
  can_manage_team boolean,
  accepted_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.organizer_user_id,
    p.organization_name,
    p.organization_logo_url,
    m.role,
    -- Un admin porte TOUS les droits fins, exactement comme
    -- `org_member_has_permission` le décide côté serveur. Les rendre ici tels
    -- qu'ils sont stockés ferait dire au front « pas le droit de rembourser »
    -- à un admin que la base laisse pourtant rembourser.
    (m.role = 'admin' OR m.can_view_finance) AS can_view_finance,
    (m.role = 'admin' OR m.can_refund)       AS can_refund,
    (m.role = 'admin' OR m.can_export)       AS can_export,
    (m.role = 'admin' OR m.can_manage_team)  AS can_manage_team,
    m.accepted_at
  FROM public.org_members m
  JOIN public.profiles p ON p.id = m.organizer_user_id
  WHERE m.member_user_id = auth.uid()
    AND m.invitation_status = 'accepted'
  ORDER BY m.accepted_at NULLS LAST, m.created_at;
$$;

REVOKE ALL ON FUNCTION public.get_my_org_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_memberships() TO authenticated;

COMMENT ON FUNCTION public.get_my_org_memberships() IS
  'Organisations dont l''appelant est membre accepté. Identité minimale (nom, logo) + rôle et droits fins déjà résolus. Ne rend jamais la ligne d''un tiers.';

-- =============================================================================
-- Accepter une invitation : la porte serveur
-- =============================================================================
-- L'acceptation se faisait par l'edge function `accept-org-member` avec la clé
-- service_role, sans aucune trace de la règle en base. On la pose ici pour que
-- la règle vive AU MÊME ENDROIT que les droits qu'elle ouvre : un token, un
-- email qui correspond, une invitation encore en attente et non expirée.
--
-- L'edge function reste nécessaire pour le cas « pas encore de compte Yuno »
-- (création de compte, envoi du lien de connexion), mais l'acceptation d'une
-- personne DÉJÀ connectée passe désormais par cette fonction.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_org_member_invitation(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.org_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'sign_in_required');
  END IF;

  -- Une session d'accès assisté ne prend pas un rôle d'équipe au nom du pro :
  -- l'invitation est nominative, c'est la personne invitée qui l'accepte.
  IF public.is_support_session() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'support_session');
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT * INTO v_inv FROM public.org_members WHERE invitation_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF v_inv.invitation_status = 'accepted' AND v_inv.member_user_id = v_uid THEN
    -- Déjà à jour : on rend le succès, pas une erreur. Le lien d'un email se
    -- rouvre (deuxième appareil, retour en arrière) et ne doit pas afficher
    -- « invitation déjà utilisée » à la personne qui en est titulaire.
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'organizer_user_id', v_inv.organizer_user_id, 'role', v_inv.role
    );
  END IF;

  IF v_inv.invitation_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_pending');
  END IF;

  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  IF lower(v_inv.member_email) IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'email_mismatch',
      'invited_email', v_inv.member_email, 'signed_in_email', v_email
    );
  END IF;

  UPDATE public.org_members
     SET member_user_id     = v_uid,
         invitation_status  = 'accepted',
         accepted_at        = now()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'organizer_user_id', v_inv.organizer_user_id, 'role', v_inv.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_org_member_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_org_member_invitation(uuid) TO authenticated;

COMMENT ON FUNCTION public.accept_org_member_invitation(uuid) IS
  'Accepte une invitation d''équipe organisateur pour l''appelant. Refuse un email qui ne correspond pas, une invitation expirée ou déjà close, et une session d''accès assisté.';
