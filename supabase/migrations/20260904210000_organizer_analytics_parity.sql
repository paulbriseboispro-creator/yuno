-- Analytics organisateur = même puissance que le club.
--
-- Les quatre RPC d'analytics serveur (guest list, réservations VIP, conso VIP,
-- bilan par soirée) étaient verrouillées sur p_venue_id / is_venue_owner : la
-- page Analytique de l'organisateur ne pouvait donc afficher ni la guest list,
-- ni le détail des tables, ni le bilan par nuit. Chacune reçoit un paramètre
-- p_organizer_user_id (portée = soirées dont l'utilisateur est l'organisateur
-- principal OU partenaire, comme useAnalyticsData), gardé comme
-- get_organizer_customer_segments : l'organisateur lui-même, son équipe admin,
-- ou un super admin.
--
-- Pas de boissons côté organisateur (cohérent avec le reste de sa page) : en
-- portée organisateur, p_venue_id est NULL, donc les jointures bar
-- (orders.venue_id = p_venue_id) ne rattachent rien, et le bilan par soirée
-- n'agrège les commandes que lorsqu'un club est fourni.
--
-- Ajout d'un paramètre = DROP + CREATE (jamais CREATE OR REPLACE) : une
-- surcharge rendrait ambigu l'appel à arguments nommés des bundles en cache.

drop function if exists public.get_guest_list_analytics(text, uuid, timestamptz, timestamptz, text);

