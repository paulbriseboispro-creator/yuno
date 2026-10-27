-- Yuno CRM › Ventes › « Ce qui a fait vendre », lot C5 (TRAFFIC_TAB_PLAN.md, 27/10).
-- Ajouts ADDITIFS à crm_ana_traffic__core, réécrite depuis pg_get_functiondef
-- de la prod : `links` (ventes par lien Yuno), `messages` (ventes par e-mail,
-- recette ou SMS, attribution _crm_email_attrib), `night_mix` (nouveaux et part
-- Yuno par soirée). Aucune clé retirée : le MCP get_web_traffic lit la fonction.

CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_series jsonb; v_sources jsonb; v_clicks jsonb; v_new jsonb; v_events jsonb; v_first jsonb; v_gained jsonb;
  v_partners jsonb;
  v_links jsonb; v_msgs jsonb; v_mix jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Premier achat de chaque client dans l'espace (toutes époques).
  DROP TABLE IF EXISTS _afirst;
  CREATE TEMP TABLE _afirst ON COMMIT DROP AS
  SELECT DISTINCT ON (a.email) a.email, a.id, a.bought_at, a.src, a.ci, a.pi
    FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL
   ORDER BY a.email, a.bought_at, a.id;

  -- Clics sur les messages Yuno (un clic = une personne et une campagne).
  DROP TABLE IF EXISTS _aclk;
  CREATE TEMP TABLE _aclk ON COMMIT DROP AS
  SELECT k.campaign_id, k.email, k.at, k.event_id,
         public._crm_ana_bucket(m, k.at) AS ci,
         CASE m->>'mode'
           WHEN 'hour' THEN CASE WHEN k.at >= (m->>'start')::timestamptz - make_interval(hours => v_n) AND k.at < (m->>'start')::timestamptz THEN 0 END
           WHEN 'day' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                     BETWEEN (m->>'start')::date - v_n AND (m->>'start')::date - 1 THEN 0 END
           WHEN 'month' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                       >= ((m->>'start')::date - interval '12 months')::date
                                   AND public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int) < (m->>'start')::date THEN 0 END
           ELSE NULL END AS pi
    FROM (
      SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS at, c.event_id
        FROM public.email_campaign_events ev
        JOIN public.email_campaigns c ON c.id = ev.campaign_id
       WHERE ev.event_type = 'clicked'
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND ev.created_at > now() - interval '25 months'
         AND public.crm_campaign_is_crm(c.id)
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  -- Agrégé UNE fois par (case, source), puis lu par case : avant, chaque
  -- case × source relisait tous les billets (20261016210000).
  DROP TABLE IF EXISTS _aser;
  CREATE TEMP TABLE _aser ON COMMIT DROP AS
  SELECT a.ci, a.src, round(sum(a.amount), 2) AS rev, sum(a.qty) AS tk
    FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci, a.src;
  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.rev FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.tk FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE(ck.n, 0),
           'new_buyers', COALESCE(nb.n, 0)
         ) ORDER BY g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g
    LEFT JOIN (SELECT c.ci, count(*) AS n FROM _aclk c WHERE c.ci IS NOT NULL GROUP BY c.ci) ck ON ck.ci = g
    LEFT JOIN (SELECT f.ci, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.ci) nb ON nb.ci = g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  WITH cur AS (
    SELECT a.src, count(DISTINCT a.ord) AS orders, sum(a.qty) AS tk, count(DISTINCT a.email) AS buyers,
           round(sum(a.amount), 2) AS rev
      FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.src
  ), prv AS (
    SELECT a.src, sum(a.qty) AS tk FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.src
  ), nf AS (
    SELECT f.src, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.src
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', COALESCE(cur.orders, 0),
           'tickets', COALESCE(cur.tk, 0),
           'buyers', COALESCE(cur.buyers, 0),
           'new_buyers', COALESCE(nf.n, 0),
           'revenue', COALESCE(cur.rev, 0),
           'prev_tickets', COALESCE(prv.tk, 0)
         ) ORDER BY s.o), '[]'::jsonb)
    INTO v_sources
    FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) WITH ORDINALITY s(k, o)
    LEFT JOIN cur ON cur.src = s.k
    LEFT JOIN prv ON prv.src = s.k
    LEFT JOIN nf ON nf.src = s.k;

  -- Partenaires, un par un (20261108600000). Deux sortes :
  -- * `shotgun` : un lien de suivi Shotgun (source `pa`, par nom). Shotgun ne
  --   rapporte ni ses visites ni ses clics : `clicks` / `visitors` restent NULL,
  --   l'écran dit « Bientôt », jamais un chiffre inventé.
  -- * `yuno` : un lien Yuno /go/ de type « partenaire » sur une soirée de la
  --   portée : clics et visiteurs mesurés par Yuno (tracked_link_clicks), ventes
  --   par sa source `yuno-<code>`, même règle que crm_night_links.
  -- Mêmes ventes, même fenêtre et même « nouveau client » que la table des sources.
  DROP TABLE IF EXISTS _apt;
  CREATE TEMP TABLE _apt ON COMMIT DROP AS
  SELECT a.id, a.email, a.qty, a.amount, a.price, a.ord, a.event_id, a.ci, a.pi, a.src,
         lower(btrim(t.utm->>'utm_source')) AS sk
    FROM _atk_all a JOIN public.external_tickets t ON t.id = a.id
   WHERE a.ok AND (a.src = 'pa' OR a.src IN ('ys', 'yb', 'yt', 'yl'));

  DROP TABLE IF EXISTS _aptl;
  CREATE TEMP TABLE _aptl ON COMMIT DROP AS
  SELECT tl.id, tl.code, public.crm_link_source(tl.code) AS sk, tl.event_id,
         COALESCE(NULLIF(btrim(tl.partner_name), ''), NULLIF(btrim(tl.label), ''), tl.code) AS name
    FROM public.tracked_links tl
   WHERE tl.utm_medium = 'partner'
     AND tl.event_id IN (SELECT e.id FROM _aev e)
     AND (m->>'mode' <> 'event' OR tl.event_id = (m->'event'->>'id')::uuid);

  WITH rows AS (
    SELECT 'shotgun'::text AS via, p.sk AS key, p.sk AS name, NULL::uuid AS link_id, NULL::text AS code, NULL::uuid AS event_id
      FROM _apt p WHERE p.src = 'pa' AND p.sk <> '' GROUP BY p.sk
    UNION ALL
    SELECT 'yuno', l.sk, l.name, l.id, l.code, l.event_id FROM _aptl l
  ), sales AS (
    SELECT r.via, r.key,
           sum(p.qty) FILTER (WHERE p.ci IS NOT NULL) AS tk,
           sum(p.qty) FILTER (WHERE p.ci IS NOT NULL AND p.price > 0) AS paid,
           sum(p.qty) FILTER (WHERE p.ci IS NOT NULL AND p.price = 0) AS free,
           count(DISTINCT p.ord) FILTER (WHERE p.ci IS NOT NULL) AS orders,
           count(DISTINCT p.email) FILTER (WHERE p.ci IS NOT NULL) AS buyers,
           round(sum(p.amount) FILTER (WHERE p.ci IS NOT NULL), 2) AS rev,
           count(DISTINCT p.event_id) FILTER (WHERE p.ci IS NOT NULL) AS nights,
           sum(p.qty) FILTER (WHERE p.pi IS NOT NULL) AS prev_tk,
           count(*) FILTER (WHERE p.ci IS NOT NULL AND EXISTS (SELECT 1 FROM _afirst f WHERE f.id = p.id)) AS new_buyers,
           min(p.ci) AS first_ci
      FROM rows r JOIN _apt p ON p.sk = r.key AND (r.via = 'yuno' OR p.src = 'pa')
     GROUP BY r.via, r.key
  ), clk AS (
    SELECT c.tracked_link_id AS link_id, count(*) AS clicks, count(DISTINCT c.visitor_id) AS visitors
      FROM public.tracked_link_clicks c JOIN _aptl l ON l.id = c.tracked_link_id
     WHERE public._crm_ana_bucket(m, c.clicked_at) IS NOT NULL
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'via', r.via, 'name', r.name, 'code', r.code, 'event_id', r.event_id,
           'tickets', COALESCE(s.tk, 0), 'paid', COALESCE(s.paid, 0), 'free', COALESCE(s.free, 0),
           'orders', COALESCE(s.orders, 0), 'buyers', COALESCE(s.buyers, 0), 'new_buyers', COALESCE(s.new_buyers, 0),
           'revenue', COALESCE(s.rev, 0), 'nights', COALESCE(s.nights, 0), 'prev_tickets', COALESCE(s.prev_tk, 0),
           'clicks', CASE WHEN r.via = 'yuno' THEN COALESCE(k.clicks, 0) END,
           'visitors', CASE WHEN r.via = 'yuno' THEN COALESCE(k.visitors, 0) END
         ) ORDER BY COALESCE(s.tk, 0) DESC, COALESCE(k.clicks, 0) DESC, r.name), '[]'::jsonb)
    INTO v_partners
    FROM rows r
    LEFT JOIN sales s ON s.via = r.via AND s.key = r.key
    LEFT JOIN clk k ON k.link_id = r.link_id
   WHERE r.via = 'yuno' OR COALESCE(s.tk, 0) > 0 OR COALESCE(s.prev_tk, 0) > 0;

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE ci IS NOT NULL),
           'prev', count(*) FILTER (WHERE pi IS NOT NULL))
    INTO v_clicks FROM _aclk;

  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND ci IS NOT NULL),
           'new', (SELECT count(*) FROM _afirst WHERE ci IS NOT NULL),
           'prev_buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND pi IS NOT NULL),
           'prev_new', (SELECT count(*) FROM _afirst WHERE pi IS NOT NULL))
    INTO v_new;

  -- Contacts gagnés : entrés dans la base pendant la fenêtre (premier achat,
  -- import, inscription), quelle que soit la porte.
  -- La case de chaque contact se calcule UNE fois (avant : une fois par case
  -- de la série, soit 31 × la base).
  WITH j AS (
    SELECT public._crm_ana_bucket(m, LEAST(f.bought_at, COALESCE(c.added_at, c.created_at))) AS b
      FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
     WHERE c.email IS NOT NULL
  ), jb AS (
    SELECT j.b, count(*) AS n FROM j WHERE j.b IS NOT NULL GROUP BY j.b
  )
  SELECT jsonb_build_object(
           'total', COALESCE((SELECT sum(jb.n) FROM jb), 0),
           'series', (SELECT jsonb_agg(COALESCE(jb.n, 0) ORDER BY g)
                        FROM generate_series(0, v_n - 1) g LEFT JOIN jb ON jb.b = g))
    INTO v_gained;

  -- Soirées : acheteurs, part de nouveaux, clics de vos messages vers elles.
  WITH per AS (
    SELECT a.event_id, count(DISTINCT a.email) AS buyers,
           count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers
      FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
       AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
           'state', CASE WHEN e.night = (m->>'today')::date THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
           'buyers', p.buyers, 'new_buyers', p.new_buyers,
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id)
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  -- Ajouts du 27/10 (Ventes › « Ce qui a fait vendre ») : ADDITIFS, aucune clé
  -- retirée (le MCP get_web_traffic lit cette fonction).
  -- `links` : chaque lien Yuno de partage qui a vendu dans la fenêtre (source
  -- `yuno-<code>`, même règle que crm_night_links).
  WITH lt AS (
    SELECT tl.id, tl.code, tl.event_id, tl.utm_source AS platform, tl.utm_medium AS placement, tl.created_at,
           COALESCE(NULLIF(btrim(tl.partner_name), ''), NULLIF(btrim(tl.label), ''), tl.code) AS name,
           public.crm_link_source(tl.code) AS sk
      FROM public.tracked_links tl
     WHERE tl.target_kind = 'event' AND tl.event_id IN (SELECT e.id FROM _aev e)
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_links FROM (
    SELECT jsonb_build_object(
             'id', l.id, 'code', l.code, 'name', l.name, 'platform', l.platform, 'placement', l.placement,
             'event_id', l.event_id, 'event_title', (SELECT e.title FROM _aev e WHERE e.id = l.event_id),
             'src', min(p.src),
             'orders', count(DISTINCT p.ord), 'tickets', sum(p.qty),
             'new_buyers', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = p.id)),
             'revenue', round(sum(p.amount), 2)) AS x
      FROM lt l JOIN _apt p ON p.sk = l.sk AND p.ci IS NOT NULL AND p.src IN ('ys', 'yb', 'yt', 'yl')
     GROUP BY l.id, l.code, l.name, l.platform, l.placement, l.event_id
  ) q;

  -- `messages` : ce que chaque e-mail (ou recette) a rapporté — un acheteur
  -- compte quand il a cliqué dans les 7 jours avant l'achat, le dernier clic
  -- gagne (_crm_email_attrib, la règle de Résultats et du Parcours) — et
  -- chaque SMS (billets portant son lien court `yuno-s-<code>`).
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);
  WITH em AS (
    SELECT COALESCE('r:' || au.kind, 'c:' || c.id::text) AS key,
           CASE WHEN au.kind IS NOT NULL THEN 'recipe' ELSE 'campaign' END AS kind,
           COALESCE(au.kind, c.name) AS name, c.id, c.sent_at, c.event_id, a.email, a.id AS tk, a.amount
      FROM _cma a
      JOIN _atk_all t ON t.id = a.id AND t.ok AND t.ci IS NOT NULL
      JOIN public.email_campaigns c ON c.id = a.campaign_id
      LEFT JOIN public.email_automations au ON au.id = c.automation_id
  ), sms AS (
    SELECT 's:' || s.id::text AS key, 'sms' AS kind, s.name, s.id, s.sent_at, s.sent_count,
           public.crm_link_source_for('sms', tl.code) AS sk
      FROM public.sms_campaigns s JOIN public.tracked_links tl ON tl.id = s.tracked_link_id
     WHERE s.product = 'crm' AND s.sent_at IS NOT NULL
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC NULLS LAST, (x->>'buyers')::int DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object(
             'kind', min(em.kind), 'name', min(em.name), 'id', CASE WHEN min(em.kind) = 'campaign' THEN min(em.id::text) END,
             'at', max(em.sent_at), 'nights', count(DISTINCT em.event_id),
             'buyers', count(DISTINCT em.email), 'tickets', count(DISTINCT em.tk),
             'sent', (SELECT count(*) FROM public.email_campaign_recipients r
                       WHERE r.status = 'sent' AND r.campaign_id IN (SELECT DISTINCT e2.id FROM em e2 WHERE e2.key = em.key)),
             'revenue', round(sum(em.amount), 2)) AS x
      FROM em GROUP BY em.key
    UNION ALL
    SELECT jsonb_build_object(
             'kind', 'sms', 'name', s.name, 'id', s.id, 'at', s.sent_at, 'nights', 1,
             'buyers', count(DISTINCT t.email), 'tickets', sum(t.qty), 'sent', COALESCE(s.sent_count, 0),
             'revenue', round(sum(t.amount), 2))
      FROM sms s
      JOIN public.external_tickets x ON lower(btrim(x.utm->>'utm_source')) = s.sk
      JOIN _atk_all t ON t.id = x.id AND t.ok AND t.ci IS NOT NULL
     GROUP BY s.id, s.name, s.sent_at, s.sent_count
  ) q;

  -- `night_mix` : pour la table des soirées de Ventes — part de nouveaux
  -- clients et part des billets venus d'une source Yuno (liens, e-mails, SMS).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', z.event_id, 'buyers', z.buyers, 'new_buyers', z.new_buyers,
           'tickets', z.tk, 'yuno_tickets', z.ytk)), '[]'::jsonb)
    INTO v_mix
    FROM (
      SELECT a.event_id, count(DISTINCT a.email) AS buyers,
             count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers,
             sum(a.qty) AS tk,
             sum(a.qty) FILTER (WHERE a.src IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm')) AS ytk
        FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
         AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
       GROUP BY a.event_id
    ) z;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'partners', COALESCE(v_partners, '[]'::jsonb),
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all),
    'links', COALESCE(v_links, '[]'::jsonb),
    'messages', COALESCE(v_msgs, '[]'::jsonb),
    'night_mix', COALESCE(v_mix, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_ana_traffic__core(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_traffic__core(text, uuid, text, uuid) TO service_role;
