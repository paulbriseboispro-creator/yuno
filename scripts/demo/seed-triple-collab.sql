-- =============================================================================
-- Démo : « Triple Collab Night » — une soirée à trois parties qui vend
-- =============================================================================
-- Soirée créée à la main le 29/09 dans le vrai front, étape par étape :
-- club `womber` (hôte) × Organisateur Démo (contrat signé, billets 60/40,
-- tables 70/30) × Asso Yuno (co-hôte éditeur, accord de partage 55/35/10).
-- Chaque partie a son lien de vente (`utm_medium = party_link`) et sa part de
-- guest list. Ce script lui donne une vie de soirée en vente : billets, tables,
-- inscrits, clics et visites, RÉPARTIS entre les trois liens, pour que
-- « Qui fait vendre ? », le Rapport de soirée et le Live View aient quelque
-- chose à dire.
--
-- Rejouable : efface d'abord ce qu'il a semé (`seed.triple.…@demo.womber.fr`,
-- QR `demo-gl-triple-…`, sessions `seed-triple-…`, clics dont le visitor_id
-- commence par `seed-triple-`). Borné à UNE soirée, elle-même dans
-- `demo_event_ids()` — le script lève sinon.
--   q.sh scripts/demo/seed-triple-collab.sql   (API Management)
-- =============================================================================

create or replace function pg_temp.seed_time(p_at timestamptz) returns timestamptz
language sql volatile as $$
  select least(now(),
    (date_trunc('day', p_at at time zone 'Europe/Paris')
      + make_interval(hours => case when random() < 0.9 then 12 + floor(random() * 12)::int else floor(random() * 3)::int end,
                      mins => floor(random() * 60)::int)) at time zone 'Europe/Paris');
$$;

