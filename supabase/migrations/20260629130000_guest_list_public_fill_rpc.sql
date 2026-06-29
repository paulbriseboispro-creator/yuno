-- Fix silent-noop RLS : les compteurs de remplissage des guest lists renvoyaient 0
-- EN SILENCE pour les visiteurs anonymes. RLS est activé sur guest_list_entries et
-- aucune policy SELECT ne couvre le rôle anon (toutes exigent auth.uid() non-NULL),
-- donc `count()` côté front retournait 0 → une guest list PLEINE s'affichait comme
-- grande ouverte sur la page d'achat publique (sur-promesse de capacité).
--
-- Fix : RPC SECURITY DEFINER qui ne renvoie QUE des compteurs agrégés (aucune PII
-- d'invité — on n'expose jamais les lignes/noms à l'anonyme) et normalise au passage
-- les variantes de genre stockées en base (F/M/male/female/femme/homme).

create or replace function public.get_guest_list_public_fill(_guest_list_id uuid)
returns table (total_count integer, female_count integer, male_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select
    count(*)::int as total_count,
    count(*) filter (where lower(btrim(coalesce(gender, ''))) in ('female', 'f', 'femme'))::int as female_count,
    count(*) filter (where lower(btrim(coalesce(gender, ''))) in ('male', 'm', 'homme'))::int as male_count
  from public.guest_list_entries
  where guest_list_id = _guest_list_id
    and status <> 'cancelled'
    and exists (
      select 1 from public.guest_lists gl
      where gl.id = _guest_list_id and gl.is_active = true
    );
$$;

grant execute on function public.get_guest_list_public_fill(uuid) to anon, authenticated;
