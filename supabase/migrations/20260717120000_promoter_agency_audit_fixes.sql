-- ============================================================================
-- Audit opérationnel promoteurs/agences (2026-07-17) — correctifs câblage.
--
-- 1. Remboursements : un billet/table/commande remboursé ne réversait JAMAIS la
--    commission promoteur (promoter_conversions restait 'pending'), ni la dette
--    club→agence (agency_conversions), ni promoters.pending_amount. Le club
--    payait donc des commissions sur des ventes annulées. → triggers de
--    réversion sur tickets / table_reservations / orders.
-- 2. Bonus de palier : l'UI des templates enregistre rules.bonus
--    ({threshold, bonusAmount}, « bonus unique au-delà d'un seuil de ventes »)
--    mais record_promoter_conversion ne le lisait pas → jamais payé.
-- 3. Template par événement : promoter_event_assignments.commission_template_id
--    existait en schéma mais n'était lu nulle part.
-- 4. Caps agence : agency_can_sell_tickets/tables + agency_ticket/table_cap
--    étaient écrits par l'app agence mais appliqués NULLE PART. → enforcement
--    au moteur de commission (commission zéro si interdit/plafond atteint,
--    par événement — jamais bloquant pour le paiement).
-- 5. create_agency : aucune garde anti-doublon — un double submit créait deux
--    agences et .maybeSingle() côté app lockait l'owner (PGRST116).
-- 6. Boucle d'approbation linktree : un membre 'manager' ne pouvait pas
--    approuver (UPDATE affiliate_members silencieusement no-op sous RLS).
--    → RPC review_member_linktree (owner OU manager de l'affilié).
-- 7. venue_subscription_public : passée en security_invoker=true (linter), la
--    vue ne renvoyait plus AUCUNE ligne aux anonymes (aucune policy anon sur
--    la table) → le gating public du badge « Powered by Yuno » était mort.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Statut 'cancelled' pour les conversions (réversion de remboursement).
--    'approved' est aussi ajouté : l'UI le référence déjà (finance owner).
-- ----------------------------------------------------------------------------
ALTER TABLE public.promoter_conversions
  DROP CONSTRAINT IF EXISTS promoter_conversions_status_check;
ALTER TABLE public.promoter_conversions
  ADD CONSTRAINT promoter_conversions_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'cancelled'));

