-- Yuno Tickets › Analyses › Trafic, lot 4 du plan combiné
-- (docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md) : le détail sous
-- « D'où vient mon public ? ». Une lecture à part, chargée avec l'onglet,
-- qui ne change rien à tix_ana_traffic :
--
--   1. La page du club / de l'organisateur : visites (entrée sur la page
--      `venue_page` / `organizer_profile`, règle de get_page_traffic),
--      visiteurs, retours, d'où elles viennent (referrer_category) et celles
--      qui ont fini par un achat (le même appareil achète une soirée de la
--      portée dans les 24 h). Pas dans la vue d'une soirée.
--   2. Les liens suivis de la portée : clics de la période, ventes lues sur la
--      vente (tracked_link_id), famille de source du lien (`_tix_source`, le
--      lien d'un promoteur sous « promoteurs ») : l'écran les range sous leur
--      source.
--   3. Les e-mails et les push de la période : envoyés, ouverts, cliqués, et
--      ce qui a été acheté dans les 7 jours après un clic (dernier clic d'un
--      même canal ; décision D7). Les renvois comptent pour leur campagne, les
--      e-mails des automatisations par recette. Une vente peut donc venir d'un
--      e-mail ET d'une autre source : l'écran le dit.
--
-- Montants sous `revenue` / `prev_revenue` : l'enveloppe de l'argent les efface.

CREATE OR REPLACE FUNCTION public.tix_ana_traffic_detail__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_ev uuid;
  v_page jsonb; v_links jsonb; v_msgs jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;
  v_ev := (m->'event'->>'id')::uuid;

  -- ── 1. La page du club / de l'organisateur ──────────────────────────────
  IF v_ev IS NULL THEN
    WITH page AS MATERIALIZED (
      SELECT s.visited_at, s.visitor_id, COALESCE(s.visitor_id::text, s.session_id) AS visitor,
             COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS source,
             COALESCE(s.is_returning, false) AS ret,
             COALESCE(s.completed_order, false) AS done,
             public._tix_bucket(s.visited_at, NULL, m, false) AS ci,
             public._tix_bucket(s.visited_at, NULL, m, true) AS pi
        FROM public.visitor_sessions s
       WHERE ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id AND s.entry_page_type = 'venue_page')
           OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id AND s.entry_page_type = 'organizer_profile'))
         AND s.visited_at > now() - interval '25 months'
    ), pg AS (
      SELECT p.*, (p.done OR (p.visitor_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.visitor_sessions b
                WHERE b.visitor_id = p.visitor_id AND COALESCE(b.completed_order, false)
                  AND b.event_id IN (SELECT id FROM _aev)
                  AND b.visited_at >= p.visited_at AND b.visited_at < p.visited_at + interval '24 hours'))) AS ordered
        FROM page p WHERE p.ci IS NOT NULL
    )
    SELECT jsonb_build_object(
             'kind', CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
             'visits', (SELECT count(*) FROM pg),
             'prev_visits', (SELECT count(*) FROM page WHERE pi IS NOT NULL),
             'visitors', (SELECT count(DISTINCT visitor) FROM pg),
             'returning', (SELECT count(*) FROM pg WHERE ret),
             'ordered', (SELECT count(*) FROM pg WHERE ordered),
             'series', (SELECT jsonb_agg(COALESCE(b.n, 0) ORDER BY g)
                          FROM generate_series(0, v_n - 1) g
                          LEFT JOIN (SELECT ci, count(*) AS n FROM pg GROUP BY 1) b ON b.ci = g),
             'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', x.source, 'visits', x.n, 'ordered', x.o) ORDER BY x.n DESC)
                                   FROM (SELECT source, count(*) AS n, count(*) FILTER (WHERE ordered) AS o FROM pg GROUP BY 1) x), '[]'::jsonb))
      INTO v_page;
  END IF;

  -- ── 2. Les liens suivis de la portée ────────────────────────────────────
  DROP TABLE IF EXISTS _atl;
  CREATE TEMP TABLE _atl ON COMMIT DROP AS
  SELECT tl.id, tl.event_id, tl.code, tl.archived_at IS NOT NULL AS archived,
         -- Le lien de partie d'une co-soirée n'a pas de nom lisible (« coorg ») : l'écran le nomme.
         COALESCE(NULLIF(btrim(tl.partner_name), ''),
                  CASE WHEN tl.utm_medium = 'party_link' THEN NULL ELSE NULLIF(btrim(tl.label), '') END) AS label,
         NULLIF(lower(btrim(tl.utm_source)), '') AS network, NULLIF(lower(btrim(tl.utm_medium)), '') AS placement,
         tl.target_kind,
         CASE WHEN tl.promoter_id IS NOT NULL THEN 'pr'
              ELSE public._tix_source(NULL, tl.utm_source, tl.utm_medium, true, NULL) END AS src
    FROM public.tracked_links tl
   WHERE ((p_venue_id IS NOT NULL AND tl.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND tl.organizer_user_id = p_organizer_user_id))
     AND (tl.event_id IN (SELECT id FROM _aev) OR (tl.event_id IS NULL AND v_ev IS NULL))
     AND (v_ev IS NULL OR tl.event_id = v_ev);

  WITH sl AS (
    SELECT x.link_id, a.ci, a.pi, a.qty, a.amount, a.pillar, a.ord
      FROM (
        SELECT t.id, t.tracked_link_id AS link_id FROM public.tickets t WHERE t.tracked_link_id IN (SELECT id FROM _atl)
        UNION ALL
        SELECT r.id, r.tracked_link_id FROM public.table_reservations r WHERE r.tracked_link_id IN (SELECT id FROM _atl)
        UNION ALL
        SELECT g.id, g.tracked_link_id FROM public.guest_list_entries g WHERE g.tracked_link_id IN (SELECT id FROM _atl)
      ) x
      JOIN _atk_all a ON a.id = x.id
     WHERE a.ok
  ), agg AS (
    SELECT link_id,
           count(DISTINCT ord) FILTER (WHERE ci IS NOT NULL AND pillar <> 'guestlist') AS orders,
           COALESCE(sum(qty) FILTER (WHERE ci IS NOT NULL AND pillar = 'tickets'), 0) AS tickets,
           count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'tables') AS tables,
           count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'guestlist') AS guests,
           COALESCE(sum(amount) FILTER (WHERE ci IS NOT NULL), 0) AS revenue,
           count(DISTINCT ord) FILTER (WHERE pi IS NOT NULL AND pillar <> 'guestlist') AS prev_orders
      FROM sl GROUP BY 1
  ), clk AS (
    SELECT c.tracked_link_id AS link_id,
           count(*) FILTER (WHERE public._tix_bucket(c.clicked_at, l.event_id, m, false) IS NOT NULL) AS clicks,
           count(*) FILTER (WHERE public._tix_bucket(c.clicked_at, l.event_id, m, true) IS NOT NULL) AS prev_clicks
      FROM public.tracked_link_clicks c
      JOIN _atl l ON l.id = c.tracked_link_id
     WHERE c.clicked_at > now() - interval '25 months'
     GROUP BY 1
  ), rows AS (
    SELECT l.*, e.title AS event_title, e.start_at AS event_start,
           COALESCE(k.clicks, 0) AS clicks, COALESCE(k.prev_clicks, 0) AS prev_clicks,
           COALESCE(a.orders, 0) AS orders, COALESCE(a.prev_orders, 0) AS prev_orders,
           COALESCE(a.tickets, 0) AS tickets, COALESCE(a.tables, 0) AS tables, COALESCE(a.guests, 0) AS guests,
           COALESCE(a.revenue, 0) AS revenue
      FROM _atl l
      LEFT JOIN _aev e ON e.id = l.event_id
      LEFT JOIN agg a ON a.link_id = l.id
      LEFT JOIN clk k ON k.link_id = l.id
     WHERE COALESCE(k.clicks, 0) > 0 OR COALESCE(a.orders, 0) > 0 OR COALESCE(a.guests, 0) > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'src', r.src, 'label', r.label, 'code', r.code, 'archived', r.archived,
           'network', r.network, 'placement', r.placement, 'target', r.target_kind,
           'event_id', r.event_id, 'event_title', r.event_title, 'event_start', r.event_start,
           'clicks', r.clicks, 'prev_clicks', r.prev_clicks, 'orders', r.orders, 'prev_orders', r.prev_orders,
           'tickets', r.tickets, 'tables', r.tables, 'guests', r.guests, 'revenue', round(r.revenue, 2))
         ORDER BY r.revenue DESC, r.orders DESC, r.clicks DESC), '[]'::jsonb)
    INTO v_links FROM (SELECT * FROM rows ORDER BY revenue DESC, orders DESC, clicks DESC LIMIT 80) r;

  -- ── 3. E-mails et push ──────────────────────────────────────────────────
  -- Les ventes de la période qui peuvent être attribuées (une personne connue).
  DROP TABLE IF EXISTS _amsale;
  CREATE TEMP TABLE _amsale ON COMMIT DROP AS
  SELECT a.id, a.email, a.bought_at, a.amount, a.ord, a.qty, a.pillar,
         COALESCE(t.user_id, r.user_id) AS user_id
    FROM _atk_all a
    LEFT JOIN public.tickets t ON a.pillar = 'tickets' AND t.id = a.id
    LEFT JOIN public.table_reservations r ON a.pillar = 'tables' AND r.id = a.id
   WHERE a.ok AND a.ci IS NOT NULL AND a.pillar <> 'guestlist';
  CREATE INDEX ON _amsale (email);
  CREATE INDEX ON _amsale (user_id);

  -- E-mails de la portée (jamais ceux du CRM) : la « racine » d'un renvoi est
  -- sa campagne, celle d'un e-mail d'automatisation sa recette.
  DROP TABLE IF EXISTS _amc;
  CREATE TEMP TABLE _amc ON COMMIT DROP AS
  SELECT c.id, c.name, c.sent_at, c.event_id, c.automation_id,
         CASE WHEN c.automation_id IS NOT NULL THEN 'auto:' || c.automation_id::text
              ELSE COALESCE(c.parent_campaign_id, c.id)::text END AS root
    FROM public.email_campaigns c
   WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND NOT public.crm_campaign_is_crm(c.id)
     AND c.sent_at > now() - interval '13 months';
  CREATE INDEX ON _amc (id);

  DROP TABLE IF EXISTS _amk;
  CREATE TEMP TABLE _amk ON COMMIT DROP AS
  SELECT c.root, lower(ev.recipient_email) AS email, ev.created_at AS at
    FROM public.email_campaign_events ev
    JOIN _amc c ON c.id = ev.campaign_id
   WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _amk (email, at);

  -- Dernier clic d'un e-mail dans les 7 jours avant l'achat.
  DROP TABLE IF EXISTS _ama;
  CREATE TEMP TABLE _ama ON COMMIT DROP AS
  SELECT DISTINCT ON (s.id) s.id, s.email, s.amount, s.ord, k.root
    FROM _amsale s
    JOIN _amk k ON k.email = s.email AND k.at <= s.bought_at AND k.at > s.bought_at - interval '7 days'
   ORDER BY s.id, k.at DESC;

  -- Push de la portée : tap → achat du même compte dans les 7 jours.
  DROP TABLE IF EXISTS _apc;
  CREATE TEMP TABLE _apc ON COMMIT DROP AS
  SELECT pc.id, pc.title, pc.created_at, pc.event_id, COALESCE(pc.source, 'manual') AS source,
         COALESCE(pc.sent_count, 0) AS sent
    FROM public.push_campaigns pc
   WHERE pc.status = 'sent' AND pc.agency_id IS NULL
     AND pc.venue_id IS NOT DISTINCT FROM p_venue_id AND pc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND pc.created_at > now() - interval '13 months';

  DROP TABLE IF EXISTS _apa;
  CREATE TEMP TABLE _apa ON COMMIT DROP AS
  SELECT DISTINCT ON (s.id) s.id, s.user_id, s.amount, s.ord, k.campaign_id
    FROM _amsale s
    JOIN public.push_campaign_events k ON k.user_id = s.user_id AND k.event_type IN ('clicked', 'opened')
                                       AND k.created_at <= s.bought_at AND k.created_at > s.bought_at - interval '7 days'
    JOIN _apc p ON p.id = k.campaign_id
   WHERE s.user_id IS NOT NULL
   ORDER BY s.id, k.created_at DESC;

  WITH em AS (
    -- Une campagne envoyée pendant la période, ou dont une vente de la période vient.
    SELECT c.root,
           max(c.name) FILTER (WHERE c.id::text = c.root) AS name,
           (array_agg(c.automation_id) FILTER (WHERE c.automation_id IS NOT NULL))[1] AS automation_id,
           min(c.sent_at) FILTER (WHERE c.id::text = c.root OR c.automation_id IS NOT NULL) AS sent_at,
           bool_or(public._tix_bucket(c.sent_at, COALESCE(c.event_id, v_ev), m, false) IS NOT NULL
                   AND (v_ev IS NULL OR c.event_id IS NULL OR c.event_id = v_ev)) AS in_window,
           array_agg(c.id) AS ids
      FROM _amc c GROUP BY c.root
  ), emr AS (
    SELECT em.*,
           (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = ANY (em.ids) AND r.status = 'sent'
               AND (em.automation_id IS NULL OR public._tix_bucket(r.sent_at, v_ev, m, false) IS NOT NULL)) AS sent,
           (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
             WHERE e.campaign_id = ANY (em.ids) AND e.event_type = 'opened'
               AND (em.automation_id IS NULL OR public._tix_bucket(e.created_at, v_ev, m, false) IS NOT NULL)) AS opened,
           (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
             WHERE e.campaign_id = ANY (em.ids) AND e.event_type = 'clicked'
               AND (em.automation_id IS NULL OR public._tix_bucket(e.created_at, v_ev, m, false) IS NOT NULL)) AS clicked,
           (SELECT count(DISTINCT a.email) FROM _ama a WHERE a.root = em.root) AS buyers,
           (SELECT count(DISTINCT a.ord) FROM _ama a WHERE a.root = em.root) AS orders,
           (SELECT COALESCE(sum(a.amount), 0) FROM _ama a WHERE a.root = em.root) AS revenue
      FROM em
  ), pu AS (
    SELECT p.*,
           (SELECT count(DISTINCT k.user_id) FROM public.push_campaign_events k WHERE k.campaign_id = p.id AND k.event_type IN ('clicked', 'opened')) AS opened,
           (SELECT count(DISTINCT a.user_id) FROM _apa a WHERE a.campaign_id = p.id) AS buyers,
           (SELECT count(DISTINCT a.ord) FROM _apa a WHERE a.campaign_id = p.id) AS orders,
           (SELECT COALESCE(sum(a.amount), 0) FROM _apa a WHERE a.campaign_id = p.id) AS revenue,
           public._tix_bucket(p.created_at, COALESCE(p.event_id, v_ev), m, false) IS NOT NULL
             AND (v_ev IS NULL OR p.event_id IS NULL OR p.event_id = v_ev) AS in_window
      FROM _apc p
  ), allm AS (
    SELECT 'email' AS channel, e.root AS id, e.name, e.sent_at AS at,
           (SELECT ea.kind FROM public.email_automations ea WHERE ea.id = e.automation_id) AS recipe,
           e.sent, e.opened, e.clicked, e.buyers, e.orders, e.revenue
      -- Un message qui n'a atteint personne sur la période ne prend pas de ligne.
      FROM emr e WHERE (e.in_window AND e.sent > 0) OR e.orders > 0
    UNION ALL
    SELECT 'push', p.id::text, p.title, p.created_at, CASE WHEN p.source = 'auto' THEN 'auto' END,
           p.sent, p.opened, p.opened, p.buyers, p.orders, p.revenue
      FROM pu p WHERE (p.in_window AND p.sent > 0) OR p.orders > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', x.channel, 'id', x.id, 'name', x.name, 'at', x.at, 'recipe', x.recipe,
           'sent', x.sent, 'opened', x.opened, 'clicked', x.clicked,
           'buyers', x.buyers, 'orders', x.orders, 'revenue', round(x.revenue, 2))
         ORDER BY x.revenue DESC, x.orders DESC, x.at DESC), '[]'::jsonb)
    INTO v_msgs FROM (SELECT * FROM allm ORDER BY revenue DESC, orders DESC, at DESC LIMIT 40) x;

  RETURN jsonb_build_object(
    'meta', m,
    'page', v_page,
    'links', v_links,
    'messages', v_msgs,
    'messages_total', jsonb_build_object(
      'email', jsonb_build_object('orders', (SELECT count(DISTINCT ord) FROM _ama), 'buyers', (SELECT count(DISTINCT email) FROM _ama),
                                  'revenue', (SELECT round(COALESCE(sum(amount), 0), 2) FROM _ama)),
      'push', jsonb_build_object('orders', (SELECT count(DISTINCT ord) FROM _apa), 'buyers', (SELECT count(DISTINCT user_id) FROM _apa),
                                 'revenue', (SELECT round(COALESCE(sum(amount), 0), 2) FROM _apa)))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_traffic_detail(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_traffic_detail__core(p_venue_id, p_organizer_user_id, p_period, p_event), p_venue_id, p_organizer_user_id);
$function$;

-- ── Droits ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('tix_ana_traffic_detail__core', 'tix_ana_traffic_detail') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = 'tix_ana_traffic_detail' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- ── Aperçu démo : la lecture crée des tables temporaires ───────────────────
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.demo_preview_writable_rpc(text)'::regprocedure);
  IF position('''tix_ana_traffic_detail''' IN v_def) = 0 THEN
    IF position('''tix_ana_traffic''' IN v_def) = 0 THEN
      RAISE EXCEPTION 'demo_preview_writable_rpc: tix_ana_traffic introuvable, insertion impossible';
    END IF;
    v_def := replace(v_def, '''tix_ana_traffic''', '''tix_ana_traffic'', ''tix_ana_traffic_detail''');
    EXECUTE v_def;
  END IF;
END $$;
