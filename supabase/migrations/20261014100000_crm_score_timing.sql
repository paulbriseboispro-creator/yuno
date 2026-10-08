-- ============================================================================
-- Yuno CRM — « Chances de venir » : une soirée à venir notée comme le modèle a
-- appris (2026-10-14). Plan : docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md (lot 2).
--
-- Constat du journal prévu / réel (lot 1, banc scripts/crm-bench) : la
-- calibration par personne tenait sur les soirées tenues à l'écart, mais la
-- somme des chances d'une soirée À VENIR surestimait ses acheteurs de 15 à 90 %
-- (audience « achètent tôt » : 35 attendus, 5 réels). Trois causes, mesurées
-- une à une au banc avant d'être corrigées :
--
--   1. Décalage entre l'apprentissage et la note. Le modèle apprend avec ce
--      qu'on savait d'une personne à l'OUVERTURE de la vente de chaque soirée
--      passée (sa dernière venue date donc d'au moins 25 jours) ; une soirée à
--      venir était notée avec l'historique jusqu'à aujourd'hui, une venue
--      d'il y a 3 jours sortant de tout ce que le modèle a vu. Désormais, une
--      soirée à venir est notée avec les facteurs connus à l'ouverture de SA
--      vente (aujourd'hui si elle n'est pas encore en vente), même règle que
--      _crm_an_load : la vraie date Shotgun, sinon le premier billet vendu,
--      sinon la publication, sinon 30 jours avant.
--      Ceux venus pour la PREMIÈRE fois depuis cette ouverture n'ont pas de
--      facteurs à cette date : ils reçoivent le taux observé sur les soirées
--      passées du compte pour ce même cas (au moins score.recent_min_pairs
--      paires, sinon ils ne sont pas notés), sans raison.
--   2. Part des achats encore à venir, PAR PERSONNE. Qui achète d'habitude tôt
--      et n'a rien pris à J-7 ne viendra presque plus. f = (k·F + m) / (k + n) :
--      n achats passés de la personne, m faits à moins de H heures de leur
--      soirée (H = heures restantes), F = la même part sur les achats des
--      clients déjà venus du compte, k = score.timing_prior (2, deux achats
--      « au rythme du compte »). Chance d'acheter d'ici la soirée, sachant
--      qu'il n'a pas encore acheté : p·f / (1 − p·(1 − f)).
--      crm_score_night.remaining_share devient la part restante des PREMIERS
--      achats : elle ne sert qu'à projeter les nouveaux.
--   3. Niveau : un recalage sur les soirées tenues à l'écart (niveau seul, puis
--      Platt) a été ESSAYÉ puis RETIRÉ. Sur 4 comptes du banc, la perte
--      logarithmique ne bouge pas (0,3504 sans, 0,3503 niveau, 0,3501 Platt) et
--      le décalage estimé sur 4 soirées change de signe d'un compte à l'autre :
--      il suit le hasard des soirées, pas une dérive.
--   4. Raisons (décision de Paul, 07/10) : une raison dont la famille
--      d'hypothèse est « pas confirmée » (not_supported) sur le compte ne
--      s'affiche jamais, même si le modèle lui donne du poids.
--   5. Un facteur de plus, « a déjà fait ce concept » oui / non, gardé au
--      banc et neutre sur le compte démo ; les autres formats essayés sont
--      refusés (voir § 2).
--   6. Temps : la hessienne de Newton n'est recalculée qu'aux deux premières
--      itérations et quand le pas reste grand ; départ à chaud par nom de
--      facteur (banc, compte « grand », avec deux facteurs de plus : 1er
--      calcul 57,6 → 45,6 s).
--
-- Mesure ajoutée au modèle (metrics.backtest) : sur les soirées tenues à
-- l'écart, à J-7, les acheteurs attendus parmi ceux qui n'avaient pas encore
-- acheté contre les réels, avec la part restante par personne. C'est la justesse de la correction de temps, lisible dès le
-- premier calcul d'un compte, sans attendre 8 soirées de journal.
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

