-- ============================================================================
-- Yuno CRM — « Ce qui fait venir » : des statuts plus sûrs (2026-10-14).
-- Plan : docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md (lot 3). Décisions de Paul :
-- corriger les tests multiples (07/10) ; « Confirmée » seulement après 2 calculs
-- complets de suite (07/10) ; « Pas de différence nette sur votre compte » à la
-- place de « Testée, pas confirmée » et d'un « À tester » qui dure (08/10).
--
-- Une vingtaine de familles et de canaux sont testés chaque nuit par compte :
-- au seuil z ≥ 2, une ou deux « Confirmée » sur vingt peuvent être du hasard.
-- Le statut affiché passe désormais par quatre étapes :
--   1. La p-valeur de chaque test. Petits effectifs (E < 10) : loi de Poisson
--      EXACTE (au banc, `launch` était « confirmée » sur O = 3 pour E = 0,8 :
--      z = 2,5 soit p = 0,006 en loi normale, mais p = 0,047 en vrai) ;
--      sinon loi normale (unilatérale pour une affinité ou un comportement,
--      bilatérale pour un retour).
--   2. Benjamini-Hochberg sur toutes les familles testées du compte, au taux
--      de fausses découvertes status.fdr (10 %) : une famille n'est candidate
--      que si son test passe ET la correction ET qu'on attendait au moins
--      status.min_e (5) cas au hasard. Au banc, la correction seule laissait
--      `launch` confirmée sur 3 cas pour 0,8 attendu (p = 0,045 passe quand
--      toutes les autres familles sont massivement significatives), et c'est
--      elle qui basculait quand on retirait 10 % des clients.
--   3. Marge anti-bascule : une famille déjà candidate le reste tant qu'elle
--      tient un seuil plus bas (gain ≥ 1,2 et z ≥ 1,5 ; retour : écart ≥ 20 %
--      et |z| ≥ 1,5).
--   4. « Confirmée » seulement après status.confirm_runs (2) jours de calcul
--      complet consécutifs comme candidate ; avant, « À tester ». Une famille
--      non concluante depuis status.flat_days (60) jours avec au moins
--      status.flat_min_n (100) cas devient « pas de différence nette »
--      (not_supported), comme une famille testée sans écart.
-- crm_family_status.supported_runs / flat_since portent cet état ; detail
-- garde la p-valeur et le passage de la correction (`p`, `bh`).
-- Les familles déjà confirmées repartent à 1 jour : confirmées de nouveau au
-- prochain calcul si elles passent la correction, sans clignoter.
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

SET lock_timeout = '5s';

