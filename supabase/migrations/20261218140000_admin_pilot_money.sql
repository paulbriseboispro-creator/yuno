-- Refonte de l'admin, lot 4 : Pilotage et Argent.
--
-- Des RPC d'ASSEMBLAGE (aucun calcul existant ne change) et une table des coûts.
-- Toutes : is_super_admin(), démo par CTE matérialisé, REVOKE / GRANT explicites.
--
-- Vocabulaire d'argent (src/admin/money/terms.ts, une source par terme) :
--   Ventes de la plateforme  = admin_platform_analytics.totals.gmv (ce que les
--                              acheteurs ont payé : billets et tables payés,
--                              remboursés compris ; la démo n'y entre JAMAIS).
--   Frais de service         = admin_platform_analytics.totals.yuno_revenue
--                              (service + assurance des billets, service + gestion
--                              des tables).
--   Abonnements CRM          = prix des abonnements Stripe de Yuno CRM (grille de
--                              crm_pricing_config, formule de crm_admin_money),
--                              au prorata des jours actifs dans la fenêtre.
--                              ESTIMATION : Yuno ne garde pas les factures Stripe.
--   Recharges de Yunits      = crm_yunit_lots kind 'purchase', montant HT de
--                              crm_admin_money.
--   Revenu de Yuno           = frais de service + abonnements CRM + recharges.
--   MRR                      = somme des `mrr` de _crm_admin_rows (abonnement
--                              Stripe payé ou en retard ; un compte offert n'y
--                              entre jamais). À une date passée : formule des
--                              mois de crm_admin_money.
--   Remboursements           = admin_platform_analytics.totals.refunds_total.
--   Coûts / Marge            = admin_costs (saisis) + IA (ai_usage_events) ;
--                              marge = revenu de Yuno − coûts.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers (sans GRANT) : abonnements et recharges CRM, portée démo comprise.
-- Recopie des formules de crm_admin_money (_ms, _mp), en CTE (pas de table
-- temporaire : ces fonctions restent STABLE).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admin_crm_subs(p_include_demo boolean)
RETURNS TABLE (scope_key text, name text, price numeric, created_at timestamptz,
               gone boolean, gone_at timestamptz, status text, billing_interval text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cfg AS MATERIALIZED (SELECT public.crm_pricing_config() AS c),
  rows AS MATERIALIZED (
    SELECT r FROM jsonb_array_elements(public._crm_admin_rows(p_include_demo)) r
     WHERE p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false)
  )
  SELECT cs.scope_key,
         (SELECT r->>'name' FROM rows WHERE r->>'id' = cs.scope_key LIMIT 1),
         CASE WHEN cs.billing_interval = 'year' THEN round((cfg.c->>'price_year')::numeric / 12, 2)
              WHEN COALESCE(cs.founder, false) THEN (cfg.c->>'price_month')::numeric
              ELSE (cfg.c->>'price_month_next')::numeric END,
         cs.created_at,
         cs.status IN ('canceled', 'incomplete'),
         CASE WHEN cs.status IN ('canceled', 'incomplete') THEN cs.updated_at END,
         cs.status, cs.billing_interval
    FROM public.crm_subscriptions cs CROSS JOIN cfg
   WHERE cs.stripe_subscription_id IS NOT NULL
     AND cs.scope_key IN (SELECT r->>'id' FROM rows)
$$;

CREATE OR REPLACE FUNCTION public._admin_crm_recharges(p_include_demo boolean)
RETURNS TABLE (scope_key text, at timestamptz, yunits integer, eur numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cfg AS MATERIALIZED (SELECT public.crm_pricing_config() AS c),
  rows AS MATERIALIZED (
    SELECT r->>'id' AS id FROM jsonb_array_elements(public._crm_admin_rows(p_include_demo)) r
     WHERE p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false)
  )
  SELECT l.scope_key, l.created_at, l.amount::integer,
         round(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                    THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg.c->>'vat_rate')::numeric, 20) / 100)
                    ELSE l.amount::numeric / NULLIF((cfg.c->>'yunits_per_euro')::numeric, 0) END, 2)
    FROM public.crm_yunit_lots l CROSS JOIN cfg
    LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
   WHERE l.kind = 'purchase' AND l.scope_key IN (SELECT id FROM rows)
$$;

