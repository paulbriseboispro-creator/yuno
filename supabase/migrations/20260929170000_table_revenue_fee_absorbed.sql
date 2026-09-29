-- CA tables : les frais de gestion ne se retirent QUE s'ils sont absorbés.
--
-- `table_reservations.total_price` = le prix de la table (budget), SANS les frais
-- de gestion Yuno : le client les paie EN PLUS (create-table-checkout), sauf si
-- le club les absorbe (`fee_absorbed`, ils sortent alors de sa part). Les RPC
-- d'analyse retiraient ces frais dans tous les cas : le CA tables affiché était
-- sous-estimé d'environ 4 % de l'acompte partout (dashboards, rapports, CRM,
-- attribution, admin). Même correction que le décompte collab (29/09) et que
-- `tableRevenue` (src/utils/fees.ts). Les lignes qui calculent le revenu de
-- Yuno (`service_fee + management_fee`) ne changent pas : Yuno encaisse ces
-- frais dans les deux cas.
--
-- Généré depuis l'état LIVE (pg_get_functiondef) : seule la soustraction change.

-- _venue_customer_rfm : 1 expression(s)
CREATE OR REPLACE FUNCTION public._venue_customer_rfm(p_venue_id text)
 RETURNS TABLE(id uuid, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, is_guest boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
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
  -- Dernière valeur NON NULLE de chaque champ (et non la dernière ligne) : un
  -- achat sans numéro ne doit pas effacer le numéro laissé la fois d'avant.
  guest_identity AS (
    SELECT gs.em,
      (array_agg(gs.full_name ORDER BY gs.created_at DESC) FILTER (WHERE gs.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(gs.ph ORDER BY gs.created_at DESC) FILTER (WHERE gs.ph IS NOT NULL))[1] AS ph
    FROM guest_sales gs GROUP BY gs.em
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
      vc.id, vc.user_id, vc.email,
      COALESCE(vc.first_name, pr.first_name) AS first_name,
      COALESCE(vc.last_name, pr.last_name) AS last_name,
      COALESCE(NULLIF(btrim(COALESCE(vc.phone, '')), ''), pr.phone) AS phone,
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
    -- Repli sur le profil du compte : le fichier client doit porter le
    -- téléphone du client, même quand l'achat qui l'a créé n'en portait pas.
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name, NULLIF(btrim(COALESCE(p.phone, '')), '') AS phone
      FROM profiles p WHERE p.id = vc.user_id LIMIT 1
    ) pr ON true
    WHERE vc.venue_id = p_venue_id

    UNION ALL

    -- Invités (lignes synthétiques par email)
    SELECT
      md5('guest:' || ga.em)::uuid AS id,
      -- user_id reste NULL : un invité n'est pas un compte, et c'est ce NULL
      -- qui l'exclut d'office du ciblage push de resolve_venue_segment.
      NULL::uuid AS user_id,
      ga.em AS email,
      NULLIF(split_part(COALESCE(gi.full_name, ''), ' ', 1), '') AS first_name,
      NULLIF(regexp_replace(COALESCE(gi.full_name, ''), '^\S+\s*', ''), '') AS last_name,
      NULLIF(btrim(COALESCE(gi.ph, '')), '') AS phone,
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
      (rank() OVER (ORDER BY b.rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    SELECT rk.*,
      -- R n'est PLUS relatif : la récence est un fait de calendrier, pas une
      -- opinion sur la population. C'est là qu'était le mensonge — sur un
      -- fichier de deux personnes, la moins récente des deux tombait à 1/5 et
      -- passait « Perdue » alors qu'elle s'était inscrite l'avant-veille. Les
      -- paliers sont ceux annoncés au client dans le mode d'emploi.
      CASE WHEN rk.recency_days <= 14 THEN 5
           WHEN rk.recency_days <= 30 THEN 4
           WHEN rk.recency_days <= 60 THEN 3
           WHEN rk.recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      -- F : bande absolue en nuits, affinée ±1 par la position dans le fichier
      -- (un club qui tourne chaque semaine n'a pas le rythme d'une soirée
      -- mensuelle). M reste purement relatif : « gros dépensier » ne veut rien
      -- dire hors du contexte du lieu.
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.rfm_freq >= 10 THEN 5
           WHEN rk.rfm_freq >= 6 THEN 4
           WHEN rk.rfm_freq >= 3 THEN 3
           WHEN rk.rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
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
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
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
  FROM blended s
  ORDER BY s.last_visit_at DESC NULLS LAST;
END;
$function$;

-- admin_orders_list : 1 expression(s)
CREATE OR REPLACE FUNCTION public.admin_orders_list(p_kind text, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_limit int := least(greatest(COALESCE(p_limit, 20), 1), 200);
  v_off int := greatest(COALESCE(p_offset, 0), 0);
  v_search text := nullif(trim(COALESCE(p_search, '')), '');
  v_status text := nullif(p_status, 'all');
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'drinks' THEN
    WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
    base AS (
      SELECT o.id, o.user_email, NULL::text AS full_name, o.venue_id,
             v.name AS venue_name, NULL::text AS event_title, NULL::text AS zone_name,
             o.total::numeric AS amount,
             (o.total::numeric - COALESCE(o.service_fee, 0)::numeric) AS club_gross,
             o.status, o.created_at, o.items
      FROM orders o
      CROSS JOIN d
      LEFT JOIN venues v ON v.id = o.venue_id
      WHERE (p_include_demo OR NOT COALESCE(o.venue_id = ANY (d.dv), false))
        AND (v_search IS NULL OR o.user_email ILIKE '%' || v_search || '%')
        AND (v_status IS NULL OR o.status = v_status)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM base),
      'revenue', (SELECT COALESCE(round(sum(club_gross), 2), 0) FROM base
                   WHERE status IN ('paid', 'confirmed', 'served')),
      'refunds', (SELECT count(*) FROM base WHERE status = 'refunded'),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
                        FROM (SELECT * FROM base ORDER BY created_at DESC
                              LIMIT v_limit OFFSET v_off) x), '[]'::jsonb)
    ) INTO v_result;

  ELSIF p_kind = 'tickets' THEN
    WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de),
    base AS (
      SELECT t.id, t.user_email, t.full_name,
             COALESCE(e.venue_id, e.partner_venue_id) AS venue_id,
             v.name AS venue_name, e.title AS event_title, NULL::text AS zone_name,
             t.total_price::numeric AS amount,
             (t.total_price::numeric - COALESCE(t.service_fee, 0)::numeric
                                     - COALESCE(t.insurance_fee, 0)::numeric) AS club_gross,
             t.status, t.created_at, NULL::jsonb AS items
      FROM tickets t
      CROSS JOIN d
      LEFT JOIN events e ON e.id = t.event_id
      LEFT JOIN venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
      WHERE (p_include_demo OR (NOT COALESCE(t.event_id = ANY (d.de), false)
                            AND NOT COALESCE(COALESCE(e.venue_id, e.partner_venue_id) = ANY (d.dv), false)))
        AND (v_search IS NULL OR t.user_email ILIKE '%' || v_search || '%')
        AND (v_status IS NULL OR t.status = v_status)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM base),
      'revenue', (SELECT COALESCE(round(sum(club_gross), 2), 0) FROM base
                   WHERE status IN ('paid', 'confirmed')),
      'refunds', (SELECT count(*) FROM base WHERE status = 'refunded'),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
                        FROM (SELECT * FROM base ORDER BY created_at DESC
                              LIMIT v_limit OFFSET v_off) x), '[]'::jsonb)
    ) INTO v_result;

  ELSIF p_kind = 'guestlist' THEN
    WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de),
    base AS (
      SELECT g.id,
             g.email AS user_email,
             g.full_name,
             COALESCE(gl.venue_id, e.venue_id, e.partner_venue_id) AS venue_id,
             v.name AS venue_name,
             -- Une soirée d'organisateur n'a pas de club : l'hôte, c'est lui.
             COALESCE(v.name, op.display_name) AS host_name,
             e.title AS event_title,
             e.start_at AS event_start_at,
             NULL::text AS zone_name,
             0::numeric AS amount,
             -- Le porteur de la part est une personne, pas un uuid : club,
             -- DJ, promoteur ou agence. Le libellé saisi prime, le nom résolu
             -- prend le relais, le type sert de dernier recours côté front.
             COALESCE(
               nullif(trim(gl.holder_label), ''),
               nullif(trim(dj.stage_name), ''),
               nullif(trim(concat_ws(' ', dj.first_name, dj.last_name)), ''),
               nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
               nullif(trim(ag.name), '')
             ) AS part_label,
             gl.holder_type,
             COALESCE(g.entry_type, 'normal') AS entry_type,
             -- Une inscription ne se paie pas : son état se lit sur deux
             -- colonnes, et se résout ici pour que la liste, les compteurs et
             -- le filtre parlent tous la même langue.
             CASE
               WHEN g.status = 'cancelled' THEN 'cancelled'
               WHEN g.entry_scanned THEN 'entered'
               ELSE 'registered'
             END AS status,
             g.entry_scanned_at AS scanned_at,
             g.reservation_code,
             g.created_at,
             NULL::jsonb AS items
      FROM guest_list_entries g
      CROSS JOIN d
      JOIN guest_lists gl ON gl.id = g.guest_list_id
      LEFT JOIN events e ON e.id = gl.event_id
      LEFT JOIN venues v ON v.id = COALESCE(gl.venue_id, e.venue_id, e.partner_venue_id)
      LEFT JOIN organizer_profiles op ON op.user_id = e.organizer_user_id
      LEFT JOIN djs dj ON gl.holder_type = 'dj' AND dj.id = gl.dj_id
      LEFT JOIN promoters pr ON gl.holder_type = 'promoter' AND pr.id = gl.promoter_id
      LEFT JOIN agencies ag ON gl.holder_type = 'agency' AND ag.id = gl.agency_id
      WHERE (p_include_demo OR (NOT COALESCE(gl.event_id = ANY (d.de), false)
                            AND NOT COALESCE(COALESCE(gl.venue_id, e.venue_id, e.partner_venue_id) = ANY (d.dv), false)))
        -- Une guest list, ce sont des noms à la porte : chercher sur le seul
        -- email raterait la moitié des recherches réelles.
        AND (v_search IS NULL OR g.email ILIKE '%' || v_search || '%'
                              OR g.full_name ILIKE '%' || v_search || '%')
    ),
    filtered AS (
      SELECT * FROM base WHERE (v_status IS NULL OR status = v_status)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM filtered),
      -- Pas d'argent sur ce pilier : le chiffre qui compte est le nombre de
      -- gens réellement passés à la porte. Les compteurs suivent le filtre de
      -- statut comme sur les autres onglets.
      'revenue', 0,
      'entered', (SELECT count(*) FROM filtered WHERE status = 'entered'),
      'refunds', (SELECT count(*) FROM filtered WHERE status = 'cancelled'),
      'signups', (SELECT count(*) FROM base),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
                        FROM (SELECT * FROM filtered ORDER BY created_at DESC
                              LIMIT v_limit OFFSET v_off) x), '[]'::jsonb)
    ) INTO v_result;

  ELSE
    WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de),
    base AS (
      SELECT r.id, r.user_email, r.full_name,
             COALESCE(z.venue_id, e.venue_id, e.partner_venue_id) AS venue_id,
             v.name AS venue_name, e.title AS event_title, z.name AS zone_name,
             r.total_price::numeric AS amount,
             (r.total_price::numeric - COALESCE(r.service_fee, 0)::numeric
                                     - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)::numeric) AS club_gross,
             r.status, r.created_at, NULL::jsonb AS items
      FROM table_reservations r
      CROSS JOIN d
      LEFT JOIN events e ON e.id = r.event_id
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN venues v ON v.id = COALESCE(z.venue_id, e.venue_id, e.partner_venue_id)
      WHERE (p_include_demo OR (NOT COALESCE(r.event_id = ANY (d.de), false)
                            AND NOT COALESCE(COALESCE(z.venue_id, e.venue_id, e.partner_venue_id) = ANY (d.dv), false)))
        AND (v_search IS NULL OR r.user_email ILIKE '%' || v_search || '%')
        AND (v_status IS NULL OR r.status = v_status)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM base),
      'revenue', (SELECT COALESCE(round(sum(club_gross), 2), 0) FROM base
                   WHERE status IN ('paid', 'confirmed')),
      'refunds', (SELECT count(*) FROM base WHERE status = 'refunded'),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
                        FROM (SELECT * FROM base ORDER BY created_at DESC
                              LIMIT v_limit OFFSET v_off) x), '[]'::jsonb)
    ) INTO v_result;
  END IF;

  RETURN v_result;
END;
$function$;

-- admin_platform_analytics : 1 expression(s)
CREATE OR REPLACE FUNCTION public.admin_platform_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_venue_id text DEFAULT NULL::text)
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

  WITH d AS MATERIALIZED (
    -- Une seule évaluation de la porte démo pour toute la requête : dans un
    -- WHERE, ces fonctions STABLE sont rappelées par ligne (32 s mesurées).
    SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de
  ),
  tx AS (
    -- Une ligne par transaction payée dans la période, avec décomposition fees.
    SELECT o.created_at, 'drinks'::text AS kind, o.venue_id, o.event_id,
      o.total::numeric AS charged,
      (o.total::numeric - COALESCE(o.service_fee, 0)::numeric) AS club_gross,
      COALESCE(o.service_fee, 0)::numeric AS yuno_fee,
      COALESCE(o.refund_amount, 0)::numeric AS refunded,
      (o.refunded_at IS NOT NULL) AS has_refund,
      1 AS qty
    FROM orders o
    CROSS JOIN d
    WHERE o.status IN ('paid', 'served', 'refunded')
      AND o.created_at >= p_from AND o.created_at <= p_to
      AND (p_venue_id IS NULL OR o.venue_id = p_venue_id)
      AND (o.status <> 'refunded' OR o.refunded_at IS NOT NULL)
      AND NOT COALESCE(o.venue_id = ANY (d.dv), false)
      AND NOT public.is_demo_email(o.user_email)
    UNION ALL
    SELECT t.created_at, 'tickets', COALESCE(e.venue_id, e.partner_venue_id), t.event_id,
      t.total_price::numeric,
      (t.total_price::numeric - COALESCE(t.service_fee, 0)::numeric - COALESCE(t.insurance_fee, 0)::numeric),
      COALESCE(t.service_fee, 0)::numeric + COALESCE(t.insurance_fee, 0)::numeric,
      COALESCE(t.refund_amount, 0)::numeric,
      (t.refunded_at IS NOT NULL),
      COALESCE(t.quantity, 1)
    FROM tickets t CROSS JOIN d LEFT JOIN events e ON e.id = t.event_id
    WHERE t.paid_at IS NOT NULL
      AND t.created_at >= p_from AND t.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
      AND NOT COALESCE(t.event_id = ANY (d.de), false)
      AND NOT public.is_demo_email(t.user_email)
    UNION ALL
    SELECT tr.created_at, 'tables', COALESCE(e.venue_id, e.partner_venue_id), tr.event_id,
      tr.total_price::numeric,
      (tr.total_price::numeric - COALESCE(tr.service_fee, 0)::numeric - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END)::numeric),
      COALESCE(tr.service_fee, 0)::numeric + COALESCE(tr.management_fee, 0)::numeric,
      COALESCE(tr.refund_amount, 0)::numeric,
      (tr.refunded_at IS NOT NULL),
      1
    FROM table_reservations tr CROSS JOIN d LEFT JOIN events e ON e.id = tr.event_id
    WHERE tr.paid_at IS NOT NULL
      AND tr.created_at >= p_from AND tr.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
      AND NOT COALESCE(tr.event_id = ANY (d.de), false)
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
          AND NOT EXISTS (SELECT 1 FROM d WHERE v.id = ANY (d.dv))),
      'new_events', (SELECT count(*) FROM events e
        WHERE e.created_at >= p_from AND e.created_at <= p_to
          AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
          AND NOT EXISTS (SELECT 1 FROM d WHERE e.id = ANY (d.de)))
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

-- admin_venue_overview : 1 expression(s)
CREATE OR REPLACE FUNCTION public.admin_venue_overview(p_venue_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'venue', (SELECT to_jsonb(x) FROM (
      SELECT vn.id, vn.name, vn.slug, vn.city, vn.address, vn.created_at, vn.is_hidden, vn.decommissioned_at, vn.purge_at,
        vn.stripe_account_id, vn.stripe_onboarding_complete, vn.stripe_charges_enabled, vn.stripe_payouts_enabled,
        vn.menu_enabled, vn.vip_placement_enabled, vn.live_mode_enabled, vn.timezone, vn.owner_id, vn.showcase_shadow_owner_id,
        vn.logo_url, vn.cover_url, vn.instagram_url, vn.whatsapp_number, vn.legal_name, vn.siret,
        (vn.id = ANY (public.demo_venue_ids())) AS is_demo
      FROM public.venues vn WHERE vn.id = p_venue_id) x),
    'owner', (SELECT jsonb_build_object('id', p.id, 'email', p.email, 'name', NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'mfa_enabled', p.mfa_enabled, 'is_suspended', p.is_suspended, 'created_at', p.created_at)
      FROM public.venues vn JOIN public.profiles p ON p.id = vn.owner_id WHERE vn.id = p_venue_id),
    'onboarding', (SELECT jsonb_build_object('current_step', o.current_step, 'steps', o.steps, 'completed_at', o.completed_at)
      FROM public.venue_onboarding o WHERE o.venue_id = p_venue_id ORDER BY o.updated_at DESC LIMIT 1),
    'subscription', (SELECT jsonb_build_object('status', s.status, 'plan', s.subscription_plan, 'trial_end', s.trial_end, 'is_early_adopter', s.is_early_adopter, 'period_end', s.current_period_end)
      FROM public.venue_subscriptions s WHERE s.venue_id = p_venue_id ORDER BY s.updated_at DESC LIMIT 1),
    'revenue', jsonb_build_object(
      'drinks', (SELECT jsonb_build_object('n', count(*), 'gross', round(COALESCE(sum(o.total - COALESCE(o.service_fee, 0)), 0), 2), 'yuno', round(COALESCE(sum(o.service_fee), 0), 2))
        FROM public.orders o WHERE o.venue_id = p_venue_id AND o.status IN ('paid', 'served')),
      'tickets', (SELECT jsonb_build_object('n', COALESCE(sum(t.quantity), 0), 'gross', round(COALESCE(sum(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0)), 0), 2), 'yuno', round(COALESCE(sum(COALESCE(t.service_fee, 0) + COALESCE(t.insurance_fee, 0)), 0), 2))
        FROM public.tickets t JOIN public.events e ON e.id = t.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
      'tables', (SELECT jsonb_build_object('n', count(*), 'gross', round(COALESCE(sum(tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END)), 0), 2), 'yuno', round(COALESCE(sum(COALESCE(tr.service_fee, 0) + COALESCE(tr.management_fee, 0)), 0), 2))
        FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND tr.status IN ('paid', 'confirmed')),
      'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
        WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND ge.status IS DISTINCT FROM 'cancelled'),
      'last_sale_at', (SELECT max(x.at) FROM (
        SELECT max(o.created_at) AS at FROM public.orders o WHERE o.venue_id = p_venue_id AND o.status IN ('paid', 'served')
        UNION ALL SELECT max(t.created_at) FROM public.tickets t JOIN public.events e ON e.id = t.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND t.paid_at IS NOT NULL
        UNION ALL SELECT max(tr.created_at) FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND tr.status IN ('paid', 'confirmed')) x)
    ),
    'events', jsonb_build_object(
      'total', (SELECT count(*) FROM public.events e WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id),
      'upcoming', (SELECT count(*) FROM public.events e WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND e.end_at >= now() AND e.cancelled_at IS NULL),
      'recent', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'is_active', e.is_active, 'ticketing', e.ticketing_enabled, 'tables', e.tables_enabled,
          'cancelled', e.cancelled_at IS NOT NULL, 'organizer', op.display_name,
          'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = e.id AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
          'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id)) ORDER BY e.start_at DESC)
        FROM (SELECT * FROM public.events e WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id ORDER BY e.start_at DESC LIMIT 15) e
        LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
      ), '[]'::jsonb)
    ),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', COALESCE(p.staff_display_name, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')),
        'roles', (SELECT array_agg(ur.role::text ORDER BY ur.role) FROM public.user_roles ur WHERE ur.user_id = p.id),
        'has_pin', p.employee_pin IS NOT NULL, 'since', p.staff_since) ORDER BY p.created_at)
      FROM public.profiles p WHERE p.venue_id = p_venue_id
    ), '[]'::jsonb),
    'promoters', (SELECT count(*) FROM public.promoters pr WHERE pr.venue_id = p_venue_id AND pr.is_active),
    'customers', (SELECT count(*) FROM public.venue_customers vc WHERE vc.venue_id = p_venue_id),
    'followers', (SELECT count(*) FROM public.favorites f WHERE f.venue_id = p_venue_id AND f.favorite_type = 'club'),
    'zones', (SELECT count(*) FROM public.table_zones z WHERE z.venue_id = p_venue_id),
    'drinks', (SELECT count(*) FROM public.drinks dr WHERE dr.venue_id = p_venue_id),
    'ai_chats_30d', (SELECT count(*) FROM public.ai_usage_events a WHERE a.venue_id = p_venue_id AND a.created_at >= now() - interval '30 days'),
    'email_campaigns', (SELECT count(*) FROM public.email_campaigns c WHERE c.venue_id = p_venue_id),
    'newsletter', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE ns.venue_id = p_venue_id AND ns.opted_in),
    'support_grant', (SELECT jsonb_build_object('status', g.status, 'created_at', g.created_at) FROM public.admin_support_grants g JOIN public.venues vn ON vn.owner_id = g.target_user_id
      WHERE vn.id = p_venue_id AND g.status IN ('pending', 'active', 'approved') ORDER BY g.created_at DESC LIMIT 1)
  ) INTO v;
  RETURN v;
