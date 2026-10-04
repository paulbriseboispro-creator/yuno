-- ============================================================================
-- Yuno CRM — lot 4b : UN abonnement et les Yunits (décision de Paul, 02/10,
-- confirmée le 04/10 : « applique pour Yuno CRM les règles de l'abonnement et
-- des Yunits ; rien qui touche Yuno Billetterie »).
--
-- Avant : quatre offres (Gratuit, Essentiel, Pro, Business) avec un quota
-- d'emails par mois, un plafond de membres et d'automatisations, l'A/B et le
-- renvoi réservés au Pro. Jamais vendues (les prix n'ont jamais existé).
-- Après, pour un compte au produit `crm` seulement :
--   • une offre, le SOCLE (`base`) : essai en cours, abonnement actif ou en
--     retard, ou offre accordée à la main pas encore échue ; sinon le compte
--     est EN PAUSE (`paused`) : la base reste lisible et exportable, rien ne
--     se synchronise, rien ne part ;
--   • tout ce qui fait envoyer est dans le socle : automatisations, A/B,
--     renvoi, équipe sans limite ; synchro toutes les 15 minutes ;
--   • plus de quota mensuel d'emails : le Yunit est la seule limite (débité à
--     la mise en file, migration 20261004220000, et sur la file des campagnes
--     enfants, 20261004225000). Les garde-fous de délivrabilité (plafond
--     plateforme, montée en charge du domaine) restent ceux de Yuno ;
--   • l'équipe de l'espace CRM (gérant d'un club, admin / éditeur d'une
--     organisation) écrit et envoie les campagnes, pas seulement le titulaire.
--     L'argent (abonnement, recharges) reste au titulaire.
-- La Suite (Yuno Billetterie) ne change pas : chaque fonction ci-dessous
-- retombe sur son comportement d'avant dès que la portée n'est pas `crm`.
-- ============================================================================

-- ── 1. Une offre ────────────────────────────────────────────────────────────
ALTER TABLE public.crm_subscriptions DROP CONSTRAINT IF EXISTS crm_subscriptions_plan_check;
UPDATE public.crm_subscriptions SET plan = 'base', updated_at = now() WHERE plan IS DISTINCT FROM 'base';
ALTER TABLE public.crm_subscriptions ALTER COLUMN plan SET DEFAULT 'base';
ALTER TABLE public.crm_subscriptions ADD CONSTRAINT crm_subscriptions_plan_check CHECK (plan = 'base');

