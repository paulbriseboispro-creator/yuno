-- Yuno CRM › Trafic, lot C1 (suite) : le bouton « Billets » d'une page
-- d'inscription /j/ passe par un lien /go/ de la page
-- (`crm_signup_pages.go_link_id`). Le clic est compté comme celui d'une story,
-- et Shotgun rapporte `utm_source = yuno-<code>` sur le billet. Fonctions
-- réécrites depuis pg_get_functiondef de la prod (27/10).

ALTER TABLE public.crm_signup_pages
  ADD COLUMN IF NOT EXISTS go_link_id uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL;

-- Un lien technique (`utm_source = 'yuno'`, `utm_medium = 'page'`), comme le
-- lien d'un SMS : hors de la liste des liens de partage (`_crm_link_kind_ok`),
-- rangé « autres liens Yuno » par `_crm_ticket_source`. Seulement pour une
-- soirée MIROIR dont la page Shotgun est connue (le Worker /go/ n'en sert pas
-- d'autre). Ne lève jamais : la page s'enregistre toujours.
CREATE OR REPLACE FUNCTION public._crm_signup_ensure_go_link(p_page_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p public.crm_signup_pages%ROWTYPE;
  v_ok boolean;
  v_link uuid;
  v_owner uuid;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_page_id;
  IF NOT FOUND OR p.event_id IS NULL OR p.status <> 'live' THEN RETURN NULL; END IF;
  SELECT e.external_source IS NOT NULL AND COALESCE(e.external_ticket_url, '') ~ '^https://'
    INTO v_ok FROM public.events e WHERE e.id = p.event_id;
  IF NOT COALESCE(v_ok, false) THEN RETURN NULL; END IF;

  IF p.go_link_id IS NOT NULL THEN
    SELECT tl.id INTO v_link FROM public.tracked_links tl
     WHERE tl.id = p.go_link_id AND tl.event_id = p.event_id AND tl.is_active;
    IF v_link IS NOT NULL THEN RETURN v_link; END IF;
  END IF;

  IF p.venue_id IS NOT NULL THEN
    SELECT owner_id INTO v_owner FROM public.venues WHERE id = p.venue_id;
  END IF;
  v_owner := COALESCE(p.created_by, v_owner, p.organizer_user_id);
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium, utm_campaign)
  VALUES ('', 'Page', CASE WHEN p.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
          p.venue_id, CASE WHEN p.venue_id IS NULL THEN p.organizer_user_id END, v_owner,
          'event', p.event_id, 'yuno', 'page', 'yuno')
  RETURNING id INTO v_link;
  UPDATE public.crm_signup_pages SET go_link_id = v_link WHERE id = p.id;
  RETURN v_link;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_crm_signup_ensure_go_link: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_ensure_go_link(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_crm_signup_go_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'live' AND NEW.event_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.event_id IS DISTINCT FROM OLD.event_id
          OR NEW.go_link_id IS NULL) THEN
    PERFORM public._crm_signup_ensure_go_link(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_crm_signup_go_link() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_signup_go_link ON public.crm_signup_pages;
CREATE TRIGGER trg_crm_signup_go_link
  AFTER INSERT OR UPDATE OF status, event_id ON public.crm_signup_pages
  FOR EACH ROW EXECUTE FUNCTION public.trg_crm_signup_go_link();

-- Les pages déjà en ligne.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.crm_signup_pages WHERE status = 'live' AND event_id IS NOT NULL AND go_link_id IS NULL LOOP
    PERFORM public._crm_signup_ensure_go_link(r.id);
  END LOOP;
END $$;

-- La page publique sert le lien /go/ comme adresse des billets (même champ
-- `event.ticket_url`, donc FanPage et les designs sur mesure n'ont rien à changer).
CREATE OR REPLACE FUNCTION public.get_crm_signup_page(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_state text;
  v_event jsonb;
  v_go text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug) AND status IN ('live', 'closed');
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_state := public._crm_signup_state(p);
  v_event := public._crm_signup_event(p.event_id);
  IF v_event IS NOT NULL AND p.go_link_id IS NOT NULL THEN
    SELECT tl.code INTO v_go FROM public.tracked_links tl
      JOIN public.events e ON e.id = tl.event_id
     WHERE tl.id = p.go_link_id AND tl.event_id = p.event_id AND tl.is_active
       AND e.external_source IS NOT NULL AND e.external_ticket_url IS NOT NULL;
    IF v_go IS NOT NULL THEN
      v_event := jsonb_set(v_event, '{ticket_url}', to_jsonb('https://yunoapp.eu/go/' || v_go));
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'occasion', p.occasion, 'theme', p.theme, 'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label,
    'thanks_message', p.thanks_message, 'poster_url', p.poster_url, 'design', p.design, 'custom_design', p.custom_design, 'fields', p.fields, 'reward', p.reward,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'countdown', p.countdown, 'close_at', public._crm_signup_close_at(p),
    'state', CASE v_state WHEN 'scheduled' THEN 'soon' WHEN 'closed' THEN 'closed' ELSE 'open' END,
    'count', CASE WHEN p.show_count THEN (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id) END,
    'demo', public._crm_signup_is_demo(p),
    -- Guest list : la page envoie le fan vers un lien après l'inscription. Le lien
    -- lui-même n'est rendu qu'à l'inscription (submit_crm_signup).
    'redirects', p.kind = 'guestlist' AND p.after_url IS NOT NULL,
    -- Le nom que le fan lit (case d'accord, pied de page) : celui des Réglages d'envoi.
    'host', COALESCE(public.crm_space_display_name(p.venue_id, p.organizer_user_id), 'Yuno'),
    -- `ticket_url` = le lien /go/ de la page quand il existe (clic compté).
    'event', v_event,
    -- La marque lue par les balises d'un design sur mesure ({{host.logo}}…) : publique déjà sur Yuno.
    'brand', CASE WHEN p.venue_id IS NOT NULL THEN (
        SELECT jsonb_strip_nulls(jsonb_build_object('logo', v.logo_url, 'city', v.city, 'instagram', v.instagram_url))
          FROM public.venues v WHERE v.id = p.venue_id)
      ELSE (
        SELECT jsonb_strip_nulls(jsonb_build_object('logo', o.avatar_url, 'city', o.city, 'instagram', o.instagram_url))
          FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_crm_signup_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_signup_page(text) TO anon, authenticated, service_role;
