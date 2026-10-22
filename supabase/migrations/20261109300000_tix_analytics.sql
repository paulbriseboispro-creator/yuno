-- Yuno Tickets › Analyses — les écrans Analyses de Yuno CRM (Ventes, Trafic,
-- Communauté, Guest list, Parcours client) branchés sur les ventes que Yuno
-- fait lui-même. Demande de Paul (22/10) : « duplique de Yuno CRM toute la
-- partie analytics sur Yuno Tickets, tout doit être pareil ».
--
-- Le moteur du CRM lit des tables temporaires (_aev soirées, _atk_all ventes,
-- _cp personnes, _cr contacts). Ici, ces mêmes tables sont remplies depuis les
-- ventes Yuno de la portée, et les calculs sont ceux du CRM, recopiés depuis
-- la prod (pg_get_functiondef du 22/10). Les deux produits restent séparés :
--   * soirées Yuno seulement (`external_source IS NULL`), jamais un miroir Shotgun ;
--   * contacts, accords, fichiers importés et campagnes de Yuno Tickets
--     (`product IS NULL`, `NOT crm_campaign_is_crm`) ;
--   * aucune fonction du CRM n'est modifiée.
--
-- Une vente Yuno dans le vocabulaire du moteur (`_tix_sales`) :
--   billet      : une ligne par commande, quantité = places, montant = CA club
--                 (fees.ts : total − frais Yuno − assurance, remboursement
--                 partiel déduit) ; prix 0 = entrée gratuite ;
--   table VIP   : une vente sans place de billetterie (quantité 0), montant =
--                 CA club de la table ; comptée dans le CA, les acheteurs, les
--                 soirées faites, jamais dans « Billets » ;
--   guest list  : une invitation (canal `invitation`), jamais une vente ;
--   remboursée  : statut `refunded` (part remboursée des Ventes).
-- La portée : soirées que le club ou l'organisateur mène, ou dont il est le
-- partenaire d'un contrat collab ; pas les soirées seulement co-hébergées (un
-- co-hôte ne reçoit jamais les clients des autres parties). Un club ne voit
-- jamais le CA d'une soirée qu'il ne fait qu'accueillir (montant 0).

-- ── Portée ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._tix_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL))
     AND COALESCE((SELECT g.ok FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id) g), false);
$$;

CREATE OR REPLACE FUNCTION public._tix_money(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT g.ok AND g.money FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id) g), false);
$$;

CREATE OR REPLACE FUNCTION public._tix_scope_events(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(id uuid, title text, start_at timestamptz, end_at timestamptz, tz text, max_tickets integer, money boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '6 hours'),
         COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'), e.max_tickets,
         CASE WHEN p_venue_id IS NULL THEN true ELSE e.venue_id IS NOT DISTINCT FROM p_venue_id END
    FROM public.events e
   WHERE e.external_source IS NULL
     AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') <> 'cancelled'
     AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
       OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)));
$$;

-- Famille de la source d'une vente Yuno (attribution figée sur la vente,
-- migration 20261001200000), dans les clés de l'écran Trafic.
CREATE OR REPLACE FUNCTION public._tix_source(p_attr text, p_link_source text, p_link_medium text, p_has_link boolean, p_purchase_source text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_purchase_source, '')) IN ('manual', 'walk_in', 'walkin', 'door') THEN 'of'
    WHEN a = 'promoter' THEN 'pr'
    WHEN a = 'partner' THEN 'pa'
    WHEN a = 'meta_ads' THEN 'ad'
    WHEN a = 'promo_code' THEN 'pc'
    WHEN a = 'email' THEN 'em'
    WHEN a = 'marketplace' THEN 'mk'
    WHEN COALESCE(p_has_link, false) THEN CASE
      WHEN lm IN ('partner_link', 'party_link', 'dj_link', 'partner') THEN 'pa'
      WHEN ls = 'sms' OR lm = 'sms_campaign' THEN 'sm'
      WHEN ls = 'instagram' AND lm = 'story' THEN 'ys'
      WHEN ls = 'instagram' THEN 'yb'
      WHEN ls = 'tiktok' THEN 'yt'
      WHEN ls = 'whatsapp' THEN 'wa'
      WHEN ls IN ('newsletter', 'email', 'mail') THEN 'em'
      ELSE 'yl' END
    WHEN a IN ('instagram', 'tiktok', 'facebook', 'whatsapp', 'social') THEN 'so'
    WHEN a = 'search' THEN 'se'
    WHEN a = 'referral' THEN 'au'
    WHEN a = 'link' THEN 'yl'
    ELSE 'di' END
  FROM (SELECT lower(COALESCE(p_attr, '')) AS a, lower(COALESCE(p_link_source, '')) AS ls,
               lower(COALESCE(p_link_medium, '')) AS lm) x;
$$;

-- Genre dans le vocabulaire du moteur (female / male / other).
CREATE OR REPLACE FUNCTION public._tix_gender(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p, '')))
    WHEN 'f' THEN 'female' WHEN 'female' THEN 'female' WHEN 'femme' THEN 'female' WHEN 'woman' THEN 'female'
    WHEN 'm' THEN 'male' WHEN 'male' THEN 'male' WHEN 'homme' THEN 'male' WHEN 'man' THEN 'male'
    WHEN 'other' THEN 'other' WHEN 'autre' THEN 'other' WHEN 'non_binary' THEN 'other' END;
$$;

-- Les ventes Yuno de la portée, dans le vocabulaire du moteur (voir l'en-tête).
DROP FUNCTION IF EXISTS public._tix_sales(text, uuid);
CREATE OR REPLACE FUNCTION public._tix_sales(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(id uuid, event_id uuid, pillar text, email text, quantity integer, price numeric, amount numeric,
              status text, deal_channel text, purchased_at timestamptz, scanned_at timestamptz, deal_name text,
              src text, age integer, gender text, city text, order_ref text, full_name text, raw_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS MATERIALIZED (
    SELECT s.id, s.start_at, s.money FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) s
  )
  SELECT t.id, t.event_id, 'tickets'::text,
         lower(NULLIF(btrim(t.user_email), '')),
         GREATEST(COALESCE(t.quantity, 1), 1),
         round(x.gross / GREATEST(COALESCE(t.quantity, 1), 1), 2),
         CASE WHEN NOT ev.money THEN 0
              WHEN t.status = 'refunded' THEN x.gross
              ELSE x.gross - LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0), x.gross) END,
         CASE WHEN t.status = 'refunded' THEN 'refunded' ELSE 'valid' END,
         NULL::text,
         COALESCE(t.paid_at, t.created_at),
         CASE WHEN COALESCE(t.entry_scanned, false) OR COALESCE(t.used, false)
              THEN COALESCE(t.entry_scanned_at, t.used_at, ev.start_at) END,
         COALESCE(NULLIF(btrim(r.name), ''), NULLIF(btrim(t.ticket_type), '')),
         public._tix_source(t.attribution_source, tl.utm_source, tl.utm_medium, t.tracked_link_id IS NOT NULL, t.purchase_source),
         CASE WHEN p.birth_date IS NOT NULL THEN extract(year FROM age(COALESCE(t.paid_at, t.created_at), p.birth_date))::int END,
         public._tix_gender(p.gender), NULLIF(btrim(p.city), ''),
         t.id::text, NULLIF(btrim(t.full_name), ''), t.status
    FROM public.tickets t
    JOIN ev ON ev.id = t.event_id
    LEFT JOIN public.ticket_rounds r ON r.id = t.ticket_round_id
    LEFT JOIN public.tracked_links tl ON tl.id = t.tracked_link_id
    LEFT JOIN public.profiles p ON p.id = t.user_id
    CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0) AS gross) x
   WHERE t.status IN ('paid', 'used', 'refunded')
  UNION ALL
  SELECT tr.id, tr.event_id, 'tables'::text,
         lower(NULLIF(btrim(tr.user_email), '')),
         0,
         x.gross,
         CASE WHEN NOT ev.money THEN 0
              WHEN tr.status = 'refunded' THEN x.gross
              ELSE x.gross - LEAST(GREATEST(COALESCE(tr.refund_amount, 0), 0), x.gross) END,
         CASE WHEN tr.status = 'refunded' THEN 'refunded' ELSE 'valid' END,
         NULL::text,
         COALESCE(tr.paid_at, tr.created_at),
         CASE WHEN COALESCE(tr.entry_scanned, false) OR tr.checked_in_at IS NOT NULL
              THEN COALESCE(tr.entry_scanned_at, tr.checked_in_at, ev.start_at) END,
         'Table · ' || COALESCE(NULLIF(btrim(pk.name), ''), 'VIP'),
         public._tix_source(tr.attribution_source, tl.utm_source, tl.utm_medium, tr.tracked_link_id IS NOT NULL, tr.purchase_source),
         CASE WHEN COALESCE(tr.age_declaration_birth_date, p.birth_date) IS NOT NULL
              THEN extract(year FROM age(COALESCE(tr.paid_at, tr.created_at), COALESCE(tr.age_declaration_birth_date, p.birth_date)))::int END,
         public._tix_gender(p.gender), NULLIF(btrim(p.city), ''),
         tr.id::text, NULLIF(btrim(tr.full_name), ''), tr.status
    FROM public.table_reservations tr
    JOIN ev ON ev.id = tr.event_id
    LEFT JOIN public.table_packs pk ON pk.id = tr.pack_id
    LEFT JOIN public.tracked_links tl ON tl.id = tr.tracked_link_id
    LEFT JOIN public.profiles p ON p.id = tr.user_id
    CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.service_fee, 0)
                                        - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END, 0) AS gross) x
   WHERE tr.status IN ('paid', 'confirmed', 'refunded')
  UNION ALL
  SELECT g.id, gl.event_id, 'guestlist'::text,
         lower(NULLIF(btrim(g.email), '')),
         1, 0::numeric, 0::numeric, 'valid', 'invitation',
         g.created_at,
         CASE WHEN COALESCE(g.entry_scanned, false) OR g.status = 'entered'
              THEN COALESCE(g.entry_scanned_at, ev.start_at) END,
         COALESCE(NULLIF(btrim(gl.holder_label), ''),
                  (SELECT NULLIF(btrim(pr.first_name), '') FROM public.promoters pr WHERE pr.id = gl.promoter_id),
                  (SELECT NULLIF(btrim(d.stage_name), '') FROM public.djs d WHERE d.id = gl.dj_id)),
         public._tix_source(g.attribution_source, tl.utm_source, tl.utm_medium, g.tracked_link_id IS NOT NULL, NULL),
         CASE WHEN p.birth_date IS NOT NULL THEN extract(year FROM age(g.created_at, p.birth_date))::int END,
         public._tix_gender(COALESCE(NULLIF(btrim(g.gender), ''), p.gender)), NULLIF(btrim(p.city), ''),
         g.id::text, NULLIF(btrim(g.full_name), ''), g.status
    FROM public.guest_list_entries g
    JOIN public.guest_lists gl ON gl.id = g.guest_list_id
    JOIN ev ON ev.id = gl.event_id
    LEFT JOIN public.tracked_links tl ON tl.id = g.tracked_link_id
    LEFT JOIN public.profiles p ON p.id = g.user_id
   WHERE g.status NOT IN ('cancelled', 'rejected', 'refused', 'declined');
$$;

