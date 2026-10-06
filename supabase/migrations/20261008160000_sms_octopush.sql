-- ───────────────────────────────────────────────────────────────────────────
-- SMS : Octopush remplace Twilio (2026-10-08).
-- Étude et plan : docs/designs/SMS_PROVIDER_PLAN.md
--
-- Ce qui change en base :
--   1. Colonnes neutres : `twilio_sid` → `provider_message_id`, plus le
--      fournisseur et le nom d'expéditeur sur chaque log.
--   2. Un envoi Octopush rend UN ticket pour tout le lot ; ses accusés de
--      réception portent (ticket, numéro). Le log se retrouve par la paire.
--   3. `provider_request_id` sur la file : posé AVANT l'appel, il suit une
--      ligne reprise après un worker interrompu. Octopush refuse un
--      `request_id` déjà vu (erreur 182) : rien ne part deux fois.
--   4. Nom d'expéditeur de la campagne (`sender_id`, règles AF2M : 3 à 11
--      lettres et chiffres, au moins une lettre).
--   5. Identité de l'annonceur exigée avant tout envoi (charte AF2M du
--      01/03/2026) : `get_sms_sender_readiness`.
--   6. La portée plateforme (Yuno écrit à sa base) peut enfin écrire un log.
--   7. Une seule porte de portée pour les tables SMS : `sms_scope_allowed`,
--      qui ouvre aussi le SMS aux admins d'équipe d'une organisation et aux
--      managers d'un club (la Console leur montrait la page, la base les
--      refusait).
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Colonnes ─────────────────────────────────────────────────────────────

ALTER TABLE public.sms_logs RENAME COLUMN twilio_sid TO provider_message_id;
ALTER TABLE public.sms_logs ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'twilio';
ALTER TABLE public.sms_logs ALTER COLUMN provider SET DEFAULT 'octopush';
ALTER TABLE public.sms_logs ADD COLUMN IF NOT EXISTS sender_id text;
-- Yunits débités pour ce SMS (Console CRM) ; 0 = crédits SMS de la Suite.
ALTER TABLE public.sms_logs ADD COLUMN IF NOT EXISTS yunits_debited integer NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS public.idx_sms_logs_twilio_sid;
CREATE INDEX IF NOT EXISTS idx_sms_logs_provider_msg
  ON public.sms_logs (provider_message_id, to_phone) WHERE provider_message_id IS NOT NULL;
-- Repli d'un accusé sans ticket connu (réponse 182) : dernier envoi du numéro.
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_recent
  ON public.sms_logs (to_phone, created_at DESC);

ALTER TABLE public.sms_campaign_recipients RENAME COLUMN twilio_sid TO provider_message_id;
ALTER TABLE public.sms_campaign_recipients ADD COLUMN IF NOT EXISTS provider_request_id text;
-- Prénom du destinataire, pour la variable {{prénom}}.
ALTER TABLE public.sms_campaign_recipients ADD COLUMN IF NOT EXISTS first_name text;
DROP INDEX IF EXISTS public.idx_sms_recipients_sid;
CREATE INDEX IF NOT EXISTS idx_sms_recipients_log
  ON public.sms_campaign_recipients (sms_log_id) WHERE sms_log_id IS NOT NULL;

ALTER TABLE public.sms_campaigns ADD COLUMN IF NOT EXISTS sender_id text;
ALTER TABLE public.sms_campaigns DROP CONSTRAINT IF EXISTS sms_campaigns_sender_id_format;
ALTER TABLE public.sms_campaigns ADD CONSTRAINT sms_campaigns_sender_id_format CHECK (
  sender_id IS NULL OR (sender_id ~ '^[A-Za-z0-9]{3,11}$' AND sender_id ~ '[A-Za-z]')
);

-- La plateforme (les deux portées à NULL) écrit aussi ses logs.
ALTER TABLE public.sms_logs DROP CONSTRAINT IF EXISTS sms_log_scope_xor;
ALTER TABLE public.sms_logs ADD CONSTRAINT sms_log_scope_xor CHECK (
  NOT (venue_id IS NOT NULL AND organizer_id IS NOT NULL)
);

-- Coût d'achat réel (Octopush, offre Basique) : lu par les écrans de marge.
UPDATE public.sms_packs SET unit_cost_eur = 0.045;

-- 2. Porte de portée ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sms_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND (
            p_organizer_user_id = auth.uid()
            OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
          ))
    ));
$$;

DROP POLICY IF EXISTS sms_camp_scope_read ON public.sms_campaigns;
CREATE POLICY sms_camp_scope_read ON public.sms_campaigns FOR SELECT TO authenticated
  USING (public.sms_scope_allowed(venue_id, organizer_id));

