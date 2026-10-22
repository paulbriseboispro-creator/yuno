-- Yuno Tickets › Analyses › Ventes, lot 1 du plan combiné
-- (docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md, décisions de Paul du 22/10).
--
-- Ce que la Billetterie avait et que la copie du CRM n'avait pas, calculé par la
-- base (jamais dans le navigateur, jamais plafonné à 1 000 lignes) :
--
--   1. un PILIER (`p_pillar` : all | tickets | tables | guestlist | refunds) qui
--      restreint héros, tuiles, heure des achats, tarifs et soirées à un pilier ;
--      une table VIP y compte pour UNE vente, une inscription guest list aussi ;
--   2. les tuiles d'un pilier : tables (remplissage, panier, minimum, acomptes),
--      guest list (venus sur une porte mesurée, inscrits par soirée),
--      remboursements (montant et nombre à la date du remboursement, motifs,
--      soirées qui remboursent) ;
--   3. « Ce que vous touchez » : volume brut − remboursements = CA ; − Stripe =
--      net (formules de src/utils/fees.ts : Stripe 1,5 % + 0,25 € sur ce qui est
--      payé en ligne, rien sur une table réglée sur place), et la part de la
--      portée sur une co-soirée d'après le contrat (estimation ; une soirée à
--      barème ou une co-organisation se lit dans son décompte) ;
--   4. pour chaque soirée : les entrées à la porte (_door_headcount, porte
--      mesurée _crm_door_measured) et son bilan (CA de toute la soirée, cachets
--      DJ, reste), qui remplacent le « Bilan par soirée ».
--
-- Tout montant sort sous une clé `revenue`, `prev_revenue` ou `amount` : sans
-- l'accès à l'argent, l'enveloppe (_tix_money_gate → _crm_null_money) l'efface.
-- Aucune fonction du CRM n'est modifiée.

