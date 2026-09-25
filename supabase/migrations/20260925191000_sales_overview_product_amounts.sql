-- Ventes › Bar : le montant d'un produit suit le CA club (2026-09-25).
--
-- `get_sales_overview.products[].amount` valait quantité × prix carte : les
-- frais Yuno (5 % pris dans le total d'une commande) et les remboursements
-- partiels n'étaient pas déduits, la liste des produits dépassait donc le CA
-- du bar affiché juste au-dessus. Chaque ligne reçoit désormais sa part du CA
-- CLUB de sa commande (fees.ts : total − frais, remboursement déduit), au
-- prorata du prix carte. Vérifié sur la démo : somme des produits = rev_bar
-- au centime. Corps repris de la base liée (pg_get_functiondef), seul le bloc
-- products_list change.

CREATE OR REPLACE FUNCTION public.get_sales_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT 'last4'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_money  boolean := false;
  v_is_org boolean := p_organizer_user_id is not null;
  v_tz     text := 'Europe/Paris';
  v_from   timestamptz;
  v_limit  integer;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if v_is_org then
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
    select coalesce(v.timezone, 'Europe/Paris') into v_tz from public.venues v where v.id = p_venue_id;
  end if;

  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
    order by e.start_at desc
    limit 1000
  ),
  cur_n as (
    select count(*)::integer as n from scope s
    where (v_limit is null or s.rn <= v_limit)
      and (v_from is null or s.start_at >= v_from)
  ),
  -- Période courante = les N premières ; précédente = les N suivantes.
  -- « Tout » n'a pas de période précédente.
  nights as materialized (
    select s.*, case when s.rn <= c.n then 'cur' else 'prev' end as bucket
    from scope s cross join cur_n c
    where s.rn <= c.n
       or (p_period <> 'all' and c.n > 0 and s.rn > c.n and s.rn <= 2 * c.n)
  ),

  tk as (
    select t.event_id,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           count(*) as orders,
           sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) as amount,
           sum(case when coalesce(t.total_price, 0) > 0 then round(t.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           sum(greatest(coalesce(t.quantity, 1), 1))
             filter (where coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as entered
    from public.tickets t
    join nights n on n.id = t.event_id
    where t.status in ('paid', 'used')
    group by t.event_id
  ),
  tb as (
    select r.event_id,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))) as amount,
           sum(case when coalesce(r.payment_mode, 'online') <> 'on_site' and coalesce(r.total_price, 0) > 0
                    then round(r.total_price * 0.015 + 0.25, 2) else 0 end) as stripe,
           count(*) filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as arrived,
           sum(greatest(coalesce(r.guest_count, 0), 1))
             filter (where coalesce(r.entry_scanned, false) or r.checked_in_at is not null) as entered
    from public.table_reservations r
    join nights n on n.id = r.event_id
    where r.status in ('paid', 'confirmed')
    group by r.event_id
  ),
  dr as (
    select o.event_id,
           count(*) as orders,
           sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
               - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount,
           sum(case when coalesce(o.total, 0) > 0 then round(o.total * 0.015 + 0.25, 2) else 0 end) as stripe
    from public.orders o
    join nights n on n.id = o.event_id
    where not v_is_org
      and o.status in ('paid', 'served')
    group by o.event_id
  ),
  gl as (
    select g.event_id,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id
    where e2.status <> 'cancelled'
    group by g.event_id
  ),
  caps as (
    select n.id as event_id,
           -- Même capacité que get_event_report : un palier illimité rend la
           -- jauge sans capacité (pas un remplissage au-delà de 100 %).
           case when coalesce(n.max_tickets, 0) > 0 then n.max_tickets
                when exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id)
                 and not exists (select 1 from public.ticket_rounds tr where tr.event_id = n.id and coalesce(tr.max_tickets, 0) <= 0)
                  then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = n.id)
                else null end as cap
    from nights n
  ),
  -- Personnes distinctes par soirée et par période (tous piliers).
  people as (
    select n.bucket, n.id as event_id, lower(trim(x.email)) as email
    from nights n
    join lateral (
      select t.user_email as email from public.tickets t where t.event_id = n.id and t.status in ('paid', 'used')
      union all
      select r.user_email from public.table_reservations r where r.event_id = n.id and r.status in ('paid', 'confirmed')
      union all
      select o.user_email from public.orders o where not v_is_org and o.event_id = n.id and o.status in ('paid', 'served')
      union all
      select e2.email from public.guest_list_entries e2 join public.guest_lists g on g.id = e2.guest_list_id
       where g.event_id = n.id and e2.status <> 'cancelled'
    ) x on true
    where nullif(trim(x.email), '') is not null
  ),
  per_night as (
    select n.id, n.title, n.start_at, n.poster, n.bucket, n.rn, n.show_money,
           coalesce(tk.sold, 0) as tickets, coalesce(tk.orders, 0) as ticket_orders,
           coalesce(tb.booked, 0) as tables, coalesce(tb.guests, 0) as table_guests, coalesce(tb.arrived, 0) as tables_arrived,
           coalesce(dr.orders, 0) as bar_orders,
           coalesce(gl.registered, 0) as gl_registered, coalesce(gl.entered, 0) as gl_entered,
           coalesce(tk.entered, 0) + coalesce(tb.entered, 0) + coalesce(gl.entered, 0) as entries,
           coalesce(tk.entered, 0) as ticket_entries,
           case when n.show_money then coalesce(tk.amount, 0) else 0 end as rev_tickets,
           case when n.show_money then coalesce(tb.amount, 0) else 0 end as rev_tables,
           case when n.show_money then coalesce(dr.amount, 0) else 0 end as rev_bar,
           case when n.show_money then coalesce(tk.stripe, 0) + coalesce(tb.stripe, 0) + coalesce(dr.stripe, 0) else 0 end as stripe,
           caps.cap,
           (select count(distinct p.email) from people p where p.event_id = n.id) as customers
    from nights n
    left join tk on tk.event_id = n.id
    left join tb on tb.event_id = n.id
    left join dr on dr.event_id = n.id
    left join gl on gl.event_id = n.id
    left join caps on caps.event_id = n.id
  ),
  totals as (
    select b.bucket,
           count(pn.id) as nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar), 0) as revenue,
           coalesce(sum(pn.rev_tickets), 0) as rev_tickets,
           coalesce(sum(pn.rev_tables), 0) as rev_tables,
           coalesce(sum(pn.rev_bar), 0) as rev_bar,
           coalesce(sum(pn.stripe), 0) as stripe,
           coalesce(sum(pn.entries), 0) as entries,
           coalesce(sum(pn.ticket_entries), 0) as ticket_entries,
           coalesce(sum(pn.tickets), 0) as tickets,
           coalesce(sum(pn.ticket_orders), 0) as ticket_orders,
           coalesce(sum(pn.tables), 0) as tables,
           coalesce(sum(pn.table_guests), 0) as table_guests,
           coalesce(sum(pn.tables_arrived), 0) as tables_arrived,
           coalesce(sum(pn.bar_orders), 0) as bar_orders,
           coalesce(sum(pn.gl_registered), 0) as gl_registered,
           coalesce(sum(pn.gl_entered), 0) as gl_entered,
           coalesce(sum(pn.cap) filter (where pn.cap > 0), 0) as ticket_cap,
           coalesce(sum(pn.tickets) filter (where pn.cap > 0), 0) as tickets_with_cap,
           -- Dénominateurs justes (revue du 25/09) : la dépense par tête ne
           -- compte que les soirées dont on voit l'argent ET où la porte a
           -- scanné ; la présence, que les soirées où la porte a scanné (sans
           -- scan, « pas scanné » ne veut pas dire « pas venu ») ; prix moyens
           -- sur les soirées dont on voit l'argent.
           count(pn.id) filter (where pn.show_money) as money_nights,
           coalesce(sum(pn.rev_tickets + pn.rev_tables + pn.rev_bar) filter (where pn.show_money and pn.entries > 0), 0) as spend_revenue,
           coalesce(sum(pn.entries) filter (where pn.show_money and pn.entries > 0), 0) as spend_entries,
           coalesce(sum(pn.entries) filter (where pn.entries > 0), 0) as presence_entries,
           coalesce(sum(pn.tickets + pn.table_guests + pn.gl_registered) filter (where pn.entries > 0), 0) as presence_expected,
           coalesce(sum(pn.gl_registered) filter (where pn.gl_entered > 0), 0) as gl_presence_registered,
           coalesce(sum(pn.gl_entered) filter (where pn.gl_entered > 0), 0) as gl_presence_entered,
           coalesce(sum(pn.tables) filter (where pn.tables_arrived > 0), 0) as tables_presence_booked,
           coalesce(sum(pn.tables_arrived) filter (where pn.tables_arrived > 0), 0) as tables_presence_arrived,
           coalesce(sum(pn.tickets) filter (where pn.show_money), 0) as money_tickets,
           coalesce(sum(pn.tables) filter (where pn.show_money), 0) as money_tables,
           coalesce(sum(pn.bar_orders) filter (where pn.show_money), 0) as money_bar_orders,
           (select count(distinct p.email) from people p where p.bucket = b.bucket) as customers
    from (values ('cur'), ('prev')) b(bucket)
    left join per_night pn on pn.bucket = b.bucket
    group by b.bucket
  ),
  -- Détail des piliers, période courante seulement.
  rounds_list as (
    select tr.name,
           sum(greatest(coalesce(t.quantity, 1), 1)) as sold,
           sum(case when n.show_money then
               greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
               - least(greatest(coalesce(t.refund_amount, 0), 0),
                       greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
               else 0 end) as amount
    from public.tickets t
    join nights n on n.id = t.event_id and n.bucket = 'cur'
    join public.ticket_rounds tr on tr.id = t.ticket_round_id
    where t.status in ('paid', 'used')
    group by tr.name
    order by 2 desc
    limit 12
  ),
  packs_list as (
    select coalesce(p.name, '—') as name,
           count(*) as booked,
           sum(greatest(coalesce(r.guest_count, 0), 0)) as guests,
           sum(case when n.show_money then
               greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
               else 0 end) as amount
    from public.table_reservations r
    join nights n on n.id = r.event_id and n.bucket = 'cur'
    left join public.table_packs p on p.id = r.pack_id
    where r.status in ('paid', 'confirmed')
    group by 1
    order by 4 desc, 2 desc
    limit 12
  ),
  -- Montant d'un produit = sa part du CA CLUB de la commande (fees.ts : total
  -- − frais Yuno, remboursement déduit), au prorata du prix carte : la somme
  -- des produits retombe exactement sur le CA du bar, jamais au-dessus.
  order_lines as (
    select o.id as order_id,
           it.value ->> 'name' as name,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1) as qty,
           greatest(coalesce((it.value ->> 'quantity')::numeric, (it.value ->> 'qty')::numeric, 1), 1)
             * greatest(coalesce((it.value ->> 'price')::numeric, 0), 0) as gross,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)) as order_net
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur' and n.show_money
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
    where not v_is_org and o.status in ('paid', 'served')
      and nullif(it.value ->> 'name', '') is not null
  ),
  products_list as (
    select l.name,
           sum(l.qty) as qty,
           round(sum(case when t.gross_total > 0 then l.order_net * l.gross / t.gross_total else 0 end), 2) as amount
    from order_lines l
    join (select order_id, sum(gross) as gross_total from order_lines group by 1) t on t.order_id = l.order_id
    group by 1
    order by 2 desc
    limit 10
  ),
  bar_service as (
    select percentile_cont(0.5) within group (
             order by extract(epoch from (o.served_at - coalesce(o.paid_at, o.created_at))) / 60.0
           ) as median_min,
           count(*) as sample
    from public.orders o
    join nights n on n.id = o.event_id and n.bucket = 'cur'
    where not v_is_org and o.status = 'served' and o.served_at is not null
      and o.served_at > coalesce(o.paid_at, o.created_at)
      and o.served_at < coalesce(o.paid_at, o.created_at) + interval '3 hours'
  ),
  holders_list as (
    select case g.holder_type
             when 'club' then 'club' when 'organizer' then 'organizer' else coalesce(nullif(g.holder_label, ''), g.holder_type)
           end as name,
           g.holder_type as kind,
           count(*) as registered,
           count(*) filter (where coalesce(e2.entry_scanned, false)) as entered
    from public.guest_list_entries e2
    join public.guest_lists g on g.id = e2.guest_list_id
    join nights n on n.id = g.event_id and n.bucket = 'cur'
    where e2.status <> 'cancelled'
    group by 1, 2
    order by 3 desc
    limit 12
  ),
  -- Déjà vendu pour les soirées À VENIR (renvoie vers les prochaines soirées).
  upcoming as (
    select count(distinct e.id) as nights,
           coalesce(sum(
             case when (v_is_org and v_money) or (not v_is_org and v_money and e.venue_id = p_venue_id) then x.amount else 0 end
           ), 0) as amount
    from public.events e
    left join lateral (
      select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0),
                                  greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and (
           (not v_is_org and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id))
        or (v_is_org and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id))
      )
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'has_bar', not v_is_org,
    'period', p_period,
    'generated_at', v_now,
    'current', (select to_jsonb(t) - 'bucket' from totals t where t.bucket = 'cur'),
    'previous', case when p_period = 'all' then null
                     -- Une comparaison n'a de sens qu'à nombre de soirées égal.
                     else (select case when t.nights > 0 and t.nights = (select n from cur_n) then to_jsonb(t) - 'bucket' end
                           from totals t where t.bucket = 'prev') end,
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pn.id, 'title', pn.title, 'start_at', pn.start_at, 'poster', pn.poster,
               'revenue', case when pn.show_money then pn.rev_tickets + pn.rev_tables + pn.rev_bar end,
               'rev_tickets', case when pn.show_money then pn.rev_tickets end,
               'rev_tables', case when pn.show_money then pn.rev_tables end,
               'rev_bar', case when pn.show_money then pn.rev_bar end,
               'entries', pn.entries, 'customers', pn.customers,
               'tickets', pn.tickets, 'ticket_cap', pn.cap, 'tables', pn.tables,
               'table_guests', pn.table_guests, 'tables_arrived', pn.tables_arrived,
               'bar_orders', pn.bar_orders,
               'gl_registered', pn.gl_registered, 'gl_entered', pn.gl_entered
             ) order by pn.start_at desc)
      from per_night pn where pn.bucket = 'cur'
    ), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'sold', r.sold,
                         'amount', case when v_money then r.amount end)) from rounds_list r), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'booked', p.booked, 'guests', p.guests,
                        'amount', case when v_money then p.amount end)) from packs_list p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty,
                           'amount', case when v_money then p.amount end)) from products_list p), '[]'::jsonb),
    'bar_service_min', (select case when b.sample >= 5 then round(b.median_min::numeric, 1) end from bar_service b),
    'holders', coalesce((select jsonb_agg(jsonb_build_object('name', h.name, 'kind', h.kind,
                          'registered', h.registered, 'entered', h.entered)) from holders_list h), '[]'::jsonb),
    'upcoming', (select jsonb_build_object('nights', u.nights, 'amount', case when v_money then u.amount end) from upcoming u)
  ) into v_result;

  -- Sans l'argent, aucun montant ne sort, même agrégé.
  if not v_money then
    v_result := jsonb_set(v_result, '{current}',
      (v_result -> 'current') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    if v_result -> 'previous' is not null and jsonb_typeof(v_result -> 'previous') = 'object' then
      v_result := jsonb_set(v_result, '{previous}',
        (v_result -> 'previous') - 'revenue' - 'rev_tickets' - 'rev_tables' - 'rev_bar' - 'stripe' - 'spend_revenue');
    end if;
  end if;

  return v_result;
end;
$function$
;
