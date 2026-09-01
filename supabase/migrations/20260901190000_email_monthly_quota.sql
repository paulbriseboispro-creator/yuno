-- ───────────────────────────────────────────────────────────────────────────
-- Quota email MENSUEL par compte pro + crédits à prix coûtant.
--
-- Le gouverneur (20260829150100) protège la JOURNÉE : warm-up + plafond
-- journalier à deux étages. Rien ne comptait le MOIS, alors que le plan Resend
-- se facture au mois (Pro : 50 000/mois) et que le quota est mutualisé entre le
-- marketing de tous les clubs ET tout le transactionnel (billets, MFA,
-- invitations). Un seul organisateur (base de 11 076) pouvait consommer 22 % du
-- plan en une campagne — au dépassement, Resend renvoie des 429 et ce sont les
-- CONFIRMATIONS DE BILLETS des autres clubs qui échouent.
--
-- Le partage décidé le 2026-09-01 (design doc office-hours) :
--
--   plan Resend Pro          50 000 / mois
--   réserve transactionnelle 10 000  (jamais écrite ici : le marketing est
--                                     plafonné à 40 000, le reste est à l'abri
--                                     par construction)
--   pool marketing plateforme 40 000
--   offert par compte         15 000  (la base du plus gros client passe, et
--                                     on bat le palier gratuit de Brevo ~9 000)
--
-- Au-delà : crédits À PRIX COÛTANT. L'overage Resend est 0,90 $/1 000 ; un pack
-- de 10 000 coûte ~8,30 € de Resend + ~0,40 € de Stripe → vendu 10 €. Décision
-- explicite : AUCUN revenu sur l'email, le tampon absorbe le change €/$.
--
-- Mécanique :
-- • email_send_quota_month : jumelle mensuelle du compteur journalier. La ligne
--   scope 'transactional' n'est alimentée que par resend-webhook (observabilité
--   de la réserve — on saura ce que le transactionnel consomme VRAIMENT).
-- • email_sender_state.credit_balance : solde de crédits persistant (un crédit
--   acheté ne périme pas). Consommé seulement APRÈS l'allocation gratuite du
--   mois ; re-crédité symétriquement quand le worker rend du quota non utilisé.
-- • consume/refund/progress : corps INTÉGRALEMENT restatés (pattern maison).
--   L'ordre de verrouillage devient partout plateforme → expéditeur (le refund
--   verrouillait dans l'autre sens : fenêtre AB-BA théorique, corrigée).
-- • Un grant à 0 pour cause de mois épuisé emprunte le chemin existant du
--   plafond journalier : la campagne ATTEND (le cron reprendra), rien n'échoue.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Compteur mensuel ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_send_quota_month (
  scope_key text NOT NULL,
  month date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  sent integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, month)
);

ALTER TABLE public.email_send_quota_month ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lecture via RPC uniquement (comme le compteur journalier).

-- ── 2. Solde de crédits + override mensuel sur l'état d'expéditeur ─────────
ALTER TABLE public.email_sender_state
  ADD COLUMN IF NOT EXISTS credit_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_cap_override integer;

-- ── 3. Packs de crédits ─────────────────────────────────────────────────────
-- Prix = coût réel : overage Resend 0,90 $/1 000 (~0,83 €/1 000) + frais Stripe
-- du checkout (EU 1,5 % + 0,25 €). Le tampon (~1 €/pack) absorbe le change et
-- les cartes non-EU (2,9 % + 0,30 €) — jamais de marge, jamais de perte.
CREATE TABLE IF NOT EXISTS public.email_packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  emails_amount integer NOT NULL CHECK (emails_amount > 0),
  price_eur numeric(8,2) NOT NULL CHECK (price_eur > 0),
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active email packs" ON public.email_packs;
CREATE POLICY "Authenticated read active email packs"
  ON public.email_packs FOR SELECT
  TO authenticated
  USING (is_active = true);

INSERT INTO public.email_packs (id, name, emails_amount, price_eur, position) VALUES
  ('email-pack-10k', '10 000 emails', 10000, 10.00, 1),
  ('email-pack-25k', '25 000 emails', 25000, 24.00, 2)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Registre des crédits ─────────────────────────────────────────────────
-- L'idempotence Stripe vit ICI (index unique sur la session) : un verify
-- rejoué ne crédite jamais deux fois — même patron que les crédits SMS.
CREATE TABLE IF NOT EXISTS public.email_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  type text NOT NULL CHECK (type IN ('purchase','admin_grant','demo')),
  pack_id text REFERENCES public.email_packs(id) ON DELETE SET NULL,
  stripe_session_id text,
  stripe_payment_intent_id text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_credit_tx_stripe_session
  ON public.email_credit_transactions (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_credit_tx_scope
  ON public.email_credit_transactions (scope_key, created_at DESC);

ALTER TABLE public.email_credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own email credit tx" ON public.email_credit_transactions;
CREATE POLICY "Owners read own email credit tx"
  ON public.email_credit_transactions FOR SELECT
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );
-- Aucune policy d'écriture : add_email_credits (service_role) est le seul chemin.

