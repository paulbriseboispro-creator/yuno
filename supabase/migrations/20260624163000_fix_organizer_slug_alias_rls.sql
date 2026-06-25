-- Fix : renommer une orga échouait avec
--   « new row violates row-level security policy for table "organizer_slug_aliases" ».
-- Cause : sync_organizer_slug() (trigger BEFORE INSERT/UPDATE sur organizer_profiles)
-- archive l'ancien slug dans organizer_slug_aliases lors d'un renommage, mais la fonction
-- n'était PAS en SECURITY DEFINER. L'INSERT tournait donc avec les droits de l'orga
-- authentifiée, et la table a la RLS activée SANS policy INSERT -> refus.
-- Son jumeau DJ resync_dj_handle() est déjà SECURITY DEFINER et passe : on aligne.
-- search_path reste fixé à 'public' (obligatoire pour une fonction SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.sync_organizer_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_new text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := public.gen_organizer_slug(NEW.display_name, NEW.user_id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : un slug explicitement modifié l'emporte (on ne le réécrit pas).
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;
  -- Renommage : resynchroniser le slug, archiver l'ancien.
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    v_new := public.gen_organizer_slug(NEW.display_name, NEW.user_id);
    IF v_new IS DISTINCT FROM OLD.slug THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
        VALUES (OLD.slug, NEW.user_id) ON CONFLICT (slug) DO NOTHING;
      NEW.slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
