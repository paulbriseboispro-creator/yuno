-- Onglet Commandes : la guest list devient un pilier traçable.
--
-- `/admin/orders` couvrait boissons, billets et tables — c'est-à-dire tout ce
-- qui encaisse. La guest list n'y était nulle part, alors que c'est souvent la
-- SEULE trace d'une venue sur une soirée sans billetterie (cf.
-- `_admin_customer_activity` du 08/09 : la plateforme comptait 0 client là où
-- elle en avait 9). Le super admin ne pouvait donc pas répondre à « qui est
-- inscrit ce soir, et combien sont vraiment entrés ».
--
-- Une inscription n'a pas de statut de paiement : elle vaut une place à la
-- porte. L'état qui compte se lit sur DEUX colonnes (`status` + `entry_scanned`)
-- et se résout ici en un seul mot — `cancelled` / `entered` / `registered` —
-- exactement comme le fait déjà `OwnerGuestListOrders` côté club. La porte démo
-- (`demo_venue_ids` / `demo_event_ids`) est matérialisée une seule fois, comme
-- partout ailleurs dans le dashboard.
CREATE OR REPLACE FUNCTION public.admin_orders_list(
  p_kind text,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
                                     - COALESCE(r.management_fee, 0)::numeric) AS club_gross,
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

GRANT EXECUTE ON FUNCTION public.admin_orders_list(text, text, text, integer, integer, boolean) TO authenticated;
