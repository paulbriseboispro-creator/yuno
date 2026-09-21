-- =============================================================================
-- Vue en direct (« Live View ») — page Analytics, club ET organisateur
-- =============================================================================
-- Ce que Shopify appelle Live View : un globe où chaque visiteur en train de
-- regarder la page du club allume un point, et à droite les chiffres de
-- l'instant — visiteurs en ce moment, sessions et ventes du jour, entonnoir
-- des dix dernières minutes, villes, pages regardées, flux d'activité et
-- suivi de la release en cours (billets par minute, paliers).
--
-- Une SEULE RPC, `get_live_view`, sert tout l'écran en un aller-retour : le
-- front la rappelle toutes les quelques secondes, et les changements Realtime
-- sur tickets / table_reservations / orders / guest_list_entries ne font que
-- déclencher un rappel immédiat. Aucun chiffre n'est agrégé côté front.
--
-- Sources (toutes existantes) :
--   - live_visitor_pings : battement 15 s des visiteurs (page, étape du
--     tunnel), écrit par `ping_live_visitor` — c'est « qui est là maintenant ».
--   - visitor_sessions : une ligne par session consentie, enrichie ville / pays
--     par l'edge `geocode-address` (ipapi). On y ajoute ici latitude /
--     longitude / country_code : sans coordonnées, pas de point sur le globe.
--   - tickets / table_reservations / guest_list_entries / orders : les ventes,
--     mêmes statuts que la compta (`paid`,`used` / `paid`,`confirmed` /
--     `<> cancelled` / `paid`,`served`), mêmes formules de CA club que
--     src/utils/fees.ts (total − frais de service − assurance / gestion).
--
-- Le tracking visiteur est gaté par le consentement analytics du CMP : seules
-- les visites consenties apparaissent. Les ventes, elles, apparaissent
-- toutes (ce sont des faits de caisse, pas de la mesure d'audience).
-- =============================================================================

alter table public.visitor_sessions
  add column if not exists country_code text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create index if not exists idx_visitor_sessions_venue_visited
  on public.visitor_sessions (venue_id, visited_at desc);
create index if not exists idx_visitor_sessions_org_visited
  on public.visitor_sessions (organizer_user_id, visited_at desc);
create index if not exists idx_visitor_sessions_session_id
  on public.visitor_sessions (session_id, visited_at desc);
create index if not exists idx_visitor_sessions_order_id
  on public.visitor_sessions (order_id)
  where order_id is not null;

drop function if exists public.get_live_view(text, uuid);

create or replace function public.get_live_view(
  p_venue_id text default null,
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id));

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
        'amount', coalesce(sum(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)), 0)
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
          where s.order_id is not null and s.order_id::text = t.id::text
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
               r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0),
               coalesce(r.guest_count, 0), false
        from public.table_reservations r
        join public.events e on e.id = r.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = r.id::text
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
               null::text, null::text, null::text, null::double precision, null::double precision,
               case when gle.promoter_id is not null then 'promoter' else null end, null::text, 'guestlist',
               e.title, null::numeric, 1, false
        from public.guest_list_entries gle
        join public.guest_lists gl on gl.id = gle.guest_list_id
        join public.events e on e.id = gl.event_id
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
$$;

revoke all on function public.get_live_view(text, uuid) from public;
grant execute on function public.get_live_view(text, uuid) to authenticated;
