-- =============================================================================
-- Co-soirée CLUB-LED : l'organisateur partenaire PEUT co-gérer la billetterie.
--
-- Bug (Paul) : sur une co-soirée créée par le club (events.venue_id = club,
-- organizer_user_id NULL, partner_organizer_id = orga), « Gérer la billetterie »
-- renvoyait l'orga sur l'onglet billetterie mais la soirée n'y apparaissait pas
-- (OwnerTicketing scope orga filtrait `organizer_user_id = moi` seulement).
--
-- Les `ticket_rounds` sont DÉJÀ gérables par l'orga partenaire (policy
-- « Ticket rounds manageable by event managers » via can_manage_event_tables, qui
-- couvre partner_organizer_id). Il manquait l'UPDATE de `events` (activer la
-- billetterie, mode de vente, présale…) qui était volontairement réservé au lead
-- (migration 20260623130000 « AUCUNE policy UPDATE partenaire »).
--
-- Décision (Paul) : co-gestion ASSUMÉE sur les vraies co-soirées partagées. On
-- ouvre l'UPDATE de `events` au partenaire SUR co_event/venue_rental (jamais
-- org_hosted = le club gère seul), et un trigger garde-fou empêche le partenaire
-- (non-lead) de toucher aux colonnes sensibles (partage, structure, BDE).
-- =============================================================================

-- 1. Policy UPDATE partenaire (hors org_hosted) -------------------------------
DROP POLICY IF EXISTS "Partner organizer can manage co-event" ON public.events;
CREATE POLICY "Partner organizer can manage co-event"
ON public.events
FOR UPDATE
TO authenticated
USING (
  event_mode IS DISTINCT FROM 'org_hosted'
  AND public.is_event_partner_organizer(auth.uid(), id)
)
WITH CHECK (
  event_mode IS DISTINCT FROM 'org_hosted'
  AND public.is_event_partner_organizer(auth.uid(), id)
);

-- 2. Garde-fou colonnes sensibles ---------------------------------------------
-- Le lead (organizer_user_id, owner du venue, super admin) et le service_role
-- passent sans restriction. Un partenaire ne peut PAS modifier le partage / la
-- structure / le flag BDE — seulement les colonnes de gestion (billetterie…).
CREATE OR REPLACE FUNCTION public.protect_event_columns_from_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_lead boolean;
BEGIN
  -- CRITIQUE : ne garder QUE les UPDATE clients directs (PostgREST = rôle
  -- `authenticated`). Les RPC SECURITY DEFINER (signature de contrat qui écrit
  -- revenue_split_*, crons, service_role…) tournent sous le rôle propriétaire et
  -- sont de confiance — sinon ce garde-fou casserait la signature de contrat par
  -- le partenaire (sign_event_collab_contract met à jour events.revenue_split_rules).
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (
    OLD.organizer_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = OLD.venue_id AND v.owner_id = auth.uid())
    OR public.is_super_admin()
  ) INTO v_is_lead;

  IF v_is_lead THEN
    RETURN NEW;
  END IF;

  -- Partenaire (non-lead) : interdit de toucher au partage / structure / BDE.
  IF NEW.revenue_split_rules    IS DISTINCT FROM OLD.revenue_split_rules
   OR NEW.revenue_split_proposal IS DISTINCT FROM OLD.revenue_split_proposal
   OR NEW.is_bde                 IS DISTINCT FROM OLD.is_bde
   OR NEW.venue_id               IS DISTINCT FROM OLD.venue_id
   OR NEW.partner_venue_id       IS DISTINCT FROM OLD.partner_venue_id
   OR NEW.organizer_user_id      IS DISTINCT FROM OLD.organizer_user_id
   OR NEW.partner_organizer_id   IS DISTINCT FROM OLD.partner_organizer_id
   OR NEW.event_mode             IS DISTINCT FROM OLD.event_mode
  THEN
    RAISE EXCEPTION 'Un partenaire ne peut pas modifier les colonnes protégées (partage, structure) de la co-soirée.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_event_columns_from_partner ON public.events;
CREATE TRIGGER trg_protect_event_columns_from_partner
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.protect_event_columns_from_partner();
