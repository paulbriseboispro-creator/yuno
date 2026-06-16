-- ============================================================================
-- COURT TERME — Suppression sûre des zones / packs VIP
--
-- Aujourd'hui supprimer une zone ou un pack via le dashboard owner part d'un
-- simple confirm() navigateur, et selon la FK la suppression peut emporter (ou
-- orpheliner) des réservations VIP déjà payées pour une soirée à venir. Le soir
-- de l'event, c'est une perte de données silencieuse.
--
-- Ces triggers BEFORE DELETE bloquent la suppression d'une zone/pack tant qu'il
-- existe une réservation "live" dessus : statut payant (paid/pending/confirmed),
-- non remboursée/annulée, ET dont la soirée n'est pas terminée (end_at >= now()).
-- Les zones/packs d'événements passés restent supprimables (nettoyage).
--
-- Pure SQL, déployable via `supabase db push`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_zone_delete_with_live_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.zone_id = OLD.id
      AND tr.status IN ('paid', 'pending', 'confirmed')
      AND e.end_at >= now()
  ) THEN
    RAISE EXCEPTION
      'Cannot delete this zone: it has live VIP reservations for an upcoming event. Refund or move them first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_zone_delete_with_live_reservations ON public.table_zones;
CREATE TRIGGER trg_prevent_zone_delete_with_live_reservations
  BEFORE DELETE ON public.table_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_zone_delete_with_live_reservations();

CREATE OR REPLACE FUNCTION public.prevent_pack_delete_with_live_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.pack_id = OLD.id
      AND tr.status IN ('paid', 'pending', 'confirmed')
      AND e.end_at >= now()
  ) THEN
    RAISE EXCEPTION
      'Cannot delete this package: it has live VIP reservations for an upcoming event. Refund or move them first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_pack_delete_with_live_reservations ON public.table_packs;
CREATE TRIGGER trg_prevent_pack_delete_with_live_reservations
  BEFORE DELETE ON public.table_packs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_pack_delete_with_live_reservations();
