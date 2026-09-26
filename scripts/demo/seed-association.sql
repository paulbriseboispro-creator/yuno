-- =============================================================================
-- Démo : le compte ASSOCIATION (bde@womber.fr) à la hauteur d'un organisateur
-- =============================================================================
-- Pourquoi (2026-09-26) : le compte « BDE » de la démo ne portait que des
-- « Jeudi Étudiant » sans billetterie ni tables, sous le nom « BDE Yuno ». Le
-- concept est devenu « Association » (asso loi 1901 : BDE, asso culturelle…) et
-- un vrai client arrive avec exactement ce cas : une soirée dans un club qui
-- n'est PAS sur Yuno, billets + tables vendus par l'asso.
--
-- Ce que fait le script (rejouable, ids fixes, rien hors du compte démo) :
--   1. renomme le profil « Asso Yuno », bio d'association, identité légale
--      fictive (RNA de démo, régime de TVA automatique = association exonérée) ;
--   2. crée / met à jour « Nuit de l'Asso » : soirée SOLO (lieu hors Yuno,
--      Amiens), billetterie à deux paliers, tables VIP event-scopées (une
--      formule en ligne avec acompte, une réglée sur place).
--
-- Comme « Rooftop Session » (organizer@womber.fr), la soirée est en
-- event_kind 'organizer_event' : jamais découvrable, donc jamais dans l'Explore
-- réel de la prod. published_at > 72 h : get_new_events_to_announce() ne
-- l'annoncera pas en push. Les automatisations email de la démo n'envoient
-- jamais (is_demo_marketing_scope).
--
-- Ensuite, relancer scripts/demo/seed-upcoming-sales.sql pour les ventes.
--   q.sh -f scripts/demo/seed-association.sql      (API Management)
--   ou : supabase db query --linked -f scripts/demo/seed-association.sql
-- =============================================================================

do $seed$
declare
  v_org   uuid;
  v_event uuid := 'c0ffee00-25a9-4d3e-9c1a-0000000000b1';
  v_zone_vip   uuid := 'c0ffee00-25a9-4d3e-9c1a-0000000000b2';
  v_zone_floor uuid := 'c0ffee00-25a9-4d3e-9c1a-0000000000b3';
  v_start timestamptz;
begin
  -- Garde de périmètre : le compte démo Association, rien d'autre.
  select p.id into v_org from public.profiles p where lower(p.email) = 'bde@womber.fr';
  if v_org is null or not public.is_demo_email('bde@womber.fr') then
    raise exception 'demo association account not found';
  end if;

  -- 1. Profil + identité légale (fictive).
  update public.organizer_profiles
     set display_name = 'Asso Yuno',
         bio = E'Association étudiante et culturelle (loi 1901).\n\n'
               || E'🎓 Soirées étudiantes, galas, afterworks\n'
               || E'🎟️ Billets et tables en ligne sur Yuno\n'
               || E'📍 Amiens · Paris\n\nWork hard. Party harder.',
         city = 'Amiens',
         legal_name = 'Association Yuno (démo)',
         legal_address = '12 rue des Trois Cailloux, 80000 Amiens',
         rna_number = 'W801000000',
         vat_regime = null,
         bde_verified = true,
         bde_verified_at = coalesce(bde_verified_at, now())
   where user_id = v_org;
  update public.profiles set organization_name = 'Asso Yuno' where id = v_org;

  -- 2. La soirée : dans 4 semaines, un jeudi 23 h (Paris), dans un club hors Yuno.
  v_start := (date_trunc('week', now() at time zone 'Europe/Paris') + interval '3 days 23 hours' + interval '4 weeks')
             at time zone 'Europe/Paris';

  insert into public.events (
    id, title, description, start_at, end_at, timezone, is_active, status,
    organizer_user_id, event_mode, event_kind, visibility,
    location_name, location_address, location_city, location_is_secret, reveal_address_in_email,
    poster_url, music_genres, music_genre, event_type,
    ticketing_enabled, ticket_selling_mode, rounds_visibility,
    tables_enabled, tables_mode, tables_owner_user_id,
    created_at, published_at
  ) values (
    v_event, 'Nuit de l''Asso',
    'La grande soirée de rentrée de l''association, dans un club partenaire hors Yuno : billets en prévente, tables VIP à réserver, DJ résident jusqu''à 5 h.',
    v_start, v_start + interval '6 hours', 'Europe/Paris', true, 'active',
    v_org, 'solo_organizer', 'organizer_event', 'public',
    'Le Hangar (club partenaire)', '12 rue des Trois Cailloux, 80000 Amiens', 'Amiens', false, true,
    'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-posters/2462e2f2-661c-491e-a5a9-9330f1d47503/1782374860420-poster.png',
    array['House', 'Hip-Hop'], 'House', 'club',
    true, 'rounds', 'sequential',
    true, 'basic', v_org,
    now() - interval '10 days', now() - interval '10 days'
  )
  on conflict (id) do update set
    title = excluded.title, description = excluded.description,
    start_at = excluded.start_at, end_at = excluded.end_at,
    is_active = true, status = 'active', event_kind = 'organizer_event', visibility = 'public',
    location_name = excluded.location_name, location_address = excluded.location_address,
    location_city = excluded.location_city, poster_url = excluded.poster_url,
    ticketing_enabled = true, tables_enabled = true, tables_mode = 'basic',
    tables_owner_user_id = excluded.tables_owner_user_id;

  -- Billetterie : prévente puis tarif normal (ids fixes : les ventes semées
  -- pointent dessus, on ne supprime jamais un palier).
  insert into public.ticket_rounds (id, event_id, name, price, max_tickets, position, is_active, auto_activate)
  values
    ('c0ffee00-25a9-4d3e-9c1a-0000000000b4', v_event, 'Prévente adhérents', 8, 150, 0, true, true),
    ('c0ffee00-25a9-4d3e-9c1a-0000000000b5', v_event, 'Tarif normal', 12, 250, 1, false, true)
  on conflict (id) do update set name = excluded.name, price = excluded.price,
    max_tickets = excluded.max_tickets, position = excluded.position;

  -- Tables VIP event-scopées (sans club, tout vit sur la soirée).
  insert into public.table_zones (id, event_id, name, color, position, tables_count, created_by_user_id)
  values
    (v_zone_vip,   v_event, 'Carré VIP',  '#F2B23C', 0, 4, v_org),
    (v_zone_floor, v_event, 'Bord de piste', '#06b6d4', 1, 4, v_org)
  on conflict (id) do update set name = excluded.name, tables_count = excluded.tables_count;

  insert into public.table_packs (id, zone_id, event_id, name, description, base_price, base_capacity,
                                  deposit, deposit_type, tables_count, is_active, payment_mode, created_by_user_id)
  values
    ('c0ffee00-25a9-4d3e-9c1a-0000000000b6', v_zone_vip, v_event, 'Carré Asso',
     '2 bouteilles + softs, 8 personnes', 320, 8, 80, 'fixed', 4, true, 'online', v_org),
    ('c0ffee00-25a9-4d3e-9c1a-0000000000b7', v_zone_floor, v_event, 'Table sur place',
     'Réservée en ligne, réglée au club', 180, 6, 0, 'fixed', 4, true, 'on_site', v_org)
  on conflict (id) do update set name = excluded.name, description = excluded.description,
    base_price = excluded.base_price, deposit = excluded.deposit, payment_mode = excluded.payment_mode;
end
$seed$;
