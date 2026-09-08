-- Tracking super admin : sortir la démonstration des chiffres, compter les
-- guest list comme des clients, suivre les inscriptions.
--
-- Contexte (relevé du 2026-09-08, avant purge). Le dashboard admin agrégeait
-- TOUT : les 261 811 € affichés étaient intégralement fictifs (aucune session
-- `cs_live_` dans la base). Les clubs de test ont été purgés, mais le club
-- démo Yuno et les orgas démo — qu'on garde, le reviewer Apple et les captures
-- produit en dépendent — portent à eux seuls ~258 000 € de faux revenus.
-- Impossible de nettoyer par la suppression : la démo doit être EXCLUE du
-- calcul, pas effacée.
--
-- Trois apports :
--   1. `is_demo_email` / `demo_venue_ids` / `demo_event_ids` — porte UNIQUE de
--      la notion « démonstration ». Toute surface admin la traverse.
--   2. Un client n'est plus seulement quelqu'un qui a payé : une entrée en
--      guest list fait de vous un client (dépense 0). C'est la population
--      réelle de la plateforme, pas la population facturée.
--   3. `admin_signup_stats` — la création de compte devient une métrique
--      suivie dans le temps, pas un COUNT(*) brut sans historique.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Porte unique « démonstration »
-- ─────────────────────────────────────────────────────────────────────────────

-- Un compte de démonstration n'est jamais un vrai client :
--   @womber.fr           → comptes démo + reviewer Apple (voir demo-login)
--   vitrine+…@yunoapp.eu → comptes fantômes de prospection (comptes vitrine)
--   deleted-…@deleted.local → résidu d'une suppression de compte
CREATE OR REPLACE FUNCTION public.is_demo_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT p_email IS NOT NULL AND (
       lower(p_email) LIKE '%@womber.fr'
    OR lower(p_email) LIKE 'vitrine+%@yunoapp.eu'
    OR lower(p_email) LIKE 'deleted-%@deleted.local'
  );
$function$;

COMMENT ON FUNCTION public.is_demo_email(text) IS
  'Porte unique : cet email est-il un compte de démonstration / vitrine ? Toute surface de tracking super admin doit passer par ici.';

-- Clubs de démonstration : ceux d'un propriétaire démo, et les vitrines de
-- prospection (leur propriétaire est un fantôme, elles n''ont jamais vendu).
CREATE OR REPLACE FUNCTION public.demo_venue_ids()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(v.id), '{}'::text[])
  FROM public.venues v
  LEFT JOIN public.profiles p ON p.id = v.owner_id
  WHERE public.is_demo_email(p.email)
     OR v.showcase_shadow_owner_id IS NOT NULL;
$function$;

-- Soirées de démonstration : celles d'un club démo (y compris hébergées en
-- co-soirée) et celles d'un organisateur démo ou vitrine.
CREATE OR REPLACE FUNCTION public.demo_event_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(e.id), '{}'::uuid[])
  FROM public.events e
  LEFT JOIN public.profiles op ON op.id = e.organizer_user_id
  LEFT JOIN public.organizer_profiles o ON o.user_id = e.organizer_user_id
  WHERE e.venue_id = ANY (public.demo_venue_ids())
     OR e.partner_venue_id = ANY (public.demo_venue_ids())
     OR public.is_demo_email(op.email)
     OR COALESCE(o.is_showcase_shadow, false);
$function$;

