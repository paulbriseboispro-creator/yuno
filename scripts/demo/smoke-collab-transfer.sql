-- Smoke : collab club × orga réglé PAR VIREMENT (contrat sans partage Stripe). Rejouable, ANNULÉ.
-- Amore Night (club lead, orga partenaire 30/70). Deux sens : orga encaisseur, puis club encaisseur (gel auto J+2).
BEGIN;
create temp table _r(step int, label text, v text);
grant all on _r to authenticated;
-- La démo a peut-être déjà vendu (contrat verrouillé) : on repart d'un contrat
-- actif, dans cette transaction annulée — sinon tout le bloc lit not_transfer_mode.
update event_collab_contracts set status = 'active' where event_id = '5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status = 'locked';
update events set split_locked_at = null where id = '5b6302d0-aa86-47a3-be7b-62e58677d0b3';
-- 1. normalisation au contrat
update event_collab_contracts set split_rules = split_rules || '{"settlement":{"mode":"transfer","collector":"organizer","payment_terms_days":"99"}}'::jsonb
 where event_id = '5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status = 'active';
insert into _r select 1, 'normalisation', (split_rules->'settlement')::text from event_collab_contracts where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status='active';
insert into _r select 2, 'barème → encaisseur club', (public.normalize_collab_settlement('{"remuneration":{"mode":"tiered_total","tiers":[{"from":0,"pct":5}]},"settlement":{"mode":"transfer","collector":"organizer"}}'::jsonb)->'settlement')::text;
insert into _r select 3, 'stripe explicite', (public.normalize_collab_settlement('{"settlement":{"mode":"xx"}}'::jsonb))::text;
-- soirée : règles en mode virement, encaisseur orga, finie
update events set revenue_split_rules = (select split_rules from event_collab_contracts where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status='active')
 where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