-- ----------------------------------------------------------------------------
-- 1. Réversion des commissions au remboursement.
--    Annule les conversions encore 'pending' liées à la ligne remboursée
--    (base + lignes override du chef d'équipe), décrémente les pending_amount,
--    et supprime la dette club→agence non encore réglée. Les conversions déjà
--    'paid' (réglées) ne sont pas touchées — la récupération d'une commission
--    déjà versée est une décision de gestion, pas un automatisme.
--    Non bloquant : une erreur ici ne doit JAMAIS faire échouer un refund.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_promoter_conversions_for_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  base RECORD;
  child RECORD;
BEGIN
  FOR base IN
    SELECT id, promoter_id, commission
    FROM promoter_conversions
    WHERE status = 'pending'
      AND conversion_type <> 'override'
      AND (
        (TG_TABLE_NAME = 'tickets'            AND ticket_id = NEW.id)
        OR (TG_TABLE_NAME = 'table_reservations' AND table_reservation_id = NEW.id)
        OR (TG_TABLE_NAME = 'orders'          AND order_id = NEW.id)
      )
  LOOP
    -- Lignes override (part du chef d'équipe) encore pending → annulées aussi.
    FOR child IN
      SELECT id, promoter_id, commission
      FROM promoter_conversions
      WHERE parent_conversion_id = base.id AND status = 'pending'
    LOOP
      UPDATE promoter_conversions SET status = 'cancelled' WHERE id = child.id;
      UPDATE promoters
      SET pending_amount = GREATEST(COALESCE(pending_amount, 0) - child.commission, 0),
          updated_at = now()
      WHERE id = child.promoter_id;
    END LOOP;

    UPDATE promoter_conversions SET status = 'cancelled' WHERE id = base.id;
    UPDATE promoters
    SET pending_amount = GREATEST(COALESCE(pending_amount, 0) - base.commission, 0),
        updated_at = now()
    WHERE id = base.promoter_id;

    -- Dette club→agence pas encore réglée : la vente n'existe plus.
    DELETE FROM agency_conversions
    WHERE source_conversion_id = base.id AND club_status = 'pending';
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'cancel_promoter_conversions_for_refund: % (table %, id %)', SQLERRM, TG_TABLE_NAME, NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_promoter_conv_on_refund ON public.tickets;
CREATE TRIGGER trg_cancel_promoter_conv_on_refund
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded')
  EXECUTE FUNCTION public.cancel_promoter_conversions_for_refund();

DROP TRIGGER IF EXISTS trg_cancel_promoter_conv_on_refund ON public.table_reservations;
CREATE TRIGGER trg_cancel_promoter_conv_on_refund
  AFTER UPDATE OF status ON public.table_reservations
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded')
  EXECUTE FUNCTION public.cancel_promoter_conversions_for_refund();

DROP TRIGGER IF EXISTS trg_cancel_promoter_conv_on_refund ON public.orders;
CREATE TRIGGER trg_cancel_promoter_conv_on_refund
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded')
  EXECUTE FUNCTION public.cancel_promoter_conversions_for_refund();

-- ----------------------------------------------------------------------------
-- 2+3+4. record_promoter_conversion : corps repris de 20260715120100 (garde
-- d'autorisation identique), avec :
--   • résolution du template PAR ÉVÉNEMENT (promoter_event_assignments
--     .commission_template_id) avant le template par défaut du promoteur ;
--   • comptage des ventes sur les CONVERSIONS DE BASE uniquement (les lignes
--     'override' du chef d'équipe et les lignes annulées ne sont pas des
--     ventes) — utilisé par les paliers ET le bonus ;
--   • bonus unique au franchissement du seuil (rules.bonus) ;
--   • enforcement des règles agence : vente interdite (can_sell) ou plafond
--     par type atteint (cap, compté par événement) → commission zéro. La
--     conversion est quand même enregistrée (traçabilité), mais aucun argent
--     ne bouge et le trigger de marge agence ne crée pas de dette club.
-- ----------------------------------------------------------------------------
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

GRANT EXECUTE ON FUNCTION public.record_promoter_conversion(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. create_agency : garde anti-doublon. L'app entière suppose UNE agence par
--    owner (useAgency .maybeSingle()) — une deuxième ligne lockait l'accès.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency(
  p_name text,
  p_owner_user_id uuid DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_contact_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_id uuid;
  v_email text;
BEGIN
  v_owner := COALESCE(p_owner_user_id, auth.uid());

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no owner resolved';
  END IF;
  IF v_owner <> auth.uid() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized to create an agency for another user';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'agency name required';
  END IF;

  -- Idempotent : si l'owner a déjà une agence, la retourner au lieu d'en
  -- créer une deuxième (double submit, back-navigation…).
  SELECT id INTO v_id FROM public.agencies
  WHERE owner_user_id = v_owner
  ORDER BY created_at ASC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.agencies (owner_user_id, name, city, slug, contact_email)
  VALUES (v_owner, trim(p_name), p_city, NULLIF(trim(COALESCE(p_slug, '')), ''), p_contact_email)
  RETURNING id INTO v_id;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_owner;

  INSERT INTO public.user_roles (user_id, role, email)
  VALUES (v_owner, 'agency', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_agency(text, uuid, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. review_member_linktree : l'owner de l'affilié OU un membre 'manager'
--    actif du même affilié change le statut de révision du linktree d'un
--    membre. L'UPDATE direct sous RLS ne matchait aucune ligne pour un
--    manager (policy « own row » ou « affiliate owner » uniquement) et
--    échouait EN SILENCE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_member_linktree(
  p_member_id uuid,
  p_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_affiliate_id uuid;
  v_authorized boolean;
BEGIN
  IF p_status NOT IN ('draft', 'pending_review', 'approved') THEN
    RAISE EXCEPTION 'invalid linktree status %', p_status;
  END IF;

  SELECT affiliate_id INTO v_affiliate_id
  FROM public.affiliate_members WHERE id = p_member_id;
  IF v_affiliate_id IS NULL THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  v_authorized :=
    EXISTS (SELECT 1 FROM public.affiliates a
            WHERE a.id = v_affiliate_id AND a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.affiliate_members mm
               WHERE mm.affiliate_id = v_affiliate_id
                 AND mm.user_id = auth.uid()
                 AND mm.role = 'manager'
                 AND mm.is_active);
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'not authorized to review this linktree';
  END IF;

  UPDATE public.affiliate_members
  SET linktree_status = p_status
  WHERE id = p_member_id;

  RETURN p_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_member_linktree(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. venue_subscription_public : re-passe la vue en SECURITY DEFINER (défaut).
--    security_invoker=true (posé pour calmer le linter) faisait appliquer le
--    RLS de venue_subscriptions au visiteur anonyme — aucune policy anon →
--    0 ligne, gating plan mort sur les pages publiques. La vue ne projette
--    que (venue_id, subscription_plan, status) pré-filtrés active/trialing :
--    c'est exactement le rôle d'une vue definer, on assume le warning linter.
-- ----------------------------------------------------------------------------
ALTER VIEW public.venue_subscription_public SET (security_invoker = false);
