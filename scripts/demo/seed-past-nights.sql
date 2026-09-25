-- =============================================================================
-- Démo : des soirées PASSÉES qui ont vraiment eu lieu (rejouable)
-- =============================================================================
-- Pourquoi : les soirées récurrentes de la démo se régénèrent chaque semaine
-- SANS vente — seules les soirées à venir sont semées
-- (`seed-upcoming-sales.sql`). Or Ventes › Vue d'ensemble compte désormais en
-- SOIRÉES PASSÉES (« 4 dernières soirées », « Ce mois »,
-- `get_sales_overview`, plan de simplification du 25/09) : sur la démo tout
-- tombait à 0 €, et le rapport d'une soirée passée notait « 0,5 / 10 ».
--
-- Ce que fait le script, sur les soirées de `demo_event_ids()` qui ont
-- commencé dans les 45 derniers jours (et SEULEMENT celles-là) :
--   1. efface ce qu'il a lui-même semé (email `seedp.…@demo.womber.fr`,
--      QR `demo-gl-seedp-…`, session `seedp-…`) ;
--   2. sème une soirée complète : billets vendus dans les trois semaines
--      d'avant (palier après palier), tables sur les vraies formules du club,
--      inscrits guest list, commandes au bar pendant la nuit (club seulement),
--      visites de la page, et la PORTE : ~80 % des billets, ~85 % des tables
--      et ~60 % des inscrits scannés entre l'ouverture et 3 h.
--
-- Sans risque d'envoi : insertions seulement (les triggers qui appellent
-- l'extérieur ne partent qu'en UPDATE, ou sur une commande `paid` avec
-- préparation demandée — ici les commandes naissent `served`), adresses
-- fictives, démo exclue de tout moteur d'envoi (`is_demo_email`).
--
-- Relancer quand les semaines passent :
--   .../sq.sh -f scripts/demo/seed-past-nights.sql   (API Management)
-- =============================================================================

do $seed$
declare
  v_now   timestamptz := now();
  v_ev    record;
  v_round record;
  v_pack  record;
  v_gl    record;
  v_fill  numeric;
  v_left  int;
  v_take  int;
  v_q     int;
  v_i     int;
  v_n     int;
  v_at    timestamptz;
  v_scan  timestamptz;
  v_sub   numeric;
  v_fee   numeric;
  v_seq   int := 0;
  v_items jsonb;
  v_total numeric;
  v_menu  jsonb := '[{"name":"Vodka Coca-Cola","price":9},{"name":"Gin Tonic","price":12},{"name":"Aperol Spritz","price":12},{"name":"Rhum Coca-Cola","price":12},{"name":"Jägermeister RedBull","price":12},{"name":"Coupe de Champagne","price":16},{"name":"Bière pression","price":7},{"name":"Shot Tequila","price":6}]';
  v_first text[] := array['Léa','Hugo','Chloé','Lucas','Inès','Nathan','Camille','Enzo','Manon','Louis','Sarah','Jules','Emma','Adam','Zoé','Théo','Jade','Noah','Lina','Tom'];
  v_last  text[] := array['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel'];