SET lock_timeout = '5s';

-- ── 0. Réglages ──────────────────────────────────────────────────────────────
UPDATE public.crm_analysis_rules
   SET config = jsonb_set(config, '{score}', COALESCE(config->'score', '{}'::jsonb) || '{
     "timing_prior": 2, "recent_min_pairs": 50, "off": []
   }'::jsonb)
 WHERE NOT (COALESCE(config->'score', '{}'::jsonb) ? 'timing_prior');

-- ── 1. Les soirées cibles : une soirée à venir prend la date d'ouverture de sa vente ──
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
    -- Soirées à venir en vente : le line-up, résidents (statistiques du compte)
    -- exclus. Les facteurs se prennent à l'ouverture de la vente (même règle
    -- que _crm_an_load), comme à l'apprentissage ; aujourd'hui au plus tard.
    CREATE TEMP TABLE _scx ON COMMIT DROP AS
    SELECT e.id AS xid, e.event_id, e.start_at,
           LEAST(now(), e.start_at,
                 COALESCE(e.launched_at,
                          (SELECT min(COALESCE(t.purchased_at, t.first_seen_at)) FROM public.external_tickets t
                            WHERE t.connection_id = e.connection_id AND t.external_event_id = e.external_id
                              AND public._crm_ticket_is_sale(t.status, t.raw)),
                          e.published_at, e.start_at - interval '30 days')) AS cutoff,
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

