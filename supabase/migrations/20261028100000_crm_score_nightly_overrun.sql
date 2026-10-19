-- ============================================================================
-- Yuno CRM — « Chances de venir » : un compte trop lent ne prive plus les
-- autres de leur calcul de nuit (2026-10-19, PERF-02). Constat, banc et retour
-- arrière : docs/audit/2026-10-18-crm-readiness/BACKLOG.md (PERF-02),
-- ROLLBACK-score-overrun.sql à côté.
--
-- Constat (prod, cron crm-score-nightly, 18/10) : le calcul d'Amoris a été
-- coupé par le délai de 120 s (statement_timeout) aux passes de 05:27, 05:57
-- et 06:27 UTC. Un délai dépassé lève query_canceled (57014), que le
-- « EXCEPTION WHEN others » de crm_score_nightly n'attrape JAMAIS (PL/pgSQL
-- l'exclut de « others ») : toute la passe était annulée, trained_at ne
-- bougeait pas, et la même portée repassait en tête de file
-- (ORDER BY trained_at NULLS FIRST, une portée par passe, quatre passes par
-- nuit). Le compte démo, deuxième de la file, n'a pas été noté ce jour-là.
-- PERF-01 (20261027100000) ramène Amoris loin du délai ; le jour où un compte
-- quatre à cinq fois plus gros arrive, le défaut revient sans cette migration.
--
-- Règle (décisions de Paul du 19/10) :
--   • Un calcul qui ne tient pas dans le temps GARDE les chances d'hier : le
--     modèle, les chances, les étiquettes et le journal prévu / réel restent
--     ceux du dernier calcul réussi (tout ce que le calcul avait écrit est
--     annulé). La fiche client, « Qui cibler » et les conditions de scénario
--     lisent donc la veille ; elles écartent déjà qui a pris une place depuis.
--   • La portée passe derrière les autres : score_overrun_at compte comme une
--     attente terminée dans l'ordre de la file (GREATEST(trained_at,
--     score_overrun_at)). Elle n'est retentée cette nuit que si une passe reste
--     libre, et les nuits suivantes elle ne prend plus la première passe.
--     Sans aucun dépassement, l'ordre est exactement celui d'avant.
--   • Une alerte super admin par compte et par nuit (type existant
--     admin_crm_analysis_failed : son libellé, son lien vers le tiroir du
--     compte dans l'Admin CRM et ses trois langues existent déjà).
--
-- Comment le temps manque, et comment il est rattrapé :
--   1. Le délai de l'instruction (statement_timeout, 120 s en prod). Le
--      gestionnaire attrape query_canceled PAR SON NOM, mais seulement si
--      l'instruction a vraiment atteint son délai (au moins 90 % de
--      statement_timeout écoulés) : une annulation à la main
--      (pg_cancel_backend) remonte comme avant. Le minuteur ne se réarme pas
--      après avoir sonné : le gestionnaire (une mise à jour d'une ligne, une
--      alerte) tourne sans délai, sous un lock_timeout de 5 s.
--   2. Un budget facultatif, score.budget_s dans crm_analysis_config()
--      (crm_analysis_rules) : ABSENT par défaut. Un budget plus court que le
--      délai couperait un calcul qui aurait tenu (le 18/10, la 4ᵉ passe a
--      réussi en 118,3 s) : la règle de la prod reste le délai. Posé, il est
--      relu entre les étapes de crm_score_compute (chargement, paires
--      d'apprentissage, ajustement, évaluation, note, journal) et lève
--      l'erreur ordinaire YS001, traitée comme un délai dépassé. Il sert au
--      banc (prouver la règle sur un vrai calcul, PGlite n'a pas de minuteur)
--      et, si besoin un jour, à rendre la passe plus tôt.
--   Une autre erreur (bug, données) garde le traitement d'avant : modèle
--   « failed », chances supprimées.
--
-- Où la trace survit : la passe coupée par le délai est annulée, donc rien
-- de ce qu'elle a écrit ne reste ; attraper l'erreur dans crm_score_nightly
-- laisse la transaction de la passe vivante, et c'est elle qui écrit
-- score_overrun_at. Pas de lecture de cron.job_run_details.
--
-- Points de contrôle du budget : posés EN PLACE dans crm_score_compute par un
-- bloc DO (la définition de la prod est relue, chaque repère doit y figurer
-- une fois, sinon la migration échoue sans rien changer), comme PERF-01 l'a
-- fait pour _crm_score_journal : une autre réécriture de la fonction n'est
-- jamais effacée. Sans score.budget_s, un point de contrôle ne fait que lire
-- sa configuration.
--
-- Banc (scripts/crm-bench/score-nightly.mjs, définitions de la prod, compte
-- amoris) : `run … --nightly` (les six tables du score identiques avant /
-- après sans dépassement) et `overrun` (budget abaissé puis délai simulé :
-- la portée lente garde ses chances d'hier et cède la passe, la suivante est
-- notée, l'alerte ne part qu'une fois, une annulation à la main remonte).
-- ============================================================================

-- ── 1. La trace d'un dépassement, par portée ────────────────────────────────
ALTER TABLE public.crm_analysis_state
  ADD COLUMN IF NOT EXISTS score_overrun_at timestamptz,
  ADD COLUMN IF NOT EXISTS score_overrun jsonb;

COMMENT ON COLUMN public.crm_analysis_state.score_overrun_at IS
  'PERF-02 : dernier calcul de nuit du score (crm_score_nightly) arrêté faute de temps ; la file le compte comme une attente terminée.';
COMMENT ON COLUMN public.crm_analysis_state.score_overrun IS
  'PERF-02 : ce dépassement — kind (timeout | budget), phase, ms, sqlstate, context (code seulement, aucune donnée).';

-- ── 2. Le budget facultatif ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_score_budget(p_sc jsonb, p_phase text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $$
DECLARE
  v_budget float8 := CASE WHEN jsonb_typeof(p_sc->'budget_s') = 'number' THEN (p_sc->>'budget_s')::float8 END;
  v_spent  float8;
BEGIN
  -- Absent (le défaut) ou nul : aucun budget, seul le délai de l'instruction compte.
  IF v_budget IS NULL OR v_budget <= 0 THEN RETURN; END IF;
  v_spent := extract(epoch FROM clock_timestamp() - statement_timestamp());
  IF v_spent > v_budget THEN
    RAISE EXCEPTION 'crm_score_budget' USING ERRCODE = 'YS001', HINT = p_phase,
      DETAIL = format('%s s > %s s', round(v_spent::numeric, 1), v_budget);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_score_budget(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_score_budget(jsonb, text) TO service_role;

-- ── 3. Les points de contrôle, posés en place dans crm_score_compute ───────
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.crm_score_compute(text,uuid)'::regprocedure);
  r record;
  v_at integer;
  v_ind text;
  v_line text;
BEGIN
  IF strpos(v_def, '_crm_score_budget(') > 0 THEN
    RAISE NOTICE 'PERF-02 : crm_score_compute porte déjà ses points de contrôle';
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      -- après le chargement (billets, achats, soirées à apprendre)
      (1, 'load', 'after', E'  PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, false);\n'),
      -- après les paires d'apprentissage et leurs facteurs
      (2, 'pairs', 'after', E'    UPDATE _scf f SET valid = p.valid FROM _scp p WHERE p.xid = f.xid AND p.em = f.em;\n'),
      -- après les deux ajustements (modèle et modèle naïf)
      (3, 'fit', 'before', E'      -- Validation sur les soirées tenues à l''écart (population complète).\n'),
      -- après l'évaluation, avant d'écrire le modèle
      (4, 'model', 'before', E'  INSERT INTO public.crm_score_model AS m (scope_key, venue_id, organizer_user_id, status, features, mean, sd, beta, metrics, trained_at)\n'),
      -- avant la note des soirées à venir
      (5, 'note', 'before', E'    -- Facteurs dont la famille d''hypothèse n''est pas confirmée sur le compte :\n'),
      -- avant le journal (hors de son bloc EXCEPTION WHEN others, qui avalerait YS001)
      (6, 'journal', 'before', E'    BEGIN\n      v_journal := v_journal || jsonb_build_object(''logged'', public._crm_score_journal(')
    ) a(o, phase, pos, anchor)
    ORDER BY o
  LOOP
    v_at := strpos(v_def, r.anchor);
    IF v_at = 0 OR strpos(substr(v_def, v_at + 1), r.anchor) > 0 THEN
      RAISE EXCEPTION 'PERF-02 : repère « % » introuvable ou en double dans crm_score_compute', r.phase;
    END IF;
    v_ind := substring(r.anchor FROM '^ *');
    v_line := v_ind || 'PERFORM public._crm_score_budget(sc, ''' || r.phase || E''');\n';
    v_def := CASE r.pos
      WHEN 'after' THEN replace(v_def, r.anchor, r.anchor || v_line)
      ELSE replace(v_def, r.anchor, v_line || r.anchor) END;
  END LOOP;
  EXECUTE v_def;
END
$patch$;
REVOKE ALL ON FUNCTION public.crm_score_compute(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_compute(text, uuid) TO service_role;

-- ── 4. La passe de nuit ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_score_nightly()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; v_r jsonb;
  v_limit_ms float8; v_ms integer; v_kind text; v_phase text; v_ctx text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- La portée qui attend depuis le plus longtemps. Un calcul arrêté faute de
  -- temps (score_overrun_at) compte comme une attente terminée : la portée
  -- lente passe derrière les autres, cette nuit (retentée seulement si une
  -- passe reste libre) et les suivantes. Sans dépassement, l'ordre d'avant.
  SELECT st.scope_key, st.venue_id, st.organizer_user_id INTO s
    FROM public.crm_analysis_state st
    LEFT JOIN public.crm_score_model m ON m.scope_key = st.scope_key
   WHERE st.full_at IS NOT NULL
     AND (m.trained_at IS NULL OR m.trained_at < date_trunc('day', now()))
     AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                  WHERE c.status <> 'disconnected' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = st.scope_key)
   ORDER BY GREATEST(m.trained_at, st.score_overrun_at) NULLS FIRST
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('scopes', 0); END IF;
  BEGIN
    v_r := public.crm_score_compute(s.venue_id, s.organizer_user_id);
  EXCEPTION
    -- Le calcul ne tient pas dans le temps : délai de l'instruction (57014,
    -- jamais attrapé par « others ») ou budget facultatif (YS001). Tout ce
    -- qu'il a écrit est annulé : les chances d'hier restent (décision de Paul,
    -- 19/10), la portée passe derrière les autres.
    WHEN SQLSTATE 'YS001' OR query_canceled THEN
      IF SQLSTATE = '57014' THEN
        -- Une annulation à la main n'est pas un délai dépassé : elle remonte.
        SELECT setting::float8 INTO v_limit_ms FROM pg_settings WHERE name = 'statement_timeout';
        IF NOT (v_limit_ms > 0
                AND extract(epoch FROM clock_timestamp() - statement_timestamp()) * 1000 >= 0.9 * v_limit_ms) THEN
          RAISE;
        END IF;
      END IF;
      GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT, v_phase = PG_EXCEPTION_HINT;
      IF SQLSTATE = 'YS001' THEN
        v_kind := 'budget';
      ELSE
        -- La fonction la plus profonde où le temps a manqué (le contexte ne
        -- porte que du code, jamais une donnée).
        v_kind := 'timeout';
        v_phase := (regexp_match(v_ctx, 'PL/pgSQL function (?:public\.)?([a-z0-9_]+)\('))[1];
      END IF;
      v_ms := round(extract(epoch FROM clock_timestamp() - statement_timestamp()) * 1000);
      -- Après un délai dépassé, le minuteur ne se réarme pas : rien ne doit
      -- attendre un verrou indéfiniment.
      PERFORM set_config('lock_timeout', '5s', true);
      UPDATE public.crm_analysis_state
         SET score_overrun_at = now(),
             score_overrun = jsonb_build_object('kind', v_kind, 'phase', v_phase, 'ms', v_ms,
                                                'sqlstate', SQLSTATE, 'context', left(v_ctx, 600))
       WHERE scope_key = s.scope_key;
      -- Une alerte par compte et par nuit ; elle ne coûte jamais la trace.
      BEGIN
        PERFORM public.emit_admin_notification(
          'admin_crm_analysis_failed', 'Yuno CRM : « Chances de venir » n''a pas tenu dans le délai',
          format('Calcul de nuit arrêté au bout de %s s (%s, étape %s). Les chances du dernier calcul réussi sont gardées ; le compte passe derrière les autres.',
                 round(v_ms / 1000.0), CASE v_kind WHEN 'timeout' THEN 'délai de 120 s' ELSE 'budget' END, COALESCE(v_phase, '?')),
          'normal', 'crm_scope', s.scope_key,
          jsonb_build_object('sqlstate', SQLSTATE, 'kind', v_kind, 'phase', v_phase, 'ms', v_ms),
          'crm_score_overrun:' || s.scope_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
      EXCEPTION WHEN others THEN
        NULL;
      END;
      RETURN jsonb_build_object('scope', s.scope_key, 'overrun', v_kind, 'phase', v_phase, 'ms', v_ms);
    WHEN others THEN
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
