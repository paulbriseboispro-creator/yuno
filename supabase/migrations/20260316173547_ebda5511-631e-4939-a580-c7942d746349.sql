
-- 1. Add unique constraints for idempotency on promoter_conversions
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_ticket_unique 
  ON public.promoter_conversions (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_table_unique 
  ON public.promoter_conversions (table_reservation_id) WHERE table_reservation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conversions_order_unique 
  ON public.promoter_conversions (order_id) WHERE order_id IS NOT NULL;

-- 2. Create the atomic attribution function
CREATE OR REPLACE FUNCTION public.record_promoter_conversion(
  p_promoter_id UUID,
  p_conversion_type TEXT,        -- 'ticket', 'table', 'order'
  p_amount NUMERIC,
  p_event_id UUID DEFAULT NULL,
  p_ticket_id UUID DEFAULT NULL,
  p_table_reservation_id UUID DEFAULT NULL,
  p_order_id UUID DEFAULT NULL
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
  v_total_conversions BIGINT;
  v_tier JSONB;
  v_tier_min INT;
  v_tier_max INT;
  v_conversion_id UUID;
  v_old_pending NUMERIC;
BEGIN
  -- Get promoter's commission template
  SELECT default_commission_template_id INTO v_template_id
  FROM promoters WHERE id = p_promoter_id;

  IF v_template_id IS NOT NULL THEN
    SELECT rules INTO v_rules
    FROM commission_templates WHERE id = v_template_id;
  END IF;

  IF v_rules IS NOT NULL THEN
    -- Check for tiers first
    v_tiers := v_rules->'tiers';
    
    IF v_tiers IS NOT NULL AND jsonb_array_length(v_tiers) > 0 THEN
      -- Count total conversions for this promoter to determine tier
      SELECT COUNT(*) INTO v_total_conversions
      FROM promoter_conversions
      WHERE promoter_id = p_promoter_id;
      
      -- Find matching tier (conversions count is 0-indexed, +1 for the current one)
      v_total_conversions := v_total_conversions + 1;
      
      FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
        v_tier_min := (v_tier->>'min')::int;
        v_tier_max := CASE WHEN v_tier->>'max' IS NULL OR v_tier->>'max' = 'null' 
                       THEN 2147483647 ELSE (v_tier->>'max')::int END;
        
        IF v_total_conversions >= v_tier_min AND v_total_conversions <= v_tier_max THEN
          v_reward_type := COALESCE(v_tier->>'reward_type', 'money');
          v_reward_config := COALESCE(v_tier->'reward_config', '{}'::jsonb);
          
          -- For money tiers, calculate commission from ticketValue
          IF v_reward_type = 'money' AND v_tier->>'ticketValue' IS NOT NULL THEN
            v_commission := (v_tier->>'ticketValue')::numeric;
          END IF;
          EXIT;
        END IF;
      END LOOP;
    ELSE
      -- No tiers: use flat ticket/table rules from template
      v_reward_type := COALESCE(v_rules->>'reward_type', 'money');
      v_reward_config := COALESCE(v_rules->'reward_config', '{}'::jsonb);
      
      IF p_conversion_type = 'ticket' THEN
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
    -- Fallback: use legacy flat commission fields on promoter record
    IF p_conversion_type = 'ticket' THEN
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

  -- Ensure non-negative
  v_commission := GREATEST(COALESCE(v_commission, 0), 0);

  -- Insert conversion (idempotent via unique indexes)
  INSERT INTO promoter_conversions (
    promoter_id, conversion_type, amount, commission, status, 
    event_id, ticket_id, table_reservation_id, order_id
  ) VALUES (
    p_promoter_id, p_conversion_type, p_amount, v_commission, 'pending',
    p_event_id, p_ticket_id, p_table_reservation_id, p_order_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_conversion_id;

  -- If inserted (not a duplicate), update pending_amount
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
