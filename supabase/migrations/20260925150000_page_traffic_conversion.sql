-- =============================================================================
-- Trafic › Ma page : la conversion (visites qui finissent en achat)
-- =============================================================================
-- Plan de simplification (lot 5) : « Sources » a rejoint « Ma page ». La
-- page dit désormais combien de visites se terminent par un achat, au total
-- et PAR SOURCE — c'était la seule chose que l'ancienne vue Sources avait en
-- plus. Réécrit depuis la définition VIVANTE (pg_get_functiondef).
-- =============================================================================

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
           coalesce(s.completed_order, false) as ordered
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
      and ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org)))
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
      'series', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(d.d, 'YYYY-MM-DD'),
                 'visits', (select count(*) from page p where (p.visited_at at time zone v_tz)::date = d.d)
               ) order by d.d)
        from days d
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
