-- ============================================================================
-- Collab : plus AUCUNE action unilatérale de pause/suppression.
--
-- INCOHÉRENCE corrigée : deux mécanismes coexistaient.
--   1. manage_event_collaboration('pause'|'remove') — UNILATÉRAL : n'exigeait
--      que d'être l'une des deux parties (bloqué seulement par des ventes).
--   2. request/respond_event_collab_action (20260624162000) — DOUBLE ACCORD,
--      introduit précisément parce qu'une partie seule ne doit pas pouvoir
--      geler ou dissoudre la collaboration de l'autre.
-- Le RPC unilatéral restait GRANTé à authenticated : n'importe quelle partie
-- pouvait contourner le double accord en appelant l'API directement (le front
-- n'appelle plus que 'resume').
--
-- FIX : 'pause' et 'remove' exigent désormais super admin (les parties passent
-- par le flux de double consentement) ; 'resume' reste accessible aux parties —
-- il ne fait que réactiver une collaboration que les deux ont déjà signée.
-- ============================================================================

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
  IF NOT v_is_party AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- RESUME ne touche pas aux ventes : réactivation simple.
  IF p_action = 'resume' THEN
    UPDATE public.events
       SET collab_paused_at = NULL, is_active = true
     WHERE id = p_event_id;
    RETURN;
  END IF;

  -- PAUSE et REMOVE unilatéraux : réservés au super admin. Les parties passent
  -- par le double consentement (request_event_collab_action / respond_...).
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'COLLAB_REQUIRES_CONSENT: cette action nécessite l''accord des deux parties — utilise la demande de pause/suppression du dashboard collab';
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

-- ── Harmonisation mineure : les deux tables d'invitation d'onboarding avaient
-- des CHECK divergents (venue_claim_invitations accepte 'cancelled',
-- organizer_claim_invitations non). Un club qui veut retirer une invitation
-- envoyée doit pouvoir la passer 'cancelled' des deux côtés du miroir.
ALTER TABLE public.organizer_claim_invitations
  DROP CONSTRAINT IF EXISTS organizer_claim_invitations_status_check;
ALTER TABLE public.organizer_claim_invitations
  ADD CONSTRAINT organizer_claim_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled'));
