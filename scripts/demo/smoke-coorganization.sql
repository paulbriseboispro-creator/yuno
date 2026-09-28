-- Smoke co-organisation (2026-09-28) — rejouable, TOUT est annulé (ROLLBACK).
-- Rôles démo : organizer@ (lead, Rooftop Session), bde@ (asso co-hôte), owner@ (club womber co-hôte), dj@ (étranger).
-- Lancer : supabase db query --linked -f scripts/demo/smoke-coorganization.sql
-- ⚠ Suppose qu'aucun co-hôte n'est déjà invité sur Rooftop Session (vitrine) : sinon les étapes 02-07 échouent sur already_invited.
BEGIN;
DELETE FROM event_cohosts WHERE event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
DELETE FROM event_coorg_deals WHERE event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
-- ════ SMOKE co-organisation (rejoué dans une transaction annulée) ════
create temp table _r (n serial, step text, ok boolean, info text);
grant all on _r to authenticated, anon;
grant usage on sequence _r_n_seq to authenticated, anon;
create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated, anon;

-- Rôles démo
-- ORG  = organizer@womber.fr  ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9 (lead, Rooftop Session)
-- ASSO = bde@womber.fr        2462e2f2-661c-491e-a5a9-9330f1d47503 (co-hôte orga)
-- CLUB = owner@womber.fr      a810aed8-1b10-4e41-b325-4bf07f657d72 (club womber, co-hôte club)
-- DJ   = dj@womber.fr         156a48cb-16d8-4eab-9ae7-e92a9fc6f766 (étranger)

