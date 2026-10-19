-- ============================================================================
-- get_visit_analytics : les visites d'une portée, comptées par la BASE.
--
-- « De la visite à l'achat » (Console Organisateur), « Comportement » et
-- « Acquisition » (Trafic › Ma page, club et organisateur) lisaient
-- `visitor_sessions` ligne à ligne depuis le navigateur, avec `.limit(10000)`.
-- PostgREST plafonne une réponse à 1 000 lignes : au-delà de 1 000 visites sur
-- la période, chaque chiffre de ces écrans était faux sans le dire. Ici, tout
-- est agrégé en une passe, avec les portes d'analyse existantes.
--
-- Portée (même règle que la Vue en direct, `get_live_view`) :
--   club          = visites posées sur le club + visites de ses soirées
--   organisateur  = visites de son profil + visites de ses soirées (menées,
--                   partenaire, co-organisées) — plus les pages des clubs qui
--                   l'ont accueilli, qui ne sont pas ses visites
--   soirée        = visites de la page de la soirée
-- Étapes (migration 20261104120000) : panier = a choisi un billet / une
-- formule / s'est inscrite ; paiement = a ouvert la page de paiement ;
-- achat = une vente payée est née de la visite.
-- Durée et défilement : moyennes sur les seules visites où ils sont connus
-- (jamais écrits entre août et le 19/10). Taux de rebond seulement à partir de
-- 10 visites à durée connue. Montants (valeur des paniers) : à qui voit
-- l'argent seulement.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_visit_analytics(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_source text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g       record;
  v_venue text;
  v_org   uuid;
  v_money boolean := false;
  v_tz    text := 'Europe/Paris';
  v_ids   uuid[] := '{}';
  v_from  timestamptz := COALESCE(p_from, '-infinity'::timestamptz);
  v_to    timestamptz := COALESCE(p_to, 'infinity'::timestamptz);
  v_dev   text := NULLIF(NULLIF(btrim(COALESCE(p_device, '')), ''), 'all');
  v_src   text := NULLIF(NULLIF(btrim(COALESCE(p_source, '')), ''), 'all');
  v_res   jsonb;
