-- ============================================================================
-- Yuno CRM — écran Analyses (/crm/analytics/sales|traffic|community).
--
-- Une mise en place commune (_crm_ana_setup) puis une lecture par onglet :
--   crm_ana_sales      « Combien ai-je vendu ? »
--   crm_ana_traffic    « D'où vient mon public ? »
--   crm_ana_community  « Qui sont mes clients ? »
-- Mêmes filtres partout : période (24h, 48h, 7d, 30d, 90d, 12m) OU une soirée
-- (de J-21 au jour J, comparée à la soirée précédente), segment de clients
-- (cycle de vie de la liste Clients), comparaison à la période d'avant.
--
-- Règles de lecture :
-- * Une vente = un billet de la billetterie connectée (external_tickets) valide
--   ou transféré, valeur faciale hors frais (comme _crm_tickets) ; un billet
--   remboursé n'est pas une vente, il compte dans « Remboursés ».
-- * La JOURNÉE d'un achat suit la règle de l'espace « À quelle heure une nuit
--   se termine-t-elle ? » (crm_settings.night_end_hour) : un achat à 1 h le
--   samedi compte pour le vendredi. Porte unique : _crm_night_date.
-- * La source d'une vente se lit dans ses UTM (_crm_ticket_source) : e-mail,
--   SMS ou réponse Instagram de Yuno, lien Yuno, réseaux sociaux,
--   partenaires, autres liens suivis, lien direct (sans suivi).
-- * Tout montant porte une clé que _crm_null_money efface (revenue,
--   prev_revenue, amount, spent) : un rôle sans accès au chiffre d'affaires
--   reçoit les volumes, jamais l'argent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._crm_night_date(p_ts timestamptz, p_tz text, p_end_hour integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ((p_ts AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'Europe/Paris')) - make_interval(hours => COALESCE(p_end_hour, 6)))::date;
$$;

CREATE OR REPLACE FUNCTION public._crm_ticket_source(p_utm jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_utm IS NULL OR jsonb_typeof(p_utm) <> 'object'
      OR COALESCE(NULLIF(btrim(p_utm->>'utm_source'), ''), NULLIF(btrim(p_utm->>'utm_medium'), ''),
                  NULLIF(btrim(p_utm->>'utm_campaign'), '')) IS NULL THEN 'di'
    WHEN lower(btrim(p_utm->>'utm_source')) = 'yuno' THEN
      CASE lower(COALESCE(btrim(p_utm->>'utm_medium'), ''))
        WHEN 'email' THEN 'em' WHEN 'sms' THEN 'sm' WHEN 'instagram' THEN 'dm' WHEN 'dm' THEN 'dm'
        ELSE 'yl' END
    WHEN lower(COALESCE(btrim(p_utm->>'utm_medium'), '')) IN ('affiliate', 'partner', 'partners', 'referral', 'promoter', 'rp', 'ambassador') THEN 'pa'
    WHEN lower(COALESCE(btrim(p_utm->>'utm_medium'), '')) IN ('social', 'social-media', 'social_media', 'paid_social', 'paidsocial', 'story', 'bio')
      OR lower(COALESCE(btrim(p_utm->>'utm_source'), '')) IN ('instagram', 'ig', 'facebook', 'fb', 'tiktok', 'snapchat', 'twitter', 'x', 'linkedin', 'threads') THEN 'so'
    ELSE 'au' END;
$$;

-- ── Mise en place commune ──────────────────────────────────────────────────
-- Tables de travail : _cr/_cp (base vivante, cycle de vie), _aev (soirées de
-- l'espace), _atk_all (billets, tous segments), _atk (billets du segment),
-- avec pour chacun ci / pi = case de la courbe courante / précédente (NULL
-- hors fenêtre). Rend la description des cases (mode, n, dates, soirées).
CREATE OR REPLACE FUNCTION public._crm_ana_setup(
  p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid, p_seg text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
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
             t.status IN ('valid', 'transferred') AS ok, t.status = 'refunded' AS refunded,
             COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.event_id,
             NULLIF(btrim(t.deal_name), '') AS deal, t.price, public._crm_ticket_source(t.utm) AS src,
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
$$;
REVOKE ALL ON FUNCTION public._crm_ana_setup(text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_ana_setup(text, uuid, text, uuid, text) TO service_role;

-- Case d'un instant dans la courbe courante (envois de messages).
CREATE OR REPLACE FUNCTION public._crm_ana_bucket(p_meta jsonb, p_ts timestamptz)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_mode text := p_meta->>'mode';
  v_n int := (p_meta->>'n')::int;
  v_nd date := public._crm_night_date(p_ts, p_meta->>'tz', (p_meta->>'night_end_hour')::int);
  v_i int;
BEGIN
  IF v_mode = 'hour' THEN
    v_i := floor(extract(epoch FROM p_ts - (p_meta->>'start')::timestamptz) / 3600)::int;
  ELSIF v_mode = 'day' THEN
    v_i := v_nd - (p_meta->>'start')::date;
  ELSIF v_mode = 'month' THEN
    v_i := ((extract(year FROM v_nd) - extract(year FROM (p_meta->>'start')::date)) * 12
            + extract(month FROM v_nd) - extract(month FROM (p_meta->>'start')::date))::int;
  ELSE
    v_i := 21 - ((p_meta->'event'->>'night')::date - v_nd);
  END IF;
  RETURN CASE WHEN v_i BETWEEN 0 AND v_n - 1 THEN v_i END;
END;
$$;

-- Envois de messages (e-mails et SMS manuels) tombés dans la courbe.
CREATE OR REPLACE FUNCTION public._crm_ana_sends(p_venue_id text, p_organizer_user_id uuid, p_meta jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, c.sent_at), 'at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at IS NOT NULL AND c.status IN ('sent', 'sending')
       AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, c.sent_at) IS NOT NULL
       AND (p_meta->>'mode' <> 'event' OR c.event_id IS NULL OR c.event_id = (p_meta->'event'->>'id')::uuid)
    UNION ALL
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, s.sent_at), 'at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at IS NOT NULL AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
       AND s.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, s.sent_at) IS NOT NULL
  ) q;
