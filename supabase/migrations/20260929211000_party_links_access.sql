-- get_event_party_links : + `access` de chaque partie (la pastille « Co-hôte · édition /
-- lecture » de la carte « Qui fait vendre » le lisait sans l'avoir). Reprise de l'état LIVE.
CREATE OR REPLACE FUNCTION public.get_event_party_links(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_super_admin();
  v_mine  text[];
  v_money boolean;
  v_rows  jsonb;
  v_total record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 1;
  IF v_mine IS NULL AND NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  -- L'argent : une de MES parties de niveau argent, qui voit le CA de la soirée.
  v_money := v_admin OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_mine, '{}'::text[])) k
     WHERE public.coorg_party_level(v_uid, k) >= 3 AND public.coorg_sees_event_money(p_event_id, k));

  WITH links AS (
    SELECT tl.id, tl.code, tl.utm_campaign AS party_key, tl.clicks_count, tl.is_active
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id AND tl.utm_medium = 'party_link'
  ),
  sales AS (
    SELECT t.tracked_link_id AS link_id, 1 AS sales, COALESCE(t.quantity, 1) AS tickets, 0 AS tables, 0 AS guests,
           greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS ca
      FROM public.tickets t
     WHERE t.event_id = p_event_id AND t.tracked_link_id IN (SELECT id FROM links)
       AND t.status IN ('paid', 'used', 'served')
    UNION ALL
    SELECT r.tracked_link_id, 1, 0, 1, 0,
           greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                    - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                              - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0))
      FROM public.table_reservations r
     WHERE r.event_id = p_event_id AND r.tracked_link_id IN (SELECT id FROM links)
       AND r.status IN ('paid', 'confirmed', 'served')
    UNION ALL
    SELECT g.tracked_link_id, 1, 0, 0, 1, 0
      FROM public.guest_list_entries g
     WHERE g.tracked_link_id IN (SELECT id FROM links)
       AND g.status IN ('confirmed', 'entered', 'reserved')
  ),
  agg AS (
    SELECT link_id, sum(sales)::int AS sales, sum(tickets)::int AS tickets, sum(tables)::int AS tables,
           sum(guests)::int AS guests, round(sum(ca), 2) AS ca
      FROM sales GROUP BY link_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'party', p.party_key, 'name', p.display_name, 'kind', p.kind, 'role', p.role, 'access', p.access,
           'avatar_url', p.avatar_url,
           'mine', p.party_key = ANY (COALESCE(v_mine, '{}'::text[])),
           'has_link', l.id IS NOT NULL,
           'code', CASE WHEN p.party_key = ANY (COALESCE(v_mine, '{}'::text[])) OR v_admin THEN l.code END,
           'active', COALESCE(l.is_active, false),
           'clicks', COALESCE(l.clicks_count, 0),
           'sales', COALESCE(a.sales, 0), 'tickets', COALESCE(a.tickets, 0),
           'tables', COALESCE(a.tables, 0), 'guests', COALESCE(a.guests, 0),
           'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    INTO v_rows
    FROM public.event_parties(p_event_id) p
    LEFT JOIN links l ON l.party_key = p.party_key
    LEFT JOIN agg a ON a.link_id = l.id;

  RETURN jsonb_build_object('ok', true, 'money', v_money, 'parties', v_rows);
END;
$function$;
