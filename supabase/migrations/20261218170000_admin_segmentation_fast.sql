-- Admin › Clients : les deux lectures de la base des acheteurs passent sous
-- la seconde (mesuré le 17/11 en super admin : 12,4 s et 11,7 s, au-delà du
-- plafond de 8 s de l'API, donc les pages Clients tombaient en erreur).
--
-- Cause : `admin_segmentation_overview` et `admin_segmentation_customers`
-- résolvaient l'identité de chaque personne par
-- `LEFT JOIN LATERAL _admin_customer_identity(b.em)`. Une fonction SECURITY
-- DEFINER n'est jamais incorporée au plan : elle s'exécute une fois PAR
-- PERSONNE, et chaque appel relit `venue_sms_contacts` en entier (≈ 23 000
-- lignes, aucun index sur lower(email)) : ≈ 31 ms × 387 personnes ≈ 12 s.
--
-- Correction : `_admin_customer_identities(text[])`, le miroir ensembliste de
-- `_admin_customer_identity` (mêmes règles, colonne par colonne), qui lit
-- chaque table une seule fois ; les deux lectures la joignent par email.
-- La base RFM est matérialisée une fois. Résultats identiques (vérifié en
-- répétition annulée sur la prod : mêmes personnes, mêmes valeurs, même
-- `total`, même suite de clés de tri ; l'aperçu est égal au jsonb près). Seul
-- ajout : la liste départage les ex-aequo par email (l'ordre entre deux
-- montants égaux n'était pas défini). Signatures, droits et
-- `is_super_admin()` inchangés ; `_admin_customer_identity` reste (lue par
-- `admin_customer_detail` / la fiche, un seul email).

CREATE OR REPLACE FUNCTION public._admin_customer_identities(p_emails text[])
 RETURNS TABLE(em text, user_id uuid, first_name text, last_name text, city text, gender text, phone text, birth_date date, avatar_url text, preferred_language text, account_created_at timestamp with time zone, is_suspended boolean, has_account boolean, profile_count integer, app_platforms text[], has_app boolean, push_on boolean, email_opt_in boolean, sms_opt_in boolean, email_suppressed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Miroir EXACT de _admin_customer_identity(email), pour une liste d'emails
  -- en une passe : chaque sous-table est lue UNE fois (jointure par hachage)
  -- au lieu d'une fois par personne. Une ligne par email reçu (dédoublonné),
  -- clé `em` = l'email tel que reçu.
  WITH e AS MATERIALIZED (
    SELECT DISTINCT x AS em, lower(x) AS le
    FROM unnest(p_emails) AS x
    WHERE x IS NOT NULL
  ),
  prof AS MATERIALIZED (
    SELECT e.em, p.id, p.first_name, p.last_name, p.city, p.gender, p.phone,
           p.birth_date, p.avatar_url, p.preferred_language, p.created_at,
           p.is_suspended, p.phone_sms_opt_in,
           EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id) AS in_auth
    FROM e
    JOIN public.profiles p ON lower(p.email) = e.le
  ),
  -- Même choix que la version unitaire : le profil VIVANT d'abord, puis le
  -- plus récent (NULLS FIRST en DESC, comme l'ORDER BY d'origine).
  pick AS MATERIALIZED (
    SELECT DISTINCT ON (pr.em) pr.*
    FROM prof pr
    ORDER BY pr.em, pr.in_auth DESC, pr.created_at DESC
  ),
  cnt AS (
    SELECT pr.em, count(*)::int AS n FROM prof pr GROUP BY pr.em
  ),
  push AS (
    SELECT ps.user_id, array_agg(DISTINCT ps.platform) AS plats
    FROM public.push_subscriptions ps
    WHERE ps.user_id IN (SELECT pk.id FROM pick pk)
    GROUP BY ps.user_id
  ),
  nl AS (
    SELECT DISTINCT lower(ns.email) AS le
    FROM public.newsletter_subscriptions ns
    WHERE ns.opted_in AND ns.product IS NULL
      AND lower(ns.email) IN (SELECT e.le FROM e)
  ),
  sms AS (
    SELECT DISTINCT lower(sc.email) AS le
    FROM public.venue_sms_contacts sc
    WHERE NOT COALESCE(sc.unsubscribed, false) AND sc.product IS NULL
      AND lower(sc.email) IN (SELECT e.le FROM e)
  ),
  sup AS (
    SELECT DISTINCT lower(es.email) AS le
    FROM public.email_suppressions es
    WHERE lower(es.email) IN (SELECT e.le FROM e)
  )
  SELECT
    e.em,
    pk.id, pk.first_name, pk.last_name, pk.city, pk.gender,
    pk.phone, pk.birth_date, pk.avatar_url, pk.preferred_language,
    pk.created_at, COALESCE(pk.is_suspended, false),
    COALESCE(pk.in_auth, false),
    COALESCE(c.n, 0),
    COALESCE(pu.plats, '{}'::text[]),
    pu.user_id IS NOT NULL,
    pu.user_id IS NOT NULL,
    nl.le IS NOT NULL,
    COALESCE(pk.phone_sms_opt_in, false) OR sms.le IS NOT NULL,
    sup.le IS NOT NULL
  FROM e
  LEFT JOIN pick pk ON pk.em = e.em
  LEFT JOIN cnt c ON c.em = e.em
  LEFT JOIN push pu ON pu.user_id = pk.id
  LEFT JOIN nl ON nl.le = e.le
  LEFT JOIN sms ON sms.le = e.le
  LEFT JOIN sup ON sup.le = e.le;
$function$;

REVOKE ALL ON FUNCTION public._admin_customer_identities(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_customer_identities(text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_segmentation_customers(p_segment text DEFAULT NULL::text, p_tier text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_activity text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_multi_venue boolean DEFAULT NULL::boolean, p_sort text DEFAULT NULL::text, p_dir text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_account text DEFAULT NULL::text, p_app text DEFAULT NULL::text, p_reach text DEFAULT NULL::text, p_tag text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_limit INT := least(greatest(COALESCE(p_limit, 50), 1), 500);
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT * FROM _admin_customer_rfm()
  ),
  ident AS MATERIALIZED (
    SELECT * FROM public._admin_customer_identities((SELECT array_agg(b.em) FROM base b))
  ),
  filtered AS (
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
      FROM base b
      -- Identité résolue EN LOT, une ligne par email (même règle que
      -- _admin_customer_identity : un doublon dans profiles ne double rien).
      LEFT JOIN ident i ON i.em = b.em
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
        CASE WHEN COALESCE(p_dir, 'desc') <> 'asc' THEN f.sort_key END DESC NULLS LAST,
        f.em
    ) AS ord
    FROM filtered f
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN f.sort_key END ASC NULLS LAST,
      CASE WHEN COALESCE(p_dir, 'desc') <> 'asc' THEN f.sort_key END DESC NULLS LAST,
      -- Départage par email : à montant égal (toutes les entrées gratuites
      -- valent 0), l'ordre n'était pas défini et une page pouvait reprendre
      -- ou sauter une personne de la page précédente.
      f.em
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

CREATE OR REPLACE FUNCTION public.admin_segmentation_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT * FROM _admin_customer_rfm()
  ),
  ident AS MATERIALIZED (
    SELECT * FROM public._admin_customer_identities((SELECT array_agg(b.em) FROM base b))
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
    LEFT JOIN ident i ON i.em = b.em
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
