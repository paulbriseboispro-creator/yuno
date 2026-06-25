-- =============================================================================
-- Mode « hébergé par le club » (org_hosted) : l'organisateur partenaire est en
-- LECTURE SEULE sur les opérations (billetterie + tables). Le club gère seul ;
-- l'orga ne fait que le marketing.
--
-- Trou constaté (Paul) : `can_manage_event_tables` — le helper qui gate l'édition
-- des `ticket_rounds` ET des table_zones/table_packs/venue_floor_plans event-scopés
-- — autorisait `partner_organizer_id` SANS regarder le mode. Donc en org_hosted,
-- l'orga partenaire pouvait encore écrire (via API / ajout rapide de template).
--
-- Fix : on exclut org_hosted de la branche partner_organizer. Le CLUB (owner du
-- venue) garde la main ; co_event / venue_rental ne changent pas (l'orga partenaire
-- y co-gère toujours). La policy UPDATE de `events` exclut déjà org_hosted, et le
-- front exclut déjà org_hosted de l'onglet billetterie de l'orga.
-- =============================================================================
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
        e.organizer_user_id = _user_id
        -- En org_hosted, le partenaire ne gère PAS les opérations (lecture seule).
        OR (e.partner_organizer_id = _user_id AND e.event_mode IS DISTINCT FROM 'org_hosted')
        OR e.tables_owner_user_id = _user_id
        OR v.owner_id = _user_id
        OR public.is_super_admin()
      )
  )
$$;
