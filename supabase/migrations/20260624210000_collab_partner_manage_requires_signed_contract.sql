-- ============================================================================
-- Co-soirée : un organisateur INVITÉ ne peut gérer la billetterie / les tables /
-- le plan de salle du club QU'APRÈS avoir signé le contrat de co-soirée.
--
-- TROU corrigé : can_manage_event_tables() autorisait `e.partner_organizer_id =
-- _user_id` SANS vérifier la signature. Or ce helper garde TOUTES les écritures
-- de config d'event côté partenaire :
--   - RLS FOR ALL : ticket_rounds, table_zones, table_packs, venue_floor_plans
--   - RPC SECURITY DEFINER : enable_collab_basic_tables(), set_event_sale_password()
-- => un organisateur à qui un club PROPOSE une co-soirée pouvait remodeler la
-- billetterie et les tables du club AVANT même d'accepter le deal (le verrou
-- n'existait que côté UI). Le CONTRACT GUARD existant ne bloque que les VENTES,
-- pas l'édition de la configuration.
--
-- FIX : la branche partenaire-invité exige désormais un contrat co-soirée signé
-- (event_collab_contracts.status IN ('active','locked','closed')). Avant signature
-- → aucun accès en écriture (l'app montre un aperçu lecture seule).
--
-- INCHANGÉ : le club (v.owner_id), l'organisateur LEAD (organizer_user_id), le
-- propriétaire des tables (tables_owner_user_id, défini uniquement via le RPC
-- d'activation lui-même gardé) et le super admin gardent l'accès complet. Les
-- lectures publiques/clients/bouncer de ticket_rounds passent par d'autres
-- policies → le flux d'achat n'est pas impacté.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_manage_event_tables(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id            -- organisateur lead (sa soirée)
        OR e.tables_owner_user_id = _user_id       -- propriétaire des tables (activation gardée)
        OR v.owner_id = _user_id                   -- club (owner du lieu lead OU partenaire)
        OR public.is_super_admin()
        -- Organisateur INVITÉ (partenaire) : débloqué seulement une fois le
        -- contrat de co-soirée signé. Avant signature → aperçu lecture seule.
        OR (
          e.partner_organizer_id = _user_id
          AND EXISTS (
            SELECT 1 FROM public.event_collab_contracts c
            WHERE c.event_id = e.id
              AND c.status IN ('active', 'locked', 'closed')
          )
        )
      )
  )
$$;
