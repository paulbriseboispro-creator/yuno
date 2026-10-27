-- Yuno CRM › Analyses › Trafic, lot C2 (docs/designs/TRAFFIC_TAB_PLAN.md, 27/10).
--
-- `crm_ana_clicks` : le trafic qui passe PAR YUNO, compté en personnes. Ce
-- que la page Shotgun voit (visites, temps, paniers) n'est pas dans l'API :
-- l'écran dit « Bientôt », cette lecture ne l'estime jamais.
--
-- Ce qu'elle lit :
--   * les clics des liens /go/ (tracked_link_clicks) des soirées miroirs de la
--     portée, rangés par emplacement : ys story Instagram, yb bio Instagram,
--     yt bio TikTok, pa lien partenaire, sm SMS, yl tout autre lien Yuno
--     (WhatsApp, flyer, bouton d'une page /j/…) ;
--   * em : les clics des e-mails CRM de la portée (email_campaign_events) ;
--   * les visites des pages d'inscription /j/ (crm_signup_visits) et leurs
--     inscrits (crm_signup_entries) ;
--   * les billets que Shotgun rapporte avec une source Yuno (`yuno…`), pour le
--     seul pont vers l'argent : commandes (et le CA total, sous _crm_money_gate,
--     pour la phrase du bas de page).
--
-- « Personnes » (décision D2 de Paul, 27/10) : l'empreinte d'un clic est salée
-- DU JOUR ; une personne = un visiteur, un jour, un lien (un e-mail, un jour,
-- une campagne pour les e-mails). L'écran le dit sous le chiffre.
-- « Clic → achat » = commandes d'une source Yuno / personnes, montré dès 10
-- personnes (l'écran applique MIN_SAMPLE).
--
-- Sans table temporaire (lisible en aperçu démo, transaction en lecture seule).
-- Deux modes : période (`p_period`, cases de _crm_ana_setup) ou soirée
-- (`p_event`, comparée à `p_compare`, sinon la précédente de la même série).

CREATE OR REPLACE FUNCTION public._crm_ana_click_family(p_platform text, p_placement text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_platform, '')) = 'sms' THEN 'sm'
    WHEN lower(COALESCE(p_placement, '')) = 'partner' THEN 'pa'
    WHEN lower(COALESCE(p_platform, '')) = 'instagram' AND lower(COALESCE(p_placement, '')) = 'story' THEN 'ys'
    WHEN lower(COALESCE(p_platform, '')) = 'instagram' AND lower(COALESCE(p_placement, '')) = 'bio' THEN 'yb'
    WHEN lower(COALESCE(p_platform, '')) = 'tiktok' AND lower(COALESCE(p_placement, '')) = 'bio' THEN 'yt'
    ELSE 'yl' END;
