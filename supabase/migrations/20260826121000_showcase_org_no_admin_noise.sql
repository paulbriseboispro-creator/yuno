-- ============================================================================
-- Pas d'alerte « Nouvel organisateur » quand c'est l'admin qui crée une vitrine.
--
-- trg_notify_admin_new_organizer (20260723210000) prévient le super admin à
-- chaque INSERT d'organizer_profiles. Une vitrine de prospection est créée PAR
-- l'admin lui-même (action create-showcase-organizer) : se notifier sa propre
-- action est du bruit. Le profil vitrine naît avec is_showcase_shadow=true →
-- on saute. Le VRAI signal de croissance arrive plus tard, à la réclamation
-- (notification admin_showcase_claim puis conversion).
--
-- Recréation à l'identique de 20260723210000 l.474-494 + le garde.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_admin_new_organizer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.is_showcase_shadow THEN
    RETURN NEW;
  END IF;
  PERFORM public.emit_admin_notification(
    'admin_new_organizer',
    'Nouvel organisateur',
    NEW.display_name || ' a créé son profil organisateur' ||
      COALESCE(' (' || NEW.city || ')', '') || '.',
    'normal', 'organizer', NEW.user_id::text,
    jsonb_build_object('user_id', NEW.user_id, 'display_name', NEW.display_name, 'city', NEW.city),
    'new_organizer:' || NEW.user_id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;
