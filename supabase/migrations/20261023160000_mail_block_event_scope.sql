-- Suite de l'audit Yuno CRM du 18/10 — MAIL-14 (P3) : une soirée citée dans
-- un bloc d'e-mail appartient à l'espace qui envoie.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- AVANT : send-campaign lisait les données « live » des blocs (titre, affiche,
-- tarifs, tables restantes, line-up) avec la clé de service, pour TOUT
-- `eventId` posé dans un bloc : un brouillon (écrit à la main ou par une IA
-- branchée par le MCP) pouvait tirer une soirée privée d'un autre compte dans
-- un e-mail, test compris.
--
-- MAINTENANT : `email_scope_event_ids` rend, parmi des soirées demandées,
-- celles dont l'espace est une PARTIE (même règle qu'`event_parties` : lieu,
-- club partenaire, organisateur, organisateur partenaire, co-hôte accepté).
-- La portée Yuno (plateforme) garde toutes les soirées. send-campaign retire
-- avant le rendu les blocs « live » d'une soirée hors de l'espace : le bloc ne
-- part pas (jamais ses lignes d'exemple).

CREATE OR REPLACE FUNCTION public.email_scope_event_ids(p_venue_id text, p_organizer_user_id uuid, p_event_ids uuid[])
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), '{}')
    FROM public.events e
   WHERE e.id = ANY (COALESCE(p_event_ids, '{}'))
     AND (
       (p_venue_id IS NULL AND p_organizer_user_id IS NULL)
       OR (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
       OR (p_organizer_user_id IS NOT NULL
           AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
       OR EXISTS (SELECT 1 FROM public.event_cohosts c
                   WHERE c.event_id = e.id AND c.status = 'accepted'
                     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
                       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)))
     )
$function$;

REVOKE ALL ON FUNCTION public.email_scope_event_ids(text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_scope_event_ids(text, uuid, uuid[]) TO service_role;
