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
-- commencé dans les 45 derniers jours (et SEULEMENT celles-là), sauf celles
-- qu'un semis de scénario tient déjà (« Triple Collab Night » :
-- `seed-triple-collab.sql`, billets `seed.triple.…`) :
--   1. efface ce qu'il a lui-même semé (email `prenom.nom.p<n>@demo.womber.fr`,
--      ou `seedp.<n>@…` avant le 20/10, QR `demo-gl-seedp-…`, session
--      `seedp-…`, factures `YUNO-…`, conversions et clics promoteur de ces
--      ventes, et leur commission dans `promoters.pending_amount`) ET ce que
--      `seed-upcoming-sales.sql` y avait posé quand la soirée était à venir
--      (`prenom.nom.v<n>@…` ou `seed.<n>@…`, `demo-gl-seed-…`, `seed-…`) : une
--      fois la soirée passée, ce script la reconstruit en entier, sans quoi la
--      prévente compterait deux fois ;
--   2. sème une soirée complète, achetée par un vivier de 1 800 habitués
--      (`prenom.nom.p<1..1800>@…`, nom fixe par identité : les mêmes gens
--      reviennent d'une soirée à l'autre, ce qui nourrit fidélité et
--      segments) : billets vendus dans les trois semaines
--      d'avant (palier après palier), tables sur les vraies formules du club
--      (total_price = prix de la table, frais de gestion EN PLUS, comme un vrai
--      checkout), inscrits guest list, visites de la page, et la PORTE :
--      ~80 % des billets, ~85 % des tables et ~60 % des inscrits scannés entre
--      l'ouverture et 3 h ;
--   3. attribue ~3 % des commandes de billets et ~1 table sur 5 aux
--      promoteurs DIRECTS de la portée (jamais ceux d'une agence : leur part
--      d'agence naît d'un trigger à l'insertion), avec leurs clics et leur
--      commission due (`pending_amount`, comme `record_promoter_conversion`).
--      Pas plus : l'écran Promoteurs compte ses lignes une à une et l'API
--      n'en rend que 1 000 — au-delà, ventes et taux de conversion faussent ;
--   4. émet une facture par vente (`/owner/accounting` et les factures lisent
--      `invoices`).
--
-- Pas de commandes au bar : le pilier boissons est EN PAUSE depuis le
-- 01/10/2026 (`docs/DRINKS_PILLAR_PAUSED.md`) et l'historique du bar de la
-- démo a été effacé (`clean-drinks-history.sql`). Le semis du bar reste écrit
-- plus bas, éteint par `v_with_bar` : le rallumer au relancement du pilier.
--
-- Sans risque d'envoi : insertions seulement (les triggers qui appellent
-- l'extérieur ne partent qu'en UPDATE), adresses fictives, démo exclue de tout
-- moteur d'envoi (`is_demo_email`). Deux précautions :
--   - une conversion promoteur naît avec une commission NULLE puis reçoit la
--     sienne par UPDATE : à l'insertion, une commission > 0 met un push en
--     file pour le promoteur (`promoter_push_on_conversion`), et la file des
--     push promoteur ne filtre pas la démo ;
--   - les factures s'écrivent dans `invoices` directement, au préfixe `YUNO-`
--     propre à la démo, jamais par `invoice_numbers` : cette numérotation est
--     unique sur TOUTE la base mais comptée par vendeur avec un préfixe commun
--     (`FAC` / `ORG`), des milliers de numéros `FAC-2026-…` y bloqueraient la
--     facture des vrais clubs.
--
-- Relancer quand les semaines passent, SEUL sur la prod (pg_stat_activity
-- d'abord, cf. docs/SUPABASE_PROD_HEALTH.md), avant `seed-upcoming-sales.sql` :
--   POST /v1/projects/<ref>/database/query avec le contenu du fichier
--   (SUPABASE_ACCESS_TOKEN de .env.local), ou
--   supabase db query --linked -f scripts/demo/seed-past-nights.sql
-- =============================================================================

-- Les adresses semées, une seule définition : `prenom.nom.p<n>@` (ce script),
-- `prenom.nom.v<n>@` (`seed-upcoming-sales.sql`), et leurs formes d'avant le
-- 20/10 (`seedp.<n>@`, `seed.<n>@`). Jamais `seed.triple.…`. Sans accent : un
-- `é` rend l'adresse invalide.
create or replace function pg_temp.seed_past_email(p text) returns boolean
language sql immutable as $$
  select p ~ '^[a-z]+\.[a-z]+\.p[0-9]+@demo\.womber\.fr$' or p like 'seedp.%@demo.womber.fr';
$$;
create or replace function pg_temp.seed_upcoming_email(p text) returns boolean
language sql immutable as $$
  select p ~ '^[a-z]+\.[a-z]+\.v[0-9]+@demo\.womber\.fr$' or p ~ '^seed\.[0-9]+@demo\.womber\.fr$';
$$;
create or replace function pg_temp.seed_email(p_first text, p_last text, p_tag text, p_seq int) returns text
language sql immutable as $$
  select format('%s.%s.%s%s@demo.womber.fr',
                lower(translate(p_first, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC')),
                lower(translate(p_last, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC')),
                p_tag, p_seq);
$$;

do $seed$
declare
  v_now   timestamptz := now();
  -- Pilier boissons en pause (01/10/2026) : aucune commande au bar semée.
  v_with_bar boolean := false;
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
  -- L'acheteur : une identité d'un vivier de 1 800 habitués (cf. plus bas).
  v_idx   int;
  v_k     int;
  v_fn    text;
  v_ln    text;
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
      and e.cancelled_at is null and coalesce(e.status, 'active') <> 'cancelled'
      -- Une soirée tenue par un semis de scénario garde ses propres chiffres.
      and not exists (select 1 from public.tickets t
                       where t.event_id = e.id and t.user_email like 'seed.triple.%@demo.womber.fr');

  -- Les ventes semées des soirées visées : ce script (`seedp.`) et la
  -- prévente laissée par `seed-upcoming-sales.sql`.
  create temp table seedp_old on commit drop as
    select t.id, 'ticket'::text as kind from public.tickets t join seedp_target s on s.id = t.event_id
     where pg_temp.seed_past_email(t.user_email) or pg_temp.seed_upcoming_email(t.user_email)
    union all
    select r.id, 'table' from public.table_reservations r join seedp_target s on s.id = r.event_id
     where pg_temp.seed_past_email(r.user_email) or pg_temp.seed_upcoming_email(r.user_email);

  create temp table seedp_conv (id uuid primary key) on commit drop;

  -- 1. Ce qui a déjà été semé sur ces soirées (dépendances d'abord : les
  -- factures n'ont pas de clé vers la vente, les conversions passeraient à NULL).
  delete from public.invoices i using seedp_target s
   where i.event_id = s.id and i.invoice_number like 'YUNO-%';
  -- La commission encore due de ces conversions sort du solde du promoteur
  -- (plancher 0 : les conversions semées avant le 20/10 n'y étaient pas).
  update public.promoters p
     set pending_amount = greatest(0, p.pending_amount - d.amt)
    from (select c.promoter_id, sum(c.commission) as amt
            from public.promoter_conversions c
            join seedp_old o on (o.kind = 'ticket' and c.ticket_id = o.id) or (o.kind = 'table' and c.table_reservation_id = o.id)
           where c.status = 'pending' group by 1) d
   where p.id = d.promoter_id;
  delete from public.promoter_conversions c using seedp_old o
   where (o.kind = 'ticket' and c.ticket_id = o.id) or (o.kind = 'table' and c.table_reservation_id = o.id);
  delete from public.promoter_clicks c using seedp_target s
   where c.event_id = s.id and c.user_agent = 'seedp';
  delete from public.tickets t using seedp_old o where o.kind = 'ticket' and t.id = o.id;
  delete from public.table_reservations r using seedp_old o where o.kind = 'table' and r.id = o.id;
  delete from public.guest_list_entries g using public.guest_lists l, seedp_target s
   where g.guest_list_id = l.id and l.event_id = s.id
     and (g.qr_code like 'demo-gl-seedp-%' or g.qr_code like 'demo-gl-seed-%');
  delete from public.orders o using seedp_target s
   where o.event_id = s.id and pg_temp.seed_past_email(o.user_email);
  delete from public.visitor_sessions v using seedp_target s
   where v.event_id = s.id
     and (v.session_id like 'seedp-%' or (v.session_id like 'seed-%' and v.session_id not like 'seed-triple-%'));

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
          v_idx := 1 + ((v_seq * 7919) % 1800);
          v_k := (v_idx * 263) % 400;
          v_fn := v_first[1 + v_k % 20];
          v_ln := v_last[1 + v_k / 20];
          insert into public.tickets (event_id, ticket_round_id, user_email, full_name, quantity, unit_price, total_price,
                                      service_fee, insurance_fee, status, paid_at, created_at,
                                      entry_scanned, entry_scanned_at)
          values (v_ev.id, v_round.id, pg_temp.seed_email(v_fn, v_ln, 'p', v_idx), v_fn || ' ' || v_ln,
                  v_q, v_round.price, v_sub + v_fee, v_fee, 0, 'paid', v_at, v_at,
                  v_scan is not null, v_scan);
        end loop;
      end loop;
    end if;

    -- 2b. Tables : 1 à 4 formules du club (ou de la soirée sans club).
    -- Comme un vrai checkout : total_price = le prix de la table, SANS les
    -- frais de gestion Yuno (payés EN PLUS par le client, 4 %).
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
        v_idx := 1 + ((v_seq * 7919) % 1800);
        v_k := (v_idx * 263) % 400;
        v_fn := v_first[1 + v_k % 20];
        v_ln := v_last[1 + v_k / 20];
        insert into public.table_reservations (event_id, pack_id, zone_id, user_email, full_name, guest_count,
                                               total_price, deposit, service_fee, management_fee, payment_mode,
                                               status, paid_at, created_at, entry_scanned, entry_scanned_at, checked_in_at)
        values (v_ev.id, v_pack.id, v_pack.zone_id, pg_temp.seed_email(v_fn, v_ln, 'p', v_idx), v_fn || ' ' || v_ln,
                5 + floor(random() * 6)::int,
                round(v_pack.base_price, 2), round(v_pack.base_price, 2), 0, round(v_pack.base_price * 0.04, 2),
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
        v_idx := 1 + ((v_seq * 7919) % 1800);
        v_k := (v_idx * 263) % 400;
        v_fn := v_first[1 + v_k % 20];
        v_ln := v_last[1 + v_k / 20];
        insert into public.guest_list_entries (guest_list_id, full_name, email, phone, qr_code, status, entry_type, gender,
                                               created_at, entry_scanned, entry_scanned_at)
        values (v_gl.id, v_fn || ' ' || v_ln, pg_temp.seed_email(v_fn, v_ln, 'p', v_idx),
                '+336' || lpad(floor(random() * 100000000)::text, 8, '0'),
                'demo-gl-seedp-' || gen_random_uuid(),
                case when v_scan is not null then 'entered' else 'confirmed' end, 'normal',
                case when random() < 0.55 then 'F' else 'M' end, v_at, v_scan is not null, v_scan);
      end loop;
    end if;

    -- 2d. Bar (club seulement) : ~55 % des entrées commandent via Yuno.
    -- ÉTEINT tant que le pilier boissons est en pause (`v_with_bar`).
    if v_with_bar and v_ev.venue_id is not null then
      v_n := round(0.55 * (
               coalesce((select sum(t.quantity) from public.tickets t where t.event_id = v_ev.id and t.entry_scanned and pg_temp.seed_past_email(t.user_email)), 0)
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
        values (v_ev.venue_id, v_ev.id, pg_temp.seed_email(v_first[1 + floor(random() * 20)::int], v_last[1 + floor(random() * 20)::int], 'p', v_seq), v_items, v_total,
                round(v_total * 0.05, 2), 'served', v_at, v_at,
                v_at + interval '2 minutes' + interval '12 minutes' * power(random(), 2), false);
      end loop;
    end if;

    -- 2e. Promoteurs DIRECTS de la portée (club de la soirée, sinon
    -- l'organisateur) : ~3 % des commandes de billets, ~1 table sur 5, à la
    -- valeur faciale hors frais Yuno. Commission posée plus bas (cf. en-tête).
    with ins as (
      insert into public.promoter_conversions (promoter_id, ticket_id, table_reservation_id, event_id,
                                               conversion_type, amount, commission, status, created_at)
      select pr.id, s.ticket_id, s.table_id, v_ev.id, s.kind, s.amount, 0, 'pending', s.at
      from (
        select t.id as ticket_id, null::uuid as table_id, 'ticket' as kind,
               t.unit_price * t.quantity as amount, t.paid_at as at
          from public.tickets t
         where t.event_id = v_ev.id and pg_temp.seed_past_email(t.user_email) and random() < 0.03
        union all
        select null, r.id, 'table', r.total_price, r.paid_at
          from public.table_reservations r
         where r.event_id = v_ev.id and pg_temp.seed_past_email(r.user_email) and random() < 0.20
      ) s
      cross join lateral (
        select p.id from public.promoters p
         where p.is_active and p.agency_id is null
           and ((v_ev.venue_id is not null and p.venue_id = v_ev.venue_id)
                or (v_ev.venue_id is null and p.organizer_user_id = v_ev.organizer_user_id))
         order by md5(coalesce(s.ticket_id, s.table_id)::text || p.id::text)
         limit 1
      ) pr
      returning id
    )
    insert into seedp_conv select id from ins;

    -- Leurs clics : 5 à 8 par vente attribuée (+2), dans les trois semaines
    -- d'avant, marqués `user_agent = 'seedp'` pour être retrouvés au rejeu.
    insert into public.promoter_clicks (promoter_id, event_id, clicked_at, source, user_agent)
    select c.promoter_id, v_ev.id,
           v_ev.start_at - interval '1 hour' - interval '21 days' * power(random(), 2),
           (array['instagram', 'story', 'whatsapp', 'tiktok', 'direct'])[1 + floor(random() * 5)::int],
           'seedp'
    from (select pc.promoter_id, count(*) as n
            from public.promoter_conversions pc join seedp_conv sc on sc.id = pc.id
           where pc.event_id = v_ev.id group by 1) c
    cross join lateral generate_series(1, (c.n * (5 + floor(random() * 4)) + 2)::int) g;

    -- 2f. Visites de la page, dans les trois semaines d'avant.
    v_n := greatest(20, (select count(*) from public.tickets t where t.event_id = v_ev.id and pg_temp.seed_past_email(t.user_email))::int * 5);
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

  -- 3. Commissions des conversions semées (règle par défaut du promoteur :
  -- montant fixe par vente, ou pourcentage de la valeur faciale), par UPDATE
  -- pour ne mettre aucun push en file.
  update public.promoter_conversions c
     set commission = case
           when c.conversion_type = 'ticket' then
             case when p.ticket_commission_type = 'percentage'
                  then round(c.amount * coalesce(p.ticket_commission_value, 0) / 100, 2)
                  else coalesce(p.ticket_commission_value, 0) end
           else
             case when p.table_commission_type = 'percentage'
                  then round(c.amount * coalesce(p.table_commission_value, 0) / 100, 2)
                  else coalesce(p.table_commission_value, 0) end
         end
    from public.promoters p, seedp_conv sc
   where sc.id = c.id and p.id = c.promoter_id;

  -- … et la commission due entre au solde du promoteur, comme le fait
  -- `record_promoter_conversion` (bandeau « dû à 1 promoteur » de l'écran).
  update public.promoters p
     set pending_amount = p.pending_amount + d.amt
    from (select c.promoter_id, sum(c.commission) as amt
            from public.promoter_conversions c join seedp_conv sc on sc.id = c.id
           group by 1) d
   where p.id = d.promoter_id;

  -- 4. Factures, comme `save_invoice_on_creation` les écrit (même montant, même
  -- calcul de TVA, mêmes lignes), au numéro `YUNO-<aammjj>-<6 hex>` propre à
  -- la démo.
  with s as (
    select t.id as ticket_id, null::uuid as table_id, 'ticket'::text as type, t.total_price as amount,
           coalesce(t.service_fee, 0) as service_fee, 0::numeric as management_fee, coalesce(t.insurance_fee, 0) as insurance_fee,
           t.user_email, t.full_name, t.event_id, coalesce(t.paid_at, t.created_at) as at,
           jsonb_build_array(jsonb_build_object('description', 'Billet', 'quantity', coalesce(t.quantity, 1),
             'unitPrice', coalesce(t.unit_price, 0), 'total', coalesce(t.quantity, 1) * coalesce(t.unit_price, 0))) as items
      from public.tickets t join seedp_target st on st.id = t.event_id
     where pg_temp.seed_past_email(t.user_email) and t.status in ('paid', 'used')
    union all
    select null, r.id, 'table', r.total_price,
           coalesce(r.service_fee, 0), coalesce(r.management_fee, 0), 0,
           r.user_email, r.full_name, r.event_id, coalesce(r.paid_at, r.created_at),
           jsonb_build_array(jsonb_build_object('description', 'Table VIP', 'quantity', 1,
             'unitPrice', coalesce(r.deposit, 0), 'total', coalesce(r.deposit, 0)))
      from public.table_reservations r join seedp_target st on st.id = r.event_id
     where pg_temp.seed_past_email(r.user_email) and r.status in ('paid', 'confirmed')
  ), x as (
    select s.*, e.title, e.start_at, e.poster_url,
           coalesce(e.venue_id, e.partner_venue_id) as v_id,
           coalesce(e.organizer_user_id, e.partner_organizer_id) as o_id
      from s join public.events e on e.id = s.event_id
  ), y as (
    select x.*,
           case when x.o_id is not null and x.v_id is null then public.organizer_vat_rate(x.o_id) else 20 end as rate
      from x
  ), z as (
    select y.*,
           case when y.rate = 20 then y.amount / 1.2
                else greatest(0, y.amount - (y.service_fee + y.management_fee + y.insurance_fee)) / (1 + y.rate / 100)
                     + (y.service_fee + y.management_fee + y.insurance_fee) / 1.2 end as ht
      from y
  )
  insert into public.invoices (venue_id, organizer_user_id, invoice_number, type, amount, total_ht, tva,
                               service_fee, management_fee, insurance_fee, customer_email, customer_name,
                               event_id, event_name, event_date, event_poster, ticket_id, table_reservation_id,
                               items, created_at)
  select z.v_id, z.o_id,
         'YUNO-' || to_char(z.at at time zone 'Europe/Paris', 'YYMMDD') || '-'
           || upper(left(md5(coalesce(z.ticket_id, z.table_id)::text), 6)),
         z.type, z.amount, z.ht, z.amount - z.ht,
         z.service_fee, z.management_fee, z.insurance_fee, z.user_email, z.full_name,
         z.event_id, z.title, z.start_at, z.poster_url, z.ticket_id, z.table_id,
         z.items, z.at
    from z;

  -- 5. Compteurs des paliers (le checkout les incrémente, un INSERT direct
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

-- Ce qui a été semé, soirée par soirée (`bar` doit rester à 0 tant que le
-- pilier boissons est en pause).
select e.title, to_char(e.start_at at time zone 'Europe/Paris', 'DD/MM') as le,
       (select coalesce(sum(t.quantity), 0) from public.tickets t where t.event_id = e.id and pg_temp.seed_past_email(t.user_email)) as billets,
       (select count(*) from public.table_reservations r where r.event_id = e.id and pg_temp.seed_past_email(r.user_email)) as tables,
       (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
         where l.event_id = e.id and g.qr_code like 'demo-gl-seedp-%') as guest_list,
       (select count(*) from public.promoter_conversions c where c.event_id = e.id
         and exists (select 1 from public.tickets t where t.id = c.ticket_id and pg_temp.seed_past_email(t.user_email))) as promo,
       (select count(*) from public.invoices i where i.event_id = e.id and i.invoice_number like 'YUNO-%') as factures,
       (select count(*) from public.orders o where o.event_id = e.id and pg_temp.seed_past_email(o.user_email)) as bar
from public.events e
where e.id = any (public.demo_event_ids())
  and e.start_at < now() - interval '6 hours' and e.start_at > now() - interval '45 days'
  and e.cancelled_at is null
order by e.start_at desc;
