-- Yuno Tickets › Analyses › Ventes, lot 2 du plan combiné : une soirée choisie
-- (docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md, décisions de Paul du 22/10).
--
--   1. « Comparer avec » : `tix_ana_sales(…, p_compare)` remplace la soirée
--      précédente de la série par n'importe quelle soirée de la portée, sur les
--      mêmes cases J-21 → J (courbe, tuiles, remplissage).
--   2. La porte d'une soirée : `tix_night_door` rend les entrées et les attendus
--      par pilier (règle de _door_headcount, en personnes), la porte mesurée
--      (_crm_door_measured), les arrivées par demi-heure dans le fuseau de la
--      soirée et le CA par personne entrée (sous `revenue` : l'enveloppe de
--      l'argent l'efface).
--
-- Le reste du rapport (phrase, objectif d'entrées, rythme, « À retenir »,
-- repères) vient de get_event_report, déjà gardée, telle quelle.

DROP FUNCTION IF EXISTS public.tix_ana_sales(text, uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.tix_ana_sales__core(text, uuid, text, uuid, text, text);

-- ── Ventes : le cœur, avec la soirée comparée ───────────────────────────
CREATE OR REPLACE FUNCTION public.tix_ana_sales__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text, p_pillar text DEFAULT 'all'::text, p_compare uuid DEFAULT NULL::uuid)
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
  v_cmp jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_today := (m->>'today')::date;
  m := m || jsonb_build_object('pillar', v_pillar);

  -- « Comparer avec » (lot 2) : une soirée choisie remplace la précédente de la
  -- série, sur les mêmes cases J-21 → J. Elle doit être de la portée (_aev).
  IF p_compare IS NOT NULL AND m->>'mode' = 'event' AND p_compare IS DISTINCT FROM (m->'event'->>'id')::uuid THEN
    SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night)
      INTO v_cmp FROM _aev e WHERE e.id = p_compare;
    IF v_cmp IS NOT NULL THEN
      UPDATE _atk_all SET pi = CASE WHEN event_id = p_compare
                                    THEN 21 - LEAST(21, GREATEST(0, (v_cmp->>'night')::date - nd)) END;
      UPDATE _atk SET pi = CASE WHEN event_id = p_compare
                                THEN 21 - LEAST(21, GREATEST(0, (v_cmp->>'night')::date - nd)) END;
      m := jsonb_set(m, '{prev_event}', v_cmp);
    END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION public.tix_ana_sales(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text, p_pillar text DEFAULT 'all'::text, p_compare uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_sales__core(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg, p_pillar, p_compare), p_venue_id, p_organizer_user_id);
$function$;