-- ── Le socle des écrans : soirées (_aev) et ventes (_atk_all / _atk) ─────
-- Miroir de _crm_ana_setup : mêmes cases (heures, jours, mois, J-21 d'une
-- soirée), même règle de nuit, mêmes colonnes. Ce qui change : la source
-- (_tix_sales), la jauge d'une soirée (billetterie Yuno : jauge totale, sinon
-- somme des paliers s'ils sont tous limités — règle de get_events_sales_summary)
-- et la colonne `pillar` (tickets / tables / guestlist) en plus.
CREATE OR REPLACE FUNCTION public._tix_ana_setup(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid, p_seg text)
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

  -- La base des personnes ne sert ici qu'à filtrer un segment.
  IF v_seg <> 'all' THEN
    PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id);
  ELSE
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, 'suite');
  END IF;

  DROP TABLE IF EXISTS _aev;
  CREATE TEMP TABLE _aev ON COMMIT DROP AS
  SELECT e.id, e.title, COALESCE(public._crm_night_series(e.title), e.title) AS series, e.start_at,
         e.end_at > v_now AS upcoming,
         public._crm_night_date(e.start_at, e.tz, v_eh) AS night,
         NULL::integer AS left_tickets,
         CASE WHEN COALESCE(e.max_tickets, 0) > 0 THEN jsonb_build_array(jsonb_build_object('quantity', e.max_tickets))
              ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('quantity', CASE WHEN COALESCE(r.max_tickets, 0) > 0 THEN r.max_tickets END)), '[]'::jsonb)
                      FROM public.ticket_rounds r WHERE r.event_id = e.id) END AS deals
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e;

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
      SELECT t.id, t.email, t.quantity AS qty, t.amount,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS ok, t.status = 'refunded' AS refunded,
             t.purchased_at AS bought_at, t.event_id, t.pillar,
             t.deal_name AS deal, t.order_ref AS ord, t.price, t.src,
             t.scanned_at, t.age, t.city,
             public._crm_night_date(t.purchased_at, v_tz, v_eh) AS nd,
             extract(hour FROM t.purchased_at AT TIME ZONE v_tz)::int AS hr
        FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
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

  SELECT jsonb_agg(CASE v_mode
           WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
           WHEN 'day' THEN to_jsonb(v_d0 + g)
           WHEN 'month' THEN to_jsonb((v_m0 + make_interval(months => g))::date)
           ELSE to_jsonb(v_ev_night - (21 - g)) END ORDER BY g)
    INTO v_labels FROM generate_series(0, v_n - 1) g;

  RETURN jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', v_seg, 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'money', public._tix_money(p_venue_id, p_organizer_user_id),
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - 21) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night, 'upcoming', v_ev_upcoming,
        'days_left', GREATEST(0, v_ev_night - v_today)) END,
    'prev_event', CASE WHEN v_pev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_pev_id, 'title', v_pev_title, 'start_at', v_pev_start, 'night', v_pev_night) END
  );
END;
$function$;

-- Les envois de la portée (Yuno Tickets) marqués sur les courbes : e-mails,
-- SMS et notifications push faits à la main.
CREATE OR REPLACE FUNCTION public._tix_ana_sends(p_venue_id text, p_organizer_user_id uuid, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, c.sent_at), 'at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at IS NOT NULL AND c.status IN ('sent', 'sending')
       AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND NOT public.crm_campaign_is_crm(c.id)
       AND c.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, c.sent_at) IS NOT NULL
       AND (p_meta->>'mode' <> 'event' OR c.event_id IS NULL OR c.event_id = (p_meta->'event'->>'id')::uuid)
    UNION ALL
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, s.sent_at), 'at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at IS NOT NULL AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id AND s.product IS NULL
       AND s.sent_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, s.sent_at) IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('i', public._crm_ana_bucket(p_meta, pc.created_at), 'at', pc.created_at, 'name', pc.title, 'channel', 'push', 'id', pc.id)
      FROM public.push_campaigns pc
     WHERE pc.status = 'sent' AND COALESCE(pc.source, 'manual') <> 'auto'
       AND pc.venue_id IS NOT DISTINCT FROM p_venue_id AND pc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND pc.agency_id IS NULL
       AND pc.created_at > now() - interval '13 months'
       AND public._crm_ana_bucket(p_meta, pc.created_at) IS NOT NULL
       AND (p_meta->>'mode' <> 'event' OR pc.event_id IS NULL OR pc.event_id = (p_meta->'event'->>'id')::uuid)
  ) q;
$function$;

