-- Phase 5 — Carnet VIP / « black book ».
-- Fiche 360° d'un client VIP pour un club : combien il a dépensé (tables + conso),
-- combien de fois il est venu, ses bouteilles préférées, sa dernière venue, ses notes.
-- C'est ce qu'un manager VIP gère aujourd'hui à la main. Lisible par owner, manager
-- ET vip_host du club (le host en a besoin en live quand le client se présente).
-- AGRÉGATS pour un seul invité déjà identifié par l'appelant (user_id ou email) —
-- jamais une liste ouverte de clients.

create or replace function public.get_vip_guest_profile(
  p_venue_id text,
  p_user_id uuid default null,
  p_email text default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
  v_email text := lower(nullif(trim(p_email), ''));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if not (
    public.is_venue_owner(auth.uid(), p_venue_id)
    or public.is_super_admin()
    or (public.has_role(auth.uid(), 'vip_host') and public.get_user_venue_id(auth.uid()) = p_venue_id)
    or (public.has_role(auth.uid(), 'manager')  and public.get_user_venue_id(auth.uid()) = p_venue_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_user_id is null and v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'no_guest_key');
  end if;

  with res as (
    select r.id, r.user_id, r.user_email, r.full_name, r.total_price, r.minimum_spend,
           r.event_id, coalesce(r.paid_at, r.created_at) as visit_at
    from public.table_reservations r
    join public.events e on e.id = r.event_id
    where e.venue_id = p_venue_id
      and r.status = 'paid'
      and (
        (p_user_id is not null and r.user_id = p_user_id)
        or (v_email is not null and lower(r.user_email) = v_email)
      )
  ),
  gfacts as (
    select f.*
    from public.vip_consumption_facts f
    where f.table_reservation_id in (select id from res)
  ),
  per_night as (
    select r.id, r.minimum_spend,
           coalesce((select sum(g.total_price) from gfacts g where g.table_reservation_id = r.id), 0) as consumed
    from res r
  )
  select jsonb_build_object(
    'ok', true,
    'guest', jsonb_build_object(
      'full_name', (select full_name from res order by visit_at desc limit 1),
      'user_id', p_user_id,
      'email', coalesce(v_email, (select lower(user_email) from res order by visit_at desc limit 1))
    ),
    'nights',        (select count(distinct event_id) from res),
    'reservations',  (select count(*) from res),
    'first_seen',    (select min(visit_at) from res),
    'last_seen',     (select max(visit_at) from res),
    'days_since_last', (select case when max(visit_at) is null then null
                          else (extract(epoch from (now() - max(visit_at)))/86400)::int end from res),
    'table_revenue',       coalesce((select sum(total_price) from res), 0),
    'consumption_revenue', coalesce((select sum(total_price) from gfacts), 0),
    -- Valeur vie = tables payées + upsell au-delà du minimum (évite le double comptage du budget prépayé)
    'lifetime_value', coalesce((select sum(total_price) from res), 0)
       + coalesce((select sum(greatest(consumed - coalesce(minimum_spend,0), 0)) from per_night), 0),
    'avg_per_night', coalesce((
        select round((
          (coalesce((select sum(total_price) from res),0)
           + coalesce((select sum(greatest(consumed - coalesce(minimum_spend,0),0)) from per_night),0))
          / nullif((select count(distinct event_id) from res),0)
        )::numeric, 2)), 0),
    'nights_min_met', (select count(*) from per_night where minimum_spend > 0 and consumed >= minimum_spend),
    'favorite_category', (
       select category from gfacts where category is not null
       group by category order by sum(quantity) desc limit 1),
    'top_bottles', coalesce((
      select jsonb_agg(row_to_json(tb)) from (
        select max(item_name) as name, max(category) as category, max(brand) as brand,
               sum(quantity) as qty, sum(total_price) as revenue
        from gfacts
        where item_type = 'bottle' or item_type is null
        group by menu_item_id, lower(coalesce(item_name,''))
        order by qty desc limit 8
      ) tb), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('note', note, 'note_type', note_type, 'created_at', created_at) order by created_at desc)
      from public.vip_customer_notes
      where venue_id = p_venue_id and p_user_id is not null and user_id = p_user_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_vip_guest_profile(text, uuid, text) to authenticated;
