-- ============================================================================
-- Yuno Billetterie × Yuno CRM : un compte peut avoir LES DEUX produits.
--
-- Décision de Paul (2026-10-04) :
--   • Un compte (club ou organisation) naît avec UN produit, son produit
--     principal (`product`, inchangé). Il peut ensuite AJOUTER l'autre
--     (`extra_products`) : lui-même depuis le funnel CRM (« ouvrir aussi Yuno
--     CRM ») ou la page /open/:product, ou sur invitation du super admin (email).
--   • Le CRM ajouté à un compte Billetterie est PAYANT À PART : essai de 14
--     jours, puis l'abonnement CRM (Yunits). La Billetterie garde ses règles
--     (15 000 e-mails offerts par mois, crédits).
--   • Même connexion, même base de contacts, deux Consoles.
--
-- Deux questions distinctes, deux portes :
--   crm_scope_has_crm(scope)  = « le CRM est-il ouvert sur ce compte ? »
--                               (Console /crm, lectures, Yunits, essai).
--   crm_scope_is_crm(scope)   = « ce compte est-il un compte CRM PUR ? »
--                               (règles au niveau du compte entier : quota
--                               mensuel, pause de tout envoi, conservation
--                               qui efface des contacts). Un compte qui a les
--                               deux produits suit les règles de la Billetterie
--                               à ce niveau : le CRM ne doit jamais bloquer ni
--                               effacer quoi que ce soit côté Billetterie.
--   crm_campaign_is_crm(id)   = « cette campagne est-elle une campagne CRM ? »
--                               (débit des Yunits, refus en pause). Compte CRM
--                               pur : toujours ; compte à deux produits : la
--                               campagne porte product = 'crm' ou une audience
--                               CRM (kind 'crm', que seule la Console CRM pose).
--
-- Rien ne change pour un compte Billetterie pur ni pour un compte CRM pur.
-- ============================================================================

-- ── 1. Produits ajoutés ─────────────────────────────────────────────────────
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS extra_products text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.organizer_profiles ADD COLUMN IF NOT EXISTS extra_products text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venues_extra_products_check') THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_extra_products_check
      CHECK (extra_products <@ ARRAY['suite', 'crm']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizer_profiles_extra_products_check') THEN
    ALTER TABLE public.organizer_profiles ADD CONSTRAINT organizer_profiles_extra_products_check
      CHECK (extra_products <@ ARRAY['suite', 'crm']::text[]);
  END IF;
END $$;

-- Lecture par colonne (les deux tables ont des GRANT par colonne).
GRANT SELECT (extra_products) ON public.venues TO authenticated;
GRANT SELECT (extra_products) ON public.organizer_profiles TO authenticated;

COMMENT ON COLUMN public.venues.extra_products IS
  'Produits AJOUTÉS au produit principal (suite | crm). Écrit par _account_add_product seulement.';
COMMENT ON COLUMN public.organizer_profiles.extra_products IS
  'Produits AJOUTÉS au produit principal (suite | crm). Écrit par _account_add_product seulement.';

-- Le client ne choisit ni son produit ni ses produits ajoutés.
CREATE OR REPLACE FUNCTION public.guard_account_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_super_admin()
     AND (NEW.product IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN 'suite' ELSE OLD.product END)
          OR NEW.extra_products IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN '{}'::text[] ELSE OLD.extra_products END)) THEN
    RAISE EXCEPTION 'product is set by Yuno only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_venue_product ON public.venues;
CREATE TRIGGER trg_guard_venue_product
  BEFORE INSERT OR UPDATE OF product, extra_products ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_product();
DROP TRIGGER IF EXISTS trg_guard_organizer_product ON public.organizer_profiles;
CREATE TRIGGER trg_guard_organizer_product
  BEFORE INSERT OR UPDATE OF product, extra_products ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_product();

