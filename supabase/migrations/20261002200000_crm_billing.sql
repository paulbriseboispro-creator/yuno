-- ============================================================================
-- Yuno CRM — lot 4 : abonnement, offres et quotas pilotés par l'offre.
-- Plan : docs/designs/YUNO_CRM_PLAN.md (lot 4) ; grille : YUNO_CRM_PRICING.md
-- (décision de Paul du 02/10 : Gratuit / Essentiel 49 € / Pro 129 € /
-- Business 249 € HT par mois, prix fondateur 35 / 89 / 175 € pour les 15
-- premiers comptes, annuel = dix mois, essai du Pro 14 jours sans carte).
--
-- Règles :
--   • Une ligne `crm_subscriptions` par PORTÉE (`venue:<id>` | `org:<uuid>`),
--     séparée de `venue_subscriptions` (Suite) : les noms d'offres se croisent
--     (essential, pro) et le trigger collab de la Suite réécrit ses lignes.
--   • L'offre qui s'applique = `crm_effective_plan()` : essai en cours = Pro,
--     abonnement actif ou en retard de paiement = son offre, sinon Gratuit.
--     Miroir front : `effectivePlan()` (src/lib/crmPlans.ts).
--   • Les limites = `crm_plan_limits()`, miroir EXACT de CRM_PLAN_LIMITS.
--     Elles ne s'appliquent qu'aux comptes au produit `crm` : la Suite garde
--     ses règles (15 000 emails, membres illimités…).
--   • Seuls Stripe (webhook, `crm_apply_stripe_subscription`) et le super
--     admin écrivent une offre payante. RLS sans policy, tout par RPC.
--   • L'essai naît quand un compte passe au produit `crm` (inscription ou
--     super admin), jamais deux fois pour une même portée.
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_subscriptions (
  scope_key             text PRIMARY KEY CHECK (scope_key ~ '^(venue|org):.+$'),
  venue_id              text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                  text NOT NULL DEFAULT 'free'
                        CHECK (plan IN ('free', 'essential', 'pro', 'business')),
  status                text NOT NULL DEFAULT 'none'
                        CHECK (status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  billing_interval      text CHECK (billing_interval IN ('month', 'year')),
  founder               boolean NOT NULL DEFAULT false,
  founder_until         timestamptz,
  trial_ends_at         timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  stripe_customer_id    text UNIQUE,
  stripe_subscription_id text UNIQUE,
  granted_by            uuid,           -- offre accordée à la main par le super admin
  last_event_at         timestamptz,    -- dernier événement Stripe appliqué (ordre)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_subscriptions_scope_chk CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
ALTER TABLE public.crm_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_subscriptions FROM anon, authenticated;

COMMENT ON TABLE public.crm_subscriptions IS
  'Abonnement Yuno CRM par portée. RLS sans policy : lecture get_crm_billing, écriture webhook Stripe / super admin.';

-- ── Grille et offre effective ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_plan_limits(p_plan text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  -- MIROIR EXACT de CRM_PLAN_LIMITS (src/lib/crmPlans.ts).
  -- members = membres en PLUS du titulaire (NULL = illimité) ;
  -- automations = recettes allumées en même temps (NULL = toutes).
  SELECT CASE p_plan
    WHEN 'essential' THEN jsonb_build_object('emails_month', 15000, 'sms_month', 100, 'sync_minutes', 60,
      'members', 2, 'automations', 3, 'ab_resend', false, 'meta', false, 'segment_export', true, 'yuno_badge', false)
    WHEN 'pro' THEN jsonb_build_object('emails_month', 50000, 'sms_month', 250, 'sync_minutes', 15,
      'members', 4, 'automations', NULL, 'ab_resend', true, 'meta', true, 'segment_export', true, 'yuno_badge', false)
    WHEN 'business' THEN jsonb_build_object('emails_month', 100000, 'sms_month', 500, 'sync_minutes', 15,
      'members', NULL, 'automations', NULL, 'ab_resend', true, 'meta', true, 'segment_export', true, 'yuno_badge', false)
    ELSE jsonb_build_object('emails_month', 1000, 'sms_month', 0, 'sync_minutes', 1440,
      'members', 0, 'automations', 0, 'ab_resend', false, 'meta', false, 'segment_export', false, 'yuno_badge', true)
  END;
$$;

CREATE OR REPLACE FUNCTION public.crm_scope_key(p_venue_id text, p_organizer_user_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
    WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id::text
  END;
$$;

-- Le compte derrière une clé de portée est-il au produit Yuno CRM ?
CREATE OR REPLACE FUNCTION public.crm_scope_is_crm(p_scope_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_scope_key LIKE 'venue:%' THEN
    RETURN EXISTS (SELECT 1 FROM public.venues WHERE id = substr(p_scope_key, 7) AND product = 'crm');
  ELSIF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    RETURN EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = substr(p_scope_key, 5)::uuid AND product = 'crm');
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_effective_plan(p_scope_key text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.crm_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND THEN RETURN 'free'; END IF;
  IF s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now() THEN
    -- L'essai vaut au moins le Pro ; un Business choisi pendant l'essai, le Business.
    RETURN CASE WHEN s.plan = 'business' THEN 'business' ELSE 'pro' END;
  END IF;
  IF s.status IN ('active', 'past_due') THEN
    -- Offre accordée à la main (sans Stripe) : elle s'éteint à sa date.
    IF s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
      RETURN 'free';
    END IF;
    RETURN s.plan;
  END IF;
  RETURN 'free';
END;
$$;

-- Limites de la portée, ou NULL si le compte n'est pas un compte CRM.
CREATE OR REPLACE FUNCTION public.crm_scope_limits(p_scope_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.crm_scope_is_crm(p_scope_key)
              THEN public.crm_plan_limits(public.crm_effective_plan(p_scope_key)) END;
$$;

CREATE OR REPLACE FUNCTION public.crm_founder_seats_left()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0, 15 - count(*)::int)
    FROM public.crm_subscriptions
   WHERE founder AND stripe_subscription_id IS NOT NULL
     AND status IN ('trialing', 'active', 'past_due');
$$;

-- ── L'essai naît avec le produit CRM ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_start_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product IS DISTINCT FROM 'crm' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.product IS NOT DISTINCT FROM NEW.product THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'venues' THEN
    INSERT INTO public.crm_subscriptions (scope_key, venue_id, status, trial_ends_at)
    VALUES ('venue:' || NEW.id, NEW.id, 'trialing', now() + interval '14 days')
    ON CONFLICT (scope_key) DO NOTHING;
  ELSE
    INSERT INTO public.crm_subscriptions (scope_key, organizer_user_id, status, trial_ends_at)
    VALUES ('org:' || NEW.user_id::text, NEW.user_id, 'trialing', now() + interval '14 days')
    ON CONFLICT (scope_key) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- L'abonnement ne doit jamais faire échouer l'ouverture du compte.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_start_trial ON public.venues;
CREATE TRIGGER trg_crm_start_trial AFTER INSERT OR UPDATE OF product ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.crm_start_trial();
DROP TRIGGER IF EXISTS trg_crm_start_trial ON public.organizer_profiles;
CREATE TRIGGER trg_crm_start_trial AFTER INSERT OR UPDATE OF product ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.crm_start_trial();

-- Comptes CRM déjà ouverts : essai à partir d'aujourd'hui.
INSERT INTO public.crm_subscriptions (scope_key, venue_id, status, trial_ends_at)
SELECT 'venue:' || v.id, v.id, 'trialing', now() + interval '14 days'
  FROM public.venues v WHERE v.product = 'crm'
ON CONFLICT (scope_key) DO NOTHING;
INSERT INTO public.crm_subscriptions (scope_key, organizer_user_id, status, trial_ends_at)
SELECT 'org:' || o.user_id::text, o.user_id, 'trialing', now() + interval '14 days'
  FROM public.organizer_profiles o WHERE o.product = 'crm'
ON CONFLICT (scope_key) DO NOTHING;

-- ── Fréquence de synchro de la billetterie ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_sync_scope(p_scope_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb := public.crm_scope_limits(p_scope_key);
  v_minutes integer;
BEGIN
  IF v_limits IS NULL THEN RETURN; END IF;
  v_minutes := (v_limits->>'sync_minutes')::int;
  UPDATE public.ticketing_connections c
     SET sync_interval_minutes = v_minutes,
         -- Une offre qui accélère prend effet tout de suite ; qui ralentit, à la prochaine passe.
         next_sync_at = LEAST(c.next_sync_at, now() + make_interval(mins => v_minutes))
   WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = p_scope_key
     AND c.sync_interval_minutes IS DISTINCT FROM v_minutes;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_connection_interval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb := public.crm_scope_limits(public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id));
BEGIN
  IF v_limits IS NOT NULL THEN
    NEW.sync_interval_minutes := (v_limits->>'sync_minutes')::int;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_connection_interval ON public.ticketing_connections;
CREATE TRIGGER trg_crm_connection_interval BEFORE INSERT ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.crm_connection_interval();

-- Le cron de synchro passe toutes les 5 minutes : une offre à 15 minutes ne
-- doit pas devenir 20 parce que le cron n'en passe qu'une toutes les 10.
DO $$
DECLARE v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'ticketing-sync';
  IF v_cmd IS NOT NULL THEN
    PERFORM cron.unschedule('ticketing-sync');
    PERFORM cron.schedule('ticketing-sync', '*/5 * * * *', v_cmd);
  END IF;
END $$;

-- ── Quota email mensuel : celui de l'offre pour un compte CRM ───────────────
CREATE OR REPLACE FUNCTION public.email_sender_monthly_free(p_scope_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_override integer;
  v_org text;
  v_crm jsonb;
BEGIN
  SELECT monthly_cap_override INTO v_override
    FROM public.email_sender_state WHERE scope_key = p_scope_key;
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v_override, 40000);   -- pool marketing (plan 50k − réserve 10k)
  END IF;
  IF p_scope_key = 'yuno' THEN
    -- Le marketing de Yuno n'a pas de forfait « offert » à lui : il puise dans
    -- le pool plateforme, déjà plafonné à l'étage 1.
    RETURN COALESCE(v_override, 40000);
  END IF;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;
  -- Yuno CRM : l'inclus de l'offre en cours (crm_plan_limits).
  v_crm := public.crm_scope_limits(p_scope_key);
  IF v_crm IS NOT NULL THEN
    RETURN (v_crm->>'emails_month')::int;
  END IF;
  IF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    v_org := substr(p_scope_key, 5);
    IF EXISTS (
      SELECT 1 FROM public.organizer_profiles
       WHERE user_id = v_org::uuid AND bde_verified = true
    ) THEN
      RETURN 2000;                        -- offert par compte association
    END IF;
  END IF;
  RETURN 15000;                           -- offert par compte pro
END;
$function$;

-- ── Membres d'équipe ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_guard_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_limits jsonb;
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'org_members' THEN
    -- Une invitation refusée ou retirée ne compte pas ; seule une ligne qui
    -- (re)devient vivante passe le contrôle.
    IF NEW.invitation_status NOT IN ('pending', 'accepted') THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.invitation_status IN ('pending', 'accepted') THEN RETURN NEW; END IF;
    v_scope := 'org:' || NEW.organizer_user_id::text;
    v_limits := public.crm_scope_limits(v_scope);
    IF v_limits IS NULL OR v_limits->'members' = 'null'::jsonb THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_count FROM public.org_members m
     WHERE m.organizer_user_id = NEW.organizer_user_id AND m.id <> NEW.id
       AND (m.invitation_status = 'accepted'
            OR (m.invitation_status = 'pending' AND (m.expires_at IS NULL OR m.expires_at > now())));
  ELSE
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
    v_scope := 'venue:' || NEW.venue_id;
    v_limits := public.crm_scope_limits(v_scope);
    IF v_limits IS NULL OR v_limits->'members' = 'null'::jsonb THEN RETURN NEW; END IF;
    SELECT count(*) INTO v_count FROM public.manager_permissions mp
     WHERE mp.venue_id = NEW.venue_id AND mp.id <> NEW.id;
  END IF;
  IF v_count >= (v_limits->>'members')::int THEN
    RAISE EXCEPTION 'crm_member_limit' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le nombre de membres de votre offre est atteint.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_member_limit ON public.org_members;
CREATE TRIGGER trg_crm_member_limit BEFORE INSERT OR UPDATE OF invitation_status ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_member_limit();
DROP TRIGGER IF EXISTS trg_crm_member_limit ON public.manager_permissions;
CREATE TRIGGER trg_crm_member_limit BEFORE INSERT ON public.manager_permissions
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_member_limit();

-- ── Automatisations allumées en même temps ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_guard_automation_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb;
  v_count integer;
BEGIN
  IF NOT COALESCE(NEW.enabled, false) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.enabled, false) THEN RETURN NEW; END IF;
  v_limits := public.crm_scope_limits(public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id));
  IF v_limits IS NULL OR v_limits->'automations' = 'null'::jsonb THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.email_automations a
   WHERE a.enabled AND a.id <> NEW.id
     AND a.venue_id IS NOT DISTINCT FROM NEW.venue_id
     AND a.organizer_user_id IS NOT DISTINCT FROM NEW.organizer_user_id;
  IF v_count >= (v_limits->>'automations')::int THEN
    RAISE EXCEPTION 'crm_automation_limit' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le nombre d''automatisations de votre offre est atteint.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_automation_limit ON public.email_automations;
CREATE TRIGGER trg_crm_automation_limit BEFORE INSERT OR UPDATE OF enabled ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_automation_limit();

-- ── A/B d'objet et renvoi aux non-ouvreurs (Pro et Business) ────────────────
CREATE OR REPLACE FUNCTION public.crm_guard_campaign_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb;
  v_turning_on boolean;
BEGIN
  v_turning_on := (COALESCE(NEW.ab_enabled, false) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.ab_enabled, false)))
               OR (COALESCE(NEW.resend_enabled, false) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.resend_enabled, false)));
  IF NOT v_turning_on THEN RETURN NEW; END IF;
  v_limits := public.crm_scope_limits(public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id));
  IF v_limits IS NULL OR (v_limits->>'ab_resend')::boolean THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'crm_plan_ab_resend' USING ERRCODE = 'P0001',
    HINT = 'Yuno CRM : le test A/B et le renvoi aux non-ouvreurs sont inclus dans l''offre Pro.';
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_campaign_features ON public.email_campaigns;
CREATE TRIGGER trg_crm_campaign_features BEFORE INSERT OR UPDATE OF ab_enabled, resend_enabled ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_campaign_features();

