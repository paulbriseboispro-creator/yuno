-- ════════════════════════════════════════════════════════════════════════════
-- Porte — UN compteur d'entrées (2026-09-29)
--
-- Le compteur du videur et le panneau « Ce soir » comptaient différemment :
--   • videur : billets seulement (la guest list n'entrait en compte que s'il
--     n'y avait AUCUN billet), la quantité entière d'un billet de groupe dès
--     le premier nominatif scanné, lignes plafonnées par PostgREST (~1 000) ;
--   • panneau : nominatifs + quantité ENTIÈRE du billet parent (un billet de 4
--     avec une personne entrée comptait 5), une table = 1 personne.
-- Désormais une seule définition, en PERSONNES, calculée en base :
--   nominatifs scannés (billets nominatifs) + quantité des billets sans
--   nominatifs scannés + convives des tables entrées + invités guest list
--   entrés ; attendus = billets payés + convives des tables payées + invités
--   non annulés.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._door_headcount(p_event_ids uuid[], p_since timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT tk.id, tk.quantity, tk.entry_scanned, tk.entry_scanned_at,
           EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = tk.id) AS nominative
      FROM public.tickets tk
     WHERE tk.event_id = ANY(p_event_ids) AND tk.status = 'paid'
  ), gle AS (
    SELECT g.entry_scanned, g.entry_scanned_at
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = ANY(p_event_ids) AND g.status IS DISTINCT FROM 'cancelled'
  ), tr AS (
    SELECT GREATEST(COALESCE(r.guest_count, 1), 1) AS guests, r.entry_scanned, r.entry_scanned_at
      FROM public.table_reservations r
     WHERE r.event_id = ANY(p_event_ids) AND r.status = 'paid'
  )
  SELECT jsonb_build_object(
    'entered',
      (SELECT count(*) FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id
        WHERE a.entry_scanned AND (p_since IS NULL OR a.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(t.quantity), 0) FROM t
        WHERE NOT t.nominative AND t.entry_scanned AND (p_since IS NULL OR t.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr
        WHERE tr.entry_scanned AND (p_since IS NULL OR tr.entry_scanned_at >= p_since))
    + (SELECT count(*) FROM gle
        WHERE gle.entry_scanned AND (p_since IS NULL OR gle.entry_scanned_at >= p_since)),
    'expected',
      (SELECT COALESCE(sum(t.quantity), 0) FROM t)
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr)
    + (SELECT count(*) FROM gle)
  )
$function$;