create or replace function public.get_guest_list_analytics(
  p_venue_id text default null,
  p_event_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Europe/Paris',
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with lists as (
    select
      gl.id,
      gl.event_id,
      gl.quota,
      gl.is_active,
      coalesce(gl.holder_type, 'venue')            as holder_type,
      coalesce(nullif(gl.holder_label, ''), '—')   as holder_label,
      gl.promoter_id,
      gl.dj_id,
      gl.entry_kind,
      gl.includes_drink,
      coalesce(
        gl.promoter_id::text,
        gl.dj_id::text,
        gl.organizer_user_id::text,
        nullif(gl.holder_label, ''),
        coalesce(gl.holder_type, 'venue')
      ) as holder_key,
      e.title      as event_title,
      e.start_at,
      e.end_at
    from public.guest_lists gl
    join public.events e on e.id = gl.event_id
    where (
          (p_venue_id is not null and coalesce(gl.venue_id, e.venue_id, e.partner_venue_id) = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      and (p_event_id is null or gl.event_id = p_event_id)
      and (p_from is null or e.start_at >= p_from)
      and (p_to   is null or e.start_at <= p_to)
  ),
  -- Un invité = une ligne. Identité normalisée pour le rattachement à la dépense.
  guests as (
    select
      ge.id            as entry_id,
      ge.user_id,
      lower(trim(ge.email))                              as email_norm,
      nullif(regexp_replace(coalesce(ge.phone, ''), '\D', '', 'g'), '') as phone_norm,
      ge.entry_scanned,
      ge.entry_scanned_at,
      ge.created_at,
      coalesce(nullif(ge.entry_type, ''), 'normal')      as entry_type,
      lower(coalesce(nullif(ge.gender, ''), 'unknown'))  as gender,
      l.id             as list_id,
      l.quota          as list_quota,
      l.event_id,
      l.event_title,
      l.start_at,
      l.end_at,
      l.holder_type,
      l.holder_label,
      l.holder_key,
      l.promoter_id,
      l.dj_id
    from public.guest_list_entries ge
    join lists l on l.id = ge.guest_list_id
    where ge.status <> 'cancelled'
  ),
  arrived as (
    select * from guests where entry_scanned
  ),
  -- ── Dépense bar rattachée aux invités entrés ──────────────────────────────
  guest_orders as (
    select distinct on (o.id)
      o.id,
      g.entry_id,
      g.event_id,
      g.entry_type,
      g.gender,
      g.list_id,
      g.holder_key,
      coalesce(o.total, 0) as amount
    from arrived g
    join public.orders o
      on o.venue_id = p_venue_id
     and o.status in ('paid', 'served')
     and (
          o.event_id = g.event_id
          or (o.event_id is null
              and o.created_at >= g.start_at - interval '6 hours'
              and o.created_at <= g.end_at   + interval '6 hours')
         )
     and (
          (g.user_id is not null and o.user_id = g.user_id)
          or lower(trim(coalesce(o.user_email, ''))) = g.email_norm
          or (g.phone_norm is not null
              and nullif(regexp_replace(coalesce(o.guest_phone, ''), '\D', '', 'g'), '') = g.phone_norm)
         )
    order by o.id, g.entry_id
  ),
  -- ── Dépense VIP (table réservée par un invité guest list) ─────────────────
  guest_tables as (
    select distinct on (r.id)
      r.id,
      g.entry_id,
      g.event_id,
      g.entry_type,
      g.gender,
      g.list_id,
      g.holder_key,
      coalesce(r.total_price, 0) as amount
    from arrived g
    join public.table_reservations r
      on r.event_id = g.event_id
     and r.status = 'paid'
     and (
          (g.user_id is not null and r.user_id = g.user_id)
          or lower(trim(coalesce(r.user_email, ''))) = g.email_norm
          or (g.phone_norm is not null
              and nullif(regexp_replace(coalesce(r.phone, r.guest_phone, ''), '\D', '', 'g'), '') = g.phone_norm)
         )
    order by r.id, g.entry_id
  ),
  -- Conso servie en table pour ces mêmes invités (bouteilles, deux sauts via la résa)
  guest_vip_items as (
    select vc.id, vc.quantity, vc.total_price, vc.item_type
    from public.vip_consumptions vc
    join guest_tables gt on gt.id = vc.table_reservation_id
  ),
  -- Dépense agrégée par invité, séparée bar / VIP pour le détail par propriétaire
  spend_per_guest as (
    select
      entry_id,
      sum(bar)         as bar,
      sum(vip)         as vip,
      sum(bar + vip)   as amount
    from (
      select entry_id, amount as bar, 0::numeric as vip from guest_orders
      union all
      select entry_id, 0::numeric, amount from guest_tables
    ) s
    group by entry_id
  ),
  -- ── Benchmark : détenteurs de billets payants entrés aux mêmes soirées ────
  paid_entrants as (
    select distinct on (tk.id)
      tk.id,
      tk.user_id,
      lower(trim(coalesce(tk.user_email, ''))) as email_norm,
      tk.event_id
    from public.tickets tk
    join (select distinct event_id from lists) l on l.event_id = tk.event_id
    where tk.status = 'paid'
      and coalesce(tk.entry_scanned, false)
      and coalesce(tk.total_price, 0) > 0
    order by tk.id
  ),
  paid_orders as (
    select distinct on (o.id) o.id, coalesce(o.total, 0) as amount
    from paid_entrants p
    join public.orders o
      on o.venue_id = p_venue_id
     and o.event_id = p.event_id
     and o.status in ('paid', 'served')
     and (
          (p.user_id is not null and o.user_id = p.user_id)
          or lower(trim(coalesce(o.user_email, ''))) = p.email_norm
         )
    order by o.id
  ),
  -- ── Agrégats par propriétaire de liste ───────────────────────────────────
  holder_list_agg as (
    select
      holder_key,
      min(holder_type)  as holder_type,
      min(holder_label) as holder_label,
      count(*)          as lists_n,
      count(distinct event_id) as events_n,
      coalesce(sum(quota) filter (where quota is not null), 0) as quota_total,
      count(*) filter (where quota is not null) as capped_lists
    from lists
    group by holder_key
  ),
  holder_guest_agg as (
    select
      g.holder_key,
      count(*)                                       as signups,
      count(*) filter (where g.entry_scanned)        as arrived,
      count(*) filter (where not g.entry_scanned)    as no_show,
      count(*) filter (where g.list_quota is not null) as capped_signups,
      coalesce(sum(sp.bar), 0)                       as bar_revenue,
      coalesce(sum(sp.vip), 0)                       as vip_revenue,
      coalesce(sum(sp.amount), 0)                    as revenue,
      count(*) filter (where coalesce(sp.amount, 0) > 0) as spenders
    from guests g
    left join spend_per_guest sp on sp.entry_id = g.entry_id
    group by g.holder_key
  ),
  holder_order_agg as (
    select holder_key, count(*) as bar_orders from guest_orders group by holder_key
  ),
  holder_table_agg as (
    select holder_key, count(*) as vip_reservations from guest_tables group by holder_key
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'lists',           (select count(*) from lists),
      'active_lists',    (select count(*) from lists where is_active),
      'events',          (select count(distinct event_id) from lists),
      'signups',         (select count(*) from guests),
      'arrived',         (select count(*) from arrived),
      'no_show',         (select count(*) from guests where not entry_scanned),
      'no_show_rate',    coalesce((select round((count(*) filter (where not entry_scanned))::numeric * 100
                                    / nullif(count(*), 0), 1) from guests), 0),
      'show_rate',       coalesce((select round((count(*) filter (where entry_scanned))::numeric * 100
                                    / nullif(count(*), 0), 1) from guests), 0),
      -- Rappel : quota NULL = illimité → exclu du calcul de remplissage
      'quota_total',     coalesce((select sum(quota) from lists where quota is not null), 0),
      'capped_lists',    (select count(*) from lists where quota is not null),
      'unlimited_lists', (select count(*) from lists where quota is null),
      'fill_rate',       coalesce((
        select round(count(g.entry_id)::numeric * 100 / nullif(sum_q.q, 0), 1)
        from guests g
        join lists l on l.id = g.list_id and l.quota is not null
        cross join (select sum(quota)::numeric q from lists where quota is not null) sum_q
        group by sum_q.q), 0)
    ),
    'spend', jsonb_build_object(
      'bar_revenue',       coalesce((select sum(amount) from guest_orders), 0),
      'vip_revenue',       coalesce((select sum(amount) from guest_tables), 0),
      'total_revenue',     coalesce((select sum(amount) from spend_per_guest), 0),
      'bar_orders',        (select count(*) from guest_orders),
      'vip_reservations',  (select count(*) from guest_tables),
      'bottles',           coalesce((select sum(quantity) from guest_vip_items where item_type = 'bottle'), 0),
      'guests_with_spend', (select count(*) from spend_per_guest where amount > 0),
      'conversion_rate',   coalesce((
        select round((select count(*) from spend_per_guest where amount > 0)::numeric * 100
               / nullif((select count(*) from arrived), 0), 1)), 0),
      -- La métrique qui justifie la guest list : ce que rapporte un invité entré
      'avg_per_arrived',   coalesce((
        select round(coalesce((select sum(amount) from spend_per_guest), 0)
               / nullif((select count(*) from arrived), 0), 2)), 0),
      'avg_per_spender',   coalesce((
        select round(avg(amount)::numeric, 2) from spend_per_guest where amount > 0), 0),
      -- Ce que « coûte » un no-show : place bloquée, zéro consommation
      'lost_value',        coalesce((
        select round(
          coalesce((select sum(amount) from spend_per_guest), 0)
          / nullif((select count(*) from arrived), 0)
          * (select count(*) from guests where not entry_scanned), 2)), 0)
    ),
    'benchmark', jsonb_build_object(
      'guest_avg',   coalesce((
        select round(coalesce((select sum(amount) from spend_per_guest), 0)
               / nullif((select count(*) from arrived), 0), 2)), 0),
      'ticket_avg',  coalesce((
        select round(coalesce((select sum(amount) from paid_orders), 0)
               / nullif((select count(*) from paid_entrants), 0), 2)), 0),
      'ticket_entrants', (select count(*) from paid_entrants),
      'ticket_bar_revenue', coalesce((select sum(amount) from paid_orders), 0)
    ),
    'arrivals_by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'arrivals', arrivals) order by hour)
      from (
        select extract(hour from (entry_scanned_at at time zone p_tz))::int as hour,
               count(*) as arrivals
        from arrived
        where entry_scanned_at is not null
        group by 1
      ) ah), '[]'::jsonb),
    'peak_hour', (
      select extract(hour from (entry_scanned_at at time zone p_tz))::int
      from arrived where entry_scanned_at is not null
      group by 1 order by count(*) desc, 1 limit 1),
    -- Délai d'inscription avant la soirée : mesure l'anticipation réelle du public
    'signup_lead', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'signups', n, 'arrived', a) order by ord)
      from (
        select
          case
            when start_at - created_at >= interval '7 days'  then '7d+'
            when start_at - created_at >= interval '3 days'  then '3-7d'
            when start_at - created_at >= interval '1 day'   then '1-3d'
            when start_at - created_at >= interval '6 hours' then '6-24h'
            else '<6h'
          end as bucket,
          case
            when start_at - created_at >= interval '7 days'  then 1
            when start_at - created_at >= interval '3 days'  then 2
            when start_at - created_at >= interval '1 day'   then 3
            when start_at - created_at >= interval '6 hours' then 4
            else 5
          end as ord,
          count(*) as n,
          count(*) filter (where entry_scanned) as a
        from guests
        group by 1, 2
      ) sl), '[]'::jsonb),
    'by_entry_type', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_type', entry_type, 'signups', n, 'arrived', a,
        'no_show_rate', nsr, 'revenue', rev, 'avg_per_arrived', apa) order by n desc)
      from (
        select
          g.entry_type,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          round((count(*) filter (where not g.entry_scanned))::numeric * 100 / nullif(count(*), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.entry_type
      ) bt), '[]'::jsonb),
    'by_gender', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gender', gender, 'signups', n, 'arrived', a,
        'no_show_rate', nsr, 'revenue', rev, 'avg_per_arrived', apa) order by n desc)
      from (
        select
          g.gender,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          round((count(*) filter (where not g.entry_scanned))::numeric * 100 / nullif(count(*), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.gender
      ) bg), '[]'::jsonb),
    -- Détail complet par propriétaire de liste (alimente le menu déroulant)
    'by_holder', coalesce((
      select jsonb_agg(jsonb_build_object(
        'holder_key',      holder_key,
        'holder_type',     holder_type,
        'holder_label',    holder_label,
        'lists',           lists_n,
        'events',          events_n,
        'signups',         signups,
        'arrived',         arrived_n,
        'no_show',         no_show_n,
        'no_show_rate',    no_show_rate,
        'show_rate',       show_rate,
        'quota_total',     quota_total,
        'capped_lists',    capped_lists,
        'fill_rate',       fill_rate,
        'revenue',         revenue,
        'bar_revenue',     bar_revenue,
        'vip_revenue',     vip_revenue,
        'bar_orders',      bar_orders,
        'vip_reservations', vip_reservations,
        'spenders',        spenders,
        'conversion_rate', conversion_rate,
        'avg_per_arrived', avg_per_arrived,
        'avg_per_spender', avg_per_spender,
        'peak_hour',       peak_hour,
        'arrivals_by_hour', arrivals_by_hour,
        'by_entry_type',   by_entry_type,
        'top_event',       top_event
      ) order by revenue desc, signups desc)
      from (
        select
          hla.holder_key,
          hla.holder_type,
          hla.holder_label,
          hla.lists_n,
          hla.events_n,
          hla.quota_total,
          hla.capped_lists,
          coalesce(hga.signups, 0)      as signups,
          coalesce(hga.arrived, 0)      as arrived_n,
          coalesce(hga.no_show, 0)      as no_show_n,
          coalesce(hga.revenue, 0)      as revenue,
          coalesce(hga.bar_revenue, 0)  as bar_revenue,
          coalesce(hga.vip_revenue, 0)  as vip_revenue,
          coalesce(hga.spenders, 0)     as spenders,
          coalesce(hoa.bar_orders, 0)   as bar_orders,
          coalesce(hta.vip_reservations, 0) as vip_reservations,
          round(coalesce(hga.no_show, 0)::numeric * 100
                / nullif(hga.signups, 0), 1) as no_show_rate,
          round(coalesce(hga.arrived, 0)::numeric * 100
                / nullif(hga.signups, 0), 1) as show_rate,
          -- Remplissage : uniquement les listes plafonnées de ce propriétaire
          round(coalesce(hga.capped_signups, 0)::numeric * 100
                / nullif(hla.quota_total, 0), 1) as fill_rate,
          round(coalesce(hga.spenders, 0)::numeric * 100
                / nullif(hga.arrived, 0), 1) as conversion_rate,
          round(coalesce(hga.revenue, 0) / nullif(hga.arrived, 0), 2)  as avg_per_arrived,
          round(coalesce(hga.revenue, 0) / nullif(hga.spenders, 0), 2) as avg_per_spender,
          (select extract(hour from (g3.entry_scanned_at at time zone p_tz))::int
             from guests g3
            where g3.holder_key = hla.holder_key
              and g3.entry_scanned and g3.entry_scanned_at is not null
            group by 1 order by count(*) desc, 1 limit 1) as peak_hour,
          coalesce((
            select jsonb_agg(jsonb_build_object('hour', hour, 'arrivals', n) order by hour)
            from (
              select extract(hour from (g4.entry_scanned_at at time zone p_tz))::int as hour,
                     count(*) as n
              from guests g4
              where g4.holder_key = hla.holder_key
                and g4.entry_scanned and g4.entry_scanned_at is not null
              group by 1
            ) ha), '[]'::jsonb) as arrivals_by_hour,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'entry_type', et, 'signups', n, 'arrived', a, 'revenue', rev) order by n desc)
            from (
              select g5.entry_type as et,
                     count(*) as n,
                     count(*) filter (where g5.entry_scanned) as a,
                     coalesce(sum(sp5.amount), 0) as rev
              from guests g5
              left join spend_per_guest sp5 on sp5.entry_id = g5.entry_id
              where g5.holder_key = hla.holder_key
              group by g5.entry_type
            ) et), '[]'::jsonb) as by_entry_type,
          (select jsonb_build_object(
             'event_id', ev.event_id, 'title', ev.title, 'start_at', ev.start_at,
             'signups', ev.n, 'arrived', ev.a, 'revenue', ev.rev)
             from (
               select g6.event_id,
                      min(g6.event_title) as title,
                      min(g6.start_at)    as start_at,
                      count(*) as n,
                      count(*) filter (where g6.entry_scanned) as a,
                      coalesce(sum(sp6.amount), 0) as rev
               from guests g6
               left join spend_per_guest sp6 on sp6.entry_id = g6.entry_id
               where g6.holder_key = hla.holder_key
               group by g6.event_id
               order by coalesce(sum(sp6.amount), 0) desc, count(*) desc
               limit 1
             ) ev) as top_event
        from holder_list_agg hla
        left join holder_guest_agg hga on hga.holder_key = hla.holder_key
        left join holder_order_agg hoa on hoa.holder_key = hla.holder_key
        left join holder_table_agg hta on hta.holder_key = hla.holder_key
        order by coalesce(hga.revenue, 0) desc, coalesce(hga.signups, 0) desc
        limit 30
      ) bh), '[]'::jsonb),
    'by_event', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', event_id, 'title', title, 'start_at', start_at,
        'signups', n, 'arrived', a, 'no_show_rate', nsr,
        'revenue', rev, 'avg_per_arrived', apa) order by start_at desc)
      from (
        select
          g.event_id,
          max(g.event_title) as title,
          max(g.start_at) as start_at,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          round((count(*) filter (where not g.entry_scanned))::numeric * 100 / nullif(count(*), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.event_id
        order by max(g.start_at) desc
        limit 20
      ) be), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_guest_list_analytics(text, uuid, timestamptz, timestamptz, text, uuid) to authenticated;

drop function if exists public.get_vip_table_analytics(text, uuid, timestamptz, timestamptz, text);

create or replace function public.get_vip_table_analytics(
  p_venue_id text default null,
  p_event_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Europe/Paris',
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with res as (
    select
      r.id,
      r.zone_id,
      r.total_price,
      coalesce(r.service_fee, 0)     as service_fee,
      coalesce(r.management_fee, 0)   as management_fee,
      -- CA Club (Yuno fees exclus), avant remboursement — foote avec tableAnalytics.totalRevenue.
      greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0) as gross,
      coalesce(r.guest_count, 0)      as guest_count,
      coalesce(r.deposit, 0)          as deposit,
      coalesce(r.minimum_spend, 0)    as minimum_spend,
      r.created_at,
      r.placed_at,
      r.finished_at,
      (r.checked_in_at is not null or coalesce(r.entry_scanned, false)) as arrived,
      e.start_at as event_start
    from public.table_reservations r
    join public.events e on e.id = r.event_id
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      and r.status = 'paid'
      and (p_event_id is null or r.event_id = p_event_id)
      and (p_from is null or r.created_at >= p_from)
      and (p_to   is null or r.created_at <= p_to)
  ),
  buckets as (
    select
      id, gross, guest_count,
      case
        when guest_count <= 2 then '1-2'
        when guest_count <= 4 then '3-4'
        when guest_count <= 6 then '5-6'
        when guest_count <= 8 then '7-8'
        else '9+'
      end as party_bucket,
      case
        when event_start is null then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 1 then 'J-0'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 2 then 'J-1'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 4 then 'J-2-3'
        when (extract(epoch from (event_start - created_at)) / 86400.0) < 8 then 'J-4-7'
        else 'J-8+'
      end as lead_bucket
    from res
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'booking_revenue', coalesce((select sum(gross) from res), 0),
      'reservations',    (select count(*) from res),
      'guests',          coalesce((select sum(guest_count) from res), 0),
      'avg_per_table',   coalesce((select round(avg(gross)::numeric, 2) from res), 0),
      'revenue_per_head', coalesce((
        select round((sum(gross) / nullif(sum(guest_count), 0))::numeric, 2) from res), 0),
      'avg_party_size',  coalesce((
        select round(avg(nullif(guest_count, 0))::numeric, 1) from res), 0),
      'total_deposit',   coalesce((select sum(deposit) from res), 0),
      'total_minimum',   coalesce((select sum(minimum_spend) from res where minimum_spend > 0), 0),
      'arrived_tables',  (select count(*) from res where arrived),
      'no_show_rate',    coalesce((
        select round((100.0 * (count(*) filter (where not arrived)) / nullif(count(*), 0))::numeric, 1)
        from res), 0),
      'avg_rotation_min', coalesce((
        select round(avg(extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'median_rotation_min', coalesce((
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (finished_at - placed_at)) / 60.0)::numeric, 0)
        from res where placed_at is not null and finished_at is not null and finished_at > placed_at), 0),
      'rotation_sample', (select count(*) from res where placed_at is not null and finished_at is not null and finished_at > placed_at)
    ),
    'party_size', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', party_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select party_bucket, count(*) cnt, sum(gross) rev,
               min(case party_bucket when '1-2' then 1 when '3-4' then 2 when '5-6' then 3 when '7-8' then 4 else 5 end) ord
        from buckets group by party_bucket
      ) p), '[]'::jsonb),
    'lead_time', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', lead_bucket, 'count', cnt, 'revenue', rev) order by ord)
      from (
        select lead_bucket, count(*) cnt, sum(gross) rev,
               min(case lead_bucket when 'J-0' then 1 when 'J-1' then 2 when 'J-2-3' then 3 when 'J-4-7' then 4 else 5 end) ord
        from buckets group by lead_bucket
      ) l), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'reservations', reservations, 'revenue', revenue, 'guests', guests,
        'avg_per_table', avg_per_table) order by revenue desc)
      from (
        select r.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               count(*) reservations, sum(r.gross) revenue, sum(r.guest_count) guests,
               round(avg(r.gross)::numeric, 2) avg_per_table
        from res r
        left join public.table_zones tz on tz.id = r.zone_id
        group by r.zone_id, tz.name
      ) z), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'reservations', reservations, 'revenue', revenue) order by hour)
      from (
        select extract(hour from (created_at at time zone p_tz))::int as hour,
               count(*) reservations, sum(gross) revenue
        from res
        group by 1
      ) h), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_vip_table_analytics(text, uuid, timestamptz, timestamptz, text, uuid) to authenticated;