-- Ventes Yuno payées par pro (billets + tables, paid_at posé : règle
-- d'admin_platform_analytics). `pro` = le compte qui MÈNE la soirée (club, sinon
-- organisateur) ; `pros` = toutes les parties (club ET organisateur, règle
-- « pros actifs » du lot 1).
CREATE OR REPLACE FUNCTION public._admin_paid_sales(p_from timestamptz, p_to timestamptz, p_include_demo boolean)
RETURNS TABLE (at timestamptz, event_id uuid, email text, charged numeric, pro text, pros text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  s AS (
    SELECT t.created_at AS at, t.event_id, lower(t.user_email) AS email, t.total_price::numeric AS charged
      FROM public.tickets t CROSS JOIN d
     WHERE t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at < p_to
       AND NOT COALESCE(t.event_id = ANY (d.de), false)
       AND (p_include_demo OR NOT public.is_demo_email(t.user_email))
    UNION ALL
    SELECT tr.created_at, tr.event_id, lower(tr.user_email), tr.total_price::numeric
      FROM public.table_reservations tr CROSS JOIN d
     WHERE tr.paid_at IS NOT NULL AND tr.created_at >= p_from AND tr.created_at < p_to
       AND NOT COALESCE(tr.event_id = ANY (d.de), false)
       AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))
  )
  SELECT s.at, s.event_id, s.email, s.charged,
         CASE WHEN e.venue_id IS NOT NULL THEN 'venue:' || e.venue_id
              WHEN e.organizer_user_id IS NOT NULL THEN 'org:' || e.organizer_user_id END,
         array_remove(ARRAY[
           CASE WHEN e.venue_id IS NOT NULL THEN 'venue:' || e.venue_id END,
           CASE WHEN e.organizer_user_id IS NOT NULL THEN 'org:' || e.organizer_user_id END], NULL)
    FROM s LEFT JOIN public.events e ON e.id = s.event_id
$$;

