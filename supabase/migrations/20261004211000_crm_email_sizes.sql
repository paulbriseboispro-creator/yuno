-- ============================================================================
-- Console Yuno CRM — taille de l'audience de plusieurs campagnes en un appel
-- (listes « Quand partent-ils ? » et « Campagnes »). Même règle que l'envoi
-- (_crm_campaign_audience) : base clients du CRM, joignables par e-mail
-- (opt-in, non supprimés), filtre de chaque audience, réunion des audiences.
-- Une campagne déjà mise en file rend son nombre réel de destinataires.
-- ============================================================================

-- Le prédicat SQL d'une liste d'audiences CRM, sur l'alias `p` de _cp.
-- NULL = aucune audience CRM (personne).
CREATE OR REPLACE FUNCTION public._crm_audience_pred(p_audiences jsonb, p_venue_id text, p_organizer_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a jsonb;
  v_def jsonb;
  v_preds text[] := '{}';
BEGIN
  FOR a IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_audiences) = 'array' THEN p_audiences ELSE '[]'::jsonb END) x LOOP
    CONTINUE WHEN a->>'kind' IS DISTINCT FROM 'crm';
    v_def := NULL;
    IF COALESCE(a->>'segmentId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (a->>'segmentId')::uuid
         AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id));
      CONTINUE WHEN v_def IS NULL;
    ELSE
      v_def := COALESCE(a->'def', '{}'::jsonb);
    END IF;
    v_preds := array_append(v_preds, '(' || public._crm_filter_sql(v_def, 'p') || ')');
  END LOOP;
  IF cardinality(v_preds) = 0 THEN RETURN NULL; END IF;
  RETURN array_to_string(v_preds, ' OR ');
END;
$$;

REVOKE ALL ON FUNCTION public._crm_audience_pred(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_audience_pred(jsonb, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_email_audience_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_pred text;
  v_n integer;
  v jsonb := '{}'::jsonb;
  v_built boolean := false;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR c IN
    SELECT ec.id, ec.audiences_json, ec.status, ec.total_recipients
      FROM public.email_campaigns ec
     WHERE ec.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     LIMIT 60
  LOOP
    IF c.status IN ('sending', 'sent', 'paused') AND COALESCE(c.total_recipients, 0) > 0 THEN
      v := v || jsonb_build_object(c.id::text, c.total_recipients);
      CONTINUE;
    END IF;
    v_pred := public._crm_audience_pred(c.audiences_json, p_venue_id, p_organizer_user_id);
    IF v_pred IS NULL THEN
      v := v || jsonb_build_object(c.id::text, 0);
      CONTINUE;
    END IF;
    IF NOT v_built THEN
      PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
      v_built := true;
    END IF;
    EXECUTE format('SELECT count(*) FROM _cp p WHERE p.email_ok AND (%s)', v_pred) INTO v_n;
    v := v || jsonb_build_object(c.id::text, v_n);
  END LOOP;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_audience_sizes(text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_audience_sizes(text, uuid, uuid[]) TO authenticated, service_role;
