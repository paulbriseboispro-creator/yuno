-- Retour arrière des migrations de l'audit du 18/10 (20261021100000 → 20261024100100).
-- Définitions lues en prod le 18/10 AVANT les corrections (pg_get_functiondef).
-- À ne jouer que si une correction casse quelque chose : le bloc 1 ROUVRE la faille SEC-01.
-- Jouer dans une transaction, puis supabase db lint --linked.

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