-- ── 0. Réglages ──────────────────────────────────────────────────────────────
UPDATE public.crm_analysis_rules
   SET config = jsonb_set(jsonb_set(config, '{status}', COALESCE(config->'status', '{}'::jsonb) || '{
       "fdr": 0.1, "min_e": 5, "gain_hold": 1.2, "z_hold": 1.5, "confirm_runs": 2, "flat_days": 60, "flat_min_n": 100
     }'::jsonb), '{return}', COALESCE(config->'return', '{}'::jsonb) || '{"gap_hold": 0.2}'::jsonb)
 WHERE NOT (COALESCE(config->'status', '{}'::jsonb) ? 'fdr');

-- ── 1. L'état de stabilité ───────────────────────────────────────────────────
ALTER TABLE public.crm_family_status
  ADD COLUMN IF NOT EXISTS supported_runs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flat_since timestamptz;
UPDATE public.crm_family_status SET supported_runs = 1 WHERE status = 'supported' AND supported_runs = 0;
UPDATE public.crm_family_status SET flat_since = status_since WHERE status = 'inconclusive' AND flat_since IS NULL;

-- ── 2. La p-valeur d'un test ─────────────────────────────────────────────────
-- Affinité / comportement : P(au moins O | E), unilatérale. Retour : bilatérale
-- sur le z des deux proportions. NULL quand le test n'a pas de sens.
CREATE OR REPLACE FUNCTION public._crm_an_pvalue(p_kind text, p_o numeric, p_e numeric, p_z numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  x float8;
  t float8;
  q float8;
  term float8;
  cdf float8;
  k integer;
  o integer := floor(COALESCE(p_o, 0))::int;
BEGIN
  IF p_kind <> 'return' AND COALESCE(p_e, 0) > 0 AND p_e < 10 THEN
    -- Poisson exact : 1 − Σ_{k<O} e^(−E) E^k / k!
    IF o <= 0 THEN RETURN 1; END IF;
    term := exp(-p_e::float8);
    cdf := term;
    FOR k IN 1..o - 1 LOOP
      term := term * p_e::float8 / k;
      cdf := cdf + term;
    END LOOP;
    RETURN GREATEST(0, LEAST(1, 1 - cdf))::numeric;
  END IF;
  IF p_z IS NULL THEN RETURN NULL; END IF;
  -- Queue de la loi normale (Abramowitz et Stegun 26.2.17, erreur < 1e-7).
  x := abs(p_z::float8);
  IF x > 37 THEN
    q := 0;  -- exp(−x²/2) sort des flottants : la queue est nulle
  ELSE
    t := 1 / (1 + 0.2316419 * x);
    q := exp(-x * x / 2) / sqrt(2 * pi())
         * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  END IF;
  IF p_kind = 'return' THEN RETURN LEAST(1, 2 * q)::numeric; END IF;
  RETURN (CASE WHEN p_z >= 0 THEN q ELSE 1 - q END)::numeric;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_an_pvalue(text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- ── 3. Le moteur : statuts corrigés ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_an_engine(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz, p_cfg jsonb, p_full boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_at timestamptz := COALESCE(p_at, now());
  v_minb int := COALESCE((p_cfg->'rarity'->>'min_nights')::int, 5);
  v_res numeric := COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_launch numeric := COALESCE((p_cfg->'buy'->>'launch_hours')::numeric, 24);
  v_far numeric := COALESCE((p_cfg->'distance'->>'far_km')::numeric, 80);
  v_early numeric := COALESCE((p_cfg->'buy'->>'early_days')::numeric, 14) * 24;
  v_last numeric := COALESCE((p_cfg->'buy'->>'last_minute_hours')::numeric, 24);
  v_grp int := COALESCE((p_cfg->'group'->>'min_tickets')::int, 2);
  v_ret interval := make_interval(days => COALESCE((p_cfg->'return'->>'days')::int, 180));
  v_ver int := (p_cfg->>'rules_version')::int;
  v_res_all numeric[];
  v_launch_all numeric[];
  v_far_all numeric[];
  v_cov jsonb;
  v_out jsonb;
  -- Correction des tests multiples et stabilité (20261014110000).
  v_fdr numeric := COALESCE((p_cfg->'status'->>'fdr')::numeric, 0.1);
  v_min_e numeric := COALESCE((p_cfg->'status'->>'min_e')::numeric, 5);
  v_gain_hold numeric := COALESCE((p_cfg->'status'->>'gain_hold')::numeric, 1.2);
  v_z_hold numeric := COALESCE((p_cfg->'status'->>'z_hold')::numeric, 1.5);
  v_gap_hold numeric := COALESCE((p_cfg->'return'->>'gap_hold')::numeric, 0.2);
  v_confirm int := COALESCE((p_cfg->'status'->>'confirm_runs')::int, 2);
  v_flat_days int := COALESCE((p_cfg->'status'->>'flat_days')::int, 60);
  v_flat_n int := COALESCE((p_cfg->'status'->>'flat_min_n')::int, 100);
  v_bh numeric;
BEGIN
  IF NOT COALESCE(p_full, false) THEN RETURN '{}'::jsonb; END IF;
  BEGIN
    SELECT cov INTO v_cov FROM _ancov LIMIT 1;
  EXCEPTION WHEN undefined_table THEN v_cov := NULL;
  END;
  v_cov := COALESCE(v_cov, public._crm_signal_coverage(p_venue_id, p_organizer_user_id));

  -- Seuils évalués : celui de la règle + ceux de la grille.
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_res_all
    FROM (SELECT v_res AS x UNION SELECT (g)::numeric FROM jsonb_array_elements_text(COALESCE(p_cfg->'grid'->'resident_share', '[]')) g) z;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_launch_all
    FROM (SELECT v_launch AS x UNION SELECT (g)::numeric FROM jsonb_array_elements_text(COALESCE(p_cfg->'grid'->'launch_hours', '[]')) g) z;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_far_all
    FROM (SELECT v_far AS x UNION SELECT (g)::numeric FROM jsonb_array_elements_text(COALESCE(p_cfg->'grid'->'far_km', '[]')) g) z;

  -- Passages N → N+1 de chaque revenant.
  DROP TABLE IF EXISTS _antr;
  CREATE TEMP TABLE _antr ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY a.em, a.k)::int AS tid, a.em, a.k AS k0, a.nid AS n0, a.start_at AS s0,
         b.nid AS n1, b.start_at AS s1, b.bought_at AS buy1
    FROM _ana a JOIN _ana b ON b.em = a.em AND b.k = a.k + 1;

  -- Ce qu'il avait vu JUSQU'À N (traits des soirées venues, N comprise).
  DROP TABLE IF EXISTS _anh;
  CREATE TEMP TABLE _anh ON COMMIT DROP AS
  SELECT t.tid,
         ARRAY(SELECT DISTINCT g FROM _ana x JOIN _ann n ON n.nid = x.nid CROSS JOIN LATERAL unnest(n.genres) g
                WHERE x.em = t.em AND x.k <= t.k0) AS h_gen,
         ARRAY(SELECT DISTINCT n.fmt FROM _ana x JOIN _ann n ON n.nid = x.nid
                WHERE x.em = t.em AND x.k <= t.k0 AND n.fmt IS NOT NULL) AS h_fmt,
         ARRAY(SELECT DISTINCT n.slot FROM _ana x JOIN _ann n ON n.nid = x.nid
                WHERE x.em = t.em AND x.k <= t.k0 AND n.slot IS NOT NULL) AS h_slot,
         ARRAY(SELECT DISTINCT n.wd FROM _ana x JOIN _ann n ON n.nid = x.nid
                WHERE x.em = t.em AND x.k <= t.k0) AS h_wd,
         ARRAY(SELECT DISTINCT n.place_key FROM _ana x JOIN _ann n ON n.nid = x.nid
                WHERE x.em = t.em AND x.k <= t.k0 AND n.place_key IS NOT NULL) AS h_place,
         ARRAY(SELECT DISTINCT n.series FROM _ana x JOIN _ann n ON n.nid = x.nid
                WHERE x.em = t.em AND x.k <= t.k0 AND n.series IS NOT NULL) AS h_ser
    FROM _antr t;
  CREATE INDEX ON _anh (tid);

  -- Artistes vus jusqu'à N, avec leur rareté À LA DATE de N (0 tant que le
  -- compte a trop peu de soirées pour parler de résident).
  DROP TABLE IF EXISTS _anhs;
  CREATE TEMP TABLE _anhs ON COMMIT DROP AS
  SELECT t.tid, y.ak, min(CASE WHEN r.base < v_minb THEN 0 ELSE r.share END) AS eff
    FROM _antr t
    JOIN _ana x ON x.em = t.em AND x.k <= t.k0
    JOIN _annart y ON y.nid = x.nid
    JOIN _anrar r ON r.nid = t.n0 AND r.ak = y.ak
   GROUP BY t.tid, y.ak;
  CREATE INDEX ON _anhs (tid, ak);

  -- Les soirées « au choix » : commencées après N, en vente avant l'achat de
  -- N+1 (N+1 toujours comprise). `ms` = plus faible rareté d'un artiste déjà vu.
  DROP TABLE IF EXISTS _anch;
  CREATE TEMP TABLE _anch ON COMMIT DROP AS
  SELECT t.tid, m.nid, (m.nid = t.n1) AS nx,
         (m.genres && h.h_gen) AS g,
         COALESCE(m.fmt = ANY (h.h_fmt), false) AS f,
         COALESCE(m.slot = ANY (h.h_slot), false) AS sl,
         COALESCE(m.wd = ANY (h.h_wd), false) AS wd,
         COALESCE(m.place_key = ANY (h.h_place), false) AS pl,
         COALESCE(m.series = ANY (h.h_ser), false) AS se,
         (SELECT min(s.eff) FROM _annart y JOIN _anhs s ON s.tid = t.tid AND s.ak = y.ak WHERE y.nid = m.nid) AS ms
    FROM _antr t
    JOIN _anh h ON h.tid = t.tid
    JOIN _ann m ON m.nid <> t.n0
               AND (m.start_at > t.s0 OR m.nid = t.n1)
               AND (m.sale_at <= t.buy1 OR m.nid = t.n1);

  DROP TABLE IF EXISTS _anstat;
  CREATE TEMP TABLE _anstat (
    family text, variant text, is_cur boolean, kind text,
    o numeric, e numeric, v numeric, n integer, n0 integer, z numeric, detail jsonb
  ) ON COMMIT DROP;

  -- Affinités.
  INSERT INTO _anstat
  SELECT q.fam, q.var, q.cur, 'affinity', sum(q.o), sum(q.p), sum(q.p * (1 - q.p)), count(*)::int, NULL,
         CASE WHEN sum(q.p * (1 - q.p)) > 0 THEN (sum(q.o) - sum(q.p)) / sqrt(sum(q.p * (1 - q.p))) END,
         jsonb_build_object('transitions', (SELECT count(*) FROM _antr))
    FROM (
      SELECT c.tid, u.fam, u.var, u.cur, avg(u.val::int)::numeric AS p, max((u.val AND c.nx)::int)::numeric AS o
        FROM _anch c
        CROSS JOIN LATERAL (
          SELECT 'genre' AS fam, '' AS var, true AS cur, c.g AS val
          UNION ALL SELECT 'format', '', true, c.f
          UNION ALL SELECT 'slot', '', true, c.sl
          UNION ALL SELECT 'weekday', '', true, c.wd
          UNION ALL SELECT 'place', '', true, c.pl
          UNION ALL SELECT 'series', '', true, c.se
          UNION ALL SELECT 'artist', 'res:' || trim_scale(th)::text, th = v_res, COALESCE(c.ms <= th, false)
            FROM unnest(v_res_all) th
        ) u
       GROUP BY c.tid, u.fam, u.var, u.cur
    ) q
   WHERE q.p > 0 AND q.p < 1
   GROUP BY q.fam, q.var, q.cur;

  -- Comportements : la classe à N prédit-elle la classe à N+1 ?
  WITH cls AS (
    SELECT a.em, a.k,
           CASE WHEN a.has_sale THEN a.lead_h >= v_early END AS early,
           CASE WHEN a.has_sale THEN a.since_launch_h END AS slh,
           CASE WHEN a.has_sale THEN a.lead_h BETWEEN 0 AND v_last END AS last_minute,
           CASE WHEN a.has_sale THEN a.door END AS door,
           CASE WHEN a.has_sale THEN a.order_size >= v_grp END AS grp,
           CASE WHEN a.has_sale THEN a.tbl END AS tbl
      FROM _ana a
  ), pairs AS (
    SELECT u.fam, u.var, u.cur, u.c0, u.c1
      FROM _antr t
      JOIN cls x0 ON x0.em = t.em AND x0.k = t.k0
      JOIN cls x1 ON x1.em = t.em AND x1.k = t.k0 + 1
      CROSS JOIN LATERAL (
        SELECT 'early' AS fam, '' AS var, true AS cur, x0.early AS c0, x1.early AS c1
        UNION ALL SELECT 'last_minute', '', true, x0.last_minute, x1.last_minute
        UNION ALL SELECT 'door', '', true, x0.door, x1.door
        UNION ALL SELECT 'group', '', true, x0.grp, x1.grp
        UNION ALL SELECT 'table', '', true, x0.tbl, x1.tbl
        UNION ALL SELECT 'launch', 'h:' || trim_scale(h)::text, h = v_launch,
                         x0.slh BETWEEN 0 AND h, x1.slh BETWEEN 0 AND h
          FROM unnest(v_launch_all) h
      ) u
  ), base AS (
    SELECT fam, var, avg(c1::int)::numeric AS b FROM pairs WHERE c1 IS NOT NULL GROUP BY 1, 2
  )
  INSERT INTO _anstat
  SELECT p.fam, p.var, p.cur, 'behaviour', sum(p.c1::int), count(*) * b.b, count(*) * b.b * (1 - b.b), count(*)::int, NULL,
         CASE WHEN b.b > 0 AND b.b < 1 THEN (sum(p.c1::int) - count(*) * b.b) / sqrt(count(*) * b.b * (1 - b.b)) END,
         jsonb_build_object('base', round(b.b, 4))
    FROM pairs p JOIN base b ON b.fam = p.fam AND b.var = p.var
   WHERE p.c0 AND p.c1 IS NOT NULL
   GROUP BY p.fam, p.var, p.cur, b.b;

  -- Retour : les nouveaux venus d'il y a plus de 180 jours.
  DROP TABLE IF EXISTS _annw;
  CREATE TEMP TABLE _annw ON COMMIT DROP AS
  SELECT a.em, a.src, a.has_sale, a.invited_only, a.order_size, a.with_returning,
         p.dist_first, p.country, p.main_country,
         EXISTS (SELECT 1 FROM _ana b WHERE b.em = a.em AND b.k = 2 AND b.start_at <= a.start_at + v_ret) AS ret
    FROM _ana a LEFT JOIN _anp p ON p.em = a.em
   WHERE a.k = 1 AND a.start_at <= v_at - v_ret;

  WITH g AS (
    SELECT u.fam, u.var, u.cur, u.g, w.ret
      FROM _annw w
      CROSS JOIN LATERAL (
        SELECT 'discovery' AS fam, '' AS var, true AS cur, (w.has_sale AND w.src = 'sg') AS g
        UNION ALL SELECT 'invited', '', true, w.invited_only
        UNION ALL SELECT 'group_first', '', true, w.has_sale AND w.order_size >= v_grp
        UNION ALL SELECT 'brought', '', true, w.with_returning
        UNION ALL SELECT 'passing', 'km:' || trim_scale(d)::text, d = v_far,
                         -- Sans distance connue, un client du pays principal compte comme
                         -- « pas de passage » (mode réduit : seuls les étrangers sont repérés).
                         CASE WHEN w.country IS NOT NULL AND w.country <> w.main_country THEN true
                              WHEN w.dist_first IS NOT NULL THEN w.dist_first > d
                              WHEN w.country IS NOT NULL THEN false END
          FROM unnest(v_far_all) d
      ) u
     WHERE u.g IS NOT NULL
    UNION ALL
    -- Canal d'arrivée : chaque source contre tous les autres nouveaux venus.
    SELECT 'channel', c.code, true, (CASE WHEN w.invited_only THEN 'gl' ELSE COALESCE(w.src, 'of') END) = c.code, w.ret
      FROM _annw w
      CROSS JOIN (SELECT DISTINCT CASE WHEN invited_only THEN 'gl' ELSE COALESCE(src, 'of') END AS code FROM _annw) c
  ), s AS (
    SELECT fam, var, cur,
           count(*) FILTER (WHERE g) AS n1, count(*) FILTER (WHERE g AND ret) AS o1,
           count(*) FILTER (WHERE NOT g) AS n0, count(*) FILTER (WHERE NOT g AND ret) AS o0
      FROM g GROUP BY 1, 2, 3
  )
  INSERT INTO _anstat
  SELECT s.fam, s.var, s.cur, 'return', s.o1,
         CASE WHEN s.n0 > 0 THEN s.n1 * (s.o0::numeric / s.n0) ELSE 0 END,
         CASE WHEN s.n0 > 0 THEN s.n1 * (s.o0::numeric / s.n0) * (1 - s.o0::numeric / s.n0) ELSE 0 END,
         s.n1::int, s.n0::int,
         CASE WHEN s.n1 > 0 AND s.n0 > 0 AND (s.o1 + s.o0) > 0 AND (s.o1 + s.o0) < (s.n1 + s.n0)
              THEN (s.o1::numeric / s.n1 - s.o0::numeric / s.n0)
                   / sqrt(((s.o1 + s.o0)::numeric / (s.n1 + s.n0)) * (1 - (s.o1 + s.o0)::numeric / (s.n1 + s.n0))
                          * (1.0 / s.n1 + 1.0 / s.n0)) END,
         jsonb_build_object('r1', CASE WHEN s.n1 > 0 THEN round(s.o1::numeric / s.n1, 4) END,
                            'r0', CASE WHEN s.n0 > 0 THEN round(s.o0::numeric / s.n0, 4) END,
                            'returned', s.o1)
    FROM s;

  -- Statut courant de chaque famille (la règle en vigueur ; chaque canal).
  -- D'abord le test de chaque famille, puis (20261014110000) la correction
  -- des tests multiples, la marge anti-bascule, la confirmation sur 2 jours
  -- de calcul complet et « pas de différence nette » pour ce qui le reste.
  DROP TABLE IF EXISTS _anfin;
  CREATE TEMP TABLE _anfin ON COMMIT DROP AS
  WITH fam AS (
    SELECT * FROM (VALUES
      ('artist', 'affinity'), ('genre', 'affinity'), ('format', 'affinity'), ('slot', 'affinity'),
      ('weekday', 'affinity'), ('place', 'affinity'), ('series', 'affinity'),
      ('early', 'behaviour'), ('launch', 'behaviour'), ('last_minute', 'behaviour'), ('door', 'behaviour'),
      ('group', 'behaviour'), ('table', 'behaviour'),
      ('discovery', 'return'), ('passing', 'return'), ('invited', 'return'), ('group_first', 'return'),
      ('brought', 'return')) x(family, kind)
  ), distinct_vals AS (
    -- Une famille d'affinité ne distingue personne quand toutes les soirées
    -- se ressemblent sur ce trait.
    SELECT 'artist' AS family, (SELECT count(DISTINCT ak) FROM _annart) AS d
    UNION ALL SELECT 'genre', (SELECT count(DISTINCT genres) FROM _ann WHERE cardinality(genres) > 0)
    UNION ALL SELECT 'format', (SELECT count(DISTINCT fmt) FROM _ann)
    UNION ALL SELECT 'slot', (SELECT count(DISTINCT slot) FROM _ann)
    UNION ALL SELECT 'weekday', (SELECT count(DISTINCT wd) FROM _ann)
    UNION ALL SELECT 'place', (SELECT count(DISTINCT place_key) FROM _ann)
    UNION ALL SELECT 'series', (SELECT count(DISTINCT series) FROM _ann)
  ), rows AS (
    SELECT f.family, '' AS variant, f.kind, s.o, s.e, s.v, s.n, s.n0, s.z, s.detail
      FROM fam f LEFT JOIN _anstat s ON s.family = f.family AND s.is_cur
    UNION ALL
    SELECT s.family, s.variant, 'return', s.o, s.e, s.v, s.n, s.n0, s.z, s.detail
      FROM _anstat s WHERE s.family = 'channel'
  )
  SELECT r.*,
           CASE
             WHEN COALESCE(v_cov->'families'->>(CASE r.family WHEN 'group_first' THEN 'group' ELSE r.family END), 'ok') = 'unavailable' THEN 'unavailable'
             WHEN r.kind = 'affinity' AND COALESCE((SELECT d FROM distinct_vals dv WHERE dv.family = r.family), 0) < 2 THEN 'uniform'
             WHEN r.kind = 'behaviour' AND COALESCE((r.detail->>'base')::numeric, 0) IN (0, 1) AND r.n > 0 THEN 'uniform'
             ELSE COALESCE(NULLIF(v_cov->'families'->>(CASE r.family WHEN 'group_first' THEN 'group' ELSE r.family END), ''), 'ok') END AS availability,
           public._crm_an_status(r.kind, COALESCE(r.o, 0), COALESCE(r.e, 0), COALESCE(r.v, 0), COALESCE(r.n, 0),
                                 r.n0, r.z, p_cfg) AS raw,
         public._crm_an_pvalue(r.kind, COALESCE(r.o, 0), COALESCE(r.e, 0), r.z) AS pv,
         CASE WHEN COALESCE(r.e, 0) > 0 THEN r.o / r.e END AS gain,
         false AS tested, false AS bh_pass, 0 AS prev_runs, NULL::timestamptz AS prev_flat, NULL::date AS prev_day,
         false AS cand, 0 AS runs, NULL::timestamptz AS flat_since, NULL::text AS status
    FROM rows r;

  UPDATE _anfin SET tested = availability NOT IN ('unavailable', 'uniform') AND raw <> 'untested';
  -- Benjamini-Hochberg (taux de fausses découvertes status.fdr) sur toutes les
  -- familles testées du compte : la plus grande p-valeur p(k) ≤ k/m·q, et
  -- tout ce qui est en dessous passe.
  SELECT max(t.pv) INTO v_bh
    FROM (SELECT pv, row_number() OVER (ORDER BY pv) AS k, count(*) OVER () AS m
            FROM _anfin WHERE tested AND pv IS NOT NULL) t
   WHERE t.pv <= t.k::numeric / t.m * v_fdr;
  UPDATE _anfin SET bh_pass = tested AND pv IS NOT NULL AND pv <= COALESCE(v_bh, -1);
  -- L'état précédent, sous la même règle seulement.
  UPDATE _anfin f SET prev_runs = c.supported_runs, prev_flat = c.flat_since, prev_day = c.computed_at::date
    FROM public.crm_family_status c
   WHERE c.scope_key = v_key AND c.family = f.family AND c.variant = f.variant AND c.rules_version = v_ver;
  -- Candidate (au moins status.min_e cas attendus) : confirmée par le test
  -- corrigé ; ou déjà candidate et tient un seuil plus bas (marge anti-bascule : un statut ne bascule pas d'un jour à
  -- l'autre pour un dixième de z).
  UPDATE _anfin SET cand = tested AND COALESCE(e, 0) >= v_min_e AND (
      (raw = 'supported' AND bh_pass)
      OR (prev_runs > 0 AND CASE WHEN kind = 'return'
            THEN COALESCE(abs(gain - 1), 0) >= v_gap_hold AND abs(COALESCE(z, 0)) >= v_z_hold
            ELSE COALESCE(gain, 0) >= v_gain_hold AND COALESCE(z, 0) >= v_z_hold END));
  -- Jours de calcul complet consécutifs comme candidate (un recalcul le même
  -- jour ne compte pas deux fois).
  UPDATE _anfin SET
    runs = CASE WHEN NOT cand THEN 0
                WHEN prev_day = current_date THEN GREATEST(prev_runs, 1)
                ELSE prev_runs + 1 END,
    flat_since = CASE WHEN tested AND NOT cand AND raw IN ('supported', 'inconclusive') THEN COALESCE(prev_flat, now()) END;
  UPDATE _anfin SET status = CASE
      WHEN availability IN ('unavailable', 'uniform') THEN 'untested'
      WHEN cand AND runs >= v_confirm THEN 'supported'
      -- Confirmée une fois : elle attend le calcul suivant (« à tester »).
      WHEN cand THEN 'inconclusive'
      -- Non concluante depuis des mois, avec de quoi juger : « pas de
      -- différence nette sur votre compte » (décision de Paul, 08/10).
      WHEN flat_since IS NOT NULL AND flat_since <= now() - make_interval(days => v_flat_days)
           AND COALESCE(n, 0) >= v_flat_n THEN 'not_supported'
      WHEN raw = 'supported' THEN 'inconclusive'
      ELSE raw END;

  INSERT INTO public.crm_family_status AS cur (
    scope_key, venue_id, organizer_user_id, family, variant, kind, availability, status, o, e, v, n,
    gain, z, direction, detail, rules_version, computed_at, status_since, supported_runs, flat_since)
  SELECT v_key, p_venue_id, p_organizer_user_id, f.family, f.variant, f.kind, f.availability,
         f.status,
         COALESCE(f.o, 0), COALESCE(f.e, 0), COALESCE(f.v, 0), COALESCE(f.n, 0),
         CASE WHEN COALESCE(f.e, 0) > 0 THEN round(f.o / f.e, 3) END,
         round(f.z, 3),
         CASE WHEN f.kind = 'return' AND COALESCE(f.e, 0) > 0 THEN CASE WHEN f.o >= f.e THEN 'more' ELSE 'less' END END,
         COALESCE(f.detail, '{}'::jsonb) || jsonb_build_object('n0', f.n0, 'p', round(f.pv, 6), 'bh', f.bh_pass),
         v_ver, now(), now(), f.runs, f.flat_since
    FROM _anfin f
  ON CONFLICT (scope_key, family, variant) DO UPDATE SET
    kind = EXCLUDED.kind, availability = EXCLUDED.availability, status = EXCLUDED.status,
    o = EXCLUDED.o, e = EXCLUDED.e, v = EXCLUDED.v, n = EXCLUDED.n, gain = EXCLUDED.gain, z = EXCLUDED.z,
    direction = EXCLUDED.direction, detail = EXCLUDED.detail, rules_version = EXCLUDED.rules_version,
    computed_at = EXCLUDED.computed_at, supported_runs = EXCLUDED.supported_runs, flat_since = EXCLUDED.flat_since,
    status_since = CASE WHEN cur.status = EXCLUDED.status AND cur.rules_version = EXCLUDED.rules_version
                        THEN cur.status_since ELSE now() END;

  -- Un canal qui n'a plus de nouveaux venus sort de la liste.
  DELETE FROM public.crm_family_status s
   WHERE s.scope_key = v_key AND s.computed_at < now() - interval '1 second'
     AND NOT EXISTS (SELECT 1 FROM _anstat a WHERE a.family = s.family
                       AND (a.variant = s.variant OR (s.variant = '' AND a.is_cur)))
     AND s.family = 'channel';

  INSERT INTO public.crm_family_status_history AS h (
    scope_key, venue_id, organizer_user_id, family, variant, rules_version, computed_on, status, o, e, v, n)
  SELECT s.scope_key, s.venue_id, s.organizer_user_id, s.family, s.variant, s.rules_version, current_date,
         s.status, s.o, s.e, s.v, s.n
    FROM public.crm_family_status s WHERE s.scope_key = v_key
  ON CONFLICT (scope_key, family, variant, rules_version, computed_on) DO UPDATE SET
    status = EXCLUDED.status, o = EXCLUDED.o, e = EXCLUDED.e, v = EXCLUDED.v, n = EXCLUDED.n;
  DELETE FROM public.crm_family_status_history WHERE scope_key = v_key AND computed_on < current_date - 400;

  -- Lot E : contribution anonyme aux leçons communes (no-op tant que le lot
  -- E n'est pas là ou que le drapeau global est éteint).
  PERFORM public._crm_an_contribute(p_venue_id, p_organizer_user_id, p_cfg);

  SELECT jsonb_build_object(
           'transitions', (SELECT count(*) FROM _antr),
           'choices', (SELECT count(*) FROM _anch),
           'newcomers_180', (SELECT count(*) FROM _annw),
           'supported', count(*) FILTER (WHERE status = 'supported'),
           'not_supported', count(*) FILTER (WHERE status = 'not_supported'),
           'untested', count(*) FILTER (WHERE status IN ('untested', 'inconclusive')))
    INTO v_out FROM public.crm_family_status WHERE scope_key = v_key;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_engine(text, uuid, timestamptz, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_engine(text, uuid, timestamptz, jsonb, boolean) TO service_role;
