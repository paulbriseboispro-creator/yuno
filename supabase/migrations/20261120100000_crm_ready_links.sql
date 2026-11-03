-- Yuno CRM : les liens suivis d'une soirée sont PRÊTS sans rien faire
-- (décision de Paul du 03/11/2026 : « le max de data sans effort »).
--
-- Pour chaque soirée miroir À VENIR (soirée Shotgun d'un compte connecté),
-- Yuno pose seul :
--   • les liens courants : lien en bio Instagram, story Instagram (un lien
--     général), lien en bio TikTok, groupe WhatsApp, événement Facebook ;
--   • un lien de partage par GUEST LIST (tarif Shotgun à 0 € vendu en ligne,
--     public ou privé), qui ouvre la page Shotgun sur ce tarif (`?ids=`).
-- Le pro ne crée plus que ses liens SPÉCIAUX (une story nommée, un partenaire,
-- un flyer) : crm_link_create ne change pas.
--
-- Règles validées par Paul :
--   1. Seulement les soirées à venir : une soirée passée n'en reçoit pas.
--   2. Un lien prêt jamais utilisé (ni clic, ni vente) reste INVISIBLE dans les
--      chiffres : pas de repère sur la courbe, pas de ligne à zéro, ne fait pas
--      sortir Trafic de son état vide (crm_ana_clicks__core).
--
-- Création : `_crm_ensure_ready_links(soirée)`, appelée par un déclencheur sur
-- external_events (création du miroir, tarifs changés : une guest list ouverte
-- chez Shotgun reçoit son lien à la synchro suivante), puis rattrapage des
-- soirées à venir ci-dessous. Elle ne lève jamais : la synchro passe toujours.
-- Un lien en bio déjà créé à la main est ADOPTÉ (jamais deux liens en bio).

ALTER TABLE public.tracked_links
  ADD COLUMN IF NOT EXISTS auto_key text,
  ADD COLUMN IF NOT EXISTS ext_deal_id text;

ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_auto_key_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_auto_key_chk
  CHECK (auto_key IS NULL OR auto_key ~ '^(ig_bio|ig_story|tt_bio|wa|fb_event|gl:[A-Za-z0-9_-]{1,40})$');
ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_ext_deal_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_ext_deal_chk
  CHECK (ext_deal_id IS NULL OR ext_deal_id ~ '^[A-Za-z0-9_-]{1,40}$');

CREATE UNIQUE INDEX IF NOT EXISTS tracked_links_event_auto_key_uq
  ON public.tracked_links (event_id, auto_key) WHERE auto_key IS NOT NULL;

COMMENT ON COLUMN public.tracked_links.auto_key IS
  'Lien posé par Yuno pour une soirée miroir (ig_bio, ig_story, tt_bio, wa, fb_event, gl:<tarif Shotgun>). Écrit par _crm_ensure_ready_links seulement.';
COMMENT ON COLUMN public.tracked_links.ext_deal_id IS
  'Tarif Shotgun visé par le lien (/go/ ouvre la page sur ?ids=<tarif>).';

-- Un client (Console, PostgREST) ne pose ni ne change ces deux colonnes : elles
-- décident de la destination d'un lien et de son rangement. Garde INVOKER sur
-- current_user (règle des gardes : jamais SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.guard_tracked_link_auto_cols()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.auto_key := NULL;
      NEW.ext_deal_id := NULL;
    ELSE
      NEW.auto_key := OLD.auto_key;
      NEW.ext_deal_id := OLD.ext_deal_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tracked_link_auto_cols() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tracked_links_auto_guard ON public.tracked_links;
CREATE TRIGGER trg_tracked_links_auto_guard
  BEFORE INSERT OR UPDATE ON public.tracked_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_tracked_link_auto_cols();

-- Destination d'un lien de soirée : la page Shotgun, ouverte sur un tarif si
-- le lien en vise un. Même règle pour /go/ et pour le lien « e-mail » d'une
-- guest list (Console) : les deux ouvrent la même page.
CREATE OR REPLACE FUNCTION public._crm_link_dest(p_url text, p_deal text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
           WHEN p_url IS NULL THEN NULL
           WHEN p_deal IS NULL OR p_deal !~ '^[A-Za-z0-9_-]{1,40}$' THEN p_url
           ELSE regexp_replace(p_url, '#.*$', '')
                || CASE WHEN position('?' IN p_url) > 0 THEN '&' ELSE '?' END
                || 'ids=' || p_deal
         END;
$$;
REVOKE ALL ON FUNCTION public._crm_link_dest(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_link_dest(text, text) TO authenticated, service_role;

-- Les guest lists d'une soirée miroir : tarifs Shotgun à 0 € vendus EN LIGNE
-- (une entrée « sur place » n'a pas de page), publics ou privés.
CREATE OR REPLACE FUNCTION public._crm_event_guestlist_deals(p_event_id uuid)
RETURNS TABLE(did text, name text, ord bigint, quantity integer, is_public boolean)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT btrim(x.j->>'id'), btrim(x.j->>'name'), x.ord,
         CASE WHEN x.j->>'quantity' ~ '^[0-9]+$' THEN (x.j->>'quantity')::integer END,
         COALESCE(NULLIF(lower(btrim(x.j->>'visibility')), ''), 'public') = 'public'
    FROM public.external_events ee,
         jsonb_array_elements(CASE WHEN jsonb_typeof(ee.deals) = 'array' THEN ee.deals ELSE '[]'::jsonb END)
           WITH ORDINALITY AS x(j, ord)
   WHERE ee.event_id = p_event_id
     AND x.j->>'price' ~ '^[0-9]+(\.[0-9]+)?$' AND (x.j->>'price')::numeric = 0
     AND COALESCE(lower(x.j->>'sales_channel'), 'online') = 'online'
     AND btrim(COALESCE(x.j->>'id', '')) ~ '^[A-Za-z0-9_-]{1,40}$'
     AND NULLIF(btrim(x.j->>'name'), '') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public._crm_event_guestlist_deals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_event_guestlist_deals(uuid) TO service_role;

-- Les liens courants, dans l'ordre de la Console. Libellé = ce que les autres
-- écrans (Ventes, Trafic) affichent ; la Console nomme par `auto_key`.
CREATE OR REPLACE FUNCTION public._crm_ready_link_specs()
RETURNS TABLE(auto_key text, platform text, placement text, label text, single boolean, ord integer)
LANGUAGE sql
IMMUTABLE
AS $$
  VALUES ('ig_bio', 'instagram', 'bio', 'Lien en bio Instagram', true, 1),
         ('ig_story', 'instagram', 'story', 'Story Instagram', false, 2),
         ('tt_bio', 'tiktok', 'bio', 'Lien en bio TikTok', true, 3),
         ('wa', 'whatsapp', 'group', 'Groupe WhatsApp', false, 4),
         ('fb_event', 'facebook', 'event', 'Événement Facebook', true, 5);
$$;
REVOKE ALL ON FUNCTION public._crm_ready_link_specs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_ready_link_specs() TO service_role;

CREATE OR REPLACE FUNCTION public._crm_ensure_ready_links(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e record;
  r record;
  v_owner uuid;
  v_adopt uuid;
  v_n integer := 0;
BEGIN
  SELECT ev.id, ev.venue_id, ev.organizer_user_id
    INTO e
    FROM public.events ev
   WHERE ev.id = p_event_id
     AND ev.external_source IS NOT NULL
     AND ev.cancelled_at IS NULL
     AND COALESCE(ev.external_ticket_url, '') ~ '^https://'
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') > now();
  IF NOT FOUND OR (e.venue_id IS NULL AND e.organizer_user_id IS NULL) THEN RETURN 0; END IF;

  IF e.venue_id IS NOT NULL THEN
    SELECT v.owner_id INTO v_owner FROM public.venues v WHERE v.id = e.venue_id;
  ELSE
    v_owner := e.organizer_user_id;
  END IF;
  IF v_owner IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT s.auto_key, s.platform, s.placement, s.label, s.single, NULL::text AS deal, s.ord::bigint AS ord
      FROM public._crm_ready_link_specs() s
    UNION ALL
    SELECT 'gl:' || g.did, 'other', 'link', g.name, false, g.did, 100 + g.ord
      FROM public._crm_event_guestlist_deals(p_event_id) g
     ORDER BY ord
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.tracked_links tl WHERE tl.event_id = p_event_id AND tl.auto_key = r.auto_key);
    BEGIN
      v_adopt := NULL;
      -- Un lien unique (bio, événement) déjà créé à la main devient le lien prêt.
      IF r.single THEN
        SELECT tl.id INTO v_adopt
          FROM public.tracked_links tl
         WHERE tl.event_id = p_event_id AND tl.target_kind = 'event' AND tl.auto_key IS NULL
           AND tl.utm_source = r.platform AND tl.utm_medium = r.placement
           AND tl.archived_at IS NULL AND tl.partner_name IS NULL
           AND tl.venue_id IS NOT DISTINCT FROM e.venue_id
           AND (e.venue_id IS NOT NULL OR tl.organizer_user_id = e.organizer_user_id)
         ORDER BY tl.created_at
         LIMIT 1;
      END IF;
      IF v_adopt IS NOT NULL THEN
        UPDATE public.tracked_links SET auto_key = r.auto_key WHERE id = v_adopt;
      ELSE
        INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                          target_kind, event_id, utm_source, utm_medium, utm_campaign,
                                          auto_key, ext_deal_id)
        VALUES ('', left(r.label, 60), CASE WHEN e.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
                e.venue_id, CASE WHEN e.venue_id IS NULL THEN e.organizer_user_id END, v_owner,
                'event', p_event_id, r.platform, r.placement, 'yuno', r.auto_key, r.deal);
      END IF;
      v_n := v_n + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- posé entre-temps par une autre passe
    END;
  END LOOP;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_crm_ensure_ready_links(%): %', p_event_id, SQLERRM;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_ensure_ready_links(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_ensure_ready_links(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_external_events_ready_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.event_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.deals IS DISTINCT FROM OLD.deals) THEN
    PERFORM public._crm_ensure_ready_links(NEW.event_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_external_events_ready_links: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_external_events_ready_links() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_external_events_ready_links ON public.external_events;
CREATE TRIGGER trg_external_events_ready_links
  AFTER INSERT OR UPDATE OF event_id, deals ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_external_events_ready_links();

-- /go/ : un lien de guest list ouvre la page Shotgun sur son tarif.
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

  SELECT tl.id, tl.code, tl.is_active, tl.utm_source, tl.utm_medium, tl.ext_deal_id, e.external_ticket_url
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
    -- Lien d'une guest list : la page Shotgun ouverte sur CE tarif (`?ids=`).
    'url', public._crm_link_dest(v_link.external_ticket_url, v_link.ext_deal_id),
    'source', public.crm_link_source_for(v_link.utm_source, v_link.code),
    'medium', v_link.utm_medium,
    'campaign', 'yuno'
  );
END;
$function$

;

-- crm_night_links : les liens prêts sont marqués (`auto`, `deal_id`) et la
-- soirée rend ses guest lists avec leurs deux liens.
CREATE OR REPLACE FUNCTION public.crm_night_links(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_money boolean := public.crm_scope_sees_money(p_venue_id, p_organizer_user_id);
  v_ev record;
  v_tz text;
  v_today date;
  v_out jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT e.id, e.title, e.start_at, e.end_at, e.external_ticket_url, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz
    INTO v_ev FROM public.events e WHERE e.id = p_event_id;
  v_tz := v_ev.tz;
  v_today := (now() AT TIME ZONE v_tz)::date;

  WITH links AS (
    SELECT tl.id, tl.code, tl.label, tl.utm_source AS platform, tl.utm_medium AS placement, tl.image_url,
           tl.created_at, tl.archived_at, tl.auto_key, tl.ext_deal_id, public.crm_link_source(tl.code) AS src
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id AND tl.target_kind = 'event'
       -- Liens de partage seulement : les liens techniques d'une campagne
       -- (SMS, e-mail) vivent dans le résultat de la campagne.
       AND public._crm_link_kind_ok(tl.utm_source, tl.utm_medium)
       AND ((p_venue_id IS NOT NULL AND tl.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND tl.organizer_user_id = p_organizer_user_id))
  ),
  clicks AS (
    SELECT c.tracked_link_id AS link_id, c.clicked_at, c.visitor_id, c.device_type, c.country
      FROM public.tracked_link_clicks c JOIN links l ON l.id = c.tracked_link_id
  ),
  -- Tous les billets de l'espace (pour « nouveau client » : aucun billet
  -- vendu avant celui-ci dans l'espace).
  scope_tk AS (
    SELECT t.id, t.event_id, lower(t.buyer_email) AS email, t.external_order_id,
           COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.price, t.status, t.deal_channel,
           NULLIF(btrim(t.buyer_first_name), '') AS first_name, NULLIF(btrim(t.buyer_last_name), '') AS last_name,
           lower(t.utm->>'utm_source') AS src
      FROM public.external_tickets t
     WHERE (p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id)
  ),
  first_buy AS (
    SELECT email, min(bought_at) AS first_at FROM scope_tk
     WHERE email IS NOT NULL AND public._crm_ticket_is_sale(status, deal_channel)
     GROUP BY email
  ),
  ev_tk AS (
    SELECT s.*, public._crm_ticket_is_sale(s.status, s.deal_channel) AS sale,
           (s.email IS NOT NULL AND f.first_at = s.bought_at) AS is_new
      FROM scope_tk s LEFT JOIN first_buy f ON f.email = s.email
     WHERE s.event_id = p_event_id
  ),
  link_tk AS (
    SELECT l.id AS link_id, t.* FROM links l JOIN ev_tk t ON t.src = l.src AND t.sale
  ),
  per_link AS (
    SELECT l.id,
           jsonb_build_object(
             'id', l.id, 'code', l.code, 'label', l.label, 'platform', l.platform, 'placement', l.placement,
             'image_url', l.image_url,
             -- Lien posé par Yuno (`ig_bio`, `gl:<tarif>`…) : la Console le range dans « Tes liens prêts ».
             'auto', l.auto_key, 'deal_id', l.ext_deal_id,
             'source', l.src, 'created_at', l.created_at, 'archived', l.archived_at IS NOT NULL,
             'clicks', (SELECT count(*) FROM clicks c WHERE c.link_id = l.id),
             'visitors', (SELECT count(DISTINCT c.visitor_id) FROM clicks c WHERE c.link_id = l.id),
             'clicks_24h', (SELECT count(*) FROM clicks c WHERE c.link_id = l.id AND c.clicked_at > now() - interval '24 hours'),
             'last_click_at', (SELECT max(c.clicked_at) FROM clicks c WHERE c.link_id = l.id),
             'mobile_pct', (SELECT CASE WHEN count(*) >= 10 THEN round(100.0 * count(*) FILTER (WHERE c.device_type = 'mobile') / count(*)) END
                              FROM clicks c WHERE c.link_id = l.id),
             'spark', (SELECT jsonb_agg(COALESCE(x.n, 0) ORDER BY g.d)
                         FROM generate_series(v_today - 13, v_today, interval '1 day') g(d)
                         LEFT JOIN LATERAL (
                           SELECT count(*) AS n FROM clicks c
                            WHERE c.link_id = l.id AND (c.clicked_at AT TIME ZONE v_tz)::date = g.d::date) x ON true),
             'tickets', (SELECT count(*) FROM link_tk k WHERE k.link_id = l.id),
             'orders', (SELECT count(DISTINCT COALESCE(k.external_order_id, k.id::text)) FROM link_tk k WHERE k.link_id = l.id),
             'revenue', CASE WHEN v_money THEN (SELECT COALESCE(round(sum(k.price), 2), 0) FROM link_tk k WHERE k.link_id = l.id) END,
             'buyers', (SELECT count(DISTINCT k.email) FROM link_tk k WHERE k.link_id = l.id),
             'new_buyers', (SELECT count(DISTINCT k.email) FROM link_tk k WHERE k.link_id = l.id AND k.is_new),
             'first_sale_at', (SELECT min(k.bought_at) FROM link_tk k WHERE k.link_id = l.id),
             'people', COALESCE((
               SELECT jsonb_agg(p ORDER BY p->>'at' DESC) FROM (
                 SELECT jsonb_build_object(
                          'email', k.email,
                          'name', NULLIF(btrim(COALESCE(max(k.first_name), '') || ' ' ||
                                  COALESCE(left(max(k.last_name), 1) || '.', '')), ''),
                          'tickets', count(*),
                          'is_new', bool_or(k.is_new),
                          'at', max(k.bought_at)) AS p
                   FROM link_tk k WHERE k.link_id = l.id AND k.email IS NOT NULL
                  GROUP BY k.email ORDER BY max(k.bought_at) DESC LIMIT 30) z), '[]'::jsonb)
           ) AS j
      FROM links l
  ),
  -- Toutes les sources que Shotgun rapporte pour les billets vendus de la soirée.
  sources AS (
    SELECT COALESCE(t.src, '') AS src, count(*) AS tickets,
           count(DISTINCT COALESCE(t.external_order_id, t.id::text)) AS orders,
           round(sum(t.price), 2) AS revenue
      FROM ev_tk t WHERE t.sale GROUP BY 1
  ),
  days AS (
    SELECT g.d::date AS d,
           (SELECT count(*) FROM clicks c WHERE (c.clicked_at AT TIME ZONE v_tz)::date = g.d::date) AS clicks,
           (SELECT count(*) FROM link_tk k WHERE (k.bought_at AT TIME ZONE v_tz)::date = g.d::date) AS tickets
      FROM generate_series(v_today - 13, v_today, interval '1 day') g(d)
  )
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at,
                                'upcoming', COALESCE(v_ev.end_at, v_ev.start_at + interval '6 hours') > now(),
                                'url', v_ev.external_ticket_url, 'tz', v_tz),
    'can_write', public.crm_scope_writable(p_venue_id, p_organizer_user_id),
    'sees_money', v_money,
    'links', COALESCE((SELECT jsonb_agg(p.j ORDER BY (p.j->>'created_at') DESC) FROM per_link p), '[]'::jsonb),
    -- Les guest lists de la soirée (tarifs Shotgun à 0 € vendus en ligne) :
    -- le lien direct pour un e-mail (Yuno y pose le suivi de la campagne à
    -- l'envoi) et le lien de partage que Yuno a créé pour chacune.
    'guestlists', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', g.did, 'name', g.name, 'public', g.is_public, 'quantity', g.quantity,
               'taken', tk.n,
               'out', (g.quantity IS NOT NULL AND g.quantity > 0 AND tk.n >= g.quantity),
               'email_url', public._crm_link_dest(v_ev.external_ticket_url, g.did),
               'link_id', (SELECT l.id FROM links l WHERE l.auto_key = 'gl:' || g.did LIMIT 1))
             ORDER BY (g.quantity IS NOT NULL AND g.quantity > 0 AND tk.n >= g.quantity), g.ord)
        FROM public._crm_event_guestlist_deals(p_event_id) g
        CROSS JOIN LATERAL (
          SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0)::integer AS n
            FROM public.external_tickets t
           WHERE t.event_id = p_event_id
             AND public._crm_ticket_is_sale(t.status, t.deal_channel)
             AND (t.deal_id = g.did OR (t.deal_id IS NULL AND lower(btrim(t.deal_name)) = lower(g.name)))) tk
    ), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'source', NULLIF(s.src, ''), 'tickets', s.tickets, 'orders', s.orders,
                  'revenue', CASE WHEN v_money THEN s.revenue END) ORDER BY s.tickets DESC) FROM sources s), '[]'::jsonb),
    'totals', jsonb_build_object(
      'tickets', (SELECT count(*) FROM ev_tk WHERE sale),
      'with_source', (SELECT count(*) FROM ev_tk WHERE sale AND src IS NOT NULL),
      'link_tickets', (SELECT count(*) FROM link_tk),
      'link_revenue', CASE WHEN v_money THEN (SELECT COALESCE(round(sum(price), 2), 0) FROM link_tk) END,
      'clicks', (SELECT count(*) FROM clicks),
      'visitors', (SELECT count(DISTINCT visitor_id) FROM clicks)),
    'series', (SELECT jsonb_agg(jsonb_build_object('d', d, 'clicks', clicks, 'tickets', tickets) ORDER BY d) FROM days),
    -- Shotgun a-t-il déjà rendu un billet portant une source de lien Yuno,
    -- toutes soirées de l'espace confondues ? Tant que non, l'écran ne dit
    -- jamais « 0 vente » mais « en attente du premier retour de Shotgun ».
    'confirmed', EXISTS (SELECT 1 FROM scope_tk WHERE src LIKE 'yuno-%' AND src !~ '^yuno-[msd]-'),
    'synced_at', (SELECT max(c.last_ok_at) FROM public.ticketing_connections c
                   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  ) INTO v_out;

  RETURN v_out;
