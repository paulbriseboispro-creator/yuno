-- ============================================================================
-- Correctifs sur les statistiques personnelles du staff
-- ============================================================================
-- Trois défauts de la première version (20260718100000) :
--
--   1. « Cette nuit » était calculé en UTC. `date_trunc('day', now() - 6h)` sur
--      un timestamptz utilise le fuseau de la session, soit UTC sur Supabase :
--      la coupure tombait à 8h heure de Paris en été, pas à 6h. Un dépôt
--      vestiaire enregistré à 7h30 lors du démontage comptait pour la nuit
--      PRÉCÉDENTE.
--   2. `nights_worked` oubliait `public.tickets` alors que `scans_total` le
--      compte : un videur d'un club en billetterie non nominative pouvait
--      afficher « 900 scans » et « 0 nuit travaillée » sur la même carte.
--   3. `orders_total` ne regardait que `served_by`, jamais renseigné sur les
--      chemins Click&Collect avant ce chantier. Le COALESCE aligne la RPC sur
--      ce que fait déjà le centre de commandement live (useLiveNightData).
--
-- Convention maison pour le fuseau : `<timestamptz> AT TIME ZONE 'Europe/Paris'`
-- en ligne (cf. 20260612000001_promoter_guestlist_commission.sql).
-- ============================================================================


-- Rattrapage du backfill de 20260718100000 : `staff-cancel` réutilise
-- `served_at` comme marqueur de clôture sur les remboursements, donc des
-- commandes remboursées se sont vu attribuer un barman « qui a servi ».
UPDATE public.orders
   SET served_by = NULL
 WHERE served_by IS NOT NULL
   AND status = 'refunded';


CREATE OR REPLACE FUNCTION public.get_staff_self_stats(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_since timestamptz;
  v_today timestamptz;
  v_venue text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Fenêtre bornée : évite qu'un p_days absurde scanne tout l'historique.
  v_since := now() - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 365) || ' days')::interval;

  -- « Cette nuit » démarre à 6h du matin, HEURE DE PARIS : une soirée club
  -- déborde sur le lendemain. On passe en heure locale, on tronque, puis on
  -- revient en timestamptz pour comparer aux colonnes stockées.
  v_today := (
    date_trunc('day', (now() AT TIME ZONE 'Europe/Paris') - interval '6 hours')
    + interval '6 hours'
  ) AT TIME ZONE 'Europe/Paris';

  SELECT venue_id INTO v_venue FROM public.profiles WHERE id = v_uid;

  SELECT jsonb_build_object(
    'venue_id', v_venue,
    'since',    v_since,

    -- Scans porte (billets nominatifs + billets legacy + tables + guest list)
    'scans_total', (
      (SELECT count(*) FROM public.ticket_attendees
        WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.tickets
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.table_reservations
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.guest_list_entries
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
    ),
    'scans_tonight', (
      (SELECT count(*) FROM public.ticket_attendees
        WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
      + (SELECT count(*) FROM public.tickets
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
      + (SELECT count(*) FROM public.table_reservations
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
      + (SELECT count(*) FROM public.guest_list_entries
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
    ),

    -- Bar. `prep_claimed_by` en repli : les commandes servies avant l'arrivée
    -- de `served_by` n'ont que celui-là. Les remboursements sont exclus —
    -- `staff-cancel` y pose un `served_at` qui ne vaut pas un service.
    'orders_total', (
      SELECT count(*) FROM public.orders
       WHERE COALESCE(served_by, prep_claimed_by) = v_uid
         AND served_at >= v_since
         AND status <> 'refunded'
    ),
    'orders_tonight', (
      SELECT count(*) FROM public.orders
       WHERE COALESCE(served_by, prep_claimed_by) = v_uid
         AND served_at >= v_today
         AND status <> 'refunded'
    ),

    -- Vestiaire (dépôts enregistrés)
    'cloakroom_total', (
      SELECT count(*) FROM public.cloakroom_transactions
       WHERE staff_id = v_uid AND created_at >= v_since
    ),
    'cloakroom_tonight', (
      SELECT count(*) FROM public.cloakroom_transactions
       WHERE staff_id = v_uid AND created_at >= v_today
    ),

    -- VIP (consommations servies + upsell généré)
    'vip_items_total', (
      SELECT COALESCE(count(*), 0) FROM public.vip_consumptions
       WHERE COALESCE(served_by, staff_id) = v_uid AND created_at >= v_since
    ),
    'vip_items_tonight', (
      SELECT COALESCE(count(*), 0) FROM public.vip_consumptions
       WHERE COALESCE(served_by, staff_id) = v_uid AND created_at >= v_today
    ),
    'vip_upsell_total', (
      SELECT COALESCE(sum(upsell_amount), 0) FROM public.vip_upsell_stats
       WHERE staff_id = v_uid AND created_at >= v_since
    ),

    -- Nuits travaillées : jours distincts avec au moins une action. Les six
    -- branches DOIVENT utiliser la même expression de bucket, sinon une même
    -- nuit est comptée deux fois.
    'nights_worked', (
      SELECT count(DISTINCT d) FROM (
        SELECT date_trunc('day', (entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours') AS d
          FROM public.ticket_attendees
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', (entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
          FROM public.tickets
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', (entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
          FROM public.table_reservations
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', (entry_scanned_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
          FROM public.guest_list_entries
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', (served_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
          FROM public.orders
         WHERE COALESCE(served_by, prep_claimed_by) = v_uid
           AND served_at >= v_since
           AND status <> 'refunded'
        UNION
        SELECT date_trunc('day', (created_at AT TIME ZONE 'Europe/Paris') - interval '6 hours')
          FROM public.cloakroom_transactions
         WHERE staff_id = v_uid AND created_at >= v_since
      ) nights
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_self_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_self_stats(integer) TO authenticated;