-- ── Webhook Stripe : la seule écriture d'une offre payée ────────────────────
CREATE OR REPLACE FUNCTION public.crm_apply_stripe_subscription(
  p_scope_key text,
  p_subscription_id text,
  p_customer_id text,
  p_stripe_status text,
  p_plan text,
  p_interval text,
  p_founder boolean,
  p_trial_end timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_event_at timestamptz,
  p_deleted boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_row public.crm_subscriptions%ROWTYPE;
  v_venue text;
  v_org uuid;
BEGIN
  IF p_scope_key !~ '^(venue|org):.+$' OR p_plan NOT IN ('essential', 'pro', 'business') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  IF p_scope_key LIKE 'venue:%' THEN v_venue := substr(p_scope_key, 7);
  ELSE v_org := substr(p_scope_key, 5)::uuid; END IF;

  v_status := CASE
    WHEN p_deleted THEN 'canceled'
    WHEN p_stripe_status IN ('trialing', 'active', 'past_due') THEN p_stripe_status
    WHEN p_stripe_status = 'unpaid' THEN 'past_due'
    WHEN p_stripe_status = 'incomplete' THEN 'incomplete'
    ELSE 'canceled'
  END;

  SELECT * INTO v_row FROM public.crm_subscriptions WHERE scope_key = p_scope_key FOR UPDATE;
  -- Un événement plus ancien que le dernier appliqué ne réécrit rien (Stripe ne
  -- garantit pas l'ordre). Un autre abonnement que celui en place, terminé, non plus.
  IF FOUND AND v_row.last_event_at IS NOT NULL AND p_event_at < v_row.last_event_at THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'older_event');
  END IF;
  IF FOUND AND v_row.stripe_subscription_id IS NOT NULL AND v_row.stripe_subscription_id <> p_subscription_id
     AND v_status IN ('canceled', 'incomplete') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'other_subscription');
  END IF;

  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, billing_interval,
         founder, founder_until, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id,
         stripe_subscription_id, last_event_at, updated_at)
  VALUES (p_scope_key, v_venue, v_org, p_plan, v_status, p_interval,
          COALESCE(p_founder, false), CASE WHEN p_founder THEN now() + interval '12 months' END,
          p_trial_end, p_period_end, COALESCE(p_cancel_at_period_end, false), p_customer_id,
          p_subscription_id, p_event_at, now())
  ON CONFLICT (scope_key) DO UPDATE SET
    plan = EXCLUDED.plan,
    status = EXCLUDED.status,
    billing_interval = EXCLUDED.billing_interval,
    founder = s.founder OR EXCLUDED.founder,
    founder_until = COALESCE(s.founder_until, EXCLUDED.founder_until),
    -- L'essai offert par Yuno garde sa date ; Stripe ne la repousse pas.
    trial_ends_at = CASE WHEN EXCLUDED.status = 'trialing' THEN EXCLUDED.trial_ends_at ELSE s.trial_ends_at END,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, s.stripe_customer_id),
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    granted_by = NULL,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();

  PERFORM public.crm_sync_scope(p_scope_key);
  RETURN jsonb_build_object('ok', true, 'status', v_status, 'effective_plan', public.crm_effective_plan(p_scope_key));
