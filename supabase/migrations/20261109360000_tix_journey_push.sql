-- Yuno Tickets › Analyses › Parcours client, lot 7 du plan combiné
-- (docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md) : le canal PUSH.
--
-- La Billetterie envoie des push ; le Parcours client (copie de celui du CRM)
-- ne lisait que les e-mails. Les push de la portée entrent dans les mêmes
-- tables que les e-mails, rattachés à l'adresse du compte qui les reçoit
-- (profiles.email) :
--   reçu  = push_campaign_events 'sent' ;
--   ouvert = cliqué = touché (push_campaign_events 'clicked' / 'opened') :
--            un push touché ouvre la page de la soirée ;
--   achat  = vente dans les 7 jours après le dernier clic, tous canaux lus
--            confondus (règle de _tix_email_attrib, recalculée ici) ;
--   retour = autre soirée achetée dans les 90 jours.
-- Les push envoyés à la main sont des campagnes (classement, filtre) ; les push
-- automatiques de Yuno sont, comme les automatisations e-mail, des messages
-- reçus avant un achat (chemins, délais, fil d'un client).
--
-- Le SMS marketing de Yuno Tickets n'est pas ouvert (SMS_MARKETING_LIVE) :
-- aucun envoi à lire, le canal reste « Bientôt » à l'écran. La réponse
-- Instagram est un outil du CRM : elle n'a pas de sens ici.
--
-- Le fil d'un client passe par `_tix_journey_person` (copie de
-- `_crm_journey_person`, partagée avec le CRM et laissée telle quelle) qui
-- nomme les envois push (`push`) et les push touchés (`tap`).

