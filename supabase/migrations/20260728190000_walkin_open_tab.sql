-- ============================================================================
-- Walk-in « addition ouverte » (open tab) — placé à l'entrée, payé à la fin
-- ============================================================================
-- L'hôte VIP veut créer un walk-in et le placer sur le plan DÈS L'ENTRÉE, avant
-- toute commande. Or le CA VIP (get_vip_table_analytics) = total_price − frais,
-- PAS les consos. Un walk-in créé à 0 € afficherait donc 0 € de CA même après
-- avoir consommé plusieurs bouteilles.
--
-- Solution : un walk-in placé à l'entrée est une ADDITION OUVERTE
-- (purchase_source='manual_open', total_price démarre à 0). Un trigger tient
-- `total_price = somme des vip_consumptions` tant que l'addition est ouverte :
-- le CA suit automatiquement ce qui est servi, sans geste de règlement séparé.
-- Le « Paiement validé » du point de vente reste une confirmation OPÉRATIONNELLE
-- (réglé au club), la recette, elle, coule des consos.
--
-- Les autres créations à la main restent 'manual' à montant fixe :
--   • owner (réservation par téléphone, montant convenu),
--   • walk-in one-shot du point de vente (total = panier).
-- Le trigger ne touche QUE 'manual_open', jamais un montant fixe ni une résa
-- prépayée normale.
-- ============================================================================

-- ── 1. create_manual_table_reservation gagne p_open_tab ──────────────────────
-- DROP puis CREATE (signature élargie) pour ne pas laisser deux surcharges.
DROP FUNCTION IF EXISTS public.create_manual_table_reservation(
  uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text
);

CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(
  p_event_id uuid,
  p_zone_id uuid,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_guest_count integer DEFAULT 1,
  p_total_price numeric DEFAULT 0,
  p_minimum_spend numeric DEFAULT 0,
  p_assigned_table_id uuid DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_open_tab boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_venue      text;
  v_max        integer;
  v_zone_name  text;
  v_used       integer;
  v_id         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT venue_id, tables_count, name
    INTO v_venue, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

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
    OR (public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
     WHERE event_id = p_event_id
       AND zone_id = p_zone_id
       AND status IN ('pending', 'paid', 'confirmed');
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'La zone "%" est complète (%/% tables).', v_zone_name, v_used, v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_assigned_table_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_assigned_table_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
       WHERE r.event_id = p_event_id
         AND r.status IN ('pending', 'paid', 'confirmed')
         AND (
           r.assigned_table_id = p_assigned_table_id
           OR (r.requested_table_id = p_assigned_table_id AND r.placement_status IN ('requested', 'approved'))
         )
    ) THEN
      RAISE EXCEPTION 'Cette table est déjà prise.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed,
    minimum_spend, status, paid_at, full_name, phone, remarks,
    assigned_table_id, placed_by, placed_at, placement_status, vip_status,
    purchase_source
  ) VALUES (
    p_event_id, p_zone_id, NULL, COALESCE(NULLIF(btrim(p_email), ''), ''), true, GREATEST(COALESCE(p_guest_count, 1), 1),
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
    CASE WHEN p_open_tab THEN 'manual_open' ELSE 'manual' END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean) TO authenticated;

-- ── 2. Le CA d'une addition ouverte suit ses consommations ───────────────────
-- Pour une résa 'manual_open', total_price = somme des vip_consumptions. Le
-- trigger tourne SECURITY DEFINER (il écrit total_price, hors allow-list hôte) ;
-- il ne concerne QUE 'manual_open' — une résa prépayée ou 'manual' à montant
-- fixe n'est jamais réécrite. Écrit uniquement si la valeur change (évite les
-- updates inutiles). Les triggers de commission ne réagissent qu'à UPDATE OF
-- status, jamais à total_price.
CREATE OR REPLACE FUNCTION public.sync_open_tab_reservation_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_res uuid := COALESCE(NEW.table_reservation_id, OLD.table_reservation_id);
BEGIN
  IF v_res IS NOT NULL THEN
    UPDATE public.table_reservations tr
       SET total_price = COALESCE(
             (SELECT sum(c.total_price) FROM public.vip_consumptions c
               WHERE c.table_reservation_id = v_res), 0)
     WHERE tr.id = v_res
       AND tr.purchase_source = 'manual_open'
       AND tr.total_price IS DISTINCT FROM COALESCE(
             (SELECT sum(c.total_price) FROM public.vip_consumptions c
               WHERE c.table_reservation_id = v_res), 0);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_open_tab_total ON public.vip_consumptions;
CREATE TRIGGER trg_sync_open_tab_total
AFTER INSERT OR UPDATE OR DELETE ON public.vip_consumptions
FOR EACH ROW EXECUTE FUNCTION public.sync_open_tab_reservation_total();
