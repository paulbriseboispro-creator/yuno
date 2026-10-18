-- Retour arrière des migrations de l'audit du 18/10 (20261021100000 → 20261026100100).
-- Définitions lues en prod le 18/10 AVANT les corrections (pg_get_functiondef).
-- À ne jouer que si une correction casse quelque chose : le bloc 1 ROUVRE la faille SEC-01.
-- Jouer dans une transaction, puis supabase db lint --linked.

-- ── 7. 20261026100000 + 20261026100100 (SEC-09) : ROUVRE les deux failles ──
-- (un promoteur se crédite des commissions sans vente ; une commission naît hors du
--  périmètre de la soirée ; un chef d'agence place un promoteur dans n'importe quel club).
-- Définition de record_promoter_conversion lue en prod le 18/10 (= 20260830180000).
DROP POLICY IF EXISTS "Agency owner views own promoters" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner adds promoters under an active contract" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner updates own promoters" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner removes own promoters" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner manages own promoters" ON public.promoters;
CREATE POLICY "Agency owner manages own promoters" ON public.promoters
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id IS NOT NULL) AND is_agency_owner(auth.uid(), agency_id))
  WITH CHECK ((agency_id IS NOT NULL) AND is_agency_owner(auth.uid(), agency_id));
DROP FUNCTION IF EXISTS public.agency_owner_can_place_promoter(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.promoter_agency_scope_unchanged(uuid, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.record_promoter_conversion(p_promoter_id uuid, p_conversion_type text, p_amount numeric, p_event_id uuid DEFAULT NULL::uuid, p_ticket_id uuid DEFAULT NULL::uuid, p_table_reservation_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_list_entry_id uuid DEFAULT NULL::uuid, p_scan_at timestamp with time zone DEFAULT now(), p_discount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            -- Le videur recruté par l'organisateur tient la porte : c'est LUI
            -- qui scanne l'invité, donc lui qui déclenche la commission. Sans
            -- ce terme, l'appel échoue en silence (il est fire-and-forget) et
            -- le promoteur n'est jamais payé sur les invités qu'il a placés.
            OR public.is_event_door_staff(auth.uid(), e.id)
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
  -- paliers et au bonus. Scopé À LA SOIRÉE (p_event_id) : un palier « vends 10 »
  -- se compte pour CETTE soirée, pas sur toute la vie du promoteur — sinon les
  -- ventes d'un autre club faisaient avancer le palier ici et le bonus ne
  -- tombait qu'une fois pour toujours. La conversion courante sera la
  -- (v_base_count + 1)-ième de la soirée.
  SELECT COUNT(*) INTO v_base_count
  FROM promoter_conversions
  WHERE promoter_id = p_promoter_id
    AND conversion_type <> 'override'
    AND parent_conversion_id IS NULL
    AND status <> 'cancelled'
    AND (p_event_id IS NULL OR event_id = p_event_id);

  IF v_rules IS NOT NULL THEN
    v_tiers := v_rules->'tiers';
    v_windows := v_rules->'time_windows';

    -- ── Dispatch PAR TYPE. Paliers et fenêtres horaires sont des mécaniques
    --    BILLET (volume, heure d'arrivée) : une table ou une guest list n'y
    --    entrent jamais.
    IF p_conversion_type = 'table' THEN
      v_table_rule := v_rules->'table';
      IF v_table_rule IS NOT NULL THEN
        IF v_table_rule->>'type' = 'percentage' THEN
          v_commission := ROUND(p_amount * ((v_table_rule->>'value')::numeric / 100), 2);
        ELSE
          v_commission := COALESCE((v_table_rule->>'value')::numeric, 0);
        END IF;
      ELSE
        -- Template sans règle 'table' → colonnes plates du promoteur (jamais 0
        -- par défaut, l'ancien code laissait la table à 0 sous un template
        -- billet-only).
        SELECT CASE WHEN table_commission_type = 'percentage'
          THEN ROUND(p_amount * (table_commission_value / 100), 2)
          ELSE COALESCE(table_commission_value, 0) END
          INTO v_commission FROM promoters WHERE id = p_promoter_id;
      END IF;

    ELSIF p_conversion_type = 'guestlist' THEN
      -- Guest list : TOUJOURS par tête (euros). Jamais un pourcentage — une
      -- entrée gratuite a un montant nul, donc un % (palier OU fenêtre) donnait
      -- 0 et le promoteur n'était jamais payé sur ses invités.
      v_commission := public.promoter_guestlist_head_commission(v_rules, p_guest_list_entry_id);

    ELSE
      -- Billet (et tout autre type payant) : paliers → fenêtres → règle plate.
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

      ELSIF v_windows IS NOT NULL AND jsonb_array_length(v_windows) > 0 THEN
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

    -- Bonus unique au franchissement du seuil de ventes de la soirée
    -- (rules.bonus). Réservé aux billets : c'est une mécanique de volume billet,
    -- une table ou une guest list ne doit pas déclencher le bonus billet.
    IF p_conversion_type = 'ticket' THEN
      v_bonus := v_rules->'bonus';
      IF v_bonus IS NOT NULL THEN
        v_bonus_threshold := COALESCE((v_bonus->>'threshold')::int, 0);
        IF v_bonus_threshold > 0 AND v_base_count + 1 = v_bonus_threshold THEN
          v_commission := v_commission + COALESCE((v_bonus->>'bonusAmount')::numeric, 0);
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
    event_id, ticket_id, table_reservation_id, order_id, guest_list_entry_id,
    discount_amount
  ) VALUES (
    p_promoter_id, p_conversion_type, p_amount, v_commission, 'pending',
    p_event_id, p_ticket_id, p_table_reservation_id, p_order_id, p_guest_list_entry_id,
    GREATEST(COALESCE(p_discount, 0), 0)
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
$function$;
REVOKE ALL ON FUNCTION public.record_promoter_conversion(uuid, text, numeric, uuid, uuid, uuid, uuid, uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_promoter_conversion(uuid, text, numeric, uuid, uuid, uuid, uuid, uuid, timestamptz, numeric) TO authenticated, service_role;

-- ── 6. 20261025200000 (SEC-07) : ROUVRE la faille (le promoteur réécrit toute sa fiche) ──
DROP TRIGGER IF EXISTS trg_a_guard_promoter_self_update ON public.promoters;
DROP FUNCTION IF EXISTS public.guard_promoter_self_update();

-- ── 5. 20261024100100 (LINK-01) : remet l'expression {1,480}, donc l'erreur 2201B ──
CREATE OR REPLACE FUNCTION public.crm_link_create(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_platform text, p_placement text, p_label text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
  v_n integer;
  v_image text := CASE WHEN p_image_url ~ '^https://[^[:space:]]{1,480}$' THEN p_image_url END;
  v_row public.tracked_links%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT public._crm_link_creatable(p_platform, p_placement) THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_n FROM public.tracked_links WHERE event_id = p_event_id;
  IF v_n >= 300 THEN RAISE EXCEPTION 'too_many_links' USING ERRCODE = '54000'; END IF;

  IF v_label IS NULL THEN
    SELECT count(*) + 1 INTO v_n FROM public.tracked_links
     WHERE event_id = p_event_id AND utm_source = p_platform AND utm_medium = p_placement;
    v_label := initcap(p_placement) || ' ' || v_n;
  END IF;

  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium, utm_campaign, image_url)
  VALUES (public.gen_tracked_link_code(), v_label,
          CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
          p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END, auth.uid(),
          'event', p_event_id, p_platform, p_placement, 'yuno', v_image)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label', v_row.label,
    'platform', v_row.utm_source, 'placement', v_row.utm_medium, 'created_at', v_row.created_at,
    'image_url', v_row.image_url);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text, text) TO authenticated, service_role;

-- ── 4. 20261024100000 (SEC-06) : ROUVRE la faille et re-casse le cycle de règlement ──
DROP TRIGGER IF EXISTS trg_guard_promoter_conversion_settlement ON public.promoter_conversions;
DROP FUNCTION IF EXISTS public.guard_promoter_conversion_settlement();
CREATE OR REPLACE FUNCTION public.guard_promoter_payout_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Les jobs serveur (crons, maintenance) gardent la main.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF COALESCE(current_setting('yuno.payout_rpc', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_direct_write_forbidden'
      USING HINT = 'Annulez le lot via cancel_promoter_payout.';
  END IF;

  -- On ne verrouille QUE le statut et les horodatages du cycle : un club doit
  -- pouvoir corriger une note ou un libelle de periode librement.
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference THEN
    RAISE EXCEPTION 'payout_direct_write_forbidden'
      USING HINT = 'Le cycle de reglement passe par declare_promoter_payout_sent / confirm_promoter_payout_received.';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_promoter_payout_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_promoter_payout_write() TO service_role;
-- (is_direct_client_write n'a pas changé : rien à défaire.)

-- ── 3. 20261021120000 (connecteur) ──
DROP TRIGGER IF EXISTS trg_ticketing_connections_withdraw_consents ON public.ticketing_connections;
DROP FUNCTION IF EXISTS public.ticketing_connections_withdraw_consents();
CREATE OR REPLACE FUNCTION public.claim_ticketing_connections(p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 150, p_connection_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF ticketing_connections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_ticketing_connections: service_role only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE public.ticketing_connections c
     SET locked_until = now() + make_interval(secs => p_lease_seconds),
         last_sync_started_at = now()
   WHERE c.id IN (
     SELECT x.id FROM public.ticketing_connections x
      WHERE x.status = 'active'
        AND x.vault_secret_id IS NOT NULL
        AND (p_connection_id IS NULL OR x.id = p_connection_id)
        AND (p_connection_id IS NOT NULL OR x.next_sync_at <= now())
        AND (x.locked_until IS NULL OR x.locked_until < now())
        AND NOT public.crm_scope_paused(public.crm_scope_key(x.venue_id, x.organizer_user_id))
      ORDER BY x.next_sync_at
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
END;
$function$;

-- ── 2. 20261021110000 (file d'envoi) ──
CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer, ab_variant text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gate boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_campaign_recipients: service_role only';
  END IF;

  -- Phase de test A/B en cours : seules les lignes avec variante sont
  -- réclamables. Le reste attend le gagnant.
  SELECT (c.ab_enabled AND COALESCE(c.subject_b, '') <> '' AND c.ab_winner IS NULL)
    INTO v_gate
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;

  RETURN QUERY
  WITH picked AS (
    SELECT r.id
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.status = 'pending'
       AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
       AND (NOT COALESCE(v_gate, false) OR r.ab_variant IS NOT NULL)
     ORDER BY r.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_campaign_recipients r
     SET status = 'sending',
         claimed_at = now(),
         attempts = r.attempts + 1
    FROM picked
   WHERE r.id = picked.id
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts, r.ab_variant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stale_campaign_claims(p_stale_minutes integer DEFAULT 10, p_max_attempts integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'requeue_stale_campaign_claims: service_role only';
  END IF;

  WITH upd AS (
    UPDATE public.email_campaign_recipients r
       SET status = CASE WHEN r.attempts >= p_max_attempts THEN 'failed' ELSE 'pending' END,
           claimed_at = NULL,
           error_message = CASE WHEN r.attempts >= p_max_attempts
                                THEN 'Abandon après ' || r.attempts || ' tentatives (worker interrompu)'
                                ELSE r.error_message END
     WHERE r.status = 'sending'
       AND r.claimed_at IS NOT NULL
       AND r.claimed_at < now() - make_interval(mins => GREATEST(1, p_stale_minutes))
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$function$;

-- ── 1. 20261021100000 (sécurité) : le gel d'envoi revient en invoker ; les révocations ne se défont
--    qu'en connaissance de cause (elles ferment SEC-01, SEC-02, SEC-03).
ALTER FUNCTION public.guard_crm_send_frozen() SECURITY INVOKER;
-- GRANT EXECUTE ON FUNCTION public._admin_customer_activity() TO PUBLIC;  -- NE PAS rouvrir sans raison
