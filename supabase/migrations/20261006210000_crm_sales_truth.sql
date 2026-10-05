-- ============================================================================
-- Yuno CRM — des chiffres de vente qui ne disent que ce que Shotgun rapporte.
-- Audit du 2026-10-05 (docs/designs/SHOTGUN_API_REFERENCE.md).
--
-- 1. Une VENTE = un billet `valid` hors invitation (`_crm_ticket_is_sale`,
--    migration 20261006200000). Un billet revendu (`resold` → notre
--    `transferred`) était compté en plus du billet de son acheteur : la place
--    et le chiffre d'affaires étaient doublés. Les invitations
--    (`deal_channel = 'invitation'`) ne sont jamais des ventes. Shotgun
--    applique la même règle dans son Smartboard. Le registre des PERSONNES
--    (base, automatisations, « a acheté ») ne change pas.
-- 2. La source d'une vente suit ce que l'API Tickets rend vraiment :
--    `utm_source` seulement (`utm_medium` y vaut website / app / widget,
--    `utm_campaign` n'est pas rendu). Familles :
--      yl  lien de partage Yuno      yuno-<code>
--      em  e-mail Yuno               yuno-m-…  (et `yuno` seul, d'avant)
--      sm  SMS Yuno                  yuno-s-…
--      dm  réponse Instagram Yuno    yuno-d-…
--      so  réseau social vu par Shotgun (instagram, tiktok…)
--      sg  app et site Shotgun       shotgun
--      au  autre site                toute autre origine
--      di  accès direct              direct
--      of  hors ligne / importé      pas de source
--    « Partenaires » disparaît : rien dans l'API ne le distingue.
-- 3. Trafic : « achats » = commandes distinctes (un billet ≠ une commande).
-- 4. Fiche client « Arrivé par » : toute source Yuno (lien, e-mail, SMS), pas
--    seulement `yuno` exact.
-- Chaque fonction est réécrite depuis sa définition EN BASE (pg_get_functiondef
-- du 05/10), seules les lignes citées changent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._crm_ticket_source(p_utm jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN s = '' THEN 'of'
    WHEN s = 'yuno' OR s LIKE 'yuno-m-%' THEN 'em'
    WHEN s LIKE 'yuno-s-%' THEN 'sm'
    WHEN s LIKE 'yuno-d-%' THEN 'dm'
    WHEN s LIKE 'yuno-%' THEN 'yl'
    WHEN s = 'shotgun' THEN 'sg'
    WHEN s = 'direct' THEN 'di'
    WHEN s IN ('instagram', 'ig', 'facebook', 'fb', 'tiktok', 'snapchat', 'twitter', 'x', 'threads', 'linkedin', 'youtube', 'pinterest', 'messenger') THEN 'so'
    ELSE 'au' END
  FROM (SELECT lower(btrim(COALESCE(CASE WHEN jsonb_typeof(p_utm) = 'object' THEN p_utm->>'utm_source' END, ''))) AS s) x;
$$;

-- ── _crm_tickets ──
CREATE OR REPLACE FUNCTION public._crm_tickets(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(id uuid, email text, qty integer, amount numeric, bought_at timestamp with time zone, event_id uuid, event_start timestamp with time zone, scanned_at timestamp with time zone, deal_name text, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, lower(t.buyer_email), GREATEST(t.quantity, 1),
         COALESCE(t.price, 0) * GREATEST(t.quantity, 1),
         COALESCE(t.purchased_at, t.first_seen_at),
         t.event_id, e.start_at, t.scanned_at, t.deal_name, t.price
    FROM public.external_tickets t
    LEFT JOIN public.events e ON e.id = t.event_id
   WHERE public._crm_ticket_is_sale(t.status, t.raw)
     AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id));
$function$
;


-- ── _crm_night_tiers ──
CREATE OR REPLACE FUNCTION public._crm_night_tiers(p_event_id uuid, p_deals jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT ord, NULLIF(btrim(x->>'name'), '') AS name, NULLIF(x->>'id', '') AS did,
           CASE WHEN x->>'price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x->>'price')::numeric END AS price,
           CASE WHEN x->>'quantity' ~ '^[0-9]+$' THEN (x->>'quantity')::integer END AS q
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_deals) = 'array' THEN p_deals ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(x, ord)
  ), tk AS (
    SELECT t.deal_id, lower(btrim(t.deal_name)) AS dn, max(t.price) AS price, sum(GREATEST(t.quantity, 1)) AS sold
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw)
     GROUP BY 1, 2
  ), matched AS (
    SELECT d.ord, d.name, d.price, d.q,
           COALESCE((SELECT sum(tk.sold) FROM tk
                      WHERE (d.did IS NOT NULL AND tk.deal_id = d.did)
                         OR (tk.dn = lower(d.name) AND (d.did IS NULL OR tk.deal_id IS DISTINCT FROM d.did))), 0) AS sold
      FROM d WHERE d.name IS NOT NULL
  ), orphans AS (
    SELECT 1000 + row_number() OVER (ORDER BY tk.price) AS ord, initcap(tk.dn) AS name, tk.price, NULL::integer AS q, tk.sold
      FROM tk
     WHERE tk.dn IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM d WHERE (d.did IS NOT NULL AND d.did = tk.deal_id) OR lower(d.name) = tk.dn)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', u.name, 'price', u.price, 'cap', u.q, 'sold', u.sold) ORDER BY u.ord), '[]'::jsonb)
    FROM (SELECT * FROM matched UNION ALL SELECT * FROM orphans) u;
$function$
;


-- ── crm_night_detail__core ──
CREATE OR REPLACE FUNCTION public.crm_night_detail__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record;
  x record;
  p record;
  v_tz text;
  v_day date;
  v_upcoming boolean;
  v_d_end integer;
  v_d_start integer;
  v_series text;
  v_curve jsonb;
  v_prev jsonb;
  v_buyers jsonb;
  v_msgs jsonb;
  v_avg numeric;
  v_sold bigint;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT ev.* INTO e FROM public.events ev
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO x FROM public.external_events WHERE event_id = p_event_id LIMIT 1;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_day := (e.start_at AT TIME ZONE v_tz)::date;
  v_upcoming := COALESCE(e.end_at, e.start_at + interval '6 hours') > now();
  v_d_end := CASE WHEN v_upcoming THEN GREATEST(0, v_day - (now() AT TIME ZONE v_tz)::date) ELSE 0 END;
  v_series := lower(COALESCE(public._crm_night_series(e.title), e.title));

  -- Billets de la soirée, avec leur « jour avant la soirée ».
  DROP TABLE IF EXISTS _cnt;
  CREATE TEMP TABLE _cnt ON COMMIT DROP AS
    SELECT lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
           GREATEST(0, v_day - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date) AS d
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw);
  SELECT COALESCE(sum(qty), 0) INTO v_sold FROM _cnt;

  -- Début de la courbe : l'ouverture des ventes, sinon le premier achat (120 j max).
  v_d_start := LEAST(120, GREATEST(v_d_end,
                 COALESCE(CASE WHEN x.launched_at IS NOT NULL AND x.launched_at <= now()
                               THEN v_day - (x.launched_at AT TIME ZONE v_tz)::date END,
                          (SELECT max(d) FROM _cnt), v_d_end)));

  -- La fois d'avant : même série, sinon la soirée passée précédente, avec des ventes.
  SELECT ev.id, ev.title, ev.start_at, COALESCE(NULLIF(ev.timezone, ''), 'Europe/Paris') AS tz INTO p
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> p_event_id
     AND ev.start_at < e.start_at
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') <= now()
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = ev.id AND public._crm_ticket_is_sale(t.status, t.raw))
   ORDER BY (lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series) DESC, ev.start_at DESC
   LIMIT 1;

  DROP TABLE IF EXISTS _cnp;
  CREATE TEMP TABLE _cnp ON COMMIT DROP AS
    SELECT GREATEST(t.quantity, 1) AS qty,
           GREATEST(0, (p.start_at AT TIME ZONE p.tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE p.tz)::date) AS d
      FROM public.external_tickets t
     WHERE p.id IS NOT NULL AND t.event_id = p.id AND public._crm_ticket_is_sale(t.status, t.raw);

  SELECT jsonb_agg(jsonb_build_object(
           'd', g.d,
           'v', (SELECT COALESCE(sum(qty), 0) FROM _cnt WHERE _cnt.d >= g.d),
           'pv', CASE WHEN p.id IS NOT NULL THEN (SELECT COALESCE(sum(qty), 0) FROM _cnp WHERE _cnp.d >= g.d) END
         ) ORDER BY g.d DESC)
    INTO v_curve
    FROM generate_series(v_d_end, v_d_start) AS g(d);

  IF p.id IS NOT NULL THEN
    v_prev := jsonb_build_object('id', p.id, 'title', p.title, 'start_at', p.start_at,
      'same_series', lower(COALESCE(public._crm_night_series(p.title), p.title)) = v_series,
      'total', (SELECT COALESCE(sum(qty), 0) FROM _cnp));
  END IF;

  -- Acheteurs : soirées de la portée AVANT celle-ci.
  WITH b AS (SELECT DISTINCT email FROM _cnt WHERE email IS NOT NULL),
  hist AS (
    SELECT b.email, count(DISTINCT t.event_id) FILTER (WHERE t.event_start < e.start_at) AS prior
      FROM b LEFT JOIN public._crm_tickets(p_venue_id, p_organizer_user_id) t ON t.email = b.email
     GROUP BY b.email
  )
  SELECT jsonb_build_object('total', count(*),
           'new', count(*) FILTER (WHERE prior = 0),
           'occasional', count(*) FILTER (WHERE prior BETWEEN 1 AND 2),
           'regular', count(*) FILTER (WHERE prior >= 3))
    INTO v_buyers FROM hist;

  -- Remplissage moyen de la série : les AUTRES soirées passées à capacité
  -- connue, au moins deux (sinon la soirée se comparerait à elle-même).
  SELECT CASE WHEN count(*) >= 2 AND sum(cap) > 0 THEN round(sum(sold)::numeric / sum(cap), 4) END INTO v_avg
    FROM (
      SELECT public._crm_night_capacity(xx.left_tickets, xx.deals, s.sold) AS cap, s.sold
        FROM public.events ev
        JOIN public.external_events xx ON xx.event_id = ev.id
        CROSS JOIN LATERAL (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) AS sold FROM public.external_tickets t
                             WHERE t.event_id = ev.id AND public._crm_ticket_is_sale(t.status, t.raw)) s
       WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> p_event_id
         AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') <= now()
         AND lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series
         AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
    ) z WHERE z.cap IS NOT NULL;

  -- Messages, avec le taux d'ouverture des e-mails partis.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'channel', m.channel, 'name', m.name, 'state', m.state, 'at', m.at,
           'open_pct', CASE WHEN m.channel = 'email' AND m.state = 'sent' THEN (
               SELECT CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE EXISTS (
                        SELECT 1 FROM public.email_campaign_events ce
                         WHERE ce.campaign_id = r.campaign_id AND ce.event_type = 'opened'
                           AND lower(ce.recipient_email) = lower(r.email))) / count(*)) END
                 FROM public.email_campaign_recipients r
                WHERE r.campaign_id = m.id AND r.status IN ('sent', 'complained')) END
         ) ORDER BY CASE m.state WHEN 'draft' THEN 0 WHEN 'plan' THEN 1 ELSE 2 END, m.at DESC), '[]'::jsonb)
    INTO v_msgs
    FROM public._crm_night_msgs(p_venue_id, p_organizer_user_id, ARRAY[p_event_id]) m;

  RETURN jsonb_build_object(
    'id', e.id, 'title', e.title, 'series', COALESCE(public._crm_night_series(e.title), e.title),
    'start_at', e.start_at, 'end_at', COALESCE(e.end_at, e.start_at + interval '6 hours'), 'tz', v_tz,
    'upcoming', v_upcoming, 'url', e.external_ticket_url,
    'street', COALESCE(x.street, e.location_address), 'zip', x.zip_code, 'city', COALESCE(x.city, e.location_city),
    'lineup', COALESCE((SELECT jsonb_agg(a->>'name') FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(x.artists) = 'array' THEN x.artists ELSE '[]'::jsonb END) a
                 WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL), '[]'::jsonb),
    'sale_opens_at', CASE WHEN x.launched_at > now() THEN x.launched_at END,
    'opened_at', CASE WHEN x.launched_at <= now() THEN x.launched_at END,
    'sold', v_sold, 'cap', public._crm_night_capacity(x.left_tickets, x.deals, v_sold),
    'sold_out', COALESCE(e.tickets_sold_out, false) OR COALESCE(x.left_tickets = 0, false),
    'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0)
                  FROM public.external_tickets t WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw)),
    'today', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
               WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw)
                 AND (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date),
    'series_avg_fill', v_avg,
    'tiers', public._crm_night_tiers(p_event_id, x.deals),
    'curve', COALESCE(v_curve, '[]'::jsonb), 'prev', v_prev,
    'buyers', v_buyers, 'msgs', v_msgs,
    'synced_at', x.synced_at
  );
