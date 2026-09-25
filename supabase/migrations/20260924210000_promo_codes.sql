-- =============================================================================
-- Codes promo par soirée (plan Shotgun, lot F)
-- =============================================================================
-- Jusqu'ici un code n'existait chez Yuno que rattaché à un PROMOTEUR (sa remise
-- et sa commission). Un organisateur qui vient de Shotgun attend l'inverse : un
-- code posé sur une soirée (ou sur toutes), indépendant de tout promoteur —
-- « EARLY20 », « STAFF », « BDE10 ».
--
-- Règles intouchables :
--   • Le SERVEUR décide de la remise : `claim_promo_code` (service_role) relit
--     le code, sa portée, ses dates, son pilier, son palier et son quota, SOUS
--     VERROU de la ligne, puis réserve un usage. Le front n'envoie qu'un texte.
--   • Un usage est RETENU 30 minutes (billet en attente, que
--     cleanup-pending-purchases supprime à 30 min), puis compte pour de bon
--     quand le billet / la table passe payé (trigger). Deux acheteurs ne
--     peuvent donc jamais consommer ensemble le dernier usage.
--   • La remise s'applique AVANT les frais (même chemin que la remise
--     promoteur) et ne se CUMULE jamais avec elle : la plus forte gagne,
--     l'attribution promoteur reste.
--   • Tables : la remise porte sur l'acompte payé en ligne (comme la remise
--     promoteur) ; une formule réglée sur place n'a rien à remiser.
--   • Écriture par le pro (RLS de portée) ; une session d'accès assisté est
--     tracée dans `admin_support_audit` (log_support_session_write) — un code
--     promo est un réglage de prix, comme un palier de billetterie.
-- =============================================================================

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  venue_id text references public.venues(id) on delete cascade,
  organizer_user_id uuid,
  event_id uuid references public.events(id) on delete cascade,
  code text not null,
  label text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  applies_to text[] not null default array['tickets']::text[],
  ticket_round_ids uuid[],
  max_uses integer check (max_uses is null or max_uses > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_one_scope check ((venue_id is null) <> (organizer_user_id is null)),
  constraint promo_codes_percentage_max check (discount_type <> 'percentage' or discount_value <= 100),
  constraint promo_codes_code_format check (code ~ '^[A-Z0-9_-]{3,32}$'),
  constraint promo_codes_applies_to check (
    cardinality(applies_to) > 0 and applies_to <@ array['tickets', 'tables']::text[]
  ),
  constraint promo_codes_dates check (starts_at is null or ends_at is null or ends_at > starts_at)
);

-- Un même texte ne vit qu'une fois par portée ET par cible (toutes les soirées
-- ou une soirée précise) : sinon deux remises différentes se disputeraient.
create unique index if not exists uq_promo_codes_scope_code
  on public.promo_codes (coalesce(venue_id, ''), coalesce(organizer_user_id::text, ''), coalesce(event_id::text, ''), code);
create index if not exists idx_promo_codes_venue on public.promo_codes (venue_id) where venue_id is not null;
create index if not exists idx_promo_codes_org on public.promo_codes (organizer_user_id) where organizer_user_id is not null;
create index if not exists idx_promo_codes_event on public.promo_codes (event_id) where event_id is not null;

comment on table public.promo_codes is
  'Codes promo autonomes (lot F) : portée club OU organisateur, une soirée ou toutes, % ou montant, billets et/ou tables, quota, dates. Remise décidée par claim_promo_code (serveur).';

-- Le code s'écrit en capitales sans espaces, et une soirée visée appartient
-- forcément à la portée du code.
create or replace function public.promo_codes_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := upper(regexp_replace(coalesce(new.code, ''), '\s+', '', 'g'));
  new.updated_at := now();
  if new.event_id is not null and not exists (
    select 1 from public.events e
    where e.id = new.event_id
      and ((new.venue_id is not null and (e.venue_id = new.venue_id or e.partner_venue_id = new.venue_id))
        or (new.organizer_user_id is not null and (e.organizer_user_id = new.organizer_user_id or e.partner_organizer_id = new.organizer_user_id)))
  ) then
    raise exception 'promo_code_event_out_of_scope' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_promo_codes_normalize on public.promo_codes;
