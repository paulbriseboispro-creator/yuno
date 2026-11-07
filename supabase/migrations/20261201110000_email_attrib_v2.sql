-- Résultats d'un e-mail : de la place prise, pas du clic.
--
-- Cas 3AM × Act III (07/11) : l'e-mail a fait vendre 6 places (source Shotgun `yuno-m-…` sur
-- chaque billet) ; l'écran en montrait 4, le rapprochement par adresse 13. Trois défauts :
--   · la règle ignorait la source que Shotgun écrit sur le billet : une vente prise avec le lien
--     d'un ami, ou avec une autre adresse que celle du clic, n'existait pas ;
--   · n'importe quel clic (Instagram, « Powered by », test) sur n'importe quelle soirée suffisait ;
--   · la relance, absente de la liste, perdait ses ventes.
--
-- Trois niveaux, une seule fonction (Résultats, Parcours, carte « messages » d'Analyses, segments) :
--   · CERTAINE  : le billet porte `utm_source = yuno-m-<8 premiers caractères de la campagne>` ;
--   · PROBABLE  : clic de personne sur le lien des billets, puis achat de CETTE soirée par la même
--                 adresse dans les 7 jours, sans la source de l'e-mail ;
--   · ENSUITE   : une personne qui a regardé achète dans les 30 jours (cette soirée ou une autre) :
--                 compté à part dans `_cml`, jamais ajouté aux places prises.
-- La relance se compte avec sa campagne mère (`_cma.campaign_id` = la mère). Les clics
-- automatiques sont déjà `auto_click` (20261201100000) : aucune lecture ne les voit.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public._crm_email_attrib(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_hosts text[];
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT lower(substring(e.external_ticket_url FROM '^https?://([^/:?#]+)')))
    INTO v_hosts
    FROM public.events e
   WHERE e.external_ticket_url IS NOT NULL AND e.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json,
           COALESCE(c.parent_campaign_id, c.id) AS root, c.event_id,
           left(c.id::text, 8) AS tag
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND public.crm_campaign_is_crm(c.id)
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  CREATE INDEX ON _cmc (id);

  -- Clics de PERSONNES (les clics automatiques sont `auto_click`) ; `rec` écarte les envois de test.
  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, c.root, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing,
           EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                    WHERE r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email)
                      AND r.status IN ('sent', 'bounced', 'complained')) AS rec
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  -- Clics automatiques (contrôles de sécurité), par adresse reçue et campagne mère.
  DROP TABLE IF EXISTS _cmx;
  CREATE TEMP TABLE _cmx ON COMMIT DROP AS
    SELECT c.root, lower(ev.recipient_email) AS email, count(*) AS clicks
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'auto_click' AND ev.recipient_email IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                    WHERE r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email)
                      AND r.status IN ('sent', 'bounced', 'complained'))
     GROUP BY 1, 2;
  CREATE INDEX ON _cmx (root, email);

  -- Les ventes de la portée, lues UNE fois (cert, prob, ensuite, et les écrans qui suivent).
  DROP TABLE IF EXISTS _cmt;
  CREATE TEMP TABLE _cmt ON COMMIT DROP AS
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id);
  CREATE INDEX ON _cmt (email, bought_at);
  CREATE INDEX ON _cmt (id);

  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    WITH tk AS (SELECT * FROM _cmt),
    cert AS (
      SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, c.root AS campaign_id, 'certain'::text AS level
        FROM tk t
        JOIN public.external_tickets x ON x.id = t.id
        JOIN _cmc c ON ('yuno-m-' || c.tag) = lower(btrim(x.utm->>'utm_source'))
       ORDER BY t.id, c.sent_at DESC
    ), prob AS (
      SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.root AS campaign_id, 'probable'::text AS level
        FROM tk t
        JOIN _cmk k ON k.email = t.email AND k.rec AND k.ticketing
                   AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
        JOIN _cmc c ON c.id = k.campaign_id
       WHERE NOT EXISTS (SELECT 1 FROM cert WHERE cert.id = t.id)
         AND (c.event_id IS NULL OR t.event_id = c.event_id)
       ORDER BY t.id, k.at DESC
    )
    SELECT * FROM cert UNION ALL SELECT * FROM prob;
  CREATE INDEX ON _cma (campaign_id, email);
  SELECT count(*) INTO v_n FROM _cma;

  -- « Réservé ensuite » : a regardé (clic de personne sur le lien des billets), puis achète dans
  -- les 30 jours, sans être déjà une place prise. Compté à part.
  DROP TABLE IF EXISTS _cml;
  CREATE TEMP TABLE _cml ON COMMIT DROP AS
    WITH h AS (
      SELECT k.root, k.email, min(k.at) AS first_at
        FROM _cmk k WHERE k.rec AND k.ticketing GROUP BY 1, 2
    )
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, h.root AS campaign_id
      FROM h
      JOIN _cmt t
        ON t.email = h.email AND t.bought_at > h.first_at AND t.bought_at <= h.first_at + interval '30 days'
     WHERE NOT EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id)
     ORDER BY t.id, h.first_at DESC;
  CREATE INDEX ON _cml (campaign_id, email);
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_email_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ces;
  CREATE TEMP TABLE _ces ON COMMIT DROP AS
  SELECT ec.id, ec.name, ec.subject, ec.sent_at, ec.audiences_json, ec.template_kind, ec.event_id,
         r.n, r.bounced, r.complained, GREATEST(r.n - r.bounced, 0) AS received,
         COALESCE(o.opened, 0) AS opened,
         COALESCE(k.clicked, 0) AS clicked, COALESCE(k.ticketing, 0) AS ticketing,
         COALESCE(b.purchases, 0) AS purchases, COALESCE(b.revenue, 0) AS revenue,
         COALESCE(ec.unsubscribes_count, 0) AS unsub,
         COALESCE(b.buyers, 0) AS buyers,
         COALESCE(b.certain, 0) AS certain, COALESCE(b.probable, 0) AS probable,
         COALESCE(l.later, 0) AS later, COALESCE(l.later_buyers, 0) AS later_buyers,
         COALESCE(x.auto_people, 0) AS auto_people, COALESCE(x.auto_clicks, 0) AS auto_clicks
    FROM public.email_campaigns ec
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE rr.status IN ('sent', 'complained', 'bounced')) AS n,
             count(*) FILTER (WHERE rr.status = 'bounced') AS bounced,
             count(*) FILTER (WHERE rr.status = 'complained') AS complained
        FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id
    ) r
    -- Ouvertures de VRAIS destinataires (un envoi de test n'en fait pas partie).
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT lower(e.recipient_email)) AS opened FROM public.email_campaign_events e
       WHERE e.campaign_id = ec.id AND e.event_type = 'opened'
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients rr
                      WHERE rr.campaign_id = e.campaign_id AND lower(rr.email) = lower(e.recipient_email))
    ) o ON true
    -- Clics de personnes, relance comprise.
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT kk.email) AS clicked, count(DISTINCT kk.email) FILTER (WHERE kk.ticketing) AS ticketing
        FROM _cmk kk WHERE kk.root = ec.id AND kk.rec
    ) k ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS purchases, COALESCE(sum(aa.amount), 0) AS revenue, count(DISTINCT aa.email) AS buyers,
             count(*) FILTER (WHERE aa.level = 'certain') AS certain, count(*) FILTER (WHERE aa.level = 'probable') AS probable
        FROM _cma aa WHERE aa.campaign_id = ec.id
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS later, count(DISTINCT ll.email) AS later_buyers FROM _cml ll WHERE ll.campaign_id = ec.id
    ) l ON true
    -- Contrôles de sécurité : adresses qui n'ont QUE des clics automatiques.
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM _cmk kk WHERE kk.root = xx.root AND kk.email = xx.email AND kk.rec)) AS auto_people,
             COALESCE(sum(xx.clicks), 0) AS auto_clicks
        FROM _cmx xx WHERE xx.root = ec.id
    ) x ON true
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id
     AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(ec.id)
     AND ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
     AND ec.sent_at >= p_from AND ec.sent_at < p_to;
  SELECT count(*) INTO v_n FROM _ces;
  RETURN v_n;
