-- Yuno CRM — abonnement : l'annuel à 10 mois, les impayés, la démo, l'écran de
-- pause et « Prévenir le titulaire » (décisions de Paul du 03/11).
--
-- 1. Prix : l'annuel coûte 10 mois (240 € au lancement, « 2 mois offerts »),
--    et 10 000 Yunits sont offerts UNE fois au mensuel comme à l'annuel (plus
--    de bonus annuel de 30 000). Le prix public annuel suit le même rapport
--    (34 € × 240 / 24 = 340 €) : get_crm_billing ne le calcule plus en × 12.
-- 2. Un abonnement Stripe `unpaid` (toutes les relances ont échoué) met le
--    compte en pause : il était lu `past_due`, donc l'accès restait ouvert.
-- 3. Le compte démo CRM (crm@womber.fr) : son don était échu le 03/11 ; il est
--    prolongé de 10 ans (une démo de vente ne tombe jamais sur l'écran de pause).
-- 4. crm_pause_summary : ce que l'écran de pause montre (ce que le compte a
--    construit, depuis quand il est en pause, pourquoi). Que des comptages.
-- 5. crm_nudge_owner_subscribe : un membre de l'équipe prévient le titulaire,
--    une fois par jour au plus ; le titulaire le lit dans ses notifications.
--
-- Les corps des fonctions réécrites sont ceux de la prod (pg_get_functiondef du
-- 03/11), modifiés par remplacement exact : un remplacement qui ne trouve pas
-- son texte fait échouer la migration plutôt que de passer en silence.

-- ── 1. Prix ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT config INTO v_before FROM public.crm_pricing WHERE id;
  v_after := v_before || jsonb_build_object('price_year', 240, 'annual_bonus_yunits', 0);
  IF v_after IS DISTINCT FROM v_before THEN
    UPDATE public.crm_pricing SET config = v_after, updated_at = now() WHERE id;
    INSERT INTO public.crm_pricing_history (by_user, reason, before, after)
    VALUES (NULL, 'Annuel = 10 mois (2 mois offerts), 10 000 Yunits pour les deux formules (décision du 03/11)', v_before, v_after);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._crm_patch_function(p_sig regprocedure, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
BEGIN
  IF position(p_from IN v_def) = 0 THEN
    RAISE EXCEPTION 'patch % : texte introuvable : %', p_sig, left(p_from, 120);
  END IF;
  EXECUTE replace(v_def, p_from, p_to);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_patch_function(regprocedure, text, text) FROM PUBLIC, anon, authenticated;

-- get_crm_billing : prix public annuel au même rapport que le lancement.
SELECT public._crm_patch_function('public.get_crm_billing(text, uuid)'::regprocedure,
  $f$'price_year', CASE WHEN v_tier = 'public' THEN (cfg->>'price_month_next')::numeric * 12 ELSE (cfg->>'price_year')::numeric END,$f$,
  $f$'price_year', CASE WHEN v_tier = 'public'
        THEN round((cfg->>'price_month_next')::numeric * (cfg->>'price_year')::numeric / NULLIF((cfg->>'price_month')::numeric, 0))
        ELSE (cfg->>'price_year')::numeric END,$f$);

-- crm_yunits_ensure_allowance : l'annuel reçoit aussi les 10 000 Yunits d'accueil.
SELECT public._crm_patch_function('public.crm_yunits_ensure_allowance(text)'::regprocedure,
  $f$    -- Annuel : le bonus est posé à la période payée par crm_apply_stripe_subscription.
    IF s.billing_interval = 'year' THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'annual');
    END IF;
$f$,
  $f$    -- Mensuel comme annuel : 10 000 Yunits une fois (décision du 03/11).
$f$);

-- crm_apply_stripe_subscription : `unpaid` met en pause, bonus annuel seulement s'il existe.
SELECT public._crm_patch_function(
  'public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamp with time zone, timestamp with time zone, boolean, timestamp with time zone, boolean)'::regprocedure,
  $f$    WHEN p_stripe_status = 'unpaid' THEN 'past_due'$f$,
  $f$    -- Toutes les relances ont échoué : le compte passe en pause (03/11).
    WHEN p_stripe_status = 'unpaid' THEN 'canceled'$f$);
SELECT public._crm_patch_function(
  'public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamp with time zone, timestamp with time zone, boolean, timestamp with time zone, boolean)'::regprocedure,
  $f$IF v_status = 'active' AND p_interval = 'year' AND p_period_end IS NOT NULL AND p_period_end > now() THEN$f$,
  $f$IF v_status = 'active' AND p_interval = 'year' AND p_period_end IS NOT NULL AND p_period_end > now()
     AND COALESCE((cfg->>'annual_bonus_yunits')::int, 0) > 0 THEN$f$);

-- ── 3. Le compte démo CRM ne passe jamais en pause ────────────────────────
UPDATE public.crm_subscriptions s
   SET status = 'active', current_period_end = now() + interval '10 years', updated_at = now()
  FROM public.organizer_profiles o
  JOIN auth.users u ON u.id = o.user_id
 WHERE s.scope_key = 'org:' || o.user_id::text
   AND public.is_demo_email(u.email)
   AND s.stripe_subscription_id IS NULL
   AND (s.current_period_end IS NULL OR s.current_period_end < now() + interval '1 year');

