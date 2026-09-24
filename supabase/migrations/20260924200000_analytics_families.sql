-- =============================================================================
-- Analytics en quatre familles (plan Shotgun, lot E) — deux lectures nouvelles
-- =============================================================================
-- Analytics se range en Ventes / Trafic / Communauté / En direct (grammaire
-- Shotgun : une page = une question). Deux pages n'avaient pas de source :
--
--   • Communauté › Vue d'ensemble — « Qui sont mes clients ? » :
--     `get_community_overview(p_venue_id, p_organizer_user_id)`, lue sur la
--     base VIVANTE `contact_rows` (fichiers importés ∪ clients venus par Yuno,
--     une ligne par contact) : contacts, joignables par email, abonnés,
--     joignables par push ; participation 0 / 1 / 2 / 3 / 4+ soirées ; dernier
--     achat < 3 / 3-6 / 6-12 / 12-24 / > 24 mois ; croissance cumulée sur
--     24 mois ; nouveaux contacts des 10 dernières soirées. Des mots de pro, pas
--     de RFM : les segments restent dans le CRM, où l'on agit.
--     « Nouveau contact » d'une soirée = sa PREMIÈRE soirée dans la portée
--     (billet payé, table payée/confirmée, guest list non annulée) — la même
--     définition que le Rapport de soirée.
--
--   • Trafic › Ma page et Par soirée — « Est-ce qu'on me voit ? » :
--     `get_page_traffic(p_venue_id, p_organizer_user_id, p_days)`, lue sur
--     `visitor_sessions` : la page publique du club (`venue_page`) ou de
--     l'organisateur (`organizer_profile`), visites par jour, aujourd'hui,
--     visiteurs uniques, sources ; puis chaque soirée de la portée avec ses
--     visites et la part qui a commandé.
--     Le tracking visiteur est gaté par le consentement analytics du CMP :
--     seules les visites consenties existent, et c'est écrit sous la courbe.
--
-- Porte : la même que `get_events_sales_summary` (club : `can_manage_venue` ;
-- organisateur : fondateur ou membre d'équipe éditeur et plus). Aucun montant :
-- ces deux pages comptent des gens, pas de l'argent.
-- =============================================================================

create or replace function public.get_community_overview(
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
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_venue  text;
  v_org    uuid;
  v_tz     text := 'Europe/Paris';
  v_result jsonb;
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

  with
  c as materialized (
    select cr.email, cr.event_count, cr.last_purchase_at, cr.added_at, cr.origin,
           cr.subscribed, cr.bounced, cr.unsubscribed_at
    from public.contact_rows(v_venue, v_org) cr
  ),
  f as materialized (
    select x.user_id, min(x.created_at) as created_at
    from (
      select fv.user_id, fv.created_at
      from public.favorites fv
      where v_venue is not null and fv.favorite_type = 'club' and fv.venue_id = v_venue
      union all
      select opf.user_id, opf.created_at
      from public.organizer_profile_followers opf
      where v_org is not null and opf.organizer_user_id = v_org
    ) x
    where x.user_id is not null
    group by x.user_id
  ),
  ev as materialized (
    select e.id, e.title, e.start_at
    from public.events e
    where ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org)))
  ),
  -- Qui est venu à quelle soirée (mêmes sources que contact_scope_customers).
  act as materialized (
    select distinct x.em, x.event_id
    from (
      select lower(btrim(t.user_email)) as em, t.event_id
      from public.tickets t join ev on ev.id = t.event_id
      where t.user_email is not null and btrim(t.user_email) <> '' and t.paid_at is not null
      union all
      select lower(btrim(r.user_email)), r.event_id
      from public.table_reservations r join ev on ev.id = r.event_id
      where r.user_email is not null and btrim(r.user_email) <> ''
        and (r.paid_at is not null or r.status in ('paid', 'confirmed'))
      union all
      select lower(btrim(g.email)), gl.event_id
      from public.guest_list_entries g
      join public.guest_lists gl on gl.id = g.guest_list_id
      join ev on ev.id = gl.event_id
      where g.email is not null and btrim(g.email) <> '' and g.status <> 'cancelled'
    ) x
  ),
  first_ev as materialized (
    select a.em, (array_agg(a.event_id order by e.start_at, a.event_id))[1] as event_id
    from act a join ev e on e.id = a.event_id
    group by a.em
  ),
  recent as (
    select e.id, e.title, e.start_at
    from ev e
    join public.events full_e on full_e.id = e.id
    where e.start_at <= v_now and full_e.cancelled_at is null
    order by e.start_at desc
    limit 10
  ),
  months as (
    select generate_series(
      date_trunc('month', v_now at time zone v_tz) - interval '23 months',
      date_trunc('month', v_now at time zone v_tz),
      interval '1 month'
    ) as m
  )
  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'totals', jsonb_build_object(
      'contacts', (select count(*) from c),
      'emailReachable', (select count(*) from c
                         where c.email is not null and c.subscribed and not c.bounced and c.unsubscribed_at is null),
      'yunoCustomers', (select count(*) from c where c.origin in ('yuno', 'both')),
      'imported', (select count(*) from c where c.origin in ('import', 'both')),
      'followers', (select count(*) from f),
      'pushReachable', (select count(*) from f
                        where exists (select 1 from public.push_subscriptions ps
                                      where ps.user_id = f.user_id and ps.platform = 'ios')),
      'newFollowers30d', (select count(*) from f where f.created_at >= v_now - interval '30 days'),
      'newContacts30d', (select count(*) from c where c.added_at >= v_now - interval '30 days')
    ),
    'participation', jsonb_build_object(
      'known', (select count(*) from c where c.event_count is not null),
      'avg', (select round(avg(c.event_count)::numeric, 2) from c where c.event_count is not null),
      'buckets', (
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(n.n, 0)) order by b.ord)
        from (values ('0', 0), ('1', 1), ('2', 2), ('3', 3), ('4+', 4)) as b(bucket, ord)
        left join (
          select case when c.event_count >= 4 then '4+' else c.event_count::text end as bucket, count(*) as n
          from c where c.event_count is not null and c.event_count >= 0
          group by 1
        ) n on n.bucket = b.bucket
      )
    ),
    'lastPurchase', jsonb_build_object(
      'known', (select count(*) from c where c.last_purchase_at is not null),
      'buckets', (
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(n.n, 0)) order by b.ord)
        from (values ('lt3', 0), ('3to6', 1), ('6to12', 2), ('12to24', 3), ('gt24', 4)) as b(bucket, ord)
        left join (
          select case
                   when c.last_purchase_at >= v_now - interval '3 months' then 'lt3'
                   when c.last_purchase_at >= v_now - interval '6 months' then '3to6'
                   when c.last_purchase_at >= v_now - interval '12 months' then '6to12'
                   when c.last_purchase_at >= v_now - interval '24 months' then '12to24'
                   else 'gt24'
                 end as bucket,
                 count(*) as n
          from c where c.last_purchase_at is not null
          group by 1
        ) n on n.bucket = b.bucket
      )
    ),
    'growth', jsonb_build_object(
      'known', (select count(*) from c where c.added_at is not null),
      'series', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(mo.m, 'YYYY-MM'),
                 'contacts', (select count(*) from c
                              where c.added_at is not null
                                and (c.added_at at time zone v_tz) < mo.m + interval '1 month'),
                 'followers', (select count(*) from f
                               where (f.created_at at time zone v_tz) < mo.m + interval '1 month')
               ) order by mo.m)
        from months mo
      )
    ),
    'byEvent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'title', r.title,
               'startAt', r.start_at,
               'participants', (select count(*) from act a where a.event_id = r.id),
               'newContacts', (select count(*) from first_ev fe where fe.event_id = r.id)
             ) order by r.start_at desc)
      from recent r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_community_overview(text, uuid) from public, anon;
