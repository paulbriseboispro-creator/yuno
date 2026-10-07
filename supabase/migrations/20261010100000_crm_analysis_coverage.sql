-- ============================================================================
-- Yuno CRM — analyse client, lot A : les règles versionnées et la couverture
-- des signaux (2026-10-07). Plan : docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md,
-- consignes : docs/designs/CRM_CLIENT_ANALYSIS_PROMPT.md.
--
-- 1. crm_analysis_rules / crm_analysis_config() : UNE source pour tous les
--    seuils de l'analyse (rareté, délais, distance, statuts). Une nouvelle
--    version de règles n'est jamais appliquée seule : elle naît en
--    proposition (lot E) et Paul la valide.
-- 2. _crm_signal_coverage(portée) : ce que la billetterie connectée rend
--    vraiment, connexion par connexion (commandes à plusieurs billets et
--    détenteurs différents, soirées avec artistes / genres / type de lieu,
--    canaux, plateformes, tarifs promoteurs, scan, code postal, mise en
--    vente). Chaque famille d'hypothèses en déduit si elle est disponible,
--    réduite ou absente. Aucun vrai compte Shotgun n'était branché le 07/10 :
--    le code découvre ces réponses seul au lieu de les supposer.
-- 3. crm_signal_coverage(portée) : la même lecture, gardée (Console).
-- ============================================================================