END $function$;

-- audience_weekly_recap_data : 1 expression(s)
CREATE OR REPLACE FUNCTION public.audience_weekly_recap_data(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_from timestamptz := now() - interval '7 days';
BEGIN
  WITH flow AS (
    SELECT
      count(*) FILTER (WHERE action = 'follow')   AS gained,
      count(*) FILTER (WHERE action = 'unfollow') AS lost
    FROM public.audience_follow_events
    WHERE subject_type = p_subject_type AND subject_id = p_subject_id
      AND created_at >= v_from
  ),
  scoped_events AS (
    SELECT id FROM public.events
     WHERE p_subject_type = 'venue' AND (venue_id = p_subject_id OR partner_venue_id = p_subject_id)
  ),
  rev AS (
    SELECT COALESCE(sum(net), 0) AS net FROM (
      SELECT (t.total_price - coalesce(t.service_fee,0) - coalesce(t.insurance_fee,0)
                - coalesce(t.refund_amount,0) - (t.total_price*0.015 + 0.25)) AS net
        FROM public.tickets t
       WHERE p_subject_type = 'venue' AND t.event_id IN (SELECT id FROM scoped_events)
         AND t.status = 'paid' AND t.created_at >= v_from
      UNION ALL
      SELECT (r.total_price - coalesce(r.service_fee,0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)
                - coalesce(r.refund_amount,0) - (r.total_price*0.015 + 0.25))
        FROM public.table_reservations r
       WHERE p_subject_type = 'venue' AND r.event_id IN (SELECT id FROM scoped_events)
         AND r.status = 'paid' AND r.created_at >= v_from
      UNION ALL
      SELECT (o.total - coalesce(o.service_fee,0) - coalesce(o.refund_amount,0) - (o.total*0.015 + 0.25))
        FROM public.orders o
       WHERE p_subject_type = 'venue' AND o.venue_id = p_subject_id
         AND o.status IN ('paid','served') AND o.created_at >= v_from
    ) s
  ),
  pushes AS (
    SELECT count(*) AS n FROM public.push_campaigns
     WHERE p_subject_type = 'venue' AND venue_id = p_subject_id
       AND created_at >= v_from AND status = 'sent'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'followers_net', (SELECT gained - lost FROM flow),
    'followers_gained', (SELECT gained FROM flow),
    'pushes', (SELECT n FROM pushes),
    'revenue_net', round((SELECT net FROM rev)::numeric, 0)
  ) INTO result;

  RETURN result;
END;
$function$;

-- contact_scope_customers : 1 expression(s)
CREATE OR REPLACE FUNCTION public.contact_scope_customers(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(email text, user_id uuid, first_name text, last_name text, phone text, spent numeric, event_count integer, paid_count integer, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, first_at timestamp with time zone, last_at timestamp with time zone, last_paid_at timestamp with time zone, city text, age integer, gender text, subscribed boolean, sub_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id
      FROM public.events e
     WHERE (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
        OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
  ), act AS (
    SELECT lower(btrim(t.user_email)) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind, t.user_id,
           COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS fn,
           COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS ln,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS ph
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND btrim(t.user_email) <> '' AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(btrim(tr.user_email)),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id, 'table', tr.user_id,
           COALESCE(tr.guest_first_name, NULLIF(split_part(btrim(COALESCE(tr.full_name, '')), ' ', 1), '')),
           COALESCE(tr.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(tr.full_name, ''), '^\S+\s*', '')), '')),
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
      FROM public.table_reservations tr JOIN ev ON ev.id = tr.event_id
     WHERE tr.user_email IS NOT NULL AND btrim(tr.user_email) <> ''
       AND (tr.paid_at IS NOT NULL OR tr.status IN ('paid', 'confirmed'))
    UNION ALL
    SELECT lower(btrim(o.user_email)),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id, 'order', o.user_id,
           o.guest_first_name, o.guest_last_name,
           NULLIF(btrim(COALESCE(o.guest_phone, '')), '')
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.user_email IS NOT NULL AND btrim(o.user_email) <> '' AND o.status = 'paid'
    UNION ALL
    SELECT lower(btrim(gle.email)),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist', gle.user_id,
           NULLIF(split_part(btrim(COALESCE(gle.full_name, '')), ' ', 1), ''),
           NULLIF(btrim(regexp_replace(COALESCE(gle.full_name, ''), '^\S+\s*', '')), ''),
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
      JOIN ev ON ev.id = gl.event_id
     WHERE gle.email IS NOT NULL AND btrim(gle.email) <> '' AND gle.status <> 'cancelled'
  ), agg AS (
    SELECT a.em,
           COALESCE(sum(a.amount), 0) AS spent,
           count(DISTINCT a.event_id) AS event_count,
           count(*) FILTER (WHERE a.kind <> 'guestlist') AS paid_count,
           count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
           count(*) FILTER (WHERE a.kind = 'table') AS table_count,
           count(*) FILTER (WHERE a.kind = 'order') AS order_count,
           count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           max(a.created_at) FILTER (WHERE a.kind <> 'guestlist') AS last_paid_at,
           (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS uid,
           (array_agg(a.fn ORDER BY a.created_at DESC) FILTER (WHERE a.fn IS NOT NULL))[1] AS fn,
           (array_agg(a.ln ORDER BY a.created_at DESC) FILTER (WHERE a.ln IS NOT NULL))[1] AS ln,
           (array_agg(a.ph ORDER BY a.created_at DESC) FILTER (WHERE a.ph IS NOT NULL))[1] AS ph
      FROM act a
     GROUP BY a.em
  ), subs AS (
    -- Abonnés entrés par une surface Yuno (jamais par un fichier importé).
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           max(ns.source) AS src,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           max(ns.first_name) AS fn, max(ns.last_name) AS ln
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.import_id IS NULL
       AND COALESCE(ns.source, '') NOT LIKE '%import%'
     GROUP BY lower(ns.email)
  ), merged AS (
    SELECT COALESCE(a.em, s.em) AS em,
           COALESCE(a.uid, s.uid) AS uid,
           a.spent, a.event_count, a.paid_count, a.ticket_count, a.table_count, a.order_count, a.guest_list_count,
           a.first_at, a.last_at, a.last_paid_at,
           COALESCE(a.fn, s.fn) AS fn, COALESCE(a.ln, s.ln) AS ln, a.ph,
           COALESCE(s.subscribed, false) AS subscribed, s.src
      FROM agg a
      FULL OUTER JOIN subs s ON s.em = a.em
  )
  SELECT m.em::text AS email,
         COALESCE(m.uid, p.id) AS user_id,
         COALESCE(p.first_name, m.fn)::text AS first_name,
         COALESCE(p.last_name, m.ln)::text AS last_name,
         COALESCE(m.ph, p.phone)::text AS phone,
         m.spent, m.event_count::int, m.paid_count::int, m.ticket_count::int, m.table_count::int,
         m.order_count::int, m.guest_list_count::int, m.first_at, m.last_at, m.last_paid_at,
         NULLIF(btrim(COALESCE(p.city, '')), '')::text AS city,
         CASE WHEN p.birth_date IS NOT NULL THEN date_part('year', age(p.birth_date))::int END AS age,
         CASE
           WHEN lower(COALESCE(p.gender, '')) IN ('female', 'f', 'femme', 'woman', 'mujer') THEN 'female'
           WHEN lower(COALESCE(p.gender, '')) IN ('male', 'm', 'homme', 'man', 'hombre') THEN 'male'
           WHEN lower(COALESCE(p.gender, '')) IN ('other', 'autre', 'otro', 'non-binary', 'nb') THEN 'other'
         END::text AS gender,
         m.subscribed, m.src::text AS sub_source
    FROM merged m
    LEFT JOIN public.profiles p ON p.id = m.uid AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.uid AND u.deleted_at IS NULL)
   WHERE m.em IS NOT NULL AND position('@' in m.em) > 1;
$function$;

-- email_automation_weekly_digest : 1 expression(s)
CREATE OR REPLACE FUNCTION public.email_automation_weekly_digest(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_from timestamptz := now() - interval '7 days';
BEGIN
  IF p_subject_type NOT IN ('venue', 'organizer') OR p_subject_id IS NULL THEN
    RETURN jsonb_build_object('emails', 0, 'sales', 0, 'revenue', 0);
  END IF;

  WITH children AS (
    SELECT c.id FROM public.email_campaigns c
     WHERE c.automation_id IS NOT NULL
       AND CASE WHEN p_subject_type = 'venue' THEN c.venue_id = p_subject_id
                ELSE c.organizer_user_id::text = p_subject_id END
  ),
  sent AS (
    SELECT count(*) AS n FROM public.email_campaign_recipients r
     WHERE r.campaign_id IN (SELECT id FROM children) AND r.status = 'sent' AND r.sent_at >= v_from
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  clicks AS (
    SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS click_at
      FROM public.email_campaign_events ev
     WHERE ev.campaign_id IN (SELECT id FROM children)
       AND ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
       AND ev.created_at >= v_from - interval '72 hours'
     GROUP BY lower(ev.recipient_email)
  ),
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, lower(t.user_email) AS em, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= v_from
    UNION ALL
    SELECT 'table:' || r.id::text, lower(r.user_email), r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= v_from
    UNION ALL
    SELECT 'order:' || o.id::text, lower(o.user_email), o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25))
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL AND o.created_at >= v_from
       AND CASE WHEN p_subject_type = 'venue' THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events) END
  ),
  attributed AS (
    SELECT DISTINCT s.sale_key, s.net
      FROM clicks c JOIN sales s ON s.em = c.em
       AND s.created_at >= c.click_at AND s.created_at < c.click_at + interval '72 hours'
  )
  SELECT jsonb_build_object(
    'emails', (SELECT n FROM sent),
    'sales', (SELECT count(*) FROM attributed),
    'revenue', round(COALESCE((SELECT sum(net) FROM attributed), 0)::numeric, 0)
  ) INTO result;

  RETURN result;
END;
$function$;

-- get_audience_push_attribution : 1 expression(s)
CREATE OR REPLACE FUNCTION public.get_audience_push_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type <> 'venue' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT id FROM public.events
     WHERE venue_id = p_subject_id OR partner_venue_id = p_subject_id
  ),
  -- 1er clic par (campagne, user) sur les campagnes du venue (90j)
  clicks AS (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS click_at
      FROM public.push_campaign_events pce
      JOIN public.push_campaigns pc ON pc.id = pce.campaign_id
     WHERE pce.event_type = 'clicked'
       AND pc.venue_id = p_subject_id
       AND pc.created_at >= now() - interval '90 days'
       AND pce.user_id IS NOT NULL
     GROUP BY pce.campaign_id, pce.user_id
  ),
  -- ventes du venue avec NET (fees.ts), clé de vente pour dédup
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, t.user_id, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'table:' || r.id::text, r.user_id, r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'order:' || o.id::text, o.user_id, o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25))
      FROM public.orders o
     WHERE o.venue_id = p_subject_id AND o.status IN ('paid', 'served') AND o.user_id IS NOT NULL
  ),
  -- vente attribuée si l'acheteur a cliqué la campagne et acheté dans les 72h
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.user_id, s.net
      FROM clicks c
      JOIN sales s
        ON s.user_id = c.user_id
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2) AS revenue,
           count(DISTINCT user_id)      AS buyers
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', campaign_id, 'revenue', revenue, 'buyers', buyers))
      FROM per_campaign
    ), '[]'::jsonb),
    -- cumul dédupliqué par vente (une vente ne compte qu'une fois même si 2 campagnes la revendiquent)
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$function$;

-- get_audience_revenue : 1 expression(s)
CREATE OR REPLACE FUNCTION public.get_audience_revenue(p_subject_type text, p_subject_id text, p_from timestamp with time zone DEFAULT (now() - '90 days'::interval), p_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result   jsonb;
  v_org    uuid := CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END;
  v_agency uuid := CASE WHEN p_subject_type = 'agency'    THEN nullif(p_subject_id, '')::uuid END;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type = 'dj' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false, 'reason', 'dj_revenue_via_conversion_hub');
  END IF;

  WITH members AS (
    SELECT user_id FROM public.audience_members(p_subject_type, p_subject_id)
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
    WHERE (p_subject_type = 'venue'
             AND (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id))
       OR (p_subject_type = 'organizer'
             AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
       OR (p_subject_type = 'agency' AND EXISTS (
             SELECT 1 FROM public.agency_venue_contracts avc
              WHERE avc.agency_id = v_agency AND avc.status = 'active'
                AND ((avc.venue_id IS NOT NULL AND avc.venue_id = e.venue_id)
                  OR (avc.organizer_user_id IS NOT NULL AND avc.organizer_user_id = e.organizer_user_id))
           ))
  ),
  sales AS (
    SELECT t.user_id, lower(nullif(trim(t.user_email), '')) AS email,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)) AS gross,
           coalesce(t.refund_amount, 0) AS refund
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid'
       AND t.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.user_id, lower(nullif(trim(r.user_email), '')),
           (r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)),
           coalesce(r.refund_amount, 0)
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid'
       AND r.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT o.user_id, lower(nullif(trim(o.user_email), '')),
           (o.total - coalesce(o.service_fee, 0)),
           coalesce(o.refund_amount, 0)
      FROM public.orders o
     WHERE o.status IN ('paid', 'served')
       AND o.created_at BETWEEN p_from AND p_to
       AND ((p_subject_type = 'venue'     AND o.venue_id = p_subject_id)
         OR (p_subject_type = 'organizer' AND o.event_id IN (SELECT id FROM scoped_events))
         OR (p_subject_type = 'agency'    AND o.event_id IN (SELECT id FROM scoped_events)))
  ),
  resolved AS (
    SELECT s.gross, s.refund,
      coalesce(s.user_id,
               (SELECT pr.id FROM public.profiles pr
                 WHERE s.email IS NOT NULL AND lower(pr.email) = s.email LIMIT 1)) AS buyer_uid
    FROM sales s
  ),
  tagged AS (
    SELECT r.gross, r.refund,
      EXISTS (SELECT 1 FROM members mm WHERE mm.user_id = r.buyer_uid) AS is_follower
    FROM resolved r
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'from', p_from, 'to', p_to,
    'followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2)        FROM tagged WHERE is_follower),
      'net',    (SELECT round(coalesce(sum(gross - refund), 0)::numeric, 2) FROM tagged WHERE is_follower)
    ),
    'non_followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE NOT is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2)        FROM tagged WHERE NOT is_follower),
      'net',    (SELECT round(coalesce(sum(gross - refund), 0)::numeric, 2) FROM tagged WHERE NOT is_follower)
    ),
    'follower_share', (
      SELECT CASE WHEN coalesce(sum(gross), 0) > 0
                  THEN round(100.0 * coalesce(sum(gross) FILTER (WHERE is_follower), 0) / sum(gross), 1)
                  ELSE 0 END
      FROM tagged
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- get_email_campaign_attribution : 1 expression(s)
CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type NOT IN ('venue', 'organizer') THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  -- 1er clic par (campagne, email) sur les campagnes email du sujet (90 j)
  clicks AS (
    SELECT ece.campaign_id, lower(ece.recipient_email) AS em, min(ece.created_at) AS click_at
      FROM public.email_campaign_events ece
      JOIN public.email_campaigns ec ON ec.id = ece.campaign_id
     WHERE ece.event_type = 'clicked'
       AND ece.recipient_email IS NOT NULL
       AND ec.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN ec.venue_id = p_subject_id
                ELSE ec.organizer_user_id::text = p_subject_id
           END
     GROUP BY ece.campaign_id, lower(ece.recipient_email)
  ),
  -- Actions du sujet avec NET (fees.ts), matchées par email. `units` = ce que
  -- le pilier compte vraiment : billets vendus, convives attablés, 1 inscrit.
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, 'ticket'::text AS kind,
           lower(t.user_email) AS em, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net,
           GREATEST(coalesce(t.quantity, 1), 1)::int AS units
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= now() - interval '90 days'
    UNION ALL
    SELECT 'table:' || r.id::text, 'table', lower(r.user_email), r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25)),
           GREATEST(coalesce(r.guest_count, 0), 0)::int
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= now() - interval '90 days'
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, 'order', lower(o.user_email), o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25)),
           0
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND o.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
    UNION ALL
    -- Liste invités : zéro euro, mais c'est une entrée gagnée. Sur une soirée
    -- sans billetterie c'est la SEULE chose que l'email peut produire — la
    -- taire revenait à afficher « 0 € » sur une campagne qui a rempli la porte.
    SELECT 'guestlist:' || gle.id::text, 'guestlist', lower(gle.email), gle.created_at,
           0::numeric, 1
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scoped_events)
       AND gle.status <> 'cancelled'
       AND gle.email IS NOT NULL AND btrim(gle.email) <> ''
       AND gle.created_at >= now() - interval '90 days'
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.kind, s.em, s.net, s.units
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2)                                   AS revenue,
           count(DISTINCT em) FILTER (WHERE kind <> 'guestlist')         AS buyers,
           count(*)           FILTER (WHERE kind = 'ticket')             AS ticket_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'ticket'), 0)        AS ticket_units,
           round(coalesce(sum(net) FILTER (WHERE kind = 'ticket'), 0)::numeric, 2)    AS ticket_revenue,
           count(*)           FILTER (WHERE kind = 'table')              AS table_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'table'), 0)         AS table_guests,
           round(coalesce(sum(net) FILTER (WHERE kind = 'table'), 0)::numeric, 2)     AS table_revenue,
           count(*)           FILTER (WHERE kind = 'guestlist')          AS gl_entries,
           count(DISTINCT em) FILTER (WHERE kind = 'guestlist')          AS gl_people,
           count(*)           FILTER (WHERE kind = 'order')              AS drink_orders,
           round(coalesce(sum(net) FILTER (WHERE kind = 'order'), 0)::numeric, 2)     AS drink_revenue
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', campaign_id,
        'revenue', revenue,
        'buyers', buyers,
        'tickets',   jsonb_build_object('orders', ticket_orders, 'units', ticket_units, 'revenue', ticket_revenue),
        'tables',    jsonb_build_object('orders', table_orders,  'guests', table_guests, 'revenue', table_revenue),
        'guestlist', jsonb_build_object('entries', gl_entries,   'people', gl_people),
        'drinks',    jsonb_build_object('orders', drink_orders,  'revenue', drink_revenue)
      ))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$function$;

