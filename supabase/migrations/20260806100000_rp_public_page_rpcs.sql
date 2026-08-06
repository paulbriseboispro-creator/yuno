-- ============================================================================
-- Pages publiques RP (agences) : deux RPC SECURITY DEFINER pour le grand public.
--
-- 1) get_event_rp_agencies(p_event_id) — la ou les agences RP sous contrat
--    ACTIF avec le club (ou l'orga) d'une soirée Yuno publique. Alimente la
--    carte « RP » en bas de la page événement in-Yuno.
-- 2) get_agency_public_venues(p_affiliate_id) — les clubs Yuno sous contrat
--    actif de l'agence, pour la section « Clubs » de la page publique /rp/:slug.
--
-- SECURITY DEFINER + EXECUTE anon : le visiteur est anonyme et
-- agency_venue_contracts n'est pas (ni ne doit devenir) lisible par anon.
-- Les deux RPC n'exposent que des données déjà publiques par ailleurs
-- (identité affiliés des linktrees, venues de la marketplace). Même logique
-- de jointure que get_agency_linktree_yuno_events — c'est le miroir :
-- linktree = les soirées d'une agence, ici = les agences d'une soirée.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_event_rp_agencies(p_event_id uuid)
RETURNS TABLE(
  affiliate_id uuid,
  name         text,
  avatar_url   text,
  slug         text,
  city         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.id, a.name, a.avatar_url, a.linktree_slug, a.city
  FROM events e
  JOIN agency_venue_contracts avc
    ON avc.status = 'active'
   AND (
        (avc.venue_id IS NOT NULL AND avc.venue_id = e.venue_id)
     OR (avc.organizer_user_id IS NOT NULL AND avc.organizer_user_id = e.organizer_user_id)
   )
  JOIN affiliates a
    ON a.agency_id = avc.agency_id
   AND a.is_active = true
  WHERE e.id = p_event_id
    AND e.is_active = true
    AND e.visibility = 'public'
    AND e.cancelled_at IS NULL
  ORDER BY a.name
  LIMIT 6;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_rp_agencies(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_agency_public_venues(p_affiliate_id uuid)
RETURNS TABLE(
  venue_id  text,
  name      text,
  city      text,
  logo_url  text,
  cover_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT v.id, v.name, v.city, v.logo_url, v.cover_url
  FROM affiliates a
  JOIN agency_venue_contracts avc
    ON avc.agency_id = a.agency_id AND avc.status = 'active'
  JOIN venues v
    ON v.id = avc.venue_id
  WHERE a.id = p_affiliate_id
    AND a.is_active = true
    AND a.agency_id IS NOT NULL
    AND v.is_hidden = false
  ORDER BY v.name
  LIMIT 24;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_public_venues(uuid) TO anon, authenticated;