grant execute on function public.get_community_overview(text, uuid) to authenticated;

comment on function public.get_community_overview(text, uuid) is
  'Analytics › Communauté › Vue d''ensemble : contacts (contact_rows), abonnés, participation 0-4+, dernier achat par tranches de mois, croissance cumulée 24 mois, nouveaux contacts des 10 dernières soirées. Aucun montant.';


create or replace function public.get_page_traffic(
  p_venue_id text default null,
  p_organizer_user_id uuid default null,
  p_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
           coalesce(s.is_returning, false) as is_ret
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
      'series', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(d.d, 'YYYY-MM-DD'),
                 'visits', (select count(*) from page p where (p.visited_at at time zone v_tz)::date = d.d)
               ) order by d.d)
        from days d
      ),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object('source', x.source, 'visits', x.n) order by x.n desc)
        from (select source, count(*) as n from page group by source) x
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
$$;

revoke all on function public.get_page_traffic(text, uuid, integer) from public, anon;
grant execute on function public.get_page_traffic(text, uuid, integer) to authenticated;

comment on function public.get_page_traffic(text, uuid, integer) is
  'Analytics › Trafic : visites de la page publique du club / de l''organisateur (par jour, aujourd''hui, visiteurs, sources) et visites de chaque soirée de la portée avec la part qui a commandé, sur p_days jours (7-365). Visites consenties seulement.';
