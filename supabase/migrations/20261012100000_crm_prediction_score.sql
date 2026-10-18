-- ============================================================================
-- Yuno CRM — « Chances de venir » : le score de prédiction (2026-10-07).
-- Plan : docs/designs/CRM_PREDICTION_SCORE_PLAN.md. Décisions de Paul : une
-- étiquette (élevées / moyennes / faibles) et ses raisons sur la fiche, jamais
-- un pourcentage ; nom « Chances de venir » ; projection de remplissage visible
-- du super admin seulement au début ; on prédit les VENTES (pas les invitations).
--
-- La question : pour une personne DÉJÀ VENUE et une soirée en vente, la chance
-- qu'elle prenne une place. Les nouveaux (jamais venus) sont hors du modèle.
--
-- Le modèle : une régression logistique par compte, pénalisée (L2), ajustée
-- par la méthode de Newton (IRLS) entièrement en SQL, chaque nuit. Douze
-- facteurs lisibles, calculés avec ce que la personne avait vu AVANT
-- l'ouverture de la vente de la soirée (jamais le futur) :
--   rec      log(1 + jours entre sa dernière soirée et celle-ci)
--   freq     log(1 + soirées sur les 12 mois d'avant)
--   series   log(1 + éditions du même concept déjà faites)
--   artist   log(1 + fois où il a vu l'artiste INVITÉ (non résident) du
--            line-up qu'il a vu le plus souvent)
--   genre    part de ses soirées qui partagent un genre avec celle-ci
--   fmt      même format que sa soirée la plus fréquente
--   slot     même créneau          wd   même jour de la semaine
--   early    part de ses achats faits tôt (≥ buy.early_days)
--   last     part de ses achats de dernière minute (≤ buy.last_minute_hours)
--   far      « de passage » (étranger ou loin)
--   disc     arrivé par une découverte Shotgun
--
-- Données : les soirées passées des 12 derniers mois ; les 4 plus récentes
-- sont TENUES À L'ÉCART pour la validation. Achats gardés, non-achats
-- échantillonnés (score.neg_sample, déterministe par empreinte) et repondérés :
-- les probabilités restent calibrées.
--
-- Portes (score.*) : AUC ≥ auc_min sur les soirées tenues à l'écart, meilleure
-- que le modèle naïf (récence + fréquence) d'au moins auc_gain, calibration
-- (ECE) ≤ ece_max, au moins min_pos_train achats appris et min_pos_valid
-- achats de validation. Sinon : pas de score (status = 'insufficient' ou
-- 'weak'), et l'écran le dit.
--
-- Tables sans aucune policy (lues par les RPC gardées) :
--   crm_score_model         un modèle par compte, ses métriques ;
--   crm_person_night_score  la chance de chaque personne déjà venue, sans
--                           place, d'acheter D'ICI la soirée (corrigée de la
--                           part des achats déjà passée), son étiquette et
--                           ses 3 raisons ;
--   crm_score_night         par soirée à venir, cette part restante.
-- Le droit d'opposition (crm_profile_optouts) retire la personne du calcul et
-- efface ses scores. Jamais dans un export, jamais dans l'apprentissage commun.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 0. Réglages ──────────────────────────────────────────────────────────────
UPDATE public.crm_analysis_rules
   SET config = config || jsonb_build_object('score', '{
     "months": 12, "holdout_nights": 4, "min_train_nights": 8,
     "neg_sample": 0.2, "l2": 1.0, "iterations": 12,
     "auc_min": 0.70, "auc_gain": 0.02, "ece_max": 0.05,
     "min_pos_train": 200, "min_pos_valid": 50,
     "high": 0.30, "medium": 0.10
   }'::jsonb)
 WHERE NOT (config ? 'score');

-- ── 1. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_score_model (
  scope_key         text PRIMARY KEY,
  venue_id          text,
  organizer_user_id uuid,
  status            text NOT NULL CHECK (status IN ('ok', 'weak', 'insufficient', 'failed')),
  features          text[],
  mean              float8[],
  sd                float8[],
  beta              float8[],
  metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
  trained_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_score_model ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_score_model FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_person_night_score (
  scope_key   text NOT NULL,
  event_id    uuid NOT NULL,
  email       text NOT NULL,
  p           real NOT NULL,
  label       text NOT NULL CHECK (label IN ('high', 'medium', 'low')),
  reasons     text[] NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, event_id, email)
);
CREATE INDEX IF NOT EXISTS crm_person_night_score_email ON public.crm_person_night_score (scope_key, email);

-- Par soirée à venir : la part des achats qui reste à venir d'ici la soirée,
-- mesurée sur l'historique du compte (délai achat → soirée des ventes passées).
-- À la veille d'une soirée, l'essentiel des achats a déjà eu lieu.
CREATE TABLE IF NOT EXISTS public.crm_score_night (
  scope_key       text NOT NULL,
  event_id        uuid NOT NULL,
  remaining_share real NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, event_id)
);
ALTER TABLE public.crm_score_night ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_score_night FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_person_night_score ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_person_night_score FROM PUBLIC, anon, authenticated;

-- ── 2. Algèbre : résoudre A x = b (Gauss-Jordan, pivot partiel) ─────────────
CREATE OR REPLACE FUNCTION public._crm_solve(p_a float8[], p_b float8[], p_n integer)
 RETURNS float8[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  a float8[] := p_a;   -- matrice n×n à plat (ligne i, colonne j = (i-1)*n + j)
  b float8[] := p_b;
  i integer; j integer; k integer; piv integer; m float8; t float8;
BEGIN
  FOR k IN 1..p_n LOOP
    piv := k;
    FOR i IN k + 1..p_n LOOP
      IF abs(a[(i - 1) * p_n + k]) > abs(a[(piv - 1) * p_n + k]) THEN piv := i; END IF;
    END LOOP;
    IF abs(a[(piv - 1) * p_n + k]) < 1e-12 THEN RETURN NULL; END IF;
    IF piv <> k THEN
      FOR j IN 1..p_n LOOP
        t := a[(k - 1) * p_n + j]; a[(k - 1) * p_n + j] := a[(piv - 1) * p_n + j]; a[(piv - 1) * p_n + j] := t;
      END LOOP;
      t := b[k]; b[k] := b[piv]; b[piv] := t;
    END IF;
    FOR i IN 1..p_n LOOP
      IF i <> k THEN
        m := a[(i - 1) * p_n + k] / a[(k - 1) * p_n + k];
        IF m <> 0 THEN
          FOR j IN k..p_n LOOP a[(i - 1) * p_n + j] := a[(i - 1) * p_n + j] - m * a[(k - 1) * p_n + j]; END LOOP;
          b[i] := b[i] - m * b[k];
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..p_n LOOP b[i] := b[i] / a[(i - 1) * p_n + i]; END LOOP;
  RETURN b;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_solve(float8[], float8[], integer) FROM PUBLIC, anon, authenticated;

-- ── 3. Les facteurs d'une liste de paires (soirée, personne) ─────────────────
-- Entrées (tables temporaires) : _scx (soirées cibles : xid, start_at, cutoff,
-- series, genres, arts = artistes invités du line-up, fmt, slot, wd) et _scp
-- (paires : xid, em, y, w). Lit _ann, _annart, _ana, _anp de _crm_an_load.
-- Sortie : _scf (xid, em, y, w, f float8[12]) dans l'ordre de _crm_score_features().
CREATE OR REPLACE FUNCTION public._crm_score_features()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ARRAY['rec', 'freq', 'series', 'artist', 'genre', 'fmt', 'slot', 'wd', 'early', 'last', 'far', 'disc'];
$function$;

CREATE OR REPLACE FUNCTION public._crm_score_build(p_cfg jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_early float8 := COALESCE((p_cfg->'buy'->>'early_days')::float8, 14) * 24;
  v_last float8 := COALESCE((p_cfg->'buy'->>'last_minute_hours')::float8, 24);
  v_n integer;
BEGIN
  DROP TABLE IF EXISTS _sch;
  CREATE TEMP TABLE _sch ON COMMIT DROP AS
  SELECT p.xid, p.em, a.nid AS hn, a.start_at AS hs, a.lead_h, a.has_sale,
         n.series AS hser, n.genres AS hg, n.fmt AS hfmt, n.slot AS hslot, n.wd AS hwd
    FROM _scp p
    JOIN _scx x ON x.xid = p.xid
    JOIN _ana a ON a.em = p.em AND a.start_at < x.cutoff
    JOIN _ann n ON n.nid = a.nid;
  CREATE INDEX ON _sch (xid, em);

  DROP TABLE IF EXISTS _scf;
  CREATE TEMP TABLE _scf ON COMMIT DROP AS
  WITH agg AS (
    SELECT h.xid, h.em,
           max(h.hs) AS last_hs,
           count(*) FILTER (WHERE h.hs > x.start_at - interval '365 days') AS n12,
           count(*) FILTER (WHERE h.hser IS NOT NULL AND h.hser = x.series) AS series,
           avg(CASE WHEN cardinality(x.genres) > 0 AND h.hg && x.genres THEN 1 ELSE 0 END) AS genre,
           mode() WITHIN GROUP (ORDER BY h.hfmt) AS mfmt,
           mode() WITHIN GROUP (ORDER BY h.hslot) AS mslot,
           mode() WITHIN GROUP (ORDER BY h.hwd) AS mwd,
           avg(CASE WHEN h.lead_h >= v_early THEN 1 ELSE 0 END) FILTER (WHERE h.has_sale) AS early,
           avg(CASE WHEN h.lead_h <= v_last THEN 1 ELSE 0 END) FILTER (WHERE h.has_sale) AS last
      FROM _sch h JOIN _scx x ON x.xid = h.xid
     GROUP BY h.xid, h.em
  ), art AS (
    -- L'invité de l'affiche qu'il a vu le plus souvent : combien de fois.
    SELECT z.xid, z.em, max(z.n) AS n
      FROM (SELECT h.xid, h.em, a.ak, count(DISTINCT h.hn) AS n
              FROM _sch h JOIN _scx x ON x.xid = h.xid
              JOIN _annart a ON a.nid = h.hn
             WHERE a.ak = ANY (x.arts)
             GROUP BY 1, 2, 3) z
     GROUP BY 1, 2
  ), first AS (
    SELECT a.em, a.src FROM _ana a WHERE a.k = 1
  )
  SELECT p.xid, p.em, p.y, p.w,
         ARRAY[
           ln(1 + GREATEST(0, extract(epoch FROM x.start_at - g.last_hs) / 86400.0)),
           ln(1 + g.n12),
           ln(1 + g.series),
           ln(1 + COALESCE(ar.n, 0)),
           COALESCE(g.genre, 0),
           CASE WHEN x.fmt IS NOT NULL AND x.fmt = g.mfmt THEN 1 ELSE 0 END,
           CASE WHEN x.slot IS NOT NULL AND x.slot = g.mslot THEN 1 ELSE 0 END,
           CASE WHEN x.wd IS NOT NULL AND x.wd = g.mwd THEN 1 ELSE 0 END,
           COALESCE(g.early, 0),
           COALESCE(g.last, 0),
           CASE WHEN ap.passing THEN 1 ELSE 0 END,
           CASE WHEN fi.src = 'sg' THEN 1 ELSE 0 END
         ]::float8[] AS f
    FROM _scp p
    JOIN _scx x ON x.xid = p.xid
    JOIN agg g ON g.xid = p.xid AND g.em = p.em
    LEFT JOIN art ar ON ar.xid = p.xid AND ar.em = p.em
    LEFT JOIN _anp ap ON ap.em = p.em
    LEFT JOIN first fi ON fi.em = p.em;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_build(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 4. Ajuster une régression logistique L2 sur _scz (xv, y, w) ──────────────
-- xv = [1, z1..zk] (facteurs centrés-réduits). Newton : β ← β + H⁻¹ g, avec
-- g = X'w(y−p) − λβ et H = X'w p(1−p) X + λI (l'intercept n'est pas pénalisé).
-- Une itération = UNE requête SQL qui rend g et H. Rend β, ou NULL.
CREATE OR REPLACE FUNCTION public._crm_logit_fit(p_k integer, p_l2 float8, p_iter integer)
 RETURNS float8[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer := p_k + 1;
  beta float8[] := array_fill(0::float8, ARRAY[n]);
  dot text;
  gsql text;
  hsql text;
  g float8[];
  h float8[];
  hh float8[];
  d float8[];
  it integer;
  i integer; j integer;
  mx float8;
BEGIN
  FOR it IN 1..p_iter LOOP
    dot := '';
    FOR i IN 1..n LOOP
      dot := dot || CASE WHEN i > 1 THEN ' + ' ELSE '' END || format('(%s)::float8 * xv[%s]', beta[i], i);
    END LOOP;
    gsql := ''; hsql := '';
    FOR i IN 1..n LOOP
      gsql := gsql || CASE WHEN i > 1 THEN ', ' ELSE '' END || format('sum(w * (y - p) * xv[%s])', i);
      FOR j IN i..n LOOP
        hsql := hsql || CASE WHEN hsql <> '' THEN ', ' ELSE '' END || format('sum(w * p * (1 - p) * xv[%s] * xv[%s])', i, j);
      END LOOP;
    END LOOP;
    EXECUTE format('SELECT ARRAY[%s]::float8[], ARRAY[%s]::float8[] FROM (SELECT xv, y, w, 1 / (1 + exp(-LEAST(30, GREATEST(-30, %s)))) AS p FROM _scz) z',
                   gsql, hsql, dot) INTO g, hh;
    IF g IS NULL OR hh IS NULL THEN RETURN NULL; END IF;
    -- H symétrique à plat, plus la pénalité.
    h := array_fill(0::float8, ARRAY[n * n]);
    d := NULL;
    DECLARE c integer := 0; BEGIN
      FOR i IN 1..n LOOP
        FOR j IN i..n LOOP
          c := c + 1;
          h[(i - 1) * n + j] := hh[c];
          h[(j - 1) * n + i] := hh[c];
        END LOOP;
      END LOOP;
    END;
    FOR i IN 2..n LOOP
      h[(i - 1) * n + i] := h[(i - 1) * n + i] + p_l2;
      g[i] := g[i] - p_l2 * beta[i];
    END LOOP;
    d := public._crm_solve(h, g, n);
    IF d IS NULL THEN RETURN NULL; END IF;
    mx := 0;
    FOR i IN 1..n LOOP
      beta[i] := beta[i] + d[i];
      mx := GREATEST(mx, abs(d[i]));
    END LOOP;
    EXIT WHEN mx < 1e-6;
  END LOOP;
  RETURN beta;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_logit_fit(integer, float8, integer) FROM PUBLIC, anon, authenticated;

-- AUC (Mann-Whitney, rangs moyens aux ex-aequo) et ECE (10 tranches) de _scv (p, y).
CREATE OR REPLACE FUNCTION public._crm_score_eval()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  WITH r AS (
    SELECT p, y, rank() OVER (ORDER BY p) + (count(*) OVER (PARTITION BY p) - 1) / 2.0 AS rk FROM _scv
  ), s AS (
    SELECT count(*) FILTER (WHERE y = 1) AS n1, count(*) FILTER (WHERE y = 0) AS n0,
           sum(rk) FILTER (WHERE y = 1) AS r1 FROM r
  ), b AS (
    SELECT width_bucket(p, 0, 1.0000001, 10) AS k, avg(p) AS mp, avg(y) AS my, count(*) AS n FROM _scv GROUP BY 1
  )
  SELECT jsonb_build_object(
    'auc', CASE WHEN s.n1 > 0 AND s.n0 > 0 THEN round(((s.r1 - s.n1 * (s.n1 + 1) / 2.0) / (s.n1 * s.n0))::numeric, 4) END,
    'ece', (SELECT round((sum(abs(b.mp - b.my) * b.n) / NULLIF(sum(b.n), 0))::numeric, 4) FROM b),
    'pos', s.n1, 'n', s.n1 + s.n0,
    'mean_p', (SELECT round(avg(p)::numeric, 4) FROM _scv), 'rate', round((s.n1::numeric / NULLIF(s.n1 + s.n0, 0)), 4))
  INTO v FROM s;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_eval() FROM PUBLIC, anon, authenticated;

-- Applique un modèle (mean, sd, beta) à _scf → _scv (xid, em, p, y, c = contributions).
CREATE OR REPLACE FUNCTION public._crm_score_apply(p_idx integer[], p_mean float8[], p_sd float8[], p_beta float8[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  DROP TABLE IF EXISTS _scv;
  CREATE TEMP TABLE _scv ON COMMIT DROP AS
  SELECT f.xid, f.em, f.y,
         1 / (1 + exp(-LEAST(30, GREATEST(-30, p_beta[1] + COALESCE((
           SELECT sum(p_beta[gi + 1] * (f.f[p_idx[gi]] - p_mean[gi]) / p_sd[gi]) FROM generate_subscripts(p_idx, 1) gi), 0))))) AS p,
         ARRAY(SELECT p_beta[gi + 1] * (f.f[p_idx[gi]] - p_mean[gi]) / p_sd[gi] FROM generate_subscripts(p_idx, 1) gi ORDER BY gi) AS c
    FROM _scf f;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_apply(integer[], float8[], float8[], float8[]) FROM PUBLIC, anon, authenticated;

-- Moyennes / écarts-types pondérés des colonnes p_idx de _scf, puis _scz.
CREATE OR REPLACE FUNCTION public._crm_score_design(p_idx integer[], OUT o_mean float8[], OUT o_sd float8[])
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE i integer; m float8; s float8;
BEGIN
  o_mean := '{}'; o_sd := '{}';
  FOR i IN 1..cardinality(p_idx) LOOP
    SELECT sum(w * f[p_idx[i]]) / sum(w), sqrt(GREATEST(sum(w * f[p_idx[i]] ^ 2) / sum(w) - (sum(w * f[p_idx[i]]) / sum(w)) ^ 2, 0))
      INTO m, s FROM _scf;
    o_mean := o_mean || COALESCE(m, 0);
    o_sd := o_sd || CASE WHEN COALESCE(s, 0) < 1e-6 THEN 1 ELSE s END;
  END LOOP;
  DROP TABLE IF EXISTS _scz;
  CREATE TEMP TABLE _scz ON COMMIT DROP AS
  SELECT ARRAY[1::float8] || ARRAY(SELECT (f.f[p_idx[gi]] - o_mean[gi]) / o_sd[gi] FROM generate_subscripts(p_idx, 1) gi ORDER BY gi) AS xv,
         f.y, f.w
    FROM _scf f;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_design(integer[]) FROM PUBLIC, anon, authenticated;

-- ── 5. Les soirées cibles : passées (apprentissage) ou à venir (score) ───────
CREATE OR REPLACE FUNCTION public._crm_score_targets(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb, p_upcoming boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res numeric := COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_minb integer := COALESCE((p_cfg->'rarity'->>'min_nights')::integer, 5);
  v_n integer;
BEGIN
  DROP TABLE IF EXISTS _scx;
  IF NOT p_upcoming THEN
    -- Soirées passées : celles chargées par _crm_an_load ; la rareté à leur date.
    CREATE TEMP TABLE _scx ON COMMIT DROP AS
    SELECT n.nid AS xid, n.event_id, n.start_at, n.sale_at AS cutoff, n.series, n.genres, n.fmt, n.slot, n.wd,
           ARRAY(SELECT a.ak FROM _annart a JOIN _anrar r ON r.nid = n.nid AND r.ak = a.ak
                  WHERE a.nid = n.nid AND NOT (r.base >= v_minb AND r.share > v_res)) AS arts
      FROM _ann n
     WHERE n.start_at < now() - interval '12 hours';
  ELSE
    -- Soirées à venir en vente : le line-up, résidents (statistiques du compte) exclus.
    CREATE TEMP TABLE _scx ON COMMIT DROP AS
    SELECT e.id AS xid, e.event_id, e.start_at, now() AS cutoff,
           public._crm_night_series(e.name) AS series,
           ARRAY(SELECT DISTINCT lower(btrim(g)) FROM unnest(COALESCE(e.genres, '{}')) g WHERE btrim(g) <> '' ORDER BY 1) AS genres,
           lower(NULLIF(btrim(e.type_of_place), '')) AS fmt,
           public._crm_an_slot(e.start_at, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'), p_cfg) AS slot,
           extract(isodow FROM public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'), 6))::smallint AS wd,
           ARRAY(SELECT DISTINCT public._crm_artist_key(a)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.artists) = 'array' THEN e.artists ELSE '[]'::jsonb END) a
                  WHERE public._crm_artist_key(a) IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st
                                     WHERE st.scope_key = p_scope AND st.artist_key = public._crm_artist_key(a) AND st.share > v_res)) AS arts
      FROM public.external_events e
      JOIN public.events ev ON ev.id = e.event_id AND ev.cancelled_at IS NULL
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.cancelled_at IS NULL AND e.start_at > now()
       AND e.start_at <= now() + interval '120 days';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_targets(text, text, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- ── 6. L'entraînement, la validation et le score d'un compte ────────────────
CREATE OR REPLACE FUNCTION public.crm_score_compute(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg   jsonb := public.crm_analysis_config();
  sc      jsonb;
  v_t0    timestamptz := clock_timestamp();
  v_feat  text[] := public._crm_score_features();
  v_all   integer[] := ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  v_base  integer[] := ARRAY[1, 2];
  v_idx   integer[];
  v_cut   timestamptz;
  v_ntr   integer; v_nva integer;
  v_mean  float8[]; v_sd float8[]; v_beta float8[];
  b_mean  float8[]; b_sd float8[]; b_beta float8[];
  v_tr    jsonb; v_va jsonb; v_vb jsonb;
  v_pos   integer;
  v_neg   float8;
  v_status text;
  v_scored integer := 0;
  i integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'crm_score_compute: service only' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  sc := COALESCE(v_cfg->'score', '{}'::jsonb);
  v_neg := LEAST(1, GREATEST(0.01, COALESCE((sc->>'neg_sample')::float8, 0.2)));

  PERFORM public._crm_an_load(p_venue_id, p_organizer_user_id, now(), v_cfg);
  PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, false);

  -- Les soirées des N derniers mois ; les dernières sont tenues à l'écart.
  DELETE FROM _scx WHERE start_at < now() - make_interval(months => COALESCE((sc->>'months')::int, 12));
  SELECT start_at INTO v_cut FROM _scx ORDER BY start_at DESC
   OFFSET GREATEST(COALESCE((sc->>'holdout_nights')::int, 4) - 1, 0) LIMIT 1;
  SELECT count(*) FILTER (WHERE start_at < v_cut), count(*) FILTER (WHERE start_at >= v_cut) INTO v_ntr, v_nva FROM _scx;

  IF v_cut IS NULL OR v_ntr < COALESCE((sc->>'min_train_nights')::int, 8) THEN
    v_status := 'insufficient';
    v_tr := jsonb_build_object('nights', COALESCE(v_ntr, 0));
  ELSE
    -- Paires : toute personne déjà venue avant l'ouverture de la vente ;
    -- achats gardés, non-achats échantillonnés et repondérés.
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    WITH known AS (
      SELECT x.xid, a.em
        FROM _scx x JOIN _ana a ON a.start_at < x.cutoff
       GROUP BY x.xid, a.em
    ), bought AS (
      SELECT a.em, a.nid FROM _ana a WHERE a.has_sale
    )
    SELECT k.xid, k.em, CASE WHEN b.em IS NOT NULL THEN 1 ELSE 0 END AS y,
           CASE WHEN b.em IS NOT NULL OR x.start_at >= v_cut THEN 1.0 ELSE 1.0 / v_neg END AS w,
           x.start_at >= v_cut AS valid
      FROM known k
      JOIN _scx x ON x.xid = k.xid
      LEFT JOIN bought b ON b.em = k.em AND b.nid = k.xid
     WHERE b.em IS NOT NULL OR x.start_at >= v_cut
        OR (abs(hashtext(k.em || ':' || k.xid::text)) % 1000) < v_neg * 1000;

    PERFORM public._crm_score_build(v_cfg);
    ALTER TABLE _scf ADD COLUMN valid boolean;
    UPDATE _scf f SET valid = p.valid FROM _scp p WHERE p.xid = f.xid AND p.em = f.em;

    SELECT count(*) FILTER (WHERE y = 1 AND NOT valid) INTO v_pos FROM _scf;
    v_tr := jsonb_build_object('nights', v_ntr, 'rows', (SELECT count(*) FROM _scf WHERE NOT valid), 'pos', v_pos);

    IF v_pos < COALESCE((sc->>'min_pos_train')::int, 200) THEN
      v_status := 'insufficient';
    ELSE
      -- Apprentissage sur les soirées d'avant la coupure.
      ALTER TABLE _scf RENAME TO _scf_all;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE NOT valid;
      -- Facteurs constants sur ce compte (toutes les soirées pareilles) : retirés.
      v_idx := '{}';
      FOR i IN 1..12 LOOP
        IF (SELECT stddev_pop(f[i]) FROM _scf) > 1e-6 THEN v_idx := v_idx || i; END IF;
      END LOOP;
      SELECT * INTO v_mean, v_sd FROM public._crm_score_design(v_idx);
      v_beta := public._crm_logit_fit(cardinality(v_idx), COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12));
      SELECT * INTO b_mean, b_sd FROM public._crm_score_design(v_base);
      b_beta := public._crm_logit_fit(2, COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12));

      -- Validation sur les soirées tenues à l'écart (population complète).
      DROP TABLE _scf;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE valid;
      IF v_beta IS NULL OR b_beta IS NULL THEN
        v_status := 'failed';
      ELSE
        PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
        v_va := public._crm_score_eval();
        -- Valeur ajoutée mesurée sur les clients ACTIFS (dernière soirée il y
        -- a moins de 180 jours) : sur toute la base, la récence seule trie
        -- déjà presque parfaitement (ceux qui ne reviennent jamais).
        DELETE FROM _scv v USING _scf f WHERE f.xid = v.xid AND f.em = v.em AND f.f[1] > ln(181);
        v_va := v_va || jsonb_build_object('active', public._crm_score_eval());
        PERFORM public._crm_score_apply(v_base, b_mean, b_sd, b_beta);
        v_vb := public._crm_score_eval();
        DELETE FROM _scv v USING _scf f WHERE f.xid = v.xid AND f.em = v.em AND f.f[1] > ln(181);
        v_vb := v_vb || jsonb_build_object('active', public._crm_score_eval());
        v_status := CASE
          WHEN COALESCE((v_va->>'pos')::int, 0) < COALESCE((sc->>'min_pos_valid')::int, 50) THEN 'insufficient'
          WHEN COALESCE((v_va->>'auc')::float8, 0) >= COALESCE((sc->>'auc_min')::float8, 0.70)
           AND COALESCE((v_va->'active'->>'auc')::float8, 0) >= COALESCE((v_vb->'active'->>'auc')::float8, 0) + COALESCE((sc->>'auc_gain')::float8, 0.02)
           AND COALESCE((v_va->>'ece')::float8, 1) <= COALESCE((sc->>'ece_max')::float8, 0.05)
            THEN 'ok'
          ELSE 'weak' END;
      END IF;
      DROP TABLE _scf_all;
    END IF;
  END IF;

  INSERT INTO public.crm_score_model AS m (scope_key, venue_id, organizer_user_id, status, features, mean, sd, beta, metrics, trained_at)
  VALUES (v_key, p_venue_id, p_organizer_user_id, v_status,
          CASE WHEN v_idx IS NOT NULL THEN ARRAY(SELECT v_feat[j] FROM unnest(v_idx) j) END,
          v_mean, v_sd, v_beta,
          jsonb_strip_nulls(jsonb_build_object('train', v_tr, 'valid', v_va, 'baseline', v_vb,
            'valid_nights', v_nva, 'rules_version', (v_cfg->>'rules_version')::int,
            'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000))),
          now())
  ON CONFLICT (scope_key) DO UPDATE SET status = EXCLUDED.status, features = EXCLUDED.features, mean = EXCLUDED.mean,
    sd = EXCLUDED.sd, beta = EXCLUDED.beta, metrics = EXCLUDED.metrics, trained_at = EXCLUDED.trained_at;

  -- Le score des soirées à venir (seulement avec un modèle validé).
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key;
  DELETE FROM public.crm_score_night WHERE scope_key = v_key;
  IF v_status = 'ok' THEN
    PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, true);
    -- Part des achats encore à venir : ventes passées faites à moins de H
    -- heures de leur soirée, H = heures restantes avant celle-ci.
    ALTER TABLE _scx ADD COLUMN f float8;
    UPDATE _scx x SET f = COALESCE((
      SELECT avg(CASE WHEN a.lead_h <= GREATEST(0, extract(epoch FROM x.start_at - now()) / 3600.0) THEN 1 ELSE 0 END)
        FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1);
    INSERT INTO public.crm_score_night (scope_key, event_id, remaining_share)
    SELECT v_key, x.event_id, x.f FROM _scx x WHERE x.event_id IS NOT NULL;
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    SELECT x.xid, p.em, 0 AS y, 1.0::float8 AS w
      FROM _scx x
      CROSS JOIN (SELECT DISTINCT em FROM _ana) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.event_id = x.event_id AND lower(t.buyer_email) = p.em AND t.status IN ('valid', 'transferred'));
    PERFORM public._crm_score_build(v_cfg);
    PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
    -- Chance d'acheter D'ICI la soirée, sachant qu'il n'a pas encore acheté :
    -- p·f / (1 − p·(1 − f)), f = part des achats qui reste à venir.
    INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
    SELECT v_key, x.event_id, v.em, q.pa,
           CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
           -- Raisons : les facteurs qui poussent sa chance vers le haut ET qu'il
           -- possède vraiment (un trait à zéro n'est jamais une raison) ; « de
           -- passage » et « découverte Shotgun » décrivent un contexte, jamais
           -- une raison de venir.
           ARRAY(SELECT v_feat[v_idx[gi]] FROM generate_subscripts(v.c, 1) gi
                  WHERE v.c[gi] > 0.15 AND v_feat[v_idx[gi]] NOT IN ('far', 'disc')
                    AND (v_feat[v_idx[gi]] = 'rec' OR f.f[v_idx[gi]] > 0)
                  ORDER BY v.c[gi] DESC LIMIT 3)
      FROM _scv v JOIN _scx x ON x.xid = v.xid
      JOIN _scf f ON f.xid = v.xid AND f.em = v.em
      CROSS JOIN LATERAL (SELECT v.p * x.f / GREATEST(1e-9, 1 - v.p * (1 - x.f)) AS pa) q
     WHERE x.event_id IS NOT NULL;
    GET DIAGNOSTICS v_scored = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('scope', v_key, 'status', v_status, 'scored', v_scored,
    'auc', v_va->'auc', 'auc_base', v_vb->'auc', 'ece', v_va->'ece',
    'auc_active', v_va->'active'->'auc', 'auc_active_base', v_vb->'active'->'auc',
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_score_compute(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_compute(text, uuid) TO service_role;

-- Chaque nuit : un compte par passage, celui dont le modèle est le plus ancien.
CREATE OR REPLACE FUNCTION public.crm_score_nightly()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s record; v_r jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT st.scope_key, st.venue_id, st.organizer_user_id INTO s
    FROM public.crm_analysis_state st
    LEFT JOIN public.crm_score_model m ON m.scope_key = st.scope_key
   WHERE st.full_at IS NOT NULL
     AND (m.trained_at IS NULL OR m.trained_at < date_trunc('day', now()))
     AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                  WHERE c.status <> 'disconnected' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = st.scope_key)
   ORDER BY m.trained_at NULLS FIRST
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('scopes', 0); END IF;
  BEGIN
    v_r := public.crm_score_compute(s.venue_id, s.organizer_user_id);
  EXCEPTION WHEN others THEN
    INSERT INTO public.crm_score_model AS m (scope_key, venue_id, organizer_user_id, status, metrics, trained_at)
    VALUES (s.scope_key, s.venue_id, s.organizer_user_id, 'failed', jsonb_build_object('error', left(SQLERRM, 300), 'sqlstate', SQLSTATE), now())
    ON CONFLICT (scope_key) DO UPDATE SET status = 'failed', metrics = EXCLUDED.metrics, trained_at = now();
    DELETE FROM public.crm_person_night_score WHERE scope_key = s.scope_key;
    RETURN jsonb_build_object('scope', s.scope_key, 'error', SQLSTATE);
  END;
  RETURN v_r;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_score_nightly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_nightly() TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule('crm-score-nightly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-score-nightly');
  -- Après le calcul complet de l'analyse (2 h → 5 h), un compte par passage.
  PERFORM cron.schedule('crm-score-nightly', '27,57 5-6 * * *', $job$SELECT public.crm_score_nightly()$job$);
END
$cron$;
