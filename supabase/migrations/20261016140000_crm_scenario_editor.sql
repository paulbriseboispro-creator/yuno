-- ============================================================================
-- Yuno CRM — Scénarios, lot J4 : les lectures de l'éditeur (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md (§ 6).
--
--   crm_scenario_counts   effectif en direct de chaque groupe d'une condition,
--                         par la MÊME compilation que l'envoi (_crm_cond_sql
--                         sur _cp) : le chiffre affiché = le filtre = l'envoi
--   crm_scenario_preview  « Avant de publier » : erreurs, avertissements, qui
--                         entrerait aujourd'hui (le moteur À BLANC), estimation
--                         par semaine sur les 8 dernières, plafond de Yunits
--
-- Elles construisent des tables temporaires : elles entrent dans
-- demo_preview_writable_rpc (aperçu démo en lecture seule), avec
-- crm_scenario_report et « Qui cibler » (crm_night_targets), qui manquait
-- depuis le 11/10 (un prospect sur un lien d'aperçu voyait l'onglet tomber).
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Effectifs en direct d'une condition ──────────────────────────────────
-- p_ctx 'entry' (filtre d'entrée) | 'step'. Un groupe qui contient une
-- feuille propre à une inscription (achat depuis l'entrée, message reçu…) n'a
-- pas d'effectif avant le lancement : NULL, l'écran dit « au lancement ».
CREATE OR REPLACE FUNCTION public.crm_scenario_counts(p_venue_id text, p_organizer_user_id uuid, p_tree jsonb,
                                                      p_event uuid DEFAULT NULL, p_ctx text DEFAULT 'entry')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_total integer;
  v_out   jsonb := '{}'::jsonb;
  v_path  record;
  v_sql   text;
  v_n     integer;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_event IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event
          AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
    RAISE EXCEPTION 'unknown_event' USING ERRCODE = '22023';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT count(*) INTO v_total FROM _cp p WHERE p.email_ok OR p.phone_ok;

  -- Chaque groupe (racine comprise), désigné par son chemin.
  FOR v_path IN
    WITH RECURSIVE g(node, path) AS (
      SELECT p_tree, ''::text WHERE jsonb_typeof(p_tree) = 'object' AND p_tree ? 'op'
      UNION ALL
      SELECT it.value, CASE WHEN g.path = '' THEN (it.o - 1)::text ELSE g.path || '.' || (it.o - 1) END
        FROM g CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(g.node->'items') = 'array' THEN g.node->'items' ELSE '[]'::jsonb END) WITH ORDINALITY AS it(value, o)
       WHERE jsonb_typeof(it.value) = 'object' AND it.value ? 'op'
    )
    SELECT g.node, g.path FROM g LIMIT 40
  LOOP
    -- Une feuille d'inscription : pas d'effectif avant le lancement.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(public._crm_cond_errors(v_path.node, 'entry')) e WHERE e->>'code' = 'not_in_entry') THEN
      v_out := v_out || jsonb_build_object(v_path.path, NULL);
      CONTINUE;
    END IF;
    v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_path.node, p_event), 'p', 'r');
    EXECUTE format('SELECT count(*) FROM _cp p CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %L::text AS scope_key, %L::uuid AS event_id,
                      p.email, now() AS entered_at, NULL::uuid AS version_id) r WHERE (p.email_ok OR p.phone_ok) AND (%s)',
                   v_key, p_event, v_sql) INTO v_n;
    v_out := v_out || jsonb_build_object(v_path.path, v_n);
  END LOOP;
  RETURN jsonb_build_object('total', v_total, 'groups', v_out,
                            'errors', public._crm_cond_errors(p_tree, CASE WHEN p_ctx = 'entry' THEN 'entry' ELSE 'step' END));
END;
$function$;