create trigger trg_promo_codes_normalize
  before insert or update on public.promo_codes
  for each row execute function public.promo_codes_normalize();

-- Qui gère les codes d'une portée : le club (owner, ou manager avec le droit
-- CRM), l'organisateur fondateur ou un admin de son équipe.
create or replace function public.can_manage_promo_scope(p_venue_id text, p_organizer_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_super_admin()
    or (p_venue_id is not null and (
      public.is_venue_owner(auth.uid(), p_venue_id)
      or exists (select 1 from public.manager_permissions mp
                 where mp.user_id = auth.uid() and mp.venue_id = p_venue_id and coalesce(mp.can_manage_crm, false))
    ))
    or (p_organizer_user_id is not null and (
      p_organizer_user_id = auth.uid()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ))
  );
$$;

revoke all on function public.can_manage_promo_scope(text, uuid) from public, anon;
grant execute on function public.can_manage_promo_scope(text, uuid) to authenticated, service_role;

alter table public.promo_codes enable row level security;

drop policy if exists promo_codes_select on public.promo_codes;
create policy promo_codes_select on public.promo_codes
  for select to authenticated
  using (public.can_manage_promo_scope(venue_id, organizer_user_id));

drop policy if exists promo_codes_insert on public.promo_codes;
create policy promo_codes_insert on public.promo_codes
  for insert to authenticated
  with check (public.can_manage_promo_scope(venue_id, organizer_user_id));

drop policy if exists promo_codes_update on public.promo_codes;
create policy promo_codes_update on public.promo_codes
  for update to authenticated
  using (public.can_manage_promo_scope(venue_id, organizer_user_id))
  with check (public.can_manage_promo_scope(venue_id, organizer_user_id));

drop policy if exists promo_codes_delete on public.promo_codes;
create policy promo_codes_delete on public.promo_codes
  for delete to authenticated
  using (public.can_manage_promo_scope(venue_id, organizer_user_id));

