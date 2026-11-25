-- Tables VIP, vague A — P2.8 : une réservation abandonnée libère sa table à l'heure.
--
-- Une session Stripe de table dure 31 min (create-table-checkout : expires_at = +31 min). Mais reserve_table_slot comptait TOUTE
-- réservation `pending` (capacité de la zone, plafond de la formule, table demandée) tant que le nettoyage ne l'avait pas supprimée
-- (45 min côté edge) : un client qui ferme l'onglet bloquait la table et la formule trop longtemps. get_event_table_availability, lui,
-- coupait à 30 min : le plan public et le serveur ne disaient pas la même chose.
--
-- Une règle UNIQUE, `_table_resa_holds(status, created_at)` : une réservation retient sa table / sa place si elle est payée (paid,
-- confirmed) ou `pending` depuis moins de 31 min. Lue par reserve_table_slot (zone, formule, table) et get_event_table_availability.
-- Signatures inchangées ; la décision de la file d'attente reste côté edge (webhook checkout.session.expired supprime la pending).
-- _event_tables_left ne comptait déjà que paid / confirmed : inchangée.

CREATE OR REPLACE FUNCTION public._table_resa_holds(p_status text, p_created_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_status IN ('paid', 'confirmed')
      OR (p_status = 'pending' AND p_created_at > now() - interval '31 minutes');
$function$;
REVOKE ALL ON FUNCTION public._table_resa_holds(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._table_resa_holds(text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_table_slot(_event_id uuid, _zone_id uuid, _capacity_zone_id uuid, _pack_id uuid, _user_id uuid, _user_email text, _is_guest boolean, _guest_count integer, _deposit numeric, _total_price numeric, _management_fee numeric, _status text, _qr_code text, _full_name text, _phone text, _remarks text, _newsletter_opt_in boolean, _sms_opt_in boolean, _requested_table_id text, _placement_status text, _purchase_source text, _fee_absorbed boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max integer;
  v_zone_name text;
  v_used integer;
  v_reservation_id uuid;
  v_requested text := NULLIF(_requested_table_id, '');
  -- Formule : plafond propre + périmètre.
  v_pack_limit boolean;
  v_pack_max integer;
  v_pack_name text;
  v_pack_event uuid;
  v_pack_venue text;
  v_pack_used integer;
  -- Table liée à une formule sur le plan.
  v_club text;
  v_layout jsonb;
  v_table jsonb;
  v_bound_pack uuid;
  v_bound_name text;
BEGIN
  IF _capacity_zone_id IS NOT NULL THEN
    SELECT tables_count, name INTO v_max, v_zone_name
    FROM public.table_zones
    WHERE id = _capacity_zone_id
    FOR UPDATE;

    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
      WHERE event_id = _event_id
        AND zone_id = _capacity_zone_id
        AND public._table_resa_holds(status, created_at);

      IF v_used >= v_max THEN
        RAISE EXCEPTION
          'La zone "%" est complète (%/% tables réservées). Choisis une autre zone ou réessaie plus tard.',
          v_zone_name, v_used, v_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Plafond de la formule (verrou sur la ligne du pack : deux checkouts
  -- concurrents sur la dernière table de la formule se sérialisent ici).
  IF _pack_id IS NOT NULL THEN
    SELECT limit_tables, tables_count, name, event_id, venue_id
      INTO v_pack_limit, v_pack_max, v_pack_name, v_pack_event, v_pack_venue
      FROM public.table_packs
     WHERE id = _pack_id
     FOR UPDATE;

    IF COALESCE(v_pack_limit, false) AND COALESCE(v_pack_max, 0) > 0 THEN
      SELECT COUNT(*) INTO v_pack_used
        FROM public.table_reservations
       WHERE event_id = _event_id
         AND pack_id = _pack_id
         AND public._table_resa_holds(status, created_at);

      IF v_pack_used >= v_pack_max THEN
        RAISE EXCEPTION
          'La formule "%" est complète (%/% tables réservées). Choisis une autre formule.',
          v_pack_name, v_pack_used, v_pack_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF v_requested IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_event_id::text || ':' || v_requested, 0));
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
      WHERE r.event_id = _event_id
        AND public._table_resa_holds(r.status, r.created_at)
        AND (
          (r.requested_table_id::text = v_requested
            AND r.placement_status IN ('requested', 'approved'))
          OR r.assigned_table_id::text = v_requested
        )
    ) THEN
      RAISE EXCEPTION
        'Cette table vient d''être réservée par quelqu''un d''autre. Choisis une autre table sur le plan.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Table liée à une formule : plan de la soirée d'abord, sinon celui du club.
    SELECT COALESCE(venue_id, partner_venue_id) INTO v_club FROM public.events WHERE id = _event_id;
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = _event_id;
    IF v_layout IS NULL AND v_club IS NOT NULL THEN
      SELECT layout INTO v_layout FROM public.venue_floor_plans
       WHERE venue_id = v_club AND event_id IS NULL;
    END IF;
    IF v_layout IS NOT NULL THEN
      SELECT t INTO v_table
        FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
       WHERE t->>'id' = v_requested
       LIMIT 1;
      IF v_table IS NOT NULL AND NULLIF(v_table->>'packId', '') IS NOT NULL
         AND (v_table->>'packId')::uuid <> _pack_id THEN
        -- N'applique la liaison que si la formule liée vit dans le MÊME
        -- périmètre que celle du checkout.
        SELECT p.id, p.name INTO v_bound_pack, v_bound_name
          FROM public.table_packs p
         WHERE p.id = (v_table->>'packId')::uuid
           AND p.event_id IS NOT DISTINCT FROM v_pack_event
           AND p.venue_id IS NOT DISTINCT FROM v_pack_venue;
        IF v_bound_pack IS NOT NULL THEN
          RAISE EXCEPTION
            'Cette table se réserve avec la formule "%". Choisis cette formule ou une autre table.',
            v_bound_name
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, pack_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed, status, paid_at, qr_code,
    full_name, phone, remarks, newsletter_opt_in, sms_opt_in,
    requested_table_id, placement_status, purchase_source
  ) VALUES (
    _event_id, _pack_id, _zone_id, _user_id, _user_email, _is_guest, _guest_count,
    _deposit, _total_price, 0, _management_fee, _fee_absorbed, _status,
    CASE WHEN _status = 'paid' THEN now() ELSE NULL END, _qr_code,
    _full_name, _phone, _remarks, _newsletter_opt_in, _sms_opt_in,
    NULLIF(_requested_table_id, '')::uuid, COALESCE(NULLIF(_placement_status, ''), 'none'), _purchase_source
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_table_availability(p_event_id uuid)
 RETURNS TABLE(requested_table_id text, assigned_table_id text, placement_status text, guest_count integer, zone_id uuid, status text, pack_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    tr.requested_table_id::text,
    tr.assigned_table_id::text,
    tr.placement_status,
    tr.guest_count,
    tr.zone_id,
    tr.status,
    tr.pack_id
  FROM public.table_reservations tr
  WHERE tr.event_id = p_event_id
    AND public._table_resa_holds(tr.status, tr.created_at);
$function$;

-- reserve_table_slot : service_role seul (inchangé) ; availability : visiteur compris (le plan public la lit).
REVOKE ALL ON FUNCTION public.reserve_table_slot(uuid, uuid, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, numeric, text, text, text, text, text, boolean, boolean, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_table_slot(uuid, uuid, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, numeric, text, text, text, text, text, boolean, boolean, text, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.get_event_table_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_table_availability(uuid) TO anon, authenticated, service_role;
