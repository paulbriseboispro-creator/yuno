-- ============================================================================
-- Soirées récurrentes : auto-publication d'un MODÈLE DE GUEST LIST.
--
-- Le template récurrent sait déjà épingler un preset billets standard, un preset
-- billets VIP et un preset de tables VIP, appliqués automatiquement à chaque
-- occurrence. La guest list, elle, restait manuelle : chaque vendredi il fallait
-- rouvrir /owner/guest-list, choisir la soirée et appliquer le preset club à la
-- main. On épingle donc un guest_list_templates sur le template récurrent.
--
-- Approche identique à 20260629140000 (preset de tables VIP) : on NE réécrit PAS
-- generate_recurring_events() (fonction critique revenu, ~170 lignes). Un trigger
-- AFTER INSERT sur events recopie le modèle dans une part 'club' de guest_lists
-- pour toute occurrence issue d'un template. Les inserts manuels
-- (recurring_template_id NULL) sont ignorés.
-- ============================================================================

ALTER TABLE public.owner_recurring_templates
  ADD COLUMN IF NOT EXISTS guest_list_template_id uuid
    REFERENCES public.guest_list_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.owner_recurring_templates.guest_list_template_id IS
  'Modèle de guest list auto-publié (part « club ») sur chaque occurrence récurrente. NULL = pas de guest list automatique.';

CREATE OR REPLACE FUNCTION public.apply_recurring_guest_list_template()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl_id public.owner_recurring_templates.guest_list_template_id%TYPE;
  gl       public.guest_list_templates%ROWTYPE;
BEGIN
  SELECT guest_list_template_id INTO v_tpl_id
  FROM public.owner_recurring_templates
  WHERE id = NEW.recurring_template_id;

  IF v_tpl_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO gl FROM public.guest_list_templates WHERE id = v_tpl_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Part « club » = la liste hôte de la soirée. venue_id / organizer_user_id sont
  -- hérités de l'occurrence (co-soirée org-led : le club physique est partner_venue_id),
  -- pour satisfaire le CHECK de scope de guest_lists.
  INSERT INTO public.guest_lists (
    event_id, venue_id, organizer_user_id, holder_type,
    entry_kind, quota, quota_normal, quota_drink, quota_table,
    quota_female, quota_male, free_before_time, entry_deadline,
    includes_drink, visible_on_club_page, show_remaining, is_active
  ) VALUES (
    NEW.id,
    COALESCE(NEW.venue_id, NEW.partner_venue_id),
    NEW.organizer_user_id,
    'club',
    gl.entry_kind, gl.quota, gl.quota_normal, gl.quota_drink, gl.quota_table,
    gl.quota_female, gl.quota_male, gl.free_before_time, gl.entry_deadline,
    gl.includes_drink, gl.visible_on_club_page, gl.show_remaining, true
  )
  -- Idempotent : guest_lists_event_club_uniq = UNIQUE(event_id) WHERE holder_type='club'.
  ON CONFLICT (event_id) WHERE holder_type = 'club' DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_recurring_guest_list_template ON public.events;
CREATE TRIGGER trg_apply_recurring_guest_list_template
  AFTER INSERT ON public.events
  FOR EACH ROW
  WHEN (NEW.recurring_template_id IS NOT NULL)
  EXECUTE FUNCTION public.apply_recurring_guest_list_template();
