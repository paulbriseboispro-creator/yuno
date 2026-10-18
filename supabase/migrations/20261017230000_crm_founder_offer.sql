-- Yuno CRM — l'offre fondateurs (décision de Paul, 17/10/2026, après le premier
-- appel commercial : 3AM).
--
-- Les 5 premiers comptes CHOISIS par le super admin reçoivent :
--   • 6 mois d'abonnement offerts, à partir de l'ouverture du compte ;
--   • 15 000 Yunits offerts à l'ouverture (valables 12 mois), qui REMPLACENT les
--     2 000 de l'essai et les 10 000 de l'abonnement mensuel (rien ne s'ajoute
--     quand le compte commence à payer ; le bonus annuel reste celui de tout le
--     monde) ;
--   • ensuite le prix de lancement (24 € HT / mois), garanti (founder = true).
-- Rien à voir avec le prix de lancement des 50 premiers comptes payants qui
-- s'inscrivent seuls (crm_price_tier, price_switch_at) : un compte fondateur ne
-- paie pas pendant 6 mois, crm_paying_accounts ne le compte donc pas.
--
-- Le parcours :
--   1. Admin CRM › Vente › Offre fondateurs : le super admin crée une invitation
--      (crm_admin_offer_invite_create). 5 places : une invitation en attente et
--      non expirée RÉSERVE une place, un compte ouvert l'OCCUPE ; révoquer ou
--      laisser expirer la rend.
--   2. Le lien https://crm.yunoapp.eu/<langue>/start?offer=<jeton> part par
--      e-mail (edge admin-account-recovery, action crm-founder-offer-email) ou
--      par WhatsApp (lien wa.me préparé par l'écran admin).
--   3. Le parcours d'inscription de la landing lit l'invitation
--      (crm_offer_invite_preview), la garde sur le brouillon (track_pro_signup,
--      clé `offer`), et l'ouverture du compte (complete_pro_signup, ou
--      open_product_on_my_account pour un compte Yuno existant) l'APPLIQUE côté
--      serveur (_crm_offer_apply) : aucune étape du navigateur n'est nécessaire,
--      le lien de confirmation e-mail compris.
--   4. Dans Yuno, la période offerte est un essai qui dure 6 mois
--      (status = 'trialing', trial_ends_at = offer_until) : tout ce qui sait lire
--      un essai suit sans changement (accès, mise en pause à la fin par
--      crm_billing_sweep). Chez Stripe, c'est la période gratuite NATIVE : quand
--      le titulaire enregistre sa carte (crm_checkout), l'abonnement au prix de
--      lancement naît avec trial_end = offer_until, et Stripe facture seul le
--      premier mois payant à cette date. Sans carte, rien n'est prélevé : le
--      compte passe en pause à la fin, comme un essai.

-- ── Invitations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_offer_invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token          text NOT NULL UNIQUE,
  offer          text NOT NULL DEFAULT 'founder' CHECK (offer = 'founder'),
  org_name       text NOT NULL CHECK (length(trim(org_name)) BETWEEN 1 AND 120),
  contact_name   text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  email          text CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone          text CHECK (phone IS NULL OR length(phone) <= 40),
  lang           text NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'en', 'es')),
  note           text CHECK (note IS NULL OR length(note) <= 500),
  free_months    integer NOT NULL CHECK (free_months BETWEEN 1 AND 24),
  yunits         integer NOT NULL CHECK (yunits BETWEEN 0 AND 100000),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'revoked')),
  expires_at     timestamptz NOT NULL,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  emailed_at     timestamptz,
  email_count    integer NOT NULL DEFAULT 0,
  shared_at      timestamptz,
  opened_at      timestamptz,
  claimed_at     timestamptz,
  claimed_by     uuid,
  scope_key      text,
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoked_reason text
);
CREATE INDEX IF NOT EXISTS crm_offer_invites_status_idx ON public.crm_offer_invites (offer, status);
-- RLS sans policy : tout passe par les fonctions ci-dessous.
ALTER TABLE public.crm_offer_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_offer_invites FROM anon, authenticated;

