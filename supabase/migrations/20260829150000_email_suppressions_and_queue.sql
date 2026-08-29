-- ───────────────────────────────────────────────────────────────────────────
-- Envoi de masse (1/3) — liste de suppression globale + file d'attente
--
-- Pourquoi : `send-campaign` envoyait tout dans une seule invocation, avec un
-- UPDATE par destinataire. À 3 000 adresses ça dépasse le wall-clock d'une
-- edge function et la campagne reste bloquée en 'sending'. On transforme
-- `email_campaign_recipients` en VRAIE file de travail :
--   • claim atomique (FOR UPDATE SKIP LOCKED) → deux workers ne peuvent pas
--     envoyer au même destinataire ;
--   • marquage EN LOT (un appel, pas N) ;
--   • reprise des claims morts (fonction tuée en plein vol).
--
-- Et on pose la liste de suppression PLATEFORME. Décision assumée : un hard
-- bounce ou une plainte suppriment l'adresse pour TOUS les expéditeurs, pas
-- seulement celui qui l'a touchée — la réputation de yunoapp.eu est mutualisée
-- entre tous les clubs ET les emails transactionnels (billets, reçus). Une
-- adresse morte re-sollicitée par le club B après avoir bouncé chez le club A,
-- c'est le domaine entier qui prend.
-- La suppression n'est consultée QU'À la constitution d'une audience marketing :
-- elle ne peut jamais bloquer une confirmation de billet.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Liste de suppression plateforme ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('hard_bounce','complaint','invalid','manual')),
  source text,
  scope_venue_id text,
  scope_organizer_user_id uuid,
  campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_suppressions_email
  ON public.email_suppressions (lower(email));
CREATE INDEX IF NOT EXISTS idx_email_suppressions_created
  ON public.email_suppressions (created_at DESC);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

-- Aucune policy d'écriture : seules les fonctions SECURITY DEFINER et le
-- service_role (webhook Resend) y touchent.
DROP POLICY IF EXISTS "Super admin reads suppressions" ON public.email_suppressions;
CREATE POLICY "Super admin reads suppressions"
  ON public.email_suppressions FOR SELECT
  USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.is_email_suppressed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.email_suppressions s
    WHERE lower(s.email) = lower(COALESCE(p_email, ''))
  );
$$;