GRANT EXECUTE ON FUNCTION public.is_demo_email(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.demo_venue_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.demo_event_ids() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Activité client : payée ET guest list, démo exclue
-- ─────────────────────────────────────────────────────────────────────────────

-- Toute l'activité qui fait de quelqu'un un client de la plateforme.
-- `is_paid = false` pour une entrée en guest list : elle compte comme une
-- venue (fréquence, récence, présence), jamais comme du revenu.
CREATE OR REPLACE FUNCTION public._admin_customer_activity()
RETURNS TABLE(em text, amount numeric, created_at timestamptz, kind text,
              venue_id text, event_id uuid, is_paid boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT lower(t.user_email), t.total_price::numeric, t.created_at, 'tickets'::text,
         COALESCE(e.venue_id, e.partner_venue_id), t.event_id, true
  FROM tickets t
  LEFT JOIN events e ON e.id = t.event_id
  WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    AND NOT public.is_demo_email(t.user_email)
    -- COALESCE : sans lui, un event_id ou un venue_id NULL rend la comparaison
    -- NULL et la ligne disparaît en silence au lieu d'être gardée.
    AND NOT COALESCE(t.event_id = ANY (public.demo_event_ids()), false)
    AND NOT COALESCE(COALESCE(e.venue_id, e.partner_venue_id) = ANY (public.demo_venue_ids()), false)
  UNION ALL
  SELECT lower(o.user_email), o.total::numeric, o.created_at, 'drinks'::text,
         o.venue_id, o.event_id, true
  FROM orders o
  WHERE o.user_email IS NOT NULL AND o.status IN ('paid', 'served')
    AND NOT public.is_demo_email(o.user_email)
    AND NOT COALESCE(o.venue_id = ANY (public.demo_venue_ids()), false)
  UNION ALL
  SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, 'tables'::text,
         COALESCE(e.venue_id, e.partner_venue_id), tr.event_id, true
  FROM table_reservations tr
  LEFT JOIN events e ON e.id = tr.event_id
  WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
    AND NOT public.is_demo_email(tr.user_email)
    AND NOT COALESCE(tr.event_id = ANY (public.demo_event_ids()), false)
    AND NOT COALESCE(COALESCE(e.venue_id, e.partner_venue_id) = ANY (public.demo_venue_ids()), false)
  UNION ALL
  -- Guest list : la personne est venue, elle n'a rien payé à Yuno. C'est la
  -- moitié manquante de la base client — sur une soirée sans billetterie, elle
  -- en est la TOTALITÉ.
  SELECT lower(gle.email), 0::numeric, gle.created_at, 'guestlist'::text,
         COALESCE(e.venue_id, e.partner_venue_id), e.id, false
  FROM guest_list_entries gle
  JOIN guest_lists g ON g.id = gle.guest_list_id
  LEFT JOIN events e ON e.id = g.event_id
  WHERE gle.email IS NOT NULL AND gle.status <> 'cancelled'
    AND NOT public.is_demo_email(gle.email)
    AND NOT COALESCE(e.id = ANY (public.demo_event_ids()), false)
    AND NOT COALESCE(COALESCE(e.venue_id, e.partner_venue_id) = ANY (public.demo_venue_ids()), false)
$function$;

-- L'activité PAYÉE reste dérivée de la même source : une seule définition de la
-- démo, un seul endroit où la changer.
CREATE OR REPLACE FUNCTION public._admin_paid_activity()
RETURNS TABLE(em text, amount numeric, created_at timestamptz, kind text,
              venue_id text, event_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.em, a.amount, a.created_at, a.kind, a.venue_id, a.event_id
  FROM public._admin_customer_activity() a
  WHERE a.is_paid;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RFM : la guest list fait partie de la base client
-- ─────────────────────────────────────────────────────────────────────────────

-- DROP + CREATE : le type de retour gagne deux colonnes (guestlist_count,
-- has_paid). CREATE OR REPLACE refuserait de changer la signature.
DROP FUNCTION IF EXISTS public._admin_customer_rfm();

CREATE FUNCTION public._admin_customer_rfm()
RETURNS TABLE(em text, total_spent numeric, rev_30d numeric, rev_90d numeric,
              rev_prev_90d numeric, avg_basket numeric, tx_count bigint,
              ticket_count bigint, order_count bigint, table_count bigint,
              visit_nights bigint, venues_count bigint, venue_ids text[],
              first_at timestamptz, last_at timestamptz,
              r_score integer, f_score integer, m_score integer,
              segment text, tier text, category text,
              guestlist_count bigint, has_paid boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cust AS (
    -- Récence, fréquence et nombre de nuits comptent TOUTE l'activité (guest
    -- list incluse). Les montants ne comptent que ce qui a été payé : une
    -- entrée gratuite ne doit jamais diluer le panier moyen ni la LTV.
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.is_paid), 0) AS total_spent,
      COALESCE(sum(a.amount) FILTER (WHERE a.is_paid AND a.created_at >= now() - interval '30 days'), 0) AS rev_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.is_paid AND a.created_at >= now() - interval '90 days'), 0) AS rev_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.is_paid
                                       AND a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS rev_prev_90d,
      avg(a.amount) FILTER (WHERE a.is_paid) AS avg_basket,
      count(*) FILTER (WHERE a.is_paid) AS tx_count,
      count(*) FILTER (WHERE a.kind = 'tickets') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'drinks') AS order_count,
      count(*) FILTER (WHERE a.kind = 'tables') AS table_count,
      count(*) FILTER (WHERE a.kind = 'guestlist') AS guestlist_count,
      bool_or(a.is_paid) AS has_paid,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      count(DISTINCT a.venue_id) FILTER (WHERE a.venue_id IS NOT NULL) AS venues_count,
      array_remove(array_agg(DISTINCT a.venue_id), NULL) AS venue_ids,
      min(a.created_at) AS first_at,
      max(a.created_at) AS last_at
    FROM public._admin_customer_activity() a
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
    -- Une personne jamais passée à la caisse est rangée sous 'guestlist' : la
    -- classer 'mixed' la rendait indistinguable d'un vrai acheteur multi-pilier.
    CASE
      WHEN NOT s.has_paid THEN 'guestlist'
      WHEN s.ticket_count > s.order_count AND s.ticket_count > s.table_count THEN 'tickets'
      WHEN s.order_count > s.ticket_count AND s.order_count > s.table_count THEN 'drinks'
      WHEN s.table_count > s.ticket_count AND s.table_count > s.order_count THEN 'tables'
      ELSE 'mixed'
    END AS category,
    s.guestlist_count, s.has_paid
  FROM scored s
$function$;

