
-- =========================================================
-- SMS CREDITS SYSTEM — Livraison 1 (infrastructure)
-- venue_id is TEXT (matches public.venues.id)
-- organizer_id is UUID (auth.users.id of the organizer)
-- =========================================================

-- 1. SMS_PACKS
CREATE TABLE public.sms_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  credits_amount integer NOT NULL CHECK (credits_amount > 0),
  unit_cost_eur numeric(10,4) NOT NULL DEFAULT 0.065,
  unit_margin_eur numeric(10,4) NOT NULL DEFAULT 0.05,
  price_eur numeric(10,2) NOT NULL,
  stripe_price_id text,
  stripe_product_id text,
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_packs_public_read" ON public.sms_packs FOR SELECT USING (is_active = true);
CREATE POLICY "sms_packs_admin_all" ON public.sms_packs FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_sms_packs_updated_at BEFORE UPDATE ON public.sms_packs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_sms_packs_active ON public.sms_packs(is_active, position) WHERE is_active = true;

-- 2. SMS_CREDIT_BALANCES
CREATE TABLE public.sms_credit_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_purchased integer NOT NULL DEFAULT 0,
  total_consumed integer NOT NULL DEFAULT 0,
  total_refunded integer NOT NULL DEFAULT 0,
  low_balance_alert_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_balance_scope_xor CHECK (
    (venue_id IS NOT NULL AND organizer_id IS NULL)
    OR (venue_id IS NULL AND organizer_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_sms_balance_venue ON public.sms_credit_balances(venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX idx_sms_balance_organizer ON public.sms_credit_balances(organizer_id) WHERE organizer_id IS NOT NULL;

ALTER TABLE public.sms_credit_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_balance_scope_read" ON public.sms_credit_balances FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
  OR (venue_id IS NOT NULL AND public.is_venue_staff(auth.uid(), venue_id))
  OR (organizer_id = auth.uid())
);

CREATE TRIGGER trg_sms_balances_updated_at BEFORE UPDATE ON public.sms_credit_balances
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. SMS_CREDIT_TRANSACTIONS
CREATE TYPE public.sms_credit_tx_type AS ENUM ('purchase','consume','refund','bonus','admin_adjust');

CREATE TABLE public.sms_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES public.sms_credit_balances(id) ON DELETE CASCADE,
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  organizer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type public.sms_credit_tx_type NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  stripe_payment_intent_id text,
  stripe_session_id text,
  sms_log_id uuid,
  pack_id uuid REFERENCES public.sms_packs(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_tx_balance ON public.sms_credit_transactions(balance_id, created_at DESC);
CREATE INDEX idx_sms_tx_venue ON public.sms_credit_transactions(venue_id, created_at DESC) WHERE venue_id IS NOT NULL;
CREATE INDEX idx_sms_tx_organizer ON public.sms_credit_transactions(organizer_id, created_at DESC) WHERE organizer_id IS NOT NULL;
CREATE INDEX idx_sms_tx_stripe ON public.sms_credit_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

ALTER TABLE public.sms_credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_tx_scope_read" ON public.sms_credit_transactions FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
  OR (organizer_id = auth.uid())
);

-- 4. SMS_LOGS
CREATE TYPE public.sms_status AS ENUM ('queued','sent','delivered','failed','undelivered');
CREATE TYPE public.sms_purpose AS ENUM ('ticket_confirm','reminder_j1','guest_list','vip_confirm','campaign','manual','other');

CREATE TABLE public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  organizer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_phone text NOT NULL,
  body text NOT NULL,
  twilio_sid text,
  status public.sms_status NOT NULL DEFAULT 'queued',
  error_code text,
  error_message text,
  credits_consumed integer NOT NULL DEFAULT 1,
  purpose public.sms_purpose NOT NULL DEFAULT 'manual',
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  campaign_id uuid,
  refunded boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_log_scope_xor CHECK (
    (venue_id IS NOT NULL AND organizer_id IS NULL)
    OR (venue_id IS NULL AND organizer_id IS NOT NULL)
  )
);

CREATE INDEX idx_sms_logs_venue ON public.sms_logs(venue_id, created_at DESC) WHERE venue_id IS NOT NULL;
CREATE INDEX idx_sms_logs_organizer ON public.sms_logs(organizer_id, created_at DESC) WHERE organizer_id IS NOT NULL;
CREATE INDEX idx_sms_logs_twilio_sid ON public.sms_logs(twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX idx_sms_logs_status ON public.sms_logs(status, created_at DESC);
CREATE INDEX idx_sms_logs_event ON public.sms_logs(event_id) WHERE event_id IS NOT NULL;

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_logs_scope_read" ON public.sms_logs FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
  OR (organizer_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.validate_sms_phone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.to_phone IS NULL OR NEW.to_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'Invalid phone format (expected E.164)';
  END IF;
  IF length(NEW.body) = 0 OR length(NEW.body) > 1600 THEN
    RAISE EXCEPTION 'SMS body must be 1-1600 chars';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_sms_logs_validate BEFORE INSERT ON public.sms_logs
FOR EACH ROW EXECUTE FUNCTION public.validate_sms_phone();

-- 5. SMS_CAMPAIGNS
CREATE TYPE public.sms_campaign_status AS ENUM ('draft','scheduled','sending','sent','failed','cancelled');

CREATE TABLE public.sms_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  body_template text NOT NULL,
  segment_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_recipients integer NOT NULL DEFAULT 0,
  estimated_credits integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  sent_at timestamptz,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status public.sms_campaign_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_campaign_scope_xor CHECK (
    (venue_id IS NOT NULL AND organizer_id IS NULL)
    OR (venue_id IS NULL AND organizer_id IS NOT NULL)
  )
);

CREATE INDEX idx_sms_camp_venue ON public.sms_campaigns(venue_id, created_at DESC) WHERE venue_id IS NOT NULL;
CREATE INDEX idx_sms_camp_organizer ON public.sms_campaigns(organizer_id, created_at DESC) WHERE organizer_id IS NOT NULL;
CREATE INDEX idx_sms_camp_scheduled ON public.sms_campaigns(scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.sms_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_camp_scope_read" ON public.sms_campaigns FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
  OR (organizer_id = auth.uid())
);

CREATE POLICY "sms_camp_scope_insert" ON public.sms_campaigns FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
    OR (organizer_id = auth.uid())
  )
);