-- get_event_report : 2 expression(s)
CREATE OR REPLACE FUNCTION public.get_event_report(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  e            record;
  v_tz         text;
  v_day_start  timestamptz;
  v_scope_venue text := null;
  v_scope_org  uuid := null;
  v_money      boolean := false;
  v_scope_ids  uuid[];
  v_result     jsonb;
  v_take       jsonb := '[]'::jsonb;
  v_tx_total   integer;
  v_expected   integer;
  v_entered    integer;
  v_heads_d0   integer;
  v_heads      integer;
  v_row        record;
  v_ref        record;
  v_ref_d      integer;
  v_ref_final  integer;
  v_ref_at     integer;
  v_pace       jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select ev.*, coalesce(ev.timezone, v.timezone, 'Europe/Paris') as tz, v.name as venue_name
    into e
  from public.events ev
  left join public.venues v on v.id = coalesce(ev.venue_id, ev.partner_venue_id)
  where ev.id = p_event_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── Portée + droit de voir l'argent ───────────────────────────────────
  if e.venue_id is not null and (public.can_manage_venue(v_uid, e.venue_id) or public.is_super_admin()) then
    v_scope_venue := e.venue_id;
  elsif e.partner_venue_id is not null and public.can_manage_venue(v_uid, e.partner_venue_id) then
    v_scope_venue := e.partner_venue_id;
  elsif e.organizer_user_id is not null and (
          v_uid = e.organizer_user_id
          or public.is_super_admin()
          or public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) then
    v_scope_org := e.organizer_user_id;
  elsif e.partner_organizer_id is not null and (
          v_uid = e.partner_organizer_id
          or public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) then
    v_scope_org := e.partner_organizer_id;
  -- Co-hôte accepté : la soirée se lit dans SA portée (orga d'abord).
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
                   and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) then
    select c.organizer_user_id into v_scope_org from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
       and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     order by (c.organizer_user_id = v_uid) desc limit 1;
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
                   and public.can_manage_venue(v_uid, c.venue_id)) then
    select c.venue_id into v_scope_venue from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
       and public.can_manage_venue(v_uid, c.venue_id)
     limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope_venue is not null then
    v_money := coalesce(v_scope_venue = e.venue_id, false) and (
      public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = v_scope_venue and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = v_scope_venue
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      ));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where x.venue_id = v_scope_venue or x.partner_venue_id = v_scope_venue or x.id in (select public.cohost_event_ids_venue(v_scope_venue));
  else
    v_money := (v_uid = v_scope_org
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, v_scope_org, 'view_finance'))
      -- Un co-hôte ne voit l'argent que s'il a une part dans un accord actif.
      and (public.is_super_admin() or public.coorg_sees_event_money(p_event_id, 'org:' || v_scope_org::text));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where x.organizer_user_id = v_scope_org or x.partner_organizer_id = v_scope_org or x.id in (select public.cohost_event_ids_org(v_scope_org));
  end if;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  with
  -- ── Les ventes de la soirée, une ligne par transaction ────────────────
  tx as materialized (
    select 'tickets'::text as pillar, t.id, lower(t.user_email) as email, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(coalesce(t.quantity, 1), 1) as heads,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id, t.ticket_round_id as line_id
    from public.tickets t
    where t.event_id = p_event_id and t.status in ('paid', 'used')
    union all
    select 'tables', r.id, lower(r.user_email), r.user_id,
           coalesce(r.paid_at, r.created_at),
           1,
           greatest(coalesce(r.guest_count, 0), 1),
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id, r.pack_id
    from public.table_reservations r
    where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
    union all
    select 'drinks', o.id, lower(o.user_email), o.user_id,
           coalesce(o.paid_at, o.created_at),
           1,
           0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id, null::uuid
    from public.orders o
    where o.event_id = p_event_id and o.status in ('paid', 'served')
      and v_scope_venue is not null and o.venue_id = v_scope_venue
  ),
  gle as materialized (
    select g.id, lower(nullif(btrim(g.email), '')) as email, g.user_id, g.created_at as at_ts,
           g.guest_list_id as line_id, g.tracked_link_id
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = p_event_id and g.status <> 'cancelled'
  ),
  vis as materialized (
    select s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.completed_order, false) as done
    from public.visitor_sessions s
    where s.event_id = p_event_id
  ),

  -- ── Contacts de la soirée, et ceux déjà vus à une soirée PRÉCÉDENTE ────
  people as (
    select distinct email from (
      select email from tx where pillar in ('tickets', 'tables') and email is not null
      union all
      select email from gle where email is not null
    ) p
  ),
  prior_events as materialized (
    select x.id from public.events x
    where x.id = any(v_scope_ids) and x.id <> p_event_id and x.start_at < e.start_at
  ),
  seen_before as (
    select distinct p.email
    from people p
    where exists (select 1 from public.tickets t
                  where t.event_id in (select id from prior_events)
                    and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
       or exists (select 1 from public.table_reservations r
                  where r.event_id in (select id from prior_events)
                    and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
       or exists (select 1 from public.guest_list_entries g
                  join public.guest_lists gl on gl.id = g.guest_list_id
                  where gl.event_id in (select id from prior_events)
                    and g.status <> 'cancelled' and lower(g.email) = p.email)
  ),

  -- ── Série jour par jour, clé d = jours calendaires avant la soirée ─────
  day_rows as (
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date as d,
           case when pillar = 'tickets' then units else 0 end as tickets,
           case when pillar = 'tables' then 1 else 0 end as tables,
           0 as guests, amount, 0 as visits,
           heads as people
    from tx
    union all
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date, 0, 0, 1, 0, 0, 1 from gle
    union all
    select (e.start_at at time zone v_tz)::date - (visited_at at time zone v_tz)::date, 0, 0, 0, 0, 1, 0 from vis
  ),
  series as (
    select d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
           sum(amount) as amount, sum(visits) as visits, sum(people) as people
    from day_rows group by d
  ),

  -- ── Messages qui parlaient de CETTE soirée ────────────────────────────
  emails as (
    select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
           coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
           coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
           ec.automation_id is not null as auto
    from public.email_campaigns ec
    where (ec.event_id = p_event_id or ec.automation_trigger_event_id = p_event_id)
      and ec.status in ('sent', 'sending', 'paused')
      and ((v_scope_venue is not null and ec.venue_id = v_scope_venue)
        or (v_scope_org is not null and ec.organizer_user_id = v_scope_org))
    order by ec.sent_at desc nulls last
    limit 30
  ),
  email_clicks as (
    select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
    from public.email_campaign_events ece
    where ece.campaign_id in (select id from emails)
      and ece.event_type = 'clicked' and ece.recipient_email is not null
    group by 1, 2
  ),
  email_attr as (
    select c.campaign_id,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from email_clicks c
    join (
      select pillar, id, email, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, email, at_ts, 0 from gle
    ) x on x.email = c.email and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  ),
  pushes as (
    select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
           coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key
    from public.push_campaigns pc
    where pc.event_id = p_event_id
      and pc.status in ('sent', 'sending', 'completed')
      and ((v_scope_venue is not null and pc.venue_id = v_scope_venue)
        or (v_scope_org is not null and pc.venue_id is null and pc.agency_id is null))
    order by pc.created_at desc
    limit 30
  ),
  push_clicks as (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
    from public.push_campaign_events pce
    where pce.campaign_id in (select id from pushes)
      and pce.event_type = 'clicked' and pce.user_id is not null
    group by 1, 2
  ),
  push_attr as (
    select c.campaign_id,
           count(*) as clicks,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from push_clicks c
    left join (
      select pillar, id, user_id, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, user_id, at_ts, 0 from gle
    ) x on x.user_id = c.user_id and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  )

  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'money', v_money,
    'scope', case when v_scope_venue is not null then 'venue' else 'organizer' end,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', e.end_at,
      'poster', coalesce(e.poster_url, e.image_url), 'status', e.status,
      'cancelled', e.cancelled_at is not null,
      'publishedAt', e.published_at, 'createdAt', e.created_at,
      'venueName', e.venue_name,
      'entryTarget', e.entry_target,
      'phase', case when v_now >= e.end_at then 'after' when v_now >= e.start_at then 'live' else 'before' end
    ),

    -- 1. Où en sont mes ventes ?
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (select coalesce(sum(units), 0) from tx where pillar = 'tickets'),
        'today', (select coalesce(sum(units), 0) from tx where pillar = 'tickets' and at_ts >= v_day_start),
        'orders', (select count(*) from tx where pillar = 'tickets'),
        'capacity', case
          when coalesce(e.max_tickets, 0) > 0 then e.max_tickets
          when exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id)
           and not exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id and coalesce(tr.max_tickets, 0) <= 0)
            then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = p_event_id)
          else null end,
        'enabled', coalesce(e.ticketing_enabled, false),
        'soldOut', coalesce(e.tickets_sold_out, false)
      ),
      'tables', jsonb_build_object(
        'booked', (select count(*) from tx where pillar = 'tables'),
        'today', (select count(*) from tx where pillar = 'tables' and at_ts >= v_day_start),
        'guests', (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0)
                   from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed')),
        'capacity', nullif((
          select coalesce(sum(p.tables_count), 0)
          from public.table_packs p
          where p.is_active
            and (p.event_id = p_event_id
                 or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                     and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
            and not (p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])))
        ), 0),
        'enabled', coalesce(e.tables_enabled, false),
        'soldOut', coalesce(e.tables_sold_out, false)
      ),
      'guestList', jsonb_build_object(
        'registered', (select count(*) from gle),
        'today', (select count(*) from gle where at_ts >= v_day_start),
        'capacity', (
          select case when count(*) > 0 and count(*) filter (where coalesce(gl.quota, 0) <= 0) = 0
                      then sum(gl.quota) else null end
          from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active
        ),
        'enabled', exists (select 1 from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active),
        'soldOut', coalesce(e.guest_list_sold_out, false)
      ),
      'drinks', case when v_scope_venue is not null then jsonb_build_object(
        'orders', (select count(*) from tx where pillar = 'drinks'),
        'today', (select count(*) from tx where pillar = 'drinks' and at_ts >= v_day_start)
      ) else null end,
      'revenue', case when v_money then jsonb_build_object(
        'total', round((select coalesce(sum(amount), 0) from tx)::numeric, 2),
        'today', round((select coalesce(sum(amount), 0) from tx where at_ts >= v_day_start)::numeric, 2),
        'tickets', round((select coalesce(sum(amount), 0) from tx where pillar = 'tickets')::numeric, 2),
        'tables', round((select coalesce(sum(amount), 0) from tx where pillar = 'tables')::numeric, 2),
        'drinks', round((select coalesce(sum(amount), 0) from tx where pillar = 'drinks')::numeric, 2)
      ) else null end,
      'visits', jsonb_build_object(
        'total', (select count(*) from vis),
        'today', (select count(*) from vis where visited_at >= v_day_start),
        'withOrder', (select count(*) from vis where done)
      ),
      -- La porte : personnes scannées (billets en quantité, convives d'une
      -- table scannée ou arrivée, inscrits guest list) et attendus. Même
      -- définition que « Entrées » dans get_sales_overview.
      'door', jsonb_build_object(
        'entered',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used')
              and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
              and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled' and coalesce(g2.entry_scanned, false)),
        'expected',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled')
      )
    ),

    'lines', coalesce((
      select jsonb_agg(l.obj order by l.pillar_ord, l.ord)
      from (
        -- Paliers de billets
        select 1 as pillar_ord, coalesce(tr.position, 0) * 1000 + row_number() over (order by tr.position, tr.created_at) as ord,
               jsonb_build_object(
                 'pillar', 'tickets', 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0),
                 'capacity', nullif(tr.max_tickets, 0),
                 'status', case
                   when coalesce(e.tickets_sold_out, false) or coalesce(tr.manually_sold_out, false)
                     or (coalesce(tr.max_tickets, 0) > 0 and coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0) >= tr.max_tickets)
                     then 'sold_out'
                   when tr.is_active then 'on_sale'
                   when coalesce(tr.auto_activate, false) then 'upcoming'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tickets' and line_id = tr.id), 0)::numeric, 2) else null end
               ) as obj
        from public.ticket_rounds tr where tr.event_id = p_event_id
        union all
        -- Formules de table (de la soirée, ou du club quand elles ne sont pas event-scopées)
        select 2, coalesce(p.position, 0) * 1000 + row_number() over (order by p.position, p.created_at),
               jsonb_build_object(
                 'pillar', 'tables', 'id', p.id, 'name', p.name, 'price', p.base_price,
                 'sold', (select count(*) from tx where pillar = 'tables' and line_id = p.id),
                 'capacity', nullif(p.tables_count, 0),
                 'status', case
                   when coalesce(e.tables_sold_out, false) or p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])) then 'sold_out'
                   when coalesce(p.tables_count, 0) > 0 and (select count(*) from tx where pillar = 'tables' and line_id = p.id) >= p.tables_count then 'sold_out'
                   when coalesce(e.tables_enabled, false) then 'on_sale'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tables' and line_id = p.id), 0)::numeric, 2) else null end
               )
        from public.table_packs p
        where p.is_active
          and (p.event_id = p_event_id
               or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                   and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
        union all
        -- Parts de guest list
        select 3, row_number() over (order by gl.created_at),
               jsonb_build_object(
                 'pillar', 'guestList', 'id', gl.id,
                 'name', nullif(btrim(coalesce(gl.holder_label, '')), ''),
                 'holderType', gl.holder_type,
                 'price', null,
                 'sold', (select count(*) from gle where line_id = gl.id),
                 'capacity', nullif(gl.quota, 0),
                 'status', case
                   when coalesce(e.guest_list_sold_out, false) or coalesce(gl.manually_sold_out, false) then 'sold_out'
                   when coalesce(gl.quota, 0) > 0 and (select count(*) from gle where line_id = gl.id) >= gl.quota then 'sold_out'
                   when gl.is_active then 'on_sale'
                   else 'closed' end,
                 'amount', null
               )
        from public.guest_lists gl where gl.event_id = p_event_id
      ) l
    ), '[]'::jsonb),

    -- 2. Comment évoluent-elles ?
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
               'amount', case when v_money then round(s.amount::numeric, 2) else null end,
               'visits', s.visits, 'people', s.people
             ) order by s.d desc)
      from series s
    ), '[]'::jsonb),

    -- 3. Est-ce qu'on voit ma soirée ?
    'visitSources', coalesce((
      select jsonb_agg(jsonb_build_object('source', v.source, 'sessions', v.sessions, 'orders', v.orders) order by v.sessions desc)
      from (select source, count(*) as sessions, count(*) filter (where done) as orders
            from vis group by source order by 2 desc limit 8) v
    ), '[]'::jsonb),

    -- 4. Qui achète ?
    'audience', jsonb_build_object(
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables') and email is not null),
      'priorEvents', (select count(*) from prior_events)
    ),

    -- 5. Qu'est-ce qui a fait vendre ?
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
               'amount', case when v_money then round(c.amount::numeric, 2) else null end) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
               'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
               'amount', case when v_money then round(k.amount::numeric, 2) else null end
             ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
      from (
        select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
               (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
               (select count(*) from gle where gle.tracked_link_id = tl.id) as entries,
               (select coalesce(sum(amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
        from public.tracked_links tl
        where tl.event_id = p_event_id
           or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
           or tl.id in (select tracked_link_id from gle where tracked_link_id is not null)
      ) k
      where k.n > 0 or k.entries > 0 or coalesce(k.clicks_count, 0) > 0
    ), '[]'::jsonb),
    -- Repères de la courbe J-N : publication, ouverture d'un tarif (première
    -- vente d'un palier qui n'est pas le premier), emails et push de la soirée.
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object('kind', mk.kind, 'd', mk.d, 'at', mk.at_ts, 'label', mk.label)
                       order by mk.at_ts)
      from (
        select 'published'::text as kind, e.published_at as at_ts, null::text as label,
               (e.start_at at time zone v_tz)::date - (e.published_at at time zone v_tz)::date as d
        where e.published_at is not null
        union all
        select 'round', r.first_at, r.name,
               (e.start_at at time zone v_tz)::date - (r.first_at at time zone v_tz)::date
        from (
          select tr.name, min(tx.at_ts) as first_at,
                 row_number() over (order by min(tx.at_ts)) as rn
          from public.ticket_rounds tr
          join tx on tx.pillar = 'tickets' and tx.line_id = tr.id
          where tr.event_id = p_event_id
          group by tr.id, tr.name
        ) r
        where r.rn > 1
        union all
        select 'email', em.sent_at, em.title,
               (e.start_at at time zone v_tz)::date - (em.sent_at at time zone v_tz)::date
        from emails em where em.sent_at is not null
        union all
        select 'push', pu.sent_at, pu.title,
               (e.start_at at time zone v_tz)::date - (pu.sent_at at time zone v_tz)::date
        from pushes pu where pu.sent_at is not null
      ) mk
      where mk.at_ts <= v_now
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(m.obj order by m.sent_at desc nulls last)
      from (
        select em.sent_at, jsonb_build_object(
                 'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                 'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               ) as obj
        from emails em left join email_attr a on a.campaign_id = em.id
        union all
        select pu.sent_at, jsonb_build_object(
                 'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                 'templateKey', pu.template_key,
                 'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               )
        from pushes pu left join push_attr a on a.campaign_id = pu.id
      ) m
    ), '[]'::jsonb)
  )
  into v_result;

  -- ── À retenir : 0 à 3 constats, chacun avec son seuil et sa section ──────
  -- Clé + paramètres ; le texte est traduit côté front (er.tk.*). Une base
  -- mince ne dit rien : chaque constat porte un minimum de volume.
  v_entered  := coalesce((v_result #>> '{totals,door,entered}')::int, 0);
  v_expected := coalesce((v_result #>> '{totals,door,expected}')::int, 0);
  v_tx_total := coalesce((v_result #>> '{totals,tickets,orders}')::int, 0)
              + coalesce((v_result #>> '{totals,tables,booked}')::int, 0)
              + coalesce((v_result #>> '{totals,guestList,registered}')::int, 0);

  -- 1. Soirée passée : la porte n'a pas vu tout le monde.
  if v_result #>> '{event,phase}' = 'after' and v_expected >= 30 and v_entered > 0
     and v_entered::numeric / v_expected < 0.7 then
    v_take := v_take || jsonb_build_object('key', 'no_show', 'tone', 'bad', 'section', 'sales',
      'params', jsonb_build_object('pct', round(100.0 * v_entered / v_expected), 'missing', v_expected - v_entered));
  end if;

  -- 2. Un message a fait une bonne part des ventes.
  select m.value into v_row from jsonb_array_elements(v_result -> 'messages') m
   order by (m.value ->> 'orders')::int + (m.value ->> 'entries')::int desc limit 1;
  if found and v_tx_total >= 10
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) >= 5
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int)::numeric / v_tx_total >= 0.2 then
    v_take := v_take || jsonb_build_object('key', 'msg_drove', 'tone', 'good', 'section', 'reach',
      'params', jsonb_build_object('kind', v_row.value ->> 'kind', 'title', v_row.value ->> 'title',
        'n', (v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int,
        'pct', round(100.0 * ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) / v_tx_total)));
  end if;

  -- 3. Beaucoup de visites, peu d'achats.
  if coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 100
     and (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int < 0.02 then
    v_take := v_take || jsonb_build_object('key', 'low_conversion', 'tone', 'bad', 'section', 'reach',
      'params', jsonb_build_object('visits', (v_result #>> '{totals,visits,total}')::int,
        'pct', round(100.0 * (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int, 1)));
  end if;

  -- 4. Soirée passée : une grosse part des attendus a acheté le jour J.
  select coalesce(sum((x.value ->> 'people')::int) filter (where (x.value ->> 'd')::int <= 0), 0),
         coalesce(sum((x.value ->> 'people')::int), 0)
    into v_heads_d0, v_heads
  from jsonb_array_elements(v_result -> 'series') x;
  if v_result #>> '{event,phase}' = 'after' and v_heads >= 30 and v_heads_d0::numeric / v_heads >= 0.3 then
    v_take := v_take || jsonb_build_object('key', 'day_of', 'tone', 'info', 'section', 'curve',
      'params', jsonb_build_object('pct', round(100.0 * v_heads_d0 / v_heads)));
  end if;

  -- 5. D'où viennent les visites.
  select s.value into v_row from jsonb_array_elements(v_result -> 'visitSources') s
   order by (s.value ->> 'sessions')::int desc limit 1;
  if found and coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 30
     and (v_row.value ->> 'sessions')::numeric / (v_result #>> '{totals,visits,total}')::int >= 0.5 then
    v_take := v_take || jsonb_build_object('key', 'visit_source', 'tone', 'info', 'section', 'reach',
      'params', jsonb_build_object('source', v_row.value ->> 'source',
        'pct', round(100.0 * (v_row.value ->> 'sessions')::int / (v_result #>> '{totals,visits,total}')::int)));
  end if;

  -- 6. Public neuf ou public d'habitués (seulement s'il y a eu des soirées avant).
  if coalesce((v_result #>> '{audience,people}')::int, 0) >= 20
     and coalesce((v_result #>> '{audience,priorEvents}')::int, 0) >= 1 then
    if (v_result #>> '{audience,new}')::numeric / (v_result #>> '{audience,people}')::int >= 0.6 then
      v_take := v_take || jsonb_build_object('key', 'mostly_new', 'tone', 'info', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,new}')::int / (v_result #>> '{audience,people}')::int)));
    elsif (v_result #>> '{audience,returning}')::numeric / (v_result #>> '{audience,people}')::int >= 0.5 then
      v_take := v_take || jsonb_build_object('key', 'mostly_returning', 'tone', 'good', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,returning}')::int / (v_result #>> '{audience,people}')::int)));
    end if;
  end if;

  -- ── Rythme : la dernière soirée TERMINÉE de la portée (≥ 20 attendus), et
  --    la part de ses attendus qu'elle avait au même J-N. Le front applique
  --    cette part aux attendus d'aujourd'hui pour dire où finira la soirée.
  if v_result #>> '{event,phase}' = 'before' then
    v_ref_d := (e.start_at at time zone v_tz)::date - (v_now at time zone v_tz)::date;
    for v_ref in
      select x.id, x.title, x.start_at, coalesce(x.timezone, v.timezone, 'Europe/Paris') as tz
      from public.events x
      left join public.venues v on v.id = coalesce(x.venue_id, x.partner_venue_id)
      where x.id = any(v_scope_ids) and x.id <> p_event_id
        and x.cancelled_at is null and x.end_at < v_now and x.start_at < e.start_at
      order by x.start_at desc
      limit 6
    loop
      select coalesce(sum(h.n), 0),
             -- Jours ENTIERS avant ce J-N (strictement) : aujourd'hui n'est pas
             -- fini ici, on ne le compare pas à une journée complète là-bas.
             coalesce(sum(h.n) filter (where (v_ref.start_at at time zone v_ref.tz)::date - (h.at_ts at time zone v_ref.tz)::date > v_ref_d), 0)
        into v_ref_final, v_ref_at
      from (
        select greatest(coalesce(t.quantity, 1), 1) as n, coalesce(t.paid_at, t.created_at) as at_ts
        from public.tickets t where t.event_id = v_ref.id and t.status in ('paid', 'used')
        union all
        select greatest(coalesce(r.guest_count, 0), 1), coalesce(r.paid_at, r.created_at)
        from public.table_reservations r where r.event_id = v_ref.id and r.status in ('paid', 'confirmed')
        union all
        select 1, g.created_at
        from public.guest_list_entries g join public.guest_lists gl on gl.id = g.guest_list_id
        where gl.event_id = v_ref.id and g.status <> 'cancelled'
      ) h;
      if v_ref_final >= 20 then
        v_pace := jsonb_build_object('refId', v_ref.id, 'refTitle', v_ref.title, 'd', v_ref_d,
                                     'final', v_ref_final, 'atSameD', v_ref_at);
        exit;
      end if;
    end loop;
  end if;
  v_result := v_result || jsonb_build_object('pace', v_pace);

  v_result := v_result || jsonb_build_object('takeaways',
    coalesce((select jsonb_agg(x.value) from (select value from jsonb_array_elements(v_take) limit 3) x), '[]'::jsonb));

  return v_result;
end;
$function$;

-- get_events_pnl : 1 expression(s)
CREATE OR REPLACE FUNCTION public.get_events_pnl(p_venue_id text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with evs as (
    select e.id, e.title, e.start_at
    from public.events e
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      -- Une soirée est dans la période si elle y tombe OU si elle a encaissé
      -- (billet, table, commande) ou reçu un inscrit guest list pendant la
      -- période : une soirée à venir qui vend cette semaine a sa ligne.
      and (
        ((p_from is null or e.start_at >= p_from) and (p_to is null or e.start_at <= p_to))
        or exists (select 1 from public.tickets t where t.event_id = e.id and t.status = 'paid'
                   and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at <= p_to))
        or exists (select 1 from public.table_reservations r where r.event_id = e.id and r.status = 'paid'
                   and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at <= p_to))
        or (p_venue_id is not null and exists (select 1 from public.orders o where o.event_id = e.id and o.status in ('paid','served')
                   and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at <= p_to)))
        or exists (select 1 from public.guest_lists gl join public.guest_list_entries x on x.guest_list_id = gl.id
                   where gl.event_id = e.id and x.status <> 'cancelled'
                   and (p_from is null or x.created_at >= p_from) and (p_to is null or x.created_at <= p_to))
      )
  ),
  tk as (
    select t.event_id,
      coalesce(sum(greatest(t.total_price - coalesce(t.service_fee,0) - coalesce(t.insurance_fee,0), 0))
        filter (where t.status = 'paid'), 0)                                   as revenue,
      coalesce(sum(t.quantity) filter (where t.status = 'paid'), 0)             as cnt,
      coalesce(sum(t.quantity) filter (where t.status = 'paid' and coalesce(t.entry_scanned,false)), 0) as scanned,
      coalesce(sum(coalesce(t.refund_amount,0)) filter (where t.status = 'refunded' or t.refund_amount > 0), 0) as refunds
    from public.tickets t
    join evs on evs.id = t.event_id
    group by t.event_id
  ),
  dr as (
    select o.event_id,
      coalesce(sum(greatest(o.total - coalesce(o.service_fee,0), 0))
        filter (where o.status in ('paid','served')), 0)                       as revenue,
      coalesce(count(*) filter (where o.status in ('paid','served')), 0)        as cnt,
      coalesce(sum(coalesce(o.refund_amount,0)) filter (where o.status = 'refunded' or o.refund_amount > 0), 0) as refunds
    from public.orders o
    join evs on evs.id = o.event_id
    where p_venue_id is not null
    group by o.event_id
  ),
  tb as (
    select r.event_id,
      coalesce(sum(greatest(r.total_price - coalesce(r.service_fee,0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
        filter (where r.status = 'paid'), 0)                                    as revenue,
      coalesce(count(*) filter (where r.status = 'paid'), 0)                     as cnt,
      coalesce(sum(coalesce(r.guest_count,0))
        filter (where r.status = 'paid' and (r.checked_in_at is not null or coalesce(r.entry_scanned,false))), 0) as guests_arrived,
      coalesce(sum(coalesce(r.refund_amount,0)) filter (where r.status = 'refunded' or r.refund_amount > 0), 0) as refunds
    from public.table_reservations r
    join evs on evs.id = r.event_id
    group by r.event_id
  ),
  glist as (
    select gl.event_id,
      count(gle.id)                                          as signups,
      count(gle.id) filter (where coalesce(gle.entry_scanned,false)) as arrived
    from public.guest_lists gl
    join evs on evs.id = gl.event_id
    left join public.guest_list_entries gle on gle.guest_list_id = gl.id
    group by gl.event_id
  )
  select jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(row_to_json(x) order by x.start_at desc) from (
        select
          evs.id                                        as event_id,
          evs.title                                     as title,
          evs.start_at                                  as start_at,
          coalesce(tk.revenue,0)                        as tickets_revenue,
          coalesce(tk.cnt,0)                            as tickets_count,
          coalesce(dr.revenue,0)                        as drinks_revenue,
          coalesce(dr.cnt,0)                            as drinks_orders,
          coalesce(tb.revenue,0)                        as tables_revenue,
          coalesce(tb.cnt,0)                            as tables_count,
          coalesce(glist.signups,0)                     as guestlist_signups,
          coalesce(glist.arrived,0)                     as guestlist_arrived,
          coalesce(tk.scanned,0) + coalesce(tb.guests_arrived,0) + coalesce(glist.arrived,0) as attendance,
          coalesce(tk.refunds,0) + coalesce(dr.refunds,0) + coalesce(tb.refunds,0)           as refunds,
          coalesce(tk.revenue,0) + coalesce(dr.revenue,0) + coalesce(tb.revenue,0)           as gross,
          (coalesce(tk.revenue,0) + coalesce(dr.revenue,0) + coalesce(tb.revenue,0))
            - (coalesce(tk.refunds,0) + coalesce(dr.refunds,0) + coalesce(tb.refunds,0))     as net
        from evs
        left join tk    on tk.event_id = evs.id
        left join dr    on dr.event_id = evs.id
        left join tb    on tb.event_id = evs.id
        left join glist on glist.event_id = evs.id
      ) x
      where x.gross > 0 or x.guestlist_signups > 0
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

-- get_events_sales_summary : 4 expression(s)
CREATE OR REPLACE FUNCTION public.get_events_sales_summary(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_events jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
  end if;

  with
  ev as materialized (
    select e.id, e.title, e.start_at, e.end_at, e.status, e.is_active, e.cancelled_at,
           e.published_at, coalesce(e.poster_url, e.image_url) as poster,
           e.ticketing_enabled, e.tables_enabled,
           e.tickets_sold_out, e.tables_sold_out, e.guest_list_sold_out,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           coalesce(e.sold_out_pack_ids, '{}'::uuid[]) as closed_packs,
           date_trunc('day', v_now at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris'))
             at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris') as day_start,
           case
             when p_organizer_user_id is not null then v_money
               and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id
                    or public.coorg_sees_event_money(e.id, 'org:' || p_organizer_user_id::text))
             else v_money and e.venue_id = p_venue_id
           end as show_money
    from public.events e
    left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
    where e.end_at > v_now - interval '12 hours'
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (p_venue_id is not null and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id or e.id in (select public.cohost_event_ids_venue(p_venue_id))))
        or (p_organizer_user_id is not null
            and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))
      )
    order by e.start_at
    limit 60
  ),

  tk as (
    select t.event_id,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) as sold,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as sold_today,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ) filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as amount_today
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),

  rounds as (
    select tr.event_id,
           count(*) as n,
           count(*) filter (where coalesce(tr.max_tickets, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(tr.max_tickets, 0), 0)), 0) as cap
    from public.ticket_rounds tr
    join ev on ev.id = tr.event_id
    group by tr.event_id
  ),

  tb as (
    select r.event_id,
           count(*) as booked,
           count(*) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start) as booked_today,
           coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0) as guests,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
           ) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start), 0) as amount_today
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),

  -- Même inventaire que `_event_tables_left` : formules actives de la soirée,
  -- ou du club quand la formule n'est pas event-scopée, formules « complètes »
  -- exclues.
  packs as (
    select ev.id as event_id, coalesce(sum(p.tables_count), 0)::integer as cap
    from ev
    join public.table_packs p
      on p.is_active
     and (p.event_id = ev.id
          or (p.event_id is null and coalesce(ev.venue_id, ev.partner_venue_id) is not null
              and p.venue_id = coalesce(ev.venue_id, ev.partner_venue_id)))
     and not (p.id = any (ev.closed_packs))
    group by ev.id
  ),

  gls as (
    select gl.event_id,
           count(*) filter (where gl.is_active) as lists,
           count(*) filter (where gl.is_active and coalesce(gl.quota, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(gl.quota, 0), 0)) filter (where gl.is_active), 0) as cap,
           bool_and(coalesce(gl.manually_sold_out, false)) filter (where gl.is_active) as all_closed
    from public.guest_lists gl
    join ev on ev.id = gl.event_id
    group by gl.event_id
  ),

  gle as (
    select gl.event_id,
           count(*) as registered,
           count(*) filter (where e2.created_at >= ev.day_start) as registered_today
    from public.guest_list_entries e2
    join public.guest_lists gl on gl.id = e2.guest_list_id
    join ev on ev.id = gl.event_id
    where e2.status <> 'cancelled'
    group by gl.event_id
  ),

  dr as (
    select o.event_id,
           count(*) as orders,
           count(*) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start) as orders_today,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start), 0) as amount_today
    from public.orders o
    join ev on ev.id = o.event_id
    where p_venue_id is not null
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
    group by o.event_id
  ),

  vis as (
    select s.event_id,
           count(*) as total,
           count(*) filter (where s.visited_at >= ev.day_start) as today
    from public.visitor_sessions s
    join ev on ev.id = s.event_id
    group by s.event_id
  )

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id,
           'title', ev.title,
           'startAt', ev.start_at,
           'endAt', ev.end_at,
           'poster', ev.poster,
           'status', ev.status,
           'isActive', ev.is_active,
           'publishedAt', ev.published_at,
           'dayStart', ev.day_start,
           'tickets', jsonb_build_object(
             'enabled', coalesce(ev.ticketing_enabled, false),
             'soldOut', coalesce(ev.tickets_sold_out, false),
             'sold', coalesce(tk.sold, 0),
             'today', coalesce(tk.sold_today, 0),
             'capacity', case
               when coalesce(ev.max_tickets, 0) > 0 then ev.max_tickets
               when rounds.n > 0 and rounds.unbounded = 0 then rounds.cap
               else null end
           ),
           'tables', jsonb_build_object(
             'enabled', coalesce(ev.tables_enabled, false),
             'soldOut', coalesce(ev.tables_sold_out, false),
             'booked', coalesce(tb.booked, 0),
             'today', coalesce(tb.booked_today, 0),
             'guests', coalesce(tb.guests, 0),
             'capacity', case when coalesce(packs.cap, 0) > 0 then packs.cap else null end
           ),
           'guestList', jsonb_build_object(
             'enabled', coalesce(gls.lists, 0) > 0,
             'soldOut', coalesce(ev.guest_list_sold_out, false) or coalesce(gls.all_closed, false),
             'registered', coalesce(gle.registered, 0),
             'today', coalesce(gle.registered_today, 0),
             'capacity', case when coalesce(gls.lists, 0) > 0 and gls.unbounded = 0 and gls.cap > 0
                              then gls.cap else null end
           ),
           'drinks', case when p_venue_id is not null then jsonb_build_object(
             'orders', coalesce(dr.orders, 0),
             'today', coalesce(dr.orders_today, 0)
           ) else null end,
           'visits', jsonb_build_object(
             'total', coalesce(vis.total, 0),
             'today', coalesce(vis.today, 0)
           ),
           'revenue', case when ev.show_money then jsonb_build_object(
             'total', round((coalesce(tk.amount, 0) + coalesce(tb.amount, 0) + coalesce(dr.amount, 0))::numeric, 2),
             'today', round((coalesce(tk.amount_today, 0) + coalesce(tb.amount_today, 0) + coalesce(dr.amount_today, 0))::numeric, 2),
             'tickets', round(coalesce(tk.amount, 0)::numeric, 2),
             'tables', round(coalesce(tb.amount, 0)::numeric, 2),
             'drinks', round(coalesce(dr.amount, 0)::numeric, 2)
           ) else null end
         ) order by ev.start_at), '[]'::jsonb)
    into v_events
  from ev
  left join tk     on tk.event_id = ev.id
  left join rounds on rounds.event_id = ev.id
  left join tb     on tb.event_id = ev.id
  left join packs  on packs.event_id = ev.id
  left join gls    on gls.event_id = ev.id
  left join gle    on gle.event_id = ev.id
  left join dr     on dr.event_id = ev.id
  left join vis    on vis.event_id = ev.id;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'money', v_money,
    'events', v_events
  );
end;
$function$;

-- get_live_view : 2 expression(s)
CREATE OR REPLACE FUNCTION public.get_live_view(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now        timestamptz := now();
  v_tz         text := 'Europe/Paris';
  v_day_start  timestamptz;
  v_event_ids  uuid[];
  v_gl_ids     uuid[];
  v_recent_ids uuid[];
  v_home       jsonb := null;
  v_release_id uuid;
  v_release    jsonb := null;
  v_visitors_now integer := 0;
  v_sessions_today integer := 0;
  v_points     jsonb := '[]'::jsonb;
  v_behavior   jsonb;
  v_pages      jsonb := '[]'::jsonb;
  v_locations  jsonb := '[]'::jsonb;
  v_sales      jsonb;
  v_feed       jsonb := '[]'::jsonb;
  v_lat        double precision;
  v_lng        double precision;
  v_home_name  text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
      or public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.can_manage_venue(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── Portée : les soirées du club / de l'organisateur ────────────────────
  select coalesce(array_agg(e.id), '{}')
    into v_event_ids
  from public.events e
  where (p_venue_id is not null and e.venue_id = p_venue_id)
     or (p_organizer_user_id is not null
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))));

  -- Soirées « vivantes » (pas finies depuis plus d'un jour) : ce sont celles
  -- que le front écoute en Realtime — une liste courte, jamais tout l'historique.
  select coalesce(array_agg(x.id order by x.start_at), '{}')
    into v_recent_ids
  from (
    select e.id, e.start_at
    from public.events e
    where e.id = any(v_event_ids)
      and e.end_at > v_now - interval '1 day'
    order by e.start_at
    limit 60
  ) x;

  select coalesce(array_agg(gl.id), '{}')
    into v_gl_ids
  from public.guest_lists gl
  where gl.event_id = any(v_recent_ids);

  -- ── Fuseau + point d'ancrage (le club) ────────────────────────────────
  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.venues v where v.id = p_venue_id;
  else
    -- Organisateur : le club de sa prochaine soirée (ou de la dernière), s'il y en a un.
    select coalesce(e.timezone, v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.events e
    left join public.venues v on v.id = e.venue_id
    where e.id = any(v_event_ids)
    order by (e.end_at > v_now) desc, abs(extract(epoch from (e.start_at - v_now)))
    limit 1;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;
  if v_lat is not null and v_lng is not null then
    v_home := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'name', v_home_name);
  end if;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  -- ── Visiteurs en ce moment (battement < 75 s) + leurs points ───────────
  select count(distinct p.session_id)
    into v_visitors_now
  from public.live_visitor_pings p
  where p.last_seen > v_now - interval '75 seconds'
    and (
         (p_venue_id is not null and p.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
      or p.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'session', x.session_id,
           'stage', x.stage,
           'path', x.page_path,
           'seen', x.last_seen,
           'eventTitle', x.event_title,
           'city', x.city,
           'country', x.country,
           'countryCode', x.country_code,
           'lat', x.latitude,
           'lng', x.longitude,
           'device', x.device_type,
           'source', x.referrer_category
         ) order by x.last_seen desc), '[]'::jsonb)
    into v_points
  from (
    select distinct on (p.session_id)
           p.session_id, p.stage, p.page_path, p.last_seen, e.title as event_title,
           vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude, vs.device_type, vs.referrer_category
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    left join lateral (
      select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
      from public.visitor_sessions s
      where s.session_id = p.session_id
      order by s.visited_at desc
      limit 1
    ) vs on true
    where p.last_seen > v_now - interval '75 seconds'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Comportement des 10 dernières minutes (une session = son dernier stade) ──
  select jsonb_build_object(
           'browsing', count(*) filter (where x.stage = 'browsing'),
           'cart',     count(*) filter (where x.stage = 'cart'),
           'checkout', count(*) filter (where x.stage = 'checkout'),
           'paid',     count(*) filter (where x.stage = 'paid')
         )
    into v_behavior
  from (
    select distinct on (p.session_id) p.session_id, p.stage
    from public.live_visitor_pings p
    where p.last_seen > v_now - interval '10 minutes'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Pages regardées en ce moment ───────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', x.page_path, 'n', x.n, 'eventTitle', x.event_title
         ) order by x.n desc, x.page_path), '[]'::jsonb)
    into v_pages
  from (
    select p.page_path, count(distinct p.session_id) as n, max(e.title) as event_title
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    where p.last_seen > v_now - interval '75 seconds'
      and p.page_path is not null
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    group by p.page_path
    order by n desc
    limit 6
  ) x;

  -- ── Sessions du jour + villes ─────────────────────────────────────────
  select count(*)
    into v_sessions_today
  from public.visitor_sessions s
  where s.visited_at >= v_day_start
    and (
         (p_venue_id is not null and s.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
      or s.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'city', x.city, 'country', x.country, 'countryCode', x.country_code,
           'n', x.n, 'lat', x.lat, 'lng', x.lng
         ) order by x.n desc), '[]'::jsonb)
    into v_locations
  from (
    select coalesce(s.city, s.region, s.country) as city,
           s.country,
           max(s.country_code) as country_code,
           count(*) as n,
           avg(s.latitude) as lat,
           avg(s.longitude) as lng
    from public.visitor_sessions s
    where s.visited_at >= v_day_start
      and coalesce(s.city, s.region, s.country) is not null
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
    group by coalesce(s.city, s.region, s.country), s.country
    order by n desc
    limit 8
  ) x;

  -- ── Ventes du jour (CA club, formules de fees.ts) ───────────────────────
  select jsonb_build_object(
    'tickets', (
      select jsonb_build_object(
        'orders', count(*),
        'qty', coalesce(sum(t.quantity), 0),
        'amount', coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
      )
      from public.tickets t
      where t.event_id = any(v_event_ids)
        and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) >= v_day_start
    ),
    'tables', (
      select jsonb_build_object(
        'orders', count(*),
        'guests', coalesce(sum(coalesce(r.guest_count, 0)), 0),
        'amount', coalesce(sum(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)), 0)
      )
      from public.table_reservations r
      where r.event_id = any(v_event_ids)
        and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) >= v_day_start
    ),
    'guestlist', (
      select jsonb_build_object('orders', count(*))
      from public.guest_list_entries gle
      join public.guest_lists gl on gl.id = gle.guest_list_id
      where gl.event_id = any(v_event_ids)
        and gle.status <> 'cancelled'
        and gle.created_at >= v_day_start
    ),
    'drinks', (
      select jsonb_build_object(
        'orders', count(*),
        'amount', coalesce(sum(o.total - coalesce(o.service_fee, 0)), 0)
      )
      from public.orders o
      where p_venue_id is not null
        and o.venue_id = p_venue_id
        and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) >= v_day_start
    )
  ) into v_sales;

  -- ── Flux d'activité : les 40 derniers faits des 24 dernières heures ────
  select coalesce(jsonb_agg(to_jsonb(f) order by f.ts desc), '[]'::jsonb)
    into v_feed
  from (
    select * from (
      (
        select 'visit'::text as kind,
               'visit:' || s.id::text as id,
               s.visited_at as ts,
               s.city, s.country, s.country_code as "countryCode",
               s.latitude as lat, s.longitude as lng,
               s.referrer_category as source,
               s.device_type as device,
               s.entry_page_type as "pageType",
               e.title as "eventTitle",
               null::numeric as amount,
               null::integer as qty,
               coalesce(s.is_returning, false) as returning
        from public.visitor_sessions s
        left join public.events e on e.id = s.event_id
        where s.visited_at > v_now - interval '24 hours'
          and (
               (p_venue_id is not null and s.venue_id = p_venue_id)
            or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
            or s.event_id = any(v_event_ids)
          )
        order by s.visited_at desc
        limit 40
      )
      union all
      (
        select 'ticket', 'ticket:' || t.id::text, coalesce(t.paid_at, t.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(t.purchase_source, vs.referrer_category), vs.device_type, 'ticket',
               e.title,
               t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0),
               t.quantity, false
        from public.tickets t
        join public.events e on e.id = t.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = t.id::text
          order by s.visited_at desc limit 1
        ) vs on true
        where t.event_id = any(v_event_ids)
          and t.status in ('paid', 'used')
          and coalesce(t.paid_at, t.created_at) > v_now - interval '24 hours'
        order by coalesce(t.paid_at, t.created_at) desc
        limit 40
      )
      union all
      (
        select 'table', 'table:' || r.id::text, coalesce(r.paid_at, r.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(r.purchase_source, vs.referrer_category), vs.device_type, 'table',
               e.title,
               r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END),
               coalesce(r.guest_count, 0), false
        from public.table_reservations r
        join public.events e on e.id = r.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = r.id::text
          order by s.visited_at desc limit 1
        ) vs on true
        where r.event_id = any(v_event_ids)
          and r.status in ('paid', 'confirmed')
          and coalesce(r.paid_at, r.created_at) > v_now - interval '24 hours'
        order by coalesce(r.paid_at, r.created_at) desc
        limit 40
      )
      union all
      (
        select 'guestlist', 'gl:' || gle.id::text, gle.created_at,
               null::text, null::text, null::text, null::double precision, null::double precision,
               case when gle.promoter_id is not null then 'promoter' else null end, null::text, 'guestlist',
               e.title, null::numeric, 1, false
        from public.guest_list_entries gle
        join public.guest_lists gl on gl.id = gle.guest_list_id
        join public.events e on e.id = gl.event_id
        where gl.event_id = any(v_event_ids)
          and gle.status <> 'cancelled'
          and gle.created_at > v_now - interval '24 hours'
        order by gle.created_at desc
        limit 40
      )
      union all
      (
        select 'order', 'order:' || o.id::text, coalesce(o.paid_at, o.created_at),
               null::text, null::text, null::text, null::double precision, null::double precision,
               o.purchase_source, null::text, 'order',
               e.title,
               o.total - coalesce(o.service_fee, 0),
               coalesce(jsonb_array_length(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end), 0),
               false
        from public.orders o
        left join public.events e on e.id = o.event_id
        where p_venue_id is not null
          and o.venue_id = p_venue_id
          and o.status in ('paid', 'served')
          and coalesce(o.paid_at, o.created_at) > v_now - interval '24 hours'
        order by coalesce(o.paid_at, o.created_at) desc
        limit 40
      )
    ) u
    order by u.ts desc
    limit 40
  ) f;

  -- ── Release en cours : la soirée qui vend le plus depuis une heure ──────
  select t.event_id
    into v_release_id
  from public.tickets t
  join public.events e on e.id = t.event_id
  where t.event_id = any(v_event_ids)
    and t.status in ('paid', 'used')
    and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
  group by t.event_id, e.start_at
  order by sum(t.quantity) desc, e.start_at
  limit 1;

  if v_release_id is null then
    -- Rien ne vend à l'instant : on suit la prochaine soirée qui a une billetterie.
    select e.id into v_release_id
    from public.events e
    where e.id = any(v_event_ids)
      and e.ticketing_enabled
      and e.status = 'active' and e.is_active and e.cancelled_at is null
      and e.end_at > v_now
    order by e.start_at
    limit 1;
  end if;

  if v_release_id is not null then
    select jsonb_build_object(
      'eventId', e.id,
      'title', e.title,
      'startAt', e.start_at,
      'endAt', e.end_at,
      'publishedAt', e.published_at,
      'poster', coalesce(e.poster_url, e.image_url),
      'ticketsSoldOut', e.tickets_sold_out,
      'maxTickets', e.max_tickets,
      'sales10m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '10 minutes'),
      'sales60m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'salesToday', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) >= v_day_start),
      'salesTotal', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')),
      'revenue60m', (select coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
                     from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'tables60m', (select count(*) from public.table_reservations r
                    where r.event_id = e.id and r.status in ('paid', 'confirmed')
                      and coalesce(r.paid_at, r.created_at) > v_now - interval '60 minutes'),
      'guests60m', (select count(*) from public.guest_list_entries gle
                    join public.guest_lists gl on gl.id = gle.guest_list_id
                    where gl.event_id = e.id and gle.status <> 'cancelled'
                      and gle.created_at > v_now - interval '60 minutes'),
      'viewersNow', (select count(distinct p.session_id) from public.live_visitor_pings p
                     where p.event_id = e.id and p.last_seen > v_now - interval '75 seconds'),
      -- 60 cases : billets par minute, de la plus ancienne (il y a 59 min) à maintenant.
      'series', (
        select jsonb_agg(coalesce(c.n, 0) order by g.m desc)
        from generate_series(59, 0, -1) as g(m)
        left join (
          select floor(extract(epoch from (v_now - coalesce(t.paid_at, t.created_at))) / 60)::int as m,
                 sum(t.quantity) as n
          from public.tickets t
          where t.event_id = e.id and t.status in ('paid', 'used')
            and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
          group by 1
        ) c on c.m = g.m
      ),
      'rounds', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', tr.tickets_sold, 'max', tr.max_tickets,
                 'active', tr.is_active, 'soldOut', tr.manually_sold_out or (tr.max_tickets > 0 and tr.tickets_sold >= tr.max_tickets)
               ) order by tr.position, tr.created_at), '[]'::jsonb)
        from public.ticket_rounds tr where tr.event_id = e.id
      )
    )
    into v_release
    from public.events e
    where e.id = v_release_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'home', v_home,
    'visitorsNow', v_visitors_now,
    'sessionsToday', v_sessions_today,
    'points', v_points,
    'behavior', v_behavior,
    'pages', v_pages,
    'locations', v_locations,
    'sales', v_sales,
    'feed', v_feed,
    'release', v_release,
    'watch', jsonb_build_object(
      'eventIds', to_jsonb(v_recent_ids),
      'guestListIds', to_jsonb(v_gl_ids)
    )
  );