-- Nouveaux pros (règle du lot 1 : clubs, organisations hors vitrines, agences).
CREATE OR REPLACE FUNCTION public._admin_new_pros(p_from timestamptz, p_to timestamptz, p_include_demo boolean)
RETURNS TABLE (at timestamptz, pro text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH d AS MATERIALIZED (SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv)
  SELECT v.created_at, 'venue:' || v.id FROM public.venues v CROSS JOIN d
   WHERE v.created_at >= p_from AND v.created_at < p_to AND NOT COALESCE(v.id = ANY (d.dv), false)
  UNION ALL
  SELECT op.created_at, 'org:' || op.user_id FROM public.organizer_profiles op
    LEFT JOIN public.profiles pr ON pr.id = op.user_id
   WHERE op.created_at >= p_from AND op.created_at < p_to AND NOT COALESCE(op.is_showcase_shadow, false)
     AND (p_include_demo OR NOT public.is_demo_email(pr.email))
  UNION ALL
  SELECT ag.created_at, 'agency:' || ag.id FROM public.agencies ag
    LEFT JOIN public.profiles pr ON pr.id = ag.owner_user_id
   WHERE ag.created_at >= p_from AND ag.created_at < p_to
     AND (p_include_demo OR NOT public.is_demo_email(pr.email))
$$;

-- Revenu des abonnements CRM dans une fenêtre : prix mensuel × jours actifs / 30.
-- `p_subs` = instantané jsonb de _admin_crm_subs (lu UNE fois par appel d'écran).
CREATE OR REPLACE FUNCTION public._admin_crm_sub_revenue(p_subs jsonb, p_from timestamptz, p_to timestamptz)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(round(sum(s.price * GREATEST(0,
           extract(epoch FROM LEAST(p_to, COALESCE(s.gone_at, p_to)) - GREATEST(p_from, s.created_at))) / 86400 / 30), 2), 0)
    FROM jsonb_to_recordset(p_subs) AS s(price numeric, created_at timestamptz, gone boolean, gone_at timestamptz)
$$;

-- MRR à une date (formule des mois de crm_admin_money).
CREATE OR REPLACE FUNCTION public._admin_crm_mrr_at(p_subs jsonb, p_at timestamptz)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(sum(s.price), 0)
    FROM jsonb_to_recordset(p_subs) AS s(price numeric, created_at timestamptz, gone boolean, gone_at timestamptz)
   WHERE s.created_at < p_at AND (NOT s.gone OR s.gone_at >= p_at)
$$;

REVOKE ALL ON FUNCTION public._admin_crm_subs(boolean), public._admin_crm_recharges(boolean),
  public._admin_paid_sales(timestamptz, timestamptz, boolean), public._admin_new_pros(timestamptz, timestamptz, boolean),
  public._admin_crm_sub_revenue(jsonb, timestamptz, timestamptz), public._admin_crm_mrr_at(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pilotage › Vue d'ensemble : six chiffres comparés, revenu de Yuno par jour et
-- par source, douze derniers mois, concentration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_pilot_overview(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days  integer := CASE WHEN p_days IN (7, 30, 90, 365) THEN p_days ELSE 30 END;
  v_to    timestamptz := now();
  v_from  timestamptz := now() - make_interval(days => v_days);
  v_pfrom timestamptz := now() - make_interval(days => 2 * v_days);
  v_cur   jsonb; v_prev jsonb; v_months jsonb := '[]'::jsonb; v_m timestamptz; v_me timestamptz; v_a jsonb;
  v_mrr   numeric; v_series jsonb; v_prev_series jsonb; v_kpi jsonb; v_conc jsonb;
  v_subs  jsonb; v_rc jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_subs FROM public._admin_crm_subs(p_include_demo) x;
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_rc FROM public._admin_crm_recharges(p_include_demo) x;

  v_cur  := public.admin_platform_analytics(v_from, v_to);
  v_prev := public.admin_platform_analytics(v_pfrom, v_from);

  SELECT COALESCE(sum((r->>'mrr')::numeric), 0) INTO v_mrr
    FROM jsonb_array_elements(public._crm_admin_rows(p_include_demo)) r
   WHERE p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false);

  WITH cur AS (SELECT * FROM public._admin_paid_sales(v_from, v_to, p_include_demo)),
       prv AS (SELECT * FROM public._admin_paid_sales(v_pfrom, v_from, p_include_demo)),
       rc  AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(v_rc) AS r(at timestamptz, eur numeric))
  SELECT jsonb_build_object(
    'sales',      jsonb_build_object('cur', (v_cur->'totals'->>'gmv')::numeric, 'prev', (v_prev->'totals'->>'gmv')::numeric),
    'fees',       jsonb_build_object('cur', (v_cur->'totals'->>'yuno_revenue')::numeric, 'prev', (v_prev->'totals'->>'yuno_revenue')::numeric),
    'subs',       jsonb_build_object('cur', public._admin_crm_sub_revenue(v_subs, v_from, v_to),
                                     'prev', public._admin_crm_sub_revenue(v_subs, v_pfrom, v_from)),
    'recharges',  jsonb_build_object('cur', (SELECT COALESCE(sum(eur), 0) FROM rc WHERE at >= v_from AND at < v_to),
                                     'prev', (SELECT COALESCE(sum(eur), 0) FROM rc WHERE at >= v_pfrom AND at < v_from)),
    'mrr',        jsonb_build_object('cur', v_mrr, 'prev', public._admin_crm_mrr_at(v_subs, v_from)),
    'selling',    jsonb_build_object('cur', (SELECT count(DISTINCT p) FROM cur, unnest(cur.pros) p),
                                     'prev', (SELECT count(DISTINCT p) FROM prv, unnest(prv.pros) p)),
    'buyers',     jsonb_build_object('cur', (SELECT count(DISTINCT email) FROM cur WHERE email IS NOT NULL),
                                     'prev', (SELECT count(DISTINCT email) FROM prv WHERE email IS NOT NULL)),
    'new_pros',   jsonb_build_object('cur', (SELECT count(*) FROM public._admin_new_pros(v_from, v_to, p_include_demo)),
                                     'prev', (SELECT count(*) FROM public._admin_new_pros(v_pfrom, v_from, p_include_demo))),
    'refunds',    jsonb_build_object('cur', (v_cur->'totals'->>'refunds_total')::numeric, 'prev', (v_prev->'totals'->>'refunds_total')::numeric)
  ) INTO v_kpi;

  -- Revenu de Yuno par jour, par source. Abonnements : prix / 30 chaque jour actif.
  WITH subs AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(v_subs) AS s(price numeric, created_at timestamptz, gone boolean, gone_at timestamptz)),
       rc   AS MATERIALIZED (SELECT * FROM jsonb_to_recordset(v_rc) AS r(at timestamptz, eur numeric)),
       fees AS (SELECT (x->>'d')::date AS d, (x->>'yuno')::numeric AS yuno FROM jsonb_array_elements(v_cur->'by_day') x),
       pfees AS (SELECT (x->>'d')::date AS d, (x->>'yuno')::numeric AS yuno FROM jsonb_array_elements(v_prev->'by_day') x)
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'd', f.d,
        'fees', f.yuno,
        'subs', round(COALESCE((SELECT sum(s.price) / 30 FROM subs s
                                 WHERE s.created_at::date <= f.d AND (NOT s.gone OR s.gone_at::date > f.d)), 0), 2),
        'recharges', COALESCE((SELECT sum(r.eur) FROM rc r WHERE r.at::date = f.d), 0)
      ) ORDER BY f.d), '[]'::jsonb) FROM fees f),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'd', f.d,
        'total', f.yuno
          + round(COALESCE((SELECT sum(s.price) / 30 FROM subs s
                             WHERE s.created_at::date <= f.d AND (NOT s.gone OR s.gone_at::date > f.d)), 0), 2)
          + COALESCE((SELECT sum(r.eur) FROM rc r WHERE r.at::date = f.d), 0)
      ) ORDER BY f.d), '[]'::jsonb) FROM pfees f)
  INTO v_series, v_prev_series;

  -- Douze derniers mois (le mois en cours compris, arrêté à maintenant).
  FOR i IN REVERSE 11..0 LOOP
    v_m  := date_trunc('month', now()) - make_interval(months => i);
    v_me := LEAST(v_m + interval '1 month', now());
    v_a  := public.admin_platform_analytics(v_m, v_me) -> 'totals';
    v_months := v_months || jsonb_build_array(
      (WITH s AS (SELECT * FROM public._admin_paid_sales(v_m, v_me, p_include_demo))
       SELECT jsonb_build_object(
         'm', to_char(v_m, 'YYYY-MM'),
         'sales', (v_a->>'gmv')::numeric,
         'fees', (v_a->>'yuno_revenue')::numeric,
         'subs', public._admin_crm_sub_revenue(v_subs, v_m, v_me),
         'recharges', (SELECT COALESCE(sum(r.eur), 0) FROM jsonb_to_recordset(v_rc) AS r(at timestamptz, eur numeric) WHERE r.at >= v_m AND r.at < v_me),
         'refunds', (v_a->>'refunds_total')::numeric,
         'mrr_end', CASE WHEN v_me >= now() THEN v_mrr ELSE public._admin_crm_mrr_at(v_subs, v_me) END,
         'new_pros', (SELECT count(*) FROM public._admin_new_pros(v_m, v_me, p_include_demo)),
         'selling', (SELECT count(DISTINCT p) FROM s, unnest(s.pros) p),
         'buyers', (SELECT count(DISTINCT email) FROM s WHERE email IS NOT NULL))));
  END LOOP;

  -- Concentration : part des cinq premiers pros dans les ventes de la période.
  WITH s AS (SELECT * FROM public._admin_paid_sales(v_from, v_to, p_include_demo) WHERE pro IS NOT NULL),
       tot AS (SELECT COALESCE(sum(charged), 0) AS t FROM s),
       byp AS (SELECT pro, sum(charged) AS amount, count(*) AS n FROM s GROUP BY pro ORDER BY sum(charged) DESC LIMIT 5)
  SELECT jsonb_build_object(
    'total', (SELECT t FROM tot),
    'pros_selling', (SELECT count(DISTINCT pro) FROM s),
    'top5', (SELECT COALESCE(sum(amount), 0) FROM byp),
    'top', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'key', byp.pro, 'amount', round(byp.amount, 2), 'n', byp.n,
              'name', CASE WHEN byp.pro LIKE 'venue:%' THEN (SELECT v.name FROM public.venues v WHERE v.id = substr(byp.pro, 7))
                           ELSE (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id::text = substr(byp.pro, 5)) END
            ) ORDER BY byp.amount DESC) FROM byp), '[]'::jsonb)
  ) INTO v_conc;

  RETURN jsonb_build_object(
    'generated_at', now(), 'days', v_days, 'from', v_from, 'prev_from', v_pfrom,
    'kpis', v_kpi, 'series', v_series, 'prev_series', v_prev_series,
    'months', v_months, 'concentration', v_conc,
    'demo_in_sales', false
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pilotage › Acquisition : UN entonnoir Billetterie + CRM.
-- Lit admin_pro_signups (personnes, sans robots : ses règles, inchangées) et
-- crm_landing_events (visites de la landing CRM). Configuré, première vente /
-- synchro et payant sont lus sur le compte ouvert.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_pro_acquisition(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days integer := CASE WHEN p_days IN (7, 30, 90, 365) THEN p_days ELSE 30 END;
  v_from timestamptz := now() - make_interval(days => v_days);
  v_s jsonb; v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  v_s := public.admin_pro_signups(v_days, p_include_demo);

  WITH crm AS MATERIALIZED (
    SELECT r FROM jsonb_array_elements(public._crm_admin_rows(p_include_demo)) r
     WHERE p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false)
  ),
  acc AS (
    SELECT p->>'key' AS key,
           CASE WHEN p->>'product' = 'crm' THEN 'crm' ELSE 'tickets' END AS product,
           NULLIF(p->'account'->>'user_id', '')::uuid AS user_id,
           NULLIF(p->'account'->>'venue_id', '') AS venue_id,
           (p->'account'->>'created_at')::timestamptz AS created_at,
           COALESCE((p->'account'->>'events')::int, 0) AS events,
           COALESCE((p->'account'->>'payments')::boolean, false) AS payments,
           p->'origin' AS origin
      FROM jsonb_array_elements(v_s->'people') p
     WHERE p->'account' IS NOT NULL AND p->'account' <> 'null'::jsonb
       AND (p->'account'->>'created_at')::timestamptz >= v_from
  ),
  acc2 AS (
    SELECT a.*,
      EXISTS (SELECT 1 FROM public.ticketing_connections c
               WHERE (a.venue_id IS NOT NULL AND c.venue_id = a.venue_id) OR (a.user_id IS NOT NULL AND c.organizer_user_id = a.user_id)) AS has_conn,
      EXISTS (SELECT 1 FROM public.ticketing_connections c
               WHERE ((a.venue_id IS NOT NULL AND c.venue_id = a.venue_id) OR (a.user_id IS NOT NULL AND c.organizer_user_id = a.user_id))
                 AND c.initial_import_done_at IS NOT NULL) AS synced,
      (SELECT min(x.at) FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE t.paid_at IS NOT NULL AND e.external_source IS NULL
             AND ((a.venue_id IS NOT NULL AND (e.venue_id = a.venue_id OR e.partner_venue_id = a.venue_id))
               OR (a.user_id IS NOT NULL AND e.organizer_user_id = a.user_id))
          UNION ALL
          SELECT tr.created_at FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id
           WHERE tr.paid_at IS NOT NULL
             AND ((a.venue_id IS NOT NULL AND (e.venue_id = a.venue_id OR e.partner_venue_id = a.venue_id))
               OR (a.user_id IS NOT NULL AND e.organizer_user_id = a.user_id))) x) AS first_sale_at,
      EXISTS (SELECT 1 FROM crm c
               WHERE c.r->>'state' IN ('paid', 'late') AND COALESCE((c.r->>'paid')::boolean, false)
                 AND ((a.user_id IS NOT NULL AND c.r->>'organizer_user_id' = a.user_id::text)
                   OR (a.venue_id IS NOT NULL AND c.r->>'venue_id' = a.venue_id))) AS paying
      FROM acc a
  ),
  st AS (
    SELECT a.*,
      CASE WHEN a.product = 'crm' THEN a.has_conn ELSE (a.events > 0 OR a.payments) END AS configured,
      CASE WHEN a.product = 'crm' THEN a.synced ELSE a.first_sale_at IS NOT NULL END AS first_done
      FROM acc2 a
  )
  SELECT jsonb_build_object(
    'days', v_days, 'from', v_from,
    'visits', (SELECT count(DISTINCT (e.day, e.visitor_hash)) FROM public.crm_landing_events e
                WHERE e.kind = 'visit' AND e.at >= v_from),
    'opened', (v_s->'funnel'->>'opened')::int,
    'created_signup', (v_s->'funnel'->>'created')::int,
    'robots', (v_s->'funnel'->>'robots')::int,
    'leads', (v_s->'funnel'->>'leads')::int,
    'to_contact', (v_s->'funnel'->>'to_contact')::int,
    'by_product', (SELECT COALESCE(jsonb_object_agg(product, x), '{}'::jsonb) FROM (
        SELECT product, jsonb_build_object(
          'created', count(*), 'configured', count(*) FILTER (WHERE configured),
          'first', count(*) FILTER (WHERE first_done), 'paying', count(*) FILTER (WHERE paying)) AS x
          FROM st GROUP BY product) q),
    'created', (SELECT count(*) FROM st),
    'configured', (SELECT count(*) FROM st WHERE configured),
    'first', (SELECT count(*) FROM st WHERE first_done),
    'paying', (SELECT count(*) FROM st WHERE paying),
    'median_days_to_first_sale', (SELECT round((percentile_cont(0.5) WITHIN GROUP (
         ORDER BY extract(epoch FROM first_sale_at - created_at) / 86400))::numeric, 1)
       FROM st WHERE product = 'tickets' AND first_sale_at IS NOT NULL AND first_sale_at >= created_at),
    'median_n', (SELECT count(*) FROM st WHERE product = 'tickets' AND first_sale_at IS NOT NULL AND first_sale_at >= created_at),
    'sources', COALESCE(v_s->'by_source', '[]'::jsonb),
    'by_day', COALESCE(v_s->'by_day', '[]'::jsonb),
    'landing_by_day', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb) FROM (
        SELECT e.day AS d, count(DISTINCT e.visitor_hash) AS n FROM public.crm_landing_events e
         WHERE e.kind = 'visit' AND e.at >= v_from GROUP BY e.day) q)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pilotage › Rétention : cohortes de pros par mois de première vente (Billetterie),
