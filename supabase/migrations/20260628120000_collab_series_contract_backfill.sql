-- =============================================================================
-- Backfill : proposer le CONTRAT-CADRE récurrent aux résidences DÉJÀ existantes.
--
-- La création du cadre se fait à l'enregistrement d'un template (RecurringEventsManager).
-- Les co-soirées récurrentes créées AVANT cette fonctionnalité n'ont donc pas de cadre :
-- l'orga continuerait de signer chaque occurrence. On comble le trou en créant, pour
-- chaque template co-event actif sans cadre vivant, un contrat-cadre en
-- 'pending_signatures' PRÉ-SIGNÉ PAR LE CLUB.
--
-- IMPORTANT — légalement sûr : on crée seulement une PROPOSITION (pending), jamais un
-- contrat actif. L'organisateur reste libre de signer (→ auto-accept de la série) ou de
-- refuser (→ il garde la signature par-occurrence). Aucune partie n'est liée sans signature.
-- Le trigger notify_collab_series_created prévient l'orga (« signe une fois pour toute la série »).
-- Idempotent : ON CONFLICT (template_id) + garde NOT EXISTS sur un cadre non clos.
-- =============================================================================
DO $$
DECLARE
  r        public.owner_recurring_templates%ROWTYPE;
  v_owner  uuid;
  v_part   uuid;
  v_rules  jsonb;
  v_alcohol boolean;
BEGIN
  FOR r IN
    SELECT t.* FROM public.owner_recurring_templates t
    WHERE t.is_active = true
      AND t.partner_organizer_id IS NOT NULL
      AND t.venue_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.event_collab_series_contracts s
        WHERE s.template_id = t.id AND s.status NOT IN ('cancelled','terminated')
      )
  LOOP
    SELECT owner_id INTO v_owner FROM public.venues WHERE id = r.venue_id;
    IF v_owner IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_part FROM public.venue_organizer_partnerships
      WHERE venue_id = r.venue_id AND organizer_user_id = r.partner_organizer_id
        AND status = 'active' LIMIT 1;

    v_rules := COALESCE(r.revenue_split_rules, jsonb_build_object(
      'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
      'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
      'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)));

    -- Boissons 100% club sauf attestation alcool de l'orga (cf. 20260623230000).
    SELECT COALESCE(can_sell_alcohol, false) INTO v_alcohol
    FROM public.organizer_profiles WHERE user_id = r.partner_organizer_id;
    IF NOT COALESCE(v_alcohol, false) OR NOT (v_rules ? 'drinks') THEN
      v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));
    END IF;

    INSERT INTO public.event_collab_series_contracts (
      template_id, partnership_id, venue_id, organizer_user_id, created_by,
      status, split_rules, cancellation_policy, venue_signed_at, venue_signed_by
    ) VALUES (
      r.id, v_part, r.venue_id, r.partner_organizer_id, v_owner,
      'pending_signatures', v_rules, 'pro_rata_refund', now(), v_owner
    ) ON CONFLICT (template_id) DO NOTHING;
  END LOOP;
END $$;