-- 0. avant : l'asso ne voit aucun billet de la soirée
select set_config('request.jwt.claims', '{"sub":"2462e2f2-661c-491e-a5a9-9330f1d47503","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '00 asso ne voit pas les billets avant', count(*) = 0, count(*)::text from tickets where event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
do $$ begin
  perform public.invite_event_cohost('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9'::uuid, null, 'editor', true, null);
  insert into _r(step, ok, info) values ('01 un étranger ne peut pas inviter', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('01 un étranger ne peut pas inviter', sqlerrm = 'forbidden', sqlerrm); end $$;
reset role;

-- 1. l'orga invite l'asso (éditeur) et le club (lecture)
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
insert into _ids select 'inv_asso', public.invite_event_cohost('c0ffee00-25a9-4d3e-9c1a-0000000000a1', '2462e2f2-661c-491e-a5a9-9330f1d47503'::uuid, null, 'editor', true, 'On la fait ensemble ?')::text;
insert into _ids select 'inv_club', public.invite_event_cohost('c0ffee00-25a9-4d3e-9c1a-0000000000a1', null, 'womber', 'viewer', true, null)::text;
insert into _r(step, ok, info) select '02 invitations créées', count(*) = 2, count(*)::text from _ids;
do $$ begin
  perform public.invite_event_cohost('c0ffee00-25a9-4d3e-9c1a-0000000000a1', '2462e2f2-661c-491e-a5a9-9330f1d47503'::uuid, null, 'editor', true, null);
  insert into _r(step, ok, info) values ('03 double invitation refusée', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('03 double invitation refusée', sqlerrm = 'already_invited', sqlerrm); end $$;
do $$ begin
  perform public.invite_event_cohost('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9'::uuid, null, 'editor', true, null);
  insert into _r(step, ok, info) values ('04 s''inviter soi-même refusé', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('04 s''inviter soi-même refusé', sqlerrm = 'already_party', sqlerrm); end $$;
insert into _r(step, ok, info) select '05 recherche annuaire (démo↔démo)', public.search_coorg_partners('asso')::text like '%Asso Yuno%', left(public.search_coorg_partners('asso')::text, 200);
reset role;

-- 2. l'asso voit l'invitation et accepte
select set_config('request.jwt.claims', '{"sub":"2462e2f2-661c-491e-a5a9-9330f1d47503","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '06 asso voit son invitation', jsonb_array_length(public.get_my_cohost_invitations(null, '2462e2f2-661c-491e-a5a9-9330f1d47503')) >= 1, left(public.get_my_cohost_invitations(null, '2462e2f2-661c-491e-a5a9-9330f1d47503')::text, 160);
insert into _r(step, ok, info) select '07 asso accepte', public.respond_event_cohost_invitation((select v::uuid from _ids where k='inv_asso'), true) = 'accepted', 'ok';
insert into _r(step, ok, info) select '08 asso voit maintenant les billets (RLS)', count(*) > 0, count(*)::text from tickets where event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
insert into _r(step, ok, info) select '09 asso voit les tables (RLS)', count(*) > 0, count(*)::text from table_reservations where event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
-- éditeur : habiller oui, structure non
update events set description = coalesce(description,'') || ' ' where id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
insert into _r(step, ok, info) select '10 asso éditrice modifie la description', true, 'ok';
do $$ begin
  update events set visibility = 'private' where id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
  insert into _r(step, ok, info) values ('11 asso ne change pas la visibilité', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('11 asso ne change pas la visibilité', sqlerrm = 'cohost_structural_change', sqlerrm); end $$;
do $$ begin
  update events set organizer_user_id = '2462e2f2-661c-491e-a5a9-9330f1d47503' where id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
  insert into _r(step, ok, info) values ('12 asso ne s''approprie pas la soirée', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('12 asso ne s''approprie pas la soirée', true, sqlerrm); end $$;
insert into _r(step, ok, info) select '13 can_manage_event_tables pour l''éditrice', public.can_manage_event_tables('2462e2f2-661c-491e-a5a9-9330f1d47503', 'c0ffee00-25a9-4d3e-9c1a-0000000000a1'), '';
-- analyses et CRM dans SA portée
insert into _r(step, ok, info) select '14 bande de ventes (portée asso) inclut la soirée',
  public.get_events_sales_summary(null, '2462e2f2-661c-491e-a5a9-9330f1d47503')::text like '%c0ffee00-25a9-4d3e-9c1a-0000000000a1%',
  left(public.get_events_sales_summary(null, '2462e2f2-661c-491e-a5a9-9330f1d47503')::text, 120);
insert into _r(step, ok, info) select '15 rapport de soirée ouvert au co-hôte', (public.get_event_report('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->>'ok') is distinct from 'false', left(public.get_event_report('c0ffee00-25a9-4d3e-9c1a-0000000000a1')::text, 120);
reset role;
insert into _r(step, ok, info) select '16 CRM asso : acheteurs de la soirée', count(*) > 0, count(*)::text
  from public.contact_scope_customers(null, '2462e2f2-661c-491e-a5a9-9330f1d47503') ;
set local role authenticated;
do $$ begin
  perform public.invite_event_cohost('c0ffee00-25a9-4d3e-9c1a-0000000000a1', null, 'womber', 'editor', true, null);
  insert into _r(step, ok, info) values ('17 un co-hôte n''invite pas', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('17 un co-hôte n''invite pas', sqlerrm in ('forbidden','already_invited'), sqlerrm); end $$;
reset role;

-- 3. le club accepte (lecture seule)
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '18 club voit l''invitation', jsonb_array_length(public.get_my_cohost_invitations('womber', null)) >= 1, '';
insert into _r(step, ok, info) select '19 club accepte', public.respond_event_cohost_invitation((select v::uuid from _ids where k='inv_club'), true) = 'accepted', '';
do $$ begin
  update events set description = 'x' where id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
  insert into _r(step, ok, info) values ('20 club lecteur ne modifie rien', not found, case when found then 'modifié' else '0 ligne' end);
exception when others then insert into _r(step, ok, info) values ('20 club lecteur ne modifie rien', true, sqlerrm); end $$;
insert into _r(step, ok, info) select '21 bande de ventes (portée club) inclut la soirée',
  public.get_events_sales_summary('womber', null)::text like '%c0ffee00-25a9-4d3e-9c1a-0000000000a1%', '';
reset role;

-- 4. accord : 60 / 30 / 10, contrat formel
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '22 parties = 3', jsonb_array_length(public.get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'parties') = 3,
  (select string_agg(p->>'key' || '/' || (p->>'role'), ', ') from jsonb_array_elements(public.get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'parties') p);
do $$ begin
  perform public.save_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1', '{"org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9":60,"org:2462e2f2-661c-491e-a5a9-9330f1d47503":30}'::jsonb, true, null);
  insert into _r(step, ok, info) values ('23 parts ≠ 100 refusées', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('23 parts ≠ 100 refusées', sqlerrm = 'shares_must_total_100', sqlerrm); end $$;
insert into _r(step, ok, info) select '24 accord proposé', (public.save_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1',
  '{"org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9":60,"org:2462e2f2-661c-491e-a5a9-9330f1d47503":30,"venue:womber":10}'::jsonb, true, 'Chacun paie ses artistes.')->>'status') = 'pending', '';
reset role;
select set_config('request.jwt.claims', '{"sub":"2462e2f2-661c-491e-a5a9-9330f1d47503","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '25 asso signe', (public.sign_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'org:2462e2f2-661c-491e-a5a9-9330f1d47503', '1.2.3.4', 'smoke')->>'status') = 'pending', '';
do $$ begin
  perform public.sign_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'venue:womber', null, null);
  insert into _r(step, ok, info) values ('26 on ne signe pas pour un autre', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('26 on ne signe pas pour un autre', sqlerrm = 'forbidden', sqlerrm); end $$;
insert into _ids select 'line_dj', public.add_coorg_ledger_line('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'org:2462e2f2-661c-491e-a5a9-9330f1d47503', 'expense', 'Cachet DJ', 300, 'artists', null)::text;
insert into _r(step, ok, info) select '27 asso déclare un frais', true, '';
reset role;
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '28 club signe → accord actif', (public.sign_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'venue:womber', '5.6.7.8', 'smoke')->>'status') = 'active', '';
insert into _ids select 'line_bar', public.add_coorg_ledger_line('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'venue:womber', 'revenue', 'Bar hors Yuno (ticket Z)', 1000, 'bar', null)::text;
do $$ begin
  perform public.approve_coorg_settlement('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'venue:womber', 1);
  insert into _r(step, ok, info) values ('29 pas de décompte avant la fin', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('29 pas de décompte avant la fin', sqlerrm = 'event_not_over', sqlerrm); end $$;
reset role;

-- 5. la soirée se termine (dans la transaction)
update events set start_at = now() - interval '2 days', end_at = now() - interval '1 day' where id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';

select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
insert into _ids select 'fig', (public.get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'settlement')::text;
insert into _r(step, ok, info) select '30 soldes = 0 (conservation)',
  abs((select sum((p->>'balance')::numeric) from jsonb_array_elements((v::jsonb)->'figures'->'parties') p)) < 0.001,
  (select string_agg((p->>'party') || ' held=' || (p->>'held') || ' ent=' || (p->>'entitled') || ' bal=' || (p->>'balance'), ' | ') from jsonb_array_elements((v::jsonb)->'figures'->'parties') p)
  from _ids where k='fig';
insert into _r(step, ok, info) select '31 pot = revenus - frais',
  ((v::jsonb)->'figures'->>'pot')::numeric = ((v::jsonb)->'figures'->>'revenue')::numeric - ((v::jsonb)->'figures'->>'expenses')::numeric,
  'rev=' || ((v::jsonb)->'figures'->>'revenue') || ' exp=' || ((v::jsonb)->'figures'->>'expenses') || ' transfers=' || ((v::jsonb)->'figures'->'transfers')::text
  from _ids where k='fig';
do $$ begin
  perform public.approve_coorg_settlement('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9', 999);
  insert into _r(step, ok, info) values ('32 version périmée refusée', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('32 version périmée refusée', sqlerrm = 'stale_version', sqlerrm); end $$;
insert into _r(step, ok, info) select '33 orga valide', (public.approve_coorg_settlement('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9',
   ((v::jsonb)->>'version')::int)->>'status') = 'open', '' from _ids where k='fig';
reset role;
select set_config('request.jwt.claims', '{"sub":"2462e2f2-661c-491e-a5a9-9330f1d47503","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '34 asso valide', (public.approve_coorg_settlement('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'org:2462e2f2-661c-491e-a5a9-9330f1d47503',
   ((v::jsonb)->>'version')::int)->>'status') = 'open', '' from _ids where k='fig';
reset role;
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '35 club valide → figé', (public.approve_coorg_settlement('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'venue:womber',
   ((v::jsonb)->>'version')::int)->>'status') = 'approved', '' from _ids where k='fig';
do $$ begin
  perform public.add_coorg_ledger_line('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'venue:womber', 'expense', 'x', 10, 'other', null);
  insert into _r(step, ok, info) values ('36 décompte figé : plus de ligne', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('36 décompte figé : plus de ligne', sqlerrm = 'settlement_locked', sqlerrm); end $$;
-- Lecture PAR LA RPC : la table n'a aucune policy (un club ne la lit pas en direct).
insert into _r(step, ok, info) select '37 virements créés', jsonb_array_length(public.get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'transfers') > 0,
  (select string_agg((x->>'from') || '→' || (x->>'to') || ' ' || (x->>'amount') || ' ' || (x->>'reference'), ' | ')
     from jsonb_array_elements(public.get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'transfers') x);
reset role;
-- 6. chaque virement : le payeur déclare, le bénéficiaire confirme
do $$
declare t record; v_payer uuid; v_payee uuid; n int := 0;
begin
  for t in select * from event_coorg_transfers where event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1' loop
    v_payer := case t.from_party when 'venue:womber' then 'a810aed8-1b10-4e41-b325-4bf07f657d72' else substr(t.from_party, 5)::uuid end;
    v_payee := case t.to_party when 'venue:womber' then 'a810aed8-1b10-4e41-b325-4bf07f657d72' else substr(t.to_party, 5)::uuid end;
    -- le bénéficiaire ne peut pas déclarer à la place du payeur
    perform set_config('request.jwt.claims', json_build_object('sub', v_payee, 'role', 'authenticated')::text, true);
    begin
      perform public.declare_coorg_transfer_sent(t.id, 'x');
      insert into _r(step, ok, info) values ('38 bénéficiaire ne déclare pas l''envoi', false, 'passé');
    exception when others then insert into _r(step, ok, info) values ('38 bénéficiaire ne déclare pas l''envoi', sqlerrm = 'forbidden', sqlerrm); end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_payer, 'role', 'authenticated')::text, true);
    perform public.declare_coorg_transfer_sent(t.id, 'VIR-123');
    begin
      perform public.confirm_coorg_transfer(t.id, true, null);
      insert into _r(step, ok, info) values ('39 payeur ne confirme pas la réception', false, 'passé');
    exception when others then insert into _r(step, ok, info) values ('39 payeur ne confirme pas la réception', sqlerrm = 'forbidden', sqlerrm); end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_payee, 'role', 'authenticated')::text, true);
    perform public.confirm_coorg_transfer(t.id, true, null);
    n := n + 1;
  end loop;
  insert into _r(step, ok, info) values ('40 virements confirmés', n > 0, n::text);
end $$;
insert into _r(step, ok, info) select '41 décompte soldé', status = 'settled', status from event_coorg_settlements where event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
select set_config('request.jwt.claims', '{"sub":"2462e2f2-661c-491e-a5a9-9330f1d47503","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.end_event_cohost((select v::uuid from _ids where k='inv_asso'));
  insert into _r(step, ok, info) values ('42 on ne quitte pas après un décompte validé', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('42 on ne quitte pas après un décompte validé', sqlerrm = 'settlement_locked', sqlerrm); end $$;
reset role;

-- 7. CRM partagé par consentement nommé
insert into tickets (event_id, ticket_round_id, user_email, status, quantity, unit_price, total_price, newsletter_opt_in, qr_code)
select 'c0ffee00-25a9-4d3e-9c1a-0000000000a1', (select id from ticket_rounds where event_id = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1' limit 1),
       'smoke.cohost@example.com', 'pending', 1, 10, 10, true, 'SMOKE-COORG-' || gen_random_uuid();
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into _r(step, ok, info) select '43 hôtes nommés au checkout (anon)', jsonb_array_length(public.get_event_marketing_hosts('c0ffee00-25a9-4d3e-9c1a-0000000000a1')) = 3,
  (select string_agg(h->>'name', ', ') from jsonb_array_elements(public.get_event_marketing_hosts('c0ffee00-25a9-4d3e-9c1a-0000000000a1')) h);
insert into _r(step, ok, info) select '44 consentement versé aux 2 co-hôtes', public.share_event_marketing_consent('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'smoke.cohost@example.com', 'Recevoir les offres de A, B et C', 'fr', 'ticket_checkout') = 2, '';
insert into _r(step, ok, info) select '45 adresse sans achat : rien', public.share_event_marketing_consent('c0ffee00-25a9-4d3e-9c1a-0000000000a1', 'nobody@example.com', 'x', 'fr', 'ticket_checkout') = 0, '';
insert into _r(step, ok, info) select '46 page publique : présentateurs', jsonb_array_length(public.get_event_presenters('c0ffee00-25a9-4d3e-9c1a-0000000000a1')) = 3, '';
do $$ begin
  perform public.get_event_host_followers('c0ffee00-25a9-4d3e-9c1a-0000000000a1');
  insert into _r(step, ok, info) values ('47 audience push fermée à anon', false, 'passé');
exception when others then insert into _r(step, ok, info) values ('47 audience push fermée à anon', true, sqlerrm); end $$;
reset role;
insert into _r(step, ok, info) select '48 registre asso contient l''adresse', count(*) = 1, count(*)::text from newsletter_subscriptions
 where lower(email) = 'smoke.cohost@example.com' and organizer_user_id = '2462e2f2-661c-491e-a5a9-9330f1d47503' and opted_in;
insert into _r(step, ok, info) select '49 registre club contient l''adresse', count(*) = 1, count(*)::text from newsletter_subscriptions
 where lower(email) = 'smoke.cohost@example.com' and venue_id = 'womber' and opted_in;
insert into _r(step, ok, info) select '50 preuve de consentement ×2', count(*) = 2, count(*)::text from marketing_consent_events where email = 'smoke.cohost@example.com' and source like '%:cohost';
insert into _r(step, ok, info) select '51 audience push = abonnés des 3 hôtes', (public.get_event_host_followers('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->>'host_names') is not null,
  left(public.get_event_host_followers('c0ffee00-25a9-4d3e-9c1a-0000000000a1')::text, 200);
insert into _r(step, ok, info) select '52 recettes marketing : soirée co-hébergée dans la portée asso',
  'c0ffee00-25a9-4d3e-9c1a-0000000000a1'::uuid in (select public.coorg_marketing_event_ids(null, '2462e2f2-661c-491e-a5a9-9330f1d47503')), '';
-- 8. un étranger ne voit rien
select set_config('request.jwt.claims', '{"sub":"156a48cb-16d8-4eab-9ae7-e92a9fc6f766","role":"authenticated"}', true);
set local role authenticated;
insert into _r(step, ok, info) select '53 étranger : get_event_coorg refusé', public.get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->>'reason' = 'forbidden', '';
insert into _r(step, ok, info) select '54 étranger : aucun virement lisible', count(*) = 0, count(*)::text from event_coorg_transfers;
reset role;
reset role;
select n, step, ok, info from _r order by n;
ROLLBACK;
