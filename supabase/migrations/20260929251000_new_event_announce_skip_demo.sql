-- =============================================================================
-- Push « nouvelle soirée » : jamais pour une soirée de la démo
-- =============================================================================
-- `get_new_events_to_announce()` écartait les clubs cachés (donc le club démo),
-- mais pas une soirée d'ORGANISATEUR démo sans club (« Rooftop Session ») : la
-- publier depuis la démo l'annonçait en push aux abonnés de l'organisateur. La
-- règle tenait jusqu'ici par une consigne (« garder un published_at de plus de
-- 72 h »), c'est-à-dire par personne. Elle tient désormais dans la requête.
--
-- Corps identique à l'état live, plus la porte démo évaluée UNE fois
-- (CTE MATERIALIZED, cf. CLAUDE.md « La porte s'évalue une fois par requête »).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_new_events_to_announce()
 RETURNS TABLE(event_id uuid, title text, slug text, venue_id text, organizer_user_id uuid, start_at timestamp with time zone, host_name text, host_kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
  SELECT e.id, e.title, e.slug, e.venue_id, e.organizer_user_id, e.start_at,
         COALESCE(
           v.name,
           NULLIF(btrim(op.display_name), ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           'Yuno') AS host_name,
         CASE WHEN e.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END AS host_kind
    FROM public.events e
    CROSS JOIN d
    LEFT JOIN public.venues v ON v.id = e.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
    LEFT JOIN public.profiles p ON p.id = e.organizer_user_id
   WHERE e.is_active = true
     AND e.visibility = 'public'
     AND e.cancelled_at IS NULL
     AND COALESCE(e.requires_access_code, false) = false
     AND e.start_at > now()
     AND e.published_at > now() - interval '72 hours'
     AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
     AND (e.venue_id IS NULL OR (COALESCE(v.is_hidden, false) = false AND v.decommissioned_at IS NULL))
     AND (e.recurring_template_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.events e2
             WHERE e2.recurring_template_id = e.recurring_template_id
               AND e2.id <> e.id AND e2.created_at < e.created_at))
     AND NOT EXISTS (
            SELECT 1 FROM public.push_campaigns c
             WHERE c.event_id = e.id AND c.template_key = 'new_event' AND c.source = 'auto')
   ORDER BY e.published_at;
$function$;
