-- Audience DJ — reparation du systeme casse.
-- Deux causes racines corrigees ici :
--   (a) Les liens trackes n'etaient semes que sur INSERT event_djs (line-up public).
--       Mais les owners attachent surtout les DJ via dj_sets (planning/cachet),
--       non synchronise avec event_djs -> aucun lien -> page Audience vide.
--       Fix : seed aussi sur INSERT dj_sets (quand event_id present).
--   (b) La page lisait une seule fiche djs (venue selectionnee). Un DJ = N fiches
--       (1 par venue + 1 par roster orga, meme user_id). Fix cote serveur : la RPC
--       get_dj_audience() agrege TOUTES les fiches du caller (via auth.uid()) et
--       unit event_djs ∪ dj_sets, plus les infos guest list DJ par soiree.

-- =============================================================================
-- 1. Seed lien tracke aussi depuis dj_sets (reutilise la fonction existante
--    seed_dj_event_tracked_link de la migration 20260620100000).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_seed_dj_set_tracked_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    PERFORM public.seed_dj_event_tracked_link(NEW.event_id, NEW.dj_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS seed_dj_tracked_link_on_set ON public.dj_sets;
CREATE TRIGGER seed_dj_tracked_link_on_set
  AFTER INSERT ON public.dj_sets
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_dj_set_tracked_link();

-- Backfill : dj_sets existants sur des soirees a venir et actives.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT ds.event_id, ds.dj_id
    FROM public.dj_sets ds
    JOIN public.events e ON e.id = ds.event_id
    WHERE ds.event_id IS NOT NULL AND e.is_active = true AND e.end_at >= now()
  LOOP
    PERFORM public.seed_dj_event_tracked_link(r.event_id, r.dj_id);
  END LOOP;
END $$;

-- =============================================================================
-- 2. RPC hub : tout ce que la page Audience affiche, agrege sur toutes les fiches
--    du DJ. Par soiree a venir : son lien de vente tracke (clics/ventes/€) + sa
--    guest list DJ si l'hote en a accorde une (lien + inscrits/quota + scannes).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_audience()
RETURNS TABLE (
  event_id      uuid,
  event_title   text,
  start_at      timestamptz,
  poster_url    text,
  location_name text,
  link_code     text,
  clicks        integer,
  conversions   bigint,
  revenue       numeric,
  gl_id         uuid,
  gl_share_token text,
  gl_quota      integer,
  gl_signups    bigint,
  gl_scanned    bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- The RETURNS TABLE output names (event_id, gl_id, ...) are also visible as
-- plpgsql variables in the body, so unqualified column refs are ambiguous.
-- use_column makes any ambiguity resolve to the column, not the OUT variable.
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  r record;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Garantir un lien tracke par (event, fiche) — idempotent (belt-and-suspenders
  -- au cas ou un trigger aurait manque un line-up).
  FOR r IN
    SELECT DISTINCT x.event_id, x.dj_id FROM (
      SELECT ed.event_id, ed.dj_id
      FROM public.event_djs ed
      JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_uid
      JOIN public.events e ON e.id = ed.event_id
      WHERE e.is_active = true AND e.end_at >= now()
      UNION
      SELECT ds.event_id, ds.dj_id
      FROM public.dj_sets ds
      JOIN public.djs d    ON d.id = ds.dj_id AND d.user_id = v_uid
      JOIN public.events e ON e.id = ds.event_id
      WHERE ds.event_id IS NOT NULL AND e.is_active = true AND e.end_at >= now()
    ) x
  LOOP
    PERFORM public.seed_dj_event_tracked_link(r.event_id, r.dj_id);
  END LOOP;

  RETURN QUERY
  WITH dj_ids AS (
    SELECT id FROM public.djs WHERE user_id = v_uid
  ),
  ev AS (
    SELECT DISTINCT e.id AS event_id
    FROM public.events e
    WHERE e.is_active = true AND e.end_at >= now()
      AND (
        EXISTS (SELECT 1 FROM public.event_djs ed JOIN dj_ids di ON di.id = ed.dj_id WHERE ed.event_id = e.id)
        OR EXISTS (SELECT 1 FROM public.dj_sets ds  JOIN dj_ids di ON di.id = ds.dj_id WHERE ds.event_id = e.id)
      )
  ),
  -- un seul lien DJ par event parmi les fiches du caller (le plus recent)
  link AS (
    SELECT DISTINCT ON (tl.event_id)
           tl.event_id, tl.id AS link_id, tl.code, tl.clicks_count
    FROM public.tracked_links tl
    JOIN dj_ids di ON di.id = tl.dj_id
    WHERE tl.owner_kind = 'dj' AND tl.event_id IN (SELECT ev.event_id FROM ev)
    ORDER BY tl.event_id, tl.created_at DESC
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT tracked_link_id, total_price AS amt FROM public.tickets            WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total_price AS amt FROM public.table_reservations WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total       AS amt FROM public.orders             WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
    ) all_conv
    GROUP BY tracked_link_id
  ),
  -- la guest list DJ pour cet event parmi les fiches du caller
  gl AS (
    SELECT DISTINCT ON (g.event_id)
           g.event_id, g.id AS gl_id, g.share_token, g.quota
    FROM public.guest_lists g
    JOIN dj_ids di ON di.id = g.dj_id
    WHERE g.dj_id IS NOT NULL AND g.is_active = true AND g.event_id IN (SELECT ev.event_id FROM ev)
    ORDER BY g.event_id, g.created_at DESC
  ),
  gle AS (
    SELECT e.guest_list_id,
           count(*) FILTER (WHERE e.status <> 'cancelled')::bigint AS signups,
           count(*) FILTER (WHERE e.entry_scanned)::bigint         AS scanned
    FROM public.guest_list_entries e
    WHERE e.guest_list_id IN (SELECT gl.gl_id FROM gl)
    GROUP BY e.guest_list_id
  )
  SELECT
    e.id, e.title, e.start_at, e.poster_url,
    COALESCE(v.name, e.location_name) AS location_name,
    link.code, COALESCE(link.clicks_count, 0),
    COALESCE(conv.c, 0), COALESCE(conv.rev, 0),
    gl.gl_id, gl.share_token, gl.quota,
    COALESCE(gle.signups, 0), COALESCE(gle.scanned, 0)
  FROM ev
  JOIN public.events e ON e.id = ev.event_id
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN link ON link.event_id = ev.event_id
  LEFT JOIN conv ON conv.tracked_link_id = link.link_id
  LEFT JOIN gl   ON gl.event_id = ev.event_id
  LEFT JOIN gle  ON gle.guest_list_id = gl.gl_id
  ORDER BY e.start_at ASC NULLS LAST;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_audience() TO authenticated;
