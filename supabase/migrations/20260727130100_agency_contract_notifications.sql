-- ============================================================================
-- La cloche couvre enfin le bras Yuno : un club qui signe ton contrat, un
-- contrat qui change d'état — ça arrive dans l'inbox de l'agence
-- (affiliate_app_notifications, flux admin), comme le reste.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_agency_contract_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id uuid;
  v_scope text;
BEGIN
  SELECT id INTO v_affiliate_id FROM affiliates WHERE agency_id = NEW.agency_id;
  IF v_affiliate_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(v.name, 'Organisateur') INTO v_scope
  FROM (SELECT NEW.venue_id) t
  LEFT JOIN venues v ON v.id = NEW.venue_id;

  -- Le club vient de signer.
  IF NEW.club_signed_at IS NOT NULL AND OLD.club_signed_at IS NULL THEN
    PERFORM emit_affiliate_app_notification(
      v_affiliate_id, NULL,
      'aff_contract_signed',
      'Contrat signé',
      v_scope || ' a signé votre contrat — vos promoteurs peuvent vendre.',
      'high', 'agency_contract', NEW.id, '{}'
    );
  -- Changement d'état notable (pause, fin, annulation).
  ELSIF NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('paused', 'ended', 'cancelled') THEN
    PERFORM emit_affiliate_app_notification(
      v_affiliate_id, NULL,
      'aff_contract_status',
      'Contrat ' || CASE NEW.status
        WHEN 'paused' THEN 'en pause' WHEN 'ended' THEN 'terminé' ELSE 'annulé' END,
      v_scope || ' — le contrat est passé à « ' || NEW.status || ' ».',
      'normal', 'agency_contract', NEW.id, '{}'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_contract_notify ON public.agency_venue_contracts;
CREATE TRIGGER trg_agency_contract_notify
  AFTER UPDATE ON public.agency_venue_contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_agency_contract_events();
