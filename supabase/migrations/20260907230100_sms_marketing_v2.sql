-- ============================================================================
-- SMS marketing v2 — portée organisateur, file d'envoi, statistiques.
-- ============================================================================
--
-- Le prototype v1 était club-only et envoyait toute la campagne dans une seule
-- invocation d'edge function. Cette migration pose ce qui manquait :
--
--   1. Les contacts SMS d'un ORGANISATEUR sans club (venue_sms_contacts prend
--      un organizer_user_id, exactement comme newsletter_subscriptions).
--   2. Une file de travail par campagne (sms_campaign_recipients) drainée par
--      tranches avec claim atomique FOR UPDATE SKIP LOCKED, calquée sur la
--      file email (email_campaign_recipients) : deux workers ne réservent
--      jamais le même numéro, un worker tué est repris par le cron.
--   3. Les compteurs de livraison (delivered / undelivered / failed) alimentés
--      par le webhook Twilio via UNE RPC atomique qui rembourse aussi le crédit.
--   4. Un rapport de campagne (livraison, clics sur le lien suivi, ventes
--      attribuées) et une vue d'ensemble des contacts, avec garde de portée.
--   5. Le canal « sms » des liens suivis (/l/<code>), pour mesurer les clics.
--   6. Les RPC de consentement côté client (lecture, retrait, abonnements,
--      STOP entrant) élargies à la portée organisateur.
--
-- Sécurité : les anciennes RPC resolve_/count_sms_campaign_recipients étaient
-- SECURITY DEFINER SANS garde et ouvertes à `authenticated` — n'importe quel
-- compte pouvait lister les numéros d'un autre club. Elles sont remplacées
-- (DROP + CREATE, jamais de surcharge ambiguë) : la résolution est réservée au
-- service_role, le comptage vérifie la portée.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Contacts SMS : portée club OU organisateur
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_sms_contacts ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.venue_sms_contacts
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.venue_sms_contacts DROP CONSTRAINT IF EXISTS venue_sms_contacts_scope_xor;
ALTER TABLE public.venue_sms_contacts ADD CONSTRAINT venue_sms_contacts_scope_xor CHECK (
  (venue_id IS NOT NULL AND organizer_user_id IS NULL)
  OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
);