-- Fichiers importés de Yuno Tickets (miroir de _crm_file_history, product IS NULL).
CREATE OR REPLACE FUNCTION public._tix_file_history(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(email text, f_nights integer, f_spent numeric, f_paid integer, f_first timestamp with time zone, f_last timestamp with time zone, f_asof timestamp with time zone, f_list uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (lower(c.email))
         lower(c.email),
         GREATEST(COALESCE(c.event_count, 0),
                  CASE WHEN COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL THEN 1 ELSE 0 END),
         COALESCE(c.total_spent, 0),
         CASE WHEN COALESCE(c.total_spent, 0) > 0 THEN GREATEST(COALESCE(c.event_count, 0), 1) ELSE 0 END,
         LEAST(c.added_at, c.last_purchase_at),
         c.last_purchase_at,
         COALESCE(c.last_purchase_at, c.created_at),
         c.list_import_id
    FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND c.product IS NULL
     AND c.email IS NOT NULL
     AND (COALESCE(c.event_count, 0) > 0 OR COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL)
     AND c.created_at <= COALESCE(p_at, now())
     AND (c.last_purchase_at IS NULL OR c.last_purchase_at <= COALESCE(p_at, now()))
   ORDER BY lower(c.email), c.created_at DESC,
            ((c.event_count IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.last_purchase_at IS NOT NULL)::int) DESC,
            c.id;
$function$;

-- ── Les personnes (_cp) : miroir de _crm_people_build sur les ventes Yuno ──
CREATE OR REPLACE FUNCTION public._tix_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_light boolean DEFAULT false)
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
  -- Mémoire de transaction (20261016230000) : un appelant qui construit
  -- plusieurs bases de la MÊME portée dans la même transaction (fiche d'un
  -- segment, balayage nocturne) pose yuno.crm_cp_memo = sa portée ; ce qui ne
  -- dépend pas de la date (contacts, billets, premier billet, profil, zones)
  -- n'est alors lu qu'une fois. Sans ce réglage, rien n'est réutilisé.
  -- Pas de mémoire de transaction ici : chaque écran construit sa base une fois.
  v_memo boolean := false;
  v_ready boolean;
  -- p_light (20261018250000) : base LÉGÈRE, pour un écran qui ne lit que le
  -- cycle de vie, la joignabilité, les soirées et la dépense (Communauté).
  -- Mêmes colonnes, mais source, utm_*, âge / genre / pays / lieu Shotgun,
  -- area_key, an_tags / an_dist_km, étiquettes, note et comportement face aux
  -- messages (msg_n, click_*), guest list (gl_*, gl_conv), tonight, upcoming
  -- ne sont pas calculés : NULL ou leur défaut ; _cpt n'a pas ses index.
  -- Tout le reste (soirées, dépense, cycle de vie, guest list…) est la même
  -- règle, mot pour mot. Ne JAMAIS la passer à un lecteur de ces colonnes.
BEGIN
  -- Portée de la base construite, lue par les clés de filtre qui interrogent
  -- une soirée (`ntgt`, 20261011110000) : jamais la soirée d'un autre compte.
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  -- Une base légère réutilise la mémoire d'une base complète ou légère ; une
  -- base complète, seulement celle d'une base complète (tables pleines).
  v_ready := false;
  IF NOT v_ready THEN
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, 'suite');
  END IF;

  -- Les billets de la portée, lus UNE fois (20261018110000) : ventes, guest
  -- list, premier billet, profil et lieux en sortent. Avant, cinq lectures de
  -- external_tickets (dont une par l'index des adresses sur TOUTE la table)
  -- coûtaient ~0,9 s sur 48 000 billets. Le canal du tarif se lit dans sa
  -- colonne (20261018100000), plus dans le billet brut. Sans borne de date :
  -- chaque base filtre ensuite à sa date ; en mémoire de transaction, la
  -- lecture sert à toutes les bases de la portée.
  IF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpx;
    CREATE TEMP TABLE _cpx ON COMMIT DROP AS
      SELECT t.id, t.email, t.quantity AS qty, t.amount,
             t.purchased_at AS bought_at,
             t.event_id, e.start_at AS event_start,
             e.end_at AS event_end,
             t.scanned_at, t.deal_name, t.price,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS sale,
             public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS kind,
             t.src, NULL::text AS utm_medium,
             t.age, t.gender, NULL::text AS country_code, t.city, t.status
        FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
        LEFT JOIN public._tix_scope_events(p_venue_id, p_organizer_user_id) e ON e.id = t.event_id;
  END IF;

  -- Billets vendus (mêmes colonnes que _crm_tickets).
  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT x.id, x.email, x.qty, x.amount, x.bought_at, x.event_id, x.event_start, x.scanned_at, x.deal_name, x.price, x.src
      FROM _cpx x
     WHERE x.sale AND x.bought_at <= v_at;

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  CREATE TEMP TABLE _cpg ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start, x.event_end, x.kind,
           x.scanned_at, x.bought_at AS at, NULLIF(btrim(x.deal_name), '') AS deal
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.kind IS NOT NULL AND x.bought_at <= v_at;

  -- Soirées faites (audit 18/10, DATA-02, décision de Paul) : un billet vendu
  -- (même à 0 €) ou une invitation scannée, SAUF une entrée gratuite non
  -- scannée sur une porte mesurée (_crm_sale_counts_as_night) : là, on sait
  -- que la personne n'est pas venue. `came` = soirée faite ; les autres lignes
  -- disent seulement « avait une place » (provenance). Lue aussi par la fiche
  -- client et _crm_activity_build.
  DROP TABLE IF EXISTS _cpd;
  CREATE TEMP TABLE _cpd ON COMMIT DROP AS
    -- Porte mesurée (miroir de _crm_measured_doors) : soirées terminées à la
    -- date, au moins 10 entrées scannées et au moins 10 % des places valides.
    SELECT x.event_id FROM _cpx x
     WHERE x.status = 'valid' AND x.event_id IS NOT NULL AND x.event_end <= v_at
     GROUP BY x.event_id
    HAVING public._crm_door_measured(count(*), count(*) FILTER (WHERE x.scanned_at IS NOT NULL));
  DROP TABLE IF EXISTS _cpa;
  CREATE TEMP TABLE _cpa ON COMMIT DROP AS
    SELECT t.email, t.event_id, t.event_start,
           public._crm_sale_counts_as_night(t.price, t.scanned_at IS NOT NULL, d.event_id IS NOT NULL) AS came
      FROM _cpt t LEFT JOIN _cpd d ON d.event_id = t.event_id
     WHERE t.email IS NOT NULL
    UNION ALL
    SELECT g.email, g.event_id, g.event_start, true
      FROM _cpg g
     WHERE g.kind = 'inv' AND g.scanned_at IS NOT NULL AND g.event_id IS NOT NULL;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
   WHERE e.end_at > v_at
     AND (e.start_at AT TIME ZONE e.tz)::date <= (v_at AT TIME ZONE e.tz)::date
   ORDER BY e.start_at LIMIT 1;

  -- Premier billet, profil et zones : ne dépendent pas de la date de la base.
  IF NOT v_ready AND p_light THEN
    -- Base légère : mêmes tables, vides (la requête principale reste la même).
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
      SELECT x.email, x.src AS utm_source, x.utm_medium FROM _cpx x WHERE false;
    DROP TABLE IF EXISTS _cpm_prof;
    CREATE TEMP TABLE _cpm_prof ON COMMIT DROP AS
      SELECT x.email, x.age, x.gender, x.country_code AS country, x.city FROM _cpx x WHERE false;
    DROP TABLE IF EXISTS _cpm_akey;
    CREATE TEMP TABLE _cpm_akey ON COMMIT DROP AS
      SELECT NULL::text AS a, NULL::text AS k WHERE false;
    IF v_memo THEN
      PERFORM set_config('yuno.crm_cp_memo_light', v_scope, true);
    END IF;
  ELSIF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
    -- Le 1er billet VENDU (ni invitation, ni remboursé, ni duplicata), par
    -- date d'achat (20261010110000).
    SELECT DISTINCT ON (x.email) x.email, x.src AS utm_source, x.utm_medium
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.sale
     ORDER BY x.email, x.bought_at, x.id;
    DROP TABLE IF EXISTS _cpm_prof;
    CREATE TEMP TABLE _cpm_prof ON COMMIT DROP AS
    -- Profil rapporté par Shotgun (âge, genre, ville, pays) : la valeur connue
    -- la plus récente de chaque acheteur (catalogue de segments, 20261008200000).
    -- Entrée triée par (acheteur, date) : les quatre agrégats partagent le
    -- même ORDER BY et lisent ce tri une fois (agrégat pré-trié), au lieu de
    -- quatre tris par acheteur (20261016230000). Mêmes valeurs.
    SELECT t.email,
           (array_agg(t.age ORDER BY t.ts DESC) FILTER (WHERE t.age BETWEEN 12 AND 110))[1] AS age,
           (array_agg(t.gender ORDER BY t.ts DESC) FILTER (WHERE t.gender IN ('female', 'male', 'other')))[1] AS gender,
           (array_agg(upper(btrim(t.country_code)) ORDER BY t.ts DESC)
              FILTER (WHERE btrim(t.country_code) ~* '^[a-z]{2}$'))[1] AS country,
           (array_agg(btrim(t.city) ORDER BY t.ts DESC) FILTER (WHERE NULLIF(btrim(t.city), '') IS NOT NULL))[1] AS city
      FROM (SELECT x.email, x.bought_at AS ts, x.age, x.gender, x.country_code, x.city
              FROM _cpx x
             WHERE x.email IS NOT NULL
               AND (x.age IS NOT NULL OR x.gender IS NOT NULL OR x.country_code IS NOT NULL OR x.city IS NOT NULL)
             ORDER BY 1, 2 DESC) t
     GROUP BY t.email;
    DROP TABLE IF EXISTS _cpm_akey;
    CREATE TEMP TABLE _cpm_akey ON COMMIT DROP AS
    -- Clé de zone (_crm_area_key) calculée UNE fois par lieu distinct, pas par
    -- personne : la fonction n'est pas « inlinée » (SET search_path) et
    -- coûtait 0,2 s sur 14 000 contacts (20261016220000). Tous les lieux
    -- possibles (billets, fiches) : un sur-ensemble suffit à la jointure.
    SELECT x.a, public._crm_area_key(x.a) AS k
      FROM (SELECT NULLIF(btrim(t.city), '') FROM _cpx t
             WHERE NULLIF(btrim(t.city), '') IS NOT NULL
            UNION SELECT NULLIF(btrim(c.city), '') FROM _cr c WHERE NULLIF(btrim(c.city), '') IS NOT NULL
            UNION SELECT NULLIF(btrim(c.zone), '') FROM _cr c WHERE NULLIF(btrim(c.zone), '') IS NOT NULL) x(a);
    IF v_memo THEN
      PERFORM set_config('yuno.crm_cp_memo_ready', v_scope, true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH att AS (
    -- Une soirée faite : voir _cpa plus haut (DATA-02).
    SELECT a.email, a.event_id, a.event_start, a.came FROM _cpa a
  ), agg AS (
    SELECT a.email,
           count(DISTINCT a.event_id) FILTER (WHERE a.came AND a.event_start <= v_at) AS nights,
           count(DISTINCT a.event_id) FILTER (WHERE a.came AND a.event_start <= v_at
                 AND a.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(a.event_start) FILTER (WHERE a.came AND a.event_start <= v_at) AS first_night,
           max(a.event_start) FILTER (WHERE a.came AND a.event_start <= v_at) AS last_night,
           -- Avait une place pour une soirée passée, venu ou non : la provenance.
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at) AS held
      FROM att a
     GROUP BY a.email
  ), buy AS (
    SELECT t.email,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy,
           count(DISTINCT COALESCE(t.event_id::text, t.id::text)) FILTER (WHERE t.amount > 0) AS paid_n,
           min(t.bought_at) FILTER (WHERE t.amount > 0) AS first_paid,
           bool_or(t.event_start > v_at) AS upcoming
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), cov AS (
    -- Soirées terminées dont la porte est mesurée (_crm_measured_doors, lue une fois dans _cpd).
    SELECT d.event_id FROM _cpd d
  ), gl AS (
    SELECT g.email,
           count(DISTINCT g.event_id) AS gl_n,
           count(DISTINCT g.event_id) FILTER (WHERE g.scanned_at IS NOT NULL) AS gl_came,
           min(g.event_start) AS gl_first,
           array_agg(DISTINCT g.event_id) FILTER (WHERE g.event_id IS NOT NULL) AS gl_events,
           count(*) FILTER (WHERE g.scanned_at IS NULL AND g.event_id IN (SELECT cov.event_id FROM cov)) AS gl_noshow,
           bool_or(g.event_id = v_tonight) AS gl_tonight,
           bool_or(g.event_start > v_at) AS gl_upcoming
      FROM _cpg g
     WHERE NOT p_light
     GROUP BY g.email
  ), first_utm AS (
    SELECT * FROM _cpm_futm
  ), prof AS (
    SELECT * FROM _cpm_prof
  ), page_first AS (
    -- Première inscription CONFIRMÉE par une page d'inscription de la portée.
    SELECT lower(e.email) AS email, min(e.created_at) AS at
      FROM public.crm_signup_entries e
      JOIN public.crm_signup_pages pg ON pg.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND e.created_at <= v_at
       AND false -- les pages d'inscription sont au CRM
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), fh AS (
    -- Historique d'un fichier importé (20261008210000).
    SELECT * FROM public._tix_file_history(p_venue_id, p_organizer_user_id, v_at)
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id,
           c.age AS f_age, c.gender AS f_gender, c.country_code AS f_country,
           NULLIF(btrim(c.city), '') AS f_city, NULLIF(btrim(c.zone), '') AS f_zone
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  ), akey AS (
    SELECT * FROM _cpm_akey
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         -- Soirées, dépense, dates : billets Shotgun ET historique des fichiers (voir `h`).
         h.nights::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         h.first_night, h.last_night, round(h.spent, 2) AS spent,
         COALESCE(y.events, '{}'::uuid[]) AS events,
         CASE WHEN NOT p_light THEN COALESCE(y.tonight, false) OR COALESCE(g.gl_tonight, false) END AS tonight,
         CASE WHEN p_light THEN NULL
              WHEN pf.at IS NOT NULL AND (y.first_buy IS NULL OR pf.at < y.first_buy) THEN 'page'
              WHEN COALESCE(a.held, 0) > 0 THEN 'yuno'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         CASE WHEN NOT p_light THEN u.utm_source END AS utm_source,
         CASE WHEN NOT p_light THEN u.utm_medium END AS utm_medium,
         CASE
           -- A acheté pour une soirée à venir sans en avoir encore fait : nouveau
           -- client, pas un « contact connu » (import, inscription). Une entrée
           -- gratuite passée où il n'est pas venu (DATA-02) n'en fait pas un client.
           WHEN h.nights = 0 THEN CASE WHEN COALESCE(y.upcoming, false) THEN 'nou' ELSE 'none' END
           -- A repris une place : il n'a pas décroché.
           WHEN h.last_night < v_at - make_interval(months => v_rules.lapse_months)
                AND NOT COALESCE(y.upcoming, false) THEN 'end'
           -- « Habitué » se prouve par des soirées DATÉES (billets) : un total de
           -- fichier ne dit pas combien tombent dans la fenêtre.
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN h.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note,
         h.paid_n::int AS paid_n,
         COALESCE(g.gl_n, 0)::int AS gl_n,
         COALESCE(g.gl_came, 0)::int AS gl_came,
         g.gl_first,
         COALESCE(g.gl_events, '{}'::uuid[]) AS gl_events,
         COALESCE(g.gl_noshow, 0)::int AS gl_noshow,
         -- Devenu client : premier billet PAYANT acheté après sa première soirée en guest list.
         CASE WHEN NOT p_light THEN (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) END AS gl_conv,
         -- Catalogue de segments (20261008200000) : profil (Shotgun d'abord, puis
         -- vos fichiers), place pour une soirée à venir, dépense par soirée payée.
         CASE WHEN NOT p_light THEN COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) END AS age,
         CASE WHEN NOT p_light THEN COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) END AS gender,
         CASE WHEN NOT p_light THEN COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) END AS country,
         CASE WHEN NOT p_light THEN COALESCE(pr.city, b.f_city, b.f_zone) END AS area,
         CASE WHEN NOT p_light THEN ak.k END AS area_key,
         CASE WHEN NOT p_light THEN (COALESCE(y.upcoming, false) OR COALESCE(g.gl_upcoming, false)) END AS upcoming,
         CASE WHEN h.paid_n > 0 THEN round(h.spent / h.paid_n, 2) END AS basket,
         -- Ce que dit le fichier, et comment il a compté (fiche client).
         f.f_nights AS hist_nights, f.f_spent AS hist_spent, f.f_last AS hist_last, m.mode AS hist_mode, f.f_list AS hist_list,
         -- Analyse client (20261010110000) : clés de filtre pré-calculées.
         COALESCE(ap.tags, '{}'::text[]) AS an_tags, ap.dist_km AS an_dist_km
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN prof pr ON pr.email = b.email
    LEFT JOIN fh f ON f.email = b.email
    LEFT JOIN akey ak ON ak.a = COALESCE(pr.city, b.f_city, b.f_zone)
    LEFT JOIN public.crm_person_profile ap ON false
    -- Comment l'historique d'un fichier compte :
    --   'added' — il précède le premier billet Shotgun (deux billetteries, ou
    --             pas encore de Shotgun) : les deux s'additionnent ;
    --   'file' / 'live' — les deux se recouvrent (un export de la même
    --             billetterie réimporté) : la source qui connaît le plus de
    --             soirées, JAMAIS la somme (pas de double compte).
    CROSS JOIN LATERAL (
      SELECT CASE WHEN f.email IS NULL THEN NULL
                  WHEN y.first_buy IS NULL OR f.f_asof < y.first_buy - interval '2 days' THEN 'added'
                  WHEN f.f_nights > COALESCE(a.nights, 0) THEN 'file'
                  ELSE 'live' END AS mode
    ) m
    CROSS JOIN LATERAL (
      SELECT CASE m.mode WHEN 'added' THEN COALESCE(a.nights, 0) + f.f_nights WHEN 'file' THEN f.f_nights ELSE COALESCE(a.nights, 0) END AS nights,
             CASE m.mode WHEN 'added' THEN COALESCE(y.spent, 0) + f.f_spent WHEN 'file' THEN f.f_spent ELSE COALESCE(y.spent, 0) END AS spent,
             CASE m.mode WHEN 'added' THEN COALESCE(y.paid_n, 0) + f.f_paid WHEN 'file' THEN f.f_paid ELSE COALESCE(y.paid_n, 0) END AS paid_n,
             CASE WHEN m.mode IS NULL THEN a.last_night ELSE GREATEST(a.last_night, f.f_last) END AS last_night,
             CASE WHEN m.mode IS NULL THEN a.first_night ELSE LEAST(a.first_night, f.f_first) END AS first_night
    ) h
    LEFT JOIN public.crm_contact_notes n ON false;

  -- Lu par personne plus bas (« a cliqué sans acheter ») et par les écrans
  -- (Parcours, Analyses) : sans index, chaque recherche relisait tous les
  -- billets — quadratique sur un compte de 30 000 billets (20261016210000).
  -- Créés APRÈS la base : la requête principale lit tous les billets, un index
  -- déjà posé l'y faisait passer par des accès aléatoires (0,2 s).
  IF NOT p_light THEN
    CREATE INDEX ON _cpt (email, bought_at);
    CREATE INDEX ON _cpt (id);
  END IF;

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  IF NOT p_light THEN
  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
       AND ec.sent_at <= v_at AND ec.sent_at > v_at - interval '12 months'
       AND NOT public.crm_campaign_is_crm(ec.id)
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

  END IF;

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$;

