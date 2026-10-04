-- ============================================================================
-- Yuno CRM — le portefeuille de Yunits (lot 4b, partie données).
--
-- La monnaie de Yuno CRM s'appelle « Yunit » (design Claude Design de Paul,
-- 03/10 : page Tarifs, Recharger, mascotte YunitFace). 1 e-mail = 1 Yunit,
-- 1 SMS France = 40, DM Instagram = 10 (bientôt), WhatsApp = 100 (bientôt).
--
-- 1. crm_yunit_lots : un lot daté par crédit (essai, mois inclus, bonus annuel,
--    achat, geste commercial, remboursement). Solde = somme des restes des
--    lots non expirés. On dépense TOUJOURS d'abord le lot qui expire le plus
--    tôt (« les offerts d'abord, parce qu'ils expirent à la fin du mois »).
-- 2. crm_yunit_moves : le grand livre (crédits, débits, remboursements,
--    expirations), lu par la Console (« Derniers envois », Historique).
-- 3. crm_pricing : la grille en vigueur (prix, essai, mois inclus, bonus
--    annuel, recharges, tarif par canal), une ligne, réglée par le super admin
--    (Admin › Réglages). Le front ne code AUCUN de ces chiffres.
-- 4. Crédit automatique : l'essai (5 000 jusqu'à la fin de l'essai) à la
--    création de l'abonnement CRM, puis le mois inclus (10 000) tant que
--    l'abonnement est actif — trigger + balayage horaire, idempotents
--    (index unique sur la référence du lot).
-- 5. Débit / remboursement : crm_yunits_debit / crm_yunits_refund
--    (service_role seul), appelés par les chemins d'envoi des comptes CRM.
--    Rien n'est débité pour un test, un contact écarté par les règles
--    d'envoi ou un refus du fournisseur.
-- ============================================================================

