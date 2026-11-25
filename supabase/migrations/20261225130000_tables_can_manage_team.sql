-- Tables VIP, vague A — P3.4 : l'équipe d'Amoris peut configurer les tables.
--
-- can_manage_event_tables ne connaissait que l'organisateur lui-même, le propriétaire de tables, le partenaire, le
-- propriétaire du club et les co-hôtes : un administrateur ou un éditeur d'équipe de l'organisation voyait la page Tables
-- VIP (barre latérale, OrgAppRoute) mais chaque écriture était refusée par la RLS SANS erreur (0 ligne) ou levait « Not
-- allowed to manage tables for this event » (enable_collab_tables, set_event_tables_mode, apply_vip_room_to_event).
--
-- Ajouts (même passerelle que les salles VIP, can_manage_organizer_rooms, et que is_event_cohost) :
--   • membre d'équipe admin OU éditeur (is_org_team_member(…, 'editor'), invitation acceptée) de l'organisateur de la
--     soirée, de son propriétaire de tables, ou de l'organisateur partenaire quand le domaine « operations » lui revient ;
--   • manager d'un club hôte / partenaire qui a la permission « tables », sous la même condition de domaine que le
--     propriétaire du club.
-- Jamais un scanneur, jamais une invitation en attente.
-- Fonctions et policies qui en dépendent (et gagnent donc ces droits) : upsert_event_floor_plan (RLS), set_event_tables_mode,
-- apply_vip_room_to_event, enable_collab_tables, enable_collab_basic_tables, policies table_packs / table_zones /
-- venue_floor_plans, ticket_rounds, event_scarcity_settings, can_manage_ticket_groups, _mcp_ticketing, set_event_sale_password.

CREATE OR REPLACE FUNCTION public.can_manage_event_tables(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    CROSS JOIN LATERAL (
      SELECT public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations') AS ops
    ) h
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        OR (e.partner_organizer_id = _user_id AND h.ops IN ('organizer','both'))
        OR e.tables_owner_user_id = _user_id
        OR (v.owner_id = _user_id AND h.ops IN ('venue','both'))
        -- Équipe de l'organisation (admin ou éditeur) : le principal, le propriétaire de tables, le partenaire.
        OR (_user_id IS NOT NULL AND (
              public.is_org_team_member(_user_id, e.organizer_user_id, 'editor')
              OR public.is_org_team_member(_user_id, e.tables_owner_user_id, 'editor')
              OR (h.ops IN ('organizer','both')
                  AND public.is_org_team_member(_user_id, e.partner_organizer_id, 'editor'))
        ))
        -- Manager d'un club avec la permission « tables ».
        OR (_user_id IS NOT NULL AND v.id IS NOT NULL AND h.ops IN ('venue','both')
            AND public.manager_has_permission(_user_id, v.id, 'tables'))
        OR public.is_super_admin()
      )
  ) OR public.is_event_cohost(_event_id, _user_id, 'editor')
$function$;
