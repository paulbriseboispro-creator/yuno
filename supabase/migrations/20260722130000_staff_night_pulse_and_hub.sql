-- ============================================================================
-- Le pouls de la nuit + le hub équipe owner
-- ============================================================================
-- Toutes les données de la soirée existaient déjà (useLiveNightData les agrège
-- pour /owner/live) mais le staff n'en voyait AUCUNE : le videur avait un seul
-- chiffre, « scannés ce soir ». Or la RLS interdit à un videur de lire orders,
-- à un barman de lire tickets — impossible d'agréger côté client.
--
-- Quatre briques, toutes SECURITY DEFINER :
--
--   • get_staff_night_pulse(p_venue_id) — UNE passe qui rend l'état de la nuit
--     entière : événement du soir + attendus (préventes, guest list, tables),
--     le direct (entrées, file du bar, vestiaire, incidents), l'équipe en
--     poste (shift_start sans shift_end), la consigne du soir et les bravos.
--     Chaque écran staff n'affiche que les tuiles de SON poste ; l'owner s'en
--     sert aussi pour le hub équipe.
--
--   • get_venue_staff_activity(p_venue_id, p_days) — l'activité par membre
--     (nuits, actions par domaine, dernière action) pour l'onglet Activité du
--     hub owner. Trombinoscope de travail, pas un classement : trié par
--     ancienneté, jamais par volume.
--
--   • owner_set_staff_title — l'intitulé de poste est décidé par le club, pas
--     par la personne (« Responsable porte », « Chef de rang »). Sans intitulé,
--     les écrans retombent sur le libellé du rôle.
--
--   • profiles.staff_onboarded_at — le flag du nouvel onboarding staff. En
--     localStorage il était par APPAREIL : sur la tablette partagée de la
--     porte, le deuxième videur ne voyait jamais l'intro. Les comptes staff
--     existants sont backfillés (pas de wizard surprise en plein service).
-- ============================================================================


-- ── 1. Flag d'onboarding par personne ────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_onboarded_at timestamptz;

UPDATE public.profiles p
   SET staff_onboarded_at = now()
 WHERE p.staff_onboarded_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
   );


-- ── 2. L'intitulé de poste appartient au club ────────────────────────────────

