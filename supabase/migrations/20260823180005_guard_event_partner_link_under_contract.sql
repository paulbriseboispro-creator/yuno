-- ============================================================================
-- P0 COLLAB — Verrou : le lien club↔organisateur d'une soirée ne bouge plus
-- tant qu'un contrat de collaboration non annulé existe.
--
-- Trou : aucun trigger n'empêche de repasser events.partner_venue_id à NULL
-- (ou vers un autre club) après signature du contrat. La répartition retombe
-- alors en solo — 100 % organisateur — malgré un contrat signé. Le miroir vaut
-- côté club (partner_organizer_id), et changer venue_id / organizer_user_id
-- sous contrat casserait le split de la même façon : les quatre colonnes de
-- lien sont couvertes.
--
-- Mécanique : même style que les gardes promoteur (guard_promoter_payout_write)
-- et protect_order_immutable_fields —
--   • le TRIGGER est SECURITY INVOKER et discrimine sur current_user : un
--     trigger de garde SECURITY DEFINER s'exécuterait sous son propriétaire,
--     current_user vaudrait « postgres » y compris pour un PATCH client, et le
--     verrou se désactiverait lui-même. Les RPC légitimes du cycle collab
--     (create/sign/cancel_event_collab_contract, adoption des occurrences)
--     sont SECURITY DEFINER et les edge functions tournent en service_role :
--     toutes passent.
--   • la LECTURE du contrat passe par un helper SECURITY DEFINER : la table
--     event_collab_contracts est sous RLS « parties seulement », et un EXISTS
--     évalué sous le rôle appelant raterait un contrat invisible → le verrou
--     doit voir le contrat quel que soit l'appelant.
--
-- Statuts (CHECK de event_collab_contracts, 20260622220000) : 'draft',
-- 'pending_signatures', 'active', 'locked', 'closed', 'cancelled'. Seul
-- 'cancelled' libère le lien. Un contrat 1:1 par event (UNIQUE event_id).
--
-- Flux front vérifiés compatibles :
--   • OrgProposeEventDialog.tsx:141 pose partner_venue_id AVANT de créer le
--     contrat (aucun contrat → passe) ; son rollback :163 remet NULL quand la
--     création du contrat a ÉCHOUÉ (fonction atomique → aucun contrat → passe).
--   • ClubProposeEventDialog.tsx:165, même schéma côté partner_organizer_id.
--   • Le retrait légitime d'un partenaire passe par
--     cancel_event_collab_contract (status='cancelled') puis détachement →
--     passe. Les sauvegardes de formulaire event qui renvoient la même valeur
--     ne déclenchent rien (IS DISTINCT FROM).
-- ============================================================================

-- Lecture du contrat hors RLS (DEFINER), séparée du trigger (INVOKER).
CREATE OR REPLACE FUNCTION public.event_has_blocking_collab_contract(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.event_collab_contracts c
     WHERE c.event_id = p_event_id
       AND c.status <> 'cancelled'
  );
$$;

REVOKE ALL ON FUNCTION public.event_has_blocking_collab_contract(uuid) FROM PUBLIC, anon, authenticated;

-- Garde SECURITY INVOKER (pas de clause SECURITY = INVOKER par défaut).
CREATE OR REPLACE FUNCTION public.guard_event_partner_link_under_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Rôles serveur (service_role, RPC SECURITY DEFINER exécutées sous leur
  -- propriétaire) : la main reste libre.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF (NEW.partner_venue_id     IS DISTINCT FROM OLD.partner_venue_id
      OR NEW.venue_id          IS DISTINCT FROM OLD.venue_id
      OR NEW.organizer_user_id IS DISTINCT FROM OLD.organizer_user_id
      OR NEW.partner_organizer_id IS DISTINCT FROM OLD.partner_organizer_id)
     AND public.event_has_blocking_collab_contract(NEW.id) THEN
    RAISE EXCEPTION 'partner_locked_by_contract'
      USING HINT = 'Un contrat de collaboration actif existe pour cette soirée. Annulez-le (cancel_event_collab_contract) avant de changer le club ou l''organisateur partenaire.',
            ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_event_partner_link_under_contract ON public.events;
CREATE TRIGGER trg_guard_event_partner_link_under_contract
  BEFORE UPDATE OF venue_id, partner_venue_id, organizer_user_id, partner_organizer_id
  ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_event_partner_link_under_contract();