END;
$$;

-- Client Stripe propre au CRM (jamais retrouvé par email : un club de la Suite
-- a peut-être déjà le sien).
CREATE OR REPLACE FUNCTION public.crm_set_stripe_customer(p_scope_key text, p_customer_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.crm_subscriptions (scope_key, venue_id, organizer_user_id, stripe_customer_id)
  VALUES (p_scope_key,
          CASE WHEN p_scope_key LIKE 'venue:%' THEN substr(p_scope_key, 7) END,
          CASE WHEN p_scope_key LIKE 'org:%' THEN substr(p_scope_key, 5)::uuid END,
          p_customer_id)
  ON CONFLICT (scope_key) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = now();
END;
$$;

-- ── Lecture pour la page Abonnement ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_crm_billing(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_row public.crm_subscriptions%ROWTYPE;
  v_plan text;
  v_limits jsonb;
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_sent integer;
  v_credits integer;
  v_members integer;
  v_auto integer;
  v_can_manage boolean;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.crm_subscriptions WHERE scope_key = v_scope;
  v_plan := public.crm_effective_plan(v_scope);
  v_limits := public.crm_plan_limits(v_plan);

  SELECT COALESCE(sent, 0) INTO v_sent FROM public.email_send_quota_month WHERE scope_key = v_scope AND month = v_month;
  SELECT COALESCE(credit_balance, 0) INTO v_credits FROM public.email_sender_state WHERE scope_key = v_scope;

  IF p_venue_id IS NOT NULL THEN
    SELECT count(*) INTO v_members FROM public.manager_permissions WHERE venue_id = p_venue_id;
    v_can_manage := EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = auth.uid())
                    OR public.is_super_admin();
  ELSE
    SELECT count(*) INTO v_members FROM public.org_members m
     WHERE m.organizer_user_id = p_organizer_user_id
       AND (m.invitation_status = 'accepted'
            OR (m.invitation_status = 'pending' AND (m.expires_at IS NULL OR m.expires_at > now())));
    v_can_manage := p_organizer_user_id = auth.uid() OR public.is_super_admin();
  END IF;
  SELECT count(*) INTO v_auto FROM public.email_automations a
   WHERE a.enabled AND a.venue_id IS NOT DISTINCT FROM p_venue_id
     AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'subscription', CASE WHEN v_row.scope_key IS NULL THEN NULL ELSE jsonb_build_object(
      'plan', v_row.plan, 'status', v_row.status, 'interval', v_row.billing_interval,
      'founder', v_row.founder, 'founder_until', v_row.founder_until,
      'trial_ends_at', v_row.trial_ends_at, 'current_period_end', v_row.current_period_end,
      'cancel_at_period_end', v_row.cancel_at_period_end,
      'has_stripe', v_row.stripe_subscription_id IS NOT NULL,
      'has_customer', v_row.stripe_customer_id IS NOT NULL) END,
    'effective_plan', v_plan,
    'founder_seats_left', public.crm_founder_seats_left(),
    'can_manage', v_can_manage,
    'usage', jsonb_build_object(
      'emails_sent', COALESCE(v_sent, 0),
      'emails_included', public.email_sender_monthly_free(v_scope),
      'email_credits', COALESCE(v_credits, 0),
      'sms_included', (v_limits->>'sms_month')::int,
      'members', COALESCE(v_members, 0),
      'members_limit', CASE WHEN v_limits->'members' = 'null'::jsonb THEN NULL ELSE (v_limits->>'members')::int END,
      'sync_minutes', (v_limits->>'sync_minutes')::int,
      'automations_on', COALESCE(v_auto, 0),
      'automations_limit', CASE WHEN v_limits->'automations' = 'null'::jsonb THEN NULL ELSE (v_limits->>'automations')::int END)
  );
