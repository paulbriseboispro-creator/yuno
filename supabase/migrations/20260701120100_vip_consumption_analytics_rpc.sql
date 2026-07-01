-- Phase 4 — Analytics conso VIP (idée fondateur #1 : « qui boit quoi, quand, comment »).
-- Lit la vue unifiée vip_consumption_facts (Phase 0) et renvoie des AGRÉGATS uniquement
-- (jamais de PII ligne à ligne). Scopé par venue via is_venue_owner, sur le modèle exact
-- de event_audience_demographics.
--
-- Renvoie : totaux (CA conso, articles, bouteilles, tables actives, valeur incluse vs upsell),
-- top items, répartition par catégorie, par zone, par heure, et bilan upsell vs minimum spend.

create or replace function public.get_vip_consumption_analytics(
  p_venue_id text,
  p_event_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Europe/Paris'
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with facts as (
    select f.*
    from public.vip_consumption_facts f
    where f.venue_id = p_venue_id
      and (p_event_id is null or f.event_id = p_event_id)
      and (p_from is null or f.served_at >= p_from)
      and (p_to   is null or f.served_at <= p_to)
  ),
  -- Conso agrégée par réservation, pour le calcul upsell vs minimum
  per_res as (
    select f.table_reservation_id, sum(f.total_price) as consumed
    from facts f
    group by f.table_reservation_id
  ),
  res_scope as (
    select r.id, r.minimum_spend, coalesce(pr.consumed, 0) as consumed
    from public.table_reservations r
    join per_res pr on pr.table_reservation_id = r.id
    where r.status = 'paid'
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'revenue',        coalesce((select sum(total_price) from facts), 0),
      'items',          coalesce((select sum(quantity)    from facts), 0),
      'bottles',        coalesce((select sum(quantity)    from facts where item_type = 'bottle'), 0),
      'active_tables',  (select count(distinct table_reservation_id) from facts),
      'included_value', coalesce((select sum(total_price) from facts where is_included), 0),
      'upsell_value',   coalesce((select sum(total_price) from facts where not is_included), 0),
      'avg_per_table',  coalesce((
        select round(avg(t.rev)::numeric, 2) from (
          select table_reservation_id, sum(total_price) rev from facts group by table_reservation_id
        ) t), 0)
    ),
    'top_items', coalesce((
      select jsonb_agg(row_to_json(ti)) from (
        select
          menu_item_id,
          max(item_name)  as name,
          max(category)   as category,
          max(brand)      as brand,
          sum(quantity)   as qty,
          sum(total_price) as revenue
        from facts
        group by menu_item_id, lower(coalesce(item_name, ''))
        order by revenue desc
        limit 15
      ) ti), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', coalesce(category, 'other'), 'qty', qty, 'revenue', revenue) order by revenue desc)
      from (
        select category, sum(quantity) qty, sum(total_price) revenue
        from facts group by category
      ) bc), '[]'::jsonb),
    'by_zone', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'zone_name', zone_name,
        'revenue', revenue, 'qty', qty, 'tables', tables) order by revenue desc)
      from (
        select f.zone_id, coalesce(tz.name, 'Zone') as zone_name,
               sum(f.total_price) revenue, sum(f.quantity) qty,
               count(distinct f.table_reservation_id) tables
        from facts f
        left join public.table_zones tz on tz.id = f.zone_id
        group by f.zone_id, tz.name
      ) bz), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'revenue', revenue, 'qty', qty) order by hour)
      from (
        select extract(hour from (served_at at time zone p_tz))::int as hour,
               sum(total_price) revenue, sum(quantity) qty
        from facts
        group by 1
      ) bh), '[]'::jsonb),
    'upsell', jsonb_build_object(
      'total_minimum',      coalesce((select sum(minimum_spend) from res_scope where minimum_spend > 0), 0),
      'total_consumed',     coalesce((select sum(consumed) from res_scope), 0),
      'upsell_amount',      coalesce((select sum(greatest(consumed - coalesce(minimum_spend,0), 0)) from res_scope), 0),
      'tables_over_min',    (select count(*) from res_scope where minimum_spend > 0 and consumed >= minimum_spend),
      'tables_under_min',   (select count(*) from res_scope where minimum_spend > 0 and consumed <  minimum_spend)
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_vip_consumption_analytics(text, uuid, timestamptz, timestamptz, text) to authenticated;
