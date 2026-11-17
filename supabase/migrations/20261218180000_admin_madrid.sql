-- Admin : rubrique « Madrid » (« La marketplace de Madrid marche-t-elle ? »).
--
-- La marketplace EXTERNE de Madrid : soirées de clubs non clients
-- (`affiliate_events` de l'agence de Madrid, « Mad by Night »), dont le bouton
-- sort vers la billetterie du club. Rien ne se vend dans Yuno pour ces soirées.
-- Définitions, volumes et pièges : docs/designs/ADMIN_MADRID.md.
--
--   • admin_madrid_inputs : une ligne par mois, coût (€) et heures passées sur
--     Madrid, saisis à la main (rien de cela n'est en base ailleurs). RLS sans
--     policy : lecture par admin_madrid_traffic, écriture par admin_madrid_input_set.
--   • admin_madrid_traffic(p_days, p_include_demo) : verdict, clubs et soirées,
--     audience. Lit platform_sessions / platform_page_views (mesure sans cookie,
--     ROBOTS RETIRÉS), affiliate_clicks (sorties vers la billetterie),
--     affiliate_visitor_sessions (consentement : retours et cohortes),
--     affiliate_reported_sales (ventes déclarées).
--   • admin_madrid_offer(p_days, p_include_demo) : ce que Madrid apporte au reste
--     de Yuno (comptes, app, push, achats DANS Yuno, pros) et la santé du catalogue.
--   • admin_madrid_input_set(p_month, p_cost, p_hours, p_note) : saisie du mois.
--
-- Aucune table temporaire, aucun calcul existant modifié. Super admin seul,
-- REVOKE / GRANT explicites.

-- ── Saisie mensuelle ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_madrid_inputs (
  month       date PRIMARY KEY CHECK (month = date_trunc('month', month)::date),
  cost_eur    numeric(10, 2) CHECK (cost_eur IS NULL OR cost_eur >= 0),
  hours       numeric(6, 1) CHECK (hours IS NULL OR hours >= 0),
  note        text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_madrid_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_madrid_inputs FROM anon, authenticated;

-- ── Helpers (sans GRANT : lus par les RPC ci-dessous seulement) ────────────

-- Les agences de Madrid. Une agence dont le titulaire est un compte démo n'en
-- est une qu'avec p_include_demo.
CREATE OR REPLACE FUNCTION public._admin_madrid_affiliates(p_include_demo boolean)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.id FROM public.affiliates a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE lower(trim(COALESCE(a.city, ''))) LIKE 'madrid%'
    AND (p_include_demo OR NOT public.is_demo_email(p.email));
$$;
REVOKE ALL ON FUNCTION public._admin_madrid_affiliates(boolean) FROM PUBLIC, anon, authenticated;

-- Les personnes qui ne sont jamais un visiteur : super admins, titulaires et
-- membres des agences de Madrid, titulaires de l'agence fusionnée, comptes démo
-- (sauf p_include_demo).
CREATE OR REPLACE FUNCTION public._admin_madrid_staff(p_include_demo boolean)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin'::app_role
  UNION SELECT a.user_id FROM public.affiliates a WHERE a.id IN (SELECT public._admin_madrid_affiliates(true)) AND a.user_id IS NOT NULL
  UNION SELECT m.user_id FROM public.affiliate_members m WHERE m.affiliate_id IN (SELECT public._admin_madrid_affiliates(true)) AND m.user_id IS NOT NULL
  UNION SELECT g.owner_user_id FROM public.agencies g JOIN public.affiliates a ON a.agency_id = g.id
        WHERE a.id IN (SELECT public._admin_madrid_affiliates(true)) AND g.owner_user_id IS NOT NULL
  UNION SELECT p.id FROM public.profiles p WHERE NOT p_include_demo AND public.is_demo_email(p.email);
$$;
REVOKE ALL ON FUNCTION public._admin_madrid_staff(boolean) FROM PUBLIC, anon, authenticated;

-- Nuit d'un instant : la règle d'affiliate_night_date() (heure de Paris − 8 h).
CREATE OR REPLACE FUNCTION public._admin_madrid_night(p_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_ts AT TIME ZONE 'Europe/Paris') - interval '8 hours')::date;
$$;
REVOKE ALL ON FUNCTION public._admin_madrid_night(timestamptz) FROM PUBLIC, anon, authenticated;

-- Probable robot (mesure plateforme) : session web arrivée sans référent depuis
-- les États-Unis, ou navigateur non reconnu. Constaté le 17/11 : 908 sessions
-- « navigateur inconnu, ordinateur, États-Unis, directe » et 176 « Chrome
-- Android, États-Unis, directe », 1,3 page, 0 s : les robots d'indexation qui
-- exécutent la page. Une session de l'app n'est jamais un robot.
CREATE OR REPLACE FUNCTION public._admin_madrid_is_robot(p_native boolean, p_browser text, p_country text, p_channel text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT COALESCE(p_native, false)
     AND (COALESCE(p_browser, 'other') IN ('other', 'unknown')
          OR (COALESCE(p_country, '') = 'US' AND COALESCE(p_channel, 'direct') = 'direct'));
$$;
REVOKE ALL ON FUNCTION public._admin_madrid_is_robot(boolean, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── Trafic : verdict, clubs et soirées, audience ───────────────────────────

CREATE OR REPLACE FUNCTION public.admin_madrid_traffic(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days  integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 400);
  v_now   timestamptz := now();
  v_from  timestamptz;
  v_pfrom timestamptz;
  v_n0    date;
  v_n1    date;
  v_out   jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  v_from  := v_now - make_interval(days => v_days);
  v_pfrom := v_now - make_interval(days => 2 * v_days);
  v_n1    := public._admin_madrid_night(v_now);
  v_n0    := v_n1 - (v_days - 1);

  WITH
  aff AS MATERIALIZED (SELECT public._admin_madrid_affiliates(COALESCE(p_include_demo, false)) AS id),
  staff AS MATERIALIZED (SELECT public._admin_madrid_staff(COALESCE(p_include_demo, false)) AS uid),
  ven AS MATERIALIZED (
    SELECT v.id, v.name, v.slug, v.is_active FROM public.affiliate_venues v WHERE v.affiliate_id IN (SELECT id FROM aff)),
  tpl AS MATERIALIZED (
    SELECT t.id, t.slug, t.affiliate_venue_id FROM public.affiliate_recurring_templates t
    WHERE t.affiliate_id IN (SELECT id FROM aff) AND t.slug IS NOT NULL),
  ev AS MATERIALIZED (
    SELECT e.id, e.slug, e.name, e.event_date, e.affiliate_venue_id, e.recurring_template_id, e.status
    FROM public.affiliate_events e WHERE e.affiliate_id IN (SELECT id FROM aff)),
  -- Pages publiques de l'agence (linktree /p/, page agence /rp/) et de ses promoteurs (/promo/).
  pslug AS MATERIALIZED (
    SELECT a.linktree_slug AS slug FROM public.affiliates a WHERE a.id IN (SELECT id FROM aff) AND a.linktree_slug IS NOT NULL
    UNION SELECT s.slug FROM public.affiliate_slug_aliases s WHERE s.affiliate_id IN (SELECT id FROM aff)
    UNION SELECT m.linktree_slug FROM public.affiliate_members m WHERE m.affiliate_id IN (SELECT id FROM aff) AND m.linktree_slug IS NOT NULL
    UNION SELECT ma.slug FROM public.affiliate_member_slug_aliases ma JOIN public.affiliate_members m ON m.id = ma.member_id WHERE m.affiliate_id IN (SELECT id FROM aff)),
  -- Slugs de soirées d'AUTRES agences (photos des visites et des clics) : jamais Madrid.
  other_slug AS MATERIALIZED (
    SELECT DISTINCT event_slug AS slug FROM public.affiliate_visitor_sessions
     WHERE event_slug IS NOT NULL AND affiliate_id NOT IN (SELECT id FROM aff)
    UNION SELECT DISTINCT event_slug FROM public.affiliate_clicks
     WHERE event_slug IS NOT NULL AND affiliate_id NOT IN (SELECT id FROM aff)),
  -- Vues des pages de la marketplace sur deux périodes (mesure plateforme, sans cookie).
  pv AS MATERIALIZED (
    SELECT x.session_id, x.occurred_at, x.kind, x.slug,
           e.id AS event_id, COALESCE(e.event_date, x.slug_date) AS event_date, e.name AS event_name,
           COALESCE(e.affiliate_venue_id, vv.id, t.affiliate_venue_id,
                    (SELECT v2.id FROM ven v2 WHERE x.kind = 'event' AND length(v2.slug) >= 4 AND x.slug LIKE '%' || regexp_replace(v2.slug, '-madrid$', '') || '%' LIMIT 1)) AS venue_id,
           e.recurring_template_id IS NOT NULL OR (e.id IS NULL AND t.id IS NOT NULL) AS recurring
    FROM (
      SELECT pv0.session_id, pv0.occurred_at,
             CASE WHEN pv0.path LIKE '/affiliate-event/%' THEN 'event' WHEN pv0.path LIKE '/affiliate-venue/%' THEN 'venue'
                  WHEN pv0.path LIKE '/promo/%' THEN 'promo' ELSE 'linktree' END AS kind,
             split_part(pv0.path, '/', 3) AS slug,
             CASE WHEN split_part(pv0.path, '/', 3) ~ '-\d{4}-\d{2}-\d{2}$'
                  THEN (substring(split_part(pv0.path, '/', 3) from '(\d{4}-\d{2}-\d{2})$'))::date END AS slug_date
      FROM public.platform_page_views pv0
      WHERE pv0.occurred_at >= v_pfrom AND pv0.occurred_at < v_now
        AND (pv0.path LIKE '/affiliate-event/%' OR pv0.path LIKE '/affiliate-venue/%'
             OR pv0.path LIKE '/p/%' OR pv0.path LIKE '/rp/%' OR pv0.path LIKE '/promo/%')
    ) x
    LEFT JOIN ev e ON x.kind = 'event' AND e.slug = x.slug
    LEFT JOIN ven vv ON x.kind = 'venue' AND vv.slug = x.slug
    LEFT JOIN LATERAL (SELECT t0.id, t0.affiliate_venue_id FROM tpl t0 WHERE x.kind = 'event' AND e.id IS NULL AND x.slug LIKE t0.slug || '-____-__-__' LIMIT 1) t ON true
    WHERE (x.kind = 'event' AND (e.id IS NOT NULL OR x.slug NOT IN (SELECT slug FROM other_slug)))
       OR (x.kind = 'venue' AND vv.id IS NOT NULL)
       OR (x.kind IN ('linktree', 'promo') AND x.slug IN (SELECT slug FROM pslug))),
  -- Sessions qui ont vu au moins une page de la marketplace (robots marqués).
  ses AS MATERIALIZED (
    SELECT s.id, s.visitor_hash, s.started_at, public._admin_madrid_night(s.started_at) AS night,
           s.started_at >= v_from AS cur, s.is_native, s.is_authenticated, s.language, s.country, s.channel,
           public._admin_madrid_is_robot(s.is_native, s.browser, s.country, s.channel) AS robot,
           CASE
             WHEN s.is_native THEN 'app'
             WHEN COALESCE(s.utm_medium, '') ~* 'cpc|ppc|paid|ads' THEN 'ads'
             WHEN COALESCE(s.entry_path, '') ~ '^/(p|rp|promo)/' OR COALESCE(s.referrer_host, '') ~* 'linktr\.ee' THEN 'linktree'
             WHEN s.browser = 'Instagram' OR COALESCE(s.referrer_host, '') ~* 'instagram' OR COALESCE(s.utm_source, '') ~* '^(ig|instagram)$' THEN 'instagram'
             WHEN s.channel = 'social' THEN 'social'
             WHEN s.channel = 'search' THEN 'search'
             WHEN COALESCE(s.referrer_host, '') ~* 'yunoapp\.eu' OR COALESCE(s.entry_path, '/') !~ '^/affiliate-(event|venue)/' THEN 'yuno'
             WHEN s.channel = 'direct' THEN 'direct'
             ELSE 'other'
           END AS src,
           pvs.saw_event,
           extract(hour FROM s.started_at AT TIME ZONE 'Europe/Paris')::int AS hr,
           extract(isodow FROM s.started_at AT TIME ZONE 'Europe/Paris')::int AS dw
    FROM public.platform_sessions s
    JOIN (SELECT session_id, bool_or(kind = 'event') AS saw_event FROM pv GROUP BY 1) pvs ON pvs.session_id = s.id),
  hum AS MATERIALIZED (SELECT * FROM ses WHERE NOT robot),
  -- Sorties vers la billetterie (un clic = une sortie), personnel et démo retirés.
  clk AS MATERIALIZED (
    SELECT c.id, c.clicked_at, public._admin_madrid_night(c.clicked_at) AS night, c.clicked_at >= v_from AS cur,
           COALESCE(c.visitor_id, c.browser_id, 'c:' || c.id::text) AS who, c.user_id,
           COALESCE(c.affiliate_event_id::text, c.event_slug) AS ekey, c.affiliate_event_id,
           COALESCE(e.slug, c.event_slug) AS slug, COALESCE(e.name, c.event_name) AS ename,
           COALESCE(e.event_date, c.event_date) AS event_date,
           COALESCE(e.affiliate_venue_id, c.affiliate_venue_id, t.affiliate_venue_id,
                    (SELECT v2.id FROM ven v2 WHERE length(v2.slug) >= 4 AND c.event_slug LIKE '%' || regexp_replace(v2.slug, '-madrid$', '') || '%' LIMIT 1)) AS venue_id,
           e.recurring_template_id IS NOT NULL OR (e.id IS NULL AND t.id IS NOT NULL) AS recurring,
           CASE
             WHEN COALESCE(c.utm_source, '') ~* '^meta$' OR COALESCE(c.utm_medium, '') ~* 'cpc|ppc|paid|ads' THEN 'ads'
             WHEN COALESCE(c.referrer, '') ~* 'linktr\.ee' THEN 'linktree'
             WHEN COALESCE(c.utm_source, '') ~* '^(ig|instagram)$' OR c.referrer_category IN ('social', 'paid_social') AND COALESCE(c.referrer, '') !~* 'facebook|tiktok' THEN 'instagram'
             WHEN c.referrer_category IN ('social', 'paid_social') THEN 'social'
             WHEN c.referrer_category = 'search' THEN 'search'
             WHEN c.referrer_category = 'internal' THEN 'yuno'
             WHEN c.referrer_category = 'direct' OR c.referrer_category IS NULL THEN 'direct'
             ELSE 'other'
           END AS src
    FROM public.affiliate_clicks c
    LEFT JOIN ev e ON e.id = c.affiliate_event_id
    LEFT JOIN LATERAL (SELECT t0.id, t0.affiliate_venue_id FROM tpl t0 WHERE e.id IS NULL AND c.event_slug LIKE t0.slug || '-____-__-__' LIMIT 1) t ON true
    WHERE c.affiliate_id IN (SELECT id FROM aff)
      AND c.clicked_at >= LEAST(v_pfrom, v_now - interval '56 days') AND c.clicked_at < v_now
      AND NOT COALESCE(c.is_internal, false)
      AND (c.user_id IS NULL OR c.user_id NOT IN (SELECT uid FROM staff WHERE uid IS NOT NULL))),
  -- Mesure avec consentement (identifiant visiteur d'un an) : retours et cohortes.
  avs AS MATERIALIZED (
    SELECT s.visitor_id, s.visited_at, date_trunc('week', s.visited_at AT TIME ZONE 'Europe/Paris')::date AS wk
    FROM public.affiliate_visitor_sessions s
    WHERE s.affiliate_id IN (SELECT id FROM aff) AND NOT COALESCE(s.is_internal, false) AND s.visitor_id IS NOT NULL),
  avs_first AS MATERIALIZED (SELECT visitor_id, min(visited_at) AS first_at, min(wk) AS first_wk FROM avs GROUP BY 1),
  -- 4 semaines glissantes (verdict), indépendantes de la période choisie.
  ses56 AS MATERIALIZED (
    SELECT s.visitor_hash, s.started_at >= v_now - interval '28 days' AS cur
    FROM public.platform_sessions s
    JOIN (SELECT DISTINCT p.session_id FROM public.platform_page_views p
          WHERE p.occurred_at >= v_now - interval '56 days' AND p.occurred_at < v_now
            AND (p.path LIKE '/affiliate-event/%' OR p.path LIKE '/affiliate-venue/%')) m ON m.session_id = s.id
    WHERE s.started_at >= v_now - interval '56 days'
      AND NOT public._admin_madrid_is_robot(s.is_native, s.browser, s.country, s.channel)),
  -- Vues de personnes (robots retirés) de la période, une ligne par (session, page).
  pvh AS MATERIALIZED (
    SELECT p.*, h.visitor_hash FROM pv p JOIN hum h ON h.id = p.session_id WHERE h.cur),
  hum_n AS (SELECT night, count(DISTINCT visitor_hash) AS n FROM hum GROUP BY 1),
  clk_n AS (SELECT night, count(*) AS n FROM clk GROUP BY 1),
  clk_en AS (SELECT ekey, night, count(*) AS n FROM clk WHERE cur AND ekey IS NOT NULL GROUP BY 1, 2),
  -- Comptes venus par Madrid : créés puis sortis vers une billetterie de Madrid sous 7 jours.
  acc AS MATERIALIZED (
    SELECT p.id, p.created_at FROM public.profiles p
    JOIN (SELECT c.user_id, min(c.clicked_at) AS first_click FROM public.affiliate_clicks c
          WHERE c.affiliate_id IN (SELECT id FROM aff) AND c.user_id IS NOT NULL AND NOT COALESCE(c.is_internal, false)
          GROUP BY 1) f ON f.user_id = p.id
    WHERE p.id NOT IN (SELECT uid FROM staff WHERE uid IS NOT NULL)
      AND f.first_click >= p.created_at AND f.first_click < p.created_at + interval '7 days'),
  nights AS (SELECT gs::date AS d, row_number() OVER (ORDER BY gs) - 1 AS i FROM generate_series(v_n0, v_n1, interval '1 day') gs),
  rep AS (
    SELECT count(*) AS n, COALESCE(sum(tickets_sold), 0) AS tickets, COALESCE(sum(revenue_amount), 0) AS revenue,
           COALESCE(sum(commission_due), 0) AS commission,
           COALESCE(sum(commission_due) FILTER (WHERE commission_status IN ('paid', 'settled')), 0) AS commission_paid,
           count(*) FILTER (WHERE created_at >= v_from) AS n_cur
    FROM public.affiliate_reported_sales WHERE affiliate_id IN (SELECT id FROM aff))
  SELECT jsonb_build_object(
    'days', v_days,
    'night', v_n1,
    'since', jsonb_build_object(
      'platform', (SELECT min(occurred_at) FROM public.platform_page_views),
      'clicks', (SELECT min(clicked_at) FROM public.affiliate_clicks WHERE affiliate_id IN (SELECT id FROM aff)),
      'consent', (SELECT min(visited_at) FROM avs)),
    'kpis', jsonb_build_object(
      'visitors', jsonb_build_object('cur', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur), 'prev', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE NOT cur)),
      'event_viewers', jsonb_build_object('cur', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur AND saw_event), 'prev', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE NOT cur AND saw_event)),
      'robots', jsonb_build_object('cur', (SELECT count(*) FROM ses WHERE cur AND robot), 'sessions', (SELECT count(*) FROM ses WHERE cur)),
      'exits', jsonb_build_object('cur', (SELECT count(*) FROM clk WHERE cur), 'prev', (SELECT count(*) FROM clk WHERE NOT cur AND clicked_at >= v_pfrom)),
      'exit_people', jsonb_build_object('cur', (SELECT count(DISTINCT who) FROM clk WHERE cur), 'prev', (SELECT count(DISTINCT who) FROM clk WHERE NOT cur AND clicked_at >= v_pfrom)),
      'accounts', jsonb_build_object('cur', (SELECT count(*) FROM acc WHERE created_at >= v_from), 'prev', (SELECT count(*) FROM acc WHERE created_at >= v_pfrom AND created_at < v_from))),
    'reported', (SELECT jsonb_build_object('rows', n, 'rows_cur', n_cur, 'tickets', tickets, 'revenue', revenue, 'commission', commission, 'commission_paid', commission_paid) FROM rep),
    'v28', jsonb_build_object(
      'visitors', jsonb_build_object('cur', (SELECT count(DISTINCT visitor_hash) FROM ses56 WHERE cur), 'prev', (SELECT count(DISTINCT visitor_hash) FROM ses56 WHERE NOT cur)),
      'exits', jsonb_build_object('cur', (SELECT count(*) FROM clk WHERE clicked_at >= v_now - interval '28 days'), 'prev', (SELECT count(*) FROM clk WHERE clicked_at < v_now - interval '28 days' AND clicked_at >= v_now - interval '56 days')),
      'exit_people', jsonb_build_object('cur', (SELECT count(DISTINCT who) FROM clk WHERE clicked_at >= v_now - interval '28 days'), 'prev', (SELECT count(DISTINCT who) FROM clk WHERE clicked_at < v_now - interval '28 days' AND clicked_at >= v_now - interval '56 days')),
      'returning', (SELECT jsonb_build_object('base', count(DISTINCT a.visitor_id), 'back', count(DISTINCT a.visitor_id) FILTER (WHERE f.first_at < v_now - interval '28 days'))
                    FROM avs a JOIN avs_first f USING (visitor_id) WHERE a.visited_at >= v_now - interval '28 days'),
      'accounts', jsonb_build_object('cur', (SELECT count(*) FROM acc WHERE created_at >= v_now - interval '28 days'), 'prev', (SELECT count(*) FROM acc WHERE created_at >= v_now - interval '56 days' AND created_at < v_now - interval '28 days'))),
    -- Par nuit (heure de Paris − 8 h), alignée sur la période précédente par rang.
    'series', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'd', n.d,
        'visitors', COALESCE(a.n, 0), 'exits', COALESCE(b.n, 0),
        'prev_visitors', COALESCE(a2.n, 0), 'prev_exits', COALESCE(b2.n, 0)) ORDER BY n.d), '[]'::jsonb)
      FROM nights n
      LEFT JOIN hum_n a ON a.night = n.d LEFT JOIN clk_n b ON b.night = n.d
      LEFT JOIN hum_n a2 ON a2.night = n.d - v_days LEFT JOIN clk_n b2 ON b2.night = n.d - v_days),
    'funnel', jsonb_build_object(
      'visitors', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur),
      'event_viewers', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur AND saw_event),
      'exit_people', (SELECT count(DISTINCT who) FROM clk WHERE cur),
      'exits', (SELECT count(*) FROM clk WHERE cur)),
    'clubs', (SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'exits')::int DESC, (r->>'visitors')::int DESC, r->>'name'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'id', v.id, 'name', v.name, 'slug', v.slug, 'active', v.is_active,
          'visitors', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.venue_id = v.id),
          'views', (SELECT count(*) FROM pvh p WHERE p.venue_id = v.id),
          'exits', (SELECT count(*) FROM clk c WHERE c.cur AND c.venue_id = v.id),
          'prev_exits', (SELECT count(*) FROM clk c WHERE NOT c.cur AND c.clicked_at >= v_pfrom AND c.venue_id = v.id),
          'exit_people', (SELECT count(DISTINCT c.who) FROM clk c WHERE c.cur AND c.venue_id = v.id),
          'nights', (SELECT count(*) FROM ev e WHERE e.affiliate_venue_id = v.id AND e.status = 'published' AND e.event_date BETWEEN v_n0 AND v_n1)) AS r
        FROM ven v) z
        WHERE (r->>'visitors')::int + (r->>'exits')::int + (r->>'nights')::int > 0 OR (r->>'active')::boolean),
    'unknown_club', jsonb_build_object(
      'visitors', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind IN ('event', 'venue') AND p.venue_id IS NULL),
      'exits', (SELECT count(*) FROM clk WHERE cur AND venue_id IS NULL)),
    'events', (SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'exits')::int DESC, (r->>'visitors')::int DESC, r->>'date' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'key', k.key, 'slug', k.slug, 'name', k.name, 'date', k.event_date, 'club', v.name, 'recurring', k.recurring,
          'visitors', k.visitors, 'exits', k.exits, 'exit_people', k.exit_people,
          'spark', (SELECT jsonb_agg(COALESCE(ce.n, 0) ORDER BY g)
                    FROM generate_series(GREATEST(v_n0, COALESCE(k.event_date, v_n1) - 13), LEAST(v_n1, COALESCE(k.event_date, v_n1)), interval '1 day') g
                    LEFT JOIN clk_en ce ON ce.ekey = k.key AND ce.night = g::date)) AS r
        FROM (
          SELECT COALESCE(u.key, c.key) AS key, COALESCE(u.slug, c.slug) AS slug, COALESCE(u.name, c.name) AS name,
                 COALESCE(u.event_date, c.event_date) AS event_date, COALESCE(u.venue_id, c.venue_id) AS venue_id,
                 COALESCE(u.recurring, c.recurring, false) AS recurring,
                 COALESCE(u.visitors, 0) AS visitors, COALESCE(c.exits, 0) AS exits, COALESCE(c.exit_people, 0) AS exit_people
          FROM (SELECT COALESCE(p.event_id::text, p.slug) AS key, max(p.slug) AS slug, max(p.event_name) AS name, max(p.event_date) AS event_date,
                       (array_agg(p.venue_id) FILTER (WHERE p.venue_id IS NOT NULL))[1] AS venue_id, bool_or(p.recurring) AS recurring,
                       count(DISTINCT p.visitor_hash) AS visitors
                FROM pvh p WHERE p.kind = 'event' GROUP BY 1) u
          FULL JOIN (SELECT ekey AS key, max(slug) AS slug, max(ename) AS name, max(event_date) AS event_date,
                            (array_agg(venue_id) FILTER (WHERE venue_id IS NOT NULL))[1] AS venue_id, bool_or(recurring) AS recurring,
                            count(*) AS exits, count(DISTINCT who) AS exit_people
                     FROM clk WHERE cur AND ekey IS NOT NULL GROUP BY 1) c
            ON c.key = u.key
          ORDER BY COALESCE(c.exits, 0) DESC, COALESCE(u.visitors, 0) DESC LIMIT 60) k
        LEFT JOIN ven v ON v.id = k.venue_id) z),
    -- Soirs de la semaine : par jour de la SOIRÉE visée (lundi = 1).
    'weekdays', (SELECT jsonb_agg(jsonb_build_object(
        'dow', g,
        'nights', (SELECT count(*) FROM ev e WHERE e.status = 'published' AND e.event_date BETWEEN v_n0 AND v_n1 AND extract(isodow FROM e.event_date) = g),
        'visitors', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind = 'event' AND extract(isodow FROM p.event_date) = g),
        'exits', (SELECT count(*) FROM clk c WHERE c.cur AND extract(isodow FROM c.event_date) = g)) ORDER BY g) FROM generate_series(1, 7) g),
    'kinds', jsonb_build_object(
      'recurring', jsonb_build_object(
        'nights', (SELECT count(*) FROM ev WHERE status = 'published' AND recurring_template_id IS NOT NULL AND event_date BETWEEN v_n0 AND v_n1),
        'visitors', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind = 'event' AND p.recurring),
        'exits', (SELECT count(*) FROM clk WHERE cur AND recurring)),
      'oneoff', jsonb_build_object(
        'nights', (SELECT count(*) FROM ev WHERE status = 'published' AND recurring_template_id IS NULL AND event_date BETWEEN v_n0 AND v_n1),
        'visitors', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind = 'event' AND NOT p.recurring),
        'exits', (SELECT count(*) FROM clk WHERE cur AND NOT recurring AND ekey IS NOT NULL))),
    'pages', jsonb_build_object(
      'event', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind = 'event'),
      'venue', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind = 'venue'),
      'linktree', (SELECT count(DISTINCT p.visitor_hash) FROM pvh p WHERE p.kind IN ('linktree', 'promo'))),
    'sources', (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', k,
        'visitors', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur AND src = k),
        'exits', (SELECT count(*) FROM clk WHERE cur AND src = k)) ORDER BY k), '[]'::jsonb)
        FROM unnest(ARRAY['app', 'instagram', 'linktree', 'social', 'ads', 'search', 'yuno', 'direct', 'other']) k),
    'app_web', jsonb_build_object(
      'app', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur AND is_native),
      'web', (SELECT count(DISTINCT visitor_hash) FROM hum WHERE cur AND NOT is_native),
      'signed_in', (SELECT count(*) FROM hum WHERE cur AND is_authenticated)),
    'languages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', key, 'n', n) ORDER BY n DESC, key), '[]'::jsonb) FROM (
        SELECT COALESCE(language, '?') AS key, count(DISTINCT visitor_hash) AS n FROM hum WHERE cur GROUP BY 1) z),
    'countries', (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', key, 'n', n) ORDER BY n DESC, key), '[]'::jsonb) FROM (
        SELECT COALESCE(country, '?') AS key, count(DISTINCT visitor_hash) AS n FROM hum WHERE cur GROUP BY 1) z),
    'hours', (SELECT jsonb_agg((SELECT count(*) FROM hum WHERE cur AND hr = g) ORDER BY g) FROM generate_series(0, 23) g),
    'visit_days', (SELECT jsonb_agg((SELECT count(*) FROM hum WHERE cur AND dw = g) ORDER BY g) FROM generate_series(1, 7) g),
    'returning', (SELECT jsonb_build_object(
        'base', count(DISTINCT a.visitor_id),
        'back', count(DISTINCT a.visitor_id) FILTER (WHERE f.first_at < v_from),
        'multi', (SELECT count(*) FROM (SELECT visitor_id FROM avs WHERE visited_at >= v_from GROUP BY 1 HAVING count(DISTINCT public._admin_madrid_night(visited_at)) > 1) m))
        FROM avs a JOIN avs_first f USING (visitor_id) WHERE a.visited_at >= v_from),
    -- Cohortes (mesure avec consentement) : semaine de première visite, revenus en semaine k.
    'cohorts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('wk', c.first_wk, 'size', c.size, 'cells', c.cells) ORDER BY c.first_wk), '[]'::jsonb) FROM (
        SELECT f.first_wk, count(*) AS size,
               (SELECT jsonb_agg(CASE WHEN f.first_wk + 7 * k > (v_now AT TIME ZONE 'Europe/Paris')::date THEN NULL
                                      ELSE (SELECT count(DISTINCT a.visitor_id) FROM avs a JOIN avs_first f2 USING (visitor_id)
                                            WHERE f2.first_wk = f.first_wk AND a.wk = f.first_wk + 7 * k) END ORDER BY k)
                FROM generate_series(1, 6) k) AS cells
        FROM avs_first f WHERE f.first_wk >= date_trunc('week', v_now - interval '12 weeks')::date GROUP BY f.first_wk) c),
    'months', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'm', m.m,
        'exits', (SELECT count(*) FROM public.affiliate_clicks c WHERE c.affiliate_id IN (SELECT id FROM aff) AND NOT COALESCE(c.is_internal, false)
                    AND (c.user_id IS NULL OR c.user_id NOT IN (SELECT uid FROM staff WHERE uid IS NOT NULL))
                    AND c.clicked_at >= m.m AND c.clicked_at < m.m + interval '1 month'),
        'accounts', (SELECT count(*) FROM acc WHERE acc.created_at >= m.m AND acc.created_at < m.m + interval '1 month'),
        'cost', i.cost_eur, 'hours', i.hours, 'note', i.note) ORDER BY m.m DESC), '[]'::jsonb)
        FROM (SELECT gs::date AS m FROM generate_series(date_trunc('month', v_now - interval '11 months'), date_trunc('month', v_now), interval '1 month') gs) m
        LEFT JOIN public.admin_madrid_inputs i ON i.month = m.m)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.admin_madrid_traffic(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_madrid_traffic(integer, boolean) TO authenticated, service_role;

-- ── Effet sur Yuno et santé du catalogue ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_madrid_offer(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 400);
  v_now  timestamptz := now();
  v_from timestamptz;
  v_n1   date;
  v_out  jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  v_from := v_now - make_interval(days => v_days);
  v_n1   := public._admin_madrid_night(v_now);

  WITH
  aff AS MATERIALIZED (SELECT public._admin_madrid_affiliates(COALESCE(p_include_demo, false)) AS id),
  staff AS MATERIALIZED (SELECT public._admin_madrid_staff(COALESCE(p_include_demo, false)) AS uid),
  ven AS MATERIALIZED (SELECT v.id, v.name, v.slug, v.is_active FROM public.affiliate_venues v WHERE v.affiliate_id IN (SELECT id FROM aff)),
  ev AS MATERIALIZED (
    SELECT e.id, e.slug, e.name, e.event_date, e.affiliate_venue_id, e.recurring_template_id, e.status,
           NULLIF(trim(COALESCE(e.external_ticket_url, '')), '') AS url, e.flyer_url
    FROM public.affiliate_events e WHERE e.affiliate_id IN (SELECT id FROM aff)),
  tpl AS MATERIALIZED (
    SELECT t.id, t.name, t.affiliate_venue_id, t.is_active, t.day_of_week FROM public.affiliate_recurring_templates t
    WHERE t.affiliate_id IN (SELECT id FROM aff)),
  clk AS MATERIALIZED (
    SELECT c.user_id, c.clicked_at, c.affiliate_event_id FROM public.affiliate_clicks c
    WHERE c.affiliate_id IN (SELECT id FROM aff) AND NOT COALESCE(c.is_internal, false)
      AND (c.user_id IS NULL OR c.user_id NOT IN (SELECT uid FROM staff WHERE uid IS NOT NULL))),
  -- Personnes de Madrid connues de Yuno : sorties connectées, favoris, ville du profil.
  who AS MATERIALIZED (
    SELECT p.id, p.created_at, lower(trim(COALESCE(p.city, ''))) LIKE 'madrid%' AS city_madrid,
           (SELECT min(c.clicked_at) FROM clk c WHERE c.user_id = p.id) AS first_click,
           EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = p.id
                     AND (f.affiliate_event_id IN (SELECT id FROM ev) OR f.affiliate_venue_id IN (SELECT id FROM ven))) AS fav
    FROM public.profiles p
    WHERE p.id NOT IN (SELECT uid FROM staff WHERE uid IS NOT NULL)
      AND (p.id IN (SELECT user_id FROM clk WHERE user_id IS NOT NULL)
           OR lower(trim(COALESCE(p.city, ''))) LIKE 'madrid%'
           OR EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = p.id
                        AND (f.affiliate_event_id IN (SELECT id FROM ev) OR f.affiliate_venue_id IN (SELECT id FROM ven))))),
  -- Un compte « venu par Madrid » : créé, puis sorti vers une billetterie de Madrid sous 7 jours.
  came AS MATERIALIZED (SELECT * FROM who WHERE first_click >= created_at AND first_click < created_at + interval '7 days'),
  dev AS MATERIALIZED (SELECT CASE WHEN COALESCE(p_include_demo, false) THEN ARRAY[]::uuid[] ELSE public.demo_event_ids() END AS ids),
  -- Achats DANS Yuno après la première sortie vers Madrid (billets payés, tables payées), soirées démo exclues.
  buys AS MATERIALIZED (
    SELECT w.id, 'ticket' AS k, t.total_price AS amount, COALESCE(t.service_fee, 0) AS fee, COALESCE(t.paid_at, t.created_at) AS at
    FROM who w JOIN public.tickets t ON t.user_id = w.id
    WHERE w.first_click IS NOT NULL AND t.status IN ('paid', 'used') AND COALESCE(t.paid_at, t.created_at) > w.first_click
      AND NOT EXISTS (SELECT 1 FROM dev WHERE t.event_id = ANY (dev.ids))
    UNION ALL
    SELECT w.id, 'table', r.total_price, COALESCE(r.service_fee, 0), COALESCE(r.paid_at, r.created_at)
    FROM who w JOIN public.table_reservations r ON r.user_id = w.id
    WHERE w.first_click IS NOT NULL AND r.status IN ('paid', 'confirmed') AND COALESCE(r.paid_at, r.created_at) > w.first_click
      AND NOT EXISTS (SELECT 1 FROM dev WHERE r.event_id = ANY (dev.ids))),
  norm_ven AS MATERIALIZED (
    SELECT v.id, v.name, v.is_active,
           regexp_replace(regexp_replace(lower(v.name), '\m(the|club|madrid)\M', '', 'g'), '[^a-z0-9]', '', 'g') AS k
    FROM ven v),
  wk AS (SELECT gs::date AS w, row_number() OVER (ORDER BY gs) - 1 AS i
         FROM generate_series(date_trunc('week', v_n1::timestamp), date_trunc('week', v_n1::timestamp) + interval '7 weeks', interval '1 week') gs),
  last_run AS (SELECT r.* FROM public.affiliate_ticket_sync_runs r WHERE r.affiliate_id IN (SELECT id FROM aff) ORDER BY r.ran_at DESC LIMIT 1)
  SELECT jsonb_build_object(
    'days', v_days,
    'night', v_n1,
    'yuno', jsonb_build_object(
      'known', (SELECT count(*) FROM who),
      'clicked_signed_in', (SELECT count(*) FROM who WHERE first_click IS NOT NULL),
      'came', (SELECT count(*) FROM came),
      'came_cur', (SELECT count(*) FROM came WHERE created_at >= v_from),
      'city_madrid', (SELECT count(*) FROM who WHERE city_madrid),
      'favorites', (SELECT count(*) FROM who WHERE fav),
      'push', (SELECT count(DISTINCT s.user_id) FROM public.push_subscriptions s WHERE s.user_id IN (SELECT id FROM who)),
      'push_came', (SELECT count(DISTINCT s.user_id) FROM public.push_subscriptions s WHERE s.user_id IN (SELECT id FROM came)),
      'app_sessions', (SELECT count(*) FROM public.platform_sessions s WHERE s.is_native AND s.started_at >= v_from
                         AND EXISTS (SELECT 1 FROM public.platform_page_views p WHERE p.session_id = s.id
                                       AND (p.path LIKE '/affiliate-event/%' OR p.path LIKE '/affiliate-venue/%'))),
      'app_signed_in', (SELECT count(*) FROM public.platform_sessions s WHERE s.is_native AND s.is_authenticated AND s.started_at >= v_from
                         AND EXISTS (SELECT 1 FROM public.platform_page_views p WHERE p.session_id = s.id
                                       AND (p.path LIKE '/affiliate-event/%' OR p.path LIKE '/affiliate-venue/%'))),
      'buyers', (SELECT count(DISTINCT id) FROM buys),
      'buyers_came', (SELECT count(DISTINCT id) FROM buys WHERE id IN (SELECT id FROM came)),
      'orders', (SELECT count(*) FROM buys),
      'spend', (SELECT COALESCE(sum(amount), 0) FROM buys),
      'fees', (SELECT COALESCE(sum(fee), 0) FROM buys),
      'spend_came', (SELECT COALESCE(sum(amount), 0) FROM buys WHERE id IN (SELECT id FROM came)),
      'fees_came', (SELECT COALESCE(sum(fee), 0) FROM buys WHERE id IN (SELECT id FROM came)),
      'months', (SELECT COALESCE(jsonb_agg(jsonb_build_object('m', m, 'accounts', a) ORDER BY m), '[]'::jsonb) FROM (
          SELECT date_trunc('month', created_at)::date AS m, count(*) AS a FROM came GROUP BY 1) z)),
    -- Clubs de Madrid (catalogue) qu'on retrouve chez Yuno : client, inscription, prospect.
    'pros', (SELECT COALESCE(jsonb_agg(jsonb_build_object('club', nv.name, 'active', nv.is_active, 'kind', m.kind, 'label', m.label, 'at', m.at) ORDER BY m.at DESC), '[]'::jsonb)
      FROM norm_ven nv
      JOIN LATERAL (
        SELECT 'venue' AS kind, v.name AS label, v.created_at AS at FROM public.venues v
         WHERE length(nv.k) >= 3 AND regexp_replace(regexp_replace(lower(v.name), '\m(the|club|madrid)\M', '', 'g'), '[^a-z0-9]', '', 'g') = nv.k
           AND (COALESCE(p_include_demo, false) OR v.id <> ALL (SELECT unnest(public.demo_venue_ids())))
        UNION ALL
        SELECT 'signup', s.org_name, s.created_at FROM public.pro_signups s
         WHERE length(nv.k) >= 3 AND regexp_replace(regexp_replace(lower(COALESCE(s.org_name, '')), '\m(the|club|madrid)\M', '', 'g'), '[^a-z0-9]', '', 'g') = nv.k
        UNION ALL
        SELECT 'lead', l.org_name, l.created_at FROM public.links_pro_leads l
         WHERE length(nv.k) >= 3 AND regexp_replace(regexp_replace(lower(COALESCE(l.org_name, '')), '\m(the|club|madrid)\M', '', 'g'), '[^a-z0-9]', '', 'g') = nv.k
      ) m ON true),
    'madrid_pros', jsonb_build_object(
      'signups', (SELECT count(*) FROM public.pro_signups s WHERE lower(COALESCE(s.city, '')) LIKE 'madrid%' AND COALESCE(s.robot, '') = ''),
      'signups_account', (SELECT count(*) FROM public.pro_signups s WHERE lower(COALESCE(s.city, '')) LIKE 'madrid%' AND s.user_id IS NOT NULL),
      'leads', (SELECT count(*) FROM public.links_pro_leads l WHERE lower(COALESCE(l.city, '')) LIKE 'madrid%'),
      'venues', (SELECT count(*) FROM public.venues v WHERE lower(COALESCE(v.city, '')) LIKE 'madrid%' AND NOT COALESCE(v.is_hidden, false) AND v.decommissioned_at IS NULL)),
    -- Santé du catalogue.
    'supply', jsonb_build_object(
      'clubs_active', (SELECT count(*) FROM ven WHERE is_active),
      'clubs_total', (SELECT count(*) FROM ven),
      'upcoming_published', (SELECT count(*) FROM ev WHERE status = 'published' AND event_date BETWEEN v_n1 AND v_n1 + 27),
      'upcoming_week', (SELECT count(*) FROM ev WHERE status = 'published' AND event_date BETWEEN v_n1 AND v_n1 + 6),
      'clubs_with_upcoming', (SELECT count(DISTINCT affiliate_venue_id) FROM ev WHERE status = 'published' AND event_date BETWEEN v_n1 AND v_n1 + 13),
      'weeks', (SELECT jsonb_agg(w.w ORDER BY w.w) FROM wk w),
      'clubs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', v.id, 'name', v.name, 'active', v.is_active,
          'next', (SELECT min(event_date) FROM ev e WHERE e.affiliate_venue_id = v.id AND e.status = 'published' AND e.event_date >= v_n1),
          'templates', (SELECT count(*) FROM tpl t WHERE t.affiliate_venue_id = v.id AND t.is_active),
          'drafts', (SELECT count(*) FROM ev e WHERE e.affiliate_venue_id = v.id AND e.status = 'draft' AND e.event_date BETWEEN v_n1 AND v_n1 + 55),
          'weeks', (SELECT jsonb_agg((SELECT count(*) FROM ev e WHERE e.affiliate_venue_id = v.id AND e.status = 'published'
                                        AND e.event_date >= w.w AND e.event_date < w.w + 7 AND e.event_date >= v_n1) ORDER BY w.w) FROM wk w))
          ORDER BY v.is_active DESC, v.name), '[]'::jsonb) FROM ven v),
      -- Une soirée sans lien de billetterie ne peut pas faire sortir : elle reste en brouillon.
      'blocked', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'date', e.event_date, 'club', v.name) ORDER BY e.event_date, v.name), '[]'::jsonb)
          FROM ev e JOIN ven v ON v.id = e.affiliate_venue_id
          WHERE v.is_active AND e.status = 'draft' AND e.url IS NULL AND e.event_date BETWEEN v_n1 AND v_n1 + 13),
      'blocked_total', (SELECT count(*) FROM ev e JOIN ven v ON v.id = e.affiliate_venue_id
          WHERE v.is_active AND e.status = 'draft' AND e.url IS NULL AND e.event_date BETWEEN v_n1 AND v_n1 + 55),
      'inactive_drafts', (SELECT count(*) FROM ev e JOIN ven v ON v.id = e.affiliate_venue_id WHERE NOT v.is_active AND e.status = 'draft' AND e.event_date >= v_n1),
      'inactive_templates', (SELECT count(*) FROM tpl t JOIN ven v ON v.id = t.affiliate_venue_id WHERE NOT v.is_active AND t.is_active),
      'no_flyer', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'date', e.event_date, 'club', v.name) ORDER BY e.event_date), '[]'::jsonb)
          FROM ev e LEFT JOIN ven v ON v.id = e.affiliate_venue_id
          WHERE e.status = 'published' AND e.event_date BETWEEN v_n1 AND v_n1 + 27 AND NULLIF(trim(COALESCE(e.flyer_url, '')), '') IS NULL),
      'templates_idle', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'club', v.name, 'dow', t.day_of_week) ORDER BY v.name, t.name), '[]'::jsonb)
          FROM tpl t JOIN ven v ON v.id = t.affiliate_venue_id
          WHERE t.is_active AND v.is_active
            AND NOT EXISTS (SELECT 1 FROM ev e WHERE e.recurring_template_id = t.id AND e.status = 'published' AND e.event_date BETWEEN v_n1 AND v_n1 + 27)),
      -- Soirées publiées de la période, déjà passées, que personne n'a ouvertes vers la billetterie.
      'past_published', (SELECT count(*) FROM ev WHERE status = 'published' AND event_date < v_n1 AND event_date >= public._admin_madrid_night(v_from)),
      'never_clicked', (SELECT count(*) FROM ev e WHERE e.status = 'published' AND e.event_date < v_n1 AND e.event_date >= public._admin_madrid_night(v_from)
          AND NOT EXISTS (SELECT 1 FROM clk c WHERE c.affiliate_event_id = e.id)),
      'never_clicked_list', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'date', e.event_date, 'club', v.name) ORDER BY e.event_date DESC), '[]'::jsonb)
          FROM (SELECT * FROM ev e WHERE e.status = 'published' AND e.event_date < v_n1 AND e.event_date >= public._admin_madrid_night(v_from)
                  AND NOT EXISTS (SELECT 1 FROM clk c WHERE c.affiliate_event_id = e.id) ORDER BY e.event_date DESC LIMIT 30) e
          LEFT JOIN ven v ON v.id = e.affiliate_venue_id)),
    'sync', jsonb_build_object(
      'last', (SELECT jsonb_build_object('at', ran_at, 'trigger', trigger, 'links', links_filled, 'images', images_set, 'names', names_set,
                                         'one_offs', one_offs_created, 'unmatched', COALESCE(unmatched, '[]'::jsonb),
                                         'errors', CASE WHEN jsonb_typeof(errors) = 'array' THEN jsonb_array_length(errors) ELSE 0 END) FROM last_run),
      'days', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', g::date,
          'runs', (SELECT count(*) FROM public.affiliate_ticket_sync_runs r WHERE r.affiliate_id IN (SELECT id FROM aff) AND (r.ran_at AT TIME ZONE 'Europe/Paris')::date = g::date),
          'links', (SELECT COALESCE(sum(links_filled), 0) FROM public.affiliate_ticket_sync_runs r WHERE r.affiliate_id IN (SELECT id FROM aff) AND (r.ran_at AT TIME ZONE 'Europe/Paris')::date = g::date),
          'errors', (SELECT count(*) FROM public.affiliate_ticket_sync_runs r WHERE r.affiliate_id IN (SELECT id FROM aff) AND (r.ran_at AT TIME ZONE 'Europe/Paris')::date = g::date
                       AND jsonb_typeof(r.errors) = 'array' AND jsonb_array_length(r.errors) > 0)) ORDER BY g), '[]'::jsonb)
          FROM generate_series(((v_now AT TIME ZONE 'Europe/Paris')::date - 29), (v_now AT TIME ZONE 'Europe/Paris')::date, interval '1 day') g),
      'sources', (SELECT COALESCE(jsonb_agg(jsonb_build_object('account', account_slug, 'provider', provider, 'priority', priority, 'active', is_active, 'one_offs', create_one_offs) ORDER BY priority), '[]'::jsonb)
          FROM public.affiliate_ticket_sources WHERE affiliate_id IN (SELECT id FROM aff)),
      'seen', (SELECT count(*) FROM public.affiliate_ticket_sync_seen WHERE affiliate_id IN (SELECT id FROM aff)))
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.admin_madrid_offer(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_madrid_offer(integer, boolean) TO authenticated, service_role;

-- ── Saisie du mois ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_madrid_input_set(p_month date, p_cost numeric, p_hours numeric, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_m date := date_trunc('month', p_month)::date;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF p_month IS NULL THEN RAISE EXCEPTION 'month_required' USING ERRCODE = '22023'; END IF;
  IF (p_cost IS NOT NULL AND p_cost < 0) OR (p_hours IS NOT NULL AND p_hours < 0) THEN
    RAISE EXCEPTION 'negative_value' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL AND p_hours IS NULL AND NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN
    DELETE FROM public.admin_madrid_inputs WHERE month = v_m;
  ELSE
    INSERT INTO public.admin_madrid_inputs (month, cost_eur, hours, note, updated_by, updated_at)
    VALUES (v_m, round(p_cost, 2), round(p_hours, 1), NULLIF(trim(COALESCE(p_note, '')), ''), auth.uid(), now())
    ON CONFLICT (month) DO UPDATE
      SET cost_eur = EXCLUDED.cost_eur, hours = EXCLUDED.hours, note = EXCLUDED.note,
          updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'madrid_input_set', 'admin_madrid_inputs', v_m::text,
          jsonb_build_object('cost', p_cost, 'hours', p_hours));
END $$;
REVOKE ALL ON FUNCTION public.admin_madrid_input_set(date, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_madrid_input_set(date, numeric, numeric, text) TO authenticated, service_role;
