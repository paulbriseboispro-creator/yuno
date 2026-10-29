-- Yuno CRM — « Vos acheteurs » : écrire aux acheteurs de ses propres soirées
-- sur l'exception « clients » de l'article L34-5 alinéa 2 du CPCE (soft opt-in).
-- Plan : docs/designs/CRM_CUSTOMER_BASIS_PLAN.md (lot 1).
--
-- Ce fichier pose la base, sans aucun effet visible :
--   • réglages globaux (fermés : ni ouverture générale, ni envoi possible) ;
--   • la déclaration d'un compte (signée par le TITULAIRE, preuve dans legal_acceptances) ;
--   • les personnes éligibles (table à part, JAMAIS newsletter_subscriptions : opted_in
--     y veut dire « a donné son accord ») ;
--   • la base légale d'une campagne (consent | customer) et sa garde ;
--   • le contrôle de contenu « ne parle que de vos soirées » ;
--   • les RPC de la Console et de l'Admin CRM, et la passe de nuit.
-- La lecture par le moteur d'envoi (résolveur, file, désinscription, montée
-- progressive) est le lot 2 : tant qu'il n'est pas posé, aucune campagne
-- « customer » ne vise une personne de plus.

SET lock_timeout = '3s';

-- ── 1. Réglages globaux ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_customer_basis_settings (
  id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Ouverture pour tous les comptes (après l'avis de l'avocat). Avant : bêta par compte.
  enabled             boolean NOT NULL DEFAULT false,
  -- Compte Resend et domaine d'envoi à part prêts (lot 3). Faux : rien ne part, même déclaré.
  sending_ready       boolean NOT NULL DEFAULT false,
  declaration_version text    NOT NULL DEFAULT '2026-10-29',
  eligibility_months  int     NOT NULL DEFAULT 36 CHECK (eligibility_months BETWEEN 1 AND 36),
  validity_months     int     NOT NULL DEFAULT 12 CHECK (validity_months BETWEEN 1 AND 12),
  ramp_start          int     NOT NULL DEFAULT 1500 CHECK (ramp_start BETWEEN 100 AND 100000),
  complaint_pause_pct numeric NOT NULL DEFAULT 0.1 CHECK (complaint_pause_pct > 0 AND complaint_pause_pct <= 0.2),
  bounce_pause_pct    numeric NOT NULL DEFAULT 4   CHECK (bounce_pause_pct > 0 AND bounce_pause_pct <= 5),
  max_per_30d         int     NOT NULL DEFAULT 4   CHECK (max_per_30d BETWEEN 1 AND 8),
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crm_customer_basis_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.crm_customer_basis_settings ENABLE ROW LEVEL SECURITY;  -- aucune policy : tout par RPC

-- ── 2. La déclaration d'un compte ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_customer_basis (
  scope_key           text PRIMARY KEY,                 -- crm_scope_key(venue, orga)
  venue_id            text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id   uuid,
  status              text NOT NULL DEFAULT 'off' CHECK (status IN ('off', 'active', 'suspended')),
  beta_allowed        boolean NOT NULL DEFAULT false,   -- posé par le super admin avant l'ouverture générale
  declared_by         uuid,
  declared_at         timestamptz,
  declaration_version text,
  acceptance_id       uuid REFERENCES public.legal_acceptances(id) ON DELETE SET NULL,
  signatory_name      text,
  signatory_role      text,
  expires_at          timestamptz,
  suspended_at        timestamptz,
  suspended_reason    text CHECK (suspended_reason IS NULL OR suspended_reason IN ('complaints', 'bounces', 'admin', 'version', 'expired')),
  suspended_by        uuid,
  ramp_day            int NOT NULL DEFAULT 0,
  ramp_cap            int,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(venue_id, organizer_user_id) = 1)
);
ALTER TABLE public.crm_customer_basis ENABLE ROW LEVEL SECURITY;  -- aucune policy