DROP POLICY IF EXISTS sms_camp_scope_insert ON public.sms_campaigns;
CREATE POLICY sms_camp_scope_insert ON public.sms_campaigns FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (venue_id IS NOT NULL OR organizer_id IS NOT NULL)
    AND public.sms_scope_allowed(venue_id, organizer_id)
  );

DROP POLICY IF EXISTS sms_camp_scope_update ON public.sms_campaigns;
CREATE POLICY sms_camp_scope_update ON public.sms_campaigns FOR UPDATE TO authenticated
  USING ((venue_id IS NOT NULL OR organizer_id IS NOT NULL) AND public.sms_scope_allowed(venue_id, organizer_id))
  WITH CHECK ((venue_id IS NOT NULL OR organizer_id IS NOT NULL) AND public.sms_scope_allowed(venue_id, organizer_id));

DROP POLICY IF EXISTS sms_camp_scope_delete ON public.sms_campaigns;
CREATE POLICY sms_camp_scope_delete ON public.sms_campaigns FOR DELETE TO authenticated
  USING (
    status = 'draft'::public.sms_campaign_status
    AND (venue_id IS NOT NULL OR organizer_id IS NOT NULL)
    AND public.sms_scope_allowed(venue_id, organizer_id)
  );

DROP POLICY IF EXISTS sms_recipients_scope_read ON public.sms_campaign_recipients;
CREATE POLICY sms_recipients_scope_read ON public.sms_campaign_recipients FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sms_campaigns c
     WHERE c.id = sms_campaign_recipients.campaign_id
       AND public.sms_scope_allowed(c.venue_id, c.organizer_id)
  ));

DROP POLICY IF EXISTS sms_logs_scope_read ON public.sms_logs;
CREATE POLICY sms_logs_scope_read ON public.sms_logs FOR SELECT TO authenticated
  USING (public.sms_scope_allowed(venue_id, organizer_id));

DROP POLICY IF EXISTS sms_balance_scope_read ON public.sms_credit_balances;
CREATE POLICY sms_balance_scope_read ON public.sms_credit_balances FOR SELECT TO authenticated
  USING (
    public.sms_scope_allowed(venue_id, organizer_id)
    OR (venue_id IS NOT NULL AND public.is_venue_staff(auth.uid(), venue_id))
  );

DROP POLICY IF EXISTS sms_tx_scope_read ON public.sms_credit_transactions;
CREATE POLICY sms_tx_scope_read ON public.sms_credit_transactions FOR SELECT TO authenticated
  USING (public.sms_scope_allowed(venue_id, organizer_id));

DROP POLICY IF EXISTS sms_list_imports_owner_read ON public.sms_list_imports;
CREATE POLICY sms_list_imports_owner_read ON public.sms_list_imports FOR SELECT TO authenticated
  USING (
    (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL)
    AND public.sms_scope_allowed(venue_id, organizer_user_id)
  );

-- 3. File d'envoi ─────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.claim_sms_campaign_recipients(uuid, integer);
CREATE FUNCTION public.claim_sms_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, phone_e164 text, full_name text, first_name text, user_id uuid, lang text, attempts integer, provider_request_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_sms_campaign_recipients: service_role only';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT r.id
      FROM public.sms_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.status = 'pending'
       AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
     ORDER BY r.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sms_campaign_recipients r
     SET status = 'sending', claimed_at = now(), attempts = r.attempts + 1
    FROM picked
   WHERE r.id = picked.id
  RETURNING r.id, r.phone_e164, r.full_name, r.first_name, r.user_id, r.lang, r.attempts, r.provider_request_id;
END;
$$;

