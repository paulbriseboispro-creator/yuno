-- ============================================================================
-- Yuno CRM — « Chances de venir » : le calcul de nuit tient dans son délai
-- (2026-10-19). Constat, banc et retour arrière :
-- docs/audit/2026-10-18-crm-readiness/BACKLOG.md (PERF-01),
-- ROLLBACK-score.sql à côté.
--
-- Constat (prod, cron crm-score-nightly, 18/10) : 3 passes sur 4 annulées par
-- le délai de 120 s (statement_timeout du fichier de configuration, aucun
-- réglage propre au rôle postgres) sur le compte d'Amoris, le premier vrai
-- compte (280 soirées, 48 388 billets, 16 952 profils, 171 705 paires
-- d'apprentissage). La quatrième a réussi en 118,3 s, à 1,7 s du délai ; le
-- modèle seul (avant la note et le journal) en prenait 111,8 s
-- (crm_score_model.metrics.ms). Les messages d'erreur citaient le journal
-- (_crm_night_target_set, puis l'INSERT de crm_prediction_people) parce que
-- c'est la dernière étape : le temps était parti avant.
--
-- Où il part (banc scripts/crm-bench/score-nightly.mjs, définitions de la
-- prod, compte « amoris » de 18 800 contacts, 60 000 billets et 280 soirées,
-- départ à froid et modèle « ok » comme le 18/10 ; PGlite, deux à trois fois
-- plus lent que la prod) : 244,7 s au total, dont 202 s dans _crm_logit_fit
-- (8 itérations de Newton avec la hessienne, 22 s chacune) et 12,3 s dans
-- l'INSERT de crm_prediction_nights du journal.
--
-- Cause 1 (_crm_logit_fit) : la sous-requête qui calcule la probabilité p de
-- chaque ligne est « aplatie » par le planificateur, qui recopie l'expression
-- de p dans CHACUNE des sommes (14 du gradient, 105 de la hessienne pour 14
-- variables). Chaque ligne refaisait ainsi ~120 fois la combinaison linéaire
-- de 14 termes et l'exponentielle. PostgreSQL ne met pas en commun une
-- sous-expression répétée.
-- Correction 1 : p est calculé une fois par ligne dans une sous-requête que
-- OFFSET 0 empêche d'aplatir, puis r = w·(y − p) et q = w·p·(1 − p) une fois
-- aussi ; les sommes lisent r·xᵢ et q·xᵢ·xⱼ. Ce sont les MÊMES produits, dans
-- le même ordre (l'ancienne expression w * p * (1 - p) * xi * xj se lit
-- ((w·p)·(1 − p))·xi·xj, soit q·xi·xj), sur les mêmes lignes lues dans le même
-- ordre (_scz est une table temporaire : jamais de lecture parallèle) : les
-- coefficients sont identiques au bit près. Rien d'autre ne change : nombre
-- d'itérations, critère d'arrêt, règle de réutilisation de la hessienne,
-- départ à chaud.
--
-- Cause 2 (_crm_score_journal) : la répartition des chances par audience
-- « Qui cibler » joignait chaque membre d'audience à crm_person_night_score.
-- La table vient d'être vidée puis réécrite dans la même transaction : ses
-- statistiques décrivent la veille, le planificateur croit la soirée presque
-- vide et choisit une boucle qui compare chaque membre d'audience à chaque
-- personne notée (27 928 × 18 557 au banc : 258 millions de comparaisons ;
-- quadratique dans la taille du compte).
-- Correction 2 : la chance de chaque membre se lit par la clé primaire
-- (scope_key, event_id, email), une ligne au plus, dans une sous-requête
-- LATERAL que OFFSET 0 garde entière (jointe à plat, sans statistiques
-- fraîches, elle redevenait la boucle). Même ligne lue pour chaque membre, mêmes
-- comptes, mêmes sommes, dans le même ordre (arrondies au centième comme
-- avant).
--
-- Mesure au banc, les deux calculs dans UNE transaction (même now(), même
-- état de départ), trois fois : 243-250 s → 47-49 s à froid ; à chaud (modèle
-- d'hier) 68-70 s → 32 s. crm_score_model (coefficients au bit près),
-- crm_score_night, crm_person_night_score (18 557 chances et étiquettes),
-- crm_prediction_nights et crm_prediction_people (37 114 lignes) sont
-- identiques ligne à ligne avant et après ; seules les sommes en real du
-- journal varient au 7e chiffre, comme entre deux passages sans migration.
--
-- Définition de départ de _crm_logit_fit : pg_get_functiondef de la prod le
-- 19/10 (= dépôt, 20261014100000_crm_score_timing.sql). _crm_score_journal
-- est corrigé en place, sur la définition que la base a au moment de
-- l'application (section 2).
-- ============================================================================

-- Newton, une requête par itération. La hessienne (105 sommes pour 14
-- variables, l'essentiel du temps) n'est recalculée qu'aux deux premières
-- itérations et quand le pas reste grand ; ensuite seul le gradient est relu
-- et la hessienne précédente resservie : la convergence ne change pas (même
-- critère d'arrêt), le temps oui (banc, compte « grand »).
-- p, puis r = w·(y − p) et q = w·p·(1 − p), une fois par ligne : OFFSET 0
-- garde chaque sous-requête entière (aplatie, elle recopiait l'expression de p
-- dans chacune des ~120 sommes, 202 s sur 245 au banc « amoris »).
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
    gsql := gsql || CASE WHEN i > 1 THEN ', ' ELSE '' END || format('sum(r * x%s)', i);
    FOR j IN i..n LOOP
      hsql := hsql || CASE WHEN hsql <> '' THEN ', ' ELSE '' END || format('sum(q * x%s * x%s)', i, j);
    END LOOP;
  END LOOP;
  FOR it IN 1..p_iter LOOP
    dot := '';
    FOR i IN 1..n LOOP
      dot := dot || CASE WHEN i > 1 THEN ' + ' ELSE '' END || format('(%s)::float8 * x%s', beta[i], i);
    END LOOP;
    full_h := it <= 2 OR h IS NULL OR mx > 0.05;
    IF full_h THEN
      EXECUTE format('SELECT ARRAY[%s]::float8[], ARRAY[%s]::float8[] FROM ('
                     'SELECT *, w * (y - p) AS r, w * p * (1 - p) AS q FROM ('
                     'SELECT *, 1 / (1 + exp(-LEAST(30, GREATEST(-30, %s)))) AS p FROM _scz OFFSET 0) zp OFFSET 0) z',
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
      EXECUTE format('SELECT ARRAY[%s]::float8[] FROM ('
                     'SELECT *, w * (y - p) AS r FROM ('
                     'SELECT *, 1 / (1 + exp(-LEAST(30, GREATEST(-30, %s)))) AS p FROM _scz OFFSET 0) zp OFFSET 0) z',
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

-- ── 2. Le journal prévu / réel : la chance de chaque membre d'audience par la clé ──
-- _crm_score_journal est corrigé EN PLACE : on relit sa définition en base et
-- on ne remplace que la jointure des audiences. La session DATA-08b
-- (20261022150000_crm_night_new_buyers.sql) réécrit la même fonction pour un
-- autre motif (nouveaux acheteurs) ; une réécriture complète ici effacerait
-- l'une des deux corrections selon l'ordre d'application. Ainsi, que
-- 20261022150000 soit passée ou non, seule la jointure change. Déjà corrigée :
-- rien n'est fait ; jointure introuvable : la migration échoue.
DO $do$
DECLARE
  v_old text := 'LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope AND s.event_id = g.event_id AND s.email = g.email';
  v_new text := 'LEFT JOIN LATERAL (SELECT x.p FROM public.crm_person_night_score x
                                                 WHERE x.scope_key = p_scope AND x.event_id = g.event_id AND x.email = g.email
                                                OFFSET 0) s ON true  -- par la clé, une ligne au plus (PERF-01)';
  v_def text := pg_get_functiondef('public._crm_score_journal(text, text, uuid)'::regprocedure);
BEGIN
  IF strpos(v_def, 'LEFT JOIN LATERAL (SELECT x.p FROM public.crm_person_night_score x') > 0 THEN
    RAISE NOTICE '_crm_score_journal : déjà corrigée';
  ELSIF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '_crm_score_journal : jointure des audiences introuvable ou en double, définition à relire';
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$do$;
REVOKE ALL ON FUNCTION public._crm_score_journal(text, text, uuid) FROM PUBLIC, anon, authenticated;
