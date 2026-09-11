-- Statut du code PIN du staff d'un organisateur, lisible par l'organisateur.
--
-- Le problème réparé : /organizer-app/team affichait « PIN à configurer » pour
-- TOUT LE MONDE, y compris un videur qui avait posé son PIN des mois plus tôt.
-- La page lisait `profiles.employee_pin` en direct, or aucune policy de
-- `profiles` n'ouvre la ligne d'un tiers à un organisateur (seuls le
-- propriétaire de la ligne, un owner de club, un manager de club et le super
-- admin passent). La lecture rendait donc zéro ligne, sans erreur : un état
-- « aucun PIN » affiché avec aplomb, et le pro bloqué devant un badge rouge
-- qu'aucun bouton ne peut éteindre.
--
-- La réponse ne porte QUE des booléens et des dates. Le hash du PIN ne sort
-- jamais de la base : personne d'autre que son porteur n'a affaire à ce secret.

CREATE OR REPLACE FUNCTION public.get_org_staff_pin_status(p_organizer_user_id uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, has_pin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := COALESCE(p_organizer_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Qui a le droit de savoir : l'organisateur lui-même, un membre de son
  -- équipe qui gère le personnel, le super admin. Fermé par défaut.
  IF NOT (
    v_uid = v_org
    OR COALESCE(org_member_has_permission(v_uid, v_org, 'manage_team'), false)
    OR COALESCE(is_super_admin(), false)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT os.user_id, (p.employee_pin IS NOT NULL) AS has_pin
    FROM org_staff os
    JOIN profiles p ON p.id = os.user_id
   WHERE os.organizer_user_id = v_org
     AND os.user_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_staff_pin_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_staff_pin_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_org_staff_pin_status(uuid) IS
  'Le staff d''un organisateur et l''état de son code PIN (booléen seul, jamais le hash). Porte : organisateur, membre avec manage_team, super admin.';
