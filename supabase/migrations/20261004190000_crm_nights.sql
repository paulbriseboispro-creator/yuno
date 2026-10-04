-- ============================================================================
-- Console Yuno CRM — écran Soirées (maquette « Soirees.dc.html »).
--
-- Une soirée de la Console CRM est une soirée MIROIR de la billetterie
-- connectée (events.external_source, créée par ticketing_after_sync) : on lit
-- ses billets dans external_tickets et sa fiche dans external_events.
--
--   crm_nights(portée)                 les deux onglets en un appel : soirées à
--                                      venir (tarifs, messages) et passées
--                                      (25 mois, pour comparer deux périodes)
--   crm_night_detail(portée, soirée)   le tiroir : courbe des ventes jour par
--                                      jour comparée à la soirée d'avant de la
--                                      même série, tarifs, acheteurs, messages
--
-- Règles de lecture (une seule définition, ici) :
--   • Vendu = billets valides ou transférés (quantité), CA = prix × quantité
--     de ces billets : un remboursé n'est ni vendu ni compté.
--   • Capacité = vendu + places restantes annoncées par Shotgun
--     (leftTicketsCount) ; sinon somme des stocks de tarifs si chaque tarif a
--     le sien ; sinon inconnue (NULL) — l'écran n'invente jamais une jauge.
--   • État d'une soirée à venir : 'soon' (ventes pas ouvertes, launched_at
--     futur), 'full' (plus aucune place), 'almost' (≥ 80 %), 'sale'.
--   • Série = le titre sans son numéro ni sa date (« Warehouse Session #22 »
--     → « Warehouse Session ») : c'est elle qui choisit « la fois d'avant ».
--   • Nouveau / occasionnel / habitué = 0 / 1-2 / 3+ soirées de la portée
--     AVANT celle-ci.
--   • Messages d'une soirée = campagnes e-mail et SMS manuelles reliées à la
--     soirée (event_id) : brouillon, planifiée, envoyée.
-- ============================================================================

-- La série d'une soirée : le titre sans « #22 », « Vol. 3 », « 12/10 »…
CREATE OR REPLACE FUNCTION public._crm_night_series(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(p_name, ''),
               '\s*[-–—:|·,]?\s*\(?\d{1,2}[./]\d{1,2}([./]\d{2,4})?\)?\s*$', ''),
             '\s*[-–—:|·,]?\s*([#№]\s*\d+|(vol|n°|no|ep|episode|chapitre|chapter|part|partie|edition|édition)\.?\s*\d+)\s*$', '', 'i'),
           '\s+', ' ', 'g')), '');
$$;

-- Capacité d'une soirée (voir l'en-tête). p_sold = billets valides.
CREATE OR REPLACE FUNCTION public._crm_night_capacity(p_left integer, p_deals jsonb, p_sold bigint)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_left IS NOT NULL AND p_left >= 0 THEN (COALESCE(p_sold, 0) + p_left)::integer
    ELSE (SELECT CASE WHEN count(*) > 0 AND count(*) = count(*) FILTER (WHERE d->>'quantity' ~ '^[0-9]+$')
                      THEN sum((d->>'quantity')::integer)::integer END
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_deals) = 'array' THEN p_deals ELSE '[]'::jsonb END) d)
  END;
$$;

