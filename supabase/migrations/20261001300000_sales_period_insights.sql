-- Analytics › Ventes › Vue d'ensemble, périmètre « toutes les soirées » :
-- les trois lectures qui n'existaient que pour UNE soirée (get_event_report)
-- existent maintenant pour une PÉRIODE, avec les mêmes formules, pour que le
-- pro n'apprenne qu'une seule grammaire d'analyse (décision du 01/10).
--
--   get_sales_period_curve     la courbe J-N moyenne des soirées de la période,
--                              comparée aux soirées de la période d'avant
--   get_sales_period_drivers   ce qui a fait vendre : canaux, liens suivis,
--                              emails et push (attribution clic → achat < 72 h)
--   get_sales_period_audience  nouveaux visages ou habitués sur la période
--
-- Période = les soirées de la portée COMMENCÉES dans [p_from, p_to[ ; période
-- d'avant = même durée juste avant. Portée et droit de voir l'argent :
-- analytics_scope_gate (club : jamais le CA d'une soirée seulement accueillie).
-- Montants = CA club de fees.ts (frais Yuno et assurance / gestion absorbée
-- déduits, remboursements déduits), statuts de la compta.

-- ── Les ventes des soirées d'une liste, une ligne par transaction ──────────
-- Même définition que `tx` / `gle` dans get_event_report, sur N soirées.
create or replace function public._sales_period_tx(p_event_ids uuid[], p_scope_venue text)
returns table (
  event_id uuid, pillar text, id uuid, email text, user_id uuid, at_ts timestamptz,
  units integer, heads integer, amount numeric, source text, tracked_link_id uuid
)
language sql stable security definer set search_path = public as $$
  select t.event_id, 'tickets'::text, t.id, lower(t.user_email), t.user_id,
         coalesce(t.paid_at, t.created_at),
         greatest(coalesce(t.quantity, 1), 1)::integer,
         greatest(coalesce(t.quantity, 1), 1)::integer,
         greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
           - least(greatest(coalesce(t.refund_amount, 0), 0),
                   greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)),
         coalesce(nullif(t.purchase_source, ''), 'direct'),
         t.tracked_link_id
  from public.tickets t
  where t.event_id = any(p_event_ids) and t.status in ('paid', 'used')
  union all
  select r.event_id, 'tables', r.id, lower(r.user_email), r.user_id,
         coalesce(r.paid_at, r.created_at),
         1,
         greatest(coalesce(r.guest_count, 0), 1)::integer,
         greatest(r.total_price - coalesce(r.service_fee, 0) - (case when coalesce(r.fee_absorbed, false) then coalesce(r.management_fee, 0) else 0 end), 0)
           - least(greatest(coalesce(r.refund_amount, 0), 0),
                   greatest(r.total_price - coalesce(r.service_fee, 0) - (case when coalesce(r.fee_absorbed, false) then coalesce(r.management_fee, 0) else 0 end), 0)),
         coalesce(nullif(r.purchase_source, ''), 'direct'),
         r.tracked_link_id
  from public.table_reservations r
  where r.event_id = any(p_event_ids) and r.status in ('paid', 'confirmed')
  union all
  select o.event_id, 'drinks', o.id, lower(o.user_email), o.user_id,
         coalesce(o.paid_at, o.created_at),
         1, 0,
         greatest(o.total - coalesce(o.service_fee, 0), 0)
           - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
         coalesce(nullif(o.purchase_source, ''), 'direct'),
         o.tracked_link_id
  from public.orders o
  where o.event_id = any(p_event_ids) and o.status in ('paid', 'served')
    and p_scope_venue is not null and o.venue_id = p_scope_venue
  union all
  select gl.event_id, 'guestlist', g.id, lower(nullif(btrim(g.email), '')), g.user_id,
         g.created_at, 0, 1, 0, 'guestlist', g.tracked_link_id
  from public.guest_list_entries g
  join public.guest_lists gl on gl.id = g.guest_list_id
  where gl.event_id = any(p_event_ids) and g.status <> 'cancelled'
$$;
revoke all on function public._sales_period_tx(uuid[], text) from public, anon, authenticated;

-- ── Les soirées de la période (et de la période d'avant) ────────────────────
-- `show_money` : le club ne voit pas le CA d'une soirée qu'il ne fait
-- qu'accueillir (partner_venue_id), comme get_sales_overview.
create or replace function public._sales_period_nights(
  p_scope_ids uuid[], p_scope_venue text, p_money boolean,
  p_from timestamptz, p_to timestamptz
)
returns table (id uuid, title text, start_at timestamptz, tz text, bucket text, show_money boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.start_at,
         coalesce(e.timezone, v.timezone, 'Europe/Paris'),
         case when e.start_at >= p_from then 'cur' else 'prev' end,
         case when p_scope_venue is null then p_money else p_money and e.venue_id = p_scope_venue end
  from public.events e
  left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
  where e.id = any(p_scope_ids)
    and e.cancelled_at is null and coalesce(e.status, 'active') <> 'cancelled'
    and e.start_at < p_to
    and e.start_at >= p_from - (p_to - p_from)
$$;
revoke all on function public._sales_period_nights(uuid[], text, boolean, timestamptz, timestamptz) from public, anon, authenticated;

-- ── 1. La courbe J-N moyenne ─────────────────────────────────────────────────
create or replace function public.get_sales_period_curve(
  p_venue_id text default null, p_organizer_user_id uuid default null,
  p_from timestamptz default now() - interval '7 days', p_to timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g record;
begin
  select * into g from public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  if not g.ok then return jsonb_build_object('ok', false, 'reason', g.reason); end if;

  return (
    with nights as materialized (
      select * from public._sales_period_nights(g.scope_ids, g.scope_venue, g.money, p_from, p_to)
    ),
    tx as materialized (
      select x.*, n.bucket, n.show_money,
             (n.start_at at time zone n.tz)::date - (x.at_ts at time zone n.tz)::date as d
      from public._sales_period_tx((select coalesce(array_agg(id), '{}') from nights), g.scope_venue) x
      join nights n on n.id = x.event_id
    ),
    vis as (
      select n.bucket, (n.start_at at time zone n.tz)::date - (s.visited_at at time zone n.tz)::date as d, count(*) as visits
      from public.visitor_sessions s join nights n on n.id = s.event_id
      group by 1, 2
    ),
    day_rows as (
      select bucket, d,
             case when pillar = 'tickets' then units else 0 end as tickets,
             case when pillar = 'tables' then 1 else 0 end as tables,
             case when pillar = 'guestlist' then 1 else 0 end as guests,
             case when show_money and pillar in ('tickets', 'tables', 'drinks') then amount else 0 end as amount,
             0 as visits,
             case when pillar in ('tickets', 'tables', 'guestlist') then heads else 0 end as people
      from tx
      union all
      select bucket, d, 0, 0, 0, 0, visits, 0 from vis
    ),
    series as (
      select bucket, d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
             sum(amount) as amount, sum(visits) as visits, sum(people) as people
      from day_rows group by bucket, d
    ),
    per_bucket as (
      select b.bucket,
             (select count(*) from nights n where n.bucket = b.bucket) as nights,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
                        'amount', case when g.money then round(s.amount::numeric, 2) else null end,
                        'visits', s.visits, 'people', s.people) order by s.d desc)
               from series s where s.bucket = b.bucket
             ), '[]'::jsonb) as series
      from (values ('cur'), ('prev')) b(bucket)
    )
    select jsonb_build_object(
      'ok', true, 'money', g.money, 'tz', g.tz, 'from', p_from, 'to', p_to,
      'cur', (select jsonb_build_object('nights', nights, 'series', series) from per_bucket where bucket = 'cur'),
      'prev', (select jsonb_build_object('nights', nights, 'series', series) from per_bucket where bucket = 'prev')
    )
  );
end;
$$;
revoke all on function public.get_sales_period_curve(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_sales_period_curve(text, uuid, timestamptz, timestamptz) to authenticated;

-- ── 2. Ce qui a fait vendre sur la période ──────────────────────────────────
create or replace function public.get_sales_period_drivers(
  p_venue_id text default null, p_organizer_user_id uuid default null,
  p_from timestamptz default now() - interval '7 days', p_to timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g record;
begin
  select * into g from public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  if not g.ok then return jsonb_build_object('ok', false, 'reason', g.reason); end if;

  return (
    with nights as materialized (
      select * from public._sales_period_nights(g.scope_ids, g.scope_venue, g.money, p_from, p_to)
      where bucket = 'cur'
    ),
    tx as materialized (
      select x.*, case when n.show_money then x.amount else 0 end as money_amount
      from public._sales_period_tx((select coalesce(array_agg(id), '{}') from nights), g.scope_venue) x
      join nights n on n.id = x.event_id
    ),
    emails as (
      select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
             coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
             coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
             ec.automation_id is not null as auto
      from public.email_campaigns ec
      where (ec.event_id in (select id from nights) or ec.automation_trigger_event_id in (select id from nights))
        and ec.status in ('sent', 'sending', 'paused')
        and ((g.scope_venue is not null and ec.venue_id = g.scope_venue)
          or (g.scope_org is not null and ec.organizer_user_id = g.scope_org))
      order by ec.sent_at desc nulls last
      limit 30
    ),
    email_clicks as (
      select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
      from public.email_campaign_events ece
      where ece.campaign_id in (select id from emails)
        and ece.event_type = 'clicked' and ece.recipient_email is not null
      group by 1, 2
    ),
    email_attr as (
      select c.campaign_id,
             count(distinct x.id) filter (where x.pillar in ('tickets', 'tables')) as orders,
             coalesce(sum(x.money_amount) filter (where x.pillar in ('tickets', 'tables')), 0) as amount,
             count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
      from email_clicks c
      join tx x on x.email = c.email and x.pillar in ('tickets', 'tables', 'guestlist')
                and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
      group by c.campaign_id
    ),
    pushes as (
      select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
             coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key,
             pc.event_id
      from public.push_campaigns pc
      where pc.event_id in (select id from nights)
        and pc.status in ('sent', 'sending', 'completed')
        and ((g.scope_venue is not null and pc.venue_id = g.scope_venue)
          or (g.scope_org is not null and pc.venue_id is null and pc.agency_id is null))
      order by pc.created_at desc
      limit 30
    ),
    push_clicks as (
      select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
      from public.push_campaign_events pce
      where pce.campaign_id in (select id from pushes)
        and pce.event_type = 'clicked' and pce.user_id is not null
      group by 1, 2
    ),
    push_attr as (
      select c.campaign_id,
             count(*) as clicks,
             count(distinct x.id) filter (where x.pillar in ('tickets', 'tables')) as orders,
             coalesce(sum(x.money_amount) filter (where x.pillar in ('tickets', 'tables')), 0) as amount,
             count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
      from push_clicks c
      left join tx x on x.user_id = c.user_id and x.pillar in ('tickets', 'tables', 'guestlist')
                     and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
      group by c.campaign_id
    )
    select jsonb_build_object(
      'ok', true, 'money', g.money, 'nights', (select count(*) from nights),
      'channels', coalesce((
        select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
                 'amount', case when g.money then round(c.amount::numeric, 2) else null end) order by c.n desc)
        from (
          select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                      when source in ('manual', 'manual_open') then 'manual'
                      else 'other' end as source,
                 count(*) as n, sum(money_amount) as amount
          from tx where pillar in ('tickets', 'tables')
          group by 1
        ) c
      ), '[]'::jsonb),
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
                 'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
                 'amount', case when g.money then round(k.amount::numeric, 2) else null end
               ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
        from (
          select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
                 (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
                 (select count(*) from tx where tx.tracked_link_id = tl.id and pillar = 'guestlist') as entries,
                 (select coalesce(sum(money_amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
          from public.tracked_links tl
          where tl.event_id in (select id from nights)
             or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
        ) k
        where k.n > 0 or k.entries > 0
        limit 12
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(m.obj order by m.sent_at desc nulls last)
        from (
          select em.sent_at, jsonb_build_object(
                   'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                   'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                   'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                   'amount', case when g.money then round(coalesce(a.amount, 0)::numeric, 2) else null end
                 ) as obj
          from emails em left join email_attr a on a.campaign_id = em.id
          union all
          select pu.sent_at, jsonb_build_object(
                   'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                   'templateKey', pu.template_key,
                   'eventTitle', (select n.title from nights n where n.id = pu.event_id),
                   'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                   'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                   'amount', case when g.money then round(coalesce(a.amount, 0)::numeric, 2) else null end
                 )
          from pushes pu left join push_attr a on a.campaign_id = pu.id
        ) m
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_sales_period_drivers(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_sales_period_drivers(text, uuid, timestamptz, timestamptz) to authenticated;

-- ── 3. Qui achète sur la période : nouveaux visages ou habitués ─────────────
-- Une personne est « nouvelle » si sa PREMIÈRE soirée dans la portée est une
-- soirée de la période ; « habituée » si elle était déjà venue à une soirée
-- commencée avant (même définition que le rapport, étendue à N soirées).
create or replace function public.get_sales_period_audience(
  p_venue_id text default null, p_organizer_user_id uuid default null,
  p_from timestamptz default now() - interval '7 days', p_to timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g record;
begin
  select * into g from public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  if not g.ok then return jsonb_build_object('ok', false, 'reason', g.reason); end if;

  return (
    with nights as materialized (
      select * from public._sales_period_nights(g.scope_ids, g.scope_venue, g.money, p_from, p_to)
      where bucket = 'cur'
    ),
    tx as materialized (
      select x.email, x.pillar, n.start_at
      from public._sales_period_tx((select coalesce(array_agg(id), '{}') from nights), g.scope_venue) x
      join nights n on n.id = x.event_id
      where x.email is not null and x.pillar in ('tickets', 'tables', 'guestlist')
    ),
    people as (
      select email, min(start_at) as first_at from tx group by email
    ),
    seen_before as (
      select p.email
      from people p
      where exists (select 1 from public.tickets t join public.events e on e.id = t.event_id
                    where e.id = any(g.scope_ids) and e.start_at < p.first_at
                      and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
         or exists (select 1 from public.table_reservations r join public.events e on e.id = r.event_id
                    where e.id = any(g.scope_ids) and e.start_at < p.first_at
                      and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
         or exists (select 1 from public.guest_list_entries gg join public.guest_lists gl on gl.id = gg.guest_list_id
                    join public.events e on e.id = gl.event_id
                    where e.id = any(g.scope_ids) and e.start_at < p.first_at
                      and gg.status <> 'cancelled' and lower(gg.email) = p.email)
    )
    select jsonb_build_object(
      'ok', true,
      'nights', (select count(*) from nights),
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables')),
      'priorEvents', (select count(*) from public.events e
                      where e.id = any(g.scope_ids) and e.cancelled_at is null
                        and e.start_at < coalesce((select min(start_at) from nights), p_from))
    )
  );
end;
$$;
revoke all on function public.get_sales_period_audience(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_sales_period_audience(text, uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