begin
  perform setseed(0.2509);

  create temp table seedp_target on commit drop as
    select e.id, e.title, e.start_at, e.venue_id, e.organizer_user_id,
           coalesce(e.ticketing_enabled, false) as ticketing, coalesce(e.tables_enabled, false) as tables
    from public.events e
    where e.id = any (public.demo_event_ids())
      and e.start_at < v_now - interval '6 hours'
      and e.start_at > v_now - interval '45 days'
      and e.cancelled_at is null and coalesce(e.status, 'active') <> 'cancelled';

  -- 1. Ce que ce script a déjà semé
  delete from public.tickets t using seedp_target s
   where t.event_id = s.id and t.user_email like 'seedp.%@demo.womber.fr';
  delete from public.table_reservations r using seedp_target s
   where r.event_id = s.id and r.user_email like 'seedp.%@demo.womber.fr';
  delete from public.guest_list_entries g using public.guest_lists l, seedp_target s
   where g.guest_list_id = l.id and l.event_id = s.id and g.qr_code like 'demo-gl-seedp-%';
  delete from public.orders o using seedp_target s
   where o.event_id = s.id and o.user_email like 'seedp.%@demo.womber.fr';
  delete from public.visitor_sessions v using seedp_target s
   where v.event_id = s.id and v.session_id like 'seedp-%';

  for v_ev in select * from seedp_target order by start_at loop
    -- Remplissage de la soirée : de 30 % à 70 %, le samedi plus fort.
    v_fill := 0.30 + random() * 0.30
      + case when extract(isodow from v_ev.start_at at time zone 'Europe/Paris') in (5, 6) then 0.10 else 0 end;

    -- 2a. Billets : les paliers dans l'ordre, chacun jusqu'à son plafond.
    if v_ev.ticketing then
      v_left := round(coalesce(nullif((select sum(coalesce(nullif(r.max_tickets, 0), 100)) from public.ticket_rounds r where r.event_id = v_ev.id), 0), 300) * v_fill)::int;
      for v_round in
        select r.id, r.price, coalesce(nullif(r.max_tickets, 0), 100) as cap
        from public.ticket_rounds r where r.event_id = v_ev.id
        order by r.position, r.price
      loop
        exit when v_left <= 0;
        v_take := least(v_left, v_round.cap);
        v_left := v_left - v_take;
        while v_take > 0 loop
          v_seq := v_seq + 1;
          v_q := least(v_take, 1 + floor(random() * 3)::int);
          v_take := v_take - v_q;
          -- Achat : 3 semaines avant → 1 h avant, plus dense vers la date.
          v_at := v_ev.start_at - interval '1 hour' - interval '21 days' * power(random(), 2.2);
          v_sub := v_round.price * v_q;
          v_fee := round(v_sub * 0.04, 2);
          v_scan := case when random() < 0.82 then v_ev.start_at + interval '25 minutes' + interval '3 hours' * power(random(), 1.4) end;
          insert into public.tickets (event_id, ticket_round_id, user_email, full_name, quantity, unit_price, total_price,
                                      service_fee, insurance_fee, status, paid_at, created_at,
                                      entry_scanned, entry_scanned_at)
          values (v_ev.id, v_round.id, format('seedp.%s@demo.womber.fr', v_seq),
                  v_first[1 + floor(random() * 20)::int] || ' ' || v_last[1 + floor(random() * 20)::int],
                  v_q, v_round.price, v_sub + v_fee, v_fee, 0, 'paid', v_at, v_at,
                  v_scan is not null, v_scan);
        end loop;
      end loop;
    end if;

    -- 2b. Tables : 1 à 4 formules du club (ou de la soirée sans club).
    if v_ev.tables then
      v_n := 1 + floor(random() * 4)::int;
      v_i := 0;
      for v_pack in
        select p.id, p.zone_id, p.base_price
        from public.table_packs p
        where p.is_active and coalesce(p.payment_mode, 'online') = 'online'
          and ((v_ev.venue_id is not null and p.venue_id = v_ev.venue_id and p.event_id is null) or p.event_id = v_ev.id)
        order by random()
        limit v_n
      loop
        v_i := v_i + 1; v_seq := v_seq + 1;
        v_at := v_ev.start_at - interval '2 hours' - interval '12 days' * power(random(), 2);
        v_scan := case when random() < 0.85 then v_ev.start_at + interval '1 hour' + interval '2 hours' * random() end;
        insert into public.table_reservations (event_id, pack_id, zone_id, user_email, full_name, guest_count,
                                               total_price, deposit, service_fee, management_fee, payment_mode,
                                               status, paid_at, created_at, entry_scanned, entry_scanned_at, checked_in_at)
        values (v_ev.id, v_pack.id, v_pack.zone_id, format('seedp.%s@demo.womber.fr', v_seq),
                v_first[1 + floor(random() * 20)::int] || ' ' || v_last[1 + floor(random() * 20)::int],
                5 + floor(random() * 6)::int,
                round(v_pack.base_price * 1.04, 2), round(v_pack.base_price * 1.04, 2), 0, round(v_pack.base_price * 0.04, 2),
                'online', 'paid', v_at, v_at, v_scan is not null, v_scan, v_scan);
      end loop;
    end if;

    -- 2c. Guest list : la liste du club / maison, sinon la première active.
    select l.id, coalesce(nullif(l.quota, 0), 80) as quota into v_gl
    from public.guest_lists l
    where l.event_id = v_ev.id and l.is_active
    order by (l.holder_type = 'club') desc, l.created_at limit 1;
    if v_gl.id is not null then
      v_n := greatest(4, round(v_gl.quota * (0.35 + random() * 0.4))::int);
      for v_i in 1..v_n loop
        v_seq := v_seq + 1;
        v_at := v_ev.start_at - interval '30 minutes' - interval '10 days' * power(random(), 2);
        v_scan := case when random() < 0.6 then v_ev.start_at + interval '15 minutes' + interval '2 hours' * power(random(), 1.6) end;
        insert into public.guest_list_entries (guest_list_id, full_name, email, phone, qr_code, status, entry_type, gender,
                                               created_at, entry_scanned, entry_scanned_at)
        values (v_gl.id,
                v_first[1 + floor(random() * 20)::int] || ' ' || v_last[1 + floor(random() * 20)::int],
                format('seedp.%s@demo.womber.fr', v_seq),
                '+336' || lpad(floor(random() * 100000000)::text, 8, '0'),
                'demo-gl-seedp-' || gen_random_uuid(),
                case when v_scan is not null then 'entered' else 'confirmed' end, 'normal',
                case when random() < 0.55 then 'F' else 'M' end, v_at, v_scan is not null, v_scan);
      end loop;
    end if;

    -- 2d. Bar (club seulement) : ~55 % des entrées commandent via Yuno.
    if v_ev.venue_id is not null then
      v_n := round(0.55 * (
               coalesce((select sum(t.quantity) from public.tickets t where t.event_id = v_ev.id and t.entry_scanned and t.user_email like 'seedp.%'), 0)
             + coalesce((select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
                          where l.event_id = v_ev.id and g.entry_scanned and g.qr_code like 'demo-gl-seedp-%'), 0)))::int;
      for v_i in 1..v_n loop
        v_seq := v_seq + 1;
        select jsonb_agg(jsonb_build_object('name', m ->> 'name', 'price', (m ->> 'price')::numeric,
                                            'quantity', 1 + floor(random() * 2)::int, 'collection', 'drink'))
          into v_items
        from (select m from jsonb_array_elements(v_menu) m order by random() limit 1 + floor(random() * 2)::int) x;
        select sum((it ->> 'price')::numeric * (it ->> 'quantity')::int) into v_total from jsonb_array_elements(v_items) it;
        v_at := v_ev.start_at + interval '40 minutes' + interval '4 hours' * power(random(), 1.3);
        insert into public.orders (venue_id, event_id, user_email, items, total, service_fee, status, paid_at, created_at,
                                   served_at, prep_requested)
        values (v_ev.venue_id, v_ev.id, format('seedp.%s@demo.womber.fr', v_seq), v_items, v_total,
                round(v_total * 0.05, 2), 'served', v_at, v_at,
                v_at + interval '2 minutes' + interval '12 minutes' * power(random(), 2), false);
      end loop;
    end if;

    -- 2e. Visites de la page, dans les trois semaines d'avant.
    v_n := greatest(20, (select count(*) from public.tickets t where t.event_id = v_ev.id and t.user_email like 'seedp.%')::int * 5);
    insert into public.visitor_sessions (session_id, visitor_id, venue_id, organizer_user_id, event_id,
                                         entry_page, entry_page_type, referrer_category, utm_source,
                                         device_type, visited_at, created_at, last_activity_at,
                                         added_to_cart, proceeded_to_checkout, completed_order, is_returning, pages_viewed,
                                         city, region, country, country_code)
    select 'seedp-' || gen_random_uuid(), gen_random_uuid()::text,
           v_ev.venue_id, case when v_ev.venue_id is null then v_ev.organizer_user_id end, v_ev.id,
           '/event/' || v_ev.id, 'event_page',
           case when c < 0.42 then 'direct' when c < 0.72 then 'social' when c < 0.84 then 'search' else 'internal' end,
           case when c >= 0.42 and c < 0.72 then 'instagram' end,
           case when random() < 0.78 then 'mobile' else 'desktop' end,
           at, at, at + interval '2 minutes',
           r < 0.30, r < 0.24, r < 0.2, random() < 0.35, 1 + floor(random() * 4)::int,
           'Paris', 'Île-de-France', 'France', 'FR'
    from (select random() as c, random() as r,
                 v_ev.start_at - interval '21 days' * power(random(), 2) as at
          from generate_series(1, v_n)) z;
  end loop;

  -- 3. Compteurs des paliers (le checkout les incrémente, un INSERT direct
  -- non), une fois toutes les soirées semées.
  -- Ligne par ligne : un trigger de palier touche le palier suivant, une
  -- mise à jour ensembliste se heurterait à sa propre modification.
  for v_round in select r.id from public.ticket_rounds r where r.event_id in (select id from seedp_target) loop
    update public.ticket_rounds r
       set tickets_sold = coalesce((select sum(t.quantity) from public.tickets t
                                    where t.ticket_round_id = r.id and t.status in ('paid', 'used')), 0)
     where r.id = v_round.id;
  end loop;
end
$seed$;

-- Ce qui a été semé, soirée par soirée.
select e.title, to_char(e.start_at at time zone 'Europe/Paris', 'DD/MM') as le,
       (select coalesce(sum(t.quantity), 0) from public.tickets t where t.event_id = e.id and t.user_email like 'seedp.%') as billets,
       (select count(*) from public.table_reservations r where r.event_id = e.id and r.user_email like 'seedp.%') as tables,
       (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
         where l.event_id = e.id and g.qr_code like 'demo-gl-seedp-%') as guest_list,
       (select count(*) from public.orders o where o.event_id = e.id and o.user_email like 'seedp.%') as bar
from public.events e
where e.id = any (public.demo_event_ids())
  and e.start_at < now() - interval '6 hours' and e.start_at > now() - interval '45 days'
  and e.cancelled_at is null
order by e.start_at desc;