-- ── Ventes (miroir de crm_ana_sales__core) ──
CREATE OR REPLACE FUNCTION public.tix_ana_sales__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_today date;
  v_series jsonb; v_tot jsonb; v_msg jsonb; v_deals jsonb; v_fill jsonb; v_ref jsonb; v_seg_share numeric;
  v_target uuid; v_refs uuid[]; v_goal jsonb;
  v_heat jsonb; v_tariffs jsonb; v_events jsonb; v_other jsonb;
  v_heat_from date; v_heat_to date;
  v_cur_from date; v_prev_from date; v_prev_to date;
  v_cut int;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;

  -- Une soirée encore en vente se compare à la précédente AU MÊME JOUR (J-k) :
  -- au-delà d'aujourd'hui, la précédente n'est pas dans les totaux.
  v_cut := CASE WHEN m->>'mode' = 'event' AND COALESCE((m->'event'->>'upcoming')::boolean, false)
                THEN 21 - COALESCE((m->'event'->>'days_left')::int, 0) ELSE v_n - 1 END;

  -- Une lecture des billets pour toutes les cases (GROUP BY), au lieu de
  -- quatre sous-requêtes par case : 90 cases × 4 relisaient tous les billets
  -- (4,5 s sur 48 000 billets). Mêmes valeurs, case pour case.
  WITH cur AS MATERIALIZED (
    SELECT a.ci AS g, round(sum(a.amount), 2) AS revenue, sum(a.qty) AS tickets,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci
  ), prv AS MATERIALIZED (
    SELECT a.pi AS g, round(sum(a.amount), 2) AS revenue, sum(a.qty) AS tickets,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid
      FROM _atk a WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.pi
  )
  SELECT jsonb_agg(jsonb_build_object(
           'revenue', COALESCE(c.revenue, 0),
           'tickets', COALESCE(c.tickets, 0),
           'prev_revenue', COALESCE(p.revenue, 0),
           'prev_tickets', COALESCE(p.tickets, 0),
           'paid_tickets', COALESCE(c.paid, 0),
           'prev_paid_tickets', COALESCE(p.paid, 0)
         ) ORDER BY g.g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g(g)
    LEFT JOIN cur c ON c.g = g.g
    LEFT JOIN prv p ON p.g = g.g;

  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL), 0),
           -- Payants / entrées gratuites (20261020200000) : tickets = les deux.
           'paid_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL AND COALESCE(price, 0) > 0), 0),
           'free_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL AND price = 0), 0),
           'prev_paid_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut AND COALESCE(price, 0) > 0), 0),
           'prev_free_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut AND price = 0), 0),
           'buyers', count(DISTINCT email) FILTER (WHERE ok AND ci IS NOT NULL),
           -- Tables VIP (Yuno Tickets) : une vente sans place de billetterie.
           'tables', count(*) FILTER (WHERE ok AND ci IS NOT NULL AND pillar = 'tables'),
           'prev_tables', count(*) FILTER (WHERE ok AND pi <= v_cut AND pillar = 'tables'),
           -- Sous des clés `revenue` : l'enveloppe de l'argent (_crm_null_money) les efface.
           'table_money', jsonb_build_object(
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL AND pillar = 'tables'), 2), 0),
               'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut AND pillar = 'tables'), 2), 0)),
           'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut), 2), 0),
           'prev_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut), 0),
           'has_prev', bool_or(pi IS NOT NULL),
           'prev_same_day', v_cut < v_n - 1,
           -- Remboursés : part des billets de la fenêtre rendus (montant brut).
           'refund_pct', CASE WHEN sum(amount) FILTER (WHERE ci IS NOT NULL) > 0
                              THEN round(100 * sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL)
                                         / sum(amount) FILTER (WHERE ci IS NOT NULL), 1) END,
           'prev_refund_pct', CASE WHEN sum(amount) FILTER (WHERE pi <= v_cut) > 0
                                   THEN round(100 * sum(amount) FILTER (WHERE refunded AND pi <= v_cut)
                                              / sum(amount) FILTER (WHERE pi <= v_cut), 1) END,
           'refunds', jsonb_build_object(
               'amount', COALESCE(round(sum(amount) FILTER (WHERE refunded AND ci IS NOT NULL), 2), 0),
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ci IS NOT NULL), 2), 0))
         )
    INTO v_tot FROM _atk;

  -- Ce qui a fait vendre : la part venue d'un message Yuno (UTM).
  SELECT jsonb_build_object(
           'share', CASE WHEN sum(amount) > 0 THEN round(100 * sum(amount) FILTER (WHERE src IN ('em', 'sm')) / sum(amount), 1) END,
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE src IN ('em', 'sm')), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm')), 0),
           'by', jsonb_build_object(
             'em', COALESCE(sum(qty) FILTER (WHERE src = 'em'), 0),
             'sm', COALESCE(sum(qty) FILTER (WHERE src = 'sm'), 0),
             'dm', COALESCE(sum(qty) FILTER (WHERE src = 'dm'), 0)))
    INTO v_msg FROM _atk WHERE ok AND ci IS NOT NULL;

  -- Tarifs de la fenêtre.
  -- Une table VIP n'a pas de place de billetterie : elle compte en ventes
  -- (`units`), jamais dans la part des billets.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal, 'price', d.price, 'tickets', d.tickets, 'revenue', d.revenue,
                                               'units', d.units, 'pillar', d.pillar)
                            ORDER BY (d.pillar = 'tables'), d.tickets DESC, d.revenue DESC), '[]'::jsonb)
    INTO v_tariffs FROM (
      SELECT COALESCE(a.deal, '—') AS deal, a.pillar, round(avg(a.price), 2) AS price, sum(a.qty) AS tickets,
             round(sum(a.amount), 2) AS revenue, count(*) AS units
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1, 2 ORDER BY (a.pillar = 'tables'), 4 DESC, 5 DESC LIMIT 8) d;

  -- Remplissage des soirées TENUES dans la fenêtre (nuit déjà venue), contre
  -- celles de la fenêtre d'avant ; pour une soirée, elle contre la précédente.
  -- Une soirée encore en vente ne tire pas le remplissage vers le bas.
  IF m->>'mode' = 'hour' THEN
    v_cur_from := public._crm_night_date((m->>'start')::timestamptz, m->>'tz', (m->>'night_end_hour')::int);
    v_prev_from := public._crm_night_date((m->>'start')::timestamptz - make_interval(hours => v_n), m->>'tz', (m->>'night_end_hour')::int);
  ELSIF m->>'mode' = 'month' THEN
    v_cur_from := (m->>'start')::date;
    v_prev_from := ((m->>'start')::date - interval '12 months')::date;
  ELSIF m->>'mode' = 'day' THEN
    v_cur_from := (m->>'start')::date;
    v_prev_from := v_cur_from - v_n;
  END IF;
  v_prev_to := v_cur_from - 1;
  WITH capx AS (
    SELECT e.id, e.night, COALESCE(s.sold, 0) AS sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(s.sold, 0)::int) AS cap
      FROM _aev e
      LEFT JOIN (SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok GROUP BY 1) s ON s.event_id = e.id
  ), cur AS (
    SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'event'->>'id')::uuid
                                              ELSE night BETWEEN v_cur_from AND v_today END
  ), prv AS (
    SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'prev_event'->>'id')::uuid
                                              ELSE night BETWEEN v_prev_from AND v_prev_to END
  )
  SELECT jsonb_build_object(
           'sold', (SELECT sum(sold) FROM cur), 'cap', (SELECT sum(cap) FROM cur), 'nights', (SELECT count(*) FROM cur),
           'prev_sold', (SELECT sum(sold) FROM prv), 'prev_cap', (SELECT sum(cap) FROM prv))
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
  ), hc AS MATERIALIZED (
    SELECT h.r, h.c, count(*) AS n, round(sum(h.amount), 2) AS amount FROM h WHERE h.c IS NOT NULL GROUP BY h.r, h.c
  )
  SELECT jsonb_build_object(
           'cells', (SELECT jsonb_agg((SELECT jsonb_agg(jsonb_build_object(
                         'n', COALESCE(x.n, 0),
                         'amount', COALESCE(x.amount, 0)) ORDER BY cc)
                       FROM generate_series(0, 7) cc LEFT JOIN hc x ON x.r = rr AND x.c = cc) ORDER BY rr)
                     FROM generate_series(0, 6) rr),
           'outside', (SELECT count(*) FROM h WHERE h.c IS NULL),
           'days30', v_heat_from IS NOT NULL)
    INTO v_heat;

  -- Soirées qui ont vendu dans la fenêtre (les 7 premières, puis le reste).
  WITH per AS (
    SELECT a.event_id, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid,
           sum(a.qty) FILTER (WHERE a.price = 0) AS free,
           count(*) FILTER (WHERE a.pillar = 'tables') AS tables
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL AND a.event_id IS NOT NULL GROUP BY 1
  ), tot AS (
    SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), rows AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming, p.tickets, p.revenue, COALESCE(t.sold, 0) AS sold,
           COALESCE(p.paid, 0) AS paid, COALESCE(p.free, 0) AS free, COALESCE(p.tables, 0) AS tables,
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
           'tickets', tickets, 'paid', paid, 'free', free, 'tables', tables, 'revenue', revenue, 'sold', sold, 'cap', cap, 'prev_sold', prev_sold
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
    'sends', public._tix_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