end;
$function$;

-- get_organizer_customer_segments : 1 expression(s)
CREATE OR REPLACE FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid)
 RETURNS TABLE(id text, user_id uuid, email text, first_name text, last_name text, phone text, first_visit_at timestamp with time zone, last_visit_at timestamp with time zone, total_spent numeric, ticket_count integer, order_count integer, table_count integer, is_banned boolean, banned_at timestamp with time zone, ban_reason text, notes text, revenue_30d numeric, revenue_90d numeric, revenue_prev_90d numeric, avg_basket numeric, visit_nights integer, visits_per_month numeric, last_activity_at timestamp with time zone, preferred_dow integer, preferred_event_title text, recency_days integer, rfm_r integer, rfm_f integer, rfm_m integer, rfm_segment text, rfm_tier text, churn_risk boolean, guest_list_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH organizer_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
  ),
  -- Revenu organisateur = montant facturé − frais Yuno (billets + tables).
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind,
           t.user_id, t.full_name, t.guest_first_name, t.guest_last_name,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS phone
    FROM tickets t JOIN organizer_events oe ON oe.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id, 'table'::text,
           tr.user_id, tr.full_name, tr.guest_first_name, tr.guest_last_name,
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
    FROM table_reservations tr JOIN organizer_events oe ON oe.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
    UNION ALL
    -- Guest list : montant 0, mais c'est une PERSONNE de plus dans le fichier
    -- client. Sur une soirée en entrée libre (aucune billetterie, aucune table)
    -- c'est la SEULE activité qui existe : sans cette branche, l'organisateur
    -- terminait sa soirée avec un fichier client vide.
    SELECT lower(gle.email),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist'::text,
           gle.user_id, gle.full_name, NULL::text, NULL::text,
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
    FROM guest_list_entries gle
    JOIN guest_lists gl ON gl.id = gle.guest_list_id
    JOIN organizer_events oe ON oe.id = gl.event_id
    WHERE gle.email IS NOT NULL
      AND btrim(gle.email) <> ''
      AND gle.status <> 'cancelled'
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(sum(a.amount), 0) AS total_spent,
      COALESCE(avg(a.amount) FILTER (WHERE a.kind <> 'guestlist'), 0) AS avg_basket,
      count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'table') AS table_count,
      count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  -- Dernière valeur NON NULLE de chaque champ, jamais « la dernière ligne » :
  -- une inscription guest list sans numéro effaçait le téléphone laissé lors
  -- d'un achat précédent, et la fiche client s'ouvrait sans coordonnées.
  ident AS (
    SELECT a.em,
      (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS user_id,
      (array_agg(a.full_name ORDER BY a.created_at DESC) FILTER (WHERE a.full_name IS NOT NULL))[1] AS full_name,
      (array_agg(a.guest_first_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_first_name IS NOT NULL))[1] AS guest_first_name,
      (array_agg(a.guest_last_name ORDER BY a.created_at DESC) FILTER (WHERE a.guest_last_name IS NOT NULL))[1] AS guest_last_name,
      (array_agg(a.phone ORDER BY a.created_at DESC) FILTER (WHERE a.phone IS NOT NULL))[1] AS phone
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, oe.start_at, oe.title, count(*) AS cnt
    FROM activity a JOIN organizer_events oe ON oe.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, oe.start_at, oe.title
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
  base AS (
    SELECT
      ag.em AS c_id,
      COALESCE(id_.user_id, p.id) AS c_user_id,
      ag.em AS c_email,
      COALESCE(p.first_name, id_.guest_first_name,
               NULLIF(split_part(COALESCE(id_.full_name, ''), ' ', 1), '')) AS c_first_name,
      COALESCE(p.last_name, id_.guest_last_name,
               NULLIF(substr(COALESCE(id_.full_name, ''), strpos(COALESCE(id_.full_name, '') || ' ', ' ') + 1), '')) AS c_last_name,
      COALESCE(id_.phone, p.phone) AS c_phone,
      ag.first_activity_at AS c_first_visit_at,
      ag.last_activity_at AS c_last_visit_at,
      round(ag.total_spent, 2) AS c_total_spent,
      ag.ticket_count::int AS c_ticket_count,
      ag.table_count::int AS c_table_count,
      ag.guest_list_count::int AS c_guest_list_count,
      (b.email IS NOT NULL) AS c_is_banned, b.banned_at AS c_banned_at, b.ban_reason AS c_ban_reason,
      n.notes AS c_notes,
      ag.revenue_30d AS c_revenue_30d, ag.revenue_90d AS c_revenue_90d,
      ag.revenue_prev_90d AS c_revenue_prev_90d, ag.avg_basket AS c_avg_basket,
      COALESCE(ag.visit_nights, 0)::int AS c_visit_nights,
      CASE
        WHEN ag.first_activity_at IS NULL THEN 0
        ELSE round(
          ag.visit_nights::numeric /
          greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
          2)
      END AS c_visits_per_month,
      ag.last_activity_at AS c_last_activity_at,
      pd.dow AS c_preferred_dow, pe.preferred_event_title AS c_preferred_event_title,
      floor(extract(epoch FROM (now() - COALESCE(ag.last_activity_at, ag.first_activity_at, now()))) / 86400)::int AS c_recency_days,
      CASE WHEN COALESCE(ag.visit_nights, 0) > 0 THEN ag.visit_nights::int
           ELSE (ag.ticket_count + ag.table_count + ag.guest_list_count)::int
      END AS c_rfm_freq,
      round(ag.total_spent, 2) AS c_rfm_money
    FROM agg ag
    LEFT JOIN ident id_ ON id_.em = ag.em
    -- Un email peut porter PLUSIEURS profils (comptes orphelins, comptes
    -- vitrine). Un LEFT JOIN direct dupliquait alors la ligne client. On n'en
    -- retient qu'un : celui qui a réellement fait l'activité, sinon le plus récent.
    LEFT JOIN LATERAL (
      SELECT pr.id, pr.first_name, pr.last_name, NULLIF(btrim(COALESCE(pr.phone, '')), '') AS phone
      FROM profiles pr
      WHERE lower(pr.email) = ag.em
      ORDER BY (pr.id = id_.user_id) DESC NULLS LAST, pr.created_at DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN organizer_banned_emails b ON b.organizer_user_id = p_organizer_user_id AND b.email = ag.em
    LEFT JOIN organizer_customer_notes n ON n.organizer_user_id = p_organizer_user_id AND n.email = ag.em
    LEFT JOIN pref_event pe ON pe.em = ag.em
    LEFT JOIN pref_dow pd ON pd.em = ag.em
  ),
  ranked AS (
    SELECT b.*,
      count(*) OVER () AS n_total,
      (rank() OVER (ORDER BY b.c_rfm_freq) - 1)::numeric  AS freq_below,
      (rank() OVER (ORDER BY b.c_rfm_money) - 1)::numeric AS mon_below
    FROM base b
  ),
  scored AS (
    -- Règle identique au club, au mot près (cf. _venue_customer_rfm).
    SELECT rk.*,
      CASE WHEN rk.c_recency_days <= 14 THEN 5
           WHEN rk.c_recency_days <= 30 THEN 4
           WHEN rk.c_recency_days <= 60 THEN 3
           WHEN rk.c_recency_days <= 90 THEN 2
           ELSE 1 END AS s_r,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.freq_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS rel_f,
      CASE WHEN rk.n_total <= 1 THEN 3
           ELSE least(5, greatest(1, floor((rk.mon_below / (rk.n_total - 1)) * 5)::int + 1))
      END AS s_m,
      CASE WHEN rk.c_rfm_freq >= 10 THEN 5
           WHEN rk.c_rfm_freq >= 6 THEN 4
           WHEN rk.c_rfm_freq >= 3 THEN 3
           WHEN rk.c_rfm_freq >= 2 THEN 2
           ELSE 1 END AS abs_f
    FROM ranked rk
  ),
  blended AS (
    SELECT s.*,
      least(5, greatest(1, least(greatest(s.rel_f, s.abs_f - 1), s.abs_f + 1))) AS s_f
    FROM scored s
  )
  SELECT
    s.c_id, s.c_user_id, s.c_email, s.c_first_name, s.c_last_name, s.c_phone,
    s.c_first_visit_at, s.c_last_visit_at, s.c_total_spent,
    s.c_ticket_count, 0 AS order_count, s.c_table_count,
    s.c_is_banned, s.c_banned_at, s.c_ban_reason, s.c_notes,
    s.c_revenue_30d, s.c_revenue_90d, s.c_revenue_prev_90d, s.c_avg_basket,
    s.c_visit_nights, s.c_visits_per_month,
    s.c_last_activity_at, s.c_preferred_dow, s.c_preferred_event_title,
    s.c_recency_days,
    s.s_r::int, s.s_f::int, s.s_m::int,
    (CASE
      WHEN s.s_r >= 4 AND s.s_f >= 4 THEN 'champions'
      -- « Était régulier, se met en silence » passe AVANT « fidèle » : un
      -- habitué muet depuis trois mois est le client à rappeler ce soir, pas
      -- une ligne rassurante dans le camembert. L'ordre inverse le rangeait en
      -- « Fidèles » et le club ne le voyait jamais partir.
      WHEN s.s_r <= 2 AND s.s_f >= 3 THEN 'at_risk'
      WHEN s.s_f >= 4 THEN 'loyal'
      WHEN s.s_r >= 4 AND s.s_f <= 2 THEN CASE WHEN s.s_m >= 3 THEN 'promising' ELSE 'new' END
      WHEN s.s_r >= 3 THEN 'loyal'
      WHEN s.s_r = 2 THEN 'dormant'
      ELSE 'lost'
    END)::text,
    (CASE
      WHEN s.s_m >= 5 THEN 'platinum'
      WHEN s.s_m >= 4 THEN 'gold'
      WHEN s.s_m >= 2 THEN 'silver'
      ELSE 'bronze'
    END)::text,
    (s.s_f >= 3 AND s.c_recency_days > 45 AND s.c_recency_days <= 180),
    s.c_guest_list_count
  FROM blended s
  ORDER BY s.c_last_visit_at DESC NULLS LAST;
END;
$function$;

-- get_promo_codes : 2 expression(s)
CREATE OR REPLACE FUNCTION public.get_promo_codes(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_money boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if (p_venue_id is null) = (p_organizer_user_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not public.can_manage_promo_scope(p_venue_id, p_organizer_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  -- Le CA suit les mêmes droits que le reste de la Console.
  v_money := public.is_super_admin()
    or (p_venue_id is not null and (
      exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (select 1 from public.manager_permissions mp where mp.user_id = v_uid and mp.venue_id = p_venue_id
                 and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false)))))
    or (p_organizer_user_id is not null and (
      v_uid = p_organizer_user_id or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance')));

  return jsonb_build_object(
    'ok', true,
    'money', v_money,
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pc.id,
               'code', pc.code,
               'label', pc.label,
               'eventId', pc.event_id,
               'eventTitle', e.title,
               'eventStartAt', e.start_at,
               'discountType', pc.discount_type,
               'discountValue', pc.discount_value,
               'appliesTo', pc.applies_to,
               'maxUses', pc.max_uses,
               'startsAt', pc.starts_at,
               'endsAt', pc.ends_at,
               'isActive', pc.is_active,
               'createdAt', pc.created_at,
               'uses', coalesce(st.uses, 0),
               'held', coalesce(st.held, 0),
               'tickets', coalesce(st.tickets, 0),
               'tables', coalesce(st.tables, 0),
               'discountGiven', coalesce(st.discount_given, 0),
               'revenue', case when v_money then round(coalesce(st.revenue, 0)::numeric, 2) else null end
             ) order by pc.is_active desc, pc.created_at desc)
      from public.promo_codes pc
      left join public.events e on e.id = pc.event_id
      left join lateral (
        select
          count(*) filter (where r.status = 'paid') as uses,
          count(*) filter (where r.status = 'held' and r.created_at > now() - interval '30 minutes') as held,
          coalesce(sum(t.quantity) filter (where r.status = 'paid' and r.pillar = 'tickets'), 0) as tickets,
          count(*) filter (where r.status = 'paid' and r.pillar = 'tables') as tables,
          sum(r.discount_amount) filter (where r.status = 'paid') as discount_given,
          -- CA club de ces ventes (fees.ts) : total − frais Yuno, remboursement déduit.
          sum(
            case
              when r.status <> 'paid' then 0
              when r.pillar = 'tickets' then
                greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                - least(greatest(coalesce(t.refund_amount, 0), 0),
                        greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
              else
                greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0)
                - least(greatest(coalesce(tr.refund_amount, 0), 0),
                        greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0))
            end
          ) as revenue
        from public.promo_code_redemptions r
        left join public.tickets t on t.id = r.ticket_id
        left join public.table_reservations tr on tr.id = r.table_reservation_id
        where r.promo_code_id = pc.id
      ) st on true
      where (p_venue_id is not null and pc.venue_id = p_venue_id)
         or (p_organizer_user_id is not null and pc.organizer_user_id = p_organizer_user_id)
    ), '[]'::jsonb)
  );
end;
$function$;

-- get_purchase_behavior : 2 expression(s)
CREATE OR REPLACE FUNCTION public.get_purchase_behavior(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now       timestamptz := now();
  v_from      timestamptz := coalesce(p_from, '2020-01-01'::timestamptz);
  v_to        timestamptz := coalesce(p_to, now());
  v_tz        text := 'Europe/Paris';
  v_event_ids uuid[];
  v_drinks    boolean := p_venue_id is not null;
  v_result    jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
      or public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.can_manage_venue(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── Portée : les soirées du club / de l'organisateur ────────────────────
  select coalesce(array_agg(e.id), '{}')
    into v_event_ids
  from public.events e
  where (p_venue_id is not null and e.venue_id = p_venue_id)
     or (p_organizer_user_id is not null
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))));

  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris') into v_tz
    from public.venues v where v.id = p_venue_id;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;

  with
  ev as materialized (
    select e.id, e.start_at, e.end_at
    from public.events e
    where e.id = any(v_event_ids)
  ),

  -- ── Toutes les ventes de la période, une ligne par transaction ─────────
  tx as materialized (
    select 'tickets'::text as pillar,
           t.id,
           lower(t.user_email) as buyer,
           t.event_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           ev.start_at, ev.end_at,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(t.is_guest, false) as is_guest,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id is not null as tracked,
           coalesce(t.has_insurance, false) as insurance,
           t.drink_id is not null as bundled_drink,
           coalesce(t.drink_redeemed, false) as drink_redeemed,
           coalesce(t.is_upgrade, false) as upgrade,
           coalesce(t.is_loyalty_reward, false) as loyalty,
           coalesce(t.newsletter_opt_in, false) as newsletter,
           coalesce(t.sms_opt_in, false) as sms,
           t.ticket_round_id as round_id,
           (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as scanned,
           t.entry_scanned_at as scanned_at,
           null::integer as guests,
           null::integer as items,
           false as deposit_only,
           false as on_site
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
      and coalesce(t.paid_at, t.created_at) >= v_from
      and coalesce(t.paid_at, t.created_at) < v_to

    union all

    select 'tables',
           r.id,
           lower(r.user_email),
           r.event_id,
           coalesce(r.paid_at, r.created_at),
           ev.start_at, ev.end_at,
           1,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(r.is_guest, false),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id is not null,
           false, false, false, false, false,
           coalesce(r.newsletter_opt_in, false),
           coalesce(r.sms_opt_in, false),
           null::uuid,
           (coalesce(r.entry_scanned, false) or r.checked_in_at is not null),
           coalesce(r.entry_scanned_at, r.checked_in_at),
           greatest(coalesce(r.guest_count, 0), 0),
           null::integer,
           (coalesce(r.deposit, 0) > 0 and coalesce(r.deposit, 0) < r.total_price),
           coalesce(r.payment_mode, 'online') = 'on_site'
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
      and coalesce(r.paid_at, r.created_at) >= v_from
      and coalesce(r.paid_at, r.created_at) < v_to

    union all

    select 'drinks',
           o.id,
           coalesce(lower(o.user_email), o.user_id::text, o.id::text),
           o.event_id,
           coalesce(o.paid_at, o.created_at),
           ev.start_at, ev.end_at,
           1,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(o.is_guest, false),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id is not null,
           false, false, false, false, false, false, false,
           null::uuid,
           false,
           null::timestamptz,
           null::integer,
           (select coalesce(sum(case when (i->>'qty') ~ '^[0-9]+$' then (i->>'qty')::integer else 1 end), 0)::integer
              from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i),
           false, false
    from public.orders o
    left join ev on ev.id = o.event_id
    where v_drinks
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
      and coalesce(o.paid_at, o.created_at) >= v_from
      and coalesce(o.paid_at, o.created_at) < v_to
  ),

  -- Achats à l'avance (billets + tables) : ceux qui ont un « avant la soirée ».
  pre as materialized (
    select tx.*,
           extract(epoch from (tx.start_at - tx.at_ts)) / 3600.0 as lead_h,
           case
             when tx.at_ts >= tx.start_at then 'after_start'
             when tx.start_at - tx.at_ts < interval '24 hours' then 'h24'
             when tx.start_at - tx.at_ts < interval '4 days' then 'd1_3'
             when tx.start_at - tx.at_ts < interval '8 days' then 'd4_7'
             when tx.start_at - tx.at_ts < interval '15 days' then 'd8_14'
             when tx.start_at - tx.at_ts < interval '31 days' then 'd15_30'
             else 'd30p'
           end as lead_bucket
    from tx
    where tx.pillar in ('tickets', 'tables') and tx.start_at is not null
  ),

  gl as materialized (
    select gle.id, lower(gle.email) as buyer, gl0.event_id, gle.created_at as at_ts,
           coalesce(gle.entry_scanned, false) as scanned,
           coalesce(gle.newsletter_opt_in, false) as newsletter,
           ev.start_at, ev.end_at
    from public.guest_list_entries gle
    join public.guest_lists gl0 on gl0.id = gle.guest_list_id
    join ev on ev.id = gl0.event_id
    where gle.status <> 'cancelled'
      and gle.created_at >= v_from
      and gle.created_at < v_to
  ),

  -- Acheteurs de la période (payants) et leur historique complet dans la portée.
  buyers as materialized (
    select tx.buyer, sum(tx.amount) as spent, count(*) as tx_count, min(tx.at_ts) as first_in_period
    from tx
    where tx.buyer is not null
    group by tx.buyer
  ),
  hist as materialized (
    select h.buyer, h.night_key, min(h.at_ts) as at_ts
    from (
      select lower(t.user_email) as buyer, t.event_id::text as night_key, coalesce(t.paid_at, t.created_at) as at_ts
      from public.tickets t
      where t.event_id = any(v_event_ids) and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) < v_to
      union all
      select lower(r.user_email), r.event_id::text, coalesce(r.paid_at, r.created_at)
      from public.table_reservations r
      where r.event_id = any(v_event_ids) and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) < v_to
      union all
      select coalesce(lower(o.user_email), o.user_id::text, o.id::text),
             coalesce(o.event_id::text,
                      to_char((coalesce(o.paid_at, o.created_at) at time zone v_tz) - interval '6 hours', 'YYYY-MM-DD')),
             coalesce(o.paid_at, o.created_at)
      from public.orders o
      where v_drinks and o.venue_id = p_venue_id and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) < v_to
      union all
      select lower(gle.email), gl0.event_id::text, gle.created_at
      from public.guest_list_entries gle
      join public.guest_lists gl0 on gl0.id = gle.guest_list_id
      where gl0.event_id = any(v_event_ids) and gle.status <> 'cancelled'
        and gle.created_at < v_to
    ) h
    where h.buyer in (select b.buyer from buyers b)
    group by h.buyer, h.night_key
  ),
  buyer_hist as materialized (
    select h.buyer, count(*) as nights, min(h.at_ts) as first_ever
    from hist h
    group by h.buyer
  ),
  gaps as (
    select extract(epoch from (h.at_ts - lag(h.at_ts) over (partition by h.buyer order by h.at_ts))) / 86400.0 as gap_d
    from hist h
  ),
  ranked as (
    select b.spent,
           row_number() over (order by b.spent desc) as rn,
           count(*) over () as n
    from buyers b
  ),

  -- Paires (client, soirée) — pour les parcours croisés sur une même nuit.
  pairs as materialized (
    select distinct tx.pillar, tx.buyer, tx.event_id, tx.start_at
    from tx
    where tx.pillar in ('tickets', 'tables') and tx.buyer is not null and tx.start_at < v_now
    union
    select 'guestlist', gl.buyer, gl.event_id, gl.start_at
    from gl
    where gl.scanned and gl.buyer is not null and gl.start_at < v_now
  ),
  pairs_x as (
    select p.pillar, p.buyer, p.event_id,
           d.orders as drink_orders, d.amount as drink_amount,
           exists (
             select 1 from public.table_reservations r
             where r.event_id = p.event_id and lower(r.user_email) = p.buyer
               and r.status in ('paid', 'confirmed')
           ) as has_table
    from pairs p
    left join lateral (
      select count(*) as orders,
             sum(greatest(o.total - coalesce(o.service_fee, 0), 0)) as amount
      from public.orders o
      where v_drinks
        and o.event_id = p.event_id
        and lower(o.user_email) = p.buyer
        and o.status in ('paid', 'served')
    ) d on true
  ),

  -- Soirées terminées où la porte a scanné au moins une entrée.
  scanned_events as materialized (
    select ev.id
    from ev
    where ev.end_at < v_now
      and (
        exists (select 1 from public.tickets t where t.event_id = ev.id
                  and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        or exists (select 1 from public.guest_list_entries gle
                     join public.guest_lists gl0 on gl0.id = gle.guest_list_id
                     where gl0.event_id = ev.id and coalesce(gle.entry_scanned, false))
        or exists (select 1 from public.table_reservations r where r.event_id = ev.id
                     and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
      )
  ),

  vs as materialized (
    select s.device_type, s.referrer_category, s.is_returning, s.visit_number,
           coalesce(s.added_to_cart, false) as cart,
           coalesce(s.proceeded_to_checkout, false) as checkout,
           coalesce(s.completed_order, false) as done,
           s.duration_seconds, s.cart_value_cents
    from public.visitor_sessions s
    where s.visited_at >= v_from and s.visited_at < v_to
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
  )

  select jsonb_build_object(
    'ok', true,
    'tz', v_tz,
    'hasDrinks', v_drinks,
    'from', v_from,
    'to', v_to,

    -- ── Vue d'ensemble ───────────────────────────────────────────────────
    'summary', (
      select jsonb_build_object(
        'transactions', (select count(*) from tx),
        'buyers', (select count(*) from buyers),
        'amount', coalesce((select sum(amount) from tx), 0),
        'avgBasket', coalesce((select avg(amount) from tx where amount > 0), 0),
        'avgPerBuyer', coalesce((select avg(spent) from buyers), 0),
        'avgTxPerBuyer', coalesce((select avg(tx_count) from buyers), 0),
        'repeatBuyers', (select count(*) from buyer_hist where nights >= 2),
        'newBuyers', (select count(*) from buyer_hist where first_ever >= v_from),
        'medianLeadHours', (select percentile_cont(0.5) within group (order by lead_h) from pre where lead_h > 0),
        'guestCheckouts', (select count(*) from tx where is_guest),
        'guestlist', (select count(*) from gl),
        'guestlistScanned', (select count(*) from gl where scanned)
      )
    ),

    'pillars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pillar', p.pillar, 'transactions', p.n, 'units', p.units,
        'buyers', p.buyers, 'amount', p.amount, 'avgBasket', p.avg_basket
      ) order by p.amount desc)
      from (
        select pillar, count(*) as n, sum(units) as units, count(distinct buyer) as buyers,
               sum(amount) as amount, avg(amount) as avg_basket
        from tx group by pillar
      ) p
    ), '[]'::jsonb),

    -- ── Quand achètent-ils ? ──────────────────────────────────────────────
    'leadTime', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket', b.bucket,
        'tickets', coalesce(c.tickets, 0), 'tables', coalesce(c.tables, 0),
        'ticketUnits', coalesce(c.ticket_units, 0), 'amount', coalesce(c.amount, 0)
      ) order by b.ord)
      from (values ('d30p', 1), ('d15_30', 2), ('d8_14', 3), ('d4_7', 4), ('d1_3', 5), ('h24', 6), ('after_start', 7)) b(bucket, ord)
      left join (
        select lead_bucket,
               count(*) filter (where pillar = 'tickets') as tickets,
               count(*) filter (where pillar = 'tables') as tables,
               sum(units) filter (where pillar = 'tickets') as ticket_units,
               sum(amount) as amount
        from pre group by lead_bucket
      ) c on c.lead_bucket = b.bucket
    ), '[]'::jsonb),

    'leadMedian', jsonb_build_object(
      'tickets', (select percentile_cont(0.5) within group (order by lead_h) from pre where pillar = 'tickets' and lead_h > 0),
      'tables', (select percentile_cont(0.5) within group (order by lead_h) from pre where pillar = 'tables' and lead_h > 0)
    ),

    -- Jour × heure de l'achat, dans le fuseau du club (lundi = 0).
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_array(h.pillar, h.dow, h.hr, h.n))
      from (
        select pillar,
               (extract(isodow from (at_ts at time zone v_tz))::integer - 1) as dow,
               extract(hour from (at_ts at time zone v_tz))::integer as hr,
               count(*) as n
        from tx
        group by 1, 2, 3
      ) h
    ), '[]'::jsonb),

    -- Boissons : à quelle heure de la nuit (heures écoulées depuis l'ouverture).
    'nightDrinks', coalesce((
      select jsonb_agg(jsonb_build_object('h', d.h, 'orders', d.n, 'amount', d.amount) order by d.h)
      from (
        select greatest(-1, least(8, floor(extract(epoch from (at_ts - start_at)) / 3600.0)::integer)) as h,
               count(*) as n, sum(amount) as amount
        from tx
        where pillar = 'drinks' and start_at is not null
        group by 1
      ) d
    ), '[]'::jsonb),

    'drinkRhythm', (
      select jsonb_build_object(
        'drinkersPerNight', count(*),
        'avgOrdersPerNight', avg(x.n),
        'avgSpendPerNight', avg(x.amount),
        'multiOrderShare', case when count(*) > 0 then (count(*) filter (where x.n >= 2))::numeric / count(*) else null end,
        'medianMinutesEntryToFirstDrink', (
          select percentile_cont(0.5) within group (order by m.mins)
          from (
            select extract(epoch from (min(d.at_ts) - min(t.scanned_at))) / 60.0 as mins
            from tx d
            join tx t on t.pillar = 'tickets' and t.buyer = d.buyer and t.event_id = d.event_id
                     and t.scanned_at is not null
            where d.pillar = 'drinks' and d.event_id is not null
            group by d.buyer, d.event_id
          ) m
          where m.mins between 0 and 600
        )
      )
      from (
        select buyer, event_id, count(*) as n, sum(amount) as amount
        from tx
        where pillar = 'drinks' and event_id is not null
        group by buyer, event_id
      ) x
    ),

    -- ── Combien achètent-ils ? ────────────────────────────────────────────
    'groupSize', jsonb_build_object(
      'tickets', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0), 'units', coalesce(c.units, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when units = 1 then '1' when units = 2 then '2' when units <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n, sum(units) as units
          from tx where pillar = 'tickets' group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgTicketsPerOrder', (select avg(units) from tx where pillar = 'tickets'),
      'tables', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0)) order by b.ord)
        from (values ('1_4', 1), ('5_8', 2), ('9_12', 3), ('13p', 4)) b(bucket, ord)
        left join (
          select case when guests <= 4 then '1_4' when guests <= 8 then '5_8' when guests <= 12 then '9_12' else '13p' end as bucket,
                 count(*) as n
          from tx where pillar = 'tables' and guests > 0 group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgGuestsPerTable', (select avg(guests) from tx where pillar = 'tables' and guests > 0),
      'avgPerHead', (select sum(amount) / nullif(sum(guests), 0) from tx where pillar = 'tables' and guests > 0),
      'drinks', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when items <= 1 then '1' when items = 2 then '2' when items <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n
          from tx where pillar = 'drinks' group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgItemsPerOrder', (select avg(items) from tx where pillar = 'drinks' and items > 0)
    ),

    'basketBands', coalesce((
      select jsonb_agg(jsonb_build_object('pillar', c.pillar, 'band', c.band, 'n', c.n))
      from (
        select pillar,
               case when amount < 15 then 'b0_15' when amount < 30 then 'b15_30' when amount < 60 then 'b30_60'
                    when amount < 120 then 'b60_120' when amount < 300 then 'b120_300' else 'b300p' end as band,
               count(*) as n
        from tx where amount > 0
        group by 1, 2
      ) c
    ), '[]'::jsonb),

    -- Palier de prix auquel les billets partent (1er palier = le moins cher publié).
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('rank', r.rnk, 'units', r.units, 'amount', r.amount) order by r.rnk)
      from (
        select least(rk.rnk, 3) as rnk, sum(t.units) as units, sum(t.amount) as amount
        from tx t
        join (
          select tr.id, dense_rank() over (partition by tr.event_id order by tr.position, tr.price) as rnk
          from public.ticket_rounds tr
          where tr.event_id = any(v_event_ids)
        ) rk on rk.id = t.round_id
        where t.pillar = 'tickets'
        group by 1
      ) r
    ), '[]'::jsonb),

    -- ── Ce qu'ils prennent en plus ────────────────────────────────────────
    'attach', (
      select jsonb_build_object(
        'ticketOrders', count(*) filter (where pillar = 'tickets'),
        'insurance', count(*) filter (where pillar = 'tickets' and insurance),
        'bundledDrink', count(*) filter (where pillar = 'tickets' and bundled_drink),
        'bundledDrinkRedeemed', count(*) filter (where pillar = 'tickets' and bundled_drink and drink_redeemed),
        'upgrades', count(*) filter (where pillar = 'tickets' and upgrade),
        'loyaltyRewards', count(*) filter (where pillar = 'tickets' and loyalty),
        'optinBase', count(*) filter (where pillar in ('tickets', 'tables')),
        'newsletter', count(*) filter (where pillar in ('tickets', 'tables') and newsletter),
        'sms', count(*) filter (where pillar in ('tickets', 'tables') and sms),
        'tableOrders', count(*) filter (where pillar = 'tables'),
        'tableDeposit', count(*) filter (where pillar = 'tables' and deposit_only),
        'tableOnSite', count(*) filter (where pillar = 'tables' and on_site)
      )
      from tx
    ),

    -- ── Qui achète ? ─────────────────────────────────────────────────────
    'loyalty', jsonb_build_object(
      'frequency', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'buyers', coalesce(c.n, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when nights <= 1 then '1' when nights = 2 then '2' when nights <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n
          from buyer_hist group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'medianDaysBetween', (select percentile_cont(0.5) within group (order by gap_d) from gaps where gap_d > 0.5),
      'top10Share', (
        select case when sum(spent) > 0 then sum(spent) filter (where rn <= greatest(1, ceil(n * 0.1))) / sum(spent) else null end
        from ranked
      ),
      'newAmount', coalesce((select sum(b.spent) from buyers b join buyer_hist h on h.buyer = b.buyer where h.first_ever >= v_from), 0),
      'returningAmount', coalesce((select sum(b.spent) from buyers b join buyer_hist h on h.buyer = b.buyer where h.first_ever < v_from), 0)
    ),

    -- Même nuit : billet → bar, table → bar, guest list → bar, billet → table.
    'crossSell', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pillar', c.pillar, 'pairs', c.pairs, 'withDrinks', c.with_drinks,
        'drinkSpend', c.drink_spend, 'withTable', c.with_table
      ))
      from (
        select pillar, count(*) as pairs,
               count(*) filter (where coalesce(drink_orders, 0) > 0) as with_drinks,
               avg(drink_amount) filter (where coalesce(drink_orders, 0) > 0) as drink_spend,
               count(*) filter (where pillar <> 'tables' and has_table) as with_table
        from pairs_x
        group by pillar
      ) c
    ), '[]'::jsonb),

    -- ── Par quel canal ? ─────────────────────────────────────────────────
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n, 'amount', c.amount) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'trackedShare', (
      select case when count(*) > 0 then (count(*) filter (where tracked))::numeric / count(*) else null end
      from tx where pillar in ('tickets', 'tables')
    ),

    -- ── Passage à l'achat (visites consenties) ───────────────────────────
    'funnel', (
      select jsonb_build_object(
        'sessions', count(*),
        'carts', count(*) filter (where cart),
        'checkouts', count(*) filter (where checkout),
        'orders', count(*) filter (where done),
        'abandonedCarts', count(*) filter (where cart and not done),
        'abandonedValue', coalesce(sum(cart_value_cents) filter (where cart and not done), 0) / 100.0,
        'medianVisitAtPurchase', percentile_cont(0.5) within group (order by visit_number) filter (where done and visit_number > 0),
        'medianDurationBuyers', percentile_cont(0.5) within group (order by duration_seconds) filter (where done and duration_seconds > 0),
        'medianDurationOthers', percentile_cont(0.5) within group (order by duration_seconds) filter (where not done and duration_seconds > 0),
        'newSessions', count(*) filter (where not coalesce(is_returning, false)),
        'newOrders', count(*) filter (where done and not coalesce(is_returning, false)),
        'returningSessions', count(*) filter (where coalesce(is_returning, false)),
        'returningOrders', count(*) filter (where done and coalesce(is_returning, false)),
        'devices', coalesce((
          select jsonb_agg(jsonb_build_object('device', d.device, 'sessions', d.sessions, 'orders', d.orders) order by d.sessions desc)
          from (
            select coalesce(nullif(device_type, ''), 'unknown') as device,
                   count(*) as sessions, count(*) filter (where done) as orders
            from vs group by 1
          ) d
        ), '[]'::jsonb),
        'sources', coalesce((
          select jsonb_agg(jsonb_build_object('source', d.source, 'sessions', d.sessions, 'orders', d.orders) order by d.sessions desc)
          from (
            select coalesce(nullif(referrer_category, ''), 'direct') as source,
                   count(*) as sessions, count(*) filter (where done) as orders
            from vs group by 1
            order by 2 desc
            limit 8
          ) d
        ), '[]'::jsonb)
      )
      from vs
    ),

    -- ── Achat ≠ venue : présence des acheteurs ───────────────────────────
    'attendance', jsonb_build_object(
      'nights', (select count(*) from scanned_events se where se.id in (select event_id from tx union select event_id from gl)),
      'ticketOrders', (select count(*) from tx where pillar = 'tickets' and event_id in (select id from scanned_events)),
      'ticketScanned', (select count(*) from tx where pillar = 'tickets' and scanned and event_id in (select id from scanned_events)),
      'tableOrders', (select count(*) from tx where pillar = 'tables' and event_id in (select id from scanned_events)),
      'tableScanned', (select count(*) from tx where pillar = 'tables' and scanned and event_id in (select id from scanned_events)),
      'guestlist', (select count(*) from gl where event_id in (select id from scanned_events)),
      'guestlistScanned', (select count(*) from gl where scanned and event_id in (select id from scanned_events)),
      'byLead', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'orders', coalesce(c.n, 0), 'scanned', coalesce(c.s, 0)) order by b.ord)
        from (values ('d30p', 1), ('d15_30', 2), ('d8_14', 3), ('d4_7', 4), ('d1_3', 5), ('h24', 6), ('after_start', 7)) b(bucket, ord)
        left join (
          select lead_bucket, count(*) as n, count(*) filter (where scanned) as s
          from pre
          where pillar = 'tickets' and event_id in (select id from scanned_events)
          group by lead_bucket
        ) c on c.lead_bucket = b.bucket
      ), '[]'::jsonb)
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- get_push_campaigns : 2 expression(s)
CREATE OR REPLACE FUNCTION public.get_push_campaigns(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filter text DEFAULT 'all'::text, p_event_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_event_ids uuid[];
  v_limit     integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset    integer := greatest(coalesce(p_offset, 0), 0);
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    -- Marketing d'une organisation : fondateur ou admin d'équipe (capacité
    -- `marketing` de capabilitiesFor), comme l'envoi.
    if not (v_uid = p_organizer_user_id
            or public.is_super_admin()
            or public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    select coalesce(array_agg(e.id), '{}') into v_event_ids
    from public.events e
    where e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id));
  elsif p_venue_id is not null then
    if not (public.is_super_admin()
            or public.is_venue_owner(v_uid, p_venue_id)
            or exists (
              select 1 from public.manager_permissions mp
              where mp.user_id = v_uid and mp.venue_id = p_venue_id
                and (coalesce(mp.can_manage_crm, false) or coalesce(mp.can_view_analytics, false))
            )) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(array_agg(e.id), '{}') into v_event_ids
    from public.events e
    where e.venue_id = p_venue_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with
  scoped as materialized (
    select pc.*
    from public.push_campaigns pc
    where ((p_venue_id is not null and pc.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and pc.organizer_user_id = p_organizer_user_id))
  ),
  filtered as (
    select s.* from scoped s
    where (p_event_id is null or s.event_id = p_event_id)
      and case coalesce(p_filter, 'all')
            when 'manual' then coalesce(s.source, 'manual') <> 'auto'
            when 'auto' then s.source = 'auto'
            when 'scheduled' then s.status = 'scheduled'
            else true end
  ),
  page as materialized (
    select f.* from filtered f
    order by coalesce(f.scheduled_at, f.created_at) desc, f.created_at desc
    limit v_limit offset v_offset
  ),
  -- Ventes de la portée, une ligne par transaction, attribuables par user_id.
  sales as materialized (
    select 'tickets'::text as pillar, t.id, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount
    from public.tickets t
    where t.event_id = any(v_event_ids) and t.status in ('paid', 'used') and t.user_id is not null
      and coalesce(t.paid_at, t.created_at) > now() - interval '400 days'
    union all
    select 'tables', r.id, r.user_id, coalesce(r.paid_at, r.created_at),
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
    from public.table_reservations r
    where r.event_id = any(v_event_ids) and r.status in ('paid', 'confirmed') and r.user_id is not null
      and coalesce(r.paid_at, r.created_at) > now() - interval '400 days'
    union all
    select 'drinks', o.id, o.user_id, coalesce(o.paid_at, o.created_at),
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
    from public.orders o
    where p_venue_id is not null and o.venue_id = p_venue_id
      and o.status in ('paid', 'served') and o.user_id is not null
      and coalesce(o.paid_at, o.created_at) > now() - interval '400 days'
    union all
    select 'guestlist', g.id, g.user_id, g.created_at, 0
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = any(v_event_ids) and g.status <> 'cancelled' and g.user_id is not null
      and g.created_at > now() - interval '400 days'
  ),
  -- Premier tap par (campagne, personne) : sur la page ET sur les 30 derniers jours.
  taps as materialized (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as tap_at
    from public.push_campaign_events pce
    where pce.event_type = 'clicked' and pce.user_id is not null
      and (pce.campaign_id in (select id from page)
           or pce.campaign_id in (select id from scoped where created_at >= now() - interval '30 days'))
    group by 1, 2
  ),
  attributed as materialized (
    select t.campaign_id, s.pillar, s.id as sale_id, s.user_id, s.amount
    from taps t
    join sales s on s.user_id = t.user_id
                and s.at_ts >= t.tap_at and s.at_ts < t.tap_at + interval '72 hours'
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'total', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'summary', (
      select jsonb_build_object(
        'campaigns', count(*),
        'sent', coalesce(sum(sc.sent_count), 0),
        'taps', (select count(*) from taps t where t.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')),
        'buyers', (select count(distinct a.user_id) from attributed a
                   where a.pillar <> 'guestlist' and a.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')),
        'revenue', case when v_money then round(coalesce((
                     select sum(d.amount) from (
                       select distinct a.sale_id, a.amount from attributed a
                       where a.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')
                     ) d), 0)::numeric, 2) else null end
      )
      from scoped sc
      where sc.created_at >= now() - interval '30 days' and sc.status <> 'scheduled'
    ),
    'followers', (
      with f as (
        select fv.user_id, fv.created_at
        from public.favorites fv
        where p_venue_id is not null and fv.favorite_type = 'club' and fv.venue_id = p_venue_id
        union
        select opf.user_id, opf.created_at
        from public.organizer_profile_followers opf
        where p_organizer_user_id is not null and opf.organizer_user_id = p_organizer_user_id
      )
      select jsonb_build_object(
        'total', count(distinct f.user_id),
        'reachable', count(distinct f.user_id) filter (where exists (
          select 1 from public.push_subscriptions ps where ps.user_id = f.user_id and ps.platform = 'ios')),
        'new30d', count(distinct f.user_id) filter (where f.created_at >= now() - interval '30 days')
      ) from f
    ),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'title', p.title,
               'body', p.body,
               'templateKey', p.template_key,
               'source', coalesce(p.source, 'manual'),
               'status', p.status,
               'createdAt', p.created_at,
               'scheduledAt', p.scheduled_at,
               'eventId', p.event_id,
               'eventTitle', e.title,
               'targeted', coalesce(p.targeted_count, 0),
               'sent', coalesce(p.sent_count, 0),
               'failed', coalesce(p.failed_count, 0),
               'taps', coalesce((select count(*) from taps t where t.campaign_id = p.id), 0),
               'buyers', coalesce((select count(distinct a.user_id) from attributed a where a.campaign_id = p.id and a.pillar <> 'guestlist'), 0),
               'orders', coalesce((select count(*) from attributed a where a.campaign_id = p.id and a.pillar <> 'guestlist'), 0),
               'entries', coalesce((select count(*) from attributed a where a.campaign_id = p.id and a.pillar = 'guestlist'), 0),
               'revenue', case when v_money then round(coalesce((select sum(a.amount) from attributed a where a.campaign_id = p.id), 0)::numeric, 2) else null end
             ) order by coalesce(p.scheduled_at, p.created_at) desc, p.created_at desc)
      from page p
      left join public.events e on e.id = p.event_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

-- get_sales_overview : 6 expression(s)
CREATE OR REPLACE FUNCTION public.get_sales_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_is_org boolean := p_organizer_user_id is not null;
  v_tz     text := 'Europe/Paris';
  v_from   timestamptz;
  v_limit  integer;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if v_is_org then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
  end if;

  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
    order by e.start_at desc
    limit 1000
  ),
  cur_n as (
    select count(*)::integer as n from scope s
    where (v_limit is null or s.rn <= v_limit)
      and (v_from is null or s.start_at >= v_from)
  ),
  -- Période courante = les N premières ; précédente = les N suivantes.
  -- « Tout » n'a pas de période précédente.
  nights as materialized (
    select s.*, case when s.rn <= c.n then 'cur' else 'prev' end as bucket
    from scope s cross join cur_n c
    where s.rn <= c.n
       or (p_period <> 'all' and c.n > 0 and s.rn > c.n and s.rn <= 2 * c.n)
  ),

  tk as (
    select t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           count(*) as orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) as amount,
           sum(case when coalesce(t.total_price, 0) > 0 then round(t.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as entered
    from public.tickets t
    join nights n on n.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),
  tb as (
    select r.event_id,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount,
           sum(case when coalesce(r.payment_mode, 'online') <> 'on_site' and coalesce(r.total_price, 0) > 0
                    then round(r.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           count(*) filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as arrived,
           sum(greatest(coalesce(r.guest_count, 0), 1))
             filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as entered
    from public.table_reservations r
    join nights n on n.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),
  dr as (
    select o.event_id,
           count(*) as orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount,
           sum(case when coalesce(o.total, 0) > 0 then round(o.total * 0.015 + 0.25, 2) else 0 end) as stripe
    from public.orders o
    join nights n on n.id = o.event_id
    where not v_is_org
      and o.status in ('paid', 'served')
    group by o.event_id
  ),
  gl as (
    select g.event_id,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id
    where e2.status <> 'cancelled'
    group by g.event_id
  ),
  caps as (
    select n.id as event_id,
           -- Même capacité que get_event_report : un palier illimité rend la
           -- jauge sans capacité (pas un remplissage au-delà de 100 %).
           case when coalesce(n.max_tickets, 0) > 0 then n.max_tickets
                when exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id)
                 and not exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id and coalesce(tr.max_tickets, 0) <= 0)
                  then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = n.id)
                else null end as cap
    from nights n
  ),
  -- Personnes distinctes par soirée et par période (tous piliers).
  people as (
    select n.bucket, n.id as event_id, lower(trim(x.email)) as email
    from nights n
    join lateral (
      select t.user_email as email from public.tickets t where t.event_id = n.id and t.status in ('paid', 'used')
      union all
      select r.user_email from public.table_reservations r where r.event_id = n.id and r.status in ('paid', 'confirmed')
      union all
      select o.user_email from public.orders o where not v_is_org and o.event_id = n.id and o.status in ('paid', 'served')
      union all
      select e2.email from public.guest_list_entries e2 join public.guest_lists g on g.id = e2.guest_list_id
       where g.event_id = n.id and e2.status <> 'cancelled'
    ) x on true
    where nullif(trim(x.email), '') is not null
  ),
  per_night as (
    select n.id, n.title, n.start_at, n.poster, n.bucket, n.rn, n.show_money,
           coalesce(tk.sold, 0) as tickets, coalesce(tk.orders, 0) as ticket_orders,
           coalesce(tb.booked, 0) as tables, coalesce(tb.guests, 0) as table_guests, coalesce(tb.arrived, 0) as tables_arrived,
           coalesce(dr.orders, 0) as bar_orders,
           coalesce(gl.registered, 0) as gl_registered, coalesce(gl.entered, 0) as gl_entered,
           coalesce(tk.entered, 0) + coalesce(tb.entered, 0) + coalesce(gl.entered, 0) as entries,
           coalesce(tk.entered, 0) as ticket_entries,
           case when n.show_money then coalesce(tk.amount, 0) else 0 end as rev_tickets,
           case when n.show_money then coalesce(tb.amount, 0) else 0 end as rev_tables,
           case when n.show_money then coalesce(dr.amount, 0) else 0 end as rev_bar,
           case when n.show_money then coalesce(tk.stripe, 0) + coalesce(tb.stripe, 0) + coalesce(dr.stripe, 0) else 0 end as stripe,
           caps.cap,
           (select count(distinct p.email) from people p where p.event_id = n.id) as customers
    from nights n
    left join tk on tk.event_id = n.id
    left join tb on tb.event_id = n.id
    left join dr on dr.event_id = n.id
    left join gl on gl.event_id = n.id
    left join caps on caps.event_id = n.id
  ),
  totals as (
    select b.bucket,
           count(pn.id) as nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar), 0) as revenue,
           coalesce(sum(pn.rev_tickets), 0) as rev_tickets,
           coalesce(sum(pn.rev_tables), 0) as rev_tables,
           coalesce(sum(pn.rev_bar), 0) as rev_bar,
           coalesce(sum(pn.stripe), 0) as stripe,
           coalesce(sum(pn.entries), 0) as entries,
           coalesce(sum(pn.ticket_entries), 0) as ticket_entries,
           coalesce(sum(pn.tickets), 0) as tickets,
           coalesce(sum(pn.ticket_orders), 0) as ticket_orders,
           coalesce(sum(pn.tables), 0) as tables,
           coalesce(sum(pn.table_guests), 0) as table_guests,
           coalesce(sum(pn.tables_arrived), 0) as tables_arrived,
           coalesce(sum(pn.bar_orders), 0) as bar_orders,
           coalesce(sum(pn.gl_registered), 0) as gl_registered,
           coalesce(sum(pn.gl_entered), 0) as gl_entered,
           coalesce(sum(pn.cap) filter (where pn.cap > 0), 0) as ticket_cap,
           coalesce(sum(pn.tickets) filter (where pn.cap > 0), 0) as tickets_with_cap,
           -- Dénominateurs justes (revue du 25/09) : la dépense par tête ne
           -- compte que les soirées dont on voit l'argent ET où la porte a
           -- scanné ; la présence, que les soirées où la porte a scanné (sans
           -- scan, « pas scanné » ne veut pas dire « pas venu ») ; prix moyens
           -- sur les soirées dont on voit l'argent.
           count(pn.id) filter (where pn.show_money) as money_nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar) filter (where pn.show_money and pn.entries > 0), 0) as spend_revenue,
           coalesce(sum(pn.entries) filter (where pn.show_money and pn.entries > 0), 0) as spend_entries,
           coalesce(sum(pn.entries) filter (where pn.entries > 0), 0) as presence_entries,
           coalesce(sum(pn.tickets + pn.table_guests + pn.gl_registered) filter (where pn.entries > 0), 0) as presence_expected,
           coalesce(sum(pn.gl_registered) filter (where pn.gl_entered > 0), 0) as gl_presence_registered,
           coalesce(sum(pn.gl_entered) filter (where pn.gl_entered > 0), 0) as gl_presence_entered,
           coalesce(sum(pn.tables) filter (where pn.tables_arrived > 0), 0) as tables_presence_booked,
           coalesce(sum(pn.tables_arrived) filter (where pn.tables_arrived > 0), 0) as tables_presence_arrived,
           coalesce(sum(pn.tickets) filter (where pn.show_money), 0) as money_tickets,
           coalesce(sum(pn.tables) filter (where pn.show_money), 0) as money_tables,
           coalesce(sum(pn.bar_orders) filter (where pn.show_money), 0) as money_bar_orders,
           (select count(distinct p.email) from people p where p.bucket = b.bucket) as customers
    from (values ('cur'), ('prev')) b(bucket)
    left join per_night pn on pn.bucket = b.bucket
    group by b.bucket
  ),
  -- Détail des piliers, période courante seulement.
  rounds_list as (
    select tr.name,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           sum(case when n.show_money then
               greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
               else 0 end) as amount
    from public.tickets t
    join nights n on n.id = t.event_id and n.bucket = 'cur'
    join public.ticket_rounds tr on tr.id = t.ticket_round_id
    where t.status in ('paid', 'used')
    group by tr.name
    order by 2 desc
    limit 12
  ),
  packs_list as (
    select coalesce(p.name, '—') as name,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(case when n.show_money then
               greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
               else 0 end) as amount
    from public.table_reservations r
    join nights n on n.id = r.event_id and n.bucket = 'cur'
    left join public.table_packs p on p.id = r.pack_id
    where r.status in ('paid', 'confirmed')
    group by 1
    order by 4 desc, 2 desc
    limit 12
  ),
  -- Montant d'un produit = sa part du CA CLUB de la commande (fees.ts : total
  -- − frais Yuno, remboursement déduit), au prorata du prix carte : la somme
  -- des produits retombe exactement sur le CA du bar, jamais au-dessus.
  order_lines as (
    select o.id as order_id,
           it.value ->> 'name' as name,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1) as qty,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1)
             * greatest(coalesce((it.value ->> 'price')::numeric, 0), 0) as gross,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)) as order_net
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur' and n.show_money
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    where not v_is_org and o.status in ('paid', 'served')
      and nullif(it.value ->> 'name', '') is not null
  ),
  products_list as (
    select l.name,
           sum(l.qty) as qty,
           round(sum(case when t.gross_total > 0 then l.order_net * l.gross / t.gross_total else 0 end), 2) as amount
    from order_lines l
    join (select order_id, sum(gross) as gross_total from order_lines group by 1) t on t.order_id = l.order_id
    group by 1
    order by 2 desc
    limit 10
  ),
  bar_service as (
    select percentile_cont(0.5) within group (
             order by extract(epoch from (o.served_at - coalesce(o.paid_at, o.created_at))) / 60.0
           ) as median_min,
           count(*) as sample
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur'
    where not v_is_org and o.status = 'served' and o.served_at is not null
      and o.served_at > coalesce(o.paid_at, o.created_at)
      and o.served_at < coalesce(o.paid_at, o.created_at) + interval '3 hours'
  ),
  holders_list as (
    select case g.holder_type
             when 'club' then 'club' when 'organizer' then 'organizer' else coalesce(nullif(g.holder_label, ''), g.holder_type)
           end as name,
           g.holder_type as kind,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id and n.bucket = 'cur'
    where e2.status <> 'cancelled'
    group by 1, 2
    order by 3 desc
    limit 12
  ),
  -- Déjà vendu pour les soirées À VENIR (renvoie vers les prochaines soirées).
  upcoming as (
    select count(distinct e.id) as nights,
           coalesce(sum(
             case when (v_is_org and v_money) or (not v_is_org and v_money and e.venue_id = p_venue_id) then x.amount else 0 end
           ), 0) as amount
    from public.events e
    left join lateral (
      select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0),
                                  greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'has_bar', not v_is_org,
    'period', p_period,
    'generated_at', v_now,
    'current', (select to_jsonb(t) - 'bucket' from totals t where t.bucket = 'cur'),
    'previous', case when p_period = 'all' then null
                     -- Une comparaison n'a de sens qu'à nombre de soirées égal.
                     else (select case when t.nights > 0 and t.nights = (select n from cur_n) then to_jsonb(t) - 'bucket' end
                           from totals t where t.bucket = 'prev') end,
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pn.id, 'title', pn.title, 'start_at', pn.start_at, 'poster', pn.poster,
               'revenue', case when pn.show_money then pn.rev_tickets + pn.rev_tables + pn.rev_bar end,
               'rev_tickets', case when pn.show_money then pn.rev_tickets end,
               'rev_tables', case when pn.show_money then pn.rev_tables end,
               'rev_bar', case when pn.show_money then pn.rev_bar end,
               'entries', pn.entries, 'customers', pn.customers,
               'tickets', pn.tickets, 'ticket_cap', pn.cap, 'tables', pn.tables,
               'table_guests', pn.table_guests, 'tables_arrived', pn.tables_arrived,
               'bar_orders', pn.bar_orders,
               'gl_registered', pn.gl_registered, 'gl_entered', pn.gl_entered
             ) order by pn.start_at desc)
      from per_night pn where pn.bucket = 'cur'
    ), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'sold', r.sold,
                         'amount', case when v_money then r.amount end)) from rounds_list r), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'booked', p.booked, 'guests', p.guests,
                        'amount', case when v_money then p.amount end)) from packs_list p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty,
                           'amount', case when v_money then p.amount end)) from products_list p), '[]'::jsonb),
    'bar_service_min', (select case when b.sample >= 5 then round(b.median_min::numeric, 1) end from bar_service b),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('name', h.name, 'kind', h.kind,
                          'registered', h.registered, 'entered', h.entered)) from holders_list h), '[]'::jsonb),
    'upcoming', (select jsonb_build_object('nights', u.nights, 'amount', case when v_money then u.amount end) from upcoming u)
  ) into v_result;

  -- Sans l'argent, aucun montant ne sort, même agrégé.
  if not v_money then
    v_result := jsonb_set(v_result, '{current}',
      (v_result -> 'current') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    if v_result -> 'previous' is not null and jsonb_typeof(v_result -> 'previous') = 'object' then
      v_result := jsonb_set(v_result, '{previous}',
        (v_result -> 'previous') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    end if;
  end if;

  return v_result;
end;
$function$;

-- get_vip_table_analytics : 1 expression(s)
CREATE OR REPLACE FUNCTION public.get_vip_table_analytics(p_venue_id text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with res as (
    select
      r.id,
      r.zone_id,
      r.total_price,
      coalesce(r.service_fee, 0)     as service_fee,
      coalesce(r.management_fee, 0)   as management_fee,
      -- CA Club (Yuno fees exclus), avant remboursement — foote avec tableAnalytics.totalRevenue.
      greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) as gross,
      coalesce(r.guest_count, 0)      as guest_count,
      coalesce(r.deposit, 0)          as deposit,
      coalesce(r.minimum_spend, 0)    as minimum_spend,
      r.created_at,
      r.placed_at,
      r.finished_at,
      (r.checked_in_at is not null or coalesce(r.entry_scanned, false)) as arrived,
      e.start_at as event_start
    from public.table_reservations r
    join public.events e on e.id = r.event_id
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      and r.status = 'paid'
      and (p_event_id is null or r.event_id = p_event_id)
      and (p_from is null or r.created_at >= p_from)
      and (p_to   is null or r.created_at <= p_to)
  ),
  buckets as (
    select
      id, gross, guest_count,
      case
        when guest_count <= 2 then '1-2'
        when guest_count <= 4 then '3-4'
        when guest_count <= 6 then '5-6'
        when guest_count <= 8 then '7-8'
        else '9+'
      end as party_bucket,
      case
        when event_start is null then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 1 then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 2 then 'J-1'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 4 then 'J-2-3'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 8 then 'J-4-7'
        else 'J-8+'
      end as lead_bucket
    from res
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'booking_revenue', coalesce((select sum(gross) from res), 0),
      'reservations',    (select count(*) from res),
      'guests',          coalesce((select sum(guest_count) from res), 0),
      'avg_per_table',   coalesce((select round(avg(gross)::numeric, 2) from res), 0),
      'revenue_per_head', coalesce((
        select round((sum(gross) / nullif(sum(guest_count), 0))::numeric, 2) from res), 0),
      'avg_party_size',  coalesce((
        select round(avg(nullif(guest_count, 0))::numeric, 1) from res), 0),
      'total_deposit',   coalesce((select sum(deposit) from res), 0),
      'total_minimum',   coalesce((select sum(minimum_spend) from res where minimum_spend > 0), 0),
      'arrived_tables',  (select count(*) from res where arrived),
      'no_show_rate',    coalesce((
        select round((100.0 * (count(*) filter (where not arrived)) / nullif(count(*), 0))::numeric, 1)
        from res), 0),
      'avg_rotation_min', coalesce((
        select round(avg(extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'median_rotation_min', coalesce((
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'rotation_sample', (select count(*) from res where placed_at is not null and finished_at is not null and finished_at > placed_at)
    ),
    'party_size', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', party_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select party_bucket, count(*) cnt, sum(gross) rev,
               min(case party_bucket when '1-2' then 1 when '3-4' then 2 when '5-6' then 3 when '7-8' then 4 else 5 end) ord
        from buckets group by party_bucket
      ) p), '[]'::jsonb),
    'lead_time', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', lead_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select lead_bucket, count(*) cnt, sum(gross) rev,
               min(case lead_bucket when 'J-0' then 1 when 'J-1' then 2 when 'J-2-3' then 3 when 'J-4-7' then 4 else 5 end) ord
        from buckets group by lead_bucket
      ) l), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'reservations', reservations, 'revenue', revenue, 'guests', guests,
        'avg_per_table', avg_per_table) order by revenue desc)
      from (
        select r.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               count(*) reservations, sum(r.gross) revenue, sum(r.guest_count) guests,
               round(avg(r.gross)::numeric, 2) avg_per_table
        from res r
        left join public.table_zones tz on tz.id = r.zone_id
        group by r.zone_id, tz.name
      ) z), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'reservations', reservations, 'revenue', revenue) order by hour)
      from (
        select extract(hour from (created_at at time zone p_tz))::int as hour,
               count(*) reservations, sum(gross) revenue
        from res
        group by 1
      ) h), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

