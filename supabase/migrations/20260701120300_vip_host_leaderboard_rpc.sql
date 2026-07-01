-- Phase 6 — Leaderboard host / upsell.
-- Qui, parmi les hôtes VIP, génère le plus de conso servie. Le champ served_by est déjà
-- capturé à chaque ligne (host qui sert). Sert l'accountability + les commissions.
-- Lisible par owner, manager du club, super admin. Agrégats par host (jamais par client).

create or replace function public.get_vip_host_leaderboard(
  p_venue_id text,
  p_event_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if not (
    public.is_venue_owner(auth.uid(), p_venue_id)
    or public.is_super_admin()
    or (public.has_role(auth.uid(), 'manager') and public.get_user_venue_id(auth.uid()) = p_venue_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with facts as (
    select f.*
    from public.vip_consumption_facts f
    where f.venue_id = p_venue_id
      and f.served_by is not null
      and (p_event_id is null or f.event_id = p_event_id)
      and (p_from is null or f.served_at >= p_from)
      and (p_to   is null or f.served_at <= p_to)
  )
  select jsonb_build_object(
    'ok', true,
    'hosts', coalesce((
      select jsonb_agg(row_to_json(h) order by h.revenue desc) from (
        select
          f.served_by as host_id,
          coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Staff') as name,
          p.avatar_url,
          sum(f.total_price)                       as revenue,
          sum(f.quantity)                          as items,
          count(distinct f.table_reservation_id)   as tables
        from facts f
        left join public.profiles p on p.id = f.served_by
        group by f.served_by, p.first_name, p.last_name, p.email, p.avatar_url
      ) h), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_vip_host_leaderboard(text, uuid, timestamptz, timestamptz) to authenticated;