-- ── Trafic (miroir de crm_ana_traffic__core, + les visites de la page de vente) ──
CREATE OR REPLACE FUNCTION public.tix_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
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
  v_visits jsonb; v_from timestamptz; v_to timestamptz; v_pfrom timestamptz; v_ids uuid[];
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Ce que Yuno mesure et que Shotgun ne rapporte pas : les visites de la
  -- page de vente et leur passage vers l'achat (visitor_sessions, mêmes
  -- étapes que get_visit_analytics : panier = a choisi, paiement = a ouvert le
  -- paiement, achat = une vente payée est née de la visite).
  SELECT array_agg(e.id) INTO v_ids FROM _aev e;
  IF m->>'mode' = 'event' THEN
    v_from := '-infinity'; v_to := 'infinity'; v_pfrom := NULL;
  ELSIF m->>'mode' = 'hour' THEN
    v_from := (m->>'start')::timestamptz; v_to := v_from + make_interval(hours => v_n);
    v_pfrom := v_from - make_interval(hours => v_n);
  ELSIF m->>'mode' = 'month' THEN
    v_from := ((m->>'start')::date + make_interval(hours => (m->>'night_end_hour')::int)) AT TIME ZONE (m->>'tz');
    v_to := now(); v_pfrom := ((m->>'start')::date - interval '12 months' + make_interval(hours => (m->>'night_end_hour')::int)) AT TIME ZONE (m->>'tz');
  ELSE
    v_from := ((m->>'start')::date + make_interval(hours => (m->>'night_end_hour')::int)) AT TIME ZONE (m->>'tz');
    v_to := now(); v_pfrom := v_from - make_interval(days => v_n);
  END IF;
  WITH vs AS (
    SELECT s.visited_at, COALESCE(s.added_to_cart, false) AS cart, COALESCE(s.proceeded_to_checkout, false) AS checkout,
           COALESCE(s.completed_order, false) AS done, s.event_id,
           CASE WHEN s.visited_at >= v_from AND s.visited_at < v_to THEN 0
                WHEN v_pfrom IS NOT NULL AND s.visited_at >= v_pfrom AND s.visited_at < v_from THEN 1 END AS w
      FROM public.visitor_sessions s
     WHERE CASE WHEN m->>'mode' = 'event' THEN s.event_id = (m->'event'->>'id')::uuid
                ELSE (p_venue_id IS NOT NULL AND s.venue_id = p_venue_id)
                  OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id)
                  OR s.event_id = ANY (COALESCE(v_ids, '{}'::uuid[])) END
       AND s.visited_at >= COALESCE(v_pfrom, v_from)
  )
  SELECT jsonb_build_object(
           'visits', count(*) FILTER (WHERE w = 0), 'carts', count(*) FILTER (WHERE w = 0 AND cart),
           'checkouts', count(*) FILTER (WHERE w = 0 AND checkout), 'orders', count(*) FILTER (WHERE w = 0 AND done),
           'prev_visits', CASE WHEN v_pfrom IS NOT NULL THEN count(*) FILTER (WHERE w = 1) END,
           'prev_orders', CASE WHEN v_pfrom IS NOT NULL THEN count(*) FILTER (WHERE w = 1 AND done) END,
           'series', (SELECT jsonb_agg(COALESCE(b.n, 0) ORDER BY g)
                        FROM generate_series(0, v_n - 1) g
                        LEFT JOIN (SELECT public._crm_ana_bucket(m, x.visited_at) AS i, count(*) AS n FROM vs x WHERE x.w = 0 GROUP BY 1) b ON b.i = g))
    INTO v_visits FROM vs;


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
         AND NOT public.crm_campaign_is_crm(c.id)
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
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'wa', 'yl', 'pr', 'pa', 'em', 'sm', 'ad', 'pc', 'mk', 'so', 'se', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.tk FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'wa', 'yl', 'pr', 'pa', 'em', 'sm', 'ad', 'pc', 'mk', 'so', 'se', 'au', 'di', 'of']) s(k)),
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
    FROM unnest(ARRAY['ys', 'yb', 'yt', 'wa', 'yl', 'pr', 'pa', 'em', 'sm', 'ad', 'pc', 'mk', 'so', 'se', 'au', 'di', 'of']) WITH ORDINALITY s(k, o)
    LEFT JOIN cur ON cur.src = s.k
    LEFT JOIN prv ON prv.src = s.k
    LEFT JOIN nf ON nf.src = s.k;

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
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id),
           'visits', (SELECT count(*) FROM public.visitor_sessions s WHERE s.event_id = e.id
                        AND (m->>'mode' = 'event' OR (s.visited_at >= v_from AND s.visited_at < v_to)))
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  RETURN jsonb_build_object(
    'meta', m,
    'visits', v_visits,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._tix_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

-- ── Communauté (miroir de crm_ana_community__core) ──
CREATE OR REPLACE FUNCTION public.tix_ana_community__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  -- _crm_ana_setup ne construit la base des personnes que pour un segment.
  IF m->>'seg' = 'all' THEN
    -- Base légère : cet écran ne lit ni la source, ni le profil Shotgun, ni
    -- les messages (_crm_people_build, p_light).
    PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id, NULL, true);
  END IF;
  v_n := (m->>'n')::int;
  v_seg := m->>'seg';
  v_today := (m->>'today')::date;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Les personnes regardées : toute la base, ou le segment ; pour une soirée,
  -- ses acheteurs.
  DROP TABLE IF EXISTS _apeo;
  CREATE TEMP TABLE _apeo ON COMMIT DROP AS
  WITH fb AS (
    SELECT a.email, min(a.bought_at) AS first_buy FROM _atk_all a WHERE a.ok GROUP BY a.email
  ), cr AS (
    -- La fiche (âge, ville) : une ligne par adresse, jointe d'un coup.
    SELECT DISTINCT ON (lower(x.email)) lower(x.email) AS em, x.age, x.city
      FROM _cr x WHERE x.email IS NOT NULL
     ORDER BY lower(x.email), (x.age IS NULL), (x.city IS NULL)
  )
  SELECT p.*, LEAST(p.first_night, p.added_at, fb.first_buy) AS joined_at,
         c.age AS c_age, c.city AS c_city
    FROM _cp p
    LEFT JOIN fb ON fb.email = p.email
    LEFT JOIN cr c ON c.em = p.email
   WHERE (v_seg = 'all' OR p.lifecycle = v_seg)
     AND (m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                            AND a.event_id = (m->'event'->>'id')::uuid));

  -- Courbe : la base au total à la fin de chaque case, et les nouveaux venus.
  -- Pour une soirée : ses acheteurs, jour après jour.
  IF m->>'mode' = 'event' THEN
    -- Une lecture par mesure (20261018100000) au lieu de quatre sous-requêtes
    -- par jour : 22 jours × 4 relisaient tous les billets (1,6 s sur
    -- 48 000 billets). Mêmes règles, jour pour jour :
    --   total      : acheteurs (de la base regardée) dont un billet tombe au
    --                plus tard dans la case → leur première case ;
    --   new        : acheteurs dont un billet de la case est leur PREMIER
    --                billet vendu (aucun billet vendu plus tôt) ;
    --   prev_total / prev_new : idem sur la soirée de comparaison, sans le
    --                filtre de la base (comme avant).
    WITH fm AS MATERIALIZED (
      SELECT a.email, min(a.bought_at) AS mb FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL GROUP BY a.email
    ), ce AS MATERIALIZED (
      SELECT a.email, min(a.ci) AS mci FROM _atk_all a JOIN _apeo p ON p.email = a.email
       WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.email
    ), cn AS MATERIALIZED (
      SELECT a.ci AS g, count(DISTINCT a.email) AS n
        FROM _atk_all a JOIN _apeo p ON p.email = a.email JOIN fm ON fm.email = a.email AND fm.mb = a.bought_at
       WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci
    ), pe AS MATERIALIZED (
      SELECT a.email, min(a.pi) AS mpi FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.email IS NOT NULL GROUP BY a.email
    ), pn AS MATERIALIZED (
      SELECT a.pi AS g, count(DISTINCT a.email) AS n
        FROM _atk_all a JOIN fm ON fm.email = a.email AND fm.mb = a.bought_at
       WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.pi
    )
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(*) FROM ce WHERE ce.mci <= g.g),
             'new', COALESCE((SELECT cn.n FROM cn WHERE cn.g = g.g), 0),
             'prev_total', (SELECT count(*) FROM pe WHERE pe.mpi <= g.g),
             'prev_new', COALESCE((SELECT pn.n FROM pn WHERE pn.g = g.g), 0)
           ) ORDER BY g.g)
      INTO v_series FROM generate_series(0, v_n - 1) g(g);
  ELSE
    -- Une passe sur la base (20261016220000) : la date de nuit, la case et la
    -- case de la période précédente de chaque personne sont calculées UNE
    -- fois, puis comptées par case. Avant, chaque case relisait toute la base
    -- en appelant _crm_ana_bucket (plpgsql) par personne : 2,7 s sur un
    -- compte de 14 000 contacts. Mêmes règles, mot pour mot :
    --   total    : arrivée (nuit) au plus tard à la fin de la case ;
    --   new      : _crm_ana_bucket(m, joined_at) = la case (même calcul, en SQL) ;
    --   prev_new : la tranche de même rang de la période précédente (le rang
    --              candidat est revérifié par le prédicat d'origine).
    WITH pj AS (
      SELECT p.joined_at AS ts,
             public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int) AS nd
        FROM _apeo p
       WHERE p.joined_at IS NOT NULL
    ), pk AS (
      SELECT pj.nd,
             CASE m->>'mode'
               WHEN 'hour' THEN floor(extract(epoch FROM pj.ts - (m->>'start')::timestamptz) / 3600)::int
               WHEN 'day' THEN pj.nd - (m->>'start')::date
               WHEN 'month' THEN ((extract(year FROM pj.nd) - extract(year FROM (m->>'start')::date)) * 12
                                  + extract(month FROM pj.nd) - extract(month FROM (m->>'start')::date))::int
             END AS i,
             CASE m->>'mode'
               WHEN 'hour' THEN floor(extract(epoch FROM pj.ts - ((m->>'start')::timestamptz - make_interval(hours => v_n))) / 3600)::int
               WHEN 'month' THEN ((extract(year FROM pj.nd) - extract(year FROM ((m->>'start')::date - interval '12 months')::date)) * 12
                                  + extract(month FROM pj.nd) - extract(month FROM ((m->>'start')::date - interval '12 months')::date))::int
               ELSE pj.nd - ((m->>'start')::date - v_n)
             END AS pi,
             pj.ts
        FROM pj
    ), pv AS (
      -- Rang de la période précédente, gardé seulement s'il vérifie le prédicat d'origine.
      SELECT pk.nd, CASE WHEN pk.i BETWEEN 0 AND v_n - 1 THEN pk.i END AS i,
             CASE WHEN pk.pi BETWEEN 0 AND v_n - 1 AND CASE m->>'mode'
                     WHEN 'hour' THEN pk.ts >= (m->>'start')::timestamptz - make_interval(hours => v_n - pk.pi)
                                      AND pk.ts < (m->>'start')::timestamptz - make_interval(hours => v_n - pk.pi - 1)
                     WHEN 'month' THEN pk.nd >= ((m->>'start')::date - interval '12 months' + make_interval(months => pk.pi))::date
                                       AND pk.nd < ((m->>'start')::date - interval '12 months' + make_interval(months => pk.pi + 1))::date
                     ELSE pk.nd = (m->>'start')::date - v_n + pk.pi END
                  THEN pk.pi END AS pi
        FROM pk
    ), byd AS MATERIALIZED (
      SELECT pv.nd, count(*) AS c FROM pv GROUP BY pv.nd
    ), byi AS MATERIALIZED (
      SELECT pv.i, count(*) AS c FROM pv WHERE pv.i IS NOT NULL GROUP BY pv.i
    ), byp AS MATERIALIZED (
      SELECT pv.pi, count(*) AS c FROM pv WHERE pv.pi IS NOT NULL GROUP BY pv.pi
    )
    SELECT jsonb_agg(jsonb_build_object(
             'total', COALESCE((SELECT sum(byd.c) FROM byd
                                 WHERE byd.nd <= CASE m->>'mode'
                                   WHEN 'hour' THEN public._crm_night_date((m->>'start')::timestamptz + make_interval(hours => g + 1), m->>'tz', (m->>'night_end_hour')::int)
                                   WHEN 'month' THEN ((m->>'start')::date + make_interval(months => g + 1) - interval '1 day')::date
                                   ELSE (m->>'start')::date + g END), 0)::bigint,
             'new', COALESCE((SELECT byi.c FROM byi WHERE byi.i = g), 0),
             'prev_new', COALESCE((SELECT byp.c FROM byp WHERE byp.pi = g), 0)
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
  -- Une passe (20261016220000) au lieu de six : chaque billet porte le rang k
  -- le plus ancien dont la borne le suit, puis chaque personne compte, pour
  -- chaque k, ses soirées et sa dépense d'avant la borne. Mêmes nombres.
  WITH cut AS (
    -- Les six bornes, de la plus récente (k = 0, maintenant) à la plus ancienne.
    SELECT now() AS c0,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 0)) AT TIME ZONE 'Europe/Paris' AS c1,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 1)) AT TIME ZONE 'Europe/Paris' AS c2,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 2)) AT TIME ZONE 'Europe/Paris' AS c3,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 3)) AT TIME ZONE 'Europe/Paris' AS c4,
           (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => 4)) AT TIME ZONE 'Europe/Paris' AS c5
  ), tk AS (
    -- kk = le plus grand k dont la borne suit l'achat (les bornes reculent avec k).
    SELECT a.email, a.event_id, a.amount,
           CASE WHEN a.bought_at < cut.c5 THEN 5 WHEN a.bought_at < cut.c4 THEN 4 WHEN a.bought_at < cut.c3 THEN 3
                WHEN a.bought_at < cut.c2 THEN 2 WHEN a.bought_at < cut.c1 THEN 1 WHEN a.bought_at < cut.c0 THEN 0 END AS kk
      FROM _atk_all a JOIN _apeo p ON p.email = a.email CROSS JOIN cut
     WHERE a.ok AND a.event_id IS NOT NULL
  ), pe AS (
    -- Par personne et soirée : la borne la plus ancienne qu'un billet précède.
    SELECT tk.email, tk.event_id, max(tk.kk) AS kev FROM tk WHERE tk.kk IS NOT NULL GROUP BY tk.email, tk.event_id
  ), ps AS (
    -- Par personne et rang : la dépense.
    SELECT tk.email, tk.kk, sum(tk.amount) AS s FROM tk WHERE tk.kk IS NOT NULL GROUP BY tk.email, tk.kk
  ), pp AS (
    -- Une ligne par personne, sans jointure entre agrégats (estimations sûres).
    SELECT u.email,
           count(*) FILTER (WHERE u.kev >= 0) AS n0, count(*) FILTER (WHERE u.kev >= 1) AS n1,
           count(*) FILTER (WHERE u.kev >= 2) AS n2, count(*) FILTER (WHERE u.kev >= 3) AS n3,
           count(*) FILTER (WHERE u.kev >= 4) AS n4, count(*) FILTER (WHERE u.kev >= 5) AS n5,
           sum(u.s) FILTER (WHERE u.kk >= 0) AS s0, sum(u.s) FILTER (WHERE u.kk >= 1) AS s1,
           sum(u.s) FILTER (WHERE u.kk >= 2) AS s2, sum(u.s) FILTER (WHERE u.kk >= 3) AS s3,
           sum(u.s) FILTER (WHERE u.kk >= 4) AS s4, sum(u.s) FILTER (WHERE u.kk >= 5) AS s5
      FROM (SELECT pe.email, pe.kev, NULL::integer AS kk, NULL::numeric AS s FROM pe
            UNION ALL
            SELECT ps.email, NULL::integer, ps.kk, ps.s FROM ps) u
     GROUP BY u.email
  ), x AS (
    SELECT v.k, pp.email, v.n, v.s
      FROM pp
     CROSS JOIN LATERAL (VALUES (0, pp.n0, pp.s0), (1, pp.n1, pp.s1), (2, pp.n2, pp.s2),
                                (3, pp.n3, pp.s3), (4, pp.n4, pp.s4), (5, pp.n5, pp.s5)) v(k, n, s)
     WHERE v.n > 0
  )
  SELECT jsonb_agg(jsonb_build_object('returning_pct', q.rp, 'avg_nights', q.an, 'spent', q.sp) ORDER BY q.k DESC)
    INTO v_spark FROM (
      SELECT k,
             round(100.0 * count(*) FILTER (WHERE n >= 2) / NULLIF(count(*), 0), 1) AS rp,
             round(avg(n), 2) AS an, round(avg(s), 2) AS sp
        FROM x
       GROUP BY k) q;

  -- Qui revient : les cinq dernières soirées passées, et la part de leurs
  -- acheteurs revenus aux soirées suivantes (+1 à +4).
  WITH evs AS (
    SELECT e.id, e.title, e.start_at, e.night, row_number() OVER (ORDER BY e.start_at) AS rn
      FROM _aev e WHERE EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
  ), last5 AS (
    SELECT * FROM evs WHERE start_at < now() ORDER BY start_at DESC LIMIT 5
  ), rel AS (
    -- Les seules soirées lues plus bas : les cinq et leurs quatre suivantes
    -- (20261016220000 : la liste des acheteurs n'est plus relue en entier).
    SELECT l.id FROM last5 l
    UNION SELECT nx.id FROM last5 l JOIN evs nx ON nx.rn BETWEEN l.rn + 1 AND l.rn + 4
  ), buyers AS (
    SELECT DISTINCT a.event_id, a.email FROM _atk_all a JOIN _apeo p ON p.email = a.email
     WHERE a.ok AND a.email IS NOT NULL AND a.event_id IN (SELECT rel.id FROM rel)
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
  WITH lg AS (
    SELECT p.lifecycle AS k, count(DISTINCT x.email) AS buyers, COALESCE(round(sum(x.amount), 2), 0) AS revenue
      FROM _atk x JOIN _cp p ON p.email = x.email
     WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle IN ('nou', 'occ', 'hab', 'end')
     GROUP BY p.lifecycle
  )
  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT a.email) FROM _atk a WHERE a.ok AND a.ci IS NOT NULL),
           'groups', (SELECT jsonb_object_agg(g.k, jsonb_build_object(
                          'buyers', COALESCE(lg.buyers, 0),
                          'revenue', COALESCE(lg.revenue, 0)))
                        FROM unnest(ARRAY['nou', 'occ', 'hab', 'end']) g(k) LEFT JOIN lg ON lg.k = g.k))
    INTO v_aud;

  -- Âge et lieu : billets d'abord (déclarés à l'achat), sinon la fiche.
  WITH ta AS (
    SELECT a.email, max(a.age) AS age FROM _atk_all a WHERE a.age BETWEEN 14 AND 99 GROUP BY a.email
  ), tc AS (
    SELECT DISTINCT ON (a.email) a.email, a.city FROM _atk_all a WHERE a.city IS NOT NULL ORDER BY a.email, a.bought_at DESC
  ), pa AS (
    SELECT p.email,
           COALESCE(ta.age, NULLIF(p.c_age, 0)) AS age,
           COALESCE(tc.city, NULLIF(btrim(p.c_city), '')) AS city
      FROM _apeo p
      LEFT JOIN ta ON ta.email = p.email
      LEFT JOIN tc ON tc.email = p.email
  )
  SELECT jsonb_build_object(
           'known', count(*) FILTER (WHERE age IS NOT NULL), 'total', count(*),
           'b', jsonb_build_array(count(*) FILTER (WHERE age BETWEEN 14 AND 21), count(*) FILTER (WHERE age BETWEEN 22 AND 25),
                                  count(*) FILTER (WHERE age BETWEEN 26 AND 30), count(*) FILTER (WHERE age BETWEEN 31 AND 35),
                                  count(*) FILTER (WHERE age >= 36))),
         jsonb_build_object(
           'known', count(*) FILTER (WHERE city IS NOT NULL), 'total', count(*),
           'top', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city', c, 'n', k) ORDER BY k DESC), '[]'::jsonb) FROM (
                     -- initcap par ville distincte, puis regroupement (même compte).
                     SELECT initcap(lower(pc.city)) AS c, sum(pc.n)::bigint AS k
                       FROM (SELECT city, count(*) AS n FROM pa WHERE city IS NOT NULL GROUP BY city) pc
                      GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t))
    INTO v_age, v_city FROM pa;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
           'nights', p.nights, 'spent', p.spent, 'last_night', p.last_night) ORDER BY p.spent DESC), '[]'::jsonb)
    INTO v_top FROM (SELECT email, first_name, last_name, nights, spent, last_night
                       FROM _apeo WHERE nights > 0 ORDER BY spent DESC, nights DESC LIMIT 5) p;

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
$function$;

