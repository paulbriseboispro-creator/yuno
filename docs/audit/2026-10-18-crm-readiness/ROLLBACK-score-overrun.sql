-- Retour arrière de 20261028100000_crm_score_nightly_overrun.sql (PERF-02).
-- crm_score_nightly : définition lue en prod le 19/10 AVANT la correction
-- (pg_get_functiondef). crm_score_compute : les points de contrôle du budget
-- sont retirés EN PLACE (le reste de la fonction n'est pas touché).
-- Effet : un délai dépassé annule de nouveau toute la passe, et la même
-- portée reprend la tête de la file à chaque passe de la nuit.
-- Jouer dans une transaction, puis supabase db lint --linked.

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

DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.crm_score_compute(text,uuid)'::regprocedure);
  v_out text;
BEGIN
  v_out := regexp_replace(v_def, E'\\n *PERFORM public\\._crm_score_budget\\(sc, ''[a-z]+''\\);', '', 'g');
  IF v_out = v_def THEN
    RAISE NOTICE 'crm_score_compute : aucun point de contrôle à retirer';
  ELSE
    EXECUTE v_out;
  END IF;
END
$do$;
REVOKE ALL ON FUNCTION public.crm_score_compute(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_compute(text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public._crm_score_budget(jsonb, text);

ALTER TABLE public.crm_analysis_state
  DROP COLUMN IF EXISTS score_overrun_at,
  DROP COLUMN IF EXISTS score_overrun;