CREATE OR REPLACE FUNCTION public.owner_set_staff_title(p_user_id uuid, p_title text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_venue text;
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT p.venue_id INTO v_venue FROM public.profiles p WHERE p.id = p_user_id;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'not staff of a venue' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.is_venue_owner(v_uid, v_venue)
    OR public.manager_has_permission(v_uid, v_venue, 'staff')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_title IS NOT NULL AND char_length(v_title) > 40 THEN
    RAISE EXCEPTION 'title too long' USING ERRCODE = '22001';
  END IF;

  UPDATE public.profiles SET staff_title = v_title WHERE id = p_user_id;

  RETURN jsonb_build_object('user_id', p_user_id, 'title', v_title);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_staff_title(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_staff_title(uuid, text) TO authenticated;


-- ── 3. Le pouls de la nuit ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_staff_night_pulse(p_venue_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
      -- Entrées ≈ personnes : billets nominatifs à l'unité, billets legacy en
      -- quantité, une ligne par table scannée et par invité guest list.
      'entries', (
        (SELECT count(*) FROM public.ticket_attendees ta
           JOIN public.tickets t ON t.id = ta.ticket_id
          WHERE t.event_id = ANY(v_event_ids) AND ta.entry_scanned_at >= v_night_start)
      + (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t
          WHERE t.event_id = ANY(v_event_ids)
            AND t.entry_scanned = true AND t.entry_scanned_at >= v_night_start)
      + (SELECT count(*) FROM public.table_reservations tr
          WHERE tr.event_id = ANY(v_event_ids) AND tr.entry_scanned_at >= v_night_start)
      + (SELECT count(*) FROM public.guest_list_entries gle
          WHERE gle.guest_list_id IN (
            SELECT gl.id FROM public.guest_lists gl WHERE gl.event_id = ANY(v_event_ids)
          ) AND gle.entry_scanned_at >= v_night_start)
      ),
      'entries_last10', (
        (SELECT count(*) FROM public.ticket_attendees ta
           JOIN public.tickets t ON t.id = ta.ticket_id
          WHERE t.event_id = ANY(v_event_ids) AND ta.entry_scanned_at >= now() - interval '10 minutes')
      + (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t
          WHERE t.event_id = ANY(v_event_ids)
            AND t.entry_scanned = true AND t.entry_scanned_at >= now() - interval '10 minutes')
      + (SELECT count(*) FROM public.table_reservations tr
          WHERE tr.event_id = ANY(v_event_ids) AND tr.entry_scanned_at >= now() - interval '10 minutes')
      + (SELECT count(*) FROM public.guest_list_entries gle
          WHERE gle.guest_list_id IN (
            SELECT gl.id FROM public.guest_lists gl WHERE gl.event_id = ANY(v_event_ids)
          ) AND gle.entry_scanned_at >= now() - interval '10 minutes')
      ),
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
    ),

    -- ── Les bravos de la nuit ────────────────────────────────────────────────
    'kudos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', k.id,
        'from_name', COALESCE(NULLIF(pf.staff_display_name, ''), NULLIF(pf.first_name, ''), split_part(pf.email, '@', 1)),
        'to_user', k.to_user,
        'to_name', COALESCE(NULLIF(pt.staff_display_name, ''), NULLIF(pt.first_name, ''), split_part(pt.email, '@', 1)),
        'body', k.body,
        'created_at', k.created_at
      ) ORDER BY k.created_at DESC)
      FROM public.staff_kudos k
      LEFT JOIN public.profiles pf ON pf.id = k.from_user
      LEFT JOIN public.profiles pt ON pt.id = k.to_user
      WHERE k.venue_id = v_venue AND k.night_date = v_night
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_night_pulse(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_night_pulse(text) TO authenticated;


-- ── 4. L'activité de l'équipe (hub owner) ────────────────────────────────────
-- Mêmes sources d'attribution que get_staff_self_stats, agrégées par membre.
-- Trié par ancienneté (staff_since) : un relevé de travail, pas un podium.

CREATE OR REPLACE FUNCTION public.get_venue_staff_activity(
  p_venue_id text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_venue text;
  v_since timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_venue := COALESCE(p_venue_id, public.get_user_venue_id(v_uid));
  IF v_venue IS NULL OR NOT (
    public.is_venue_owner(v_uid, v_venue)
    OR public.manager_has_permission(v_uid, v_venue, 'staff')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_since := now() - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 365) || ' days')::interval;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', m.id,
      'name', COALESCE(NULLIF(m.staff_display_name, ''), NULLIF(m.first_name, ''), split_part(m.email, '@', 1)),
      'title', m.staff_title,
      'avatar_url', COALESCE(NULLIF(m.staff_avatar_url, ''), m.avatar_url),
      'staff_since', m.staff_since,
      'roles', (
        SELECT COALESCE(array_agg(ur.role::text ORDER BY ur.role::text), '{}')
          FROM public.user_roles ur
         WHERE ur.user_id = m.id
           AND ur.role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
      ),
      'scans', (
        (SELECT count(*) FROM public.ticket_attendees ta
          WHERE ta.entry_scanned_by = m.id AND ta.entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.tickets t
          WHERE t.entry_scanned_by = m.id AND t.entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.table_reservations tr
          WHERE tr.entry_scanned_by = m.id AND tr.entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.guest_list_entries gle
          WHERE gle.entry_scanned_by = m.id AND gle.entry_scanned_at >= v_since)
      ),
      'orders', (
        SELECT count(*) FROM public.orders o
         WHERE COALESCE(o.served_by, o.prep_claimed_by) = m.id
           AND o.served_at >= v_since AND o.status <> 'refunded'
      ),
      'cloakroom', (
        SELECT count(*) FROM public.cloakroom_transactions ct
         WHERE ct.staff_id = m.id AND ct.created_at >= v_since
      ),
      'vip_items', (
        SELECT count(*) FROM public.vip_consumptions vc
         WHERE COALESCE(vc.served_by, vc.staff_id) = m.id AND vc.created_at >= v_since
      ),
      'nights_worked', (
        SELECT count(DISTINCT d) FROM (
          SELECT date_trunc('day', (ta.entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours') AS d
            FROM public.ticket_attendees ta
           WHERE ta.entry_scanned_by = m.id AND ta.entry_scanned_at >= v_since
          UNION
          SELECT date_trunc('day', (t.entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
            FROM public.tickets t
           WHERE t.entry_scanned_by = m.id AND t.entry_scanned_at >= v_since
          UNION
          SELECT date_trunc('day', (tr.entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
            FROM public.table_reservations tr
           WHERE tr.entry_scanned_by = m.id AND tr.entry_scanned_at >= v_since
          UNION
          SELECT date_trunc('day', (gle.entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
            FROM public.guest_list_entries gle
           WHERE gle.entry_scanned_by = m.id AND gle.entry_scanned_at >= v_since
          UNION
          SELECT date_trunc('day', (o.served_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
            FROM public.orders o
           WHERE COALESCE(o.served_by, o.prep_claimed_by) = m.id
             AND o.served_at >= v_since AND o.status <> 'refunded'
          UNION
          SELECT date_trunc('day', (ct.created_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
            FROM public.cloakroom_transactions ct
           WHERE ct.staff_id = m.id AND ct.created_at >= v_since
          UNION
          SELECT date_trunc('day', (ne.created_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
            FROM public.night_ops_events ne
           WHERE ne.reported_by = m.id AND ne.kind = 'shift_start' AND ne.created_at >= v_since
        ) nights
      ),
      'last_action_at', GREATEST(
        (SELECT max(ta.entry_scanned_at) FROM public.ticket_attendees ta WHERE ta.entry_scanned_by = m.id),
        (SELECT max(t.entry_scanned_at) FROM public.tickets t WHERE t.entry_scanned_by = m.id),
        (SELECT max(tr.entry_scanned_at) FROM public.table_reservations tr WHERE tr.entry_scanned_by = m.id),
        (SELECT max(gle.entry_scanned_at) FROM public.guest_list_entries gle WHERE gle.entry_scanned_by = m.id),
        (SELECT max(o.served_at) FROM public.orders o WHERE COALESCE(o.served_by, o.prep_claimed_by) = m.id AND o.status <> 'refunded'),
        (SELECT max(ct.created_at) FROM public.cloakroom_transactions ct WHERE ct.staff_id = m.id),
        (SELECT max(ne.created_at) FROM public.night_ops_events ne WHERE ne.reported_by = m.id)
      )
    ) ORDER BY m.staff_since NULLS LAST, m.first_name)
    FROM public.profiles m
    WHERE m.venue_id = v_venue
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = m.id
           AND ur.role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
      )
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_venue_staff_activity(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_venue_staff_activity(text, integer) TO authenticated;