CREATE OR REPLACE FUNCTION public._tix_journey_person(p_kind text, p_email text, p_from timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_first text; v_last text; v_life text; v_nights int; v_mail boolean; v_phone boolean;
  v_events jsonb;
BEGIN
  SELECT p.first_name, p.last_name, p.lifecycle, p.nights, p.email_ok, p.phone_ok
    INTO v_first, v_last, v_life, v_nights, v_mail, v_phone
    FROM _cp p WHERE p.email = p_email;
  WITH evs AS (
    SELECT r.sent_at AS at, CASE WHEN r.ch = 'push' THEN 'push' WHEN r.auto THEN 'auto' ELSE 'mail' END AS t,
           c.name AS s, NULL::numeric AS amount, NULL::int AS qty, NULL::timestamptz AS ev_at
      FROM _jrc r JOIN _cmc c ON c.id = r.campaign_id
     WHERE r.email = p_email AND r.sent_at >= p_from - interval '30 days'
    UNION ALL
    SELECT min(e.created_at), 'open', c.name, NULL, NULL, NULL
      FROM public.email_campaign_events e JOIN _cmc c ON c.id = e.campaign_id
     WHERE lower(e.recipient_email) = p_email AND e.event_type = 'opened' AND e.created_at >= p_from - interval '30 days'
     GROUP BY c.id, c.name
    UNION ALL
    SELECT min(k.at), CASE WHEN EXISTS (SELECT 1 FROM _jpc x WHERE x.id = c.id) THEN 'tap' ELSE 'click' END, c.name, NULL, NULL, NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.tix_journey__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_campaign uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'all'::text, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_days int := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz;
  v_pfrom timestamptz;
  v_seg text := CASE WHEN p_seg IN ('nou', 'occ', 'hab', 'end', 'none') THEN p_seg ELSE 'all' END;
  -- Yuno Tickets : e-mail et push. Le SMS marketing n'est pas encore ouvert (rien à lire),
  -- la réponse Instagram est un outil du CRM : ces canaux rendent une lecture vide.
  v_ch text := CASE WHEN p_channel IN ('email', 'push', 'sms', 'ig') THEN p_channel ELSE 'all' END;
  v_write boolean := public._tix_allowed(p_venue_id, p_organizer_user_id);
  v_camp_id uuid; v_camp_at timestamptz;
  v_funnel jsonb; v_prev jsonb; v_steps jsonb; v_paths jsonb; v_delays jsonb; v_camps jsonb;
  v_examples jsonb; v_cover jsonb; v_spark jsonb; v_bars jsonb; v_options jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_to - make_interval(days => v_days);
  -- Pas de fenêtre précédente au-delà de 90 jours (comme Analyses).
  v_pfrom := CASE WHEN v_days <= 90 THEN v_from - make_interval(days => v_days) ELSE v_from END;

  IF p_campaign IS NOT NULL THEN
    SELECT c.id, c.sent_at INTO v_camp_id, v_camp_at FROM public.email_campaigns c
     WHERE c.id = p_campaign AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id AND NOT public.crm_campaign_is_crm(c.id);
    IF v_camp_id IS NULL THEN
      SELECT pc.id, pc.created_at INTO v_camp_id, v_camp_at FROM public.push_campaigns pc
       WHERE pc.id = p_campaign AND pc.agency_id IS NULL AND pc.venue_id IS NOT DISTINCT FROM p_venue_id
         AND pc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
    END IF;
  END IF;

  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id);
  PERFORM public._tix_email_attrib(p_venue_id, p_organizer_user_id);

  -- Push (lot 7) : les push de la portée entrent dans les mêmes tables que les
  -- e-mails, rattachés à l'adresse du compte qui les reçoit. Un push touché vaut
  -- une ouverture ET un clic (il ouvre la page de la soirée).
  DROP TABLE IF EXISTS _jpc;
  CREATE TEMP TABLE _jpc ON COMMIT DROP AS
  SELECT pc.id, COALESCE(NULLIF(btrim(pc.title), ''), '—') AS name, pc.created_at AS sent_at, pc.event_id,
         COALESCE(pc.source, 'manual') = 'auto' AS auto
    FROM public.push_campaigns pc
   WHERE pc.status = 'sent' AND pc.agency_id IS NULL
     AND pc.venue_id IS NOT DISTINCT FROM p_venue_id AND pc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND pc.created_at > now() - interval '25 months';
  INSERT INTO _cmc (id, name, sent_at) SELECT id, name, sent_at FROM _jpc;
  IF v_ch = 'push' THEN
    DELETE FROM _cmk;
  END IF;
  IF v_ch IN ('all', 'push') THEN
    INSERT INTO _cmk (campaign_id, email, at, ticketing)
    SELECT k.campaign_id, lower(p.email), min(k.created_at), true
      FROM public.push_campaign_events k
      JOIN _jpc c ON c.id = k.campaign_id
      JOIN public.profiles p ON p.id = k.user_id
     WHERE k.event_type IN ('clicked', 'opened') AND NULLIF(btrim(p.email), '') IS NOT NULL
     GROUP BY k.campaign_id, lower(p.email);
  END IF;
  -- Quand un push compte, l'attribution se refait sur les clics des canaux lus :
  -- dernier clic dans les 7 jours avant l'achat (règle de _tix_email_attrib), sur
  -- les ventes déjà lues par _tix_people_build (_cpx, les mêmes lignes que
  -- _tix_sales) : pas de seconde lecture des billets.
  IF v_ch = 'push' OR EXISTS (SELECT 1 FROM _cmk k JOIN _jpc p ON p.id = k.campaign_id) THEN
    DROP TABLE IF EXISTS _cma;
    CREATE TEMP TABLE _cma ON COMMIT DROP AS
      SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
        FROM _cpx t
        JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
       WHERE t.sale AND t.email IS NOT NULL
       ORDER BY t.id, k.at DESC;
    CREATE INDEX ON _cma (campaign_id, email);
  END IF;

  -- Tous les envois reçus de la portée (automatisations comprises), lus une
  -- seule fois : les questions « qu'a-t-il reçu avant ? » passent par ici.
  DROP TABLE IF EXISTS _jrc;
  CREATE TEMP TABLE _jrc ON COMMIT DROP AS
  SELECT r.campaign_id, lower(r.email) AS email, c.sent_at, (ec.automation_id IS NOT NULL) AS auto, 'email'::text AS ch
    FROM _cmc c
    JOIN public.email_campaigns ec ON ec.id = c.id
    JOIN public.email_campaign_recipients r ON r.campaign_id = c.id AND r.status IN ('sent', 'complained')
   WHERE v_ch IN ('all', 'email')
  UNION ALL
  SELECT DISTINCT ON (k.campaign_id, lower(p.email)) k.campaign_id, lower(p.email), c.sent_at, c.auto, 'push'
    FROM _jpc c
    JOIN public.push_campaign_events k ON k.campaign_id = c.id AND k.event_type = 'sent'
    JOIN public.profiles p ON p.id = k.user_id
   WHERE v_ch IN ('all', 'push') AND NULLIF(btrim(p.email), '') IS NOT NULL;
  CREATE INDEX ON _jrc (email, sent_at);
  CREATE INDEX ON _jrc (campaign_id, email);

  -- Campagnes de la sélection : courante (w = 0), précédente (w = 1). Une
  -- campagne choisie l'est quelle que soit la période.
  DROP TABLE IF EXISTS _jc;
  CREATE TEMP TABLE _jc ON COMMIT DROP AS
  SELECT c.id, c.name, c.sent_at, c.event_id,
         CASE WHEN p_campaign IS NOT NULL OR c.sent_at >= v_from THEN 0 ELSE 1 END AS w, 'email'::text AS ch
    FROM public.email_campaigns c
   WHERE v_ch IN ('all', 'email')
     AND c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND NOT public.crm_campaign_is_crm(c.id)
     AND (p_campaign IS NOT NULL OR (c.sent_at >= v_pfrom AND c.sent_at < v_to))
     AND (p_campaign IS NULL OR c.id = p_campaign)
     AND (p_event IS NULL OR p_campaign IS NOT NULL OR c.event_id = p_event)
  UNION ALL
  -- Les push envoyés à la main (les push automatiques de Yuno sont, comme les
  -- automatisations e-mail, des messages reçus avant, pas des campagnes).
  SELECT c.id, c.name, c.sent_at, c.event_id,
         CASE WHEN p_campaign IS NOT NULL OR c.sent_at >= v_from THEN 0 ELSE 1 END, 'push'
    FROM _jpc c
   WHERE v_ch IN ('all', 'push') AND NOT c.auto
     AND (p_campaign IS NOT NULL OR (c.sent_at >= v_pfrom AND c.sent_at < v_to))
     AND (p_campaign IS NULL OR c.id = p_campaign)
     AND (p_event IS NULL OR p_campaign IS NOT NULL OR c.event_id = p_event);

  DROP TABLE IF EXISTS _jo;
  CREATE TEMP TABLE _jo ON COMMIT DROP AS
  SELECT DISTINCT e.campaign_id, lower(e.recipient_email) AS email
    FROM public.email_campaign_events e JOIN _jc c ON c.id = e.campaign_id
   WHERE e.event_type IN ('opened', 'clicked') AND e.recipient_email IS NOT NULL
  UNION
  SELECT k.campaign_id, k.email FROM _cmk k JOIN _jc c ON c.id = k.campaign_id AND c.ch = 'push';
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
           (SELECT t2.src FROM _cpt t2 WHERE t2.id = b.id LIMIT 1) AS src
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
                               FROM (SELECT k2.key, count(*) AS n FROM keyed k2 WHERE v_ch IN ('all', 'email', 'push') AND (v_ch = 'all' OR k2.has_msg) GROUP BY k2.key) q), '[]'::jsonb))
    INTO v_paths FROM keyed
   -- Le SMS marketing de Yuno Tickets n'est pas ouvert, la réponse Instagram est
   -- un outil du CRM : rien à montrer pour ces canaux.
   WHERE v_ch IN ('all', 'email', 'push');

  -- Couverture : acheteurs de la fenêtre, et ceux dont l'achat suit un clic.
  IF p_campaign IS NULL AND v_ch IN ('all', 'email', 'push') THEN
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
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'event_id', c.event_id, 'channel', c.ch,
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
  SELECT COALESCE(jsonb_agg(public._tix_journey_person(e.kind, e.email, v_from) ORDER BY e.ord), '[]'::jsonb)
    INTO v_examples
    FROM (SELECT DISTINCT ON (ex.email) ex.kind, ex.email, ex.ord FROM ex ORDER BY ex.email, ex.ord) e;

  -- Choix des filtres (indépendants des filtres) : campagnes des 12 derniers mois.
  SELECT jsonb_build_object('campaigns', COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'sent_at', o.sent_at, 'event_id', o.event_id, 'channel', o.ch) ORDER BY o.sent_at DESC), '[]'::jsonb))
    INTO v_options
    FROM (
      SELECT c.id, c.name, c.sent_at, c.event_id, 'email'::text AS ch
        FROM public.email_campaigns c
       WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL AND c.sent_at > now() - interval '12 months'
         AND NOT public.crm_campaign_is_crm(c.id)
         AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      UNION ALL
      SELECT p.id, p.name, p.sent_at, p.event_id, 'push' FROM _jpc p WHERE NOT p.auto AND p.sent_at > now() - interval '12 months'
    ) o;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_to, 'days', v_days, 'seg', v_seg, 'channel', v_ch,
    'campaign', CASE WHEN v_camp_id IS NOT NULL THEN jsonb_build_object('id', v_camp_id, 'sent_at', v_camp_at) END,
    'funnel', v_funnel, 'prev', v_prev, 'spark', v_spark, 'bars', v_bars, 'steps', v_steps, 'delays', v_delays,
    'paths', v_paths, 'cover', v_cover, 'campaigns', v_camps, 'examples', v_examples, 'options', v_options,
    'thanks_auto', EXISTS (SELECT 1 FROM public.email_automations a WHERE a.kind = 'post_event_thanks' AND a.enabled AND a.product IS NULL
                            AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id),
    'has_campaigns', EXISTS (SELECT 1 FROM _cmc c JOIN public.email_campaigns ec ON ec.id = c.id
                              WHERE ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL)
                     OR EXISTS (SELECT 1 FROM _jpc p WHERE NOT p.auto),
    -- La billetterie est Yuno : les ventes sont toujours là.
    'has_connection', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._tix_journey_person(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