$$;
REVOKE ALL ON FUNCTION public._crm_ana_click_family(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_ana_clicks__core(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_period text DEFAULT '30d',
  p_event uuid DEFAULT NULL,
  p_compare uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh int;
  v_now timestamptz := now();
  v_today date;
  v_mode text; v_n int;
  v_start timestamptz; v_end timestamptz;   -- fenêtre (heures)
  v_d0 date; v_m0 date;                     -- premier jour / mois
  v_from date; v_to date;                   -- fenêtre en nuits (jours, mois)
  v_pfrom date; v_pto date;                 -- fenêtre d'avant
  v_labels jsonb;
  v_ev record; v_cmp record;
  v_eid uuid; v_enight date; v_cid uuid; v_cnight date;
  v_cut int;                                -- soirée à venir : J-k d'aujourd'hui
  v_lo timestamptz;                         -- début de la fenêtre d'avant (lecture des billets)
  m jsonb;
  v_out jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r;
  v_today := public._crm_night_date(v_now, v_tz, v_eh);

  -- ── Cases (mêmes règles que _crm_ana_setup) ────────────────────────────────
  IF p_event IS NOT NULL THEN
    SELECT e.id, e.title, e.start_at, COALESCE(public._crm_night_series(e.title), e.title) AS series,
           public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), v_tz), v_eh) AS night,
           COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now AS upcoming
      INTO v_ev
      FROM public.events e
     WHERE e.id = p_event AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));
    IF v_ev.id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;

    SELECT e.id, e.title, e.start_at,
           public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), v_tz), v_eh) AS night
      INTO v_cmp
      FROM public.events e
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.id <> v_ev.id
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND ((p_compare IS NOT NULL AND e.id = p_compare)
         OR (p_compare IS NULL AND e.start_at < v_ev.start_at))
     ORDER BY (COALESCE(public._crm_night_series(e.title), e.title) = v_ev.series) DESC, e.start_at DESC
     LIMIT 1;
    v_eid := v_ev.id; v_enight := v_ev.night; v_cid := v_cmp.id; v_cnight := v_cmp.night;
    v_cut := CASE WHEN v_ev.upcoming THEN GREATEST(0, v_ev.night - v_today) END;
    v_mode := 'event'; v_n := 22;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_end := date_trunc('hour', v_now) + interval '1 hour';
    v_start := v_end - make_interval(hours => v_n);
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
    v_from := v_m0; v_to := v_today;
    v_pfrom := (v_m0 - interval '12 months')::date; v_pto := v_m0 - 1;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
    v_from := v_d0; v_to := v_today;
    v_pfrom := v_d0 - v_n; v_pto := v_d0 - 1;
  END IF;

  v_lo := CASE v_mode WHEN 'hour' THEN v_start - make_interval(hours => v_n)
                      WHEN 'event' THEN NULL
                      ELSE (v_pfrom::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz END;

  SELECT jsonb_agg(CASE v_mode
           WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
           WHEN 'day' THEN to_jsonb(v_d0 + g)
           WHEN 'month' THEN to_jsonb((v_m0 + make_interval(months => g))::date)
           ELSE to_jsonb(v_enight - (21 - g)) END ORDER BY g)
    INTO v_labels FROM generate_series(0, v_n - 1) g;

  m := jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', 'all', 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_enight - 21) END,
    'event', NULL, 'prev_event', NULL);
  IF v_mode = 'event' THEN
    m := m || jsonb_build_object(
      'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'night', v_ev.night,
                                  'upcoming', v_ev.upcoming, 'days_left', GREATEST(0, v_ev.night - v_today)),
      'prev_event', CASE WHEN v_cid IS NOT NULL THEN jsonb_build_object(
                       'id', v_cmp.id, 'title', v_cmp.title, 'start_at', v_cmp.start_at, 'night', v_cmp.night) END);
  END IF;

  WITH
  ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, e.external_ticket_url,
           public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), v_tz), v_eh) AS night,
           COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now AS upcoming
      FROM public.events e
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND (v_mode <> 'event' OR e.id IN (v_eid, v_cid))
  ),
  -- Liens Yuno des soirées de la portée (partage, partenaire, SMS, page /j/).
  lk AS MATERIALIZED (
    SELECT tl.id, tl.code, tl.label, tl.partner_name, tl.utm_source AS platform, tl.utm_medium AS placement,
           tl.created_at, tl.event_id, tl.archived_at,
           public._crm_ana_click_family(tl.utm_source, tl.utm_medium) AS fam,
           public.crm_link_source_for(tl.utm_source, tl.code) AS src
      FROM public.tracked_links tl JOIN ev ON ev.id = tl.event_id
     WHERE tl.target_kind = 'event'
  ),
  -- Campagnes e-mail CRM de la portée (mères et enfants : recettes, scénarios).
  cp AS MATERIALIZED (
    SELECT c.id, c.name, c.event_id, c.sent_at, c.automation_id, c.parent_campaign_id,
           (SELECT a.kind FROM public.email_automations a WHERE a.id = c.automation_id) AS recipe,
           'yuno-m-' || substr(c.id::text, 1, 8) AS src
      FROM public.email_campaigns c
     WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.sent_at IS NOT NULL
       AND public.crm_campaign_is_crm(c.id)
       AND (v_mode <> 'event' OR c.event_id IN (v_eid, v_cid))
  ),
  -- Chaque clic (lien ou e-mail) : instant, nuit, personne, emplacement.
  raw AS (
    SELECT 'l'::text AS kind, k.tracked_link_id AS ref, l.fam, l.event_id, k.clicked_at AS at,
           k.visitor_id AS who, k.device_type AS device, k.country, k.in_app
      FROM public.tracked_link_clicks k JOIN lk l ON l.id = k.tracked_link_id
     WHERE v_mode = 'event'
        OR (v_mode = 'hour' AND k.clicked_at >= v_start - make_interval(hours => v_n) AND k.clicked_at < v_end)
        OR (v_mode IN ('day', 'month') AND k.clicked_at >= ((v_pfrom::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz)
                                        AND k.clicked_at < (((v_to + 1)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz))
    UNION ALL
    SELECT 'e', ce.campaign_id, 'em', c.event_id, ce.created_at, lower(ce.recipient_email), NULL, NULL, NULL
      FROM public.email_campaign_events ce JOIN cp c ON c.id = ce.campaign_id
     WHERE ce.event_type = 'clicked'
       AND (v_mode = 'event'
         OR (v_mode = 'hour' AND ce.created_at >= v_start - make_interval(hours => v_n) AND ce.created_at < v_end)
         OR (v_mode IN ('day', 'month') AND ce.created_at >= ((v_pfrom::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz)
                                         AND ce.created_at < (((v_to + 1)::timestamp + make_interval(hours => v_eh)) AT TIME ZONE v_tz)))
  ),
  hit AS MATERIALIZED (
    SELECT r.*, q.nd,
           -- Une personne = un visiteur, un jour, un lien (D2).
           r.kind || ':' || r.ref::text || ':' || COALESCE(r.who, '?') || ':' || q.nd::text AS pk,
           CASE v_mode
             WHEN 'hour' THEN CASE WHEN r.at >= v_start THEN floor(extract(epoch FROM r.at - v_start) / 3600)::int END
             WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_from AND v_to THEN q.nd - v_from END
             WHEN 'month' THEN CASE WHEN q.nd BETWEEN v_from AND v_to
                                    THEN ((extract(year FROM q.nd) - extract(year FROM v_m0)) * 12
                                          + extract(month FROM q.nd) - extract(month FROM v_m0))::int END
             ELSE CASE WHEN r.event_id = v_eid THEN 0 END
           END AS ci,
           CASE v_mode
             WHEN 'hour' THEN CASE WHEN r.at < v_start THEN 0 END
             WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_pfrom AND v_pto THEN 0 END
             WHEN 'month' THEN CASE WHEN q.nd BETWEEN v_pfrom AND v_pto THEN 0 END
             -- Soirée : la comparée, arrêtée au même J-k que la soirée choisie.
             ELSE CASE WHEN r.event_id = v_cid AND (v_cut IS NULL OR v_cnight - q.nd >= v_cut) THEN 0 END
           END AS pi,
           CASE WHEN v_mode = 'event' THEN
             (SELECT x.night FROM ev x WHERE x.id = r.event_id) - q.nd END AS d,
           extract(isodow FROM r.at AT TIME ZONE v_tz)::int - 1 AS dow,
           extract(hour FROM r.at AT TIME ZONE v_tz)::int AS hr
      FROM raw r
      CROSS JOIN LATERAL (SELECT public._crm_night_date(r.at, v_tz, v_eh) AS nd) q
  ),
  cur AS (SELECT * FROM hit WHERE ci IS NOT NULL),
  -- Billets vendus : la source Yuno qu'ils portent (le pont vers l'argent) et
  -- la plateforme d'achat que Shotgun rend (`utm_medium`).
  tk AS MATERIALIZED (
    SELECT t.event_id, COALESCE(t.external_order_id, t.id::text) AS ord,
           COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
           lower(btrim(COALESCE(CASE WHEN jsonb_typeof(t.utm) = 'object' THEN t.utm->>'utm_source' END, ''))) AS src,
           lower(btrim(COALESCE(CASE WHEN jsonb_typeof(t.utm) = 'object' THEN t.utm->>'utm_medium' END, ''))) AS med,
           q.nd,
           CASE v_mode
             WHEN 'hour' THEN (COALESCE(t.purchased_at, t.first_seen_at) >= v_start AND COALESCE(t.purchased_at, t.first_seen_at) < v_end)
             WHEN 'event' THEN t.event_id = v_eid
             ELSE q.nd BETWEEN v_from AND v_to END AS is_cur,
           CASE v_mode
             WHEN 'hour' THEN (COALESCE(t.purchased_at, t.first_seen_at) >= v_start - make_interval(hours => v_n) AND COALESCE(t.purchased_at, t.first_seen_at) < v_start)
             WHEN 'event' THEN t.event_id = v_cid AND (v_cut IS NULL OR v_cnight - q.nd >= v_cut)
             ELSE q.nd BETWEEN v_pfrom AND v_pto END AS is_prev
      FROM public.external_tickets t
      CROSS JOIN LATERAL (SELECT public._crm_night_date(COALESCE(t.purchased_at, t.first_seen_at), v_tz, v_eh) AS nd) q
     WHERE public._crm_ticket_is_sale(t.status, t.deal_channel)
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND (v_mode <> 'event' OR t.event_id IN (v_eid, v_cid))
       AND (v_lo IS NULL OR COALESCE(t.purchased_at, t.first_seen_at) >= v_lo)
  ),
  ytk AS (SELECT * FROM tk WHERE src LIKE 'yuno%' AND (is_cur OR is_prev)),
  -- Pages d'inscription /j/ de la portée.
  pg AS MATERIALIZED (
    SELECT p.id, p.title, p.kind, p.status, p.event_id, p.created_at, p.published_at
      FROM public.crm_signup_pages p
     WHERE p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND (v_mode <> 'event' OR p.event_id IN (v_eid, v_cid))
  ),
  vis AS (
    SELECT v.page_id, COALESCE(v.src, 'direct') AS src, v.day, v.at,
           CASE WHEN v_mode = 'event' THEN (SELECT p.event_id FROM pg p WHERE p.id = v.page_id) = v_eid
                WHEN v_mode = 'hour' THEN v.at >= v_start AND v.at < v_end
                ELSE v.day BETWEEN v_from AND v_to END AS is_cur,
           CASE WHEN v_mode = 'event' THEN false
                WHEN v_mode = 'hour' THEN v.at >= v_start - make_interval(hours => v_n) AND v.at < v_start
                ELSE v.day BETWEEN v_pfrom AND v_pto END AS is_prev
      FROM public.crm_signup_visits v JOIN pg ON pg.id = v.page_id
  ),
  ent AS (
    SELECT s.page_id, COALESCE(s.src, 'direct') AS src, s.created_at, s.confirmed_at, lower(s.email) AS email,
           CASE WHEN v_mode = 'event' THEN (SELECT p.event_id FROM pg p WHERE p.id = s.page_id) = v_eid
                WHEN v_mode = 'hour' THEN s.created_at >= v_start AND s.created_at < v_end
                ELSE public._crm_night_date(s.created_at, v_tz, v_eh) BETWEEN v_from AND v_to END AS is_cur,
           CASE WHEN v_mode = 'event' THEN false
                WHEN v_mode = 'hour' THEN s.created_at >= v_start - make_interval(hours => v_n) AND s.created_at < v_start
                ELSE public._crm_night_date(s.created_at, v_tz, v_eh) BETWEEN v_pfrom AND v_pto END AS is_prev
      FROM public.crm_signup_entries s JOIN pg ON pg.id = s.page_id
  ),
  -- Une ligne par lien / campagne vue dans la fenêtre.
  rows_ AS (
    SELECT h.kind, h.ref, min(h.fam) AS fam, count(*) AS clicks, count(DISTINCT h.pk) AS people,
           count(*) FILTER (WHERE h.in_app IS NOT NULL) AS ua_known,
           count(*) FILTER (WHERE h.in_app = 'instagram') AS ig,
           count(*) FILTER (WHERE h.in_app IN ('instagram', 'facebook', 'tiktok')) AS in_app
      FROM cur h GROUP BY h.kind, h.ref
  ),
  peak AS (
    SELECT DISTINCT ON (h.kind, h.ref) h.kind, h.ref, h.dow, h.hr
      FROM cur h GROUP BY h.kind, h.ref, h.dow, h.hr
     ORDER BY h.kind, h.ref, count(*) DESC, h.dow, h.hr
  ),
  lord AS (
    SELECT l.id, count(DISTINCT y.ord) AS orders
      FROM lk l JOIN ytk y ON y.src = l.src AND y.is_cur GROUP BY l.id
  ),
  cord AS (
    SELECT c.id, count(DISTINCT y.ord) AS orders
      FROM cp c JOIN ytk y ON y.src = c.src AND y.is_cur GROUP BY c.id
  ),
  links_out AS (
    SELECT jsonb_build_object(
             'kind', r.kind, 'id', r.ref, 'fam', r.fam,
             'label', CASE WHEN r.kind = 'l' THEN COALESCE(NULLIF(btrim(l.partner_name), ''), NULLIF(btrim(l.label), ''), l.code) ELSE c.name END,
             'platform', l.platform, 'placement', l.placement, 'code', l.code,
             'recipe', c.recipe, 'child', c.parent_campaign_id IS NOT NULL OR c.automation_id IS NOT NULL,
             'event_id', COALESCE(l.event_id, c.event_id),
             'event_title', (SELECT e.title FROM ev e WHERE e.id = COALESCE(l.event_id, c.event_id)),
             'created_at', COALESCE(l.created_at, c.sent_at),
             'clicks', r.clicks, 'people', r.people, 'ua_known', r.ua_known, 'in_app', r.in_app, 'ig', r.ig,
             'peak_dow', pk.dow, 'peak_hour', pk.hr,
             'orders', COALESCE(CASE WHEN r.kind = 'l' THEN lo.orders ELSE co.orders END, 0)) AS j,
           r.clicks
      FROM rows_ r
      LEFT JOIN lk l ON r.kind = 'l' AND l.id = r.ref
      LEFT JOIN cp c ON r.kind = 'e' AND c.id = r.ref
      LEFT JOIN peak pk ON pk.kind = r.kind AND pk.ref = r.ref
      LEFT JOIN lord lo ON r.kind = 'l' AND lo.id = r.ref
      LEFT JOIN cord co ON r.kind = 'e' AND co.id = r.ref
  ),
  -- Liens d'une soirée choisie sans clic encore : ils comptent dans « Les liens de cette soirée ».
  idle_links AS (
    SELECT jsonb_build_object(
             'kind', 'l', 'id', l.id, 'fam', l.fam,
             'label', COALESCE(NULLIF(btrim(l.partner_name), ''), NULLIF(btrim(l.label), ''), l.code),
             'platform', l.platform, 'placement', l.placement, 'code', l.code, 'recipe', NULL, 'child', false,
             'event_id', l.event_id, 'event_title', (SELECT e.title FROM ev e WHERE e.id = l.event_id),
             'created_at', l.created_at, 'clicks', 0, 'people', 0, 'ua_known', 0, 'in_app', 0, 'ig', 0,
             'peak_dow', NULL, 'peak_hour', NULL, 'orders', COALESCE(lo.orders, 0)) AS j
      FROM lk l LEFT JOIN lord lo ON lo.id = l.id
     WHERE v_mode = 'event' AND l.event_id = v_eid AND l.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM rows_ r WHERE r.kind = 'l' AND r.ref = l.id)
  ),
  fams AS (
    SELECT f.k, f.o,
           (SELECT count(*) FROM cur h WHERE h.fam = f.k) AS clicks,
           (SELECT count(DISTINCT h.pk) FROM cur h WHERE h.fam = f.k) AS people,
           (SELECT count(*) FROM hit h WHERE h.pi IS NOT NULL AND h.fam = f.k) AS prev_clicks,
           (SELECT count(DISTINCT y.ord) FROM ytk y WHERE y.is_cur AND (
              (f.k = 'em' AND (y.src = 'yuno' OR EXISTS (SELECT 1 FROM cp c WHERE c.src = y.src)))
              OR (f.k <> 'em' AND EXISTS (SELECT 1 FROM lk l WHERE l.src = y.src AND l.fam = f.k)))) AS orders
      FROM unnest(ARRAY['ys', 'yb', 'yt', 'pa', 'em', 'sm', 'yl']) WITH ORDINALITY f(k, o)
  ),
  ser AS (
    SELECT h.ci, h.fam, count(*) AS c, count(DISTINCT h.pk) AS p FROM cur h WHERE v_mode <> 'event' GROUP BY h.ci, h.fam
  ),
  -- « A cliqué sans acheter » : la règle de la recette `click_no_buy` — un clic
  -- nominatif dans un e-mail de la portée vers la page Shotgun d'une soirée
  -- (`_link_base`), et aucune place à la même adresse pour elle.
  cnb AS (
    SELECT DISTINCT lower(ce.recipient_email) AS email, e.id AS event_id
      FROM public.email_campaign_events ce
      JOIN cp c ON c.id = ce.campaign_id
      JOIN ev e ON public._link_base(ce.metadata->'click'->>'link') = public._link_base(e.external_ticket_url)
     WHERE ce.event_type = 'clicked'
       AND e.external_ticket_url IS NOT NULL
       AND (CASE WHEN v_mode = 'event' THEN e.id = v_eid
                 WHEN v_mode = 'hour' THEN ce.created_at >= v_start AND ce.created_at < v_end
                 ELSE public._crm_night_date(ce.created_at, v_tz, v_eh) BETWEEN v_from AND v_to END)
       AND NOT EXISTS (SELECT 1 FROM public.external_tickets xt
                        WHERE xt.event_id = e.id AND xt.status IN ('valid', 'transferred')
                          AND lower(xt.buyer_email) = lower(ce.recipient_email))
  ),
  nights AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming,
           (SELECT count(*) FROM cur h WHERE h.event_id = e.id) AS clicks,
           (SELECT count(DISTINCT h.pk) FROM cur h WHERE h.event_id = e.id) AS people,
           (SELECT count(DISTINCT h.ref) FROM cur h WHERE h.event_id = e.id AND h.kind = 'l') AS links,
           (SELECT count(*) FROM ent s JOIN pg p ON p.id = s.page_id WHERE s.is_cur AND p.event_id = e.id) AS signups,
           (SELECT count(DISTINCT y.ord) FROM ytk y WHERE y.is_cur AND y.event_id = e.id) AS orders
      FROM ev e
  ),
  totals AS (
    SELECT (SELECT count(*) FROM cur) AS clicks,
           (SELECT count(DISTINCT pk) FROM cur) AS people,
           (SELECT count(*) FROM hit WHERE pi IS NOT NULL) AS prev_clicks,
           (SELECT count(DISTINCT pk) FROM hit WHERE pi IS NOT NULL) AS prev_people,
           (SELECT count(*) FROM cur WHERE fam IN ('ys', 'yb') AND in_app IS NOT NULL) AS ig_known,
           (SELECT count(*) FROM cur WHERE fam IN ('ys', 'yb') AND in_app = 'instagram') AS ig_in,
           (SELECT count(*) FROM hit WHERE pi IS NOT NULL AND fam IN ('ys', 'yb') AND in_app IS NOT NULL) AS prev_ig_known,
           (SELECT count(*) FROM hit WHERE pi IS NOT NULL AND fam IN ('ys', 'yb') AND in_app = 'instagram') AS prev_ig_in,
           (SELECT count(DISTINCT ord) FROM ytk WHERE is_cur) AS orders,
           (SELECT count(DISTINCT ord) FROM ytk WHERE is_prev) AS prev_orders,
           (SELECT round(sum(amount), 2) FROM ytk WHERE is_cur) AS revenue,
           (SELECT count(*) FROM vis WHERE is_cur) AS visits,
           (SELECT count(*) FROM vis WHERE is_prev) AS prev_visits,
           (SELECT count(*) FROM ent WHERE is_cur) AS signups,
           (SELECT count(*) FROM ent WHERE is_prev) AS prev_signups,
           (SELECT count(*) FROM cnb) AS click_no_buy
  )
  SELECT jsonb_build_object(
    'meta', m,
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'families', (SELECT jsonb_agg(jsonb_build_object('k', f.k, 'clicks', f.clicks, 'people', f.people,
                                                      'prev_clicks', f.prev_clicks, 'orders', f.orders) ORDER BY f.o) FROM fams f),
    'series', CASE WHEN v_mode <> 'event' THEN (
      SELECT jsonb_agg(jsonb_build_object(
               'c', (SELECT jsonb_object_agg(f.k, COALESCE((SELECT s.c FROM ser s WHERE s.ci = g AND s.fam = f.k), 0))
                       FROM unnest(ARRAY['ys', 'yb', 'yt', 'pa', 'em', 'sm', 'yl']) f(k)),
               'p', (SELECT jsonb_object_agg(f.k, COALESCE((SELECT s.p FROM ser s WHERE s.ci = g AND s.fam = f.k), 0))
                       FROM unnest(ARRAY['ys', 'yb', 'yt', 'pa', 'em', 'sm', 'yl']) f(k))) ORDER BY g)
        FROM generate_series(0, v_n - 1) g) END,
    -- Soirée : clics cumulés de J-span à J-0, la choisie et la comparée.
    'curve', CASE WHEN v_mode = 'event' THEN (
      WITH sp AS (
        SELECT LEAST(60, GREATEST(14, COALESCE(max(h.d), 0))) AS span FROM hit h WHERE h.d >= 0
      )
      SELECT jsonb_build_object(
        'span', sp.span,
        'today_d', v_cut,
        'cur', (SELECT jsonb_agg(CASE WHEN v_cut IS NOT NULL AND g < v_cut THEN NULL ELSE
                    (SELECT count(*) FROM hit h WHERE h.event_id = v_eid AND h.d >= g) END ORDER BY g DESC)
                  FROM generate_series(0, sp.span) g),
        'prev', CASE WHEN v_cid IS NOT NULL THEN (
                  SELECT jsonb_agg((SELECT count(*) FROM hit h WHERE h.event_id = v_cid AND h.d >= g) ORDER BY g DESC)
                    FROM generate_series(0, sp.span) g) END,
        'prev_people_total', (SELECT count(DISTINCT h.pk) FROM hit h WHERE h.event_id = v_cid))
        FROM sp) END,
    -- Repères : envois e-mail / SMS de la fenêtre, liens créés, pages publiées.
    'marks', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('at', s->>'at', 'name', s->>'name', 'channel', s->>'channel', 'i', s->'i',
                                  'd', CASE WHEN v_mode = 'event' THEN v_enight - public._crm_night_date((s->>'at')::timestamptz, v_tz, v_eh) END) AS x
          FROM jsonb_array_elements(CASE WHEN v_mode = 'event' THEN (
                   SELECT COALESCE(jsonb_agg(jsonb_build_object('at', c.sent_at, 'name', c.name, 'channel', 'email', 'i', NULL)), '[]'::jsonb)
                     FROM cp c WHERE c.event_id = v_eid AND c.parent_campaign_id IS NULL AND c.automation_id IS NULL)
                 || (SELECT COALESCE(jsonb_agg(jsonb_build_object('at', s.sent_at, 'name', s.name, 'channel', 'sms', 'i', NULL)), '[]'::jsonb)
                       FROM public.sms_campaigns s
                      WHERE s.event_id = v_eid AND s.sent_at IS NOT NULL AND s.product = 'crm'
                        AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id)
               ELSE public._crm_ana_sends(p_venue_id, p_organizer_user_id, m) END) s
        UNION ALL
        SELECT jsonb_build_object('at', l.created_at, 'name', COALESCE(NULLIF(btrim(l.partner_name), ''), NULLIF(btrim(l.label), ''), l.code),
                                  'channel', 'link', 'fam', l.fam,
                                  'i', CASE v_mode
                                         WHEN 'hour' THEN CASE WHEN l.created_at >= v_start AND l.created_at < v_end
                                                               THEN floor(extract(epoch FROM l.created_at - v_start) / 3600)::int END
                                         WHEN 'day' THEN public._crm_night_date(l.created_at, v_tz, v_eh) - v_from
                                         WHEN 'month' THEN ((extract(year FROM public._crm_night_date(l.created_at, v_tz, v_eh)) - extract(year FROM v_m0)) * 12
                                                            + extract(month FROM public._crm_night_date(l.created_at, v_tz, v_eh)) - extract(month FROM v_m0))::int END,
                                  'd', CASE WHEN v_mode = 'event' THEN v_enight - public._crm_night_date(l.created_at, v_tz, v_eh) END)
          FROM lk l
         WHERE l.fam IN ('ys', 'yb', 'yt', 'pa', 'yl') AND l.placement <> 'page'
           AND CASE WHEN v_mode = 'event' THEN l.event_id = v_eid
                    WHEN v_mode = 'hour' THEN l.created_at >= v_start AND l.created_at < v_end
                    ELSE public._crm_night_date(l.created_at, v_tz, v_eh) BETWEEN v_from AND v_to END
        UNION ALL
        SELECT jsonb_build_object('at', COALESCE(p.published_at, p.created_at), 'name', p.title, 'channel', 'page', 'i', NULL,
                                  'd', v_enight - public._crm_night_date(COALESCE(p.published_at, p.created_at), v_tz, v_eh))
          FROM pg p WHERE v_mode = 'event' AND p.event_id = v_eid AND p.status IN ('live', 'closed')
      ) q),
    'links', (SELECT COALESCE(jsonb_agg(z.j ORDER BY z.n DESC), '[]'::jsonb) FROM (
                SELECT o.j, o.clicks AS n FROM links_out o
                 WHERE v_mode <> 'event' OR (o.j->>'event_id')::uuid = v_eid
                 ORDER BY o.clicks DESC LIMIT CASE WHEN v_mode = 'event' THEN 40 ELSE 12 END) z)
             || (SELECT COALESCE(jsonb_agg(i.j ORDER BY i.j->>'created_at' DESC), '[]'::jsonb) FROM idle_links i),
    'links_total', (SELECT count(*) FROM links_out),
    'pages', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'title', p.title, 'kind', p.kind, 'status', p.status, 'event_id', p.event_id,
                  'visits', (SELECT count(*) FROM vis v WHERE v.page_id = p.id AND v.is_cur),
                  'signups', (SELECT count(*) FROM ent s WHERE s.page_id = p.id AND s.is_cur),
                  'confirmed', (SELECT count(*) FROM ent s WHERE s.page_id = p.id AND s.is_cur AND s.confirmed_at IS NOT NULL),
                  'took', (SELECT count(DISTINCT s.email) FROM ent s WHERE s.page_id = p.id AND s.is_cur AND s.email IS NOT NULL
                              AND p.event_id IS NOT NULL
                              AND EXISTS (SELECT 1 FROM public.external_tickets xt
                                           WHERE xt.event_id = p.event_id AND xt.status IN ('valid', 'transferred')
                                             AND lower(xt.buyer_email) = s.email)))
                ORDER BY (SELECT count(*) FROM vis v WHERE v.page_id = p.id AND v.is_cur) DESC), '[]'::jsonb)
                FROM pg p
               WHERE EXISTS (SELECT 1 FROM vis v WHERE v.page_id = p.id AND v.is_cur)
                  OR EXISTS (SELECT 1 FROM ent s WHERE s.page_id = p.id AND s.is_cur)
                  OR (v_mode = 'event' AND p.event_id = v_eid)),
    'page_srcs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('src', x.src, 'visits', x.v, 'signups', x.s) ORDER BY x.v DESC), '[]'::jsonb)
                    FROM (SELECT k.src, count(*) FILTER (WHERE k.t = 'v') AS v, count(*) FILTER (WHERE k.t = 's') AS s
                            FROM (SELECT src, 'v' AS t FROM vis WHERE is_cur UNION ALL SELECT src, 's' FROM ent WHERE is_cur) k
                           GROUP BY k.src) x),
    -- E-mails et SMS : reçus, personnes qui cliquent (aucun montant ici).
    'messages', jsonb_build_object(
      'email', jsonb_build_object(
        'sent', (SELECT count(*) FROM public.email_campaign_recipients r JOIN cp c ON c.id = r.campaign_id
                  WHERE r.status = 'sent' AND r.sent_at IS NOT NULL
                    AND CASE WHEN v_mode = 'event' THEN c.event_id = v_eid
                             WHEN v_mode = 'hour' THEN r.sent_at >= v_start AND r.sent_at < v_end
                             ELSE public._crm_night_date(r.sent_at, v_tz, v_eh) BETWEEN v_from AND v_to END),
        'clickers', (SELECT count(DISTINCT h.who) FROM cur h WHERE h.kind = 'e')),
      'sms', jsonb_build_object(
        'sent', (SELECT count(*) FROM public.sms_campaign_recipients r JOIN public.sms_campaigns s ON s.id = r.campaign_id
                  WHERE s.product = 'crm' AND r.sent_at IS NOT NULL AND r.status IN ('sent', 'delivered')
                    AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
                    AND CASE WHEN v_mode = 'event' THEN s.event_id = v_eid
                             WHEN v_mode = 'hour' THEN r.sent_at >= v_start AND r.sent_at < v_end
                             ELSE public._crm_night_date(r.sent_at, v_tz, v_eh) BETWEEN v_from AND v_to END),
        'clickers', (SELECT count(DISTINCT h.pk) FROM cur h WHERE h.fam = 'sm')),
      'rows', (
        SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'clickers')::int DESC), '[]'::jsonb) FROM (
          -- Campagnes à la main.
          SELECT jsonb_build_object('kind', 'campaign', 'id', c.id, 'name', c.name, 'at', c.sent_at,
                   'sent', (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent'),
                   'clickers', (SELECT count(DISTINCT h.who) FROM cur h WHERE h.kind = 'e' AND h.ref = c.id)) AS x
            FROM cp c
           WHERE c.automation_id IS NULL AND c.parent_campaign_id IS NULL
             AND EXISTS (SELECT 1 FROM cur h WHERE h.kind = 'e' AND h.ref = c.id)
          UNION ALL
          -- Recettes : leurs enfants regroupés.
          SELECT jsonb_build_object('kind', 'recipe', 'id', NULL, 'name', c.recipe, 'at', max(c.sent_at),
                   'nights', count(DISTINCT c.event_id),
                   'sent', (SELECT count(*) FROM public.email_campaign_recipients r JOIN cp c2 ON c2.id = r.campaign_id
                             WHERE c2.recipe = c.recipe AND r.status = 'sent'),
                   'clickers', (SELECT count(DISTINCT h.who) FROM cur h JOIN cp c2 ON c2.id = h.ref WHERE h.kind = 'e' AND c2.recipe = c.recipe))
            FROM cp c
           WHERE c.recipe IS NOT NULL AND EXISTS (SELECT 1 FROM cur h WHERE h.kind = 'e' AND h.ref = c.id)
           GROUP BY c.recipe
          UNION ALL
          -- SMS : personnes sur le lien court de la soirée de chaque envoi.
          SELECT jsonb_build_object('kind', 'sms', 'id', s.id, 'name', s.name, 'at', s.sent_at,
                   'sent', COALESCE(s.sent_count, 0),
                   'clickers', (SELECT count(DISTINCT h.pk) FROM cur h WHERE h.kind = 'l' AND h.ref = s.tracked_link_id
                                  AND h.at >= s.sent_at AND h.at < s.sent_at + interval '7 days'))
            FROM public.sms_campaigns s
           WHERE s.product = 'crm' AND s.sent_at IS NOT NULL AND s.tracked_link_id IS NOT NULL
             AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
             AND CASE WHEN v_mode = 'event' THEN s.event_id = v_eid
                      WHEN v_mode = 'hour' THEN s.sent_at >= v_start AND s.sent_at < v_end
                      ELSE public._crm_night_date(s.sent_at, v_tz, v_eh) BETWEEN v_from AND v_to END
        ) q)),
    'click_no_buy', (SELECT count(*) FROM cnb),
    -- (alias gd / gh : `cur` porte une colonne `d`, qui masquerait la boucle)
    'heat', (SELECT jsonb_agg((SELECT jsonb_agg((SELECT count(*) FROM cur h WHERE h.dow = gd.v AND h.hr = gh.v) ORDER BY gh.v)
                                 FROM generate_series(0, 23) gh(v)) ORDER BY gd.v)
               FROM generate_series(0, 6) gd(v)),
    'hours', (SELECT jsonb_agg((SELECT count(*) FROM cur h WHERE h.hr = gh.v) ORDER BY gh.v) FROM generate_series(0, 23) gh(v)),
    'devices', (SELECT jsonb_build_object(
                  'mobile', count(*) FILTER (WHERE device = 'mobile'),
                  'desktop', count(*) FILTER (WHERE device = 'desktop'),
                  'tablet', count(*) FILTER (WHERE device = 'tablet'),
                  'known', count(*) FILTER (WHERE device IS NOT NULL)) FROM cur WHERE kind = 'l'),
    'countries', (SELECT COALESCE(jsonb_agg(jsonb_build_object('cc', x.cc, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                    FROM (SELECT country AS cc, count(*) AS n FROM cur WHERE kind = 'l' AND country IS NOT NULL
                           GROUP BY country ORDER BY count(*) DESC) x),
    'platform', jsonb_build_object(
      'all', (SELECT jsonb_build_object('app', count(DISTINCT ord) FILTER (WHERE med = 'app'),
                                        'website', count(DISTINCT ord) FILTER (WHERE med = 'website'),
                                        'other', count(DISTINCT ord) FILTER (WHERE med NOT IN ('app', 'website')))
                FROM tk WHERE is_cur),
      'yuno', (SELECT jsonb_build_object('app', count(DISTINCT ord) FILTER (WHERE med = 'app'),
                                         'website', count(DISTINCT ord) FILTER (WHERE med = 'website'),
                                         'other', count(DISTINCT ord) FILTER (WHERE med NOT IN ('app', 'website')))
                 FROM ytk WHERE is_cur)),
    'nights', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', n.id, 'title', n.title, 'start_at', n.start_at, 'night', n.night, 'upcoming', n.upcoming,
                  'state', CASE WHEN n.night = v_today THEN 'tonight' WHEN n.upcoming THEN 'presale' ELSE 'past' END,
                  'clicks', n.clicks, 'people', n.people, 'links', n.links, 'signups', n.signups, 'orders', n.orders)
                ORDER BY n.clicks DESC), '[]'::jsonb)
                 FROM (SELECT * FROM nights WHERE v_mode <> 'event' AND (clicks > 0 OR signups > 0)
                        ORDER BY clicks DESC LIMIT 8) n),
    -- Shotgun a-t-il déjà rendu un billet portant un lien Yuno ? Tant que non,
    -- l'écran dit « en attente », jamais 0 (règle de crm_night_links).
    'confirmed', EXISTS (SELECT 1 FROM public.external_tickets t
                          WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
                              OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
                            AND lower(t.utm->>'utm_source') LIKE 'yuno-%'
                            AND lower(t.utm->>'utm_source') !~ '^yuno-[msd]-'),
    'has_any', EXISTS (SELECT 1 FROM lk) OR EXISTS (SELECT 1 FROM cp) OR EXISTS (SELECT 1 FROM pg)
  ) INTO v_out;

  -- « À retenir » : des constats calculés ici, avec leurs seuils, jamais un conseil.
  v_out := v_out || jsonb_build_object('keep', public._crm_ana_clicks_keep(v_out));
  RETURN v_out;
