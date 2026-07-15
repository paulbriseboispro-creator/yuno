-- ============================================================================
-- Audit (2026-07-15) — record_promoter_conversion : check d'appelant.
--
-- La fonction est SECURITY DEFINER, écrit de l'argent (promoter_conversions +
-- promoters.pending_amount) et est GRANT à `authenticated` SANS aucun contrôle
-- d'appelant. N'importe quel utilisateur connecté pouvait donc appeler la RPC
-- avec un p_promoter_id arbitraire et se fabriquer/gonfler des commissions.
--
-- FIX : garde d'autorisation en tête. Appelants légitimes :
--   • service_role / contexte sans JWT (les edge functions de paiement
--     verify-ticket-payment / verify-table-payment) → auth.uid() est NULL ;
--   • le promoteur lui-même (son propre onglet de scan) ;
--   • un owner / manager / staff / organisateur de l'event de la conversion
--     (scan à la porte via l'app orga ou l'app staff).
--
-- Corps de la fonction reproduit À L'IDENTIQUE depuis 20260612000003 (signature
-- 9 args inchangée) ; seule la garde est ajoutée juste après BEGIN.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_promoter_conversion(
  p_promoter_id UUID,
  p_conversion_type TEXT,
  p_amount NUMERIC,
  p_event_id UUID DEFAULT NULL,
  p_ticket_id UUID DEFAULT NULL,
  p_table_reservation_id UUID DEFAULT NULL,
  p_order_id UUID DEFAULT NULL,
  p_guest_list_entry_id UUID DEFAULT NULL,
  p_scan_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template_id UUID;
  v_rules JSONB;
  v_commission NUMERIC := 0;
  v_reward_type TEXT := 'money';
  v_reward_config JSONB := '{}'::jsonb;
  v_ticket_rule JSONB;
  v_table_rule JSONB;
  v_tiers JSONB;
  v_windows JSONB;
  v_window JSONB;
  v_total_conversions BIGINT;
  v_tier JSONB;
  v_tier_min INT;
  v_tier_max INT;
  v_conversion_id UUID;
  v_scan_minutes INT;
  v_window_minutes INT;
  v_window_matched BOOLEAN := false;
  -- override
  v_team_id UUID;
  v_leader UUID;
  v_ov_type TEXT;
  v_ov_value NUMERIC;
  v_override NUMERIC := 0;
BEGIN
  -- ── Garde d'autorisation (voir en-tête) ──
  IF auth.uid() IS NOT NULL THEN
    IF NOT (
      EXISTS (SELECT 1 FROM promoters p WHERE p.id = p_promoter_id AND p.user_id = auth.uid())
      OR (p_event_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = p_event_id
          AND (
            public.is_venue_owner(auth.uid(), e.venue_id)
            OR public.can_manage_venue(auth.uid(), e.venue_id)
            OR public.is_venue_staff(auth.uid(), e.venue_id)
            OR public.is_venue_owner(auth.uid(), e.partner_venue_id)
            OR public.can_manage_venue(auth.uid(), e.partner_venue_id)
            OR public.is_venue_staff(auth.uid(), e.partner_venue_id)
            OR e.organizer_user_id = auth.uid()
            OR e.partner_organizer_id = auth.uid()
            OR public.is_event_partner_organizer(auth.uid(), e.id)
          )
      ))
    ) THEN
      RAISE EXCEPTION 'Not authorized to record this conversion';
    END IF;
  END IF;

  SELECT default_commission_template_id INTO v_template_id
  FROM promoters WHERE id = p_promoter_id;

  IF v_template_id IS NOT NULL THEN
    SELECT rules INTO v_rules FROM commission_templates WHERE id = v_template_id;
  END IF;

  IF v_rules IS NOT NULL THEN
    v_tiers := v_rules->'tiers';
    v_windows := v_rules->'time_windows';

    IF v_tiers IS NOT NULL AND jsonb_array_length(v_tiers) > 0 THEN
      SELECT COUNT(*) INTO v_total_conversions FROM promoter_conversions WHERE promoter_id = p_promoter_id;
      v_total_conversions := v_total_conversions + 1;
      FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
        v_tier_min := (v_tier->>'min')::int;
        v_tier_max := CASE WHEN v_tier->>'max' IS NULL OR v_tier->>'max' = 'null' THEN 2147483647 ELSE (v_tier->>'max')::int END;
        IF v_total_conversions >= v_tier_min AND v_total_conversions <= v_tier_max THEN
          v_reward_type := COALESCE(v_tier->>'reward_type', 'money');
          v_reward_config := COALESCE(v_tier->'reward_config', '{}'::jsonb);
          IF v_reward_type = 'money' AND v_tier->>'ticketValue' IS NOT NULL THEN
            v_commission := (v_tier->>'ticketValue')::numeric;
          END IF;
          EXIT;
        END IF;
      END LOOP;

    ELSIF v_windows IS NOT NULL AND jsonb_array_length(v_windows) > 0
          AND p_conversion_type IN ('ticket', 'guestlist') THEN
      v_scan_minutes := EXTRACT(HOUR FROM p_scan_at AT TIME ZONE 'Europe/Paris')::int * 60
                      + EXTRACT(MINUTE FROM p_scan_at AT TIME ZONE 'Europe/Paris')::int;
      IF v_scan_minutes < 360 THEN v_scan_minutes := v_scan_minutes + 1440; END IF;
      FOR v_window IN SELECT * FROM jsonb_array_elements(v_windows) LOOP
        v_window_minutes := split_part(v_window->>'before', ':', 1)::int * 60 + split_part(v_window->>'before', ':', 2)::int;
        IF v_window_minutes < 360 THEN v_window_minutes := v_window_minutes + 1440; END IF;
        IF v_scan_minutes < v_window_minutes THEN
          IF v_window->>'type' = 'percentage' THEN
            v_commission := ROUND(p_amount * ((v_window->>'value')::numeric / 100), 2);
          ELSE
            v_commission := COALESCE((v_window->>'value')::numeric, 0);
          END IF;
          v_window_matched := true;
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_window_matched THEN
        v_ticket_rule := v_rules->'ticket';
        IF v_ticket_rule IS NOT NULL THEN
          IF v_ticket_rule->>'type' = 'percentage' THEN
            v_commission := ROUND(p_amount * ((v_ticket_rule->>'value')::numeric / 100), 2);
          ELSE
            v_commission := COALESCE((v_ticket_rule->>'value')::numeric, 0);
          END IF;
        END IF;
      END IF;

    ELSE
      v_reward_type := COALESCE(v_rules->>'reward_type', 'money');
      v_reward_config := COALESCE(v_rules->'reward_config', '{}'::jsonb);
      IF p_conversion_type IN ('ticket', 'guestlist') THEN
        v_ticket_rule := v_rules->'ticket';
        IF v_ticket_rule IS NOT NULL THEN
          IF v_ticket_rule->>'type' = 'percentage' THEN
            v_commission := ROUND(p_amount * ((v_ticket_rule->>'value')::numeric / 100), 2);
          ELSE
            v_commission := COALESCE((v_ticket_rule->>'value')::numeric, 0);
          END IF;
        END IF;
      ELSIF p_conversion_type = 'table' THEN
        v_table_rule := v_rules->'table';
        IF v_table_rule IS NOT NULL THEN
          IF v_table_rule->>'type' = 'percentage' THEN
            v_commission := ROUND(p_amount * ((v_table_rule->>'value')::numeric / 100), 2);
          ELSE
            v_commission := COALESCE((v_table_rule->>'value')::numeric, 0);
          END IF;
        END IF;
      END IF;
    END IF;
  ELSE
    IF p_conversion_type IN ('ticket', 'guestlist') THEN
      SELECT CASE WHEN ticket_commission_type = 'percentage'
        THEN ROUND(p_amount * (ticket_commission_value / 100), 2) ELSE ticket_commission_value END
        INTO v_commission FROM promoters WHERE id = p_promoter_id;
    ELSIF p_conversion_type = 'table' THEN
      SELECT CASE WHEN table_commission_type = 'percentage'
        THEN ROUND(p_amount * (table_commission_value / 100), 2) ELSE table_commission_value END
        INTO v_commission FROM promoters WHERE id = p_promoter_id;
    END IF;
  END IF;

  v_commission := GREATEST(COALESCE(v_commission, 0), 0);

  INSERT INTO promoter_conversions (
    promoter_id, conversion_type, amount, commission, status,
    event_id, ticket_id, table_reservation_id, order_id, guest_list_entry_id
  ) VALUES (
    p_promoter_id, p_conversion_type, p_amount, v_commission, 'pending',
    p_event_id, p_ticket_id, p_table_reservation_id, p_order_id, p_guest_list_entry_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_conversion_id;

  IF v_conversion_id IS NOT NULL AND v_commission > 0 THEN
    UPDATE promoters
    SET pending_amount = pending_amount + v_commission, updated_at = now()
    WHERE id = p_promoter_id;

    -- Agency override: split a slice of this commission to the team leader.
    SELECT team_id INTO v_team_id FROM promoters WHERE id = p_promoter_id;
    IF v_team_id IS NOT NULL THEN
      SELECT leader_promoter_id, override_type, override_value
        INTO v_leader, v_ov_type, v_ov_value
      FROM promoter_teams WHERE id = v_team_id;

      IF v_leader IS NOT NULL AND v_leader <> p_promoter_id AND COALESCE(v_ov_value, 0) > 0 THEN
        v_override := CASE WHEN v_ov_type = 'percentage'
          THEN ROUND(v_commission * v_ov_value / 100, 2)
          ELSE v_ov_value END;
        v_override := LEAST(v_override, v_commission);

        IF v_override > 0 THEN
          -- Reduce the field promoter's take.
          UPDATE promoter_conversions
          SET commission = commission - v_override, override_amount = v_override
          WHERE id = v_conversion_id;
          UPDATE promoters
          SET pending_amount = pending_amount - v_override, updated_at = now()
          WHERE id = p_promoter_id;

          -- Credit the leader.
          INSERT INTO promoter_conversions (
            promoter_id, conversion_type, amount, commission, status,
            event_id, parent_conversion_id, override_amount
          ) VALUES (
            v_leader, 'override', 0, v_override, 'pending',
            p_event_id, v_conversion_id, v_override
          );
          UPDATE promoters
          SET pending_amount = pending_amount + v_override, updated_at = now()
          WHERE id = v_leader;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'conversion_id', v_conversion_id,
    'commission', GREATEST(v_commission - v_override, 0),
    'override', v_override,
    'reward_type', v_reward_type,
    'reward_config', v_reward_config,
    'duplicate', v_conversion_id IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_promoter_conversion(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ
) TO authenticated;