do $seed$
declare
  v_event   uuid := '8c704fa2-0f19-442b-b20c-83b2021af4b5';
  v_now     timestamptz := now();
  v_today   timestamptz := (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris');
  -- Liens de vente de chaque partie (party_link) — lus en base, pas en dur.
  v_l_club  uuid; v_l_org uuid; v_l_asso uuid;
  -- Parts de guest list : maison (tenue par l'orga), Asso, promoteur du club.
  v_gl_house uuid; v_gl_asso uuid; v_gl_promo uuid;
  v_early   record; v_regular record;
  v_first text[] := array['Léa','Hugo','Chloé','Lucas','Inès','Nathan','Camille','Enzo','Manon','Louis','Sarah','Jules','Emma','Adam','Zoé','Théo','Jade','Noah','Lina','Tom'];
  v_last  text[] := array['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel'];
  v_seq int := 0; v_i int; v_q int; v_at timestamptz; v_sub numeric; v_fee numeric;
  v_link uuid; v_round record; v_left int; v_r numeric;
  v_pack record;
begin
  if not (v_event = any (public.demo_event_ids())) then
    raise exception 'seed-triple-collab: la soirée % n''est pas dans le périmètre démo', v_event;
  end if;
  perform setseed(0.2909);

  select id into v_l_club from public.tracked_links where event_id = v_event and utm_medium = 'party_link' and utm_campaign = 'venue:womber';
  select id into v_l_org  from public.tracked_links where event_id = v_event and utm_medium = 'party_link' and utm_campaign = 'org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  select id into v_l_asso from public.tracked_links where event_id = v_event and utm_medium = 'party_link' and utm_campaign = 'org:2462e2f2-661c-491e-a5a9-9330f1d47503';
  select id into v_gl_house from public.guest_lists where event_id = v_event and holder_type = 'club';
  select id into v_gl_asso  from public.guest_lists where event_id = v_event and holder_type = 'custom' and organizer_user_id = '2462e2f2-661c-491e-a5a9-9330f1d47503';
  select id into v_gl_promo from public.guest_lists where event_id = v_event and holder_type = 'promoter' limit 1;
  select * into v_early   from public.ticket_rounds where event_id = v_event and position = 0;
  select * into v_regular from public.ticket_rounds where event_id = v_event and position = 1;
  if v_l_club is null or v_l_org is null or v_l_asso is null or v_gl_house is null or v_gl_asso is null or v_early.id is null then
    raise exception 'seed-triple-collab: liens de vente, parts de guest list ou paliers manquants — rejouer le parcours d''abord';
  end if;

  -- 1. Ce que ce script a déjà semé
  delete from public.tickets where event_id = v_event and user_email like 'seed.triple.%@demo.womber.fr';
  delete from public.table_reservations where event_id = v_event and user_email like 'seed.triple.%@demo.womber.fr';
  delete from public.guest_list_entries g using public.guest_lists l
   where g.guest_list_id = l.id and l.event_id = v_event and g.qr_code like 'demo-gl-triple-%';
  delete from public.visitor_sessions where event_id = v_event and session_id like 'seed-triple-%';
  delete from public.tracked_link_clicks where tracked_link_id in (v_l_club, v_l_org, v_l_asso) and visitor_id like 'seed-triple-%';

  -- 2. Billets : l'Early Bird part en entier (150), le Regular prend le relais.
  --    Attribution : Organisateur Démo 38 %, club 24 %, Asso 18 %, sans lien 20 %.
  for v_round in select * from (values (v_early.id, v_early.price::numeric, 150), (v_regular.id, v_regular.price::numeric, 96)) r(id, price, target) loop
    v_left := v_round.target;
    while v_left > 0 loop
      v_seq := v_seq + 1;
      v_q := least(v_left, 1 + floor(random() * 3)::int + case when random() < 0.15 then 1 else 0 end);
      v_r := random();
      v_link := case when v_r < 0.38 then v_l_org when v_r < 0.62 then v_l_club when v_r < 0.80 then v_l_asso else null end;
      -- Early Bird = la première semaine ; Regular = les derniers jours, dont aujourd'hui.
      v_at := case
        when v_round.id = v_early.id then pg_temp.seed_time(v_now - interval '14 days' + interval '7 days' * power(random(), 1.3))
        when random() < 0.18 then v_today + (v_now - v_today) * random()
        else pg_temp.seed_time(v_now - interval '6 days' * power(random(), 2)) end;
      v_sub := v_round.price * v_q;
      v_fee := round(v_sub * 0.04, 2);
      insert into public.tickets (event_id, ticket_round_id, user_email, quantity, unit_price, total_price,
                                  service_fee, insurance_fee, status, paid_at, created_at, tracked_link_id)
      values (v_event, v_round.id, format('seed.triple.%s@demo.womber.fr', v_seq), v_q, v_round.price, v_sub + v_fee,
              v_fee, 0, 'paid', v_at, v_at, v_link);
      v_left := v_left - v_q;
    end loop;
  end loop;
  -- Un palier à la fois : un trigger ouvre le suivant quand l'un s'épuise, une
  -- mise à jour groupée le percute (« tuple already modified »).
  for v_round in select id from public.ticket_rounds where event_id = v_event order by position loop
    update public.ticket_rounds r
       set tickets_sold = coalesce((select sum(t.quantity) from public.tickets t where t.ticket_round_id = r.id and t.status = 'paid'), 0)
     where r.id = v_round.id;
  end loop;

  -- 3. Tables : les formules du club. Deux par l'orga, une par l'Asso, deux sans lien.
  v_i := 0;
  for v_pack in
    select p.id, p.zone_id, p.base_price, x.link, x.guests
      from (values ('Gold Vip', v_l_org, 8), ('Silver VIP', v_l_org, 6), ('Silver VIP', v_l_asso, 7),
                   ('Diamond Vip', null::uuid, 10), ('Platinium Vip', null::uuid, 8)) x(name, link, guests)
      join public.table_packs p on p.venue_id = 'womber' and p.event_id is null and p.is_active and p.name = x.name
  loop
    v_i := v_i + 1; v_seq := v_seq + 1;
    v_at := case when v_i = 1 then v_today + (v_now - v_today) * random()
                 else pg_temp.seed_time(v_now - interval '10 days' * power(random(), 2)) end;
    insert into public.table_reservations (event_id, pack_id, zone_id, user_email, full_name, guest_count,
                                           total_price, deposit, service_fee, management_fee, payment_mode,
                                           status, paid_at, created_at, tracked_link_id)
    values (v_event, v_pack.id, v_pack.zone_id, format('seed.triple.%s@demo.womber.fr', v_seq),
            v_first[1 + floor(random() * 20)::int] || ' ' || v_last[1 + floor(random() * 20)::int],
            v_pack.guests, round(v_pack.base_price, 2), round(v_pack.base_price, 2), 0,
            round(v_pack.base_price * 0.04, 2), 'online', 'paid', v_at, v_at, v_pack.link);
  end loop;

  -- 4. Guest list : la liste de la soirée (tenue par l'orga), celle de l'Asso,
  --    et quelques noms du promoteur du club.
  for v_round in select * from (values (v_gl_house, 64), (v_gl_asso, 41), (v_gl_promo, 12)) g(id, n) loop
    continue when v_round.id is null;
    for v_i in 1..v_round.n loop
      v_seq := v_seq + 1;
      v_at := case when v_i <= greatest(1, v_round.n / 6) then v_today + (v_now - v_today) * random()
                   else pg_temp.seed_time(v_now - interval '12 days' * power(random(), 2)) end;
      insert into public.guest_list_entries (guest_list_id, full_name, email, phone, qr_code, status, entry_type, gender, created_at)
      values (v_round.id,
              v_first[1 + floor(random() * 20)::int] || ' ' || v_last[1 + floor(random() * 20)::int],
              format('seed.triple.%s@demo.womber.fr', v_seq),
              '+336' || lpad(floor(random() * 100000000)::text, 8, '0'),
              'demo-gl-triple-' || gen_random_uuid(), 'pending',
              case when random() < 0.85 then 'normal' else 'drink' end,
              case when random() < 0.55 then 'F' else 'M' end, v_at);
    end loop;
  end loop;

  -- 5. Clics sur les liens de vente (≈ 7 à 9 par vente attribuée) + compteur.
  for v_round in select * from (values (v_l_org, 610), (v_l_club, 380), (v_l_asso, 330)) c(id, n) loop
    for v_i in 1..v_round.n loop
      v_at := case when v_i <= v_round.n / 8 then v_today + (v_now - v_today) * random()
                   else pg_temp.seed_time(v_now - interval '14 days' * power(random(), 2)) end;
      insert into public.tracked_link_clicks (tracked_link_id, clicked_at, visitor_id, device_type, referrer)
      values (v_round.id, v_at, 'seed-triple-' || gen_random_uuid(),
              case when random() < 0.82 then 'mobile' else 'desktop' end,
              case when random() < 0.7 then 'https://l.instagram.com/' else null end);
    end loop;
    update public.tracked_links set clicks_count = (select count(*) from public.tracked_link_clicks where tracked_link_id = v_round.id)
     where id = v_round.id;
  end loop;

  -- 6. Visites de la page de la soirée (≈ 6 par commande), surtout Instagram.
  for v_i in 1..620 loop
    v_at := case when v_i <= 90 then v_today + (v_now - v_today) * random()
                 else pg_temp.seed_time(v_now - interval '14 days' * power(random(), 2)) end;
    insert into public.visitor_sessions (session_id, visitor_id, venue_id, organizer_user_id, event_id,
                                         entry_page, entry_page_type, referrer_category, utm_source, utm_medium,
                                         device_type, visited_at, created_at, last_activity_at,
                                         added_to_cart, proceeded_to_checkout, completed_order, is_returning, pages_viewed,
                                         city, region, country, country_code, latitude, longitude)
    select 'seed-triple-' || gen_random_uuid(), gen_random_uuid()::text,
           'womber', null, v_event,
           '/event/' || v_event, 'event_page', x.cat, x.src, x.med,
           case when random() < 0.8 then 'mobile' else 'desktop' end,
           v_at, v_at, v_at + interval '2 minutes',
           x.r < 0.30, x.r < 0.22, x.r < 0.16, random() < 0.35, 1 + floor(random() * 4)::int,
           g.city, g.region, g.country, g.cc,
           g.lat + (random() - 0.5) * 0.06, g.lng + (random() - 0.5) * 0.08
    from (select random() as r, random() as c, random() as w) z
    cross join lateral (
      select case when z.c < 0.30 then 'direct' when z.c < 0.78 then 'social' when z.c < 0.88 then 'search' else 'internal' end as cat,
             case when z.c >= 0.30 and z.c < 0.78 then 'instagram' end as src,
             case when z.c >= 0.30 and z.c < 0.62 then 'party_link' end as med,
             z.r
    ) x
    cross join lateral (
      select * from (values
        (0.55, 'Paris', 'Île-de-France', 'France', 'FR', 48.8566, 2.3522),
        (0.63, 'Boulogne-Billancourt', 'Île-de-France', 'France', 'FR', 48.8397, 2.2399),
        (0.70, 'Saint-Denis', 'Île-de-France', 'France', 'FR', 48.9362, 2.3574),
        (0.78, 'Amiens', 'Hauts-de-France', 'France', 'FR', 49.8941, 2.2958),
        (0.85, 'Lille', 'Hauts-de-France', 'France', 'FR', 50.6292, 3.0573),
        (0.91, 'Lyon', 'Auvergne-Rhône-Alpes', 'France', 'FR', 45.7640, 4.8357),
        (0.96, 'Bruxelles', 'Bruxelles-Capitale', 'Belgique', 'BE', 50.8503, 4.3517),
        (1.01, 'London', 'England', 'United Kingdom', 'GB', 51.5072, -0.1276)
      ) c(upto, city, region, country, cc, lat, lng)
      where z.w < c.upto order by c.upto limit 1
    ) g;
  end loop;
end
$seed$;

-- Ce qui a été semé.
select
  (select coalesce(sum(quantity), 0) from public.tickets where event_id = '8c704fa2-0f19-442b-b20c-83b2021af4b5' and user_email like 'seed.triple.%') as billets,
  (select count(*) from public.table_reservations where event_id = '8c704fa2-0f19-442b-b20c-83b2021af4b5' and user_email like 'seed.triple.%') as tables,
  (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
    where l.event_id = '8c704fa2-0f19-442b-b20c-83b2021af4b5' and g.qr_code like 'demo-gl-triple-%') as guest_list,
  (select count(*) from public.visitor_sessions where event_id = '8c704fa2-0f19-442b-b20c-83b2021af4b5' and session_id like 'seed-triple-%') as visites,
  (select sum(clicks_count) from public.tracked_links where event_id = '8c704fa2-0f19-442b-b20c-83b2021af4b5' and utm_medium = 'party_link') as clics;