END;
$function$

;

-- Trafic (crm_ana_clicks__core) : un lien prêt jamais cliqué ni vendeur ne
-- compte pas. Remplacement CIBLÉ dans la définition vivante (comme _mcp_tool) :
-- chaque morceau doit être trouvé, sinon la migration échoue.
DO $mig$
DECLARE
  v_def text;
  v_new text;
  v_parts text[][] := ARRAY[
    ARRAY['           tl.created_at, tl.event_id, tl.archived_at,
           public._crm_ana_click_family(tl.utm_source, tl.utm_medium) AS fam,',
          '           tl.created_at, tl.event_id, tl.archived_at, tl.auto_key,
           public._crm_ana_click_family(tl.utm_source, tl.utm_medium) AS fam,'],
    -- Repères de la courbe : la création d'un lien prêt n'est pas un geste du pro.
    ARRAY['WHERE l.fam IN (''ys'', ''yb'', ''yt'', ''pa'', ''yl'') AND l.placement <> ''page''',
          'WHERE l.fam IN (''ys'', ''yb'', ''yt'', ''pa'', ''yl'') AND l.placement <> ''page'' AND l.auto_key IS NULL'],
    -- « Les liens de cette soirée » : pas de ligne à zéro pour un lien prêt.
    ARRAY['WHERE v_mode = ''event'' AND l.event_id = v_eid AND l.archived_at IS NULL',
          'WHERE v_mode = ''event'' AND l.event_id = v_eid AND l.archived_at IS NULL
       AND (l.auto_key IS NULL OR COALESCE(lo.orders, 0) > 0)'],
    -- État vide : un lien prêt seul ne fait pas « des données ».
    ARRAY['''has_any'', EXISTS (SELECT 1 FROM lk) OR',
          '''has_any'', EXISTS (SELECT 1 FROM lk WHERE lk.auto_key IS NULL) OR EXISTS (SELECT 1 FROM links_out) OR']
  ];
  i int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'crm_ana_clicks__core';
  IF v_def IS NULL THEN RAISE EXCEPTION 'crm_ana_clicks__core introuvable'; END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(v_parts, 1) LOOP
    IF (length(v_new) - length(replace(v_new, v_parts[i][1], ''))) / length(v_parts[i][1]) <> 1 THEN
      RAISE EXCEPTION 'crm_ana_clicks__core : morceau % introuvable ou en double', i;
    END IF;
    v_new := replace(v_new, v_parts[i][1], v_parts[i][2]);
  END LOOP;
  EXECUTE v_new;
END
$mig$;

-- Rattrapage : toutes les soirées miroirs à venir.
DO $mig$
DECLARE r record; v_total integer := 0;
BEGIN
  FOR r IN
    SELECT e.id FROM public.events e
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') > now()
  LOOP
    v_total := v_total + public._crm_ensure_ready_links(r.id);
  END LOOP;
  RAISE NOTICE 'liens prêts posés : %', v_total;
END
$mig$;
