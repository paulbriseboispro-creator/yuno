-- ============================================================================
-- resolve_venue_slug ne révèle plus l'existence d'un club caché.
--
-- La RPC est SECURITY DEFINER et grantée à anon : avant ce correctif, elle
-- résolvait aussi les venues is_hidden=true (vitrines de prospection, clubs en
-- onboarding, décommissions) — un visiteur pouvait confirmer l'existence d'un
-- club caché en tapant son slug, alors que la page rend 404. Désormais, un
-- club caché ne résout que pour ceux qui ont le droit de le voir : super
-- admin, owner, manager (can_manage_venue), ou staff rattaché
-- (profiles.venue_id).
--
-- Fuite résiduelle assumée (pré-existante, hors périmètre) : le SELECT direct
-- sur venues avec un id deviné reste possible via la policy USING(true) et le
-- GRANT colonne — le gate 404 de VenuePage en dépend pour son propre check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_venue_slug(p_slug text)
RETURNS TABLE (venue_id text, slug text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY
    SELECT v.id, COALESCE(NULLIF(v.slug, ''), v.id) FROM public.venues v
     WHERE (v.slug = lower(p_slug) OR v.id = p_slug)
       AND (NOT v.is_hidden
            OR public.is_super_admin()
            OR v.owner_id = auth.uid()
            OR public.can_manage_venue(auth.uid(), v.id)
            OR EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.venue_id = v.id))
     ORDER BY (v.id = p_slug) DESC
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT v.id, COALESCE(NULLIF(v.slug, ''), v.id)
      FROM public.venue_slug_aliases a
      JOIN public.venues v ON v.id = a.venue_id
     WHERE a.slug = lower(p_slug)
       AND (NOT v.is_hidden
            OR public.is_super_admin()
            OR v.owner_id = auth.uid()
            OR public.can_manage_venue(auth.uid(), v.id)
            OR EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.venue_id = v.id))
     LIMIT 1;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_venue_slug(text) TO anon, authenticated;
