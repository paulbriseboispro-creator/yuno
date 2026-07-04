-- Sécurisation juridique : registre des acceptations légales (clickwrap).
--
-- Chaque acceptation (CGU au signup, conditions pro + engagement de confidentialité
-- à l'onboarding, engagement de confidentialité à l'entrée d'un aperçu démo) est
-- enregistrée avec un faisceau de preuves : qui (user_id/email), quoi (doc_type +
-- version + hash du contenu), quand (accepted_at), d'où (ip, user_agent).
--
-- Écriture UNIQUEMENT via la RPC record_legal_acceptance (security definer) :
-- pas de policy INSERT directe. L'anon peut enregistrer (porte de démo = prospect
-- non connecté), avec garde-fou de débit par IP.

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  doc_type text not null,
  doc_version text not null,
  doc_hash text,
  context jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  constraint legal_acceptances_doc_type_check
    check (doc_type in ('cgu','cgv_users','terms_pro','confidentiality','demo_confidentiality','privacy'))
);

create index if not exists legal_acceptances_user_idx
  on public.legal_acceptances (user_id, doc_type, accepted_at desc);
create index if not exists legal_acceptances_type_idx
  on public.legal_acceptances (doc_type, accepted_at desc);
create index if not exists legal_acceptances_ip_recent_idx
  on public.legal_acceptances (ip, accepted_at desc);

alter table public.legal_acceptances enable row level security;

-- Lecture : chacun voit ses propres acceptations ; le super admin voit tout.
drop policy if exists "legal_acceptances_select_own" on public.legal_acceptances;
create policy "legal_acceptances_select_own"
  on public.legal_acceptances for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- Pas de policy INSERT/UPDATE/DELETE : la RPC security definer est la seule porte
-- d'entrée, et le registre est immuable (aucune modification après coup).

create or replace function public.record_legal_acceptance(
  p_doc_type text,
  p_doc_version text,
  p_doc_hash text default null,
  p_email text default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_ip text;
  v_ua text;
  v_recent int;
  v_id uuid;
begin
  -- Validation d'entrée (la RPC est exposée à l'anon : tout est borné).
  if p_doc_type is null or p_doc_type not in
    ('cgu','cgv_users','terms_pro','confidentiality','demo_confidentiality','privacy') then
    raise exception 'invalid_doc_type';
  end if;
  if p_doc_version is null or length(p_doc_version) = 0 or length(p_doc_version) > 32 then
    raise exception 'invalid_doc_version';
  end if;
  if p_email is not null and (length(p_email) > 320 or position('@' in p_email) = 0) then
    raise exception 'invalid_email';
  end if;
  if p_context is not null and pg_column_size(p_context) > 2048 then
    raise exception 'context_too_large';
  end if;

  -- Faisceau de preuves : IP + user-agent depuis les en-têtes PostgREST.
  begin
    v_headers := current_setting('request.headers', true)::json;
    v_ip := nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    v_ua := nullif(left(coalesce(v_headers->>'user-agent', ''), 400), '');
  exception when others then
    v_ip := null;
    v_ua := null;
  end;

  -- Garde-fou anti-flood pour l'anon : 30 acceptations/min/IP max.
  if v_ip is not null then
    select count(*) into v_recent
    from public.legal_acceptances
    where ip = v_ip and accepted_at > now() - interval '1 minute';
    if v_recent >= 30 then
      raise exception 'rate_limited';
    end if;
  end if;

  insert into public.legal_acceptances (user_id, email, doc_type, doc_version, doc_hash, context, ip, user_agent)
  values (
    auth.uid(),
    p_email,
    p_doc_type,
    p_doc_version,
    left(p_doc_hash, 128),
    coalesce(p_context, '{}'::jsonb),
    v_ip,
    v_ua
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_legal_acceptance(text, text, text, text, jsonb) from public;
grant execute on function public.record_legal_acceptance(text, text, text, text, jsonb) to anon, authenticated;

-- Vérification côté front (LegalConsentGate) : l'utilisateur connecté a-t-il déjà
-- accepté cette version du document ?
create or replace function public.has_accepted_legal(
  p_doc_type text,
  p_doc_version text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.legal_acceptances
    where user_id = auth.uid()
      and doc_type = p_doc_type
      and doc_version = p_doc_version
  );
$$;

revoke all on function public.has_accepted_legal(text, text) from public;
grant execute on function public.has_accepted_legal(text, text) to authenticated;