-- ── 3. Les personnes ────────────────────────────────────────────────────────
-- Une ligne par (espace, adresse). Construite seulement quand la base du compte
-- est ouverte, ou quand une opposition est transmise (elle sert alors de repoussoir).
-- « objected » est définitif : jamais remis à « eligible ».
CREATE TABLE IF NOT EXISTS public.crm_customer_contacts (
  scope_key         text NOT NULL,
  email             text NOT NULL,
  first_name        text,
  last_name         text,
  first_sale_at     timestamptz,
  last_sale_at      timestamptz,
  last_event_id     uuid,
  sales             int NOT NULL DEFAULT 0,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  state             text NOT NULL DEFAULT 'eligible' CHECK (state IN ('eligible', 'objected', 'expired')),
  objected_at       timestamptz,
  objected_source   text CHECK (objected_source IS NULL OR objected_source IN
                     ('unsubscribe', 'provider_withdrawn', 'pro_reported', 'complaint', 'suppressed')),
  refreshed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, email),
  CHECK (state <> 'objected' OR objected_source IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_customer_contacts_token_uq ON public.crm_customer_contacts (unsubscribe_token);
CREATE INDEX IF NOT EXISTS crm_customer_contacts_state_idx ON public.crm_customer_contacts (scope_key, state);
ALTER TABLE public.crm_customer_contacts ENABLE ROW LEVEL SECURITY;  -- aucune policy

-- ── 4. Preuve : la déclaration est une acceptation légale ───────────────────
-- record_legal_acceptance (publique) ne l'accepte PAS : seule crm_customer_basis_declare l'écrit.
ALTER TABLE public.legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_doc_type_check;
ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_doc_type_check CHECK (doc_type = ANY (ARRAY[
  'cgu', 'cgv_users', 'terms_pro', 'confidentiality', 'demo_confidentiality', 'privacy',
  'terms_crm', 'dpa', 'crm_customer_basis']));

-- ── 5. La base légale d'une campagne et de chaque destinataire ──────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS legal_basis text NOT NULL DEFAULT 'consent';
DO $$ BEGIN
  ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_legal_basis_check
    CHECK (legal_basis IN ('consent', 'customer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Posée par le moteur d'envoi (lot 2) : à quel titre cette personne a reçu ce message.
ALTER TABLE public.email_campaign_recipients ADD COLUMN IF NOT EXISTS legal_basis text;

-- ── 6. Lectures de base ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_customer_basis_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', s.enabled, 'sending_ready', s.sending_ready,
    'declaration_version', s.declaration_version,
    'eligibility_months', s.eligibility_months, 'validity_months', s.validity_months,
    'ramp_start', s.ramp_start, 'complaint_pause_pct', s.complaint_pause_pct,
    'bounce_pause_pct', s.bounce_pause_pct, 'max_per_30d', s.max_per_30d)
  FROM public.crm_customer_basis_settings s WHERE s.id = 1;
$$;

-- La base d'un compte peut-elle partir AUJOURD'HUI ? Lue par le moteur (lot 2) et la garde.
CREATE OR REPLACE FUNCTION public.crm_customer_basis_open(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT s.sending_ready AND (s.enabled OR b.beta_allowed)
       AND b.status = 'active' AND b.expires_at > now()
       AND b.declaration_version = s.declaration_version
      FROM public.crm_customer_basis b
      CROSS JOIN public.crm_customer_basis_settings s
     WHERE b.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND s.id = 1), false);
$$;

-- Une soirée est-elle une soirée PROPRE de l'espace : miroir de sa billetterie,
-- vendue par lui (rôle Shotgun non co-organisé) ?
CREATE OR REPLACE FUNCTION public._crm_customer_own_event(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_event_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.events e
      JOIN public.external_events ee ON ee.event_id = e.id
     WHERE e.id = p_event_id AND e.external_source IS NOT NULL
       AND public.marketing_scope_match(ee.venue_id, ee.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND NOT public._ticketing_role_is_cohosted(ee.external_role));
$$;

-- ── 7. Qui est éligible : LA règle ──────────────────────────────────────────
-- Au moins un billet PAYANT d'une soirée propre (rôle Shotgun non co-organisé),
-- dernier achat propre dans la fenêtre, et l'opposition éventuelle :
--   provider_withdrawn : a coché l'accord chez la billetterie puis l'a retiré
--                        (dernier signal = non, après un oui) ;
--   suppressed         : rebond dur ou plainte (liste globale) ;
--   unsubscribe        : désabonné de l'espace, Billetterie ou CRM (un « stop » vaut pour les deux).
-- « N'a jamais coché » et « champ absent » ne sont PAS des oppositions : c'est
-- l'interprétation que le pro déclare (article 7 bis des Conditions CRM).
CREATE OR REPLACE FUNCTION public._crm_customer_eligible_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE (email text, first_name text, last_name text, first_sale_at timestamptz,
               last_sale_at timestamptz, last_event_id uuid, sales integer, objected_source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Requête dynamique : planifiée à chaque appel avec le compte connu. Écrite en
  -- fonction SQL, elle était planifiée sans lui (10 billets estimés pour 46 000) : 4,6 s au lieu de 0,45 s.
  RETURN QUERY EXECUTE $q$
  WITH cfg AS (SELECT eligibility_months FROM public.crm_customer_basis_settings WHERE id = 1),
  t AS MATERIALIZED (
    SELECT lower(btrim(xt.buyer_email)) AS email,
           NULLIF(btrim(xt.buyer_first_name), '') AS fn, NULLIF(btrim(xt.buyer_last_name), '') AS ln,
           xt.status, xt.deal_channel, xt.price, xt.newsletter_optin, xt.event_id,
           COALESCE(xt.purchased_at, xt.first_seen_at) AS at,
           COALESCE(xt.source_updated_at, xt.purchased_at, xt.first_seen_at) AS upd,
           (ee.id IS NOT NULL AND NOT public._ticketing_role_is_cohosted(ee.external_role)) AS own
      FROM public.external_tickets xt
      LEFT JOIN public.external_events ee
        ON ee.connection_id = xt.connection_id AND ee.external_id = xt.external_event_id
     WHERE (($1 IS NOT NULL AND xt.venue_id = $1)
         OR ($1 IS NULL AND $2 IS NOT NULL AND xt.organizer_user_id = $2))
       AND xt.erased_at IS NULL
       AND xt.buyer_email IS NOT NULL
       AND btrim(xt.buyer_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  -- Une seule agrégation par personne : ventes propres, et le signal newsletter de TOUS ses
  -- billets de l'espace (règle de ticketing_after_sync : le plus récemment mis à jour décide).
  o AS (
    SELECT email,
           (array_agg(fn ORDER BY at DESC) FILTER (WHERE own AND paid AND fn IS NOT NULL))[1] AS fn,
           (array_agg(ln ORDER BY at DESC) FILTER (WHERE own AND paid AND ln IS NOT NULL))[1] AS ln,
           min(at) FILTER (WHERE own AND paid) AS first_sale_at,
           max(at) FILTER (WHERE own AND paid) AS last_sale_at,
           (array_agg(event_id ORDER BY at DESC) FILTER (WHERE own AND paid AND event_id IS NOT NULL))[1] AS last_event_id,
           (count(*) FILTER (WHERE own AND paid))::int AS sales,
           (array_agg(newsletter_optin ORDER BY upd DESC NULLS LAST) FILTER (WHERE newsletter_optin IS NOT NULL))[1] AS last_optin,
           bool_or(COALESCE(newsletter_optin, false)) AS ever_yes
      FROM (SELECT t.*, public._crm_ticket_is_paid(t.status, t.price, t.deal_channel) AS paid FROM t) t2
     GROUP BY email
    HAVING count(*) FILTER (WHERE own AND paid) > 0
  )
  SELECT o.email, o.fn, o.ln, o.first_sale_at, o.last_sale_at, o.last_event_id, o.sales,
         CASE
           WHEN o.ever_yes AND o.last_optin = false THEN 'provider_withdrawn'
           WHEN EXISTS (SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = o.email) THEN 'suppressed'
           WHEN EXISTS (SELECT 1 FROM public.email_opt_outs x
                         WHERE lower(x.email) = o.email
                           AND public.marketing_scope_match(x.venue_id, x.organizer_user_id, $1, $2)) THEN 'unsubscribe'
           WHEN EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                         WHERE lower(ns.email) = o.email AND ns.opted_out_at IS NOT NULL AND NOT ns.opted_in
                           AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, $1, $2)) THEN 'unsubscribe'
         END AS objected_source
    FROM o
    CROSS JOIN cfg
   WHERE o.last_sale_at > now() - make_interval(months => cfg.eligibility_months)
  $q$ USING p_venue_id, p_organizer_user_id;
END;
$$;

-- Reconstruit les personnes d'un espace. Une opposition déjà notée reste notée ;
-- qui ne remplit plus les conditions (plus de 36 mois, billet remboursé…) passe
-- « expired », puis disparaît 30 jours plus tard. Les oppositions ne disparaissent jamais.
CREATE OR REPLACE FUNCTION public._crm_customer_contacts_refresh(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_rows int; v_expired int; v_purged int;
BEGIN
  IF v_key IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.crm_customer_contacts AS c
         (scope_key, email, first_name, last_name, first_sale_at, last_sale_at, last_event_id, sales,
          state, objected_at, objected_source, refreshed_at)
  SELECT v_key, r.email, r.first_name, r.last_name, r.first_sale_at, r.last_sale_at, r.last_event_id, r.sales,
         CASE WHEN r.objected_source IS NULL THEN 'eligible' ELSE 'objected' END,
         CASE WHEN r.objected_source IS NOT NULL THEN now() END, r.objected_source, now()
    FROM public._crm_customer_eligible_rows(p_venue_id, p_organizer_user_id) r
  ON CONFLICT (scope_key, email) DO UPDATE SET
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
    first_sale_at = EXCLUDED.first_sale_at, last_sale_at = EXCLUDED.last_sale_at,
    last_event_id = EXCLUDED.last_event_id, sales = EXCLUDED.sales,
    state = CASE WHEN c.state = 'objected' THEN 'objected' ELSE EXCLUDED.state END,
    objected_at = CASE WHEN c.state = 'objected' THEN c.objected_at ELSE EXCLUDED.objected_at END,
    objected_source = CASE WHEN c.state = 'objected' THEN c.objected_source ELSE EXCLUDED.objected_source END,
    refreshed_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Ce qui n'est pas revenu dans cette passe (now() = début de la transaction).
  UPDATE public.crm_customer_contacts SET state = 'expired'
   WHERE scope_key = v_key AND state = 'eligible' AND refreshed_at < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  DELETE FROM public.crm_customer_contacts
   WHERE scope_key = v_key AND state = 'expired' AND refreshed_at < now() - interval '30 days';
  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN jsonb_build_object('rows', v_rows, 'expired', v_expired, 'purged', v_purged);
END;
$$;

-- Comptes affichés (Réglages, fenêtre à cocher, Admin CRM). Base ouverte : la
-- table ; base fermée : calcul à la volée, rien n'est écrit.
CREATE OR REPLACE FUNCTION public._crm_customer_basis_counts(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_out jsonb;
BEGIN
  WITH consent AS (
    SELECT DISTINCT lower(ns.email) AS email FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in AND ns.product = 'crm'
       AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
  ), rows AS (
    SELECT r.email, r.objected_source FROM public._crm_customer_eligible_rows(p_venue_id, p_organizer_user_id) r
     WHERE NOT EXISTS (SELECT 1 FROM public.crm_customer_basis b WHERE b.scope_key = v_key AND b.status = 'active')
    UNION ALL
    SELECT c.email, c.objected_source FROM public.crm_customer_contacts c
     WHERE c.scope_key = v_key AND c.state IN ('eligible', 'objected')
       AND EXISTS (SELECT 1 FROM public.crm_customer_basis b WHERE b.scope_key = v_key AND b.status = 'active')
  ), reported AS (   -- oppositions transmises, même base fermée
    SELECT c.email FROM public.crm_customer_contacts c
     WHERE c.scope_key = v_key AND c.state = 'objected' AND c.objected_source IN ('pro_reported', 'complaint')
  )
  SELECT jsonb_build_object(
    'consent', (SELECT count(*) FROM consent),
    'extra', (SELECT count(*) FROM rows r WHERE r.objected_source IS NULL
                AND NOT EXISTS (SELECT 1 FROM consent k WHERE k.email = r.email)
                AND NOT EXISTS (SELECT 1 FROM reported p WHERE p.email = r.email)),
    'excluded', jsonb_build_object(
      'provider_withdrawn', (SELECT count(*) FROM rows WHERE objected_source = 'provider_withdrawn'),
      'unsubscribe', (SELECT count(*) FROM rows WHERE objected_source = 'unsubscribe'),
      'suppressed', (SELECT count(*) FROM rows WHERE objected_source = 'suppressed'),
      'reported', (SELECT count(*) FROM reported)))
  INTO v_out;
  RETURN v_out;
END;
$$;

-- ── 8. Console : lire, déclarer, fermer, transmettre des oppositions ───────
CREATE OR REPLACE FUNCTION public.crm_customer_basis_get(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  b public.crm_customer_basis%ROWTYPE;
  s public.crm_customer_basis_settings%ROWTYPE;
BEGIN
  IF v_key IS NULL OR NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_customer_basis_settings WHERE id = 1;
  SELECT * INTO b FROM public.crm_customer_basis WHERE scope_key = v_key;
  RETURN jsonb_build_object(
    'status', COALESCE(b.status, 'off'),
    'can_declare', s.enabled OR COALESCE(b.beta_allowed, false),
    'is_owner', public._crm_signup_owner(p_venue_id, p_organizer_user_id),
    'sending_ready', s.sending_ready,
    'open', public.crm_customer_basis_open(p_venue_id, p_organizer_user_id),
    'version', s.declaration_version,
    'declaration_version', b.declaration_version,
    'needs_renewal', b.status = 'active' AND (b.declaration_version IS DISTINCT FROM s.declaration_version
                                              OR b.expires_at < now() + interval '30 days'),
    'declared_at', b.declared_at, 'expires_at', b.expires_at,
    'signatory_name', b.signatory_name, 'signatory_role', b.signatory_role,
    'suspended_at', b.suspended_at, 'suspended_reason', b.suspended_reason,
    'eligibility_months', s.eligibility_months,
    'counts', public._crm_customer_basis_counts(p_venue_id, p_organizer_user_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_customer_basis_declare(
  p_venue_id text, p_organizer_user_id uuid, p_version text, p_doc_hash text,
  p_signatory_name text, p_signatory_role text, p_checks jsonb,
  p_lang text DEFAULT 'fr', p_shown jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_customer_basis_settings%ROWTYPE;
  v_beta boolean;
  v_email text;
  v_headers json; v_ip text; v_ua text;
  v_acc uuid;
  v_name text := NULLIF(btrim(COALESCE(p_signatory_name, '')), '');
  v_role text := NULLIF(btrim(COALESCE(p_signatory_role, '')), '');
  k text;
BEGIN
  IF public.is_support_session() OR public.is_demo_preview_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id)
     OR NOT public._crm_signup_owner(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'crm_owner_only' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_account' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO s FROM public.crm_customer_basis_settings WHERE id = 1;
  SELECT beta_allowed INTO v_beta FROM public.crm_customer_basis WHERE scope_key = v_key;
  IF NOT (s.enabled OR COALESCE(v_beta, false)) THEN
    RAISE EXCEPTION 'customer_basis_not_open' USING ERRCODE = 'P0001';
  END IF;
  IF p_version IS DISTINCT FROM s.declaration_version THEN
    RAISE EXCEPTION 'customer_basis_version' USING ERRCODE = 'P0001', DETAIL = s.declaration_version;
  END IF;
  -- Les cinq engagements de la fenêtre, tous cochés.
  FOREACH k IN ARRAY ARRAY['seller', 'own_nights_only', 'informed', 'forward_objections', 'terms_read'] LOOP
    IF jsonb_typeof(p_checks) <> 'object' OR COALESCE((p_checks->>k)::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'customer_basis_checks' USING ERRCODE = 'P0001', DETAIL = k;
    END IF;
  END LOOP;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 120 OR v_role IS NULL OR length(v_role) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'customer_basis_signatory' USING ERRCODE = 'P0001';
  END IF;
  IF p_doc_hash IS NULL OR p_doc_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'customer_basis_hash' USING ERRCODE = 'P0001';
  END IF;
  IF pg_column_size(p_shown) > 2048 THEN
    RAISE EXCEPTION 'context_too_large' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
    v_ip := NULLIF(btrim(split_part(COALESCE(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    v_ua := NULLIF(left(COALESCE(v_headers->>'user-agent', ''), 400), '');
  EXCEPTION WHEN others THEN v_ip := NULL; v_ua := NULL;
  END;

  INSERT INTO public.legal_acceptances (user_id, email, doc_type, doc_version, doc_hash, context, ip, user_agent)
  VALUES (auth.uid(), v_email, 'crm_customer_basis', s.declaration_version, p_doc_hash,
          jsonb_build_object('scope_key', v_key, 'checks', p_checks, 'shown', COALESCE(p_shown, '{}'::jsonb),
                             'signatory_name', v_name, 'signatory_role', v_role,
                             'lang', CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END),
          v_ip, v_ua)
  RETURNING id INTO v_acc;

  INSERT INTO public.crm_customer_basis AS b
         (scope_key, venue_id, organizer_user_id, status, declared_by, declared_at, declaration_version,
          acceptance_id, signatory_name, signatory_role, expires_at, ramp_day, ramp_cap, updated_at)
  VALUES (v_key, p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END, 'active',
          auth.uid(), now(), s.declaration_version, v_acc, v_name, v_role,
          now() + make_interval(months => s.validity_months), 0, s.ramp_start, now())
  ON CONFLICT (scope_key) DO UPDATE SET
    status = 'active', declared_by = EXCLUDED.declared_by, declared_at = EXCLUDED.declared_at,
    declaration_version = EXCLUDED.declaration_version, acceptance_id = EXCLUDED.acceptance_id,
    signatory_name = EXCLUDED.signatory_name, signatory_role = EXCLUDED.signatory_role,
    expires_at = EXCLUDED.expires_at,
    -- Une réouverture après une suspension pour plaintes ne remet pas la montée à zéro… mais la
    -- suspension elle-même ne se lève que par le super admin (crm_admin_customer_basis_set).
    suspended_at = CASE WHEN b.suspended_reason IN ('complaints', 'bounces', 'admin') THEN b.suspended_at END,
    suspended_by = CASE WHEN b.suspended_reason IN ('complaints', 'bounces', 'admin') THEN b.suspended_by END,
    suspended_reason = CASE WHEN b.suspended_reason IN ('complaints', 'bounces', 'admin') THEN b.suspended_reason END,
    ramp_cap = COALESCE(b.ramp_cap, EXCLUDED.ramp_cap),
    updated_at = now();
  -- Suspendu par Yuno : la signature est enregistrée, la base reste suspendue.
  UPDATE public.crm_customer_basis SET status = 'suspended'
   WHERE scope_key = v_key AND suspended_reason IN ('complaints', 'bounces', 'admin');

  PERFORM public._crm_customer_contacts_refresh(p_venue_id, p_organizer_user_id);

  PERFORM public.emit_admin_notification(
    'admin_crm_customer_basis_on',
    'Vos acheteurs : base ouverte',
    v_name || ' (' || v_role || ') a signé la déclaration « Vos acheteurs » pour ' || v_key || '.',
    'normal', 'crm_account', v_key,
    jsonb_build_object('scope_key', v_key, 'version', s.declaration_version, 'shown', p_shown),
    'crm_customer_basis_on:' || v_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);

  RETURN public.crm_customer_basis_get(p_venue_id, p_organizer_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_customer_basis_off(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF public.is_support_session() OR public.is_demo_preview_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR NOT public._crm_signup_owner(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'crm_owner_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.crm_customer_basis SET status = 'off', updated_at = now() WHERE scope_key = v_key;
  -- Les oppositions restent (repoussoir), le reste s'efface.
  DELETE FROM public.crm_customer_contacts WHERE scope_key = v_key AND state <> 'objected';
  -- Une campagne programmée sur cette base repasse en brouillon.
  UPDATE public.email_campaigns SET status = 'draft'
   WHERE legal_basis = 'customer' AND status = 'scheduled'
     AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
  RETURN public.crm_customer_basis_get(p_venue_id, p_organizer_user_id);
END;
$$;

-- Le pro transmet des oppositions reçues ailleurs (réponse à un e-mail, message, guichet).
CREATE OR REPLACE FUNCTION public.crm_customer_report_objection(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_n int;
BEGIN
  IF v_key IS NULL OR NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_emails), 0) = 0 OR cardinality(p_emails) > 5000 THEN
    RAISE EXCEPTION 'customer_objection_size' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.crm_customer_contacts AS c (scope_key, email, state, objected_at, objected_source, refreshed_at)
  SELECT DISTINCT v_key, lower(btrim(e)), 'objected', now(), 'pro_reported', now()
    FROM unnest(p_emails) e
   WHERE btrim(e) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ON CONFLICT (scope_key, email) DO UPDATE SET
    state = 'objected',
    objected_at = COALESCE(c.objected_at, now()),
    objected_source = COALESCE(c.objected_source, 'pro_reported');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('objected', v_n);
END;
$$;

-- ── 9. Contrôle de contenu : « ne parle que de vos soirées » ────────────────
-- Plus souple que l'e-mail pratique (on a le droit de vendre, de montrer les prix,
-- de poser un code promo sur SA soirée), plus strict qu'une campagne à l'accord.
CREATE OR REPLACE FUNCTION public._crm_customer_link_issue(p_url text, p_venue_id text, p_organizer_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text := lower(btrim(COALESCE(p_url, '')));
  v_host text; v_path text; v_bare text; v_code text; v_ev uuid;
BEGIN
  IF v_url = '' OR v_url LIKE 'mailto:%' OR v_url LIKE 'tel:%' OR v_url LIKE '#%' THEN RETURN NULL; END IF;
  -- Variables du Studio : elles mènent à la soirée de la campagne, jugée à part.
  IF v_url LIKE '%{{%' THEN RETURN NULL; END IF;
  IF v_url !~ '^https?://' THEN v_url := 'https://' || v_url; END IF;
  v_host := regexp_replace(substring(v_url FROM '^https?://([^/?#]+)'), '^www\.', '');
  v_path := COALESCE(substring(v_url FROM '^https?://[^/?#]+(/[^?#]*)'), '/');
  v_bare := split_part(split_part(regexp_replace(v_url, '^https?://(www\.)?', ''), '?', 1), '#', 1);

  IF v_host IN ('yunoapp.eu', 'crm.yunoapp.eu') THEN
    -- Lien suivi d'une soirée : la soirée doit être propre.
    v_code := substring(v_path FROM '^/(?:go|l)/([a-z0-9-]{1,60})/?$');
    IF v_code IS NOT NULL THEN
      SELECT tl.event_id INTO v_ev FROM public.tracked_links tl
       WHERE tl.id = public.tracked_link_id_for_code(v_code);
      IF public._crm_customer_own_event(p_venue_id, p_organizer_user_id, v_ev) THEN RETURN NULL; END IF;
      RETURN 'link_not_own_event';
    END IF;
    -- Page d'inscription de l'espace.
    IF v_path ~ '^/j/[a-z0-9-]+' AND EXISTS (
         SELECT 1 FROM public.crm_signup_pages sp
          WHERE sp.slug = substring(v_path FROM '^/j/([a-z0-9-]+)')
            AND public.marketing_scope_match(sp.venue_id, sp.organizer_user_id, p_venue_id, p_organizer_user_id)) THEN
      RETURN NULL;
    END IF;
    RETURN 'link_foreign_page';
  END IF;

  IF v_host LIKE '%shotgun.live' THEN
    IF EXISTS (
         SELECT 1 FROM public.events e
           JOIN public.external_events ee ON ee.event_id = e.id
          WHERE e.external_source IS NOT NULL AND e.external_ticket_url IS NOT NULL
            AND public.marketing_scope_match(ee.venue_id, ee.organizer_user_id, p_venue_id, p_organizer_user_id)
            AND NOT public._ticketing_role_is_cohosted(ee.external_role)
            AND split_part(split_part(regexp_replace(lower(e.external_ticket_url), '^https?://(www\.)?', ''), '?', 1), '#', 1) = v_bare) THEN
      RETURN NULL;
    END IF;
    RETURN 'link_not_own_event';
  END IF;

  IF v_host ~ '(^|\.)(dice\.fm|fourvenues\.com|whan\.es|eventbrite\.[a-z.]+|weezevent\.com|billetweb\.fr|ticketmaster\.[a-z.]+|fnacspectacles\.com|ra\.co|residentadvisor\.net|xceed\.me|seetickets\.com|helloasso\.com|yurplan\.com|tickettailor\.com|festicket\.com|universe\.com|fever\.?up\.com|feverup\.com|digitick\.com|eventim\.[a-z.]+)$' THEN
    RETURN 'link_ticketing';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._crm_customer_content_issues(
  p_blocks jsonb, p_event_id uuid, p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  b jsonb; v_type text; v_id text; v_issue text; v_url text; v_ev text;
BEGIN
  -- La soirée de la campagne, quand il y en a une, est une soirée propre.
  IF p_event_id IS NOT NULL AND NOT public._crm_customer_own_event(p_venue_id, p_organizer_user_id, p_event_id) THEN
    v_out := v_out || jsonb_build_object('code', 'not_own_event', 'field', 'event');
  END IF;
  IF jsonb_typeof(p_blocks) <> 'array' THEN RETURN v_out; END IF;

  FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
    v_type := b->>'type';
    v_id := b->>'id';
    -- Bloc Yuno relié à une soirée : la soirée doit être propre.
    v_ev := NULLIF(b->>'eventId', '');
    IF v_type IN ('event', 'tickets', 'table', 'countdown', 'lineup', 'guestlist') AND v_ev IS NOT NULL THEN
      IF v_ev !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT public._crm_customer_own_event(p_venue_id, p_organizer_user_id, v_ev::uuid) THEN
        v_out := v_out || jsonb_build_object('code', 'not_own_event', 'block', v_id, 'type', v_type);
      END IF;
    END IF;

    FOR v_url IN
      SELECT u FROM (
        SELECT b->>'url' AS u WHERE v_type = 'cta'
        UNION ALL SELECT b->>'linkUrl' WHERE v_type = 'image'
        UNION ALL SELECT b->>'ctaUrl' WHERE v_type = 'event'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b->>'body', ''), '\[url=([^\]]+)\]', 'gi') m WHERE v_type IN ('text', 'html')
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b->>'body', '') || ' ' || COALESCE(b->>'html', ''), 'href\s*=\s*["'']([^"'']+)["'']', 'gi') m WHERE v_type IN ('text', 'html')
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b#>>'{left,body}', '') || ' ' || COALESCE(b#>>'{right,body}', ''), '\[url=([^\]]+)\]', 'gi') m WHERE v_type = 'columns'
      ) x WHERE NULLIF(btrim(u), '') IS NOT NULL
    LOOP
      v_issue := public._crm_customer_link_issue(v_url, p_venue_id, p_organizer_user_id);
      IF v_issue IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('code', v_issue, 'block', v_id, 'type', v_type, 'url', left(v_url, 200));
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Lue par la Vérification de la Console et par send-campaign (avant un test et avant la file).
CREATE OR REPLACE FUNCTION public.crm_customer_email_check(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.email_campaigns%ROWTYPE;
  v_issues jsonb;
  v_open boolean;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR c.legal_basis <> 'customer' THEN
    RETURN jsonb_build_object('customer', false, 'ok', true, 'issues', '[]'::jsonb);
  END IF;
  IF NOT (auth.role() = 'service_role' OR public.crm_scope_allowed(c.venue_id, c.organizer_user_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_issues := public._crm_customer_content_issues(c.blocks_json, c.event_id, c.venue_id, c.organizer_user_id);
  v_open := public.crm_customer_basis_open(c.venue_id, c.organizer_user_id);
  RETURN jsonb_build_object('customer', true, 'open', v_open,
                            'ok', v_open AND jsonb_array_length(v_issues) = 0, 'issues', v_issues);
END;
$$;

-- ── 10. Garde de la campagne ────────────────────────────────────────────────
-- Avant trg_b_crm_practical_email (ordre alphabétique : « cu » < « pr »), après trg_0
-- (qui pose le produit). Une campagne « consent » ne fait que passer.
CREATE OR REPLACE FUNCTION public.guard_crm_customer_basis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_going boolean;
  v_issues jsonb;
BEGIN
  -- Une campagne partie garde sa base légale : c'est la preuve de ce qu'elle a été.
  IF TG_OP = 'UPDATE' AND OLD.legal_basis IS DISTINCT FROM NEW.legal_basis AND OLD.status NOT IN ('draft', 'scheduled') THEN
    RAISE EXCEPTION 'crm_customer_basis_locked' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.legal_basis IS DISTINCT FROM 'customer' THEN RETURN NEW; END IF;

  IF NEW.product IS DISTINCT FROM 'crm' OR COALESCE(NEW.practical, false)
     OR (NEW.venue_id IS NULL AND NEW.organizer_user_id IS NULL)
     OR NEW.type = 'informational' THEN
    RAISE EXCEPTION 'crm_customer_basis_scope' USING ERRCODE = 'P0001',
      HINT = 'Seule une campagne marketing de Yuno CRM peut viser vos acheteurs.';
  END IF;
  -- v1 : campagnes manuelles seules ; ni renvoi, ni relance, ni enfant (recettes et scénarios = lot 5).
  IF COALESCE(NEW.resend_enabled, false) OR COALESCE(NEW.followup_enabled, false)
     OR NEW.automation_id IS NOT NULL OR NEW.child_kind IS NOT NULL OR NEW.parent_campaign_id IS NOT NULL THEN
    RAISE EXCEPTION 'crm_customer_basis_feature' USING ERRCODE = 'P0001';
  END IF;

  v_going := NEW.status IN ('sending', 'scheduled')
         AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
              OR OLD.blocks_json IS DISTINCT FROM NEW.blocks_json
              OR OLD.event_id IS DISTINCT FROM NEW.event_id
              OR OLD.legal_basis IS DISTINCT FROM NEW.legal_basis);
  IF NOT v_going THEN RETURN NEW; END IF;

  v_issues := public._crm_customer_content_issues(NEW.blocks_json, NEW.event_id, NEW.venue_id, NEW.organizer_user_id);
  IF jsonb_array_length(v_issues) > 0 THEN
    RAISE EXCEPTION 'crm_customer_content' USING ERRCODE = 'P0001', DETAIL = v_issues::text,
      HINT = 'Un e-mail à vos acheteurs ne parle que de vos soirées.';
  END IF;
  -- Une tranche suivante ou une reprise ne rejuge pas l'ouverture : la file relit la base (lot 2).
  IF TG_OP = 'UPDATE' AND OLD.status IN ('sending', 'paused') AND NEW.status = 'sending' THEN
    RETURN NEW;
  END IF;
  IF NOT public.crm_customer_basis_open(NEW.venue_id, NEW.organizer_user_id) THEN
    RAISE EXCEPTION 'crm_customer_basis_closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_b_crm_customer_basis ON public.email_campaigns;
CREATE TRIGGER trg_b_crm_customer_basis BEFORE INSERT OR UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_customer_basis();

-- ── 11. Admin CRM ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_customer_basis(p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.crm_customer_basis_config(),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'scope_key', b.scope_key, 'venue_id', b.venue_id, 'organizer_user_id', b.organizer_user_id,
        'name', COALESCE(v.name, op.display_name), 'status', b.status, 'beta_allowed', b.beta_allowed,
        'open', public.crm_customer_basis_open(b.venue_id, b.organizer_user_id),
        'declared_at', b.declared_at, 'declaration_version', b.declaration_version,
        'signatory_name', b.signatory_name, 'signatory_role', b.signatory_role,
        'expires_at', b.expires_at, 'suspended_at', b.suspended_at, 'suspended_reason', b.suspended_reason,
        'ramp_day', b.ramp_day, 'ramp_cap', b.ramp_cap,
        'eligible', (SELECT count(*) FROM public.crm_customer_contacts c WHERE c.scope_key = b.scope_key AND c.state = 'eligible'),
        'objected', (SELECT count(*) FROM public.crm_customer_contacts c WHERE c.scope_key = b.scope_key AND c.state = 'objected'))
        ORDER BY b.declared_at DESC NULLS LAST)
        FROM public.crm_customer_basis b
        LEFT JOIN public.venues v ON v.id = b.venue_id
        LEFT JOIN public.organizer_profiles op ON op.user_id = b.organizer_user_id
       WHERE p_include_demo
          OR NOT (b.venue_id = ANY (public.demo_venue_ids())
                  OR public.is_demo_email((SELECT u.email FROM auth.users u WHERE u.id = b.organizer_user_id)))
    ), '[]'::jsonb));
END;
$$;

-- beta_on | beta_off | suspend | resume, motif obligatoire, journal admin_audit_log.
CREATE OR REPLACE FUNCTION public.crm_admin_customer_basis_set(
  p_venue_id text, p_organizer_user_id uuid, p_action text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_key IS NULL OR p_action NOT IN ('beta_on', 'beta_off', 'suspend', 'resume') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.crm_customer_basis (scope_key, venue_id, organizer_user_id)
  VALUES (v_key, p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END)
  ON CONFLICT (scope_key) DO NOTHING;

  IF p_action = 'beta_on' THEN
    UPDATE public.crm_customer_basis SET beta_allowed = true, updated_at = now() WHERE scope_key = v_key;
  ELSIF p_action = 'beta_off' THEN
    UPDATE public.crm_customer_basis SET beta_allowed = false, updated_at = now() WHERE scope_key = v_key;
  ELSIF p_action = 'suspend' THEN
    UPDATE public.crm_customer_basis
       SET status = CASE WHEN status = 'off' THEN 'off' ELSE 'suspended' END,
           suspended_at = now(), suspended_reason = 'admin', suspended_by = auth.uid(), updated_at = now()
     WHERE scope_key = v_key;
  ELSE  -- resume : rouvre seulement une base déclarée, dans sa version et sa durée
    UPDATE public.crm_customer_basis b
       SET status = CASE WHEN b.declared_at IS NOT NULL AND b.expires_at > now()
                          AND b.declaration_version = (SELECT declaration_version FROM public.crm_customer_basis_settings WHERE id = 1)
                         THEN 'active' ELSE 'off' END,
           suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL, updated_at = now()
     WHERE scope_key = v_key;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_customer_basis_' || p_action, 'crm_account', v_key,
          jsonb_build_object('reason', btrim(p_reason)));
  RETURN (SELECT to_jsonb(b) - 'acceptance_id' FROM public.crm_customer_basis b WHERE b.scope_key = v_key);
END;
$$;

-- Réglages globaux : ouverture générale, envoi prêt, version, seuils. Motif obligatoire.
CREATE OR REPLACE FUNCTION public.crm_admin_customer_basis_settings_set(p_patch jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before jsonb := public.crm_customer_basis_config();
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'invalid_patch' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.crm_customer_basis_settings SET
    enabled             = COALESCE((p_patch->>'enabled')::boolean, enabled),
    sending_ready       = COALESCE((p_patch->>'sending_ready')::boolean, sending_ready),
    declaration_version = COALESCE(NULLIF(left(btrim(p_patch->>'declaration_version'), 32), ''), declaration_version),
    eligibility_months  = COALESCE((p_patch->>'eligibility_months')::int, eligibility_months),
    validity_months     = COALESCE((p_patch->>'validity_months')::int, validity_months),
    ramp_start          = COALESCE((p_patch->>'ramp_start')::int, ramp_start),
    complaint_pause_pct = COALESCE((p_patch->>'complaint_pause_pct')::numeric, complaint_pause_pct),
    bounce_pause_pct    = COALESCE((p_patch->>'bounce_pause_pct')::numeric, bounce_pause_pct),
    max_per_30d         = COALESCE((p_patch->>'max_per_30d')::int, max_per_30d),
    updated_by = auth.uid(), updated_at = now()
  WHERE id = 1;
  -- Une nouvelle version suspend toutes les bases jusqu'à une nouvelle signature.
  IF (v_before->>'declaration_version') IS DISTINCT FROM (SELECT declaration_version FROM public.crm_customer_basis_settings WHERE id = 1) THEN
    UPDATE public.crm_customer_basis
       SET status = 'suspended', suspended_at = now(), suspended_reason = 'version', updated_at = now()
     WHERE status = 'active';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_customer_basis_settings', 'crm_settings', 'customer_basis',
          jsonb_build_object('reason', btrim(p_reason), 'before', v_before, 'patch', p_patch));
  RETURN public.crm_customer_basis_config();
END;
$$;

-- ── 12. La passe de nuit ────────────────────────────────────────────────────
-- Échéance et version : une base qui n'est plus signée dans la version courante,
-- ou dont la déclaration a plus de 12 mois, se suspend. Puis chaque base active
-- se reconstruit (nouveaux acheteurs, 36 mois, oppositions).
CREATE OR REPLACE FUNCTION public.crm_customer_basis_nightly()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_done int := 0; v_failed int := 0;
  v_version text := (SELECT declaration_version FROM public.crm_customer_basis_settings WHERE id = 1);
BEGIN
  UPDATE public.crm_customer_basis
     SET status = 'suspended', suspended_at = now(),
         suspended_reason = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'version' END, updated_at = now()
   WHERE status = 'active' AND (expires_at <= now() OR declaration_version IS DISTINCT FROM v_version);
  FOR r IN SELECT venue_id, organizer_user_id FROM public.crm_customer_basis WHERE status = 'active' LOOP
    BEGIN
      PERFORM public._crm_customer_contacts_refresh(r.venue_id, r.organizer_user_id);
      v_done := v_done + 1;
    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;   -- un compte en erreur n'arrête pas les autres
    END;
  END LOOP;
  RETURN jsonb_build_object('refreshed', v_done, 'failed', v_failed);
END;
$$;

DO $$ BEGIN
  PERFORM cron.unschedule('crm-customer-basis-nightly');
EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('crm-customer-basis-nightly', '47 3 * * *', $$SELECT public.crm_customer_basis_nightly()$$);

-- ── 13. Droits ──────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  -- Internes : jamais appelables depuis l'API publique.
  FOREACH f IN ARRAY ARRAY[
    'public._crm_customer_own_event(text, uuid, uuid)',
    'public._crm_customer_eligible_rows(text, uuid)',
    'public._crm_customer_contacts_refresh(text, uuid)',
    'public._crm_customer_basis_counts(text, uuid)',
    'public._crm_customer_link_issue(text, text, uuid)',
    'public._crm_customer_content_issues(jsonb, uuid, text, uuid)',
    'public.crm_customer_basis_open(text, uuid)',
    'public.crm_customer_basis_nightly()',
    'public.guard_crm_customer_basis()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  -- Console et Admin CRM (chacune vérifie l'appelant).
  FOREACH f IN ARRAY ARRAY[
    'public.crm_customer_basis_config()',
    'public.crm_customer_basis_get(text, uuid)',
    'public.crm_customer_basis_declare(text, uuid, text, text, text, text, jsonb, text, jsonb)',
    'public.crm_customer_basis_off(text, uuid)',
    'public.crm_customer_report_objection(text, uuid, text[])',
    'public.crm_customer_email_check(uuid)',
    'public.crm_admin_customer_basis(boolean)',
    'public.crm_admin_customer_basis_set(text, uuid, text, text)',
    'public.crm_admin_customer_basis_settings_set(jsonb, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
