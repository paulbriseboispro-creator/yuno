-- Aperçu social d'un lien suivi (/l/:code) : le Worker OG a besoin de savoir
-- quelle page le lien ouvre, SANS enregistrer de clic (un crawler WhatsApp /
-- Instagram gonflerait les compteurs). Lecture seule, aucune donnée perso :
-- rend seulement le chemin public de la cible.

CREATE OR REPLACE FUNCTION public.get_tracked_link_preview_path(p_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.tracked_links%ROWTYPE;
  v_gl_event uuid;
  v_slug text;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_link.target_kind = 'event' THEN
    RETURN '/event/' || v_link.event_id::text;
  ELSIF v_link.target_kind = 'guestlist' THEN
    SELECT gl.event_id INTO v_gl_event FROM public.guest_lists gl WHERE gl.id = v_link.guest_list_id;
    IF v_gl_event IS NOT NULL THEN RETURN '/event/' || v_gl_event::text; END IF;
  ELSIF v_link.target_kind = 'venue' THEN
    RETURN '/club/' || v_link.target_venue_id;
  ELSIF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
    IF v_slug IS NOT NULL THEN RETURN '/o/' || v_slug; END IF;
  END IF;
  RETURN NULL;
END; $function$;

REVOKE ALL ON FUNCTION public.get_tracked_link_preview_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracked_link_preview_path(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
