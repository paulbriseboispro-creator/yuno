-- ============================================================================
-- Billetterie : les soirées MIROIR d'une billetterie externe (Shotgun,
-- events.external_source) ne sont pas des soirées Yuno.
--
-- Trouvé le 05/10 avant de brancher WOH, compte Billetterie auquel on ajoute
-- Yuno CRM : le connecteur crée une soirée miroir (inactive, privée) par soirée
-- Shotgun, au nom de l'organisateur. La Console CRM les lit exprès ; les
-- écrans de la Billetterie ne les filtraient pas — « Tes 4 dernières soirées »
-- aurait montré les dernières soirées Shotgun à 0 €, « Vos prochaines soirées »,
-- le sélecteur de soirées d'Analytics et le bilan par soirée les auraient
-- listées. Même règle côté front : orgEventsOr / venueEventsOr (src/lib/coorg.ts).
--
-- Corps repris de la base liée (pg_get_functiondef, 05/10) ; seule la condition
-- `external_source IS NULL` est ajoutée à la portée. Une soirée miroir n'a
-- jamais de partenaire ni de co-hôte. analytics_scope_gate couvre d'un coup
-- toutes les RPC qui partent de ses scope_ids (rail, périodes, analytics_*, MCP).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_scope_gate(p_venue_id text, p_organizer_user_id uuid)
 RETURNS TABLE(ok boolean, reason text, scope_venue text, scope_org uuid, money boolean, tz text, scope_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_money boolean := false;
  v_tz    text := 'Europe/Paris';
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
  END IF;
  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')) THEN
      RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
               OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids FROM public.events x
     WHERE (x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id
        OR x.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id)))
       AND x.external_source IS NULL;
    RETURN QUERY SELECT true, null::text, null::text, p_organizer_user_id, v_money, v_tz, v_ids; RETURN;
  END IF;
  IF p_venue_id IS NULL OR NOT (public.can_manage_venue(v_uid, p_venue_id) OR public.is_super_admin()) THEN
    RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, v_tz, '{}'::uuid[]; RETURN;
  END IF;
  v_money := public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                  AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false)));
  SELECT coalesce(v.timezone, 'Europe/Paris') INTO v_tz FROM public.venues v WHERE v.id = p_venue_id;
  SELECT coalesce(array_agg(x.id), '{}') INTO v_ids FROM public.events x
   WHERE (x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id
      OR x.id IN (SELECT public.cohost_event_ids_venue(p_venue_id)))
     AND x.external_source IS NULL;
  RETURN QUERY SELECT true, null::text, p_venue_id, null::uuid, v_money, coalesce(v_tz, 'Europe/Paris'), v_ids;
END;
$function$;

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
  v_by_end boolean := false;
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

  -- Périodes en temps (24 h, 48 h, 7 j, 30 j, 90 j) : les soirées TERMINÉES
  -- dont la fin tombe dans la fenêtre ; la période d'avant = le même nombre de
  -- soirées juste avant (règle inchangée : on ne compare qu'à nombre égal).
  v_by_end := p_period in ('d1', 'd2', 'd7', 'd30', 'd90');
  v_from := case p_period
    when 'month' then date_trunc('month', v_now at time zone v_tz) at time zone v_tz
    when 'year'  then date_trunc('year',  v_now at time zone v_tz) at time zone v_tz
    when 'd1'    then v_now - interval '24 hours'
    when 'd2'    then v_now - interval '48 hours'
    when 'd7'    then v_now - interval '7 days'
    when 'd30'   then v_now - interval '30 days'
    when 'd90'   then v_now - interval '90 days'
    else null
  end;
  v_limit := case p_period when 'last' then 1 when 'last4' then 4 else null end;

  with
  -- Toutes les soirées commencées de la portée, de la plus récente à la plus
  -- ancienne ; `rn` numérote cette file.
  scope as materialized (
    select e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '8 hours') as end_ts, coalesce(e.poster_url, e.image_url) as poster,
           e.max_tickets, e.venue_id, e.partner_venue_id,
           case when v_is_org then v_money else v_money and e.venue_id = p_venue_id end as show_money,
           row_number() over (order by e.start_at desc) as rn
    from public.events e
    -- Soirées TERMINÉES : une soirée en cours (entrées partielles) n'est pas
    -- « la dernière soirée ».
    where coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
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
      and (v_from is null or (case when v_by_end then s.end_ts else s.start_at end) >= v_from)
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
           sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount,
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
               greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
               - least(greatest(coalesce(r.refund_amount, 0), 0),
                       greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
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
           + coalesce((select sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0),
                                  greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
                       from public.table_reservations r where r.event_id = e.id and r.status in ('paid', 'confirmed')), 0) as amount
      from public.tickets t where t.event_id = e.id and t.status in ('paid', 'used')
    ) x on true
    where e.start_at > v_now
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
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
$function$;

CREATE OR REPLACE FUNCTION public.get_events_sales_summary(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id
                    or public.coorg_sees_event_money(e.id, 'org:' || p_organizer_user_id::text))
             else v_money and (e.venue_id = p_venue_id
                               or public.coorg_cohost_sees_money(e.id, 'venue:' || p_venue_id))
           end as show_money
    from public.events e
    left join public.venues v on v.id = coalesce(e.venue_id, e.partner_venue_id)
    where e.end_at > v_now - interval '12 hours'
      and e.cancelled_at is null
      and coalesce(e.status, 'active') <> 'cancelled'
      and e.external_source is null
      and (
           (p_venue_id is not null and (e.venue_id = p_venue_id or e.partner_venue_id = p_venue_id or e.id in (select public.cohost_event_ids_venue(p_venue_id))))
        or (p_organizer_user_id is not null
            and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))
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
             greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
           ), 0) as amount,
           coalesce(sum(
             greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
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
$function$;

CREATE OR REPLACE FUNCTION public.get_events_pnl(p_venue_id text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where e.external_source is null and (
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
      coalesce(sum(greatest(r.total_price - coalesce(r.service_fee,0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
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
$function$;
