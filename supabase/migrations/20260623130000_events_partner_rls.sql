-- ============================================================================
-- P0-1 — RLS LECTURE des events pour les partenaires d'une co-organisation.
--
-- BUG LIVE : un club partenaire (events.partner_venue_id) ou un organisateur
-- partenaire (events.partner_organizer_id) ne pouvait PAS lire la ligne `events`
-- → la page /owner/collab/event/:id (et l'app orga) recevait `null` → « event not
-- found ». Les policies SELECT existantes ne couvrent que :
--   - public découvrable (is_active + visibility public + discoverable + approved)
--   - organizer_user_id = auth.uid()   (lead organisateur uniquement)
--   - events organisateur is_active=true (donc PAS les propositions club is_active=false)
-- Aucune ne couvre partner_venue_id ni partner_organizer_id.
--
-- FIX : on branche enfin les helpers déjà déployés (20260421103841) sur le SELECT
-- de `events`. Ces helpers (SECURITY DEFINER, pas de récursion RLS) couvrent À LA
-- FOIS le lead ET le partenaire des deux côtés :
--   - is_event_partner_venue_owner : owner de venue_id OU partner_venue_id
--   - is_event_partner_organizer   : organizer_user_id OU partner_organizer_id
--                                    OU membre d'équipe org (rôle editor)
-- Pas de filtre is_active → couvre les propositions club is_active=false.
--
-- ÉCRITURE : on n'ajoute AUCUNE policy UPDATE partenaire. Le partenaire est en
-- lecture seule sur les métadonnées de l'event (matrice des rôles). Les colonnes
-- de partage (revenue_split_*) ne sont écrites QUE par les RPC SECURITY DEFINER
-- (create/sign/cancel_event_collab_contract). Le lead édite l'event via ses
-- policies existantes (owner de venue / organizer_user_id = auth.uid()).
-- ============================================================================

DROP POLICY IF EXISTS "Partners can view co-events" ON public.events;
CREATE POLICY "Partners can view co-events"
ON public.events
FOR SELECT
TO authenticated
USING (
  public.is_event_partner_venue_owner(auth.uid(), id)
  OR public.is_event_partner_organizer(auth.uid(), id)
);