-- ── La case d'un instant, règle de _tix_ana_setup ─────────────────────────
-- Une date (ici : celle d'un remboursement) dans les cases de l'écran, la
-- période en cours ou celle d'avant ; d'une soirée, J-21 → J (de la soirée
-- choisie, ou de la précédente pour la comparaison).
CREATE OR REPLACE FUNCTION public._tix_bucket(p_ts timestamptz, p_event uuid, m jsonb, p_prev boolean)
RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_mode text := m->>'mode';
  v_n int := (m->>'n')::int;
  v_nd date;
  v_start timestamptz;
  v_d0 date;
  v_m0 date;
  v_night date;
BEGIN
  IF p_ts IS NULL THEN RETURN NULL; END IF;
  v_nd := public._crm_night_date(p_ts, m->>'tz', (m->>'night_end_hour')::int);
  IF v_mode = 'hour' THEN
    v_start := (m->>'start')::timestamptz - CASE WHEN p_prev THEN make_interval(hours => v_n) ELSE interval '0' END;
    IF p_ts >= v_start AND p_ts < v_start + make_interval(hours => v_n) THEN
      RETURN floor(extract(epoch FROM p_ts - v_start) / 3600)::int;
    END IF;
    RETURN NULL;
  ELSIF v_mode = 'day' THEN
    v_d0 := (m->>'start')::date - CASE WHEN p_prev THEN v_n ELSE 0 END;
    RETURN CASE WHEN v_nd BETWEEN v_d0 AND v_d0 + v_n - 1 THEN v_nd - v_d0 END;
  ELSIF v_mode = 'month' THEN
    v_m0 := ((m->>'start')::date - CASE WHEN p_prev THEN interval '12 months' ELSE interval '0' END)::date;
    RETURN CASE WHEN v_nd >= v_m0 AND v_nd < (v_m0 + interval '12 months')::date AND v_nd <= (m->>'today')::date
                THEN ((extract(year FROM v_nd) - extract(year FROM v_m0)) * 12 + extract(month FROM v_nd) - extract(month FROM v_m0))::int END;
  END IF;
  -- Une soirée : J-21 → J, comme les ventes.
  IF p_prev THEN
    IF p_event IS DISTINCT FROM (m->'prev_event'->>'id')::uuid THEN RETURN NULL; END IF;
    v_night := (m->'prev_event'->>'night')::date;
  ELSE
    IF p_event IS DISTINCT FROM (m->'event'->>'id')::uuid THEN RETURN NULL; END IF;
    v_night := (m->'event'->>'night')::date;
  END IF;
  RETURN 21 - LEAST(21, GREATEST(0, v_night - v_nd));
END;
$$;

-- ── Les remboursements de la portée ──────────────────────────────────────
-- Billets et tables VIP rendus en tout ou en partie, à la date du
-- remboursement. Montant côté club (fees.ts) : une vente remboursée en totalité
-- rend toute sa part club (même règle que _tix_sales), un remboursement partiel
-- son montant, plafonné à cette part. Une soirée dont la portée ne voit pas
-- l'argent compte ses remboursements, à 0 €.
CREATE OR REPLACE FUNCTION public._tix_refund_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(id uuid, event_id uuid, pillar text, email text, refunded_at timestamptz, amount numeric, reason text, full_refund boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS MATERIALIZED (
    SELECT s.id, s.money FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) s
  )
  SELECT t.id, t.event_id, 'tickets'::text, lower(NULLIF(btrim(t.user_email), '')),
         COALESCE(t.refunded_at, t.paid_at, t.created_at),
         CASE WHEN NOT ev.money THEN 0
              WHEN t.status = 'refunded' THEN x.gross
              ELSE LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0), x.gross) END,
         NULLIF(btrim(t.refund_reason), ''), t.status = 'refunded'
    FROM public.tickets t
    JOIN ev ON ev.id = t.event_id
    CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0) AS gross) x
   WHERE t.status = 'refunded' OR (t.status IN ('paid', 'used') AND COALESCE(t.refund_amount, 0) > 0)
  UNION ALL
  SELECT tr.id, tr.event_id, 'tables'::text, lower(NULLIF(btrim(tr.user_email), '')),
         COALESCE(tr.refunded_at, tr.paid_at, tr.created_at),
         CASE WHEN NOT ev.money THEN 0
              WHEN tr.status = 'refunded' THEN x.gross
              ELSE LEAST(GREATEST(COALESCE(tr.refund_amount, 0), 0), x.gross) END,
         NULLIF(btrim(tr.refund_reason), ''), tr.status = 'refunded'
    FROM public.table_reservations tr
    JOIN ev ON ev.id = tr.event_id
    CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.service_fee, 0)
                                        - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END, 0) AS gross) x
   WHERE tr.status = 'refunded' OR (tr.status IN ('paid', 'confirmed') AND COALESCE(tr.refund_amount, 0) > 0);
$$;

