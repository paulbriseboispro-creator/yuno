-- =============================================================================
-- Comportement d'achat — page Analytics, club ET organisateur
-- =============================================================================
-- `/owner/analytics?tab=purchase` et `/organizer-app/analytics?tab=purchase`.
-- Le reste de la page Analytics répond à « combien ai-je vendu ? » ; cet
-- onglet répond à « comment mes clients achètent-ils ? » : quand (délai avant
-- la soirée, jour et heure), combien (taille de groupe, panier, palier),
-- quoi en plus (assurance, boisson incluse, consentements), qui (nouveaux,
-- habitués, concentration), par quel canal, avec quel passage à l'achat, et
-- s'ils viennent vraiment une fois le billet payé.
--
-- Une SEULE RPC, `get_purchase_behavior`, sert tout l'écran en un aller-retour.
-- Aucun chiffre n'est agrégé côté front. Même porte, mêmes statuts et mêmes
-- formules que `get_live_view` :
--   - billets `paid`/`used`, tables `paid`/`confirmed`, boissons
--     `paid`/`served`, guest list `<> cancelled` ;
--   - CA club = total − frais de service − assurance / gestion (fees.ts),
--     remboursement club déduit et plafonné au brut ;
--   - l'instant d'achat = `coalesce(paid_at, created_at)`, fenêtre [from, to[ ;
--   - un acheteur = son email en minuscules (les invités sans compte comptent).
-- Les boissons n'existent qu'en portée club : l'organisateur ne tient pas de
-- bar, et les commandes du bar d'un club ne lui appartiennent pas.
--
-- Présence (no-show) : seules les soirées TERMINÉES et dont la porte a scanné
-- au moins une entrée comptent — sans scanner, « pas scanné » ne veut pas
-- dire « pas venu » (même règle que les recettes « Merci » / « On t'a manqué »).
-- =============================================================================

create index if not exists idx_orders_event_email
  on public.orders (event_id, lower(user_email))
  where event_id is not null;

drop function if exists public.get_purchase_behavior(text, uuid, timestamptz, timestamptz);

create or replace function public.get_purchase_behavior(
  p_venue_id text default null,
  p_organizer_user_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_from      timestamptz := coalesce(p_from, '2020-01-01'::timestamptz);
  v_to        timestamptz := coalesce(p_to, now());
  v_tz        text := 'Europe/Paris';
  v_event_ids uuid[];
  v_drinks    boolean := p_venue_id is not null;
  v_result    jsonb;
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

  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris') into v_tz
    from public.venues v where v.id = p_venue_id;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;

  with
  ev as materialized (
    select e.id, e.start_at, e.end_at
    from public.events e
    where e.id = any(v_event_ids)
  ),

  -- ── Toutes les ventes de la période, une ligne par transaction ─────────
  tx as materialized (
    select 'tickets'::text as pillar,
           t.id,
           lower(t.user_email) as buyer,
           t.event_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           ev.start_at, ev.end_at,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(t.is_guest, false) as is_guest,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id is not null as tracked,
           coalesce(t.has_insurance, false) as insurance,
           t.drink_id is not null as bundled_drink,
           coalesce(t.drink_redeemed, false) as drink_redeemed,
           coalesce(t.is_upgrade, false) as upgrade,
           coalesce(t.is_loyalty_reward, false) as loyalty,
           coalesce(t.newsletter_opt_in, false) as newsletter,
           coalesce(t.sms_opt_in, false) as sms,
           t.ticket_round_id as round_id,
           (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used') as scanned,
           t.entry_scanned_at as scanned_at,
           null::integer as guests,
           null::integer as items,
           false as deposit_only,
           false as on_site
    from public.tickets t
    join ev on ev.id = t.event_id
    where t.status in ('paid', 'used')
      and coalesce(t.paid_at, t.created_at) >= v_from
      and coalesce(t.paid_at, t.created_at) < v_to

    union all

    select 'tables',
           r.id,
           lower(r.user_email),
           r.event_id,
           coalesce(r.paid_at, r.created_at),
           ev.start_at, ev.end_at,
           1,
           greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)),
           coalesce(r.is_guest, false),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id is not null,
           false, false, false, false, false,
           coalesce(r.newsletter_opt_in, false),
           coalesce(r.sms_opt_in, false),
           null::uuid,
           (coalesce(r.entry_scanned, false) or r.checked_in_at is not null),
           coalesce(r.entry_scanned_at, r.checked_in_at),
           greatest(coalesce(r.guest_count, 0), 0),
           null::integer,
           (coalesce(r.deposit, 0) > 0 and coalesce(r.deposit, 0) < r.total_price),
           coalesce(r.payment_mode, 'online') = 'on_site'
    from public.table_reservations r
    join ev on ev.id = r.event_id
    where r.status in ('paid', 'confirmed')
      and coalesce(r.paid_at, r.created_at) >= v_from
      and coalesce(r.paid_at, r.created_at) < v_to

    union all

    select 'drinks',
           o.id,
           coalesce(lower(o.user_email), o.user_id::text, o.id::text),
           o.event_id,
           coalesce(o.paid_at, o.created_at),
           ev.start_at, ev.end_at,
           1,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(o.is_guest, false),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id is not null,
           false, false, false, false, false, false, false,
           null::uuid,
           false,
           null::timestamptz,
           null::integer,
           (select coalesce(sum(case when (i->>'qty') ~ '^[0-9]+$' then (i->>'qty')::integer else 1 end), 0)::integer
              from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i),
           false, false
    from public.orders o
    left join ev on ev.id = o.event_id
    where v_drinks
      and o.venue_id = p_venue_id
      and o.status in ('paid', 'served')
      and coalesce(o.paid_at, o.created_at) >= v_from
      and coalesce(o.paid_at, o.created_at) < v_to
  ),

  -- Achats à l'avance (billets + tables) : ceux qui ont un « avant la soirée ».
  pre as materialized (
    select tx.*,
           extract(epoch from (tx.start_at - tx.at_ts)) / 3600.0 as lead_h,
           case
             when tx.at_ts >= tx.start_at then 'after_start'
             when tx.start_at - tx.at_ts < interval '24 hours' then 'h24'
             when tx.start_at - tx.at_ts < interval '4 days' then 'd1_3'
             when tx.start_at - tx.at_ts < interval '8 days' then 'd4_7'
             when tx.start_at - tx.at_ts < interval '15 days' then 'd8_14'
             when tx.start_at - tx.at_ts < interval '31 days' then 'd15_30'
             else 'd30p'
           end as lead_bucket
    from tx
    where tx.pillar in ('tickets', 'tables') and tx.start_at is not null
  ),

  gl as materialized (
    select gle.id, lower(gle.email) as buyer, gl0.event_id, gle.created_at as at_ts,
           coalesce(gle.entry_scanned, false) as scanned,
           coalesce(gle.newsletter_opt_in, false) as newsletter,
           ev.start_at, ev.end_at
    from public.guest_list_entries gle
    join public.guest_lists gl0 on gl0.id = gle.guest_list_id
    join ev on ev.id = gl0.event_id
    where gle.status <> 'cancelled'
      and gle.created_at >= v_from
      and gle.created_at < v_to
  ),

  -- Acheteurs de la période (payants) et leur historique complet dans la portée.
  buyers as materialized (
    select tx.buyer, sum(tx.amount) as spent, count(*) as tx_count, min(tx.at_ts) as first_in_period
    from tx
    where tx.buyer is not null
    group by tx.buyer
  ),
  hist as materialized (
    select h.buyer, h.night_key, min(h.at_ts) as at_ts
    from (
      select lower(t.user_email) as buyer, t.event_id::text as night_key, coalesce(t.paid_at, t.created_at) as at_ts
      from public.tickets t
      where t.event_id = any(v_event_ids) and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) < v_to
      union all
      select lower(r.user_email), r.event_id::text, coalesce(r.paid_at, r.created_at)
      from public.table_reservations r
      where r.event_id = any(v_event_ids) and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) < v_to
      union all
      select coalesce(lower(o.user_email), o.user_id::text, o.id::text),
             coalesce(o.event_id::text,
                      to_char((coalesce(o.paid_at, o.created_at) at time zone v_tz) - interval '6 hours', 'YYYY-MM-DD')),
             coalesce(o.paid_at, o.created_at)
      from public.orders o
      where v_drinks and o.venue_id = p_venue_id and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) < v_to
      union all
      select lower(gle.email), gl0.event_id::text, gle.created_at
      from public.guest_list_entries gle
      join public.guest_lists gl0 on gl0.id = gle.guest_list_id
      where gl0.event_id = any(v_event_ids) and gle.status <> 'cancelled'
        and gle.created_at < v_to
    ) h
    where h.buyer in (select b.buyer from buyers b)
    group by h.buyer, h.night_key
  ),
  buyer_hist as materialized (
    select h.buyer, count(*) as nights, min(h.at_ts) as first_ever
    from hist h
    group by h.buyer
  ),
  gaps as (
    select extract(epoch from (h.at_ts - lag(h.at_ts) over (partition by h.buyer order by h.at_ts))) / 86400.0 as gap_d
    from hist h
  ),
  ranked as (
    select b.spent,
           row_number() over (order by b.spent desc) as rn,
           count(*) over () as n
    from buyers b
  ),

  -- Paires (client, soirée) — pour les parcours croisés sur une même nuit.
  pairs as materialized (
    select distinct tx.pillar, tx.buyer, tx.event_id, tx.start_at
    from tx
    where tx.pillar in ('tickets', 'tables') and tx.buyer is not null and tx.start_at < v_now
    union
    select 'guestlist', gl.buyer, gl.event_id, gl.start_at
    from gl
    where gl.scanned and gl.buyer is not null and gl.start_at < v_now
  ),
  pairs_x as (
    select p.pillar, p.buyer, p.event_id,
           d.orders as drink_orders, d.amount as drink_amount,
           exists (
             select 1 from public.table_reservations r
             where r.event_id = p.event_id and lower(r.user_email) = p.buyer
               and r.status in ('paid', 'confirmed')
           ) as has_table
    from pairs p
    left join lateral (
      select count(*) as orders,
             sum(greatest(o.total - coalesce(o.service_fee, 0), 0)) as amount
      from public.orders o
      where v_drinks
        and o.event_id = p.event_id
        and lower(o.user_email) = p.buyer
        and o.status in ('paid', 'served')
    ) d on true
  ),

  -- Soirées terminées où la porte a scanné au moins une entrée.
  scanned_events as materialized (
    select ev.id
    from ev
    where ev.end_at < v_now
      and (
        exists (select 1 from public.tickets t where t.event_id = ev.id
                  and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        or exists (select 1 from public.guest_list_entries gle
                     join public.guest_lists gl0 on gl0.id = gle.guest_list_id
                     where gl0.event_id = ev.id and coalesce(gle.entry_scanned, false))
        or exists (select 1 from public.table_reservations r where r.event_id = ev.id
                     and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
      )
  ),

  vs as materialized (
    select s.device_type, s.referrer_category, s.is_returning, s.visit_number,
           coalesce(s.added_to_cart, false) as cart,
           coalesce(s.proceeded_to_checkout, false) as checkout,
           coalesce(s.completed_order, false) as done,
           s.duration_seconds, s.cart_value_cents
    from public.visitor_sessions s
    where s.visited_at >= v_from and s.visited_at < v_to
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
  )

  select jsonb_build_object(
    'ok', true,
    'tz', v_tz,
    'hasDrinks', v_drinks,
    'from', v_from,
    'to', v_to,

    -- ── Vue d'ensemble ───────────────────────────────────────────────────
    'summary', (
      select jsonb_build_object(
        'transactions', (select count(*) from tx),
        'buyers', (select count(*) from buyers),
        'amount', coalesce((select sum(amount) from tx), 0),
        'avgBasket', coalesce((select avg(amount) from tx where amount > 0), 0),
        'avgPerBuyer', coalesce((select avg(spent) from buyers), 0),
        'avgTxPerBuyer', coalesce((select avg(tx_count) from buyers), 0),
        'repeatBuyers', (select count(*) from buyer_hist where nights >= 2),
        'newBuyers', (select count(*) from buyer_hist where first_ever >= v_from),
        'medianLeadHours', (select percentile_cont(0.5) within group (order by lead_h) from pre where lead_h > 0),
        'guestCheckouts', (select count(*) from tx where is_guest),
        'guestlist', (select count(*) from gl),
        'guestlistScanned', (select count(*) from gl where scanned)
      )
    ),

    'pillars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pillar', p.pillar, 'transactions', p.n, 'units', p.units,
        'buyers', p.buyers, 'amount', p.amount, 'avgBasket', p.avg_basket
      ) order by p.amount desc)
      from (
        select pillar, count(*) as n, sum(units) as units, count(distinct buyer) as buyers,
               sum(amount) as amount, avg(amount) as avg_basket
        from tx group by pillar
      ) p
    ), '[]'::jsonb),

    -- ── Quand achètent-ils ? ──────────────────────────────────────────────
    'leadTime', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket', b.bucket,
        'tickets', coalesce(c.tickets, 0), 'tables', coalesce(c.tables, 0),
        'ticketUnits', coalesce(c.ticket_units, 0), 'amount', coalesce(c.amount, 0)
      ) order by b.ord)
      from (values ('d30p', 1), ('d15_30', 2), ('d8_14', 3), ('d4_7', 4), ('d1_3', 5), ('h24', 6), ('after_start', 7)) b(bucket, ord)
      left join (
        select lead_bucket,
               count(*) filter (where pillar = 'tickets') as tickets,
               count(*) filter (where pillar = 'tables') as tables,
               sum(units) filter (where pillar = 'tickets') as ticket_units,
               sum(amount) as amount
        from pre group by lead_bucket
      ) c on c.lead_bucket = b.bucket
    ), '[]'::jsonb),

    'leadMedian', jsonb_build_object(
      'tickets', (select percentile_cont(0.5) within group (order by lead_h) from pre where pillar = 'tickets' and lead_h > 0),
      'tables', (select percentile_cont(0.5) within group (order by lead_h) from pre where pillar = 'tables' and lead_h > 0)
    ),

    -- Jour × heure de l'achat, dans le fuseau du club (lundi = 0).
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_array(h.pillar, h.dow, h.hr, h.n))
      from (
        select pillar,
               (extract(isodow from (at_ts at time zone v_tz))::integer - 1) as dow,
               extract(hour from (at_ts at time zone v_tz))::integer as hr,
               count(*) as n
        from tx
        group by 1, 2, 3
      ) h
    ), '[]'::jsonb),

    -- Boissons : à quelle heure de la nuit (heures écoulées depuis l'ouverture).
    'nightDrinks', coalesce((
      select jsonb_agg(jsonb_build_object('h', d.h, 'orders', d.n, 'amount', d.amount) order by d.h)
      from (
        select greatest(-1, least(8, floor(extract(epoch from (at_ts - start_at)) / 3600.0)::integer)) as h,
               count(*) as n, sum(amount) as amount
        from tx
        where pillar = 'drinks' and start_at is not null
        group by 1
      ) d
    ), '[]'::jsonb),

    'drinkRhythm', (
      select jsonb_build_object(
        'drinkersPerNight', count(*),
        'avgOrdersPerNight', avg(x.n),
        'avgSpendPerNight', avg(x.amount),
        'multiOrderShare', case when count(*) > 0 then (count(*) filter (where x.n >= 2))::numeric / count(*) else null end,
        'medianMinutesEntryToFirstDrink', (
          select percentile_cont(0.5) within group (order by m.mins)
          from (
            select extract(epoch from (min(d.at_ts) - min(t.scanned_at))) / 60.0 as mins
            from tx d
            join tx t on t.pillar = 'tickets' and t.buyer = d.buyer and t.event_id = d.event_id
                     and t.scanned_at is not null
            where d.pillar = 'drinks' and d.event_id is not null
            group by d.buyer, d.event_id
          ) m
          where m.mins between 0 and 600
        )
      )
      from (
        select buyer, event_id, count(*) as n, sum(amount) as amount
        from tx
        where pillar = 'drinks' and event_id is not null
        group by buyer, event_id
      ) x
    ),

    -- ── Combien achètent-ils ? ────────────────────────────────────────────
    'groupSize', jsonb_build_object(
      'tickets', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0), 'units', coalesce(c.units, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when units = 1 then '1' when units = 2 then '2' when units <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n, sum(units) as units
          from tx where pillar = 'tickets' group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgTicketsPerOrder', (select avg(units) from tx where pillar = 'tickets'),
      'tables', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0)) order by b.ord)
        from (values ('1_4', 1), ('5_8', 2), ('9_12', 3), ('13p', 4)) b(bucket, ord)
        left join (
          select case when guests <= 4 then '1_4' when guests <= 8 then '5_8' when guests <= 12 then '9_12' else '13p' end as bucket,
                 count(*) as n
          from tx where pillar = 'tables' and guests > 0 group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgGuestsPerTable', (select avg(guests) from tx where pillar = 'tables' and guests > 0),
      'avgPerHead', (select sum(amount) / nullif(sum(guests), 0) from tx where pillar = 'tables' and guests > 0),
      'drinks', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(c.n, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when items <= 1 then '1' when items = 2 then '2' when items <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n
          from tx where pillar = 'drinks' group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'avgItemsPerOrder', (select avg(items) from tx where pillar = 'drinks' and items > 0)
    ),

    'basketBands', coalesce((
      select jsonb_agg(jsonb_build_object('pillar', c.pillar, 'band', c.band, 'n', c.n))
      from (
        select pillar,
               case when amount < 15 then 'b0_15' when amount < 30 then 'b15_30' when amount < 60 then 'b30_60'
                    when amount < 120 then 'b60_120' when amount < 300 then 'b120_300' else 'b300p' end as band,
               count(*) as n
        from tx where amount > 0
        group by 1, 2
      ) c
    ), '[]'::jsonb),

    -- Palier de prix auquel les billets partent (1er palier = le moins cher publié).
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('rank', r.rnk, 'units', r.units, 'amount', r.amount) order by r.rnk)
      from (
        select least(rk.rnk, 3) as rnk, sum(t.units) as units, sum(t.amount) as amount
        from tx t
        join (
          select tr.id, dense_rank() over (partition by tr.event_id order by tr.position, tr.price) as rnk
          from public.ticket_rounds tr
          where tr.event_id = any(v_event_ids)
        ) rk on rk.id = t.round_id
        where t.pillar = 'tickets'
        group by 1
      ) r
    ), '[]'::jsonb),

    -- ── Ce qu'ils prennent en plus ────────────────────────────────────────
    'attach', (
      select jsonb_build_object(
        'ticketOrders', count(*) filter (where pillar = 'tickets'),
        'insurance', count(*) filter (where pillar = 'tickets' and insurance),
        'bundledDrink', count(*) filter (where pillar = 'tickets' and bundled_drink),
        'bundledDrinkRedeemed', count(*) filter (where pillar = 'tickets' and bundled_drink and drink_redeemed),
        'upgrades', count(*) filter (where pillar = 'tickets' and upgrade),
        'loyaltyRewards', count(*) filter (where pillar = 'tickets' and loyalty),
        'optinBase', count(*) filter (where pillar in ('tickets', 'tables')),
        'newsletter', count(*) filter (where pillar in ('tickets', 'tables') and newsletter),
        'sms', count(*) filter (where pillar in ('tickets', 'tables') and sms),
        'tableOrders', count(*) filter (where pillar = 'tables'),
        'tableDeposit', count(*) filter (where pillar = 'tables' and deposit_only),
        'tableOnSite', count(*) filter (where pillar = 'tables' and on_site)
      )
      from tx
    ),

    -- ── Qui achète ? ─────────────────────────────────────────────────────
    'loyalty', jsonb_build_object(
      'frequency', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'buyers', coalesce(c.n, 0)) order by b.ord)
        from (values ('1', 1), ('2', 2), ('3_4', 3), ('5p', 4)) b(bucket, ord)
        left join (
          select case when nights <= 1 then '1' when nights = 2 then '2' when nights <= 4 then '3_4' else '5p' end as bucket,
                 count(*) as n
          from buyer_hist group by 1
        ) c on c.bucket = b.bucket
      ), '[]'::jsonb),
      'medianDaysBetween', (select percentile_cont(0.5) within group (order by gap_d) from gaps where gap_d > 0.5),
      'top10Share', (
        select case when sum(spent) > 0 then sum(spent) filter (where rn <= greatest(1, ceil(n * 0.1))) / sum(spent) else null end
        from ranked
      ),
      'newAmount', coalesce((select sum(b.spent) from buyers b join buyer_hist h on h.buyer = b.buyer where h.first_ever >= v_from), 0),
      'returningAmount', coalesce((select sum(b.spent) from buyers b join buyer_hist h on h.buyer = b.buyer where h.first_ever < v_from), 0)
    ),

    -- Même nuit : billet → bar, table → bar, guest list → bar, billet → table.
    'crossSell', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pillar', c.pillar, 'pairs', c.pairs, 'withDrinks', c.with_drinks,
        'drinkSpend', c.drink_spend, 'withTable', c.with_table
      ))
      from (
        select pillar, count(*) as pairs,
               count(*) filter (where coalesce(drink_orders, 0) > 0) as with_drinks,
               avg(drink_amount) filter (where coalesce(drink_orders, 0) > 0) as drink_spend,
               count(*) filter (where pillar <> 'tables' and has_table) as with_table
        from pairs_x
        group by pillar
      ) c
    ), '[]'::jsonb),

    -- ── Par quel canal ? ─────────────────────────────────────────────────
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n, 'amount', c.amount) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'trackedShare', (
      select case when count(*) > 0 then (count(*) filter (where tracked))::numeric / count(*) else null end
      from tx where pillar in ('tickets', 'tables')
    ),

    -- ── Passage à l'achat (visites consenties) ───────────────────────────
    'funnel', (
      select jsonb_build_object(
        'sessions', count(*),
        'carts', count(*) filter (where cart),
        'checkouts', count(*) filter (where checkout),
        'orders', count(*) filter (where done),
        'abandonedCarts', count(*) filter (where cart and not done),
        'abandonedValue', coalesce(sum(cart_value_cents) filter (where cart and not done), 0) / 100.0,
        'medianVisitAtPurchase', percentile_cont(0.5) within group (order by visit_number) filter (where done and visit_number > 0),
        'medianDurationBuyers', percentile_cont(0.5) within group (order by duration_seconds) filter (where done and duration_seconds > 0),
        'medianDurationOthers', percentile_cont(0.5) within group (order by duration_seconds) filter (where not done and duration_seconds > 0),
        'newSessions', count(*) filter (where not coalesce(is_returning, false)),
        'newOrders', count(*) filter (where done and not coalesce(is_returning, false)),
        'returningSessions', count(*) filter (where coalesce(is_returning, false)),
        'returningOrders', count(*) filter (where done and coalesce(is_returning, false)),
        'devices', coalesce((
          select jsonb_agg(jsonb_build_object('device', d.device, 'sessions', d.sessions, 'orders', d.orders) order by d.sessions desc)
          from (
            select coalesce(nullif(device_type, ''), 'unknown') as device,
                   count(*) as sessions, count(*) filter (where done) as orders
            from vs group by 1
          ) d
        ), '[]'::jsonb),
        'sources', coalesce((
          select jsonb_agg(jsonb_build_object('source', d.source, 'sessions', d.sessions, 'orders', d.orders) order by d.sessions desc)
          from (
            select coalesce(nullif(referrer_category, ''), 'direct') as source,
                   count(*) as sessions, count(*) filter (where done) as orders
            from vs group by 1
            order by 2 desc
            limit 8
          ) d
        ), '[]'::jsonb)
      )
      from vs
    ),

    -- ── Achat ≠ venue : présence des acheteurs ───────────────────────────
    'attendance', jsonb_build_object(
      'nights', (select count(*) from scanned_events se where se.id in (select event_id from tx union select event_id from gl)),
      'ticketOrders', (select count(*) from tx where pillar = 'tickets' and event_id in (select id from scanned_events)),
      'ticketScanned', (select count(*) from tx where pillar = 'tickets' and scanned and event_id in (select id from scanned_events)),
      'tableOrders', (select count(*) from tx where pillar = 'tables' and event_id in (select id from scanned_events)),
      'tableScanned', (select count(*) from tx where pillar = 'tables' and scanned and event_id in (select id from scanned_events)),
      'guestlist', (select count(*) from gl where event_id in (select id from scanned_events)),
      'guestlistScanned', (select count(*) from gl where scanned and event_id in (select id from scanned_events)),
      'byLead', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'orders', coalesce(c.n, 0), 'scanned', coalesce(c.s, 0)) order by b.ord)
        from (values ('d30p', 1), ('d15_30', 2), ('d8_14', 3), ('d4_7', 4), ('d1_3', 5), ('h24', 6), ('after_start', 7)) b(bucket, ord)
        left join (
          select lead_bucket, count(*) as n, count(*) filter (where scanned) as s
          from pre
          where pillar = 'tickets' and event_id in (select id from scanned_events)
          group by lead_bucket
        ) c on c.lead_bucket = b.bucket
      ), '[]'::jsonb)
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_purchase_behavior(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_purchase_behavior(text, uuid, timestamptz, timestamptz) to authenticated;
