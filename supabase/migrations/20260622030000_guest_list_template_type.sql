-- Presets de guest list typés : un preset cible un détenteur (club / DJ / promoteur)
-- et peut être marqué « par défaut » (utilisé par le toggle Guest list rapide de la
-- page événements pour publier la liste club en 2s).

ALTER TABLE public.guest_list_templates
  ADD COLUMN IF NOT EXISTS holder_type text NOT NULL DEFAULT 'club',
  ADD COLUMN IF NOT EXISTS is_default  boolean NOT NULL DEFAULT false;

ALTER TABLE public.guest_list_templates DROP CONSTRAINT IF EXISTS glt_holder_type_check;
ALTER TABLE public.guest_list_templates
  ADD CONSTRAINT glt_holder_type_check CHECK (holder_type IN ('club','dj','promoter'));

-- Un seul preset « par défaut » par (scope, type). Index partiels distincts venue/orga.
CREATE UNIQUE INDEX IF NOT EXISTS glt_default_venue_uniq
  ON public.guest_list_templates(venue_id, holder_type)
  WHERE is_default AND venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS glt_default_org_uniq
  ON public.guest_list_templates(organizer_user_id, holder_type)
  WHERE is_default AND organizer_user_id IS NOT NULL;
