-- Liens suivis : renvoyer le chemin PROPRE de la soirée (/events/:host/:slug).
--
-- Avant, `record_tracked_link_click` ne rendait que `event_venue_id`, et le
-- front bâtissait l'ancienne forme `/club/:slug/event/:id/...`. Une soirée
-- d'organisateur SANS club (venue_id NULL, pilier tables/guest list solo) n'a
-- pas de slug de club : le front retombait sur la chaîne littérale « event »,
-- produisant `/club/event/event/<uuid>/guestlist`. La page s'ouvrait, mais le
-- bouton de retour partait sur `/club/event` — un club qui n'existe pas — et
-- l'URL annoncée dans un email marketing n'était pas la canonique.
--
-- On expose donc le host (slug d'orga si organizer-led, sinon slug du club) et
-- le slug de la soirée, tous deux lus par `event_host_slug` / `events.slug` :
-- la règle de composition reste au seul endroit qui la porte.
--
-- Signature inchangée -> CREATE OR REPLACE suffit (pas de surcharge ambiguë).

CREATE OR REPLACE FUNCTION public.record_tracked_link_click(
  p_code text,
  p_visitor_id text DEFAULT NULL::text,
  p_device_type text DEFAULT NULL::text,
  p_referrer text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text,
  p_ip_hash text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_link        public.tracked_links%ROWTYPE;
  v_event_venue text;
  v_org_slug    text;
  v_promo_code  text;
  v_recent      boolean := false;
  v_gl_token    text;
  v_gl_event    uuid;
  v_path_event  uuid;
  v_event_host  text;
  v_event_slug  text;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF p_visitor_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tracked_link_clicks
      WHERE tracked_link_id = v_link.id AND visitor_id = p_visitor_id
        AND clicked_at > now() - interval '30 minutes'
    ) INTO v_recent;
  END IF;

  INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type)
  VALUES (v_link.id, p_ip_hash, p_user_agent, p_referrer, p_visitor_id, p_device_type);

  IF NOT v_recent THEN
    UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
  END IF;

  IF v_link.target_kind = 'event' THEN
    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_link.event_id;
  END IF;
  IF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_org_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
  END IF;
  -- Guest list : on renvoie le token de la PART, seul moyen d'ouvrir une part
  -- déléguée (elles ne sont pas listées sur la page publique de la soirée).
  IF v_link.target_kind = 'guestlist' THEN
    SELECT gl.share_token, gl.event_id INTO v_gl_token, v_gl_event
    FROM public.guest_lists gl
    WHERE gl.id = v_link.guest_list_id AND gl.is_active = true;
    IF v_gl_event IS NOT NULL THEN
      SELECT COALESCE(e.venue_id, e.partner_venue_id) INTO v_event_venue
      FROM public.events e WHERE e.id = v_gl_event;
    END IF;
  END IF;
  IF v_link.owner_kind = 'promoter' THEN
    SELECT promo_code INTO v_promo_code FROM public.promoters WHERE id = v_link.promoter_id;
  END IF;

  -- Chemin canonique : le front préfère /events/:host/:slug quand les deux
  -- sont là, et ne retombe sur l'ancienne forme que s'il en manque un.
  v_path_event := COALESCE(v_gl_event, v_link.event_id);
  IF v_path_event IS NOT NULL THEN
    SELECT NULLIF(btrim(e.slug), '') INTO v_event_slug FROM public.events e WHERE e.id = v_path_event;
    IF v_event_slug IS NOT NULL THEN
      SELECT NULLIF(btrim(public.event_host_slug(v_path_event)), '') INTO v_event_host;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found',              true,
    'tracked_link_id',    v_link.id,
    'target_kind',        v_link.target_kind,
    'event_id',           v_link.event_id,
    'event_venue_id',     v_event_venue,
    'target_venue_id',    v_link.target_venue_id,
    'organizer_slug',     v_org_slug,
    'promo_code',         v_promo_code,
    'guest_list_token',   v_gl_token,
    'guest_list_event_id', v_gl_event,
    'event_host',         v_event_host,
    'event_slug',         v_event_slug
  );
END; $function$;
