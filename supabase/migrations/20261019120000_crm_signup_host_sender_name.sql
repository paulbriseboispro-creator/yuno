-- Pages d'inscription Yuno CRM : le fan lit le nom des Réglages d'envoi.
--
-- Constaté le 17/10 sur le premier vrai compte (le Shotgun de WOH testé dans
-- l'espace Amoris) : la case d'accord d'une page /j/ disait « Je veux être
-- prévenu(e) par Amoris des prochaines soirées », l'e-mail de confirmation
-- venait d'« Amoris », alors que ces fans connaissent WOH / Club Sonore et que
-- les e-mails partent au nom réglé dans Réglages › Envoi. Décision de Paul
-- (17/10) : la page prend le nom d'expéditeur quand il est rempli.
--
-- Porte unique : crm_space_display_name(venue, orga) = le nom d'expéditeur de
-- crm_email_settings (portée crm_scope_key), sinon le nom du club, sinon le nom
-- public de l'organisateur. Lue par la page publique (get_crm_signup_page.host :
-- case d'accord, pied de page, {{host.name}}), la confirmation par e-mail
-- (crm_signup_confirm_queue) et le kit MCP (brand.name). Miroir Console :
-- signupHostName (src/crm/pages/signup/useSignupHost.ts).
--
-- Le logo, la ville et l'Instagram de la page restent ceux du compte. Le pied
-- de page des e-mails est signé par la raison sociale (footerSigner,
-- migration 20261019103000). Corps des trois fonctions repris de la prod
-- (pg_get_functiondef) : seule la ligne du nom change.

CREATE OR REPLACE FUNCTION public.crm_space_display_name(p_venue_id text, p_organizer_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(s.sender_name), '') FROM public.crm_email_settings s
      WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)),
    (SELECT NULLIF(btrim(v.name), '') FROM public.venues v WHERE v.id = p_venue_id),
    (SELECT NULLIF(btrim(o.display_name), '') FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id));
$function$;

REVOKE ALL ON FUNCTION public.crm_space_display_name(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_space_display_name(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_crm_signup_page(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_state text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug) AND status IN ('live', 'closed');
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_state := public._crm_signup_state(p);
  RETURN jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'occasion', p.occasion, 'theme', p.theme, 'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label,
    'thanks_message', p.thanks_message, 'poster_url', p.poster_url, 'design', p.design, 'custom_design', p.custom_design, 'fields', p.fields, 'reward', p.reward,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'countdown', p.countdown, 'close_at', public._crm_signup_close_at(p),
    'state', CASE v_state WHEN 'scheduled' THEN 'soon' WHEN 'closed' THEN 'closed' ELSE 'open' END,
    'count', CASE WHEN p.show_count THEN (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id) END,
    'demo', public._crm_signup_is_demo(p),
    -- Le nom que le fan lit (case d'accord, pied de page) : celui des Réglages d'envoi.
    'host', COALESCE(public.crm_space_display_name(p.venue_id, p.organizer_user_id), 'Yuno'),
    'event', public._crm_signup_event(p.event_id),
    -- La marque lue par les balises d'un design sur mesure ({{host.logo}}…) : publique déjà sur Yuno.
    'brand', CASE WHEN p.venue_id IS NOT NULL THEN (
        SELECT jsonb_strip_nulls(jsonb_build_object('logo', v.logo_url, 'city', v.city, 'instagram', v.instagram_url))
          FROM public.venues v WHERE v.id = p.venue_id)
      ELSE (
        SELECT jsonb_strip_nulls(jsonb_build_object('logo', o.avatar_url, 'city', o.city, 'instagram', o.instagram_url))
          FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_signup_confirm_queue(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_tok text; v_out jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT e.id, e.email, e.first_name, e.lang, p.slug, p.title, p.thanks_message,
           public.crm_space_display_name(p.venue_id, p.organizer_user_id) AS host
      FROM public.crm_signup_entries e JOIN public.crm_signup_pages p ON p.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirm_sent_at IS NULL AND e.confirmed_at IS NULL AND e.created_at > now() - interval '3 days'
       AND NOT public._crm_signup_is_demo(p) AND NOT public.is_demo_email(e.email)
     ORDER BY e.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
     FOR UPDATE OF e SKIP LOCKED
  LOOP
    v_tok := encode(extensions.gen_random_bytes(24), 'hex');
    UPDATE public.crm_signup_entries SET confirm_hash = encode(sha256(convert_to(v_tok, 'UTF8')), 'hex'), confirm_sent_at = now() WHERE id = r.id;
    v_out := v_out || jsonb_build_object('id', r.id, 'email', r.email, 'first_name', r.first_name, 'lang', r.lang, 'slug', r.slug, 'title', r.title, 'host', r.host, 'token', v_tok);
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_signup_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_ids   uuid[];
  v_event uuid;
  v_lang  text;
  p       public.crm_signup_pages%ROWTYPE;
BEGIN
  IF NOT coalesce(public.crm_scope_allowed(v_venue, v_org), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF NOT ('crm' = ANY (public._mcp_email_products(v_venue, v_org, p_product))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;

  IF p_tool = 'get_signup_page_kit' THEN
    v_ids := public._mcp_signup_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'can_create', public._mcp_space_can_draft(p_uid, v_venue, v_org, 'crm'),
      'can_publish', public._crm_signup_owner(v_venue, v_org),
      'language_hint', coalesce(v_lang, 'fr'),
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', COALESCE(public.crm_space_display_name(v_venue, NULL), vv.name), 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', COALESCE(public.crm_space_display_name(NULL, v_org), op.display_name), 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark')))
            FROM (SELECT ec.name, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL OR EXISTS (
                      SELECT 1 FROM public.external_events xe WHERE xe.event_id = x.id AND xe.cover_url IS NOT NULL),
                   'sold_out', coalesce(x.tickets_sold_out, false))) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids) AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._crm_signup_event(v_event) END,
      'pages', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'page_id', x.id, 'title', nullif(x.title, ''), 'kind', x.kind, 'state', public._crm_signup_state(x),
                   'design', CASE WHEN x.custom_design IS NOT NULL THEN 'custom' ELSE x.design->>'tpl' END,
                   'prepared_by', x.ai_author, 'proposal_pending', CASE WHEN x.ai_proposal IS NOT NULL THEN true END,
                   'public_url', CASE WHEN x.status <> 'draft' THEN 'https://crm.yunoapp.eu/j/' || x.slug END,
                   'event', (SELECT e.title FROM public.events e WHERE e.id = x.event_id),
                   'signups', (SELECT count(*) FROM public.crm_signup_entries y WHERE y.page_id = x.id),
                   'edited', to_char(x.updated_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI'))) ORDER BY x.updated_at DESC)
            FROM (SELECT * FROM public.crm_signup_pages sp
                   WHERE sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org
                   ORDER BY sp.updated_at DESC LIMIT 20) x), '[]'::jsonb));
  ELSIF p_tool = 'get_signup_page' THEN
    IF coalesce(p_args->>'page_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'page_not_found');
    END IF;
    SELECT * INTO p FROM public.crm_signup_pages sp
     WHERE sp.id = (p_args->>'page_id')::uuid
       AND sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'page_not_found'); END IF;
    RETURN jsonb_build_object('ok', true,
        'can_publish', public._crm_signup_owner(v_venue, v_org),
        'event_facts', CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_event(p.event_id) END)
      || public._mcp_signup_page_view(p);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
END;
$function$;
