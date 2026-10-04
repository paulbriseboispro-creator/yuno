-- ============================================================================
-- SMS CRM : le modèle d'origine d'un SMS (segment_filters.tpl), écrit par
-- crm_sms_save et rendu sur chaque ligne : l'écran Modèles montre le taux de
-- clic des SMS partis de chaque modèle. Corps repris de la base.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._crm_sms_row(c sms_campaigns)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'body', c.body_template, 'sender_name', c.sender_name,
    'status', c.status, 'scheduled_at', c.scheduled_at, 'sent_at', c.sent_at,
    'updated_at', c.updated_at, 'created_at', c.created_at, 'event_id', c.event_id,
    'event_title', (SELECT e.title FROM public.events e WHERE e.id = c.event_id),
    'audiences', COALESCE(c.segment_filters->'audiences', '[]'::jsonb),
    'tpl', NULLIF(c.segment_filters->>'tpl', ''),
    'exclude_buyers', COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false),
    'recent_days', NULLIF(c.segment_filters->>'recent_days', '')::integer,
    'waves', COALESCE((c.segment_filters->>'waves')::boolean, false),
    'quiet_hours', c.quiet_hours,
    'estimated', c.estimated_recipients, 'parts', GREATEST(COALESCE(c.segments_per_message, 1), 1),
    'paused_reason', c.paused_reason);
$function$;

CREATE OR REPLACE FUNCTION public.crm_sms_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_id uuid := p_id;
  v_filters jsonb;
  v_event uuid;
  v_sender text;
  v_rd integer;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN p_patch := '{}'::jsonb; END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO c FROM public.sms_campaigns x
     WHERE x.id = v_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF c.status <> 'draft' THEN RAISE EXCEPTION 'not_draft' USING ERRCODE = '22023'; END IF;
  END IF;

  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL THEN
    SELECT e.id INTO v_event FROM public.events e
     WHERE e.id = (p_patch->>'event_id')::uuid
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));
    IF v_event IS NULL THEN RAISE EXCEPTION 'bad_event' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_patch ? 'sender_name' THEN
    v_sender := NULLIF(btrim(COALESCE(p_patch->>'sender_name', '')), '');
    IF v_sender IS NOT NULL AND v_sender !~ '^[A-Za-z0-9]{3,11}$' THEN
      RAISE EXCEPTION 'bad_sender' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_rd := CASE WHEN (p_patch->>'recent_days') ~ '^[0-9]+$' AND (p_patch->>'recent_days')::int BETWEEN 1 AND 90
               THEN (p_patch->>'recent_days')::int END;

  -- Audience CRM : « type » = crm, que l'ancien moteur refuse de mettre en file.
  v_filters := COALESCE(c.segment_filters, '{}'::jsonb) || jsonb_build_object('type', 'crm');
  IF p_patch ? 'audiences' THEN
    v_filters := v_filters || jsonb_build_object('audiences',
      CASE WHEN jsonb_typeof(p_patch->'audiences') = 'array' THEN p_patch->'audiences' ELSE '[]'::jsonb END);
  END IF;
  IF p_patch ? 'exclude_buyers' THEN v_filters := v_filters || jsonb_build_object('exclude_buyers', COALESCE((p_patch->>'exclude_buyers')::boolean, false)); END IF;
  IF p_patch ? 'recent_days' THEN v_filters := v_filters || jsonb_build_object('recent_days', v_rd); END IF;
  IF p_patch ? 'waves' THEN v_filters := v_filters || jsonb_build_object('waves', COALESCE((p_patch->>'waves')::boolean, false)); END IF;
  -- Le modèle d'origine (« Vos envois » de l'écran Modèles).
  IF p_patch ? 'tpl' THEN
    v_filters := v_filters || jsonb_build_object('tpl', CASE WHEN p_patch->>'tpl' ~ '^[a-z]{2,20}$' THEN p_patch->>'tpl' END);
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                      event_id, sender_name, quiet_hours, scheduled_at, estimated_recipients, segments_per_message, estimated_credits)
    VALUES (p_venue_id, p_organizer_user_id, auth.uid(),
            left(COALESCE(NULLIF(btrim(p_patch->>'name'), ''), 'SMS'), 120),
            left(COALESCE(p_patch->>'body', ''), 1000),
            v_filters, 'draft', v_event, v_sender,
            COALESCE((p_patch->>'quiet_hours')::boolean, true),
            NULLIF(p_patch->>'scheduled_at', '')::timestamptz,
            GREATEST(COALESCE((p_patch->>'estimated')::int, 0), 0),
            LEAST(GREATEST(COALESCE((p_patch->>'parts')::int, 1), 1), 10),
            GREATEST(COALESCE((p_patch->>'estimated')::int, 0), 0) * LEAST(GREATEST(COALESCE((p_patch->>'parts')::int, 1), 1), 10))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.sms_campaigns x SET
      name = CASE WHEN p_patch ? 'name' THEN left(COALESCE(NULLIF(btrim(p_patch->>'name'), ''), x.name), 120) ELSE x.name END,
      body_template = CASE WHEN p_patch ? 'body' THEN left(COALESCE(p_patch->>'body', ''), 1000) ELSE x.body_template END,
      segment_filters = v_filters,
      event_id = CASE WHEN p_patch ? 'event_id' THEN v_event ELSE x.event_id END,
      sender_name = CASE WHEN p_patch ? 'sender_name' THEN v_sender ELSE x.sender_name END,
      quiet_hours = CASE WHEN p_patch ? 'quiet_hours' THEN COALESCE((p_patch->>'quiet_hours')::boolean, true) ELSE x.quiet_hours END,
      scheduled_at = CASE WHEN p_patch ? 'scheduled_at' THEN NULLIF(p_patch->>'scheduled_at', '')::timestamptz ELSE x.scheduled_at END,
      estimated_recipients = CASE WHEN p_patch ? 'estimated' THEN GREATEST(COALESCE((p_patch->>'estimated')::int, 0), 0) ELSE x.estimated_recipients END,
      segments_per_message = CASE WHEN p_patch ? 'parts' THEN LEAST(GREATEST(COALESCE((p_patch->>'parts')::int, 1), 1), 10) ELSE x.segments_per_message END
     WHERE x.id = v_id;
    UPDATE public.sms_campaigns x SET estimated_credits = x.estimated_recipients * x.segments_per_message WHERE x.id = v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_save(text, uuid, uuid, jsonb) TO authenticated, service_role;
