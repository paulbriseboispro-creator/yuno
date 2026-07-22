-- ============================================================================
-- Guest list promoteur : allocation ET commission PAR TYPE (normal / boisson /
-- VIP), + répartition par sexe. Le modèle de commission porte désormais
-- rules.guestlist_allocation = {
--   free_before, types: { normal|drink|table: { spots, commission } },
--   gender?: { female, male }
-- }. (Le 3e type est stocké 'table' mais affiché « VIP » partout.)
--
-- 1. La commission guest list n'est plus un forfait global : elle dépend du type
--    de l'invité scanné. record_promoter_conversion reçoit déjà l'id de l'invité
--    (p_guest_list_entry_id) — il lit son entry_type et choisit le bon € par
--    tête, avec repli sur l'ancien rules.guestlist.value (rétrocompat).
-- 2. La part guest_lists matérialisée porte les quotas par type (quota_normal/
--    drink/table) et, si défini, les quotas par sexe (quota_female/male).
-- ============================================================================

-- ── Helper : € par tête d'un invité guest list, selon son type ───────────────
-- Repli : type non configuré → ancien forfait global rules.guestlist.value → 0.
CREATE OR REPLACE FUNCTION public.promoter_guestlist_head_commission(
  v_rules jsonb,
  p_entry_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_per_type numeric;
BEGIN
  IF p_entry_id IS NOT NULL THEN
    SELECT entry_type INTO v_type FROM public.guest_list_entries WHERE id = p_entry_id;
  END IF;
  v_type := COALESCE(v_type, 'normal');
  v_per_type := NULLIF(v_rules -> 'guestlist_allocation' -> 'types' -> v_type ->> 'commission', '')::numeric;
  RETURN COALESCE(v_per_type, (v_rules -> 'guestlist' ->> 'value')::numeric, 0);
END;
$$;

-- ── record_promoter_conversion : commission guest list par type ──────────────
-- Corps identique à 20260720160000, seules les 2 lignes de commission guest list
-- passent par le helper ci-dessus (extraction mécanique, aucune autre modif).

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
  v_base_count BIGINT := 0;
  v_tier JSONB;
  v_tier_min INT;
  v_tier_max INT;
  v_conversion_id UUID;
  v_scan_minutes INT;
  v_window_minutes INT;
  v_window_matched BOOLEAN := false;
  -- bonus
  v_bonus JSONB;
  v_bonus_threshold INT;
  -- agence
  v_agency_id UUID;
  v_can_tickets BOOLEAN;
  v_can_tables BOOLEAN;
  v_ticket_cap INT;
  v_table_cap INT;
  v_type_count BIGINT;
  -- override
  v_team_id UUID;
  v_leader UUID;
  v_ov_type TEXT;
  v_ov_value NUMERIC;
  v_override NUMERIC := 0;
BEGIN
  -- ── Garde d'autorisation (identique à 20260715120100) ──
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
            OR public.is_org_member(auth.uid(), e.organizer_user_id)
            OR public.is_org_member(auth.uid(), e.partner_organizer_id)
            OR e.organizer_user_id = auth.uid()
            OR e.partner_organizer_id = auth.uid()
            OR public.is_event_partner_organizer(auth.uid(), e.id)
          )
      ))
    ) THEN
      RAISE EXCEPTION 'Not authorized to record this conversion';
    END IF;
  END IF;

  -- ── Résolution du template : par événement d'abord, défaut promoteur sinon ──
  IF p_event_id IS NOT NULL THEN
    SELECT commission_template_id INTO v_template_id
    FROM promoter_event_assignments
    WHERE promoter_id = p_promoter_id AND event_id = p_event_id
      AND commission_template_id IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_template_id IS NULL THEN
    SELECT default_commission_template_id INTO v_template_id
    FROM promoters WHERE id = p_promoter_id;
  END IF;

  IF v_template_id IS NOT NULL THEN
    SELECT rules INTO v_rules FROM commission_templates WHERE id = v_template_id;
  END IF;

  -- Ventes de base déjà enregistrées (ni override, ni annulées) : sert aux
  -- paliers et au bonus. La conversion courante sera la (v_base_count + 1)-ième.
  SELECT COUNT(*) INTO v_base_count
  FROM promoter_conversions
  WHERE promoter_id = p_promoter_id
    AND conversion_type <> 'override'
    AND parent_conversion_id IS NULL
    AND status <> 'cancelled';

  IF v_rules IS NOT NULL THEN
    v_tiers := v_rules->'tiers';
    v_windows := v_rules->'time_windows';

    IF v_tiers IS NOT NULL AND jsonb_array_length(v_tiers) > 0 THEN
      FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
        v_tier_min := (v_tier->>'min')::int;
        v_tier_max := CASE WHEN v_tier->>'max' IS NULL OR v_tier->>'max' = 'null' THEN 2147483647 ELSE (v_tier->>'max')::int END;
        IF v_base_count + 1 >= v_tier_min AND v_base_count + 1 <= v_tier_max THEN
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
        IF p_conversion_type = 'guestlist' THEN
          -- Guest list : remuneration PAR TETE (euros), jamais en pourcentage.
          -- Une entree gratuite n'a pas de montant : un pourcentage valait donc
          -- toujours 0, et le promoteur n'etait jamais paye sur ses invites.
          v_commission := public.promoter_guestlist_head_commission(v_rules, p_guest_list_entry_id);
        ELSE
          v_ticket_rule := v_rules->'ticket';
          IF v_ticket_rule IS NOT NULL THEN
            IF v_ticket_rule->>'type' = 'percentage' THEN
              v_commission := ROUND(p_amount * ((v_ticket_rule->>'value')::numeric / 100), 2);
            ELSE
              v_commission := COALESCE((v_ticket_rule->>'value')::numeric, 0);
            END IF;
          END IF;
        END IF;
      END IF;

    ELSE
      v_reward_type := COALESCE(v_rules->>'reward_type', 'money');
      v_reward_config := COALESCE(v_rules->'reward_config', '{}'::jsonb);
      IF p_conversion_type IN ('ticket', 'guestlist') THEN
        IF p_conversion_type = 'guestlist' THEN
          -- Guest list : remuneration PAR TETE (euros), jamais en pourcentage.
          -- Une entree gratuite n'a pas de montant : un pourcentage valait donc
          -- toujours 0, et le promoteur n'etait jamais paye sur ses invites.
          v_commission := public.promoter_guestlist_head_commission(v_rules, p_guest_list_entry_id);
        ELSE
          v_ticket_rule := v_rules->'ticket';
          IF v_ticket_rule IS NOT NULL THEN
            IF v_ticket_rule->>'type' = 'percentage' THEN
              v_commission := ROUND(p_amount * ((v_ticket_rule->>'value')::numeric / 100), 2);
            ELSE
              v_commission := COALESCE((v_ticket_rule->>'value')::numeric, 0);
            END IF;
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

    -- Bonus unique au franchissement du seuil de ventes (rules.bonus).
    v_bonus := v_rules->'bonus';
    IF v_bonus IS NOT NULL THEN
      v_bonus_threshold := COALESCE((v_bonus->>'threshold')::int, 0);
      IF v_bonus_threshold > 0 AND v_base_count + 1 = v_bonus_threshold THEN
        v_commission := v_commission + COALESCE((v_bonus->>'bonusAmount')::numeric, 0);
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

  -- ── Règles agence : interdiction de vente ou plafond par type (par événement)
  --    → commission zéro. Jamais d'exception : un paiement ne doit pas échouer.
  SELECT agency_id, agency_can_sell_tickets, agency_can_sell_tables,
         agency_ticket_cap, agency_table_cap
    INTO v_agency_id, v_can_tickets, v_can_tables, v_ticket_cap, v_table_cap
  FROM promoters WHERE id = p_promoter_id;

  IF v_agency_id IS NOT NULL AND v_commission > 0 THEN
    IF p_conversion_type = 'ticket' AND v_can_tickets IS FALSE THEN
      v_commission := 0;
    ELSIF p_conversion_type = 'table' AND v_can_tables IS FALSE THEN
      v_commission := 0;
    ELSIF p_conversion_type IN ('ticket', 'table') AND p_event_id IS NOT NULL THEN
      IF p_conversion_type = 'ticket' AND COALESCE(v_ticket_cap, 0) > 0 THEN
        SELECT COUNT(*) INTO v_type_count FROM promoter_conversions
        WHERE promoter_id = p_promoter_id AND event_id = p_event_id
          AND conversion_type = 'ticket' AND status <> 'cancelled';
        IF v_type_count >= v_ticket_cap THEN v_commission := 0; END IF;
      ELSIF p_conversion_type = 'table' AND COALESCE(v_table_cap, 0) > 0 THEN
        SELECT COUNT(*) INTO v_type_count FROM promoter_conversions
        WHERE promoter_id = p_promoter_id AND event_id = p_event_id
          AND conversion_type = 'table' AND status <> 'cancelled';
        IF v_type_count >= v_table_cap THEN v_commission := 0; END IF;
      END IF;
    END IF;
  END IF;

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