-- Posé AVANT l'appel au fournisseur : une ligne reprise garde son identifiant
-- d'envoi, et le fournisseur reconnaît le doublon.
CREATE OR REPLACE FUNCTION public.set_sms_recipients_request_id(p_campaign_id uuid, p_ids uuid[], p_request_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'set_sms_recipients_request_id: service_role only';
  END IF;
  UPDATE public.sms_campaign_recipients
     SET provider_request_id = p_request_id
   WHERE campaign_id = p_campaign_id AND id = ANY(p_ids) AND status = 'sending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- p_rows : [{"id": uuid, "provider_message_id": "...", "sms_log_id": uuid, "credits": 1}]
CREATE OR REPLACE FUNCTION public.mark_sms_campaign_recipients_sent(p_campaign_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0; v_credits integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'mark_sms_campaign_recipients_sent: service_role only';
  END IF;
  WITH src AS (
    SELECT (x->>'id')::uuid AS rid, NULLIF(x->>'provider_message_id','') AS msg_id,
           NULLIF(x->>'sms_log_id','')::uuid AS log_id, COALESCE((x->>'credits')::int, 1) AS credits
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  ), upd AS (
    UPDATE public.sms_campaign_recipients r
       SET status = 'sent', provider_message_id = src.msg_id, sms_log_id = src.log_id,
           credits = src.credits, sent_at = now(), claimed_at = NULL,
           error_code = NULL, error_message = NULL
      FROM src
     WHERE r.campaign_id = p_campaign_id AND r.id = src.rid
       AND r.status = 'sending'
    RETURNING r.credits
  )
  SELECT count(*), COALESCE(sum(credits), 0) INTO v_count, v_credits FROM upd;

  UPDATE public.sms_campaigns
     SET sent_count = sent_count + v_count,
         credits_consumed = credits_consumed + v_credits,
         last_slice_at = now()
   WHERE id = p_campaign_id;
  RETURN v_count;
END;
$$;

-- 4. Accusés de réception ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.apply_sms_delivery_status(text, text, text, text);
CREATE FUNCTION public.apply_sms_delivery_status(
  p_message_id text, p_phone text, p_status text,
  p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_phone      text := public.normalize_phone_e164(p_phone);
  v_log        public.sms_logs%ROWTYPE;
  v_new        public.sms_status;
  v_rec_id     uuid;
  v_rec_status text;
  v_campaign   uuid;
  v_balance    uuid;
  v_refunded   boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'apply_sms_delivery_status: service_role only';
  END IF;

  -- Un ticket couvre tout un lot : le numéro départage.
  SELECT * INTO v_log FROM public.sms_logs
   WHERE provider_message_id = p_message_id
     AND (v_phone IS NULL OR to_phone = v_phone)
   ORDER BY created_at DESC
   LIMIT 1;

  -- Lot accepté sans ticket connu (réponse 182 à une reprise) : dernier envoi
  -- de ce numéro sans ticket, sous 48 h. Le ticket lui est alors rattaché.
  IF NOT FOUND AND v_phone IS NOT NULL THEN
    SELECT * INTO v_log FROM public.sms_logs
     WHERE to_phone = v_phone
       AND provider_message_id IS NULL
       AND status = 'sent'
       AND created_at > now() - interval '48 hours'
     ORDER BY created_at DESC
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.sms_logs SET provider_message_id = p_message_id WHERE id = v_log.id;
      UPDATE public.sms_campaign_recipients SET provider_message_id = p_message_id
       WHERE sms_log_id = v_log.id AND provider_message_id IS NULL;
    END IF;
  END IF;

  IF v_log.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_new := CASE p_status
             WHEN 'delivered'   THEN 'delivered'::public.sms_status
             WHEN 'failed'      THEN 'failed'::public.sms_status
             WHEN 'undelivered' THEN 'undelivered'::public.sms_status
             WHEN 'sent'        THEN 'sent'::public.sms_status
             ELSE NULL
           END;

  IF v_new IS NOT NULL THEN
    -- Un « sent » tardif ne doit jamais écraser un statut final déjà reçu.
    UPDATE public.sms_logs
       SET status = CASE WHEN v_new = 'sent' AND status IN ('delivered','failed','undelivered') THEN status ELSE v_new END,
           delivered_at = CASE WHEN v_new = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
           error_code = COALESCE(p_error_code, error_code),
           error_message = COALESCE(p_error_message, error_message)
     WHERE id = v_log.id;
  END IF;

  SELECT r.id, r.status, r.campaign_id INTO v_rec_id, v_rec_status, v_campaign
    FROM public.sms_campaign_recipients r
   WHERE r.sms_log_id = v_log.id
   LIMIT 1;

  IF v_rec_id IS NOT NULL AND v_new IS NOT NULL AND v_new <> 'sent'
     AND v_rec_status NOT IN ('delivered','failed','undelivered') THEN
    UPDATE public.sms_campaign_recipients
       SET status = v_new::text,
           delivered_at = CASE WHEN v_new = 'delivered' THEN now() ELSE delivered_at END,
           error_code = COALESCE(p_error_code, error_code),
           error_message = COALESCE(p_error_message, error_message)
     WHERE id = v_rec_id;

    UPDATE public.sms_campaigns
       SET delivered_count   = delivered_count   + CASE WHEN v_new = 'delivered'   THEN 1 ELSE 0 END,
           undelivered_count = undelivered_count + CASE WHEN v_new = 'undelivered' THEN 1 ELSE 0 END,
           failed_count      = failed_count      + CASE WHEN v_new = 'failed'      THEN 1 ELSE 0 END
     WHERE id = v_campaign;
  END IF;

  -- Remboursement UNIQUEMENT sur 'failed' (jamais parti). Un 'undelivered' a
  -- été remis à l'opérateur et facturé : il reste à la charge du pro, comme
  -- chez tout fournisseur SMS (décision produit 2026-09-08).
  IF v_new = 'failed' AND NOT v_log.refunded AND v_log.yunits_debited > 0 THEN
    UPDATE public.sms_logs SET refunded = true WHERE id = v_log.id AND NOT refunded;
    PERFORM public.crm_yunits_refund(public.crm_scope_key(v_log.venue_id, v_log.organizer_id), v_log.yunits_debited,
      'sms', 'sms_campaign', v_log.campaign_id::text, 'SMS non parti (' || COALESCE(p_error_code, 'no code') || ')');
    v_refunded := true;
  ELSIF v_new = 'failed' AND NOT v_log.refunded THEN
    SELECT id INTO v_balance FROM public.sms_credit_balances
     WHERE (v_log.venue_id IS NOT NULL AND venue_id = v_log.venue_id)
        OR (v_log.organizer_id IS NOT NULL AND organizer_id = v_log.organizer_id)
     LIMIT 1;
    IF v_balance IS NOT NULL THEN
      PERFORM public.refund_sms_credits(v_balance, GREATEST(1, v_log.credits_consumed), v_log.id,
        'Auto-refund: ' || v_log.provider || ' failed (' || COALESCE(p_error_code, 'no code') || ')');
      v_refunded := true;
      IF v_campaign IS NOT NULL THEN
        UPDATE public.sms_campaigns
           SET credits_refunded = credits_refunded + GREATEST(1, v_log.credits_consumed)
         WHERE id = v_campaign;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('found', true, 'status', v_new, 'refunded', v_refunded, 'campaign_id', v_campaign);
END;
$$;

-- 5. Identité de l'annonceur ─────────────────────────────────────────────
-- Charte AF2M (01/03/2026) : chaque maillon vérifie l'identité de son
-- co-contractant. Avant tout envoi, la portée a une raison sociale et un
-- identifiant légal (SIRET 14 chiffres, RNA d'association, ou TVA pour une
-- structure étrangère). La plateforme (Yuno) est toujours prête.
CREATE OR REPLACE FUNCTION public.get_sms_sender_readiness(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_legal   text;
  v_siret   text;
  v_rna     text;
  v_vat     text;
  v_has_id  boolean;
  v_missing text[] := ARRAY[]::text[];
  v_last    text;
BEGIN
  -- Lecture : qui gère le SMS de la portée, ou un membre de la Console CRM.
  IF NOT (public.sms_scope_allowed(p_venue_id, p_organizer_user_id)
          OR (COALESCE(p_venue_id, p_organizer_user_id::text) IS NOT NULL
              AND public.crm_scope_allowed(p_venue_id, p_organizer_user_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RETURN jsonb_build_object('identity_ok', true, 'missing', '[]'::jsonb, 'last_sender_id', 'YUNO');
  END IF;

  IF p_venue_id IS NOT NULL THEN
    SELECT v.legal_name, v.siret, NULL::text, v.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.venues v WHERE v.id = p_venue_id;
  ELSE
    SELECT o.legal_name, o.siret, o.rna_number, o.vat_number
      INTO v_legal, v_siret, v_rna, v_vat
      FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id;
  END IF;

  v_has_id := length(regexp_replace(COALESCE(v_siret, ''), '[^0-9]', '', 'g')) = 14
           OR upper(regexp_replace(COALESCE(v_rna, ''), '\s', '', 'g')) ~ '^W[0-9]{9}$'
           OR length(btrim(COALESCE(v_vat, ''))) >= 6;

  IF length(btrim(COALESCE(v_legal, ''))) < 2 THEN v_missing := array_append(v_missing, 'legal_name'); END IF;
  IF NOT v_has_id THEN v_missing := array_append(v_missing, 'registration'); END IF;

  -- Nom d'expéditeur à proposer : celui des Réglages SMS de la Console, sinon
  -- le dernier utilisé par la portée (colonne , ou 
  -- quand il suit déjà les règles, comme dans la Console CRM).
  SELECT s.sender_name INTO v_last FROM public.crm_sms_settings s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)
     AND s.sender_name ~ '^[A-Za-z0-9]{3,11}$';
  IF v_last IS NULL THEN
    SELECT COALESCE(c.sender_id, c.sender_name) INTO v_last
      FROM public.sms_campaigns c
     WHERE (c.sender_id IS NOT NULL OR c.sender_name ~ '^[A-Za-z0-9]{3,11}$')
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND c.organizer_id = p_organizer_user_id))
     ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'identity_ok', cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing),
    'last_sender_id', v_last
  );
END;
$$;

-- 6. Liste STOP globale ──────────────────────────────────────────────────
-- Un STOP au 30101 vaut pour TOUT le compte Octopush de Yuno (sa liste noire
-- est par compte). Yuno garde la même mémoire : un numéro qui a dit STOP n'est
-- plus jamais mis en file, quelle que soit l'origine de son accord (achat,
-- page d'inscription, fichier). Jamais vidée ; aucune policy.
CREATE TABLE IF NOT EXISTS public.sms_stop_list (
  phone_e164 text PRIMARY KEY,
  source     text NOT NULL DEFAULT 'stop',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_stop_list ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_stop_list FROM PUBLIC, anon, authenticated;

INSERT INTO public.sms_stop_list (phone_e164, source, created_at)
SELECT DISTINCT ON (m.phone_e164) m.phone_e164, 'stop', m.occurred_at
  FROM public.marketing_consent_events m
 WHERE m.channel = 'sms' AND m.source = 'sms_stop' AND m.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
 ORDER BY m.phone_e164, m.occurred_at
ON CONFLICT (phone_e164) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sms_stop_unsubscribe(_phone text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text := public.normalize_phone_e164(_phone);
  v_count integer := 0;
BEGIN
  IF v_norm IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.sms_stop_list (phone_e164, source) VALUES (v_norm, 'stop')
  ON CONFLICT (phone_e164) DO NOTHING;

  UPDATE public.venue_sms_contacts sc
  SET unsubscribed = true, unsubscribed_at = now()
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND NOT sc.unsubscribed;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.profiles p
  SET phone_sms_opt_in = false
  WHERE public.normalize_phone_e164(p.phone) = v_norm
    AND p.phone_sms_opt_in;

  -- Les envois encore en file pour ce numéro ne partent plus.
  UPDATE public.sms_campaign_recipients r
     SET status = 'skipped', error_code = 'stop', error_message = 'STOP reçu'
   WHERE r.phone_e164 = v_norm AND r.status = 'pending';

  -- Trace de preuve, une ligne par club ou organisateur quitté (art. 7(1) RGPD).
  INSERT INTO public.marketing_consent_events (
    user_id, phone_e164, channel, venue_id, organizer_user_id, action, wording_text, source
  )
  SELECT DISTINCT sc.user_id, v_norm, 'sms', sc.venue_id, sc.organizer_user_id, 'withdrawn',
         'STOP par SMS entrant', 'sms_stop'
  FROM public.venue_sms_contacts sc
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND (sc.venue_id IS NOT NULL OR sc.organizer_user_id IS NOT NULL);

  RETURN v_count;
END;
$function$;

-- 7. Yuno CRM : le SMS part ────────────────────────────────────────────────
-- docs/designs/CRM_SMS_PLAN.md. Un SMS CRM coûte des Yunits (35 par SMS en
-- France, `crm_pricing.rates.sms`, décision de Paul du 08/10), son audience
-- est celle de la Console (audiences {kind:'crm'}), il porte les variables
-- {{prénom}} / {{nom_club}} / {{soirée}} / {{lien}} et suit les réglages
-- d'envoi du compte (`crm_sms_settings`).

UPDATE public.crm_pricing SET config = jsonb_set(config, '{rates,sms}', '35'::jsonb) WHERE id;


-- Un SMS de la Console CRM (brouillon `type = crm`) ou d'un compte CRM seul.
CREATE OR REPLACE FUNCTION public.sms_campaign_is_crm(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT c.segment_filters->>'type' = 'crm'
        OR public.crm_scope_is_crm(public.crm_scope_key(c.venue_id, c.organizer_id))
      FROM public.sms_campaigns c WHERE c.id = p_campaign_id), false);
$$;

-- Yunits par SMS (un segment de 160 caractères).
CREATE OR REPLACE FUNCTION public.crm_sms_rate()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'sms')::integer, 35));
$$;

