-- Yuno Pro : qui a le droit d'entrer, décidé par la base (2026-10-28).
--
-- La porte de l'app Pro (`ProAccessGate`) ne regardait que `user_roles`
-- (un rôle autre que `client`). Or plusieurs accès pro légitimes ne vivent
-- PAS dans cette table :
--   * le fondateur d'une organisation (`profiles.profile_type = 'organizer'`,
--     `organizer_profiles.user_id`) : Amoris était refusé le soir de sa soirée ;
--   * l'équipe d'une organisation (`org_members`, admin / éditeur / scanner) ;
--   * le staff opérationnel d'une organisation (`org_staff`) ;
--   * le staff de porte d'UNE soirée (`event_door_staff`) ;
--   * le propriétaire d'un club (`venues.owner_id`).
-- Une seule fonction dit oui ou non, et la liste des raisons sert au
-- diagnostic. Une invitation en attente pour l'adresse du compte compte aussi :
-- l'écran l'accepte juste après (`claim_my_event_door_invites`).

CREATE OR REPLACE FUNCTION public.get_my_pro_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text;
  v_reasons text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('pro', false, 'reasons', '[]'::jsonb);
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v_uid AND r.role <> 'client') THEN
    v_reasons := v_reasons || 'role'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.profile_type = 'organizer')
     OR EXISTS (SELECT 1 FROM public.organizer_profiles o WHERE o.user_id = v_uid) THEN
    v_reasons := v_reasons || 'organizer'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members m
              WHERE m.member_user_id = v_uid AND m.invitation_status = 'accepted') THEN
    v_reasons := v_reasons || 'org_team'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_staff s
              WHERE s.user_id = v_uid AND s.invitation_status = 'accepted') THEN
    v_reasons := v_reasons || 'org_staff'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_door_staff d
              WHERE d.revoked_at IS NULL
                AND (   (d.user_id = v_uid AND d.status = 'accepted')
                     OR (v_email IS NOT NULL AND d.status = 'pending' AND lower(d.email) = v_email))) THEN
    v_reasons := v_reasons || 'event_door'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.venues v WHERE v.owner_id = v_uid) THEN
    v_reasons := v_reasons || 'venue_owner'::text;
  END IF;

  RETURN jsonb_build_object('pro', cardinality(v_reasons) > 0, 'reasons', to_jsonb(v_reasons));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_pro_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pro_access() TO authenticated, service_role;