-- ── Le nombre de tables qu'une soirée met en vente ───────────────────────
-- Somme des formules actives de la soirée (ou du club, qui servent toutes ses
-- dates), formules marquées complètes à la main exclues : la règle de
-- _event_tables_left. NULL si la soirée ne vend aucune table.
CREATE OR REPLACE FUNCTION public._tix_event_tables_total(p_event_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NULLIF(COALESCE(sum(p.tables_count), 0), 0)::integer
    FROM public.events e
    JOIN public.table_packs p
      ON p.is_active
     AND (p.event_id = e.id OR (p.event_id IS NULL AND COALESCE(e.venue_id, e.partner_venue_id) IS NOT NULL
                                AND p.venue_id = COALESCE(e.venue_id, e.partner_venue_id)))
     AND NOT (p.id = ANY (COALESCE(e.sold_out_pack_ids, '{}'::uuid[])))
   WHERE e.id = p_event_id;
$$;

-- ── Part de la portée dans une vente d'une co-soirée (en %) ──────────────
-- Soirée sans partenaire : 100. Co-soirée club × organisateur : le bloc du
-- pilier dans revenue_split_rules (lecture de normalizeSplitRules, src/lib/
-- splitRules.ts : organizer_pct, sinon 100 − venue_pct ; bloc absent = 0 / 100
-- club). NULL quand le contrat ne se lit pas vente par vente : barème sur le CA
-- de la soirée, ou co-organisation avec un accord de parts actif.
CREATE OR REPLACE FUNCTION public._tix_party_pct(p_event_id uuid, p_pillar text, p_side text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.event_coorg_deals d WHERE d.event_id = e.id AND d.status = 'active') THEN NULL
    WHEN NOT (COALESCE(e.venue_id, e.partner_venue_id) IS NOT NULL
              AND COALESCE(e.organizer_user_id, e.partner_organizer_id) IS NOT NULL) THEN 100
    WHEN public.is_tiered_collab(e.revenue_split_rules) THEN NULL
    ELSE (SELECT CASE WHEN p_side = 'organizer' THEN o ELSE 100 - o END
            FROM (SELECT LEAST(100, GREATEST(0, COALESCE(
                           NULLIF(b->>'organizer_pct', '')::numeric,
                           100 - NULLIF(b->>'venue_pct', '')::numeric,
                           0))) AS o
                    FROM (SELECT CASE WHEN jsonb_typeof(e.revenue_split_rules->p_pillar) = 'object'
                                      THEN e.revenue_split_rules->p_pillar END AS b) bb) oo)
  END
  FROM public.events e WHERE e.id = p_event_id;
$$;

-- ── Ventes : le cœur, avec le pilier ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.tix_ana_sales(text, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.tix_ana_sales__core(text, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.tix_ana_sales__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text, p_pillar text DEFAULT 'all'::text)
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
  v_pillar text := CASE WHEN p_pillar IN ('tickets', 'tables', 'guestlist', 'refunds') THEN p_pillar ELSE 'all' END;
  v_side text := CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END;
  v_series jsonb; v_tot jsonb; v_msg jsonb; v_fill jsonb; v_seg_share numeric;
  v_target uuid; v_refs uuid[]; v_goal jsonb;
  v_heat jsonb; v_tariffs jsonb; v_events jsonb; v_other jsonb;
  v_heat_from date; v_heat_to date;
  v_cur_from date; v_prev_from date; v_prev_to date;
  v_cut int;
  v_payout jsonb; v_tables jsonb; v_gl jsonb; v_refunds jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;
  m := m || jsonb_build_object('pillar', v_pillar);

  -- Un pilier : l'écran ne lit plus que ses ventes. Une table VIP compte pour
  -- UNE vente (elle n'a pas de place de billetterie), une inscription guest
  -- list aussi (elle n'est pas une vente). `_atk_all` reste entier : la jauge,
  -- la courbe et l'objectif lisent les billets de la soirée.
  IF v_pillar IN ('tickets', 'tables', 'guestlist') THEN
    DELETE FROM _atk WHERE pillar <> v_pillar;
    IF v_pillar = 'tables' THEN UPDATE _atk SET qty = 1; END IF;
    IF v_pillar = 'guestlist' THEN UPDATE _atk SET ok = true; END IF;
  END IF;

  v_cut := CASE WHEN m->>'mode' = 'event' AND COALESCE((m->'event'->>'upcoming')::boolean, false)
                THEN 21 - COALESCE((m->'event'->>'days_left')::int, 0) ELSE v_n - 1 END;

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
           'paid_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL AND COALESCE(price, 0) > 0), 0),
           'free_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND ci IS NOT NULL AND price = 0), 0),
           'prev_paid_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut AND COALESCE(price, 0) > 0), 0),
           'prev_free_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut AND price = 0), 0),
           'buyers', count(DISTINCT email) FILTER (WHERE ok AND ci IS NOT NULL),
           'tables', count(*) FILTER (WHERE ok AND ci IS NOT NULL AND pillar = 'tables'),
           'prev_tables', count(*) FILTER (WHERE ok AND pi <= v_cut AND pillar = 'tables'),
           'table_money', jsonb_build_object(
               'revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND ci IS NOT NULL AND pillar = 'tables'), 2), 0),
               'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut AND pillar = 'tables'), 2), 0)),
           'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE ok AND pi <= v_cut), 2), 0),
           'prev_tickets', COALESCE(sum(qty) FILTER (WHERE ok AND pi <= v_cut), 0),
           'has_prev', bool_or(pi IS NOT NULL),
           'prev_same_day', v_cut < v_n - 1,
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

  -- Ce qui a fait vendre : la part venue d'un message Yuno. En euros quand il
  -- y en a ; sinon (guest list, portée sans l'argent) en ventes.
  SELECT jsonb_build_object(
           'share', CASE WHEN sum(amount) > 0 THEN round(100 * COALESCE(sum(amount) FILTER (WHERE src IN ('em', 'sm')), 0) / sum(amount), 1)
                         WHEN sum(qty) > 0 THEN round(100 * COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm')), 0) / sum(qty), 1) END,
           'basis', CASE WHEN sum(amount) > 0 THEN 'amount' ELSE 'count' END,
           'revenue', COALESCE(round(sum(amount) FILTER (WHERE src IN ('em', 'sm')), 2), 0),
           'tickets', COALESCE(sum(qty) FILTER (WHERE src IN ('em', 'sm')), 0),
           'by', jsonb_build_object(
             'em', COALESCE(sum(qty) FILTER (WHERE src = 'em'), 0),
             'sm', COALESCE(sum(qty) FILTER (WHERE src = 'sm'), 0),
             'dm', COALESCE(sum(qty) FILTER (WHERE src = 'dm'), 0)))
    INTO v_msg FROM _atk WHERE ok AND ci IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('deal', d.deal, 'price', d.price, 'tickets', d.tickets, 'revenue', d.revenue,
                                               'units', d.units, 'pillar', d.pillar)
                            ORDER BY (d.pillar = 'tables'), d.tickets DESC, d.revenue DESC), '[]'::jsonb)
    INTO v_tariffs FROM (
      SELECT COALESCE(a.deal, '—') AS deal, a.pillar, round(avg(a.price), 2) AS price, sum(a.qty) AS tickets,
             round(sum(a.amount), 2) AS revenue, count(*) AS units
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1, 2 ORDER BY (a.pillar = 'tables'), 4 DESC, 5 DESC LIMIT 8) d;

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

  -- Objectif et courbe (billets) : seulement pour « Tout » et « Billets ».
  IF v_pillar IN ('all', 'tickets') THEN
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
  END IF;

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

  -- Soirées qui ont vendu dans la fenêtre (les 7 premières, puis le reste),
  -- avec leur porte et leur bilan (toute la soirée, tous piliers).
  WITH per AS (
    SELECT a.event_id, sum(a.qty) AS tickets, round(sum(a.amount), 2) AS revenue,
           sum(a.qty) FILTER (WHERE COALESCE(a.price, 0) > 0) AS paid,
           sum(a.qty) FILTER (WHERE a.price = 0) AS free,
           count(*) FILTER (WHERE a.pillar = 'tables') AS tables
      FROM _atk a WHERE a.ok AND a.ci IS NOT NULL AND a.event_id IS NOT NULL GROUP BY 1
  ), tot AS (
    SELECT event_id, sum(qty) AS sold FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), ttot AS (
    SELECT event_id, count(*) AS sold FROM _atk_all WHERE ok AND pillar = 'tables' AND event_id IS NOT NULL GROUP BY 1
  ), nrev AS (
    SELECT event_id, round(sum(amount), 2) AS revenue FROM _atk_all WHERE ok AND event_id IS NOT NULL GROUP BY 1
  ), djf AS (
    SELECT s.event_id, round(sum(s.fee), 2) AS fees
      FROM public.dj_sets s
     WHERE s.event_id IN (SELECT id FROM _aev) AND COALESCE(s.fee, 0) > 0
       AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id))
     GROUP BY 1
  ), rows AS (
    SELECT e.id, e.title, e.start_at, e.night, e.upcoming, p.tickets, p.revenue, COALESCE(t.sold, 0) AS sold,
           COALESCE(p.paid, 0) AS paid, COALESCE(p.free, 0) AS free, COALESCE(p.tables, 0) AS tables,
           COALESCE(nr.revenue, 0) AS night_revenue, COALESCE(dj.fees, 0) AS dj_fees, COALESCE(tt.sold, 0) AS tables_sold,
           public._crm_night_capacity(e.left_tickets, e.deals, COALESCE(t.sold, 0)::int) AS cap,
           (SELECT COALESCE(t2.sold, 0) FROM _aev e2 LEFT JOIN tot t2 ON t2.event_id = e2.id
             WHERE e2.start_at < e.start_at AND e2.id <> e.id AND NOT e2.upcoming
             ORDER BY (e2.series = e.series) DESC, e2.start_at DESC LIMIT 1) AS prev_sold,
           row_number() OVER (ORDER BY p.revenue DESC, p.tickets DESC) AS rk
      FROM per p JOIN _aev e ON e.id = p.event_id LEFT JOIN tot t ON t.event_id = e.id
      LEFT JOIN nrev nr ON nr.event_id = e.id LEFT JOIN djf dj ON dj.event_id = e.id LEFT JOIN ttot tt ON tt.event_id = e.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'start_at', start_at, 'night', night, 'upcoming', upcoming,
           'state', CASE WHEN night = v_today THEN 'tonight' WHEN upcoming THEN 'presale' ELSE 'past' END,
           'tickets', tickets, 'paid', paid, 'free', free, 'tables', tables, 'revenue', revenue, 'sold', sold, 'cap', cap, 'prev_sold', prev_sold,
           -- Pilier Tables VIP : le remplissage se lit en tables, pas en places.
           'tables_fill', CASE WHEN v_pillar = 'tables' THEN jsonb_build_object('sold', tables_sold, 'cap', public._tix_event_tables_total(id)) END,
           -- La porte d'une soirée passée : entrées et attendus, en personnes.
           'door', CASE WHEN NOT upcoming THEN (
               SELECT jsonb_build_object('entered', (h->>'entered')::int, 'expected', (h->>'expected')::int,
                                         'measured', public._crm_door_measured((h->>'expected')::bigint, (h->>'entered')::bigint))
                 FROM (SELECT public._door_headcount(ARRAY[id], NULL) AS h) z) END,
           -- Le bilan de toute la soirée : CA − cachets DJ (la seule dépense connue).
           'balance', jsonb_build_object('revenue', night_revenue,
                                       'fees', jsonb_build_object('amount', dj_fees),
                                       'rest', jsonb_build_object('amount', night_revenue - dj_fees))
         ) ORDER BY start_at DESC) FILTER (WHERE rk <= 7), '[]'::jsonb),
         CASE WHEN count(*) > 7 THEN jsonb_build_object('count', count(*) FILTER (WHERE rk > 7),
                'tickets', sum(tickets) FILTER (WHERE rk > 7), 'revenue', sum(revenue) FILTER (WHERE rk > 7)) END
    INTO v_events, v_other
    FROM rows;

  -- ── « Ce que vous touchez » (Tout) ────────────────────────────────────
  -- Ventes de la fenêtre (billets et tables), remboursées comprises.
  -- Volume brut − remboursements = le CA du héros ; − Stripe = le net.
  IF v_pillar = 'all' THEN
    WITH ev AS MATERIALIZED (
      SELECT s.id, s.money FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) s
    ), s AS (
      SELECT a.event_id, a.pillar, a.refunded, x.gross, x.charged, x.on_site,
             CASE WHEN a.refunded THEN x.gross ELSE LEAST(GREATEST(x.refund_amount, 0), x.gross) END AS refund
        FROM _atk a
        JOIN ev ON ev.id = a.event_id AND ev.money
        LEFT JOIN public.tickets t ON a.pillar = 'tickets' AND t.id = a.id
        LEFT JOIN public.table_reservations tr ON a.pillar = 'tables' AND tr.id = a.id
        CROSS JOIN LATERAL (SELECT
          CASE a.pillar
            WHEN 'tickets' THEN GREATEST(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
            ELSE GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.service_fee, 0)
                          - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END, 0) END AS gross,
          CASE a.pillar WHEN 'tickets' THEN COALESCE(t.refund_amount, 0) ELSE COALESCE(tr.refund_amount, 0) END AS refund_amount,
          -- Ce qui passe par Stripe : le billet ; d'une table, l'acompte payé en ligne.
          CASE a.pillar
            WHEN 'tickets' THEN COALESCE(t.total_price, 0)
            ELSE CASE WHEN COALESCE(tr.payment_mode, 'online') = 'online'
                      THEN COALESCE(tr.deposit, tr.total_price, 0) + COALESCE(tr.service_fee, 0) ELSE 0 END END AS charged,
          -- Le reste d'une table, réglé au club le soir même.
          CASE WHEN a.pillar = 'tables' AND NOT a.refunded
               THEN CASE WHEN COALESCE(tr.payment_mode, 'online') = 'online'
                         THEN GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.deposit, tr.total_price, 0), 0)
                         ELSE COALESCE(tr.total_price, 0) END
               ELSE 0 END AS on_site) x
       WHERE a.ci IS NOT NULL AND a.pillar IN ('tickets', 'tables') AND (a.ok OR a.refunded)
    ), pc AS MATERIALIZED (
      -- La part se lit une fois par soirée et par pilier, pas vente par vente.
      SELECT k.event_id, k.pillar, public._tix_party_pct(k.event_id, k.pillar, v_side) AS pct,
             EXISTS (SELECT 1 FROM public.events e
                      WHERE e.id = k.event_id AND COALESCE(e.venue_id, e.partner_venue_id) IS NOT NULL
                        AND COALESCE(e.organizer_user_id, e.partner_organizer_id) IS NOT NULL) AS shared
        FROM (SELECT DISTINCT event_id, pillar FROM s) k
    ), sx AS (
      SELECT s.*, CASE WHEN s.charged > 0 THEN round(s.charged * 0.015 + 0.25, 2) ELSE 0 END AS stripe,
             pc.pct, pc.shared
        FROM s JOIN pc ON pc.event_id = s.event_id AND pc.pillar = s.pillar
    )
    SELECT jsonb_build_object(
             'gross', jsonb_build_object('amount', COALESCE(round(sum(gross), 2), 0), 'n', count(*)),
             'refunds', jsonb_build_object('amount', COALESCE(round(sum(refund), 2), 0), 'n', count(*) FILTER (WHERE refund > 0)),
             'stripe', jsonb_build_object('amount', COALESCE(round(sum(stripe), 2), 0), 'n', count(*) FILTER (WHERE stripe > 0)),
             'net', jsonb_build_object('amount', COALESCE(round(sum(gross - refund - stripe), 2), 0)),
             'on_site', jsonb_build_object('amount', COALESCE(round(sum(on_site), 2), 0)),
             'share', CASE WHEN bool_or(shared OR pct IS NULL) THEN jsonb_build_object(
                 'amount', COALESCE(round(sum((gross - refund - stripe) * pct / 100) FILTER (WHERE pct IS NOT NULL), 2), 0),
                 'nights', count(DISTINCT event_id) FILTER (WHERE shared AND pct IS NOT NULL),
                 'unknown', count(DISTINCT event_id) FILTER (WHERE pct IS NULL)) END)
      INTO v_payout FROM sx;
  END IF;

  -- ── Tables VIP ────────────────────────────────────────────────────────
  IF v_pillar = 'tables' THEN
    WITH s AS (
      SELECT a.ci, a.pi, a.event_id, tr.total_price, tr.deposit, tr.minimum_spend, tr.guest_count,
             COALESCE(tr.payment_mode, 'online') AS mode
        FROM _atk a JOIN public.table_reservations tr ON tr.id = a.id
       WHERE a.ok
    ), capx AS (
      SELECT e.id, e.night, public._tix_event_tables_total(e.id) AS cap,
             (SELECT count(*) FROM _atk_all x WHERE x.event_id = e.id AND x.ok AND x.pillar = 'tables') AS sold
        FROM _aev e
       WHERE CASE WHEN m->>'mode' = 'event' THEN e.id IN ((m->'event'->>'id')::uuid, (m->'prev_event'->>'id')::uuid)
                  ELSE e.night BETWEEN v_prev_from AND v_today END
    ), cur AS (
      SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'event'->>'id')::uuid
                                                ELSE night BETWEEN v_cur_from AND v_today END
    ), prv AS (
      SELECT * FROM capx WHERE cap > 0 AND CASE WHEN m->>'mode' = 'event' THEN id = (m->'prev_event'->>'id')::uuid
                                                ELSE night BETWEEN v_prev_from AND v_prev_to END
    )
    SELECT jsonb_build_object(
             'n', count(*) FILTER (WHERE ci IS NOT NULL),
             'prev_n', count(*) FILTER (WHERE pi <= v_cut),
             'guests', round(avg(GREATEST(COALESCE(guest_count, 1), 1)) FILTER (WHERE ci IS NOT NULL), 1),
             'min_spend', jsonb_build_object('amount', round(avg(NULLIF(minimum_spend, 0)) FILTER (WHERE ci IS NOT NULL), 2)),
             'engaged', jsonb_build_object('amount', COALESCE(round(sum(total_price) FILTER (WHERE ci IS NOT NULL), 2), 0)),
             'deposits', jsonb_build_object('amount', COALESCE(round(sum(COALESCE(deposit, total_price)) FILTER (WHERE ci IS NOT NULL AND mode = 'online'), 2), 0)),
             'online_n', count(*) FILTER (WHERE ci IS NOT NULL AND mode = 'online'),
             'on_site_n', count(*) FILTER (WHERE ci IS NOT NULL AND mode <> 'online'),
             'fill', (SELECT jsonb_build_object('sold', sum(sold), 'cap', sum(cap), 'nights', count(*)) FROM cur),
             'prev_fill', (SELECT jsonb_build_object('sold', sum(sold), 'cap', sum(cap)) FROM prv))
      INTO v_tables FROM s;
  END IF;

  -- ── Guest list : venus sur une porte mesurée ──────────────────────────
  IF v_pillar = 'guestlist' THEN
    WITH ev AS (
      SELECT a.event_id, count(*) AS signups, count(*) FILTER (WHERE a.scanned_at IS NOT NULL) AS came
        FROM _atk a WHERE a.ok AND a.ci IS NOT NULL GROUP BY 1
    ), evx AS (
      SELECT ev.*, e.upcoming,
             CASE WHEN NOT e.upcoming THEN (SELECT public._crm_door_measured((h->>'expected')::bigint, (h->>'entered')::bigint)
                                              FROM (SELECT public._door_headcount(ARRAY[ev.event_id], NULL) AS h) z) END AS measured
        FROM ev JOIN _aev e ON e.id = ev.event_id
    )
    SELECT jsonb_build_object(
             'nights', count(*),
             'nights_measured', count(*) FILTER (WHERE measured),
             'signups_measured', COALESCE(sum(signups) FILTER (WHERE measured), 0),
             'came', COALESCE(sum(came) FILTER (WHERE measured), 0),
             'per_night', CASE WHEN count(*) > 0 THEN round(sum(signups)::numeric / count(*), 1) END)
      INTO v_gl FROM evx;
  END IF;

  -- ── Remboursements, à la date du remboursement ────────────────────────
  IF v_pillar = 'refunds' THEN
    DROP TABLE IF EXISTS _arf;
    CREATE TEMP TABLE _arf ON COMMIT DROP AS
    SELECT r.*, public._tix_bucket(r.refunded_at, r.event_id, m, false) AS ci,
                public._tix_bucket(r.refunded_at, r.event_id, m, true) AS pi
      FROM public._tix_refund_rows(p_venue_id, p_organizer_user_id) r;
    -- Un segment : `_cp` n'existe que dans ce cas (_tix_ana_setup).
    IF (m->>'seg') <> 'all' THEN
      DELETE FROM _arf r WHERE NOT EXISTS (SELECT 1 FROM _cp p WHERE p.email = r.email AND p.lifecycle = m->>'seg');
    END IF;

    WITH cur AS (SELECT ci AS g, sum(amount) AS a, count(*) AS n FROM _arf WHERE ci IS NOT NULL GROUP BY 1),
         prv AS (SELECT pi AS g, sum(amount) AS a, count(*) AS n FROM _arf WHERE pi IS NOT NULL GROUP BY 1)
    SELECT jsonb_build_object(
      'series', (SELECT jsonb_agg(jsonb_build_object(
                    'revenue', COALESCE(round(c.a, 2), 0), 'tickets', COALESCE(c.n, 0),
                    'prev_revenue', COALESCE(round(p.a, 2), 0), 'prev_tickets', COALESCE(p.n, 0)) ORDER BY g.g)
                   FROM generate_series(0, v_n - 1) g(g) LEFT JOIN cur c ON c.g = g.g LEFT JOIN prv p ON p.g = g.g),
      'totals', (SELECT jsonb_build_object(
                    'revenue', COALESCE(round(sum(amount) FILTER (WHERE ci IS NOT NULL), 2), 0),
                    'n', count(*) FILTER (WHERE ci IS NOT NULL),
                    'full', count(*) FILTER (WHERE ci IS NOT NULL AND full_refund),
                    'prev_revenue', COALESCE(round(sum(amount) FILTER (WHERE pi <= v_cut), 2), 0),
                    'prev_n', count(*) FILTER (WHERE pi <= v_cut),
                    'tickets_n', count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'tickets'),
                    'tables_n', count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'tables'),
                    'has_prev', bool_or(pi IS NOT NULL))
                   FROM _arf),
      'reasons', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', x.reason, 'n', x.n, 'revenue', x.a) ORDER BY x.n DESC, x.a DESC), '[]'::jsonb)
                    FROM (SELECT reason, count(*) AS n, round(sum(amount), 2) AS a FROM _arf WHERE ci IS NOT NULL
                           GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 6) x),
      'events', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', e.id, 'title', e.title, 'start_at', e.start_at, 'upcoming', e.upcoming,
                    'state', CASE WHEN e.night = v_today THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
                    'n', x.n, 'revenue', x.a,
                    'sales', (SELECT count(*) FROM _atk_all s WHERE s.event_id = e.id AND s.pillar IN ('tickets', 'tables') AND (s.ok OR s.refunded)))
                    ORDER BY x.n DESC, x.a DESC), '[]'::jsonb)
                   FROM (SELECT event_id, count(*) AS n, round(sum(amount), 2) AS a FROM _arf WHERE ci IS NOT NULL
                          GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 8) x JOIN _aev e ON e.id = x.event_id))
      INTO v_refunds;
  END IF;

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
    'payout', v_payout,
    'tables_block', v_tables,
    'gl_block', v_gl,
    'refunds_block', v_refunds,
    'sends', public._tix_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_sales(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text, p_pillar text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_sales__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg, p_pillar), p_venue_id, p_organizer_user_id);
$function$;

-- ── Droits ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('_tix_bucket', '_tix_refund_rows', '_tix_event_tables_total',
                                                          '_tix_party_pct', 'tix_ana_sales__core', 'tix_ana_sales') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = 'tix_ana_sales' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;