-- night_recap_data : 2 expression(s)
CREATE OR REPLACE FUNCTION public.night_recap_data(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e          record;
  v_entered  integer;
  v_expected integer;
  v_revenue  numeric;
  v_prev     record;
  v_prev_entered integer := 0;
  v_prev_title   text;
  v_owner    uuid;
begin
  select ev.*, v.owner_id as venue_owner
    into e
  from public.events ev
  left join public.venues v on v.id = ev.venue_id
  where ev.id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_owner := coalesce(e.venue_owner, e.organizer_user_id);
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_recipient');
  end if;

  -- La porte (même définition que get_event_report.totals.door).
  v_entered :=
      (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
        where t.event_id = p_event_id and t.status in ('paid', 'used')
          and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
    + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
        where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
          and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
    + (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
        where l.event_id = p_event_id and g.status <> 'cancelled' and coalesce(g.entry_scanned, false));
  v_expected :=
      (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
        where t.event_id = p_event_id and t.status in ('paid', 'used'))
    + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
        where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
    + (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
        where l.event_id = p_event_id and g.status <> 'cancelled');

  -- CA club (fees.ts) : total − frais Yuno, remboursement déduit, avant Stripe.
  -- Le bar ne compte que pour le club qui porte la soirée.
  v_revenue :=
      (select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
              - least(greatest(coalesce(t.refund_amount, 0), 0),
                      greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
         from public.tickets t where t.event_id = p_event_id and t.status in ('paid', 'used'))
    + (select coalesce(sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
              - least(greatest(coalesce(r.refund_amount, 0), 0),
                      greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))), 0)
         from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
    + (select coalesce(sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
              - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))), 0)
         from public.orders o
        where o.event_id = p_event_id and o.status in ('paid', 'served')
          and e.venue_id is not null and o.venue_id = e.venue_id);

  -- La soirée précédente de la même portée qui a vu du monde à la porte.
  for v_prev in
    select x.id, x.title
    from public.events x
    where x.id <> p_event_id and x.cancelled_at is null and x.start_at < e.start_at
      and ((e.venue_id is not null and x.venue_id = e.venue_id)
        or (e.venue_id is null and x.organizer_user_id = e.organizer_user_id))
    order by x.start_at desc
    limit 5
  loop
    v_prev_entered :=
        (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
          where t.event_id = v_prev.id and t.status in ('paid', 'used')
            and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
      + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
          where r.event_id = v_prev.id and r.status in ('paid', 'confirmed')
            and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
      + (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
          where l.event_id = v_prev.id and g.status <> 'cancelled' and coalesce(g.entry_scanned, false));
    if v_prev_entered > 0 then
      v_prev_title := v_prev.title;
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'event_id', e.id,
    'title', e.title,
    'venue_id', e.venue_id,
    'organizer_user_id', case when e.venue_id is null then e.organizer_user_id end,
    'recipient', v_owner,
    'entered', v_entered,
    'expected', v_expected,
    'target', e.entry_target,
    'revenue', round(v_revenue, 2),
    'spend', case when v_entered > 0 and v_revenue > 0 then round(v_revenue / v_entered, 2) end,
    'prev_title', v_prev_title,
    'prev_entered', case when v_prev_title is not null then v_prev_entered end,
    -- La démo ne reçoit jamais de push réel (la cloche, oui).
    'demo', e.id = any (public.demo_event_ids())
  );
end;
$function$;
