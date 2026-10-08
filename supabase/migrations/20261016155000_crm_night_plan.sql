-- ============================================================================
-- Yuno CRM — le « Plan de soirée » (agents, lot A1, 2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md § 7 (décisions 5 à 8 du 08/10).
--
-- Un plan DÉTERMINISTE pour une soirée à venir, calculé à la lecture : aucune
-- IA chez Yuno (décision 6). Il part de « Qui cibler » (crm_night_targets, la
-- même porte que l'envoi) et ajoute ce qui en fait un plan :
--   • les étapes datées (maintenant, la semaine d'avant, la veille), chaque
--     personne comptée UNE fois, dans la première audience qui la contient ;
--   • le canal conseillé et le coût en Yunits de chaque étape (tarifs lus
--     dans crm_pricing, SMS au tarif France, estimé) et le solde du compte ;
--   • le rythme : billets vendus contre l'édition précédente (même série
--     d'abord) au même moment avant la soirée ;
--   • les messages déjà prévus pour cette soirée (e-mails et SMS) ;
--   • le témoin du compte et les familles d'hypothèses CONFIRMÉES.
-- Tout chiffre est calculé ici : l'IA du pro (MCP) le lit, elle ne l'écrit
-- jamais. Des agrégats seulement, jamais une personne.
--
-- crm_night_plan lit les tables temporaires que crm_night_targets laisse dans
-- la transaction (_ntg, _nta) et `_cp` (_crm_people_build) : il entre donc
-- dans demo_preview_writable_rpc, et l'outil MCP get_night_plan dans
-- _mcp_needs_temp (migration suivante, 20261016160000).
--
-- _mcp_email_audience (prod = 20261009150000, vérifié le 08/10) accepte
-- l'audience « target:<soirée>:<audience> » : un brouillon d'e-mail préparé
-- par l'IA du pro vise exactement l'audience du plan (filtre `ntgt`, même
-- porte serveur que les chiffres).
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key     text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ev      uuid := p_event_id;
  v_t       jsonb;
  v_rates   jsonb := COALESCE(public.crm_pricing_config()->'rates', '{}'::jsonb);
  v_re      integer;
  v_rs      integer;
  v_sms_ok  boolean;
  v_steps   jsonb;
  v_tot     jsonb;
  v_bal     integer;
  e         record;
  v_prev    record;
  v_pace    jsonb;
  v_sold    integer;
  v_planned jsonb;
  v_fams    jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Sans soirée désignée : la prochaine du compte.
  IF v_ev IS NULL THEN
    SELECT ev.id INTO v_ev FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') > now()
     ORDER BY ev.start_at LIMIT 1;
    IF v_ev IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_upcoming'); END IF;
  END IF;

  -- « Qui cibler » : même porte, mêmes audiences, mêmes moments.
  v_t := public.crm_night_targets(p_venue_id, p_organizer_user_id, v_ev);
  IF NOT COALESCE((v_t->>'ok')::boolean, false) THEN RETURN v_t; END IF;

  v_re := GREATEST(1, COALESCE((v_rates->>'email')::integer, 1));
  v_rs := GREATEST(1, COALESCE((v_rates->>'sms')::integer, 35));
  -- Un SMS ne part qu'avec l'identité légale de l'expéditeur : sinon, e-mail.
  v_sms_ok := COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id)->>'identity_ok')::boolean, false);

  -- Les étapes : chaque personne compte UNE fois, dans la première audience
  -- (ordre conseillé) qui la contient ; groupées par moment.
  WITH r AS (
    SELECT a.aud, a.rk, a.moment, a.mord FROM _nta a WHERE a.rk IS NOT NULL
  ), f AS (
    SELECT DISTINCT ON (g.email) g.email, r.aud FROM _ntg g JOIN r ON r.aud = g.aud ORDER BY g.email, r.rk
  ), c AS (
    SELECT f.aud, count(*)::int AS n, count(*) FILTER (WHERE p.email_ok)::int AS ne, count(*) FILTER (WHERE p.phone_ok)::int AS ns
      FROM f LEFT JOIN _cp p ON p.email = f.email GROUP BY f.aud
  ), a AS (
    SELECT r.aud, r.rk, r.moment, r.mord, COALESCE(c.n, 0) AS n, COALESCE(c.ne, 0) AS ne, COALESCE(c.ns, 0) AS ns, x.j
      FROM r LEFT JOIN c ON c.aud = r.aud
      CROSS JOIN LATERAL (SELECT j FROM jsonb_array_elements(v_t->'audiences') j WHERE j->>'key' = r.aud LIMIT 1) x
  ), st AS (
    SELECT a.moment, min(a.mord) AS mord, min((a.j->>'send_at')::timestamptz) AS send_at,
           sum(a.n)::int AS people, sum(a.ne)::int AS email, sum(a.ns)::int AS sms,
           jsonb_agg(a.j || jsonb_build_object('first_n', a.n, 'first_email', a.ne, 'first_sms', a.ns,
                                               'audience_id', 'target:' || v_ev::text || ':' || a.aud) ORDER BY a.rk) AS auds
      FROM a GROUP BY a.moment
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'moment', st.moment, 'send_at', st.send_at, 'people', st.people, 'email', st.email, 'sms', st.sms,
           -- La veille : SMS si l'identité est prête et que l'étape a des numéros ; sinon e-mail.
           'channel', CASE WHEN st.moment = 'eve' AND v_sms_ok AND st.sms > 0 THEN 'sms' ELSE 'email' END,
           'cost_email', st.email * v_re, 'cost_sms', st.sms * v_rs,
           'audiences', st.auds) ORDER BY st.mord), '[]'::jsonb)
    INTO v_steps FROM st;

  v_bal := COALESCE(public.crm_yunits_balance(v_key), 0);
  SELECT jsonb_build_object(
           'people', COALESCE(sum((s->>'people')::int), 0),
           'email', COALESCE(sum((s->>'email')::int), 0),
           'sms', COALESCE(sum((s->>'sms')::int), 0),
           'cost', COALESCE(sum(CASE WHEN s->>'channel' = 'sms' THEN (s->>'cost_sms')::int ELSE (s->>'cost_email')::int END), 0),
           'balance', v_bal)
    INTO v_tot FROM jsonb_array_elements(v_steps) s;
  v_tot := v_tot || jsonb_build_object('enough', v_bal >= (v_tot->>'cost')::int);

  -- Le rythme : billets vendus maintenant contre l'édition précédente au même
  -- moment avant sa soirée (même série d'abord, sinon la soirée d'avant).
  SELECT ev.id, ev.title, ev.start_at INTO e FROM public.events ev WHERE ev.id = v_ev;
  SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_sold
    FROM public.external_tickets t WHERE t.event_id = v_ev AND public._crm_ticket_is_sale(t.status, t.raw);
  SELECT ev.id, ev.title, ev.start_at,
         lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(e.title)) AS same_series
    INTO v_prev
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> v_ev
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND ev.start_at < now()
   ORDER BY (lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(e.title))) DESC, ev.start_at DESC
   LIMIT 1;
  v_pace := jsonb_build_object('sold', v_sold);
  IF v_prev.id IS NOT NULL THEN
    v_pace := v_pace || jsonb_build_object('prev', jsonb_build_object(
      'id', v_prev.id, 'title', v_prev.title, 'start_at', v_prev.start_at, 'same_series', v_prev.same_series,
      'sold_same', (SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int FROM public.external_tickets t
                     WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.raw)
                       AND COALESCE(t.purchased_at, t.first_seen_at) <= v_prev.start_at - (e.start_at - now())),
      'total', (SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int FROM public.external_tickets t
                 WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.raw))));
  END IF;

  -- Ce qui est déjà prévu pour cette soirée (campagnes faites à la main ;
  -- les envois des automatisations et des scénarios ont leurs propres écrans).
  SELECT jsonb_build_object(
    'emails', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                                 'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                                 'recipients', COALESCE(c.total_recipients, c.recipients_count)) ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at))
                          FROM public.email_campaigns c
                         WHERE c.event_id = v_ev AND c.automation_id IS NULL AND c.child_kind IS NULL AND c.parent_campaign_id IS NULL
                           AND c.status IN ('draft', 'scheduled', 'sending', 'paused', 'sent')
                           AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                           AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)), '[]'::jsonb),
    'sms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                              'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                              'recipients', COALESCE(c.total_recipients, c.estimated_recipients)) ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at))
                       FROM public.sms_campaigns c
                      WHERE c.event_id = v_ev
                        AND c.status IN ('draft', 'scheduled', 'sending', 'paused', 'sent')
                        AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                        AND (p_venue_id IS NOT NULL OR c.organizer_id = p_organizer_user_id)), '[]'::jsonb))
    INTO v_planned;

  -- Familles d'hypothèses CONFIRMÉES sur le compte (même règle que les scénarios).
  SELECT COALESCE(jsonb_agg(f.fam ORDER BY f.o), '[]'::jsonb) INTO v_fams
    FROM unnest(ARRAY['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series', 'early', 'launch', 'last_minute',
                      'door', 'group', 'table', 'discovery', 'passing', 'invited', 'group_first', 'brought', 'channel'])
         WITH ORDINALITY AS f(fam, o)
   WHERE public._crm_family_confirmed(v_key, f.fam);

  RETURN jsonb_build_object(
    'ok', true,
    'event', v_t->'event', 'days_left', v_t->'days_left', 'computed', v_t->'computed',
    'has_ticket', v_t->'has_ticket', 'score', v_t->'score', 'union', v_t->'union',
    'steps', v_steps, 'totals', v_tot, 'pace', v_pace, 'planned', v_planned,
    'holdout_pct', public.crm_holdout_pct(v_key),
    'families', v_fams,
    'rates', jsonb_build_object('email', v_re, 'sms', v_rs),
    'sms_ready', v_sms_ok);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_plan(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan(text, uuid, uuid) TO authenticated, service_role;

-- ── L'aperçu démo : le plan construit `_cp` et lit des tables temporaires ───
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
    'crm_scenario_counts', 'crm_scenario_preview', 'crm_scenario_report',
    -- Plan de soirée (20261016155000) : il passe par « Qui cibler »
    'crm_night_plan'
  ]::text[]);