END;
$function$;

-- Constats descriptifs (0 à 3), textes `yc.tr.tk.<k>` côté écran.
CREATE OR REPLACE FUNCTION public._crm_ana_clicks_keep(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_tot numeric := COALESCE((p->'totals'->>'clicks')::numeric, 0);
  v_top record; v_em record; v_lk record; v_pa jsonb;
  v_ig_known numeric := COALESCE((p->'totals'->>'ig_known')::numeric, 0);
  v_ig_in numeric := COALESCE((p->'totals'->>'ig_in')::numeric, 0);
  v_pd int; v_ph int; v_pmax numeric := 0; v_heat jsonb := p->'heat';
  d int; h int; v numeric;
BEGIN
  -- 1. L'emplacement qui fait le plus de clics (dès 30 clics).
  IF v_tot >= 30 THEN
    SELECT f->>'k' AS k, (f->>'clicks')::numeric AS c INTO v_top
      FROM jsonb_array_elements(p->'families') f ORDER BY (f->>'clicks')::numeric DESC LIMIT 1;
    IF v_top.c > 0 THEN
      v_out := v_out || jsonb_build_object('k', 'top', 'fam', v_top.k, 'pct', round(100 * v_top.c / v_tot));
    END IF;
  END IF;
  -- 2. E-mails contre liens : passage à l'achat, chacun sur 30 personnes au moins.
  SELECT (f->>'people')::numeric AS pe, (f->>'orders')::numeric AS o INTO v_em
    FROM jsonb_array_elements(p->'families') f WHERE f->>'k' = 'em';
  SELECT sum((f->>'people')::numeric) AS pe, sum((f->>'orders')::numeric) AS o INTO v_lk
    FROM jsonb_array_elements(p->'families') f WHERE f->>'k' <> 'em';
  IF COALESCE(v_em.pe, 0) >= 30 AND COALESCE(v_lk.pe, 0) >= 30 AND COALESCE(v_lk.o, 0) > 0 AND COALESCE(v_em.o, 0) > 0
     AND COALESCE((p->>'confirmed')::boolean, false) THEN
    v_out := v_out || jsonb_build_object('k', 'emailConv',
      'em', round(100 * LEAST(v_em.o, v_em.pe) / v_em.pe, 1), 'links', round(100 * LEAST(v_lk.o, v_lk.pe) / v_lk.pe, 1));
  END IF;
  -- 3. Le lien partenaire qui amène le plus de monde (dès 10 personnes).
  SELECT l INTO v_pa FROM jsonb_array_elements(p->'links') l
   WHERE l->>'fam' = 'pa' AND (l->>'people')::int >= 10 ORDER BY (l->>'people')::int DESC LIMIT 1;
  IF v_pa IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('k', 'partner', 'name', v_pa->>'label', 'people', (v_pa->>'people')::int,
                                         'orders', (v_pa->>'orders')::int);
  END IF;
  -- 4. Ouvert dans Instagram (dès 30 clics de liens Instagram au user-agent connu).
  IF v_ig_known >= 30 THEN
    v_out := v_out || jsonb_build_object('k', 'inApp', 'pct', round(100 * v_ig_in / v_ig_known));
  END IF;
  -- 5. Le créneau le plus chargé (dès 50 clics).
  IF v_tot >= 50 AND v_heat IS NOT NULL THEN
    FOR d IN 0..6 LOOP
      FOR h IN 0..23 LOOP
        v := COALESCE((v_heat->d->>h)::numeric, 0);
        IF v > v_pmax THEN v_pmax := v; v_pd := d; v_ph := h; END IF;
      END LOOP;
    END LOOP;
    IF v_pmax > 0 THEN v_out := v_out || jsonb_build_object('k', 'peak', 'dow', v_pd, 'hour', v_ph); END IF;
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_out) x LIMIT 3) q);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_ana_clicks_keep(jsonb) FROM PUBLIC, anon, authenticated;

-- Le CA du pont (`totals.revenue`) suit la règle d'argent des Analyses.
CREATE OR REPLACE FUNCTION public.crm_ana_clicks(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d',
  p_event uuid DEFAULT NULL, p_compare uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_ana_clicks__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_compare),
                                p_venue_id, p_organizer_user_id);
$$;

REVOKE ALL ON FUNCTION public.crm_ana_clicks__core(text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_clicks__core(text, uuid, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.crm_ana_clicks(text, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ana_clicks(text, uuid, text, uuid, uuid) TO authenticated, service_role;