-- ── Guest list (miroir de crm_ana_guestlist__core) ──
CREATE OR REPLACE FUNCTION public.tix_ana_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_eh integer;
  v_today date;
  v_n integer := CASE p_period WHEN '24h' THEN 1 WHEN '48h' THEN 2 WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_from date;
  v_pfrom date;
  v_out jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT r.night_end_hour INTO v_eh FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r;
  v_today := public._crm_night_date(now(), v_tz, COALESCE(v_eh, 6));
  v_from := v_today - (v_n - 1);
  v_pfrom := v_from - v_n;

  WITH evs AS MATERIALIZED (
    SELECT ev.id, ev.title, ev.start_at, ev.tz, ev.end_at,
           public._crm_night_date(ev.start_at, ev.tz, COALESCE(v_eh, 6)) AS night
      FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) ev
  ), tk AS MATERIALIZED (
    SELECT t.event_id, t.email,
           public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS gl,
           (public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0) AS paid,
           t.amount,
           t.purchased_at AS at, t.scanned_at,
           NULLIF(btrim(t.deal_name), '') AS deal, t.gender, t.age
      FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
     WHERE t.status = 'valid'
  ), ev2 AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, e.tz, e.end_at, e.night,
           count(t.event_id) FILTER (WHERE t.gl IS NOT NULL) AS entries,
           count(t.event_id) FILTER (WHERE t.gl = 'inv') AS inv,
           count(t.event_id) FILTER (WHERE t.gl IS NOT NULL AND t.scanned_at IS NOT NULL) AS came,
           count(t.event_id) FILTER (WHERE t.paid) AS paid,
           count(t.event_id) FILTER (WHERE t.paid AND t.scanned_at IS NOT NULL) AS paid_came,
           (e.end_at <= now()
             AND public._crm_door_measured(count(t.event_id), count(t.event_id) FILTER (WHERE t.scanned_at IS NOT NULL))) AS known,
           CASE WHEN e.night BETWEEN v_from AND v_today AND e.start_at <= now() THEN 'cur'
                WHEN e.night BETWEEN v_pfrom AND v_from - 1 AND e.start_at <= now() THEN 'prev' END AS w
      FROM evs e LEFT JOIN tk t ON t.event_id = e.id
     GROUP BY e.id, e.title, e.start_at, e.tz, e.end_at, e.night
  ), wt AS (
    SELECT w,
           count(*) AS nights,
           count(*) FILTER (WHERE entries > 0) AS gl_nights,
           COALESCE(sum(entries), 0) AS entries, COALESCE(sum(inv), 0) AS inv, COALESCE(sum(came), 0) AS came,
           COALESCE(sum(entries) FILTER (WHERE known), 0) AS k_entries,
           COALESCE(sum(came) FILTER (WHERE known), 0) AS k_came,
           COALESCE(sum(paid_came) FILTER (WHERE known), 0) AS k_paid_came,
           count(*) FILTER (WHERE known AND entries > 0) AS k_nights
      FROM ev2 WHERE w IS NOT NULL
     GROUP BY w
  ), wpeople AS (
    SELECT e.w, count(DISTINCT t.email) AS people
      FROM tk t JOIN ev2 e ON e.id = t.event_id
     WHERE e.w IS NOT NULL AND t.gl IS NOT NULL AND t.email IS NOT NULL
     GROUP BY e.w
  ), wppl AS (
    -- Invités des soirées TERMINÉES de la fenêtre : leur première soirée en guest list.
    SELECT t.email, min(e.start_at) AS first_start
      FROM tk t JOIN ev2 e ON e.id = t.event_id
     WHERE e.w = 'cur' AND e.end_at <= now() AND t.gl IS NOT NULL AND t.email IS NOT NULL
     GROUP BY t.email
  ), wconv AS (
    SELECT w.email,
           bool_or(t.paid AND t.at < w.first_start) AS paid_before,
           min(t.at) FILTER (WHERE t.paid AND t.at > w.first_start) AS paid_after_at,
           COALESCE(sum(t.amount) FILTER (WHERE t.paid AND t.at > w.first_start), 0) AS paid_after
      FROM wppl w JOIN tk t ON t.email = w.email
     GROUP BY w.email
  ), wlists AS (
    SELECT COALESCE(t.deal, '') AS name,
           CASE WHEN bool_and(t.gl = 'inv') THEN 'inv' WHEN bool_and(t.gl = 'free') THEN 'free' ELSE 'mix' END AS kind,
           count(DISTINCT t.event_id) AS nights,
           count(*) AS entries,
           count(*) FILTER (WHERE e.known) AS k_entries,
           count(*) FILTER (WHERE e.known AND t.scanned_at IS NOT NULL) AS k_came,
           count(DISTINCT t.email) FILTER (WHERE c.email IS NOT NULL AND NOT c.paid_before) AS eligible,
           count(DISTINCT t.email) FILTER (WHERE c.email IS NOT NULL AND NOT c.paid_before AND c.paid_after_at IS NOT NULL) AS conv
      FROM tk t
      JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur'
      LEFT JOIN wconv c ON c.email = t.email
     WHERE t.gl IS NOT NULL
     GROUP BY COALESCE(t.deal, '')
  ), arr AS (
    SELECT extract(hour FROM t.scanned_at AT TIME ZONE e.tz)::int AS h,
           count(*) FILTER (WHERE t.gl IS NOT NULL) AS gl,
           count(*) FILTER (WHERE t.paid) AS paid
      FROM tk t JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur' AND e.known
     WHERE t.scanned_at IS NOT NULL
     GROUP BY 1
  ), med AS (
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'gl') AS gl,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'paid') AS paid,
           count(*) FILTER (WHERE k = 'gl') AS n_gl, count(*) FILTER (WHERE k = 'paid') AS n_paid
      FROM (SELECT CASE WHEN t.gl IS NOT NULL THEN 'gl' WHEN t.paid THEN 'paid' END AS k,
                   ((extract(hour FROM t.scanned_at AT TIME ZONE e.tz)::int * 60
                     + extract(minute FROM t.scanned_at AT TIME ZONE e.tz)::int) + 720) % 1440 AS m
              FROM tk t JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur' AND e.known
             WHERE t.scanned_at IS NOT NULL) z
  ), prof AS (
    SELECT k,
           count(*) FILTER (WHERE gender IN ('female', 'male', 'other')) AS g_known,
           count(*) FILTER (WHERE gender = 'female') AS f,
           count(*) FILTER (WHERE age BETWEEN 14 AND 99) AS a_known,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY age::float8) FILTER (WHERE age BETWEEN 14 AND 99) AS age_med
      FROM (SELECT CASE WHEN t.gl IS NOT NULL THEN 'gl' WHEN t.paid THEN 'paid' END AS k, t.gender, t.age
              FROM tk t JOIN ev2 e ON e.id = t.event_id AND e.w = 'cur') z
     WHERE k IS NOT NULL
     GROUP BY k
  ), persons AS (
    -- Tout l'historique, définitions des filtres Clients `loyal` et `noshow`.
    SELECT t.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.gl IS NOT NULL) AS gl_n,
           count(*) FILTER (WHERE t.paid) AS paid_n,
           count(*) FILTER (WHERE t.gl IS NOT NULL AND t.scanned_at IS NULL AND e.known) AS noshow,
           min(e.start_at) FILTER (WHERE t.gl IS NOT NULL) AS gl_first,
           min(t.at) FILTER (WHERE t.paid) AS first_paid
      FROM tk t LEFT JOIN ev2 e ON e.id = t.event_id
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), nxt AS (
    SELECT e.id, e.title, e.start_at, e.tz, e.entries, e.inv,
           (SELECT count(*) FROM tk t WHERE t.event_id = e.id AND t.gl IS NOT NULL
               AND (t.at AT TIME ZONE e.tz)::date = (now() AT TIME ZONE e.tz)::date) AS today
      FROM ev2 e WHERE e.start_at > now()
     ORDER BY e.start_at LIMIT 1
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('period', p_period, 'days', v_n, 'from', v_from, 'to', v_today, 'today', v_today),
    'has_any', EXISTS (SELECT 1 FROM tk WHERE tk.gl IS NOT NULL),
    'totals', (SELECT jsonb_build_object(
        'nights', COALESCE(c.nights, 0), 'gl_nights', COALESCE(c.gl_nights, 0),
        'entries', COALESCE(c.entries, 0), 'inv', COALESCE(c.inv, 0), 'came', COALESCE(c.came, 0),
        'people', COALESCE((SELECT people FROM wpeople WHERE w = 'cur'), 0),
        'scan_nights', COALESCE(c.k_nights, 0),
        'showup', CASE WHEN c.k_entries >= 10 THEN round(100.0 * c.k_came / c.k_entries, 1) END,
        'free_share', CASE WHEN c.k_came + c.k_paid_came >= 10 THEN round(100.0 * c.k_came / (c.k_came + c.k_paid_came), 1) END,
        'prev_nights', COALESCE(pr.nights, 0),
        'prev_entries', COALESCE(pr.entries, 0),
        'prev_people', COALESCE((SELECT people FROM wpeople WHERE w = 'prev'), 0),
        'prev_showup', CASE WHEN pr.k_entries >= 10 THEN round(100.0 * pr.k_came / pr.k_entries, 1) END,
        'prev_free_share', CASE WHEN pr.k_came + pr.k_paid_came >= 10 THEN round(100.0 * pr.k_came / (pr.k_came + pr.k_paid_came), 1) END)
        FROM (SELECT 1) one
        LEFT JOIN wt c ON c.w = 'cur'
        LEFT JOIN wt pr ON pr.w = 'prev'),
    'conv', (SELECT jsonb_build_object(
        'eligible', count(*) FILTER (WHERE NOT c.paid_before),
        'converted', count(*) FILTER (WHERE NOT c.paid_before AND c.paid_after_at IS NOT NULL),
        'revenue', round(COALESCE(sum(c.paid_after) FILTER (WHERE NOT c.paid_before AND c.paid_after_at IS NOT NULL), 0), 2),
        'median_days', (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY GREATEST(0, (c2.paid_after_at::date - w2.first_start::date)))
                          FROM wconv c2 JOIN wppl w2 ON w2.email = c2.email
                         WHERE NOT c2.paid_before AND c2.paid_after_at IS NOT NULL))
        FROM wconv c),
    'nights', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', z.id, 'title', z.title, 'start_at', z.start_at, 'tz', z.tz, 'live', z.end_at > now(),
        'entries', z.entries, 'inv', z.inv, 'came', z.came, 'paid_came', z.paid_came, 'scan_known', z.known,
        'showup', CASE WHEN z.known AND z.entries >= 10 THEN round(100.0 * z.came / z.entries, 1) END) ORDER BY z.start_at), '[]'::jsonb)
        FROM (SELECT * FROM ev2 WHERE w = 'cur' ORDER BY start_at DESC LIMIT 40) z),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', NULLIF(l.name, ''), 'kind', l.kind, 'nights', l.nights, 'entries', l.entries,
        'showup', CASE WHEN l.k_entries >= 10 THEN round(100.0 * l.k_came / l.k_entries, 1) END,
        'eligible', l.eligible, 'conv', l.conv,
        'conv_pct', CASE WHEN l.eligible >= 10 THEN round(100.0 * l.conv / l.eligible, 1) END)
        ORDER BY l.entries DESC, l.name), '[]'::jsonb) FROM (SELECT * FROM wlists ORDER BY entries DESC LIMIT 12) l),
    'arrivals', (SELECT jsonb_build_object(
        'slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('h', r.h, 'gl', r.gl, 'paid', r.paid) ORDER BY (r.h + 12) % 24) FROM arr r), '[]'::jsonb),
        'gl_med', CASE WHEN m.n_gl >= 10 THEN m.gl END,
        'paid_med', CASE WHEN m.n_paid >= 10 THEN m.paid END)
        FROM med m),
    'profile', (SELECT COALESCE(jsonb_object_agg(pr.k, jsonb_build_object(
        'known', pr.g_known,
        'female_pct', CASE WHEN pr.g_known >= 10 THEN round(100.0 * pr.f / pr.g_known, 1) END,
        'age_known', pr.a_known,
        'age_med', CASE WHEN pr.a_known >= 10 THEN round(pr.age_med::numeric, 0) END)), '{}'::jsonb)
        FROM prof pr),
    'loyal', (SELECT count(*) FROM persons WHERE gl_n >= 3 AND paid_n = 0),
    'noshow', (SELECT count(*) FROM persons WHERE noshow >= 2),
    -- Devenus clients sur tout l'historique : filtre Clients `conv`.
    'conv_all', (SELECT count(*) FROM persons WHERE gl_first IS NOT NULL AND first_paid > gl_first),
    'next', (SELECT jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at, 'tz', x.tz,
                                       'entries', x.entries, 'inv', x.inv, 'today', x.today) FROM nxt x)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

