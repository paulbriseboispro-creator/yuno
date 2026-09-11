-- Qui tient la porte d'une soirée — la liste, pas le test.
--
-- `is_event_door_staff(user, event)` répond « oui/non » pour UNE personne. Le
-- pré-chargement de la liste hors ligne a besoin de l'inverse : à qui faut-il
-- rappeler d'ouvrir Yuno Pro avant les portes, pour que la soirée soit dans
-- son téléphone quand le réseau manquera.
--
-- Même périmètre, au mot près, que `is_event_door_staff` — les deux doivent
-- rester d'accord : staff de club (videur / manager rattaché au lieu lead ou
-- partenaire), staff d'organisateur (videur accepté), et membres d'équipe
-- d'organisateur habilités au scan.

CREATE OR REPLACE FUNCTION public.event_door_staff_ids(p_event_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT s.user_id
    FROM events e
    CROSS JOIN LATERAL (
      -- Staff de club : le rattachement se lit sur profiles.venue_id, comme
      -- partout ailleurs (il n'y a pas de table de jonction staff ↔ club).
      SELECT ur.user_id
        FROM user_roles ur
        JOIN profiles p ON p.id = ur.user_id
       WHERE ur.role IN ('bouncer', 'manager')
         AND p.venue_id IS NOT NULL
         AND p.venue_id IN (e.venue_id, e.partner_venue_id)
      UNION
      SELECT os.user_id
        FROM org_staff os
       WHERE os.user_id IS NOT NULL
         AND os.invitation_status = 'accepted'
         AND os.role = 'bouncer'
         AND os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
      UNION
      SELECT om.member_user_id
        FROM org_members om
       WHERE om.member_user_id IS NOT NULL
         AND om.invitation_status = 'accepted'
         AND om.role IN ('admin', 'editor', 'scanner')
         AND om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
    ) AS s(user_id)
   WHERE e.id = p_event_id
     AND s.user_id IS NOT NULL;
$$;

-- Réservée au serveur : c'est une liste nominative d'employés.
REVOKE ALL ON FUNCTION public.event_door_staff_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_door_staff_ids(uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.event_door_staff_ids(uuid) TO service_role;

COMMENT ON FUNCTION public.event_door_staff_ids(uuid) IS
  'Les comptes qui tiennent la porte d''une soirée (mêmes règles que is_event_door_staff). service_role uniquement.';