-- Mise en file CRM : MÊME règle que crm_sms_audience_preview (joignables par
-- SMS de la base du compte, moins les acheteurs de la soirée si demandé, moins
-- ceux qui ont reçu un e-mail ou un SMS récemment, moins le plafond de la
-- semaine), puis la liste STOP globale.
CREATE OR REPLACE FUNCTION public._enqueue_crm_sms_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_scope  text;
  v_pred   text;
  v_days   integer;
  v_excl   boolean;
  v_cap    integer;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION '_enqueue_crm_sms_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;
  v_scope := public.crm_scope_key(c.venue_id, c.organizer_id);
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le compte est en pause, aucun envoi ne part.';
  END IF;

  v_pred := public._crm_audience_pred(c.segment_filters->'audiences', c.venue_id, c.organizer_id);
  IF v_pred IS NOT NULL THEN
    v_days := CASE WHEN (c.segment_filters->>'recent_days') ~ '^[0-9]+$'
                    AND (c.segment_filters->>'recent_days')::int BETWEEN 1 AND 90
                   THEN (c.segment_filters->>'recent_days')::int END;
    v_excl := COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false) AND c.event_id IS NOT NULL;
    SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s WHERE s.scope_key = v_scope;
    v_cap := COALESCE(v_cap, 1);
    PERFORM public._crm_people_build(c.venue_id, c.organizer_id, NULL);

    EXECUTE format($q$
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name, lang)
      SELECT %6$L::uuid, s.phone,
             NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
             NULLIF(btrim(s.first_name), ''), 'fr'
        FROM (
          SELECT DISTINCT ON (p.phone) p.phone, p.first_name, p.last_name, p.email, p.events
            FROM _cp p
           WHERE p.phone_ok AND p.phone ~ '^\+[1-9][0-9]{6,14}$' AND (%3$s)
           ORDER BY p.phone, p.first_name NULLS LAST
        ) s
       WHERE NOT (%7$L::boolean AND %4$L::uuid = ANY (s.events))
         AND NOT (%5$L::integer IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.sms_campaign_recipients r
                          JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
                         WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                           AND c2.id <> %6$L::uuid AND r.phone_e164 = s.phone
                           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - make_interval(days => %5$L::integer))
                OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                             JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                            WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                              AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                              AND lower(r.email) = s.email)))
         AND (SELECT count(*) FROM public.sms_campaign_recipients r
                JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
               WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                 AND c2.id <> %6$L::uuid AND r.phone_e164 = s.phone
                 AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days') < %8$L::integer
         AND NOT EXISTS (SELECT 1 FROM public.sms_stop_list x WHERE x.phone_e164 = s.phone)
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING
    $q$, c.venue_id, c.organizer_id, v_pred, c.event_id, v_days, p_campaign_id, v_excl, v_cap);
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;
  UPDATE public.sms_campaigns SET total_recipients = v_total, estimated_recipients = v_total WHERE id = p_campaign_id;
  RETURN jsonb_build_object('total', v_total, 'pending', v_pending, 'crm', true);
