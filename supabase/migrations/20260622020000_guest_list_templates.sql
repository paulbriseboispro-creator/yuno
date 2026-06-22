-- Presets de guest list — l'owner/orga sauvegarde une config réutilisable (quota,
-- split genré, gratuit-avant, deadline, boisson, visibilité) et publie une liste club
-- en un clic depuis ce preset. Table indépendante des events (purement un modèle).

CREATE TABLE IF NOT EXISTS public.guest_list_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid,
  name text NOT NULL,
  quota integer NOT NULL DEFAULT 100,
  quota_female integer,
  quota_male integer,
  free_before_time time NOT NULL DEFAULT '02:00',
  entry_deadline time,
  includes_drink boolean NOT NULL DEFAULT false,
  visible_on_club_page boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_list_templates_scope_check CHECK (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_glt_venue     ON public.guest_list_templates(venue_id)          WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_glt_organizer ON public.guest_list_templates(organizer_user_id) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.guest_list_templates ENABLE ROW LEVEL SECURITY;

-- Owners (et managers) gèrent les presets de leur venue ; mêmes helpers que guest_lists.
DROP POLICY IF EXISTS "Owners manage venue gl templates" ON public.guest_list_templates;
CREATE POLICY "Owners manage venue gl templates"
  ON public.guest_list_templates FOR ALL
  USING (venue_id IS NOT NULL AND (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id)))
  WITH CHECK (venue_id IS NOT NULL AND (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id)));

-- Organizers gèrent leurs propres presets.
DROP POLICY IF EXISTS "Organizers manage own gl templates" ON public.guest_list_templates;
CREATE POLICY "Organizers manage own gl templates"
  ON public.guest_list_templates FOR ALL
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());
