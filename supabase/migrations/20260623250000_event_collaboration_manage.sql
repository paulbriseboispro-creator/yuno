-- =============================================================================
-- Gérer une collaboration AU NIVEAU D'UNE SOIRÉE : mettre en pause / reprendre /
-- supprimer. Demande de Paul : permettre de poser (pause) une collaboration
-- — impossible quand la soirée est live avec des achats — ou carrément la
-- supprimer.
--
-- - PAUSE   : gèle la collab (la soirée passe hors-ligne, is_active=false),
--             réversible. Bloqué s'il y a déjà des ventes.
-- - RESUME  : réactive (collab_paused_at=NULL, is_active=true).
-- - REMOVE  : détache le partenaire → la soirée redevient solo, annule le
--             contrat et purge la proposition de split. Bloqué s'il y a déjà
--             des ventes.
--
-- Garde-fou « ventes » = au moins un billet payé OU une table payée/confirmée
-- OU split_locked_at posé (premier encaissement). On NE casse jamais une soirée
-- que des clients ont déjà payée.
-- =============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS collab_paused_at timestamptz;

CREATE OR REPLACE FUNCTION public.manage_event_collaboration(
  p_event_id uuid,
  p_action   text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e          public.events%ROWTYPE;
  v_is_party boolean;
  v_has_sales boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_action NOT IN ('pause','resume','remove') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  -- Doit être une collaboration club <-> organisateur (un partenaire attaché).
  IF NOT ((e.venue_id IS NOT NULL AND e.partner_organizer_id IS NOT NULL)
       OR (e.organizer_user_id IS NOT NULL AND e.partner_venue_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Cette soirée n''est pas une collaboration';
  END IF;

  -- Le demandeur doit être l'une des deux parties (club lead/partenaire OU orga).
  v_is_party :=
       (e.venue_id IS NOT NULL        AND public.is_venue_owner(auth.uid(), e.venue_id))
    OR (e.partner_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), e.partner_venue_id))
    OR (e.organizer_user_id = auth.uid())
    OR (e.partner_organizer_id = auth.uid());
  IF NOT v_is_party THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- RESUME ne touche pas aux ventes : réactivation simple.
  IF p_action = 'resume' THEN
    UPDATE public.events
       SET collab_paused_at = NULL, is_active = true
     WHERE id = p_event_id;
    RETURN;
  END IF;

  -- PAUSE et REMOVE sont verrouillés dès qu'il y a un vrai achat.
  v_has_sales :=
       EXISTS (SELECT 1 FROM public.tickets t
                WHERE t.event_id = p_event_id AND t.status = 'paid')
    OR EXISTS (SELECT 1 FROM public.table_reservations tr
                WHERE tr.event_id = p_event_id AND tr.status IN ('paid','confirmed'))
    OR e.split_locked_at IS NOT NULL;
  IF v_has_sales THEN
    RAISE EXCEPTION 'COLLAB_LOCKED_BY_SALES: des billets ou tables ont déjà été vendus pour cette soirée';
  END IF;

  IF p_action = 'pause' THEN
    UPDATE public.events
       SET collab_paused_at = now(), is_active = false
     WHERE id = p_event_id;
    RETURN;
  END IF;

  -- REMOVE : annuler le contrat, détacher le partenaire, purger le split →
  -- la soirée redevient une soirée solo du lead.
  UPDATE public.event_collab_contracts
     SET status = 'cancelled'
   WHERE event_id = p_event_id AND status <> 'cancelled';

  UPDATE public.events SET
       partner_organizer_id        = NULL,
       partner_venue_id            = NULL,
       event_mode                  = NULL,
       collab_paused_at            = NULL,
       revenue_split_proposal      = NULL,
       revenue_split_rules         = NULL,
       split_proposed_by           = NULL,
       split_proposed_at           = NULL,
       split_approved_by_venue     = false,
       split_approved_by_organizer = false
   WHERE id = p_event_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.manage_event_collaboration(uuid, text) TO authenticated;