-- ── 2. Les facteurs : un format de plus, prouvé ─────────────────────────────
-- Les 12 facteurs d'origine gardent leur place (rec reste le 1er : la porte des
-- clients actifs le lit). Un facteur s'ajoute, gardé parce qu'il améliore la
-- perte logarithmique ET la calibration sur les soirées tenues à l'écart des 4
-- comptes du banc (demo + 3 tirages de grand), sans rien dégrader sur le compte
-- démo de la prod (répétition annulée du 08/10) :
--   series_done    a déjà fait une édition du concept (oui / non)
-- Essayés puis REFUSÉS : « a vu un invité de l'affiche dans les 180 jours »
-- (meilleur au banc, mais AUC 0,7053 → 0,7040 et perte log 0,4157 → 0,4166
-- sur le compte démo : une baisse sur un compte n'est pas une amélioration),
-- artiste vu oui / non, dernière édition du concept faite, achat à plusieurs,
-- venu avec un client déjà venu, jour + créneau habituels, saison (rien ou
-- pire), prix de la soirée contre son prix habituel (son gain sur un compte
-- venait d'un artefact du générateur).
-- score.off éteint un facteur par son nom (essais au banc).
-- Une raison ne s'affiche que sous un libellé existant (_crm_score_reason_key).
CREATE OR REPLACE FUNCTION public._crm_score_features()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ARRAY['rec', 'freq', 'series', 'artist', 'genre', 'fmt', 'slot', 'wd', 'early', 'last', 'far', 'disc',
               'series_done'];
$function$;
REVOKE ALL ON FUNCTION public._crm_score_features() FROM PUBLIC, anon, authenticated;

-- Le libellé de raison d'un facteur (yc.sc.reason.<clé>), ou NULL s'il n'en a pas.
CREATE OR REPLACE FUNCTION public._crm_score_reason_key(p_feature text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_feature
    WHEN 'rec' THEN 'rec' WHEN 'freq' THEN 'freq'
    WHEN 'series' THEN 'series' WHEN 'series_done' THEN 'series'
    WHEN 'artist' THEN 'artist'
    WHEN 'genre' THEN 'genre' WHEN 'fmt' THEN 'fmt' WHEN 'slot' THEN 'slot'
    WHEN 'wd' THEN 'wd'
    WHEN 'early' THEN 'early' WHEN 'last' THEN 'last'
  END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_reason_key(text) FROM PUBLIC, anon, authenticated;

-- La famille d'hypothèse d'une raison (décision 2 : jamais une raison dont la
-- famille est « pas confirmée » sur le compte).
CREATE OR REPLACE FUNCTION public._crm_score_reason_family(p_reason text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_reason
    WHEN 'series' THEN 'series' WHEN 'artist' THEN 'artist' WHEN 'genre' THEN 'genre' WHEN 'fmt' THEN 'format'
    WHEN 'slot' THEN 'slot' WHEN 'wd' THEN 'weekday' WHEN 'early' THEN 'early' WHEN 'last' THEN 'last_minute'
  END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_reason_family(text) FROM PUBLIC, anon, authenticated;

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
           CASE WHEN fi.src = 'sg' THEN 1 ELSE 0 END,
           CASE WHEN g.series > 0 THEN 1 ELSE 0 END
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

-- Newton, une requête par itération. La hessienne (120 sommes pour 15
-- variables, l'essentiel du temps) n'est recalculée qu'aux deux premières
-- itérations et quand le pas reste grand ; ensuite seul le gradient (15
-- sommes) est relu et la hessienne précédente resservie : la convergence ne
-- change pas (même critère d'arrêt), le temps oui (banc, compte « grand »).
CREATE OR REPLACE FUNCTION public._crm_logit_fit(p_k integer, p_l2 float8, p_iter integer,
                                                 p_start float8[] DEFAULT NULL, p_tol float8 DEFAULT 1e-6)
 RETURNS float8[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer := p_k + 1;
  -- Départ : le modèle d'hier quand il a les mêmes facteurs (1 itération au
  -- lieu de 8), sinon zéro.
  beta float8[] := CASE WHEN cardinality(p_start) = p_k + 1 THEN p_start ELSE array_fill(0::float8, ARRAY[p_k + 1]) END;
  dot text;
  gsql text;
  hsql text;
  g float8[];
  h float8[];
  hh float8[];
  d float8[];
  it integer;
  i integer; j integer;
  mx float8 := 1;
  full_h boolean;
BEGIN
  gsql := ''; hsql := '';
  FOR i IN 1..n LOOP
    gsql := gsql || CASE WHEN i > 1 THEN ', ' ELSE '' END || format('sum(w * (y - p) * x%s)', i);
    FOR j IN i..n LOOP
      hsql := hsql || CASE WHEN hsql <> '' THEN ', ' ELSE '' END || format('sum(w * p * (1 - p) * x%s * x%s)', i, j);
    END LOOP;
  END LOOP;
  FOR it IN 1..p_iter LOOP
    dot := '';
    FOR i IN 1..n LOOP
      dot := dot || CASE WHEN i > 1 THEN ' + ' ELSE '' END || format('(%s)::float8 * x%s', beta[i], i);
    END LOOP;
    full_h := it <= 2 OR h IS NULL OR mx > 0.05;
    IF full_h THEN
      EXECUTE format('SELECT ARRAY[%s]::float8[], ARRAY[%s]::float8[] FROM (SELECT *, 1 / (1 + exp(-LEAST(30, GREATEST(-30, %s)))) AS p FROM _scz) z',
                     gsql, hsql, dot) INTO g, hh;
      IF g IS NULL OR hh IS NULL THEN RETURN NULL; END IF;
      -- H symétrique à plat, plus la pénalité.
      h := array_fill(0::float8, ARRAY[n * n]);
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
      END LOOP;
    ELSE
      EXECUTE format('SELECT ARRAY[%s]::float8[] FROM (SELECT *, 1 / (1 + exp(-LEAST(30, GREATEST(-30, %s)))) AS p FROM _scz) z',
                     gsql, dot) INTO g;
      IF g IS NULL THEN RETURN NULL; END IF;
    END IF;
    FOR i IN 2..n LOOP
      g[i] := g[i] - p_l2 * beta[i];
    END LOOP;
    d := public._crm_solve(h, g, n);
    IF d IS NULL THEN RETURN NULL; END IF;
    mx := 0;
    FOR i IN 1..n LOOP
      beta[i] := beta[i] + d[i];
      mx := GREATEST(mx, abs(d[i]));
    END LOOP;
    EXIT WHEN mx < p_tol;
  END LOOP;
  RETURN beta;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_logit_fit(integer, float8, integer, float8[], float8) FROM PUBLIC, anon, authenticated;

-- AUC (Mann-Whitney, rangs moyens aux ex-aequo), ECE (10 tranches) et perte
-- logarithmique de _scv (p, y).
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
    'logloss', (SELECT round((-avg(y * ln(LEAST(GREATEST(p, 1e-6), 1 - 1e-6))
                                + (1 - y) * ln(1 - LEAST(GREATEST(p, 1e-6), 1 - 1e-6))))::numeric, 5) FROM _scv),
    'pos', s.n1, 'n', s.n1 + s.n0,
    'mean_p', (SELECT round(avg(p)::numeric, 4) FROM _scv), 'rate', round((s.n1::numeric / NULLIF(s.n1 + s.n0, 0)), 4))
  INTO v FROM s;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_eval() FROM PUBLIC, anon, authenticated;

-- ── 3. Le calcul de nuit ─────────────────────────────────────────────────────
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
  v_off   text[];
  v_base  integer[] := ARRAY[1, 2];
  v_idx   integer[];
  v_cut   timestamptz;
  v_ntr   integer; v_nva integer;
  v_mean  float8[]; v_sd float8[]; v_beta float8[]; v_start float8[];
  b_mean  float8[]; b_sd float8[]; b_beta float8[];
  v_tr    jsonb; v_va jsonb; v_vb jsonb;
  v_pos   integer;
  v_neg   float8;
  v_status text;
  v_scored integer := 0;
  v_journal jsonb := '{}'::jsonb;
  v_prior float8;
  v_bt    jsonb;
  v_rn    integer := 0;
  v_rate  float8;
  v_blocked text[];
  i integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'crm_score_compute: service only' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  sc := COALESCE(v_cfg->'score', '{}'::jsonb);
  v_off := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(sc->'off') = 'array' THEN sc->'off' ELSE '[]'::jsonb END));
  v_prior := GREATEST(0.1, COALESCE((sc->>'timing_prior')::float8, 2));

  -- Journal prévu / réel (20261013110000) : les soirées finies se comparent à
  -- la réalité avant tout. Une panne du journal ne coûte jamais le score.
  BEGIN
    v_journal := jsonb_build_object('settled', public._crm_score_settle(v_key, p_venue_id, p_organizer_user_id, now()));
  EXCEPTION WHEN others THEN
    v_journal := jsonb_build_object('settle_error', left(SQLERRM, 200));
  END;
  v_neg := LEAST(1, GREATEST(0.01, COALESCE((sc->>'neg_sample')::float8, 0.2)));

  PERFORM public._crm_an_load(p_venue_id, p_organizer_user_id, now(), v_cfg);
  PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, false);

  -- Les soirées des N derniers mois ; les dernières sont tenues à l'écart.
  DELETE FROM _scx WHERE start_at < now() - make_interval(months => COALESCE((sc->>'months')::int, 12));
  SELECT start_at INTO v_cut FROM _scx ORDER BY start_at DESC
   OFFSET GREATEST(COALESCE((sc->>'holdout_nights')::int, 4) - 1, 0) LIMIT 1;
  SELECT count(*) FILTER (WHERE start_at < v_cut), count(*) FILTER (WHERE start_at >= v_cut) INTO v_ntr, v_nva FROM _scx;

  -- Venus pour la première fois PENDANT la vente d'une soirée passée : la part
  -- qui l'a achetée. C'est la chance donnée à ce même cas sur une soirée à
  -- venir (le modèle n'a pas de facteurs pour eux à l'ouverture de la vente).
  SELECT count(*), avg(z.y) INTO v_rn, v_rate
    FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM _ana b WHERE b.em = f.em AND b.nid = x.xid AND b.has_sale) THEN 1 ELSE 0 END AS y
            FROM _scx x
            JOIN (SELECT em, min(start_at) AS first_at FROM _ana GROUP BY em) f
              ON f.first_at >= x.cutoff AND f.first_at < x.start_at) z;

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
      -- Facteurs constants sur ce compte (toutes les soirées pareilles) ou
      -- éteints (score.off) : retirés.
      v_idx := '{}';
      FOR i IN 1..cardinality(v_feat) LOOP
        CONTINUE WHEN v_feat[i] = ANY (v_off);
        IF (SELECT stddev_pop(f[i]) FROM _scf) > 1e-6 THEN v_idx := v_idx || i; END IF;
      END LOOP;
      SELECT * INTO v_mean, v_sd FROM public._crm_score_design(v_idx);
      -- Départ à chaud : les poids d'hier, facteur par facteur (par NOM) ; un
      -- facteur nouveau part de zéro. Ajouter un facteur ne force donc pas un
      -- départ à froid (58 s au lieu de 15 s sur le compte « grand » du banc).
      SELECT ARRAY[m.beta[1]] || ARRAY(SELECT COALESCE(m.beta[array_position(m.features, v_feat[u.j]) + 1], 0)
                                         FROM unnest(v_idx) WITH ORDINALITY u(j, o) ORDER BY u.o)
        INTO v_start FROM public.crm_score_model m
       WHERE m.scope_key = v_key AND m.status IN ('ok', 'weak') AND cardinality(m.beta) = cardinality(m.features) + 1;
      v_beta := public._crm_logit_fit(cardinality(v_idx), COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12),
                                      v_start, COALESCE((sc->>'tol')::float8, 1e-4));
      SELECT * INTO b_mean, b_sd FROM public._crm_score_design(v_base);
      b_beta := public._crm_logit_fit(2, COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12),
                                      NULL, COALESCE((sc->>'tol')::float8, 1e-4));

      -- Validation sur les soirées tenues à l'écart (population complète).
      DROP TABLE _scf;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE valid;
      IF v_beta IS NULL OR b_beta IS NULL THEN
        v_status := 'failed';
      ELSE
        PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
        v_va := public._crm_score_eval();
        -- Rejeu à J-7 : parmi ceux qui n'avaient pas encore acheté une semaine
        -- avant, acheteurs attendus (part restante par personne, historique
        -- d'avant l'ouverture de la vente) contre acheteurs réels.
        WITH fk AS (
          SELECT avg(CASE WHEN a.lead_h <= 168 THEN 1 ELSE 0 END) AS f
            FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL AND a.k > 1 AND a.start_at < v_cut
        ), pop AS (
          SELECT v.em, v.p, x.cutoff,
                 CASE WHEN b.em IS NOT NULL AND b.lead_h <= 168 THEN 1 ELSE 0 END AS y7
            FROM _scv v JOIN _scx x ON x.xid = v.xid
            LEFT JOIN _ana b ON b.em = v.em AND b.nid = v.xid AND b.has_sale
           WHERE NOT (b.em IS NOT NULL AND COALESCE(b.lead_h, 0) > 168)
        ), per AS (
          SELECT pop.*,
                 (SELECT count(*) FROM _ana h WHERE h.em = pop.em AND h.has_sale AND h.lead_h IS NOT NULL AND h.start_at < pop.cutoff) AS n,
                 (SELECT count(*) FROM _ana h WHERE h.em = pop.em AND h.has_sale AND h.lead_h IS NOT NULL AND h.start_at < pop.cutoff
                     AND h.lead_h <= 168) AS m
            FROM pop
        )
        SELECT jsonb_build_object('hours', 168, 'n', count(*), 'buyers', COALESCE(sum(per.y7), 0),
                 'expected', round(COALESCE(sum(per.p * q.fi / GREATEST(1e-9, 1 - per.p * (1 - q.fi))), 0)::numeric, 1))
          INTO v_bt
          FROM per CROSS JOIN fk
          CROSS JOIN LATERAL (SELECT (v_prior * COALESCE(fk.f, 1) + per.m) / (v_prior + per.n) AS fi) q;
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
            'backtest', v_bt,
            'recent', jsonb_build_object('pairs', v_rn, 'rate', round(v_rate::numeric, 4)),
            'timing_prior', v_prior,
            'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000))),
          now())
  ON CONFLICT (scope_key) DO UPDATE SET status = EXCLUDED.status, features = EXCLUDED.features, mean = EXCLUDED.mean,
    sd = EXCLUDED.sd, beta = EXCLUDED.beta, metrics = EXCLUDED.metrics, trained_at = EXCLUDED.trained_at;

  -- Le score des soirées à venir (seulement avec un modèle validé).
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key;
  DELETE FROM public.crm_score_night WHERE scope_key = v_key;
  IF v_status = 'ok' THEN
    PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, true);
    -- Parts des achats encore à venir, H = heures restantes avant la soirée :
    -- celle des clients déjà venus (F, à priori de chaque personne) et celle
    -- des PREMIERS achats (projection des nouveaux, crm_score_night).
    ALTER TABLE _scx ADD COLUMN h float8, ADD COLUMN f_known float8, ADD COLUMN f_new float8;
    UPDATE _scx x SET h = GREATEST(0, extract(epoch FROM x.start_at - now()) / 3600.0);
    UPDATE _scx x SET
      f_known = COALESCE(
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL AND a.k > 1),
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1),
      f_new = COALESCE(
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL AND a.k = 1),
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1);
    INSERT INTO public.crm_score_night (scope_key, event_id, remaining_share)
    SELECT v_key, x.event_id, x.f_new FROM _scx x WHERE x.event_id IS NOT NULL;
    -- Le rythme d'achat de chaque personne (tout son historique).
    DROP TABLE IF EXISTS _sct;
    CREATE TEMP TABLE _sct ON COMMIT DROP AS
    SELECT x.xid, a.em, count(*) AS n, count(*) FILTER (WHERE a.lead_h <= x.h) AS m
      FROM _scx x CROSS JOIN _ana a
     WHERE a.has_sale AND a.lead_h IS NOT NULL
     GROUP BY x.xid, a.em;
    CREATE INDEX ON _sct (xid, em);
    -- Les personnes sans place : déjà venues à l'ouverture de la vente
    -- (facteurs à cette date, notées par le modèle), ou venues pour la
    -- première fois depuis (taux du compte pour ce cas).
    DROP TABLE IF EXISTS _scw;
    CREATE TEMP TABLE _scw ON COMMIT DROP AS
    SELECT x.xid, p.em, p.first_at < x.cutoff AS known
      FROM _scx x
      CROSS JOIN (SELECT em, min(start_at) AS first_at FROM _ana GROUP BY em) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.event_id = x.event_id AND lower(t.buyer_email) = p.em AND t.status IN ('valid', 'transferred'));
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    SELECT w.xid, w.em, 0 AS y, 1.0::float8 AS w FROM _scw w WHERE w.known;
    PERFORM public._crm_score_build(v_cfg);
    PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
    -- Facteurs dont la famille d'hypothèse n'est pas confirmée sur le compte :
    -- jamais une raison (décision de Paul, 07/10).
    v_blocked := ARRAY(
      SELECT DISTINCT fs.family FROM public.crm_family_status fs
       WHERE fs.scope_key = v_key AND fs.variant = '' AND fs.status = 'not_supported');
    -- Chance d'acheter D'ICI la soirée, sachant qu'il n'a pas encore acheté :
    -- p·f / (1 − p·(1 − f)), f = sa part des achats encore à venir.
    INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
    SELECT v_key, x.event_id, v.em, q.pa,
           CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
           -- Raisons : les facteurs qui poussent sa chance vers le haut ET qu'il
           -- possède vraiment (un trait à zéro n'est jamais une raison) ; « de
           -- passage » et « découverte Shotgun » décrivent un contexte, jamais
           -- une raison de venir ; une famille pas confirmée sur le compte non plus.
           -- Deux facteurs du même libellé (artiste vu, artiste vu récemment)
           -- comptent une fois, avec leur poids cumulé.
           ARRAY(SELECT z.k FROM (
                   SELECT public._crm_score_reason_key(v_feat[v_idx[gi]]) AS k, sum(v.c[gi]) AS c
                     FROM generate_subscripts(v.c, 1) gi
                    WHERE v.c[gi] > 0 AND public._crm_score_reason_key(v_feat[v_idx[gi]]) IS NOT NULL
                      AND (v_feat[v_idx[gi]] = 'rec' OR f.f[v_idx[gi]] > 0)
                    GROUP BY 1) z
                  WHERE z.c > 0.15
                    AND NOT COALESCE(public._crm_score_reason_family(z.k) = ANY (v_blocked), false)
                  ORDER BY z.c DESC LIMIT 3)
      FROM _scv v JOIN _scx x ON x.xid = v.xid
      JOIN _scf f ON f.xid = v.xid AND f.em = v.em
      LEFT JOIN _sct t ON t.xid = v.xid AND t.em = v.em
      CROSS JOIN LATERAL (SELECT (v_prior * x.f_known + COALESCE(t.m, 0)) / (v_prior + COALESCE(t.n, 0)) AS fi) z
      CROSS JOIN LATERAL (SELECT v.p * z.fi / GREATEST(1e-9, 1 - v.p * (1 - z.fi)) AS pa) q
     WHERE x.event_id IS NOT NULL;
    GET DIAGNOSTICS v_scored = ROW_COUNT;
    -- Venus pour la première fois depuis l'ouverture de la vente : le taux du
    -- compte, s'il repose sur assez de cas ; aucune raison.
    IF v_rn >= COALESCE((sc->>'recent_min_pairs')::int, 50) AND v_rate IS NOT NULL THEN
      INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
      SELECT v_key, x.event_id, w.em, q.pa,
             CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                  WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
             '{}'::text[]
        FROM _scw w JOIN _scx x ON x.xid = w.xid
        LEFT JOIN _sct t ON t.xid = w.xid AND t.em = w.em
        CROSS JOIN LATERAL (SELECT (v_prior * x.f_known + COALESCE(t.m, 0)) / (v_prior + COALESCE(t.n, 0)) AS fi) z
        CROSS JOIN LATERAL (SELECT v_rate * z.fi / GREATEST(1e-9, 1 - v_rate * (1 - z.fi)) AS pa) q
       WHERE NOT w.known AND x.event_id IS NOT NULL;
      GET DIAGNOSTICS i = ROW_COUNT;
      v_scored := v_scored + i;
    END IF;
    BEGIN
      v_journal := v_journal || jsonb_build_object('logged', public._crm_score_journal(v_key, p_venue_id, p_organizer_user_id));
    EXCEPTION WHEN others THEN
      v_journal := v_journal || jsonb_build_object('journal_error', left(SQLERRM, 200));
    END;
  END IF;
  IF v_journal ? 'settle_error' OR v_journal ? 'journal_error' THEN
    UPDATE public.crm_score_model SET metrics = metrics || jsonb_build_object('journal', v_journal) WHERE scope_key = v_key;
  END IF;

  RETURN jsonb_build_object('scope', v_key, 'status', v_status, 'scored', v_scored, 'journal', v_journal,
    'auc', v_va->'auc', 'auc_base', v_vb->'auc', 'ece', v_va->'ece',
    'auc_active', v_va->'active'->'auc', 'auc_active_base', v_vb->'active'->'auc',
    'backtest', v_bt,
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_score_compute(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_compute(text, uuid) TO service_role;
