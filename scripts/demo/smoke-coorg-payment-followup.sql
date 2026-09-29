-- Smoke rejouable : suivi des virements de co-organisation (échéance, relances,
-- escalade, litige automatique, relance manuelle, arbitrage super admin).
-- Transaction ANNULÉE. Vitrine : « Yuno Rooftop Sunset », virement org → club.
BEGIN;
create temp table _r(step int, label text, v text);
grant all on _r to authenticated;
-- 1. échéance proche, pas d'IBAN
update event_coorg_transfers set due_at = now() + interval '2 days' where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
insert into _r select 1,'sweep due_soon', coorg_transfer_followup_sweep()::text;
insert into _r select 2,'sweep again (dedup)', coorg_transfer_followup_sweep()::text;
-- 3. retard de 8 jours
update event_coorg_transfers set due_at = now() - interval '8 days' where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
insert into _r select 3,'sweep 8d late', coorg_transfer_followup_sweep()::text;
insert into _r select 4,'sweep 8d rerun', coorg_transfer_followup_sweep()::text;
insert into _r select 5,'state', row(reminder_count, escalated_at is not null, admin_alerted_at is not null)::text from event_coorg_transfers where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
-- 6. 15 jours, dernière relance il y a 4 j
update event_coorg_transfers set due_at = now() - interval '15 days', last_reminded_at = now() - interval '4 days' where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
insert into _r select 6,'sweep 15d', coorg_transfer_followup_sweep()::text;
insert into _r select 7,'state', row(reminder_count, escalated_at is not null, admin_alerted_at is not null)::text from event_coorg_transfers where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
-- 8. relance manuelle : club (bénéficiaire)
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform nudge_coorg_transfer('3f639562-46bc-4af0-a60e-cc750dfd217a'); insert into _r values (8,'nudge club','ok'); exception when others then insert into _r values (8,'nudge club',sqlerrm); end $$;
do $$ begin perform nudge_coorg_transfer('3f639562-46bc-4af0-a60e-cc750dfd217a'); insert into _r values (9,'nudge again','ok'); exception when others then insert into _r values (9,'nudge again',sqlerrm); end $$;
do $$ begin perform admin_resolve_coorg_transfer('3f639562-46bc-4af0-a60e-cc750dfd217a','cancelled','x'); insert into _r values (10,'club resolves','ok'); exception when others then insert into _r values (10,'club resolves',sqlerrm); end $$;
do $$ begin perform set_coorg_transfer_iban('3f639562-46bc-4af0-a60e-cc750dfd217a','FR76 3000 6000 0112 3456 7890 189'); insert into _r values (11,'club iban','ok'); exception when others then insert into _r values (11,'club iban',sqlerrm); end $$;
insert into _r select 12,'club view', (x->>'due_at' is not null)::text || '/' || (x->>'reminder_count') || '/' || (x->>'last_nudged_at' is not null)::text
  from jsonb_array_elements(get_event_coorg('6b583db7-1a4f-4a51-ad48-cf5ce3a1a3b7')->'transfers') x where x->>'id'='3f639562-46bc-4af0-a60e-cc750dfd217a';
reset role;
-- 13. le payeur ne peut pas relancer
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
do $$ begin update event_coorg_transfers set last_nudged_at=null where id='3f639562-46bc-4af0-a60e-cc750dfd217a'; perform nudge_coorg_transfer('3f639562-46bc-4af0-a60e-cc750dfd217a'); insert into _r values (13,'nudge by payer','ok'); exception when others then insert into _r values (13,'nudge by payer',sqlerrm); end $$;
do $$ begin perform declare_coorg_transfer_sent('3f639562-46bc-4af0-a60e-cc750dfd217a','VIR-1'); insert into _r values (14,'declare','ok'); exception when others then insert into _r values (14,'declare',sqlerrm); end $$;
do $$ begin perform coorg_transfer_followup_sweep(); insert into _r values (15,'sweep as authenticated','ok'); exception when others then insert into _r values (15,'sweep as authenticated',sqlerrm); end $$;
do $$ begin perform admin_coorg_transfer_issues(); insert into _r values (16,'issues as org','ok'); exception when others then insert into _r values (16,'issues as org',sqlerrm); end $$;
reset role;
insert into _r select 17,'after declare', row(status, confirm_due_at > now() + interval '6 days')::text from event_coorg_transfers where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
-- 18. rappel de confirmation
update event_coorg_transfers set confirm_due_at = now() + interval '1 day' where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
insert into _r select 18,'sweep confirm', coorg_transfer_followup_sweep()::text;
update event_coorg_transfers set confirm_due_at = now() - interval '1 hour' where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
insert into _r select 19,'sweep auto-dispute', coorg_transfer_followup_sweep()::text;
insert into _r select 20,'state', row(status, dispute_reason)::text from event_coorg_transfers where id='3f639562-46bc-4af0-a60e-cc750dfd217a';
-- 21. super admin
select set_config('request.jwt.claims', '{"sub":"fceae0a5-d888-48f2-8c99-7c32c9559476","role":"authenticated"}', true);
set local role authenticated;
insert into _r select 21,'admin issues', jsonb_array_length(admin_coorg_transfer_issues())::text;
do $$ begin perform admin_resolve_coorg_transfer('3f639562-46bc-4af0-a60e-cc750dfd217a','received',''); insert into _r values (22,'resolve no note','ok'); exception when others then insert into _r values (22,'resolve no note',sqlerrm); end $$;
do $$ begin perform admin_resolve_coorg_transfer('3f639562-46bc-4af0-a60e-cc750dfd217a','received','Relevé bancaire reçu par email'); insert into _r values (23,'resolve','ok'); exception when others then insert into _r values (23,'resolve',sqlerrm); end $$;
reset role;
insert into _r select 24,'settlement', status from event_coorg_settlements where event_id='6b583db7-1a4f-4a51-ad48-cf5ce3a1a3b7';
-- 25. délai de paiement dans l'accord
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform save_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1','{"org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9":70,"org:2462e2f2-661c-491e-a5a9-9330f1d47503":30}'::jsonb,true,null,10); insert into _r values (25,'terms 10','ok'); exception when others then insert into _r values (25,'terms 10',sqlerrm); end $$;
do $$ begin perform save_coorg_deal('c0ffee00-25a9-4d3e-9c1a-0000000000a1','{"org:ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9":70,"org:2462e2f2-661c-491e-a5a9-9330f1d47503":30}'::jsonb,true,null,30); insert into _r values (26,'terms 30','ok'); exception when others then insert into _r values (26,'terms 30',sqlerrm); end $$;
insert into _r select 27,'deal', (get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'deal'->>'payment_terms_days') || '/' || (get_event_coorg('c0ffee00-25a9-4d3e-9c1a-0000000000a1')->'deal'->>'status');
reset role;
insert into _r select 30,'org notifs', string_agg(notification_type||'×'||n, ', ') from (select notification_type, count(*) n from organizer_notifications where notification_type like 'coorg%' and created_at >= now() group by 1) z;
insert into _r select 31,'club notifs', string_agg(notification_type||'×'||n, ', ') from (select notification_type, count(*) n from staff_notifications where notification_type like 'coorg%' and created_at >= now() group by 1) z;
insert into _r select 32,'admin notifs', string_agg(notification_type||'×'||n, ', ') from (select notification_type, count(*) n from admin_notifications where notification_type like 'admin_coorg%' and created_at >= now() group by 1) z;
insert into _r select 33,'org msgs', string_agg(left(message,140), ' | ') from organizer_notifications where notification_type like 'coorg%' and created_at >= now();
select * from _r order by step;
ROLLBACK;