$function$;

-- ── Audience d'un brouillon préparé par l'IA : « target:<soirée>:<audience> » ─
-- Reprise de 20261009150000 (prod identique, vérifié le 08/10), une branche de
-- plus pour Yuno CRM : l'audience « Qui cibler » d'une soirée du compte.
CREATE OR REPLACE FUNCTION public._mcp_email_audience(p_id text, p_product text, p_venue_id text, p_organizer_user_id uuid, p_lang text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_id   text := lower(btrim(coalesce(p_id, '')));
  v_i    integer := CASE WHEN p_lang = 'en' THEN 1 WHEN p_lang = 'es' THEN 3 ELSE 2 END;
  v_uuid uuid;
  v_name text;
  v_def  jsonb;
  v_lbl  text[];
BEGIN
  IF p_product = 'crm' THEN
    IF v_id = 'all' THEN
      RETURN (SELECT jsonb_agg(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', k), 'label', lbl[v_i]) ORDER BY o)
                FROM (VALUES (1, 'hab', ARRAY['Regulars', 'Habitués', 'Habituales']),
                             (2, 'occ', ARRAY['Occasional', 'Occasionnels', 'Ocasionales']),
                             (3, 'nou', ARRAY['New', 'Nouveaux', 'Nuevos']),
                             (4, 'end', ARRAY['Dormant', 'Endormis', 'Dormidos']),
                             (5, 'none', ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'])) x(o, k, lbl));
    END IF;
    IF v_id ~ '^lifecycle:(hab|occ|nou|end|none)$' THEN
      v_lbl := CASE split_part(v_id, ':', 2)
        WHEN 'hab' THEN ARRAY['Regulars', 'Habitués', 'Habituales']
        WHEN 'occ' THEN ARRAY['Occasional', 'Occasionnels', 'Ocasionales']
        WHEN 'nou' THEN ARRAY['New', 'Nouveaux', 'Nuevos']
        WHEN 'end' THEN ARRAY['Dormant', 'Endormis', 'Dormidos']
        ELSE ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'] END;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', split_part(v_id, ':', 2)), 'label', v_lbl[v_i]));
    END IF;
    IF v_id ~ '^segment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uuid := split_part(v_id, ':', 2)::uuid;
      SELECT s.name INTO v_name FROM public.crm_segments s
       WHERE s.id = v_uuid
         AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id));
      IF NOT FOUND THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'segmentId', v_uuid, 'label', v_name));
    END IF;
    -- « Qui cibler » d'une soirée (plan de soirée, 20261016155000) : la soirée
    -- doit être une soirée miroir du compte, encore à venir.
    IF v_id ~ '^target:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(likely|concept|lineup|genre|early|last_minute|once_local)$' THEN
      v_uuid := split_part(v_id, ':', 2)::uuid;
      SELECT e.title INTO v_name FROM public.events e
       WHERE e.id = v_uuid AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
         AND COALESCE(e.end_at, e.start_at + interval '6 hours') > now()
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));
      IF NOT FOUND THEN RETURN NULL; END IF;
      v_lbl := CASE split_part(v_id, ':', 3)
        WHEN 'likely' THEN ARRAY['Most likely to come', 'Les plus probables', 'Los más probables']
        WHEN 'concept' THEN ARRAY['Concept regulars without a ticket', 'Fidèles du concept sans place', 'Fieles del concepto sin entrada']
        WHEN 'lineup' THEN ARRAY['Saw an artist of the line-up', 'Ont vu un artiste du line-up', 'Vieron a un artista del line-up']
        WHEN 'genre' THEN ARRAY['Their most attended genre', 'Leur genre le plus fréquenté', 'Su género más frecuentado']
        WHEN 'early' THEN ARRAY['Buy early', 'Achètent tôt', 'Compran pronto']
        WHEN 'last_minute' THEN ARRAY['Buy at the last minute', 'Achètent à la dernière minute', 'Compran en el último momento']
        ELSE ARRAY['Came once, live nearby', 'Venus une fois, habitent près', 'Vinieron una vez, viven cerca'] END;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm',
        'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('ntgt', jsonb_build_object('e', v_uuid, 'a', split_part(v_id, ':', 3)))),
        'label', left(v_lbl[v_i] || ' · ' || v_name, 80)));
    END IF;
    IF v_id ~ '^preset:' THEN
      SELECT d, l INTO v_def, v_lbl FROM (VALUES
        ('preset:vip', '{"seg":"all","f":{"sp":"200+"}}'::jsonb, ARRAY['Big spenders', 'Gros dépensiers', 'Grandes gastadores']),
        ('preset:loyal', '{"seg":"all","f":{"nb_min":4}}'::jsonb, ARRAY['Loyal customers (4 nights or more)', 'Fidèles (4 soirées ou plus)', 'Fieles (4 fiestas o más)']),
        ('preset:buyers', '{"seg":"all","f":{"paid_min":1}}'::jsonb, ARRAY['Ticket buyers', 'Acheteurs de billets', 'Compradores de entradas']),
        ('preset:recent', '{"seg":"all","f":{"last_lt_days":90}}'::jsonb, ARRAY['Came in the last 3 months', 'Venus ces 3 derniers mois', 'Vinieron en los últimos 3 meses']),
        ('preset:lapsed', '{"seg":"all","f":{"last_gt_days":90,"last_lt_days":365}}'::jsonb, ARRAY['To reactivate (3 to 12 months)', 'À réactiver (3 à 12 mois)', 'Por reactivar (3 a 12 meses)']),
        ('preset:has_upcoming', '{"seg":"all","f":{"up":"yes"}}'::jsonb, ARRAY['Already have their place', 'Ont déjà leur place', 'Ya tienen su entrada']),
        ('preset:no_upcoming', '{"seg":"all","f":{"up":"no"}}'::jsonb, ARRAY['No place yet for what’s next', 'Pas encore de place pour la suite', 'Sin entrada aún para lo próximo']),
        ('preset:clickers', '{"seg":"all","f":{"click_lt_days":90}}'::jsonb, ARRAY['Clicked in the last 3 months', 'Ont cliqué ces 3 derniers mois', 'Hicieron clic en los últimos 3 meses']),
        ('preset:gl_loyal', '{"seg":"all","f":{"gl":"loyal"}}'::jsonb, ARRAY['Guest list regulars', 'Habitués de la guest list', 'Habituales de la lista de invitados'])
      ) x(k, d, l) WHERE x.k = v_id;
      IF v_def IS NULL THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', v_def, 'label', v_lbl[v_i]));
    END IF;
    RETURN NULL;
  END IF;

  -- Billetterie (Suite) : audiences v2 du moteur d'envoi (resolve_campaign_audience).
  IF v_id IN ('all', 'kind:all_subscribers') THEN RETURN jsonb_build_array(jsonb_build_object('kind', 'all_subscribers')); END IF;
  IF v_id ~ '^kind:(vip|big_spenders|regulars|new_customers|dormant)$' THEN
    RETURN jsonb_build_array(jsonb_build_object('kind', split_part(v_id, ':', 2)));
  END IF;
  IF v_id ~ '^(segment|contact_segment|import):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := split_part(v_id, ':', 2)::uuid;
    IF v_id LIKE 'segment:%' THEN
      IF p_venue_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.venue_segments s WHERE s.id = v_uuid AND s.venue_id = p_venue_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'segment', 'segmentId', v_uuid));
    ELSIF v_id LIKE 'contact_segment:%' THEN
      IF NOT EXISTS (SELECT 1 FROM public.contact_segments s WHERE s.id = v_uuid
                      AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'contact_segment', 'segmentId', v_uuid));
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.email_list_imports i WHERE i.id = v_uuid AND i.superseded_at IS NULL
                      AND i.venue_id IS NOT DISTINCT FROM p_venue_id AND i.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'import', 'importId', v_uuid));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._mcp_email_audience(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mcp_email_audience(text, text, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
