-- ============================================================================
-- Yuno CRM — analyse client, lot C : le moteur d'hypothèses (2026-10-07).
-- Plan : docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md §13, consignes :
-- docs/designs/CRM_CLIENT_ANALYSIS_PROMPT.md §4 lot C.
--
-- On n'affirme jamais : on TESTE. Tout est en SQL, déterministe, rejouable,
-- sans IA. Trois familles de tests, par compte :
--
-- AFFINITÉ (artiste, genre, format, créneau, jour, lieu, série). Pour chaque
--   revenant, à chaque passage d'une soirée N à la suivante N+1 : les soirées
--   « au choix » sont celles qui commencent après N et étaient en vente avant
--   l'achat de N+1 (N+1 comprise). p = part de ces soirées qui partagent le
--   trait avec ce qu'il avait vu JUSQU'À N (rareté des artistes à la date de
--   N : pas de triche avec le futur) ; o = 1 si N+1 le partage. Seuls
--   comptent les passages où au moins une soirée partageait le trait et une
--   ne le partageait pas (0 < p < 1).
--   O = Σo, E = Σp, V = Σp(1−p), gain = O/E, z = (O−E)/√V.
-- COMPORTEMENT (anticipe, 1res heures de vente, dernière minute, à la porte,
--   à plusieurs, table) : même calcul, p = part de la classe sur l'ensemble
--   des achats N+1, pour les passages où la classe était vraie à N.
-- RETOUR (découverte Shotgun, de passage, invité, 1re commande à plusieurs,
--   amené par un client déjà venu, canal d'arrivée) : taux de retour à 180
--   jours du groupe contre les autres nouveaux venus, sur les 1res soirées de
--   plus de 180 jours. O = revenus du groupe, E = n × taux des autres.
--
-- Statuts (seuils dans crm_analysis_config) :
--   untested       pas assez de recul (n < 30) — « à tester » ;
--   supported      confirmée sur ce compte (gain ≥ 1,3 et z ≥ 2 ; retour :
--                  écart ≥ 30 % et |z| ≥ 2) ;
--   not_supported  testée, pas confirmée (gain < 1,1 ou z < 1) ;
--   inconclusive   entre les deux — affichée « à tester ».
--   (`prior_only`, « observée sur d'autres comptes Yuno », se décide à
--   l'affichage, lot E.)
-- Disponibilité : ok | reduced | unavailable (la billetterie ne rend pas la
-- matière, lot A) | uniform (toutes les soirées du compte pareilles : la
-- famille ne distingue personne, éteinte et dite en une ligne).
--
-- Tables d'AGRÉGATS, sans aucune donnée personnelle :
--   crm_family_status          statut courant par (compte, famille, variante) ;
--   crm_family_status_history  une ligne par jour de calcul complet : « confirmée
--                              depuis août », et matière du lot E.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_family_status (
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  family            text NOT NULL,
  -- '' = la règle en vigueur ; pour `channel`, le code de la source.
  variant           text NOT NULL DEFAULT '',
  kind              text NOT NULL CHECK (kind IN ('affinity', 'behaviour', 'return')),
  availability      text NOT NULL CHECK (availability IN ('ok', 'reduced', 'unavailable', 'uniform')),
  status            text NOT NULL CHECK (status IN ('untested', 'supported', 'not_supported', 'inconclusive')),
  o                 numeric NOT NULL DEFAULT 0,
  e                 numeric NOT NULL DEFAULT 0,
  v                 numeric NOT NULL DEFAULT 0,
  n                 integer NOT NULL DEFAULT 0,
  gain              numeric,
  z                 numeric,
  direction         text CHECK (direction IN ('more', 'less')),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_version     integer NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  -- Premier calcul complet où la famille est passée à son statut actuel.
  status_since      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, family, variant)
);
ALTER TABLE public.crm_family_status ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_family_status_history (
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  family            text NOT NULL,
  variant           text NOT NULL DEFAULT '',
  rules_version     integer NOT NULL,
  computed_on       date NOT NULL,
  status            text NOT NULL,
  o                 numeric NOT NULL,
  e                 numeric NOT NULL,
  v                 numeric NOT NULL,
  n                 integer NOT NULL,
  PRIMARY KEY (scope_key, family, variant, rules_version, computed_on)
);
ALTER TABLE public.crm_family_status_history ENABLE ROW LEVEL SECURITY;
-- Aucune policy : écrites par le moteur, lues par les RPC gardées (lot D).

-- ── 1. Le statut d'un test ──────────────────────────────────────────────────
-- p_n0 : taille du groupe de comparaison (retour seulement).
CREATE OR REPLACE FUNCTION public._crm_an_status(p_kind text, p_o numeric, p_e numeric, p_v numeric,
                                                 p_n integer, p_n0 integer, p_z numeric, p_cfg jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_kind = 'return' THEN CASE
      WHEN COALESCE(p_n, 0) < COALESCE((p_cfg->'return'->>'min_n')::int, 30)
        OR COALESCE(p_n0, 0) < COALESCE((p_cfg->'return'->>'min_n')::int, 30)
        OR COALESCE(p_e, 0) <= 0 OR p_z IS NULL THEN 'untested'
      WHEN abs(p_o / p_e - 1) >= COALESCE((p_cfg->'return'->>'gap')::numeric, 0.3)
        AND abs(p_z) >= COALESCE((p_cfg->'return'->>'z')::numeric, 2) THEN 'supported'
      WHEN abs(p_o / p_e - 1) < 0.1 OR abs(p_z) < COALESCE((p_cfg->'status'->>'z_not')::numeric, 1) THEN 'not_supported'
      ELSE 'inconclusive' END
    ELSE CASE
      WHEN COALESCE(p_n, 0) < COALESCE((p_cfg->'status'->>'min_n')::int, 30)
        OR COALESCE(p_e, 0) <= 0 OR COALESCE(p_v, 0) <= 0 THEN 'untested'
      WHEN p_o / p_e >= COALESCE((p_cfg->'status'->>'gain_supported')::numeric, 1.3)
        AND (p_o - p_e) / sqrt(p_v) >= COALESCE((p_cfg->'status'->>'z_supported')::numeric, 2) THEN 'supported'
      WHEN p_o / p_e < COALESCE((p_cfg->'status'->>'gain_not')::numeric, 1.1)
        OR (p_o - p_e) / sqrt(p_v) < COALESCE((p_cfg->'status'->>'z_not')::numeric, 1) THEN 'not_supported'
      ELSE 'inconclusive' END
  END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_status(text, numeric, numeric, numeric, integer, integer, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_an_status(text, numeric, numeric, numeric, integer, integer, numeric, jsonb) TO authenticated, service_role;

-- ── 2. Le moteur : statistiques de chaque famille ───────────────────────────
-- Lit les tables de _crm_an_load (et _ancov, posée par crm_analysis_compute).
-- Une passe complète seulement. Calcule aussi les VARIANTES de seuil de la
-- grille (rareté, 1res heures de vente, distance) : matière du lot E, jamais
-- montrée telle quelle.
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
  ), fin AS (
    SELECT r.*,
           CASE
             WHEN COALESCE(v_cov->'families'->>(CASE r.family WHEN 'group_first' THEN 'group' ELSE r.family END), 'ok') = 'unavailable' THEN 'unavailable'
             WHEN r.kind = 'affinity' AND COALESCE((SELECT d FROM distinct_vals dv WHERE dv.family = r.family), 0) < 2 THEN 'uniform'
             WHEN r.kind = 'behaviour' AND COALESCE((r.detail->>'base')::numeric, 0) IN (0, 1) AND r.n > 0 THEN 'uniform'
             ELSE COALESCE(NULLIF(v_cov->'families'->>(CASE r.family WHEN 'group_first' THEN 'group' ELSE r.family END), ''), 'ok') END AS availability,
           public._crm_an_status(r.kind, COALESCE(r.o, 0), COALESCE(r.e, 0), COALESCE(r.v, 0), COALESCE(r.n, 0),
                                 r.n0, r.z, p_cfg) AS status
      FROM rows r
  )
  INSERT INTO public.crm_family_status AS cur (
    scope_key, venue_id, organizer_user_id, family, variant, kind, availability, status, o, e, v, n,
    gain, z, direction, detail, rules_version, computed_at, status_since)
  SELECT v_key, p_venue_id, p_organizer_user_id, f.family, f.variant, f.kind, f.availability,
         CASE WHEN f.availability IN ('unavailable', 'uniform') THEN 'untested' ELSE f.status END,
         COALESCE(f.o, 0), COALESCE(f.e, 0), COALESCE(f.v, 0), COALESCE(f.n, 0),
         CASE WHEN COALESCE(f.e, 0) > 0 THEN round(f.o / f.e, 3) END,
         round(f.z, 3),
         CASE WHEN f.kind = 'return' AND COALESCE(f.e, 0) > 0 THEN CASE WHEN f.o >= f.e THEN 'more' ELSE 'less' END END,
         COALESCE(f.detail, '{}'::jsonb) || jsonb_build_object('n0', f.n0),
         v_ver, now(), now()
    FROM fin f
  ON CONFLICT (scope_key, family, variant) DO UPDATE SET
    kind = EXCLUDED.kind, availability = EXCLUDED.availability, status = EXCLUDED.status,
    o = EXCLUDED.o, e = EXCLUDED.e, v = EXCLUDED.v, n = EXCLUDED.n, gain = EXCLUDED.gain, z = EXCLUDED.z,
    direction = EXCLUDED.direction, detail = EXCLUDED.detail, rules_version = EXCLUDED.rules_version,
    computed_at = EXCLUDED.computed_at,
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

-- Point d'accroche du lot E.
CREATE OR REPLACE FUNCTION public._crm_an_contribute(p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb)
RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
REVOKE ALL ON FUNCTION public._crm_an_contribute(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_contribute(text, uuid, jsonb) TO service_role;

-- ── 3. Les hypothèses d'une personne ────────────────────────────────────────
-- Remplit _anpp.hyps (personnes de _antg) : pour chaque famille dont la
-- matière existe chez elle, une force tirée de SES faits (fort 3, moyen 2,
-- faible 1), une clé de preuve et ses paramètres (texte traduit au front).
-- Venu une seule fois : jamais au-dessus de « moyen ». Une famille éteinte
-- sur le compte (indisponible ou uniforme) ne produit rien. Le statut de la
-- famille se lit à l'affichage, jamais copié ici.
CREATE OR REPLACE FUNCTION public._crm_an_fill_hyps(p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_res numeric := COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_minb int := COALESCE((p_cfg->'rarity'->>'min_nights')::int, 5);
  v_l72 numeric := COALESCE((p_cfg->'line_up_medium'->>'launch_hours')::numeric, 72);
  v_gs numeric := COALESCE((p_cfg->'taste'->>'genre_share')::numeric, 0.6);
  v_fs numeric := COALESCE((p_cfg->'taste'->>'format_share')::numeric, 0.7);
  v_min int := COALESCE((p_cfg->>'min_sample')::int, 10);
  v_med numeric;
  v_group_mode text;
BEGIN
  BEGIN
    SELECT cov->'families'->>'group' INTO v_group_mode FROM _ancov LIMIT 1;
  EXCEPTION WHEN undefined_table THEN v_group_mode := NULL;
  END;

  -- Part de nouveaux d'une soirée « habituelle » (médiane, soirées de 10
  -- entrées et plus).
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY z.ns) INTO v_med
    FROM (SELECT count(*) FILTER (WHERE k = 1)::numeric / count(*) AS ns
            FROM _ana GROUP BY nid HAVING count(*) >= v_min) z;

  DROP TABLE IF EXISTS _anhy;
  CREATE TEMP TABLE _anhy (em text, f text, s smallint, k text, p jsonb) ON COMMIT DROP;

  -- Line-up : le même artiste RARE (pas un résident à la date) revu, à des
  -- séries différentes = fort ; revu dans la même série = moyen ; vu une
  -- fois = faible.
  WITH me AS (SELECT a.* FROM _ana a JOIN _antg g ON g.em = a.em),
  art AS (
    SELECT m.em, y.ak,
           (array_agg(y.name ORDER BY m.start_at DESC) FILTER (WHERE y.name IS NOT NULL))[1] AS name,
           count(DISTINCT m.nid) AS rare_n, count(DISTINCT m.series) AS rare_series
      FROM me m JOIN _annart y ON y.nid = m.nid
      JOIN _anrar r ON r.nid = m.nid AND r.ak = y.ak
     WHERE NOT (r.base >= v_minb AND r.share > v_res)
     GROUP BY m.em, y.ak
  ), best AS (
    SELECT DISTINCT ON (em) * FROM art ORDER BY em, rare_n DESC, rare_series DESC, name
  )
  INSERT INTO _anhy
  SELECT b.em, 'artist',
         CASE WHEN b.rare_n >= 2 AND b.rare_series >= 2 THEN 3 WHEN b.rare_n >= 2 THEN 2 ELSE 1 END,
         CASE WHEN b.rare_n >= 2 AND b.rare_series >= 2 THEN 'artist.repeat'
              WHEN b.rare_n >= 2 THEN 'artist.repeat_series' ELSE 'artist.rare_seen' END,
         jsonb_build_object('artist', b.name, 'n', b.rare_n, 'series', b.rare_series)
    FROM best b WHERE b.name IS NOT NULL;

  -- Line-up, 1re venue : une tête d'affiche rare, une place prise dans les 72 h
  -- après la mise en vente, une soirée qui a recruté plus de nouveaux que
  -- d'habitude = moyen.
  INSERT INTO _anhy
  SELECT a.em, 'artist', 2, 'artist.first_rare',
         jsonb_build_object('artist', y.name, 'hours', round(a.since_launch_h::numeric))
    FROM _ana a JOIN _antg g ON g.em = a.em
    JOIN LATERAL (
      SELECT y.name FROM _annart y JOIN _anrar r ON r.nid = y.nid AND r.ak = y.ak
       WHERE y.nid = a.nid AND y.name IS NOT NULL AND NOT (r.base >= v_minb AND r.share > v_res)
       ORDER BY r.share, y.name LIMIT 1) y ON true
   WHERE a.k = 1 AND a.since_launch_h BETWEEN 0 AND v_l72 AND v_med IS NOT NULL
     AND (SELECT count(*) FILTER (WHERE b.k = 1)::numeric / count(*) FROM _ana b WHERE b.nid = a.nid) > v_med;

  -- Musique : genre dominant (BRUT, tel que Shotgun le rend).
  WITH me AS (SELECT a.* FROM _ana a JOIN _antg g ON g.em = a.em),
  gen AS (
    SELECT m.em, g AS v, count(*) AS n FROM me m JOIN _ann n ON n.nid = m.nid CROSS JOIN LATERAL unnest(n.genres) g GROUP BY 1, 2
  ), tot AS (
    SELECT m.em, count(*) AS n FROM me m JOIN _ann n ON n.nid = m.nid WHERE cardinality(n.genres) > 0 GROUP BY 1
  ), top AS (SELECT DISTINCT ON (em) * FROM gen ORDER BY em, n DESC, v)
  INSERT INTO _anhy
  SELECT t.em, 'genre', x.s, CASE WHEN x.s = 1 THEN 'genre.single' ELSE 'genre.dominant' END,
         jsonb_build_object('genre', t.v, 'n', t.n, 'of', o.n)
    FROM top t JOIN tot o ON o.em = t.em
    CROSS JOIN LATERAL (SELECT CASE WHEN o.n >= 3 AND t.n::numeric / o.n >= v_gs THEN 3
                                    WHEN o.n >= 2 AND t.n::numeric / o.n >= v_gs THEN 2
                                    WHEN o.n = 1 THEN 1 END AS s) x
   WHERE x.s IS NOT NULL;

  -- Format, créneau, jour, lieu : préférence nette sur 2 soirées ou plus.
  WITH me AS (SELECT a.* FROM _ana a JOIN _antg g ON g.em = a.em),
  tr AS (
    SELECT m.em, 'format' AS f, n.fmt AS v FROM me m JOIN _ann n ON n.nid = m.nid WHERE n.fmt IS NOT NULL
    UNION ALL SELECT m.em, 'slot', n.slot FROM me m JOIN _ann n ON n.nid = m.nid WHERE n.slot IS NOT NULL
    UNION ALL SELECT m.em, 'weekday', n.wd::text FROM me m JOIN _ann n ON n.nid = m.nid
    UNION ALL SELECT m.em, 'place', n.place_key FROM me m JOIN _ann n ON n.nid = m.nid WHERE n.place_key IS NOT NULL
  ), c AS (
    SELECT em, f, v, count(*) AS n, sum(count(*)) OVER (PARTITION BY em, f) AS tot FROM tr GROUP BY 1, 2, 3
  ), top AS (SELECT DISTINCT ON (em, f) * FROM c ORDER BY em, f, n DESC, v)
  INSERT INTO _anhy
  SELECT t.em, t.f, CASE WHEN t.tot >= 4 THEN 3 ELSE 2 END, t.f || '.dominant',
         jsonb_build_object('value', t.v, 'n', t.n, 'of', t.tot)
    FROM top t WHERE t.tot >= 2 AND t.n::numeric / t.tot >= v_fs;

  -- Le concept : plusieurs éditions d'une même série ; avec des line-ups
  -- différents, c'est la soirée qui le fait venir, pas un artiste.
  WITH me AS (SELECT a.* FROM _ana a JOIN _antg g ON g.em = a.em),
  ser AS (
    SELECT m.em, m.series AS v, count(*) AS n,
           count(DISTINCT array_to_string(n.arts, '|')) FILTER (WHERE cardinality(n.arts) > 0) AS lineups
      FROM me m JOIN _ann n ON n.nid = m.nid WHERE m.series IS NOT NULL GROUP BY 1, 2
  ), top AS (SELECT DISTINCT ON (em) * FROM ser ORDER BY em, n DESC, lineups DESC, v)
  INSERT INTO _anhy
  SELECT t.em, 'series', CASE WHEN t.lineups >= 2 THEN 3 ELSE 2 END,
         CASE WHEN t.lineups >= 2 THEN 'series.lineups' ELSE 'series.same' END,
         jsonb_build_object('series', t.v, 'n', t.n, 'lineups', t.lineups)
    FROM top t WHERE t.n >= 2;

  -- Profil d'achat (anticipe, 1res heures de vente, dernière minute, porte),
  -- à plusieurs, table : classes des venues PAYÉES (_anbuy).
  WITH b AS (
    SELECT em,
           count(*) FILTER (WHERE early IS NOT NULL) AS n,
           count(*) FILTER (WHERE early) AS early,
           count(*) FILTER (WHERE launch IS NOT NULL) AS ln,
           count(*) FILTER (WHERE launch) AS launch,
           count(*) FILTER (WHERE last_minute) AS last_minute,
           count(*) FILTER (WHERE door) AS door,
           count(*) FILTER (WHERE grp) AS grp,
           count(*) FILTER (WHERE tbl) AS tbl
      FROM _anbuy GROUP BY 1
  ), u AS (
    SELECT b.em, x.f, x.cnt, x.of
      FROM b CROSS JOIN LATERAL (VALUES
        ('early', b.early, b.n), ('launch', b.launch, b.ln), ('last_minute', b.last_minute, b.n),
        ('door', b.door, b.n), ('group', b.grp, b.n)) x(f, cnt, of)
     WHERE x.of > 0 AND x.cnt > 0
  )
  INSERT INTO _anhy
  SELECT u.em, u.f,
         CASE WHEN u.cnt >= 3 AND u.cnt::numeric / u.of >= 0.6 THEN 3
              WHEN u.cnt >= 2 AND u.cnt::numeric / u.of >= 0.6 THEN 2
              ELSE 1 END,
         CASE WHEN u.f = 'group' THEN CASE WHEN COALESCE(v_group_mode, 'ok') = 'reduced' THEN 'group.buys_for' ELSE 'group.with' END
              ELSE 'buy.' || u.f END,
         jsonb_build_object('n', u.cnt, 'of', u.of)
    FROM u
   WHERE (u.cnt::numeric / u.of >= 0.6) OR u.of = 1;

  INSERT INTO _anhy
  SELECT b.em, 'table', CASE WHEN count(*) FILTER (WHERE b.tbl) >= 2 THEN 3 ELSE 2 END, 'table.seat',
         jsonb_build_object('n', count(*) FILTER (WHERE b.tbl))
    FROM _anbuy b GROUP BY b.em HAVING count(*) FILTER (WHERE b.tbl) > 0;

  -- Les faits de la 1re venue : amené par un client déjà venu, découverte dans
  -- l'appli Shotgun, invitation, canal d'arrivée.
  INSERT INTO _anhy
  SELECT a.em, x.f, x.s, x.k, x.p
    FROM _ana a JOIN _antg g ON g.em = a.em
    CROSS JOIN LATERAL (VALUES
      ('brought', 2::smallint, 'brought.first', '{}'::jsonb, a.with_returning),
      ('discovery', 2::smallint, 'discovery.first', '{}'::jsonb, a.has_sale AND a.src = 'sg'),
      ('invited', 2::smallint, 'invited.first', '{}'::jsonb, a.invited_only),
      ('channel', 1::smallint, 'channel.first',
         jsonb_build_object('src', CASE WHEN a.invited_only THEN 'gl' ELSE a.src END),
         a.invited_only OR a.src IS NOT NULL)
    ) x(f, s, k, p, ok)
   WHERE a.k = 1 AND x.ok;

  -- De passage : une seule soirée, et loin (ou de l'étranger).
  INSERT INTO _anhy
  SELECT p.em, 'passing', 2,
         CASE WHEN p.country IS NOT NULL AND p.country <> p.main_country THEN 'passing.foreign' ELSE 'passing.far' END,
         jsonb_build_object('country', p.country, 'km', p.dist_first)
    FROM _anp p JOIN _anpp pp ON pp.em = p.em
   WHERE p.passing AND pp.nights = 1;

  -- Venu une seule fois : jamais au-dessus de « moyen ».
  UPDATE _anhy h SET s = 2 FROM _anpp p WHERE p.em = h.em AND p.nights = 1 AND h.s > 2;

  -- Une famille éteinte sur le compte ne parle pas.
  DELETE FROM _anhy h USING public.crm_family_status fs
   WHERE fs.scope_key = v_key AND fs.family = h.f AND fs.variant = ''
     AND fs.availability IN ('unavailable', 'uniform');

  UPDATE _anpp p SET
    hyps = h.arr,
    tags = ARRAY(SELECT DISTINCT x FROM unnest(p.tags || h.htags) x ORDER BY 1)
    FROM (
      SELECT z.em,
             jsonb_agg(jsonb_build_object('f', z.f, 's', CASE z.s WHEN 3 THEN 'strong' WHEN 2 THEN 'medium' ELSE 'weak' END,
                                          'k', z.k, 'p', z.p)
                       ORDER BY z.s DESC, (fs.status = 'supported') DESC NULLS LAST,
                                array_position(ARRAY['artist', 'series', 'genre', 'brought', 'group', 'launch', 'early',
                                                     'last_minute', 'door', 'table', 'format', 'slot', 'weekday', 'place',
                                                     'discovery', 'invited', 'passing', 'channel'], z.f)) AS arr,
             COALESCE(array_agg('h:' || z.f) FILTER (WHERE z.s >= 2), '{}'::text[]) AS htags
        FROM (SELECT DISTINCT ON (em, f) * FROM _anhy ORDER BY em, f, s DESC, k) z
        LEFT JOIN public.crm_family_status fs ON fs.scope_key = v_key AND fs.family = z.f AND fs.variant = ''
       GROUP BY z.em
    ) h
   WHERE p.em = h.em;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_fill_hyps(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_fill_hyps(text, uuid, jsonb) TO service_role;