-- Ajout d'une suppression. Idempotent : la 1re raison gagne (un hard bounce
-- déjà enregistré n'est pas écrasé par une plainte ultérieure).
CREATE OR REPLACE FUNCTION public.suppress_email(
  p_email text,
  p_reason text,
  p_source text DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  v_inserted boolean := false;
BEGIN
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RETURN false;
  END IF;
  IF p_reason NOT IN ('hard_bounce','complaint','invalid','manual') THEN
    RETURN false;
  END IF;

  INSERT INTO public.email_suppressions (email, reason, source, campaign_id, metadata)
  VALUES (v_email, p_reason, p_source, p_campaign_id, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (lower(email)) DO NOTHING;
  v_inserted := FOUND;

  -- Couper le consentement marketing partout où il existe : les automations
  -- (win-back, anniversaire, upsell) passent par la porte opted_in, pas par
  -- la liste de suppression.
  UPDATE public.newsletter_subscriptions
     SET opted_in = false, opted_out_at = COALESCE(opted_out_at, now())
   WHERE lower(email) = v_email AND opted_in = true;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.suppress_email(text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suppress_email(text, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_email_suppressed(text) TO authenticated, service_role;

-- ── 2. email_campaign_recipients devient une file de travail ────────────────
ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

ALTER TABLE public.email_campaign_recipients
  DROP CONSTRAINT IF EXISTS email_campaign_recipients_status_check;
ALTER TABLE public.email_campaign_recipients
  ADD CONSTRAINT email_campaign_recipients_status_check
  CHECK (status IN ('pending','sending','sent','failed','bounced','complained','suppressed','skipped'));

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_pending
  ON public.email_campaign_recipients (campaign_id, id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_claimed
  ON public.email_campaign_recipients (claimed_at)
  WHERE status = 'sending';

-- ── 3. Compteurs + statuts de campagne ──────────────────────────────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS total_recipients integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounced_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS complained_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS send_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_slice_at timestamptz;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_status_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN ('draft','scheduled','sending','paused','sent','failed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_email_campaigns_sending
  ON public.email_campaigns (last_slice_at)
  WHERE status = 'sending';

-- ── 4. Claim atomique d'un lot ──────────────────────────────────────────────
-- FOR UPDATE SKIP LOCKED : deux invocations concurrentes (auto-chaînage + cron)
-- ne peuvent JAMAIS réserver le même destinataire. C'est la garantie
-- anti-doublon côté base ; côté Resend, la clé d'idempotence couvre le cas du
-- worker tué APRÈS l'appel HTTP mais AVANT le marquage.
CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(
  p_campaign_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_campaign_recipients: service_role only';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT r.id
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.status = 'pending'
       AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
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
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts;
END;
$$;

-- ── 5. Marquage EN LOT (un aller-retour, pas N) ─────────────────────────────
-- p_rows : [{"email":"a@b.c","resend_email_id":"..."}]
CREATE OR REPLACE FUNCTION public.mark_campaign_recipients_sent(
  p_campaign_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'mark_campaign_recipients_sent: service_role only';
  END IF;

  WITH src AS (
    SELECT lower(x->>'email') AS addr, NULLIF(x->>'resend_email_id','') AS rid
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  ), upd AS (
    UPDATE public.email_campaign_recipients r
       SET status = 'sent',
           resend_email_id = COALESCE(src.rid, r.resend_email_id),
           sent_at = now(),
           claimed_at = NULL,
           error_message = NULL
      FROM src
     WHERE r.campaign_id = p_campaign_id
       AND lower(r.email) = src.addr
       AND r.status <> 'sent'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  UPDATE public.email_campaigns
     SET recipients_count = recipients_count + v_count,
         last_slice_at = now()
   WHERE id = p_campaign_id;

  RETURN v_count;
END;
$$;

-- Échec d'un lot. p_retry_at NULL = échec définitif ; sinon on remet en file.
CREATE OR REPLACE FUNCTION public.mark_campaign_recipients_failed(
  p_campaign_id uuid,
  p_emails text[],
  p_error text,
  p_retry_at timestamptz DEFAULT NULL,
  p_max_attempts integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_failed integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'mark_campaign_recipients_failed: service_role only';
  END IF;

  WITH upd AS (
    UPDATE public.email_campaign_recipients r
       SET status = CASE
                      WHEN p_retry_at IS NOT NULL AND r.attempts < p_max_attempts THEN 'pending'
                      ELSE 'failed'
                    END,
           next_attempt_at = CASE
                      WHEN p_retry_at IS NOT NULL AND r.attempts < p_max_attempts THEN p_retry_at
                      ELSE NULL
                    END,
           claimed_at = NULL,
           error_message = left(COALESCE(p_error, 'unknown'), 500)
      FROM unnest(p_emails) AS e(email)
     WHERE r.campaign_id = p_campaign_id
       AND lower(r.email) = lower(e.email)
       AND r.status = 'sending'
    RETURNING r.status
  )
  SELECT count(*), count(*) FILTER (WHERE status = 'failed') INTO v_count, v_failed FROM upd;

  IF v_failed > 0 THEN
    UPDATE public.email_campaigns
       SET failed_count = failed_count + v_failed
     WHERE id = p_campaign_id;
  END IF;

  RETURN v_count;
END;
$$;

-- ── 6. Reprise des claims morts ─────────────────────────────────────────────
-- Une edge function tuée laisse des lignes en 'sending' pour toujours. Au-delà
-- de p_stale_minutes on les remet en file (le compteur `attempts` a déjà été
-- incrémenté, donc une ligne ne peut pas boucler indéfiniment).
CREATE OR REPLACE FUNCTION public.requeue_stale_campaign_claims(
  p_stale_minutes integer DEFAULT 10,
  p_max_attempts integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_campaign_recipients_sent(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_campaign_recipients_failed(uuid, text[], text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.requeue_stale_campaign_claims(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_campaign_recipients_sent(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_campaign_recipients_failed(uuid, text[], text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_campaign_claims(integer, integer) TO service_role;