-- ── 2. Les portes ───────────────────────────────────────────────────────────
-- Produits d'un compte : principal d'abord, puis les ajoutés.
CREATE OR REPLACE FUNCTION public.account_products(p_scope_key text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v text[];
BEGIN
  IF p_scope_key LIKE 'venue:%' THEN
    SELECT ARRAY[product] || extra_products INTO v FROM public.venues WHERE id = substr(p_scope_key, 7);
  ELSIF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    SELECT ARRAY[product] || extra_products INTO v FROM public.organizer_profiles WHERE user_id = substr(p_scope_key, 5)::uuid;
  END IF;
  RETURN COALESCE(v, '{}'::text[]);
END;
$function$;
REVOKE ALL ON FUNCTION public.account_products(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_products(text) TO authenticated, service_role;

-- Le CRM est-il ouvert sur ce compte (principal ou ajouté) ?
CREATE OR REPLACE FUNCTION public.crm_scope_has_crm(p_scope_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'crm' = ANY (public.account_products(p_scope_key));
$function$;
REVOKE ALL ON FUNCTION public.crm_scope_has_crm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_has_crm(text) TO authenticated, service_role;

-- Compte CRM PUR : produit principal CRM, sans la Billetterie ajoutée.
CREATE OR REPLACE FUNCTION public.crm_scope_is_crm(p_scope_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_scope_key LIKE 'venue:%' THEN
    RETURN EXISTS (SELECT 1 FROM public.venues
                    WHERE id = substr(p_scope_key, 7) AND product = 'crm' AND NOT ('suite' = ANY (extra_products)));
  ELSIF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    RETURN EXISTS (SELECT 1 FROM public.organizer_profiles
                    WHERE user_id = substr(p_scope_key, 5)::uuid AND product = 'crm' AND NOT ('suite' = ANY (extra_products)));
  END IF;
  RETURN false;
END;
$function$;

-- Une campagne email est-elle une campagne CRM (Yunits, refus en pause) ?
ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS product text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_campaigns_product_check') THEN
    ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_product_check
      CHECK (product IS NULL OR product IN ('suite', 'crm'));
  END IF;
END $$;
COMMENT ON COLUMN public.email_campaigns.product IS
  'Produit qui a créé la campagne (posé par la Console CRM). NULL = produit principal du compte.';

CREATE OR REPLACE FUNCTION public.crm_campaign_is_crm(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_scope text;
BEGIN
  SELECT id, venue_id, organizer_user_id, product, audiences_json, parent_campaign_id
    INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_scope := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  IF v_scope IS NULL THEN RETURN false; END IF;               -- portée plateforme
  IF public.crm_scope_is_crm(v_scope) THEN RETURN true; END IF; -- CRM pur : tout est CRM
  IF NOT public.crm_scope_has_crm(v_scope) THEN RETURN false; END IF;
  -- Compte à deux produits : la campagne dit d'où elle vient.
  IF c.product IS NOT NULL THEN RETURN c.product = 'crm'; END IF;
  IF jsonb_typeof(c.audiences_json) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(c.audiences_json) e WHERE e->>'kind' = 'crm') THEN
    RETURN true;
  END IF;
  -- Relance d'une campagne : celle de sa mère.
  IF c.parent_campaign_id IS NOT NULL AND c.parent_campaign_id <> c.id THEN
    RETURN public.crm_campaign_is_crm(c.parent_campaign_id);
  END IF;
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_campaign_is_crm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_campaign_is_crm(uuid) TO service_role;

-- ── 3. Envoi : Yunits et pause jugés PAR CAMPAGNE ───────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
  v_scope text;
  v_name text;
  v_queued integer;
  v_debit jsonb;
  v_crm boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;

  SELECT public.crm_scope_key(c.venue_id, c.organizer_user_id), c.name
    INTO v_scope, v_name
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  v_crm := public.crm_campaign_is_crm(p_campaign_id);
  IF v_crm AND public.crm_effective_plan(v_scope) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le compte est en pause, aucun envoi ne part.';
  END IF;

  v_res := public._enqueue_campaign_recipients_core(p_campaign_id);
  IF v_scope IS NULL OR NOT v_crm THEN
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
$function$;

CREATE OR REPLACE FUNCTION public._crm_yunits_debit_child_recipients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF r.scope IS NULL OR NOT public.crm_campaign_is_crm(r.campaign_id) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.mark_campaign_recipients_failed(p_campaign_id uuid, p_emails text[], p_error text, p_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_max_attempts integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_scope IS NOT NULL AND public.crm_campaign_is_crm(p_campaign_id) THEN
    SELECT failed_count INTO v_after FROM public.email_campaigns WHERE id = p_campaign_id;
    IF COALESCE(v_after, 0) > COALESCE(v_before, 0) THEN
      -- Refusé par le fournisseur, jamais parti : le Yunit revient.
      PERFORM public.crm_yunits_refund(v_scope, v_after - COALESCE(v_before, 0), 'email', 'email_campaign', p_campaign_id::text, v_name);
    END IF;
  END IF;
  RETURN v_n;
END;
$function$;

-- ── 4. Accès à la Console CRM : CRM principal OU ajouté ─────────────────────
CREATE OR REPLACE FUNCTION public.get_my_crm_spaces()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT COALESCE(jsonb_agg(s ORDER BY s->>'sort', s->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'kind', 'venue',
             'key', 'venue:' || v.id,
             'venue_id', v.id,
             'organizer_user_id', NULL,
             'name', v.name,
             'city', v.city,
             'logo_url', v.logo_url,
             'role', CASE WHEN v.owner_id = me.uid THEN 'owner' ELSE 'manager' END,
             'sort', CASE WHEN v.owner_id = me.uid THEN '0' ELSE '2' END,
             'products', ARRAY[v.product] || v.extra_products
           ) AS s
      FROM public.venues v, me
     WHERE me.uid IS NOT NULL
       AND (v.product = 'crm' OR 'crm' = ANY (v.extra_products))
       AND public.can_manage_venue(me.uid, v.id)
    UNION ALL
    SELECT jsonb_build_object(
             'kind', 'org',
             'key', 'org:' || o.user_id,
             'venue_id', NULL,
             'organizer_user_id', o.user_id,
             'name', COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation'),
             'city', o.city,
             'logo_url', COALESCE(o.avatar_url, p.organization_logo_url),
             'role', public.crm_org_role(me.uid, o.user_id),
             'sort', CASE WHEN o.user_id = me.uid THEN '0' ELSE '1' END,
             'products', ARRAY[o.product] || o.extra_products
           )
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id, me
     WHERE me.uid IS NOT NULL
       AND (o.product = 'crm' OR 'crm' = ANY (o.extra_products))
       AND public.crm_org_role(me.uid, o.user_id) IS NOT NULL
  ) q;
$function$;

CREATE OR REPLACE FUNCTION public.crm_user_in_scope(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL
     AND ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL))
     AND public.crm_scope_has_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id))
     AND (
       (p_venue_id IS NOT NULL AND public.can_manage_venue(p_user_id, p_venue_id))
       OR (p_organizer_user_id IS NOT NULL AND (
             p_organizer_user_id = p_user_id
             OR public.is_org_team_member(p_user_id, p_organizer_user_id, 'editor'))));
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_limits(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF v_scope IS NULL OR NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RETURN NULL;
  END IF;
  IF NOT public.crm_scope_has_crm(v_scope) THEN RETURN NULL; END IF;
  RETURN public.crm_plan_limits(public.crm_effective_plan(v_scope))
         || jsonb_build_object('plan', public.crm_effective_plan(v_scope));
END;
$function$;

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
        JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id
                                         AND (op.product = 'crm' OR 'crm' = ANY (op.extra_products))
       WHERE m.member_user_id = auth.uid() AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.manager_permissions mp
        JOIN public.venues v ON v.id = mp.venue_id AND (v.product = 'crm' OR 'crm' = ANY (v.extra_products))
       WHERE mp.user_id = auth.uid()
    )
$function$;

CREATE OR REPLACE FUNCTION public.crm_segment_counts_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sc record;
  v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  FOR v_sc IN
    SELECT v.id AS venue_id, NULL::uuid AS org FROM public.venues v
     WHERE v.product = 'crm' OR 'crm' = ANY (v.extra_products)
    UNION ALL
    SELECT NULL::text, o.user_id FROM public.organizer_profiles o
     WHERE o.product = 'crm' OR 'crm' = ANY (o.extra_products)
  LOOP
    BEGIN
      PERFORM public._crm_people_build(v_sc.venue_id, v_sc.org, NULL);
      PERFORM public._crm_segment_counts_write(v_sc.venue_id, v_sc.org, v_today);
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'crm_segment_counts_sweep % %: %', v_sc.venue_id, v_sc.org, SQLERRM;
    END;
  END LOOP;
  DELETE FROM public.crm_segment_counts WHERE day < v_today - 800;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_billing_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_ended integer;
  v_lapsed integer;
BEGIN
  -- Essai fini sans abonnement : le CRM du compte passe en pause.
  UPDATE public.crm_subscriptions SET status = 'none', updated_at = now()
   WHERE status = 'trialing' AND stripe_subscription_id IS NULL AND trial_ends_at < now();
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  -- Offre accordée à la main, échue.
  UPDATE public.crm_subscriptions SET status = 'canceled', updated_at = now()
   WHERE status IN ('active', 'past_due') AND stripe_subscription_id IS NULL
     AND current_period_end IS NOT NULL AND current_period_end < now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  FOR r IN SELECT s.scope_key FROM public.crm_subscriptions s WHERE public.crm_scope_has_crm(s.scope_key) LOOP
    PERFORM public.crm_sync_scope(r.scope_key);
  END LOOP;
  RETURN jsonb_build_object('trials_ended', v_ended, 'grants_lapsed', v_lapsed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_yunits_ensure_allowance(p_scope_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.crm_subscriptions%ROWTYPE;
  cfg jsonb := public.crm_pricing_config();
  v_month_end timestamptz := (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') + interval '1 month') AT TIME ZONE 'Europe/Paris';
  v_end timestamptz;
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND OR NOT public.crm_scope_has_crm(p_scope_key) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_crm');
  END IF;

  IF s.status = 'trialing' AND s.trial_ends_at > now() THEN
    RETURN public.crm_yunits_credit(p_scope_key, 'trial', (cfg->>'trial_yunits')::int, s.trial_ends_at,
                                    'trial', 'Offerts pendant l’essai');
  END IF;

  IF s.status IN ('active', 'past_due') THEN
    IF s.stripe_subscription_id IS NOT NULL AND s.current_period_end IS NOT NULL AND s.current_period_end > now() THEN
      -- Mensuel : un lot par période payée. Annuel : un lot par mois civil,
      -- borné à la fin de la période payée.
      v_end := CASE WHEN s.billing_interval = 'year' THEN LEAST(v_month_end, s.current_period_end)
                    ELSE s.current_period_end END;
    ELSE
      -- Offre accordée à la main : un lot par mois civil, tant qu'elle court.
      IF s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
        RETURN jsonb_build_object('ok', true, 'skipped', 'expired');
      END IF;
      v_end := v_month_end;
    END IF;
    RETURN public.crm_yunits_credit(p_scope_key, 'monthly', (cfg->>'monthly_yunits')::int, v_end,
                                    'monthly:' || to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'),
                                    'Inclus dans l’abonnement');
  END IF;

  RETURN jsonb_build_object('ok', true, 'skipped', s.status);
END;
$function$;

-- La conservation EFFACE des contacts : seulement sur un compte CRM PUR. Sur un
-- compte qui a aussi la Billetterie, la base sert aux deux produits.
CREATE OR REPLACE FUNCTION public.crm_retention_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  s record;
  v_emails text[];
  v_n integer;
  v_total integer := 0;
BEGIN
  FOR s IN
    SELECT cs.scope_key, cs.venue_id, cs.organizer_user_id, cs.retention_months
      FROM public.crm_settings cs
     WHERE cs.retention_months IS NOT NULL
       AND public.crm_scope_is_crm(cs.scope_key)
  LOOP
    BEGIN
      PERFORM public._crm_activity_build(s.venue_id, s.organizer_user_id);
      SELECT COALESCE(array_agg(email), '{}') INTO v_emails
        FROM (SELECT email FROM _ca
               WHERE COALESCE(last_activity, '-infinity'::timestamptz) < now() - make_interval(months => s.retention_months)
               LIMIT 5000) q;
      v_n := public._crm_erase_contacts(s.venue_id, s.organizer_user_id, v_emails);
      INSERT INTO public.crm_retention_runs (scope_key, venue_id, organizer_user_id, retention_months, erased)
      VALUES (s.scope_key, s.venue_id, s.organizer_user_id, s.retention_months, v_n);
      v_total := v_total + v_n;
    EXCEPTION WHEN others THEN
      -- Un espace en panne ne bloque pas les autres ; l'erreur se lit dans les alertes.
      PERFORM public.emit_admin_notification(
        'admin_crm_retention_failed', 'Conservation CRM en échec', SQLERRM, 'normal',
        'crm_scope', s.scope_key, jsonb_build_object('sqlstate', SQLSTATE),
        'crm_retention_failed:' || s.scope_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
    END;
  END LOOP;
  DELETE FROM public.crm_retention_runs WHERE ran_at < now() - interval '13 months';
  RETURN v_total;
END;
$function$;

-- ── 5. L'essai CRM naît aussi quand le CRM est AJOUTÉ ───────────────────────
CREATE OR REPLACE FUNCTION public.crm_start_trial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now boolean := NEW.product = 'crm' OR 'crm' = ANY (NEW.extra_products);
  v_before boolean := TG_OP = 'UPDATE' AND (OLD.product = 'crm' OR 'crm' = ANY (OLD.extra_products));
BEGIN
  IF NOT v_now OR v_before THEN RETURN NEW; END IF;
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
$function$;

DROP TRIGGER IF EXISTS trg_crm_start_trial ON public.venues;
CREATE TRIGGER trg_crm_start_trial AFTER INSERT OR UPDATE OF product, extra_products ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.crm_start_trial();
DROP TRIGGER IF EXISTS trg_crm_start_trial ON public.organizer_profiles;
CREATE TRIGGER trg_crm_start_trial AFTER INSERT OR UPDATE OF product, extra_products ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.crm_start_trial();

-- ── 6. Journal et invitations ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_product_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key          text NOT NULL CHECK (scope_key ~ '^(venue|org):.+$'),
  venue_id           text,
  organizer_user_id  uuid,
  product            text NOT NULL CHECK (product IN ('suite', 'crm')),
  action             text NOT NULL CHECK (action IN ('added', 'invited')),
  via                text NOT NULL CHECK (via IN ('self', 'admin', 'invite')),
  actor              uuid,
  email              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_product_events_scope_idx ON public.account_product_events (scope_key, created_at DESC);
ALTER TABLE public.account_product_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_product_events FROM anon, authenticated;
COMMENT ON TABLE public.account_product_events IS
  'Produits ajoutés à un compte et invitations envoyées. RLS sans policy : lecture admin_account_products.';

CREATE TABLE IF NOT EXISTS public.account_product_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash         text NOT NULL UNIQUE,
  scope_key          text NOT NULL CHECK (scope_key ~ '^(venue|org):.+$'),
  venue_id           text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  product            text NOT NULL CHECK (product IN ('suite', 'crm')),
  email              text NOT NULL,
  invited_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at        timestamptz,
  accepted_by        uuid,
  canceled_at        timestamptz,
  CONSTRAINT account_product_invites_scope_chk CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS account_product_invites_scope_idx ON public.account_product_invites (scope_key, product);
ALTER TABLE public.account_product_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_product_invites FROM anon, authenticated;
COMMENT ON TABLE public.account_product_invites IS
  'Invitation du super admin à ouvrir l''autre produit (jeton haché, 14 jours). RLS sans policy : tout par RPC.';

-- ── 7. Ajouter un produit (porte unique, interne) ───────────────────────────
CREATE OR REPLACE FUNCTION public._account_add_product(
  p_venue_id text, p_organizer_user_id uuid, p_product text, p_via text, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_primary text;
  v_extra text[];
  v_name text;
  v_label text;
BEGIN
  IF p_product NOT IN ('suite', 'crm') OR v_scope IS NULL
     OR ((p_venue_id IS NULL) = (p_organizer_user_id IS NULL)) THEN
    RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    SELECT product, extra_products, name INTO v_primary, v_extra, v_name
      FROM public.venues WHERE id = p_venue_id FOR UPDATE;
  ELSE
    SELECT o.product, o.extra_products, COALESCE(NULLIF(o.display_name, ''), 'Organisation')
      INTO v_primary, v_extra, v_name
      FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id FOR UPDATE;
  END IF;
  IF v_primary IS NULL THEN RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_primary = p_product OR p_product = ANY (v_extra) THEN
    RETURN jsonb_build_object('ok', true, 'added', false, 'scope_key', v_scope, 'product', p_product);
  END IF;

  IF p_venue_id IS NOT NULL THEN
    UPDATE public.venues SET extra_products = array_append(extra_products, p_product) WHERE id = p_venue_id;
  ELSE
    UPDATE public.organizer_profiles SET extra_products = array_append(extra_products, p_product)
     WHERE user_id = p_organizer_user_id;
  END IF;

  INSERT INTO public.account_product_events (scope_key, venue_id, organizer_user_id, product, action, via, actor)
  VALUES (v_scope, p_venue_id, p_organizer_user_id, p_product, 'added', p_via, p_actor);

  v_label := CASE p_product WHEN 'crm' THEN 'Yuno CRM' ELSE 'Yuno Billetterie' END;
  BEGIN
    PERFORM public.emit_admin_notification(
      'admin_account_product_added',
      v_name || ' a ouvert ' || v_label,
      v_name || ' (' || CASE v_primary WHEN 'crm' THEN 'Yuno CRM' ELSE 'Yuno Billetterie' END || ') a ajouté '
        || v_label || CASE p_via WHEN 'admin' THEN ' (ouvert par un admin).' WHEN 'invite' THEN ' sur invitation.' ELSE '.' END,
      'normal', 'account', v_scope,
      jsonb_build_object('venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                         'product', p_product, 'primary', v_primary, 'via', p_via),
      'account_product_added:' || v_scope || ':' || p_product, NULL);
  EXCEPTION WHEN others THEN NULL;  -- une alerte ne fait jamais échouer l'ouverture
  END;

  RETURN jsonb_build_object('ok', true, 'added', true, 'scope_key', v_scope, 'product', p_product);
END;
$function$;
REVOKE ALL ON FUNCTION public._account_add_product(text, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._account_add_product(text, uuid, text, text, uuid) TO service_role;

-- ── 8. Côté pro : mes comptes, ouvrir l'autre produit ───────────────────────
-- Les comptes dont la personne est TITULAIRE (club possédé, organisation
-- fondée) : seuls eux peuvent ajouter un produit, qui engage un abonnement.
CREATE OR REPLACE FUNCTION public.get_my_product_accounts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(a ORDER BY a->>'kind' DESC, a->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'kind', 'venue', 'venue_id', v.id, 'organizer_user_id', NULL,
             'name', v.name, 'city', v.city,
             'product', v.product, 'products', ARRAY[v.product] || v.extra_products) AS a
      FROM public.venues v
     WHERE auth.uid() IS NOT NULL AND v.owner_id = auth.uid()
    UNION ALL
    SELECT jsonb_build_object(
             'kind', 'org', 'venue_id', NULL, 'organizer_user_id', o.user_id,
             'name', COALESCE(NULLIF(o.display_name, ''), 'Organisation'), 'city', o.city,
             'product', o.product, 'products', ARRAY[o.product] || o.extra_products)
      FROM public.organizer_profiles o
     WHERE auth.uid() IS NOT NULL AND o.user_id = auth.uid()
  ) q;
$function$;
REVOKE ALL ON FUNCTION public.get_my_product_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_product_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.open_product_on_my_account(
  p_product text, p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_signup_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  -- Ouvrir un produit engage un abonnement : jamais depuis un accès assisté.
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501'; END IF;
  IF public.is_demo_email((SELECT email FROM auth.users WHERE id = v_uid)) THEN
    RAISE EXCEPTION 'demo_account' USING ERRCODE = '42501';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
      RAISE EXCEPTION 'not_account_owner' USING ERRCODE = '42501';
    END IF;
  ELSIF p_organizer_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_account_owner' USING ERRCODE = '42501';
  END IF;

  v_res := public._account_add_product(p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END,
                                       p_product, 'self', v_uid);

  -- Le parcours d'inscription qui a mené ici aboutit sur ce compte.
  IF p_signup_key IS NOT NULL THEN
    UPDATE public.pro_signups
       SET user_id = COALESCE(user_id, v_uid),
           venue_id = COALESCE(venue_id, p_venue_id),
           account_created_at = COALESCE(account_created_at, now()),
           product = p_product,
           updated_at = now()
     WHERE client_key = p_signup_key AND (user_id IS NULL OR user_id = v_uid);
  END IF;
  RETURN v_res;
END;
$function$;
REVOKE ALL ON FUNCTION public.open_product_on_my_account(text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_product_on_my_account(text, text, uuid, text) TO authenticated;

-- ── 9. Invitation du super admin ────────────────────────────────────────────
-- Appelée par l'edge admin-account-recovery (action invite-product) avec le
-- JWT du super admin : l'edge tire le jeton, n'envoie ici que son empreinte, et
-- reçoit l'adresse du titulaire pour l'email.
CREATE OR REPLACE FUNCTION public.admin_create_product_invite(
  p_venue_id text, p_organizer_user_id uuid, p_product text, p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_owner uuid;
  v_name text;
  v_email text;
  v_lang text;
  v_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_product NOT IN ('suite', 'crm') OR v_scope IS NULL OR coalesce(length(p_token_hash), 0) < 32 THEN
    RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023';
  END IF;
  IF p_product = ANY (public.account_products(v_scope)) THEN
    RAISE EXCEPTION 'already_has_product' USING ERRCODE = 'P0001';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    SELECT owner_id, name INTO v_owner, v_name FROM public.venues WHERE id = p_venue_id;
  ELSE
    SELECT user_id, COALESCE(NULLIF(display_name, ''), 'Organisation') INTO v_owner, v_name
      FROM public.organizer_profiles WHERE user_id = p_organizer_user_id;
  END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT u.email, p.preferred_language INTO v_email, v_lang
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = v_owner;
  IF v_email IS NULL THEN RAISE EXCEPTION 'owner_without_email' USING ERRCODE = 'P0002'; END IF;
  IF public.is_demo_email(v_email) THEN RAISE EXCEPTION 'demo_account' USING ERRCODE = '42501'; END IF;

  -- Une seule invitation ouverte par compte et par produit.
  UPDATE public.account_product_invites SET canceled_at = now()
   WHERE scope_key = v_scope AND product = p_product AND accepted_at IS NULL AND canceled_at IS NULL;

  INSERT INTO public.account_product_invites (token_hash, scope_key, venue_id, organizer_user_id, product, email, invited_by)
  VALUES (p_token_hash, v_scope, p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END,
          p_product, v_email, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.account_product_events (scope_key, venue_id, organizer_user_id, product, action, via, actor, email)
  VALUES (v_scope, p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END,
          p_product, 'invited', 'admin', auth.uid(), v_email);

  RETURN jsonb_build_object('ok', true, 'invite_id', v_id, 'email', v_email, 'name', v_name,
                            'lang', COALESCE(v_lang, 'fr'), 'kind', CASE WHEN p_venue_id IS NULL THEN 'org' ELSE 'venue' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_create_product_invite(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_product_invite(text, uuid, text, text) TO authenticated;

-- Ouvrir directement, sans email (le client l'a demandé de vive voix).
CREATE OR REPLACE FUNCTION public.admin_add_account_product(p_venue_id text, p_organizer_user_id uuid, p_product text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN public._account_add_product(p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END,
                                     p_product, 'admin', auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_add_account_product(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_account_product(text, uuid, text) TO authenticated;

-- La page /open/:product?token= : que dit l'invitation ? (lisible avant connexion)
CREATE OR REPLACE FUNCTION public.get_product_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  i public.account_product_invites%ROWTYPE;
  v_name text;
  v_owner uuid;
  v_status text;
BEGIN
  IF coalesce(length(p_token), 0) < 20 THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  SELECT * INTO i FROM public.account_product_invites
   WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF i.venue_id IS NOT NULL THEN
    SELECT name, owner_id INTO v_name, v_owner FROM public.venues WHERE id = i.venue_id;
  ELSE
    SELECT COALESCE(NULLIF(display_name, ''), 'Organisation'), user_id INTO v_name, v_owner
      FROM public.organizer_profiles WHERE user_id = i.organizer_user_id;
  END IF;

  v_status := CASE
    WHEN i.accepted_at IS NOT NULL OR i.product = ANY (public.account_products(i.scope_key)) THEN 'accepted'
    WHEN i.canceled_at IS NOT NULL THEN 'canceled'
    WHEN i.expires_at < now() THEN 'expired'
    ELSE 'open' END;

  RETURN jsonb_build_object(
    'status', v_status,
    'product', i.product,
    'kind', CASE WHEN i.venue_id IS NULL THEN 'org' ELSE 'venue' END,
    'name', v_name,
    -- L'adresse n'est montrée en clair qu'au titulaire ; aux autres, masquée.
    'email', CASE WHEN auth.uid() = v_owner THEN i.email
                  ELSE regexp_replace(i.email, '^(.).*(@.*)$', '\1•••\2') END,
    'is_owner', auth.uid() IS NOT NULL AND auth.uid() = v_owner);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_product_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_invite(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_product_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  i public.account_product_invites%ROWTYPE;
  v_owner uuid;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.account_product_invites
   WHERE token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;
  IF i.canceled_at IS NOT NULL THEN RAISE EXCEPTION 'invite_canceled' USING ERRCODE = 'P0001'; END IF;
  IF i.accepted_at IS NULL AND i.expires_at < now() THEN RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001'; END IF;

  IF i.venue_id IS NOT NULL THEN
    SELECT owner_id INTO v_owner FROM public.venues WHERE id = i.venue_id;
  ELSE
    v_owner := i.organizer_user_id;
  END IF;
  -- Seul le titulaire du compte invité l'ouvre : c'est lui qui s'abonne.
  IF v_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_account_owner' USING ERRCODE = '42501'; END IF;

  v_res := public._account_add_product(i.venue_id, i.organizer_user_id, i.product, 'invite', v_uid);
  UPDATE public.account_product_invites SET accepted_at = COALESCE(accepted_at, now()), accepted_by = COALESCE(accepted_by, v_uid)
   WHERE id = i.id;
  RETURN v_res || jsonb_build_object('kind', CASE WHEN i.venue_id IS NULL THEN 'org' ELSE 'venue' END,
                                     'venue_id', i.venue_id, 'organizer_user_id', i.organizer_user_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_product_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_product_invite(text) TO authenticated;

-- Le super admin lit les produits et l'historique d'un ou de tous les comptes.
CREATE OR REPLACE FUNCTION public.admin_account_products(p_scope_keys text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_key', e.scope_key, 'product', e.product, 'action', e.action,
                                          'via', e.via, 'email', e.email, 'created_at', e.created_at)
                       ORDER BY e.created_at DESC)
        FROM public.account_product_events e
       WHERE p_scope_keys IS NULL OR e.scope_key = ANY (p_scope_keys)), '[]'::jsonb),
    'open_invites', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_key', i.scope_key, 'product', i.product, 'email', i.email,
                                          'created_at', i.created_at, 'expires_at', i.expires_at))
        FROM public.account_product_invites i
       WHERE i.accepted_at IS NULL AND i.canceled_at IS NULL AND i.expires_at > now()
         AND (p_scope_keys IS NULL OR i.scope_key = ANY (p_scope_keys))), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_account_products(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_products(text[]) TO authenticated;