-- ── create_promoter_guestlist_part : quotas par type + par sexe ──────────────
-- Remplace la version de 20260722170000 : lit rules.guestlist_allocation.types
-- (normal/drink/table → quota_normal/drink/table) et .gender (female/male →
-- quota_female/male). Rétrocompat : ancienne forme { spots } → tout en normal.
-- ON CONFLICT DO NOTHING : ne réécrit jamais une part ajustée à la main.
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
  v_alloc jsonb;
  v_types jsonb;
  v_normal int;
  v_drink int;
  v_table int;
  v_total int;
  v_female int;
  v_male int;
  v_free_before time;
  v_label text;
  v_venue_id text;
  v_org_id uuid;
BEGIN
  SELECT ct.rules,
         COALESCE(NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.promo_code)
    INTO v_rules, v_label
  FROM public.promoters p
  LEFT JOIN public.commission_templates ct ON ct.id = p.default_commission_template_id
  WHERE p.id = p_promoter_id
    AND p.is_active;

  IF v_rules IS NULL THEN
    RETURN;
  END IF;

  v_alloc := v_rules -> 'guestlist_allocation';
  IF v_alloc IS NULL THEN
    RETURN; -- le modèle ne porte pas d'allocation guest list
  END IF;

  v_types := v_alloc -> 'types';
  v_normal := COALESCE(NULLIF(v_types -> 'normal' ->> 'spots', '')::int, 0);
  v_drink  := COALESCE(NULLIF(v_types -> 'drink'  ->> 'spots', '')::int, 0);
  v_table  := COALESCE(NULLIF(v_types -> 'table'  ->> 'spots', '')::int, 0);
  -- Rétrocompat : ancienne forme v1 { spots } (sans types) → tout en normal.
  IF v_types IS NULL THEN
    v_normal := COALESCE(NULLIF(v_alloc ->> 'spots', '')::int, 0);
  END IF;

  v_total := v_normal + v_drink + v_table;
  IF v_total <= 0 THEN
    RETURN;
  END IF;

  v_female := COALESCE(NULLIF(v_alloc -> 'gender' ->> 'female', '')::int, 0);
  v_male   := COALESCE(NULLIF(v_alloc -> 'gender' ->> 'male', '')::int, 0);
  v_free_before := COALESCE(NULLIF(v_alloc ->> 'free_before', ''), '02:00')::time;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.events WHERE id = p_event_id;

  INSERT INTO public.guest_lists
    (event_id, venue_id, organizer_user_id, holder_type, promoter_id, holder_label,
     quota, quota_normal, quota_drink, quota_table, quota_female, quota_male,
     free_before_time, includes_drink, visible_on_club_page, is_active)
  VALUES
    (p_event_id, v_venue_id, v_org_id, 'promoter', p_promoter_id, v_label,
     v_total, v_normal, v_drink, v_table, v_female, v_male,
     v_free_before, (v_drink > 0), false, true)
  ON CONFLICT (event_id, promoter_id) WHERE holder_type = 'promoter' DO NOTHING;

  UPDATE public.promoter_event_assignments
     SET can_access_guestlist = true
   WHERE promoter_id = p_promoter_id
     AND event_id = p_event_id
     AND can_access_guestlist IS DISTINCT FROM true;
END;
$$;
