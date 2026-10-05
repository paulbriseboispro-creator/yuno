-- ============================================================================
-- Yuno CRM — une story se nomme, et peut porter sa photo.
--
-- Pour retrouver QUELLE story a converti, le pro la nomme à la création
-- (« Story line-up », « Story dernières places ») et peut joindre la capture
-- de la story : elle s'affiche à côté du lien, dans la liste. La photo vit dans
-- le bucket public `email-assets` (même porte d'upload que l'Email Studio) ;
-- seule son URL https est gardée.
-- ============================================================================

ALTER TABLE public.tracked_links ADD COLUMN IF NOT EXISTS image_url text;

-- Ajouter un paramètre = DROP + CREATE : une surcharge rendrait ambigus les
-- appels à arguments nommés (erreur 300).
DROP FUNCTION IF EXISTS public.crm_link_create(text, uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.crm_link_create(
  p_venue_id text,
  p_organizer_user_id uuid,
  p_event_id uuid,
  p_platform text,
  p_placement text,
  p_label text DEFAULT NULL,
  p_image_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
  v_n integer;
  v_image text := CASE WHEN p_image_url ~ '^https://[^[:space:]]{1,480}$' THEN p_image_url END;
  v_row public.tracked_links%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT public._crm_link_creatable(p_platform, p_placement) THEN
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
                                    target_kind, event_id, utm_source, utm_medium, utm_campaign, image_url)
  VALUES (public.gen_tracked_link_code(), v_label,
          CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
          p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END, auth.uid(),
          'event', p_event_id, p_platform, p_placement, 'yuno', v_image)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label', v_row.label,
    'platform', v_row.utm_source, 'placement', v_row.utm_medium, 'created_at', v_row.created_at,
    'image_url', v_row.image_url);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text, text) TO authenticated;

-- Lecture : chaque lien rend aussi `image_url`.
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
    SELECT tl.id, tl.code, tl.label, tl.utm_source AS platform, tl.utm_medium AS placement, tl.image_url,
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
             'image_url', l.image_url,
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

NOTIFY pgrst, 'reload schema';
