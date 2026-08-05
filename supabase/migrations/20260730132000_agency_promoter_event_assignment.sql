-- =====================================================================
-- Réglage PAR SOIRÉE d'un promoteur d'agence — parité OwnerPromoterEventView.
--
-- L'agence n'a pas de policy d'écriture sur promoter_event_assignments (scope
-- venue only). Comme assign_agency_promoter_to_event, on passe par un RPC
-- SECURITY DEFINER gardé is_agency_owner. Upsert (jamais de delete) des réglages
-- de performance : objectif, plafond billets, accès guest list / tables.
-- Le moteur argent lit déjà max_tickets et les accès sur promoter_event_assignments,
-- sans changement.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_agency_promoter_event_assignment(
  p_promoter_id uuid,
  p_event_id uuid,
  p_goal_target integer DEFAULT NULL,
  p_max_tickets integer DEFAULT NULL,
  p_can_access_guestlist boolean DEFAULT NULL,
  p_can_access_tables boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
  SELECT agency_id INTO v_agency_id FROM public.promoters WHERE id = p_promoter_id;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Promoteur d''agence introuvable';
  END IF;
  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.promoter_event_assignments
    (promoter_id, event_id, status, goal_target, max_tickets, can_access_guestlist, can_access_tables)
  VALUES
    (p_promoter_id, p_event_id, 'active', p_goal_target, p_max_tickets,
     COALESCE(p_can_access_guestlist, false), COALESCE(p_can_access_tables, true))
  ON CONFLICT (promoter_id, event_id) DO UPDATE SET
    goal_target          = COALESCE(p_goal_target, promoter_event_assignments.goal_target),
    max_tickets          = COALESCE(p_max_tickets, promoter_event_assignments.max_tickets),
    can_access_guestlist = COALESCE(p_can_access_guestlist, promoter_event_assignments.can_access_guestlist),
    can_access_tables    = COALESCE(p_can_access_tables, promoter_event_assignments.can_access_tables),
    status = 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_agency_promoter_event_assignment(uuid, uuid, integer, integer, boolean, boolean) TO authenticated;
