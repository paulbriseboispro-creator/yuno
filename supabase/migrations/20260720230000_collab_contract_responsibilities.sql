-- =============================================================================
-- Soirée UNIQUE : le contrat de collaboration porte lui aussi la répartition
-- des responsabilités.
--
-- 20260720220000 a posé l'axe sur les soirées, les séries et les deux tables de
-- contrat. Il manquait la voie d'entrée du PONCTUEL : create_event_collab_contract
-- ne connaissait pas le paramètre, donc une proposition de soirée unique ne
-- pouvait pas dire qui tient le design et qui tient l'opérationnel — seule une
-- résidence le pouvait. Deux surfaces, deux vocabulaires : exactement ce qu'on
-- vient de supprimer.
--
-- Le paramètre est optionnel : un contrat sans répartition explicite reste
-- exactement le contrat d'avant (préréglage du mode).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_event_collab_contract(
  p_event_id           uuid,
  p_split_rules        jsonb DEFAULT NULL,
  p_cancellation_policy text DEFAULT 'pro_rata_refund',
  p_responsibilities   jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_partnership uuid;
  v_id         uuid;
  v_org_alcohol boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cancellation_policy NOT IN ('pro_rata_refund','no_refund_after_event') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cet évènement n''est pas une collaboration club ↔ organisateur';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c
              WHERE c.event_id = p_event_id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'Un contrat existe déjà pour cette soirée';
  END IF;

  SELECT id, default_split_rules INTO v_partnership, v_rules
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));

  -- Boissons : 100% club par défaut. Honorées telles que proposées UNIQUEMENT si
  -- l'orga a attesté ses documents légaux de vente d'alcool. Sinon → 100% club forcé.
  SELECT COALESCE(can_sell_alcohol, false) INTO v_org_alcohol
  FROM public.organizer_profiles WHERE user_id = v_org_id;

  IF NOT COALESCE(v_org_alcohol, false) OR NOT (v_rules ? 'drinks') THEN
    v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
  END IF;

  INSERT INTO public.event_collab_contracts (
    event_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy, auto_release_at, responsibilities,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_event_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy,
    (SELECT COALESCE(end_at, start_at) + interval '2 days' FROM public.events WHERE id = p_event_id),
    p_responsibilities,
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  UPDATE public.events
     SET revenue_split_proposal = v_rules,
         split_proposed_by = auth.uid(),
         split_proposed_at = now(),
         split_approved_by_venue = v_is_venue,
         split_approved_by_organizer = v_is_org,
         -- COALESCE : une proposition sans répartition ne doit pas EFFACER celle
         -- que la soirée porte déjà (cas d'une occurrence née d'une résidence).
         collab_responsibilities = COALESCE(p_responsibilities, collab_responsibilities)
   WHERE id = p_event_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_event_collab_contract(uuid, jsonb, text, jsonb) TO authenticated;

-- Le contrat reste la source de vérité : si sa répartition change (renégociation,
-- correction admin), la soirée suit. Sans ça, events.collab_responsibilities
-- pourrait diverger de ce que les deux parties ont signé — et c'est events qui
-- gate les droits d'écriture.
CREATE OR REPLACE FUNCTION public.trg_sync_contract_responsibilities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.responsibilities IS DISTINCT FROM OLD.responsibilities
     AND NEW.responsibilities IS NOT NULL THEN
    UPDATE public.events SET collab_responsibilities = NEW.responsibilities
     WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_collab_contract_sync_responsibilities ON public.event_collab_contracts;
CREATE TRIGGER trg_collab_contract_sync_responsibilities
  AFTER UPDATE OF responsibilities ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_contract_responsibilities();
