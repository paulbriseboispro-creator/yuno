-- Mode Live — RPC unique « suis-je en soirée ? ».
--
-- SECURITY DEFINER délibéré : la réponse croise 7 tables (tickets,
-- table_reservations, guest_lists/guest_list_entries, events, venues,
-- client_scores, venue_customers) + auth.users pour le fallback email des
-- guest lists. Passer par les RLS clientes exposerait le résultat aux
-- « silent noop » RLS déjà rencontrés sur ce projet ; ici la logique d'accès
-- est explicite : un utilisateur ne voit QUE sa propre session (auth.uid()).
--
-- Retour :
--   state = 'live'          → scanné à l'entrée d'un événement dans sa fenêtre
--   state = 'pending_scan'  → possède une entrée non scannée pour un événement
--                             dans sa fenêtre (le client doit s'abonner au realtime)
--   (aucune ligne)          → rien ce soir
--
-- Fenêtre : start_at − 2h → end_at + 2h (miroir de use-drink-credit et du
-- token de retrait bar). Garde-fou anti-staleness : scan < 24 h.
-- Priorité si plusieurs hits : table > ticket > guest_list.

CREATE OR REPLACE FUNCTION public.get_live_session()
RETURNS TABLE (
  state text,
  source text,
  event_id uuid,
  event_title text,
  event_start_at timestamptz,
  event_end_at timestamptz,
  venue_id text,
  venue_name text,
  entry_scanned_at timestamptz,
  table_reservation_id uuid,
  menu_enabled boolean,
  live_mode_enabled boolean,
  solo_bottle_sale_enabled boolean,
  client_rank integer,
  client_tier text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  -- 1) Session live : une entrée scannée dans la fenêtre de l'événement.
  RETURN QUERY
  WITH hits AS (
    SELECT 'table'::text AS src, tr.event_id AS ev_id, tr.entry_scanned_at AS scanned_at,
           tr.id AS res_id, 1 AS prio
    FROM public.table_reservations tr
    WHERE tr.user_id = v_uid
      AND tr.entry_scanned
      AND tr.status IN ('paid', 'confirmed')
      AND tr.entry_scanned_at > now() - interval '24 hours'
    UNION ALL
    SELECT 'ticket', t.event_id, t.entry_scanned_at, NULL::uuid, 2
    FROM public.tickets t
    WHERE t.user_id = v_uid
      AND t.entry_scanned
      AND t.status = 'paid'
      AND t.entry_scanned_at > now() - interval '24 hours'
    UNION ALL
    SELECT 'guest_list', gl.event_id, gle.entry_scanned_at, NULL::uuid, 3
    FROM public.guest_list_entries gle
    JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
    WHERE gle.entry_scanned
      AND gle.status <> 'cancelled'
      AND gle.entry_scanned_at > now() - interval '24 hours'
      AND (
        gle.user_id = v_uid
        OR (gle.user_id IS NULL AND v_email IS NOT NULL AND lower(gle.email) = v_email)
      )
  )
  SELECT
    'live'::text,
    h.src,
    e.id,
    e.title,
    e.start_at,
    e.end_at,
    v.id,
    v.name,
    h.scanned_at,
    h.res_id,
    COALESCE(v.menu_enabled, false),
    v.live_mode_enabled,
    v.solo_bottle_sale_enabled,
    cs.rank,
    CASE
      WHEN vc.total_spent >= 1000 THEN 'platinum'
      WHEN vc.total_spent >= 500 THEN 'gold'
      WHEN vc.total_spent >= 200 THEN 'silver'
      WHEN vc.total_spent IS NOT NULL THEN 'bronze'
    END
  FROM hits h
  JOIN public.events e ON e.id = h.ev_id
  JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN public.client_scores cs ON cs.venue_id = v.id AND cs.user_id = v_uid
  LEFT JOIN public.venue_customers vc ON vc.venue_id = v.id AND vc.user_id = v_uid
  WHERE v.live_mode_enabled
    AND now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
  ORDER BY h.prio, h.scanned_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- 2) Pending : une entrée NON scannée pour un événement dans sa fenêtre
  --    (le provider client sait alors qu'il doit écouter le realtime).
  RETURN QUERY
  WITH pend AS (
    SELECT 'table'::text AS src, tr.event_id AS ev_id, tr.id AS res_id, 1 AS prio
    FROM public.table_reservations tr
    WHERE tr.user_id = v_uid
      AND NOT tr.entry_scanned
      AND tr.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'ticket', t.event_id, NULL::uuid, 2
    FROM public.tickets t
    WHERE t.user_id = v_uid
      AND NOT t.entry_scanned
      AND t.status = 'paid'
    UNION ALL
    SELECT 'guest_list', gl.event_id, NULL::uuid, 3
    FROM public.guest_list_entries gle
    JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
    WHERE NOT gle.entry_scanned
      AND gle.status <> 'cancelled'
      AND (
        gle.user_id = v_uid
        OR (gle.user_id IS NULL AND v_email IS NOT NULL AND lower(gle.email) = v_email)
      )
  )
  SELECT
    'pending_scan'::text,
    p.src,
    e.id,
    e.title,
    e.start_at,
    e.end_at,
    v.id,
    v.name,
    NULL::timestamptz,
    p.res_id,
    COALESCE(v.menu_enabled, false),
    v.live_mode_enabled,
    v.solo_bottle_sale_enabled,
    NULL::integer,
    NULL::text
  FROM pend p
  JOIN public.events e ON e.id = p.ev_id
  JOIN public.venues v ON v.id = e.venue_id
  WHERE v.live_mode_enabled
    AND now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
  ORDER BY p.prio, e.start_at
  LIMIT 1;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.get_live_session() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_live_session() TO authenticated;

-- Index partiels de support : les prédicats du RPC et des canaux realtime
-- filtrent sur (user_id, entry_scanned). Les tables tickets/réservations sont
-- volumineuses ; le WHERE partiel garde l'index minuscule (lignes scannées
-- des dernières heures utiles).
CREATE INDEX IF NOT EXISTS idx_tickets_user_entry_scanned
  ON public.tickets (user_id, entry_scanned_at)
  WHERE entry_scanned;

CREATE INDEX IF NOT EXISTS idx_table_reservations_user_entry_scanned
  ON public.table_reservations (user_id, entry_scanned_at)
  WHERE entry_scanned;

CREATE INDEX IF NOT EXISTS idx_guest_list_entries_user_id
  ON public.guest_list_entries (user_id);

CREATE INDEX IF NOT EXISTS idx_guest_list_entries_email_lower
  ON public.guest_list_entries (lower(email));