END;
$$;

-- Les limites de la portée, pour les écrans qui gatent une fonction (Studio,
-- Automatisations, Équipe, Publicité). NULL = compte Suite, rien à gater.
CREATE OR REPLACE FUNCTION public.get_crm_limits(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF v_scope IS NULL OR NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RETURN NULL;
  END IF;
  IF NOT public.crm_scope_is_crm(v_scope) THEN RETURN NULL; END IF;
  RETURN public.crm_plan_limits(public.crm_effective_plan(v_scope))
         || jsonb_build_object('plan', public.crm_effective_plan(v_scope));
END;
$$;

-- ── Balayage horaire : fin d'essai, fin d'offre accordée, excès ─────────────
CREATE OR REPLACE FUNCTION public.crm_billing_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_limits jsonb;
  v_disabled integer := 0;
  v_ended integer;
  n integer;
BEGIN
  -- Essai fini sans abonnement : on le dit en clair (Gratuit).
  UPDATE public.crm_subscriptions SET status = 'none', updated_at = now()
   WHERE status = 'trialing' AND stripe_subscription_id IS NULL AND trial_ends_at < now();
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  -- Offre accordée à la main, échue.
  UPDATE public.crm_subscriptions SET status = 'canceled', updated_at = now()
   WHERE status IN ('active', 'past_due') AND stripe_subscription_id IS NULL
     AND current_period_end IS NOT NULL AND current_period_end < now();

  FOR r IN SELECT s.scope_key, s.venue_id, s.organizer_user_id FROM public.crm_subscriptions s
            WHERE public.crm_scope_is_crm(s.scope_key) LOOP
    PERFORM public.crm_sync_scope(r.scope_key);
    v_limits := public.crm_scope_limits(r.scope_key);
    -- Automatisations au-delà de l'offre : on garde les plus anciennes allumées.
    IF v_limits IS NOT NULL AND v_limits->'automations' <> 'null'::jsonb THEN
      UPDATE public.email_automations a SET enabled = false, updated_at = now()
       WHERE a.id IN (
         SELECT x.id FROM public.email_automations x
          WHERE x.enabled
            AND x.venue_id IS NOT DISTINCT FROM r.venue_id
            AND x.organizer_user_id IS NOT DISTINCT FROM r.organizer_user_id
          ORDER BY x.enabled_at NULLS LAST, x.created_at
          OFFSET (v_limits->>'automations')::int);
      GET DIAGNOSTICS n = ROW_COUNT;
      v_disabled := v_disabled + n;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('trials_ended', v_ended, 'automations_disabled', v_disabled);
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm-billing-sweep';
SELECT cron.schedule('crm-billing-sweep', '17 * * * *', $$SELECT public.crm_billing_sweep();$$);

-- ── Super admin : accorder une offre à la main, revenu récurrent ────────────
CREATE OR REPLACE FUNCTION public.admin_grant_crm_plan(p_scope_key text, p_plan text, p_until timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_plan NOT IN ('free', 'essential', 'pro', 'business') OR p_scope_key !~ '^(venue|org):.+$' THEN
    RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_subscriptions WHERE scope_key = p_scope_key AND stripe_subscription_id IS NOT NULL
               AND status IN ('trialing', 'active', 'past_due')) THEN
    RAISE EXCEPTION 'has_stripe_subscription' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, current_period_end, granted_by)
  VALUES (p_scope_key,
          CASE WHEN p_scope_key LIKE 'venue:%' THEN substr(p_scope_key, 7) END,
          CASE WHEN p_scope_key LIKE 'org:%' THEN substr(p_scope_key, 5)::uuid END,
          p_plan, CASE WHEN p_plan = 'free' THEN 'none' ELSE 'active' END, p_until, auth.uid())
  ON CONFLICT (scope_key) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end, granted_by = EXCLUDED.granted_by, updated_at = now();
  PERFORM public.crm_sync_scope(p_scope_key);
  RETURN jsonb_build_object('ok', true, 'effective_plan', public.crm_effective_plan(p_scope_key));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_crm_revenue(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
  rows AS (
    SELECT s.*, public.crm_effective_plan(s.scope_key) AS eff,
           -- Prix mensuel HT équivalent (annuel = dix mois, ramené au mois).
           CASE WHEN s.stripe_subscription_id IS NULL OR s.status NOT IN ('active', 'past_due') THEN 0
                ELSE (CASE WHEN s.founder THEN (CASE s.plan WHEN 'essential' THEN 35 WHEN 'pro' THEN 89 WHEN 'business' THEN 175 ELSE 0 END)
                           ELSE (CASE s.plan WHEN 'essential' THEN 49 WHEN 'pro' THEN 129 WHEN 'business' THEN 249 ELSE 0 END) END)
                     * (CASE WHEN s.billing_interval = 'year' THEN 10.0 / 12 ELSE 1 END)
           END AS mrr
      FROM public.crm_subscriptions s CROSS JOIN d
     WHERE public.crm_scope_is_crm(s.scope_key)
       AND (p_include_demo OR NOT (
             (s.venue_id IS NOT NULL AND s.venue_id = ANY(d.dv))
          OR (s.organizer_user_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM auth.users u WHERE u.id = s.organizer_user_id AND public.is_demo_email(u.email)))))
  )
  SELECT jsonb_build_object(
    'accounts', count(*),
    'mrr', round(COALESCE(sum(mrr), 0)::numeric, 2),
    'paying', count(*) FILTER (WHERE mrr > 0),
    'trialing', count(*) FILTER (WHERE status = 'trialing' AND trial_ends_at > now()),
    'past_due', count(*) FILTER (WHERE status = 'past_due'),
    'founders', count(*) FILTER (WHERE founder AND mrr > 0),
    'by_plan', COALESCE((SELECT jsonb_object_agg(eff, c) FROM (SELECT eff, count(*) c FROM rows GROUP BY eff) x), '{}'::jsonb)
  ) INTO v FROM rows;
  RETURN v;
END;
$$;

-- ── Droits ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.crm_plan_limits(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_plan_limits(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_scope_key(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_key(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_scope_is_crm(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_scope_is_crm(text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_effective_plan(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_effective_plan(text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_scope_limits(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_scope_limits(text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_founder_seats_left() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_founder_seats_left() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_start_trial() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_sync_scope(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sync_scope(text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_connection_interval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_guard_member_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_guard_automation_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_guard_campaign_features() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.crm_set_stripe_customer(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_set_stripe_customer(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_crm_billing(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_billing(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_crm_limits(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_limits(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_billing_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_billing_sweep() TO service_role;
REVOKE ALL ON FUNCTION public.admin_grant_crm_plan(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_crm_plan(text, text, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_crm_revenue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_revenue(boolean) TO authenticated;
-- email_sender_monthly_free garde ses droits (authenticated, service_role).
