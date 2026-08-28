-- ─────────────────────────────────────────────────────────────────────────────
-- Les acheteurs INVITÉS (guest checkout, user_id NULL) entrent dans le CRM.
--
-- Option retenue : UNION à la LECTURE dans _venue_customer_rfm — AUCUNE
-- modification des fonctions de paiement (philosophie fail-open des tracked
-- links : le chemin argent reste gelé). Une ligne synthétique est construite
-- par email pour toute adresse ayant acheté au club sans ligne venue_customers.
--
-- Conséquences assumées :
--   • id synthétique DÉTERMINISTE md5('guest:'||email)::uuid — stable entre
--     deux appels (clés React, maps front), jamais résolvable vers une vraie
--     ligne. user_id NULL + is_guest=true (nouvelle colonne de sortie).
--   • Les invités entrent dans la POPULATION des quintiles RFM : les segments
--     des clients à compte peuvent bouger là où il y a beaucoup d'invités —
--     c'est voulu (ce sont de vrais clients du club).
--   • total_spent invité = somme des montants facturés (même sémantique gross
--     que increment_venue_customer_stats côté comptes).
--   • is_banned via venue_banned_emails (le ban email existait déjà).
--   • Pas de notes / incidents / timeline sur un invité pur (pas de compte) —
--     le front désactive ces actions (is_guest).
--   • « Fusion » naturelle : dès qu'une vraie ligne venue_customers existe au
--     même email (claim d'achat ou nouvel achat connecté), la ligne synthétique
--     disparaît (anti-jointure sur l'email).
--   • resolve_venue_segment hérite sans changement : le push intersecte
--     user_id (invités exclus d'office), l'email matche par email (invités
--     inclus ssi opt-in newsletter — le trigger d'auto-abonnement au checkout
--     couvre le guest qui a coché la case).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.get_venue_customer_segments(TEXT);
DROP FUNCTION public._venue_customer_rfm(TEXT);

CREATE FUNCTION public._venue_customer_rfm(p_venue_id TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, email TEXT, first_name TEXT, last_name TEXT, phone TEXT,
  first_visit_at TIMESTAMPTZ, last_visit_at TIMESTAMPTZ, total_spent NUMERIC,
  ticket_count INTEGER, order_count INTEGER, table_count INTEGER,
  is_banned BOOLEAN, banned_at TIMESTAMPTZ, ban_reason TEXT, notes TEXT,
  revenue_30d NUMERIC, revenue_90d NUMERIC, revenue_prev_90d NUMERIC,
  avg_basket NUMERIC, visit_nights INTEGER, visits_per_month NUMERIC,
  last_activity_at TIMESTAMPTZ, preferred_dow INTEGER, preferred_event_title TEXT,
  recency_days INTEGER, rfm_r INTEGER, rfm_f INTEGER, rfm_m INTEGER,
  rfm_segment TEXT, rfm_tier TEXT, churn_risk BOOLEAN, is_guest BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fonction INTERNE : aucune garde ici, droits révoqués plus bas.
  RETURN QUERY
  WITH venue_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
  ),
  -- Revenu club = montant facturé − frais Yuno. La part Yuno n'est jamais comptée.
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, ve.start_at, ve.title, count(*) AS cnt
    FROM activity a JOIN venue_events ve ON ve.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, ve.start_at, ve.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  ),
  -- Ventes brutes par email : sémantique gross (= increment_venue_customer_stats),
  -- identité (nom/tél du dernier achat qui en porte), compteurs par pilier.
  guest_sales AS (
    SELECT lower(t.user_email) AS em, t.total_price::numeric AS gross, t.created_at,
           'ticket'::text AS kind, t.full_name, t.phone AS ph
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email), o.total::numeric, o.created_at, 'order', NULL, NULL
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, 'table', tr.full_name, tr.phone
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  guest_identity AS (
    SELECT DISTINCT ON (gs.em) gs.em, gs.full_name, gs.ph
    FROM guest_sales gs
    WHERE gs.full_name IS NOT NULL OR gs.ph IS NOT NULL
    ORDER BY gs.em, gs.created_at DESC
  ),
  guest_agg AS (
    SELECT gs.em,
      sum(gs.gross) AS total_spent,
      count(*) FILTER (WHERE gs.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE gs.kind = 'order')  AS order_count,
      count(*) FILTER (WHERE gs.kind = 'table')  AS table_count,
      min(gs.created_at) AS first_at,
      max(gs.created_at) AS last_at
    FROM guest_sales gs
    -- Anti-jointure : seuls les emails SANS ligne venue_customers deviennent invités.
    WHERE NOT EXISTS (
      SELECT 1 FROM venue_customers vc
      WHERE vc.venue_id = p_venue_id AND lower(vc.email) = gs.em
    )
    GROUP BY gs.em
  ),
  base AS (
    -- Clients à compte (lignes venue_customers)
    SELECT
      vc.id, vc.user_id, vc.email, vc.first_name, vc.last_name, vc.phone,
      vc.first_visit_at, vc.last_visit_at, vc.total_spent,
      vc.ticket_count, vc.order_count, vc.table_count,
      vc.is_banned, vc.banned_at, vc.ban_reason, vc.notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, vc.last_visit_at, vc.first_visit_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE COALESCE(vc.ticket_count, 0) + COALESCE(vc.order_count, 0) + COALESCE(vc.table_count, 0)
      END AS rfm_freq,
      COALESCE(vc.total_spent, 0)::numeric AS rfm_money,
      false AS is_guest
    FROM venue_customers vc
    LEFT JOIN agg ag ON ag.em = lower(vc.email)
    LEFT JOIN pref_event pe ON pe.em = lower(vc.email)
    LEFT JOIN pref_dow pd ON pd.em = lower(vc.email)
    WHERE vc.venue_id = p_venue_id

    UNION ALL

    -- Invités (lignes synthétiques par email)
    SELECT
      md5('guest:' || ga.em)::uuid AS id,
      NULL::uuid AS user_id,
      ga.em AS email,
      NULLIF(split_part(COALESCE(gi.full_name, ''), ' ', 1), '') AS first_name,
      NULLIF(regexp_replace(COALESCE(gi.full_name, ''), '^\S+\s*', ''), '') AS last_name,
      gi.ph AS phone,
      ga.first_at AS first_visit_at,
      ga.last_at AS last_visit_at,
      COALESCE(ga.total_spent, 0) AS total_spent,
      ga.ticket_count::int, ga.order_count::int, ga.table_count::int,
      (vbe.email IS NOT NULL) AS is_banned,
      vbe.banned_at,
      vbe.ban_reason,
      NULL::text AS notes,
      ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS visits_per_month,
      ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ga.last_at, ga.first_at, now()))) / 86400)::int AS recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ga.ticket_count + ga.order_count + ga.table_count)::int
      END AS rfm_freq,
      COALESCE(ga.total_spent, 0)::numeric AS rfm_money,
      true AS is_guest
    FROM guest_agg ga
    LEFT JOIN guest_identity gi ON gi.em = ga.em
    LEFT JOIN agg ag ON ag.em = ga.em
    LEFT JOIN pref_event pe ON pe.em = ga.em
    LEFT JOIN pref_dow pd ON pd.em = ga.em
    LEFT JOIN venue_banned_emails vbe ON vbe.venue_id = p_venue_id AND lower(vbe.email) = ga.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.recency_days) - 1)::numeric AS rec_below,
      (rank() OVER (ORDER BY b.rfm_freq) - 1)::numeric     AS freq_below,
      (rank() OVER (ORDER BY b.rfm_money) - 1)::numeric    AS mon_below
    FROM base b
  ),
  scored AS (
    SELECT rk.*,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE 6 - least(5, greatest(1, floor((rk.rec_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_r,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m
    FROM ranked rk
  )
  SELECT
    s.id, s.user_id, s.email, s.first_name, s.last_name, s.phone,
    s.first_visit_at, s.last_visit_at, s.total_spent,
    s.ticket_count, s.order_count, s.table_count,
    s.is_banned, s.banned_at, s.ban_reason, s.notes,
    s.revenue_30d, s.revenue_90d, s.revenue_prev_90d, s.avg_basket,
    s.visit_nights, s.visits_per_month,
    s.last_activity_at, s.preferred_dow, s.preferred_event_title,
    s.recency_days,
    s.s_r::int AS rfm_r, s.s_f::int AS rfm_f, s.s_m::int AS rfm_m,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text AS rfm_segment,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text AS rfm_tier,
    (s.s_f >= 3 AND s.recency_days > 45 AND s.recency_days <= 180) AS churn_risk,
    s.is_guest
  FROM scored s
  ORDER BY s.last_visit_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public._venue_customer_rfm(TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_venue_customer_segments(p_venue_id TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, email TEXT, first_name TEXT, last_name TEXT, phone TEXT,
  first_visit_at TIMESTAMPTZ, last_visit_at TIMESTAMPTZ, total_spent NUMERIC,
  ticket_count INTEGER, order_count INTEGER, table_count INTEGER,
  is_banned BOOLEAN, banned_at TIMESTAMPTZ, ban_reason TEXT, notes TEXT,
  revenue_30d NUMERIC, revenue_90d NUMERIC, revenue_prev_90d NUMERIC,
  avg_basket NUMERIC, visit_nights INTEGER, visits_per_month NUMERIC,
  last_activity_at TIMESTAMPTZ, preferred_dow INTEGER, preferred_event_title TEXT,
  recency_days INTEGER, rfm_r INTEGER, rfm_f INTEGER, rfm_m INTEGER,
  rfm_segment TEXT, rfm_tier TEXT, churn_risk BOOLEAN, is_guest BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT * FROM public._venue_customer_rfm(p_venue_id)
  ORDER BY 8 DESC NULLS LAST; -- last_visit_at (position : noms = variables de sortie en plpgsql)
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_venue_customer_segments(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_venue_customer_segments(TEXT) FROM anon;