-- ── 1. Les règles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_analysis_rules (
  version         integer PRIMARY KEY CHECK (version > 0),
  config          jsonb NOT NULL,
  active          boolean NOT NULL DEFAULT false,
  -- 'seed' (posée par une migration) | 'proposal' (calculée sur les agrégats,
  -- lot E) ; une proposition n'est active qu'après validation de Paul.
  origin          text NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed', 'proposal')),
  evidence        jsonb,
  approved_by     uuid,
  approved_at     timestamptz,
  approved_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_analysis_rules_one_active
  ON public.crm_analysis_rules ((true)) WHERE active;
ALTER TABLE public.crm_analysis_rules ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lue par crm_analysis_config(), écrite par les migrations et
-- par la validation super admin (lot E).

INSERT INTO public.crm_analysis_rules (version, active, origin, config) VALUES (1, true, 'seed', '{
  "min_sample": 10,
  "status": {"min_n": 30, "gain_supported": 1.3, "z_supported": 2, "gain_not": 1.1, "z_not": 1},
  "return": {"days": 180, "gap": 0.30, "z": 2, "min_n": 30},
  "rarity": {"resident_share": 0.20, "min_nights": 5},
  "buy": {"early_days": 14, "launch_hours": 24, "last_minute_hours": 24},
  "line_up_medium": {"launch_hours": 72},
  "distance": {"far_km": 80},
  "group": {"min_tickets": 2},
  "taste": {"genre_share": 0.6, "format_share": 0.7},
  "slots": {"day": 11, "sunset": 16, "evening": 20, "night": 23, "after": 5},
  "coverage": {"ok": 0.5, "min": 0.1, "multi_holder_full": 0.2},
  "grid": {"resident_share": [0.10, 0.20, 0.30], "launch_hours": [24, 72], "far_km": [50, 80, 150]}
}'::jsonb)
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_analysis_config()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT r.config || jsonb_build_object('rules_version', r.version)
       FROM public.crm_analysis_rules r WHERE r.active LIMIT 1),
    (SELECT r.config || jsonb_build_object('rules_version', r.version)
       FROM public.crm_analysis_rules r ORDER BY r.version LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.crm_analysis_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_analysis_config() TO authenticated, service_role;

-- ── 2. La couverture des signaux ─────────────────────────────────────────────
-- Lecture interne (pas de garde) : appelée par la RPC gardée, par le moteur
-- (lot B) et par l'Admin CRM (lot D). Une seule lecture des billets et des
-- soirées de la portée.
CREATE OR REPLACE FUNCTION public._crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_ok numeric := COALESCE((v_cfg->'coverage'->>'ok')::numeric, 0.5);
  v_min numeric := COALESCE((v_cfg->'coverage'->>'min')::numeric, 0.1);
  v_full numeric := COALESCE((v_cfg->'coverage'->>'multi_holder_full')::numeric, 0.2);
  v_conns jsonb;
  v_tot record;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;

  WITH conn AS (
    SELECT c.id, c.provider, c.status, c.initial_import_done_at
      FROM public.ticketing_connections c
     WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
  ), tk AS (
    SELECT t.connection_id, t.external_order_id, lower(t.buyer_email) AS em, t.status, t.raw, t.utm,
           t.scanned_at, t.zip_code, t.country_code, t.event_id,
           public._crm_ticket_is_sale(t.status, t.raw) AS sale
      FROM public.external_tickets t JOIN conn ON conn.id = t.connection_id
  ), ord AS (
    SELECT o.connection_id, count(*) AS orders,
           count(*) FILTER (WHERE o.n > 1) AS multi,
           count(*) FILTER (WHERE o.n > 1 AND o.holders > 1) AS multi_holders
      FROM (SELECT connection_id, external_order_id, count(*) AS n, count(DISTINCT em) AS holders
              FROM tk WHERE sale AND external_order_id IS NOT NULL GROUP BY 1, 2) o
     GROUP BY 1
  ), tks AS (
    SELECT connection_id,
           count(*) FILTER (WHERE sale) AS sales,
           count(*) FILTER (WHERE sale AND jsonb_typeof(raw->'deal_visibilities') = 'array'
                              AND raw->'deal_visibilities' ? 'promoters') AS promoter_sales,
           count(*) FILTER (WHERE sale AND raw->'ticket_seating'->>'type' IN ('Table', 'Booth')) AS table_sales,
           count(*) FILTER (WHERE sale AND zip_code IS NOT NULL AND btrim(zip_code) <> '') AS with_zip,
           count(*) FILTER (WHERE sale AND country_code IS NOT NULL) AS with_country,
           count(*) FILTER (WHERE status = 'valid') AS valid,
           count(*) FILTER (WHERE status = 'valid' AND scanned_at IS NOT NULL) AS scanned
      FROM tk GROUP BY 1
  ), chan AS (
    SELECT connection_id, jsonb_object_agg(k, n) AS channels
      FROM (SELECT connection_id, COALESCE(NULLIF(raw->>'deal_channel', ''), 'unknown') AS k, count(*) AS n
              FROM tk GROUP BY 1, 2) z GROUP BY 1
  ), med AS (
    SELECT connection_id, jsonb_object_agg(k, n) AS mediums
      FROM (SELECT connection_id, COALESCE(NULLIF(lower(utm->>'utm_medium'), ''), 'none') AS k, count(*) AS n
              FROM tk WHERE sale GROUP BY 1, 2) z GROUP BY 1
  ), ev AS (
    SELECT e.connection_id,
           count(*) AS nights,
           count(*) FILTER (WHERE jsonb_typeof(e.artists) = 'array' AND jsonb_array_length(e.artists) > 0) AS with_artists,
           count(*) FILTER (WHERE cardinality(e.genres) > 0) AS with_genres,
           count(*) FILTER (WHERE NULLIF(btrim(e.type_of_place), '') IS NOT NULL) AS with_place_type,
           count(*) FILTER (WHERE e.latitude IS NOT NULL AND e.longitude IS NOT NULL) AS with_coords,
           count(*) FILTER (WHERE e.launched_at IS NOT NULL) AS with_launch,
           COALESCE(array_agg(DISTINCT lower(btrim(e.type_of_place))) FILTER (WHERE NULLIF(btrim(e.type_of_place), '') IS NOT NULL), '{}') AS place_values
      FROM public.external_events e JOIN conn ON conn.id = e.connection_id
     WHERE e.cancelled_at IS NULL
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', conn.id, 'provider', conn.provider, 'status', conn.status,
           'imported', conn.initial_import_done_at IS NOT NULL,
           'sales', COALESCE(tks.sales, 0),
           'orders', COALESCE(ord.orders, 0),
           'multi_orders', COALESCE(ord.multi, 0),
           'multi_holder_orders', COALESCE(ord.multi_holders, 0),
           'promoter_sales', COALESCE(tks.promoter_sales, 0),
           'table_sales', COALESCE(tks.table_sales, 0),
           'with_zip', COALESCE(tks.with_zip, 0),
           'with_country', COALESCE(tks.with_country, 0),
           'valid', COALESCE(tks.valid, 0),
           'scanned', COALESCE(tks.scanned, 0),
           'channels', COALESCE(chan.channels, '{}'::jsonb),
           'mediums', COALESCE(med.mediums, '{}'::jsonb),
           'nights', COALESCE(ev.nights, 0),
           'nights_with_artists', COALESCE(ev.with_artists, 0),
           'nights_with_genres', COALESCE(ev.with_genres, 0),
           'nights_with_place_type', COALESCE(ev.with_place_type, 0),
           'nights_with_coords', COALESCE(ev.with_coords, 0),
           'nights_with_launch', COALESCE(ev.with_launch, 0),
           'place_values', to_jsonb(COALESCE(ev.place_values, '{}'::text[]))
         ) ORDER BY conn.id), '[]'::jsonb)
    INTO v_conns
    FROM conn
    LEFT JOIN ord ON ord.connection_id = conn.id
    LEFT JOIN tks ON tks.connection_id = conn.id
    LEFT JOIN chan ON chan.connection_id = conn.id
    LEFT JOIN med ON med.connection_id = conn.id
    LEFT JOIN ev ON ev.connection_id = conn.id;

  -- Totaux de la portée (toutes connexions).
  SELECT COALESCE(sum((c->>'sales')::int), 0) AS sales,
         COALESCE(sum((c->>'orders')::int), 0) AS orders,
         COALESCE(sum((c->>'multi_orders')::int), 0) AS multi,
         COALESCE(sum((c->>'multi_holder_orders')::int), 0) AS multi_holders,
         COALESCE(sum((c->>'promoter_sales')::int), 0) AS promoter_sales,
         COALESCE(sum((c->>'table_sales')::int), 0) AS table_sales,
         COALESCE(sum((c->>'with_zip')::int), 0) AS with_zip,
         COALESCE(sum((c->>'with_country')::int), 0) AS with_country,
         COALESCE(sum((c->>'valid')::int), 0) AS valid,
         COALESCE(sum((c->>'scanned')::int), 0) AS scanned,
         COALESCE(sum((c->>'nights')::int), 0) AS nights,
         COALESCE(sum((c->>'nights_with_artists')::int), 0) AS n_art,
         COALESCE(sum((c->>'nights_with_genres')::int), 0) AS n_gen,
         COALESCE(sum((c->>'nights_with_place_type')::int), 0) AS n_fmt,
         COALESCE(sum((c->>'nights_with_coords')::int), 0) AS n_geo,
         COALESCE(sum((c->>'nights_with_launch')::int), 0) AS n_launch,
         COALESCE(sum(COALESCE((c->'channels'->>'onsite')::int, 0) + COALESCE((c->'channels'->>'venue')::int, 0)), 0) AS door,
         COALESCE(sum(COALESCE((c->'channels'->>'invitation')::int, 0)), 0) AS inv,
         COALESCE(sum(COALESCE((c->'mediums'->>'app')::int, 0) + COALESCE((c->'mediums'->>'website')::int, 0)
                      + COALESCE((c->'mediums'->>'widget')::int, 0)), 0) AS online
    INTO v_tot
    FROM jsonb_array_elements(v_conns) c;

  RETURN jsonb_build_object(
    'rules_version', (v_cfg->>'rules_version')::int,
    'connections', v_conns,
    'totals', jsonb_build_object(
      'sales', v_tot.sales, 'orders', v_tot.orders, 'multi_orders', v_tot.multi,
      'multi_holder_orders', v_tot.multi_holders, 'nights', v_tot.nights,
      'nights_with_artists', v_tot.n_art, 'nights_with_genres', v_tot.n_gen,
      'nights_with_place_type', v_tot.n_fmt, 'nights_with_coords', v_tot.n_geo,
      'nights_with_launch', v_tot.n_launch, 'promoter_sales', v_tot.promoter_sales,
      'table_sales', v_tot.table_sales, 'with_zip', v_tot.with_zip, 'with_country', v_tot.with_country,
      'valid', v_tot.valid, 'scanned', v_tot.scanned, 'door_tickets', v_tot.door,
      'invitations', v_tot.inv, 'online_sales', v_tot.online),
    -- Disponibilité de chaque famille : 'ok' | 'reduced' | 'unavailable'.
    -- Une famille « uniforme » (toutes les soirées pareilles) est décidée par
    -- le moteur, qui voit les valeurs (lot C).
    'families', jsonb_build_object(
      'artist', public._crm_cov_level(v_tot.n_art, v_tot.nights, v_ok, v_min),
      'genre', public._crm_cov_level(v_tot.n_gen, v_tot.nights, v_ok, v_min),
      'format', public._crm_cov_level(v_tot.n_fmt, v_tot.nights, v_ok, v_min),
      'slot', CASE WHEN v_tot.nights > 0 THEN 'ok' ELSE 'unavailable' END,
      'weekday', CASE WHEN v_tot.nights > 0 THEN 'ok' ELSE 'unavailable' END,
      'series', CASE WHEN v_tot.nights > 0 THEN 'ok' ELSE 'unavailable' END,
      'place', public._crm_cov_level(v_tot.n_geo, v_tot.nights, v_ok, v_min),
      'early', CASE WHEN v_tot.sales > 0 THEN 'ok' ELSE 'unavailable' END,
      'launch', public._crm_cov_level(v_tot.n_launch, v_tot.nights, v_ok, v_min),
      'last_minute', CASE WHEN v_tot.sales > 0 THEN 'ok' ELSE 'unavailable' END,
      'door', CASE WHEN v_tot.door > 0 THEN 'ok' ELSE 'unavailable' END,
      -- « Venu avec » exige des détenteurs différents dans une commande ;
      -- sinon la famille se réduit à « achète pour N ».
      'group', CASE WHEN v_tot.multi = 0 THEN 'unavailable'
                    WHEN v_tot.multi_holders::numeric >= v_full * v_tot.multi THEN 'ok'
                    ELSE 'reduced' END,
      'brought', CASE WHEN v_tot.multi_holders > 0 THEN 'ok' ELSE 'unavailable' END,
      'table', CASE WHEN v_tot.table_sales > 0 THEN 'ok' ELSE 'unavailable' END,
      'discovery', CASE WHEN v_tot.online > 0 THEN 'ok' ELSE 'unavailable' END,
      -- Sans code postal : seulement les étrangers (réduit).
      'passing', CASE WHEN v_tot.sales = 0 THEN 'unavailable'
                      WHEN v_tot.with_zip::numeric >= v_ok * v_tot.sales AND v_tot.n_geo > 0 THEN 'ok'
                      WHEN v_tot.with_country > 0 THEN 'reduced'
                      ELSE 'unavailable' END,
      'invited', CASE WHEN v_tot.inv > 0 THEN 'ok' ELSE 'unavailable' END,
      'channel', CASE WHEN v_tot.sales > 0 THEN 'ok' ELSE 'unavailable' END),
    'scan_share', CASE WHEN v_tot.valid > 0 THEN round(v_tot.scanned::numeric / v_tot.valid, 3) END,
    'zip_share', CASE WHEN v_tot.sales > 0 THEN round(v_tot.with_zip::numeric / v_tot.sales, 3) END,
    'launch_share', CASE WHEN v_tot.nights > 0 THEN round(v_tot.n_launch::numeric / v_tot.nights, 3) END,
    'multi_share', CASE WHEN v_tot.orders > 0 THEN round(v_tot.multi::numeric / v_tot.orders, 3) END,
    'multi_holder_share', CASE WHEN v_tot.multi > 0 THEN round(v_tot.multi_holders::numeric / v_tot.multi, 3) END,
    'promoter_share', CASE WHEN v_tot.sales > 0 THEN round(v_tot.promoter_sales::numeric / v_tot.sales, 3) END
  );
END;
$$;

-- Niveau d'une couverture : 'ok' dès `ok`, 'reduced' dès `min`, sinon absente.
CREATE OR REPLACE FUNCTION public._crm_cov_level(p_n bigint, p_total bigint, p_ok numeric, p_min numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(p_total, 0) = 0 OR COALESCE(p_n, 0) = 0 THEN 'unavailable'
              WHEN p_n::numeric >= p_ok * p_total THEN 'ok'
              WHEN p_n::numeric >= p_min * p_total THEN 'reduced'
              ELSE 'unavailable' END;
$$;

REVOKE ALL ON FUNCTION public._crm_cov_level(bigint, bigint, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_cov_level(bigint, bigint, numeric, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._crm_signal_coverage(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signal_coverage(text, uuid) TO service_role;

-- ── 3. Lecture gardée (Console) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_signal_coverage(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public._crm_signal_coverage(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signal_coverage(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signal_coverage(text, uuid) TO authenticated, service_role;