END;
$$;

-- La porte unique de mise en file : la Suite (ancien moteur) ou la Console CRM.
CREATE OR REPLACE FUNCTION public.enqueue_sms_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_seg    text;
  v_event  uuid;
  v_import uuid;
  v_segid  uuid;
  v_ids    uuid[];
  v_match  text;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_sms_campaign_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;
  -- Yuno CRM : son audience (type « crm ») n'est JAMAIS lue par l'ancien
  -- moteur, qui la prendrait pour « tous les contacts ».
  IF public.sms_campaign_is_crm(p_campaign_id) THEN
    RETURN public._enqueue_crm_sms_recipients(p_campaign_id);
  END IF;

  v_seg    := COALESCE(c.segment_filters->>'type', 'all');
  v_event  := COALESCE(c.event_id, NULLIF(c.segment_filters->>'event_id', '')::uuid);
  v_import := NULLIF(c.segment_filters->>'import_id', '')::uuid;
  v_segid  := CASE WHEN COALESCE(c.segment_filters->>'segment_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (c.segment_filters->>'segment_id')::uuid END;
  v_ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(c.segment_filters->'segment_ids') = 'array' THEN c.segment_filters->'segment_ids' ELSE '[]'::jsonb END) x
           WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  IF cardinality(v_ids) = 0 AND v_segid IS NOT NULL THEN v_ids := ARRAY[v_segid]; END IF;
  v_match := CASE WHEN c.segment_filters->>'match' = 'all' THEN 'all' ELSE 'any' END;

  INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, user_id, phone_e164, full_name, first_name, lang)
  SELECT p_campaign_id, r.contact_id, r.user_id, r.phone_e164, r.full_name,
         NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), ''),
         COALESCE(pr.preferred_language, 'fr')
    FROM public.resolve_sms_campaign_recipients(c.venue_id, c.organizer_id, v_seg, v_event, v_import, v_segid, v_ids, v_match) r
    LEFT JOIN public.profiles pr ON pr.id = r.user_id
   WHERE NOT EXISTS (SELECT 1 FROM public.sms_stop_list x WHERE x.phone_e164 = r.phone_e164)
  ON CONFLICT (campaign_id, phone_e164) DO NOTHING;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE public.sms_campaigns
     SET total_recipients = v_total, estimated_recipients = v_total
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('total', v_total, 'pending', v_pending);
END;
$function$;

