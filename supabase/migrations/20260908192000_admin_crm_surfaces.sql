-- Les trois surfaces client passent par l'identité unique et rendent le CRM.
--
-- Liste : plus de doublons, et les colonnes qui décident de l'action (compte,
-- app, canaux joignables, étiquettes) avec leurs filtres.
-- Fiche : joignabilité, notes, étiquettes, et une timeline qui inclut enfin la
-- guest list.
-- Totaux : combien ont l'app, combien sont joignables, combien sont une impasse.

-- DROP + CREATE : la fonction gagne quatre paramètres. Une surcharge rendrait
-- l'appel ambigu pour les bundles en cache (erreur 300).
DROP FUNCTION IF EXISTS public.admin_segmentation_customers(text, text, text, text, text, boolean, text, text, integer, integer);

CREATE FUNCTION public.admin_segmentation_customers(
  p_segment text DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_activity text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_multi_venue boolean DEFAULT NULL,
  p_sort text DEFAULT NULL,
  p_dir text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_account text DEFAULT NULL,   -- 'yes' | 'no'
  p_app text DEFAULT NULL,       -- 'yes' | 'no'
  p_reach text DEFAULT NULL,     -- 'email' | 'sms' | 'push' | 'none'
  p_tag text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      SELECT b.*, i.user_id, i.first_name, i.last_name, i.city,
        i.has_account, i.has_app, i.app_platforms, i.push_on,
        i.email_opt_in, i.sms_opt_in, i.email_suppressed, i.is_suspended,
        COALESCE(c.tags, '{}'::text[]) AS tags,
        CASE WHEN b.rev_prev_90d > 0
             THEN round((b.rev_90d - b.rev_prev_90d) / b.rev_prev_90d * 100, 1)
             WHEN b.rev_90d > 0 THEN 100 ELSE 0 END AS trend_pct
      FROM _admin_customer_rfm() b
      -- LATERAL : un email en doublon dans profiles ne produit plus deux lignes.
      LEFT JOIN LATERAL public._admin_customer_identity(b.em) i ON true
      LEFT JOIN crm_customers c ON c.email = b.em
    ) x
    WHERE (p_segment IS NULL OR x.segment = p_segment)
      AND (p_tier IS NULL OR x.tier = p_tier)
      AND (p_category IS NULL OR x.category = p_category)
      AND (p_activity IS NULL
        OR (p_activity = 'active_30d' AND x.last_at >= now() - interval '30 days')
        OR (p_activity = 'cooling' AND x.last_at < now() - interval '30 days' AND x.last_at >= now() - interval '90 days')
        OR (p_activity = 'lapsed' AND x.last_at < now() - interval '90 days'))
      AND (p_multi_venue IS NULL OR (p_multi_venue AND x.venues_count >= 2) OR (NOT p_multi_venue AND x.venues_count <= 1))
      AND (p_account IS NULL
        OR (p_account = 'yes' AND x.has_account)
        OR (p_account = 'no' AND NOT x.has_account))
      AND (p_app IS NULL
        OR (p_app = 'yes' AND x.has_app)
        OR (p_app = 'no' AND NOT x.has_app))
      AND (p_reach IS NULL
        OR (p_reach = 'email' AND x.email_opt_in)
        OR (p_reach = 'sms' AND x.sms_opt_in)
        OR (p_reach = 'push' AND x.push_on)
        -- 'none' : ni compte, ni email, ni SMS, ni push. Personne qu'on ne peut
        -- plus recontacter par aucun canal.
        OR (p_reach = 'none' AND NOT x.has_account AND NOT x.email_opt_in
            AND NOT x.sms_opt_in AND NOT x.push_on))
      AND (p_tag IS NULL OR length(trim(p_tag)) = 0 OR x.tags @> ARRAY[trim(p_tag)])
      AND (p_search IS NULL OR length(trim(p_search)) = 0
        OR x.em ILIKE '%' || trim(p_search) || '%'
        OR (COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) ILIKE '%' || trim(p_search) || '%'
        OR EXISTS (SELECT 1 FROM unnest(x.tags) tg WHERE tg ILIKE '%' || trim(p_search) || '%'))
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
        'has_account', f.has_account,
        'has_app', f.has_app,
        'app_platforms', f.app_platforms,
        'push_on', f.push_on,
        'email_opt_in', f.email_opt_in,
        'sms_opt_in', f.sms_opt_in,
        'email_suppressed', f.email_suppressed,
        'is_suspended', f.is_suspended,
        'tags', f.tags,
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
        'guestlist_count', f.guestlist_count,
        'has_paid', f.has_paid,
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
$function$;

