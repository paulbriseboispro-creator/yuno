-- Onglet Commandes : la démo sort de la liste et des compteurs.
--
-- `/admin/orders` lisait `orders`, `tickets` et `table_reservations` en direct,
-- sans aucun filtre : au 08/09 il affichait 1 210 commandes, 2 616 billets et
-- 84 réservations, TOUTES issues du seed démo et de Stripe test. Aucune vente
-- réelle dans la base (aucune session `cs_live_`).
--
-- Filtrer côté client était exclu : la pagination et les compteurs doivent
-- rester serveur, et exclure 105 soirées démo par `not.in.(…)` dans une URL
-- PostgREST casse dès que le club démo grossit.
--
-- `p_include_demo` laisse rouvrir la démo à la demande — elle reste consultable,
-- elle n'est simplement plus comptée par défaut.
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
