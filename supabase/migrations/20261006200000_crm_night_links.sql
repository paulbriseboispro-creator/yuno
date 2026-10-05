-- ============================================================================
-- Yuno CRM — liens suivis d'une soirée vendue sur Shotgun (story, bio, post…).
-- Référence API : docs/designs/SHOTGUN_API_REFERENCE.md.
--
-- Le principe tient en deux mesures, chacune vraie par construction :
--
-- 1. LE CLIC, mesuré par Yuno. Un lien `yunoapp.eu/go/<code>` passe par le
--    Worker Cloudflare, qui appelle `crm_link_hit` (compte le clic sans
--    cookie : empreinte du jour, comme le trafic plateforme) puis redirige
--    tout de suite vers la page Shotgun de la soirée.
-- 2. LA VENTE, rapportée par Shotgun. La redirection ajoute
--    `utm_source=yuno-<code>` : c'est le seul champ de suivi que l'API Tickets
--    rend tel quel (`utm_medium` y est écrasé par la plateforme, `utm_campaign`
--    n'est pas rendu). Un billet qui revient avec cette source a été acheté
--    via CE lien : on sait combien, pour combien, et par qui.
--
-- Ce qu'on ne sait PAS, et que l'écran dit : qui a cliqué sans acheter (le
-- clic est anonyme), et ce que la personne a fait sur la page Shotgun.
--
-- Les liens réutilisent `tracked_links` (owner_kind venue / organizer,
-- target_kind event, event_id = soirée miroir). utm_source = réseau
-- (instagram, tiktok…), utm_medium = emplacement (story, bio…). Un lien n'est
-- jamais désactivé : une story déjà publiée doit toujours mener à la soirée.
-- « Masquer » (`archived_at`) le retire seulement de la liste.
-- ============================================================================

ALTER TABLE public.tracked_links ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.tracked_link_clicks ADD COLUMN IF NOT EXISTS country text;

CREATE INDEX IF NOT EXISTS idx_tracked_link_clicks_link_time
  ON public.tracked_link_clicks (tracked_link_id, clicked_at);
CREATE INDEX IF NOT EXISTS external_tickets_utm_source_idx
  ON public.external_tickets ((lower(utm->>'utm_source'))) WHERE utm IS NOT NULL;

-- ── Source Shotgun d'un lien ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_link_source(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'yuno-' || lower(btrim(p_code));
$$;

-- Source d'un lien selon son canal : un lien posé par une campagne SMS ou
-- e-mail garde sa famille (`yuno-s-…`, `yuno-m-…`), tout le reste est un lien
-- de partage (`yuno-<code>`). Miroir : sourceKind (src/crm/lib/links.ts).
CREATE OR REPLACE FUNCTION public.crm_link_source_for(p_channel text, p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_channel, ''))
           WHEN 'sms' THEN 'yuno-s-' || lower(btrim(p_code))
           WHEN 'newsletter' THEN 'yuno-m-' || lower(btrim(p_code))
           WHEN 'email' THEN 'yuno-m-' || lower(btrim(p_code))
           ELSE public.crm_link_source(p_code) END;
$$;

-- Réseaux et emplacements proposés. Une paire hors liste est refusée.
CREATE OR REPLACE FUNCTION public._crm_link_kind_ok(p_platform text, p_placement text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_platform, p_placement) IN (
    ('instagram', 'story'), ('instagram', 'bio'), ('instagram', 'post'), ('instagram', 'reel'), ('instagram', 'dm'),
    ('tiktok', 'video'), ('tiktok', 'bio'),
    ('whatsapp', 'group'), ('whatsapp', 'message'),
    ('facebook', 'post'), ('facebook', 'event'),
    ('snapchat', 'story'),
    ('other', 'flyer'), ('other', 'partner'), ('other', 'link')
  );
$$;