GRANT EXECUTE ON FUNCTION public.admin_segmentation_customers(text, text, text, text, text, boolean, text, text, integer, integer, text, text, text, text) TO authenticated;

-- Totaux : ajouter app et joignabilité, et passer par l'identité unique.
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
    -- Identité résolue à UNE ligne par email : la jointure directe sur profiles
    -- dupliquait chaque personne ayant un profil orphelin en doublon.
    SELECT b.*, i.user_id, i.city,
      COALESCE(nullif(trim(i.gender), ''), gle.gender) AS gender,
      CASE WHEN i.birth_date IS NOT NULL
           THEN date_part('year', age(i.birth_date))::int END AS age,
      i.has_account, i.has_app, i.email_opt_in, i.sms_opt_in
    FROM base b
    LEFT JOIN LATERAL public._admin_customer_identity(b.em) i ON true
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
        -- Qui est joignable, et par quoi. C'est ce qui décide de la prochaine
        -- action : un client sans compte et sans opt-in est une impasse.
        'with_app', count(*) FILTER (WHERE has_app),
        'reach_email', count(*) FILTER (WHERE email_opt_in),
        'reach_sms', count(*) FILTER (WHERE sms_opt_in),
        'unreachable', count(*) FILTER (WHERE NOT COALESCE(has_account, false)
                                          AND NOT COALESCE(email_opt_in, false)
                                          AND NOT COALESCE(sms_opt_in, false)),
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

-- Fiche client : joignabilité, étiquettes, notes, timeline complète.
CREATE OR REPLACE FUNCTION public.admin_customer_detail(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        'user_id', i.user_id, 'first_name', i.first_name, 'last_name', i.last_name,
        'phone', i.phone, 'city', i.city, 'gender', i.gender,
        'age', CASE WHEN i.birth_date IS NOT NULL
                    THEN date_part('year', age(i.birth_date))::int END,
        'created_at', i.account_created_at, 'preferred_language', i.preferred_language,
        'party_persona', (SELECT p.party_persona FROM profiles p WHERE p.id = i.user_id),
        'is_suspended', i.is_suspended,
        'sms_opt_in', i.sms_opt_in, 'avatar_url', i.avatar_url,
        -- Ce qui décide de l'action : compte, app, canaux joignables.
        'has_account', i.has_account, 'profile_count', i.profile_count,
        'has_app', i.has_app, 'app_platforms', i.app_platforms,
        'email_opt_in', i.email_opt_in, 'email_suppressed', i.email_suppressed
      ) FROM public._admin_customer_identity(v_em) i
    ),
    'tags', COALESCE((SELECT to_jsonb(c.tags) FROM crm_customers c WHERE c.email = v_em), '[]'::jsonb),
    'notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'body', n.body, 'created_at', n.created_at
      ) ORDER BY n.created_at DESC)
      FROM crm_customer_notes n WHERE n.email = v_em
    ), '[]'::jsonb),
    -- Timeline COMPLÈTE : la guest list en fait partie. La version précédente
    -- lisait _admin_paid_activity, donc un client venu sans payer avait une
    -- fiche vide alors qu'il était bien là.
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'amount', round(r.amount, 2), 'created_at', r.created_at,
        'is_paid', r.is_paid,
        'venue_name', COALESCE(v.name, r.venue_id), 'event_title', e.title
      ) ORDER BY r.created_at DESC)
      FROM (
        SELECT a.kind, a.amount, a.created_at, a.venue_id, a.event_id, a.is_paid
        FROM public._admin_customer_activity() a
        WHERE a.em = v_em
        ORDER BY a.created_at DESC LIMIT 50
      ) r
      LEFT JOIN venues v ON v.id = r.venue_id
      LEFT JOIN events e ON e.id = r.event_id
    ), '[]'::jsonb),
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
$function$;
