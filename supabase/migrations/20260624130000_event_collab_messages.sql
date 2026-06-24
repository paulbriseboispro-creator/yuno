-- Fil de communication d'une soirée collab (club ↔ organisateur).
--
-- Comble le manque pointé par l'audit : aucune communication in-app dans
-- l'espace collab. Un fil léger par co-événement où les deux parties laissent
-- messages et décisions, visible côté club (vitrine) ET côté orga (event detail).
--
-- Sécurité : seuls les PARTICIPANTS du co-événement peuvent lire/écrire — les
-- propriétaires des venues (lead + partenaire) et l'organisateur (lead +
-- partenaire). Le test passe par une fonction SECURITY DEFINER pour éviter que
-- la RLS de `events`/`venues` masque la ligne pendant l'évaluation de la policy.

-- ── Participant predicate (definer-side, bypasses RLS for the check) ──────────
create or replace function public.is_event_collab_participant(p_event_id uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.events e
    left join public.venues v  on v.id = e.venue_id
    left join public.venues pv on pv.id = e.partner_venue_id
    where e.id = p_event_id
      and p_user is not null
      and (
        v.owner_id = p_user
        or pv.owner_id = p_user
        or e.organizer_user_id = p_user
        or e.partner_organizer_id = p_user
      )
  );
$$;

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists public.event_collab_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('venue', 'organizer')),
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists event_collab_messages_event_idx
  on public.event_collab_messages (event_id, created_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.event_collab_messages enable row level security;

drop policy if exists "collab participants can read" on public.event_collab_messages;
create policy "collab participants can read"
  on public.event_collab_messages for select
  using (public.is_event_collab_participant(event_id, auth.uid()));

drop policy if exists "collab participants can insert" on public.event_collab_messages;
create policy "collab participants can insert"
  on public.event_collab_messages for insert
  with check (
    author_user_id = auth.uid()
    and public.is_event_collab_participant(event_id, auth.uid())
  );

drop policy if exists "authors can delete own" on public.event_collab_messages;
create policy "authors can delete own"
  on public.event_collab_messages for delete
  using (author_user_id = auth.uid());

grant select, insert, delete on public.event_collab_messages to authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_collab_messages'
  ) then
    alter publication supabase_realtime add table public.event_collab_messages;
  end if;
end $$;
