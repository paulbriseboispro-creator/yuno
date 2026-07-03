-- resolve_event_path : résoudre le slug d'orga même si son PROFIL public est masqué.
-- Un event PEUT être public alors que l'orga qui le porte a `is_public=false` (profil non
-- listé). Le resolver ne fait que mapper (host, slug) -> event id ; l'accès aux données de
-- l'event reste gouverné par sa visibilité + la RLS. Sans ça, le lien propre d'un tel event
-- renvoyait « event introuvable ». On retire donc le filtre is_public de la branche orga.

CREATE OR REPLACE FUNCTION public.resolve_event_path(p_host text, p_slug text)
RETURNS TABLE (event_id uuid, host text, slug text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_org uuid; v_org_slug text;
BEGIN
  -- --- Branche VENUE : host = venue_id (id texte de la table venues). ---
  IF EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_host) THEN
    RETURN QUERY
      SELECT e.id, e.venue_id, e.slug
        FROM public.events e
       WHERE e.venue_id = p_host
         AND e.organizer_user_id IS NULL
         AND e.is_active = true
         AND ( e.slug = p_slug
            OR EXISTS (SELECT 1 FROM public.event_slug_aliases a
                        WHERE a.event_id = e.id AND a.slug = p_slug) )
       ORDER BY (e.slug = p_slug) DESC
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- --- Branche ORGA : host = slug d'orga (courant ou alias), quel que soit is_public. ---
  SELECT o.user_id INTO v_org FROM public.organizer_profiles o WHERE o.slug = p_host;
  IF v_org IS NULL THEN
    SELECT al.user_id INTO v_org FROM public.organizer_slug_aliases al WHERE al.slug = p_host;
  END IF;
  IF v_org IS NOT NULL THEN
    SELECT o.slug INTO v_org_slug FROM public.organizer_profiles o WHERE o.user_id = v_org;
    RETURN QUERY
      SELECT e.id, v_org_slug, e.slug
        FROM public.events e
       WHERE e.organizer_user_id = v_org
         AND e.is_active = true
         AND ( e.slug = p_slug
            OR EXISTS (SELECT 1 FROM public.event_slug_aliases a
                        WHERE a.event_id = e.id AND a.slug = p_slug) )
       ORDER BY (e.slug = p_slug) DESC
       LIMIT 1;
  END IF;
  RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_event_path(text, text) TO anon, authenticated;