-- Contrainte UNIQUE pleine (pas d'index partiel) : PostgREST ne sait pas
-- viser un index partiel dans `on_conflict`, et une contrainte pleine suffit —
-- les lignes club ont organizer_user_id NULL, donc ne se heurtent jamais.
ALTER TABLE public.venue_sms_contacts DROP CONSTRAINT IF EXISTS venue_sms_contacts_unique_org_phone;
ALTER TABLE public.venue_sms_contacts
  ADD CONSTRAINT venue_sms_contacts_unique_org_phone UNIQUE (organizer_user_id, phone_e164);

CREATE INDEX IF NOT EXISTS idx_sms_contacts_organizer
  ON public.venue_sms_contacts (organizer_user_id)
  WHERE organizer_user_id IS NOT NULL AND NOT unsubscribed;

DROP POLICY IF EXISTS sms_contacts_organizer_all ON public.venue_sms_contacts;
CREATE POLICY sms_contacts_organizer_all ON public.venue_sms_contacts
  FOR ALL TO authenticated
  USING (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Campagnes : colonnes de pilotage et de statistiques
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS quiet_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS total_recipients integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS undelivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_refunded integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS segments_per_message integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tracked_link_id uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS send_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_slice_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sms_campaigns_sending
  ON public.sms_campaigns (last_slice_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_sms_campaigns_event
  ON public.sms_campaigns (event_id) WHERE event_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. File de destinataires
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.sms_campaigns(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES public.venue_sms_contacts(id) ON DELETE SET NULL,
  user_id         uuid,
  phone_e164      text NOT NULL,
  full_name       text,
  lang            text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','delivered','failed','undelivered','skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  claimed_at      timestamptz,
  next_attempt_at timestamptz,
  twilio_sid      text,
  sms_log_id      uuid,
  credits         integer NOT NULL DEFAULT 0,
  error_code      text,
  error_message   text,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_campaign_recipients_unique UNIQUE (campaign_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_sms_recipients_pending
  ON public.sms_campaign_recipients (campaign_id, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sms_recipients_claimed
  ON public.sms_campaign_recipients (claimed_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_sms_recipients_sid
  ON public.sms_campaign_recipients (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_recipients_campaign_status
  ON public.sms_campaign_recipients (campaign_id, status);

ALTER TABLE public.sms_campaign_recipients ENABLE ROW LEVEL SECURITY;

-- Lecture seule pour le pro qui possède la campagne ; aucune écriture client :
-- seules les RPC service_role ci-dessous font avancer la file.
DROP POLICY IF EXISTS sms_recipients_scope_read ON public.sms_campaign_recipients;
CREATE POLICY sms_recipients_scope_read ON public.sms_campaign_recipients
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sms_campaigns c
    WHERE c.id = sms_campaign_recipients.campaign_id
      AND (
        public.is_super_admin()
        OR (c.organizer_id IS NOT NULL AND c.organizer_id = auth.uid())
        OR (c.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), c.venue_id))
      )
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Garde de portée (une seule définition, réutilisée partout)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin()
    OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
    OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.sms_scope_allowed(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sms_scope_allowed(text, uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Résolution d'audience (service_role) + comptage (pro, gardé)
-- ────────────────────────────────────────────────────────────────────────────
-- Segments :
--   all        tous les contacts consentants de la portée
--   event      contacts dont le consentement vient de CETTE soirée (acheteurs)
--   vip        contacts issus d'une réservation de table
--   not_event  contacts sans billet ni table pour CETTE soirée — le segment
--              « il reste des places » : on relance ceux qui n'ont pas encore
--              acheté, jamais ceux qui ont déjà payé.
-- Consentement périmé (> 36 mois) ou retiré : jamais résolu, quel que soit le
-- segment. La vérification se fait À L'ENVOI, pas à la création.
DROP FUNCTION IF EXISTS public.resolve_sms_campaign_recipients(text, text, uuid);
CREATE FUNCTION public.resolve_sms_campaign_recipients(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_segment_type      text,
  p_event_id          uuid DEFAULT NULL
)
RETURNS TABLE(contact_id uuid, phone_e164 text, full_name text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: service_role only';
  END IF;
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: exactly one scope required';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (c.phone_e164)
         c.id, c.phone_e164, c.full_name, c.user_id
    FROM public.venue_sms_contacts c
   WHERE NOT c.unsubscribed
     AND c.sms_consent_at > now() - interval '36 months'
     AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
     AND (
       (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
     )
     AND CASE COALESCE(p_segment_type, 'all')
           WHEN 'event' THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
           WHEN 'vip'   THEN c.is_vip
           WHEN 'not_event' THEN p_event_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM public.tickets t
                WHERE t.event_id = p_event_id
                  AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                  AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.table_reservations tr
                WHERE tr.event_id = p_event_id
                  AND tr.status <> 'refunded'
                  AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
             )
           ELSE true
         END
   ORDER BY c.phone_e164, c.sms_consent_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_sms_campaign_recipients(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sms_campaign_recipients(text, uuid, text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.count_sms_campaign_recipients(text, text, uuid);
CREATE FUNCTION public.count_sms_campaign_recipients(
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_segment_type      text,
  p_event_id          uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT count(*) INTO v_count
    FROM (
      SELECT DISTINCT c.phone_e164
        FROM public.venue_sms_contacts c
       WHERE NOT c.unsubscribed
         AND c.sms_consent_at > now() - interval '36 months'
         AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         AND (
           (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
         )
         AND CASE COALESCE(p_segment_type, 'all')
               WHEN 'event' THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
               WHEN 'vip'   THEN c.is_vip
               WHEN 'not_event' THEN p_event_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = p_event_id
                      AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                      AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM public.table_reservations tr
                    WHERE tr.event_id = p_event_id
                      AND tr.status <> 'refunded'
                      AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
                 )
               ELSE true
             END
    ) d;
  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.count_sms_campaign_recipients(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_sms_campaign_recipients(text, uuid, text, uuid) TO authenticated, service_role;

-- Vue d'ensemble de la base de contacts d'une portée (en-tête de la page).
CREATE OR REPLACE FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH base AS (
    SELECT c.*
      FROM public.venue_sms_contacts c
     WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
  ),
  live AS (
    SELECT * FROM base
     WHERE NOT unsubscribed AND sms_consent_at > now() - interval '36 months'
  ),
  per_event AS (
    SELECT l.source_event_id AS event_id, e.title, e.start_at, count(DISTINCT l.phone_e164) AS n
      FROM live l JOIN public.events e ON e.id = l.source_event_id
     GROUP BY l.source_event_id, e.title, e.start_at
     ORDER BY e.start_at DESC
     LIMIT 12
  )
  SELECT jsonb_build_object(
    'active',       (SELECT count(DISTINCT phone_e164) FROM live),
    'vip',          (SELECT count(DISTINCT phone_e164) FROM live WHERE is_vip),
    'last_30d',     (SELECT count(DISTINCT phone_e164) FROM live WHERE sms_consent_at > now() - interval '30 days'),
    'unsubscribed', (SELECT count(*) FROM base WHERE unsubscribed),
    'events',       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'event_id', event_id, 'title', title, 'start_at', start_at, 'contacts', n
                      )) FROM per_event), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sms_contacts_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sms_contacts_overview(text, uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. File de travail : enqueue / claim / marquage en lot / reprise
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_sms_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_seg    text;
  v_event  uuid;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_sms_campaign_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;

  v_seg   := COALESCE(c.segment_filters->>'type', 'all');
  v_event := COALESCE(c.event_id, NULLIF(c.segment_filters->>'event_id', '')::uuid);

  INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, user_id, phone_e164, full_name, lang)
  SELECT p_campaign_id, r.contact_id, r.user_id, r.phone_e164, r.full_name,
         COALESCE(pr.preferred_language, 'fr')
    FROM public.resolve_sms_campaign_recipients(c.venue_id, c.organizer_id, v_seg, v_event) r
    LEFT JOIN public.profiles pr ON pr.id = r.user_id
  ON CONFLICT (campaign_id, phone_e164) DO NOTHING;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE public.sms_campaigns
     SET total_recipients = v_total,
         estimated_recipients = v_total
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('total', v_total, 'pending', v_pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_sms_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, phone_e164 text, full_name text, user_id uuid, lang text, attempts integer)
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
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sms_campaign_recipients r
     SET status = 'sending', claimed_at = now(), attempts = r.attempts + 1
    FROM picked
   WHERE r.id = picked.id
  RETURNING r.id, r.phone_e164, r.full_name, r.user_id, r.lang, r.attempts;
END;
$$;

-- p_rows : [{"id": uuid, "twilio_sid": "...", "sms_log_id": uuid, "credits": 1}]
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
    SELECT (x->>'id')::uuid AS rid, NULLIF(x->>'twilio_sid','') AS sid,
           NULLIF(x->>'sms_log_id','')::uuid AS log_id, COALESCE((x->>'credits')::int, 1) AS credits
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  ), upd AS (
    UPDATE public.sms_campaign_recipients r
       SET status = 'sent', twilio_sid = src.sid, sms_log_id = src.log_id,
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

CREATE OR REPLACE FUNCTION public.mark_sms_campaign_recipients_failed(
  p_campaign_id uuid, p_ids uuid[], p_error text,
  p_error_code text DEFAULT NULL, p_retry_at timestamptz DEFAULT NULL, p_max_attempts integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0; v_failed integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'mark_sms_campaign_recipients_failed: service_role only';
  END IF;
  WITH upd AS (
    UPDATE public.sms_campaign_recipients r
       SET status = CASE WHEN p_retry_at IS NOT NULL AND r.attempts < p_max_attempts THEN 'pending' ELSE 'failed' END,
           next_attempt_at = CASE WHEN p_retry_at IS NOT NULL AND r.attempts < p_max_attempts THEN p_retry_at ELSE NULL END,
           claimed_at = NULL,
           error_code = COALESCE(p_error_code, r.error_code),
           error_message = left(COALESCE(p_error, 'unknown'), 500)
     WHERE r.campaign_id = p_campaign_id AND r.id = ANY(p_ids) AND r.status = 'sending'
    RETURNING r.status
  )
  SELECT count(*), count(*) FILTER (WHERE status = 'failed') INTO v_count, v_failed FROM upd;

  IF v_failed > 0 THEN
    UPDATE public.sms_campaigns SET failed_count = failed_count + v_failed, last_slice_at = now()
     WHERE id = p_campaign_id;
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.requeue_stale_sms_claims(p_stale_minutes integer DEFAULT 10, p_max_attempts integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'requeue_stale_sms_claims: service_role only';
  END IF;
  WITH upd AS (
    UPDATE public.sms_campaign_recipients r
       SET status = CASE WHEN r.attempts >= p_max_attempts THEN 'failed' ELSE 'pending' END,
           claimed_at = NULL,
           error_message = CASE WHEN r.attempts >= p_max_attempts
                                THEN 'Abandon après ' || r.attempts || ' tentatives (worker interrompu)'
                                ELSE r.error_message END
     WHERE r.status = 'sending' AND r.claimed_at IS NOT NULL
       AND r.claimed_at < now() - make_interval(mins => GREATEST(1, p_stale_minutes))
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_sms_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_sms_campaign_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_sms_campaign_recipients_sent(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_sms_campaign_recipients_failed(uuid, uuid[], text, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stale_sms_claims(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_sms_campaign_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_sms_campaign_recipients(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_sms_campaign_recipients_sent(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_sms_campaign_recipients_failed(uuid, uuid[], text, text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_sms_claims(integer, integer) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Accusés de livraison Twilio — une RPC atomique (log + file + compteurs
--    + remboursement). Idempotente : un même statut rejoué ne compte pas deux
--    fois, et un crédit n'est jamais remboursé deux fois (sms_logs.refunded).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_sms_delivery_status(
  p_twilio_sid text, p_status text, p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
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

  SELECT * INTO v_log FROM public.sms_logs WHERE twilio_sid = p_twilio_sid LIMIT 1;
  IF NOT FOUND THEN
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
    -- Un « sent » tardif ne doit jamais écraser un « delivered » déjà reçu.
    UPDATE public.sms_logs
       SET status = CASE WHEN v_new = 'sent' AND status IN ('delivered','failed','undelivered') THEN status ELSE v_new END,
           delivered_at = CASE WHEN v_new = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
           error_code = COALESCE(p_error_code, error_code),
           error_message = COALESCE(p_error_message, error_message)
     WHERE id = v_log.id;
  END IF;

  -- Ligne de file correspondante (campagnes uniquement ; les SMS transactionnels
  -- n'en ont pas).
  SELECT r.id, r.status, r.campaign_id INTO v_rec_id, v_rec_status, v_campaign
    FROM public.sms_campaign_recipients r
   WHERE r.twilio_sid = p_twilio_sid
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

  -- Échec terminal : le crédit revient au pro (une seule fois).
  IF v_new IN ('failed','undelivered') AND NOT v_log.refunded THEN
    SELECT id INTO v_balance FROM public.sms_credit_balances
     WHERE (v_log.venue_id IS NOT NULL AND venue_id = v_log.venue_id)
        OR (v_log.organizer_id IS NOT NULL AND organizer_id = v_log.organizer_id)
     LIMIT 1;
    IF v_balance IS NOT NULL THEN
      PERFORM public.refund_sms_credits(v_balance, GREATEST(1, v_log.credits_consumed), v_log.id,
        'Auto-refund: Twilio ' || v_new::text || ' (' || COALESCE(p_error_code, 'no code') || ')');
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
REVOKE ALL ON FUNCTION public.apply_sms_delivery_status(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sms_delivery_status(text, text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Lien suivi « sms » d'une soirée (clics + ventes attribuées au SMS)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_sms_tracked_link(p_event_id uuid)
RETURNS TABLE(id uuid, code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event      public.events%ROWTYPE;
  v_owner_kind text;
  v_venue_id   text;
  v_org_user   uuid;
  v_created_by uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ensure_sms_tracked_link: service_role only';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE events.id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_event.venue_id IS NOT NULL THEN
    v_owner_kind := 'venue';
    v_venue_id   := v_event.venue_id;
    SELECT owner_id INTO v_created_by FROM public.venues WHERE venues.id = v_event.venue_id;
    v_created_by := COALESCE(v_created_by, v_event.organizer_user_id);
  ELSIF v_event.organizer_user_id IS NOT NULL THEN
    v_owner_kind := 'organizer';
    v_org_user   := v_event.organizer_user_id;
    v_created_by := v_event.organizer_user_id;
  ELSE
    RETURN;
  END IF;
  IF v_created_by IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id AND tl.owner_kind = v_owner_kind AND lower(tl.label) = 'sms'
       AND tl.promoter_id IS NULL AND tl.dj_id IS NULL
  ) THEN
    INSERT INTO public.tracked_links
      (code, label, owner_kind, venue_id, organizer_user_id, created_by, target_kind, event_id, utm_source, utm_medium)
    VALUES
      (public.gen_tracked_link_code(), 'sms', v_owner_kind, v_venue_id, v_org_user, v_created_by, 'event', p_event_id, 'sms', 'sms_campaign');
  END IF;

  RETURN QUERY
  SELECT tl.id, tl.code FROM public.tracked_links tl
   WHERE tl.event_id = p_event_id AND tl.owner_kind = v_owner_kind AND lower(tl.label) = 'sms'
     AND tl.promoter_id IS NULL AND tl.dj_id IS NULL
   ORDER BY tl.created_at ASC LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_sms_tracked_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_sms_tracked_link(uuid) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Rapport de campagne (pro, gardé)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sms_campaign_report(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.sms_scope_allowed(c.venue_id, c.organizer_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH r AS (
    SELECT * FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id
  ),
  counts AS (
    SELECT
      count(*)                                                    AS total,
      count(*) FILTER (WHERE status = 'pending')                  AS pending,
      count(*) FILTER (WHERE status = 'sending')                  AS sending,
      count(*) FILTER (WHERE status IN ('sent','delivered','undelivered')) AS sent,
      count(*) FILTER (WHERE status = 'delivered')                AS delivered,
      count(*) FILTER (WHERE status = 'undelivered')              AS undelivered,
      count(*) FILTER (WHERE status = 'failed')                   AS failed,
      count(*) FILTER (WHERE status = 'skipped')                  AS skipped,
      COALESCE(sum(credits) FILTER (WHERE status IN ('sent','delivered','undelivered','failed')), 0) AS credits
    FROM r
  ),
  clicks AS (
    SELECT count(*) AS n, count(DISTINCT COALESCE(visitor_id, ip_hash, id::text)) AS uniq
      FROM public.tracked_link_clicks tc
     WHERE c.tracked_link_id IS NOT NULL
       AND tc.tracked_link_id = c.tracked_link_id
       AND tc.clicked_at >= COALESCE(c.send_started_at, c.created_at)
  ),
  sales AS (
    SELECT
      (SELECT count(*) FROM public.tickets t
        WHERE c.tracked_link_id IS NOT NULL AND t.tracked_link_id = c.tracked_link_id
          AND t.status = 'paid' AND t.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tickets,
      (SELECT COALESCE(sum(t.total_price), 0) FROM public.tickets t
        WHERE c.tracked_link_id IS NOT NULL AND t.tracked_link_id = c.tracked_link_id
          AND t.status = 'paid' AND t.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tickets_revenue,
      (SELECT count(*) FROM public.table_reservations tr
        WHERE c.tracked_link_id IS NOT NULL AND tr.tracked_link_id = c.tracked_link_id
          AND tr.status = 'paid' AND tr.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tables,
      (SELECT COALESCE(sum(tr.total_price), 0) FROM public.table_reservations tr
        WHERE c.tracked_link_id IS NOT NULL AND tr.tracked_link_id = c.tracked_link_id
          AND tr.status = 'paid' AND tr.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tables_revenue
  ),
  timeline AS (
    SELECT date_trunc('hour', delivered_at) AS h, count(*) AS n
      FROM r WHERE delivered_at IS NOT NULL
     GROUP BY 1 ORDER BY 1
     LIMIT 72
  )
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'status', c.status::text, 'paused_reason', c.paused_reason,
    'error_message', c.error_message, 'body_template', c.body_template, 'sender_name', c.sender_name,
    'segment_filters', c.segment_filters, 'event_id', c.event_id,
    'scheduled_at', c.scheduled_at, 'send_started_at', c.send_started_at, 'sent_at', c.sent_at,
    'created_at', c.created_at, 'quiet_hours', c.quiet_hours,
    'segments_per_message', c.segments_per_message,
    'credits_consumed', c.credits_consumed, 'credits_refunded', c.credits_refunded,
    'tracked_link_code', (SELECT code FROM public.tracked_links WHERE tracked_links.id = c.tracked_link_id),
    'counts', (SELECT to_jsonb(counts) FROM counts),
    'clicks', (SELECT to_jsonb(clicks) FROM clicks),
    'sales',  (SELECT to_jsonb(sales) FROM sales),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', h, 'delivered', n)) FROM timeline), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sms_campaign_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sms_campaign_report(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Consentement côté client : portée organisateur pour le SMS
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_marketing_consent(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(email_opted_in boolean, sms_opted_in boolean, email_since timestamp with time zone, sms_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_stale timestamptz := now() - interval '36 months';
BEGIN
  IF v_uid IS NULL OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RETURN QUERY SELECT false, false, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT ns.opted_in AND ns.updated_at > v_stale
      FROM public.newsletter_subscriptions ns
      WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
        AND (
          (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
        )
      ORDER BY ns.updated_at DESC
      LIMIT 1
    ), false),
    COALESCE((
      SELECT NOT sc.unsubscribed AND sc.sms_consent_at > v_stale
      FROM public.venue_sms_contacts sc
      WHERE (
          (p_venue_id IS NOT NULL AND sc.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND sc.organizer_user_id = p_organizer_user_id)
        )
        AND (sc.user_id = v_uid
             OR (v_phone IS NOT NULL
                 AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    ), false),
    (
      SELECT ns.created_at
      FROM public.newsletter_subscriptions ns
      WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
        AND (
          (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
        )
      ORDER BY ns.updated_at DESC
      LIMIT 1
    ),
    (
      SELECT sc.sms_consent_at
      FROM public.venue_sms_contacts sc
      WHERE (
          (p_venue_id IS NOT NULL AND sc.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND sc.organizer_user_id = p_organizer_user_id)
        )
        AND (sc.user_id = v_uid
             OR (v_phone IS NOT NULL
                 AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_my_marketing_consent(p_channel text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_wording_text text DEFAULT ''::text, p_locale text DEFAULT NULL::text, p_source text DEFAULT 'checkout'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentification requise';
  END IF;
  IF p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'canal invalide: %', p_channel;
  END IF;
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'portée requise (club ou organisateur)';
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  IF p_channel = 'email' THEN
    UPDATE public.newsletter_subscriptions ns
    SET opted_in = false, opted_out_at = now(), updated_at = now()
    WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
      AND (
        (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
      );
  ELSE
    UPDATE public.venue_sms_contacts sc
    SET unsubscribed = true, unsubscribed_at = now()
    WHERE (
        (p_venue_id IS NOT NULL AND sc.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND sc.organizer_user_id = p_organizer_user_id)
      )
      AND (sc.user_id = v_uid
           OR (v_phone IS NOT NULL
               AND public.normalize_phone_e164(sc.phone_e164) = v_phone));
  END IF;

  INSERT INTO public.marketing_consent_events (
    user_id, email, phone_e164, channel, venue_id, organizer_user_id,
    action, wording_text, locale, source
  ) VALUES (
    v_uid, v_email, v_phone, p_channel, p_venue_id, p_organizer_user_id,
    'withdrawn', COALESCE(NULLIF(p_wording_text, ''), 'withdrawal'), p_locale, p_source
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_marketing_subscriptions()
 RETURNS TABLE(scope_type text, venue_id text, organizer_user_id uuid, scope_name text, email_opted_in boolean, sms_opted_in boolean, since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone) INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  RETURN QUERY
  WITH email_subs AS (
    SELECT ns.venue_id, ns.organizer_user_id, ns.opted_in, ns.created_at
    FROM public.newsletter_subscriptions ns
    WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
      AND ns.opted_in
  ),
  sms_subs AS (
    SELECT sc.venue_id, sc.organizer_user_id, sc.sms_consent_at
    FROM public.venue_sms_contacts sc
    WHERE NOT sc.unsubscribed
      AND (sc.user_id = v_uid
           OR (v_phone IS NOT NULL AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
  ),
  scopes AS (
    SELECT e.venue_id, e.organizer_user_id FROM email_subs e
    UNION
    SELECT s.venue_id, s.organizer_user_id FROM sms_subs s
  )
  SELECT
    CASE WHEN sc.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    sc.venue_id,
    sc.organizer_user_id,
    COALESCE(v.name, pr.organization_name, 'Organisateur'),
    EXISTS (
      SELECT 1 FROM email_subs e
      WHERE e.venue_id IS NOT DISTINCT FROM sc.venue_id
        AND e.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id
    ),
    EXISTS (
      SELECT 1 FROM sms_subs s
      WHERE s.venue_id IS NOT DISTINCT FROM sc.venue_id
        AND s.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id
    ),
    LEAST(
      (SELECT min(e.created_at) FROM email_subs e
        WHERE e.venue_id IS NOT DISTINCT FROM sc.venue_id
          AND e.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id),
      (SELECT min(s.sms_consent_at) FROM sms_subs s
        WHERE s.venue_id IS NOT DISTINCT FROM sc.venue_id
          AND s.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id)
    )
  FROM scopes sc
  LEFT JOIN public.venues v ON v.id = sc.venue_id
  LEFT JOIN public.profiles pr ON pr.id = sc.organizer_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sms_stop_unsubscribe(_phone text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text := public.normalize_phone_e164(_phone);
  v_count integer := 0;
BEGIN
  IF v_norm IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.venue_sms_contacts sc
  SET unsubscribed = true, unsubscribed_at = now()
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND NOT sc.unsubscribed;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.profiles p
  SET phone_sms_opt_in = false
  WHERE public.normalize_phone_e164(p.phone) = v_norm
    AND p.phone_sms_opt_in;

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

COMMENT ON TABLE public.sms_campaign_recipients IS
  'File d''envoi d''une campagne SMS : une ligne par numéro, réservée par lot (FOR UPDATE SKIP LOCKED) et marquée en lot. Statuts de livraison poussés par le webhook Twilio via apply_sms_delivery_status.';