-- ── 2. « Avant de publier » ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_scenario_preview(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key    text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s        public.crm_scenarios%ROWTYPE;
  v        public.crm_scenario_versions%ROWTYPE;
  g        jsonb;
  t        jsonb;
  tt       text;
  v_check  jsonb;
  v_content jsonb;
  v_now    jsonb;
  v_rates  jsonb := public.crm_sms_rates();
  v_email  integer := GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));
  v_seg    integer := 1;
  v_week   numeric;
  v_basis  text;
  v_ev     record;
  v_sql    text;
  v_k      integer;
  v_sum    numeric := 0;
  v_filter jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  g := s.draft;
  t := g->'trigger';
  tt := t->>'type';
  v_filter := g->'entry'->'filter';
  v_check := public._crm_scenario_graph_errors(g);
  v_content := public._crm_scenario_content(p_venue_id, p_organizer_user_id, g);

  -- Le coût au plus, par entrant : le chemin le plus cher (SMS au tarif d'un
  -- numéro étranger au pire ; un SMS compte ses segments).
  SELECT COALESCE(max(public._crm_sms_segments_estimate(n.v->>'body')), 1) INTO v_seg
    FROM jsonb_each(CASE WHEN jsonb_typeof(g->'nodes') = 'object' THEN g->'nodes' ELSE '{}'::jsonb END) n(id, v)
   WHERE n.v->>'type' = 'sms';

  -- Qui entrerait aujourd'hui : le moteur À BLANC (rien n'est écrit), seulement
  -- pour un graphe lisible.
  IF jsonb_array_length(v_check->'errors') = 0 THEN
    PERFORM public._crm_scenario_temp();
    v.id := gen_random_uuid();
    v.scenario_id := s.id;
    v.scope_key := v_key;
    v.graph := g;
    v.published_at := now();
    v_now := public._crm_scenario_enter(s, v, NULL, NULL, true);
  END IF;

  -- Estimation par semaine sur les 8 dernières (base d'aujourd'hui, filtre
  -- d'entrée appliqué ; jamais un chiffre présenté comme une mesure).
  IF jsonb_array_length(v_check->'errors') = 0 AND tt IN ('before_event', 'event_published', 'after_event', 'ticket_bought',
                                                          'signup_confirmed', 'absence', 'click_no_buy') THEN
    PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
    IF tt IN ('before_event', 'event_published', 'after_event', 'ticket_bought') THEN
      v_basis := 'events';
      FOR v_ev IN
        SELECT e.id FROM public.events e
         WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
           AND e.start_at BETWEEN now() - interval '56 days' AND now()
           AND (tt NOT IN ('before_event', 'ticket_bought') OR t->>'series' IS NULL
                OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
         LIMIT 40
      LOOP
        v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_filter, v_ev.id), 'p', 'r');
        EXECUTE format($q$
          SELECT count(*) FROM _cp p
           CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %1$L::text AS scope_key, %2$L::uuid AS event_id, p.email,
                                      now() AS entered_at, NULL::uuid AS version_id) r
           WHERE (p.email_ok OR p.phone_ok) AND (%3$s)
             AND CASE %4$L
                   -- Après la soirée : ceux qui y étaient (scan) ou avaient une place.
                   WHEN 'after_event' THEN EXISTS (SELECT 1 FROM public.external_tickets tk WHERE tk.event_id = %2$L::uuid
                                                     AND lower(tk.buyer_email) = p.email
                                                     AND CASE %5$L WHEN 'entered' THEN tk.scanned_at IS NOT NULL
                                                                   WHEN 'absent_buyers' THEN tk.scanned_at IS NULL
                                                                   ELSE true END)
                   -- Billet acheté : les acheteurs de cette soirée.
                   WHEN 'ticket_bought' THEN EXISTS (SELECT 1 FROM public.external_tickets tk WHERE tk.event_id = %2$L::uuid
                                                       AND lower(tk.buyer_email) = p.email AND public._crm_ticket_is_sale(tk.status, tk.raw))
                   ELSE true END
        $q$, v_key, v_ev.id, v_sql, tt, COALESCE(t->>'who', 'all')) INTO v_k;
        v_sum := v_sum + v_k;
      END LOOP;
      v_week := round(v_sum / 8.0, 1);
    ELSIF tt = 'signup_confirmed' THEN
      v_basis := 'signups';
      SELECT count(DISTINCT lower(en.email)) / 8.0 INTO v_week
        FROM public.crm_signup_entries en
       WHERE en.page_id = (t->>'page_id')::uuid AND en.confirmed_at > now() - interval '56 days';
    ELSIF tt = 'absence' THEN
      v_basis := 'absence';
      v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_filter, NULL), 'p', 'r');
      EXECUTE format($q$
        SELECT count(*) / 8.0 FROM _cp p
         CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %1$L::text AS scope_key, NULL::uuid AS event_id, p.email,
                                    now() AS entered_at, NULL::uuid AS version_id) r
         WHERE (p.email_ok OR p.phone_ok) AND (%2$s)
           AND p.last_night < now() - make_interval(days => %3$L::integer)
           AND p.last_night >= now() - make_interval(days => %3$L::integer) - interval '56 days'
      $q$, v_key, v_sql, (t->>'days')::integer) INTO v_week;
    ELSIF tt = 'click_no_buy' THEN
      v_basis := 'clicks';
      SELECT count(*) / 8.0 INTO v_week FROM (
        SELECT DISTINCT lower(ev.recipient_email), c.event_id
          FROM public.email_campaign_events ev
          JOIN public.email_campaigns c ON c.id = ev.campaign_id
          JOIN public.events e2 ON e2.id = c.event_id
         WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
           AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
           AND e2.external_ticket_url IS NOT NULL
           AND public._link_base(ev.metadata->'click'->>'link') = public._link_base(e2.external_ticket_url)
           AND ev.created_at > now() - interval '56 days'
           AND NOT EXISTS (SELECT 1 FROM public.external_tickets tk WHERE tk.event_id = c.event_id
                            AND lower(tk.buyer_email) = lower(ev.recipient_email) AND tk.status IN ('valid', 'transferred'))) z;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'errors', public._crm_scn_sorted((v_check->'errors') || (v_content->'errors')),
    'warnings', v_content->'warnings',
    'stats', v_check->'stats',
    'now', v_now,
    'week', jsonb_build_object('estimate', v_week, 'basis', v_basis),
    'cost', jsonb_build_object(
      'email', v_email, 'sms_fr', (v_rates->>'fr')::integer, 'sms_intl', (v_rates->>'intl')::integer, 'sms_segments', v_seg,
      'max_emails', (v_check->'stats'->>'maxEmails')::integer, 'max_sms', (v_check->'stats'->>'maxSms')::integer,
      'max_fr', COALESCE((v_check->'stats'->>'maxEmails')::integer, 0) * v_email
                + COALESCE((v_check->'stats'->>'maxSms')::integer, 0) * v_seg * (v_rates->>'fr')::integer,
      'max_intl', COALESCE((v_check->'stats'->>'maxEmails')::integer, 0) * v_email
                + COALESCE((v_check->'stats'->>'maxSms')::integer, 0) * v_seg * (v_rates->>'intl')::integer),
    'holdout_pct', public.crm_holdout_pct(v_key),
    'can_publish', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) AND NOT public.is_support_session());
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_scenario_counts(text, uuid, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scenario_counts(text, uuid, jsonb, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_scenario_preview(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scenario_preview(text, uuid, uuid) TO authenticated, service_role;

-- ── 3. Aperçu démo en lecture seule : ces lectures passent ──────────────────
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs
-- --before 20261016100000), seule la fin de la liste change.
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
    'crm_sms_send_options', 'crm_sms_audience_preview', 'crm_sms_settings_get', 'crm_sms_draft_sizes',
    -- catalogue de segments (20261008200000)
    'crm_segment_catalog',
    -- « Qui cibler » (20261011110000) : il construit `_cp`, il manquait ici
    'crm_night_targets',
    -- Scénarios (20261016140000) : effectifs, « Avant de publier », rapport
    'crm_scenario_counts', 'crm_scenario_preview', 'crm_scenario_report'
  ]::text[]);
$function$;
