-- ============================================================================
-- RÉGRESSION corrigée : can_manage_event_tables() avait PERDU l'exigence de
-- contrat signé pour l'organisateur invité.
--
-- Historique :
--   - 20260624210000 : ajoute « l'orga INVITÉ (partner_organizer_id) ne gère
--     la billetterie / les tables / le plan du club QU'APRÈS contrat signé »
--     (event_collab_contracts.status IN ('active','locked','closed')).
--   - 20260625140000 : réécrit la fonction pour exclure org_hosted… mais en
--     repartant d'une version ANTÉRIEURE au fix du 24 — l'exigence de contrat
--     signé a été silencieusement écrasée. Confirmé sur la définition live le
--     2026-07-14 : plus aucune référence à event_collab_contracts.
--
-- Conséquence du trou : un organisateur à qui un club PROPOSE une co-soirée
-- pouvait remodeler ticket_rounds / table_zones / table_packs /
-- venue_floor_plans du club AVANT d'avoir signé quoi que ce soit.
--
-- FIX : cette version COMBINE les deux garde-fous —
--   1. org_hosted : le partenaire est en lecture seule (fix du 25/06) ;
--   2. hors org_hosted : le partenaire invité n'écrit qu'avec contrat signé
--      (fix du 24/06).
-- INCHANGÉ : club (v.owner_id), organisateur lead, tables_owner_user_id et
-- super admin gardent l'accès complet.
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
        -- Organisateur INVITÉ (partenaire) : jamais en org_hosted (lecture
        -- seule), et sinon seulement une fois le contrat de co-soirée signé.
        OR (
          e.partner_organizer_id = _user_id
          AND e.event_mode IS DISTINCT FROM 'org_hosted'
          AND EXISTS (
            SELECT 1 FROM public.event_collab_contracts c
            WHERE c.event_id = e.id
              AND c.status IN ('active', 'locked', 'closed')
          )
        )
      )
  )
$$;
