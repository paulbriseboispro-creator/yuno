-- =============================================================================
-- Part boissons négociable en collab + attestation alcool de l'organisateur.
--
-- AVANT : les boissons d'un co-event allaient TOUJOURS 100% club (le club détient
-- la licence alcool). Invariant dur, forcé front + back.
--
-- DÉSORMAIS (plus flexible) : l'organisateur peut attester qu'il possède les
-- documents légaux pour la vente d'alcool (organizer_profiles.can_sell_alcohol).
-- S'il a attesté, il peut négocier une part des revenus boissons ; sinon les
-- boissons restent 100% club (comportement inchangé par défaut).
--
-- La RPC de création de contrat est le point de contrôle AUTORITAIRE : elle force
-- les boissons à 100% club tant que l'orga n'a pas attesté, même si l'UI est
-- contournée. events.revenue_split_rules (qui pilote le partage Stripe) n'est
-- alimenté que par un contrat signé passé par cette RPC → les règles stockées
-- sont fiables, donc payment-split.ts peut honorer la part boissons stockée.
-- =============================================================================

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS can_sell_alcohol boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_sell_alcohol_confirmed_at timestamptz;

COMMENT ON COLUMN public.organizer_profiles.can_sell_alcohol IS
  'L''organisateur atteste posséder les documents légaux de vente d''alcool. Débloque la négociation d''une part des revenus boissons en collaboration.';

-- RPC création du contrat (club OU orga propose le %) — boissons gardées 100% club
-- SAUF si l'orga a attesté ses documents alcool, auquel cas la part boissons proposée
-- est honorée. (Reste de la fonction identique à 20260622220000.)
CREATE OR REPLACE FUNCTION public.create_event_collab_contract(
  p_event_id           uuid,
  p_split_rules        jsonb DEFAULT NULL,
  p_cancellation_policy text DEFAULT 'pro_rata_refund'
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

  -- Règles : payload OU défaut du partenariat OU 50/50 tickets, 0/100 tables, 0/100 drinks.
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
    status, split_rules, cancellation_policy, auto_release_at,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_event_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy,
    (SELECT COALESCE(end_at, start_at) + interval '2 days' FROM public.events WHERE id = p_event_id),
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  UPDATE public.events
     SET revenue_split_proposal = v_rules,
         split_proposed_by = auth.uid(),
         split_proposed_at = now(),
         split_approved_by_venue = v_is_venue,
         split_approved_by_organizer = v_is_org
   WHERE id = p_event_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_event_collab_contract(uuid, jsonb, text) TO authenticated;
