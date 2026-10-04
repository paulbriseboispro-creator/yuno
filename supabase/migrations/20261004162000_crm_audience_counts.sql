-- ============================================================================
-- Yuno CRM — effectifs de plusieurs définitions en un appel (modèles de la
-- fenêtre « Nouveau segment »). Une seule construction de la base, puis un
-- comptage par définition, dans l'ordre reçu (20 au plus).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_audience_counts(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_defs jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_def jsonb;
  v_n integer;
  v_r integer;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_defs) <> 'array' OR jsonb_array_length(p_defs) = 0 THEN RETURN '[]'::jsonb; END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  FOR v_def IN SELECT x FROM jsonb_array_elements(p_defs) WITH ORDINALITY AS e(x, i) ORDER BY i LIMIT 20 LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s',
                   public._crm_filter_sql(v_def, 'p'))
      INTO v_n, v_r;
    v_out := v_out || jsonb_build_array(jsonb_build_object('total', v_n, 'reachable', v_r));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_audience_counts(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_audience_counts(text, uuid, jsonb) TO authenticated;
