-- DJ team / manager access.
-- A DJ can grant scoped, read-only dashboard access to a manager / booking agent.
-- The manager accepts an emailed invitation, which links them to the DJ's profiles
-- and grants the `dj` app role so they can reach the dashboard. Access is read-only
-- (the DJ stays the only writer); the `role` column is a label for the DJ's own org.

-- ── Members (active access grants) ───────────────────────────────────────────
create table if not exists public.dj_team_members (
  id uuid primary key default gen_random_uuid(),
  dj_user_id uuid not null references auth.users(id) on delete cascade,     -- the DJ (owner)
  member_user_id uuid not null references auth.users(id) on delete cascade,  -- the manager
  role text not null default 'manager' check (role in ('manager','agent','viewer')),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  unique (dj_user_id, member_user_id)
);

create index if not exists idx_dj_team_members_member
  on public.dj_team_members(member_user_id) where status = 'active';
create index if not exists idx_dj_team_members_dj
  on public.dj_team_members(dj_user_id);

-- ── Invitations ──────────────────────────────────────────────────────────────
create table if not exists public.dj_team_invitations (
  id uuid primary key default gen_random_uuid(),
  dj_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'manager' check (role in ('manager','agent','viewer')),
  token text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references auth.users(id),
  member_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);

create index if not exists idx_dj_team_invitations_dj
  on public.dj_team_invitations(dj_user_id);
create index if not exists idx_dj_team_invitations_email
  on public.dj_team_invitations(lower(email));

alter table public.dj_team_members enable row level security;
alter table public.dj_team_invitations enable row level security;

-- The DJ owner manages their own team + invitation rows; a member can read their grant.
drop policy if exists dj_team_members_owner_all on public.dj_team_members;
create policy dj_team_members_owner_all on public.dj_team_members
  for all using (dj_user_id = auth.uid()) with check (dj_user_id = auth.uid());
drop policy if exists dj_team_members_member_read on public.dj_team_members;
create policy dj_team_members_member_read on public.dj_team_members
  for select using (member_user_id = auth.uid());

drop policy if exists dj_team_invitations_owner_all on public.dj_team_invitations;
create policy dj_team_invitations_owner_all on public.dj_team_invitations
  for all using (dj_user_id = auth.uid()) with check (dj_user_id = auth.uid());

-- ── Helper: DJ owner ids the current user can access as an active team member ──
create or replace function public.dj_team_owner_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select dj_user_id from public.dj_team_members
  where member_user_id = auth.uid() and status = 'active';
$$;

grant execute on function public.dj_team_owner_ids() to authenticated;

-- ── Additive read access for team members on the DJ's core tables ─────────────
-- These are permissive (OR-combined) policies that sit alongside the existing
-- owner-only policies; a normal DJ with no team is unaffected.
drop policy if exists djs_team_read on public.djs;
create policy djs_team_read on public.djs
  for select using (user_id in (select public.dj_team_owner_ids()));

drop policy if exists dj_sets_team_read on public.dj_sets;
create policy dj_sets_team_read on public.dj_sets
  for select using (
    dj_id in (select id from public.djs where user_id in (select public.dj_team_owner_ids()))
  );

drop policy if exists dj_payments_team_read on public.dj_payments;
create policy dj_payments_team_read on public.dj_payments
  for select using (
    dj_id in (select id from public.djs where user_id in (select public.dj_team_owner_ids()))
  );

-- ── Accept an invitation ──────────────────────────────────────────────────────
create or replace function public.dj_accept_team_invitation(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv public.dj_team_invitations;
  uid uuid := auth.uid();
  uemail text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select email into uemail from auth.users where id = uid;
  select * into inv from public.dj_team_invitations where token = p_token;

  if inv.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if inv.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if inv.expires_at < now() then
    update public.dj_team_invitations set status = 'expired' where id = inv.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if lower(inv.email) <> lower(coalesce(uemail, '')) then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;

  insert into public.dj_team_members (dj_user_id, member_user_id, role, status)
  values (inv.dj_user_id, uid, inv.role, 'active')
  on conflict (dj_user_id, member_user_id)
    do update set role = excluded.role, status = 'active';

  update public.dj_team_invitations
    set status = 'accepted', accepted_at = now(), member_user_id = uid
    where id = inv.id;

  -- Grant the dj app role so the manager can reach the dashboard (idempotent).
  insert into public.user_roles (user_id, role, email)
  select uid, 'dj'::public.app_role, uemail
  where not exists (
    select 1 from public.user_roles where user_id = uid and role = 'dj'::public.app_role
  );

  return jsonb_build_object('ok', true, 'dj_user_id', inv.dj_user_id);
end;
$$;

grant execute on function public.dj_accept_team_invitation(text) to authenticated;

-- ── Revoke an invitation (and any active membership it created) ────────────────
create or replace function public.dj_revoke_team_invitation(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.dj_team_invitations;
begin
  select * into inv from public.dj_team_invitations where id = p_id;
  if inv.id is null or inv.dj_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.dj_team_invitations set status = 'revoked' where id = p_id;

  if inv.member_user_id is not null then
    update public.dj_team_members set status = 'revoked'
      where dj_user_id = inv.dj_user_id and member_user_id = inv.member_user_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.dj_revoke_team_invitation(uuid) to authenticated;
