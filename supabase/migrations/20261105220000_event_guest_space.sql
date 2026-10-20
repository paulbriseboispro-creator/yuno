-- ============================================================================
-- L'espace invité d'une soirée : ce qu'il montre (six onglets) et les gestes
-- que l'invité fait par son lien.
-- ============================================================================
-- Suite de 20261105210000. Une seule lecture, get_event_guest_space(jeton),
-- sert les six onglets (Vue d'ensemble, Ventes, Marketing, Argent, Porte,
-- Infos & contrat). Agrégats seulement : jamais un acheteur. Seules les
-- personnes que l'INVITÉ a lui-même mises sur sa part de guest list sont
-- nommées (ce sont les siennes).
--
-- Mêmes formules que le reste de la Billetterie : CA club de fees.ts
-- (billets total − frais de service − assurance, tables total − frais de
-- service − frais de gestion absorbés, remboursements déduits), frais Stripe
-- estimés comme _collab_transfer_compute (1,5 % + 0,25 € par paiement), porte
-- = billets valides scannés + convives de tables arrivés + guest list scannée.
--
-- Qui fait vendre (règle unique, `_guest_space_sale_key`) : lien suivi de
-- l'invité → l'invité ; lien suivi d'une partie ou d'un de ses promoteurs →
-- la partie ; attribution `marketplace` ou achat depuis une page Yuno
-- (Explore, page club / organisateur) → « yuno » ; le reste → « direct ».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La clé d'attribution d'une vente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guest_space_sale_key(
  p_link_id uuid, p_ticket_id uuid, p_table_id uuid, p_attribution text, p_purchase_source text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH l AS (
    SELECT tl.guest_pass_id, tl.promoter_id, tl.venue_id, tl.organizer_user_id
      FROM public.tracked_links tl WHERE tl.id = p_link_id
  ),
  pr AS (
    SELECT CASE WHEN p.organizer_user_id IS NOT NULL THEN 'org:' || p.organizer_user_id
                WHEN p.venue_id IS NOT NULL THEN 'venue:' || p.venue_id END AS pkey
      FROM public.promoters p
     WHERE p.id = coalesce(
             (SELECT l.promoter_id FROM l),
             (SELECT c.promoter_id FROM public.promoter_conversions c
               WHERE (p_ticket_id IS NOT NULL AND c.ticket_id = p_ticket_id)
                  OR (p_table_id IS NOT NULL AND c.table_reservation_id = p_table_id)
               LIMIT 1))
  )
  SELECT coalesce(
    (SELECT 'guest:' || l.guest_pass_id FROM l WHERE l.guest_pass_id IS NOT NULL),
    (SELECT pr.pkey FROM pr WHERE pr.pkey IS NOT NULL),
    (SELECT CASE WHEN l.organizer_user_id IS NOT NULL THEN 'org:' || l.organizer_user_id
                 WHEN l.venue_id IS NOT NULL THEN 'venue:' || l.venue_id END FROM l),
    CASE WHEN p_attribution = 'marketplace'
           OR p_purchase_source IN ('explore', 'venue_profile', 'organizer_profile', 'dj_profile', 'app', 'marketplace')
         THEN 'yuno' ELSE 'direct' END
  );
$$;
REVOKE ALL ON FUNCTION public._guest_space_sale_key(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le contenu de l'espace (agrégats).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guest_space_payload(p_pass public.event_guest_passes)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       timestamptz := now();
  e           record;
  v_tz        text;
  v_day_start timestamptz;
  v_phase     text;
  v_uid       uuid := auth.uid();
  v_member    integer := 0;
  v_money     boolean;
  v_org       record;
  v_result    jsonb;
  v_rules     jsonb;
  v_compute   jsonb;
  v_contract  boolean := false;
  v_statement record;
  v_transfer  record;
  v_money_obj jsonb;
  v_collector text;
  v_gl_id     uuid;
BEGIN
  SELECT ev.*, coalesce(nullif(ev.timezone, ''), v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = coalesce(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_pass.event_id;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_phase := CASE WHEN e.cancelled_at IS NOT NULL THEN 'cancelled'
                  WHEN v_now >= coalesce(e.end_at, e.start_at + interval '8 hours') THEN 'after'
                  WHEN v_now >= e.start_at THEN 'live'
                  ELSE 'before' END;

  IF v_uid IS NOT NULL AND p_pass.guest_party IS NOT NULL THEN
    v_member := public.coorg_party_level(v_uid, p_pass.guest_party);
  END IF;
  -- L'argent : ce que l'organisateur laisse voir, ou le titulaire de la partie
  -- invitée quand elle est signataire du contrat de la soirée.
  v_money := p_pass.show_revenue OR v_member >= 3;

  SELECT p.display_name, p.avatar_url, p.kind,
         (SELECT op.instagram_url FROM public.organizer_profiles op WHERE op.user_id = p.organizer_user_id) AS instagram
    INTO v_org
    FROM public.event_parties(p_pass.event_id) p
   WHERE p.party_key = p_pass.created_by_party;

  SELECT gl.id INTO v_gl_id FROM public.guest_lists gl WHERE gl.guest_pass_id = p_pass.id;

  -- Contrat Yuno réglé par virement dont l'invité est une des deux parties ?
  v_rules := public.normalize_collab_settlement(e.revenue_split_rules);
  IF p_pass.guest_party IS NOT NULL AND v_rules IS NOT NULL
     AND public.collab_settlement_mode(v_rules) = 'transfer' THEN
    v_compute := public._collab_transfer_compute(p_pass.event_id);
    v_contract := coalesce((v_compute->>'ok')::boolean, false)
                  AND p_pass.guest_party IN (v_compute->>'venue_key', v_compute->>'org_key');
  END IF;

  WITH
  tx AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, coalesce(t.paid_at, t.created_at) AS at_ts,
           greatest(coalesce(t.quantity, 1), 1) AS heads,
           (coalesce(t.total_price, 0) > 0) AS paid,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) AS gross,
           least(greatest(coalesce(t.refund_amount, 0), 0),
                 greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) AS refund,
           coalesce(t.service_fee, 0) + coalesce(t.insurance_fee, 0) AS yuno_fee,
           CASE WHEN coalesce(t.total_price, 0) > 0 THEN round(t.total_price * 0.015 + 0.25, 2) ELSE 0 END AS stripe,
           t.ticket_round_id AS line_id,
           (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used') AS scanned,
           public._guest_space_sale_key(t.tracked_link_id, t.id, NULL, t.attribution_source, t.purchase_source) AS skey
      FROM public.tickets t
     WHERE t.event_id = p_pass.event_id AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', r.id, coalesce(r.paid_at, r.created_at),
           greatest(coalesce(r.guest_count, 0), 1),
           true,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0),
           least(greatest(coalesce(r.refund_amount, 0), 0),
                 greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(r.service_fee, 0),
           CASE WHEN coalesce(r.deposit, 0) > 0 AND coalesce(r.payment_mode, 'online') = 'online'
                THEN round((r.deposit + CASE WHEN coalesce(r.fee_absorbed, false) THEN 0 ELSE coalesce(r.management_fee, 0) END) * 0.015 + 0.25, 2)
                ELSE 0 END,
           r.pack_id,
           (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL),
           public._guest_space_sale_key(r.tracked_link_id, NULL, r.id, r.attribution_source, r.purchase_source)
      FROM public.table_reservations r
     WHERE r.event_id = p_pass.event_id AND r.status IN ('paid', 'confirmed')
  ),
  gle AS MATERIALIZED (
    SELECT g.id, g.created_at AS at_ts, g.guest_list_id, coalesce(g.entry_scanned, false) AS scanned
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = p_pass.event_id AND g.status <> 'cancelled'
  ),
  series AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (at_ts AT TIME ZONE v_tz)::date AS d,
           sum(heads) FILTER (WHERE pillar = 'tickets') AS tickets,
           count(*) FILTER (WHERE pillar = 'tables') AS tables
      FROM tx GROUP BY 1
  ),
  rounds AS (
    SELECT tr.id, tr.name, tr.price, tr.position, tr.created_at, tr.max_tickets, tr.is_active,
           tr.auto_activate, tr.manually_sold_out, tr.hidden, tr.entry_deadline, tr.includes_drink,
           tr.drink_cutoff_time,
           coalesce((SELECT sum(heads) FROM tx WHERE pillar = 'tickets' AND line_id = tr.id), 0) AS sold,
           coalesce((SELECT sum(gross - refund) FROM tx WHERE pillar = 'tickets' AND line_id = tr.id), 0) AS ca
      FROM public.ticket_rounds tr
     WHERE tr.event_id = p_pass.event_id
  ),
  packs AS (
    SELECT p.id, p.name, p.base_price, p.position, p.created_at, p.tables_count,
           (SELECT count(*) FROM tx WHERE pillar = 'tables' AND line_id = p.id) AS sold,
           coalesce((SELECT sum(gross - refund) FROM tx WHERE pillar = 'tables' AND line_id = p.id), 0) AS ca,
           coalesce((SELECT sum(heads) FROM tx WHERE pillar = 'tables' AND line_id = p.id), 0) AS guests
      FROM public.table_packs p
     WHERE p.is_active
       AND (p.event_id = p_pass.event_id
            OR (p.event_id IS NULL AND coalesce(e.venue_id, e.partner_venue_id) IS NOT NULL
                AND p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
  ),
  who AS (
    SELECT skey,
           sum(heads) FILTER (WHERE pillar = 'tickets') AS tickets,
           count(*) FILTER (WHERE pillar = 'tables') AS tables,
           sum(gross - refund) AS ca
      FROM tx GROUP BY skey
  ),
  who_named AS (
    SELECT w.skey, w.tickets, w.tables, w.ca,
           CASE
             WHEN w.skey = 'guest:' || p_pass.id THEN p_pass.guest_name
             WHEN w.skey LIKE 'guest:%' THEN (SELECT h.guest_name FROM public.event_guest_passes h WHERE 'guest:' || h.id = w.skey)
             WHEN w.skey IN ('yuno', 'direct') THEN NULL
             ELSE (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = w.skey)
           END AS name,
           CASE WHEN w.skey = 'guest:' || p_pass.id THEN 'me'
                WHEN w.skey IN ('yuno', 'direct') THEN w.skey
                WHEN w.skey LIKE 'guest:%' THEN 'guest'
                ELSE 'party' END AS kind
      FROM who w
  )
  SELECT jsonb_build_object(
    'now', v_now,
    'phase', v_phase,
    'viewer', jsonb_build_object('member_level', v_member, 'signed_in', v_uid IS NOT NULL),
    'money_visible', v_money,
    'event', jsonb_build_object(
      'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'timezone', v_tz,
      'poster_url', coalesce(e.poster_url, e.image_url),
      'location_name', e.location_name, 'location_city', e.location_city,
      'location_address', CASE WHEN coalesce(e.location_is_secret, false) THEN NULL ELSE e.location_address END,
      'organizer_name', coalesce(v_org.display_name, 'Yuno'), 'organizer_avatar', v_org.avatar_url,
      'event_mode', e.event_mode, 'ticket_selling_mode', e.ticket_selling_mode,
      'tables_enabled', coalesce(e.tables_enabled, false)
    ),
    'organizer_contact', jsonb_build_object(
      'email', p_pass.organizer_contact_email, 'phone', p_pass.organizer_contact_phone, 'instagram', v_org.instagram
    ),
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets'),
        'paid', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND paid),
        'free', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND NOT paid),
        'today', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND at_ts >= v_day_start),
        'capacity', CASE
          WHEN coalesce(e.max_tickets, 0) > 0 THEN e.max_tickets
          WHEN EXISTS (SELECT 1 FROM rounds) AND NOT EXISTS (SELECT 1 FROM rounds WHERE coalesce(max_tickets, 0) <= 0)
            THEN (SELECT sum(max_tickets) FROM rounds)
          ELSE NULL END,
        'on_sale', (SELECT count(*) FROM rounds r WHERE r.is_active AND NOT coalesce(r.manually_sold_out, false)
                     AND (coalesce(r.max_tickets, 0) <= 0 OR r.sold < r.max_tickets) AND NOT coalesce(e.tickets_sold_out, false))
      ),
      'tables', jsonb_build_object(
        'booked', (SELECT count(*) FROM tx WHERE pillar = 'tables'),
        'guests', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tables'),
        'today', (SELECT count(*) FROM tx WHERE pillar = 'tables' AND at_ts >= v_day_start),
        'capacity', nullif((SELECT coalesce(sum(tables_count), 0) FROM packs), 0)
      ),
      'guest_list', jsonb_build_object(
        'registered', (SELECT count(*) FROM gle),
        'places', (SELECT CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE coalesce(gl.quota, 0) <= 0) = 0
                               THEN sum(gl.quota) END
                     FROM public.guest_lists gl WHERE gl.event_id = p_pass.event_id AND gl.is_active),
        'mine_places', (SELECT gl.quota FROM public.guest_lists gl WHERE gl.id = v_gl_id),
        'mine_registered', (SELECT count(*) FROM gle WHERE guest_list_id = v_gl_id),
        'mine_entered', (SELECT count(*) FROM gle WHERE guest_list_id = v_gl_id AND scanned)
      ),
      'expected', (SELECT coalesce(sum(heads), 0) FROM tx) + (SELECT count(*) FROM gle),
      'expected_today', (SELECT coalesce(sum(heads), 0) FROM tx WHERE at_ts >= v_day_start)
                      + (SELECT count(*) FROM gle WHERE at_ts >= v_day_start),
      'entered', jsonb_build_object(
        'tickets', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND scanned),
        'tables', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tables' AND scanned),
        'guest_list', (SELECT count(*) FROM gle WHERE scanned),
        'last_10min', (SELECT count(*) FROM public.tickets t WHERE t.event_id = p_pass.event_id
                         AND t.entry_scanned_at > v_now - interval '10 minutes')
                    + (SELECT count(*) FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                         WHERE gl.event_id = p_pass.event_id AND g.entry_scanned_at > v_now - interval '10 minutes')
      ),
      'revenue', CASE WHEN v_money THEN jsonb_build_object(
        'total', round((SELECT coalesce(sum(gross - refund), 0) FROM tx)::numeric, 2),
        'today', round((SELECT coalesce(sum(gross - refund), 0) FROM tx WHERE at_ts >= v_day_start)::numeric, 2),
        'tickets', round((SELECT coalesce(sum(gross - refund), 0) FROM tx WHERE pillar = 'tickets')::numeric, 2),
        'tables', round((SELECT coalesce(sum(gross - refund), 0) FROM tx WHERE pillar = 'tables')::numeric, 2)
      ) END
    ),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('d', s.d, 'tickets', coalesce(s.tickets, 0), 'tables', s.tables) ORDER BY s.d DESC)
        FROM series s WHERE s.d <= 60
    ), '[]'::jsonb),
    'series_before', jsonb_build_object(
      'tickets', (SELECT coalesce(sum(s.tickets), 0) FROM series s WHERE s.d > 60),
      'tables', (SELECT coalesce(sum(s.tables), 0) FROM series s WHERE s.d > 60)),
    'tickets', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', r.name, 'price', r.price, 'sold', r.sold, 'capacity', nullif(r.max_tickets, 0),
               'entry_deadline', to_char(r.entry_deadline, 'HH24:MI'),
               'includes_drink', coalesce(r.includes_drink, false),
               'drink_cutoff', to_char(r.drink_cutoff_time, 'HH24:MI'),
               'revenue', CASE WHEN v_money THEN round(r.ca::numeric, 2) END,
               'status', CASE
                 WHEN coalesce(e.tickets_sold_out, false) OR coalesce(r.manually_sold_out, false)
                   OR (coalesce(r.max_tickets, 0) > 0 AND r.sold >= r.max_tickets) THEN 'sold_out'
                 WHEN r.is_active THEN 'on_sale'
                 WHEN coalesce(r.auto_activate, false) THEN 'upcoming'
                 ELSE 'closed' END
             ) ORDER BY r.position, r.created_at)
        FROM rounds r WHERE NOT coalesce(r.hidden, false) OR r.sold > 0
    ), '[]'::jsonb),
    'tables', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', p.name, 'price', p.base_price, 'sold', p.sold, 'capacity', nullif(p.tables_count, 0),
               'guests', p.guests, 'revenue', CASE WHEN v_money THEN round(p.ca::numeric, 2) END
             ) ORDER BY p.position, p.created_at)
        FROM packs p
    ), '[]'::jsonb),
    'guest_list_parts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', CASE WHEN gl.guest_pass_id IS NOT NULL THEN coalesce(h.guest_name, gl.holder_label)
                            WHEN gl.holder_type = 'organizer' THEN coalesce(op.display_name, nullif(btrim(gl.holder_label), ''))
                            ELSE coalesce(nullif(btrim(gl.holder_label), ''), v_org.display_name) END,
               'places', nullif(gl.quota, 0),
               'registered', (SELECT count(*) FROM gle WHERE gle.guest_list_id = gl.id),
               'entered', (SELECT count(*) FROM gle WHERE gle.guest_list_id = gl.id AND gle.scanned),
               'mine', gl.id = v_gl_id
             ) ORDER BY gl.id = v_gl_id DESC, gl.created_at)
        FROM public.guest_lists gl
        LEFT JOIN public.event_guest_passes h ON h.id = gl.guest_pass_id
        LEFT JOIN public.organizer_profiles op ON op.user_id = gl.organizer_user_id
       WHERE gl.event_id = p_pass.event_id AND (gl.is_active OR gl.id = v_gl_id)
    ), '[]'::jsonb),
    'my_guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.full_name, 'entered', coalesce(g.entry_scanned, false),
                                          'at', g.created_at) ORDER BY g.created_at DESC)
        FROM public.guest_list_entries g
       WHERE g.guest_list_id = v_gl_id AND g.status <> 'cancelled'
    ), '[]'::jsonb),
    'who_sells', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'key', w.skey, 'kind', w.kind, 'name', w.name,
               'tickets', coalesce(w.tickets, 0), 'tables', coalesce(w.tables, 0),
               'revenue', CASE WHEN v_money THEN round(coalesce(w.ca, 0)::numeric, 2) END
             ) ORDER BY coalesce(w.tickets, 0) + coalesce(w.tables, 0) DESC)
        FROM who_named w
    ), '[]'::jsonb),
    'parties', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', p.party_key, 'name', p.display_name, 'kind', p.kind, 'role', p.role) ORDER BY p.ord)
        FROM public.event_parties(p_pass.event_id) p
    ), '[]'::jsonb),
    'my_links', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', tl.id, 'code', tl.code, 'channel', replace(coalesce(tl.utm_source, 'guest_direct'), 'guest_', ''),
               'active', tl.is_active, 'clicks', coalesce(tl.clicks_count, 0),
               'tickets', (SELECT coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) FROM public.tickets t
                            WHERE t.tracked_link_id = tl.id AND t.status IN ('paid', 'used')),
               'tables', (SELECT count(*) FROM public.table_reservations r
                           WHERE r.tracked_link_id = tl.id AND r.status IN ('paid', 'confirmed')),
               'revenue', CASE WHEN v_money THEN round((
                   (SELECT coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                                        - least(greatest(coalesce(t.refund_amount, 0), 0),
                                                greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
                      FROM public.tickets t WHERE t.tracked_link_id = tl.id AND t.status IN ('paid', 'used'))
                 + (SELECT coalesce(sum(greatest(r.total_price - coalesce(r.service_fee, 0)
                                          - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                                        - least(greatest(coalesce(r.refund_amount, 0), 0),
                                                greatest(r.total_price - coalesce(r.service_fee, 0)
                                                  - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))), 0)
                      FROM public.table_reservations r WHERE r.tracked_link_id = tl.id AND r.status IN ('paid', 'confirmed'))
                 )::numeric, 2) END
             ) ORDER BY tl.created_at)
        FROM public.tracked_links tl
       WHERE tl.guest_pass_id = p_pass.id AND tl.archived_at IS NULL
    ), '[]'::jsonb),
    'door', jsonb_build_object(
      'deadlines', coalesce((SELECT jsonb_agg(DISTINCT to_char(r.entry_deadline, 'HH24:MI')) FROM rounds r WHERE r.entry_deadline IS NOT NULL), '[]'::jsonb),
      'drink_heads', (SELECT coalesce(sum(r.sold), 0) FROM rounds r WHERE coalesce(r.includes_drink, false)),
      'drink_cutoff', (SELECT to_char(r.drink_cutoff_time, 'HH24:MI') FROM rounds r
                        WHERE coalesce(r.includes_drink, false) AND r.drink_cutoff_time IS NOT NULL
                        GROUP BY r.drink_cutoff_time ORDER BY sum(r.sold) DESC, r.drink_cutoff_time LIMIT 1)
    ),
    'figures', CASE WHEN v_money THEN jsonb_build_object(
      'tickets_count', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets'),
      'tickets_gross', round((SELECT coalesce(sum(gross), 0) FROM tx WHERE pillar = 'tickets')::numeric, 2),
      'tables_count', (SELECT count(*) FROM tx WHERE pillar = 'tables'),
      'tables_gross', round((SELECT coalesce(sum(gross), 0) FROM tx WHERE pillar = 'tables')::numeric, 2),
      'refunds', round((SELECT coalesce(sum(refund), 0) FROM tx)::numeric, 2),
      'refunds_count', (SELECT count(*) FROM tx WHERE refund > 0),
      'ca', round((SELECT coalesce(sum(gross - refund), 0) FROM tx)::numeric, 2),
      'stripe', round((SELECT coalesce(sum(stripe), 0) FROM tx)::numeric, 2),
      'net', round((SELECT coalesce(sum(greatest(gross - refund - stripe, 0)), 0) FROM tx)::numeric, 2),
      'net_tickets', round((SELECT coalesce(sum(greatest(gross - refund - stripe, 0)), 0) FROM tx WHERE pillar = 'tickets')::numeric, 2),
      'net_tables', round((SELECT coalesce(sum(greatest(gross - refund - stripe, 0)), 0) FROM tx WHERE pillar = 'tables')::numeric, 2),
      'yuno_fees', round((SELECT coalesce(sum(yuno_fee), 0) FROM tx)::numeric, 2)
    ) END
  ) INTO v_result;

  -- ── Argent : SA part seulement ─────────────────────────────────────────────
  v_collector := coalesce(v_compute->>'collector_key',
                          (SELECT p.party_key FROM public.event_parties(p_pass.event_id) p WHERE p.role = 'lead' ORDER BY p.ord LIMIT 1));
  IF v_contract THEN
    SELECT * INTO v_statement FROM public.collab_transfer_statements s WHERE s.event_id = p_pass.event_id;
    SELECT t.* INTO v_transfer FROM public.event_coorg_transfers t
     WHERE t.event_id = p_pass.event_id AND coalesce(t.source, 'collab') = 'collab'
       AND (t.from_party = p_pass.guest_party OR t.to_party = p_pass.guest_party)
     ORDER BY t.created_at DESC LIMIT 1;
    v_money_obj := jsonb_build_object(
      'mode', 'contract',
      'collector', v_collector,
      'collector_name', (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = v_collector),
      'payment_terms_days', v_compute->'payment_terms_days',
      'my_share', jsonb_build_object(
        'tickets_pct', CASE WHEN p_pass.guest_party = v_compute->>'venue_key'
                            THEN 100 - public.collab_rules_org_pct(v_rules, 'tickets', e.event_mode::text)
                            ELSE public.collab_rules_org_pct(v_rules, 'tickets', e.event_mode::text) END,
        'tables_pct', CASE WHEN p_pass.guest_party = v_compute->>'venue_key'
                           THEN 100 - public.collab_rules_org_pct(v_rules, 'tables', e.event_mode::text)
                           ELSE public.collab_rules_org_pct(v_rules, 'tables', e.event_mode::text) END,
        'amount', CASE WHEN p_pass.guest_party = v_compute->>'venue_key' THEN v_compute->'venue_total' ELSE v_compute->'organizer_total' END
      ),
      'transfer', CASE
        WHEN v_transfer.id IS NOT NULL THEN jsonb_build_object(
          'direction', CASE WHEN v_transfer.to_party = p_pass.guest_party THEN 'in' ELSE 'out' END,
          'amount', v_transfer.amount, 'status', v_transfer.status, 'due_at', v_transfer.due_at,
          'reference', v_transfer.reference, 'iban_set', v_transfer.payee_iban IS NOT NULL,
          'id', CASE WHEN v_member >= 3 THEN v_transfer.id END)
        WHEN v_compute->'transfer' IS NOT NULL AND v_compute->'transfer' <> 'null'::jsonb THEN jsonb_build_object(
          'direction', CASE WHEN v_compute#>>'{transfer,to}' = p_pass.guest_party THEN 'in' ELSE 'out' END,
          'amount', v_compute#>'{transfer,amount}', 'status', 'estimate')
        END,
      'statement', jsonb_build_object('frozen', v_statement.frozen_at IS NOT NULL, 'frozen_at', v_statement.frozen_at,
                                      'status', v_statement.status)
    );
  ELSE
    v_money_obj := jsonb_build_object(
      'mode', 'external',
      'collector', v_collector,
      'collector_name', (SELECT p.display_name FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = v_collector),
      'my_share', CASE WHEN p_pass.share_tickets_pct IS NOT NULL OR p_pass.share_tables_pct IS NOT NULL THEN jsonb_build_object(
        'tickets_pct', p_pass.share_tickets_pct, 'tables_pct', p_pass.share_tables_pct,
        'amount', CASE WHEN v_money THEN round((
          coalesce((v_result#>>'{figures,net_tickets}')::numeric, 0) * coalesce(p_pass.share_tickets_pct, 0) / 100
          + coalesce((v_result#>>'{figures,net_tables}')::numeric, 0) * coalesce(p_pass.share_tables_pct, 0) / 100)::numeric, 2) END,
        'declared', true) END
    );
  END IF;
  v_money_obj := v_money_obj || jsonb_build_object(
    'response', p_pass.statement_response, 'response_reason', p_pass.statement_reason,
    'responded_at', p_pass.statement_responded_at,
    'statement_ready', v_phase = 'after');

  RETURN v_result || jsonb_build_object('money', v_money_obj);
END;
$$;
REVOKE ALL ON FUNCTION public._guest_space_payload(public.event_guest_passes) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. La lecture publique (anon) : /h/<jeton>. Compte l'ouverture.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_guest_space(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_ev    record;
  v_close timestamptz;
  v_team  boolean := false;
  v_ctx   record;
  v_count boolean := true;
  v_paul  text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT e.title, e.start_at, e.end_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  v_close := coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') + interval '7 days';
  IF v_pass.revoked_at IS NOT NULL OR now() > v_close THEN
    RETURN jsonb_build_object('found', true, 'closed', true, 'revoked', v_pass.revoked_at IS NOT NULL,
                              'language', v_pass.language, 'guest_name', v_pass.guest_name, 'event_title', v_ev.title);
  END IF;

  v_team := public._guest_pass_is_team(v_pass.event_id);
  IF NOT v_team THEN
    BEGIN
      SELECT * INTO v_ctx FROM public.links_visitor_context();
      IF EXISTS (SELECT 1 FROM public.event_guest_pass_opens o
                  WHERE o.pass_id = v_pass.id AND o.action = 'open' AND o.visitor_hash = v_ctx.o_hash
                    AND o.created_at > now() - interval '30 minutes')
         OR (SELECT count(*) FROM public.event_guest_pass_opens o
              WHERE o.visitor_hash = v_ctx.o_hash AND o.created_at > now() - interval '1 hour') >= 60 THEN
        v_count := false;
      END IF;
      IF v_count THEN
        INSERT INTO public.event_guest_pass_opens (pass_id, visitor_hash, action) VALUES (v_pass.id, v_ctx.o_hash, 'open');
        UPDATE public.event_guest_passes
           SET opened_count = opened_count + 1, first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now()
         WHERE id = v_pass.id
         RETURNING * INTO v_pass;
        IF v_pass.opened_count = 1 THEN
          PERFORM public._guest_pass_alert(v_pass, 'open', 'host_pass_open:' || v_pass.id::text);
        ELSIF v_pass.opened_count = 5 THEN
          PERFORM public._guest_pass_alert(v_pass, 'hot', 'host_pass_hot:' || v_pass.id::text);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_event_guest_space count: %', SQLERRM;
    END;
  END IF;

  SELECT nullif(regexp_replace(coalesce(c.config->>'whatsapp_number', ''), '\D', '', 'g'), '')
    INTO v_paul FROM public.links_page_config c WHERE c.id = 'default';

  RETURN jsonb_build_object(
    'found', true, 'closed', false, 'revoked', false,
    'guest', jsonb_build_object(
      'kind', v_pass.guest_kind, 'name', v_pass.guest_name, 'contact_email', v_pass.contact_email,
      'party', v_pass.guest_party, 'claim_status', v_pass.claim_status,
      'party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                       LEFT JOIN public.venues v ON 'venue:' || v.id = v_pass.guest_party
                       LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = v_pass.guest_party),
      'places_requested', v_pass.places_requested),
    'language', v_pass.language,
    'show_revenue', v_pass.show_revenue,
    'closes_at', v_close,
    'paul_whatsapp', v_paul,
    'is_team', v_team,
    'is_demo', v_pass.event_id = ANY (public.demo_event_ids()),
    'door_staff', CASE WHEN v_pass.guest_kind = 'venue' THEN '[]'::jsonb END
  ) || public._guest_space_payload(v_pass);
END;
$$;
REVOKE ALL ON FUNCTION public.get_event_guest_space(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_guest_space(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Les gestes de l'invité par son lien.
-- ---------------------------------------------------------------------------
-- Ajouter ses invités dans SA part (et ses accompagnants, une place chacun).
CREATE OR REPLACE FUNCTION public.guest_pass_add_guest(p_token text, p_name text, p_plus integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_gl    public.guest_lists%ROWTYPE;
  v_name  text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  v_plus  integer := greatest(least(coalesce(p_plus, 0), 9), 0);
  v_taken integer;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF char_length(v_name) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  SELECT * INTO v_gl FROM public.guest_lists WHERE guest_pass_id = v_pass.id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_gl.quota, 0) <= 0 THEN RAISE EXCEPTION 'no_guest_list_part'; END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_pass.event_id
              AND (e.cancelled_at IS NOT NULL OR coalesce(e.end_at, e.start_at + interval '8 hours') < now())) THEN
    RAISE EXCEPTION 'event_closed';
  END IF;
  SELECT count(*) INTO v_taken FROM public.guest_list_entries g WHERE g.guest_list_id = v_gl.id AND g.status <> 'cancelled';
  IF v_taken + 1 + v_plus > v_gl.quota THEN RAISE EXCEPTION 'guest_list_full'; END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'guest') THEN RAISE EXCEPTION 'too_many_actions'; END IF;

  FOR i IN 0..v_plus LOOP
    v_code := 'YN-';
    FOR j IN 1..6 LOOP v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1); END LOOP;
    INSERT INTO public.guest_list_entries (guest_list_id, full_name, email, phone, qr_code, reservation_code,
                                           status, entry_type, entry_deadline, attribution_source)
    VALUES (v_gl.id, CASE WHEN i = 0 THEN v_name ELSE v_name || ' +' || i END, '', '',
            'GL-' || gen_random_uuid()::text, v_code, 'reserved', coalesce(v_gl.entry_kind, 'normal'),
            v_gl.entry_deadline, 'partner');
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'added', 1 + v_plus);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_add_guest(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_add_guest(text, text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_pass_remove_guest(p_token text, p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_n    integer;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  UPDATE public.guest_list_entries g SET status = 'cancelled'
   WHERE g.id = p_entry_id AND NOT coalesce(g.entry_scanned, false) AND g.status <> 'cancelled'
     AND g.guest_list_id = (SELECT gl.id FROM public.guest_lists gl WHERE gl.guest_pass_id = v_pass.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_remove_guest(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_remove_guest(text, uuid) TO anon, authenticated;

-- Demander des places à l'organisateur (une demande vivante à la fois).
CREATE OR REPLACE FUNCTION public.guest_pass_request_places(p_token text, p_places integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_title text;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF p_places IS NULL OR p_places < 1 OR p_places > 200 THEN RAISE EXCEPTION 'invalid_places'; END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'places', interval '10 minutes') THEN RAISE EXCEPTION 'too_many_actions'; END IF;
  UPDATE public.event_guest_passes SET places_requested = p_places, places_requested_at = now() WHERE id = v_pass.id;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = v_pass.event_id;
  PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'guest_pass_places',
    'Demande de places de guest list',
    v_pass.guest_name || ' demande ' || p_places || ' places de plus sur sa part de guest list pour « ' || coalesce(v_title, 'la soirée') || ' ».',
    v_pass.id, 'guest_pass_places:' || v_pass.id::text || ':' || to_char(now(), 'YYYYMMDDHH24'), '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_request_places(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_request_places(text, integer) TO anon, authenticated;

-- Créer un lien de vente à son nom (8 au plus).
CREATE OR REPLACE FUNCTION public.guest_pass_create_link(p_token text, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_id   uuid;
  v_code text;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF (SELECT count(*) FROM public.tracked_links tl WHERE tl.guest_pass_id = v_pass.id) >= 8 THEN
    RAISE EXCEPTION 'too_many_links';
  END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'link') THEN RAISE EXCEPTION 'too_many_actions'; END IF;
  v_id := public._guest_pass_add_link(v_pass, coalesce(p_channel, 'other'), NULL);
  SELECT code INTO v_code FROM public.tracked_links WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_create_link(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_create_link(text, text) TO anon, authenticated;

-- Valider ou contester le décompte : un avis, transmis à l'organisateur.
CREATE OR REPLACE FUNCTION public.guest_pass_statement_response(p_token text, p_response text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_guest_passes%ROWTYPE;
  v_title text;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF p_response NOT IN ('approved', 'contested') THEN RAISE EXCEPTION 'invalid_response'; END IF;
  IF p_response = 'contested' AND v_reason IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_pass.event_id
                  AND now() >= coalesce(e.end_at, e.start_at + interval '8 hours')) THEN
    RAISE EXCEPTION 'statement_not_ready';
  END IF;
  IF NOT public._guest_pass_note(v_pass.id, 'statement', interval '1 minute') THEN RAISE EXCEPTION 'too_many_actions'; END IF;
  UPDATE public.event_guest_passes
     SET statement_response = p_response, statement_reason = v_reason, statement_responded_at = now()
   WHERE id = v_pass.id;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = v_pass.event_id;
  PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'guest_pass_statement',
    CASE p_response WHEN 'approved' THEN 'Décompte validé par ton invité' ELSE 'Décompte contesté par ton invité' END,
    v_pass.guest_name || CASE p_response WHEN 'approved' THEN ' a validé le décompte de « '
                                         ELSE ' conteste le décompte de « ' END
      || coalesce(v_title, 'la soirée') || ' »' || coalesce(' : ' || v_reason, '') || '.',
    v_pass.id, 'guest_pass_statement:' || v_pass.id::text || ':' || p_response || ':' || to_char(now(), 'YYYYMMDDHH24MI'), '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_statement_response(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_pass_statement_response(text, text, text) TO anon, authenticated;

-- Les gestes de mesure (bouton d'inscription, WhatsApp, copie, partage).
CREATE OR REPLACE FUNCTION public.track_event_guest_pass(p_token text, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  IF p_action NOT IN ('signup', 'whatsapp', 'copy', 'share') THEN RETURN; END IF;
  v_pass := public._guest_pass_live(p_token);
  IF public._guest_pass_is_team(v_pass.event_id) THEN RETURN; END IF;
  IF NOT public._guest_pass_note(v_pass.id, p_action, interval '10 minutes') THEN RETURN; END IF;
  UPDATE public.event_guest_passes SET
    signup_clicks   = signup_clicks + CASE WHEN p_action = 'signup' THEN 1 ELSE 0 END,
    whatsapp_clicks = whatsapp_clicks + CASE WHEN p_action = 'whatsapp' THEN 1 ELSE 0 END,
    link_copies     = link_copies + CASE WHEN p_action IN ('copy', 'share') THEN 1 ELSE 0 END
  WHERE id = v_pass.id
  RETURNING * INTO v_pass;
  IF p_action = 'signup' THEN
    PERFORM public._guest_pass_alert(v_pass, 'signup', 'host_pass_signup:' || v_pass.id::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.track_event_guest_pass(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event_guest_pass(text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. L'invité ouvre son compte : il devient Partenaire de la soirée.
--    Adresse du compte = adresse de l'invitation → co-hôte `viewer` accepté
--    d'office. Sinon l'organisateur est prévenu et l'invite lui-même.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_event_guest_pass(p_token text, p_party text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_pass   public.event_guest_passes%ROWTYPE;
  v_ev     record;
  v_party  text;
  v_pname  text;
  v_email  text;
  v_cohost uuid;
  v_status text;
  v_venue  text;
  v_org    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR v_pass.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  -- La partie de l'appelant, du bon type : son club, ou son organisation.
  IF v_pass.guest_kind = 'venue' THEN
    SELECT v.id, v.name INTO v_venue, v_pname FROM public.venues v
     WHERE v.owner_id = v_uid AND v.decommissioned_at IS NULL
       AND (p_party IS NULL OR 'venue:' || v.id = p_party)
     ORDER BY v.created_at LIMIT 1;
    IF v_venue IS NULL THEN RAISE EXCEPTION 'no_venue'; END IF;
    v_party := 'venue:' || v_venue;
  ELSE
    SELECT op.user_id, op.display_name INTO v_org, v_pname FROM public.organizer_profiles op
     WHERE (op.user_id = v_uid OR public.is_org_team_member(v_uid, op.user_id, 'admin'))
       AND (p_party IS NULL OR 'org:' || op.user_id = p_party)
     ORDER BY (op.user_id = v_uid) DESC LIMIT 1;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
    v_party := 'org:' || v_org;
  END IF;

  IF (v_pass.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM
     public.coorg_party_is_demo(split_part(v_party, ':', 1), v_venue, v_org) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF v_pass.guest_party IS NOT NULL AND v_pass.guest_party <> v_party THEN RAISE EXCEPTION 'already_claimed'; END IF;
  IF v_party = v_pass.created_by_party THEN RAISE EXCEPTION 'already_party'; END IF;

  SELECT e.end_at, e.start_at, e.cancelled_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  IF EXISTS (SELECT 1 FROM public.event_parties(v_pass.event_id) p WHERE p.party_key = v_party) THEN
    v_status := 'accepted';
  ELSIF v_ev.cancelled_at IS NOT NULL OR coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') < now() THEN
    v_status := 'recorded';
  ELSIF v_pass.contact_email IS NOT NULL AND v_pass.contact_email = v_email
        AND (SELECT count(*) FROM public.event_cohosts c
              WHERE c.event_id = v_pass.event_id AND c.status IN ('pending', 'accepted')) < 8 THEN
    SELECT c.id INTO v_cohost FROM public.event_cohosts c
     WHERE c.event_id = v_pass.event_id AND c.status = 'pending'
       AND (c.venue_id = v_venue OR c.organizer_user_id = v_org) LIMIT 1;
    IF v_cohost IS NULL THEN
      INSERT INTO public.event_cohosts (event_id, venue_id, organizer_user_id, access, share_crm, invited_by, invited_by_party, role)
      VALUES (v_pass.event_id, v_venue, v_org, 'viewer', false, v_pass.created_by, v_pass.created_by_party, 'cohost')
      RETURNING id INTO v_cohost;
    END IF;
    PERFORM public.respond_event_cohost_invitation(v_cohost, true);
    v_status := 'accepted';
  ELSE
    v_status := 'pending';
    PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'host_pass_claimed',
      'Un invité a ouvert son compte',
      v_pname || ' a ouvert son compte Yuno depuis son espace « ' || v_pass.guest_name
        || ' ». Ajoute-le en partenaire de la soirée depuis la page Co-organisation.',
      v_pass.id, 'host_pass_claimed:' || v_pass.id::text, '{}'::jsonb);
  END IF;

  UPDATE public.event_guest_passes
     SET guest_party = v_party, claimed_by = v_uid, claimed_at = coalesce(claimed_at, now()), claim_status = v_status
   WHERE id = v_pass.id
   RETURNING * INTO v_pass;
  PERFORM public._guest_pass_alert(v_pass, 'claimed', 'host_pass_claimed:' || v_pass.id::text);

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'event_id', v_pass.event_id, 'party', v_party);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_event_guest_pass(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_event_guest_pass(text, text) TO authenticated;
