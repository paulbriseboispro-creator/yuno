-- ============================================================================
-- SMS CRM : le titre de la soirée sur chaque ligne (la variable {{soirée}} du
-- message), et la taille VIVANTE de l'audience d'un brouillon
-- (crm_sms_draft_sizes : la même règle que crm_sms_audience_preview, une fois
-- par brouillon) — un chiffre gardé sur le brouillon vieillit.
-- Corps repris de la base.
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
    'exclude_buyers', COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false),
    'recent_days', NULLIF(c.segment_filters->>'recent_days', '')::integer,
    'waves', COALESCE((c.segment_filters->>'waves')::boolean, false),
    'quiet_hours', c.quiet_hours,
    'estimated', c.estimated_recipients, 'parts', GREATEST(COALESCE(c.segments_per_message, 1), 1),
    'paused_reason', c.paused_reason);
$function$;

CREATE OR REPLACE FUNCTION public.crm_sms_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := CASE WHEN p_days IN (30, 90) THEN p_days ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => v_days);
  v_pfrom timestamptz := now() - make_interval(days => 2 * v_days);
  v_cur jsonb; v_prev jsonb; v_list jsonb; v_up jsonb; v_last jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_sms_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', v_to);

  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'delivered', COALESCE(sum(delivered), 0),
           'clicked', COALESCE(sum(clicked), 0), 'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0),
           'stop', COALESCE(sum(stop), 0), 'units', COALESCE(sum(n * parts), 0))
    INTO v_cur FROM _css WHERE sent_at >= v_from;
  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'delivered', COALESCE(sum(delivered), 0),
           'clicked', COALESCE(sum(clicked), 0), 'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0),
           'stop', COALESCE(sum(stop), 0), 'units', COALESCE(sum(n * parts), 0))
    INTO v_prev FROM _css WHERE sent_at >= v_pfrom AND sent_at < v_from;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at, 'n', n,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY sent_at), '[]'::jsonb)
    INTO v_list FROM _css WHERE sent_at >= v_from;

  -- Brouillons et envois programmés.
  SELECT COALESCE(jsonb_agg(public._crm_sms_row(c) ORDER BY c.status = 'draft', COALESCE(c.scheduled_at, c.updated_at)), '[]'::jsonb)
    INTO v_up
    FROM public.sms_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND (c.status = 'draft' OR (c.status = 'scheduled' AND c.scheduled_at > now() - interval '1 hour'));

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
    SELECT jsonb_build_object('id', id, 'name', name, 'body', body, 'sender_name', sender_name, 'sent_at', sent_at,
             'event_title', (SELECT e.title FROM public.events e WHERE e.id = _css.event_id),
             'n', n, 'delivered', delivered, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
      FROM _css ORDER BY sent_at DESC LIMIT 3) z;

  RETURN jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'current', v_cur, 'previous', v_prev,
    'campaigns', v_list, 'upcoming', v_up, 'last', v_last, 'ever_sent', EXISTS (SELECT 1 FROM _css));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sms_overview__core(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sms_overview__core(text, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_sms_draft_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR c IN
    SELECT * FROM public.sms_campaigns x
     WHERE x.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
       AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     LIMIT 40
  LOOP
    v := v || jsonb_build_object(c.id::text, COALESCE((public.crm_sms_audience_preview(
      p_venue_id, p_organizer_user_id, COALESCE(c.segment_filters->'audiences', '[]'::jsonb), c.event_id,
      NULLIF(c.segment_filters->>'recent_days', '')::integer,
      COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false), c.id)->>'net')::integer, 0));
  END LOOP;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_sms_draft_sizes(text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_draft_sizes(text, uuid, uuid[]) TO authenticated, service_role;

-- Aperçu démo : la taille d'audience crée des tables temporaires.
CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(coalesce(p_name, '')) = ANY (ARRAY[
    -- CTA « Activer mon compte » des sessions vitrine (seul canal d'écriture voulu)
    'request_showcase_claim',
    -- mesure d'audience / live view (battements, vues, clics)
    'ping_live_visitor', 'platform_heartbeat', 'track_platform_view',
    'track_links_event', 'ping_affiliate_live', 'flush_affiliate_session',
    'track_guest_artist_click',
    -- parcours client consultable depuis la démo (anti-flood, déverrouillage)
    'check_promo_code', 'unlock_event_sale', 'open_discovery_selection',
    -- écrans de lecture dont le calcul passe par une table temporaire / un cache
    'list_contact_base', 'count_contact_segment_def', 'analyze_contact_lists',
    'check_contact_import', 'get_contact_intelligence_overview',
    'get_contact_segment_panel', 'get_campaign_list_impact',
    'get_dj_audience', 'get_tracked_link_stats', 'get_user_nightlife_stats',
    'seed_event_tracked_links', 'seed_guest_list_tracked_links',
    'seed_venue_tracked_links', 'demo_is_live',
    -- composition d'un email (20260927162000) : rien de tout ça n'envoie
    'save_contact_segments', 'bump_email_template_usage',
    'refresh_contact_engagement', 'refresh_campaign_list_impacts',
    -- Console Yuno CRM : lectures calculées dans des tables temporaires
    'crm_home', 'crm_clients_overview', 'crm_clients_list', 'crm_client',
    'crm_audience_count', 'crm_audience_counts', 'crm_segments_brief',
    'crm_segments_overview', 'crm_segment_detail', 'crm_import_check',
    'crm_email_overview', 'crm_email_campaigns', 'crm_email_analysis',
    'crm_email_result', 'crm_email_result_segments', 'crm_email_recipients',
    'crm_email_recipient_emails', 'crm_email_send_options',
    'crm_email_audience_preview', 'crm_email_audience_sizes',
    'crm_night_detail', 'crm_rules_preview',
    'crm_ana_sales', 'crm_ana_traffic', 'crm_ana_community',
    'crm_journey', 'crm_automations',
    'crm_sms_overview', 'crm_sms_campaigns', 'crm_sms_result', 'crm_sms_analysis',
    'crm_sms_send_options', 'crm_sms_audience_preview', 'crm_sms_settings_get', 'crm_sms_draft_sizes'
  ]::text[]);
$function$;