END;
$function$
;


-- ── _crm_ana_setup ──
CREATE OR REPLACE FUNCTION public._crm_ana_setup(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid, p_seg text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_rules record;
  v_eh integer;
  v_now timestamptz := now();
  v_today date;
  v_mode text;
  v_n integer;
  v_start timestamptz; v_end timestamptz;
  v_d0 date; v_m0 date;
  v_ev_id uuid; v_ev_title text; v_ev_start timestamptz; v_ev_night date; v_ev_upcoming boolean; v_ev_series text;
  v_pev_id uuid; v_pev_title text; v_pev_start timestamptz; v_pev_night date;
  v_seg text := CASE WHEN p_seg IN ('hab', 'occ', 'nou', 'end', 'none') THEN p_seg ELSE 'all' END;
  v_labels jsonb;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  v_eh := v_rules.night_end_hour;
  v_today := public._crm_night_date(v_now, v_tz, v_eh);

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _aev;
  CREATE TEMP TABLE _aev ON COMMIT DROP AS
  SELECT e.id, e.title, COALESCE(public._crm_night_series(e.title), e.title) AS series, e.start_at,
         COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now AS upcoming,
         public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), v_tz), v_eh) AS night,
         x.left_tickets, x.deals
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  IF p_event IS NOT NULL THEN
    SELECT id, title, start_at, night, upcoming, series
      INTO v_ev_id, v_ev_title, v_ev_start, v_ev_night, v_ev_upcoming, v_ev_series
      FROM _aev WHERE id = p_event;
    IF v_ev_id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;
    SELECT id, title, start_at, night INTO v_pev_id, v_pev_title, v_pev_start, v_pev_night
      FROM _aev
     WHERE start_at < v_ev_start AND id <> v_ev_id
     ORDER BY (series = v_ev_series) DESC, start_at DESC LIMIT 1;
    v_mode := 'event'; v_n := 22;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_end := date_trunc('hour', v_now) + interval '1 hour';
    v_start := v_end - make_interval(hours => v_n);
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
  END IF;

  DROP TABLE IF EXISTS _atk_all;
  CREATE TEMP TABLE _atk_all ON COMMIT DROP AS
  SELECT q.*,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start AND q.bought_at < v_end
                                 THEN floor(extract(epoch FROM q.bought_at - v_start) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 AND v_today THEN q.nd - v_d0 END
           WHEN 'month' THEN CASE WHEN q.nd >= v_m0 AND q.nd <= v_today
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0)) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0))::int END
           ELSE CASE WHEN q.event_id = v_ev_id THEN 21 - LEAST(21, GREATEST(0, v_ev_night - q.nd)) END
         END AS ci,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start - make_interval(hours => v_n) AND q.bought_at < v_start
                                 THEN floor(extract(epoch FROM q.bought_at - (v_start - make_interval(hours => v_n))) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 - v_n AND v_d0 - 1 THEN q.nd - (v_d0 - v_n) END
           WHEN 'month' THEN CASE WHEN q.nd >= (v_m0 - interval '12 months')::date AND q.nd < v_m0
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0 - interval '12 months')) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0 - interval '12 months'))::int END
           ELSE CASE WHEN q.event_id = v_pev_id THEN 21 - LEAST(21, GREATEST(0, v_pev_night - q.nd)) END
         END AS pi
    FROM (
      SELECT t.id, lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
             COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
             public._crm_ticket_is_sale(t.status, t.raw) AS ok, t.status = 'refunded' AS refunded,
             COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.event_id,
             NULLIF(btrim(t.deal_name), '') AS deal, COALESCE(t.external_order_id, t.id::text) AS ord, t.price, public._crm_ticket_source(t.utm) AS src,
             t.scanned_at, t.age, NULLIF(btrim(t.city), '') AS city,
             public._crm_night_date(COALESCE(t.purchased_at, t.first_seen_at), v_tz, v_eh) AS nd,
             extract(hour FROM COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::int AS hr
        FROM public.external_tickets t
       WHERE t.status IN ('valid', 'transferred', 'refunded')
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
    ) q;
  CREATE INDEX ON _atk_all (event_id);
  CREATE INDEX ON _atk_all (email);

  DROP TABLE IF EXISTS _atk;
  IF v_seg = 'all' THEN
    CREATE TEMP TABLE _atk ON COMMIT DROP AS SELECT * FROM _atk_all;
  ELSE
    CREATE TEMP TABLE _atk ON COMMIT DROP AS
    SELECT a.* FROM _atk_all a JOIN _cp p ON p.email = a.email AND p.lifecycle = v_seg;
  END IF;

  -- Libellés des cases : l'instant de début (heures), la date (jours, mois),
  -- J-k et la date de la nuit (soirée).
  SELECT jsonb_agg(CASE v_mode
           WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
           WHEN 'day' THEN to_jsonb(v_d0 + g)
           WHEN 'month' THEN to_jsonb((v_m0 + make_interval(months => g))::date)
           ELSE to_jsonb(v_ev_night - (21 - g)) END ORDER BY g)
    INTO v_labels FROM generate_series(0, v_n - 1) g;

  RETURN jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', v_seg, 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - 21) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night, 'upcoming', v_ev_upcoming,
        'days_left', GREATEST(0, v_ev_night - v_today)) END,
    'prev_event', CASE WHEN v_pev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_pev_id, 'title', v_pev_title, 'start_at', v_pev_start, 'night', v_pev_night) END
  );
