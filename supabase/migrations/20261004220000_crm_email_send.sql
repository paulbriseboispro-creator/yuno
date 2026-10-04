-- ============================================================================
-- Console Yuno CRM — écran Envoi (Audience, Planification, Vérification) et
-- débit des Yunits à la mise en file.
--
-- 1. crm_email_send_options : ce qu'on peut cocher à l'étape Audience — les
--    cinq cycles de vie (habitués, occasionnels, nouveaux, endormis, jamais
--    venus) et les segments enregistrés, chacun avec ses joignables et ses
--    taux d'ouverture et de clic sur 12 mois (muets sous 20 e-mails reçus).
-- 2. crm_email_audience_preview : le nombre exact de destinataires d'une
--    sélection, avec ce que retirent « ont déjà leur place » et « contactés
--    récemment ». MÊME règle que l'envoi (_crm_campaign_audience) : base
--    clients du CRM, joignable par e-mail, inscrit à la newsletter de la
--    portée, réunion des audiences.
-- 3. Débit des Yunits : enqueue_campaign_recipients débite, pour un compte au
--    produit CRM, le nombre d'adresses NOUVELLEMENT mises en file (après
--    consentement, liste de suppression et règles d'envoi). Solde court ⇒
--    l'exception crm_yunits_insufficient annule toute la mise en file : rien
--    ne part, rien n'est débité. Un e-mail refusé par le fournisseur (échec
--    définitif) est remboursé par mark_campaign_recipients_failed. Un test
--    ne passe pas par la file : il ne coûte rien. La Suite n'est pas touchée.
-- ============================================================================

