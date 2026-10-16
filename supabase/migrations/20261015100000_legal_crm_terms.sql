-- Conditions Yuno CRM : l'acceptation du titulaire est tracée comme celle des
-- conditions pro de la Billetterie (registre legal_acceptances, version + empreinte
-- SHA-256 du texte + IP + user-agent). Deux types de documents s'ajoutent :
--   terms_crm  Conditions Yuno CRM (yunoapp.eu/legal/cgv-crm)
--   dpa        Accord de sous-traitance des données (yunoapp.eu/legal/dpa),
--              dont le chapitre 12 « Yuno CRM » encadre l'analyse client et les
--              statistiques anonymes.
-- Le front (CrmLegalGate) les demande au titulaire d'un espace CRM tant que la
-- version courante (LEGAL_VERSIONS, src/lib/legal.ts) n'est pas acceptée.
-- Corps de record_legal_acceptance repris de la base liée (identique au fichier
-- 20260706090000) ; seule la liste des types change.

alter table public.legal_acceptances drop constraint if exists legal_acceptances_doc_type_check;
alter table public.legal_acceptances add constraint legal_acceptances_doc_type_check
  check (doc_type in ('cgu','cgv_users','terms_pro','confidentiality','demo_confidentiality','privacy',
                      'terms_crm','dpa'));

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
    ('cgu','cgv_users','terms_pro','confidentiality','demo_confidentiality','privacy',
     'terms_crm','dpa') then
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