CREATE OR REPLACE FUNCTION public.crm_plan_limits(p_plan text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  -- MIROIR EXACT de CRM_PLAN_LIMITS (src/lib/crmPlans.ts).
  -- NULL = sans limite. Le socle n'a ni quota d'emails ni plafond : le Yunit
  -- fait la limite. En pause : lecture et export seulement.
  SELECT CASE p_plan
    WHEN 'base' THEN jsonb_build_object('send', true, 'sync', true, 'emails_month', NULL, 'sync_minutes', 15,
      'members', NULL, 'automations', NULL, 'ab_resend', true, 'meta', true, 'segment_export', true, 'yuno_badge', false)
    ELSE jsonb_build_object('send', false, 'sync', false, 'emails_month', 0, 'sync_minutes', NULL,
      'members', NULL, 'automations', NULL, 'ab_resend', true, 'meta', false, 'segment_export', true, 'yuno_badge', false)
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
  IF NOT FOUND THEN RETURN 'paused'; END IF;
  IF s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now() THEN
    RETURN 'base';
  END IF;
  IF s.status IN ('active', 'past_due') THEN
    -- Offre accordée à la main (sans Stripe) : elle s'éteint à sa date.
    IF s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
      RETURN 'paused';
    END IF;
    RETURN 'base';
  END IF;
  RETURN 'paused';
END;
$$;

-- Un compte CRM en pause ? (faux pour tout compte de la Suite)
CREATE OR REPLACE FUNCTION public.crm_scope_paused(p_scope_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_scope_key IS NOT NULL AND public.crm_scope_is_crm(p_scope_key)
         AND public.crm_effective_plan(p_scope_key) = 'paused';
$$;
REVOKE ALL ON FUNCTION public.crm_scope_paused(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_paused(text) TO authenticated, service_role;

-- ── 2. Synchro : toutes les 15 minutes, rien en pause ───────────────────────
-- Une connexion d'un compte en pause est repoussée loin (le balayage de la
-- synchro ne la voit plus comme « due », donc ne relance pas en boucle) ; à la
-- reprise, elle repart tout de suite.
CREATE OR REPLACE FUNCTION public.crm_sync_scope(p_scope_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb := public.crm_scope_limits(p_scope_key);
  v_minutes integer;
  v_far timestamptz := now() + interval '100 years';
BEGIN
  IF v_limits IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((v_limits->>'sync')::boolean, false) THEN
    UPDATE public.ticketing_connections c
       SET next_sync_at = v_far
     WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = p_scope_key
       AND c.next_sync_at < now() + interval '50 years';
    RETURN;
  END IF;
  v_minutes := (v_limits->>'sync_minutes')::int;
  UPDATE public.ticketing_connections c
     SET sync_interval_minutes = v_minutes,
         next_sync_at = CASE WHEN c.next_sync_at > now() + interval '50 years' THEN now()
                             ELSE LEAST(c.next_sync_at, now() + make_interval(mins => v_minutes)) END
   WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = p_scope_key
     AND (c.sync_interval_minutes IS DISTINCT FROM v_minutes OR c.next_sync_at > now() + interval '50 years');
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
    NEW.sync_interval_minutes := COALESCE((v_limits->>'sync_minutes')::int, 15);
    IF NOT COALESCE((v_limits->>'sync')::boolean, false) THEN
      NEW.next_sync_at := now() + interval '100 years';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Ceinture : même une synchro demandée à la main ne part pas d'un compte en pause.
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

-- ── 3. Emails : plus de quota mensuel pour un compte CRM ────────────────────
CREATE OR REPLACE FUNCTION public.email_sender_monthly_free(p_scope_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_override integer;
  v_org text;
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
  -- Yuno CRM : le Yunit est la seule limite (débité à la mise en file). Le
  -- quota mensuel ne bride plus rien ; en pause, rien ne part de toute façon.
  IF public.crm_scope_is_crm(p_scope_key) THEN
    RETURN CASE WHEN public.crm_effective_plan(p_scope_key) = 'base' THEN 1000000000 ELSE 0 END;
  END IF;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
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

-- Mise en file : un compte en pause n'envoie rien (refus avant toute écriture).
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

  SELECT public.crm_scope_key(c.venue_id, c.organizer_user_id), c.name
    INTO v_scope, v_name
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  IF public.crm_scope_paused(v_scope) THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le compte est en pause, aucun envoi ne part.';
  END IF;

  v_res := public._enqueue_campaign_recipients_core(p_campaign_id);
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

-- File des campagnes enfants : en pause, les destinataires sont écartés.
CREATE OR REPLACE FUNCTION public._crm_yunits_debit_child_recipients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_debit jsonb;
  v_reason text;
BEGIN
  FOR r IN
    SELECT n.campaign_id, count(*)::integer AS k,
           public.crm_scope_key(c.venue_id, c.organizer_user_id) AS scope, c.name
      FROM new_rows n
      JOIN public.email_campaigns c ON c.id = n.campaign_id
     WHERE n.status = 'pending' AND c.child_kind IS NOT NULL
     GROUP BY n.campaign_id, c.venue_id, c.organizer_user_id, c.name
  LOOP
    IF r.scope IS NULL OR NOT public.crm_scope_is_crm(r.scope) THEN
      CONTINUE;
    END IF;
    v_reason := NULL;
    IF public.crm_effective_plan(r.scope) = 'paused' THEN
      v_reason := 'paused';
    ELSE
      v_debit := public.crm_yunits_debit(r.scope, r.k, 'email', 'email_campaign', r.campaign_id::text, r.name, '{}'::jsonb);
      IF NOT COALESCE((v_debit->>'ok')::boolean, false) THEN v_reason := 'yunits'; END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
      UPDATE public.email_campaign_recipients q
         SET status = 'skipped', error_message = v_reason
       WHERE q.campaign_id = r.campaign_id AND q.status = 'pending'
         AND q.id IN (SELECT n.id FROM new_rows n WHERE n.campaign_id = r.campaign_id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_yunits_debit_child_recipients() FROM PUBLIC, anon, authenticated;

-- A/B et renvoi : dans le socle (le garde ne refuse plus rien à un compte CRM).
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
  IF v_limits IS NULL OR COALESCE((v_limits->>'ab_resend')::boolean, true) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'crm_plan_ab_resend' USING ERRCODE = 'P0001';
END;
$$;

-- ── 4. Balayage horaire : fin d'essai, fin d'offre accordée, synchro ────────
CREATE OR REPLACE FUNCTION public.crm_billing_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_ended integer;
  v_lapsed integer;
BEGIN
  -- Essai fini sans abonnement : le compte passe en pause.
  UPDATE public.crm_subscriptions SET status = 'none', updated_at = now()
   WHERE status = 'trialing' AND stripe_subscription_id IS NULL AND trial_ends_at < now();
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  -- Offre accordée à la main, échue.
  UPDATE public.crm_subscriptions SET status = 'canceled', updated_at = now()
   WHERE status IN ('active', 'past_due') AND stripe_subscription_id IS NULL
     AND current_period_end IS NOT NULL AND current_period_end < now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  FOR r IN SELECT s.scope_key FROM public.crm_subscriptions s WHERE public.crm_scope_is_crm(s.scope_key) LOOP
    PERFORM public.crm_sync_scope(r.scope_key);
  END LOOP;
  RETURN jsonb_build_object('trials_ended', v_ended, 'grants_lapsed', v_lapsed);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_billing_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_billing_sweep() TO service_role;

-- ── 5. Stripe et super admin : une seule offre ──────────────────────────────
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
  -- p_plan est gardé dans la signature (anciens appels) mais il n'y a plus
  -- qu'une offre : le socle.
  IF p_scope_key !~ '^(venue|org):.+$' THEN
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
  IF FOUND AND v_row.last_event_at IS NOT NULL AND p_event_at < v_row.last_event_at THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'older_event');
  END IF;
  IF FOUND AND v_row.stripe_subscription_id IS NOT NULL AND v_row.stripe_subscription_id <> p_subscription_id
     AND v_status IN ('canceled', 'incomplete') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'other_subscription');
  END IF;

  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, billing_interval,
         founder, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id,
         stripe_subscription_id, last_event_at, updated_at)
  VALUES (p_scope_key, v_venue, v_org, 'base', v_status, p_interval,
          COALESCE(p_founder, false), p_trial_end, p_period_end, COALESCE(p_cancel_at_period_end, false), p_customer_id,
          p_subscription_id, p_event_at, now())
  ON CONFLICT (scope_key) DO UPDATE SET
    plan = 'base',
    status = EXCLUDED.status,
    billing_interval = EXCLUDED.billing_interval,
    founder = s.founder OR EXCLUDED.founder,
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
REVOKE ALL ON FUNCTION public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, boolean) TO service_role;

-- Super admin : accorder le socle jusqu'à une date, ou mettre en pause.
-- Les anciens noms d'offre valent le socle ; « free » vaut la pause.
CREATE OR REPLACE FUNCTION public.admin_grant_crm_plan(p_scope_key text, p_plan text, p_until timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pause boolean;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_plan NOT IN ('base', 'paused', 'free', 'essential', 'pro', 'business') OR p_scope_key !~ '^(venue|org):.+$' THEN
    RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_subscriptions WHERE scope_key = p_scope_key AND stripe_subscription_id IS NOT NULL
               AND status IN ('trialing', 'active', 'past_due')) THEN
    RAISE EXCEPTION 'has_stripe_subscription' USING ERRCODE = 'P0001';
  END IF;
  v_pause := p_plan IN ('paused', 'free');
  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, current_period_end, granted_by)
  VALUES (p_scope_key,
          CASE WHEN p_scope_key LIKE 'venue:%' THEN substr(p_scope_key, 7) END,
          CASE WHEN p_scope_key LIKE 'org:%' THEN substr(p_scope_key, 5)::uuid END,
          'base', CASE WHEN v_pause THEN 'none' ELSE 'active' END, p_until, auth.uid())
  ON CONFLICT (scope_key) DO UPDATE SET plan = 'base', status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end, granted_by = EXCLUDED.granted_by, updated_at = now();
  PERFORM public.crm_sync_scope(p_scope_key);
  RETURN jsonb_build_object('ok', true, 'effective_plan', public.crm_effective_plan(p_scope_key));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_grant_crm_plan(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_crm_plan(text, text, timestamptz) TO authenticated, service_role;

-- ── 5b. Lecture des limites : le socle ou la pause ──────────────────────────
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

-- ── 6. L'équipe de l'espace CRM écrit et envoie ─────────────────────────────
-- Qui travaille dans un espace CRM (même porte que les lectures de la Console).
CREATE OR REPLACE FUNCTION public.crm_user_in_scope(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL
     AND ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL))
     AND public.crm_scope_is_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id))
     AND (
       (p_venue_id IS NOT NULL AND public.can_manage_venue(p_user_id, p_venue_id))
       OR (p_organizer_user_id IS NOT NULL AND (
             p_organizer_user_id = p_user_id
             OR public.is_org_team_member(p_user_id, p_organizer_user_id, 'editor'))));