-- ── 5. Allocation mensuelle gratuite ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_sender_monthly_free(p_scope_key text)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override integer;
BEGIN
  SELECT monthly_cap_override INTO v_override
    FROM public.email_sender_state WHERE scope_key = p_scope_key;
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v_override, 40000);   -- pool marketing (plan 50k − réserve 10k)
  END IF;
  RETURN COALESCE(v_override, 15000);     -- offert par compte pro
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_sender_monthly_free(text) TO authenticated, service_role;

-- ── 6. Consommation atomique v2 : journée + mois + crédits ──────────────────
-- Corps restaté depuis 20260829150100 §4. Verrouillage TOUJOURS dans l'ordre
-- plateforme (jour, mois) puis expéditeur (état, jour, mois).
CREATE OR REPLACE FUNCTION public.consume_email_send_quota(
  p_scope_key text,
  p_requested integer,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req integer := GREATEST(0, COALESCE(p_requested, 0));
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_platform integer;
  v_granted integer;
  v_day_sent integer;
  v_month_sent integer;
  v_day_cap integer;
  v_month_cap integer;
  v_free integer;
  v_credits integer;
  v_allowed_month integer;
  v_used_credits integer;
  v_pct_before numeric;
  v_pct_after numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'consume_email_send_quota: service_role only';
  END IF;
  IF v_req = 0 THEN RETURN 0; END IF;

  -- Étage 1 : plateforme, jour PUIS mois. L'upsert DO UPDATE crée ET verrouille
  -- la ligne en un seul aller-retour.
  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES ('platform', CURRENT_DATE, 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_day_sent;
  v_day_cap := public.email_sender_daily_cap('platform');

  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES ('platform', v_month, 0)
  ON CONFLICT (scope_key, month) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_month_sent;
  v_month_cap := public.email_sender_monthly_free('platform');

  v_platform := GREATEST(0, LEAST(v_req, v_day_cap - v_day_sent, v_month_cap - v_month_sent));
  IF v_platform = 0 THEN RETURN 0; END IF;

  UPDATE public.email_send_quota SET sent = sent + v_platform, updated_at = now()
   WHERE scope_key = 'platform' AND day = CURRENT_DATE;
  UPDATE public.email_send_quota_month SET sent = sent + v_platform, updated_at = now()
   WHERE scope_key = 'platform' AND month = v_month;

  -- Étage 2 : expéditeur. L'état porte le solde de crédits : on le verrouille
  -- pour sérialiser la consommation de crédits entre workers concurrents.
  INSERT INTO public.email_sender_state (scope_key, venue_id, organizer_user_id)
  VALUES (p_scope_key, p_venue_id, p_organizer_user_id)
  ON CONFLICT (scope_key) DO NOTHING;

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = p_scope_key FOR UPDATE;

  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES (p_scope_key, CURRENT_DATE, 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_day_sent;
  v_day_cap := public.email_sender_daily_cap(p_scope_key);

  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES (p_scope_key, v_month, 0)
  ON CONFLICT (scope_key, month) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_month_sent;
  v_free := public.email_sender_monthly_free(p_scope_key);

  v_allowed_month := GREATEST(0, (v_free + v_credits) - v_month_sent);
  v_granted := GREATEST(0, LEAST(v_platform, v_day_cap - v_day_sent, v_allowed_month));

  IF v_granted < v_platform THEN
    -- Rendre à la plateforme (jour ET mois) ce que l'expéditeur n'a pas pris.
    UPDATE public.email_send_quota SET sent = sent - (v_platform - v_granted)
     WHERE scope_key = 'platform' AND day = CURRENT_DATE;
    UPDATE public.email_send_quota_month SET sent = sent - (v_platform - v_granted)
     WHERE scope_key = 'platform' AND month = v_month;
  END IF;
  IF v_granted = 0 THEN RETURN 0; END IF;

  UPDATE public.email_send_quota SET sent = sent + v_granted, updated_at = now()
   WHERE scope_key = p_scope_key AND day = CURRENT_DATE;
  UPDATE public.email_send_quota_month SET sent = sent + v_granted, updated_at = now()
   WHERE scope_key = p_scope_key AND month = v_month;

  -- Crédits : seul le dépassement de l'allocation gratuite en consomme.
  v_used_credits := GREATEST(0, (v_month_sent + v_granted) - v_free)
                  - GREATEST(0, v_month_sent - v_free);

  UPDATE public.email_sender_state
     SET first_send_at = COALESCE(first_send_at, now()),
         lifetime_sent = lifetime_sent + v_granted,
         credit_balance = GREATEST(0, credit_balance - v_used_credits),
         updated_at = now()
   WHERE scope_key = p_scope_key;

  -- Alerte super admin au franchissement de 80 % / 100 % de l'allocation
  -- gratuite. dedup_key mensuel : une alerte par seuil et par mois, pas une
  -- par tranche d'envoi. Une alerte d'observabilité ne fait JAMAIS échouer
  -- l'écriture métier qu'elle observe.
  BEGIN
    v_pct_before := v_month_sent::numeric / NULLIF(v_free, 0);
    v_pct_after  := (v_month_sent + v_granted)::numeric / NULLIF(v_free, 0);
    IF v_pct_before < 1 AND v_pct_after >= 1 THEN
      PERFORM public.emit_admin_notification(
        'admin_email_quota_100',
        'Quota email du mois épuisé',
        p_scope_key || ' a consommé les ' || v_free || ' emails offerts du mois.',
        'high', 'email_sender', p_scope_key,
        jsonb_build_object('venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                           'month', v_month, 'free', v_free, 'credits_left', GREATEST(0, v_credits - v_used_credits)),
        'email_quota_100_' || p_scope_key || '_' || to_char(v_month, 'YYYY-MM'));
    ELSIF v_pct_before < 0.8 AND v_pct_after >= 0.8 THEN
      PERFORM public.emit_admin_notification(
        'admin_email_quota_80',
        'Quota email du mois à 80 %',
        p_scope_key || ' a consommé 80 % de ses ' || v_free || ' emails offerts du mois.',
        'normal', 'email_sender', p_scope_key,
        jsonb_build_object('venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                           'month', v_month, 'free', v_free),
        'email_quota_80_' || p_scope_key || '_' || to_char(v_month, 'YYYY-MM'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_granted;
END;
$$;

-- ── 7. Restitution v2 : jour + mois + re-crédit ─────────────────────────────
-- Corps restaté depuis 20260829150100 §4 bis. L'ordre de verrouillage passe à
-- plateforme puis expéditeur (aligné sur consume — l'ancien ordre inverse
-- ouvrait une fenêtre d'interblocage théorique).
CREATE OR REPLACE FUNCTION public.refund_email_send_quota(
  p_scope_key text,
  p_amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_before integer;
  v_free integer;
  v_giveback integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'refund_email_send_quota: service_role only';
  END IF;
  IF v_amount = 0 THEN RETURN; END IF;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = 'platform' AND day = CURRENT_DATE;
  UPDATE public.email_send_quota_month
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = 'platform' AND month = v_month;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = p_scope_key AND day = CURRENT_DATE;

  -- Le mois de l'expéditeur : lire AVANT de décrémenter pour rendre au solde
  -- de crédits exactement ce que le dépassement avait consommé.
  SELECT sent INTO v_before FROM public.email_send_quota_month
   WHERE scope_key = p_scope_key AND month = v_month FOR UPDATE;

  IF FOUND THEN
    v_free := public.email_sender_monthly_free(p_scope_key);
    v_giveback := GREATEST(0, v_before - v_free)
                - GREATEST(0, GREATEST(0, v_before - v_amount) - v_free);
    UPDATE public.email_send_quota_month
       SET sent = GREATEST(0, sent - v_amount), updated_at = now()
     WHERE scope_key = p_scope_key AND month = v_month;
  ELSE
    v_giveback := 0;
  END IF;

  UPDATE public.email_sender_state
     SET lifetime_sent = GREATEST(0, lifetime_sent - v_amount),
         credit_balance = credit_balance + COALESCE(v_giveback, 0)
   WHERE scope_key = p_scope_key;
END;
$$;

-- ── 8. Créditer un compte (achat Stripe, geste admin, démo) ─────────────────
CREATE OR REPLACE FUNCTION public.add_email_credits(
  p_scope_key text,
  p_venue_id text,
  p_organizer_user_id uuid,
  p_amount integer,
  p_type text,
  p_pack_id text DEFAULT NULL,
  p_stripe_session_id text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_inserted boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'add_email_credits: service_role only';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'add_email_credits: montant invalide';
  END IF;
  IF p_type NOT IN ('purchase','admin_grant','demo') THEN
    RAISE EXCEPTION 'add_email_credits: type invalide';
  END IF;

  -- Idempotence : l'index unique sur la session Stripe fait foi. Un verify
  -- rejoué (double clic, retour navigateur) ne crédite pas deux fois.
  INSERT INTO public.email_credit_transactions
    (scope_key, venue_id, organizer_user_id, amount, type, pack_id,
     stripe_session_id, stripe_payment_intent_id, notes, created_by)
  VALUES
    (p_scope_key, p_venue_id, p_organizer_user_id, p_amount, p_type, p_pack_id,
     p_stripe_session_id, p_stripe_payment_intent_id, p_notes, p_created_by)
  ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL
  DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    INSERT INTO public.email_sender_state (scope_key, venue_id, organizer_user_id, credit_balance)
    VALUES (p_scope_key, p_venue_id, p_organizer_user_id, p_amount)
    ON CONFLICT (scope_key) DO UPDATE
      SET credit_balance = public.email_sender_state.credit_balance + p_amount,
          updated_at = now();
  END IF;

  SELECT credit_balance INTO v_balance
    FROM public.email_sender_state WHERE scope_key = p_scope_key;
  RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.add_email_credits(text, text, uuid, integer, text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_email_credits(text, text, uuid, integer, text, text, text, text, text, uuid) TO service_role;

-- ── 9. État du quota, lisible par le pro ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_email_quota_status(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_used integer;
  v_free integer;
  v_credits integer;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'get_email_quota_status: fournir p_venue_id OU p_organizer_user_id';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'venue:' || p_venue_id;
  ELSE
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'org:' || p_organizer_user_id::text;
  END IF;

  SELECT COALESCE(sent, 0) INTO v_used
    FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = v_month;
  v_used := COALESCE(v_used, 0);

  v_free := public.email_sender_monthly_free(v_scope);

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;
  v_credits := COALESCE(v_credits, 0);

  RETURN jsonb_build_object(
    'used', v_used,
    'free', v_free,
    'credits', v_credits,
    'remaining', GREATEST(0, (v_free + v_credits) - v_used),
    'resets_on', (v_month + interval '1 month')::date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_quota_status(text, uuid) TO authenticated;

-- ── 10. Observabilité du transactionnel ─────────────────────────────────────
-- Appelé par resend-webhook pour tout événement terminal (delivered/bounced)
-- SANS campaign_id : le webhook reçoit déjà les événements de TOUS les emails
-- du compte Resend, il les jetait. La réserve de 10 000 passe d'un pari à un
-- chiffre observé, sans toucher aux 33 fonctions d'envoi.
CREATE OR REPLACE FUNCTION public.count_transactional_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'count_transactional_email: service_role only';
  END IF;
  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES ('transactional', date_trunc('month', CURRENT_DATE)::date, 1)
  ON CONFLICT (scope_key, month) DO UPDATE
    SET sent = public.email_send_quota_month.sent + 1, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.count_transactional_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_transactional_email() TO service_role;

-- ── 11. Progression : exposer le mois au front ──────────────────────────────
-- Corps restaté depuis 20260829150100 §7 ; ajoute monthly_used / monthly_cap
-- (allocation + crédits) pour que la carte de progression sache dire « quota du
-- mois atteint, reprise le 1er » au lieu d'un faux « plafond du jour ».
CREATE OR REPLACE FUNCTION public.get_campaign_send_progress(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_auth boolean := false;
  v_counts jsonb;
  v_cap integer;
  v_used integer;
  v_scope text;
  v_month_used integer;
  v_month_free integer;
  v_credits integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := (c.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN v_auth := true; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT jsonb_object_agg(status, n) INTO v_counts
    FROM (SELECT status, count(*) AS n
            FROM public.email_campaign_recipients
           WHERE campaign_id = p_campaign_id GROUP BY status) s;

  v_scope := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id
                  ELSE 'org:' || c.organizer_user_id::text END;

  SELECT public.email_sender_daily_cap(v_scope) INTO v_cap;
  SELECT COALESCE(sent, 0) INTO v_used FROM public.email_send_quota
   WHERE scope_key = v_scope AND day = CURRENT_DATE;

  SELECT COALESCE(sent, 0) INTO v_month_used FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = date_trunc('month', CURRENT_DATE)::date;
  v_month_free := public.email_sender_monthly_free(v_scope);
  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;

  RETURN jsonb_build_object(
    'status', c.status,
    'paused_reason', c.paused_reason,
    'error_message', c.error_message,
    'total', c.total_recipients,
    'sent', c.recipients_count,
    'delivered', c.delivered_count,
    'bounced', c.bounced_count,
    'complained', c.complained_count,
    'failed', c.failed_count,
    'suppressed', c.suppressed_count,
    'opens', c.opens_count,
    'clicks', c.clicks_count,
    'by_status', COALESCE(v_counts, '{}'::jsonb),
    'daily_cap', v_cap,
    'daily_used', COALESCE(v_used, 0),
    'monthly_cap', v_month_free + COALESCE(v_credits, 0),
    'monthly_used', COALESCE(v_month_used, 0),
    'send_started_at', c.send_started_at,
    'last_slice_at', c.last_slice_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_send_progress(uuid) TO authenticated, service_role;
