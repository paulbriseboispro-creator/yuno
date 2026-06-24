-- =============================================================================
-- Co-soirée : l'organisateur peut COPIER une template de billetterie du club.
--
-- Demande (Paul) : pour la billetterie d'une co-soirée, soit l'orga crée la
-- sienne librement, soit elle copie une des templates (presets) du club.
--
-- Les ticket_presets sont à double portée (venue OU organizer). En RLS normale,
-- un organisateur ne voit QUE ses propres presets (organizer_user_id = lui) — il
-- ne peut pas lire les presets de niveau venue du club partenaire. Ce RPC
-- SECURITY DEFINER expose, pour une co-soirée donnée, les presets du club
-- partenaire — uniquement si l'appelant est bien une partie de cette soirée
-- (l'organisateur, ou le propriétaire du club).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_partner_venue_ticket_presets(p_event_id uuid)
RETURNS SETOF public.ticket_presets
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_club  text;
  v_org   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT venue_id, organizer_user_id INTO v_club, v_org
    FROM public.collab_event_parties(p_event_id);

  IF v_club IS NULL THEN
    RETURN;
  END IF;

  -- L'appelant doit être une partie de la co-soirée.
  IF v_uid IS DISTINCT FROM v_org
     AND NOT EXISTS (SELECT 1 FROM public.venues WHERE id = v_club AND owner_id = v_uid)
     AND NOT public.is_super_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT *
      FROM public.ticket_presets
     WHERE venue_id = v_club
       AND organizer_user_id IS NULL
     ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_partner_venue_ticket_presets(uuid) TO authenticated;