-- départs Yuno CRM.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_pro_retention(p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  WITH s AS MATERIALIZED (
    SELECT pro, date_trunc('month', at) AS m, sum(charged) AS amount
      FROM public._admin_paid_sales('2020-01-01'::timestamptz, now(), p_include_demo)
     WHERE pro IS NOT NULL GROUP BY 1, 2
  ),
  first AS (SELECT pro, min(m) AS c FROM s GROUP BY pro),
  cohorts AS (
    SELECT f.c, k,
           count(DISTINCT s.pro) FILTER (WHERE s.m = f.c + make_interval(months => k)) AS active,
           COALESCE(sum(s.amount) FILTER (WHERE s.m = f.c + make_interval(months => k)), 0) AS amount
      FROM first f CROSS JOIN generate_series(0, 6) k
      LEFT JOIN s ON s.pro = f.pro
     WHERE f.c >= date_trunc('month', now()) - interval '11 months'
     GROUP BY f.c, k
  ),
  crm AS MATERIALIZED (
    SELECT r FROM jsonb_array_elements(public._crm_admin_rows(p_include_demo)) r
     WHERE p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false)
  )
  SELECT jsonb_build_object(
    'cohorts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'm', to_char(c, 'YYYY-MM'),
        'size', (SELECT count(*) FROM first WHERE first.c = q.c),
        'months_elapsed', (extract(year FROM age(date_trunc('month', now()), c)) * 12 + extract(month FROM age(date_trunc('month', now()), c)))::int,
        'active', q.active, 'amount', q.amount) ORDER BY c)
      FROM (SELECT c, jsonb_agg(active ORDER BY k) AS active, jsonb_agg(round(amount, 2) ORDER BY k) AS amount
              FROM cohorts GROUP BY c) q), '[]'::jsonb),
    'pros_ever', (SELECT count(*) FROM first),
    'crm_departures', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', s.scope_key, 'name', s.name, 'at', s.gone_at, 'price', s.price) ORDER BY s.gone_at DESC)
      FROM public._admin_crm_subs(p_include_demo) s WHERE s.gone), '[]'::jsonb),
    'crm_states', (SELECT COALESCE(jsonb_object_agg(st, n), '{}'::jsonb) FROM (
        SELECT r->>'state' AS st, count(*) AS n FROM crm GROUP BY 1) q),
    'crm_paused', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', r->>'id', 'name', r->>'name', 'state', r->>'state'))
       FROM crm WHERE r->>'state' IN ('paused', 'churned')), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pilotage › Audience : acheteurs actifs et récurrents (comparés).
