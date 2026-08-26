-- ============================================================================
-- Publier son profil orga relance la découvrabilité de ses events.
--
-- Un event d'organisateur n'a de page publique consultable que si le profil de
-- l'orga est lisible (EventDetails charge organizer_profiles ; is_public=false
-- → « introuvable » pour anon). Le pipeline vitrine maintient donc les events
-- d'un orga privé non-découvrables (zz_showcase_hide_event + handoff). Quand
-- l'orga passe son profil en public — c'est SON geste de publication, toggle
-- de /organizer-app/profile — ses events actifs repassent l'évaluation
-- normale : un UPDATE no-op re-déclenche evaluate_event_discoverability
-- (BEFORE UPDATE), qui rend découvrables ceux qui remplissent les critères.
--
-- Mécanisme général (pas réservé aux vitrines) : un orga qui repasse public
-- veut être vu ; c'est l'équivalent d'un re-save de chaque event, rien de plus.
-- Corps enveloppé d'un EXCEPTION → RETURN : une relance d'évaluation ne doit
-- jamais faire échouer le toggle du profil.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reevaluate_org_events_on_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.events
     SET is_discoverable = is_discoverable
   WHERE organizer_user_id = NEW.user_id
     AND is_active = true;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_publish_reevaluates_events ON public.organizer_profiles;
CREATE TRIGGER org_publish_reevaluates_events
  AFTER UPDATE OF is_public ON public.organizer_profiles
  FOR EACH ROW
  WHEN (OLD.is_public = false AND NEW.is_public = true)
  EXECUTE FUNCTION public.reevaluate_org_events_on_publish();