CREATE POLICY "sms_camp_scope_update" ON public.sms_campaigns FOR UPDATE TO authenticated
USING (
  (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
  OR (organizer_id = auth.uid())
);

CREATE POLICY "sms_camp_scope_delete" ON public.sms_campaigns FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND (
    (venue_id IS NOT NULL AND venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid()))
    OR (organizer_id = auth.uid())
  )
);

CREATE TRIGGER trg_sms_campaigns_updated_at BEFORE UPDATE ON public.sms_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. PROFILES — opt-in
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_sms_opt_in boolean NOT NULL DEFAULT false;

-- 7. RPC: get_or_create_sms_balance
CREATE OR REPLACE FUNCTION public.get_or_create_sms_balance(
  p_venue_id text DEFAULT NULL,
  p_organizer_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance_id uuid;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of venue_id or organizer_id must be provided';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    SELECT id INTO v_balance_id FROM public.sms_credit_balances WHERE venue_id = p_venue_id;
    IF v_balance_id IS NULL THEN
      INSERT INTO public.sms_credit_balances (venue_id) VALUES (p_venue_id) RETURNING id INTO v_balance_id;
    END IF;
  ELSE
    SELECT id INTO v_balance_id FROM public.sms_credit_balances WHERE organizer_id = p_organizer_id;
    IF v_balance_id IS NULL THEN
      INSERT INTO public.sms_credit_balances (organizer_id) VALUES (p_organizer_id) RETURNING id INTO v_balance_id;
    END IF;
  END IF;
  RETURN v_balance_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_sms_balance(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_sms_balance(text, uuid) TO service_role;

-- 8. RPC: consume_sms_credits
CREATE OR REPLACE FUNCTION public.consume_sms_credits(p_balance_id uuid, p_amount integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current integer; v_new integer; v_venue text; v_org uuid;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  SELECT balance, venue_id, organizer_id INTO v_current, v_venue, v_org
  FROM public.sms_credit_balances WHERE id = p_balance_id FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Balance not found'; END IF;
  IF v_current < p_amount THEN RETURN false; END IF;
  v_new := v_current - p_amount;
  UPDATE public.sms_credit_balances
  SET balance = v_new, total_consumed = total_consumed + p_amount, updated_at = now()
  WHERE id = p_balance_id;
  INSERT INTO public.sms_credit_transactions (balance_id, venue_id, organizer_id, type, amount, balance_after)
  VALUES (p_balance_id, v_venue, v_org, 'consume', -p_amount, v_new);
  RETURN true;
END; $$;

REVOKE EXECUTE ON FUNCTION public.consume_sms_credits(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_sms_credits(uuid, integer) TO service_role;

-- 9. RPC: refund_sms_credits
CREATE OR REPLACE FUNCTION public.refund_sms_credits(
  p_balance_id uuid, p_amount integer, p_sms_log_id uuid DEFAULT NULL, p_notes text DEFAULT NULL
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new integer; v_venue text; v_org uuid;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  SELECT venue_id, organizer_id INTO v_venue, v_org
  FROM public.sms_credit_balances WHERE id = p_balance_id FOR UPDATE;
  IF v_venue IS NULL AND v_org IS NULL THEN RAISE EXCEPTION 'Balance not found'; END IF;
  UPDATE public.sms_credit_balances
  SET balance = balance + p_amount, total_refunded = total_refunded + p_amount, updated_at = now()
  WHERE id = p_balance_id RETURNING balance INTO v_new;
  INSERT INTO public.sms_credit_transactions (balance_id, venue_id, organizer_id, type, amount, balance_after, sms_log_id, notes)
  VALUES (p_balance_id, v_venue, v_org, 'refund', p_amount, v_new, p_sms_log_id, p_notes);
  IF p_sms_log_id IS NOT NULL THEN
    UPDATE public.sms_logs SET refunded = true WHERE id = p_sms_log_id;
  END IF;
  RETURN v_new;
END; $$;

REVOKE EXECUTE ON FUNCTION public.refund_sms_credits(uuid, integer, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_sms_credits(uuid, integer, uuid, text) TO service_role;

-- 10. RPC: add_sms_credits
CREATE OR REPLACE FUNCTION public.add_sms_credits(
  p_balance_id uuid, p_amount integer, p_type public.sms_credit_tx_type,
  p_pack_id uuid DEFAULT NULL, p_stripe_session_id text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new integer; v_venue text; v_org uuid; v_existing_count int;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  IF p_stripe_session_id IS NOT NULL THEN
    SELECT count(*) INTO v_existing_count FROM public.sms_credit_transactions
    WHERE stripe_session_id = p_stripe_session_id AND type = 'purchase';
    IF v_existing_count > 0 THEN
      SELECT balance INTO v_new FROM public.sms_credit_balances WHERE id = p_balance_id;
      RETURN v_new;
    END IF;
  END IF;
  SELECT venue_id, organizer_id INTO v_venue, v_org
  FROM public.sms_credit_balances WHERE id = p_balance_id FOR UPDATE;
  UPDATE public.sms_credit_balances
  SET balance = balance + p_amount,
      total_purchased = total_purchased + (CASE WHEN p_type = 'purchase' THEN p_amount ELSE 0 END),
      updated_at = now()
  WHERE id = p_balance_id RETURNING balance INTO v_new;
  INSERT INTO public.sms_credit_transactions (
    balance_id, venue_id, organizer_id, type, amount, balance_after,
    pack_id, stripe_session_id, stripe_payment_intent_id, notes, created_by
  ) VALUES (
    p_balance_id, v_venue, v_org, p_type, p_amount, v_new,
    p_pack_id, p_stripe_session_id, p_stripe_payment_intent_id, p_notes, p_created_by
  );
  RETURN v_new;
END; $$;

REVOKE EXECUTE ON FUNCTION public.add_sms_credits(uuid, integer, public.sms_credit_tx_type, uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_sms_credits(uuid, integer, public.sms_credit_tx_type, uuid, text, text, text, uuid) TO service_role;

-- 11. Seed default packs
INSERT INTO public.sms_packs (name, description, credits_amount, unit_cost_eur, unit_margin_eur, price_eur, position) VALUES
  ('Starter', '100 SMS pour démarrer vos campagnes', 100, 0.065, 0.05, 11.50, 1),
  ('Standard', '500 SMS pour vos communications régulières', 500, 0.065, 0.05, 57.50, 2),
  ('Pro', '2000 SMS pour les clubs actifs', 2000, 0.065, 0.05, 230.00, 3),
  ('Scale', '5000 SMS pour gros volume', 5000, 0.065, 0.05, 575.00, 4);