-- Accès assisté : tracé (l'admin réel est nommé), pas bloqué.
drop trigger if exists trg_support_log_promo_codes on public.promo_codes;
create trigger trg_support_log_promo_codes
  after insert or update or delete on public.promo_codes
  for each row execute function public.log_support_session_write();

-- ── Usages ───────────────────────────────────────────────────────────────────
create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  event_id uuid not null,
  pillar text not null check (pillar in ('tickets', 'tables')),
  -- Pas de clé étrangère : un billet en attente est SUPPRIMÉ à 30 min par
  -- cleanup-pending-purchases, l'usage retenu expire alors de lui-même.
  ticket_id uuid,
  table_reservation_id uuid,
  email text,
  user_id uuid,
  quantity integer not null default 1 check (quantity > 0),
  discount_amount numeric(10, 2) not null check (discount_amount >= 0),
  status text not null default 'held' check (status in ('held', 'paid', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promo_redemptions_code on public.promo_code_redemptions (promo_code_id, status, created_at);
create index if not exists idx_promo_redemptions_ticket on public.promo_code_redemptions (ticket_id) where ticket_id is not null;
create index if not exists idx_promo_redemptions_table on public.promo_code_redemptions (table_reservation_id) where table_reservation_id is not null;

-- Aucune policy : service_role écrit, les RPC lisent.
alter table public.promo_code_redemptions enable row level security;

alter table public.tickets add column if not exists promo_code_id uuid;
alter table public.tickets add column if not exists promo_discount numeric(10, 2);
alter table public.table_reservations add column if not exists promo_code_id uuid;
alter table public.table_reservations add column if not exists promo_discount numeric(10, 2);

comment on column public.tickets.promo_discount is
  'Remise du code promo (lot F), déjà déduite de total_price. La remise promoteur, elle, est tracée dans promoter_conversions.';

-- Usages qui comptent dans le quota : payés, ou retenus depuis moins de 30 min.
create or replace function public.promo_code_uses(p_promo_code_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.promo_code_redemptions r
  where r.promo_code_id = p_promo_code_id
    and (r.status = 'paid' or (r.status = 'held' and r.created_at > now() - interval '30 minutes'));
$$;

revoke all on function public.promo_code_uses(uuid) from public, anon, authenticated;
grant execute on function public.promo_code_uses(uuid) to service_role;

-- Le code applicable à une soirée : celui de la soirée gagne sur celui de
-- « toutes les soirées », le club / l'organisateur de la soirée en sont la
-- portée (hôte ou partenaire).
create or replace function public.find_promo_code(p_code text, p_event_id uuid)
returns public.promo_codes
language sql
stable
security definer
set search_path = public
as $$
  select pc.*
  from public.promo_codes pc
  join public.events e on e.id = p_event_id
  where pc.code = upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'))
    and (pc.event_id = p_event_id or pc.event_id is null)
    and ((pc.venue_id is not null and (pc.venue_id = e.venue_id or pc.venue_id = e.partner_venue_id))
      or (pc.organizer_user_id is not null and (pc.organizer_user_id = e.organizer_user_id or pc.organizer_user_id = e.partner_organizer_id)))
  order by (pc.event_id is not null) desc, pc.created_at desc
  limit 1;
$$;

revoke all on function public.find_promo_code(text, uuid) from public, anon, authenticated;
grant execute on function public.find_promo_code(text, uuid) to service_role;

-- Raison de refus d'un code pour un achat donné (NULL = valable).
create or replace function public.promo_code_refusal(
  pc public.promo_codes,
  p_pillar text,
  p_ticket_round_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pc.id is null then 'not_found'
    when not pc.is_active then 'inactive'
    when pc.starts_at is not null and now() < pc.starts_at then 'not_started'
    when pc.ends_at is not null and now() >= pc.ends_at then 'expired'
    when not (p_pillar = any(pc.applies_to)) then 'not_eligible'
    when p_pillar = 'tickets' and pc.ticket_round_ids is not null and cardinality(pc.ticket_round_ids) > 0
         and (p_ticket_round_id is null or not (p_ticket_round_id = any(pc.ticket_round_ids))) then 'not_eligible'
    when pc.max_uses is not null and public.promo_code_uses(pc.id) >= pc.max_uses then 'exhausted'
    else null
  end;
$$;

revoke all on function public.promo_code_refusal(public.promo_codes, text, uuid) from public, anon, authenticated;
grant execute on function public.promo_code_refusal(public.promo_codes, text, uuid) to service_role;

-- La remise, arrondie au centime, jamais au-delà de la base.
--   billets : % du sous-total, ou montant PAR billet ;
--   tables  : % de l'acompte payé en ligne, ou montant par réservation.
create or replace function public.promo_code_discount(
  p_type text, p_value numeric, p_pillar text, p_quantity integer, p_base numeric
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select greatest(0, least(
    coalesce(p_base, 0),
    case
      when p_type = 'percentage' then round(coalesce(p_base, 0) * p_value / 100, 2)
      when p_pillar = 'tickets' then round(p_value * greatest(coalesce(p_quantity, 1), 1), 2)
      else round(p_value, 2)
    end
  ));
$$;

-- Aperçu public (page de paiement) : dit si le code s'applique et combien,
-- SANS rien retenir. La décision finale reste claim_promo_code.
create or replace function public.check_promo_code(
  p_code text,
  p_event_id uuid,
  p_pillar text default 'tickets',
  p_ticket_round_id uuid default null,
  p_quantity integer default 1,
  p_base_amount numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pc public.promo_codes;
  v_reason text;
begin
  if coalesce(length(btrim(p_code)), 0) < 3 or p_event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  v_pc := public.find_promo_code(p_code, p_event_id);
  v_reason := public.promo_code_refusal(v_pc, p_pillar, p_ticket_round_id);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', v_pc.code,
    'discountType', v_pc.discount_type,
    'discountValue', v_pc.discount_value,
    'discount', case when p_base_amount is null then null
                     else public.promo_code_discount(v_pc.discount_type, v_pc.discount_value, p_pillar, p_quantity, p_base_amount) end
  );
end;
$$;

revoke all on function public.check_promo_code(text, uuid, text, uuid, integer, numeric) from public;
grant execute on function public.check_promo_code(text, uuid, text, uuid, integer, numeric) to anon, authenticated, service_role;

-- La décision serveur : valide le code SOUS VERROU et retient un usage.
create or replace function public.claim_promo_code(
  p_code text,
  p_event_id uuid,
  p_pillar text,
  p_ticket_round_id uuid,
  p_quantity integer,
  p_base_amount numeric,
  p_email text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pc public.promo_codes;
  v_reason text;
  v_discount numeric;
  v_id uuid;
begin
  v_pc := public.find_promo_code(p_code, p_event_id);
  if v_pc.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Verrou de la ligne : deux paiements simultanés sur le dernier usage
  -- passent l'un après l'autre, le second voit le premier.
  select * into v_pc from public.promo_codes where id = v_pc.id for update;
  v_reason := public.promo_code_refusal(v_pc, p_pillar, p_ticket_round_id);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  v_discount := public.promo_code_discount(v_pc.discount_type, v_pc.discount_value, p_pillar, p_quantity, p_base_amount);
  insert into public.promo_code_redemptions (promo_code_id, event_id, pillar, email, user_id, quantity, discount_amount)
  values (v_pc.id, p_event_id, p_pillar, lower(nullif(btrim(p_email), '')), p_user_id, greatest(coalesce(p_quantity, 1), 1), v_discount)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'redemptionId', v_id, 'promoCodeId', v_pc.id, 'code', v_pc.code, 'discount', v_discount);
end;
$$;

revoke all on function public.claim_promo_code(text, uuid, text, uuid, integer, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_promo_code(text, uuid, text, uuid, integer, numeric, text, uuid) to service_role;

-- Relie l'usage retenu à la vente créée ; payé d'emblée si la vente l'est déjà
-- (chemin simulé / démo), sinon le trigger ci-dessous le confirmera.
create or replace function public.attach_promo_redemption(
  p_redemption_id uuid,
  p_ticket_id uuid default null,
  p_table_reservation_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_paid boolean := false;
begin
  if p_ticket_id is not null then
    select t.status in ('paid', 'used') into v_paid from public.tickets t where t.id = p_ticket_id;
  elsif p_table_reservation_id is not null then
    select r.status in ('paid', 'confirmed') into v_paid from public.table_reservations r where r.id = p_table_reservation_id;
  end if;
  update public.promo_code_redemptions
     set ticket_id = coalesce(p_ticket_id, ticket_id),
         table_reservation_id = coalesce(p_table_reservation_id, table_reservation_id),
         status = case when coalesce(v_paid, false) then 'paid' else status end,
         updated_at = now()
   where id = p_redemption_id;
end;
$$;

revoke all on function public.attach_promo_redemption(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_promo_redemption(uuid, uuid, uuid) to service_role;

create or replace function public.release_promo_redemption(p_redemption_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.promo_code_redemptions
     set status = 'released', updated_at = now()
   where id = p_redemption_id and status = 'held';
$$;

revoke all on function public.release_promo_redemption(uuid) from public, anon, authenticated;
grant execute on function public.release_promo_redemption(uuid) to service_role;

-- Le paiement confirme l'usage ; une annulation avant paiement le rend.
create or replace function public.promo_redemption_follow_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.promo_code_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status in ('paid', 'used') then
    update public.promo_code_redemptions set status = 'paid', updated_at = now()
     where ticket_id = new.id and status <> 'paid';
  elsif old.status = 'pending' and new.status in ('cancelled', 'expired', 'failed') then
    update public.promo_code_redemptions set status = 'released', updated_at = now()
     where ticket_id = new.id and status = 'held';
  end if;
  return new;
exception when others then
  -- Le suivi d'un usage ne doit jamais faire échouer un paiement.
  return new;
end;
$$;

drop trigger if exists trg_promo_redemption_ticket on public.tickets;
create trigger trg_promo_redemption_ticket
  after update of status on public.tickets
  for each row execute function public.promo_redemption_follow_ticket();

create or replace function public.promo_redemption_follow_table()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.promo_code_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status in ('paid', 'confirmed') then
    update public.promo_code_redemptions set status = 'paid', updated_at = now()
     where table_reservation_id = new.id and status <> 'paid';
  elsif old.status = 'pending' and new.status in ('cancelled', 'expired', 'failed') then
    update public.promo_code_redemptions set status = 'released', updated_at = now()
     where table_reservation_id = new.id and status = 'held';
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_promo_redemption_table on public.table_reservations;
create trigger trg_promo_redemption_table
  after update of status on public.table_reservations
  for each row execute function public.promo_redemption_follow_table();

-- ── Lecture pro : les codes d'une portée et ce qu'ils ont fait vendre ────────
create or replace function public.get_promo_codes(
  p_venue_id text default null,
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_money boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if (p_venue_id is null) = (p_organizer_user_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not public.can_manage_promo_scope(p_venue_id, p_organizer_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  -- Le CA suit les mêmes droits que le reste de la Console.
  v_money := public.is_super_admin()
    or (p_venue_id is not null and (
      exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (select 1 from public.manager_permissions mp where mp.user_id = v_uid and mp.venue_id = p_venue_id
                 and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false)))))
    or (p_organizer_user_id is not null and (
      v_uid = p_organizer_user_id or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance')));

  return jsonb_build_object(
    'ok', true,
    'money', v_money,
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pc.id,
               'code', pc.code,
               'label', pc.label,
               'eventId', pc.event_id,
               'eventTitle', e.title,
               'eventStartAt', e.start_at,
               'discountType', pc.discount_type,
               'discountValue', pc.discount_value,
               'appliesTo', pc.applies_to,
               'maxUses', pc.max_uses,
               'startsAt', pc.starts_at,
               'endsAt', pc.ends_at,
               'isActive', pc.is_active,
               'createdAt', pc.created_at,
               'uses', coalesce(st.uses, 0),
               'held', coalesce(st.held, 0),
               'tickets', coalesce(st.tickets, 0),
               'tables', coalesce(st.tables, 0),
               'discountGiven', coalesce(st.discount_given, 0),
               'revenue', case when v_money then round(coalesce(st.revenue, 0)::numeric, 2) else null end
             ) order by pc.is_active desc, pc.created_at desc)
      from public.promo_codes pc
      left join public.events e on e.id = pc.event_id
      left join lateral (
        select
          count(*) filter (where r.status = 'paid') as uses,
          count(*) filter (where r.status = 'held' and r.created_at > now() - interval '30 minutes') as held,
          coalesce(sum(t.quantity) filter (where r.status = 'paid' and r.pillar = 'tickets'), 0) as tickets,
          count(*) filter (where r.status = 'paid' and r.pillar = 'tables') as tables,
          sum(r.discount_amount) filter (where r.status = 'paid') as discount_given,
          -- CA club de ces ventes (fees.ts) : total − frais Yuno, remboursement déduit.
          sum(
            case
              when r.status <> 'paid' then 0
              when r.pillar = 'tickets' then
                greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                - least(greatest(coalesce(t.refund_amount, 0), 0),
                        greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
              else
                greatest(tr.total_price - coalesce(tr.service_fee, 0) - coalesce(tr.management_fee, 0), 0)
                - least(greatest(coalesce(tr.refund_amount, 0), 0),
                        greatest(tr.total_price - coalesce(tr.service_fee, 0) - coalesce(tr.management_fee, 0), 0))
            end
          ) as revenue
        from public.promo_code_redemptions r
        left join public.tickets t on t.id = r.ticket_id
        left join public.table_reservations tr on tr.id = r.table_reservation_id
        where r.promo_code_id = pc.id
      ) st on true
      where (p_venue_id is not null and pc.venue_id = p_venue_id)
         or (p_organizer_user_id is not null and pc.organizer_user_id = p_organizer_user_id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_promo_codes(text, uuid) from public, anon;
grant execute on function public.get_promo_codes(text, uuid) to authenticated;

comment on function public.get_promo_codes(text, uuid) is
  'Codes promo d''une portée avec leurs usages payés, retenus (< 30 min), billets et tables vendus, remise accordée et CA club (fees.ts, remboursement déduit ; CA seulement pour qui voit l''argent).';
