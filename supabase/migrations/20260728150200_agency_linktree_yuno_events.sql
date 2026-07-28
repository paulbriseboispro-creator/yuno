-- ============================================================================
-- Linktree agence : les soirées Yuno des clubs sous contrat s'affichent.
--
-- Le linktree public /p/:slug ne lisait que affiliate_events (bras externe).
-- Une agence fusionnée qui ne travaille QUE des clubs Yuno affichait « Aucune
-- soirée pour le moment » alors que ses promoteurs sont assignés sur de vraies
-- soirées in-app. Cette RPC rend les soirées Yuno à venir des clubs/orgas sous
-- contrat ACTIF de l'agence liée à l'affilié.
--
-- SECURITY DEFINER + EXECUTE anon : le visiteur du linktree est anonyme, et ni
-- agency_venue_contracts ni promoters ne sont (ni ne doivent devenir) lisibles
-- par anon. La RPC n'expose que des données déjà publiques par ailleurs sur la
-- marketplace (events is_active + visibility 'public', prix planchers).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_agency_linktree_yuno_events(p_affiliate_id uuid)
RETURNS TABLE(
  event_id    uuid,
  title       text,
  start_at    timestamptz,
  venue_id    text,
  venue_name  text,
  venue_city  text,
  poster_url  text,
  music_genres text[],
  price_from  numeric,
  is_free     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.start_at,
    e.venue_id,
    v.name,
    v.city,
    COALESCE(e.poster_url, e.image_url),
    COALESCE(e.music_genres, ARRAY[e.music_genre]),
    MIN(tr.price) FILTER (WHERE tr.is_active),
    COALESCE(MIN(tr.price) FILTER (WHERE tr.is_active), 0) <= 0
  FROM affiliates a
  JOIN agency_venue_contracts avc
    ON avc.agency_id = a.agency_id AND avc.status = 'active'
  JOIN events e
    ON (avc.venue_id IS NOT NULL AND e.venue_id = avc.venue_id)
    OR (avc.organizer_user_id IS NOT NULL AND e.organizer_user_id = avc.organizer_user_id)
  LEFT JOIN venues v ON v.id = e.venue_id
  LEFT JOIN ticket_rounds tr ON tr.event_id = e.id
  WHERE a.id = p_affiliate_id
    AND a.is_active = true
    AND a.agency_id IS NOT NULL
    AND e.is_active = true
    AND e.visibility = 'public'
    AND e.cancelled_at IS NULL
    AND e.end_at >= now()
  GROUP BY e.id, e.title, e.start_at, e.venue_id, v.name, v.city,
           e.poster_url, e.image_url, e.music_genres, e.music_genre
  ORDER BY e.start_at ASC
  LIMIT 24;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_linktree_yuno_events(uuid) TO anon, authenticated;
