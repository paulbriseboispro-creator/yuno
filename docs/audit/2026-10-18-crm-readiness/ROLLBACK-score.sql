-- Retour arrière de 20261027100000_crm_score_fit_once_per_row.sql (PERF-01).
-- _crm_logit_fit : définition lue en prod le 19/10 AVANT la correction
-- (pg_get_functiondef, = 20261014100000_crm_score_timing.sql).
-- _crm_score_journal : la jointure des audiences est remise comme avant, en
-- place. Le calcul redevient lent (p recopié dans chaque somme, audiences
-- jointes en boucle) : sur Amoris, le cron crm-score-nightly retombe à
-- ~118 s pour un délai de 120 s.
-- Jouer dans une transaction, puis supabase db lint --linked.

CREATE OR REPLACE FUNCTION public._crm_logit_fit(p_k integer, p_l2 double precision, p_iter integer, p_start double precision[] DEFAULT NULL::double precision[], p_tol double precision DEFAULT 0.000001)
 RETURNS double precision[]
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

-- _crm_score_journal : patch inverse EN PLACE (la fonction peut porter aussi
-- la correction DATA-08b, 20261022150000, qu'une réécriture complète effacerait).
DO $do$
DECLARE
  v_old text := 'LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope AND s.event_id = g.event_id AND s.email = g.email';
  v_new text := 'LEFT JOIN LATERAL (SELECT x.p FROM public.crm_person_night_score x
                                                 WHERE x.scope_key = p_scope AND x.event_id = g.event_id AND x.email = g.email
                                                OFFSET 0) s ON true  -- par la clé, une ligne au plus (PERF-01)';
  v_def text := pg_get_functiondef('public._crm_score_journal(text, text, uuid)'::regprocedure);
BEGIN
  IF strpos(v_def, v_new) = 0 THEN
    RAISE EXCEPTION '_crm_score_journal : correction PERF-01 introuvable, définition à relire';
  END IF;
  EXECUTE replace(v_def, v_new, v_old);
END
$do$;
REVOKE ALL ON FUNCTION public._crm_score_journal(text, text, uuid) FROM PUBLIC, anon, authenticated;