-- L'offre portée par l'abonnement CRM du compte (une fois posée, elle reste :
-- c'est l'historique de ce que le compte a reçu).
ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS offer text CHECK (offer IS NULL OR offer = 'founder'),
  ADD COLUMN IF NOT EXISTS offer_invite_id uuid REFERENCES public.crm_offer_invites (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_until timestamptz;

-- Le brouillon d'inscription retient l'invitation (le parcours peut partir chez
-- Google / Apple ou attendre la confirmation de l'e-mail).
ALTER TABLE public.pro_signups
  ADD COLUMN IF NOT EXISTS offer_invite_id uuid REFERENCES public.crm_offer_invites (id) ON DELETE SET NULL;

-- ── Réglages de l'offre (une seule définition) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_founder_offer_config()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT jsonb_build_object('seats', 5, 'free_months', 6, 'yunits', 15000, 'link_days', 30, 'yunits_valid_months', 12);
$function$;
REVOKE ALL ON FUNCTION public.crm_founder_offer_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_founder_offer_config() TO authenticated, service_role;

-- Le lien que reçoit le prospect (page d'inscription de crm.yunoapp.eu, dans sa langue).
CREATE OR REPLACE FUNCTION public.crm_offer_invite_url(p_token text, p_lang text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT 'https://crm.yunoapp.eu' || CASE p_lang WHEN 'fr' THEN '/fr/start' WHEN 'es' THEN '/es/start' ELSE '/start' END
         || '?offer=' || p_token;
$function$;
REVOKE ALL ON FUNCTION public.crm_offer_invite_url(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_offer_invite_url(text, text) TO service_role;

-- Statut lisible : une invitation en attente dont le lien a expiré est « expired ».
CREATE OR REPLACE FUNCTION public._crm_offer_invite_state(i public.crm_offer_invites)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END;
$function$;
REVOKE ALL ON FUNCTION public._crm_offer_invite_state(public.crm_offer_invites) FROM PUBLIC, anon, authenticated;

-- Places prises : comptes ouverts + invitations encore valables.
CREATE OR REPLACE FUNCTION public._crm_offer_seats_taken(p_except uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::int FROM public.crm_offer_invites i
   WHERE i.offer = 'founder'
     AND (p_except IS NULL OR i.id <> p_except)
     AND (i.status = 'claimed' OR (i.status = 'pending' AND i.expires_at > now()));
$function$;
REVOKE ALL ON FUNCTION public._crm_offer_seats_taken(uuid) FROM PUBLIC, anon, authenticated;

-- Une ligne d'invitation pour l'admin (lien compris, jamais exposé ailleurs).
CREATE OR REPLACE FUNCTION public._crm_offer_invite_json(i public.crm_offer_invites)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', i.id, 'url', public.crm_offer_invite_url(i.token, i.lang), 'org_name', i.org_name,
    'contact_name', i.contact_name, 'email', i.email, 'phone', i.phone, 'lang', i.lang, 'note', i.note,
    'free_months', i.free_months, 'yunits', i.yunits, 'status', public._crm_offer_invite_state(i),
    'expires_at', i.expires_at, 'created_at', i.created_at, 'emailed_at', i.emailed_at,
    'email_count', i.email_count, 'shared_at', i.shared_at, 'opened_at', i.opened_at,
    'claimed_at', i.claimed_at, 'scope_key', i.scope_key, 'revoked_at', i.revoked_at,
    'revoked_reason', i.revoked_reason,
    'account', CASE WHEN i.scope_key IS NULL THEN NULL ELSE (
      SELECT jsonb_build_object(
        'name', COALESCE((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = i.scope_key),
                         (SELECT NULLIF(o.display_name, '') FROM public.organizer_profiles o WHERE 'org:' || o.user_id::text = i.scope_key)),
        'offer_until', s.offer_until, 'status', s.status, 'has_stripe', s.stripe_subscription_id IS NOT NULL,
        'yunits_balance', public.crm_yunits_balance(i.scope_key))
      FROM public.crm_subscriptions s WHERE s.scope_key = i.scope_key) END);
$function$;
REVOKE ALL ON FUNCTION public._crm_offer_invite_json(public.crm_offer_invites) FROM PUBLIC, anon, authenticated;

-- ── Admin CRM : lire, créer, corriger, révoquer, noter le partage ──────────
CREATE OR REPLACE FUNCTION public.crm_admin_offer_invites()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  v_claimed integer;
  v_pending integer;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT count(*) FILTER (WHERE status = 'claimed'),
         count(*) FILTER (WHERE status = 'pending' AND expires_at > now())
    INTO v_claimed, v_pending
    FROM public.crm_offer_invites WHERE offer = 'founder';
  RETURN jsonb_build_object(
    'config', cfg,
    'price_month', (public.crm_pricing_config()->>'price_month')::numeric,
    'seats', jsonb_build_object('total', (cfg->>'seats')::int, 'claimed', v_claimed, 'pending', v_pending,
                                'left', GREATEST(0, (cfg->>'seats')::int - v_claimed - v_pending)),
    'invites', COALESCE((SELECT jsonb_agg(public._crm_offer_invite_json(i) ORDER BY i.created_at DESC)
                           FROM public.crm_offer_invites i WHERE i.offer = 'founder'), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_offer_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_offer_invites() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_offer_invite_create(
  p_org_name text, p_contact_name text DEFAULT NULL, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_lang text DEFAULT 'fr', p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  v_name text := left(regexp_replace(trim(COALESCE(p_org_name, '')), '\s+', ' ', 'g'), 120);
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  v_phone text := left(NULLIF(trim(COALESCE(p_phone, '')), ''), 40);
  v_lang text := CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END;
  v_row public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  IF v_name = '' THEN RAISE EXCEPTION 'org_name_required' USING ERRCODE = '22023'; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
  END IF;
  -- Une place à la fois : deux créations simultanées ne dépassent pas le plafond.
  PERFORM pg_advisory_xact_lock(hashtext('crm_founder_offer_seats'));
  IF public._crm_offer_seats_taken() >= (cfg->>'seats')::int THEN
    RAISE EXCEPTION 'offer_full' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.crm_offer_invites (token, org_name, contact_name, email, phone, lang, note,
                                        free_months, yunits, expires_at, created_by)
  VALUES (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
          v_name, left(NULLIF(trim(COALESCE(p_contact_name, '')), ''), 120), v_email, v_phone, v_lang,
          left(NULLIF(trim(COALESCE(p_note, '')), ''), 500),
          (cfg->>'free_months')::int, (cfg->>'yunits')::int,
          now() + make_interval(days => (cfg->>'link_days')::int), auth.uid())
  RETURNING * INTO v_row;
  -- Journal de l'admin (la clé serveur, sans personne derrière, n'y écrit pas).
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'crm_offer_invite_create', 'crm_offer_invite', v_row.id::text,
            jsonb_build_object('org_name', v_row.org_name, 'email', v_row.email, 'offer', v_row.offer));
  END IF;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_offer_invite_create(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_offer_invite_create(text, text, text, text, text, text) TO authenticated, service_role;

-- Corriger le contact (adresse oubliée, numéro WhatsApp…) tant que le lien n'a pas servi.
CREATE OR REPLACE FUNCTION public.crm_admin_offer_invite_update(p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
  v_email text;
BEGIN
  PERFORM public._crm_admin_gate();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001'; END IF;
  IF p_patch ? 'email' THEN
    v_email := lower(NULLIF(trim(COALESCE(p_patch->>'email', '')), ''));
    IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
      RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.crm_offer_invites SET
    org_name = CASE WHEN p_patch ? 'org_name' AND length(trim(COALESCE(p_patch->>'org_name', ''))) > 0
                    THEN left(regexp_replace(trim(p_patch->>'org_name'), '\s+', ' ', 'g'), 120) ELSE org_name END,
    contact_name = CASE WHEN p_patch ? 'contact_name' THEN left(NULLIF(trim(COALESCE(p_patch->>'contact_name', '')), ''), 120) ELSE contact_name END,
    email = CASE WHEN p_patch ? 'email' THEN v_email ELSE email END,
    phone = CASE WHEN p_patch ? 'phone' THEN left(NULLIF(trim(COALESCE(p_patch->>'phone', '')), ''), 40) ELSE phone END,
    lang = CASE WHEN p_patch->>'lang' IN ('fr', 'en', 'es') THEN p_patch->>'lang' ELSE lang END,
    note = CASE WHEN p_patch ? 'note' THEN left(NULLIF(trim(COALESCE(p_patch->>'note', '')), ''), 500) ELSE note END
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_offer_invite_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_offer_invite_update(uuid, jsonb) TO authenticated, service_role;

-- Révoquer rend la place (le lien n'ouvre plus rien).
CREATE OR REPLACE FUNCTION public.crm_admin_offer_invite_revoke(p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_offer_invites
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revoked_reason = left(trim(p_reason), 300)
   WHERE id = p_id AND status = 'pending'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001'; END IF;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'crm_offer_invite_revoke', 'crm_offer_invite', v_row.id::text,
            jsonb_build_object('org_name', v_row.org_name, 'reason', v_row.revoked_reason));
  END IF;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_offer_invite_revoke(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_offer_invite_revoke(uuid, text) TO authenticated, service_role;

-- « Envoyé » : par e-mail (l'edge, après un envoi réussi) ou partagé (WhatsApp, lien copié).
CREATE OR REPLACE FUNCTION public.crm_admin_offer_invite_mark(p_id uuid, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  IF p_channel NOT IN ('email', 'whatsapp', 'copy') THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_offer_invites SET
    emailed_at = CASE WHEN p_channel = 'email' THEN now() ELSE emailed_at END,
    email_count = email_count + CASE WHEN p_channel = 'email' THEN 1 ELSE 0 END,
    shared_at = CASE WHEN p_channel <> 'email' THEN now() ELSE shared_at END
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_offer_invite_mark(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_offer_invite_mark(uuid, text) TO authenticated, service_role;

-- Ce que l'edge met dans l'e-mail (service_role seul : le lien ne sort que là).
CREATE OR REPLACE FUNCTION public.crm_offer_invite_for_email(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF public._crm_offer_invite_state(v_row) <> 'pending' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001'; END IF;
  IF v_row.email IS NULL THEN RAISE EXCEPTION 'no_email' USING ERRCODE = '22023'; END IF;
  RETURN public._crm_offer_invite_json(v_row)
    || jsonb_build_object('price_month', (public.crm_pricing_config()->>'price_month')::numeric);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_offer_invite_for_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_offer_invite_for_email(uuid) TO authenticated, service_role;

-- ── Lecture publique d'une invitation (page d'inscription) ─────────────────
-- Le jeton (64 caractères aléatoires) EST l'accès : on ne rend que ce qu'il faut
-- pour accueillir la personne. Première ouverture horodatée pour l'admin.
CREATE OR REPLACE FUNCTION public.crm_offer_invite_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
  v_state text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{20,80}$' THEN
    RETURN jsonb_build_object('status', 'unknown');
  END IF;
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  v_state := public._crm_offer_invite_state(v_row);
  IF v_state = 'pending' AND v_row.opened_at IS NULL THEN
    UPDATE public.crm_offer_invites SET opened_at = now() WHERE id = v_row.id;
  END IF;
  IF v_state <> 'pending' THEN RETURN jsonb_build_object('status', v_state); END IF;
  RETURN jsonb_build_object(
    'status', 'ok', 'offer', v_row.offer, 'org_name', v_row.org_name,
    'first_name', NULLIF(split_part(COALESCE(v_row.contact_name, ''), ' ', 1), ''),
    'email', v_row.email, 'lang', v_row.lang,
    'free_months', v_row.free_months, 'yunits', v_row.yunits,
    'price_month', (public.crm_pricing_config()->>'price_month')::numeric,
    'expires_at', v_row.expires_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_offer_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_offer_invite_preview(text) TO anon, authenticated, service_role;

-- ── Appliquer l'offre à un compte CRM (interne) ────────────────────────────
-- Appelée par complete_pro_signup, open_product_on_my_account et
-- crm_offer_claim, dans la transaction qui ouvre (ou montre) le compte.
-- Ne lève jamais : rend {ok:false, reason} et l'ouverture du compte continue.
CREATE OR REPLACE FUNCTION public._crm_offer_apply(p_invite uuid, p_scope text, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  v_inv public.crm_offer_invites%ROWTYPE;
  v_sub public.crm_subscriptions%ROWTYPE;
  v_until timestamptz;
  v_parts record;
  v_name text;
BEGIN
  IF p_invite IS NULL OR p_scope IS NULL OR p_scope !~ '^(venue|org):.+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_founder_offer_seats'));
  SELECT * INTO v_inv FROM public.crm_offer_invites WHERE id = p_invite FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown'); END IF;
  -- Déjà appliquée à CE compte (deuxième passage du même parcours) : même réponse.
  IF v_inv.status = 'claimed' AND v_inv.scope_key = p_scope THEN
    SELECT * INTO v_sub FROM public.crm_subscriptions WHERE scope_key = p_scope;
    RETURN jsonb_build_object('ok', true, 'already', true, 'offer', v_inv.offer, 'until', v_sub.offer_until,
                              'free_months', v_inv.free_months, 'yunits', v_inv.yunits);
  END IF;
  IF public._crm_offer_invite_state(v_inv) <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', public._crm_offer_invite_state(v_inv));
  END IF;
  IF public._crm_offer_seats_taken(v_inv.id) >= (cfg->>'seats')::int THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_full');
  END IF;
  IF NOT public.crm_scope_has_crm(p_scope) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_crm');
  END IF;

  SELECT * INTO v_sub FROM public.crm_subscriptions WHERE scope_key = p_scope FOR UPDATE;
  IF FOUND AND v_sub.offer IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_has_offer');
  END IF;
  -- Un compte qui paie déjà chez Stripe ne change pas de contrat par un lien.
  IF FOUND AND v_sub.stripe_subscription_id IS NOT NULL AND v_sub.status IN ('trialing', 'active', 'past_due') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'has_stripe');
  END IF;

  v_until := now() + make_interval(months => v_inv.free_months);
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope);
  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, trial_ends_at,
                                             founder, offer, offer_invite_id, offer_until, granted_by)
  VALUES (p_scope, v_parts.venue_id, v_parts.organizer_user_id, 'base', 'trialing', v_until,
          true, v_inv.offer, v_inv.id, v_until, v_inv.created_by)
  ON CONFLICT (scope_key) DO UPDATE SET
    plan = 'base', status = 'trialing', trial_ends_at = v_until, current_period_end = NULL,
    cancel_at_period_end = false, founder = true, offer = EXCLUDED.offer,
    offer_invite_id = EXCLUDED.offer_invite_id, offer_until = v_until,
    granted_by = EXCLUDED.granted_by, updated_at = now();

  -- L'essai standard crédite ses Yunits dès l'ouverture (trg_crm_subscription_allowance) :
  -- un lot d'essai jamais entamé est REMPLACÉ par ceux de l'offre (lot et ligne
  -- d'historique retirés, il n'a jamais servi). Un lot déjà entamé reste.
  WITH gone AS (
    DELETE FROM public.crm_yunit_lots l
     WHERE l.scope_key = p_scope AND l.kind = 'trial' AND l.remaining = l.amount
    RETURNING l.id)
  DELETE FROM public.crm_yunit_moves m USING gone
   WHERE m.scope_key = p_scope AND m.kind = 'credit' AND m.ref_type = 'lot' AND m.ref_id = gone.id::text;

  IF v_inv.yunits > 0 THEN
    PERFORM public.crm_yunits_credit(
      p_scope, 'grant', v_inv.yunits,
      now() + make_interval(months => COALESCE((cfg->>'yunits_valid_months')::int, 12)),
      'founder_offer', 'Offre fondateur', jsonb_build_object('invite_id', v_inv.id));
  END IF;

  UPDATE public.crm_offer_invites
     SET status = 'claimed', claimed_at = now(), claimed_by = p_uid, scope_key = p_scope
   WHERE id = v_inv.id;
  PERFORM public.crm_sync_scope(p_scope);

  v_name := COALESCE((SELECT v.name FROM public.venues v WHERE v.id = v_parts.venue_id),
                     (SELECT NULLIF(o.display_name, '') FROM public.organizer_profiles o WHERE o.user_id = v_parts.organizer_user_id),
                     v_inv.org_name);
  BEGIN
    PERFORM public.emit_admin_notification(
      'admin_crm_offer_claimed',
      'Offre fondateur activée',
      v_name || ' a ouvert son compte Yuno CRM : ' || v_inv.free_months || ' mois offerts (jusqu''au '
        || to_char(v_until AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY') || ') et '
        || replace(to_char(v_inv.yunits, 'FM999,999'), ',', ' ') || ' Yunits. Places prises : '
        || public._crm_offer_seats_taken() || ' / ' || (cfg->>'seats') || '.',
      'high', 'crm_account', p_scope,
      jsonb_build_object('invite_id', v_inv.id, 'scope_key', p_scope, 'org_name', v_name,
                         'offer_until', v_until, 'yunits', v_inv.yunits),
      'crm_offer_claimed:' || v_inv.id::text, NULL);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'offer', v_inv.offer, 'until', v_until,
                            'free_months', v_inv.free_months, 'yunits', v_inv.yunits);
EXCEPTION WHEN OTHERS THEN
  -- L'offre ne doit jamais faire échouer l'ouverture d'un compte.
  RETURN jsonb_build_object('ok', false, 'reason', 'error', 'detail', left(SQLERRM, 200));
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_offer_apply(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_offer_apply(uuid, text, uuid) TO service_role;

-- Un titulaire déjà connecté réclame l'offre sur SON compte CRM (compte Yuno
-- existant ouvert par /open/crm?offer=…).
CREATE OR REPLACE FUNCTION public.crm_offer_claim(p_token text, p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501'; END IF;
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
      RAISE EXCEPTION 'not_account_owner' USING ERRCODE = '42501';
    END IF;
  ELSIF p_organizer_user_id <> v_uid THEN
    RAISE EXCEPTION 'not_account_owner' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM public.crm_offer_invites WHERE token = p_token;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown'); END IF;
  RETURN public._crm_offer_apply(v_id, public.crm_scope_key(p_venue_id, p_organizer_user_id), v_uid);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_offer_claim(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_offer_claim(text, text, uuid) TO authenticated, service_role;

-- ── Fonctions existantes, reprises de la base liée ─────────────────────────

CREATE OR REPLACE FUNCTION public.track_pro_signup(p_key text, p_step text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx      record;
  v_row      public.pro_signups%ROWTYPE;
  v_recent   integer;
  v_d        jsonb := CASE WHEN jsonb_typeof(p_data) = 'object' AND length(p_data::text) <= 4000
                           THEN p_data ELSE '{}'::jsonb END;
  v_kind     text := lower(nullif(trim(coalesce(v_d->>'kind', '')), ''));
  v_email    text := lower(nullif(trim(coalesce(v_d->>'email', '')), ''));
  v_product  text := lower(nullif(trim(coalesce(v_d->>'product', '')), ''));
  v_pillars  text[];
  v_offer    uuid;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN; END IF;
  IF p_step NOT IN ('opened','role','structure','account','lead') THEN RETURN; END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('club','organizer','promoter','other') THEN v_kind := NULL; END IF;
  IF v_product IS NOT NULL AND v_product NOT IN ('suite','crm') THEN v_product := NULL; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    v_email := NULL;
  END IF;

  -- Offre fondateurs : une invitation valable suit le parcours (20261017230000).
  IF nullif(v_d->>'offer', '') IS NOT NULL THEN
    SELECT i.id INTO v_offer FROM public.crm_offer_invites i
     WHERE i.token = v_d->>'offer' AND i.status = 'pending' AND i.expires_at > now();
  END IF;

  IF jsonb_typeof(v_d->'pillars') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_pillars
      FROM jsonb_array_elements_text(v_d->'pillars') x
     WHERE x IN ('tickets','guest_list','tables','drinks');
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_ctx FROM public.links_visitor_context();
    -- Anti-flood : 20 parcours neufs par visiteur et par heure.
    SELECT count(*) INTO v_recent FROM public.pro_signups
     WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour';
    IF v_recent >= 20 THEN RETURN; END IF;

    INSERT INTO public.pro_signups (client_key, visitor_hash, device, geo_country)
    VALUES (p_key, v_ctx.o_hash, v_ctx.o_device, v_ctx.o_country)
    RETURNING * INTO v_row;
  END IF;

  -- Un parcours qui a déjà produit un compte ne s'écrit plus anonymement.
  IF v_row.user_id IS NOT NULL THEN RETURN; END IF;

  UPDATE public.pro_signups SET
    updated_at    = now(),
    kind          = coalesce(v_kind, kind),
    product       = coalesce(v_product, product),
    lang          = coalesce(lower(left(nullif(v_d->>'lang', ''), 2)), lang),
    first_name    = coalesce(left(nullif(trim(v_d->>'first_name'), ''), 80), first_name),
    last_name     = coalesce(left(nullif(trim(v_d->>'last_name'), ''), 80), last_name),
    email         = coalesce(v_email, email),
    phone         = coalesce(left(nullif(trim(v_d->>'phone'), ''), 40), phone),
    org_name      = coalesce(left(nullif(regexp_replace(trim(v_d->>'org_name'), '\s+', ' ', 'g'), ''), 120), org_name),
    city          = coalesce(left(nullif(trim(v_d->>'city'), ''), 120), city),
    country       = coalesce(upper(left(nullif(trim(v_d->>'country'), ''), 2)), country),
    size_band     = coalesce(left(nullif(v_d->>'size_band', ''), 20), size_band),
    frequency     = coalesce(left(nullif(v_d->>'frequency', ''), 20), frequency),
    pillars       = coalesce(v_pillars, pillars),
    current_tool  = coalesce(left(nullif(v_d->>'current_tool', ''), 40), current_tool),
    next_night    = coalesce(left(nullif(v_d->>'next_night', ''), 20), next_night),
    source        = coalesce(source, left(nullif(v_d->>'source', ''), 60)),
    utm_source    = coalesce(utm_source, left(nullif(v_d->>'utm_source', ''), 120)),
    utm_medium    = coalesce(utm_medium, left(nullif(v_d->>'utm_medium', ''), 120)),
    utm_campaign  = coalesce(utm_campaign, left(nullif(v_d->>'utm_campaign', ''), 120)),
    referrer_host = coalesce(referrer_host, left(nullif(v_d->>'referrer_host', ''), 120)),
    offer_invite_id = coalesce(v_offer, offer_invite_id),
    steps         = CASE WHEN steps ? p_step THEN steps
                         ELSE steps || jsonb_build_object(p_step, now()) END,
    last_step     = p_step
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Promoteur / autre : pas de compte en libre-service, c'est un lead chaud.
  IF p_step = 'lead' AND v_row.email IS NOT NULL AND NOT public.is_demo_email(v_row.email) THEN
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_pro_signup_lead',
        'Nouveau lead pro (landing)',
        coalesce(nullif(trim(coalesce(v_row.first_name, '') || ' ' || coalesce(v_row.last_name, '')), ''), v_row.email)
          || coalesce(' — ' || v_row.org_name, '') || coalesce(' (' || v_row.city || ')', '')
          || ' · ' || coalesce(v_row.kind, 'other') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'email', v_row.email, 'phone', v_row.phone,
                           'org_name', v_row.org_name, 'city', v_row.city, 'lang', v_row.lang),
        'pro_signup_lead:' || v_row.id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.complete_pro_signup(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_row       public.pro_signups%ROWTYPE;
  v_email     text;
  v_venue     text;
  v_created   boolean := false;
  v_name      text;
  v_city      text;
  v_pillars   text[];
  v_who       text;
  v_n         integer;
  v_crm       boolean;
  v_offer     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Une session d'accès assisté n'ouvre jamais de compte pour quelqu'un.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_signup' USING ERRCODE = '22023';
  END IF;
  IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
    RAISE EXCEPTION 'already_used' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind NOT IN ('club','organizer') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;

  v_crm := coalesce(v_row.product, 'suite') = 'crm';
  v_name := nullif(trim(coalesce(v_row.org_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'org_name_required' USING ERRCODE = '22023';
  END IF;
  v_city := coalesce(nullif(trim(coalesce(v_row.city, '')), ''), '');
  v_pillars := CASE WHEN v_crm THEN '{}'::text[] ELSE coalesce(v_row.pillars, '{}') END;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Identité de la personne : seulement ce qui manque (jamais écraser).
  UPDATE public.profiles SET
    first_name = coalesce(nullif(first_name, ''), v_row.first_name),
    last_name  = coalesce(nullif(last_name, ''), v_row.last_name),
    phone      = coalesce(nullif(phone, ''), v_row.phone),
    city       = coalesce(nullif(city, ''), nullif(v_city, ''))
  WHERE id = v_uid;

  IF v_row.kind = 'club' THEN
    -- Un owner = un club (OwnerVenueContext lit par owner_id en maybeSingle).
    SELECT id INTO v_venue FROM public.venues
     WHERE owner_id = v_uid AND decommissioned_at IS NULL
     ORDER BY created_at NULLS LAST LIMIT 1;

    IF v_venue IS NULL THEN
      v_venue := public.gen_venue_slug(v_name, NULL);
      -- Caché jusqu'au « Go live » de l'onboarding (étape 7). Un club Yuno CRM
      -- ne vend rien chez Yuno : ni carte, ni placement VIP.
      INSERT INTO public.venues (id, name, city, owner_id, is_hidden, menu_enabled, vip_placement_enabled, product)
      VALUES (
        v_venue, v_name, v_city, v_uid, true,
        CASE WHEN v_crm THEN false WHEN cardinality(v_pillars) = 0 THEN true ELSE 'drinks' = ANY(v_pillars) END,
        NOT v_crm AND 'tables' = ANY(v_pillars),
        CASE WHEN v_crm THEN 'crm' ELSE 'suite' END
      );
      v_created := true;
    END IF;

    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (v_uid, 'owner'::public.app_role, v_email)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Onboarding : les piliers sont déjà choisis sur la landing → étape 1
    -- faite, le guide s'ouvre sur « Infos du club ». (Pas de piliers en CRM.)
    IF v_created AND cardinality(v_pillars) > 0 THEN
      INSERT INTO public.venue_onboarding (venue_id, owner_id, current_step, steps)
      VALUES (
        v_venue, v_uid, 2,
        jsonb_build_object(
          '1', jsonb_build_object('status', 'completed', 'completed_at', now(),
                 'metadata', jsonb_build_object('pillars',
                   to_jsonb(ARRAY(SELECT p FROM unnest(v_pillars) p WHERE p IN ('tickets','tables','drinks'))),
                   'source', 'pro_signup')),
          '2', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '3', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '4', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '5', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '6', jsonb_build_object('status', 'not_started', 'completed_at', null),
          '7', jsonb_build_object('status', 'not_started', 'completed_at', null)
        )
      )
      ON CONFLICT (venue_id) DO NOTHING;
    END IF;

    -- La 2FA reste obligatoire pour un owner ; on applique le report existant
    -- (7 jours, une fois, jamais sur les pages d'argent — RequireMFA) pour
    -- qu'un club qui s'inscrit voie son dashboard avant d'installer une app
    -- d'authentification.
    UPDATE public.profiles
       SET mfa_deferred_until = now() + interval '7 days'
     WHERE id = v_uid
       AND coalesce(mfa_enabled, false) = false
       AND mfa_deferred_until IS NULL;

    IF v_created THEN
      -- L'alerte admin_pro_signup (plus riche) remplace « nouveau club ».
      DELETE FROM public.admin_notifications
       WHERE dedup_key = 'new_venue:' || v_venue AND read_at IS NULL;
    END IF;
  ELSE
    UPDATE public.profiles SET
      profile_type      = 'organizer',
      organization_name = coalesce(nullif(organization_name, ''), v_name)
    WHERE id = v_uid;

    INSERT INTO public.organizer_profiles (user_id, display_name, city, product)
    VALUES (v_uid, v_name, nullif(v_city, ''), CASE WHEN v_crm THEN 'crm' ELSE 'suite' END)
    ON CONFLICT (user_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_created := v_n > 0;

    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (v_uid, 'organizer'::public.app_role, v_email)
    ON CONFLICT (user_id, role) DO NOTHING;

    IF v_created THEN
      DELETE FROM public.admin_notifications
       WHERE dedup_key = 'new_organizer:' || v_uid::text AND read_at IS NULL;
    END IF;
  END IF;

  UPDATE public.pro_signups SET
    user_id            = v_uid,
    venue_id           = coalesce(v_venue, venue_id),
    email              = coalesce(email, lower(v_email)),
    account_created_at = coalesce(account_created_at, now()),
    steps              = CASE WHEN steps ? 'created' THEN steps
                              ELSE steps || jsonb_build_object('created', now()) END,
    last_step          = 'created',
    updated_at         = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  IF NOT public.is_demo_email(v_email) THEN
    v_who := coalesce(nullif(trim(coalesce(v_row.first_name, '') || ' ' || coalesce(v_row.last_name, '')), ''), v_email);
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_pro_signup',
        CASE WHEN v_row.kind = 'club' THEN 'Nouveau club inscrit' ELSE 'Nouvel organisateur inscrit' END
          || CASE WHEN v_crm THEN ' (Yuno CRM)' ELSE '' END,
        v_name || coalesce(' (' || nullif(v_city, '') || ')', '') || ' · ' || v_who
          || coalesce(' · ' || v_row.phone, '') || coalesce(' · via ' || v_row.source, '') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'product', v_row.product, 'org_name', v_name, 'city', v_city,
                           'email', v_email, 'phone', v_row.phone, 'venue_id', v_venue,
                           'user_id', v_uid, 'size_band', v_row.size_band,
                           'current_tool', v_row.current_tool, 'next_night', v_row.next_night,
                           'pillars', to_jsonb(v_row.pillars), 'lang', v_row.lang),
        'pro_signup:' || v_row.id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Offre fondateurs : l'invitation gardée sur le brouillon s'applique au compte
  -- CRM qui vient de s'ouvrir (20261017230000). Ne lève jamais.
  IF v_crm AND v_row.offer_invite_id IS NOT NULL THEN
    v_offer := public._crm_offer_apply(
      v_row.offer_invite_id,
      CASE WHEN v_row.kind = 'club' THEN 'venue:' || v_venue ELSE 'org:' || v_uid::text END,
      v_uid);
  END IF;

  RETURN jsonb_build_object(
    'kind', v_row.kind,
    'product', v_row.product,
    'venue_id', v_venue,
    'created', v_created,
    'redirect', '/get-started',
    'offer', v_offer
  );
END $function$;

CREATE OR REPLACE FUNCTION public.open_product_on_my_account(p_product text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_signup_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
  v_offer uuid;
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
  -- Offre fondateurs : le parcours portait une invitation (20261017230000).
  IF p_product = 'crm' AND p_signup_key IS NOT NULL THEN
    SELECT offer_invite_id INTO v_offer FROM public.pro_signups
     WHERE client_key = p_signup_key AND user_id = v_uid;
    IF v_offer IS NOT NULL THEN
      v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('offer', public._crm_offer_apply(
                 v_offer, public.crm_scope_key(p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END), v_uid));
    END IF;
  END IF;
  RETURN v_res;
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
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND OR NOT public.crm_scope_has_crm(p_scope_key) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_crm');
  END IF;

  IF s.status = 'trialing' AND s.trial_ends_at > now() THEN
    -- Offre fondateurs : ses Yunits sont posés à l'ouverture (20261017230000).
    IF s.offer IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'offer');
    END IF;
    RETURN public.crm_yunits_credit(p_scope_key, 'trial', (cfg->>'trial_yunits')::int, s.trial_ends_at,
                                    'trial', 'Offerts pendant l’essai');
  END IF;

  IF s.status IN ('active', 'past_due') THEN
    -- Annuel : le bonus est posé à la période payée par crm_apply_stripe_subscription.
    IF s.billing_interval = 'year' THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'annual');
    END IF;
    -- Offre accordée à la main et échue : rien.
    IF s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'expired');
    END IF;
    -- Une seule fois par compte, jamais en plus d'un ancien lot mensuel ou du bonus annuel.
    IF EXISTS (SELECT 1 FROM public.crm_yunit_lots
                WHERE scope_key = p_scope_key
                  AND (kind IN ('monthly', 'annual_bonus') OR (kind = 'grant' AND source_ref IN ('welcome', 'founder_offer')))) THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'already_granted');
    END IF;
    RETURN public.crm_yunits_credit(p_scope_key, 'grant', (cfg->>'monthly_yunits')::int,
                                    now() + make_interval(months => COALESCE((cfg->>'purchase_validity_months')::int, 12)),
                                    'welcome', 'Offerts à l’abonnement');
  END IF;

  RETURN jsonb_build_object('ok', true, 'skipped', s.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_billing(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_row public.crm_subscriptions%ROWTYPE;
  v_plan text;
  v_limits jsonb;
  cfg jsonb := public.crm_pricing_config();
  v_members integer;
  v_auto integer;
  v_can_manage boolean;
  v_tier text;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.crm_subscriptions WHERE scope_key = v_scope;
  v_tier := public.crm_price_tier_for(v_scope);
  v_plan := public.crm_effective_plan(v_scope);
  v_limits := public.crm_plan_limits(v_plan);

  IF p_venue_id IS NOT NULL THEN
    SELECT count(*) INTO v_members FROM public.manager_permissions WHERE venue_id = p_venue_id;
    v_can_manage := EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = auth.uid());
  ELSE
    SELECT count(*) INTO v_members FROM public.org_members m
     WHERE m.organizer_user_id = p_organizer_user_id
       AND (m.invitation_status = 'accepted'
            OR (m.invitation_status = 'pending' AND (m.expires_at IS NULL OR m.expires_at > now())));
    v_can_manage := p_organizer_user_id = auth.uid();
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
      -- Offre fondateurs (20261017230000) : ce que le compte a reçu, et jusqu'à quand.
      'offer', CASE WHEN v_row.offer IS NULL THEN NULL ELSE
        jsonb_build_object('kind', v_row.offer, 'until', v_row.offer_until)
        || COALESCE((SELECT jsonb_build_object('free_months', i.free_months, 'yunits', i.yunits, 'started_at', i.claimed_at)
                       FROM public.crm_offer_invites i WHERE i.id = v_row.offer_invite_id), '{}'::jsonb) END,
      'has_stripe', v_row.stripe_subscription_id IS NOT NULL,
      'has_customer', v_row.stripe_customer_id IS NOT NULL,
      'granted', v_row.stripe_subscription_id IS NULL AND v_row.status = 'active',
      'trial_extensions_used', v_row.trial_extensions_used,
      'trial_extensions_left', GREATEST(0, COALESCE((cfg->>'trial_extensions')::int, 0) - v_row.trial_extensions_used)) END,
    'effective_plan', v_plan,
    -- Le propriétaire seul paie : c'est la porte des actions crm_* de club-subscription.
    'can_manage', v_can_manage,
    'yunits_balance', public.crm_yunits_balance(v_scope),
    'pricing', jsonb_build_object(
      -- Prix du niveau de CE compte (lancement garanti à un abonné existant).
      'tier', v_tier,
      'price_month', CASE WHEN v_tier = 'public' THEN (cfg->>'price_month_next')::numeric ELSE (cfg->>'price_month')::numeric END,
      'price_year', CASE WHEN v_tier = 'public' THEN (cfg->>'price_month_next')::numeric * 12 ELSE (cfg->>'price_year')::numeric END,
      'price_month_launch', (cfg->>'price_month')::numeric,
      'price_month_next', (cfg->>'price_month_next')::numeric,
      'monthly_yunits', (cfg->>'monthly_yunits')::int,
      'annual_bonus_yunits', (cfg->>'annual_bonus_yunits')::int,
      'trial_yunits', (cfg->>'trial_yunits')::int,
      'trial_days', (cfg->>'trial_days')::int,
      'vat_rate', (cfg->>'vat_rate')::numeric),
    'usage', jsonb_build_object(
      'members', COALESCE(v_members, 0),
      'sync_minutes', (v_limits->>'sync_minutes')::int,
      'automations_on', COALESCE(v_auto, 0))
  );
END;
$function$;
