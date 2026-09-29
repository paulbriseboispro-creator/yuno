-- Équipe d'un organisateur dans le collab : un ADMIN d'équipe agit pour
-- l'organisation (proposer, signer, avenants, pause/suppression, décompte).
--
-- Les RPC du contrat collab ne reconnaissaient la partie organisateur que si
-- auth.uid() = organizer_user_id : l'équipe voyait la fiche co-soirée, mais
-- chacun de ses clics était refusé. Une seule porte désormais,
-- collab_org_can_act(org) = le fondateur OU un admin d'équipe accepté
-- (is_org_team_member(…, 'admin')), même règle que l'invitation du staff
-- opérationnel. Un éditeur ou un scanner ne signe jamais un contrat d'argent.
-- La signature garde l'identité réelle (org_signed_by = auth.uid()).
-- Généré depuis l'état LIVE : seules les comparaisons d'identité changent.

CREATE OR REPLACE FUNCTION public.collab_org_can_act(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND p_org IS NOT NULL
     AND (auth.uid() = p_org OR public.is_org_team_member(auth.uid(), p_org, 'admin'))
$$;
REVOKE ALL ON FUNCTION public.collab_org_can_act(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collab_org_can_act(uuid) TO authenticated;


-- accept_collab_night_closing : 1
CREATE OR REPLACE FUNCTION public.accept_collab_night_closing(p_closing_id uuid, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c             public.collab_night_closings%ROWTYPE;
  v_rules       jsonb;
  v_ended       boolean;
  v_fig         record;
  v_total       numeric;
  v_pct         numeric;
  v_due         numeric;
  v_due_cents   bigint;
  v_held_cents  bigint := 0;
  v_online      bigint := 0;
  v_sepa_cents  bigint := 0;
  v_org_acct    text;
  v_org_ready   boolean;
  v_iban        text;
  v_iban_chg    timestamptz;
  v_settle_id   uuid;
  v_ref         text;
  v_rows        int := 0;
  v_sum_base    bigint := 0;
  v_remainder   bigint;
  v_idx         int := 0;
  v_org_cents   bigint;
  r             record;
  v_title       text;
  v_org_name    text;
BEGIN
  SELECT * INTO c FROM public.collab_night_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found'; END IF;
  -- Le décompte est une créance de l'ORGANISATEUR : lui seul l'accepte.
  IF NOT public.collab_org_can_act(c.organizer_user_id) THEN RAISE EXCEPTION 'only_organizer_can_accept'; END IF;
  IF c.status <> 'declared' THEN RAISE EXCEPTION 'closing_not_declared'; END IF;
  -- On accepte les chiffres LUS : une redéclaration entre-temps change la révision.
  IF p_expected_revision IS NOT NULL AND c.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'closing_revised';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = c.event_id;
  IF v_rules IS NULL OR NOT public.is_tiered_collab(v_rules) THEN RAISE EXCEPTION 'not_tiered'; END IF;
  IF NOT v_ended THEN RAISE EXCEPTION 'event_not_ended'; END IF;

  -- Refiger les chiffres Yuno à l'instant de l'acceptation.
  SELECT * INTO v_fig FROM public.collab_night_yuno_figures(c.event_id);
  v_total := v_fig.tickets + v_fig.tables + v_fig.drinks
    + c.declared_bar + c.declared_door_tickets + c.declared_tables_extra + c.declared_other;
  SELECT tp.pct, tp.amount INTO v_pct, v_due FROM public.collab_tier_pct(v_rules, v_total) tp;
  v_due_cents := ROUND(v_due * 100)::bigint;

  -- Fonds retenus, verrouillés le temps de la répartition.
  SELECT COALESCE(SUM(h.primary_amount_cents), 0), COUNT(*) INTO v_held_cents, v_rows
  FROM public.collab_night_held_rows(c.event_id) h;
  IF v_rows > 0 THEN
    PERFORM 1 FROM public.revenue_distributions d
    WHERE d.id IN (SELECT h.id FROM public.collab_night_held_rows(c.event_id) h) FOR UPDATE;
  END IF;

  SELECT p.stripe_connect_account_id, COALESCE(p.stripe_connect_charges_enabled, false)
    INTO v_org_acct, v_org_ready
  FROM public.profiles p WHERE p.id = c.organizer_user_id;

  IF v_org_acct IS NOT NULL AND v_org_ready THEN
    v_online := LEAST(v_due_cents, v_held_cents);
  END IF;
  v_sepa_cents := v_due_cents - v_online;

  -- Le reste passe par SEPA : il faut un IBAN organisateur, posé depuis > 24 h.
  IF v_sepa_cents > 0 THEN
    SELECT iban, iban_changed_at INTO v_iban, v_iban_chg
    FROM public.organizer_payout_details WHERE user_id = c.organizer_user_id;
    IF v_iban IS NULL OR length(trim(v_iban)) < 8 THEN RAISE EXCEPTION 'organizer_iban_missing'; END IF;
    IF v_iban_chg IS NOT NULL AND v_iban_chg > now() - interval '24 hours' THEN
      RAISE EXCEPTION 'iban_recently_changed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.collab_table_settlements
      WHERE event_id = c.event_id AND status IN ('pending', 'approved', 'disputed')
    ) THEN
      RAISE EXCEPTION 'settlement_already_open';
    END IF;
  END IF;

  -- Répartition du montant en ligne au PRORATA de chaque jambe retenue. On
  -- distribue d'abord la part entière de chaque ligne, puis les centimes de
  -- reste aux plus grosses lignes : la somme des jambes organisateur vaut
  -- exactement v_online, et aucune ligne ne dépasse ce qu'elle porte.
  IF v_online > 0 THEN
    FOR r IN
      SELECT h.id, h.primary_amount_cents AS p
      FROM public.collab_night_held_rows(c.event_id) h
      ORDER BY h.primary_amount_cents DESC, h.id
    LOOP
      v_sum_base := v_sum_base + FLOOR(r.p::numeric * v_online / v_held_cents)::bigint;
    END LOOP;
    v_remainder := v_online - v_sum_base;

    FOR r IN
      SELECT h.id, h.primary_amount_cents AS p
      FROM public.collab_night_held_rows(c.event_id) h
      ORDER BY h.primary_amount_cents DESC, h.id
    LOOP
      v_idx := v_idx + 1;
      v_org_cents := FLOOR(r.p::numeric * v_online / v_held_cents)::bigint
        + CASE WHEN v_idx <= v_remainder THEN 1 ELSE 0 END;
      v_org_cents := LEAST(v_org_cents, r.p);

      UPDATE public.revenue_distributions SET
        primary_amount_cents = (r.p - v_org_cents)::integer,
        primary_transfer_status = CASE WHEN r.p - v_org_cents > 0 THEN 'scheduled' ELSE 'not_required' END,
        primary_transfer_error = NULL,
        secondary_account_id = CASE WHEN v_org_cents > 0 THEN v_org_acct ELSE secondary_account_id END,
        secondary_amount_cents = v_org_cents::integer,
        secondary_recipient_kind = CASE WHEN v_org_cents > 0 THEN 'organizer' ELSE secondary_recipient_kind END,
        secondary_recipient_organizer_id = CASE WHEN v_org_cents > 0 THEN c.organizer_user_id ELSE secondary_recipient_organizer_id END,
        secondary_transfer_status = CASE WHEN v_org_cents > 0 THEN 'scheduled' ELSE 'not_required' END,
        secondary_transfer_error = NULL,
        transfers_release_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('night_closing_id', c.id, 'night_closing_organizer_cents', v_org_cents),
        updated_at = now()
      WHERE id = r.id;
    END LOOP;
  END IF;

  -- Tout ce qui reste retenu sur cette soirée (part club, lignes sans part
  -- organisateur) est libéré maintenant : le décompte est le seul verrou.
  UPDATE public.revenue_distributions SET
    transfers_release_at = now(),
    primary_transfer_status = CASE WHEN primary_transfer_status = 'failed' THEN 'scheduled' ELSE primary_transfer_status END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('night_closing_id', c.id),
    updated_at = now()
  WHERE event_id = c.event_id
    AND item_type IN ('ticket', 'table')
    AND split_mode = 'separate'
    AND transfers_release_at IS NULL;

  -- Le reste dû par virement : un lot du cycle existant, à déclarer par le club.
  IF v_sepa_cents > 0 THEN
    v_ref := public.build_collab_settlement_reference(c.organizer_user_id);
    INSERT INTO public.collab_table_settlements (
      event_id, contract_id, venue_id, organizer_user_id,
      amount, organizer_pct_applied, night_revenue, organizer_theoretical, organizer_prepaid,
      breakdown, status, transfer_reference, created_by, kind, closing_id
    ) VALUES (
      c.event_id, c.contract_id, c.venue_id, c.organizer_user_id,
      ROUND(v_sepa_cents / 100.0, 2), v_pct, ROUND(v_total, 2), v_due, ROUND(v_online / 100.0, 2),
      jsonb_build_object(
        'kind', 'night_closing', 'closing_id', c.id,
        'yuno_tickets', v_fig.tickets, 'yuno_tables', v_fig.tables, 'yuno_drinks', v_fig.drinks,
        'declared_bar', c.declared_bar, 'declared_door_tickets', c.declared_door_tickets,
        'declared_door_count', c.declared_door_count,
        'declared_tables_extra', c.declared_tables_extra, 'declared_other', c.declared_other,
        'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
        'held', ROUND(v_held_cents / 100.0, 2), 'online', ROUND(v_online / 100.0, 2),
        'computed_at', now()
      ),
      'pending', v_ref, auth.uid(), 'night_closing', c.id
    ) RETURNING id INTO v_settle_id;
  END IF;

  UPDATE public.collab_night_closings SET
    status = 'accepted', accepted_at = now(), accepted_by = auth.uid(),
    disputed_at = NULL, dispute_reason = NULL,
    yuno_tickets = v_fig.tickets, yuno_tables = v_fig.tables, yuno_drinks = v_fig.drinks,
    total_revenue = ROUND(v_total, 2), tier_pct = v_pct,
    tiers_mode = COALESCE(v_rules->'remuneration'->>'tiers_mode', 'flat'),
    organizer_due = v_due,
    held_amount = ROUND(v_held_cents / 100.0, 2),
    online_amount = ROUND(v_online / 100.0, 2),
    sepa_amount = ROUND(v_sepa_cents / 100.0, 2),
    settlement_id = v_settle_id
  WHERE id = c.id;

  -- Libération immédiate des transferts Stripe (même appel que le cron horaire).
  -- Best-effort : le cron repasse de toute façon à H+07.
  BEGIN
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('task', 'release_held_transfers')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT display_name INTO v_org_name FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
  BEGIN
    PERFORM public.notify_collab_party('venue', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Décompte de soirée accepté',
      COALESCE(v_org_name, 'L''organisateur') || ' a accepté le décompte de « ' || COALESCE(v_title, 'la soirée') || ' » : '
        || to_char(ROUND(v_total, 2), 'FM999G999G990D00') || ' € au total, palier ' || v_pct || ' %. '
        || CASE WHEN v_online > 0 THEN to_char(ROUND(v_online / 100.0, 2), 'FM999G999G990D00') || ' € partent des ventes Yuno retenues. ' ELSE '' END
        || CASE WHEN v_sepa_cents > 0 THEN 'Reste ' || to_char(ROUND(v_sepa_cents / 100.0, 2), 'FM999G999G990D00') || ' € à virer (référence dans la carte Décompte).' ELSE 'Rien à virer.' END,
      'high', 'collab_night_closing', c.id,
      jsonb_build_object('event_id', c.event_id, 'closing_id', c.id, 'settlement_id', v_settle_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'accepted', true, 'closing_id', c.id,
    'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
    'held', ROUND(v_held_cents / 100.0, 2),
    'online', ROUND(v_online / 100.0, 2),
    'sepa', ROUND(v_sepa_cents / 100.0, 2),
    'settlement_id', v_settle_id
  );
END;
$function$;

-- amend_event_collab_contract : 1
CREATE OR REPLACE FUNCTION public.amend_event_collab_contract(p_contract_id uuid, p_split_rules jsonb, p_cancellation_policy text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_is_org   := public.collab_org_can_act(c.organizer_user_id);
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
END; $function$;

-- cancel_collab_amendment : 1
CREATE OR REPLACE FUNCTION public.cancel_collab_amendment(p_amendment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a public.event_collab_amendments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avenant introuvable'; END IF;
  IF a.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Un avenant déjà en vigueur ne s''annule pas : proposez-en un nouveau';
  END IF;
  IF NOT (public.is_venue_owner(auth.uid(), a.venue_id) OR public.collab_org_can_act(a.organizer_user_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.event_collab_amendments SET status = 'cancelled' WHERE id = p_amendment_id;
END; $function$;

-- cancel_event_collab_contract : 1
CREATE OR REPLACE FUNCTION public.cancel_event_collab_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.event_collab_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (c.created_by = auth.uid() OR public.collab_org_can_act(c.organizer_user_id)
          OR public.is_venue_owner(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures') THEN
    RAISE EXCEPTION 'Impossible d''annuler après activation (une vente a pu avoir lieu)';
  END IF;
  UPDATE public.event_collab_contracts SET status = 'cancelled' WHERE id = p_contract_id;
  -- Libère le GUARD (purge la proposition en attente).
  UPDATE public.events
     SET revenue_split_proposal = NULL, split_proposed_by = NULL, split_proposed_at = NULL,
         split_approved_by_venue = false, split_approved_by_organizer = false
   WHERE id = c.event_id AND revenue_split_rules IS NULL;
END; $function$;

-- compute_collab_night_closing : 1
CREATE OR REPLACE FUNCTION public.compute_collab_night_closing(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_rules      jsonb;
  v_ended      boolean;
  v_end_at     timestamptz;
  v_fig        record;
  v_closing    public.collab_night_closings%ROWTYPE;
  v_has_row    boolean := false;
  v_held_cents bigint;
  v_org_acct   text;
  v_org_ready  boolean;
  v_has_iban   boolean;
  v_total      numeric;
  v_pct        numeric;
  v_due        numeric;
  v_online     numeric;
  v_sepa       numeric;
  v_settlement jsonb;
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_a_collab');
  END IF;

  IF NOT (
    public.is_super_admin()
    OR public.collab_org_can_act(v_org_id)
    OR public.is_venue_owner(auth.uid(), v_venue_id)
    OR public.can_manage_venue(auth.uid(), v_venue_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at), COALESCE(end_at, start_at) < now()
    INTO v_rules, v_end_at, v_ended
  FROM public.events WHERE id = p_event_id;

  IF v_rules IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_contract');
  END IF;
  IF NOT public.is_tiered_collab(v_rules) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_tiered');
  END IF;

  SELECT * INTO v_fig FROM public.collab_night_yuno_figures(p_event_id);

  SELECT * INTO v_closing FROM public.collab_night_closings WHERE event_id = p_event_id;
  v_has_row := FOUND;

  SELECT COALESCE(SUM(h.primary_amount_cents), 0) INTO v_held_cents
  FROM public.collab_night_held_rows(p_event_id) h;

  SELECT p.stripe_connect_account_id, COALESCE(p.stripe_connect_charges_enabled, false)
    INTO v_org_acct, v_org_ready
  FROM public.profiles p WHERE p.id = v_org_id;

  SELECT (iban IS NOT NULL AND length(trim(iban)) >= 8) INTO v_has_iban
  FROM public.organizer_payout_details WHERE user_id = v_org_id;

  -- Projection : chiffres figés si accepté, sinon Yuno live + déclaration courante.
  IF v_has_row AND v_closing.status = 'accepted' THEN
    v_total  := v_closing.total_revenue;
    v_pct    := v_closing.tier_pct;
    v_due    := v_closing.organizer_due;
    v_online := v_closing.online_amount;
    v_sepa   := v_closing.sepa_amount;
  ELSE
    v_total := v_fig.tickets + v_fig.tables + v_fig.drinks
      + CASE WHEN v_has_row THEN v_closing.declared_bar + v_closing.declared_door_tickets
                                 + v_closing.declared_tables_extra + v_closing.declared_other
             ELSE 0 END;
    SELECT tp.pct, tp.amount INTO v_pct, v_due FROM public.collab_tier_pct(v_rules, v_total) tp;
    v_online := CASE WHEN v_org_acct IS NOT NULL AND v_org_ready
                     THEN LEAST(v_due, ROUND(v_held_cents / 100.0, 2)) ELSE 0 END;
    v_sepa := ROUND(v_due - v_online, 2);
  END IF;

  IF v_has_row AND v_closing.settlement_id IS NOT NULL THEN
    SELECT to_jsonb(x) INTO v_settlement FROM (
      SELECT id, status, amount, transfer_reference, confirm_due_at,
             approved_at, paid_at, disputed_at, dispute_reason, created_at
      FROM public.collab_table_settlements
      WHERE id = v_closing.settlement_id
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'event_ended', v_ended,
    'end_at', v_end_at,
    'tiers', v_rules->'remuneration'->'tiers',
    'tiers_mode', COALESCE(v_rules->'remuneration'->>'tiers_mode', 'flat'),
    'yuno', jsonb_build_object(
      'tickets', v_fig.tickets, 'tickets_count', v_fig.tickets_count,
      'tables', v_fig.tables, 'tables_count', v_fig.tables_count,
      'drinks', v_fig.drinks, 'drinks_count', v_fig.drinks_count
    ),
    'held_amount', ROUND(v_held_cents / 100.0, 2),
    'organizer_stripe_ready', COALESCE(v_org_acct IS NOT NULL AND v_org_ready, false),
    'organizer_has_iban', COALESCE(v_has_iban, false),
    'projection', jsonb_build_object(
      'total', ROUND(v_total, 2), 'pct', v_pct, 'due', v_due,
      'online', v_online, 'sepa', v_sepa
    ),
    'closing', CASE WHEN v_has_row THEN jsonb_build_object(
      'id', v_closing.id, 'status', v_closing.status, 'revision', v_closing.revision,
      'declared_bar', v_closing.declared_bar,
      'declared_door_count', v_closing.declared_door_count,
      'declared_door_tickets', v_closing.declared_door_tickets,
      'declared_tables_extra', v_closing.declared_tables_extra,
      'declared_other', v_closing.declared_other,
      'declared_other_label', v_closing.declared_other_label,
      'declared_note', v_closing.declared_note,
      'declared_evidence', v_closing.declared_evidence,
      'declared_at', v_closing.declared_at,
      'yuno_tickets', v_closing.yuno_tickets, 'yuno_tables', v_closing.yuno_tables,
      'yuno_drinks', v_closing.yuno_drinks,
      'total_revenue', v_closing.total_revenue, 'tier_pct', v_closing.tier_pct,
      'organizer_due', v_closing.organizer_due, 'held_amount', v_closing.held_amount,
      'online_amount', v_closing.online_amount, 'sepa_amount', v_closing.sepa_amount,
      'accepted_at', v_closing.accepted_at, 'disputed_at', v_closing.disputed_at,
      'dispute_reason', v_closing.dispute_reason,
      'settlement_id', v_closing.settlement_id
    ) END,
    'settlement', v_settlement
  );
END;
$function$;

-- compute_collab_table_settlement : 1
CREATE OR REPLACE FUNCTION public.compute_collab_table_settlement(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_org_id   uuid;
  v_rules    jsonb;
  v_basis    text;
  v_pct      numeric;
  v_ended    boolean;
  v_count    int;
  v_revenue  numeric;
  v_theory   numeric;
  v_prepaid  numeric;
  v_has_iban boolean;
  v_open     jsonb;
  v_settled  numeric;
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_a_collab');
  END IF;

  IF NOT (
    public.is_super_admin()
    OR public.collab_org_can_act(v_org_id)
    OR public.is_venue_owner(auth.uid(), v_venue_id)
    OR public.can_manage_venue(auth.uid(), v_venue_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT revenue_split_rules, COALESCE(end_at, start_at) < now()
    INTO v_rules, v_ended
  FROM public.events WHERE id = p_event_id;

  IF v_rules IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_contract');
  END IF;
  v_basis := COALESCE(v_rules->'tables'->>'basis', 'deposit');
  IF v_basis <> 'total_spend' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'deposit_basis');
  END IF;
  IF NOT public.split_pillar_enabled(v_rules, 'tables') THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'tables_pillar_disabled');
  END IF;
  v_pct := COALESCE(NULLIF(v_rules->'tables'->>'organizer_pct', '')::numeric, 0);
  IF v_pct <= 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_organizer_share');
  END IF;

  -- Uniquement les réservations pas encore réglées par un lot antérieur.
  SELECT COUNT(*),
         COALESCE(SUM(l.night_revenue), 0),
         COALESCE(SUM(ROUND(l.night_revenue * v_pct / 100.0, 2)), 0),
         COALESCE(SUM(l.organizer_prepaid), 0)
    INTO v_count, v_revenue, v_theory, v_prepaid
  FROM public.collab_table_settlement_lines(p_event_id) l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.collab_table_settlement_items i
    WHERE i.table_reservation_id = l.reservation_id
  );

  SELECT COALESCE(SUM(amount), 0) INTO v_settled
  FROM public.collab_table_settlements
  WHERE event_id = p_event_id AND status = 'paid';

  SELECT to_jsonb(x) INTO v_open FROM (
    SELECT id, status, amount, transfer_reference, confirm_due_at,
           approved_at, disputed_at, dispute_reason, created_at
    FROM public.collab_table_settlements
    WHERE event_id = p_event_id AND status IN ('pending', 'approved', 'disputed')
    LIMIT 1
  ) x;

  SELECT (iban IS NOT NULL AND length(trim(iban)) >= 8) INTO v_has_iban
  FROM public.organizer_payout_details WHERE user_id = v_org_id;

  RETURN jsonb_build_object(
    'eligible', true,
    'event_ended', v_ended,
    'basis', v_basis,
    'organizer_pct', v_pct,
    'reservations', v_count,
    'night_revenue', v_revenue,
    'organizer_theoretical', v_theory,
    'organizer_prepaid', v_prepaid,
    'amount_due', ROUND(v_theory - v_prepaid, 2),
    'already_settled', v_settled,
    'organizer_has_iban', COALESCE(v_has_iban, false),
    'open_settlement', v_open
  );
END;
$function$;

-- create_event_collab_contract : 1
CREATE OR REPLACE FUNCTION public.create_event_collab_contract(p_event_id uuid, p_split_rules jsonb DEFAULT NULL::jsonb, p_cancellation_policy text DEFAULT 'pro_rata_refund'::text, p_responsibilities jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_partnership uuid;
  v_part_resp  jsonb;
  v_resp       jsonb;
  v_id         uuid;
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
  v_is_org   := public.collab_org_can_act(v_org_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c
              WHERE c.event_id = p_event_id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'Un contrat existe déjà pour cette soirée';
  END IF;

  SELECT id, default_split_rules, default_responsibilities
    INTO v_partnership, v_rules, v_part_resp
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));
  v_rules := public.enforce_drinks_alcohol_gate(v_rules, v_org_id);

  -- Le payload d'abord, le défaut du partenariat ensuite. NULL reste légal :
  -- c'est le préréglage du mode qui s'applique alors.
  v_resp := COALESCE(p_responsibilities, v_part_resp);

  INSERT INTO public.event_collab_contracts (
    event_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy, auto_release_at, responsibilities,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_event_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy,
    (SELECT COALESCE(end_at, start_at) + interval '2 days' FROM public.events WHERE id = p_event_id),
    v_resp,
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  UPDATE public.events
     SET revenue_split_proposal = v_rules,
         split_proposed_by = auth.uid(),
         split_proposed_at = now(),
         split_approved_by_venue = v_is_venue,
         split_approved_by_organizer = v_is_org,
         collab_responsibilities = COALESCE(v_resp, collab_responsibilities)
   WHERE id = p_event_id;

  RETURN v_id;
END; $function$;

-- create_event_collab_series_contract : 1
CREATE OR REPLACE FUNCTION public.create_event_collab_series_contract(p_template_id uuid, p_split_rules jsonb DEFAULT NULL::jsonb, p_cancellation_policy text DEFAULT 'pro_rata_refund'::text, p_responsibilities jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tpl          public.owner_recurring_templates%ROWTYPE;
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_part_resp  jsonb;
  v_resp       jsonb;
  v_partnership uuid;
  v_id         uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cancellation_policy NOT IN ('pro_rata_refund','no_refund_after_event') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT * INTO tpl FROM public.owner_recurring_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template introuvable'; END IF;

  v_venue_id := tpl.venue_id;
  v_org_id   := tpl.partner_organizer_id;
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Ce template n''est pas une collaboration récurrente club ↔ organisateur';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := public.collab_org_can_act(v_org_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_series_contracts s
              WHERE s.template_id = p_template_id AND s.status NOT IN ('cancelled','terminated')) THEN
    RAISE EXCEPTION 'Un contrat-cadre existe déjà pour cette série';
  END IF;

  SELECT id, default_split_rules, default_responsibilities
    INTO v_partnership, v_rules, v_part_resp
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, tpl.revenue_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));
  v_rules := public.enforce_drinks_alcohol_gate(v_rules, v_org_id);

  v_resp := COALESCE(p_responsibilities, tpl.collab_responsibilities, v_part_resp);

  INSERT INTO public.event_collab_series_contracts (
    template_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy, responsibilities,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_template_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy, v_resp,
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;

-- dispute_collab_night_closing : 1
CREATE OR REPLACE FUNCTION public.dispute_collab_night_closing(p_closing_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c       public.collab_night_closings%ROWTYPE;
  v_title text;
  v_org   text;
BEGIN
  SELECT * INTO c FROM public.collab_night_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'closing_not_found'; END IF;
  IF NOT public.collab_org_can_act(c.organizer_user_id) THEN RAISE EXCEPTION 'only_organizer_can_dispute'; END IF;
  IF c.status <> 'declared' THEN RAISE EXCEPTION 'closing_not_declared'; END IF;

  UPDATE public.collab_night_closings
  SET status = 'disputed', disputed_at = now(), dispute_reason = NULLIF(left(trim(COALESCE(p_reason, '')), 500), '')
  WHERE id = p_closing_id;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT display_name INTO v_org FROM public.organizer_profiles WHERE user_id = c.organizer_user_id;
  BEGIN
    PERFORM public.notify_collab_party('venue', c.venue_id, c.organizer_user_id, c.event_id,
      'collab_request', 'Décompte de soirée contesté',
      COALESCE(v_org, 'L''organisateur') || ' conteste le décompte de « ' || COALESCE(v_title, 'la soirée') || ' »'
        || CASE WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ' : ' || left(trim(p_reason), 200) ELSE '.' END
        || ' Corrige la déclaration pour relancer la validation.',
      'high', 'collab_night_closing', c.id,
      jsonb_build_object('event_id', c.event_id, 'closing_id', c.id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('disputed', true, 'closing_id', c.id);
END;
$function$;

-- manage_event_collaboration : 2
CREATE OR REPLACE FUNCTION public.manage_event_collaboration(p_event_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e          public.events%ROWTYPE;
  v_is_party boolean;
  v_has_sales boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_action NOT IN ('pause','resume','remove') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  -- Doit être une collaboration club <-> organisateur (un partenaire attaché).
  IF NOT ((e.venue_id IS NOT NULL AND e.partner_organizer_id IS NOT NULL)
       OR (e.organizer_user_id IS NOT NULL AND e.partner_venue_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Cette soirée n''est pas une collaboration';
  END IF;

  -- Le demandeur doit être l'une des deux parties (club lead/partenaire OU orga).
  v_is_party :=
       (e.venue_id IS NOT NULL        AND public.is_venue_owner(auth.uid(), e.venue_id))
    OR (e.partner_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), e.partner_venue_id))
    OR public.collab_org_can_act(e.organizer_user_id)
    OR public.collab_org_can_act(e.partner_organizer_id);
  IF NOT v_is_party AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- RESUME ne touche pas aux ventes : réactivation simple.
  IF p_action = 'resume' THEN
    UPDATE public.events
       SET collab_paused_at = NULL, is_active = true
     WHERE id = p_event_id;
    RETURN;
  END IF;

  -- PAUSE et REMOVE unilatéraux : réservés au super admin. Les parties passent
  -- par le double consentement (request_event_collab_action / respond_...).
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'COLLAB_REQUIRES_CONSENT: cette action nécessite l''accord des deux parties — utilise la demande de pause/suppression du dashboard collab';
  END IF;

  -- PAUSE et REMOVE sont verrouillés dès qu'il y a un vrai achat.
  v_has_sales :=
       EXISTS (SELECT 1 FROM public.tickets t
                WHERE t.event_id = p_event_id AND t.status = 'paid')
    OR EXISTS (SELECT 1 FROM public.table_reservations tr
                WHERE tr.event_id = p_event_id AND tr.status IN ('paid','confirmed'))
    OR e.split_locked_at IS NOT NULL;
  IF v_has_sales THEN
    RAISE EXCEPTION 'COLLAB_LOCKED_BY_SALES: des billets ou tables ont déjà été vendus pour cette soirée';
  END IF;

  IF p_action = 'pause' THEN
    UPDATE public.events
       SET collab_paused_at = now(), is_active = false
     WHERE id = p_event_id;
    RETURN;
  END IF;

  -- REMOVE : annuler le contrat, détacher le partenaire, purger le split →
  -- la soirée redevient une soirée solo du lead.
  UPDATE public.event_collab_contracts
     SET status = 'cancelled'
   WHERE event_id = p_event_id AND status <> 'cancelled';

  UPDATE public.events SET
       partner_organizer_id        = NULL,
       partner_venue_id            = NULL,
       event_mode                  = NULL,
       collab_paused_at            = NULL,
       revenue_split_proposal      = NULL,
       revenue_split_rules         = NULL,
       split_proposed_by           = NULL,
       split_proposed_at           = NULL,
       split_approved_by_venue     = false,
       split_approved_by_organizer = false
   WHERE id = p_event_id;
END; $function$;

-- notify_collab_ops_online : 1
CREATE OR REPLACE FUNCTION public.notify_collab_ops_online()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_owner      uuid;
  v_recipient  text;
  v_title      text;
  v_actor      text;
  v_event_title text;
  v_tables_on  boolean;
  v_tickets_on boolean;
BEGIN
  -- Résoudre les deux parties (lead OU partner). Si l'une manque, ce n'est pas
  -- une co-soirée → rien à notifier.
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
    FROM public.collab_event_parties(NEW.id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_tables_on  := (NEW.tables_enabled   IS TRUE AND OLD.tables_enabled   IS DISTINCT FROM TRUE);
  v_tickets_on := (NEW.ticketing_enabled IS TRUE AND OLD.ticketing_enabled IS DISTINCT FROM TRUE);
  IF NOT v_tables_on AND NOT v_tickets_on THEN
    RETURN NEW;
  END IF;

  -- Qui a agi ? → notifier l'autre. Par défaut on prévient le club (cas le plus
  -- courant : l'orga active).
  SELECT owner_id INTO v_owner FROM public.venues WHERE id = v_venue_id;
  IF public.collab_org_can_act(v_org_id) THEN
    v_recipient := 'venue';
  ELSIF auth.uid() = v_owner THEN
    v_recipient := 'organizer';
  ELSE
    v_recipient := 'venue';
  END IF;

  SELECT title INTO v_event_title FROM public.events WHERE id = NEW.id;
  v_event_title := COALESCE(v_event_title, 'une soirée');

  IF v_recipient = 'organizer' THEN
    SELECT name INTO v_actor FROM public.venues WHERE id = v_venue_id;
    v_actor := COALESCE(v_actor, 'Le club');
  ELSE
    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = v_org_id;
    v_actor := COALESCE(v_actor, 'L''organisateur');
  END IF;

  IF v_tables_on THEN
    PERFORM public.notify_collab_party(
      v_recipient, v_venue_id, v_org_id, NEW.id,
      'collab_tables_online', 'Vente de tables en ligne',
      v_actor || ' a activé la vente de tables pour « ' || v_event_title || ' ».',
      'normal', 'event', NEW.id,
      jsonb_build_object('event_id', NEW.id, 'kind', 'tables')
    );
  END IF;

  IF v_tickets_on THEN
    PERFORM public.notify_collab_party(
      v_recipient, v_venue_id, v_org_id, NEW.id,
      'collab_tickets_online', 'Billetterie en ligne',
      v_actor || ' a ouvert la billetterie de « ' || v_event_title || ' ».',
      'normal', 'event', NEW.id,
      jsonb_build_object('event_id', NEW.id, 'kind', 'tickets')
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- propose_collab_amendment : 1
CREATE OR REPLACE FUNCTION public.propose_collab_amendment(p_contract_id uuid DEFAULT NULL::uuid, p_series_contract_id uuid DEFAULT NULL::uuid, p_responsibilities jsonb DEFAULT NULL::jsonb, p_split_rules jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id  text;
  v_org_id    uuid;
  v_status    text;
  v_prev_resp jsonb;
  v_prev_split jsonb;
  v_is_venue  boolean;
  v_is_org    boolean;
  v_split     jsonb;
  v_id        uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF (p_contract_id IS NOT NULL) = (p_series_contract_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cible invalide : un contrat d''occurrence OU un contrat-cadre';
  END IF;
  IF p_responsibilities IS NULL AND p_split_rules IS NULL THEN
    RAISE EXCEPTION 'Un avenant doit changer au moins une chose';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    SELECT venue_id, organizer_user_id, status, responsibilities, split_rules
      INTO v_venue_id, v_org_id, v_status, v_prev_resp, v_prev_split
      FROM public.event_collab_contracts WHERE id = p_contract_id;
  ELSE
    SELECT venue_id, organizer_user_id, status, responsibilities, split_rules
      INTO v_venue_id, v_org_id, v_status, v_prev_resp, v_prev_split
      FROM public.event_collab_series_contracts WHERE id = p_series_contract_id;
  END IF;
  IF v_venue_id IS NULL THEN RAISE EXCEPTION 'Contrat introuvable'; END IF;

  -- On n'amende que ce qui EXISTE et ENGAGE. Un contrat encore en attente de
  -- signature se modifie en le refusant et en le re-proposant ; un contrat
  -- résilié ou clos ne lie plus personne.
  --
  -- 'locked' est ACCEPTÉ : c'est le statut d'une occurrence dont les ventes ont
  -- commencé (trigger de 20260622220000). Y interdire l'avenant reviendrait à
  -- geler les responsabilités dès le premier billet vendu — or déplacer la main
  -- sur l'affiche d'une soirée qui vend est précisément le cas où la souplesse
  -- sert. Le partage, lui, ne bougera pas sur cette soirée : apply_ ne réécrit
  -- revenue_split_rules que si split_locked_at IS NULL.
  IF v_status NOT IN ('active','locked') THEN
    RAISE EXCEPTION 'Seul un contrat en vigueur peut recevoir un avenant (statut=%)', v_status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := public.collab_org_can_act(v_org_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_collab_amendments a
     WHERE a.status = 'pending_signatures'
       AND (a.contract_id = p_contract_id OR a.series_contract_id = p_series_contract_id)
  ) THEN
    RAISE EXCEPTION 'Un avenant est déjà en attente de signature sur ce contrat';
  END IF;

  -- Un avenant sur l'ARGENT visant une soirée unique déjà vendue ne s'appliquerait
  -- à rien (apply_ respecte split_locked_at). Le refuser ici plutôt que de le
  -- laisser signer dans le vide : faire contresigner un document sans effet est
  -- pire que de refuser, ça donne aux deux parties une preuve de rien.
  IF p_split_rules IS NOT NULL AND p_contract_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.event_collab_contracts c
      JOIN public.events e ON e.id = c.event_id
      WHERE c.id = p_contract_id AND e.split_locked_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Les ventes de cette soirée ont commencé : le partage des revenus ne peut plus changer'
        USING HINT = 'Un avenant sur la répartition des responsabilités reste possible.';
    END IF;
  END IF;

  v_split := public.enforce_drinks_alcohol_gate(p_split_rules, v_org_id);

  INSERT INTO public.event_collab_amendments (
    contract_id, series_contract_id, venue_id, organizer_user_id,
    status, responsibilities, split_rules,
    prev_responsibilities, prev_split_rules, reason, proposed_by,
    venue_signed_at, venue_signed_by, venue_signed_ip, venue_signed_user_agent,
    org_signed_at, org_signed_by, org_signed_ip, org_signed_user_agent
  ) VALUES (
    p_contract_id, p_series_contract_id, v_venue_id, v_org_id,
    'pending_signatures', p_responsibilities, v_split,
    v_prev_resp, v_prev_split, p_reason, auth.uid(),
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_venue THEN p_ip END, CASE WHEN v_is_venue THEN p_user_agent END,
    CASE WHEN v_is_org THEN now() END, CASE WHEN v_is_org THEN auth.uid() END,
    CASE WHEN v_is_org THEN p_ip END, CASE WHEN v_is_org THEN p_user_agent END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;

-- request_event_collab_action : 1
CREATE OR REPLACE FUNCTION public.request_event_collab_action(p_event_id uuid, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id     text;
  v_org_id       uuid;
  v_is_venue     boolean;
  v_is_org       boolean;
  v_role         text;
  v_req_id       uuid;
  v_title        text;
  v_actor        text;
  v_label        text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_action NOT IN ('pause','delete') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
    FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cette soirée n''est pas une collaboration';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := public.collab_org_can_act(v_org_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_role := CASE WHEN v_is_org THEN 'organizer' ELSE 'venue' END;

  IF p_action = 'delete' AND public.collab_event_has_sales(p_event_id) THEN
    RAISE EXCEPTION 'COLLAB_DELETE_HAS_SALES: cette soirée a déjà vendu — mettez-la en pause ou annulez-la (remboursements), elle ne se supprime plus';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_action_requests r
             WHERE r.event_id = p_event_id AND r.status IN ('pending','scheduled')) THEN
    RAISE EXCEPTION 'COLLAB_ACTION_PENDING: une demande est déjà en cours pour cette soirée';
  END IF;

  INSERT INTO public.event_collab_action_requests (
    event_id, action, status, requested_by, requested_by_role,
    venue_approved, organizer_approved, venue_id, organizer_user_id
  ) VALUES (
    p_event_id, p_action, 'pending', auth.uid(), v_role,
    (v_role = 'venue'), (v_role = 'organizer'), v_venue_id, v_org_id
  ) RETURNING id INTO v_req_id;

  SELECT title INTO v_title FROM public.events WHERE id = p_event_id;
  v_title := COALESCE(v_title, 'une soirée');
  v_label := CASE WHEN p_action = 'pause' THEN 'mettre en pause' ELSE 'supprimer' END;

  -- Notifier la partie adverse, dont l'accord est requis.
  IF v_role = 'venue' THEN
    SELECT name INTO v_actor FROM public.venues WHERE id = v_venue_id;
    PERFORM public.notify_collab_party('organizer', v_venue_id, v_org_id, p_event_id,
      'collab_action_request', 'Demande sur une co-soirée',
      COALESCE(v_actor, 'Le club') || ' souhaite ' || v_label || ' « ' || v_title || ' ». Ton accord est requis.',
      'high', 'event_collab_action', v_req_id,
      jsonb_build_object('action', p_action, 'event_id', p_event_id, 'requested_by_role', v_role));
  ELSE
    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = v_org_id;
    PERFORM public.notify_collab_party('venue', v_venue_id, v_org_id, p_event_id,
      'collab_action_request', 'Demande sur une co-soirée',
      COALESCE(v_actor, 'L''organisateur') || ' souhaite ' || v_label || ' « ' || v_title || ' ». Ton accord est requis.',
      'high', 'event_collab_action', v_req_id,
      jsonb_build_object('action', p_action, 'event_id', p_event_id, 'requested_by_role', v_role));
  END IF;

  RETURN v_req_id;
END; $function$;

-- respond_event_collab_action : 1
CREATE OR REPLACE FUNCTION public.respond_event_collab_action(p_request_id uuid, p_approve boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r          public.event_collab_action_requests%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_role     text;
  v_start    timestamptz;
  v_end      timestamptz;
  v_ongoing  boolean;
  v_both     boolean;
  v_title    text;
  v_label    text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.event_collab_action_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status NOT IN ('pending','scheduled') THEN
    RAISE EXCEPTION 'COLLAB_ACTION_RESOLVED: cette demande est déjà traitée';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), r.venue_id);
  v_is_org   := public.collab_org_can_act(r.organizer_user_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_role := CASE WHEN v_is_org THEN 'organizer' ELSE 'venue' END;

  SELECT title, start_at, end_at INTO v_title, v_start, v_end
    FROM public.events WHERE id = r.event_id;
  v_title := COALESCE(v_title, 'une soirée');
  v_label := CASE WHEN r.action = 'pause' THEN 'mise en pause' ELSE 'suppression' END;

  -- Refus (autre partie) ou annulation (demandeur) → on clôt la demande.
  IF NOT p_approve THEN
    UPDATE public.event_collab_action_requests
       SET status = CASE WHEN v_role = r.requested_by_role THEN 'cancelled' ELSE 'rejected' END,
           resolved_at = now(), updated_at = now()
     WHERE id = p_request_id;
    -- Prévenir la partie qui n'agit pas maintenant.
    IF v_role = 'venue' THEN
      PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
        'collab_action_rejected', 'Demande annulée',
        'La ' || v_label || ' de « ' || v_title || ' » n''aura pas lieu.',
        'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id));
    ELSE
      PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
        'collab_action_rejected', 'Demande annulée',
        'La ' || v_label || ' de « ' || v_title || ' » n''aura pas lieu.',
        'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id));
    END IF;
    RETURN 'cancelled';
  END IF;

  -- Approbation : poser le flag de MON côté.
  IF v_is_venue THEN
    UPDATE public.event_collab_action_requests SET venue_approved = true, updated_at = now() WHERE id = p_request_id;
  END IF;
  IF v_is_org THEN
    UPDATE public.event_collab_action_requests SET organizer_approved = true, updated_at = now() WHERE id = p_request_id;
  END IF;

  SELECT (venue_approved AND organizer_approved) INTO v_both
    FROM public.event_collab_action_requests WHERE id = p_request_id;
  IF NOT v_both THEN
    RETURN 'pending';  -- on attend encore l'autre partie
  END IF;

  -- Les deux ont accepté. Soirée EN COURS → différer après la fin.
  v_ongoing := (v_start IS NOT NULL AND now() >= v_start AND now() < v_end);
  IF v_ongoing THEN
    UPDATE public.event_collab_action_requests
       SET status = 'scheduled', scheduled_for = v_end, updated_at = now()
     WHERE id = p_request_id;
    PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_scheduled', 'Action programmée',
      'La ' || v_label || ' de « ' || v_title || ' » est validée. Elle s''appliquera à la fin de la soirée en cours.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id, 'scheduled_for', v_end));
    PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_scheduled', 'Action programmée',
      'La ' || v_label || ' de « ' || v_title || ' » est validée. Elle s''appliquera à la fin de la soirée en cours.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id, 'scheduled_for', v_end));
    RETURN 'scheduled';
  END IF;

  -- Sinon, exécution immédiate.
  PERFORM public._execute_event_collab_action(p_request_id);
  RETURN 'executed';
END; $function$;

-- sign_collab_amendment : 1
CREATE OR REPLACE FUNCTION public.sign_collab_amendment(p_amendment_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_terms_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          public.event_collab_amendments%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
BEGIN
  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avenant introuvable'; END IF;
  IF a.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Cet avenant n''attend pas de signature (statut=%)', a.status;
  END IF;

  -- ─── Partage figé depuis la première vente : un avenant ne peut plus le changer.
  IF a.contract_id IS NOT NULL AND a.split_rules IS NOT NULL
     AND a.split_rules IS DISTINCT FROM a.prev_split_rules
     AND EXISTS (SELECT 1 FROM public.event_collab_contracts cc
                   JOIN public.events e ON e.id = cc.event_id
                  WHERE cc.id = a.contract_id
                    AND (cc.status = 'locked' OR e.split_locked_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'AMENDMENT_SPLIT_LOCKED: le partage est figé depuis la première vente, cet avenant ne peut plus le modifier. Proposez un avenant sur les seules responsabilités.';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), a.venue_id);
  v_is_org   := public.collab_org_can_act(a.organizer_user_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_amendments
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_amendment_id;
  ELSE
    UPDATE public.event_collab_amendments
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_amendment_id;
  END IF;

  SELECT * INTO a FROM public.event_collab_amendments WHERE id = p_amendment_id;
  IF a.venue_signed_at IS NULL OR a.org_signed_at IS NULL THEN
    RETURN 'pending_signatures';
  END IF;

  -- Double signature → l'avenant prend effet et se fige.
  UPDATE public.event_collab_amendments
     SET status = 'active',
         effective_at = now(),
         terms_snapshot = jsonb_build_object(
           'responsibilities', a.responsibilities,
           'split_rules', a.split_rules,
           'prev_responsibilities', a.prev_responsibilities,
           'prev_split_rules', a.prev_split_rules,
           'reason', a.reason,
           'proposed_by', a.proposed_by,
           'venue_signed_at', a.venue_signed_at,
           'org_signed_at', a.org_signed_at,
           'terms_version', p_terms_version,
           'frozen_at', now()
         )
   WHERE id = p_amendment_id;

  PERFORM public.apply_collab_amendment(p_amendment_id);
  RETURN 'active';
END; $function$;

-- sign_event_collab_contract : 1
CREATE OR REPLACE FUNCTION public.sign_event_collab_contract(p_contract_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_terms_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c          public.event_collab_contracts%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Le contrat n''attend pas de signature (statut=%)', c.status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), c.venue_id);
  v_is_org   := public.collab_org_can_act(c.organizer_user_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_contracts
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
    UPDATE public.events SET split_approved_by_venue = true WHERE id = c.event_id;
  ELSE
    UPDATE public.event_collab_contracts
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
    UPDATE public.events SET split_approved_by_organizer = true WHERE id = c.event_id;
  END IF;

  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id;
  v_both := c.venue_signed_at IS NOT NULL AND c.org_signed_at IS NOT NULL;

  IF v_both THEN
    UPDATE public.event_collab_contracts
       SET status = 'active',
           terms_snapshot = jsonb_build_object(
             'split_rules', c.split_rules,
             'cancellation_policy', c.cancellation_policy,
             'currency', c.currency,
             'venue_id', c.venue_id,
             'organizer_user_id', c.organizer_user_id,
             'event_id', c.event_id,
             'venue_signed_at', c.venue_signed_at,
             'org_signed_at', c.org_signed_at,
             'terms_version', p_terms_version,
             'frozen_at', now()
           )
     WHERE id = p_contract_id;
    -- Le GUARD : copier la proposition dans les règles en vigueur + purger la proposition.
    UPDATE public.events
       SET revenue_split_rules = c.split_rules,
           revenue_split_proposal = NULL,
           split_proposed_by = NULL,
           split_proposed_at = NULL,
           split_approved_by_venue = false,
           split_approved_by_organizer = false
     WHERE id = c.event_id;
    RETURN 'active';
  END IF;

  RETURN 'pending_signatures';
END; $function$;

-- sign_event_collab_series_contract : 1
CREATE OR REPLACE FUNCTION public.sign_event_collab_series_contract(p_contract_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_terms_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c          public.event_collab_series_contracts%ROWTYPE;
  tpl        public.owner_recurring_templates%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Le contrat-cadre n''attend pas de signature (statut=%)', c.status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), c.venue_id);
  v_is_org   := public.collab_org_can_act(c.organizer_user_id);
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_series_contracts
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  ELSE
    UPDATE public.event_collab_series_contracts
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  END IF;

  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id;
  v_both := c.venue_signed_at IS NOT NULL AND c.org_signed_at IS NOT NULL;
  IF NOT v_both THEN RETURN 'pending_signatures'; END IF;

  SELECT * INTO tpl FROM public.owner_recurring_templates WHERE id = c.template_id;

  -- Geler les termes du contrat-cadre (identifie la série : jour + heure).
  UPDATE public.event_collab_series_contracts
     SET status = 'active',
         terms_snapshot = jsonb_build_object(
           'split_rules', c.split_rules,
           'cancellation_policy', c.cancellation_policy,
           'currency', c.currency,
           'venue_id', c.venue_id,
           'organizer_user_id', c.organizer_user_id,
           'template_id', c.template_id,
           'recurring', true,
           'day_of_week', tpl.day_of_week,
           'start_time', tpl.start_time,
           'venue_signed_at', c.venue_signed_at,
           'org_signed_at', c.org_signed_at,
           'terms_version', p_terms_version,
           'frozen_at', now()
         )
   WHERE id = p_contract_id;
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id;

  -- BALAYAGE : activer les contrats d'occurrence ENCORE en attente et SANS vente.
  -- Les occurrences déjà active/locked/closed (signées individuellement ou vendues)
  -- gardent leurs termes figés et sont exclues. terms_snapshot porte via_series →
  -- le trigger notify_collab_contract_signed les ignore (pas de spam).
  UPDATE public.event_collab_contracts oc
     SET status = 'active',
         venue_signed_at = COALESCE(oc.venue_signed_at, c.venue_signed_at),
         venue_signed_by = COALESCE(oc.venue_signed_by, c.venue_signed_by),
         org_signed_at   = COALESCE(oc.org_signed_at,   c.org_signed_at),
         org_signed_by   = COALESCE(oc.org_signed_by,   c.org_signed_by),
         split_rules     = c.split_rules,
         terms_snapshot  = COALESCE(c.terms_snapshot, '{}'::jsonb)
                            || jsonb_build_object('via_series', true, 'series_contract_id', c.id)
    FROM public.events e
   WHERE oc.event_id = e.id
     AND e.recurring_template_id = c.template_id
     AND e.partner_organizer_id = c.organizer_user_id
     AND oc.status = 'pending_signatures'
     AND e.split_locked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.revenue_distributions rd WHERE rd.event_id = e.id);

  -- Ouvrir le GUARD sur les events balayés : règles en vigueur + purge de la proposition.
  UPDATE public.events e
     SET revenue_split_rules = c.split_rules,
         revenue_split_proposal = NULL,
         split_proposed_by = NULL,
         split_proposed_at = NULL,
         split_approved_by_venue = false,
         split_approved_by_organizer = false
   WHERE e.recurring_template_id = c.template_id
     AND e.partner_organizer_id = c.organizer_user_id
     AND e.split_locked_at IS NULL
     AND e.revenue_split_rules IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.revenue_distributions rd WHERE rd.event_id = e.id);

  -- Le cadre est actif : générer les dates que le garde de
  -- generate_recurring_events retenait tant qu'il n'était pas signé. Elles
  -- naissent directement actives, sans repasser par une proposition par date.
  PERFORM public.generate_recurring_events(c.template_id);

  RETURN 'active';
END; $function$;

-- terminate_event_collab_series_contract : 1
CREATE OR REPLACE FUNCTION public.terminate_event_collab_series_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.event_collab_series_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_series_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (c.created_by = auth.uid() OR public.collab_org_can_act(c.organizer_user_id)
          OR public.is_venue_owner(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures','active') THEN
    RAISE EXCEPTION 'Le contrat-cadre est déjà clos (statut=%)', c.status;
  END IF;
  UPDATE public.event_collab_series_contracts
     SET status = CASE WHEN c.status = 'active' THEN 'terminated' ELSE 'cancelled' END,
         terminated_at = now(), terminated_by = auth.uid()
   WHERE id = p_contract_id;
END; $function$;

-- confirm_collab_settlement_received : 1
CREATE OR REPLACE FUNCTION public.confirm_collab_settlement_received(p_settlement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_status text;
  v_amount numeric;
BEGIN
  SELECT organizer_user_id, status, amount INTO v_org_id, v_status, v_amount
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  -- Un lot en litige reste confirmable : l'argent a pu arriver en retard.
  IF v_status NOT IN ('approved', 'disputed') THEN RAISE EXCEPTION 'settlement_not_declared'; END IF;
  IF NOT public.collab_org_can_act(v_org_id) THEN RAISE EXCEPTION 'only_organizer_can_confirm'; END IF;

  UPDATE public.collab_table_settlements
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
      disputed_at = NULL, dispute_reason = NULL
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object('confirmed', true, 'amount', v_amount);
END;
$function$;

-- dispute_collab_settlement : 1
CREATE OR REPLACE FUNCTION public.dispute_collab_settlement(p_settlement_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT organizer_user_id, status INTO v_org_id, v_status
  FROM public.collab_table_settlements WHERE id = p_settlement_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'settlement_not_declared'; END IF;
  IF NOT public.collab_org_can_act(v_org_id) THEN RAISE EXCEPTION 'only_organizer_can_dispute'; END IF;

  UPDATE public.collab_table_settlements
  SET status = 'disputed', disputed_at = now(), dispute_reason = left(COALESCE(p_reason, ''), 500)
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object('disputed', true, 'settlement_id', p_settlement_id);
END;
$function$;