-- ── 4. L'écran de pause ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_pause_summary(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cache text := CASE WHEN p_venue_id IS NOT NULL THEN 'v:' || p_venue_id ELSE 'o:' || p_organizer_user_id::text END || '|crm';
  s public.crm_subscriptions%ROWTYPE;
  v_reason text;
  v_since timestamptz;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = v_scope;
  IF NOT FOUND THEN
    v_reason := 'none';
  ELSIF s.stripe_subscription_id IS NOT NULL AND s.status IN ('canceled', 'incomplete') THEN
    v_reason := 'ended'; v_since := s.current_period_end;
  ELSIF s.stripe_subscription_id IS NULL AND s.status = 'canceled' THEN
    v_reason := 'grant'; v_since := s.current_period_end;
  ELSE
    v_reason := 'trial'; v_since := s.trial_ends_at;
  END IF;

  RETURN jsonb_build_object(
    'reason', v_reason,
    'since', v_since,
    'contacts', (SELECT count(*) FROM public.contact_base_cache c WHERE c.scope_key = v_cache),
    'nights', (SELECT count(*) FROM public.external_events e
                WHERE e.venue_id IS NOT DISTINCT FROM p_venue_id
                  AND e.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END)),
    'emails_sent', (SELECT count(*) FROM public.email_campaign_recipients r
                     JOIN public.email_campaigns c ON c.id = r.campaign_id
                    WHERE r.status = 'sent' AND c.product = 'crm'
                      AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                      AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id),
    'automations', (SELECT count(*) FROM public.email_automations a
                     WHERE a.product = 'crm' AND a.enabled_at IS NOT NULL
                       AND a.venue_id IS NOT DISTINCT FROM p_venue_id
                       AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id)
                 + (SELECT count(*) FROM public.crm_scenarios sc
                     WHERE sc.scope_key = v_scope AND sc.archived_at IS NULL AND sc.live_version_id IS NOT NULL),
    'yunits_balance', public.crm_yunits_balance(v_scope),
    'sync_provider', (SELECT t.provider FROM public.ticketing_connections t
                       WHERE t.venue_id IS NOT DISTINCT FROM p_venue_id
                         AND t.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END)
                       ORDER BY t.created_at LIMIT 1),
    'owner_first_name', (SELECT NULLIF(trim(COALESCE(p.first_name, '')), '')
                          FROM public.profiles p
                         WHERE p.id = COALESCE(p_organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = p_venue_id))),
    'nudged_at', (SELECT max(n.requested_at) FROM public.crm_subscribe_nudges n
                   WHERE n.scope_key = v_scope AND n.requested_by = auth.uid())
  );
END;
$$;

-- ── 5. Prévenir le titulaire ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_subscribe_nudges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_key text NOT NULL CHECK (scope_key ~ '^(venue|org):.+$'),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_subscribe_nudges_scope_idx ON public.crm_subscribe_nudges (scope_key, requested_at DESC);
ALTER TABLE public.crm_subscribe_nudges ENABLE ROW LEVEL SECURITY;
-- Aucune policy : tout passe par crm_nudge_owner_subscribe et le fil de notifications.

CREATE OR REPLACE FUNCTION public.crm_nudge_owner_subscribe(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_owner uuid;
  v_last timestamptz;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'one scope' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL OR NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_owner := COALESCE(p_organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = p_venue_id));
  IF v_owner = auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'is_owner');
  END IF;
  SELECT max(requested_at) INTO v_last FROM public.crm_subscribe_nudges
   WHERE scope_key = v_scope AND requested_by = auth.uid();
  IF v_last IS NOT NULL AND v_last > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'at', v_last);
  END IF;
  INSERT INTO public.crm_subscribe_nudges (scope_key, requested_by) VALUES (v_scope, auth.uid());
  RETURN jsonb_build_object('ok', true, 'already', false, 'at', now());
END;
$$;

-- Le fil du titulaire : « <prénom> vous demande de prendre l'abonnement » (7 jours,
-- tant qu'aucun abonnement Stripe ne court).
SELECT public._crm_patch_function('public._crm_notif_list(text, uuid, uuid, boolean)'::regprocedure,
  $f$  -- Accès assisté (20261019420000) : une demande de l'équipe Yuno attend la$f$,
  $f$  -- Un membre de l'équipe demande au titulaire de s'abonner (20261118100000).
  IF (p_venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = p_user))
     OR p_organizer_user_id = p_user THEN
    FOR r IN SELECT n.id, n.requested_at, NULLIF(trim(COALESCE(p.first_name, '')), '') AS who
               FROM public.crm_subscribe_nudges n
               LEFT JOIN public.profiles p ON p.id = n.requested_by
              WHERE n.scope_key = v_scope AND n.requested_at > now() - interval '7 days'
                AND NOT EXISTS (SELECT 1 FROM public.crm_subscriptions s
                                 WHERE s.scope_key = v_scope AND s.stripe_subscription_id IS NOT NULL
                                   AND s.status IN ('trialing', 'active', 'past_due'))
              ORDER BY n.requested_at DESC LIMIT 1 LOOP
      v_items := v_items || jsonb_build_object('id', 'subscribe_nudge:' || r.id, 'kind', 'subscribe_nudge', 'cat', 'compte', 'tone', 'todo',
        'need', true, 'lock', true, 'pref', NULL, 'at', r.requested_at, 'due_at', NULL,
        'params', jsonb_build_object('name', r.who));
    END LOOP;
  END IF;

  -- Accès assisté (20261019420000) : une demande de l'équipe Yuno attend la$f$);

DROP FUNCTION public._crm_patch_function(regprocedure, text, text);

REVOKE ALL ON FUNCTION public.crm_pause_summary(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pause_summary(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_nudge_owner_subscribe(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_nudge_owner_subscribe(text, uuid) TO authenticated, service_role;
