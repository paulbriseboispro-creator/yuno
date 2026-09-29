-- Smoke gardes collab club × orga (29/09) — rejouable, ANNULÉ. Disco Sundae (orga lead chez womber),
-- Amore Night (club lead), lot night_closing de la démo.
BEGIN;
create temp table _r(step int, label text, v text);
grant all on _r to authenticated;
-- Disco Sundae : menée par l'orga CHEZ womber (design/ops = both)
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; begin
  update events set waitlist_enabled = not coalesce(waitlist_enabled,false) where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  get diagnostics n = row_count;
  insert into _r values (1, 'club partenaire modifie les opérations (both)', n::text);
exception when others then insert into _r values (1, 'club partenaire modifie les opérations (both)', sqlerrm); end $$;
do $$ begin
  update events set revenue_split_rules = '{}'::jsonb where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  insert into _r values (2, 'club partenaire ne touche pas au partage', 'passé');
exception when others then insert into _r values (2, 'club partenaire ne touche pas au partage', sqlerrm); end $$;
reset role;
-- Même soirée avec ops = organizer : le club est bloqué sur les opérations
update events set collab_responsibilities = '{"design":"organizer","operations":"organizer"}' where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
set local role authenticated;
do $$ declare n int; begin
  update events set waitlist_enabled = not coalesce(waitlist_enabled,false) where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  get diagnostics n = row_count;
  insert into _r values (3, 'club sans domaine : rien d''écrit', n::text);
exception when others then insert into _r values (3, 'club sans domaine : rien d''écrit', sqlerrm); end $$;
reset role;
update events set collab_responsibilities = '{"design":"organizer","operations":"venue"}' where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
-- l'orga lead ne touche plus aux opérations confiées au club, le club oui
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  update events set waitlist_enabled = not coalesce(waitlist_enabled,false) where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  insert into _r values (4, 'orga lead bloqué sur ops du club', 'passé');
exception when others then insert into _r values (4, 'orga lead bloqué sur ops du club', sqlerrm); end $$;
do $$ declare n int; begin
  update events set description = coalesce(description,'') || ' ' where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  get diagnostics n = row_count;
  insert into _r values (5, 'orga lead garde le design', n::text);
exception when others then insert into _r values (5, 'orga lead garde le design', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"a810aed8-1b10-4e41-b325-4bf07f657d72","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; begin
  update events set waitlist_enabled = not coalesce(waitlist_enabled,false) where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  get diagnostics n = row_count;
  insert into _r values (6, 'club partenaire gère ses opérations', n::text);
exception when others then insert into _r values (6, 'club partenaire gère ses opérations', sqlerrm); end $$;
do $$ begin
  update events set title = title || ' x' where id = '8f4a3b34-9a82-4a53-963b-c77c4e004b51';
  insert into _r values (7, 'club partenaire bloqué sur le design de l''orga', 'passé');
exception when others then insert into _r values (7, 'club partenaire bloqué sur le design de l''orga', sqlerrm); end $$;
-- suppression d'une soirée qui a vendu
do $$ begin
  perform public.request_event_collab_action('5b6302d0-aa86-47a3-be7b-62e58677d0b3', 'delete');
  insert into _r values (8, 'Amore Night : suppression', 'passé');
exception when others then insert into _r values (8, 'Amore Night : suppression', left(sqlerrm, 60)); end $$;
-- dette SEPA d'un décompte
do $$ begin
  perform public.cancel_collab_table_settlement('dd617f69-ca7c-4f30-a8a7-e9feaa087094');
  insert into _r values (9, 'annuler lot night_closing', 'passé');
exception when others then insert into _r values (9, 'annuler lot night_closing', sqlerrm); end $$;
reset role;
update collab_table_settlements set status = 'pending' where id = 'dd617f69-ca7c-4f30-a8a7-e9feaa087094';
set local role authenticated;
do $$ begin
  perform public.cancel_collab_table_settlement('dd617f69-ca7c-4f30-a8a7-e9feaa087094');
  insert into _r values (10, 'annuler lot night_closing en attente', 'passé');
exception when others then insert into _r values (10, 'annuler lot night_closing en attente', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.accept_collab_night_closing('1acbf3a9-46e8-400e-b671-64df69318ba2', 99);
  insert into _r values (11, 'accepter (déjà acceptée)', 'passé');
exception when others then insert into _r values (11, 'accepter (déjà acceptée)', sqlerrm); end $$;
reset role;
insert into _r select 12, 'amore sales', public.collab_event_has_sales('5b6302d0-aa86-47a3-be7b-62e58677d0b3')::text;
select * from _r order by step;
ROLLBACK;
