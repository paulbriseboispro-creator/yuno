-- ============================================================
-- OWNER RECURRING EVENTS
-- Lets a club owner define a weekly recurring night (e.g. "Friday Club")
-- that auto-generates real Yuno events ahead of time, optionally with
-- ticketing + tables already published from a ticket preset.
--
-- Mirrors the affiliate recurring system, but the generated rows live in
-- the regular `events` table (owner sells ON Yuno) instead of pointing to
-- an external ticket link.
-- ============================================================

-- 1. Template table -----------------------------------------------------------
CREATE TABLE public.owner_recurring_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  poster_url        text,
  poster_position   jsonb,
  music_genres      text[] NOT NULL DEFAULT ARRAY['Open Format']::text[],
  event_type        text NOT NULL DEFAULT 'club',
  day_of_week       int  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time        time NOT NULL,
  end_time          time NOT NULL,
  advance_days      int  NOT NULL DEFAULT 7 CHECK (advance_days BETWEEN 0 AND 60),
  -- Ticketing: when set, generated events auto-apply this preset, create the
  -- rounds and flip ticketing_enabled = true.
  ticket_preset_id  uuid REFERENCES public.ticket_presets(id) ON DELETE SET NULL,
  vip_preset_id     uuid REFERENCES public.ticket_presets(id) ON DELETE SET NULL,
  auto_enable_tables boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_owner_recurring_templates_venue   ON public.owner_recurring_templates(venue_id);
CREATE INDEX idx_owner_recurring_templates_active  ON public.owner_recurring_templates(is_active) WHERE is_active;

CREATE TRIGGER trg_owner_recurring_templates_updated_at
  BEFORE UPDATE ON public.owner_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Link generated events back to their template -----------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS recurring_template_id uuid
  REFERENCES public.owner_recurring_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_recurring_template ON public.events(recurring_template_id);

-- Dedupe guard: one generated event per (template, calendar date).
-- start_at is a timestamptz; we key on the Paris-local date of start_at.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_recurring_template_date
  ON public.events (recurring_template_id, ((start_at AT TIME ZONE 'Europe/Paris')::date))
  WHERE recurring_template_id IS NOT NULL;

-- 3. RLS ----------------------------------------------------------------------
ALTER TABLE public.owner_recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their venue recurring templates"
  ON public.owner_recurring_templates
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = owner_recurring_templates.venue_id AND v.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = owner_recurring_templates.venue_id AND v.owner_id = auth.uid()
  ));

-- 4. pg_cron: generate owner recurring events daily at 06:05 UTC --------------
--    (5 min after the affiliate job to avoid contention)
SELECT cron.schedule(
  'create-owner-recurring-events',
  '5 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/create-owner-recurring-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