-- Récurrent = a déjà payé avant le début de la période.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_buyers_stats(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days  integer := CASE WHEN p_days IN (7, 30, 90, 365) THEN p_days ELSE 30 END;
  v_from  timestamptz := now() - make_interval(days => v_days);
  v_pfrom timestamptz := now() - make_interval(days => 2 * v_days);
  v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  WITH s AS MATERIALIZED (
    SELECT email, min(at) AS first_at, array_agg(at) AS ats
      FROM public._admin_paid_sales('2020-01-01'::timestamptz, now(), p_include_demo)
     WHERE email IS NOT NULL GROUP BY email
  ),
  w AS (
    SELECT email, first_at,
           EXISTS (SELECT 1 FROM unnest(ats) a WHERE a >= v_from) AS in_cur,
           EXISTS (SELECT 1 FROM unnest(ats) a WHERE a >= v_pfrom AND a < v_from) AS in_prev
      FROM s
  )
  SELECT jsonb_build_object(
    'active', jsonb_build_object('cur', count(*) FILTER (WHERE in_cur), 'prev', count(*) FILTER (WHERE in_prev)),
    'returning', jsonb_build_object('cur', count(*) FILTER (WHERE in_cur AND first_at < v_from),
                                    'prev', count(*) FILTER (WHERE in_prev AND first_at < v_pfrom)),
    'new', jsonb_build_object('cur', count(*) FILTER (WHERE first_at >= v_from),
                              'prev', count(*) FILTER (WHERE first_at >= v_pfrom AND first_at < v_from)),
    'ever', count(*)
  ) INTO v_out FROM w;
  RETURN v_out;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Argent › À régler : tout ce qui demande une action d'argent, en un appel.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_money_issues(p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'type', n.notification_type, 'title', n.title, 'message', n.message,
        'priority', n.priority, 'at', n.created_at, 'reference_type', n.reference_type,
        'reference_id', n.reference_id, 'event_id', n.event_id, 'metadata', n.metadata) ORDER BY n.created_at DESC)
      FROM public.admin_notifications n
     WHERE n.read_at IS NULL
       AND n.notification_type IN ('admin_payment_disputed', 'admin_paid_sale_unfulfilled', 'admin_refund_failed',
                                   'admin_invoice_failed', 'admin_transfer_release_failed', 'admin_indirect_charge_refused',
                                   'admin_collab_late_sale')), '[]'::jsonb),
    'transfers', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(public.admin_coorg_transfer_issues()) x
                    WHERE p_include_demo OR NOT ((x->>'event_id')::uuid = ANY (public.demo_event_ids()))), '[]'::jsonb),
    'payouts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pp.id, 'status', pp.status, 'amount', pp.amount, 'period', pp.period_label,
        'created_at', pp.created_at, 'approved_at', pp.approved_at, 'confirm_due_at', pp.confirm_due_at,
        'disputed_at', pp.disputed_at, 'dispute_reason', pp.dispute_reason, 'reference', pp.transfer_reference,
        'promoter', NULLIF(trim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
        'payer', COALESCE(v.name, op.display_name),
        'payer_key', CASE WHEN pp.venue_id IS NOT NULL THEN 'venue:' || pp.venue_id ELSE 'org:' || pp.organizer_user_id END,
        'reason', CASE WHEN pp.status = 'disputed' OR pp.disputed_at IS NOT NULL THEN 'disputed'
                       WHEN pp.status = 'approved' THEN 'unconfirmed' ELSE 'not_sent' END) ORDER BY pp.created_at)
      FROM public.promoter_payouts pp
      LEFT JOIN public.promoters pr ON pr.id = pp.promoter_id
      LEFT JOIN public.venues v ON v.id = pp.venue_id
      LEFT JOIN public.organizer_profiles op ON op.user_id = pp.organizer_user_id
     WHERE pp.status = 'disputed'
        OR (pp.status = 'approved' AND pp.confirm_due_at < now())
        OR (pp.status = 'pending' AND pp.created_at < now() - interval '30 days')), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- « Traité » d'une alerte d'argent : motif obligatoire, journal d'audit.
