-- =============================================================================
-- Codes promo : l'aperçu public ne se devine pas par force brute
-- =============================================================================
-- `check_promo_code` est ouverte à anon (c'est l'aperçu du champ « Code promo »
-- au checkout). Sans garde, un script pouvait essayer des milliers de codes par
-- minute sur une soirée et trouver les codes privés (partenaires, staff).
--
-- Garde : au-delà de 15 codes INCONNUS en une heure pour un même visiteur
-- (hash salé-jour de `links_visitor_context`, ou l'utilisateur connecté), la
-- vérification répond `rate_limited` — y compris pour un code juste, sinon la
-- garde ne protège rien. Seuls les échecs `not_found` comptent : un client qui
-- change la quantité avec un bon code n'est jamais freiné.
--
-- `claim_promo_code` (service_role, au checkout) redécide de toute façon ; ce
-- verrou ne touche que l'aperçu.
-- =============================================================================

create table if not exists public.promo_code_failed_checks (
  visitor_hash text not null,
  at timestamptz not null default now()
);
create index if not exists promo_code_failed_checks_visitor_at
  on public.promo_code_failed_checks (visitor_hash, at desc);
alter table public.promo_code_failed_checks enable row level security;
-- Aucune policy : seule la fonction ci-dessous (SECURITY DEFINER) y touche.
revoke all on public.promo_code_failed_checks from anon, authenticated;

create or replace function public.check_promo_code(
  p_code text, p_event_id uuid, p_pillar text default 'tickets',
  p_ticket_round_id uuid default null, p_quantity integer default 1, p_base_amount numeric default null)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  v_pc public.promo_codes;
  v_reason text;
  v_hash text;
begin
  begin
    select o_hash into v_hash from public.links_visitor_context();
  exception when others then
    v_hash := null;
  end;

  if v_hash is not null and (
    select count(*) from public.promo_code_failed_checks f
    where f.visitor_hash = v_hash and f.at > now() - interval '1 hour'
  ) >= 15 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if coalesce(length(btrim(p_code)), 0) < 3 or p_event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  v_pc := public.find_promo_code(p_code, p_event_id);
  v_reason := public.promo_code_refusal(v_pc, p_pillar, p_ticket_round_id);
  if v_reason is not null then
    if v_reason = 'not_found' and v_hash is not null then
      insert into public.promo_code_failed_checks (visitor_hash) values (v_hash);
      -- Ménage opportuniste : la table ne garde que la dernière journée.
      if random() < 0.02 then
        delete from public.promo_code_failed_checks where at < now() - interval '1 day';
      end if;
    end if;
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
$function$;
