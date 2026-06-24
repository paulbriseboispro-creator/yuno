-- =============================================================================
-- Modifier un contrat de co-soirée AVANT verrouillage → repart en double signature.
--
-- Demande de Paul : sur l'écran d'acceptation d'un contrat, pouvoir MODIFIER la
-- répartition. Modifier = renvoyer une nouvelle vérification à l'autre partie :
-- le contrat retombe en `pending_signatures`, la partie qui modifie a signé sa
-- version, l'AUTRE doit re-signer, et les ventes se re-bloquent (revenue_split_rules
-- vidé → CONTRACT GUARD) jusqu'à la double signature.
--
-- Autorisé tant que le contrat n'est pas verrouillé par une vente (status locked/
-- closed) ni annulé. Boissons : même garde-fou que create — 100% club sauf si
-- l'orga a attesté sa licence alcool.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.amend_event_collab_contract(
  p_contract_id         uuid,
  p_split_rules         jsonb,
  p_cancellation_policy text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c             public.event_collab_contracts%ROWTYPE;
  v_is_venue    boolean;
  v_is_org      boolean;
  v_rules       jsonb;
  v_org_alcohol boolean;
  v_title       text;
  v_actor       text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_split_rules IS NULL THEN RAISE EXCEPTION 'Split rules required'; END IF;
  IF p_cancellation_policy IS NOT NULL
     AND p_cancellation_policy NOT IN ('pro_rata_refund','no_refund_after_event') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), c.venue_id);
  v_is_org   := (c.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- Une vente a verrouillé la répartition → plus de modification possible.
  IF c.status IN ('locked','closed') THEN
    RAISE EXCEPTION 'COLLAB_CONTRACT_LOCKED: une vente a déjà figé la répartition de cette soirée';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'COLLAB_CONTRACT_CANCELLED: ce contrat est annulé';
  END IF;

  v_rules := p_split_rules;
  -- Boissons : 100% club sauf si l'orga a attesté ses documents de vente d'alcool.
  SELECT COALESCE(can_sell_alcohol, false) INTO v_org_alcohol
  FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
  IF NOT COALESCE(v_org_alcohol, false) OR NOT (v_rules ? 'drinks') THEN
    v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
  END IF;

  -- Repartir en attente de signature : celui qui modifie a signé sa version,
  -- l'autre partie doit re-signer. terms_snapshot dégelé.
  UPDATE public.event_collab_contracts SET
       split_rules         = v_rules,
       cancellation_policy = COALESCE(p_cancellation_policy, cancellation_policy),
       status              = 'pending_signatures',
       terms_snapshot      = NULL,
       venue_signed_at = CASE WHEN v_is_venue THEN now()      ELSE NULL END,
       venue_signed_by = CASE WHEN v_is_venue THEN auth.uid() ELSE NULL END,
       venue_signed_ip = NULL,
       org_signed_at   = CASE WHEN v_is_org   THEN now()      ELSE NULL END,
       org_signed_by   = CASE WHEN v_is_org   THEN auth.uid() ELSE NULL END,
       org_signed_ip   = NULL
   WHERE id = p_contract_id;

  -- Re-bloque les ventes (CONTRACT GUARD) et pilote l'approbation côté events.*
  UPDATE public.events
     SET revenue_split_proposal      = v_rules,
         revenue_split_rules         = NULL,
         split_proposed_by           = auth.uid(),
         split_proposed_at           = now(),
         split_approved_by_venue     = v_is_venue,
         split_approved_by_organizer = v_is_org
   WHERE id = c.event_id;

  -- Notifier la partie qui doit re-signer.
  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  v_title := COALESCE(v_title, 'une soirée');
  IF v_is_venue THEN
    SELECT name INTO v_actor FROM public.venues WHERE id = c.venue_id;
    PERFORM public.notify_collab_party('organizer', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Contrat de co-soirée modifié',
      COALESCE(v_actor, 'Le club') || ' a modifié la répartition de « ' || v_title || ' ». Re-signe pour ouvrir les ventes.',
      'high', 'event_collab_contract', c.id,
      jsonb_build_object('venue_id', c.venue_id, 'event_id', c.event_id, 'amended', true));
  ELSE
    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
    PERFORM public.notify_collab_party('venue', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Contrat de co-soirée modifié',
      COALESCE(v_actor, 'L''organisateur') || ' a modifié la répartition de « ' || v_title || ' ». Re-signe pour ouvrir les ventes.',
      'high', 'event_collab_contract', c.id,
      jsonb_build_object('organizer_user_id', c.organizer_user_id, 'event_id', c.event_id, 'amended', true));
  END IF;

  RETURN c.id;
END; $$;

GRANT EXECUTE ON FUNCTION public.amend_event_collab_contract(uuid, jsonb, text) TO authenticated;
