-- ─────────────────────────────────────────────────────────────────────────────
-- Fix D2 : compteur d'abonnés DJ au grain PERSONNE (cohérence des surfaces).
--
-- Bug : get_public_favorite_counts('dj') groupait par f.dj_id (une FICHE par club),
-- alors que get_dj_public_profile compte la PERSONNE. Résultat, le même DJ affichait
-- « 1 200 abonnés » sur sa page publique et un chiffre fragmenté (plus petit) sur sa
-- carte Explore. Un dashboard d'audience qui contredit la page publique tue la
-- confiance dans toute la feature.
--
-- Correctif : pour 'dj', compter les abonnés DISTINCTS de la personne (djs.user_id),
-- puis PROJETER ce total sur CHAQUE fiche (dj_id). Les appelants keyés par fiche
-- (Explore.tsx, SearchOverlay) affichent alors le vrai total, SANS changement front.
-- Les autres types sont inchangés.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_favorite_counts(_favorite_type text)
RETURNS TABLE(target_id text, total_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- DJ : grain personne, projeté sur chaque fiche dj_id.
  SELECT d.id::text AS target_id, pc.cnt::integer AS total_count
  FROM public.djs d
  JOIN (
    SELECT d2.user_id AS person, count(DISTINCT f.user_id) AS cnt
      FROM public.favorites f
      JOIN public.djs d2 ON d2.id = f.dj_id
     WHERE f.favorite_type = 'dj'
     GROUP BY d2.user_id
  ) pc ON pc.person = d.user_id
  WHERE _favorite_type = 'dj'

  UNION ALL

  -- Tous les autres types : inchangé (entité à une seule ligne).
  SELECT x.target_id, count(*)::integer AS total_count
  FROM (
    SELECT CASE
      WHEN _favorite_type = 'club'            THEN f.venue_id
      WHEN _favorite_type = 'event'           THEN f.event_id::text
      WHEN _favorite_type = 'drink'           THEN f.drink_id
      WHEN _favorite_type = 'affiliate_event' THEN f.affiliate_event_id::text
      WHEN _favorite_type = 'affiliate_venue' THEN f.affiliate_venue_id::text
      ELSE NULL
    END AS target_id
    FROM public.favorites f
    WHERE f.favorite_type = _favorite_type
      AND _favorite_type <> 'dj'
  ) x
  WHERE x.target_id IS NOT NULL
  GROUP BY x.target_id;
$$;