$$;
REVOKE ALL ON FUNCTION public.crm_user_in_scope(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_user_in_scope(uuid, text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "CRM team manages email campaigns" ON public.email_campaigns;
CREATE POLICY "CRM team manages email campaigns" ON public.email_campaigns
  FOR ALL TO authenticated
  USING (public.crm_user_in_scope(auth.uid(), venue_id, organizer_user_id))
  WITH CHECK (public.crm_user_in_scope(auth.uid(), venue_id, organizer_user_id));

DROP POLICY IF EXISTS "CRM team manages email templates" ON public.email_campaign_templates;
CREATE POLICY "CRM team manages email templates" ON public.email_campaign_templates
  FOR ALL TO authenticated
  USING (public.crm_user_in_scope(auth.uid(), venue_id, organizer_user_id))
  WITH CHECK (public.crm_user_in_scope(auth.uid(), venue_id, organizer_user_id));

-- Images du Studio : l'équipe d'un espace CRM peut en déposer.
CREATE OR REPLACE FUNCTION public.can_manage_email_assets()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.venues WHERE owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'organizer'::app_role)
    OR EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND profile_type = 'organizer'
    )
    OR EXISTS (
      SELECT 1 FROM public.org_members m
        JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id AND op.product = 'crm'
       WHERE m.member_user_id = auth.uid() AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.manager_permissions mp
        JOIN public.venues v ON v.id = mp.venue_id AND v.product = 'crm'
       WHERE mp.user_id = auth.uid()
    )
$function$;
