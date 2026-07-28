-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 1b — hype score : compteur d'abonnés PUBLIC (total + fenêtre récente).
--
-- useHypeScore lisait `favorites` en direct pour dériver favCount + favorites7d.
-- Or la RLS de favorites est owner-only (auth.uid() = user_id) : côté client, un
-- owner ne voit que sa propre ligne → 0/1. get_public_favorite_count(s) corrigent le
-- total mais n'ont pas de fenêtre temporelle, alors que le hype score a besoin des
-- DEUX (total = preuve sociale, récent = momentum d'abonnés). Ce RPC DEFINER renvoie
-- les deux en un seul aller-retour, event-scopé quand un event est fourni sinon
-- venue-scopé — parité exacte avec l'ancienne double requête :
--   event  => favorite_type = 'event' AND event_id = _event_id
--   venue  => venue_id = _venue_id (tous types, comme l'ancien .eq('venue_id', …))
--
-- Aucune fuite : le total est déjà exposé publiquement par get_public_favorite_count
-- (anon + authenticated). Ici on se limite à `authenticated` (surface pro owner).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_hype_favorite_stats(
  _venue_id text DEFAULT NULL,
  _event_id uuid DEFAULT NULL,
  _since timestamptz DEFAULT NULL
)
RETURNS TABLE(total_count integer, recent_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::integer AS total_count,
    count(*) FILTER (WHERE _since IS NOT NULL AND f.created_at >= _since)::integer AS recent_count
  FROM public.favorites f
  WHERE
    CASE
      WHEN _event_id IS NOT NULL THEN f.favorite_type = 'event' AND f.event_id = _event_id
      WHEN _venue_id IS NOT NULL THEN f.venue_id = _venue_id
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.get_hype_favorite_stats(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hype_favorite_stats(text, uuid, timestamptz) TO authenticated;
