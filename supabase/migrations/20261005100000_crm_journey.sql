-- ============================================================================
-- Yuno CRM — Parcours client (/crm/journey) : « Où mes clients s'arrêtent-ils
-- avant d'acheter ? »
--
-- Un compte CRM n'a pas de page Yuno : le parcours se lit dans ce que Yuno
-- voit vraiment, message par message —
--   Reçu → Ouvert → Clic → Achat → Retour
-- * Reçu / Ouvert / Clic : destinataires, ouvertures et clics des e-mails
--   envoyés à la main (ni automatisations, ni relances), comptés par PERSONNE
--   (l'étape la plus avancée sur l'ensemble des envois de la sélection).
-- * Achat : la règle des résultats d'e-mail (_crm_email_attrib) : un billet
--   acheté dans les 7 jours qui suivent un clic, rattaché au dernier clic.
-- * Retour : un acheteur qui rachète pour une AUTRE soirée sous 90 jours.
-- Filtres : période (ignorée quand une campagne est choisie), soirée
-- (campagnes reliées), campagne, canal (seul l'e-mail envoie aujourd'hui),
-- segment du cycle de vie. Montants sous les clés revenue / amount, masqués
-- par _crm_money_gate aux rôles sans accès à l'argent.
-- ============================================================================

-- Le fil d'une personne : messages reçus, ouvertures, clics, achats, depuis
-- 30 jours avant le début de la fenêtre (12 lignes au plus, les plus
-- récentes). Lit les tables de travail de crm_journey__core.
CREATE OR REPLACE FUNCTION public._crm_journey_person(p_kind text, p_email text, p_from timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first text; v_last text; v_life text; v_nights int; v_mail boolean; v_phone boolean;
  v_events jsonb;
BEGIN
  SELECT p.first_name, p.last_name, p.lifecycle, p.nights, p.email_ok, p.phone_ok
    INTO v_first, v_last, v_life, v_nights, v_mail, v_phone
    FROM _cp p WHERE p.email = p_email;
  WITH evs AS (
    SELECT r.sent_at AS at, CASE WHEN r.auto THEN 'auto' ELSE 'mail' END AS t,
           c.name AS s, NULL::numeric AS amount, NULL::int AS qty, NULL::timestamptz AS ev_at
      FROM _jrc r JOIN _cmc c ON c.id = r.campaign_id
     WHERE r.email = p_email AND r.sent_at >= p_from - interval '30 days'
    UNION ALL
    SELECT min(e.created_at), 'open', c.name, NULL, NULL, NULL
      FROM public.email_campaign_events e JOIN _cmc c ON c.id = e.campaign_id
     WHERE lower(e.recipient_email) = p_email AND e.event_type = 'opened' AND e.created_at >= p_from - interval '30 days'
     GROUP BY c.id, c.name
    UNION ALL
    SELECT min(k.at), 'click', c.name, NULL, NULL, NULL
      FROM _cmk k JOIN _cmc c ON c.id = k.campaign_id
     WHERE k.email = p_email AND k.at >= p_from - interval '30 days'
     GROUP BY c.id, c.name
    UNION ALL
    SELECT min(t.bought_at), 'buy', COALESCE((SELECT e.title FROM public.events e WHERE e.id = t.event_id), ''),
           sum(t.amount), sum(t.qty)::int, min(t.event_start)
      FROM _cpt t
     WHERE t.email = p_email AND t.bought_at >= p_from - interval '30 days'
     GROUP BY t.event_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', q.at, 't', q.t, 's', q.s, 'amount', q.amount, 'qty', q.qty, 'ev_at', q.ev_at) ORDER BY q.at), '[]'::jsonb)
    INTO v_events FROM (SELECT * FROM evs WHERE evs.at IS NOT NULL ORDER BY evs.at DESC LIMIT 12) q;
  RETURN jsonb_build_object(
    'kind', p_kind, 'email', p_email, 'first_name', v_first, 'last_name', v_last,
    'lifecycle', COALESCE(v_life, 'none'), 'nights', COALESCE(v_nights, 0),
    'email_ok', COALESCE(v_mail, false), 'phone_ok', COALESCE(v_phone, false),
    'events', v_events);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_journey_person(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_journey_person(text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_journey__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL,
  p_campaign uuid DEFAULT NULL, p_channel text DEFAULT 'all', p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_days int := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz;
  v_pfrom timestamptz;
  v_seg text := CASE WHEN p_seg IN ('nou', 'occ', 'hab', 'end', 'none') THEN p_seg ELSE 'all' END;
  v_ch text := CASE WHEN p_channel IN ('email', 'sms', 'ig') THEN p_channel ELSE 'all' END;
  v_write boolean := public.crm_scope_writable(p_venue_id, p_organizer_user_id);
  v_camp_id uuid; v_camp_at timestamptz;
  v_funnel jsonb; v_prev jsonb; v_steps jsonb; v_paths jsonb; v_delays jsonb; v_camps jsonb;
  v_examples jsonb; v_cover jsonb; v_spark jsonb; v_bars jsonb; v_options jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_to - make_interval(days => v_days);
  -- Pas de fenêtre précédente au-delà de 90 jours (comme Analyses).
  v_pfrom := CASE WHEN v_days <= 90 THEN v_from - make_interval(days => v_days) ELSE v_from END;

  IF p_campaign IS NOT NULL THEN
    SELECT c.id, c.sent_at INTO v_camp_id, v_camp_at FROM public.email_campaigns c
     WHERE c.id = p_campaign AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  -- Tous les envois reçus de la portée (automatisations comprises), lus une
  -- seule fois : les questions « qu'a-t-il reçu avant ? » passent par ici.
  DROP TABLE IF EXISTS _jrc;
  CREATE TEMP TABLE _jrc ON COMMIT DROP AS
  SELECT r.campaign_id, lower(r.email) AS email, c.sent_at, (ec.automation_id IS NOT NULL) AS auto
    FROM _cmc c
    JOIN public.email_campaigns ec ON ec.id = c.id
    JOIN public.email_campaign_recipients r ON r.campaign_id = c.id AND r.status IN ('sent', 'complained');
  CREATE INDEX ON _jrc (email, sent_at);
  CREATE INDEX ON _jrc (campaign_id, email);

  -- Campagnes de la sélection : courante (w = 0), précédente (w = 1). Une
  -- campagne choisie l'est quelle que soit la période.
  DROP TABLE IF EXISTS _jc;
  CREATE TEMP TABLE _jc ON COMMIT DROP AS
  SELECT c.id, c.name, c.sent_at, c.event_id,
         CASE WHEN p_campaign IS NOT NULL OR c.sent_at >= v_from THEN 0 ELSE 1 END AS w
    FROM public.email_campaigns c
   WHERE v_ch IN ('all', 'email')
     AND c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND (p_campaign IS NOT NULL OR (c.sent_at >= v_pfrom AND c.sent_at < v_to))
     AND (p_campaign IS NULL OR c.id = p_campaign)
     AND (p_event IS NULL OR p_campaign IS NOT NULL OR c.event_id = p_event);

  DROP TABLE IF EXISTS _jo;
  CREATE TEMP TABLE _jo ON COMMIT DROP AS
  SELECT DISTINCT e.campaign_id, lower(e.recipient_email) AS email
    FROM public.email_campaign_events e JOIN _jc c ON c.id = e.campaign_id
   WHERE e.event_type IN ('opened', 'clicked') AND e.recipient_email IS NOT NULL;
  CREATE INDEX ON _jo (campaign_id, email);

  -- Une ligne par (campagne, personne).
  DROP TABLE IF EXISTS _jr;
  CREATE TEMP TABLE _jr ON COMMIT DROP AS
  SELECT c.id AS campaign_id, c.w, c.sent_at, r.email,
         COALESCE(p.lifecycle, 'none') AS lifecycle, COALESCE(p.email_ok, false) AS email_ok,
         (o.email IS NOT NULL) AS opened,
         EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = c.id AND k.email = r.email) AS clicked,
         b.bought_at, b.event_id AS bought_event, b.amount,
         false AS back
    FROM _jc c
    JOIN _jrc r ON r.campaign_id = c.id
    LEFT JOIN _cp p ON p.email = r.email
    LEFT JOIN _jo o ON o.campaign_id = c.id AND o.email = r.email
    LEFT JOIN LATERAL (
      SELECT (array_agg(a.bought_at ORDER BY a.bought_at))[1] AS bought_at,
             (array_agg(t.event_id ORDER BY a.bought_at))[1] AS event_id,
             sum(a.amount) AS amount
        FROM _cma a LEFT JOIN _cpt t ON t.id = a.id
       WHERE a.campaign_id = c.id AND a.email = r.email
    ) b ON true
   WHERE v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg;
  UPDATE _jr SET opened = true WHERE clicked AND NOT opened;
  UPDATE _jr j SET back = true
   WHERE j.bought_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM _cpt t WHERE t.email = j.email AND t.bought_at > j.bought_at
                    AND t.bought_at <= j.bought_at + interval '90 days'
                    AND t.event_id IS DISTINCT FROM j.bought_event);
  CREATE INDEX ON _jr (email);
  CREATE INDEX ON _jr (campaign_id);

  -- Une ligne par personne (fenêtre courante) : son étape la plus avancée, et
  -- la campagne qui la porte à chaque étape (la plus récente).
  DROP TABLE IF EXISTS _jpp;
  CREATE TEMP TABLE _jpp ON COMMIT DROP AS
  SELECT j.email, max(j.lifecycle) AS lifecycle, bool_or(j.email_ok) AS email_ok,
         bool_or(j.opened) AS o, bool_or(j.clicked) AS c, bool_or(j.bought_at IS NOT NULL) AS b, bool_or(j.back) AS bk,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC))[1] AS c0,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC) FILTER (WHERE j.opened))[1] AS c1,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC) FILTER (WHERE j.clicked))[1] AS c2,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC) FILTER (WHERE j.bought_at IS NOT NULL))[1] AS c3,
         min(j.bought_at) AS bought_at
    FROM _jr j WHERE j.w = 0 GROUP BY j.email;

  SELECT jsonb_build_array(count(*), count(*) FILTER (WHERE o), count(*) FILTER (WHERE c),
                           count(*) FILTER (WHERE b), count(*) FILTER (WHERE bk))
    INTO v_funnel FROM _jpp;
  IF p_campaign IS NULL AND v_days <= 90 THEN
    SELECT jsonb_build_array(
             count(DISTINCT email), count(DISTINCT email) FILTER (WHERE opened), count(DISTINCT email) FILTER (WHERE clicked),
             count(DISTINCT email) FILTER (WHERE bought_at IS NOT NULL), count(DISTINCT email) FILTER (WHERE back))
      INTO v_prev FROM _jr WHERE w = 1;
  END IF;

  -- Personnes touchées (14 cases) et acheteurs (6 cases) sur la fenêtre.
  IF p_campaign IS NULL THEN
    SELECT jsonb_agg((SELECT count(DISTINCT j.email) FROM _jr j
                       WHERE j.w = 0 AND j.sent_at >= v_from + make_interval(secs => g * v_days * 86400 / 14.0)
                         AND j.sent_at < v_from + make_interval(secs => (g + 1) * v_days * 86400 / 14.0)) ORDER BY g)
      INTO v_spark FROM generate_series(0, 13) g;
    SELECT jsonb_agg((SELECT count(*) FROM _jpp p
                       WHERE p.bought_at >= v_from + make_interval(secs => g * v_days * 86400 / 6.0)
                         AND p.bought_at < v_from + make_interval(secs => (g + 1) * v_days * 86400 / 6.0)) ORDER BY g)
      INTO v_bars FROM generate_series(0, 5) g;
  END IF;

  -- Qui s'arrête après chaque étape.
  DROP TABLE IF EXISTS _jl;
  CREATE TEMP TABLE _jl ON COMMIT DROP AS
  SELECT k, p.email, p.lifecycle, p.email_ok,
         CASE k WHEN 0 THEN p.c0 WHEN 1 THEN p.c1 WHEN 2 THEN p.c2 ELSE p.c3 END AS cid
    FROM generate_series(0, 3) k
    JOIN _jpp p ON CASE k WHEN 0 THEN NOT p.o WHEN 1 THEN p.o AND NOT p.c
                          WHEN 2 THEN p.c AND NOT p.b ELSE p.b AND NOT p.bk END;
  SELECT jsonb_agg(jsonb_build_object(
           'k', kk.k,
           'lost', (SELECT count(*) FROM _jl l WHERE l.k = kk.k),
           'reach', (SELECT count(*) FROM _jl l WHERE l.k = kk.k AND l.email_ok),
           'by_campaign', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.cid, 'name', c.name, 'n', q.n) ORDER BY q.n DESC, c.name), '[]'::jsonb)
                             FROM (SELECT l.cid, count(*) AS n FROM _jl l WHERE l.k = kk.k GROUP BY l.cid ORDER BY count(*) DESC LIMIT 4) q
                             JOIN _jc c ON c.id = q.cid),
           'by_seg', (SELECT jsonb_build_object(
                         'hab', count(*) FILTER (WHERE l.lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE l.lifecycle = 'occ'),
                         'nou', count(*) FILTER (WHERE l.lifecycle = 'nou'), 'end', count(*) FILTER (WHERE l.lifecycle = 'end'),
                         'none', count(*) FILTER (WHERE l.lifecycle NOT IN ('hab', 'occ', 'nou', 'end')))
                        FROM _jl l WHERE l.k = kk.k),
           -- L'audience exacte pour « Relancer » (écriture seulement, 2 000 au plus).
           'emails', CASE WHEN v_write AND (SELECT count(*) FROM _jl l WHERE l.k = kk.k AND l.email_ok) BETWEEN 1 AND 2000
                          THEN (SELECT jsonb_agg(l.email) FROM _jl l WHERE l.k = kk.k AND l.email_ok) END
         ) ORDER BY kk.k)
    INTO v_steps FROM generate_series(0, 3) kk(k);

  -- Délai du premier clic (30 jours avant) au premier achat rattaché, et
  -- messages reçus (automatisations comprises) dans les 30 jours d'avant.
  WITH d AS (
    SELECT p.email, p.bought_at, 0 AS w,
           extract(epoch FROM p.bought_at - (SELECT min(k.at) FROM _cmk k WHERE k.email = p.email AND k.at <= p.bought_at
                                                AND k.at > p.bought_at - interval '30 days')) / 3600.0 AS h
      FROM _jpp p WHERE p.b
    UNION ALL
    SELECT x.email, x.bought_at, 1,
           extract(epoch FROM x.bought_at - (SELECT min(k.at) FROM _cmk k WHERE k.email = x.email AND k.at <= x.bought_at
                                                AND k.at > x.bought_at - interval '30 days')) / 3600.0
      FROM (SELECT j.email, min(j.bought_at) AS bought_at FROM _jr j WHERE j.w = 1 AND j.bought_at IS NOT NULL GROUP BY j.email) x
  )
  SELECT jsonb_build_object(
           'n', count(*) FILTER (WHERE d.w = 0),
           'b', jsonb_build_array(count(*) FILTER (WHERE d.w = 0 AND d.h < 24), count(*) FILTER (WHERE d.w = 0 AND d.h >= 24 AND d.h < 72),
                                  count(*) FILTER (WHERE d.w = 0 AND d.h >= 72 AND d.h < 192), count(*) FILTER (WHERE d.w = 0 AND d.h >= 192)),
           'median_h', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.h) FILTER (WHERE d.w = 0))::numeric, 2),
           'prev_median_h', CASE WHEN p_campaign IS NULL AND v_days <= 90
                                 THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.h) FILTER (WHERE d.w = 1))::numeric, 2) END,
           'touches', (SELECT round(avg(x.n), 1) FROM (
                         SELECT (SELECT count(DISTINCT r.campaign_id) FROM _jrc r
                                  WHERE r.email = d2.email AND r.sent_at <= d2.bought_at AND r.sent_at > d2.bought_at - interval '30 days') AS n
                           FROM _jpp d2 WHERE d2.b) x))
    INTO v_delays FROM d;

  -- Chemins des acheteurs : premier achat de chacun sur la fenêtre (ou
  -- rattaché à la campagne choisie), avec ce qui l'a précédé.
  WITH buys AS (
    SELECT DISTINCT ON (t.email) t.email, t.bought_at, t.id
      FROM _cpt t LEFT JOIN _cp p ON p.email = t.email
     WHERE (p_campaign IS NOT NULL OR (t.bought_at >= v_from AND t.bought_at < v_to))
       AND (p_campaign IS NULL OR EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id AND a.campaign_id = p_campaign))
       AND (p_event IS NULL OR p_campaign IS NOT NULL OR t.event_id = p_event)
       AND (v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg)
       AND t.email IS NOT NULL
     ORDER BY t.email, t.bought_at
  ), cls AS (
    SELECT b.email,
           (SELECT count(DISTINCT r.campaign_id) FROM _jrc r
             WHERE r.email = b.email AND r.sent_at <= b.bought_at AND r.sent_at > b.bought_at - interval '14 days') AS msgs,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.email = b.email AND k.at <= b.bought_at AND k.at > b.bought_at - interval '7 days') AS clicked,
           (SELECT public._crm_ticket_source(et.utm) FROM public.external_tickets et WHERE et.id = b.id) AS src
      FROM buys b
  ), keyed AS (
    SELECT CASE
             WHEN cls.msgs >= 2 AND cls.clicked THEN 'mm_click'
             WHEN cls.msgs >= 1 AND cls.clicked THEN 'm_click'
             WHEN cls.msgs >= 1 THEN 'm_noclick'
             ELSE 'src_' || COALESCE(cls.src, 'di') END AS key,
           cls.msgs > 0 AS has_msg
      FROM cls
  )
  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE v_ch = 'all' OR keyed.has_msg),
           'with_msg', count(*) FILTER (WHERE keyed.has_msg),
           'without_msg', count(*) FILTER (WHERE NOT keyed.has_msg),
           'list', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', q.key, 'n', q.n) ORDER BY q.n DESC, q.key)
                               FROM (SELECT k2.key, count(*) AS n FROM keyed k2 WHERE v_ch IN ('all', 'email') AND (v_ch = 'all' OR k2.has_msg) GROUP BY k2.key) q), '[]'::jsonb))
    INTO v_paths FROM keyed
   -- SMS et Instagram n'envoient pas encore : rien à montrer pour ces canaux.
   WHERE v_ch IN ('all', 'email');

  -- Couverture : acheteurs de la fenêtre, et ceux dont l'achat suit un clic.
  IF p_campaign IS NULL AND v_ch IN ('all', 'email') THEN
    SELECT jsonb_build_object(
             'buyers', count(DISTINCT t.email),
             'attributed', count(DISTINCT t.email) FILTER (WHERE EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id)))
      INTO v_cover
      FROM _cpt t LEFT JOIN _cp p ON p.email = t.email
     WHERE t.bought_at >= v_from AND t.bought_at < v_to AND t.email IS NOT NULL
       AND (p_event IS NULL OR t.event_id = p_event)
       AND (v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg);
  END IF;

  -- Classement des campagnes de la fenêtre.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'event_id', c.event_id,
           'event_title', (SELECT e.title FROM public.events e WHERE e.id = c.event_id),
           'received', s.received, 'opened', s.opened, 'clicked', s.clicked, 'buyers', s.buyers, 'back', s.back,
           'ticket_clicks', (SELECT count(DISTINCT k.email) FROM _cmk k JOIN _jr j ON j.campaign_id = k.campaign_id AND j.email = k.email
                              WHERE k.campaign_id = c.id AND k.ticketing),
           'revenue', s.revenue,
           'buyers_seg', s.buyers_seg,
           'within2d', (SELECT count(*) FROM _jr j WHERE j.campaign_id = c.id AND j.bought_at < c.sent_at + interval '2 days')
         ) ORDER BY c.sent_at DESC), '[]'::jsonb)
    INTO v_camps
    FROM _jc c
    CROSS JOIN LATERAL (
      SELECT count(*) AS received, count(*) FILTER (WHERE j.opened) AS opened, count(*) FILTER (WHERE j.clicked) AS clicked,
             count(*) FILTER (WHERE j.bought_at IS NOT NULL) AS buyers, count(*) FILTER (WHERE j.back) AS back,
             round(COALESCE(sum(j.amount), 0), 2) AS revenue,
             jsonb_build_object('hab', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'hab'),
                                'occ', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'occ'),
                                'nou', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'nou'),
                                'end', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'end'),
                                'none', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle NOT IN ('hab', 'occ', 'nou', 'end'))) AS buyers_seg
        FROM _jr j WHERE j.campaign_id = c.id
    ) s
   WHERE c.w = 0 AND s.received > 0;

  -- Exemples réels : acheteur après un message, clic sans achat, ouverture
  -- sans clic, achat sans message (sur la fenêtre).
  WITH ex AS (
    (SELECT 'bought'::text AS kind, p.email, 0 AS ord FROM _jpp p WHERE p.b ORDER BY p.bought_at DESC LIMIT 1)
    UNION ALL
    (SELECT 'clicked', p.email, 1 FROM _jpp p WHERE p.c AND NOT p.b
      ORDER BY (SELECT max(k.at) FROM _cmk k WHERE k.email = p.email) DESC NULLS LAST LIMIT 1)
    UNION ALL
    (SELECT 'opened', p.email, 2 FROM _jpp p WHERE p.o AND NOT p.c
      ORDER BY (SELECT max(j.sent_at) FROM _jr j WHERE j.email = p.email AND j.opened) DESC NULLS LAST LIMIT 1)
    UNION ALL
    (SELECT 'direct', t.email, 3 FROM _cpt t LEFT JOIN _cp p ON p.email = t.email
      WHERE p_campaign IS NULL AND v_ch = 'all' AND t.bought_at >= v_from AND t.bought_at < v_to AND t.email IS NOT NULL
        AND (p_event IS NULL OR t.event_id = p_event)
        AND (v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg)
        AND NOT EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id)
        AND NOT EXISTS (SELECT 1 FROM _jrc r
                         WHERE r.email = t.email AND r.sent_at <= t.bought_at AND r.sent_at > t.bought_at - interval '14 days')
      ORDER BY t.bought_at DESC LIMIT 1)
  )
  SELECT COALESCE(jsonb_agg(public._crm_journey_person(e.kind, e.email, v_from) ORDER BY e.ord), '[]'::jsonb)
    INTO v_examples
    FROM (SELECT DISTINCT ON (ex.email) ex.kind, ex.email, ex.ord FROM ex ORDER BY ex.email, ex.ord) e;

  -- Choix des filtres (indépendants des filtres) : campagnes des 12 derniers mois.
  SELECT jsonb_build_object('campaigns', COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'event_id', c.event_id) ORDER BY c.sent_at DESC), '[]'::jsonb))
    INTO v_options
    FROM public.email_campaigns c
   WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL AND c.sent_at > now() - interval '12 months'
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_to, 'days', v_days, 'seg', v_seg, 'channel', v_ch,
    'campaign', CASE WHEN v_camp_id IS NOT NULL THEN jsonb_build_object('id', v_camp_id, 'sent_at', v_camp_at) END,
    'funnel', v_funnel, 'prev', v_prev, 'spark', v_spark, 'bars', v_bars, 'steps', v_steps, 'delays', v_delays,
    'paths', v_paths, 'cover', v_cover, 'campaigns', v_camps, 'examples', v_examples, 'options', v_options,
    'thanks_auto', EXISTS (SELECT 1 FROM public.email_automations a WHERE a.kind = 'post_event_thanks' AND a.enabled
                            AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id),
    'has_campaigns', EXISTS (SELECT 1 FROM _cmc c JOIN public.email_campaigns ec ON ec.id = c.id
                              WHERE ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL),
    'has_connection', EXISTS (SELECT 1 FROM public.ticketing_connections tc
                               WHERE (p_venue_id IS NOT NULL AND tc.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND tc.organizer_user_id = p_organizer_user_id))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_journey__core(text, uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_journey__core(text, uuid, text, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_journey(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL,
  p_campaign uuid DEFAULT NULL, p_channel text DEFAULT 'all', p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_journey__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_campaign, p_channel, p_seg),
                                p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_journey(text, uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_journey(text, uuid, text, uuid, uuid, text, text) TO authenticated, service_role;

-- Le parcours se calcule dans des tables temporaires : il rejoint les
-- lectures autorisées en aperçu démo (corps repris de la base liée).
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
    'crm_journey'
  ]::text[]);
$function$;