-- Lien d'un SMS CRM : une soirée Shotgun part sur un lien court `/go/<code>`
-- (le clic est compté, la vente revient avec la source `yuno-s-<code>`) ; une
-- soirée Yuno publique sur le lien suivi `/l/<code>` du canal SMS. Un lien par
-- soirée et par compte, partagé par ses SMS (les clics vont au dernier SMS
-- parti avant le clic, `_crm_sms_stats`). Rend {kind, code} ou NULL.
CREATE OR REPLACE FUNCTION public.ensure_crm_sms_link(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c       public.sms_campaigns%ROWTYPE;
  e       public.events%ROWTYPE;
  v_link  public.tracked_links%ROWTYPE;
  v_owner uuid;
  v_r     record;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ensure_crm_sms_link: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR c.event_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.events WHERE id = c.event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF e.external_source IS NOT NULL AND e.external_ticket_url ~ '^https://' THEN
    SELECT * INTO v_link FROM public.tracked_links tl
     WHERE tl.event_id = e.id AND tl.utm_source = 'sms' AND tl.utm_medium = 'campaign' AND tl.is_active
       AND tl.venue_id IS NOT DISTINCT FROM c.venue_id
       AND tl.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN c.venue_id IS NULL THEN c.organizer_id END)
     ORDER BY tl.created_at ASC LIMIT 1;
    IF NOT FOUND THEN
      IF c.venue_id IS NOT NULL THEN
        SELECT owner_id INTO v_owner FROM public.venues WHERE id = c.venue_id;
      END IF;
      v_owner := COALESCE(v_owner, c.organizer_id, c.created_by);
      IF v_owner IS NULL THEN RETURN NULL; END IF;
      INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                        target_kind, event_id, utm_source, utm_medium, utm_campaign)
      VALUES (public.gen_tracked_link_code(), 'SMS',
              CASE WHEN c.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
              c.venue_id, CASE WHEN c.venue_id IS NULL THEN c.organizer_id END, v_owner,
              'event', e.id, 'sms', 'campaign', 'yuno')
      RETURNING * INTO v_link;
    END IF;
    UPDATE public.sms_campaigns SET tracked_link_id = v_link.id WHERE id = c.id AND tracked_link_id IS DISTINCT FROM v_link.id;
    RETURN jsonb_build_object('kind', 'go', 'code', v_link.code);
  END IF;

  IF e.is_active AND e.external_source IS NULL THEN
    SELECT * INTO v_r FROM public.ensure_sms_tracked_link(e.id);
    IF v_r.code IS NULL THEN RETURN NULL; END IF;
    UPDATE public.sms_campaigns SET tracked_link_id = v_r.id WHERE id = c.id AND tracked_link_id IS DISTINCT FROM v_r.id;
    RETURN jsonb_build_object('kind', 'l', 'code', v_r.code);
  END IF;
  RETURN NULL;
