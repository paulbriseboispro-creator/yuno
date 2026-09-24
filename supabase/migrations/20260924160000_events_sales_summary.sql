-- =============================================================================
-- Chiffres de vente par soirée à venir — liste des soirées + tableau de bord
-- =============================================================================
-- Premier écran de Shotgun : chaque soirée en vente porte son compte à rebours
-- (J-2), ses ventes en TOTAL et AUJOURD'HUI, et une jauge de remplissage. Chez
-- Yuno la liste des soirées était muette, et le tableau de bord ne montrait
-- qu'une seule soirée. Cette RPC sert les deux écrans, club ET organisateur,
-- pour les trois piliers (billets, tables, guest list) + les boissons
-- précommandées côté club.
--
-- Mêmes statuts et mêmes formules que `get_live_view` / `get_purchase_behavior` :
--   - billets `paid`/`used`, tables `paid`/`confirmed`, boissons
--     `paid`/`served`, guest list `<> cancelled` ;
--   - CA club = total − frais de service − assurance / gestion (fees.ts),
--     remboursement déduit et plafonné au brut ;
--   - l'instant de vente = `coalesce(paid_at, created_at)` ;
--   - « aujourd'hui » = depuis minuit dans le fuseau de la soirée
--     (sinon du club, sinon Paris).
--
-- Les MONTANTS ne partent qu'à qui a le droit de voir l'argent : owner, super
-- admin, manager avec `can_view_analytics` / `can_view_finance`, fondateur de
-- l'organisation ou membre avec `view_finance`. Un éditeur d'équipe voit les
-- compteurs (il prépare les soirées), jamais le CA : `revenue` vaut alors NULL.
-- Côté club, une soirée seulement ACCUEILLIE (`partner_venue_id`) montre ses
-- compteurs mais pas son CA, qui appartient à l'organisateur.
-- =============================================================================

create index if not exists idx_tickets_event_status
  on public.tickets (event_id, status);

drop function if exists public.get_events_sales_summary(text, uuid);

