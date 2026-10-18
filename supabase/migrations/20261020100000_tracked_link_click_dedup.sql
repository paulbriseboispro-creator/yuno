-- Liens suivis (/l/<code>) : un clic = une personne, pas une requête.
--
-- Constaté sur la soirée Amoris (lien WhatsApp) : 6 → 8 « vues » d'un coup.
-- `record_tracked_link_click` ne dédoublonnait que si le navigateur envoyait un
-- `p_visitor_id` (localStorage `yuno_aff_visitor_id`, posé par le seul parcours
-- affilié) : pour un visiteur ordinaire il valait NULL, donc AUCUNE
-- déduplication — un double chargement de la page de redirection (retour
-- arrière, aperçu de la messagerie, WebView qui recharge) comptait deux fois.
-- Les robots d'aperçu (WhatsApp, Facebook, Telegram…) étaient comptés aussi.
--
-- Désormais, même règle que `crm_link_hit` :
--   * clé visiteur = identifiant du navigateur s'il existe, sinon empreinte
--     serveur salée du jour (IP + user-agent, `links_visitor_context`) ;
--   * même clé sur le même lien en moins de 30 min = rien n'est écrit ;
--   * plus de 30 clics par heure d'une même clé = redirigé sans compter ;
--   * robots d'aperçu et équipe Yuno connectée en super admin = jamais comptés ;
--   * la redirection n'échoue jamais à cause de la mesure.
-- Signature inchangée -> CREATE OR REPLACE.

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
  v_gl_token    text;
  v_gl_event    uuid;
  v_path_event  uuid;
  v_event_host  text;
  v_event_slug  text;
  v_ctx         record;
  v_key         text;
  v_country     text;
  v_ua          text;
  v_count       boolean := true;
  v_flood       integer;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- ── Mesure : jamais bloquante ────────────────────────────────────────────
  BEGIN
    v_ua := left(COALESCE(p_user_agent, ''), 400);

    -- Robots d'aperçu (messageries, réseaux sociaux, moteurs) et outils headless.
    IF v_ua ~* '(bot\M|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedinbot|discord|slack|skype|embedly|pinterest|snapchat|google-?other|lighthouse|headless|curl/|wget/|python-requests|okhttp|axios|node-fetch|go-http-client)' THEN
      v_count := false;
    END IF;

    -- L'équipe Yuno qui teste ses propres liens ne gonfle pas les chiffres.
    IF v_count AND auth.uid() IS NOT NULL AND public.is_super_admin() THEN
      v_count := false;
    END IF;

    IF v_count THEN
      IF NULLIF(btrim(COALESCE(p_visitor_id, '')), '') IS NOT NULL THEN
        v_key := 'c:' || left(btrim(p_visitor_id), 80);
      ELSE
        SELECT * INTO v_ctx FROM public.links_visitor_context();
        v_key := v_ctx.o_hash;
        v_country := v_ctx.o_country;
      END IF;

      SELECT count(*) INTO v_flood FROM public.tracked_link_clicks
       WHERE tracked_link_id = v_link.id AND visitor_id = v_key
         AND clicked_at > now() - interval '1 hour';

      IF v_flood < 30 AND NOT EXISTS (
        SELECT 1 FROM public.tracked_link_clicks
         WHERE tracked_link_id = v_link.id AND visitor_id = v_key
           AND clicked_at > now() - interval '30 minutes'
      ) THEN
        INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type, country)
        VALUES (v_link.id, p_ip_hash, NULLIF(v_ua, ''), left(p_referrer, 200), v_key, p_device_type,
                v_country);
        UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_tracked_link_click: %', SQLERRM;
  END;

  -- ── Résolution de la cible (inchangée) ───────────────────────────────────
  IF v_link.target_kind = 'event' THEN
    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_link.event_id;
  END IF;
  IF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_org_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
  END IF;
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

REVOKE ALL ON FUNCTION public.record_tracked_link_click(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tracked_link_click(text, text, text, text, text, text) TO anon, authenticated, service_role;
