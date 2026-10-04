-- ============================================================================
-- Contrats collab : un visiteur sans compte n'annule plus un contrat.
--
-- `IF NOT (c.created_by = auth.uid() OR collab_org_can_act(…) OR
-- is_venue_owner(auth.uid(), …))` : sans session, le premier terme vaut NULL,
-- les deux autres faux, et le IF ne levait pas. Prouvé le 04/10 en
-- transaction annulée : cancel_event_collab_contract annulait un contrat en
-- attente de signatures, terminate_event_collab_series_contract clôturait un
-- contrat-cadre actif (tous deux sur la démo).
-- Le terme est entouré d'un COALESCE(…, false) ; ces fonctions ne sont plus
-- exécutables par anon. Corps repris de la base liée (pg_get_functiondef, 04/10).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_event_collab_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.event_collab_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (COALESCE(c.created_by = auth.uid(), false) OR public.collab_org_can_act(c.organizer_user_id)
          OR public.is_venue_owner(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures') THEN
    RAISE EXCEPTION 'Impossible d''annuler après activation (une vente a pu avoir lieu)';
  END IF;
  UPDATE public.event_collab_contracts SET status = 'cancelled' WHERE id = p_contract_id;
  -- Libère le GUARD (purge la proposition en attente).
  UPDATE public.events
     SET revenue_split_proposal = NULL, split_proposed_by = NULL, split_proposed_at = NULL,
         split_approved_by_venue = false, split_approved_by_organizer = false
   WHERE id = c.event_id AND revenue_split_rules IS NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.terminate_event_collab_series_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.event_collab_series_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (COALESCE(c.created_by = auth.uid(), false) OR public.collab_org_can_act(c.organizer_user_id)
          OR public.is_venue_owner(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures','active') THEN
    RAISE EXCEPTION 'Le contrat-cadre est déjà clos (statut=%)', c.status;
  END IF;
  UPDATE public.event_collab_series_contracts
     SET status = CASE WHEN c.status = 'active' THEN 'terminated' ELSE 'cancelled' END,
         terminated_at = now(), terminated_by = auth.uid()
   WHERE id = p_contract_id;
END; $function$;


REVOKE ALL ON FUNCTION public.cancel_event_collab_contract(p_contract_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_event_collab_contract(p_contract_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.terminate_event_collab_series_contract(p_contract_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminate_event_collab_series_contract(p_contract_id uuid) TO authenticated, service_role;