-- Billet VENDU au sens de Shotgun : statut `valid` (un billet revendu
-- devient `resold` — notre `transferred` — et l'acheteur de la revente reçoit
-- son propre billet `valid` : le compter deux fois doublerait la vente), hors
-- invitations (`deal_channel = 'invitation'`, jamais une vente).
CREATE OR REPLACE FUNCTION public._crm_ticket_is_sale(p_status text, p_raw jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status = 'valid' AND COALESCE(p_raw->>'deal_channel', '') <> 'invitation';
$$;

-- ── Le clic (appelé par le Worker, ou par la page /go/ en repli) ───────────
-- Rend {url, source, medium} pour une soirée Shotgun, NULL sinon. Le Worker
-- passe l'IP et l'user-agent du visiteur (jamais stockés : seule l'empreinte
-- salée du jour l'est). Sans eux (appel depuis le navigateur), l'empreinte
-- vient des en-têtes de la requête. `p_count = false` : robot, aperçu de
-- lien, ou test depuis la Console — on redirige sans compter.

CREATE OR REPLACE FUNCTION public.crm_link_hit(
  p_code text,
  p_ip text DEFAULT NULL,
  p_ua text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_count boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9]{4,16}$' THEN RETURN NULL; END IF;

  SELECT tl.id, tl.code, tl.is_active, tl.utm_source, tl.utm_medium, e.external_ticket_url
    INTO v_link
    FROM public.tracked_links tl
    JOIN public.events e ON e.id = tl.event_id
   WHERE tl.code = lower(p_code)
     AND tl.target_kind = 'event'
     AND e.external_source IS NOT NULL
     AND e.external_ticket_url IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_count AND v_link.is_active THEN
    BEGIN
      IF p_ip IS NULL AND p_ua IS NULL THEN
        SELECT * INTO v_ctx FROM public.links_visitor_context();
        v_hash := v_ctx.o_hash; v_device := v_ctx.o_device; v_country := v_ctx.o_country;
      ELSE
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
        INSERT INTO public.tracked_link_clicks (tracked_link_id, visitor_id, device_type, referrer, country)
        VALUES (v_link.id, v_hash, v_device, left(v_ref, 120), v_country);
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
$$;

REVOKE ALL ON FUNCTION public.crm_link_hit(text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_link_hit(text, text, text, text, text, boolean) TO anon, authenticated, service_role;

-- ── Soirée de la portée (porte commune des RPC ci-dessous) ─────────────────

CREATE OR REPLACE FUNCTION public._crm_link_event_ok(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.external_source IS NOT NULL AND e.external_ticket_url IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id)));
$$;
REVOKE ALL ON FUNCTION public._crm_link_event_ok(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Créer, renommer, masquer ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_link_create(
  p_venue_id text,
  p_organizer_user_id uuid,
  p_event_id uuid,
  p_platform text,
  p_placement text,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
  v_n integer;
  v_row public.tracked_links%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT public._crm_link_kind_ok(p_platform, p_placement) THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_n FROM public.tracked_links WHERE event_id = p_event_id;
  IF v_n >= 300 THEN RAISE EXCEPTION 'too_many_links' USING ERRCODE = '54000'; END IF;

  IF v_label IS NULL THEN
    SELECT count(*) + 1 INTO v_n FROM public.tracked_links
     WHERE event_id = p_event_id AND utm_source = p_platform AND utm_medium = p_placement;
    v_label := initcap(p_placement) || ' ' || v_n;
  END IF;

  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium, utm_campaign)
  VALUES (public.gen_tracked_link_code(), v_label,
          CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
          p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END, auth.uid(),
          'event', p_event_id, p_platform, p_placement, 'yuno')
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label', v_row.label,
    'platform', v_row.utm_source, 'placement', v_row.utm_medium, 'created_at', v_row.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_link_update(
  p_venue_id text,
  p_organizer_user_id uuid,
  p_link_id uuid,
  p_label text DEFAULT NULL,
  p_archived boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.tracked_links%ROWTYPE;
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT tl.* INTO v_row FROM public.tracked_links tl
   WHERE tl.id = p_link_id
     AND public._crm_link_event_ok(p_venue_id, p_organizer_user_id, tl.event_id)
     AND ((p_venue_id IS NOT NULL AND tl.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND tl.organizer_user_id = p_organizer_user_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found' USING ERRCODE = '22023'; END IF;

  UPDATE public.tracked_links
     SET label = COALESCE(v_label, label),
         archived_at = CASE WHEN p_archived IS NULL THEN archived_at
                            WHEN p_archived THEN COALESCE(archived_at, now()) ELSE NULL END
   WHERE id = p_link_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'label', v_row.label, 'archived', v_row.archived_at IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_link_update(text, uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_update(text, uuid, uuid, text, boolean) TO authenticated;

-- ── Lecture : les liens d'une soirée, leurs clics, leurs ventes ────────────
-- Une seule requête (pas de table temporaire : l'aperçu démo est en lecture
-- seule). Montants seulement pour qui voit l'argent.

CREATE OR REPLACE FUNCTION public.crm_night_links(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT tl.id, tl.code, tl.label, tl.utm_source AS platform, tl.utm_medium AS placement,
           tl.created_at, tl.archived_at, public.crm_link_source(tl.code) AS src
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
           COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.price, t.status, t.raw,
           NULLIF(btrim(t.buyer_first_name), '') AS first_name, NULLIF(btrim(t.buyer_last_name), '') AS last_name,
           lower(t.utm->>'utm_source') AS src
      FROM public.external_tickets t
     WHERE (p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id)
  ),
  first_buy AS (
    SELECT email, min(bought_at) AS first_at FROM scope_tk
     WHERE email IS NOT NULL AND public._crm_ticket_is_sale(status, raw)
     GROUP BY email
  ),
  ev_tk AS (
    SELECT s.*, public._crm_ticket_is_sale(s.status, s.raw) AS sale,
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
$$;

REVOKE ALL ON FUNCTION public.crm_night_links(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_links(text, uuid, uuid) TO authenticated;

-- Une session d'aperçu démo est en lecture seule : la lecture des liens y est
-- ouverte (aucune écriture). Création et modification y restent refusées.