END;
$$;

-- Programmer un SMS de la Console (le cron l'envoie à l'heure dite) et
-- l'annuler. L'identité de l'annonceur est vérifiée ICI aussi : un envoi
-- programmé ne doit pas tomber le soir venu.
CREATE OR REPLACE FUNCTION public.crm_sms_schedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v_ready jsonb;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_at IS NULL OR p_at < now() - interval '1 minute' OR p_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'bad_date' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns x
   WHERE x.id = p_id AND x.venue_id IS NOT DISTINCT FROM p_venue_id AND x.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'draft' THEN RAISE EXCEPTION 'not_draft' USING ERRCODE = '22023'; END IF;
  IF btrim(COALESCE(c.body_template, '')) = '' THEN RAISE EXCEPTION 'empty_body' USING ERRCODE = '22023'; END IF;
  v_ready := public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id);
  IF NOT COALESCE((v_ready->>'identity_ok')::boolean, false) THEN
    RAISE EXCEPTION 'sms_identity_required' USING ERRCODE = 'P0001';
  END IF;
  IF public.crm_effective_plan(public.crm_scope_key(p_venue_id, p_organizer_user_id)) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = p_at, error_message = NULL WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'scheduled_at', p_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_sms_unschedule(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sms_campaigns SET status = 'draft'
   WHERE id = p_id AND status = 'scheduled'
     AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_id IS NOT DISTINCT FROM p_organizer_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0);
END;
$$;

-- Identité de l'annonceur saisie depuis la Console (Réglages SMS) : écrite
-- sur la fiche légale du club ou de l'organisation, la même que les reçus.
-- Le titulaire seul (propriétaire du club, fondateur de l'organisation).
CREATE OR REPLACE FUNCTION public.set_sms_sender_identity(p_venue_id text, p_organizer_user_id uuid, p_legal_name text, p_registration text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name  text := NULLIF(left(btrim(COALESCE(p_legal_name, '')), 160), '');
  v_raw   text := upper(regexp_replace(COALESCE(p_registration, ''), '\s', '', 'g'));
  v_siret text;
  v_rna   text;
  v_vat   text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR p_organizer_user_id = auth.uid()) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN RAISE EXCEPTION 'bad_legal_name' USING ERRCODE = '22023'; END IF;

  IF regexp_replace(v_raw, '[^0-9]', '', 'g') ~ '^[0-9]{14}$' AND v_raw ~ '^[0-9.\-]+$' THEN
    v_siret := regexp_replace(v_raw, '[^0-9]', '', 'g');
  ELSIF v_raw ~ '^W[0-9]{9}$' THEN
    v_rna := v_raw;
  ELSIF v_raw ~ '^[A-Z]{2}[0-9A-Z]{6,13}$' THEN
    v_vat := v_raw;
  ELSE
    RAISE EXCEPTION 'bad_registration' USING ERRCODE = '22023';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF v_rna IS NOT NULL THEN RAISE EXCEPTION 'bad_registration' USING ERRCODE = '22023'; END IF;
    UPDATE public.venues SET legal_name = v_name,
           siret = COALESCE(v_siret, siret), vat_number = COALESCE(v_vat, vat_number)
     WHERE id = p_venue_id;
  ELSE
    UPDATE public.organizer_profiles SET legal_name = v_name,
           siret = COALESCE(v_siret, siret), rna_number = COALESCE(v_rna, rna_number),
           vat_number = COALESCE(v_vat, vat_number)
     WHERE user_id = p_organizer_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id);
