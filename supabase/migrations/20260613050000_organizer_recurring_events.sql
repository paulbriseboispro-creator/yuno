-- ============================================================
-- ORGANIZER RECURRING EVENTS
-- Extends the owner recurring-events system (20260613010000) to organizers.
--
-- A recurring template now belongs EITHER to a venue (club owner) OR to an
-- organizer (organizer_user_id). The materialization that turns templates into
-- real `events` rows is ported from the `create-owner-recurring-events` edge
-- function to a Postgres function so it works for both scopes and can run
-- without the edge function (which cannot be redeployed). pg_cron now calls the
-- Postgres function directly.
-- ============================================================

-- 1. Template table: allow organizer-owned templates --------------------------
ALTER TABLE public.owner_recurring_templates
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid;

-- venue_id was NOT NULL (venue-only). Organizer templates have no venue.
ALTER TABLE public.owner_recurring_templates
  ALTER COLUMN venue_id DROP NOT NULL;

-- Exactly one owner: a venue OR an organizer (never both, never neither).
ALTER TABLE public.owner_recurring_templates
  DROP CONSTRAINT IF EXISTS owner_recurring_templates_one_owner;
ALTER TABLE public.owner_recurring_templates
  ADD CONSTRAINT owner_recurring_templates_one_owner
  CHECK ((venue_id IS NOT NULL) <> (organizer_user_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_owner_recurring_templates_organizer
  ON public.owner_recurring_templates(organizer_user_id);

-- 2. RLS: owners (via venue) OR the organizer themselves ----------------------
DROP POLICY IF EXISTS "Owners manage their venue recurring templates" ON public.owner_recurring_templates;
DROP POLICY IF EXISTS "Owners and organizers manage their recurring templates" ON public.owner_recurring_templates;

CREATE POLICY "Owners and organizers manage their recurring templates"
  ON public.owner_recurring_templates
  FOR ALL
  USING (
    organizer_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = owner_recurring_templates.venue_id AND v.owner_id = auth.uid())
  )
  WITH CHECK (
    organizer_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = owner_recurring_templates.venue_id AND v.owner_id = auth.uid())
  );

-- 3. Helper: insert ticket rounds for a generated event from a preset ---------
CREATE OR REPLACE FUNCTION public._insert_recurring_rounds(
  p_event_id uuid,
  p_preset_id uuid,
  p_start_position int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.ticket_presets%ROWTYPE;
  v_mode text;
  v_count int;
BEGIN
  SELECT * INTO p FROM public.ticket_presets WHERE id = p_preset_id;
  IF p.id IS NULL OR p.rounds IS NULL OR jsonb_typeof(p.rounds) <> 'array' THEN
    RETURN 0;
  END IF;
  v_mode := COALESCE(p.selling_mode, 'rounds');

  INSERT INTO public.ticket_rounds (
    event_id, name, price, max_tickets, last_tickets_threshold, position,
    is_active, auto_activate, ticket_type, includes_drink,
    drink_deadline_type, drink_deadline_hours, drink_cutoff_time, entry_deadline
  )
  SELECT
    p_event_id,
    COALESCE(r->>'name', 'Standard'),
    COALESCE((r->>'price')::numeric, 0),
    CASE WHEN v_mode = 'simple' THEN 999999 ELSE COALESCE((r->>'maxTickets')::int, 100) END,
    COALESCE((r->>'lastTicketsThreshold')::int, 20),
    p_start_position + (ord - 1)::int,
    CASE WHEN v_mode = 'simple' THEN true ELSE (ord = 1 AND p_start_position = 0) END,
    (v_mode <> 'timed_entry' AND v_mode <> 'simple'),
    COALESCE(p.ticket_type, 'standard'),
    COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false),
    CASE WHEN COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false)
         THEN COALESCE(p.drink_deadline_type, 'none') ELSE 'none' END,
    CASE WHEN COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false)
              AND p.drink_deadline_type = 'hours_after_start' THEN p.drink_deadline_hours ELSE NULL END,
    CASE WHEN COALESCE((r->>'includesDrink')::boolean, p.includes_drink, false)
              AND p.drink_deadline_type = 'fixed_time' THEN p.drink_cutoff_time ELSE NULL END,
    CASE WHEN (r->>'entryDeadline') IS NOT NULL AND (r->>'entryDeadline') <> ''
         THEN (r->>'entryDeadline') || ':00' ELSE NULL END
  FROM jsonb_array_elements(p.rounds) WITH ORDINALITY AS t(r, ord);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4. Materialization: turn active templates into real events ------------------
--    p_template_id NULL  → all active templates (cron daily job)
--    p_template_id set   → one template (the "generate now" button after edit)
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
  -- When called by an authenticated user for one template, enforce ownership.
  -- Cron calls have no auth.uid() (NULL) and process every template.
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
    -- Upcoming occurrences of day_of_week within advance_days (Paris calendar).
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
        -- Dedupe: one generated event per (template, Paris-local date).
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

        -- events table defaults already make a new row public + discoverable
        -- (visibility/event_kind/is_discoverable/discovery_status), so we only
        -- carry the scope owner (venue_id OR organizer_user_id).
        INSERT INTO public.events (
          venue_id, organizer_user_id, title, description, poster_url, poster_position,
          music_genres, music_genre, event_type, start_at, end_at, is_active,
          recurring_template_id, ticketing_enabled, ticket_selling_mode, max_tickets, tables_enabled
        ) VALUES (
          tpl.venue_id, tpl.organizer_user_id, tpl.name, tpl.description, tpl.poster_url, tpl.poster_position,
          tpl.music_genres, COALESCE(tpl.music_genres[1], 'Open Format'), tpl.event_type, v_start_at, v_end_at, true,
          tpl.id, v_will_enable_ticketing, v_selling_mode, v_max_tickets, COALESCE(tpl.auto_enable_tables, false)
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
        -- Don't let one bad date abort the whole run (mirrors the edge function).
        RAISE WARNING 'generate_recurring_events: template % / date %: %', tpl.id, d, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN v_generated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_recurring_events(uuid) TO authenticated;

-- 5. Repoint pg_cron from the edge function to the Postgres function ----------
DO $$
BEGIN
  PERFORM cron.unschedule('create-owner-recurring-events');
EXCEPTION WHEN OTHERS THEN
  -- job may not exist in this environment; ignore
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('generate-recurring-events');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'generate-recurring-events',
  '5 6 * * *',
  $$ SELECT public.generate_recurring_events(); $$
);