-- Totaux de segmentation : distinguer payeurs et guest list.
CREATE OR REPLACE FUNCTION public.admin_segmentation_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        -- Un client est quelqu'un qui est VENU, pas seulement quelqu'un qui a
        -- payé : sur une soirée sans billetterie, la guest list est la seule
        -- trace d'une venue.
        'paying', count(*) FILTER (WHERE has_paid),
        'guestlist_only', count(*) FILTER (WHERE NOT has_paid),
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Analytics plateforme : la démo sort des chiffres
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_platform_analytics(
  p_from timestamptz, p_to timestamptz, p_venue_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$

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
      AND NOT COALESCE(o.venue_id = ANY (public.demo_venue_ids()), false)
      AND NOT public.is_demo_email(o.user_email)
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
      AND NOT COALESCE(t.event_id = ANY (public.demo_event_ids()), false)
      AND NOT public.is_demo_email(t.user_email)
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
      AND NOT COALESCE(tr.event_id = ANY (public.demo_event_ids()), false)
      AND NOT public.is_demo_email(tr.user_email)
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
    FROM days LEFT JOIN profiles p
      ON date(p.created_at) = days.d
     AND NOT public.is_demo_email(p.email)
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
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
        WHERE p.created_at >= p_from AND p.created_at <= p_to
          AND NOT public.is_demo_email(p.email)
          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
      'total_users', (SELECT count(*) FROM profiles p
        WHERE NOT public.is_demo_email(p.email)
          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
      'new_venues', (SELECT count(*) FROM venues v
        WHERE v.created_at >= p_from AND v.created_at <= p_to
          AND NOT COALESCE(v.id = ANY (public.demo_venue_ids()), false)),
      'new_events', (SELECT count(*) FROM events e
        WHERE e.created_at >= p_from AND e.created_at <= p_to
          AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
          AND NOT COALESCE(e.id = ANY (public.demo_event_ids()), false))
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Inscriptions : une métrique suivie, pas un COUNT(*) sans histoire
-- ─────────────────────────────────────────────────────────────────────────────

-- Combien de personnes ont créé un compte Yuno, et à quel rythme.
-- Ne compte que de vraies inscriptions : ni comptes démo/vitrine, ni profils
-- orphelins (une ligne `profiles` sans `auth.users` n'est plus un compte —
-- voir docs/ORPHAN_PROFILES.md). Les pros sont comptés à part : une
-- inscription de club n'est pas une inscription de fêtard.
CREATE OR REPLACE FUNCTION public.admin_signup_stats(
  p_from timestamptz DEFAULT (now() - interval '30 days'),
  p_to   timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH real_accounts AS (
    SELECT p.id, p.created_at, p.email,
           EXISTS (
             SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = p.id
               AND ur.role IN ('owner'::app_role, 'manager'::app_role, 'organizer'::app_role,
                               'promoter'::app_role, 'affiliate'::app_role, 'agency'::app_role,
                               'dj'::app_role, 'barman'::app_role, 'bouncer'::app_role,
                               'vip_host'::app_role, 'cloakroom'::app_role, 'admin'::app_role)
           ) AS is_pro
    FROM public.profiles p
    WHERE NOT public.is_demo_email(p.email)
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') gs(d)
  ),
  by_day AS (
    SELECT days.d,
      count(a.id) AS n,
      count(a.id) FILTER (WHERE NOT a.is_pro) AS n_client,
      count(a.id) FILTER (WHERE a.is_pro) AS n_pro
    FROM days LEFT JOIN real_accounts a ON date(a.created_at) = days.d
    GROUP BY days.d ORDER BY days.d
  ),
  by_month AS (
    SELECT to_char(date_trunc('month', a.created_at), 'YYYY-MM') AS m, count(*) AS n
    FROM real_accounts a
    WHERE a.created_at >= date_trunc('month', now()) - interval '11 months'
    GROUP BY 1 ORDER BY 1
  )
  SELECT jsonb_build_object(
    'total',          (SELECT count(*) FROM real_accounts),
    'total_client',   (SELECT count(*) FROM real_accounts WHERE NOT is_pro),
    'total_pro',      (SELECT count(*) FROM real_accounts WHERE is_pro),
    'in_range',       (SELECT count(*) FROM real_accounts WHERE created_at >= p_from AND created_at <= p_to),
    'new_7d',         (SELECT count(*) FROM real_accounts WHERE created_at >= now() - interval '7 days'),
    'new_30d',        (SELECT count(*) FROM real_accounts WHERE created_at >= now() - interval '30 days'),
    'prev_30d',       (SELECT count(*) FROM real_accounts
                        WHERE created_at >= now() - interval '60 days'
                          AND created_at <  now() - interval '30 days'),
    'first_signup_at',(SELECT min(created_at) FROM real_accounts),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(d, 'YYYY-MM-DD'), 'n', n, 'client', n_client, 'pro', n_pro
      )) FROM by_day), '[]'::jsonb),
    'by_month', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'm', m, 'n', n
      )) FROM by_month), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_signup_stats(timestamptz, timestamptz) TO authenticated;
