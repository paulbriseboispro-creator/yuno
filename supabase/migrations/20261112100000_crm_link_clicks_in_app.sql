-- Yuno CRM › Trafic, lot C1 (plan docs/designs/TRAFFIC_TAB_PLAN.md, 27/10).
--
-- 1. `tracked_link_clicks.in_app` : le navigateur intégré d'où vient le clic,
--    lu dans le user-agent que `crm_link_hit` (Worker /go/) et
--    `record_tracked_link_click` (page /l/) reçoivent déjà :
--      'instagram' | 'facebook' | 'tiktok' = ouvert dans l'app,
--      'none'                              = un vrai navigateur,
--      NULL                                = user-agent inconnu (clics d'avant).
--    Le user-agent lui-même n'est PAS gardé par /go/ : seule la famille l'est.
--    « Ouvert dans Instagram » ne se calcule donc que sur les clics où la
--    valeur est connue, jamais en comptant un NULL comme « hors Instagram ».
-- (Le bouton des pages /j/ vers Shotgun : migration 20261112105000.)
--
-- Fonctions réécrites depuis pg_get_functiondef de la prod (27/10).

-- ── 1. La colonne et sa règle ────────────────────────────────────────────────
ALTER TABLE public.tracked_link_clicks ADD COLUMN IF NOT EXISTS in_app text;
DO $$ BEGIN
  ALTER TABLE public.tracked_link_clicks
    ADD CONSTRAINT tracked_link_clicks_in_app_chk CHECK (in_app IS NULL OR in_app IN ('instagram', 'facebook', 'tiktok', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Même lecture que `platform_parse_ua` (navigateur Instagram / Facebook /
-- TikTok) ; miroir TS : `linkInApp` (src/crm/lib/traffic.ts).
CREATE OR REPLACE FUNCTION public._link_in_app(p_ua text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_ua, '')), '') IS NULL THEN NULL
    WHEN p_ua ~* 'instagram' THEN 'instagram'
    WHEN p_ua ~* 'fban|fbav|fb_iab' THEN 'facebook'
    WHEN p_ua ~* 'musical_ly|bytedance|tiktok' THEN 'tiktok'
    ELSE 'none' END;
$$;
REVOKE ALL ON FUNCTION public._link_in_app(text) FROM PUBLIC, anon, authenticated;

-- Les clics de la page /l/ gardaient leur user-agent : on rattrape.
UPDATE public.tracked_link_clicks
   SET in_app = public._link_in_app(user_agent)
 WHERE in_app IS NULL AND user_agent IS NOT NULL AND btrim(user_agent) <> '';

-- ── 2. crm_link_hit : pose in_app ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_link_hit(p_code text, p_ip text DEFAULT NULL::text, p_ua text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_count boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link record;
  v_hash text;
  v_device text;
  v_country text;
  v_salt uuid;
  v_recent boolean := false;
  v_flood integer;
  v_ref text;
  v_ctx record;
  v_ua text;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9][A-Za-z0-9-]{2,62}[A-Za-z0-9]$' THEN RETURN NULL; END IF;

  SELECT tl.id, tl.code, tl.is_active, tl.utm_source, tl.utm_medium, e.external_ticket_url
    INTO v_link
    FROM public.tracked_links tl
    JOIN public.events e ON e.id = tl.event_id
   WHERE tl.id = public.tracked_link_id_for_code(p_code)
     AND tl.target_kind = 'event'
     AND e.external_source IS NOT NULL
     AND e.external_ticket_url IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_count AND v_link.is_active THEN
    BEGIN
      IF p_ip IS NULL AND p_ua IS NULL THEN
        SELECT * INTO v_ctx FROM public.links_visitor_context();
        v_hash := v_ctx.o_hash; v_device := v_ctx.o_device; v_country := v_ctx.o_country;
        BEGIN
          v_ua := NULLIF(left(COALESCE(current_setting('request.headers', true)::json->>'user-agent', ''), 400), '');
        EXCEPTION WHEN OTHERS THEN v_ua := NULL;
        END;
      ELSE
        v_ua := left(p_ua, 400);
        INSERT INTO public.platform_daily_salts (day) VALUES (current_date) ON CONFLICT (day) DO NOTHING;
        SELECT salt INTO v_salt FROM public.platform_daily_salts WHERE day = current_date;
        v_hash := 'a:' || encode(sha256(convert_to(
          v_salt::text || COALESCE(left(p_ip, 64), '0.0.0.0') || COALESCE(left(p_ua, 400), ''), 'UTF8')), 'hex');
        SELECT device INTO v_device FROM public.platform_parse_ua(left(p_ua, 400), false);
        v_country := upper(NULLIF(left(btrim(COALESCE(p_country, '')), 2), ''));
        IF v_country IN ('XX', 'T1') THEN v_country := NULL; END IF;
      END IF;

      -- Anti-rafale : au-delà de 30 clics par heure d'un même visiteur sur un
      -- même lien, on redirige sans compter.
      SELECT count(*) INTO v_flood FROM public.tracked_link_clicks
       WHERE tracked_link_id = v_link.id AND visitor_id = v_hash AND clicked_at > now() - interval '1 hour';
      IF v_flood < 30 THEN
        SELECT EXISTS (
          SELECT 1 FROM public.tracked_link_clicks
           WHERE tracked_link_id = v_link.id AND visitor_id = v_hash AND clicked_at > now() - interval '30 minutes'
        ) INTO v_recent;
        -- Seul l'hôte du référent est gardé (« l.instagram.com »), jamais l'URL.
        v_ref := NULLIF(lower(substring(COALESCE(p_referrer, '') FROM '^[a-z]+://([^/:?#]+)')), '');
        INSERT INTO public.tracked_link_clicks (tracked_link_id, visitor_id, device_type, referrer, country, in_app)
        VALUES (v_link.id, v_hash, v_device, left(v_ref, 120), v_country, public._link_in_app(v_ua));
        IF NOT v_recent THEN
          UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- La mesure ne doit jamais empêcher la redirection.
      RAISE WARNING 'crm_link_hit: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'url', v_link.external_ticket_url,
    'source', public.crm_link_source_for(v_link.utm_source, v_link.code),
    'medium', v_link.utm_medium,
    'campaign', 'yuno'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_link_hit(text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_link_hit(text, text, text, text, text, boolean) TO anon, authenticated, service_role;

-- ── 3. record_tracked_link_click : pose in_app ───────────────────────────────
CREATE OR REPLACE FUNCTION public.record_tracked_link_click(p_code text, p_visitor_id text DEFAULT NULL::text, p_device_type text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
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
  SELECT * INTO v_link FROM public.tracked_links
   WHERE id = public.tracked_link_id_for_code(p_code) AND is_active = true;
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
        INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type, country, in_app)
        VALUES (v_link.id, p_ip_hash, NULLIF(v_ua, ''), left(p_referrer, 200), v_key, p_device_type,
                v_country, public._link_in_app(v_ua));
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
    'event_slug',         v_event_slug,
    'utm_source',         v_link.utm_source,
    'utm_medium',         v_link.utm_medium,
    'utm_campaign',       v_link.utm_campaign
  );
END; $function$;
REVOKE ALL ON FUNCTION public.record_tracked_link_click(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tracked_link_click(text, text, text, text, text, text) TO anon, authenticated, service_role;