BEGIN
  IF p_event_id IS NOT NULL THEN
    SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
    IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
    v_money := g.money;
    SELECT COALESCE(ev.timezone, v.timezone, 'Europe/Paris') INTO v_tz
      FROM public.events ev
      LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
     WHERE ev.id = p_event_id;
  ELSE
    SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
    IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
    v_venue := g.scope_venue;
    v_org   := g.scope_org;
    v_money := g.money;
    v_tz    := COALESCE(g.tz, 'Europe/Paris');
    v_ids   := COALESCE(g.scope_ids, '{}');
  END IF;

  WITH
  s AS MATERIALIZED (
    SELECT s.visited_at, s.visitor_id,
           COALESCE(s.added_to_cart, false) AS cart,
           COALESCE(s.proceeded_to_checkout, false) AS checkout,
           COALESCE(s.completed_order, false) AS done,
           s.duration_seconds, s.scroll_depth_max, COALESCE(s.pages_viewed, 1) AS pages,
           COALESCE(s.cart_value_cents, 0) AS cart_cents,
           s.device_type,
           COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS source,
           NULLIF(s.referrer_domain, '') AS domain,
           NULLIF(s.country, '') AS country,
           NULLIF(s.utm_source, '') AS utm_source,
           NULLIF(s.utm_medium, '') AS utm_medium,
           NULLIF(s.utm_campaign, '') AS utm_campaign
      FROM public.visitor_sessions s
     WHERE s.visited_at >= v_from AND s.visited_at <= v_to
       AND (CASE
              WHEN p_event_id IS NOT NULL THEN s.event_id = p_event_id
              ELSE (v_venue IS NOT NULL AND s.venue_id = v_venue)
                OR (v_org IS NOT NULL AND s.organizer_user_id = v_org)
                OR s.event_id = ANY (v_ids)
            END)
       AND (v_dev IS NULL OR s.device_type = v_dev)
       AND (v_src IS NULL OR COALESCE(NULLIF(s.referrer_category, ''), 'direct') = v_src)
  ),
  known AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE duration_seconds < 10 AND pages <= 1) AS bounced
      FROM s WHERE duration_seconds IS NOT NULL AND duration_seconds > 0
  ),
  hours AS (
    SELECT (extract(isodow FROM visited_at AT TIME ZONE v_tz)::int - 1) AS d,
           extract(hour FROM visited_at AT TIME ZONE v_tz)::int AS h,
           count(*) AS n
      FROM s GROUP BY 1, 2
  ),
  matrix AS (
    SELECT jsonb_agg(row_j ORDER BY d) AS m
      FROM (
        SELECT dd.d, jsonb_agg(COALESCE(hh.n, 0) ORDER BY hr.h) AS row_j
          FROM generate_series(0, 6) AS dd(d)
          CROSS JOIN generate_series(0, 23) AS hr(h)
          LEFT JOIN hours hh ON hh.d = dd.d AND hh.h = hr.h
         GROUP BY dd.d
      ) x
  )
  SELECT jsonb_build_object(
    'ok', true,
    'tz', v_tz,
    'money', v_money,
    'visits', (SELECT count(*) FROM s),
    'uniqueVisitors', (SELECT count(DISTINCT visitor_id) FROM s WHERE visitor_id IS NOT NULL),
    'carts', (SELECT count(*) FROM s WHERE cart),
    'checkouts', (SELECT count(*) FROM s WHERE checkout),
    'conversions', (SELECT count(*) FROM s WHERE done),
    'abandonedCarts', (SELECT count(*) FROM s WHERE cart AND NOT done),
    'abandonedValueCents', CASE WHEN v_money THEN (SELECT COALESCE(sum(cart_cents), 0) FROM s WHERE cart AND NOT done) END,
    'knownDuration', (SELECT n FROM known),
    'avgDuration', (SELECT round(avg(duration_seconds))::int FROM s WHERE duration_seconds > 0),
    'avgScroll', (SELECT round(avg(scroll_depth_max))::int FROM s WHERE duration_seconds > 0 AND scroll_depth_max IS NOT NULL),
    'bounceRate', (SELECT CASE WHEN n >= 10 THEN round(100.0 * bounced / n)::int END FROM known),
    'devices', jsonb_build_object(
      'mobile', (SELECT count(*) FROM s WHERE device_type = 'mobile'),
      'tablet', (SELECT count(*) FROM s WHERE device_type = 'tablet'),
      'desktop', (SELECT count(*) FROM s WHERE device_type = 'desktop')
    ),
    'hourMatrix', (SELECT m FROM matrix),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', x.source, 'visits', x.n, 'carts', x.c, 'conversions', x.o) ORDER BY x.n DESC, x.source)
        FROM (SELECT source, count(*) AS n, count(*) FILTER (WHERE cart) AS c, count(*) FILTER (WHERE done) AS o
                FROM s GROUP BY source) x
    ), '[]'::jsonb),
    'referrers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('domain', x.domain, 'visits', x.n) ORDER BY x.n DESC, x.domain)
        FROM (SELECT domain, count(*) AS n FROM s WHERE domain IS NOT NULL GROUP BY domain ORDER BY 2 DESC, 1 LIMIT 8) x
    ), '[]'::jsonb),
    'countries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('country', x.country, 'visits', x.n) ORDER BY x.n DESC, x.country)
        FROM (SELECT country, count(*) AS n FROM s WHERE country IS NOT NULL GROUP BY country ORDER BY 2 DESC, 1 LIMIT 8) x
    ), '[]'::jsonb),
    'utms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'source', x.us, 'medium', x.um, 'campaign', x.uc,
               'visits', x.n, 'conversions', x.o,
               'revenueCents', CASE WHEN v_money THEN x.v END) ORDER BY x.n DESC, x.us, x.um, x.uc)
        FROM (SELECT COALESCE(utm_source, '-') AS us, COALESCE(utm_medium, '-') AS um, COALESCE(utm_campaign, '-') AS uc,
                     count(*) AS n, count(*) FILTER (WHERE done) AS o,
                     COALESCE(sum(cart_cents) FILTER (WHERE done), 0) AS v
                FROM s WHERE utm_source IS NOT NULL OR utm_campaign IS NOT NULL
               GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1, 2, 3 LIMIT 20) x
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_visit_analytics(text, uuid, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visit_analytics(text, uuid, uuid, timestamptz, timestamptz, text, text) TO authenticated;

-- ============================================================================
-- « En ligne » : les visiteurs présents EN CE MOMENT (battement < 75 s), comme
-- la Vue en direct. La pastille des pages Analytics comptait les visites
-- OUVERTES dans les 5 dernières minutes, en lisant la table depuis le
-- navigateur (zéro pour un manager ou un membre d'équipe, que la RLS ne laisse
-- pas lire).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_visitors_now(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g     record;
  v_ids uuid[] := '{}';
  v_n   integer;
BEGIN
  IF p_event_id IS NOT NULL THEN
    SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
    IF NOT g.ok THEN RETURN NULL; END IF;
    SELECT count(DISTINCT p.session_id) INTO v_n
      FROM public.live_visitor_pings p
     WHERE p.last_seen > now() - interval '75 seconds' AND p.event_id = p_event_id;
    RETURN v_n;
  END IF;

  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN NULL; END IF;
  v_ids := COALESCE(g.scope_ids, '{}');
  SELECT count(DISTINCT p.session_id) INTO v_n
    FROM public.live_visitor_pings p
   WHERE p.last_seen > now() - interval '75 seconds'
     AND (   (g.scope_venue IS NOT NULL AND p.venue_id = g.scope_venue)
          OR (g.scope_org IS NOT NULL AND p.organizer_user_id = g.scope_org)
          OR p.event_id = ANY (v_ids));
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_visitors_now(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitors_now(text, uuid, uuid) TO authenticated;

-- ============================================================================
-- Vue en direct : une vente se place sur le globe par SA visite
-- (`tracking_visit_sid`), billets, tables et inscriptions. L'ancienne jointure
-- passait par `visitor_sessions.order_id`, une clé vers les commandes du bar :
-- aucun billet ni aucune table ne pouvait y être, donc aucune vente localisée.
-- Corps repris de la base (20260929170000), seules ces jointures changent.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_live_view(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now        timestamptz := now();
  v_tz         text := 'Europe/Paris';
  v_day_start  timestamptz;
  v_event_ids  uuid[];
  v_gl_ids     uuid[];
  v_recent_ids uuid[];
  v_home       jsonb := null;
  v_release_id uuid;
  v_release    jsonb := null;
  v_visitors_now integer := 0;
  v_sessions_today integer := 0;
  v_points     jsonb := '[]'::jsonb;
  v_behavior   jsonb;
  v_pages      jsonb := '[]'::jsonb;
  v_locations  jsonb := '[]'::jsonb;
  v_sales      jsonb;
  v_feed       jsonb := '[]'::jsonb;
  v_lat        double precision;
  v_lng        double precision;
  v_home_name  text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
      or public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.can_manage_venue(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── Portée : les soirées du club / de l'organisateur ────────────────────
  select coalesce(array_agg(e.id), '{}')
    into v_event_ids
  from public.events e
  where (p_venue_id is not null and e.venue_id = p_venue_id)
     or (p_organizer_user_id is not null
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))));

  -- Soirées « vivantes » (pas finies depuis plus d'un jour) : ce sont celles
  -- que le front écoute en Realtime — une liste courte, jamais tout l'historique.
  select coalesce(array_agg(x.id order by x.start_at), '{}')
    into v_recent_ids
  from (
    select e.id, e.start_at
    from public.events e
    where e.id = any(v_event_ids)
      and e.end_at > v_now - interval '1 day'
    order by e.start_at
    limit 60
  ) x;

  select coalesce(array_agg(gl.id), '{}')
    into v_gl_ids
  from public.guest_lists gl
  where gl.event_id = any(v_recent_ids);

  -- ── Fuseau + point d'ancrage (le club) ────────────────────────────────
  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.venues v where v.id = p_venue_id;
  else
    -- Organisateur : le club de sa prochaine soirée (ou de la dernière), s'il y en a un.
    select coalesce(e.timezone, v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.events e
    left join public.venues v on v.id = e.venue_id
    where e.id = any(v_event_ids)
    order by (e.end_at > v_now) desc, abs(extract(epoch from (e.start_at - v_now)))
    limit 1;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;
  if v_lat is not null and v_lng is not null then
    v_home := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'name', v_home_name);
  end if;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  -- ── Visiteurs en ce moment (battement < 75 s) + leurs points ───────────
  select count(distinct p.session_id)
    into v_visitors_now
  from public.live_visitor_pings p
  where p.last_seen > v_now - interval '75 seconds'
    and (
         (p_venue_id is not null and p.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
      or p.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'session', x.session_id,
           'stage', x.stage,
           'path', x.page_path,
           'seen', x.last_seen,
           'eventTitle', x.event_title,
           'city', x.city,
           'country', x.country,
           'countryCode', x.country_code,
           'lat', x.latitude,
           'lng', x.longitude,
           'device', x.device_type,
           'source', x.referrer_category
         ) order by x.last_seen desc), '[]'::jsonb)
    into v_points
  from (
    select distinct on (p.session_id)
           p.session_id, p.stage, p.page_path, p.last_seen, e.title as event_title,
           vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude, vs.device_type, vs.referrer_category
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    left join lateral (
      select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
      from public.visitor_sessions s
      where s.session_id = p.session_id
      order by s.visited_at desc
      limit 1
    ) vs on true
    where p.last_seen > v_now - interval '75 seconds'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Comportement des 10 dernières minutes (une session = son dernier stade) ──
  select jsonb_build_object(
           'browsing', count(*) filter (where x.stage = 'browsing'),
           'cart',     count(*) filter (where x.stage = 'cart'),
           'checkout', count(*) filter (where x.stage = 'checkout'),
           'paid',     count(*) filter (where x.stage = 'paid')
         )
    into v_behavior
  from (
    select distinct on (p.session_id) p.session_id, p.stage
    from public.live_visitor_pings p
    where p.last_seen > v_now - interval '10 minutes'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Pages regardées en ce moment ───────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', x.page_path, 'n', x.n, 'eventTitle', x.event_title
         ) order by x.n desc, x.page_path), '[]'::jsonb)
    into v_pages
  from (
    select p.page_path, count(distinct p.session_id) as n, max(e.title) as event_title
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    where p.last_seen > v_now - interval '75 seconds'
      and p.page_path is not null
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    group by p.page_path
    order by n desc
    limit 6
  ) x;

  -- ── Sessions du jour + villes ─────────────────────────────────────────
  select count(*)
    into v_sessions_today
  from public.visitor_sessions s
  where s.visited_at >= v_day_start
    and (
         (p_venue_id is not null and s.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
      or s.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'city', x.city, 'country', x.country, 'countryCode', x.country_code,
           'n', x.n, 'lat', x.lat, 'lng', x.lng
         ) order by x.n desc), '[]'::jsonb)
    into v_locations
  from (
    select coalesce(s.city, s.region, s.country) as city,
           s.country,
           max(s.country_code) as country_code,
           count(*) as n,
           avg(s.latitude) as lat,
           avg(s.longitude) as lng
    from public.visitor_sessions s
    where s.visited_at >= v_day_start
      and coalesce(s.city, s.region, s.country) is not null
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
    group by coalesce(s.city, s.region, s.country), s.country
    order by n desc
    limit 8
  ) x;

  -- ── Ventes du jour (CA club, formules de fees.ts) ───────────────────────
  select jsonb_build_object(
    'tickets', (
      select jsonb_build_object(
        'orders', count(*),
        'qty', coalesce(sum(t.quantity), 0),
        'amount', coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
      )
      from public.tickets t
      where t.event_id = any(v_event_ids)
        and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) >= v_day_start
    ),
    'tables', (
      select jsonb_build_object(
        'orders', count(*),
        'guests', coalesce(sum(coalesce(r.guest_count, 0)), 0),
        'amount', coalesce(sum(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)), 0)
      )
      from public.table_reservations r
      where r.event_id = any(v_event_ids)
        and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) >= v_day_start
    ),
    'guestlist', (
      select jsonb_build_object('orders', count(*))
      from public.guest_list_entries gle
      join public.guest_lists gl on gl.id = gle.guest_list_id
      where gl.event_id = any(v_event_ids)
        and gle.status <> 'cancelled'
        and gle.created_at >= v_day_start
    ),
    'drinks', (
      select jsonb_build_object(
        'orders', count(*),
        'amount', coalesce(sum(o.total - coalesce(o.service_fee, 0)), 0)
      )
      from public.orders o
      where p_venue_id is not null
        and o.venue_id = p_venue_id
        and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) >= v_day_start
    )
  ) into v_sales;

  -- ── Flux d'activité : les 40 derniers faits des 24 dernières heures ────
  select coalesce(jsonb_agg(to_jsonb(f) order by f.ts desc), '[]'::jsonb)
    into v_feed
  from (
    select * from (
      (
        select 'visit'::text as kind,
               'visit:' || s.id::text as id,
               s.visited_at as ts,
               s.city, s.country, s.country_code as "countryCode",
               s.latitude as lat, s.longitude as lng,
               s.referrer_category as source,
               s.device_type as device,
               s.entry_page_type as "pageType",
               e.title as "eventTitle",
               null::numeric as amount,
               null::integer as qty,
               coalesce(s.is_returning, false) as returning
        from public.visitor_sessions s
        left join public.events e on e.id = s.event_id
        where s.visited_at > v_now - interval '24 hours'
          and (
               (p_venue_id is not null and s.venue_id = p_venue_id)
            or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
            or s.event_id = any(v_event_ids)
          )
        order by s.visited_at desc
        limit 40
      )
      union all
      (
        select 'ticket', 'ticket:' || t.id::text, coalesce(t.paid_at, t.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(t.purchase_source, vs.referrer_category), vs.device_type, 'ticket',
               e.title,
               t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0),
               t.quantity, false
        from public.tickets t
        join public.events e on e.id = t.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where t.tracking_visit_sid is not null and s.session_id = t.tracking_visit_sid
          order by s.visited_at desc limit 1
        ) vs on true
        where t.event_id = any(v_event_ids)
          and t.status in ('paid', 'used')
          and coalesce(t.paid_at, t.created_at) > v_now - interval '24 hours'
        order by coalesce(t.paid_at, t.created_at) desc
        limit 40
      )
      union all
      (
        select 'table', 'table:' || r.id::text, coalesce(r.paid_at, r.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(r.purchase_source, vs.referrer_category), vs.device_type, 'table',
               e.title,
               r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END),
               coalesce(r.guest_count, 0), false
        from public.table_reservations r
        join public.events e on e.id = r.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where r.tracking_visit_sid is not null and s.session_id = r.tracking_visit_sid
          order by s.visited_at desc limit 1
        ) vs on true
        where r.event_id = any(v_event_ids)
          and r.status in ('paid', 'confirmed')
          and coalesce(r.paid_at, r.created_at) > v_now - interval '24 hours'
        order by coalesce(r.paid_at, r.created_at) desc
        limit 40
      )
      union all
      (
        select 'guestlist', 'gl:' || gle.id::text, gle.created_at,
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               case when gle.promoter_id is not null then 'promoter' else vs.referrer_category end, vs.device_type, 'guestlist',
               e.title, null::numeric, 1, false
        from public.guest_list_entries gle
        join public.guest_lists gl on gl.id = gle.guest_list_id
        join public.events e on e.id = gl.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where gle.tracking_visit_sid is not null and s.session_id = gle.tracking_visit_sid
          order by s.visited_at desc limit 1
        ) vs on true
        where gl.event_id = any(v_event_ids)
          and gle.status <> 'cancelled'
          and gle.created_at > v_now - interval '24 hours'
        order by gle.created_at desc
        limit 40
      )
      union all
      (
        select 'order', 'order:' || o.id::text, coalesce(o.paid_at, o.created_at),
               null::text, null::text, null::text, null::double precision, null::double precision,
               o.purchase_source, null::text, 'order',
               e.title,
               o.total - coalesce(o.service_fee, 0),
               coalesce(jsonb_array_length(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end), 0),
               false
        from public.orders o
        left join public.events e on e.id = o.event_id
        where p_venue_id is not null
          and o.venue_id = p_venue_id
          and o.status in ('paid', 'served')
          and coalesce(o.paid_at, o.created_at) > v_now - interval '24 hours'
        order by coalesce(o.paid_at, o.created_at) desc
        limit 40
      )
    ) u
    order by u.ts desc
    limit 40
  ) f;

  -- ── Release en cours : la soirée qui vend le plus depuis une heure ──────
  select t.event_id
    into v_release_id
  from public.tickets t
  join public.events e on e.id = t.event_id
  where t.event_id = any(v_event_ids)
    and t.status in ('paid', 'used')
    and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
  group by t.event_id, e.start_at
  order by sum(t.quantity) desc, e.start_at
  limit 1;

  if v_release_id is null then
    -- Rien ne vend à l'instant : on suit la prochaine soirée qui a une billetterie.
    select e.id into v_release_id
    from public.events e
    where e.id = any(v_event_ids)
      and e.ticketing_enabled
      and e.status = 'active' and e.is_active and e.cancelled_at is null
      and e.end_at > v_now
    order by e.start_at
    limit 1;
  end if;

  if v_release_id is not null then
    select jsonb_build_object(
      'eventId', e.id,
      'title', e.title,
      'startAt', e.start_at,
      'endAt', e.end_at,
      'publishedAt', e.published_at,
      'poster', coalesce(e.poster_url, e.image_url),
      'ticketsSoldOut', e.tickets_sold_out,
      'maxTickets', e.max_tickets,
      'sales10m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '10 minutes'),
      'sales60m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'salesToday', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) >= v_day_start),
      'salesTotal', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')),
      'revenue60m', (select coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
                     from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'tables60m', (select count(*) from public.table_reservations r
                    where r.event_id = e.id and r.status in ('paid', 'confirmed')
                      and coalesce(r.paid_at, r.created_at) > v_now - interval '60 minutes'),
      'guests60m', (select count(*) from public.guest_list_entries gle
                    join public.guest_lists gl on gl.id = gle.guest_list_id
                    where gl.event_id = e.id and gle.status <> 'cancelled'
                      and gle.created_at > v_now - interval '60 minutes'),
      'viewersNow', (select count(distinct p.session_id) from public.live_visitor_pings p
                     where p.event_id = e.id and p.last_seen > v_now - interval '75 seconds'),
      -- 60 cases : billets par minute, de la plus ancienne (il y a 59 min) à maintenant.
      'series', (
        select jsonb_agg(coalesce(c.n, 0) order by g.m desc)
        from generate_series(59, 0, -1) as g(m)
        left join (
          select floor(extract(epoch from (v_now - coalesce(t.paid_at, t.created_at))) / 60)::int as m,
                 sum(t.quantity) as n
          from public.tickets t
          where t.event_id = e.id and t.status in ('paid', 'used')
            and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
          group by 1
        ) c on c.m = g.m
      ),
      'rounds', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', tr.tickets_sold, 'max', tr.max_tickets,
                 'active', tr.is_active, 'soldOut', tr.manually_sold_out or (tr.max_tickets > 0 and tr.tickets_sold >= tr.max_tickets)
               ) order by tr.position, tr.created_at), '[]'::jsonb)
        from public.ticket_rounds tr where tr.event_id = e.id
      )
    )
    into v_release
    from public.events e
    where e.id = v_release_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'home', v_home,
    'visitorsNow', v_visitors_now,
    'sessionsToday', v_sessions_today,
    'points', v_points,
    'behavior', v_behavior,
    'pages', v_pages,
    'locations', v_locations,
    'sales', v_sales,
    'feed', v_feed,
    'release', v_release,
    'watch', jsonb_build_object(
      'eventIds', to_jsonb(v_recent_ids),
      'guestListIds', to_jsonb(v_gl_ids)
    )
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_live_view(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_live_view(text, uuid) TO authenticated;

-- ============================================================================
-- Trafic › Ma page : une visite de la page ne portait jamais la vente (l'achat
-- ouvre une autre visite, celle de la soirée), donc « a acheté » restait à 0.
-- La page a vendu quand ce même visiteur achète une soirée de la portée dans
-- les 24 h. Corps repris de la base (20260928100100), seule cette colonne change.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_page_traffic(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_venue     text;
  v_org       uuid;
  v_tz        text := 'Europe/Paris';
  v_days      integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_from      timestamptz;
  v_day_start timestamptz;
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_org := p_organizer_user_id;
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_venue := p_venue_id;
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;

  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;
  v_from := v_day_start - make_interval(days => v_days - 1);

  with
  page as materialized (
    select s.session_id, coalesce(s.visitor_id::text, s.session_id) as visitor,
           s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.is_returning, false) as is_ret,
           -- Une visite de LA PAGE ne porte jamais la vente : l'achat se fait
           -- sur la page de la soirée, qui ouvre une autre visite. La page a
           -- donc « vendu » quand ce même visiteur (identifiant d'appareil)
           -- achète une soirée de la portée dans les 24 h qui suivent.
           (coalesce(s.completed_order, false) or (s.visitor_id is not null and exists (
              select 1 from public.visitor_sessions b
               join public.events e on e.id = b.event_id
              where b.visitor_id = s.visitor_id
                and coalesce(b.completed_order, false)
                and b.visited_at >= s.visited_at and b.visited_at < s.visited_at + interval '24 hours'
                and ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue))
                  or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org)))
           ))) as ordered
    from public.visitor_sessions s
    where s.visited_at >= v_from
      and ((v_venue is not null and s.venue_id = v_venue and s.entry_page_type = 'venue_page')
        or (v_org is not null and s.organizer_user_id = v_org and s.entry_page_type = 'organizer_profile'))
  ),
  days as (
    select generate_series(
      (v_from at time zone v_tz)::date,
      (v_now at time zone v_tz)::date,
      interval '1 day'
    )::date as d
  ),
  ev as materialized (
    select e.id, e.title, e.start_at
    from public.events e
    where e.cancelled_at is null
      and ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue or e.id in (select public.cohost_event_ids_venue(v_venue))))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org or e.id in (select public.cohost_event_ids_org(v_org)))))
  ),
  evs as materialized (
    select s.event_id, s.visited_at, coalesce(s.completed_order, false) as ordered
    from public.visitor_sessions s
    join ev on ev.id = s.event_id
    where s.visited_at >= v_from
  )
  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'days', v_days,
    'from', v_from,
    'page', jsonb_build_object(
      'kind', case when v_venue is not null then 'venue' else 'organizer' end,
      'total', (select count(*) from page),
      'today', (select count(*) from page where visited_at >= v_day_start),
      'visitors', (select count(distinct visitor) from page),
      'returning', (select count(*) from page where is_ret),
      'ordered', (select count(*) from page where ordered),
      -- Une seule passe sur les visites, regroupées par jour, puis collées
      -- aux jours de la période (un count par jour relisait toute la page
      -- 90 fois : 2,3 s sur 35 000 sessions).
      'series', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(d.d, 'YYYY-MM-DD'),
                 'visits', coalesce(c.n, 0)
               ) order by d.d)
        from days d
        left join (
          select (p.visited_at at time zone v_tz)::date as d, count(*) as n
          from page p group by 1
        ) c on c.d = d.d
      ),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object('source', x.source, 'visits', x.n, 'ordered', x.o) order by x.n desc)
        from (select source, count(*) as n, count(*) filter (where ordered) as o from page group by source) x
      ), '[]'::jsonb)
    ),
    'events', jsonb_build_object(
      'total', (select count(*) from evs),
      'today', (select count(*) from evs where visited_at >= v_day_start),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', x.id, 'title', x.title, 'startAt', x.start_at,
                 'visits', x.visits, 'today', x.today, 'ordered', x.ordered
               ) order by x.visits desc, x.start_at desc)
        from (
          select ev.id, ev.title, ev.start_at,
                 count(*) as visits,
                 count(*) filter (where evs.visited_at >= v_day_start) as today,
                 count(*) filter (where evs.ordered) as ordered
          from evs join ev on ev.id = evs.event_id
          group by ev.id, ev.title, ev.start_at
          order by count(*) desc, ev.start_at desc
          limit 30
        ) x
      ), '[]'::jsonb)
    )
  )
  into v_result;

  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_page_traffic(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_page_traffic(text, uuid, integer) TO authenticated;
