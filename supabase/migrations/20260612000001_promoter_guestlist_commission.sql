-- Phase 2 — Commission au scan pour les guestlists gratuites.
-- Coexiste avec le modèle existant (commission à l'achat de billet, inchangé).
-- Le scan à la porte devient la source de vérité pour les entrées guestlist :
-- le timestamp du scan fait foi pour les règles horaires (verrouillage temporel).

-- 1. Autoriser le type de conversion 'guestlist'
ALTER TABLE public.promoter_conversions
  DROP CONSTRAINT IF EXISTS promoter_conversions_conversion_type_check;
ALTER TABLE public.promoter_conversions
  ADD CONSTRAINT promoter_conversions_conversion_type_check
  CHECK (conversion_type IN ('order', 'ticket', 'table', 'guestlist'));

-- 2. Lier une conversion à l'entrée guestlist scannée (idempotence : une conversion par entrée)
ALTER TABLE public.promoter_conversions
  ADD COLUMN IF NOT EXISTS guest_list_entry_id uuid
  REFERENCES public.guest_list_entries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_guestlist_unique
  ON public.promoter_conversions (guest_list_entry_id)
  WHERE guest_list_entry_id IS NOT NULL;

-- 3. Étendre la fonction d'attribution :
--    - nouveau type 'guestlist' (commission par tête, basée sur la règle 'ticket' en € fixe)
--    - fenêtres horaires optionnelles (rules->'time_windows'), appliquées via le timestamp du scan
--    - nouveau paramètre p_guest_list_entry_id + p_scan_at (par défaut now())
--    Tous les nouveaux paramètres ont une valeur par défaut : les appelants existants
--    (verify-ticket-payment, verify-table-payment) passent des arguments nommés et
--    ne sont pas impactés.
-- On supprime d'abord l'ancienne signature à 7 arguments pour éviter une surcharge
-- ambiguë ("function is not unique") une fois la version à 9 arguments créée.
DROP FUNCTION IF EXISTS public.record_promoter_conversion(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, UUID
);

CREATE OR REPLACE FUNCTION public.record_promoter_conversion(
  p_promoter_id UUID,
  p_conversion_type TEXT,        -- 'ticket', 'table', 'order', 'guestlist'
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
  v_scan_minutes INT;     -- minutes since midnight in Europe/Paris, normalised for night wrap
  v_window_minutes INT;
  v_window_matched BOOLEAN := false;
BEGIN
  -- For guestlist commission, the per-head money comes from the 'ticket' money rule.
  -- A guestlist resolver: treat it like a ticket when reading flat rules.
  -- Get promoter's commission template
  SELECT default_commission_template_id INTO v_template_id
  FROM promoters WHERE id = p_promoter_id;

  IF v_template_id IS NOT NULL THEN
    SELECT rules INTO v_rules
    FROM commission_templates WHERE id = v_template_id;
  END IF;

  IF v_rules IS NOT NULL THEN
    v_tiers := v_rules->'tiers';
    v_windows := v_rules->'time_windows';

    IF v_tiers IS NOT NULL AND jsonb_array_length(v_tiers) > 0 THEN
      -- Tiered rewards by cumulative conversion count (existing behaviour)
      SELECT COUNT(*) INTO v_total_conversions
      FROM promoter_conversions
      WHERE promoter_id = p_promoter_id;
      v_total_conversions := v_total_conversions + 1;

      FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
        v_tier_min := (v_tier->>'min')::int;
        v_tier_max := CASE WHEN v_tier->>'max' IS NULL OR v_tier->>'max' = 'null'
                       THEN 2147483647 ELSE (v_tier->>'max')::int END;
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
      -- Time-windowed commission, e.g. 5€ avant 00h30 puis 2€.
      -- Normalise scan time-of-day so post-midnight hours (< 06:00) sort after evening.
      v_scan_minutes := EXTRACT(HOUR FROM p_scan_at AT TIME ZONE 'Europe/Paris')::int * 60
                      + EXTRACT(MINUTE FROM p_scan_at AT TIME ZONE 'Europe/Paris')::int;
      IF v_scan_minutes < 360 THEN v_scan_minutes := v_scan_minutes + 1440; END IF;

      FOR v_window IN SELECT * FROM jsonb_array_elements(v_windows) LOOP
        -- window = { "before": "HH:MM", "type": "fixed"|"percentage", "value": N }
        v_window_minutes := split_part(v_window->>'before', ':', 1)::int * 60
                          + split_part(v_window->>'before', ':', 2)::int;
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

      -- After all windows (late scan): fall back to the flat ticket money rule.
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
      -- Flat ticket/table rules (existing behaviour). Guestlist uses the ticket money rule.
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
    -- Legacy fallback: flat commission fields on the promoter record.
    IF p_conversion_type IN ('ticket', 'guestlist') THEN
      SELECT
        CASE WHEN ticket_commission_type = 'percentage'
          THEN ROUND(p_amount * (ticket_commission_value / 100), 2)
          ELSE ticket_commission_value
        END INTO v_commission
      FROM promoters WHERE id = p_promoter_id;
    ELSIF p_conversion_type = 'table' THEN
      SELECT
        CASE WHEN table_commission_type = 'percentage'
          THEN ROUND(p_amount * (table_commission_value / 100), 2)
          ELSE table_commission_value
        END INTO v_commission
      FROM promoters WHERE id = p_promoter_id;
    END IF;
  END IF;

  v_commission := GREATEST(COALESCE(v_commission, 0), 0);

  -- Idempotent insert (ON CONFLICT DO NOTHING covers all unique indexes,
  -- including the new guest_list_entry_id one).
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
    SET pending_amount = pending_amount + v_commission,
        updated_at = now()
    WHERE id = p_promoter_id;
  END IF;

  RETURN jsonb_build_object(
    'conversion_id', v_conversion_id,
    'commission', v_commission,
    'reward_type', v_reward_type,
    'reward_config', v_reward_config,
    'duplicate', v_conversion_id IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_promoter_conversion(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ
) TO authenticated;
