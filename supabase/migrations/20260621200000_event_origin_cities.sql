-- Event origin cities.
-- Companion to event_audience_demographics, but tuned for the geographic "origins"
-- view (the world map / globe in the Customers → Origins tab). Returns the TOP
-- cities of the people who took part in a venue's or organizer's events, with a
-- count per city — COUNTS ONLY, never individual rows / PII.
--
-- Where event_audience_demographics caps cities at 8 (it renders a compact bar
-- list next to age/gender), this returns up to 40 so a zoomable globe can drop a
-- proportional bubble on each city. Same participant definition, same
-- authorization, same data source (profiles.city).
--
-- A "participant" is a distinct person (deduped by user_id, falling back to a
-- lowercased email) appearing in any of these sources for the scoped events:
--   • paid tickets                (tickets, status = 'paid')
--   • paid VIP table reservations (table_reservations, status = 'paid')
--   • guest-list entries          (guest_list_entries → guest_lists → event_id)
--
-- City ← profiles.city (joined by user_id, fallback by email). city_known is
-- returned so the UI can show honest coverage (most people never set a city).
--
-- Scope + authorization (identical to event_audience_demographics):
--   p_scope = 'venue'     → events where venue_id = p_scope_id OR partner_venue_id =
--                           p_scope_id; caller must own the venue or be super admin.
--   p_scope = 'organizer' → events where organizer_user_id = p_scope_id OR
--                           partner_organizer_id = p_scope_id; caller must pass
--                           can_manage_organizer.
--   p_event_id (optional) → narrows to a single night within the authorized scope.
--   p_from / p_to (optional, timestamptz) → window on the source row's created_at.
--
-- SECURITY DEFINER so it can read the otherwise-locked profiles / tickets /
-- guest-list tables, scoped strictly to the caller's own events.

create or replace function public.event_origin_cities(
  p_scope text,
  p_scope_id text,
  p_event_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_scope = 'venue' then
    if not (public.is_venue_owner(auth.uid(), p_scope_id) or public.is_super_admin()) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_scope = 'organizer' then
    if not public.can_manage_organizer(p_scope_id::uuid) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_scope');
  end if;

  with scoped_events as (
    select e.id
    from public.events e
    where (
      (p_scope = 'venue'
        and (e.venue_id = p_scope_id or e.partner_venue_id = p_scope_id))
      or
      (p_scope = 'organizer'
        and (e.organizer_user_id = p_scope_id::uuid or e.partner_organizer_id = p_scope_id::uuid))
    )
    and (p_event_id is null or e.id = p_event_id)
  ),
  parts as (
    -- paid tickets
    select t.user_id, lower(nullif(trim(t.user_email), '')) as email
    from public.tickets t
    where t.event_id in (select id from scoped_events)
      and t.status = 'paid'
      and (p_from is null or t.created_at >= p_from)
      and (p_to is null or t.created_at <= p_to)
    union
    -- paid VIP table reservations
    select r.user_id, lower(nullif(trim(r.user_email), '')) as email
    from public.table_reservations r
    where r.event_id in (select id from scoped_events)
      and r.status = 'paid'
      and (p_from is null or r.created_at >= p_from)
      and (p_to is null or r.created_at <= p_to)
    union
    -- guest-list entries
    select gle.user_id, lower(nullif(trim(gle.email), '')) as email
    from public.guest_list_entries gle
    join public.guest_lists gl on gl.id = gle.guest_list_id
    where gl.event_id in (select id from scoped_events)
      and (p_from is null or gle.created_at >= p_from)
      and (p_to is null or gle.created_at <= p_to)
  ),
  -- collapse to one row per distinct person: prefer user_id, otherwise email
  people as (
    select
      coalesce(user_id::text, email) as person_key,
      (array_agg(user_id) filter (where user_id is not null))[1] as user_id,
      (array_agg(email)  filter (where email  is not null))[1] as email
    from parts
    where user_id is not null or email is not null
    group by coalesce(user_id::text, email)
  ),
  enriched as (
    select
      pe.person_key,
      nullif(trim(p.city), '') as city
    from people pe
    left join public.profiles p
      on (pe.user_id is not null and p.id = pe.user_id)
      or (pe.user_id is null and pe.email is not null and lower(p.email) = pe.email)
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from people),
    'city_known', (select count(*) from enriched where city is not null),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'count', c) order by c desc, city asc)
      from (
        select city, count(*) c from enriched where city is not null
        group by city order by c desc, city asc limit 40
      ) cc
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.event_origin_cities(text, text, uuid, timestamptz, timestamptz) to authenticated;