CREATE OR REPLACE FUNCTION public.admin_money_issue_done(p_notification_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 4 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.admin_notifications SET read_at = now(), read_by = auth.uid()
   WHERE id = p_notification_id AND read_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'money_issue_done', 'admin_notification', p_notification_id::text,
          jsonb_build_object('reason', trim(p_reason)));
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Argent › Coûts et marge. Un poste saisi à la main par mois ; l'IA est lue
-- dans ai_usage_events (USD → EUR au taux du réglage, écrasable par une saisie).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_costs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month      date NOT NULL CHECK (month = date_trunc('month', month)::date),
  item       text NOT NULL CHECK (item IN ('resend', 'sms', 'ai', 'supabase', 'cloudflare', 'stripe', 'other')),
  amount     numeric(12, 2) NOT NULL CHECK (amount >= 0),
  note       text CHECK (note IS NULL OR length(note) <= 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, item)
);
ALTER TABLE public.admin_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_costs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_costs_list(p_months integer DEFAULT 12, p_usd_eur numeric DEFAULT 0.92)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_n integer := LEAST(GREATEST(COALESCE(p_months, 12), 1), 24);
  v_rate numeric := COALESCE(NULLIF(p_usd_eur, 0), 0.92);
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'usd_eur', v_rate,
    'months', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'm', to_char(m, 'YYYY-MM'),
        'ai_auto', round(COALESCE((SELECT sum(e.cost_usd) FROM public.ai_usage_events e
                                    WHERE e.created_at >= m AND e.created_at < m + interval '1 month'), 0) * v_rate, 2),
        'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', c.id, 'item', c.item, 'amount', c.amount, 'note', c.note,
                    'by', (SELECT COALESCE(NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.email) FROM public.profiles p WHERE p.id = c.created_by), 'at', c.updated_at)
                    ORDER BY c.item)
                  FROM public.admin_costs c WHERE c.month = m::date), '[]'::jsonb)
      ) ORDER BY m DESC), '[]'::jsonb)
      FROM generate_series(date_trunc('month', now()) - make_interval(months => v_n - 1), date_trunc('month', now()), interval '1 month') m)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_cost_set(p_month date, p_item text, p_amount numeric, p_note text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_old numeric;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 4 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  SELECT amount INTO v_old FROM public.admin_costs WHERE month = date_trunc('month', p_month)::date AND item = p_item;
  INSERT INTO public.admin_costs (month, item, amount, note, created_by)
  VALUES (date_trunc('month', p_month)::date, p_item, round(p_amount, 2), NULLIF(trim(p_note), ''), auth.uid())
  ON CONFLICT (month, item) DO UPDATE
    SET amount = EXCLUDED.amount, note = EXCLUDED.note, created_by = EXCLUDED.created_by, updated_at = now()
  RETURNING id INTO v_id;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'cost_set', 'admin_cost', v_id::text,
          jsonb_build_object('month', date_trunc('month', p_month)::date, 'item', p_item,
                             'before', v_old, 'after', round(p_amount, 2), 'reason', trim(p_reason)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_cost_delete(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row public.admin_costs;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 4 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.admin_costs WHERE id = p_id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'cost_delete', 'admin_cost', p_id::text,
          jsonb_build_object('month', v_row.month, 'item', v_row.item, 'before', v_row.amount, 'reason', trim(p_reason)));
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Argent › Factures : les numéros émis (suite par vendeur), paginés.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_invoices_list(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_off integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  WITH d AS MATERIALIZED (SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv),
  base AS (
    SELECT n.id, n.invoice_number, n.seller_kind, n.venue_id, n.organizer_user_id, n.created_at,
           n.ticket_id, n.table_reservation_id, n.order_id
      FROM public.invoice_numbers n CROSS JOIN d
      LEFT JOIN public.profiles pr ON pr.id = n.organizer_user_id
     WHERE (p_include_demo OR (NOT COALESCE(n.venue_id = ANY (d.dv), false)
                               AND (n.organizer_user_id IS NULL OR NOT public.is_demo_email(pr.email))))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'number', b.invoice_number, 'seller_kind', b.seller_kind,
        'seller', CASE WHEN b.seller_kind = 'organizer' THEN (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = b.organizer_user_id)
                       ELSE (SELECT v.name FROM public.venues v WHERE v.id = b.venue_id) END,
        'seller_key', CASE WHEN b.seller_kind = 'organizer' THEN 'org:' || b.organizer_user_id ELSE 'venue:' || b.venue_id END,
        'sale_type', CASE WHEN b.ticket_id IS NOT NULL THEN 'ticket' WHEN b.table_reservation_id IS NOT NULL THEN 'table' ELSE 'order' END,
        'sale_id', COALESCE(b.ticket_id::text, b.table_reservation_id::text, b.order_id::text),
        'amount', (SELECT i.amount FROM public.invoices i WHERE i.invoice_number = b.invoice_number
                     AND (i.ticket_id = b.ticket_id OR i.table_reservation_id = b.table_reservation_id OR i.order_id = b.order_id) LIMIT 1),
        'at', b.created_at) ORDER BY b.created_at DESC)
      FROM (SELECT * FROM base ORDER BY created_at DESC LIMIT v_limit OFFSET v_off) b), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.admin_pilot_overview(integer, boolean), public.admin_pro_acquisition(integer, boolean),
  public.admin_pro_retention(boolean), public.admin_buyers_stats(integer, boolean), public.admin_money_issues(boolean),
  public.admin_money_issue_done(uuid, text), public.admin_costs_list(integer, numeric),
  public.admin_cost_set(date, text, numeric, text, text), public.admin_cost_delete(uuid, text),
  public.admin_invoices_list(integer, integer, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pilot_overview(integer, boolean), public.admin_pro_acquisition(integer, boolean),
  public.admin_pro_retention(boolean), public.admin_buyers_stats(integer, boolean), public.admin_money_issues(boolean),
  public.admin_money_issue_done(uuid, text), public.admin_costs_list(integer, numeric),
  public.admin_cost_set(date, text, numeric, text, text), public.admin_cost_delete(uuid, text),
  public.admin_invoices_list(integer, integer, boolean)
  TO authenticated;
