-- « Qui fait vendre ? » — ce que chaque partie d'une soirée à plusieurs apporte.
--
-- Page `…/partners` de la collaboration (club ET organisateur, contrat comme
-- co-organisation). Une vente revient à la partie qui l'a amenée, dans cet
-- ordre : (1) le lien suivi par lequel elle est arrivée (possédé par la partie,
-- ou par un de SES promoteurs), (2) la conversion d'un de ses promoteurs,
-- (3) pour une inscription, la part de guest list qui l'a reçue ; sinon elle
-- reste « sans partenaire identifié ». Une attribution, jamais un partage
-- d'argent : le partage vit dans le contrat et le décompte.
--
-- Mêmes portes que `get_event_party_links` (lecture = une partie de niveau ≥ 1,
-- CA = une partie de niveau argent qui voit le CA de la soirée), les statuts du
-- rapport de soirée (inscription guest list = toute ligne non annulée)
-- et même formule de CA club (fees.ts : frais Yuno exclus, frais de gestion
-- absorbés déduits, remboursement déduit).

CREATE OR REPLACE FUNCTION public.get_collab_party_breakdown(p_event_id uuid)
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
  v_other jsonb;
  v_total jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 1;
  IF v_mine IS NULL AND NOT v_admin THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  v_money := v_admin OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_mine, '{}'::text[])) k
     WHERE public.coorg_party_level(v_uid, k) >= 3 AND public.coorg_sees_event_money(p_event_id, k));

  -- Une seule requête (fonction STABLE, et une session d'aperçu démo est en
  -- lecture seule : pas de table temporaire).
  WITH promo AS (
    SELECT pr.id,
           CASE WHEN pr.organizer_user_id IS NOT NULL THEN 'org:' || pr.organizer_user_id
                WHEN pr.venue_id IS NOT NULL THEN 'venue:' || pr.venue_id END AS pkey
      FROM public.promoters pr
  ),
  links AS (
    SELECT tl.id, COALESCE(tl.clicks_count, 0) AS clicks,
           COALESCE((SELECT pm.pkey FROM promo pm WHERE pm.id = tl.promoter_id),
                    CASE WHEN tl.organizer_user_id IS NOT NULL THEN 'org:' || tl.organizer_user_id
                         WHEN tl.venue_id IS NOT NULL THEN 'venue:' || tl.venue_id END) AS pkey
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id
  ),
  sales (pkey, tickets, tables, table_guests, guests, entered, ca) AS (
    SELECT COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.ticket_id = t.id AND pm.pkey IS NOT NULL LIMIT 1)),
           COALESCE(t.quantity, 1), 0, 0, 0,
           CASE WHEN COALESCE(t.entry_scanned, false) OR COALESCE(t.used, false) THEN COALESCE(t.quantity, 1) ELSE 0 END,
           greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0))
      FROM public.tickets t
      LEFT JOIN links l ON l.id = t.tracked_link_id
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used', 'served')
    UNION ALL
    SELECT COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.table_reservation_id = r.id AND pm.pkey IS NOT NULL LIMIT 1)),
           0, 1, COALESCE(r.guest_count, 0), 0,
           CASE WHEN COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL THEN greatest(COALESCE(r.guest_count, 1), 1) ELSE 0 END,
           greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                    - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0)
                              - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0))
      FROM public.table_reservations r
      LEFT JOIN links l ON l.id = r.tracked_link_id
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed', 'served')
    UNION ALL
    SELECT COALESCE(l.pkey,
             (SELECT pm.pkey FROM promo pm WHERE pm.id = g.promoter_id),
             (SELECT pm.pkey FROM promo pm WHERE pm.id = gl.promoter_id),
             CASE WHEN gl.organizer_user_id IS NOT NULL THEN 'org:' || gl.organizer_user_id
                  WHEN gl.venue_id IS NOT NULL THEN 'venue:' || gl.venue_id END),
           0, 0, 0, 1,
           CASE WHEN COALESCE(g.entry_scanned, false) OR g.status = 'entered' THEN 1 ELSE 0 END,
           0
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
      LEFT JOIN links l ON l.id = g.tracked_link_id
     WHERE gl.event_id = p_event_id AND g.status <> 'cancelled'
  ),
  parties AS (
    SELECT p.party_key, p.display_name, p.kind, p.role, p.avatar_url, p.ord
      FROM public.event_parties(p_event_id) p
  ),
  clicks AS (SELECT pkey, sum(clicks)::int AS clicks FROM links GROUP BY pkey),
  agg AS (
    SELECT pkey, sum(tickets)::int AS tickets, sum(tables)::int AS tables, sum(table_guests)::int AS table_guests,
           sum(guests)::int AS guests, sum(entered)::int AS entered, round(sum(ca), 2) AS ca
      FROM sales GROUP BY pkey
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'party', p.party_key, 'name', p.display_name, 'kind', p.kind, 'role', p.role, 'avatar_url', p.avatar_url,
              'mine', p.party_key = ANY (COALESCE(v_mine, '{}'::text[])),
              'clicks', COALESCE(c.clicks, 0),
              'tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0),
              'table_guests', COALESCE(a.table_guests, 0), 'guests', COALESCE(a.guests, 0),
              'entered', COALESCE(a.entered, 0),
              'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END
            ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
       FROM parties p
       LEFT JOIN agg a ON a.pkey = p.party_key
       LEFT JOIN clicks c ON c.pkey = p.party_key),
    (SELECT jsonb_build_object(
              'tickets', COALESCE(sum(s.tickets), 0)::int, 'tables', COALESCE(sum(s.tables), 0)::int,
              'table_guests', COALESCE(sum(s.table_guests), 0)::int, 'guests', COALESCE(sum(s.guests), 0)::int,
              'entered', COALESCE(sum(s.entered), 0)::int,
              'revenue', CASE WHEN v_money THEN round(COALESCE(sum(s.ca), 0), 2) END)
       FROM sales s
      WHERE s.pkey IS NULL OR NOT EXISTS (SELECT 1 FROM parties p WHERE p.party_key = s.pkey)),
    (SELECT jsonb_build_object(
              'tickets', COALESCE(sum(s.tickets), 0)::int, 'tables', COALESCE(sum(s.tables), 0)::int,
              'table_guests', COALESCE(sum(s.table_guests), 0)::int, 'guests', COALESCE(sum(s.guests), 0)::int,
              'entered', COALESCE(sum(s.entered), 0)::int,
              'revenue', CASE WHEN v_money THEN round(COALESCE(sum(s.ca), 0), 2) END)
       FROM sales s)
    INTO v_rows, v_other, v_total;

  RETURN jsonb_build_object('ok', true, 'money', v_money, 'parties', v_rows, 'unattributed', v_other, 'totals', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_collab_party_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collab_party_breakdown(uuid) TO authenticated;