create or replace function public.get_events_sales_summary(
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
  v_money  boolean := false;
  v_events jsonb := '[]'::jsonb;
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
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
  end if;

  with
  ev as materialized (
    select e.id, e.title, e.start_at, e.end_at, e.status, e.is_active, e.cancelled_at,
           e.published_at, coalesce(e.poster_url, e.image_url) as poster,
           e.ticketing_enabled, e.tables_enabled,
           e.tickets_sold_out, e.tables_sold_out, e.guest_list_sold_out,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           coalesce(e.sold_out_pack_ids, '{}'::uuid[]) as closed_packs,
           date_trunc('day', v_now at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris'))
             at time zone coalesce(e.timezone, v.timezone, 'Europe/Paris') as day_start,
           case
             when p_organizer_user_id is not null then v_money
             else v_money and e.venue_id = p_venue_id
           end as show_money
    from public.events e
    left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
    where e.end_at > v_now - interval '12 hours'
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (p_venue_id is not null and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (p_organizer_user_id is not null
            and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
    order by e.start_at
    limit 60
  ),

  tk as (
    select t.event_id,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) as sold,
           coalesce(sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as sold_today,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
           ) filter (where coalesce(t.paid_at, t.created_at) >= ev.day_start), 0) as amount_today
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),

  rounds as (
    select tr.event_id,
           count(*) as n,
           count(*) filter (where coalesce(tr.max_tickets, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(tr.max_tickets, 0), 0)), 0) as cap
    from public.ticket_rounds tr
    join ev on ev.id = tr.event_id
    group by tr.event_id
  ),

  tb as (
    select r.event_id,
           count(*) as booked,
           count(*) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start) as booked_today,
           coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0) as guests,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
           ) filter (where coalesce(r.paid_at, r.created_at) >= ev.day_start), 0) as amount_today
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),

  -- Même inventaire que `_event_tables_left` : formules actives de la soirée,
  -- ou du club quand la formule n'est pas event-scopée, formules « complètes »
  -- exclues.
  packs as (
    select ev.id as event_id, coalesce(sum(p.tables_count), 0)::integer as cap
    from ev
    join public.table_packs p
      on p.is_active
     and (p.event_id = ev.id
          or (p.event_id is null and coalesce(ev.venue_id, ev.partner_venue_id) is not null
              and p.venue_id = coalesce(ev.venue_id, ev.partner_venue_id)))
     and not (p.id = any (ev.closed_packs))
    group by ev.id
  ),

  gls as (
    select gl.event_id,
           count(*) filter (where gl.is_active) as lists,
           count(*) filter (where gl.is_active and coalesce(gl.quota, 0) <= 0) as unbounded,
           coalesce(sum(greatest(coalesce(gl.quota, 0), 0)) filter (where gl.is_active), 0) as cap,
           bool_and(coalesce(gl.manually_sold_out, false)) filter (where gl.is_active) as all_closed
    from public.guest_lists gl
    join ev on ev.id = gl.event_id
    group by gl.event_id
  ),

  gle as (
    select gl.event_id,
           count(*) as registered,
           count(*) filter (where e2.created_at >= ev.day_start) as registered_today
    from public.guest_list_entries e2
    join public.guest_lists gl on gl.id = e2.guest_list_id
    join ev on ev.id = gl.event_id
    where e2.status <> 'cancelled'
    group by gl.event_id
  ),

  dr as (
    select o.event_id,
           count(*) as orders,
           count(*) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start) as orders_today,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           ) filter (where coalesce(o.paid_at, o.created_at) >= ev.day_start), 0) as amount_today
    from public.orders o
    join ev on ev.id = o.event_id
    where p_venue_id is not null
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
    group by o.event_id
  ),

  vis as (
    select s.event_id,
           count(*) as total,
           count(*) filter (where s.visited_at >= ev.day_start) as today
    from public.visitor_sessions s
    join ev on ev.id = s.event_id
    group by s.event_id
  )

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id,
           'title', ev.title,
           'startAt', ev.start_at,
           'endAt', ev.end_at,
           'poster', ev.poster,
           'status', ev.status,
           'isActive', ev.is_active,
           'publishedAt', ev.published_at,
           'dayStart', ev.day_start,
           'tickets', jsonb_build_object(
             'enabled', coalesce(ev.ticketing_enabled, false),
             'soldOut', coalesce(ev.tickets_sold_out, false),
             'sold', coalesce(tk.sold, 0),
             'today', coalesce(tk.sold_today, 0),
             'capacity', case
               when coalesce(ev.max_tickets, 0) > 0 then ev.max_tickets
               when rounds.n > 0 and rounds.unbounded = 0 then rounds.cap
               else null end
           ),
           'tables', jsonb_build_object(
             'enabled', coalesce(ev.tables_enabled, false),
             'soldOut', coalesce(ev.tables_sold_out, false),
             'booked', coalesce(tb.booked, 0),
             'today', coalesce(tb.booked_today, 0),
             'guests', coalesce(tb.guests, 0),
             'capacity', case when coalesce(packs.cap, 0) > 0 then packs.cap else null end
           ),
           'guestList', jsonb_build_object(
             'enabled', coalesce(gls.lists, 0) > 0,
             'soldOut', coalesce(ev.guest_list_sold_out, false) or coalesce(gls.all_closed, false),
             'registered', coalesce(gle.registered, 0),
             'today', coalesce(gle.registered_today, 0),
             'capacity', case when coalesce(gls.lists, 0) > 0 and gls.unbounded = 0 and gls.cap > 0
                              then gls.cap else null end
           ),
           'drinks', case when p_venue_id is not null then jsonb_build_object(
             'orders', coalesce(dr.orders, 0),
             'today', coalesce(dr.orders_today, 0)
           ) else null end,
           'visits', jsonb_build_object(
             'total', coalesce(vis.total, 0),
             'today', coalesce(vis.today, 0)
           ),
           'revenue', case when ev.show_money then jsonb_build_object(
             'total', round((coalesce(tk.amount, 0) + coalesce(tb.amount, 0) + coalesce(dr.amount, 0))::numeric, 2),
             'today', round((coalesce(tk.amount_today, 0) + coalesce(tb.amount_today, 0) + coalesce(dr.amount_today, 0))::numeric, 2),
             'tickets', round(coalesce(tk.amount, 0)::numeric, 2),
             'tables', round(coalesce(tb.amount, 0)::numeric, 2),
             'drinks', round(coalesce(dr.amount, 0)::numeric, 2)
           ) else null end
         ) order by ev.start_at), '[]'::jsonb)
    into v_events
  from ev
  left join tk     on tk.event_id = ev.id
  left join rounds on rounds.event_id = ev.id
  left join tb     on tb.event_id = ev.id
  left join packs  on packs.event_id = ev.id
  left join gls    on gls.event_id = ev.id
  left join gle    on gle.event_id = ev.id
  left join dr     on dr.event_id = ev.id
  left join vis    on vis.event_id = ev.id;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'money', v_money,
    'events', v_events
  );
end;
$$;

revoke all on function public.get_events_sales_summary(text, uuid) from public;
grant execute on function public.get_events_sales_summary(text, uuid) to authenticated;

comment on function public.get_events_sales_summary(text, uuid) is
  'Soirées à venir d''un club ou d''un organisateur : billets, tables, guest list, boissons et visites, en total et aujourd''hui, avec capacité. CA (formules fees.ts, remboursements déduits) seulement pour qui voit l''argent.';