-- ── 1. Grille ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_pricing (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  config jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_pricing ENABLE ROW LEVEL SECURITY;

INSERT INTO public.crm_pricing (id, config) VALUES (true, jsonb_build_object(
  'price_month', 29,
  'price_month_next', 39,
  'price_year', 348,
  'currency', 'EUR',
  'vat_rate', 20,
  'trial_days', 14,
  'trial_yunits', 5000,
  'monthly_yunits', 10000,
  'annual_bonus_yunits', 30000,
  'purchase_validity_months', 12,
  'yunits_per_euro', 500,
  'recharge_min', 5000,
  'recharge_max', 300000,
  'recharge_step', 5000,
  'bonus_tiers', jsonb_build_array(
    jsonb_build_object('min', 50000, 'pct', 15),
    jsonb_build_object('min', 25000, 'pct', 10)),
  'packs', jsonb_build_array(5000, 12500, 27500, 57500),
  'low_balance', 2000,
  'rates', jsonb_build_object(
    'email', 1, 'sms', 40, 'instagram', 10, 'whatsapp', 100),
  'channels_live', jsonb_build_object(
    'email', true, 'sms', true, 'instagram', false, 'whatsapp', false)
))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_pricing_config()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT config FROM public.crm_pricing WHERE id;
$$;
-- La grille est publique (page Tarifs).
REVOKE ALL ON FUNCTION public.crm_pricing_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pricing_config() TO anon, authenticated, service_role;

-- ── 2. Lots et grand livre ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_yunit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('trial', 'monthly', 'annual_bonus', 'purchase', 'grant', 'refund')),
  amount integer NOT NULL CHECK (amount > 0),
  remaining integer NOT NULL CHECK (remaining >= 0),
  expires_at timestamptz,
  source_ref text,
  label text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL)),
  CHECK (remaining <= amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_yunit_lots_ref ON public.crm_yunit_lots (scope_key, kind, source_ref)
  WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_yunit_lots_scope ON public.crm_yunit_lots (scope_key, expires_at);
ALTER TABLE public.crm_yunit_lots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_yunit_moves (
  id bigserial PRIMARY KEY,
  scope_key text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  delta integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('credit', 'debit', 'refund', 'expire')),
  lot_kind text,
  channel text,
  ref_type text,
  ref_id text,
  label text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_crm_yunit_moves_scope ON public.crm_yunit_moves (scope_key, at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_yunit_moves_ref ON public.crm_yunit_moves (ref_type, ref_id) WHERE ref_id IS NOT NULL;
ALTER TABLE public.crm_yunit_moves ENABLE ROW LEVEL SECURITY;
-- Aucune policy sur les trois tables : tout passe par les fonctions ci-dessous.

CREATE OR REPLACE FUNCTION public.crm_scope_parts(p_scope_key text, OUT venue_id text, OUT organizer_user_id uuid)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_scope_key LIKE 'venue:%' THEN venue_id := substr(p_scope_key, 7);
  ELSIF p_scope_key LIKE 'org:%' THEN organizer_user_id := substr(p_scope_key, 5)::uuid;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_yunits_balance(p_scope_key text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(sum(remaining), 0)::int
    FROM public.crm_yunit_lots
   WHERE scope_key = p_scope_key AND remaining > 0 AND (expires_at IS NULL OR expires_at > now());
$$;

-- Crédit d'un lot, idempotent sur (portée, nature, référence).
CREATE OR REPLACE FUNCTION public.crm_yunits_credit(
  p_scope_key text, p_kind text, p_amount integer, p_expires_at timestamptz,
  p_source_ref text DEFAULT NULL, p_label text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts record;
  v_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);
  IF v_parts.venue_id IS NULL AND v_parts.organizer_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_scope');
  END IF;

  INSERT INTO public.crm_yunit_lots (scope_key, venue_id, organizer_user_id, kind, amount, remaining, expires_at, source_ref, label, created_by)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id, p_kind, p_amount, p_amount, p_expires_at, p_source_ref, p_label, auth.uid())
  ON CONFLICT (scope_key, kind, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  INSERT INTO public.crm_yunit_moves (scope_key, venue_id, organizer_user_id, delta, kind, lot_kind, ref_type, ref_id, label, meta)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id, p_amount, 'credit', p_kind, 'lot', v_id::text, p_label,
          COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('expires_at', p_expires_at));
  RETURN jsonb_build_object('ok', true, 'lot_id', v_id, 'balance', public.crm_yunits_balance(p_scope_key));
END;
$$;

-- Débit : tout ou rien, du lot qui expire le plus tôt au plus tard.
CREATE OR REPLACE FUNCTION public.crm_yunits_debit(
  p_scope_key text, p_amount integer, p_channel text,
  p_ref_type text DEFAULT NULL, p_ref_id text DEFAULT NULL, p_label text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts record;
  v_left integer := p_amount;
  v_take integer;
  v_balance integer;
  l record;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'debited', 0, 'balance', public.crm_yunits_balance(p_scope_key));
  END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);

  -- Verrou des lots vivants de la portée : deux envois simultanés ne
  -- dépensent jamais le même Yunit.
  PERFORM 1 FROM public.crm_yunit_lots
   WHERE scope_key = p_scope_key AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
   FOR UPDATE;

  v_balance := public.crm_yunits_balance(p_scope_key);
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance, 'needed', p_amount);
  END IF;

  FOR l IN SELECT id, remaining, kind FROM public.crm_yunit_lots
            WHERE scope_key = p_scope_key AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
            ORDER BY expires_at ASC NULLS LAST, created_at ASC LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(l.remaining, v_left);
    UPDATE public.crm_yunit_lots SET remaining = remaining - v_take WHERE id = l.id;
    v_left := v_left - v_take;
  END LOOP;

  INSERT INTO public.crm_yunit_moves (scope_key, venue_id, organizer_user_id, delta, kind, channel, ref_type, ref_id, label, meta)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id, -p_amount, 'debit', p_channel, p_ref_type, p_ref_id, p_label, COALESCE(p_meta, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'debited', p_amount, 'balance', v_balance - p_amount);
