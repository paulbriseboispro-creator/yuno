-- ============================================================================
-- Staff de nuit sans club : `get_user_venue_id(uid) = club` ne vaut plus NULL.
--
-- Un compte qui a un rôle de staff (hôte VIP, barman, manager) mais pas de
-- club (profiles.venue_id NULL — c'est le cas du staff d'un organisateur)
-- faisait valoir NULL à ce test, et la garde `IF NOT (…)` laissait passer.
-- Prouvé le 04/10 en transaction annulée avec un compte de test sans club :
-- get_vip_guest_profile rendait la fiche d'un client VIP (e-mail, visites,
-- dépense) de n'importe quel club à un hôte VIP sans club — deux comptes
-- réels sont dans ce cas —, get_vip_host_leaderboard le classement des hôtes
-- à un manager sans club, staff_set_drink_stock passait pour un barman sans
-- club. create_manual_table_reservation a la même forme. Les portes partagées
-- (can_run_vip_service, can_run_bar, can_staff_flag_venue…) sont corrigées
-- dans 20261005210000.
-- Le test est entouré d'un COALESCE(…, false) ; ces fonctions ne sont plus
-- exécutables par anon. Corps repris de la base liée (pg_get_functiondef, 04/10).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.staff_set_drink_stock(p_drink_id text, p_out boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_venue_id TEXT;
BEGIN
  SELECT venue_id INTO v_venue_id FROM drinks WHERE id = p_drink_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'Unknown drink %', p_drink_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    is_super_admin()
    OR is_venue_owner(auth.uid(), v_venue_id)
    OR manager_has_permission(auth.uid(), v_venue_id, 'menu')
    OR COALESCE(has_role(auth.uid(), 'barman') AND get_user_venue_id(auth.uid()) = v_venue_id, false)
  ) THEN
    RAISE EXCEPTION 'Not authorized for venue %', v_venue_id USING ERRCODE = '42501';
  END IF;

  UPDATE drinks
  SET out_of_stock = p_out,
      out_of_stock_at = CASE WHEN p_out THEN now() ELSE NULL END,
      out_of_stock_by = CASE WHEN p_out THEN auth.uid() ELSE NULL END
  WHERE id = p_drink_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(p_event_id uuid, p_zone_id uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_guest_count integer DEFAULT 1, p_total_price numeric DEFAULT 0, p_minimum_spend numeric DEFAULT 0, p_assigned_table_id uuid DEFAULT NULL::uuid, p_remarks text DEFAULT NULL::text, p_open_tab boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_venue      text;
  v_zone_event uuid;
  v_max        integer;
  v_zone_name  text;
  v_used       integer;
  v_email      text := COALESCE(NULLIF(btrim(p_email), ''), '');
  v_org        uuid;
  v_id         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT venue_id, event_id, tables_count, name
    INTO v_venue, v_zone_event, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL AND v_zone_event IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_venue IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = p_event_id
         AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue)
    ) THEN
      RAISE EXCEPTION 'event not in venue' USING ERRCODE = '22023';
    END IF;

    IF NOT (
      public.is_venue_owner(v_uid, v_venue)
      OR public.manager_has_permission(v_uid, v_venue, 'tables')
      OR COALESCE(public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'), false)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Zone d'une soirée sans club : elle doit appartenir À CETTE soirée, et
    -- l'appelant en être l'organisateur (ou de son équipe).
    IF v_zone_event <> p_event_id THEN
      RAISE EXCEPTION 'zone not in event' USING ERRCODE = '22023';
    END IF;
    SELECT organizer_user_id INTO v_org FROM public.events WHERE id = p_event_id;
    IF NOT (
      public.can_manage_organizer_rooms(v_uid, v_org)
      OR public.is_event_partner_organizer(v_uid, p_event_id)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Capacité de la zone : une résa terminée, no-show ou refusée a rendu sa
  -- table — le club la refait tourner dans la nuit.
  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
     WHERE event_id = p_event_id
       AND zone_id = p_zone_id
       AND status IN ('pending', 'paid', 'confirmed')
       AND COALESCE(vip_status, 'waiting') NOT IN ('finished', 'no_show', 'denied');
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'La zone "%" est complète (%/% tables).', v_zone_name, v_used, v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_assigned_table_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_assigned_table_id::text, 0));
    -- Tient la table : un groupe installé, un client pré-placé qui n'est pas
    -- encore arrivé, une demande de table en attente de réponse.
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
       WHERE r.event_id = p_event_id
         AND r.status IN ('pending', 'paid', 'confirmed')
         AND (
           (r.assigned_table_id = p_assigned_table_id
             AND COALESCE(r.vip_status, 'waiting') IN ('waiting', 'placed', 'active'))
           OR (r.requested_table_id = p_assigned_table_id
             AND r.assigned_table_id IS NULL
             AND r.placement_status = 'requested'
             AND COALESCE(r.vip_status, 'waiting') = 'waiting')
         )
    ) THEN
      RAISE EXCEPTION 'Cette table est déjà prise.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed,
    minimum_spend, status, paid_at, full_name, phone, remarks,
    assigned_table_id, placed_by, placed_at, placement_status, vip_status,
    purchase_source, newsletter_opt_in
  ) VALUES (
    p_event_id, p_zone_id, NULL, v_email, true, GREATEST(COALESCE(p_guest_count, 1), 1),
    0,
    CASE WHEN p_open_tab THEN 0 ELSE GREATEST(COALESCE(p_total_price, 0), 0) END,
    0, 0, false,
    GREATEST(COALESCE(p_minimum_spend, 0), 0), 'paid', now(),
    NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''), p_remarks,
    p_assigned_table_id,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN v_uid ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN 'approved' ELSE 'none' END,
    'active',
    CASE WHEN p_open_tab THEN 'manual_open' ELSE 'manual' END,
    (v_email <> '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vip_guest_profile(p_venue_id text, p_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    or coalesce(public.has_role(auth.uid(), 'vip_host') and public.get_user_venue_id(auth.uid()) = p_venue_id, false)
    or coalesce(public.has_role(auth.uid(), 'manager')  and public.get_user_venue_id(auth.uid()) = p_venue_id, false)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_vip_host_leaderboard(p_venue_id text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if not (
    public.is_venue_owner(auth.uid(), p_venue_id)
    or public.is_super_admin()
    or coalesce(public.has_role(auth.uid(), 'manager') and public.get_user_venue_id(auth.uid()) = p_venue_id, false)
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
$function$;


REVOKE ALL ON FUNCTION public.staff_set_drink_stock(p_drink_id text, p_out boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_drink_stock(p_drink_id text, p_out boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_manual_table_reservation(p_event_id uuid, p_zone_id uuid, p_full_name text, p_phone text, p_email text, p_guest_count integer, p_total_price numeric, p_minimum_spend numeric, p_assigned_table_id uuid, p_remarks text, p_open_tab boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_table_reservation(p_event_id uuid, p_zone_id uuid, p_full_name text, p_phone text, p_email text, p_guest_count integer, p_total_price numeric, p_minimum_spend numeric, p_assigned_table_id uuid, p_remarks text, p_open_tab boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_vip_guest_profile(p_venue_id text, p_user_id uuid, p_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vip_guest_profile(p_venue_id text, p_user_id uuid, p_email text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_vip_host_leaderboard(p_venue_id text, p_event_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vip_host_leaderboard(p_venue_id text, p_event_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated, service_role;
