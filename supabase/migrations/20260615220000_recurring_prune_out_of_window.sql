-- ============================================================================
-- RECURRING EVENTS — prune surplus occurrences when advance_days shrinks
--
-- Bug: generate_recurring_events only ADDED occurrences inside the
-- [today, today + advance_days] window and deduped; it never PRUNED. So when an
-- owner/organizer reduced "publish X days before" (e.g. 28 -> 7), the previously
-- generated future occurrences stayed on the dashboard. The publication window
-- setting was effectively ignored on the way down — the dashboard showed the
-- next 4 nights regardless of the value entered at creation/edit.
--
-- Fix: after (re)generating a template's in-window occurrences, delete the
-- template's FUTURE occurrences whose Paris-local date now falls OUTSIDE the
-- window — but ONLY when they carry no customer commitment (no tickets, no
-- orders, no table or ticket reservations). Events someone already bought into
-- are never auto-deleted. Past/ongoing occurrences are never touched.
--
-- Single source of truth for both scopes: the function loops over venue-owned
-- and organizer-owned templates alike, so this fixes owner AND organizer. Based
-- on the co-event version of the function (20260615210000_recurring_co_events)
-- so partner/co-event behaviour is preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_recurring_events(p_template_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tpl public.owner_recurring_templates%ROWTYPE;
  d date;
  v_close_next_day boolean;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_event_id uuid;
  v_ticket_preset public.ticket_presets%ROWTYPE;
  v_vip_preset public.ticket_presets%ROWTYPE;
  v_will_enable_ticketing boolean;
  v_selling_mode text;
  v_max_tickets int;
  v_position int;
  v_generated int := 0;
BEGIN
  IF p_template_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.owner_recurring_templates t
      WHERE t.id = p_template_id AND (
        t.organizer_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = t.venue_id AND v.owner_id = auth.uid())
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized for template %', p_template_id;
    END IF;
  END IF;

  FOR tpl IN
    SELECT * FROM public.owner_recurring_templates
    WHERE is_active = true
      AND (p_template_id IS NULL OR id = p_template_id)
  LOOP
    FOR d IN
      SELECT gd::date
      FROM generate_series(
        (now() AT TIME ZONE 'Europe/Paris')::date,
        (now() AT TIME ZONE 'Europe/Paris')::date + tpl.advance_days,
        interval '1 day'
      ) gd
      WHERE EXTRACT(DOW FROM gd) = tpl.day_of_week
    LOOP
      BEGIN
        IF EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.recurring_template_id = tpl.id
            AND (e.start_at AT TIME ZONE 'Europe/Paris')::date = d
        ) THEN
          CONTINUE;
        END IF;

        v_close_next_day := tpl.end_time <= tpl.start_time;
        v_start_at := (d + tpl.start_time) AT TIME ZONE 'Europe/Paris';
        v_end_at := ((d + (CASE WHEN v_close_next_day THEN 1 ELSE 0 END)::int) + tpl.end_time) AT TIME ZONE 'Europe/Paris';

        v_ticket_preset := NULL;
        v_vip_preset := NULL;
        IF tpl.ticket_preset_id IS NOT NULL THEN
          SELECT * INTO v_ticket_preset FROM public.ticket_presets WHERE id = tpl.ticket_preset_id;
        END IF;
        IF tpl.vip_preset_id IS NOT NULL THEN
          SELECT * INTO v_vip_preset FROM public.ticket_presets WHERE id = tpl.vip_preset_id;
        END IF;

        v_will_enable_ticketing := (v_ticket_preset.id IS NOT NULL OR v_vip_preset.id IS NOT NULL);
        v_selling_mode := COALESCE(v_ticket_preset.selling_mode, 'rounds');
        v_max_tickets := CASE WHEN v_ticket_preset.id IS NOT NULL AND v_ticket_preset.selling_mode = 'simple'
                              THEN v_ticket_preset.total_capacity ELSE NULL END;

        INSERT INTO public.events (
          venue_id, organizer_user_id, title, description, poster_url, poster_position,
          music_genres, music_genre, event_type, start_at, end_at, is_active,
          recurring_template_id, ticketing_enabled, ticket_selling_mode, max_tickets, tables_enabled,
          partner_organizer_id, event_mode, revenue_split_rules,
          split_approved_by_venue, split_approved_by_organizer, split_locked_at
        ) VALUES (
          tpl.venue_id, tpl.organizer_user_id, tpl.name, tpl.description, tpl.poster_url, tpl.poster_position,
          tpl.music_genres, COALESCE(tpl.music_genres[1], 'Open Format'), tpl.event_type, v_start_at, v_end_at, true,
          tpl.id, v_will_enable_ticketing, v_selling_mode, v_max_tickets, COALESCE(tpl.auto_enable_tables, false),
          tpl.partner_organizer_id,
          CASE WHEN tpl.partner_organizer_id IS NOT NULL THEN 'co_event'::public.event_mode
               WHEN tpl.venue_id IS NOT NULL THEN 'solo_venue'::public.event_mode
               ELSE 'solo_organizer'::public.event_mode END,
          tpl.revenue_split_rules,
          (tpl.partner_organizer_id IS NOT NULL),
          (tpl.partner_organizer_id IS NOT NULL),
          CASE WHEN tpl.partner_organizer_id IS NOT NULL THEN now() ELSE NULL END
        )
        RETURNING id INTO v_event_id;

        v_position := 0;
        IF v_ticket_preset.id IS NOT NULL THEN
          v_position := v_position + public._insert_recurring_rounds(v_event_id, v_ticket_preset.id, v_position);
        END IF;
        IF v_vip_preset.id IS NOT NULL THEN
          PERFORM public._insert_recurring_rounds(v_event_id, v_vip_preset.id, v_position);
        END IF;

        v_generated := v_generated + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'generate_recurring_events: template % / date %: %', tpl.id, d, SQLERRM;
      END;
    END LOOP;

    -- Prune surplus: when advance_days is reduced, the template's FUTURE
    -- occurrences that now fall OUTSIDE the publication window are removed so the
    -- dashboard matches the "publish X days before" setting. Only occurrences
    -- with zero customer commitment are deleted — anything with tickets, orders,
    -- or reservations is kept. Past/ongoing occurrences are never touched.
    -- Child rows (ticket_rounds, etc.) cascade; the lone NO ACTION FK
    -- (cloakroom_transactions) only exists for past events, never future ones.
    BEGIN
      DELETE FROM public.events e
      WHERE e.recurring_template_id = tpl.id
        AND e.start_at > now()
        AND (e.start_at AT TIME ZONE 'Europe/Paris')::date
            > (now() AT TIME ZONE 'Europe/Paris')::date + tpl.advance_days
        AND NOT EXISTS (SELECT 1 FROM public.tickets t             WHERE t.event_id  = e.id)
        AND NOT EXISTS (SELECT 1 FROM public.orders o              WHERE o.event_id  = e.id)
        AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr WHERE tr.event_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM public.ticket_reservations k WHERE k.event_id  = e.id);
    EXCEPTION WHEN OTHERS THEN
      -- A prune failure must never abort generation for the rest of the run.
      RAISE WARNING 'generate_recurring_events prune: template %: %', tpl.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_generated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_recurring_events(uuid) TO authenticated;