END;
$$;

-- Remboursement d'un lot refusé : crédits SMS (Suite) ou Yunits (CRM).
CREATE OR REPLACE FUNCTION public.refund_sms_log_batch(p_log_ids uuid[], p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_total integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'refund_sms_log_batch: service_role only';
  END IF;
  -- Suite : crédits SMS, log par log.
  FOR r IN
    SELECT l.id, GREATEST(1, l.credits_consumed) AS credits, b.id AS balance_id
      FROM public.sms_logs l
      JOIN public.sms_credit_balances b
        ON (l.venue_id IS NOT NULL AND b.venue_id = l.venue_id)
        OR (l.organizer_id IS NOT NULL AND b.organizer_id = l.organizer_id)
     WHERE l.id = ANY(p_log_ids) AND NOT l.refunded AND l.yunits_debited = 0
  LOOP
    PERFORM public.refund_sms_credits(r.balance_id, r.credits, r.id, COALESCE(p_note, 'Refus du fournisseur'));
    v_total := v_total + r.credits;
  END LOOP;
  -- CRM : Yunits, un remboursement par compte et par SMS de campagne.
  FOR r IN
    WITH x AS (
      UPDATE public.sms_logs l SET refunded = true
       WHERE l.id = ANY(p_log_ids) AND NOT l.refunded AND l.yunits_debited > 0
      RETURNING l.venue_id, l.organizer_id, l.campaign_id, l.yunits_debited
    )
    SELECT public.crm_scope_key(x.venue_id, x.organizer_id) AS scope_key, x.campaign_id, sum(x.yunits_debited)::integer AS yunits
      FROM x GROUP BY 1, 2
  LOOP
    PERFORM public.crm_yunits_refund(r.scope_key, r.yunits, 'sms', 'sms_campaign', r.campaign_id::text,
                                     COALESCE(p_note, 'Refus du fournisseur'));
    v_total := v_total + r.yunits;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Ligne de campagne de la Console : la progression d'un envoi et le motif
-- d'une pause (Yunits épuisés, refus du service d'envoi) sont lisibles.
CREATE OR REPLACE FUNCTION public._crm_sms_row(c public.sms_campaigns)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'body', c.body_template, 'sender_name', c.sender_name,
    'status', c.status, 'scheduled_at', c.scheduled_at, 'sent_at', c.sent_at,
    'updated_at', c.updated_at, 'created_at', c.created_at, 'event_id', c.event_id,
    'event_title', (SELECT e.title FROM public.events e WHERE e.id = c.event_id),
    'audiences', COALESCE(c.segment_filters->'audiences', '[]'::jsonb),
    'tpl', NULLIF(c.segment_filters->>'tpl', ''),
    'exclude_buyers', COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false),
    'recent_days', NULLIF(c.segment_filters->>'recent_days', '')::integer,
    'waves', COALESCE((c.segment_filters->>'waves')::boolean, false),
    'quiet_hours', c.quiet_hours,
    'estimated', c.estimated_recipients, 'parts', GREATEST(COALESCE(c.segments_per_message, 1), 1),
    'paused_reason', c.paused_reason,
    'sent_count', c.sent_count, 'total_recipients', c.total_recipients, 'error_message', c.error_message);
$function$;

-- 8. Droits ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.claim_sms_campaign_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_sms_recipients_request_id(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_sms_campaign_recipients_sent(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_sms_log_batch(uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_sms_delivery_status(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_sms_sender_readiness(text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_sms_campaign_recipients(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_sms_recipients_request_id(uuid, uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_sms_campaign_recipients_sent(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_sms_log_batch(uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sms_delivery_status(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_sms_sender_readiness(text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sms_campaign_is_crm(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._enqueue_crm_sms_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_sms_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_crm_sms_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sms_stop_unsubscribe(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_sms_rate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_sms_schedule(text, uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_sms_unschedule(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sms_sender_identity(text, uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sms_campaign_is_crm(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._enqueue_crm_sms_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_sms_campaign_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_crm_sms_link(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sms_stop_unsubscribe(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_rate() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_schedule(text, uuid, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sms_unschedule(text, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sms_sender_identity(text, uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
