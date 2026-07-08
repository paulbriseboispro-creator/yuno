-- Super Admin — segmentation client plateforme + analytics plateforme serveur.
--
-- 4 RPC SECURITY DEFINER, toutes gated sur is_super_admin() :
--   1. admin_segmentation_overview()   → agrégats RFM plateforme (segments, tiers, cohortes, démographie)
--   2. admin_segmentation_customers()  → liste clients paginée/filtrable, RFM calculé serveur
--   3. admin_customer_detail(p_email)  → fiche client 360° (par venue, transactions, incidents)
--   4. admin_platform_analytics()      → agrégats analytics plateforme (remplace le fetch client-side
--                                        qui plafonnait silencieusement à 1000 lignes PostgREST)
--
-- Sémantique argent (voir src/utils/fees.ts) :
--   - GMV / LTV client = montant payé par le client (total / total_price).
--   - CA clubs = montant payé − fees Yuno (service_fee, insurance_fee, management_fee).
--   - Revenu Yuno = somme des fees Yuno.
--
-- Scoring RFM plateforme (différent du scoring club, volontairement déterministe) :
--   - R (récence)   : fenêtres absolues en jours (14/30/60/90) — interprétable et stable.
--   - F (fréquence) : seuils absolus de nuits distinctes (1/2/3-5/6-9/10+) — ntile serait
--                     faussé par la masse de clients à 1 nuit (ties éclatés au hasard).
--   - M (monétaire) : percent_rank relatif à la base (les égalités partagent le même score).

-- ───────────────────────────────────────────────────────────────────────────
-- Index de recherche par email (lookups fiche client + jointures segmentation)
-- ───────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tickets_user_email_lower
  ON public.tickets (lower(user_email)) WHERE user_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_email_lower
  ON public.orders (lower(user_email)) WHERE user_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_table_reservations_user_email_lower
  ON public.table_reservations (lower(user_email)) WHERE user_email IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- Helper interne : activité payée plateforme, une ligne par transaction.