END;
$function$;

-- La liste des campagnes : les nouveaux chiffres s'ajoutent, aucun n'est retiré.
CREATE OR REPLACE FUNCTION public.crm_email_campaigns__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT COALESCE(jsonb_agg(public._crm_email_row(ec) || CASE WHEN s.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
           'stats', jsonb_build_object('n', s.n, 'received', s.received, 'opened', s.opened, 'clicked', s.clicked,
                     'ticketing', s.ticketing, 'purchases', s.purchases, 'revenue', round(s.revenue, 2),
                     'bounced', s.bounced, 'complained', s.complained, 'unsub', s.unsub,
                     'certain', s.certain, 'probable', s.probable, 'later', s.later)) END
           ORDER BY COALESCE(ec.sent_at, ec.scheduled_at, ec.updated_at) DESC), '[]'::jsonb)
    INTO v
    FROM public.email_campaigns ec
    LEFT JOIN _ces s ON s.id = ec.id
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(ec.id)
     AND ec.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'failed');
  RETURN jsonb_build_object('campaigns', v);
END;
$function$;

-- Le résultat d'une campagne : les trois niveaux, jour par jour, les places une par une.
CREATE OR REPLACE FUNCTION public.crm_email_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ec public.email_campaigns%ROWTYPE;
  v_me record;
  v_avg record;
  v_rank integer; v_total integer;
  v_tl jsonb; v_links jsonb; v_list jsonb;
  v_days jsonb; v_sales jsonb; v_sales_n integer; v_follow jsonb;
  v_open record; v_shared integer; v_interest integer; v_until timestamptz; v_start timestamptz;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ec FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      AND public.crm_campaign_is_crm(c.id);
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  -- Un envoi par vagues dure des jours : le jour 0 est le PREMIER envoi, pas le dernier (`sent_at`).
  v_start := COALESCE((SELECT min(r.sent_at) FROM public.email_campaign_recipients r WHERE r.campaign_id = p_campaign_id AND r.sent_at IS NOT NULL), ec.sent_at);
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT * INTO v_me FROM _ces WHERE id = p_campaign_id;
  SELECT count(*) AS n_campaigns,
         CASE WHEN sum(received) > 0 THEN sum(opened)::numeric / sum(received) END AS open_rate,
         CASE WHEN sum(received) > 0 THEN sum(clicked)::numeric / sum(received) END AS click_rate,
         CASE WHEN sum(n) > 0 THEN sum(purchases)::numeric * 1000 / sum(n) END AS per_k
    INTO v_avg FROM _ces;
  SELECT count(*) INTO v_total FROM _ces;
  SELECT r INTO v_rank FROM (
    SELECT id, rank() OVER (ORDER BY CASE WHEN n > 0 THEN purchases::numeric / n ELSE 0 END DESC) AS r FROM _ces) z
   WHERE z.id = p_campaign_id;

  -- Réactions heure par heure sur 72 h (première ouverture / premier clic de personne par personne).
  IF ec.sent_at IS NOT NULL THEN
    WITH firsts AS (
      SELECT e.event_type, lower(e.recipient_email) AS em, min(e.created_at) AS at
        FROM public.email_campaign_events e
       WHERE e.campaign_id = p_campaign_id AND e.event_type IN ('opened', 'clicked')
       GROUP BY 1, 2
    )
    SELECT jsonb_agg(jsonb_build_object('h', g.h,
             'opens', (SELECT count(*) FROM firsts f WHERE f.event_type = 'opened' AND f.at < v_start + make_interval(hours => g.h)),
             'clicks', (SELECT count(*) FROM firsts f WHERE f.event_type = 'clicked' AND f.at < v_start + make_interval(hours => g.h)))
           ORDER BY g.h)
      INTO v_tl FROM generate_series(0, 72, 3) g(h);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('link', l.link, 'clicks', l.clicks, 'people', l.people) ORDER BY l.people DESC), '[]'::jsonb)
      INTO v_links FROM (
        SELECT regexp_replace(e.metadata->'click'->>'link', '([?&])yc=[^&]*&?', '\1', 'g') AS link,
               count(*) AS clicks, count(DISTINCT lower(e.recipient_email)) AS people
          FROM public.email_campaign_events e
         WHERE e.campaign_id IN (SELECT id FROM _cmc WHERE root = p_campaign_id)
           AND e.event_type = 'clicked' AND e.metadata->'click'->>'link' IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.email_campaign_recipients rr WHERE rr.campaign_id = e.campaign_id AND lower(rr.email) = lower(e.recipient_email))
         GROUP BY 1 ORDER BY 3 DESC LIMIT 12) l;

    -- Jour par jour depuis l'envoi : ont regardé (1er clic de personne sur les billets), places
    -- prises (certaines + probables), réservé ensuite. 33 jours : la fenêtre « ensuite » (30 j)
    -- après les premiers jours.
    WITH d AS (SELECT generate_series(0, 32) AS i),
    seen AS (
      SELECT LEAST(32, GREATEST(0, ((min(k.at) AT TIME ZONE 'Europe/Paris')::date - (v_start AT TIME ZONE 'Europe/Paris')::date))) AS i, count(*) AS n
        FROM _cmk k WHERE k.root = p_campaign_id AND k.rec AND k.ticketing GROUP BY k.email
    ), sold AS (
      SELECT LEAST(32, GREATEST(0, ((a.bought_at AT TIME ZONE 'Europe/Paris')::date - (v_start AT TIME ZONE 'Europe/Paris')::date))) AS i, 1 AS n
        FROM _cma a WHERE a.campaign_id = p_campaign_id
    ), later AS (
      SELECT LEAST(32, GREATEST(0, ((l.bought_at AT TIME ZONE 'Europe/Paris')::date - (v_start AT TIME ZONE 'Europe/Paris')::date))) AS i, 1 AS n
        FROM _cml l WHERE l.campaign_id = p_campaign_id
    )
    SELECT jsonb_build_object(
             'seen', jsonb_agg((SELECT COALESCE(count(*), 0) FROM seen s WHERE s.i = d.i) ORDER BY d.i),
             'sold', jsonb_agg((SELECT COALESCE(count(*), 0) FROM sold s WHERE s.i = d.i) ORDER BY d.i),
             'later', jsonb_agg((SELECT COALESCE(count(*), 0) FROM later s WHERE s.i = d.i) ORDER BY d.i))
      INTO v_days FROM d;
  END IF;

  -- Les places, une par une (20 au plus, les plus récentes d'abord), avec leur niveau.
  WITH srows AS (
    SELECT a.id, a.email, a.bought_at, a.amount, a.level, t.deal_name,
           NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients rr
                        WHERE lower(rr.email) = a.email
                          AND rr.campaign_id IN (SELECT id FROM _cmc WHERE root = p_campaign_id)) AS shared
      FROM _cma a JOIN _cmt t ON t.id = a.id
     WHERE a.campaign_id = p_campaign_id
    UNION ALL
    SELECT l.id, l.email, l.bought_at, l.amount, 'later', t.deal_name, false
      FROM _cml l JOIN _cmt t ON t.id = l.id
     WHERE l.campaign_id = p_campaign_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', r.email, 'at', r.bought_at, 'level', r.level,
           'amount', round(r.amount, 2), 'deal', r.deal_name, 'shared', r.shared) ORDER BY r.bought_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM srows)
    INTO v_sales, v_sales_n FROM (SELECT * FROM srows ORDER BY bought_at DESC LIMIT 20) r;

  SELECT count(*) INTO v_shared FROM _cma a
   WHERE a.campaign_id = p_campaign_id AND a.level = 'certain'
     AND NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients rr
                      WHERE lower(rr.email) = a.email AND rr.campaign_id IN (SELECT id FROM _cmc WHERE root = p_campaign_id));

  -- Ouvertures : préchargement, contrôle de sécurité, client identifiable (partition des personnes).
  WITH o AS (
    SELECT lower(e.recipient_email) AS em,
           bool_or(public._email_open_class(e.metadata->'open'->>'userAgent') = 'client') AS client
      FROM public.email_campaign_events e
     WHERE e.campaign_id IN (SELECT id FROM _cmc WHERE root = p_campaign_id) AND e.event_type = 'opened'
       AND EXISTS (SELECT 1 FROM public.email_campaign_recipients rr WHERE rr.campaign_id = e.campaign_id AND lower(rr.email) = lower(e.recipient_email))
     GROUP BY 1
  ), s AS (
    SELECT o.em, o.client,
           EXISTS (SELECT 1 FROM _cmx x WHERE x.root = p_campaign_id AND x.email = o.em)
             AND NOT EXISTS (SELECT 1 FROM _cmk k WHERE k.root = p_campaign_id AND k.email = o.em AND k.rec) AS scan
      FROM o
  )
  SELECT count(*) FILTER (WHERE scan) AS scan, count(*) FILTER (WHERE NOT scan AND client) AS client,
         count(*) FILTER (WHERE NOT scan AND NOT client) AS proxy
    INTO v_open FROM s;

  -- Intérêt à relancer : a regardé (lien des billets), sans aucune place ensuite ni déjà un billet de la soirée.
  SELECT count(DISTINCT k.email) INTO v_interest
    FROM _cmk k
   WHERE k.root = p_campaign_id AND k.rec AND k.ticketing
     AND NOT EXISTS (SELECT 1 FROM _cma a WHERE a.campaign_id = p_campaign_id AND a.email = k.email)
     AND NOT EXISTS (SELECT 1 FROM _cml l WHERE l.campaign_id = p_campaign_id AND l.email = k.email)
     AND NOT EXISTS (SELECT 1 FROM _cmt t
                      WHERE t.email = k.email AND (ec.event_id IS NULL OR t.event_id = ec.event_id));

  SELECT max(k.at) + interval '30 days' INTO v_until FROM _cmk k WHERE k.root = p_campaign_id AND k.rec AND k.ticketing;

  -- La relance se compte avec sa campagne : envoyées, ont regardé, places prises.
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
           'n', COALESCE(sum((SELECT count(*) FROM public.email_campaign_recipients rr WHERE rr.campaign_id = c.id AND rr.status IN ('sent', 'complained', 'bounced'))), 0),
           'seen', (SELECT count(DISTINCT k.email) FROM _cmk k WHERE k.campaign_id IN (SELECT id FROM public.email_campaigns WHERE parent_campaign_id = p_campaign_id) AND k.rec AND k.ticketing),
           'sold', (SELECT count(*) FROM _cma a JOIN public.external_tickets x ON x.id = a.id
                     WHERE a.campaign_id = p_campaign_id
                       AND lower(btrim(x.utm->>'utm_source')) IN (SELECT 'yuno-m-' || left(id::text, 8) FROM public.email_campaigns WHERE parent_campaign_id = p_campaign_id)),
           'sent_at', min(c.sent_at)) END
    INTO v_follow FROM public.email_campaigns c
   WHERE c.parent_campaign_id = p_campaign_id AND c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL;

  -- Les autres campagnes envoyées (pour passer de l'une à l'autre).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at) ORDER BY sent_at DESC), '[]'::jsonb)
    INTO v_list FROM (SELECT id, name, sent_at FROM _ces ORDER BY sent_at DESC LIMIT 24) z;

  RETURN public._crm_email_row(ec) || jsonb_build_object(
    'stats', CASE WHEN v_me.id IS NULL THEN NULL ELSE jsonb_build_object(
      'n', v_me.n, 'received', v_me.received, 'opened', v_me.opened, 'clicked', v_me.clicked, 'ticketing', v_me.ticketing,
      'purchases', v_me.purchases, 'buyers', v_me.buyers, 'revenue', round(v_me.revenue, 2), 'bounced', v_me.bounced, 'complained', v_me.complained,
      'unsub', v_me.unsub, 'non_openers', GREATEST(v_me.received - v_me.opened - v_me.complained, 0),
      'certain', v_me.certain, 'probable', v_me.probable, 'later', v_me.later, 'later_buyers', v_me.later_buyers,
      'auto_people', v_me.auto_people, 'auto_clicks', v_me.auto_clicks,
      'opened_proxy', COALESCE(v_open.proxy, 0), 'opened_scan', COALESCE(v_open.scan, 0), 'opened_client', COALESCE(v_open.client, 0),
      'shared', COALESCE(v_shared, 0), 'interest', COALESCE(v_interest, 0), 'window_until', v_until) END,
    'avg', jsonb_build_object('campaigns', v_avg.n_campaigns, 'open_rate', round(v_avg.open_rate, 4), 'click_rate', round(v_avg.click_rate, 4), 'per_k', round(v_avg.per_k, 2)),
    'rank', v_rank, 'rank_of', v_total,
    'timeline', COALESCE(v_tl, '[]'::jsonb), 'links', COALESCE(v_links, '[]'::jsonb), 'others', v_list,
    'days', v_days, 'sales', COALESCE(v_sales, '[]'::jsonb), 'sales_total', COALESCE(v_sales_n, 0), 'follow', v_follow,
    'resend', jsonb_build_object('enabled', ec.resend_enabled, 'subject', ec.resend_subject, 'done_at', ec.resend_done_at, 'campaign_id', ec.resend_campaign_id),
    'started_at', v_start, 'blocks_version', ec.blocks_version);
END;
$function$;
