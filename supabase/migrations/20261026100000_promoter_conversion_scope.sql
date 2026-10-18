-- ============================================================================
-- SEC-09 (1/2) — Une commission de promoteur ne naît que dans le périmètre de
-- la soirée, et un client ne déclare plus qu'une tête de guest list scannée.
--
-- Constaté sur la prod le 18/10 (lecture seule, audit CRM, BACKLOG 16i) :
-- `record_promoter_conversion` (SECURITY DEFINER, EXECUTE accordé à
-- `authenticated` et `service_role`) ne vérifie JAMAIS que le promoteur
-- appartient à la soirée :
--   • en service_role (create-ticket-checkout, create-table-checkout,
--     verify-*-payment) la garde d'autorisation est sautée (auth.uid() NULL) :
--     le `promoterId` envoyé par le navigateur au checkout suffisait pour
--     créditer un promoteur du club A sur une vente du club B ;
--   • en client, la garde laisse passer le promoteur lui-même pour n'importe
--     quelle soirée (ou aucune), n'importe quel type et n'importe quel
--     montant : un promoteur se crédite une commission de billet de 10 000 €
--     par un simple appel RPC, sans vente, autant de fois qu'il veut (aucun
--     ticket_id, donc aucun conflit). Une fois SEC-06 appliqué, le club la
--     règle au prochain lot.
-- Prouvé au banc sur les définitions de la prod (scripts/crm-bench/sec09.mjs).
--
-- Ce que fait cette migration, et rien d'autre : la définition de la prod du
-- 18/10 (identique à 20260830180000), avec deux gardes ajoutées juste après
-- la garde d'autorisation existante :
--   1. Client (auth.uid() non nul, appel direct OU trigger de porte joué dans
--      sa session) : seul `guestlist` passe, avec une entrée de guest list de
--      CETTE soirée, au nom du promoteur de l'entrée, déjà scannée ; montant et
--      remise forcés à 0 (la commission de guest list est par tête). C'est
--      exactement ce que font le trigger `trg_record_guest_entry_promoter_conversion`
--      (porte, hors ligne compris) et les deux appels du front (PromoterScanTab,
--      OrgAppCheckin), devenus de simples doublons sans effet.
--   2. Tout appelant, soirée donnée : le promoteur doit être une partie de la
--      soirée (`event_parties` : club hôte, club partenaire, organisateur,
--      organisateur partenaire, co-hôte accepté). Sinon rien n'est écrit et la
--      réponse porte `out_of_scope: true` (jamais d'exception : une vente ne
--      doit pas échouer pour une commission).
-- Lu sur la prod avant d'écrire : 0 des 138 commissions existantes serait
-- hors périmètre ; les inscriptions de guest list hors périmètre (60) sont des
-- semis démo de juin-juillet jamais scannés.
--
-- Pas de NOTIFY pgrst : la signature ne change pas. Aucun front à livrer.
-- À noter pour les bancs voisins : sec06.mjs R11 et sec07.mjs S1 appellent
-- cette RPC en promoteur pour un billet ; rejoués sur un instantané pris APRÈS
-- cette migration, ils seront refusés (c'est le correctif), à passer en
-- service_role.
--
-- Répéter avant d'appliquer : node scripts/crm-bench/sec09.mjs run (banc),
-- puis sur la prod, en transaction annulée :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/sec09.sql \
--     20261026100000_promoter_conversion_scope.sql \
--     20261026100100_agency_promoter_contract_policy.sql
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Remet la définition de la prod du 18/10 (et donc la faille) : rejouer le
-- CREATE OR REPLACE de record_promoter_conversion de
-- 20260830180000_promoter_conversion_door_staff.sql (corps identique à la prod
-- du 18/10, vérifié), puis :
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261026100000';
-- (bloc 7 de docs/audit/2026-10-18-crm-readiness/ROLLBACK.sql)
-- ============================================================================

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

  -- ── SEC-09 (audit du 18/10) : un client ne déclare qu'une tête de guest list ──
  -- Billets, tables et commandes ne se déclarent qu'en service_role (checkouts,
  -- verify-*-payment) : le serveur y a vérifié la vente. Un client (appel
  -- PostgREST, ou trigger de porte joué dans sa session) ne peut déclarer que
  -- l'entrée SCANNÉE d'une guest list de CETTE soirée, au nom du promoteur de
  -- cette entrée, pour un montant nul (la commission de guest list est par
  -- tête). Avant, le promoteur passait la garde ci-dessus pour n'importe quelle
  -- soirée et se créditait une commission de billet du montant de son choix,
  -- sans vente, autant de fois qu'il le voulait.
  IF auth.uid() IS NOT NULL THEN
    IF NOT (
      p_conversion_type = 'guestlist'
      AND p_event_id IS NOT NULL
      AND p_guest_list_entry_id IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM guest_list_entries ge
          JOIN guest_lists gl ON gl.id = ge.guest_list_id
         WHERE ge.id = p_guest_list_entry_id
           AND gl.event_id = p_event_id
           AND ge.promoter_id = p_promoter_id
           AND ge.entry_scanned
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized to record this conversion';
    END IF;
    p_amount := 0;
    p_discount := 0;
  END IF;

  -- ── SEC-09 : une commission ne naît que dans le périmètre de la soirée ──
  -- Le promoteur doit appartenir à une partie de la soirée (event_parties :
  -- club hôte, club partenaire, organisateur, organisateur partenaire,
  -- co-hôte accepté). Sinon rien n'est écrit et l'appel rend `out_of_scope` :
  -- jamais d'exception, une vente ne doit pas échouer pour une commission.
  -- Avant, un promoteur du club A (son id envoyé par le navigateur au
  -- checkout) touchait une commission sur une vente du club B.
  IF p_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM promoters p, public.event_parties(p_event_id) ep
     WHERE p.id = p_promoter_id
       AND ep.party_key IN ('venue:' || p.venue_id, 'org:' || p.organizer_user_id::text)
  ) THEN
    RETURN jsonb_build_object(
      'conversion_id', NULL,
      'commission', 0,
      'override', 0,
      'reward_type', 'money',
      'reward_config', '{}'::jsonb,
      'duplicate', false,
      'out_of_scope', true
    );
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