REVOKE ALL ON FUNCTION public._door_headcount(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;

-- Le compteur du videur : mêmes chiffres, bornés aux soirées que l'appelant
-- tient réellement (club, co-soirée, organisateur, équipe, co-hôte).
CREATE OR REPLACE FUNCTION public.get_door_counters(p_event_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(e.id), '{}') INTO v_ids
    FROM public.events e
   WHERE e.id = ANY(COALESCE(p_event_ids, '{}'))
     AND (
       (e.venue_id IS NOT NULL AND public.is_night_staff_of_venue(e.venue_id))
       OR (e.partner_venue_id IS NOT NULL AND public.is_night_staff_of_venue(e.partner_venue_id))
       OR e.organizer_user_id = v_uid OR e.partner_organizer_id = v_uid
       OR public.is_event_door_staff(v_uid, e.id)
       OR public.is_event_partner_venue_staff(v_uid, e.id)
     );
  RETURN public._door_headcount(v_ids, NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_door_counters(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_door_counters(uuid[]) TO authenticated;

-- Panneau « Ce soir » : même définition des entrées.
CREATE OR REPLACE FUNCTION public.get_staff_night_pulse(p_venue_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_venue       text;
  v_night_start timestamptz;
  v_night       date;
  v_event_ids   uuid[];
  v_result      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_venue := COALESCE(p_venue_id, public.get_user_venue_id(v_uid));
  IF v_venue IS NULL OR NOT public.is_night_staff_of_venue(v_venue) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- « Cette nuit » démarre à 6h du matin, heure de Paris — même convention que
  -- get_staff_self_stats (20260718110000).
  v_night_start := (
    date_trunc('day', (now() AT TIME ZONE 'Europe/Paris') - interval '6 hours')
    + interval '6 hours'
  ) AT TIME ZONE 'Europe/Paris';
  v_night := public.paris_night_date();

  -- Les événements de la nuit : lead OU co-soirée dont ce club tient la porte.
  SELECT COALESCE(array_agg(e.id), '{}')
    INTO v_event_ids
    FROM public.events e
   WHERE (e.venue_id = v_venue OR e.partner_venue_id = v_venue)
     AND e.start_at < v_night_start + interval '24 hours'
     AND e.end_at   > v_night_start
     AND COALESCE(e.status, '') <> 'cancelled';

  SELECT jsonb_build_object(
    'venue_id', v_venue,
    'night_date', v_night,
    'night_start', v_night_start,

    -- L'événement « principal » : celui en cours, sinon le prochain de la nuit.
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title,
        'start_at', e.start_at, 'end_at', e.end_at
      )
      FROM public.events e
      WHERE e.id = ANY(v_event_ids)
      ORDER BY (now() BETWEEN e.start_at AND e.end_at) DESC, e.start_at ASC
      LIMIT 1
    ),

    -- ── Les attendus (connus avant l'ouverture) ──────────────────────────────
    'expected', jsonb_build_object(
      'tickets_sold', (
        SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t
         WHERE t.event_id = ANY(v_event_ids) AND t.status = 'paid'
      ),
      'guest_list', (
        SELECT count(*) FROM public.guest_list_entries gle
         WHERE gle.guest_list_id IN (
           SELECT gl.id FROM public.guest_lists gl WHERE gl.event_id = ANY(v_event_ids)
         )
      ),
      'vip_tables', (
        SELECT count(*) FROM public.table_reservations tr
         WHERE tr.event_id = ANY(v_event_ids) AND tr.status = 'paid'
      ),
      'capacity', (
        SELECT b.capacity FROM public.venue_hype_baseline b WHERE b.venue_id = v_venue
      )
    ),

    -- ── Le direct ────────────────────────────────────────────────────────────
    'live', jsonb_build_object(
      -- Entrées = PERSONNES, une seule définition (_door_headcount) partagée
      -- avec le compteur du videur : les deux écrans ne se contredisent plus.
      'entries', (public._door_headcount(v_event_ids, v_night_start)->>'entered')::int,
      'entries_last10', (public._door_headcount(v_event_ids, now() - interval '10 minutes')->>'entered')::int,
      'gl_scanned', (
        SELECT count(*) FROM public.guest_list_entries gle
         WHERE gle.guest_list_id IN (
           SELECT gl.id FROM public.guest_lists gl WHERE gl.event_id = ANY(v_event_ids)
         ) AND gle.entry_scanned = true
      ),
      'vip_arrived', (
        SELECT count(*) FROM public.table_reservations tr
         WHERE tr.event_id = ANY(v_event_ids) AND tr.status = 'paid'
           AND tr.checked_in_at IS NOT NULL
      ),
      'bar_backlog', (
        SELECT count(*) FROM public.orders o
         WHERE o.venue_id = v_venue AND o.status = 'paid'
           AND COALESCE(o.prep_requested, false)
           AND o.prep_status IN ('queue', 'preparing')
      ),
      'bar_oldest_min', (
        SELECT floor(extract(epoch FROM now() - min(o.created_at)) / 60)::int
          FROM public.orders o
         WHERE o.venue_id = v_venue AND o.status = 'paid'
           AND COALESCE(o.prep_requested, false)
           AND o.prep_status IN ('queue', 'preparing')
      ),
      'bar_ready', (
        SELECT count(*) FROM public.orders o
         WHERE o.venue_id = v_venue AND o.status = 'paid'
           AND o.prep_status = 'ready'
      ),
      'bar_served_tonight', (
        SELECT count(*) FROM public.orders o
         WHERE o.venue_id = v_venue AND o.served_at >= v_night_start
           AND o.status <> 'refunded'
      ),
      'out_of_stock', COALESCE((
        SELECT jsonb_agg(d.name ORDER BY d.name)
          FROM public.drinks d
         WHERE d.venue_id = v_venue AND d.out_of_stock = true
           AND COALESCE(d.active, true)
      ), '[]'::jsonb),
      'cloak_active', (
        SELECT count(*) FROM public.cloakroom_transactions ct
         WHERE ct.venue_id = v_venue AND ct.created_at >= v_night_start
           AND COALESCE(ct.retrieved, false) = false
      ),
      'cloak_retrieved', (
        SELECT count(*) FROM public.cloakroom_transactions ct
         WHERE ct.venue_id = v_venue AND ct.created_at >= v_night_start
           AND ct.retrieved = true
      ),
      'incidents', (
        SELECT count(*) FROM public.night_ops_events ne
         WHERE ne.venue_id = v_venue AND ne.created_at >= v_night_start
           AND ne.kind LIKE 'incident%'
      )
    ),

    -- ── L'équipe de la nuit (prises et fins de poste) ────────────────────────
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.reported_by,
        'name', COALESCE(NULLIF(p.staff_display_name, ''), NULLIF(p.first_name, ''), split_part(p.email, '@', 1)),
        'title', p.staff_title,
        'avatar_url', COALESCE(NULLIF(p.staff_avatar_url, ''), p.avatar_url),
        'role', s.role_note,
        'started_at', s.started_at,
        'ended_at', s.ended_at
      ) ORDER BY s.started_at)
      FROM (
        SELECT ne.reported_by,
               min(ne.created_at) FILTER (WHERE ne.kind = 'shift_start') AS started_at,
               max(ne.created_at) FILTER (WHERE ne.kind = 'shift_end')   AS ended_at,
               (array_agg(ne.note) FILTER (WHERE ne.kind = 'shift_start'))[1] AS role_note
          FROM public.night_ops_events ne
         WHERE ne.venue_id = v_venue AND ne.created_at >= v_night_start
           AND ne.kind IN ('shift_start', 'shift_end')
         GROUP BY ne.reported_by
      ) s
      JOIN public.profiles p ON p.id = s.reported_by
    ), '[]'::jsonb),

    -- ── La consigne du soir + accusés de lecture ─────────────────────────────
    'brief', (
      SELECT jsonb_build_object(
        'id', b.id,
        'body', b.body,
        'updated_at', b.updated_at,
        'read_by_me', EXISTS (
          SELECT 1 FROM public.staff_brief_reads r
           WHERE r.brief_id = b.id AND r.user_id = v_uid
        ),
        'readers', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'user_id', r.user_id,
            'name', COALESCE(NULLIF(rp.staff_display_name, ''), NULLIF(rp.first_name, ''), split_part(rp.email, '@', 1)),
            'read_at', r.read_at
          ) ORDER BY r.read_at)
          FROM public.staff_brief_reads r
          JOIN public.profiles rp ON rp.id = r.user_id
          WHERE r.brief_id = b.id
        ), '[]'::jsonb)
      )
      FROM public.staff_briefs b
      WHERE b.venue_id = v_venue AND b.night_date = v_night
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