-- ── La porte d'une soirée ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tix_night_door__core(p_venue_id text, p_organizer_user_id uuid, p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ev record;
  v_out jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.* INTO v_ev FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) s WHERE s.id = p_event;
  IF v_ev.id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;

  WITH t AS MATERIALIZED (
    SELECT tk.id, GREATEST(COALESCE(tk.quantity, 1), 1) AS quantity, COALESCE(tk.entry_scanned, false) AS scanned,
           COALESCE(tk.entry_scanned_at, tk.used_at) AS scanned_at,
           EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = tk.id) AS nominative
      FROM public.tickets tk
     WHERE tk.event_id = p_event AND tk.status = 'paid'
  ), tr AS MATERIALIZED (
    SELECT r.id, GREATEST(COALESCE(r.guest_count, 1), 1) AS guests, COALESCE(r.entry_scanned, false) AS scanned,
           COALESCE(r.entry_scanned_at, r.checked_in_at) AS scanned_at,
           EXISTS (SELECT 1 FROM public.table_reservation_guests g WHERE g.reservation_id = r.id) AS nominative
      FROM public.table_reservations r
     WHERE r.event_id = p_event AND r.status = 'paid'
  ), rev AS MATERIALIZED (
    -- CA club de la soirée (fees.ts, statuts de la compta, remboursements déduits).
    SELECT COALESCE((SELECT sum(GREATEST(x.g - LEAST(GREATEST(COALESCE(tk.refund_amount, 0), 0), x.g), 0))
                       FROM public.tickets tk
                       CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(tk.total_price, 0) - COALESCE(tk.service_fee, 0) - COALESCE(tk.insurance_fee, 0), 0) AS g) x
                      WHERE tk.event_id = p_event AND tk.status IN ('paid', 'used')), 0)
         + COALESCE((SELECT sum(GREATEST(x.g - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), x.g), 0))
                       FROM public.table_reservations r
                       CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                                                           - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0) AS g) x
                      WHERE r.event_id = p_event AND r.status IN ('paid', 'confirmed')), 0) AS amount
  ), gle AS MATERIALIZED (
    SELECT COALESCE(g.entry_scanned, false) AS scanned, g.entry_scanned_at AS scanned_at
      FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = p_event AND g.status IS DISTINCT FROM 'cancelled'
  ), scans AS (
    -- Une ligne par entrée datée, en personnes (règle de _door_headcount).
    SELECT 'tickets'::text AS pillar, a.entry_scanned_at AS at, 1 AS n
      FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id WHERE a.entry_scanned
    UNION ALL SELECT 'tickets', t.scanned_at, t.quantity FROM t WHERE NOT t.nominative AND t.scanned
    UNION ALL SELECT 'tables', g.entry_scanned_at, 1
      FROM public.table_reservation_guests g JOIN tr ON tr.id = g.reservation_id WHERE g.entry_scanned
    UNION ALL SELECT 'tables', tr.scanned_at, tr.guests FROM tr WHERE NOT tr.nominative AND tr.scanned
    UNION ALL SELECT 'guestlist', gle.scanned_at, 1 FROM gle WHERE gle.scanned
  ), exp AS (
    SELECT 'tickets'::text AS pillar,
           COALESCE((SELECT sum(quantity) FROM t), 0)
           - (SELECT count(*) FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id WHERE a.refunded_at IS NOT NULL) AS n
    UNION ALL SELECT 'tables', COALESCE((SELECT sum(guests) FROM tr), 0)
    UNION ALL SELECT 'guestlist', (SELECT count(*) FROM gle)
  ), per AS (
    SELECT e.pillar, e.n::int AS expected, COALESCE(sum(s.n), 0)::int AS entered
      FROM exp e LEFT JOIN scans s ON s.pillar = e.pillar GROUP BY e.pillar, e.n
  ), tot AS (
    SELECT sum(entered)::int AS entered, sum(expected)::int AS expected FROM per
  ), slots AS (
    -- Demi-heures du fuseau de la soirée, entre la première et la dernière entrée datée
    -- (bornées de 4 h avant le début à 8 h après la fin).
    SELECT date_bin(interval '30 minutes', s.at, v_ev.start_at) AS slot, sum(s.n)::int AS n
      FROM scans s
     WHERE s.at IS NOT NULL AND s.at BETWEEN v_ev.start_at - interval '4 hours' AND v_ev.end_at + interval '8 hours'
     GROUP BY 1
  ), rng AS (
    SELECT min(slot) AS a, max(slot) AS b FROM slots
  ), series AS (
    SELECT g AS slot, COALESCE(sl.n, 0) AS n
      FROM rng, generate_series(rng.a, rng.b, interval '30 minutes') g
      LEFT JOIN slots sl ON sl.slot = g
     WHERE rng.a IS NOT NULL
  )
  SELECT jsonb_build_object(
    'event_id', p_event,
    'tz', v_ev.tz,
    'start_at', v_ev.start_at,
    'end_at', v_ev.end_at,
    'upcoming', v_ev.end_at > now(),
    'started', v_ev.start_at <= now(),
    'entered', (SELECT entered FROM tot),
    'expected', (SELECT expected FROM tot),
    'measured', public._crm_door_measured((SELECT expected FROM tot)::bigint, (SELECT entered FROM tot)::bigint),
    'pillars', (SELECT jsonb_object_agg(pillar, jsonb_build_object('entered', entered, 'expected', expected)) FROM per),
    'undated', (SELECT COALESCE(sum(n), 0) FROM scans WHERE at IS NULL),
    'arrivals', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', slot, 'n', n) ORDER BY slot) FROM series), '[]'::jsonb),
    -- CA de la soirée (billets + tables, frais Yuno exclus, remboursements déduits) par personne entrée.
    'money', jsonb_build_object(
      'revenue', CASE WHEN v_ev.money THEN round((SELECT amount FROM rev), 2) END,
      'per_head', jsonb_build_object('revenue', CASE WHEN v_ev.money AND (SELECT entered FROM tot) > 0
        THEN round((SELECT amount FROM rev) / (SELECT entered FROM tot), 2) END))
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_night_door(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_night_door__core(p_venue_id, p_organizer_user_id, p_event), p_venue_id, p_organizer_user_id);
$function$;

-- ── Droits ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('tix_ana_sales__core', 'tix_ana_sales', 'tix_night_door__core', 'tix_night_door') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname IN ('tix_ana_sales', 'tix_night_door') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;