-- Messages manuels reliés à des soirées (e-mail + SMS) de la portée.
CREATE OR REPLACE FUNCTION public._crm_night_msgs(p_venue_id text, p_organizer_user_id uuid, p_events uuid[])
RETURNS TABLE (event_id uuid, id uuid, channel text, name text, state text, at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.event_id, c.id, 'email'::text, COALESCE(NULLIF(btrim(c.name), ''), c.subject),
         CASE WHEN c.status = 'draft' THEN 'draft' WHEN c.status = 'scheduled' THEN 'plan' ELSE 'sent' END,
         CASE WHEN c.status = 'draft' THEN c.updated_at WHEN c.status = 'scheduled' THEN c.scheduled_at
              ELSE COALESCE(c.sent_at, c.send_started_at, c.updated_at) END
    FROM public.email_campaigns c
   WHERE c.event_id = ANY (p_events)
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused')
  UNION ALL
  SELECT s.event_id, s.id, 'sms', s.name,
         CASE WHEN s.status = 'draft' THEN 'draft' WHEN s.status = 'scheduled' THEN 'plan' ELSE 'sent' END,
         CASE WHEN s.status = 'draft' THEN s.updated_at WHEN s.status = 'scheduled' THEN s.scheduled_at
              ELSE COALESCE(s.sent_at, s.send_started_at, s.updated_at) END
    FROM public.sms_campaigns s
   WHERE s.event_id = ANY (p_events)
     AND s.venue_id IS NOT DISTINCT FROM p_venue_id
     AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND s.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused');
$$;

REVOKE ALL ON FUNCTION public._crm_night_msgs(text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_night_msgs(text, uuid, uuid[]) TO service_role;

-- Tarifs d'une soirée, dans l'ordre de Shotgun : nom, prix, stock (NULL si
-- Shotgun n'en donne pas), vendus. Un billet dont le tarif a disparu de la
-- fiche garde sa ligne à la fin.
CREATE OR REPLACE FUNCTION public._crm_night_tiers(p_event_id uuid, p_deals jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    SELECT ord, NULLIF(btrim(x->>'name'), '') AS name, NULLIF(x->>'id', '') AS did,
           CASE WHEN x->>'price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x->>'price')::numeric END AS price,
           CASE WHEN x->>'quantity' ~ '^[0-9]+$' THEN (x->>'quantity')::integer END AS q
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_deals) = 'array' THEN p_deals ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(x, ord)
  ), tk AS (
    SELECT t.deal_id, lower(btrim(t.deal_name)) AS dn, max(t.price) AS price, sum(GREATEST(t.quantity, 1)) AS sold
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred')
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
$$;

REVOKE ALL ON FUNCTION public._crm_night_tiers(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_night_tiers(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_nights(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_past_total integer;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_ids uuid[];
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_past_total
    FROM public.events e
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND COALESCE(e.end_at, e.start_at + interval '6 hours') <= now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  SELECT array_agg(e.id) INTO v_ids
    FROM public.events e
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND COALESCE(e.end_at, e.start_at + interval '6 hours') > now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  WITH tix AS MATERIALIZED (
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id)
  ), firsts AS (
    SELECT DISTINCT ON (t.email) t.email, t.event_id
      FROM tix t WHERE t.event_id IS NOT NULL AND t.email IS NOT NULL
     ORDER BY t.email, t.event_start, t.bought_at
  ), nw AS (
    SELECT f.event_id, count(*) AS n FROM firsts f GROUP BY 1
  ), st AS (
    SELECT t.event_id,
           sum(t.qty) AS sold,
           round(sum(t.amount), 2) AS revenue,
           count(DISTINCT t.email) AS buyers,
           COALESCE(sum(t.qty) FILTER (WHERE (t.bought_at AT TIME ZONE 'Europe/Paris')::date = v_today), 0) AS today
      FROM tix t WHERE t.event_id IS NOT NULL GROUP BY 1
  ), ev AS (
    SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '6 hours') AS end_at,
           COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz, e.tickets_sold_out,
           e.external_ticket_url AS url, COALESCE(e.poster_url, e.image_url) AS cover_url,
           COALESCE(x.street, e.location_address) AS street, COALESCE(x.city, e.location_city) AS city,
           x.artists, x.deals, x.left_tickets, x.launched_at,
           COALESCE(st.sold, 0) AS sold, COALESCE(st.revenue, 0) AS revenue, COALESCE(st.buyers, 0) AS buyers,
           COALESCE(st.today, 0) AS today, COALESCE(nw.n, 0) AS new_buyers,
           COALESCE(e.end_at, e.start_at + interval '6 hours') > now() AS upcoming
      FROM public.events e
      LEFT JOIN public.external_events x ON x.event_id = e.id
      LEFT JOIN st ON st.event_id = e.id
      LEFT JOIN nw ON nw.event_id = e.id
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND e.start_at > now() - interval '25 months'
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
  ), msgs AS (
    SELECT m.event_id,
           jsonb_agg(jsonb_build_object('id', m.id, 'channel', m.channel, 'name', m.name, 'state', m.state, 'at', m.at)
                     ORDER BY CASE m.state WHEN 'draft' THEN 0 WHEN 'plan' THEN 1 ELSE 2 END, m.at DESC) AS list
      FROM public._crm_night_msgs(p_venue_id, p_organizer_user_id, COALESCE(v_ids, '{}')) m
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'title', ev.title, 'series', COALESCE(public._crm_night_series(ev.title), ev.title),
           'start_at', ev.start_at, 'end_at', ev.end_at, 'tz', ev.tz, 'url', ev.url, 'cover_url', ev.cover_url,
           'street', ev.street, 'city', ev.city,
           'lineup', COALESCE((SELECT jsonb_agg(a->>'name') FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(ev.artists) = 'array' THEN ev.artists ELSE '[]'::jsonb END) a
                        WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL), '[]'::jsonb),
           'upcoming', ev.upcoming,
           'sale_opens_at', CASE WHEN ev.launched_at > now() THEN ev.launched_at END,
           'sold', ev.sold, 'cap', public._crm_night_capacity(ev.left_tickets, ev.deals, ev.sold),
           'sold_out', COALESCE(ev.tickets_sold_out, false) OR COALESCE(ev.left_tickets = 0, false),
           'revenue', ev.revenue, 'buyers', ev.buyers, 'new_buyers', ev.new_buyers, 'today', ev.today,
           'tiers', CASE WHEN ev.upcoming THEN public._crm_night_tiers(ev.id, ev.deals) END,
           'msgs', CASE WHEN ev.upcoming THEN COALESCE(msgs.list, '[]'::jsonb) END
         ) ORDER BY ev.start_at), '[]'::jsonb)
    INTO v
    FROM ev LEFT JOIN msgs ON msgs.event_id = ev.id;

  RETURN jsonb_build_object('now', now(), 'past_total', v_past_total, 'nights', v);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_nights(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_nights(text, uuid) TO authenticated, service_role;

-- Le tiroir d'une soirée.
CREATE OR REPLACE FUNCTION public.crm_night_detail(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred');
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
     AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = ev.id AND t.status IN ('valid', 'transferred'))
   ORDER BY (lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series) DESC, ev.start_at DESC
   LIMIT 1;

  DROP TABLE IF EXISTS _cnp;
  CREATE TEMP TABLE _cnp ON COMMIT DROP AS
    SELECT GREATEST(t.quantity, 1) AS qty,
           GREATEST(0, (p.start_at AT TIME ZONE p.tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE p.tz)::date) AS d
      FROM public.external_tickets t
     WHERE p.id IS NOT NULL AND t.event_id = p.id AND t.status IN ('valid', 'transferred');

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
                             WHERE t.event_id = ev.id AND t.status IN ('valid', 'transferred')) s
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
                  FROM public.external_tickets t WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred')),
    'today', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
               WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred')
                 AND (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date),
    'series_avg_fill', v_avg,
    'tiers', public._crm_night_tiers(p_event_id, x.deals),
    'curve', COALESCE(v_curve, '[]'::jsonb), 'prev', v_prev,
    'buyers', v_buyers, 'msgs', v_msgs,
    'synced_at', x.synced_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_night_detail(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_detail(text, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._crm_night_series(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_night_series(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._crm_night_capacity(integer, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_night_capacity(integer, jsonb, bigint) TO authenticated, service_role;