END;
$$;

-- Remboursement (refus du fournisseur, envoi annulé) : un lot « refund »
-- valable un an, tracé à part dans le grand livre.
CREATE OR REPLACE FUNCTION public.crm_yunits_refund(
  p_scope_key text, p_amount integer, p_channel text,
  p_ref_type text DEFAULT NULL, p_ref_id text DEFAULT NULL, p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts record;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('ok', true, 'refunded', 0); END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);
  INSERT INTO public.crm_yunit_lots (scope_key, venue_id, organizer_user_id, kind, amount, remaining, expires_at, label)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id, 'refund', p_amount, p_amount, now() + interval '12 months', p_label);
  INSERT INTO public.crm_yunit_moves (scope_key, venue_id, organizer_user_id, delta, kind, channel, ref_type, ref_id, label)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id, p_amount, 'refund', p_channel, p_ref_type, p_ref_id, p_label);
  RETURN jsonb_build_object('ok', true, 'refunded', p_amount, 'balance', public.crm_yunits_balance(p_scope_key));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_scope_parts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_yunits_balance(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_yunits_credit(text, text, integer, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_yunits_debit(text, integer, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_yunits_refund(text, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_scope_parts(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_yunits_balance(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_yunits_credit(text, text, integer, timestamptz, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_yunits_debit(text, integer, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_yunits_refund(text, integer, text, text, text, text) TO service_role;

-- ── 3. Crédit automatique : essai et mois inclus ────────────────────────────

-- Le Yunit inclus d'une portée, selon son abonnement :
--   essai en cours            → lot « trial » jusqu'à la fin de l'essai ;
--   actif / en retard         → lot « monthly » de la période en cours
--                               (fin = échéance Stripe, sinon fin du mois civil).
-- Idempotent : la référence du lot porte la date de fin.
CREATE OR REPLACE FUNCTION public.crm_yunits_ensure_allowance(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.crm_subscriptions%ROWTYPE;
  cfg jsonb := public.crm_pricing_config();
  v_end timestamptz;
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND OR NOT public.crm_scope_is_crm(p_scope_key) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_crm');
  END IF;

  IF s.status = 'trialing' AND s.trial_ends_at > now() THEN
    RETURN public.crm_yunits_credit(p_scope_key, 'trial', (cfg->>'trial_yunits')::int, s.trial_ends_at,
                                    'trial', 'Offerts pendant l’essai');
  END IF;

  IF s.status IN ('active', 'past_due') THEN
    IF s.stripe_subscription_id IS NOT NULL AND s.current_period_end IS NOT NULL AND s.current_period_end > now() THEN
      v_end := s.current_period_end;
    ELSE
      -- Offre accordée à la main : un lot par mois civil, tant qu'elle court.
      IF s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
        RETURN jsonb_build_object('ok', true, 'skipped', 'expired');
      END IF;
      v_end := (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') + interval '1 month') AT TIME ZONE 'Europe/Paris';
    END IF;
    RETURN public.crm_yunits_credit(p_scope_key, 'monthly', (cfg->>'monthly_yunits')::int, v_end,
                                    'monthly:' || to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'),
                                    'Inclus dans l’abonnement');
  END IF;

  RETURN jsonb_build_object('ok', true, 'skipped', s.status);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_yunits_ensure_allowance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_yunits_ensure_allowance(text) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_crm_subscription_allowance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.crm_yunits_ensure_allowance(NEW.scope_key);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Le portefeuille ne doit jamais faire échouer l'écriture de l'abonnement.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_subscription_allowance ON public.crm_subscriptions;
CREATE TRIGGER trg_crm_subscription_allowance
  AFTER INSERT OR UPDATE OF status, trial_ends_at, current_period_end ON public.crm_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_crm_subscription_allowance();

CREATE OR REPLACE FUNCTION public.crm_yunits_allowance_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
  v jsonb;
BEGIN
  FOR r IN SELECT scope_key FROM public.crm_subscriptions
            WHERE status IN ('trialing', 'active', 'past_due') LOOP
    v := public.crm_yunits_ensure_allowance(r.scope_key);
    IF (v->>'lot_id') IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('credited', n);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_yunits_allowance_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_yunits_allowance_sweep() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-yunits-allowance') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-yunits-allowance');
  PERFORM cron.schedule('crm-yunits-allowance', '23 * * * *', $cron$SELECT public.crm_yunits_allowance_sweep();$cron$);
END $$;

-- ── 4. Lecture de la Console ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_crm_wallet(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_balance integer;
  v_lots jsonb;
  v_moves jsonb;
  v_reserved jsonb;
  v_reserved_total integer;
  v_spent_month integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_balance := public.crm_yunits_balance(v_scope);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', k, 'remaining', rem, 'expires_at', exp) ORDER BY exp NULLS LAST), '[]'::jsonb)
    INTO v_lots
    FROM (
      SELECT CASE WHEN kind IN ('purchase', 'refund') THEN 'purchase'
                  WHEN kind IN ('grant', 'annual_bonus') THEN 'bonus'
                  ELSE kind END AS k,
             sum(remaining)::int AS rem, min(expires_at) AS exp
        FROM public.crm_yunit_lots
       WHERE scope_key = v_scope AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
       GROUP BY 1
    ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'delta', delta, 'kind', kind, 'lot_kind', lot_kind,
                                               'channel', channel, 'label', label, 'ref_type', ref_type, 'ref_id', ref_id,
                                               'meta', meta) ORDER BY at DESC), '[]'::jsonb)
    INTO v_moves
    FROM (SELECT * FROM public.crm_yunit_moves WHERE scope_key = v_scope ORDER BY at DESC LIMIT 30) m;

  -- Envois programmés (e-mail et SMS) : ce qu'ils vont consommer.
  WITH sched AS (
    SELECT c.id::text AS id, c.name, 'email'::text AS channel, c.scheduled_at AS at,
           GREATEST(COALESCE(c.total_recipients, c.recipients_count, 0), 0) * (cfg->'rates'->>'email')::int AS cost
      FROM public.email_campaigns c
     WHERE c.status = 'scheduled' AND c.scheduled_at > now()
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
    UNION ALL
    SELECT s.id::text, s.name, 'sms', s.scheduled_at,
           GREATEST(COALESCE(s.estimated_recipients, 0), 0) * GREATEST(COALESCE(s.segments_per_message, 1), 1) * (cfg->'rates'->>'sms')::int
      FROM public.sms_campaigns s
     WHERE s.status = 'scheduled' AND s.scheduled_at > now()
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'channel', channel, 'at', at, 'cost', cost) ORDER BY at), '[]'::jsonb),
         COALESCE(sum(cost), 0)::int
    INTO v_reserved, v_reserved_total
    FROM sched;

  SELECT COALESCE(-sum(delta), 0)::int INTO v_spent_month
    FROM public.crm_yunit_moves
   WHERE scope_key = v_scope AND kind = 'debit'
     AND at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';

  RETURN jsonb_build_object(
    'balance', v_balance,
    'lots', v_lots,
    'moves', v_moves,
    'reserved', v_reserved,
    'reserved_total', v_reserved_total,
    'spent_month', v_spent_month,
    'low_balance', (cfg->>'low_balance')::int,
    'rates', cfg->'rates',
    'channels_live', cfg->'channels_live'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_crm_wallet(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_wallet(text, uuid) TO authenticated;

-- ── 5. Les espaces CRM déjà ouverts reçoivent leur Yunit inclus ─────────────

SELECT public.crm_yunits_allowance_sweep();