END;
$function$
;


-- ── crm_ana_traffic__core ──
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
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE((SELECT count(*) FROM _aclk c WHERE c.ci = g), 0),
           'new_buyers', COALESCE((SELECT count(*) FROM _afirst f WHERE f.ci = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', (SELECT count(DISTINCT a.ord) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'buyers', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'new_buyers', (SELECT count(*) FROM _afirst f WHERE f.ci IS NOT NULL AND f.src = s.k),
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.src = s.k), 0)
         )), '[]'::jsonb)
    INTO v_sources FROM unnest(ARRAY['yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k);

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
  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE public._crm_ana_bucket(m, j.at) IS NOT NULL),
           'series', (SELECT jsonb_agg((SELECT count(*) FROM (
                         SELECT LEAST(f.bought_at, COALESCE(c.added_at, c.created_at)) AS at
                           FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
                          WHERE c.email IS NOT NULL) z
                        WHERE public._crm_ana_bucket(m, z.at) = g) ORDER BY g)
                       FROM generate_series(0, v_n - 1) g))
    INTO v_gained
    FROM (SELECT LEAST(f.bought_at, COALESCE(c.added_at, c.created_at)) AS at
            FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
           WHERE c.email IS NOT NULL) j;

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

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$
;


-- ── _crm_people_build ──
CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_rules record;
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tonight uuid;
  v_n integer;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id) x
     WHERE x.bought_at <= v_at;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public.events e
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND (e.is_active OR e.external_source IS NOT NULL)
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_at
     AND (e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
         <= (v_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
   ORDER BY e.start_at LIMIT 1;

  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH agg AS (
    SELECT t.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start <= v_at) AS nights,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start <= v_at
                 AND t.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(t.event_start) FILTER (WHERE t.event_start <= v_at) AS first_night,
           max(t.event_start) FILTER (WHERE t.event_start <= v_at) AS last_night,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), first_utm AS (
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at)
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         COALESCE(a.nights, 0)::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         a.first_night, a.last_night, round(COALESCE(a.spent, 0), 2) AS spent,
         COALESCE(a.events, '{}'::uuid[]) AS events, COALESCE(a.tonight, false) AS tonight,
         CASE WHEN COALESCE(a.nights, 0) > 0 AND lower(u.utm_source) LIKE 'yuno%' THEN 'utm'
              WHEN COALESCE(a.nights, 0) > 0 THEN 'shotgun'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         u.utm_source, u.utm_medium,
         CASE
           WHEN COALESCE(a.nights, 0) = 0 THEN 'none'
           WHEN a.last_night < v_at - make_interval(months => v_rules.lapse_months) THEN 'end'
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN a.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN public.crm_contact_notes n ON n.scope_key = v_scope AND n.email = b.email;

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
       AND ec.sent_at <= v_at AND ec.sent_at > v_at - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), r AS (
    SELECT lower(x.email) AS em, count(*) AS n
      FROM public.email_campaign_recipients x JOIN c ON c.id = x.campaign_id
     WHERE x.status IN ('sent', 'complained')
     GROUP BY 1
  ), k AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id) AS n, max(ev.created_at) AS last
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.created_at <= v_at AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cp p
     SET msg_n = COALESCE(r.n, 0), click_n = COALESCE(k.n, 0), last_click = k.last
    FROM (SELECT DISTINCT em FROM (SELECT em FROM r UNION SELECT em FROM k) u) e
    LEFT JOIN r ON r.em = e.em
    LEFT JOIN k ON k.em = e.em
   WHERE p.email = e.em;
  UPDATE _cp p
     SET click_nobuy = true
   WHERE p.last_click > v_at - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM _cpt t
                      WHERE t.email = p.email AND t.bought_at > p.last_click
                        AND t.bought_at <= LEAST(p.last_click + interval '7 days', v_at));

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$
;