drop function if exists public.get_vip_consumption_analytics(text, uuid, timestamptz, timestamptz, text);

create or replace function public.get_vip_consumption_analytics(
  p_venue_id text default null,
  p_event_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Europe/Paris',
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with facts as (
    select f.*
    from public.vip_consumption_facts f
    where (
          (p_venue_id is not null and f.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and f.event_id in (
            select e.id from public.events e
            where (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id)))
      )
      and (p_event_id is null or f.event_id = p_event_id)
      and (p_from is null or f.served_at >= p_from)
      and (p_to   is null or f.served_at <= p_to)
  ),
  -- Conso agrégée par réservation, pour le calcul upsell vs minimum
  per_res as (
    select f.table_reservation_id, sum(f.total_price) as consumed
    from facts f
    group by f.table_reservation_id
  ),
  res_scope as (
    select r.id, r.minimum_spend, coalesce(pr.consumed, 0) as consumed
    from public.table_reservations r
    join per_res pr on pr.table_reservation_id = r.id
    where r.status = 'paid'
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'revenue',        coalesce((select sum(total_price) from facts), 0),
      'items',          coalesce((select sum(quantity)    from facts), 0),
      'bottles',        coalesce((select sum(quantity)    from facts where item_type = 'bottle'), 0),
      'active_tables',  (select count(distinct table_reservation_id) from facts),
      'included_value', coalesce((select sum(total_price) from facts where is_included), 0),
      'upsell_value',   coalesce((select sum(total_price) from facts where not is_included), 0),
      'avg_per_table',  coalesce((
        select round(avg(t.rev)::numeric, 2) from (
          select table_reservation_id, sum(total_price) rev from facts group by table_reservation_id
        ) t), 0)
    ),
    'top_items', coalesce((
      select jsonb_agg(row_to_json(ti)) from (
        select
          menu_item_id,
          max(item_name)  as name,
          max(category)   as category,
          max(brand)      as brand,
          sum(quantity)   as qty,
          sum(total_price) as revenue
        from facts
        group by menu_item_id, lower(coalesce(item_name, ''))
        order by revenue desc
        limit 15
      ) ti), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', coalesce(category, 'other'), 'qty', qty, 'revenue', revenue) order by revenue desc)
      from (
        select category, sum(quantity) qty, sum(total_price) revenue
        from facts group by category
      ) bc), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'revenue', revenue, 'qty', qty, 'tables', tables) order by revenue desc)
      from (
        select f.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               sum(f.total_price) revenue, sum(f.quantity) qty,
               count(distinct f.table_reservation_id) tables
        from facts f
        left join public.table_zones tz on tz.id = f.zone_id
        group by f.zone_id, tz.name
      ) bz), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'revenue', revenue, 'qty', qty) order by hour)
      from (
        select extract(hour from (served_at at time zone p_tz))::int as hour,
               sum(total_price) revenue, sum(quantity) qty
        from facts
        group by 1
      ) bh), '[]'::jsonb),
    'upsell', jsonb_build_object(
      'total_minimum',      coalesce((select sum(minimum_spend) from res_scope where minimum_spend > 0), 0),
      'total_consumed',     coalesce((select sum(consumed) from res_scope), 0),
      'upsell_amount',      coalesce((select sum(greatest(consumed - coalesce(minimum_spend,0), 0)) from res_scope), 0),
      'tables_over_min',    (select count(*) from res_scope where minimum_spend > 0 and consumed >= minimum_spend),
      'tables_under_min',   (select count(*) from res_scope where minimum_spend > 0 and consumed <  minimum_spend)
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_vip_consumption_analytics(text, uuid, timestamptz, timestamptz, text, uuid) to authenticated;

drop function if exists public.get_events_pnl(text, timestamptz, timestamptz);

create or replace function public.get_events_pnl(
  p_venue_id text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with evs as (
    select e.id, e.title, e.start_at
    from public.events e
    where (
          (p_venue_id is not null and e.venue_id = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
      and (p_from is null or e.start_at >= p_from)
      and (p_to   is null or e.start_at <= p_to)
  ),
  tk as (
    select t.event_id,
      coalesce(sum(greatest(t.total_price - coalesce(t.service_fee,0) - coalesce(t.insurance_fee,0), 0))
        filter (where t.status = 'paid'), 0)                                   as revenue,
      coalesce(sum(t.quantity) filter (where t.status = 'paid'), 0)             as cnt,
      coalesce(sum(t.quantity) filter (where t.status = 'paid' and coalesce(t.entry_scanned,false)), 0) as scanned,
      coalesce(sum(coalesce(t.refund_amount,0)) filter (where t.status = 'refunded' or t.refund_amount > 0), 0) as refunds
    from public.tickets t
    join evs on evs.id = t.event_id
    group by t.event_id
  ),
  dr as (
    select o.event_id,
      coalesce(sum(greatest(o.total - coalesce(o.service_fee,0), 0))
        filter (where o.status in ('paid','served')), 0)                       as revenue,
      coalesce(count(*) filter (where o.status in ('paid','served')), 0)        as cnt,
      coalesce(sum(coalesce(o.refund_amount,0)) filter (where o.status = 'refunded' or o.refund_amount > 0), 0) as refunds
    from public.orders o
    join evs on evs.id = o.event_id
    where p_venue_id is not null
    group by o.event_id
  ),
  tb as (
    select r.event_id,
      coalesce(sum(greatest(r.total_price - coalesce(r.service_fee,0) - coalesce(r.management_fee,0), 0))
        filter (where r.status = 'paid'), 0)                                    as revenue,
      coalesce(count(*) filter (where r.status = 'paid'), 0)                     as cnt,
      coalesce(sum(coalesce(r.guest_count,0))
        filter (where r.status = 'paid' and (r.checked_in_at is not null or coalesce(r.entry_scanned,false))), 0) as guests_arrived,
      coalesce(sum(coalesce(r.refund_amount,0)) filter (where r.status = 'refunded' or r.refund_amount > 0), 0) as refunds
    from public.table_reservations r
    join evs on evs.id = r.event_id
    group by r.event_id
  ),
  glist as (
    select gl.event_id,
      count(gle.id)                                          as signups,
      count(gle.id) filter (where coalesce(gle.entry_scanned,false)) as arrived
    from public.guest_lists gl
    join evs on evs.id = gl.event_id
    left join public.guest_list_entries gle on gle.guest_list_id = gl.id
    group by gl.event_id
  )
  select jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(row_to_json(x) order by x.start_at desc) from (
        select
          evs.id                                        as event_id,
          evs.title                                     as title,
          evs.start_at                                  as start_at,
          coalesce(tk.revenue,0)                        as tickets_revenue,
          coalesce(tk.cnt,0)                            as tickets_count,
          coalesce(dr.revenue,0)                        as drinks_revenue,
          coalesce(dr.cnt,0)                            as drinks_orders,
          coalesce(tb.revenue,0)                        as tables_revenue,
          coalesce(tb.cnt,0)                            as tables_count,
          coalesce(glist.signups,0)                     as guestlist_signups,
          coalesce(glist.arrived,0)                     as guestlist_arrived,
          coalesce(tk.scanned,0) + coalesce(tb.guests_arrived,0) + coalesce(glist.arrived,0) as attendance,
          coalesce(tk.refunds,0) + coalesce(dr.refunds,0) + coalesce(tb.refunds,0)           as refunds,
          coalesce(tk.revenue,0) + coalesce(dr.revenue,0) + coalesce(tb.revenue,0)           as gross,
          (coalesce(tk.revenue,0) + coalesce(dr.revenue,0) + coalesce(tb.revenue,0))
            - (coalesce(tk.refunds,0) + coalesce(dr.refunds,0) + coalesce(tb.refunds,0))     as net
        from evs
        left join tk    on tk.event_id = evs.id
        left join dr    on dr.event_id = evs.id
        left join tb    on tb.event_id = evs.id
        left join glist on glist.event_id = evs.id
      ) x
      where x.gross > 0 or x.guestlist_signups > 0
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_events_pnl(text, timestamptz, timestamptz, uuid) to authenticated;