-- Non exposé au front (pas de GRANT) — consommé par les 3 RPC segmentation.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admin_paid_activity()
RETURNS TABLE (em TEXT, amount NUMERIC, created_at TIMESTAMPTZ, kind TEXT, venue_id TEXT, event_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(t.user_email), t.total_price::numeric, t.created_at, 'tickets'::text,
         COALESCE(e.venue_id, e.partner_venue_id), t.event_id
  FROM tickets t LEFT JOIN events e ON e.id = t.event_id
  WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
  UNION ALL
  SELECT lower(o.user_email), o.total::numeric, o.created_at, 'drinks'::text, o.venue_id, o.event_id
  FROM orders o
  WHERE o.user_email IS NOT NULL AND o.status IN ('paid', 'served')
  UNION ALL
  SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, 'tables'::text,
         COALESCE(e.venue_id, e.partner_venue_id), tr.event_id
  FROM table_reservations tr LEFT JOIN events e ON e.id = tr.event_id
  WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Helper interne : clients agrégés + scores RFM. Base commune overview + liste.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admin_customer_rfm()
RETURNS TABLE (
  em TEXT, total_spent NUMERIC, rev_30d NUMERIC, rev_90d NUMERIC, rev_prev_90d NUMERIC,
  avg_basket NUMERIC, tx_count BIGINT, ticket_count BIGINT, order_count BIGINT, table_count BIGINT,
  visit_nights BIGINT, venues_count BIGINT, venue_ids TEXT[],
  first_at TIMESTAMPTZ, last_at TIMESTAMPTZ,
  r_score INT, f_score INT, m_score INT, segment TEXT, tier TEXT, category TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cust AS (
    SELECT a.em,
      sum(a.amount) AS total_spent,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS rev_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS rev_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS rev_prev_90d,
      avg(a.amount) AS avg_basket,
      count(*) AS tx_count,
      count(*) FILTER (WHERE a.kind = 'tickets') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'drinks') AS order_count,
      count(*) FILTER (WHERE a.kind = 'tables') AS table_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      count(DISTINCT a.venue_id) FILTER (WHERE a.venue_id IS NOT NULL) AS venues_count,
      array_remove(array_agg(DISTINCT a.venue_id), NULL) AS venue_ids,
      min(a.created_at) AS first_at,
      max(a.created_at) AS last_at
    FROM _admin_paid_activity() a
    GROUP BY a.em
  ),
  scored AS (
    SELECT c.*,
      CASE
        WHEN c.last_at >= now() - interval '14 days' THEN 5
        WHEN c.last_at >= now() - interval '30 days' THEN 4
        WHEN c.last_at >= now() - interval '60 days' THEN 3
        WHEN c.last_at >= now() - interval '90 days' THEN 2
        ELSE 1
      END AS r_score,
      CASE
        WHEN c.visit_nights >= 10 THEN 5
        WHEN c.visit_nights >= 6 THEN 4
        WHEN c.visit_nights >= 3 THEN 3
        WHEN c.visit_nights = 2 THEN 2
        ELSE 1
      END AS f_score,
      least(5, 1 + floor(percent_rank() OVER (ORDER BY c.total_spent) * 5))::int AS m_score
    FROM cust c
  )
  SELECT s.em, s.total_spent, s.rev_30d, s.rev_90d, s.rev_prev_90d,
    s.avg_basket, s.tx_count, s.ticket_count, s.order_count, s.table_count,
    s.visit_nights, s.venues_count, s.venue_ids, s.first_at, s.last_at,
    s.r_score, s.f_score, s.m_score,
    CASE
      WHEN s.r_score >= 4 AND s.f_score >= 4 THEN 'champions'
      WHEN s.f_score >= 4 THEN 'loyal'
      WHEN s.r_score <= 2 AND s.f_score >= 3 THEN 'at_risk'
      WHEN s.r_score >= 4 AND s.f_score <= 2 AND s.m_score >= 3 THEN 'promising'
      WHEN s.r_score >= 4 AND s.f_score <= 2 THEN 'new'
      WHEN s.r_score >= 3 THEN 'loyal'
      WHEN s.r_score = 2 THEN 'dormant'
      ELSE 'lost'
    END AS segment,
    CASE
      WHEN s.m_score >= 5 THEN 'platinum'
      WHEN s.m_score = 4 THEN 'gold'
      WHEN s.m_score >= 2 THEN 'silver'
      ELSE 'bronze'
    END AS tier,
    CASE
      WHEN s.ticket_count > s.order_count AND s.ticket_count > s.table_count THEN 'tickets'
      WHEN s.order_count > s.ticket_count AND s.order_count > s.table_count THEN 'drinks'
      WHEN s.table_count > s.ticket_count AND s.table_count > s.order_count THEN 'tables'
      ELSE 'mixed'
    END AS category
  FROM scored s
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. admin_segmentation_overview : le tableau de bord segmentation (agrégats).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_segmentation_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT * FROM _admin_customer_rfm()
  ),
  with_profile AS (
    -- Genre : profiles.gender d'abord, sinon la dernière entrée guest list du même
    -- email (c'est là que le genre est réellement capturé pour la plupart des clients).
    SELECT b.*, p.id AS user_id, p.city,
      COALESCE(nullif(trim(p.gender), ''), gle.gender) AS gender,
      CASE WHEN p.birth_date IS NOT NULL
           THEN date_part('year', age(p.birth_date::date))::int END AS age
    FROM base b
    LEFT JOIN profiles p ON lower(p.email) = b.em
    LEFT JOIN LATERAL (
      SELECT g.gender FROM guest_list_entries g
      WHERE lower(g.email) = b.em AND g.gender IS NOT NULL
      ORDER BY g.created_at DESC LIMIT 1
    ) gle ON true
  ),
  seg_agg AS (
    SELECT segment, count(*) AS n, COALESCE(sum(total_spent), 0) AS revenue,
           COALESCE(avg(total_spent), 0) AS avg_ltv
    FROM base GROUP BY segment
  ),
  tier_agg AS (
    SELECT tier, count(*) AS n, COALESCE(sum(total_spent), 0) AS revenue
    FROM base GROUP BY tier
  ),
  cat_agg AS (
    SELECT category, count(*) AS n FROM base GROUP BY category
  ),
  cohorts AS (
    SELECT to_char(date_trunc('month', gs.m), 'YYYY-MM') AS month,
           COALESCE(c.new_customers, 0) AS new_customers,
           COALESCE(r.revenue, 0) AS revenue
    FROM generate_series(date_trunc('month', now()) - interval '11 months',
                         date_trunc('month', now()), interval '1 month') gs(m)
    LEFT JOIN (
      SELECT date_trunc('month', first_at) AS m, count(*) AS new_customers
      FROM base GROUP BY 1
    ) c ON c.m = gs.m
    LEFT JOIN (
      SELECT date_trunc('month', a.created_at) AS m, sum(a.amount) AS revenue
      FROM _admin_paid_activity() a GROUP BY 1
    ) r ON r.m = gs.m
    ORDER BY gs.m
  ),
  cities AS (
    SELECT wp.city, count(*) AS n, COALESCE(sum(wp.total_spent), 0) AS revenue
    FROM with_profile wp
    WHERE wp.city IS NOT NULL AND length(trim(wp.city)) > 0
    GROUP BY wp.city ORDER BY count(*) DESC LIMIT 12
  ),
  genders AS (
    SELECT COALESCE(nullif(trim(wp.gender), ''), 'unknown') AS gender, count(*) AS n
    FROM with_profile wp GROUP BY 1
  ),
  ages AS (
    SELECT CASE
      WHEN age < 18 THEN '<18'
      WHEN age <= 20 THEN '18-20'
      WHEN age <= 24 THEN '21-24'
      WHEN age <= 29 THEN '25-29'
      WHEN age <= 34 THEN '30-34'
      ELSE '35+'
    END AS bucket, count(*) AS n
    FROM with_profile WHERE age IS NOT NULL AND age >= 10 AND age <= 100
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'customers', count(*),
        'with_account', count(*) FILTER (WHERE user_id IS NOT NULL),
        'active_30d', count(*) FILTER (WHERE last_at >= now() - interval '30 days'),
        'new_30d', count(*) FILTER (WHERE first_at >= now() - interval '30 days'),
        'multi_venue', count(*) FILTER (WHERE venues_count >= 2),
        'churn_risk', count(*) FILTER (WHERE f_score >= 3
          AND last_at < now() - interval '45 days' AND last_at >= now() - interval '180 days'),
        'total_ltv', COALESCE(sum(total_spent), 0),
        'avg_ltv', COALESCE(avg(total_spent), 0),
        'avg_basket', COALESCE(avg(avg_basket), 0),
        'repeat_rate', CASE WHEN count(*) > 0
          THEN round(count(*) FILTER (WHERE visit_nights > 1)::numeric / count(*) * 100, 1) ELSE 0 END
      ) FROM with_profile
    ),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'key', segment, 'count', n, 'revenue', round(revenue, 2), 'avg_ltv', round(avg_ltv, 2)
    ) ORDER BY revenue DESC) FROM seg_agg), '[]'::jsonb),
    'tiers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'key', tier, 'count', n, 'revenue', round(revenue, 2)
    )) FROM tier_agg), '[]'::jsonb),
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'key', category, 'count', n
    )) FROM cat_agg), '[]'::jsonb),
    'cohorts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'month', month, 'new_customers', new_customers, 'revenue', round(revenue, 2)
    )) FROM cohorts), '[]'::jsonb),
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'city', city, 'count', n, 'revenue', round(revenue, 2)
    )) FROM cities), '[]'::jsonb),
    'genders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'gender', gender, 'count', n
    )) FROM genders), '[]'::jsonb),
    'ages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'count', n
    )) FROM ages), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. admin_segmentation_customers : liste paginée + filtres + tri serveur.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_segmentation_customers(
  p_segment TEXT DEFAULT NULL,
  p_tier TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_activity TEXT DEFAULT NULL,        -- 'active_30d' | 'cooling' | 'lapsed'
  p_search TEXT DEFAULT NULL,
  p_multi_venue BOOLEAN DEFAULT NULL,
  p_sort TEXT DEFAULT 'total_spent',   -- total_spent | last_at | visit_nights | rev_90d | first_at
  p_dir TEXT DEFAULT 'desc',
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_limit INT := least(greatest(COALESCE(p_limit, 50), 1), 500);
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT x.*,
      CASE p_sort
        WHEN 'last_at' THEN extract(epoch FROM x.last_at)
        WHEN 'first_at' THEN extract(epoch FROM x.first_at)
        WHEN 'visit_nights' THEN x.visit_nights::numeric
        WHEN 'rev_90d' THEN x.rev_90d
        ELSE x.total_spent
      END AS sort_key
    FROM (
      SELECT b.*, p.id AS user_id, p.first_name, p.last_name, p.city,
        CASE WHEN b.rev_prev_90d > 0
             THEN round((b.rev_90d - b.rev_prev_90d) / b.rev_prev_90d * 100, 1)
             WHEN b.rev_90d > 0 THEN 100 ELSE 0 END AS trend_pct
      FROM _admin_customer_rfm() b
      LEFT JOIN profiles p ON lower(p.email) = b.em
    ) x
    WHERE (p_segment IS NULL OR x.segment = p_segment)
      AND (p_tier IS NULL OR x.tier = p_tier)
      AND (p_category IS NULL OR x.category = p_category)
      AND (p_activity IS NULL
        OR (p_activity = 'active_30d' AND x.last_at >= now() - interval '30 days')
        OR (p_activity = 'cooling' AND x.last_at < now() - interval '30 days' AND x.last_at >= now() - interval '90 days')
        OR (p_activity = 'lapsed' AND x.last_at < now() - interval '90 days'))
      AND (p_multi_venue IS NULL OR (p_multi_venue AND x.venues_count >= 2) OR (NOT p_multi_venue AND x.venues_count <= 1))
      AND (p_search IS NULL OR length(trim(p_search)) = 0
        OR x.em ILIKE '%' || trim(p_search) || '%'
        OR (COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) ILIKE '%' || trim(p_search) || '%')
  ),
  page AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_dir = 'asc' THEN f.sort_key END ASC NULLS LAST,
        CASE WHEN COALESCE(p_dir, 'desc') <> 'asc' THEN f.sort_key END DESC NULLS LAST
    ) AS ord
    FROM filtered f
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN f.sort_key END ASC NULLS LAST,
      CASE WHEN COALESCE(p_dir, 'desc') <> 'asc' THEN f.sort_key END DESC NULLS LAST
    LIMIT v_limit OFFSET greatest(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'email', f.em,
        'user_id', f.user_id,
        'first_name', f.first_name,
        'last_name', f.last_name,
        'city', f.city,
        'total_spent', round(f.total_spent, 2),
        'rev_30d', round(f.rev_30d, 2),
        'rev_90d', round(f.rev_90d, 2),
        'trend_pct', f.trend_pct,
        'avg_basket', round(f.avg_basket, 2),
        'visit_nights', f.visit_nights,
        'tx_count', f.tx_count,
        'ticket_count', f.ticket_count,
        'order_count', f.order_count,
        'table_count', f.table_count,
        'venues_count', f.venues_count,
        'venue_names', (SELECT COALESCE(string_agg(v.name, ', '), '')
                        FROM venues v WHERE v.id = ANY(f.venue_ids)),
        'first_at', f.first_at,
        'last_at', f.last_at,
        'r', f.r_score, 'f', f.f_score, 'm', f.m_score,
        'segment', f.segment,
        'tier', f.tier,
        'category', f.category
      ) ORDER BY f.ord)
      FROM page f
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. admin_customer_detail : fiche 360° d'un client (par email).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_customer_detail(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_em TEXT := lower(trim(p_email));
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'identity', (
      SELECT jsonb_build_object(
        'user_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'phone', p.phone, 'city', p.city, 'gender', p.gender,
        'age', CASE WHEN p.birth_date IS NOT NULL
                    THEN date_part('year', age(p.birth_date::date))::int END,
        'created_at', p.created_at, 'preferred_language', p.preferred_language,
        'party_persona', p.party_persona, 'is_suspended', p.is_suspended,
        'sms_opt_in', p.phone_sms_opt_in, 'avatar_url', p.avatar_url
      ) FROM profiles p WHERE lower(p.email) = v_em LIMIT 1
    ),
    'stats', (
      SELECT jsonb_build_object(
        'total_spent', round(b.total_spent, 2),
        'rev_30d', round(b.rev_30d, 2), 'rev_90d', round(b.rev_90d, 2),
        'avg_basket', round(b.avg_basket, 2),
        'visit_nights', b.visit_nights, 'tx_count', b.tx_count,
        'ticket_count', b.ticket_count, 'order_count', b.order_count, 'table_count', b.table_count,
        'venues_count', b.venues_count,
        'first_at', b.first_at, 'last_at', b.last_at,
        'r', b.r_score, 'f', b.f_score, 'm', b.m_score,
        'segment', b.segment, 'tier', b.tier, 'category', b.category
      ) FROM _admin_customer_rfm() b WHERE b.em = v_em LIMIT 1
    ),
    'per_venue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'venue_id', pv.venue_id, 'venue_name', COALESCE(v.name, pv.venue_id),
        'revenue', round(pv.revenue, 2), 'tx_count', pv.tx_count, 'last_at', pv.last_at
      ) ORDER BY pv.revenue DESC)
      FROM (
        SELECT a.venue_id, sum(a.amount) AS revenue, count(*) AS tx_count, max(a.created_at) AS last_at
        FROM _admin_paid_activity() a
        WHERE a.em = v_em AND a.venue_id IS NOT NULL
        GROUP BY a.venue_id
      ) pv LEFT JOIN venues v ON v.id = pv.venue_id
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'amount', round(r.amount, 2), 'created_at', r.created_at,
        'venue_name', COALESCE(v.name, r.venue_id), 'event_title', e.title
      ) ORDER BY r.created_at DESC)
      FROM (
        SELECT a.kind, a.amount, a.created_at, a.venue_id, a.event_id
        FROM _admin_paid_activity() a
        WHERE a.em = v_em
        ORDER BY a.created_at DESC LIMIT 20
      ) r
      LEFT JOIN venues v ON v.id = r.venue_id
      LEFT JOIN events e ON e.id = r.event_id
    ), '[]'::jsonb),
    'incidents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'venue_name', COALESCE(v.name, ci.venue_id),
        'type', ci.incident_type, 'reason', ci.reason, 'created_at', ci.created_at
      ) ORDER BY ci.created_at DESC)
      FROM customer_incidents ci
      JOIN venue_customers vc ON vc.id = ci.venue_customer_id
      LEFT JOIN venues v ON v.id = ci.venue_id
      WHERE lower(vc.email) = v_em
    ), '[]'::jsonb),
    'banned_venues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'venue_name', COALESCE(v.name, vbe.venue_id), 'reason', vbe.ban_reason, 'banned_at', vbe.banned_at
      ))
      FROM venue_banned_emails vbe LEFT JOIN venues v ON v.id = vbe.venue_id
      WHERE vbe.email = v_em
    ), '[]'::jsonb),
    'newsletter_opt_in', (
      SELECT COALESCE(bool_or(ns.opted_in), false)
      FROM newsletter_subscriptions ns WHERE lower(ns.email) = v_em
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. admin_platform_analytics : agrégats analytics plateforme, côté serveur.
--    Zéro plafond PostgREST, zéro N requêtes front. Sémantique fees.ts.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_platform_analytics(
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_venue_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH tx AS (
    -- Une ligne par transaction payée dans la période, avec décomposition fees.
    SELECT o.created_at, 'drinks'::text AS kind, o.venue_id, o.event_id,
      o.total::numeric AS charged,
      (o.total::numeric - COALESCE(o.service_fee, 0)::numeric) AS club_gross,
      COALESCE(o.service_fee, 0)::numeric AS yuno_fee,
      COALESCE(o.refund_amount, 0)::numeric AS refunded,
      (o.refunded_at IS NOT NULL) AS has_refund,
      1 AS qty
    FROM orders o
    WHERE o.status IN ('paid', 'served', 'refunded')
      AND o.created_at >= p_from AND o.created_at <= p_to
      AND (p_venue_id IS NULL OR o.venue_id = p_venue_id)
      AND (o.status <> 'refunded' OR o.refunded_at IS NOT NULL)
    UNION ALL
    SELECT t.created_at, 'tickets', COALESCE(e.venue_id, e.partner_venue_id), t.event_id,
      t.total_price::numeric,
      (t.total_price::numeric - COALESCE(t.service_fee, 0)::numeric - COALESCE(t.insurance_fee, 0)::numeric),
      COALESCE(t.service_fee, 0)::numeric + COALESCE(t.insurance_fee, 0)::numeric,
      COALESCE(t.refund_amount, 0)::numeric,
      (t.refunded_at IS NOT NULL),
      COALESCE(t.quantity, 1)
    FROM tickets t LEFT JOIN events e ON e.id = t.event_id
    WHERE t.paid_at IS NOT NULL
      AND t.created_at >= p_from AND t.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
    UNION ALL
    SELECT tr.created_at, 'tables', COALESCE(e.venue_id, e.partner_venue_id), tr.event_id,
      tr.total_price::numeric,
      (tr.total_price::numeric - COALESCE(tr.service_fee, 0)::numeric - COALESCE(tr.management_fee, 0)::numeric),
      COALESCE(tr.service_fee, 0)::numeric + COALESCE(tr.management_fee, 0)::numeric,
      COALESCE(tr.refund_amount, 0)::numeric,
      (tr.refunded_at IS NOT NULL),
      1
    FROM table_reservations tr LEFT JOIN events e ON e.id = tr.event_id
    WHERE tr.paid_at IS NOT NULL
      AND tr.created_at >= p_from AND tr.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') gs(d)
  ),
  by_day AS (
    SELECT days.d,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'drinks'), 0) AS drinks,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'tickets'), 0) AS tickets,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'tables'), 0) AS tables,
      COALESCE(sum(tx.yuno_fee), 0) AS yuno,
      COALESCE(sum(tx.refunded), 0) AS refunds,
      count(tx.*) FILTER (WHERE tx.kind = 'drinks') AS drink_n,
      count(tx.*) FILTER (WHERE tx.kind = 'tickets') AS ticket_n,
      count(tx.*) FILTER (WHERE tx.kind = 'tables') AS table_n
    FROM days LEFT JOIN tx ON date(tx.created_at) = days.d
    GROUP BY days.d ORDER BY days.d
  ),
  new_users AS (
    -- Tous les nouveaux comptes (profile_type ne distingue que club/organizer,
    -- il n'existe pas de valeur 'customer' — un client = un profil sans rôle pro).
    SELECT days.d, count(p.id) AS n
    FROM days LEFT JOIN profiles p ON date(p.created_at) = days.d
    GROUP BY days.d ORDER BY days.d
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'gmv', round(COALESCE(sum(charged), 0), 2),
        'club_revenue', round(COALESCE(sum(club_gross), 0), 2),
        'yuno_revenue', round(COALESCE(sum(yuno_fee), 0), 2),
        'refunds_total', round(COALESCE(sum(refunded), 0), 2),
        'refunds_count', count(*) FILTER (WHERE has_refund),
        'tx_count', count(*),
        'tickets_qty', COALESCE(sum(qty) FILTER (WHERE kind = 'tickets'), 0),
        'ticket_sales', count(*) FILTER (WHERE kind = 'tickets'),
        'tables_booked', count(*) FILTER (WHERE kind = 'tables'),
        'drink_orders', count(*) FILTER (WHERE kind = 'drinks'),
        'avg_order', CASE WHEN count(*) > 0 THEN round(sum(charged) / count(*), 2) ELSE 0 END,
        'take_rate', CASE WHEN COALESCE(sum(charged), 0) > 0
          THEN round(sum(yuno_fee) / sum(charged) * 100, 2) ELSE 0 END
      ) FROM tx
    ),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'd', to_char(d, 'YYYY-MM-DD'),
      'drinks', round(drinks, 2), 'tickets', round(tickets, 2), 'tables', round(tables, 2),
      'total', round(drinks + tickets + tables, 2),
      'yuno', round(yuno, 2), 'refunds', round(refunds, 2),
      'drink_n', drink_n, 'ticket_n', ticket_n, 'table_n', table_n
    )) FROM by_day), '[]'::jsonb),
    'top_venues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.venue_id, 'name', COALESCE(v.name, s.venue_id), 'city', v.city,
        'revenue', round(s.revenue, 2), 'yuno', round(s.yuno, 2), 'tx', s.tx
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT venue_id, sum(club_gross) AS revenue, sum(yuno_fee) AS yuno, count(*) AS tx
        FROM tx WHERE venue_id IS NOT NULL
        GROUP BY venue_id ORDER BY sum(club_gross) DESC LIMIT 10
      ) s LEFT JOIN venues v ON v.id = s.venue_id
    ), '[]'::jsonb),
    'top_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.event_id, 'title', COALESCE(e.title, s.event_id::text),
        'venue_name', COALESCE(v.name, e.venue_id), 'start_at', e.start_at,
        'revenue', round(s.revenue, 2), 'tickets', s.tickets, 'tables', s.tables
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT event_id, sum(club_gross) AS revenue,
          COALESCE(sum(qty) FILTER (WHERE kind = 'tickets'), 0) AS tickets,
          count(*) FILTER (WHERE kind = 'tables') AS tables
        FROM tx WHERE event_id IS NOT NULL
        GROUP BY event_id ORDER BY sum(club_gross) DESC LIMIT 10
      ) s
      LEFT JOIN events e ON e.id = s.event_id
      LEFT JOIN venues v ON v.id = e.venue_id
    ), '[]'::jsonb),
    'top_organizers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.organizer_user_id,
        'name', COALESCE(op.display_name, 'Organizer'),
        'revenue', round(s.revenue, 2), 'events_count', s.events_count
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT e.organizer_user_id, sum(t.club_gross) AS revenue, count(DISTINCT t.event_id) AS events_count
        FROM tx t JOIN events e ON e.id = t.event_id
        WHERE e.organizer_user_id IS NOT NULL
        GROUP BY e.organizer_user_id ORDER BY sum(t.club_gross) DESC LIMIT 8
      ) s
      LEFT JOIN organizer_profiles op ON op.user_id::text = s.organizer_user_id::text
    ), '[]'::jsonb),
    'growth', jsonb_build_object(
      'new_users_by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(d, 'YYYY-MM-DD'), 'n', n
      )) FROM new_users), '[]'::jsonb),
      'new_users', (SELECT count(*) FROM profiles p
        WHERE p.created_at >= p_from AND p.created_at <= p_to),
      'total_users', (SELECT count(*) FROM profiles p),
      'new_venues', (SELECT count(*) FROM venues v
        WHERE v.created_at >= p_from AND v.created_at <= p_to),
      'new_events', (SELECT count(*) FROM events e
        WHERE e.created_at >= p_from AND e.created_at <= p_to
          AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
    ),
    'venue_cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', s.city, 'revenue', round(s.revenue, 2), 'tx', s.tx)
        ORDER BY s.revenue DESC)
      FROM (
        SELECT v.city, sum(t.club_gross) AS revenue, count(*) AS tx
        FROM tx t JOIN venues v ON v.id = t.venue_id
        WHERE v.city IS NOT NULL
        GROUP BY v.city ORDER BY sum(t.club_gross) DESC LIMIT 10
      ) s
    ), '[]'::jsonb),
    'subscriptions', (
      SELECT count(*) FROM venue_subscriptions vs WHERE vs.status IN ('active', 'trialing')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grants : uniquement les 4 RPC publiques (les helpers _admin_* restent internes,
-- mais SECURITY DEFINER + gate is_super_admin() dans chaque RPC publique).
REVOKE EXECUTE ON FUNCTION public._admin_paid_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._admin_customer_rfm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_segmentation_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_segmentation_customers(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_customer_detail(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_analytics(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
