-- ============================================================================
-- Guest list promoteur pilotée par le MODÈLE de commission.
--
-- Avant : pour donner une guest list à un promoteur, l'owner devait toucher
-- trois écrans déconnectés — l'accès (can_access_guestlist sur l'assignation),
-- le quota (une "part" guest_lists créée à la main sur la page Guest List), et
-- le € par tête (sur le modèle de commission). Rien ne les reliait.
--
-- Maintenant : le modèle de commission porte une allocation guest list
-- (rules.guestlist_allocation = { spots, free_before }). Dès qu'un promoteur
-- portant ce modèle est relié à une soirée (assignation créée — auto ou
-- manuelle), sa part guest list est matérialisée automatiquement avec ce quota,
-- et son accès (can_access_guestlist) est ouvert. La page Guest List reste
-- disponible pour ajuster une soirée précise à la main.
--
-- Le € par tête (rules.guestlist.value) est inchangé : c'est la rémunération,
-- lue au scan par record_promoter_conversion. Ici on ne touche QUE l'allocation.
-- ============================================================================

-- ── Coeur : matérialiser la part guest list d'un (promoteur, soirée) ─────────
-- Idempotent : ON CONFLICT DO NOTHING sur l'index partiel (event_id, promoter_id)
-- WHERE holder_type='promoter'. Ne réécrit JAMAIS une part existante (l'owner a
-- pu l'ajuster à la main sur la page Guest List). Pas d'allocation au modèle ⇒
-- rien (le promoteur reste sans guest list, comme avant).
CREATE OR REPLACE FUNCTION public.create_promoter_guestlist_part(
  p_promoter_id uuid,
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_spots int;
  v_free_before time;
  v_label text;
  v_venue_id text;
  v_org_id uuid;
BEGIN
  -- Modèle de commission par défaut du promoteur + son nom d'affichage.
  SELECT ct.rules,
         COALESCE(NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.promo_code)
    INTO v_rules, v_label
  FROM public.promoters p
  LEFT JOIN public.commission_templates ct ON ct.id = p.default_commission_template_id
  WHERE p.id = p_promoter_id
    AND p.is_active;

  IF v_rules IS NULL THEN
    RETURN; -- pas de modèle ⇒ pas d'allocation pilotée
  END IF;

  v_spots := NULLIF(v_rules -> 'guestlist_allocation' ->> 'spots', '')::int;
  IF v_spots IS NULL OR v_spots <= 0 THEN
    RETURN; -- le modèle ne porte pas d'allocation guest list
  END IF;

  v_free_before := COALESCE(NULLIF(v_rules -> 'guestlist_allocation' ->> 'free_before', ''), '02:00')::time;

  -- Hôte de la soirée (le club, ou l'organisateur pour une soirée org).
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.events WHERE id = p_event_id;

  INSERT INTO public.guest_lists
    (event_id, venue_id, organizer_user_id, holder_type, promoter_id, holder_label,
     quota, free_before_time, includes_drink, visible_on_club_page, is_active)
  VALUES
    (p_event_id, v_venue_id, v_org_id, 'promoter', p_promoter_id, v_label,
     v_spots, v_free_before, false, false, true)
  ON CONFLICT (event_id, promoter_id) WHERE holder_type = 'promoter' DO NOTHING;

  -- Une allocation sans accès ne sert à rien : ouvre le tab guest list du
  -- promoteur pour cette soirée (l'accès et le quota disent la même chose).
  UPDATE public.promoter_event_assignments
     SET can_access_guestlist = true
   WHERE promoter_id = p_promoter_id
     AND event_id = p_event_id
     AND can_access_guestlist IS DISTINCT FROM true;
END;
$$;

-- ── Trigger : toute nouvelle assignation matérialise la part ─────────────────
-- Couvre TOUS les chemins d'assignation : auto-assignation (trigger events),
-- backfill owner, et assignation manuelle à l'unité (page événement promoteur).
CREATE OR REPLACE FUNCTION public.on_assignment_materialize_guestlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- La matérialisation de la guest list ne doit JAMAIS bloquer l'assignation
  -- elle-même (le rattachement prime). En cas de pépin, la part sera recréée au
  -- prochain enregistrement owner via sync_promoter_guestlist_parts.
  BEGIN
    PERFORM public.create_promoter_guestlist_part(NEW.promoter_id, NEW.event_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_materialize_guestlist ON public.promoter_event_assignments;
CREATE TRIGGER trg_assignment_materialize_guestlist
  AFTER INSERT ON public.promoter_event_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.on_assignment_materialize_guestlist();

-- ── Backfill : synchroniser un promoteur sur ses soirées à venir déjà reliées ─
-- Appelée côté owner à l'enregistrement d'un promoteur / d'un modèle : les
-- assignations DÉJÀ existantes n'ont pas déclenché le trigger, on les rattrape.
-- Ne touche que les soirées à venir (end_at >= now) et les assignations actives.
CREATE OR REPLACE FUNCTION public.sync_promoter_guestlist_parts(p_promoter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  -- Autorisation : le promoteur est soit club-scoped (l'appelant gère le club),
  -- soit organizer-scoped (l'appelant gère l'organisateur). Même périmètre que la
  -- policy d'écriture de promoter_event_assignments.
  IF NOT EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = p_promoter_id
      AND (
        (p.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p.venue_id))
        OR (p.organizer_user_id IS NOT NULL AND public.can_manage_organizer(p.organizer_user_id))
      )
  ) THEN
    RAISE EXCEPTION 'not authorized to sync this promoter';
  END IF;

  FOR r IN
    SELECT pea.event_id
    FROM public.promoter_event_assignments pea
    JOIN public.events e ON e.id = pea.event_id
    WHERE pea.promoter_id = p_promoter_id
      AND pea.status = 'active'
      AND e.end_at >= now()
  LOOP
    PERFORM public.create_promoter_guestlist_part(p_promoter_id, r.event_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_promoter_guestlist_parts(uuid) TO authenticated;
