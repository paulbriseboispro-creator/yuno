-- Bilan par soirée : les soirées À VENIR qui vendent comptent.
--
-- Même angle mort que get_guest_list_analytics (20260905090000) : la fenêtre
-- sélectionnait les soirées par date, donc une soirée de la semaine prochaine
-- qui encaisse aujourd'hui n'avait pas de ligne en vue « 7 jours ». Une soirée
-- entre dans la période si elle y tombe OU si elle a vendu / reçu un inscrit
-- pendant la période. Même signature, CREATE OR REPLACE suffit.

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
      -- Une soirée est dans la période si elle y tombe OU si elle a encaissé
      -- (billet, table, commande) ou reçu un inscrit guest list pendant la
      -- période : une soirée à venir qui vend cette semaine a sa ligne.
      and (
        ((p_from is null or e.start_at >= p_from) and (p_to is null or e.start_at <= p_to))
        or exists (select 1 from public.tickets t where t.event_id = e.id and t.status = 'paid'
                   and (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at <= p_to))
        or exists (select 1 from public.table_reservations r where r.event_id = e.id and r.status = 'paid'
                   and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at <= p_to))
        or (p_venue_id is not null and exists (select 1 from public.orders o where o.event_id = e.id and o.status in ('paid','served')
                   and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at <= p_to)))
        or exists (select 1 from public.guest_lists gl join public.guest_list_entries x on x.guest_list_id = gl.id
                   where gl.event_id = e.id and x.status <> 'cancelled'
                   and (p_from is null or x.created_at >= p_from) and (p_to is null or x.created_at <= p_to))
      )
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