-- ── Attribution d'un e-mail (miroir de _crm_email_attrib, campagnes de Yuno Tickets) ──
CREATE OR REPLACE FUNCTION public._tix_email_attrib(p_venue_id text, p_organizer_user_id uuid)
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
  -- La billetterie de Yuno Tickets est yunoapp.eu (reconnue par _crm_is_ticketing_link).
  v_hosts := '{}'::text[];

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND NOT public.crm_campaign_is_crm(c.id)
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM (SELECT x.id, x.email, x.amount, x.purchased_at AS bought_at
              FROM public._tix_sales(p_venue_id, p_organizer_user_id) x
             WHERE public._crm_ticket_is_sale(x.status, x.deal_channel) AND x.email IS NOT NULL) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);
  SELECT count(*) INTO v_n FROM _cma;
  RETURN v_n;
END;
$function$;

-- ── Parcours client (miroir de crm_journey__core) ──
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
  v_ch text := CASE WHEN p_channel IN ('email', 'sms', 'ig') THEN p_channel ELSE 'all' END;
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
  END IF;

  PERFORM public._tix_people_build(p_venue_id, p_organizer_user_id);
  PERFORM public._tix_email_attrib(p_venue_id, p_organizer_user_id);

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
     AND NOT public.crm_campaign_is_crm(c.id)
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
     AND NOT public.crm_campaign_is_crm(c.id)
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_to, 'days', v_days, 'seg', v_seg, 'channel', v_ch,
    'campaign', CASE WHEN v_camp_id IS NOT NULL THEN jsonb_build_object('id', v_camp_id, 'sent_at', v_camp_at) END,
    'funnel', v_funnel, 'prev', v_prev, 'spark', v_spark, 'bars', v_bars, 'steps', v_steps, 'delays', v_delays,
    'paths', v_paths, 'cover', v_cover, 'campaigns', v_camps, 'examples', v_examples, 'options', v_options,
    'thanks_auto', EXISTS (SELECT 1 FROM public.email_automations a WHERE a.kind = 'post_event_thanks' AND a.enabled AND a.product IS NULL
                            AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id),
    'has_campaigns', EXISTS (SELECT 1 FROM _cmc c JOIN public.email_campaigns ec ON ec.id = c.id
                              WHERE ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL),
    -- La billetterie est Yuno : les ventes sont toujours là.
    'has_connection', true
  );
END;
$function$;

-- ── Les lectures de la Console (une par écran) ────────────────────────────
-- Montants à null pour qui ne voit pas l'argent (même enveloppe que le CRM).
CREATE OR REPLACE FUNCTION public._tix_money_gate(p jsonb, p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public._tix_money(p_venue_id, p_organizer_user_id) THEN p ELSE public._crm_null_money(p) END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_sales(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_sales__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_traffic(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_traffic__core(p_venue_id, p_organizer_user_id, p_period, p_event), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_community(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_community__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_guestlist(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_guestlist__core(p_venue_id, p_organizer_user_id, p_period), p_venue_id, p_organizer_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.tix_journey(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_campaign uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'all'::text, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_journey__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_campaign, p_channel, p_seg), p_venue_id, p_organizer_user_id);
$function$;

-- Les soirées du sélecteur « Soirée » : places vendues (billets) et jauge.
CREATE OR REPLACE FUNCTION public.tix_ana_nights(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'now', now(),
    'money', public._tix_money(p_venue_id, p_organizer_user_id),
    'rules', (SELECT jsonb_build_object('regular_min_nights', r.regular_min_nights, 'regular_window_months', r.regular_window_months,
                                        'lapse_months', r.lapse_months)
                FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r),
    'nights', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'start_at', e.start_at, 'upcoming', e.end_at > now(),
        'sold', COALESCE(s.sold, 0),
        'cap', public._crm_night_capacity(NULL,
                 CASE WHEN COALESCE(e.max_tickets, 0) > 0 THEN jsonb_build_array(jsonb_build_object('quantity', e.max_tickets))
                      ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('quantity', CASE WHEN COALESCE(r.max_tickets, 0) > 0 THEN r.max_tickets END)), '[]'::jsonb)
                              FROM public.ticket_rounds r WHERE r.event_id = e.id) END,
                 COALESCE(s.sold, 0)::bigint)
      ) ORDER BY e.start_at DESC), '[]'::jsonb)
      FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) e
      LEFT JOIN (SELECT t.event_id, sum(GREATEST(COALESCE(t.quantity, 1), 1)) AS sold
                   FROM public.tickets t WHERE t.status IN ('paid', 'used') GROUP BY 1) s ON s.event_id = e.id));
END;
$function$;