insert into _r select 4, 'paiements prêts (démo = faux comptes)', public.event_payments_ready('5b6302d0-aa86-47a3-be7b-62e58677d0b3')::text;
-- 5. verrou à la première vente payée
insert into tickets (event_id, ticket_round_id, user_email, status, quantity, unit_price, total_price, service_fee, qr_code, collab_split)
select '5b6302d0-aa86-47a3-be7b-62e58677d0b3', (select id from ticket_rounds where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' limit 1),
       'smoke.transfer@example.com', 'paid', 2, 20, 42, 2, 'SMOKE-TR-1', '{"mode":"transfer","collector":"organizer","venue_pct":70,"organizer_pct":30,"venue_direct":10}';
insert into _r select 5, 'verrou + contrat locked', (split_locked_at is not null)::text || '/' || (select string_agg(status, ',') from event_collab_contracts where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3') from events where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
update events set start_at = now() + interval '2 days', end_at = now() + interval '3 days' where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
-- 6. lecture en direct (club)
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
insert into _r select 6, 'live club', left((get_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3'))::text, 700);
do $$ begin perform freeze_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3'); insert into _r values (7,'gel avant la fin','passé');
exception when others then insert into _r values (7,'gel avant la fin',sqlerrm); end $$;
reset role;
update events set start_at = now() - interval '2 days', end_at = now() - interval '1 day' where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
-- 8. étranger
select set_config('request.jwt.claims', '{"sub":"156a48cb-16d8-4eab-9ae7-e92a9fc6f766","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform freeze_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3'); insert into _r values (8,'étranger gèle','passé');
exception when others then insert into _r values (8,'étranger gèle',sqlerrm); end $$;
insert into _r select 9, 'étranger lit', (get_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->>'reason');
reset role;
-- 10. l'orga (encaisseur) gèle
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
do $$ begin insert into _r select 10, 'gel orga', (freeze_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->>'status');
exception when others then insert into _r values (10,'gel orga',sqlerrm); end $$;
do $$ begin perform freeze_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3'); insert into _r values (11,'double gel','passé');
exception when others then insert into _r values (11,'double gel',sqlerrm); end $$;
insert into _r select 12, 'virement', (x->>'from') || ' → ' || (x->>'to') || ' ' || (x->>'amount') || ' due ' || (x->>'due_at') || ' i_pay=' || (x->>'i_pay')
  from jsonb_array_elements(get_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->'transfers') x;
insert into _r select 13, 'co-org ne le voit pas', jsonb_array_length(coalesce(get_event_coorg('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->'transfers','[]'::jsonb))::text;
do $$ begin perform save_coorg_deal('5b6302d0-aa86-47a3-be7b-62e58677d0b3','{"venue:womber":50,"org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9":50}'::jsonb,false,null,15); insert into _r values (14,'accord co-org refusé','passé');
exception when others then insert into _r values (14,'accord co-org refusé',sqlerrm); end $$;
-- 15. l'orga (payeur) annonce
do $$ declare tid uuid; begin
  select (x->>'id')::uuid into tid from jsonb_array_elements(get_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->'transfers') x;
  perform declare_coorg_transfer_sent(tid, 'VIR-TR');
  insert into _r values (15,'annonce payeur','ok');
exception when others then insert into _r values (15,'annonce payeur',sqlerrm); end $$;
reset role;
-- 15b. cron : un décompte déjà figé n'est pas refait
insert into _r select 155, 'balayage (déjà figé)', collab_transfer_freeze_sweep()::text;
-- 16. le club confirme
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
do $$ declare tid uuid; begin
  select (x->>'id')::uuid into tid from jsonb_array_elements(get_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->'transfers') x;
  perform confirm_coorg_transfer(tid, true, null);
  insert into _r values (16,'club confirme','ok');
exception when others then insert into _r values (16,'club confirme',sqlerrm); end $$;
insert into _r select 17, 'statut', get_collab_transfer_statement('5b6302d0-aa86-47a3-be7b-62e58677d0b3')->>'status';
reset role;
insert into _r select 18, 'notifs', string_agg(notification_type || coalesce(' src=' || (metadata->>'source'),''), ', ') from (
  select notification_type, metadata from organizer_notifications where created_at >= now() and notification_type like 'coorg%'
  union all select notification_type, metadata from staff_notifications where created_at >= now() and notification_type like 'coorg%') z;
select * from _r order by step;
ROLLBACK;
BEGIN;
create temp table _r2(step int, label text, v text);
-- club prêt Stripe, orga non (simulation dans la transaction)
update venues set stripe_account_id = 'acct_smoke_ready', stripe_charges_enabled = true where id = 'womber';
update profiles set stripe_connect_account_id = null, stripe_connect_charges_enabled = false where id = 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
insert into _r2 select 1, 'partage Stripe 30/70, orga sans Stripe → fermé', event_payments_ready('5b6302d0-aa86-47a3-be7b-62e58677d0b3')::text;
update events set revenue_split_rules = revenue_split_rules || '{"settlement":{"mode":"transfer","collector":"venue","payment_terms_days":7}}'::jsonb where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
insert into _r2 select 2, 'virement, club encaisse → ouvert', event_payments_ready('5b6302d0-aa86-47a3-be7b-62e58677d0b3')::text;
update events set revenue_split_rules = jsonb_set(revenue_split_rules, '{settlement,collector}', '"organizer"') where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
insert into _r2 select 3, 'virement, orga encaisse sans Stripe → fermé', event_payments_ready('5b6302d0-aa86-47a3-be7b-62e58677d0b3')::text;
update events set revenue_split_rules = jsonb_set(revenue_split_rules, '{settlement,collector}', '"venue"') where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
update events set revenue_split_rules = revenue_split_rules || '{"tickets":{"organizer_pct":0,"venue_pct":100},"tables":{"organizer_pct":0,"venue_pct":100}}'::jsonb - 'settlement' where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
insert into _r2 select 4, 'Stripe 100 % club → ouvert', event_payments_ready('5b6302d0-aa86-47a3-be7b-62e58677d0b3')::text;
insert into _r2 select 5, 'Rooftop (solo orga, orga sans Stripe) → fermé', event_payments_ready('c0ffee00-25a9-4d3e-9c1a-0000000000a1')::text;
-- gel automatique à J+2 : club encaisseur
update events set revenue_split_rules = (select split_rules from event_collab_contracts where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status='active') || '{"settlement":{"mode":"transfer","collector":"venue","payment_terms_days":30}}'::jsonb,
  start_at = now() - interval '4 days', end_at = now() - interval '3 days' where id='5b6302d0-aa86-47a3-be7b-62e58677d0b3';
insert into _r2 select 6, 'balayage', collab_transfer_freeze_sweep()::text;
insert into _r2 select 7, 'virement club → orga', from_party || ' → ' || to_party || ' ' || amount || ' IBAN=' || coalesce(payee_iban,'∅') || ' échéance+' || extract(day from due_at - created_at)::text || 'j'
  from event_coorg_transfers where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and source='collab';
insert into _r2 select 8, 'relances (sweep)', coorg_transfer_followup_sweep()::text;
select * from _r2 order by step;
ROLLBACK;
-- ── Bloc 3 : avenant normalisé, vendeur des reçus, facture stockée ──────────
BEGIN;
create temp table _r3(step int, label text, v text);
-- 1. un avenant « barème + orga encaisseur » est normalisé à l'écriture (club forcé)
insert into event_collab_amendments (contract_id, venue_id, organizer_user_id, status, split_rules, proposed_by)
select c.id, c.venue_id, c.organizer_user_id, 'pending_signatures',
       '{"tickets":{"organizer_pct":0,"venue_pct":100},"tables":{"organizer_pct":0,"venue_pct":100},"remuneration":{"mode":"tiered_total","tiers":[{"from":0,"pct":5}]},"settlement":{"mode":"transfer","collector":"organizer","payment_terms_days":12}}',
       'a810aed8-1b10-4e41-b325-4bf07f657d72'
  from event_collab_contracts c where c.event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and c.status='active';
insert into _r3 select 1, 'avenant normalisé', (split_rules->'settlement')::text from event_collab_amendments
 where contract_id=(select id from event_collab_contracts where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status='active') order by created_at desc limit 1;
-- 2. règles brutes posées sur la soirée : le lecteur SQL force quand même le club
insert into _r3 select 2, 'collecteur lu (barème brut)', collab_settlement_collector('{"remuneration":{"mode":"tiered_total","tiers":[{"from":0,"pct":5}]},"settlement":{"mode":"transfer","collector":"organizer"}}');
-- 3-5. reçu : vendeur = qui a encaissé
update tickets set qr_code='SMOKE-SELLER-QR', collab_split='{"mode":"transfer","collector":"organizer","organizer_pct":30,"venue_pct":70,"venue_direct":0}'
 where id=(select id from tickets where event_id='5b6302d0-aa86-47a3-be7b-62e58677d0b3' and status in ('paid','used') order by id limit 1);
insert into _r3 select 3, 'reçu : orga encaisseur', coalesce((select name||' / seul='||sole_seller from get_event_seller('5b6302d0-aa86-47a3-be7b-62e58677d0b3','SMOKE-SELLER-QR')),'<club>');
insert into _r3 select 4, 'reçu : mauvais QR', coalesce((select name from get_event_seller('5b6302d0-aa86-47a3-be7b-62e58677d0b3','NOPE')),'<rien>');
update tickets set collab_split='{"mode":"transfer","collector":"venue","organizer_pct":30,"venue_pct":70}' where qr_code='SMOKE-SELLER-QR';
insert into _r3 select 5, 'reçu : club encaisseur', coalesce((select name from get_event_seller('5b6302d0-aa86-47a3-be7b-62e58677d0b3','SMOKE-SELLER-QR')),'<club>');
-- 6-7. facture stockée : TVA de l'encaisseur (orga en franchise = TVA sur les frais Yuno seulement)
update organizer_profiles set vat_regime='franchise' where user_id='ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
update tickets set collab_split='{"mode":"transfer","collector":"organizer"}' where qr_code='SMOKE-SELLER-QR';
delete from invoices where ticket_id=(select id from tickets where qr_code='SMOKE-SELLER-QR');
delete from invoice_numbers where ticket_id=(select id from tickets where qr_code='SMOKE-SELLER-QR');
insert into invoice_numbers(ticket_id, invoice_number) select id, 'SMOKE-INV-1' from tickets where qr_code='SMOKE-SELLER-QR';
insert into _r3 select 6, 'facture orga franchise (TVA)', tva::text from invoices where invoice_number='SMOKE-INV-1';
update tickets set collab_split=null where qr_code='SMOKE-SELLER-QR';
insert into invoice_numbers(ticket_id, invoice_number) select id, 'SMOKE-INV-2' from tickets where qr_code='SMOKE-SELLER-QR';
insert into _r3 select 7, 'facture club (TVA 20 %)', tva::text from invoices where invoice_number='SMOKE-INV-2';
select * from _r3 order by step;
ROLLBACK;