$$;
REVOKE ALL ON FUNCTION public._crm_ana_sends(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_ana_sends(text, uuid, jsonb) TO service_role;

-- Courbe cumulée (billets) d'une soirée, de J-21 au jour J ; les achats
-- d'avant J-21 comptent dans J-21. Après aujourd'hui : null.
CREATE OR REPLACE FUNCTION public._crm_ana_curve(p_event uuid, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
      'sold', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.event_id = e.id AND a.ok), 0),
      'cap', public._crm_night_capacity(e.left_tickets, e.deals,
               COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.event_id = e.id AND a.ok), 0)::int),
      'days_left', GREATEST(0, e.night - p_today),
      'curve', (SELECT jsonb_agg(CASE WHEN e.night - k > p_today THEN NULL
                       ELSE COALESCE((SELECT sum(a.qty) FROM _atk_all a
                                       WHERE a.event_id = e.id AND a.ok AND a.nd <= e.night - k), 0) END ORDER BY k DESC)
                  FROM generate_series(0, 21) k))
      FROM _aev e WHERE e.id = p_event);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_ana_curve(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_ana_curve(uuid, date) TO service_role;

-- ── Ventes ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_ana_sales__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL, p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  m jsonb;
  v_n int;
  v_today date;
  v_series jsonb; v_tot jsonb; v_msg jsonb; v_deals jsonb; v_fill jsonb; v_ref jsonb; v_seg_share numeric;
  v_target uuid; v_refs uuid[]; v_goal jsonb;
  v_heat jsonb; v_tariffs jsonb; v_events jsonb; v_other jsonb;
  v_heat_from date; v_heat_to date;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;

  SELECT jsonb_agg(jsonb_build_object(
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk a WHERE a.ok AND a.ci = g), 0),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk a WHERE a.ok AND a.ci = g), 0),
           'prev_revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk a WHERE a.ok AND a.pi = g), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk a WHERE a.ok AND a.pi = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL), 0),
           'buyers', count(DISTINCT email) FILTER (WHERE ok AND ci IS NOT NULL),
           'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi IS NOT NULL), 2), 0),
           'prev_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi IS NOT NULL), 0),
           'has_prev', bool_or(pi IS NOT NULL),
           -- Remboursés : part des billets de la fenêtre rendus (montant brut).
           'refund_pct', CASE WHEN sum(amount) FILTER (WHERE ci IS NOT NULL) > 0
                              THEN round(100 * sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL)
                                         / sum(amount) FILTER (WHERE ci IS NOT NULL), 1) END,
           'prev_refund_pct', CASE WHEN sum(amount) FILTER (WHERE pi IS NOT NULL) > 0
                                   THEN round(100 * sum(amount) FILTER (WHERE refunded AND pi IS NOT NULL)
                                              / sum(amount) FILTER (WHERE pi IS NOT NULL), 1) END,
           'refunds', jsonb_build_object(
               'amount', COALESCE(round(sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL), 2), 0),
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ci IS NOT NULL), 2), 0))
         )
    INTO v_tot FROM _atk;

  -- Ce qui a fait vendre : la part venue d'un message Yuno (UTM).
  SELECT jsonb_build_object(
           'share', CASE WHEN sum(amount) > 0 THEN round(100 * sum(amount) FILTER (WHERE src IN ('em', 'sm', 'dm')) / sum(amount), 1) END,
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE src IN ('em', 'sm', 'dm')), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm', 'dm')), 0),
           'by', jsonb_build_object(
             'em', COALESCE(sum(qty) FILTER (WHERE src = 'em'), 0),
             'sm', COALESCE(sum(qty) FILTER (WHERE src = 'sm'), 0),
             'dm', COALESCE(sum(qty) FILTER (WHERE src = 'dm'), 0)))
    INTO v_msg FROM _atk WHERE ok AND ci IS NOT NULL;

  -- Tarifs de la fenêtre.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal, 'price', d.price, 'tickets', d.tickets, 'revenue', d.revenue)
                            ORDER BY d.tickets DESC), '[]'::jsonb)
    INTO v_tariffs FROM (
      SELECT COALESCE(a.deal, '—') AS deal, round(avg(a.price), 2) AS price, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 8) d;

  -- Remplissage des soirées qui ont vendu dans la fenêtre (et la précédente).
  WITH ev_cur AS (SELECT DISTINCT event_id FROM _atk WHERE ok AND ci IS NOT NULL AND event_id IS NOT NULL),
       ev_prev AS (SELECT DISTINCT event_id FROM _atk WHERE ok AND pi IS NOT NULL AND event_id IS NOT NULL),
       capx AS (
         SELECT e.id, s.sold, public._crm_night_capacity(e.left_tickets, e.deals, s.sold::int) AS cap
           FROM _aev e
           JOIN (SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok GROUP BY 1) s ON s.event_id = e.id)
  SELECT jsonb_build_object(
           'sold', (SELECT sum(c.sold) FROM capx c WHERE c.id IN (SELECT event_id FROM ev_cur) AND c.cap > 0),
           'cap', (SELECT sum(c.cap) FROM capx c WHERE c.id IN (SELECT event_id FROM ev_cur) AND c.cap > 0),
           'prev_sold', (SELECT sum(c.sold) FROM capx c WHERE c.id IN (SELECT event_id FROM ev_prev) AND c.cap > 0),
           'prev_cap', (SELECT sum(c.cap) FROM capx c WHERE c.id IN (SELECT event_id FROM ev_prev) AND c.cap > 0))
    INTO v_fill;

  IF (m->>'seg') <> 'all' THEN
    SELECT CASE WHEN (SELECT sum(amount) FROM _atk_all WHERE ok AND ci IS NOT NULL) > 0
                THEN round(100 * (SELECT sum(amount) FROM _atk WHERE ok AND ci IS NOT NULL)
                           / (SELECT sum(amount) FROM _atk_all WHERE ok AND ci IS NOT NULL), 1) END
      INTO v_seg_share;
  END IF;

  -- Objectif et courbe : la soirée choisie, sinon la prochaine, sinon la dernière.
  v_target := (m->'event'->>'id')::uuid;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  END IF;
  IF v_target IS NULL THEN
    SELECT id INTO v_target FROM _aev ORDER BY start_at DESC LIMIT 1;
  END IF;
  IF v_target IS NOT NULL THEN
    SELECT array_agg(id ORDER BY ord) INTO v_refs FROM (
      SELECT e.id, row_number() OVER (ORDER BY (e.series = t.series) DESC, e.start_at DESC) AS ord
        FROM _aev e, _aev t
       WHERE t.id = v_target AND e.id <> t.id AND NOT e.upcoming AND e.start_at < t.start_at
         AND EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
    ) r WHERE ord <= 2;
    v_goal := jsonb_build_object(
      'target', public._crm_ana_curve(v_target, v_today),
      'refs', COALESCE((SELECT jsonb_agg(public._crm_ana_curve(x, v_today) ORDER BY o) FROM unnest(v_refs) WITH ORDINALITY u(x, o)), '[]'::jsonb),
      'week_sold', COALESCE((SELECT sum(qty) FROM _atk_all WHERE event_id = v_target AND ok AND nd > v_today - 7), 0));
  END IF;

  -- Quand achètent-ils : jour (règle de nuit) × tranche de 2 h, 10 h → 2 h.
  IF m->>'mode' = 'hour' THEN
    v_heat_from := v_today - 29; v_heat_to := v_today;
  END IF;
  WITH h AS (
    SELECT (extract(isodow FROM a.nd)::int - 1) AS r,
           CASE WHEN a.hr >= 10 THEN (a.hr - 10) / 2 WHEN a.hr < 2 THEN 7 END AS c,
           a.qty, a.amount
      FROM _atk a
     WHERE a.ok
       AND CASE WHEN v_heat_from IS NOT NULL THEN a.nd BETWEEN v_heat_from AND v_heat_to ELSE a.ci IS NOT NULL END
  )
  SELECT jsonb_build_object(
           'cells', (SELECT jsonb_agg((SELECT jsonb_agg(jsonb_build_object(
                         'n', COALESCE((SELECT count(*) FROM h WHERE h.r = rr AND h.c = cc), 0),
                         'amount', COALESCE((SELECT round(sum(h.amount), 2) FROM h WHERE h.r = rr AND h.c = cc), 0)) ORDER BY cc)
                       FROM generate_series(0, 7) cc) ORDER BY rr)
                     FROM generate_series(0, 6) rr),
           'outside', (SELECT count(*) FROM h WHERE h.c IS NULL),
           'days30', v_heat_from IS NOT NULL)
    INTO v_heat;

  -- Soirées qui ont vendu dans la fenêtre (les 7 premières, puis le reste).
  WITH per AS (
    SELECT a.event_id, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL AND a.event_id IS NOT NULL GROUP BY 1
  ), tot AS (
    SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), rows AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming, p.tickets, p.revenue, COALESCE(t.sold, 0) AS sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(t.sold, 0)::int) AS cap,
           (SELECT COALESCE(t2.sold, 0) FROM _aev e2 LEFT JOIN tot t2 ON t2.event_id = e2.id
             WHERE e2.start_at < e.start_at AND e2.id <> e.id AND NOT e2.upcoming
             ORDER BY (e2.series = e.series) DESC, e2.start_at DESC LIMIT 1) AS prev_sold,
           row_number() OVER (ORDER BY p.revenue DESC, p.tickets DESC) AS rk
      FROM per p JOIN _aev e ON e.id = p.event_id LEFT JOIN tot t ON t.event_id = e.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'start_at', start_at, 'night', night, 'upcoming', upcoming,
           'state', CASE WHEN night = v_today THEN 'tonight' WHEN upcoming THEN 'presale' ELSE 'past' END,
           'tickets', tickets, 'revenue', revenue, 'sold', sold, 'cap', cap, 'prev_sold', prev_sold
         ) ORDER BY start_at DESC) FILTER (WHERE rk <= 7), '[]'::jsonb),
         CASE WHEN count(*) > 7 THEN jsonb_build_object('count', count(*) FILTER (WHERE rk > 7),
                'tickets', sum(tickets) FILTER (WHERE rk > 7), 'revenue', sum(revenue) FILTER (WHERE rk > 7)) END
    INTO v_events, v_other
    FROM rows;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'totals', v_tot,
    'msg', v_msg,
    'tariffs', v_tariffs,
    'fill', v_fill,
    'seg_share', v_seg_share,
    'goal', v_goal,
    'heat', v_heat,
    'events', v_events,
    'events_other', v_other,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_ana_sales__core(text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_sales__core(text, uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_ana_sales(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL, p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_ana_sales__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_ana_sales(text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ana_sales(text, uuid, text, uuid, text) TO authenticated, service_role;

-- ── Trafic ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
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
                         FROM unnest(ARRAY['em', 'sm', 'dm', 'yl', 'so', 'pa', 'au', 'di']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['em', 'sm', 'dm', 'yl', 'so', 'pa', 'au', 'di']) s(k)),
           'clicks', COALESCE((SELECT count(*) FROM _aclk c WHERE c.ci = g), 0),
           'new_buyers', COALESCE((SELECT count(*) FROM _afirst f WHERE f.ci = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', (SELECT count(*) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'buyers', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'new_buyers', (SELECT count(*) FROM _afirst f WHERE f.ci IS NOT NULL AND f.src = s.k),
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.src = s.k), 0)
         )), '[]'::jsonb)
    INTO v_sources FROM unnest(ARRAY['em', 'sm', 'dm', 'yl', 'so', 'pa', 'au', 'di']) s(k);

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
$$;
REVOKE ALL ON FUNCTION public.crm_ana_traffic__core(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_traffic__core(text, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_ana_traffic(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_ana_traffic__core(p_venue_id, p_organizer_user_id, p_period, p_event), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_ana_traffic(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ana_traffic(text, uuid, text, uuid) TO authenticated, service_role;

-- ── Communauté ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_ana_community__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL, p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  m jsonb;
  v_n int;
  v_seg text;
  v_today date;
  v_series jsonb; v_lc jsonb; v_reach jsonb; v_stats jsonb; v_spark jsonb; v_cohort jsonb; v_hist jsonb;
  v_aud jsonb; v_age jsonb; v_city jsonb; v_top jsonb; v_wake jsonb; v_base_total int; v_base_prev int;
  v_next uuid;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_seg := m->>'seg';
  v_today := (m->>'today')::date;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Les personnes regardées : toute la base, ou le segment ; pour une soirée,
  -- ses acheteurs.
  DROP TABLE IF EXISTS _apeo;
  CREATE TEMP TABLE _apeo ON COMMIT DROP AS
  SELECT p.*, LEAST(p.first_night, p.added_at,
                    (SELECT min(a.bought_at) FROM _atk_all a WHERE a.email = p.email AND a.ok)) AS joined_at,
         c.age AS c_age, c.city AS c_city
    FROM _cp p
    LEFT JOIN LATERAL (SELECT x.age, x.city FROM _cr x WHERE lower(x.email) = p.email LIMIT 1) c ON true
   WHERE (v_seg = 'all' OR p.lifecycle = v_seg)
     AND (m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                            AND a.event_id = (m->'event'->>'id')::uuid));

  -- Courbe : la base au total à la fin de chaque case, et les nouveaux venus.
  -- Pour une soirée : ses acheteurs, jour après jour.
  IF m->>'mode' = 'event' THEN
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(DISTINCT a.email) FROM _atk_all a JOIN _apeo p ON p.email = a.email
                        WHERE a.ok AND a.ci IS NOT NULL AND a.ci <= g),
             'new', (SELECT count(DISTINCT a.email) FROM _atk_all a JOIN _apeo p ON p.email = a.email
                      WHERE a.ok AND a.ci = g
                        AND NOT EXISTS (SELECT 1 FROM _atk_all b WHERE b.email = a.email AND b.ok AND b.bought_at < a.bought_at)),
             'prev_total', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.pi <= g),
             'prev_new', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.pi = g
                           AND NOT EXISTS (SELECT 1 FROM _atk_all b WHERE b.email = a.email AND b.ok AND b.bought_at < a.bought_at))
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(*) FROM _apeo p WHERE p.joined_at IS NOT NULL
                        AND public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                            <= CASE m->>'mode'
                                 WHEN 'hour' THEN public._crm_night_date((m->>'start')::timestamptz + make_interval(hours => g + 1), m->>'tz', (m->>'night_end_hour')::int)
                                 WHEN 'month' THEN ((m->>'start')::date + make_interval(months => g + 1) - interval '1 day')::date
                                 ELSE (m->>'start')::date + g END),
             'new', (SELECT count(*) FROM _apeo p WHERE public._crm_ana_bucket(m, p.joined_at) = g),
             'prev_new', (SELECT count(*) FROM _apeo p WHERE p.joined_at IS NOT NULL AND CASE m->>'mode'
                             WHEN 'hour' THEN p.joined_at >= (m->>'start')::timestamptz - make_interval(hours => v_n - g)
                                              AND p.joined_at < (m->>'start')::timestamptz - make_interval(hours => v_n - g - 1)
                             WHEN 'month' THEN public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                                               >= ((m->>'start')::date - interval '12 months' + make_interval(months => g))::date
                                               AND public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                                               < ((m->>'start')::date - interval '12 months' + make_interval(months => g + 1))::date
                             ELSE public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int) = (m->>'start')::date - v_n + g END)
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  END IF;

  SELECT count(*) INTO v_base_total FROM _apeo;

  -- Cycle de vie (toute la base, ou les acheteurs de la soirée).
  SELECT jsonb_build_object(
           'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_lc
    FROM _cp p
   WHERE m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                           AND a.event_id = (m->'event'->>'id')::uuid);

  SELECT jsonb_build_object(
           'total', count(*),
           'email_sms', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok))
    INTO v_reach FROM _apeo;

  SELECT jsonb_build_object(
           'came', count(*) FILTER (WHERE nights > 0),
           'returning', count(*) FILTER (WHERE nights >= 2),
           'avg_nights', round(avg(nights) FILTER (WHERE nights > 0), 2),
           'spent', round(avg(spent) FILTER (WHERE nights > 0), 2))
    INTO v_stats FROM _apeo;

  -- Les mêmes mesures à la fin des six derniers mois (étincelles, écart).
  SELECT jsonb_agg(jsonb_build_object('returning_pct', q.rp, 'avg_nights', q.an, 'spent', q.sp) ORDER BY q.k DESC)
    INTO v_spark FROM (
      SELECT k,
             round(100.0 * count(*) FILTER (WHERE n >= 2) / NULLIF(count(*), 0), 1) AS rp,
             round(avg(n), 2) AS an, round(avg(s), 2) AS sp
        FROM generate_series(0, 5) k
        CROSS JOIN LATERAL (
          SELECT a.email, count(DISTINCT a.event_id) AS n, sum(a.amount) AS s
            FROM _atk_all a JOIN _apeo p ON p.email = a.email
           WHERE a.ok AND a.event_id IS NOT NULL
             AND a.bought_at < CASE WHEN k = 0 THEN now()
                                    ELSE (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => k - 1)) AT TIME ZONE 'Europe/Paris' END
           GROUP BY a.email) x
       GROUP BY k) q;

  -- Qui revient : les cinq dernières soirées passées, et la part de leurs
  -- acheteurs revenus aux soirées suivantes (+1 à +4).
  WITH evs AS (
    SELECT e.id, e.title, e.start_at, e.night, row_number() OVER (ORDER BY e.start_at) AS rn
      FROM _aev e WHERE EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
  ), last5 AS (
    SELECT * FROM evs WHERE start_at < now() ORDER BY start_at DESC LIMIT 5
  ), buyers AS (
    SELECT DISTINCT a.event_id, a.email FROM _atk_all a JOIN _apeo p ON p.email = a.email WHERE a.ok AND a.email IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', l.title, 'night', l.night,
           'buyers', (SELECT count(*) FROM buyers b WHERE b.event_id = l.id),
           'back', (SELECT jsonb_agg(CASE WHEN nx.id IS NULL THEN NULL ELSE
                       (SELECT round(100.0 * count(*) / NULLIF((SELECT count(*) FROM buyers b0 WHERE b0.event_id = l.id), 0), 0)
                          FROM buyers b WHERE b.event_id = l.id
                           AND EXISTS (SELECT 1 FROM buyers b2 WHERE b2.event_id = nx.id AND b2.email = b.email)) END ORDER BY s)
                     FROM generate_series(1, 4) s LEFT JOIN evs nx ON nx.rn = l.rn + s)
         ) ORDER BY l.start_at), '[]'::jsonb)
    INTO v_cohort FROM last5 l;

  SELECT jsonb_build_object(
           'n1', count(*) FILTER (WHERE nights = 1), 'n2', count(*) FILTER (WHERE nights = 2),
           'n3', count(*) FILTER (WHERE nights BETWEEN 3 AND 4), 'n5', count(*) FILTER (WHERE nights BETWEEN 5 AND 9),
           'n10', count(*) FILTER (WHERE nights >= 10))
    INTO v_hist FROM _apeo;

  -- Qui vient : les acheteurs de la fenêtre, par cycle de vie.
  SELECT jsonb_build_object(
           'buyers', count(DISTINCT a.email),
           'groups', (SELECT jsonb_object_agg(g.k, jsonb_build_object(
                          'buyers', (SELECT count(DISTINCT x.email) FROM _atk x JOIN _cp p ON p.email = x.email
                                      WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle = g.k),
                          'revenue', (SELECT COALESCE(round(sum(x.amount), 2), 0) FROM _atk x JOIN _cp p ON p.email = x.email
                                      WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle = g.k)))
                        FROM unnest(ARRAY['nou', 'occ', 'hab', 'end']) g(k)))
    INTO v_aud
    FROM _atk a WHERE a.ok AND a.ci IS NOT NULL;

  -- Âge et lieu : billets d'abord (déclarés à l'achat), sinon la fiche.
  WITH pa AS (
    SELECT p.email,
           COALESCE((SELECT max(a.age) FROM _atk_all a WHERE a.email = p.email AND a.age BETWEEN 14 AND 99), NULLIF(p.c_age, 0)) AS age,
           COALESCE((SELECT a.city FROM _atk_all a WHERE a.email = p.email AND a.city IS NOT NULL ORDER BY a.bought_at DESC LIMIT 1),
                    NULLIF(btrim(p.c_city), '')) AS city
      FROM _apeo p
  )
  SELECT jsonb_build_object(
           'known', count(*) FILTER (WHERE age IS NOT NULL), 'total', count(*),
           'b', jsonb_build_array(count(*) FILTER (WHERE age BETWEEN 14 AND 21), count(*) FILTER (WHERE age BETWEEN 22 AND 25),
                                  count(*) FILTER (WHERE age BETWEEN 26 AND 30), count(*) FILTER (WHERE age BETWEEN 31 AND 35),
                                  count(*) FILTER (WHERE age >= 36))),
         jsonb_build_object(
           'known', count(*) FILTER (WHERE city IS NOT NULL), 'total', count(*),
           'top', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city', c, 'n', k) ORDER BY k DESC), '[]'::jsonb) FROM (
                     SELECT initcap(lower(city)) AS c, count(*) AS k FROM pa WHERE city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t))
    INTO v_age, v_city FROM pa;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
           'nights', p.nights, 'spent', p.spent, 'last_night', p.last_night) ORDER BY p.spent DESC), '[]'::jsonb)
    INTO v_top FROM (SELECT * FROM _apeo WHERE nights > 0 ORDER BY spent DESC, nights DESC LIMIT 5) p;

  -- À réveiller : endormis, venus une seule fois (il y a plus d'un mois),
  -- habitués sans place pour la prochaine soirée.
  SELECT id INTO v_next FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  SELECT jsonb_build_object(
           'end', jsonb_build_object('n', count(*) FILTER (WHERE lifecycle = 'end'),
                                     'reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok))),
           'once', jsonb_build_object('n', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days'),
                                      'reachable', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days' AND (email_ok OR phone_ok))),
           'hab_no_ticket', CASE WHEN v_next IS NOT NULL THEN jsonb_build_object(
               'event_id', v_next, 'title', (SELECT title FROM _aev WHERE id = v_next),
               'n', count(*) FILTER (WHERE lifecycle = 'hab' AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next)),
               'reachable', count(*) FILTER (WHERE lifecycle = 'hab' AND (email_ok OR phone_ok) AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next))) END)
    INTO v_wake FROM _cp;

  RETURN jsonb_build_object(
    'meta', m,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'series', COALESCE(v_series, '[]'::jsonb),
    'base', v_base_total,
    'lifecycle', v_lc,
    'reach', v_reach,
    'stats', v_stats,
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'cohort', v_cohort,
    'hist', v_hist,
    'audience', v_aud,
    'age', v_age,
    'city', v_city,
    'top', v_top,
    'wake', v_wake,
    'has_any', EXISTS (SELECT 1 FROM _cp)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_ana_community__core(text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ana_community__core(text, uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_ana_community(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d', p_event uuid DEFAULT NULL, p_seg text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_ana_community__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_ana_community(text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ana_community(text, uuid, text, uuid, text) TO authenticated, service_role;

-- Les trois lectures construisent des tables temporaires : elles s'ouvrent
-- dans un aperçu démo comme les autres écrans de la Console.
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
    'crm_ana_sales', 'crm_ana_traffic', 'crm_ana_community'
  ]::text[]);
$function$;