-- ── La guest list d'une soirée (miroir de crm_night_guestlist__core) ──────
-- L'écran Analyses › Guest list quand une soirée est choisie. Mêmes règles :
-- « venu » seulement sur une porte mesurée, la fois d'avant de la même série,
-- première fois / déjà en guest list / clients payants, devenus clients.
CREATE OR REPLACE FUNCTION public.tix_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record;
  p record;
  v_tz text;
  v_day date;
  v_today date;
  v_phase text;
  v_series text;
  v_d_end integer;
  v_d_start integer;
  v_known boolean;
  v_pknown boolean;
  v_out jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT ev.* INTO e FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) ev WHERE ev.id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  v_tz := e.tz;
  v_day := (e.start_at AT TIME ZONE v_tz)::date;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_phase := CASE WHEN e.start_at > now() THEN 'upcoming' WHEN e.end_at > now() THEN 'live' ELSE 'past' END;
  v_series := lower(COALESCE(public._crm_night_series(e.title), e.title));
  v_d_end := CASE WHEN v_phase = 'upcoming' THEN GREATEST(0, v_day - v_today) ELSE 0 END;

  WITH sx AS MATERIALIZED (
    SELECT * FROM public._tix_sales(p_venue_id, p_organizer_user_id)
  ), dm AS (
    SELECT s.event_id, public._crm_door_measured(count(*), count(*) FILTER (WHERE s.scanned_at IS NOT NULL)) AS ok
      FROM sx s WHERE s.status = 'valid' GROUP BY s.event_id
  )
  SELECT (SELECT d.ok FROM dm d WHERE d.event_id = p_event_id) INTO v_known;
  v_known := v_phase = 'past' AND COALESCE(v_known, false);

  -- La fois d'avant : même série, sinon la soirée passée précédente — avec une guest list.
  SELECT ev.id, ev.title, ev.start_at, ev.tz,
         lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series AS same_series
    INTO p
    FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) ev
   WHERE ev.id <> p_event_id AND ev.start_at < e.start_at AND ev.end_at <= now()
     AND EXISTS (SELECT 1 FROM public._tix_sales(p_venue_id, p_organizer_user_id) t
                  WHERE t.event_id = ev.id AND public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL)
   ORDER BY (lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series) DESC, ev.start_at DESC
   LIMIT 1;

  WITH sx AS MATERIALIZED (
    SELECT * FROM public._tix_sales(p_venue_id, p_organizer_user_id)
  ), evs AS MATERIALIZED (
    SELECT * FROM public._tix_scope_events(p_venue_id, p_organizer_user_id)
  ), night AS MATERIALIZED (
    SELECT t.email, t.status, t.raw_status,
           public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS gl,
           (public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0) AS paid,
           t.purchased_at AS at, t.scanned_at,
           NULLIF(btrim(t.deal_name), '') AS deal, t.gender, t.age,
           NULLIF(split_part(btrim(t.full_name), ' ', 1), '') AS fn,
           CASE WHEN position(' ' IN btrim(COALESCE(t.full_name, ''))) > 0
                THEN NULLIF(regexp_replace(btrim(t.full_name), '^.*\s', ''), '') END AS ln,
           GREATEST(0, v_day - (t.purchased_at AT TIME ZONE v_tz)::date) AS d
      FROM sx t
     WHERE t.event_id = p_event_id
  ), gl AS (
    SELECT * FROM night WHERE gl IS NOT NULL
  ), pv AS (
    SELECT t.scanned_at,
           GREATEST(0, (p.start_at AT TIME ZONE p.tz)::date - (t.purchased_at AT TIME ZONE p.tz)::date) AS d
      FROM sx t
     WHERE p.id IS NOT NULL AND t.event_id = p.id
       AND public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL
  ), pdm AS (
    SELECT p.id IS NOT NULL AND (SELECT public._crm_door_measured(count(*), count(*) FILTER (WHERE s.scanned_at IS NOT NULL))
                                   FROM sx s WHERE s.event_id = p.id AND s.status = 'valid') AS ok
  ), ppl AS (
    SELECT g.email, min(g.at) AS at, min(g.scanned_at) AS scanned_at,
           (array_agg(g.deal ORDER BY g.at))[1] AS deal, (array_agg(g.gl ORDER BY g.at))[1] AS kind,
           max(g.fn) AS fn, max(g.ln) AS ln, count(*) AS n
      FROM gl g WHERE g.email IS NOT NULL
     GROUP BY g.email
  ), pa AS (
    SELECT pp.email,
           COALESCE(bool_or(public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
                   AND t.purchased_at < e.start_at
                   AND t.event_id IS DISTINCT FROM p_event_id), false) AS paid_before,
           COALESCE(bool_or(t.event_id IS DISTINCT FROM p_event_id
                   AND ((ev.start_at < e.start_at
                         AND (public._crm_ticket_is_sale(t.status, t.deal_channel)
                              OR public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL))
                     OR (public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
                         AND t.purchased_at < e.start_at))), false) AS seen_before,
           min(t.purchased_at) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
               AND t.purchased_at > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id) AS paid_after_at,
           COALESCE(sum(t.amount) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
               AND t.purchased_at > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id), 0) AS paid_after,
           COALESCE(bool_or(ev.start_at > e.start_at
                   AND (public._crm_ticket_is_sale(t.status, t.deal_channel)
                        OR public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL)), false) AS later
      FROM ppl pp
      JOIN sx t ON t.email = pp.email
      LEFT JOIN evs ev ON ev.id = t.event_id
     GROUP BY pp.email
  ), lists AS (
    SELECT COALESCE(g.deal, '') AS name,
           CASE WHEN bool_and(g.gl = 'inv') THEN 'inv' WHEN bool_and(g.gl = 'free') THEN 'free' ELSE 'mix' END AS kind,
           count(*) AS entries,
           count(*) FILTER (WHERE g.scanned_at IS NOT NULL) AS came,
           count(DISTINCT g.email) FILTER (WHERE NOT a.seen_before) AS first,
           count(DISTINCT g.email) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL) AS conv
      FROM gl g LEFT JOIN pa a ON a.email = g.email
     GROUP BY COALESCE(g.deal, '')
  ), arr AS (
    SELECT extract(hour FROM n.scanned_at AT TIME ZONE v_tz)::int AS h,
           count(*) FILTER (WHERE n.gl IS NOT NULL) AS gl,
           count(*) FILTER (WHERE n.paid) AS paid
      FROM night n WHERE n.scanned_at IS NOT NULL AND n.status = 'valid'
     GROUP BY 1
  ), med AS (
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'gl') AS gl,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'paid') AS paid
      FROM (SELECT CASE WHEN n.gl IS NOT NULL THEN 'gl' WHEN n.paid THEN 'paid' END AS k,
                   ((extract(hour FROM n.scanned_at AT TIME ZONE v_tz)::int * 60
                     + extract(minute FROM n.scanned_at AT TIME ZONE v_tz)::int) + 720) % 1440 AS m
              FROM night n WHERE n.scanned_at IS NOT NULL AND n.status = 'valid') z
  ), prof AS (
    SELECT k,
           count(*) FILTER (WHERE gender IN ('female', 'male', 'other')) AS g_known,
           count(*) FILTER (WHERE gender = 'female') AS f,
           count(*) FILTER (WHERE age BETWEEN 14 AND 99) AS a_known,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY age::float8) FILTER (WHERE age BETWEEN 14 AND 99) AS age_med
      FROM (SELECT CASE WHEN n.gl IS NOT NULL THEN 'gl' WHEN n.paid THEN 'paid' END AS k, n.gender, n.age
              FROM night n) z
     WHERE k IS NOT NULL
     GROUP BY k
  ), tot AS (
    SELECT count(*) FILTER (WHERE gl IS NOT NULL) AS entries,
           count(*) FILTER (WHERE gl = 'inv') AS inv,
           count(*) FILTER (WHERE gl = 'free') AS free,
           count(*) FILTER (WHERE gl IS NOT NULL AND scanned_at IS NOT NULL) AS came,
           count(*) FILTER (WHERE paid) AS paid,
           count(*) FILTER (WHERE paid AND scanned_at IS NOT NULL) AS paid_came,
           count(*) FILTER (WHERE gl IS NOT NULL AND (at AT TIME ZONE v_tz)::date = v_today) AS today,
           -- Guest list Yuno : une inscription en attente de validation.
           count(*) FILTER (WHERE gl = 'inv' AND raw_status = 'pending' AND scanned_at IS NULL) AS pending,
           0 AS rejected,
           count(*) FILTER (WHERE status = 'valid' AND scanned_at IS NOT NULL) AS scanned
      FROM night
  )
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
               'end_at', e.end_at, 'tz', v_tz, 'phase', v_phase, 'url', NULL),
    'scan_known', v_known,
    'totals', (SELECT jsonb_build_object(
        'entries', t.entries, 'inv', t.inv, 'free', t.free,
        'people', (SELECT count(*) FROM ppl),
        'came', t.came, 'paid', t.paid, 'paid_came', t.paid_came, 'today', t.today,
        'pending', t.pending, 'rejected', t.rejected,
        'showup', CASE WHEN v_known AND t.entries >= 10 THEN round(100.0 * t.came / t.entries, 1) END,
        'paid_showup', CASE WHEN v_known AND t.paid >= 10 THEN round(100.0 * t.paid_came / t.paid, 1) END,
        'free_share', CASE WHEN (v_known OR (v_phase = 'live' AND t.scanned > 0)) AND t.came + t.paid_came >= 10
                           THEN round(100.0 * t.came / (t.came + t.paid_came), 1) END)
        FROM tot t),
    'prev', CASE WHEN p.id IS NOT NULL THEN (
        SELECT jsonb_build_object('id', p.id, 'title', p.title, 'start_at', p.start_at, 'same_series', p.same_series,
                 'entries', count(*), 'came', count(*) FILTER (WHERE pv.scanned_at IS NOT NULL),
                 'same_day', count(*) FILTER (WHERE pv.d >= v_d_end),
                 'showup', CASE WHEN (SELECT ok FROM pdm) AND count(*) >= 10
                                THEN round(100.0 * count(*) FILTER (WHERE pv.scanned_at IS NOT NULL) / count(*), 1) END)
          FROM pv) END,
    'curve', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'd', s.d,
                'v', (SELECT count(*) FROM gl WHERE gl.d >= s.d),
                'pv', CASE WHEN p.id IS NOT NULL THEN (SELECT count(*) FROM pv WHERE pv.d >= s.d) END) ORDER BY s.d DESC), '[]'::jsonb)
                FROM generate_series(v_d_end, GREATEST(v_d_end, LEAST(60, GREATEST(v_d_end, COALESCE((SELECT max(gl.d) FROM gl), v_d_end))))) AS s(d)),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'name', NULLIF(l.name, ''), 'kind', l.kind, 'entries', l.entries, 'came', l.came,
                'showup', CASE WHEN v_known AND l.entries >= 10 THEN round(100.0 * l.came / l.entries, 1) END,
                'first', l.first, 'conv', CASE WHEN v_phase = 'past' THEN l.conv END)
                ORDER BY l.entries DESC, l.name), '[]'::jsonb) FROM lists l),
    'who', (SELECT jsonb_build_object(
              'first', count(*) FILTER (WHERE NOT a.seen_before),
              'gl', count(*) FILTER (WHERE a.seen_before AND NOT a.paid_before),
              'buyers', count(*) FILTER (WHERE a.seen_before AND a.paid_before))
              FROM ppl pp JOIN pa a ON a.email = pp.email),
    'after', CASE WHEN v_phase = 'past' THEN (SELECT jsonb_build_object(
              'eligible', count(*) FILTER (WHERE NOT a.paid_before),
              'converted', count(*) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL),
              'revenue', round(COALESCE(sum(a.paid_after) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL), 0), 2),
              'back', count(*) FILTER (WHERE a.later))
              FROM ppl pp JOIN pa a ON a.email = pp.email) END,
    'arrivals', (SELECT jsonb_build_object(
              'slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('h', r.h, 'gl', r.gl, 'paid', r.paid)
                                   ORDER BY (r.h + 12) % 24) FROM arr r), '[]'::jsonb),
              'gl_med', CASE WHEN (SELECT count(*) FROM gl WHERE gl.scanned_at IS NOT NULL) >= 10 THEN m.gl END,
              'paid_med', CASE WHEN (SELECT count(*) FROM night n WHERE n.paid AND n.scanned_at IS NOT NULL) >= 10 THEN m.paid END)
              FROM med m),
    'profile', (SELECT COALESCE(jsonb_object_agg(pr.k, jsonb_build_object(
              'known', pr.g_known,
              'female_pct', CASE WHEN pr.g_known >= 10 THEN round(100.0 * pr.f / pr.g_known, 1) END,
              'age_known', pr.a_known,
              'age_med', CASE WHEN pr.a_known >= 10 THEN round(pr.age_med::numeric, 0) END)), '{}'::jsonb)
              FROM prof pr),
    'people', (SELECT COALESCE(jsonb_agg(z.x ORDER BY z.o1, z.o2 NULLS LAST, z.o3 DESC), '[]'::jsonb) FROM (
              SELECT jsonb_build_object(
                       'email', pp.email,
                       'name', NULLIF(btrim(COALESCE(pp.fn, '') || ' ' || COALESCE(left(pp.ln, 1) || '.', '')), ''),
                       'list', pp.deal, 'kind', pp.kind, 'n', pp.n,
                       'came', pp.scanned_at IS NOT NULL, 'scanned_at', pp.scanned_at, 'at', pp.at,
                       'tag', CASE WHEN NOT a.seen_before THEN 'first' WHEN a.paid_before THEN 'buyer' ELSE 'gl' END,
                       'conv', v_phase = 'past' AND NOT a.paid_before AND a.paid_after_at IS NOT NULL) AS x,
                     (v_phase <> 'upcoming' AND pp.scanned_at IS NULL) AS o1,
                     CASE WHEN v_phase <> 'upcoming' THEN pp.scanned_at END AS o2,
                     pp.at AS o3
                FROM ppl pp JOIN pa a ON a.email = pp.email
               ORDER BY 2, 3 NULLS LAST, 4 DESC
               LIMIT 80) z),
    'synced_at', NULL
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_night_guestlist(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_night_guestlist__core(p_venue_id, p_organizer_user_id, p_event_id), p_venue_id, p_organizer_user_id);
$function$;

-- La lecture seule des aperçus démo laisse passer ces écrans (tables temporaires).
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
    -- dates repères de l'écran Segments, calculées après coup (20261016230000)
    'crm_segments_fill_anchors',
    'crm_email_overview', 'crm_email_campaigns', 'crm_email_analysis',
    'crm_email_result', 'crm_email_result_segments', 'crm_email_recipients',
    'crm_email_recipient_emails', 'crm_email_send_options',
    'crm_email_audience_preview', 'crm_email_audience_sizes',
    'crm_night_detail', 'crm_rules_preview',
    'crm_ana_sales', 'crm_ana_traffic', 'crm_ana_community',
    'crm_journey', 'crm_automations',
    'crm_sms_overview', 'crm_sms_campaigns', 'crm_sms_result', 'crm_sms_analysis',
    'crm_sms_send_options', 'crm_sms_audience_preview', 'crm_sms_settings_get', 'crm_sms_draft_sizes',
    -- catalogue de segments (20261008200000)
    'crm_segment_catalog',
    -- « Qui cibler » (20261011110000) : il construit `_cp`, il manquait ici
    'crm_night_targets',
    -- Scénarios (20261016140000) : effectifs, « Avant de publier », rapport
    'crm_scenario_counts', 'crm_scenario_preview', 'crm_scenario_report',
    -- Plan de soirée (20261016155000) : il passe par « Qui cibler »
    'crm_night_plan',
    -- Yuno Tickets › Analyses (20261109300000) : mêmes calculs que le CRM
    'tix_ana_sales', 'tix_ana_traffic', 'tix_ana_community', 'tix_journey'
  ]::text[]);
$function$;

-- ── Droits : seules les lectures de la Console sont appelables ────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE '\_tix\_%' OR p.proname LIKE 'tix\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname IN ('tix_ana_sales', 'tix_ana_traffic', 'tix_ana_community', 'tix_ana_guestlist', 'tix_journey', 'tix_ana_nights', 'tix_night_guestlist') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;
