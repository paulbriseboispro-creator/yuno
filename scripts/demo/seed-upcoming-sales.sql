-- =============================================================================
-- Démo : des ventes sur les soirées À VENIR (rejouable)
-- =============================================================================
-- Pourquoi : toutes les ventes démo datent de mai-juillet. Les écrans « pendant
-- la vente » du plan Shotgun (bande de ventes des cartes soirée, « Vos
-- prochaines soirées », rapport de soirée avant la date, « ▲ N aujourd'hui »,
-- courbe « Comparer avec » au même J-N, trafic par soirée) restaient donc à
-- zéro sur la démo — c'est ce que Paul a vu le 24/09.
--
-- Ce que fait le script, sur les soirées de `demo_event_ids()` qui commencent
-- dans les 40 prochains jours (et SEULEMENT celles-là) :
--   1. efface les lignes qu'il a lui-même semées (email
--      `prenom.nom.v<n>@demo.womber.fr`, ou `seed.<n>@…` avant le 20/10, QR
--      `demo-gl-seed-…`, session `seed-…`, factures `YUNO-…`) — jamais celles
--      de `seed-triple-collab.sql` (`seed.triple.…`, `seed-triple-…`), que
--      l'ancien motif `seed.%` emportait aussi ;
--   2. sème, pour un vivier de 400 acheteurs (nom fixe par identité, ils
--      reviennent d'une soirée à l'autre), des billets payés (palier actif), des tables
--      (club : formules du club, pack et zone renseignés), des inscrits guest
--      list et des visites de la page de la soirée, étalés sur les 14 derniers
--      jours avec une courbe qui accélère vers la date, et une part achetée
--      AUJOURD'HUI ;
--   3. émet une facture par vente (`/owner/accounting` lit `invoices`), au
--      numéro `YUNO-…` propre à la démo — jamais par `invoice_numbers`, qui
--      tient la suite légale de chaque vendeur (cf. l'en-tête de
--      `seed-past-nights.sql`).
--
-- Aucune commande au bar : le pilier boissons est en pause depuis le
-- 01/10/2026 (`docs/DRINKS_PILLAR_PAUSED.md`). Une fois la soirée passée,
-- `seed-past-nights.sql` reprend ses lignes et la reconstruit en entier.
--
-- Sans risque d'envoi : les triggers qui appellent l'extérieur sur ces tables
-- (push d'entrée, pass Wallet) ne se déclenchent qu'en UPDATE ; les adresses
-- sont fictives (`demo.womber.fr`) et aucune automatisation n'est allumée sur
-- la démo (le moteur exclut de toute façon `is_demo_email`).
--
-- Relancer quand les dates passent (la démo se dégrade seule), APRÈS
-- `seed-past-nights.sql`, seul sur la prod (pg_stat_activity d'abord, cf.
-- docs/SUPABASE_PROD_HEALTH.md) :
--   POST /v1/projects/<ref>/database/query avec le contenu du fichier
--   (SUPABASE_ACCESS_TOKEN de .env.local), ou
--   supabase db query --linked -f scripts/demo/seed-upcoming-sales.sql
-- =============================================================================

-- Les adresses semées par ce script, une seule définition (même règle que
-- `seed-past-nights.sql`) : `prenom.nom.v<n>@demo.womber.fr`, sans accent, et
-- la forme d'avant le 20/10 `seed.<n>@`. Jamais `seed.triple.…`.
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

-- Heure d'achat plausible : le jour tiré, à une heure de Paris surtout
-- l'après-midi et le soir (12 h → 23 h, quelques achats de nuit), jamais dans
-- le futur. Sans ça, le « pic d'achat » de l'onglet Achats tombait à 1 h.
create or replace function pg_temp.seed_time(p_at timestamptz) returns timestamptz
language sql volatile as $$
  select least(now(),
    (date_trunc('day', p_at at time zone 'Europe/Paris')
      + make_interval(hours => case when random() < 0.9 then 12 + floor(random() * 12)::int else floor(random() * 3)::int end,
                      mins => floor(random() * 60)::int)) at time zone 'Europe/Paris');
$$;

do $seed$
declare
  v_now  timestamptz := now();
  v_ev   record;
  v_days numeric;
  v_frac numeric;
  v_round record;
  v_n    int;
  v_i    int;
  v_q    int;
  v_at   timestamptz;
  v_sub  numeric;
  v_fee  numeric;
  v_pack record;
  v_gl   record;
  v_first text[] := array['Léa','Hugo','Chloé','Lucas','Inès','Nathan','Camille','Enzo','Manon','Louis','Sarah','Jules','Emma','Adam','Zoé','Théo','Jade','Noah','Lina','Tom'];
  v_last  text[] := array['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel'];
  v_seq  int := 0;
  -- L'acheteur : une identité d'un vivier de 400 (`prenom.nom.v<1..400>@`).
  v_idx  int;
  v_k    int;
  v_fn   text;
  v_ln   text;
  -- Instant d'une vente : t = maintenant − 14 j × u², u uniforme ⇒ la densité
  -- croît vers aujourd'hui ; une part explicite tombe AUJOURD'HUI (Paris).
  v_today timestamptz := (date_trunc('day', v_now at time zone 'Europe/Paris') at time zone 'Europe/Paris');
begin
  perform setseed(0.2409);

  create temp table seed_target on commit drop as
    select e.id, e.title, e.start_at, e.venue_id, e.organizer_user_id, e.partner_organizer_id,
           coalesce(e.ticketing_enabled, false) as ticketing, coalesce(e.tables_enabled, false) as tables
    from public.events e
    where e.id = any (public.demo_event_ids())
      and e.start_at > v_now and e.start_at < v_now + interval '40 days'
      and e.status = 'active' and e.is_active and e.cancelled_at is null
      -- Une soirée tenue par un semis de scénario garde ses propres chiffres.
      and not exists (select 1 from public.tickets t
                       where t.event_id = e.id and t.user_email like 'seed.triple.%@demo.womber.fr');

  -- 1. Ce que ce script a déjà semé (jamais `seed.triple.`).
  -- Les factures d'abord : elles n'ont pas de clé vers la vente.
  delete from public.invoices i using seed_target s
   where i.event_id = s.id and i.invoice_number like 'YUNO-%';
  delete from public.tickets t using seed_target s
   where t.event_id = s.id and pg_temp.seed_upcoming_email(t.user_email);
  delete from public.table_reservations r using seed_target s
   where r.event_id = s.id and pg_temp.seed_upcoming_email(r.user_email);
  delete from public.guest_list_entries g using public.guest_lists l, seed_target s
   where g.guest_list_id = l.id and l.event_id = s.id and g.qr_code like 'demo-gl-seed-%';
  delete from public.visitor_sessions v using seed_target s
   where v.event_id = s.id and v.session_id like 'seed-%' and v.session_id not like 'seed-triple-%';

  for v_ev in select * from seed_target order by start_at loop
    v_days := greatest(extract(epoch from (v_ev.start_at - v_now)) / 86400.0, 0.2);
    -- Remplissage visé du palier actif : plus la soirée est proche, plus elle a vendu.
    v_frac := case when v_days <= 2 then 0.55 when v_days <= 6 then 0.34 when v_days <= 14 then 0.18 else 0.08 end;

    -- 2a. Billets (palier actif le moins cher)
    if v_ev.ticketing then
      select r.id, r.price, coalesce(nullif(r.max_tickets, 0), 100) as cap into v_round
      from public.ticket_rounds r
      where r.event_id = v_ev.id and r.is_active
      order by r.position, r.price limit 1;
      if v_round.id is not null then
        v_n := greatest(3, round(v_round.cap * v_frac / 2.1)::int);  -- commandes (≈ 2,1 billets chacune)
        for v_i in 1..v_n loop
          v_seq := v_seq + 1;
          v_q := 1 + floor(random() * 3)::int + case when random() < 0.15 then 1 else 0 end;
          v_at := case when v_i <= greatest(1, v_n / 8)
                       then v_today + (v_now - v_today) * random()               -- aujourd'hui
                       else pg_temp.seed_time(v_now - interval '14 days' * power(random(), 2)) end;
          v_sub := v_round.price * v_q;
          v_fee := round(v_sub * 0.04, 2);
          v_idx := 1 + ((v_seq * 7919) % 400);
          v_k := (v_idx * 263) % 400;
          v_fn := v_first[1 + v_k % 20];
          v_ln := v_last[1 + v_k / 20];
          insert into public.tickets (event_id, ticket_round_id, user_email, full_name, quantity, unit_price, total_price,
                                      service_fee, insurance_fee, status, paid_at, created_at)
          values (v_ev.id, v_round.id, pg_temp.seed_email(v_fn, v_ln, 'v', v_idx), v_fn || ' ' || v_ln,
                  v_q, v_round.price, v_sub + v_fee, v_fee, 0, 'paid', v_at, v_at);
        end loop;
      end if;
    end if;

    -- 2b. Tables : les formules du club (venue-scopées), ou celles de la
    -- soirée quand l'organisateur vend seul (event-scopées, sans club).
    if v_ev.tables and v_days <= 30 then
      v_i := 0;
      for v_pack in
        select p.id, p.zone_id, p.base_price
        from public.table_packs p
        where p.is_active and coalesce(p.payment_mode, 'online') = 'online'
          and ((v_ev.venue_id is not null and p.venue_id = v_ev.venue_id and p.event_id is null)
               or p.event_id = v_ev.id)
        order by p.base_price
        limit case when v_days <= 2 then 3 when v_days <= 6 then 2 else 1 end
      loop
        v_i := v_i + 1; v_seq := v_seq + 1;
        v_at := case when v_i = 1 and v_days <= 3 then v_today + (v_now - v_today) * random()
                     else pg_temp.seed_time(v_now - interval '10 days' * power(random(), 2)) end;
        v_idx := 1 + ((v_seq * 7919) % 400);
        v_k := (v_idx * 263) % 400;
        v_fn := v_first[1 + v_k % 20];
        v_ln := v_last[1 + v_k / 20];
        insert into public.table_reservations (event_id, pack_id, zone_id, user_email, full_name, guest_count,
                                               total_price, deposit, service_fee, management_fee, payment_mode,
                                               status, paid_at, created_at)
        values (v_ev.id, v_pack.id, v_pack.zone_id, pg_temp.seed_email(v_fn, v_ln, 'v', v_idx), v_fn || ' ' || v_ln,
                6 + floor(random() * 5)::int,
                -- Comme un vrai checkout : total_price = le prix de la table, SANS les
                -- frais de gestion Yuno (payés EN PLUS par le client, 4 %).
                round(v_pack.base_price, 2), round(v_pack.base_price, 2), 0, round(v_pack.base_price * 0.04, 2),
                'online', 'paid', v_at, v_at);
      end loop;
    end if;

    -- 2c. Guest list (la liste du club / maison, sinon la première active)
    select l.id, coalesce(nullif(l.quota, 0), 80) as quota into v_gl
    from public.guest_lists l
    where l.event_id = v_ev.id and l.is_active
    order by (l.holder_type = 'club') desc, l.created_at limit 1;
    if v_gl.id is not null then
      v_n := greatest(2, round(v_gl.quota * v_frac * 0.8)::int);
      for v_i in 1..v_n loop
        v_seq := v_seq + 1;
        v_at := case when v_i <= greatest(1, v_n / 6)
                     then v_today + (v_now - v_today) * random()
                     else pg_temp.seed_time(v_now - interval '14 days' * power(random(), 2)) end;
        v_idx := 1 + ((v_seq * 7919) % 400);
        v_k := (v_idx * 263) % 400;
        v_fn := v_first[1 + v_k % 20];
        v_ln := v_last[1 + v_k / 20];
        insert into public.guest_list_entries (guest_list_id, full_name, email, phone, qr_code, status, entry_type, gender, created_at)
        values (v_gl.id, v_fn || ' ' || v_ln, pg_temp.seed_email(v_fn, v_ln, 'v', v_idx),
                '+336' || lpad(floor(random() * 100000000)::text, 8, '0'),
                'demo-gl-seed-' || gen_random_uuid(), 'pending', 'normal',
                case when random() < 0.55 then 'F' else 'M' end, v_at);
      end loop;
    end if;

    -- 2d. Visites de la page de la soirée (≈ 6 par commande, 1 sur 6 achète)
    v_n := greatest(10, (select count(*) from public.tickets t where t.event_id = v_ev.id
                                                            and pg_temp.seed_upcoming_email(t.user_email))::int * 6);
    for v_i in 1..v_n loop
      v_at := case when v_i <= v_n / 7 then v_today + (v_now - v_today) * random()
                   else pg_temp.seed_time(v_now - interval '14 days' * power(random(), 2)) end;
      insert into public.visitor_sessions (session_id, visitor_id, venue_id, organizer_user_id, event_id,
                                           entry_page, entry_page_type, referrer_category, utm_source,
                                           device_type, visited_at, created_at, last_activity_at,
                                           added_to_cart, proceeded_to_checkout, completed_order, is_returning, pages_viewed,
                                           city, region, country, country_code, latitude, longitude)
      select 'seed-' || gen_random_uuid(), gen_random_uuid()::text,
             v_ev.venue_id, case when v_ev.venue_id is null then v_ev.organizer_user_id end, v_ev.id,
             '/event/' || v_ev.id, 'event_page', x.cat, x.src,
             case when random() < 0.78 then 'mobile' else 'desktop' end,
             v_at, v_at, v_at + interval '2 minutes',
             x.r < 0.30, x.r < 0.22, x.r < 0.16, random() < 0.35, 1 + floor(random() * 4)::int,
             g.city, g.region, g.country, g.cc,
             g.lat + (random() - 0.5) * 0.06, g.lng + (random() - 0.5) * 0.08
      from (select random() as r, random() as c, random() as w) z
      cross join lateral (
        select case when z.c < 0.42 then 'direct' when z.c < 0.72 then 'social' when z.c < 0.84 then 'search' else 'internal' end as cat,
               case when z.c >= 0.42 and z.c < 0.72 then 'instagram' end as src,
               z.r
      ) x
      -- Ville du visiteur : surtout Paris et sa couronne, un peu de province
      -- et d'étranger. Sans ça « Villes » et le globe du Live View restaient vides.
      cross join lateral (
        select * from (values
          (0.52, 'Paris', 'Île-de-France', 'France', 'FR', 48.8566, 2.3522),
          (0.60, 'Boulogne-Billancourt', 'Île-de-France', 'France', 'FR', 48.8397, 2.2399),
          (0.67, 'Saint-Denis', 'Île-de-France', 'France', 'FR', 48.9362, 2.3574),
          (0.73, 'Versailles', 'Île-de-France', 'France', 'FR', 48.8049, 2.1204),
          (0.80, 'Lyon', 'Auvergne-Rhône-Alpes', 'France', 'FR', 45.7640, 4.8357),
          (0.86, 'Lille', 'Hauts-de-France', 'France', 'FR', 50.6292, 3.0573),
          (0.91, 'Bruxelles', 'Bruxelles-Capitale', 'Belgique', 'BE', 50.8503, 4.3517),
          (0.95, 'London', 'England', 'United Kingdom', 'GB', 51.5072, -0.1276),
          (1.01, 'Madrid', 'Comunidad de Madrid', 'España', 'ES', 40.4168, -3.7038)
        ) c(upto, city, region, country, cc, lat, lng)
        where z.w < c.upto order by c.upto limit 1
      ) g;
    end loop;
  end loop;

  -- 3. Compteurs des paliers : le checkout les incrémente, un INSERT direct
  -- non. Sans ça la carte « Release » du Live View affichait 5 / 150 sur un
  -- palier qui avait vendu 92 billets. On recale sur les billets payés.
  update public.ticket_rounds r
     set tickets_sold = coalesce((select sum(t.quantity) from public.tickets t
                                  where t.ticket_round_id = r.id and t.status = 'paid'), 0)
   where r.event_id in (select id from seed_target);

  -- 4. Factures, comme `save_invoice_on_creation` les écrit (même montant,
  -- même calcul de TVA, mêmes lignes), au numéro `YUNO-<aammjj>-<6 hex>`.
  with s as (
    select t.id as ticket_id, null::uuid as table_id, 'ticket'::text as type, t.total_price as amount,
           coalesce(t.service_fee, 0) as service_fee, 0::numeric as management_fee, coalesce(t.insurance_fee, 0) as insurance_fee,
           t.user_email, t.full_name, t.event_id, coalesce(t.paid_at, t.created_at) as at,
           jsonb_build_array(jsonb_build_object('description', 'Billet', 'quantity', coalesce(t.quantity, 1),
             'unitPrice', coalesce(t.unit_price, 0), 'total', coalesce(t.quantity, 1) * coalesce(t.unit_price, 0))) as items
      from public.tickets t join seed_target st on st.id = t.event_id
     where pg_temp.seed_upcoming_email(t.user_email) and t.status in ('paid', 'used')
    union all
    select null, r.id, 'table', r.total_price,
           coalesce(r.service_fee, 0), coalesce(r.management_fee, 0), 0,
           r.user_email, r.full_name, r.event_id, coalesce(r.paid_at, r.created_at),
           jsonb_build_array(jsonb_build_object('description', 'Table VIP', 'quantity', 1,
             'unitPrice', coalesce(r.deposit, 0), 'total', coalesce(r.deposit, 0)))
      from public.table_reservations r join seed_target st on st.id = r.event_id
     where pg_temp.seed_upcoming_email(r.user_email) and r.status in ('paid', 'confirmed')
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
end
$seed$;

-- Ce qui a été semé, soirée par soirée.
select e.title, to_char(e.start_at at time zone 'Europe/Paris', 'DD/MM HH24:MI') as quand,
       (select coalesce(sum(t.quantity), 0) from public.tickets t where t.event_id = e.id and pg_temp.seed_upcoming_email(t.user_email)) as billets,
       (select count(*) from public.table_reservations r where r.event_id = e.id and pg_temp.seed_upcoming_email(r.user_email)) as tables,
       (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
         where l.event_id = e.id and g.qr_code like 'demo-gl-seed-%') as guest_list,
       (select count(*) from public.visitor_sessions v where v.event_id = e.id and v.session_id like 'seed-%'
         and v.session_id not like 'seed-triple-%') as visites,
       (select count(*) from public.invoices i where i.event_id = e.id and i.invoice_number like 'YUNO-%') as factures
from public.events e
where e.id = any (public.demo_event_ids()) and e.start_at > now() and e.start_at < now() + interval '40 days'
  and e.status = 'active' and e.is_active and e.cancelled_at is null
order by e.start_at;