-- ── 1. Options de l'étape Audience ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_email_send_options(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto jsonb;
  v_saved jsonb := '[]'::jsonb;
  s record;
  r record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  -- Joignables : la même porte que l'envoi (opt-in newsletter de la portée).
  DROP TABLE IF EXISTS _cso;
  CREATE TEMP TABLE _cso ON COMMIT DROP AS
  SELECT p.*, 0::integer AS open_n FROM _cp p
   WHERE p.email_ok AND EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = p.email AND ns.opted_in
        AND ns.venue_id IS NOT DISTINCT FROM p_venue_id
        AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id);

  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at > now() - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), o AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id)::integer AS n
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened' AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cso p SET open_n = o.n FROM o WHERE o.em = p.email;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', k.key, 'reach', COALESCE(a.reach, 0),
           'open_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.op / a.rec) END,
           'click_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.cl / a.rec) END)
         ORDER BY k.ord), '[]'::jsonb)
    INTO v_auto
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) k(key, ord)
    LEFT JOIN (
      SELECT lifecycle, count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl
        FROM _cso GROUP BY lifecycle
    ) a ON a.lifecycle = k.key;

  FOR s IN
    SELECT id, name, description, definition FROM public.crm_segments
     WHERE venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY created_at DESC LIMIT 40
  LOOP
    EXECUTE format('SELECT count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl FROM _cso p WHERE (%s)',
                   public._crm_filter_sql(s.definition, 'p'))
      INTO r;
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'name', s.name, 'description', s.description, 'reach', COALESCE(r.reach, 0),
      'open_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.op / r.rec) END,
      'click_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.cl / r.rec) END));
  END LOOP;

  RETURN jsonb_build_object('auto', v_auto, 'saved', v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_send_options(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_send_options(text, uuid) TO authenticated, service_role;

-- ── 2. Nombre de destinataires d'une sélection ────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_email_audience_preview(
  p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb,
  p_event_id uuid DEFAULT NULL, p_recent_days integer DEFAULT NULL,
  p_exclude_buyers boolean DEFAULT false, p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred text;
  v_days integer := CASE WHEN p_recent_days BETWEEN 1 AND 90 THEN p_recent_days END;
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_pred := public._crm_audience_pred(p_audiences, p_venue_id, p_organizer_user_id);
  IF v_pred IS NULL THEN
    RETURN jsonb_build_object('reach', 0, 'x_buyers', 0, 'x_recent', 0, 'net', 0);
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  EXECUTE format($q$
    WITH sel AS (
      SELECT p.email, p.events FROM _cp p
       WHERE p.email_ok AND (%3$s)
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                      WHERE lower(ns.email) = p.email AND ns.opted_in
                        AND ns.venue_id IS NOT DISTINCT FROM %1$L::text
                        AND ns.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid)
    ), f AS (
      SELECT s.email,
             (%4$L::uuid IS NOT NULL AND %4$L::uuid = ANY (s.events)) AS buyer,
             (%5$L::integer IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.email_campaign_recipients r
                  JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                 WHERE c2.id IS DISTINCT FROM %6$L::uuid
                   AND c2.venue_id IS NOT DISTINCT FROM %1$L::text
                   AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                   AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                   AND lower(r.email) = s.email)) AS recent
        FROM sel s
    )
    SELECT jsonb_build_object(
      'reach', count(*),
      'x_buyers', count(*) FILTER (WHERE buyer),
      'x_recent', count(*) FILTER (WHERE recent AND NOT (buyer AND %7$L::boolean)),
      'net', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent))
      FROM f
  $q$, p_venue_id, p_organizer_user_id, v_pred, p_event_id, v_days, p_campaign_id, COALESCE(p_exclude_buyers, false))
  INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_audience_preview(text, uuid, jsonb, uuid, integer, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_audience_preview(text, uuid, jsonb, uuid, integer, boolean, uuid) TO authenticated, service_role;

-- ── 3. Débit à la mise en file, remboursement d'un refus du fournisseur ───
-- Les fonctions d'origine deviennent le cœur, inchangé ; l'enveloppe ajoute
-- le portefeuille pour les seuls comptes au produit CRM.
ALTER FUNCTION public.enqueue_campaign_recipients(uuid) RENAME TO _enqueue_campaign_recipients_core;
REVOKE ALL ON FUNCTION public._enqueue_campaign_recipients_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enqueue_campaign_recipients_core(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  v_scope text;
  v_name text;
  v_queued integer;
  v_debit jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;
  v_res := public._enqueue_campaign_recipients_core(p_campaign_id);

  SELECT public.crm_scope_key(c.venue_id, c.organizer_user_id), c.name
    INTO v_scope, v_name
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  IF v_scope IS NULL OR NOT public.crm_scope_is_crm(v_scope) THEN
    RETURN v_res;
  END IF;

  v_queued := COALESCE((v_res->>'queued')::integer, 0);
  IF v_queued > 0 THEN
    v_debit := public.crm_yunits_debit(v_scope, v_queued, 'email', 'email_campaign', p_campaign_id::text, v_name, '{}'::jsonb);
    IF NOT COALESCE((v_debit->>'ok')::boolean, false) THEN
      -- Annule TOUTE la mise en file de cet appel : rien ne part, rien n'est débité.
      RAISE EXCEPTION 'crm_yunits_insufficient'
        USING ERRCODE = 'P0001', DETAIL = format('needed=%s balance=%s', v_queued, v_debit->>'balance');
    END IF;
    v_res := v_res || jsonb_build_object('yunits_debited', v_queued, 'yunits_balance', v_debit->'balance');
  END IF;
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_campaign_recipients(uuid) TO service_role;

ALTER FUNCTION public.mark_campaign_recipients_failed(uuid, text[], text, timestamptz, integer) RENAME TO _mark_campaign_recipients_failed_core;
REVOKE ALL ON FUNCTION public._mark_campaign_recipients_failed_core(uuid, text[], text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mark_campaign_recipients_failed_core(uuid, text[], text, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_campaign_recipients_failed(
  p_campaign_id uuid, p_emails text[], p_error text,
  p_retry_at timestamptz DEFAULT NULL, p_max_attempts integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before integer;
  v_after integer;
  v_n integer;
  v_scope text;
  v_name text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'mark_campaign_recipients_failed: service_role only';
  END IF;
  SELECT failed_count, public.crm_scope_key(venue_id, organizer_user_id), name
    INTO v_before, v_scope, v_name
    FROM public.email_campaigns WHERE id = p_campaign_id FOR UPDATE;
  v_n := public._mark_campaign_recipients_failed_core(p_campaign_id, p_emails, p_error, p_retry_at, p_max_attempts);
  IF v_scope IS NOT NULL AND public.crm_scope_is_crm(v_scope) THEN
    SELECT failed_count INTO v_after FROM public.email_campaigns WHERE id = p_campaign_id;
    IF COALESCE(v_after, 0) > COALESCE(v_before, 0) THEN
      -- Refusé par le fournisseur, jamais parti : le Yunit revient.
      PERFORM public.crm_yunits_refund(v_scope, v_after - COALESCE(v_before, 0), 'email', 'email_campaign', p_campaign_id::text, v_name);
    END IF;
  END IF;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_campaign_recipients_failed(uuid, text[], text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_campaign_recipients_failed(uuid, text[], text, timestamptz, integer) TO service_role;
