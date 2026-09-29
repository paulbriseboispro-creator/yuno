-- « Suivre tous les hôtes » : l'état lu doit porter sur les MÊMES hôtes que
-- ceux que le bouton suit (follow_event_hosts, 20260929110000) — jamais un club
-- caché ni un organisateur privé, sinon le bouton ne passe jamais à « Suivi ».
CREATE OR REPLACE FUNCTION public.follows_all_event_hosts(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_parties(p_event_id) p
      LEFT JOIN public.organizer_profiles op ON op.user_id = p.organizer_user_id
      LEFT JOIN public.venues v ON v.id = p.venue_id
     WHERE (p.kind = 'org' AND COALESCE(op.is_public, true) AND p.organizer_user_id <> auth.uid() AND NOT EXISTS (
              SELECT 1 FROM public.organizer_profile_followers f
               WHERE f.organizer_user_id = p.organizer_user_id AND f.user_id = auth.uid()))
        OR (p.kind = 'venue' AND v.decommissioned_at IS NULL
            AND (NOT COALESCE(v.is_hidden, false) OR v.id = ANY (public.demo_venue_ids()))
            AND NOT EXISTS (
              SELECT 1 FROM public.favorites f
               WHERE f.venue_id = p.venue_id AND f.user_id = auth.uid() AND f.favorite_type = 'club'))
  );
$$;
