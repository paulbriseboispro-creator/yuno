-- Admin, lot 5 : rubrique « Légal » (« Sommes-nous en règle ? »).
--
-- Des ÉCRANS et des REGISTRES, jamais un avis juridique. Rien ici ne change un
-- calcul existant : les RPC ne font qu'assembler ce que la base sait déjà.
--
--   • privacy_requests : registre des demandes des personnes (RGPD art. 12 à 22 :
--     accès, effacement, opposition, rectification, portabilité). Saisie à la main
--     (une demande arrive par e-mail). Échéance = réception + 1 mois, prolongeable
--     de 2 mois avec un motif (art. 12.3). RLS sans policy : tout par les RPC.
--   • content_reports : registre des signalements (DSA, « notice and action »),
--     saisie à la main seulement. Applicabilité à confirmer par un juriste.
--   • crm_incidents.product : le registre des incidents (72 h) vaut pour les deux
--     produits ; `crm_admin_incidents` / `crm_admin_incident_save` restent tels quels.
--   • RPC (super admin, `_crm_admin_gate`, démo par CTE matérialisé) :
--     admin_legal_overview, admin_privacy_requests (+ _save), admin_legal_consents,
--     admin_legal_terms, admin_legal_sellers, admin_legal_incidents (+ _save, _pros),
--     admin_content_reports (+ _save), admin_legal_audit.
--   • Les demandes « automatiques » (suppressions de compte, demandes Meta,
--     effacements venus de la billetterie, effacements CRM) sont LUES là où elles
--     vivent, jamais recopiées.

-- ── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at        timestamptz NOT NULL DEFAULT now(),
  channel            text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'form', 'phone', 'mail', 'other')),
  email              text NOT NULL CHECK (length(trim(email)) >= 3),
  kind               text NOT NULL CHECK (kind IN ('access', 'erasure', 'objection', 'rectification', 'portability', 'other')),
  identity_verified  boolean NOT NULL DEFAULT false,
  account_key        text,
  extension_months   smallint NOT NULL DEFAULT 0 CHECK (extension_months BETWEEN 0 AND 2),
  extension_reason   text,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'refused')),
  response           text,
  note               text,
  handled_by         uuid,
  closed_at          timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (extension_months = 0 OR length(trim(COALESCE(extension_reason, ''))) >= 3)
);
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_requests FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON public.privacy_requests (status, received_at DESC);

CREATE TABLE IF NOT EXISTS public.content_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at        timestamptz NOT NULL DEFAULT now(),
  reporter_name      text,
  reporter_email     text,
  object_kind        text NOT NULL CHECK (object_kind IN ('event', 'pro', 'content', 'other')),
  object_ref         text,
  object_label       text,
  reason             text NOT NULL CHECK (length(trim(reason)) >= 3),
  decision           text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'removed', 'restricted', 'no_action')),
  decided_at         timestamptz,
  statement          text,
  statement_sent_at  timestamptz,
  note               text,
  handled_by         uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_reports FROM anon, authenticated;

ALTER TABLE public.crm_incidents
  ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'crm';
DO $$ BEGIN
  ALTER TABLE public.crm_incidents ADD CONSTRAINT crm_incidents_product_chk CHECK (product IN ('tickets', 'crm', 'both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Les comptes pros (clubs et organisateurs), une ligne chacun ─────────────
-- Clé = crm_scope_key (`venue:<id>` | `org:<uuid>`), celle des fiches du lot 2.
-- Helper sans GRANT : lu par les RPC ci-dessous seulement.

CREATE OR REPLACE FUNCTION public._admin_legal_pros(p_include_demo boolean)
RETURNS TABLE (
  key text, kind text, name text, user_id uuid, email text, is_demo boolean, closed boolean,
  products text[], stripe_account text, charges boolean, payouts boolean,
  legal_name text, siret text, rna text, vat_number text, legal_address text,
  vat_regime text, vat_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
  v(key, kind, name, user_id, email, is_demo, closed, products, stripe_account, charges, payouts, legal_name, siret, rna, vat_number, legal_address, vat_regime, vat_rate) AS (
    SELECT 'venue:' || ve.id AS key, 'club'::text AS kind, ve.name, ve.owner_id AS user_id, p.email,
           (ve.id = ANY (d.dv) OR COALESCE(public.is_demo_email(p.email), false)) AS is_demo,
           (ve.decommissioned_at IS NOT NULL) AS closed,
           ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[COALESCE(ve.product, 'suite')] || COALESCE(ve.extra_products, '{}')) x) AS products,
           ve.stripe_account_id, COALESCE(ve.stripe_charges_enabled, false), COALESCE(ve.stripe_payouts_enabled, false),
           NULLIF(trim(ve.legal_name), ''), NULLIF(trim(ve.siret), ''), NULL::text, NULLIF(trim(ve.vat_number), ''),
           NULLIF(trim(ve.legal_address), ''), 'subject'::text, 20::numeric
      FROM public.venues ve CROSS JOIN d
      LEFT JOIN public.profiles p ON p.id = ve.owner_id
  ),
  o(key, kind, name, user_id, email, is_demo, closed, products, stripe_account, charges, payouts, legal_name, siret, rna, vat_number, legal_address, vat_regime, vat_rate) AS (
    SELECT 'org:' || op.user_id::text, CASE WHEN op.bde_verified THEN 'association' ELSE 'organizer' END,
           COALESCE(op.display_name, p.email), op.user_id, COALESCE(NULLIF(op.billing_email, ''), p.email),
           COALESCE(public.is_demo_email(p.email), false), false,
           ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[COALESCE(op.product, 'suite')] || COALESCE(op.extra_products, '{}')) x),
           p.stripe_connect_account_id, COALESCE(p.stripe_connect_charges_enabled, false), COALESCE(p.stripe_connect_payouts_enabled, false),
           NULLIF(trim(op.legal_name), ''), NULLIF(trim(op.siret), ''), NULLIF(trim(op.rna_number), ''), NULLIF(trim(op.vat_number), ''),
           NULLIF(trim(op.legal_address), ''),
           COALESCE(op.vat_regime, CASE WHEN op.bde_verified THEN 'exempt_association' END),
           public.organizer_vat_rate(op.user_id)
      FROM public.organizer_profiles op
      LEFT JOIN public.profiles p ON p.id = op.user_id
  )
  SELECT * FROM v WHERE p_include_demo OR NOT v.is_demo
  UNION ALL
  SELECT * FROM o WHERE p_include_demo OR NOT o.is_demo;
$$;
REVOKE ALL ON FUNCTION public._admin_legal_pros(boolean) FROM PUBLIC, anon, authenticated;

-- Nom lisible d'une clé de compte (`venue:x` | `org:uuid`).
CREATE OR REPLACE FUNCTION public._admin_legal_key_name(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_key LIKE 'venue:%' THEN (SELECT v.name FROM public.venues v WHERE v.id = substr(p_key, 7))
    WHEN p_key ~ '^org:[0-9a-fA-F-]{36}$' THEN (SELECT COALESCE(op.display_name, pr.email)
                                                 FROM public.profiles pr LEFT JOIN public.organizer_profiles op ON op.user_id = pr.id
                                                WHERE pr.id = substr(p_key, 5)::uuid)
  END;
$$;
REVOKE ALL ON FUNCTION public._admin_legal_key_name(text) FROM PUBLIC, anon, authenticated;

-- Utilisateur titulaire d'une clé (propriétaire du club, organisateur).
CREATE OR REPLACE FUNCTION public._admin_legal_key_user(p_key text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_key LIKE 'venue:%' THEN (SELECT v.owner_id FROM public.venues v WHERE v.id = substr(p_key, 7))
    WHEN p_key ~ '^org:[0-9a-fA-F-]{36}$' THEN substr(p_key, 5)::uuid
  END;
$$;
REVOKE ALL ON FUNCTION public._admin_legal_key_user(text) FROM PUBLIC, anon, authenticated;

-- Dernière version acceptée de chaque document par chaque titulaire.
CREATE OR REPLACE FUNCTION public._admin_legal_accepted(p_include_demo boolean)
RETURNS TABLE (key text, docs jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.key,
         COALESCE((SELECT jsonb_object_agg(l.doc_type, jsonb_build_object('v', l.doc_version, 'at', l.accepted_at))
                     FROM (SELECT DISTINCT ON (la.doc_type) la.doc_type, la.doc_version, la.accepted_at
                             FROM public.legal_acceptances la
                            WHERE la.user_id = p.user_id
                            ORDER BY la.doc_type, la.accepted_at DESC) l), '{}'::jsonb)
    FROM public._admin_legal_pros(p_include_demo) p
   WHERE NOT p.closed;
$$;
REVOKE ALL ON FUNCTION public._admin_legal_accepted(boolean) FROM PUBLIC, anon, authenticated;

-- Manque-t-il une acceptation ? `p_required` = {"suite": ["terms_pro", …], "crm": [...]},
-- `p_versions` = {"terms_pro": "2026-07-06", …} (LEGAL_VERSIONS du front, seule source).
CREATE OR REPLACE FUNCTION public._admin_legal_missing(p_products text[], p_docs jsonb, p_required jsonb, p_versions jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT doc ORDER BY doc), '{}')
    FROM unnest(p_products) prod
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p_required -> prod, '[]'::jsonb)) doc
   WHERE COALESCE(p_docs -> doc ->> 'v', '') IS DISTINCT FROM COALESCE(p_versions ->> doc, '')
      OR (p_docs -> doc) IS NULL;
$$;
REVOKE ALL ON FUNCTION public._admin_legal_missing(text[], jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Demandes des personnes ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_privacy_requests(p_include_demo boolean DEFAULT false, p_limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manual jsonb; v_auto jsonb;
BEGIN
  PERFORM public._crm_admin_gate();

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'closed') = 'true', x->>'deadline'), '[]'::jsonb) INTO v_manual FROM (
    SELECT jsonb_build_object(
             'id', r.id, 'source', 'manual', 'auto', false, 'received_at', r.received_at, 'channel', r.channel,
             'email', r.email, 'kind', r.kind, 'identity_verified', r.identity_verified,
             'account_key', r.account_key, 'account_name', public._admin_legal_key_name(r.account_key),
             'extension_months', r.extension_months, 'extension_reason', r.extension_reason,
             'deadline', r.received_at + make_interval(months => 1 + r.extension_months),
             'status', r.status, 'response', r.response, 'note', r.note,
             'handled_by', (SELECT p.email FROM public.profiles p WHERE p.id = r.handled_by),
             'closed', r.status IN ('done', 'refused'), 'closed_at', r.closed_at) AS x
      FROM public.privacy_requests r
     ORDER BY r.received_at DESC LIMIT GREATEST(1, LEAST(p_limit, 1000))) q;

  -- Lu là où ça vit, jamais recopié. Une ligne = un fait déjà exécuté.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'received_at' DESC), '[]'::jsonb) INTO v_auto FROM (
    SELECT jsonb_build_object('id', 'sec:' || s.id, 'source', 'account_deleted', 'auto', true, 'received_at', s.created_at,
                              'kind', 'erasure', 'status', 'done', 'closed', true, 'email', NULL) AS x
      FROM public.security_logs s WHERE s.action = 'account_deleted'
    UNION ALL
    SELECT jsonb_build_object('id', 'meta:' || m.id, 'source', 'meta', 'auto', true, 'received_at', m.created_at,
                              'kind', CASE WHEN m.kind ILIKE '%deauth%' THEN 'objection' ELSE 'erasure' END,
                              'status', CASE WHEN m.status IN ('done', 'completed', 'processed') THEN 'done' ELSE 'in_progress' END,
                              'closed', m.status IN ('done', 'completed', 'processed'),
                              'detail', jsonb_build_object('kind', m.kind, 'code', m.confirmation_code, 'connections', m.connections_affected, 'raw_status', m.status))
      FROM public.meta_data_requests m
    UNION ALL
    SELECT jsonb_build_object('id', 'tke:' || e.connection_id || ':' || md5(e.email || e.at::text), 'source', 'ticketing_erasure', 'auto', true,
                              'received_at', e.at, 'kind', 'erasure', 'status', 'done', 'closed', true, 'email', e.email,
                              'account_key', public.crm_scope_key(c.venue_id, c.organizer_user_id),
                              'account_name', public._admin_legal_key_name(public.crm_scope_key(c.venue_id, c.organizer_user_id)))
      FROM public.ticketing_erasures e
      LEFT JOIN public.ticketing_connections c ON c.id = e.connection_id
    UNION ALL
    -- Effacements faits DANS le CRM (_crm_erase_contacts) : seule trace = la marque
    -- posée sur les billets, regroupée par connexion et par minute (l'adresse est effacée).
    SELECT jsonb_build_object('id', 'crm:' || g.connection_id || ':' || extract(epoch FROM g.at)::bigint, 'source', 'crm_erasure', 'auto', true,
                              'received_at', g.at, 'kind', 'erasure', 'status', 'done', 'closed', true, 'email', NULL,
                              'account_key', public.crm_scope_key(c.venue_id, c.organizer_user_id),
                              'account_name', public._admin_legal_key_name(public.crm_scope_key(c.venue_id, c.organizer_user_id)),
                              'detail', jsonb_build_object('tickets', g.n))
      FROM (SELECT t.connection_id, date_trunc('minute', t.erased_at) AS at, count(*) AS n
              FROM public.external_tickets t WHERE t.erased_at IS NOT NULL
             GROUP BY 1, 2) g
      LEFT JOIN public.ticketing_connections c ON c.id = g.connection_id
    LIMIT 500
  ) q;

  RETURN jsonb_build_object('at', now(), 'manual', v_manual, 'auto', v_auto);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_privacy_requests(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_privacy_requests(boolean, integer) TO authenticated, service_role;

-- Saisir (p_id NULL) ou mettre à jour une demande. Motif obligatoire, journalisé.
CREATE OR REPLACE FUNCTION public.admin_privacy_request_save(p_id uuid, p_patch jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  k text;
  v_status text;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('received_at', 'channel', 'email', 'kind', 'identity_verified', 'account_key', 'extension_months',
                 'extension_reason', 'status', 'response', 'note') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_status := p_patch->>'status';

  IF v_id IS NULL THEN
    INSERT INTO public.privacy_requests (received_at, channel, email, kind, identity_verified, account_key, status, response, note, created_by, handled_by)
    VALUES (COALESCE(NULLIF(p_patch->>'received_at', '')::timestamptz, now()),
            COALESCE(NULLIF(p_patch->>'channel', ''), 'email'),
            lower(trim(p_patch->>'email')),
            p_patch->>'kind',
            COALESCE((p_patch->>'identity_verified')::boolean, false),
            NULLIF(trim(p_patch->>'account_key'), ''),
            COALESCE(NULLIF(v_status, ''), 'open'),
            left(NULLIF(p_patch->>'response', ''), 4000), left(NULLIF(p_patch->>'note', ''), 4000),
            auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.privacy_requests SET
      received_at = CASE WHEN p_patch ? 'received_at' THEN (p_patch->>'received_at')::timestamptz ELSE received_at END,
      channel = CASE WHEN p_patch ? 'channel' THEN p_patch->>'channel' ELSE channel END,
      email = CASE WHEN p_patch ? 'email' THEN lower(trim(p_patch->>'email')) ELSE email END,
      kind = CASE WHEN p_patch ? 'kind' THEN p_patch->>'kind' ELSE kind END,
      identity_verified = CASE WHEN p_patch ? 'identity_verified' THEN (p_patch->>'identity_verified')::boolean ELSE identity_verified END,
      account_key = CASE WHEN p_patch ? 'account_key' THEN NULLIF(trim(p_patch->>'account_key'), '') ELSE account_key END,
      extension_months = CASE WHEN p_patch ? 'extension_months' THEN COALESCE(NULLIF(p_patch->>'extension_months', '')::smallint, 0) ELSE extension_months END,
      extension_reason = CASE WHEN p_patch ? 'extension_reason' THEN left(NULLIF(trim(p_patch->>'extension_reason'), ''), 1000) ELSE extension_reason END,
      status = CASE WHEN p_patch ? 'status' THEN v_status ELSE status END,
      response = CASE WHEN p_patch ? 'response' THEN left(NULLIF(p_patch->>'response', ''), 4000) ELSE response END,
      note = CASE WHEN p_patch ? 'note' THEN left(NULLIF(p_patch->>'note', ''), 4000) ELSE note END,
      closed_at = CASE WHEN p_patch ? 'status' THEN CASE WHEN v_status IN ('done', 'refused') THEN COALESCE(closed_at, now()) ELSE NULL END ELSE closed_at END,
      handled_by = auth.uid(),
      updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'privacy_request_created' ELSE 'privacy_request_updated' END, 'privacy_request', v_id::text,
          jsonb_build_object('reason', left(trim(p_reason), 300), 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x),
                             'status', v_status));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_privacy_request_save(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_privacy_request_save(uuid, jsonb, text) TO authenticated, service_role;

-- ── Signalements (DSA) ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_content_reports()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('at', now(), 'reports', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'received_at', r.received_at, 'reporter_name', r.reporter_name, 'reporter_email', r.reporter_email,
             'object_kind', r.object_kind, 'object_ref', r.object_ref, 'object_label', r.object_label, 'reason', r.reason,
             'decision', r.decision, 'decided_at', r.decided_at, 'statement', r.statement, 'statement_sent_at', r.statement_sent_at,
             'note', r.note, 'handled_by', (SELECT p.email FROM public.profiles p WHERE p.id = r.handled_by))
           ORDER BY (r.decision <> 'pending'), r.received_at DESC)
      FROM public.content_reports r), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_content_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_content_reports() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_content_report_save(p_id uuid, p_patch jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  k text;
  v_decision text := p_patch->>'decision';
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('received_at', 'reporter_name', 'reporter_email', 'object_kind', 'object_ref', 'object_label', 'reason',
                 'decision', 'statement', 'statement_sent_at', 'note') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_id IS NULL THEN
    INSERT INTO public.content_reports (received_at, reporter_name, reporter_email, object_kind, object_ref, object_label, reason,
                                        decision, decided_at, statement, statement_sent_at, note, created_by, handled_by)
    VALUES (COALESCE(NULLIF(p_patch->>'received_at', '')::timestamptz, now()),
            left(NULLIF(trim(p_patch->>'reporter_name'), ''), 200), lower(NULLIF(trim(p_patch->>'reporter_email'), '')),
            p_patch->>'object_kind', left(NULLIF(trim(p_patch->>'object_ref'), ''), 300), left(NULLIF(trim(p_patch->>'object_label'), ''), 300),
            left(trim(p_patch->>'reason'), 4000),
            COALESCE(NULLIF(v_decision, ''), 'pending'),
            CASE WHEN COALESCE(NULLIF(v_decision, ''), 'pending') <> 'pending' THEN now() END,
            left(NULLIF(p_patch->>'statement', ''), 4000), NULLIF(p_patch->>'statement_sent_at', '')::timestamptz,
            left(NULLIF(p_patch->>'note', ''), 4000), auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.content_reports SET
      received_at = CASE WHEN p_patch ? 'received_at' THEN (p_patch->>'received_at')::timestamptz ELSE received_at END,
      reporter_name = CASE WHEN p_patch ? 'reporter_name' THEN left(NULLIF(trim(p_patch->>'reporter_name'), ''), 200) ELSE reporter_name END,
      reporter_email = CASE WHEN p_patch ? 'reporter_email' THEN lower(NULLIF(trim(p_patch->>'reporter_email'), '')) ELSE reporter_email END,
      object_kind = CASE WHEN p_patch ? 'object_kind' THEN p_patch->>'object_kind' ELSE object_kind END,
      object_ref = CASE WHEN p_patch ? 'object_ref' THEN left(NULLIF(trim(p_patch->>'object_ref'), ''), 300) ELSE object_ref END,
      object_label = CASE WHEN p_patch ? 'object_label' THEN left(NULLIF(trim(p_patch->>'object_label'), ''), 300) ELSE object_label END,
      reason = CASE WHEN p_patch ? 'reason' THEN left(trim(p_patch->>'reason'), 4000) ELSE reason END,
      decision = CASE WHEN p_patch ? 'decision' THEN v_decision ELSE decision END,
      decided_at = CASE WHEN p_patch ? 'decision' THEN CASE WHEN v_decision = 'pending' THEN NULL ELSE COALESCE(decided_at, now()) END ELSE decided_at END,
      statement = CASE WHEN p_patch ? 'statement' THEN left(NULLIF(p_patch->>'statement', ''), 4000) ELSE statement END,
      statement_sent_at = CASE WHEN p_patch ? 'statement_sent_at' THEN NULLIF(p_patch->>'statement_sent_at', '')::timestamptz ELSE statement_sent_at END,
      note = CASE WHEN p_patch ? 'note' THEN left(NULLIF(p_patch->>'note', ''), 4000) ELSE note END,
      handled_by = auth.uid(),
      updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN p_id IS NULL THEN 'content_report_created' ELSE 'content_report_updated' END, 'content_report', v_id::text,
          jsonb_build_object('reason', left(trim(p_reason), 300), 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x),
                             'decision', v_decision));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_content_report_save(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_content_report_save(uuid, jsonb, text) TO authenticated, service_role;

-- ── Incidents, les deux produits ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_legal_incidents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('at', now(), 'incidents', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'product', i.product, 'declared_at', i.declared_at, 'discovered_at', i.discovered_at, 'nature', i.nature,
             'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'name', public._admin_legal_key_name(k))) FROM unnest(i.accounts) k), '[]'::jsonb),
             'persons_estimate', i.persons_estimate, 'measures', i.measures,
             'cnil_notified_at', i.cnil_notified_at, 'cnil_reference', i.cnil_reference,
             'pros_notified_at', i.pros_notified_at, 'closed_at', i.closed_at,
             'deadline', i.discovered_at + interval '72 hours',
             'audit', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'reason', a.metadata->>'reason') ORDER BY a.created_at DESC)
                         FROM public.admin_audit_log a WHERE a.entity_type = 'crm_incident' AND a.entity_id = i.id::text), '[]'::jsonb))
           ORDER BY (i.closed_at IS NOT NULL), i.discovered_at DESC)
      FROM public.crm_incidents i), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_incidents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_incidents() TO authenticated, service_role;

-- Même geste que crm_admin_incident_save (journal compris), plus le produit.
CREATE OR REPLACE FUNCTION public.admin_legal_incident_save(p_id uuid, p_patch jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_product text := NULLIF(p_patch->>'product', '');
BEGIN
  PERFORM public._crm_admin_gate();
  IF v_product IS NOT NULL AND v_product NOT IN ('tickets', 'crm', 'both') THEN RAISE EXCEPTION 'bad_product' USING ERRCODE = '22023'; END IF;
  v_id := public.crm_admin_incident_save(p_id, p_patch - 'product', p_reason);
  IF v_product IS NOT NULL THEN
    UPDATE public.crm_incidents SET product = v_product WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_incident_save(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_incident_save(uuid, jsonb, text) TO authenticated, service_role;

-- La liste des pros à prévenir, PRÉPARÉE (jamais envoyée), clubs et organisateurs.
CREATE OR REPLACE FUNCTION public.admin_legal_incident_pros(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_acc text[];
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT accounts INTO v_acc FROM public.crm_incidents WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_incident_pros_prepared', 'crm_incident', p_id::text,
          jsonb_build_object('reason', 'liste préparée', 'n', COALESCE(array_length(v_acc, 1), 0)));
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'email', p.email, 'is_demo', p.is_demo) ORDER BY p.name)
                     FROM public._admin_legal_pros(true) p WHERE p.key = ANY (v_acc)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_incident_pros(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_incident_pros(uuid) TO authenticated, service_role;

-- ── Conditions acceptées ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_legal_terms(p_versions jsonb, p_required jsonb, p_include_demo boolean DEFAULT false, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(p_days, 3660)));
  v_prev timestamptz := now() - make_interval(days => 2 * GREATEST(1, LEAST(p_days, 3660)));
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object(
    'at', now(),
    'docs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('doc', g.doc_type, 'version', g.doc_version, 'people', g.people, 'n', g.n, 'last', g.last)
                       ORDER BY g.doc_type, g.doc_version DESC)
        FROM (SELECT la.doc_type, la.doc_version, count(DISTINCT la.user_id) AS people, count(*) AS n, max(la.accepted_at) AS last
                FROM public.legal_acceptances la
               WHERE p_include_demo OR NOT COALESCE(public.is_demo_email(la.email), false)
               GROUP BY la.doc_type, la.doc_version) g), '[]'::jsonb),
    'pros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', p.key, 'kind', p.kind, 'name', p.name, 'email', p.email, 'is_demo', p.is_demo,
                                          'products', to_jsonb(p.products), 'docs', a.docs,
                                          'missing', to_jsonb(public._admin_legal_missing(p.products, a.docs, p_required, p_versions)))
                       ORDER BY cardinality(public._admin_legal_missing(p.products, a.docs, p_required, p_versions)) DESC, p.name)
        FROM public._admin_legal_pros(p_include_demo) p
        JOIN public._admin_legal_accepted(p_include_demo) a ON a.key = p.key
       WHERE NOT p.closed), '[]'::jsonb),
    'buyers', jsonb_build_object(
      'total', (SELECT count(*) FROM public.terms_acceptances),
      'period', (SELECT count(*) FROM public.terms_acceptances WHERE accepted_at >= v_from),
      'previous', (SELECT count(*) FROM public.terms_acceptances WHERE accepted_at >= v_prev AND accepted_at < v_from),
      'by', COALESCE((SELECT jsonb_agg(jsonb_build_object('context', COALESCE(t.context, 'other'), 'version', t.terms_version, 'n', t.n, 'last', t.last) ORDER BY t.n DESC)
                       FROM (SELECT context, terms_version, count(*) AS n, max(accepted_at) AS last FROM public.terms_acceptances GROUP BY 1, 2) t), '[]'::jsonb)));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_terms(jsonb, jsonb, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_terms(jsonb, jsonb, boolean, integer) TO authenticated, service_role;

-- ── Vendeurs ───────────────────────────────────────────────────────────────
-- Ventes ENCAISSÉES par le compte Stripe du pro (charges directes), payées dans
-- l'année (heure de Paris), remboursements déduits. Montant = CA club de fees.ts
-- (billet : total − frais de service − assurance ; table : total − frais de
-- service − frais de gestion absorbés). Un tableau de suivi, pas une déclaration.

CREATE OR REPLACE FUNCTION public.admin_legal_sellers(p_year integer DEFAULT NULL, p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::int);
  v_from timestamptz := make_timestamptz(v_year, 1, 1, 0, 0, 0, 'Europe/Paris');
  v_to   timestamptz := make_timestamptz(v_year + 1, 1, 1, 0, 0, 0, 'Europe/Paris');
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('at', now(), 'year', v_year, 'sellers', COALESCE((
    WITH pros AS MATERIALIZED (SELECT * FROM public._admin_legal_pros(p_include_demo) WHERE NOT closed),
    sales AS MATERIALIZED (
      SELECT t.stripe_connected_account_id AS acct, 'ticket'::text AS k, t.id,
             COALESCE(t.total_price, 0) - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0) - COALESCE(t.refund_amount, 0) AS amount,
             EXISTS (SELECT 1 FROM public.invoice_numbers i WHERE i.ticket_id = t.id) AS invoiced,
             COALESCE(t.paid_at, t.created_at) AS at
        FROM public.tickets t
       WHERE t.stripe_connected_account_id IS NOT NULL AND t.status IN ('paid', 'used')
         AND COALESCE(t.paid_at, t.created_at) >= v_from AND COALESCE(t.paid_at, t.created_at) < v_to
      UNION ALL
      SELECT r.stripe_connected_account_id, 'table', r.id,
             COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - CASE WHEN r.fee_absorbed THEN COALESCE(r.management_fee, 0) ELSE 0 END - COALESCE(r.refund_amount, 0),
             EXISTS (SELECT 1 FROM public.invoice_numbers i WHERE i.table_reservation_id = r.id),
             COALESCE(r.paid_at, r.created_at)
        FROM public.table_reservations r
       WHERE r.stripe_connected_account_id IS NOT NULL AND r.status IN ('paid', 'confirmed')
         AND COALESCE(r.paid_at, r.created_at) >= v_from AND COALESCE(r.paid_at, r.created_at) < v_to
    ),
    agg AS (
      SELECT acct, count(*) AS n, sum(amount) AS amount,
             count(*) FILTER (WHERE invoiced) AS invoiced,
             count(*) FILTER (WHERE NOT invoiced AND at < now() - interval '1 hour') AS missing
        FROM sales GROUP BY acct
    )
    SELECT jsonb_agg(jsonb_build_object(
             'key', p.key, 'kind', p.kind, 'name', p.name, 'email', p.email, 'is_demo', p.is_demo,
             'legal_name', p.legal_name, 'siret', p.siret, 'rna', p.rna, 'vat_number', p.vat_number,
             'legal_address', p.legal_address, 'vat_regime', p.vat_regime, 'vat_rate', p.vat_rate,
             'stripe_account', p.stripe_account IS NOT NULL, 'charges', p.charges, 'payouts', p.payouts,
             'sales', COALESCE(a.n, 0), 'amount', round(COALESCE(a.amount, 0)::numeric, 2),
             'invoiced', COALESCE(a.invoiced, 0), 'missing_invoices', COALESCE(a.missing, 0),
             'invoices_issued', (SELECT count(*) FROM public.invoice_numbers i
                                  WHERE i.invoice_year = v_year
                                    AND ((p.kind = 'club' AND i.venue_id = substr(p.key, 7) AND COALESCE(i.seller_kind, 'venue') = 'venue')
                                      OR (p.kind <> 'club' AND i.organizer_user_id = p.user_id AND i.seller_kind = 'organizer'))))
           ORDER BY COALESCE(a.amount, 0) DESC, p.name)
      FROM pros p
      LEFT JOIN agg a ON a.acct = p.stripe_account
     WHERE p.stripe_account IS NOT NULL OR a.n IS NOT NULL), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_sellers(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_sellers(integer, boolean) TO authenticated, service_role;

-- ── Consentements et preuves ───────────────────────────────────────────────
-- Par produit : NULL = Yuno Tickets, 'crm' = Yuno CRM, la portée plateforme
-- (les deux colonnes de portée à NULL) à part. `p_email` : la preuve d'UNE adresse.

CREATE OR REPLACE FUNCTION public.admin_legal_consents(p_include_demo boolean DEFAULT false, p_email text DEFAULT NULL, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(p_days, 3660)));
  v_prev timestamptz := now() - make_interval(days => 2 * GREATEST(1, LEAST(p_days, 3660)));
  v_out jsonb;
BEGIN
  PERFORM public._crm_admin_gate();

  WITH d AS MATERIALIZED (
    SELECT public.demo_venue_ids() AS dv,
           COALESCE((SELECT array_agg(p.id) FROM public.profiles p WHERE public.is_demo_email(p.email)), '{}') AS dorg
  ),
  ns AS MATERIALIZED (
    SELECT CASE WHEN n.venue_id IS NULL AND n.organizer_user_id IS NULL THEN 'platform' WHEN n.product = 'crm' THEN 'crm' ELSE 'tickets' END AS prod,
           n.opted_in, lower(n.email) AS email, n.venue_id, n.organizer_user_id, n.import_id, n.created_at
      FROM public.newsletter_subscriptions n CROSS JOIN d
     WHERE p_include_demo OR NOT (COALESCE(n.venue_id = ANY (d.dv), false) OR COALESCE(n.organizer_user_id = ANY (d.dorg), false))
  ),
  ev AS MATERIALIZED (
    SELECT DISTINCT lower(e.email) AS email, e.venue_id, e.organizer_user_id
      FROM public.marketing_consent_events e
     WHERE e.channel = 'email' AND e.action IN ('opt_in', 'granted', 'subscribe') AND e.email IS NOT NULL
  ),
  sms AS MATERIALIZED (
    SELECT CASE WHEN c.venue_id IS NULL AND c.organizer_user_id IS NULL THEN 'platform' WHEN c.product = 'crm' THEN 'crm' ELSE 'tickets' END AS prod,
           NOT COALESCE(c.unsubscribed, false) AS ok
      FROM public.venue_sms_contacts c CROSS JOIN d
     WHERE p_include_demo OR NOT (COALESCE(c.venue_id = ANY (d.dv), false) OR COALESCE(c.organizer_user_id = ANY (d.dorg), false))
  ),
  imp AS MATERIALIZED (
    SELECT l.id, l.created_at, COALESCE(l.list_name, l.filename) AS title, l.consent_source, l.attested_at, COALESCE(l.attested_via_support, false) AS via_support,
           l.superseded_at IS NOT NULL AS superseded, CASE WHEN l.product = 'crm' THEN 'crm' WHEN l.venue_id IS NULL AND l.organizer_user_id IS NULL THEN 'platform' ELSE 'tickets' END AS prod,
           public.crm_scope_key(l.venue_id, l.organizer_user_id) AS key, l.row_count AS rows, 'contact'::text AS src
      FROM public.contact_list_imports l CROSS JOIN d
     WHERE p_include_demo OR NOT (COALESCE(l.venue_id = ANY (d.dv), false) OR COALESCE(l.organizer_user_id = ANY (d.dorg), false))
    UNION ALL
    SELECT l.id, l.created_at, COALESCE(l.list_name, l.filename), l.consent_source, l.attested_at, COALESCE(l.attested_via_support, false),
           l.superseded_at IS NOT NULL, CASE WHEN l.product = 'crm' THEN 'crm' WHEN l.venue_id IS NULL AND l.organizer_user_id IS NULL THEN 'platform' ELSE 'tickets' END,
           public.crm_scope_key(l.venue_id, l.organizer_user_id), l.submitted_count, 'email'
      FROM public.email_list_imports l CROSS JOIN d
     WHERE NOT EXISTS (SELECT 1 FROM public.contact_list_imports c WHERE c.email_import_id = l.id)
       AND (p_include_demo OR NOT (COALESCE(l.venue_id = ANY (d.dv), false) OR COALESCE(l.organizer_user_id = ANY (d.dorg), false)))
    UNION ALL
    SELECT l.id, l.created_at, COALESCE(l.list_name, l.filename), l.consent_source, l.attested_at, COALESCE(l.attested_via_support, false),
           l.superseded_at IS NOT NULL, CASE WHEN l.product = 'crm' THEN 'crm' WHEN l.venue_id IS NULL AND l.organizer_user_id IS NULL THEN 'platform' ELSE 'tickets' END,
           public.crm_scope_key(l.venue_id, l.organizer_user_id), l.submitted_count, 'sms'
      FROM public.sms_list_imports l CROSS JOIN d
     WHERE NOT EXISTS (SELECT 1 FROM public.contact_list_imports c WHERE c.sms_import_id = l.id)
       AND (p_include_demo OR NOT (COALESCE(l.venue_id = ANY (d.dv), false) OR COALESCE(l.organizer_user_id = ANY (d.dorg), false)))
  )
  SELECT jsonb_build_object(
    'products', (SELECT COALESCE(jsonb_object_agg(x.prod, x.v), '{}'::jsonb) FROM (
       SELECT p.prod, jsonb_build_object(
                'subscribed', (SELECT count(*) FROM ns WHERE ns.prod = p.prod AND ns.opted_in),
                'unsubscribed', (SELECT count(*) FROM ns WHERE ns.prod = p.prod AND NOT ns.opted_in),
                'with_proof', (SELECT count(*) FROM ns WHERE ns.prod = p.prod AND ns.opted_in
                                AND EXISTS (SELECT 1 FROM ev WHERE ev.email = ns.email
                                             AND ev.venue_id IS NOT DISTINCT FROM ns.venue_id AND ev.organizer_user_id IS NOT DISTINCT FROM ns.organizer_user_id)),
                'from_import', (SELECT count(*) FROM ns WHERE ns.prod = p.prod AND ns.opted_in AND ns.import_id IS NOT NULL),
                'new_period', (SELECT count(*) FROM ns WHERE ns.prod = p.prod AND ns.opted_in AND ns.created_at >= v_from),
                'new_previous', (SELECT count(*) FROM ns WHERE ns.prod = p.prod AND ns.opted_in AND ns.created_at >= v_prev AND ns.created_at < v_from),
                'sms_ok', (SELECT count(*) FROM sms WHERE sms.prod = p.prod AND sms.ok),
                'sms_stop', (SELECT count(*) FROM sms WHERE sms.prod = p.prod AND NOT sms.ok),
                'imports', (SELECT count(*) FROM imp WHERE imp.prod = p.prod),
                'imports_support', (SELECT count(*) FROM imp WHERE imp.prod = p.prod AND imp.via_support),
                'imports_unattested', (SELECT count(*) FROM imp WHERE imp.prod = p.prod AND imp.attested_at IS NULL)) AS v
         FROM (VALUES ('tickets'), ('crm'), ('platform')) p(prod)) x),
    'events', jsonb_build_object(
       'granted_period', (SELECT count(*) FROM public.marketing_consent_events e WHERE e.action = 'granted' AND e.occurred_at >= v_from),
       'granted_previous', (SELECT count(*) FROM public.marketing_consent_events e WHERE e.action = 'granted' AND e.occurred_at >= v_prev AND e.occurred_at < v_from),
       'withdrawn_period', (SELECT count(*) FROM public.marketing_consent_events e WHERE e.action = 'withdrawn' AND e.occurred_at >= v_from),
       'withdrawn_previous', (SELECT count(*) FROM public.marketing_consent_events e WHERE e.action = 'withdrawn' AND e.occurred_at >= v_prev AND e.occurred_at < v_from)),
    'suppressions', jsonb_build_object(
       'email_opt_outs', (SELECT count(*) FROM public.email_opt_outs),
       'email_suppressions', (SELECT count(*) FROM public.email_suppressions),
       'by_reason', COALESCE((SELECT jsonb_object_agg(s.reason, s.n) FROM (SELECT COALESCE(reason, 'other') AS reason, count(*) AS n FROM public.email_suppressions GROUP BY 1) s), '{}'::jsonb),
       'sms_stop', (SELECT count(*) FROM public.sms_stop_list)),
    'imports', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'at', i.created_at, 'title', i.title, 'consent', i.consent_source,
                                                            'attested_at', i.attested_at, 'via_support', i.via_support, 'superseded', i.superseded,
                                                            'product', i.prod, 'key', i.key, 'name', public._admin_legal_key_name(i.key),
                                                            'rows', i.rows, 'channel', i.src) ORDER BY i.created_at DESC)
                          FROM (SELECT * FROM imp ORDER BY created_at DESC LIMIT 100) i), '[]'::jsonb)
  ) INTO v_out;

  IF length(v_email) >= 3 THEN
    v_out := v_out || jsonb_build_object('proof', jsonb_build_object(
      'email', v_email,
      'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', e.occurred_at, 'action', e.action, 'channel', e.channel, 'source', e.source,
                                                             'text', e.wording_text, 'key', e.wording_key, 'locale', e.locale, 'phone', e.phone_e164,
                                                             'scope', public.crm_scope_key(e.venue_id, e.organizer_user_id),
                                                             'name', public._admin_legal_key_name(public.crm_scope_key(e.venue_id, e.organizer_user_id)))
                                           ORDER BY e.occurred_at DESC)
                            FROM public.marketing_consent_events e WHERE lower(e.email) = v_email), '[]'::jsonb),
      'subscriptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('scope', public.crm_scope_key(n.venue_id, n.organizer_user_id),
                                                                    'name', public._admin_legal_key_name(public.crm_scope_key(n.venue_id, n.organizer_user_id)),
                                                                    'product', CASE WHEN n.venue_id IS NULL AND n.organizer_user_id IS NULL THEN 'platform' WHEN n.product = 'crm' THEN 'crm' ELSE 'tickets' END,
                                                                    'opted_in', n.opted_in, 'source', n.source, 'consent_source', n.consent_source,
                                                                    'recorded_at', COALESCE(n.consent_recorded_at, n.created_at), 'opted_out_at', n.opted_out_at,
                                                                    'from_import', n.import_id IS NOT NULL)
                                                  ORDER BY n.created_at DESC)
                                   FROM public.newsletter_subscriptions n WHERE lower(n.email) = v_email), '[]'::jsonb),
      'suppressed', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', s.created_at, 'reason', s.reason, 'source', s.source) ORDER BY s.created_at DESC)
                                FROM public.email_suppressions s WHERE lower(s.email) = v_email), '[]'::jsonb),
      'opt_outs', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', o.opted_out_at, 'reason', o.reason,
                                                                'name', public._admin_legal_key_name(public.crm_scope_key(o.venue_id, o.organizer_user_id))) ORDER BY o.opted_out_at DESC)
                              FROM public.email_opt_outs o WHERE lower(o.email) = v_email), '[]'::jsonb),
      'terms', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', t.accepted_at, 'version', t.terms_version, 'context', t.context) ORDER BY t.accepted_at DESC)
                           FROM public.terms_acceptances t
                          WHERE lower(t.guest_email) = v_email
                             OR t.user_id IN (SELECT p.id FROM public.profiles p WHERE lower(p.email) = v_email)), '[]'::jsonb),
      'legal', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', l.accepted_at, 'doc', l.doc_type, 'version', l.doc_version) ORDER BY l.accepted_at DESC)
                           FROM public.legal_acceptances l WHERE lower(l.email) = v_email), '[]'::jsonb)));
  END IF;
  RETURN v_out || jsonb_build_object('at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_consents(boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_consents(boolean, text, integer) TO authenticated, service_role;

-- ── Journal d'audit unique ─────────────────────────────────────────────────
-- admin_audit_log (gestes du super admin, Suite comme ex-Admin CRM) ∪
-- admin_support_audit (accès assisté, agent compris).

CREATE OR REPLACE FUNCTION public.admin_legal_audit(
  p_days integer DEFAULT 30, p_source text DEFAULT 'all', p_account text DEFAULT NULL, p_q text DEFAULT NULL, p_limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := CASE WHEN COALESCE(p_days, 0) <= 0 THEN '-infinity'::timestamptz ELSE now() - make_interval(days => LEAST(p_days, 3660)) END;
  v_key text := NULLIF(trim(COALESCE(p_account, '')), '');
  v_user uuid := public._admin_legal_key_user(NULLIF(trim(COALESCE(p_account, '')), ''));
  v_id text := CASE WHEN v_key LIKE 'venue:%' THEN substr(v_key, 7) WHEN v_key LIKE 'org:%' THEN substr(v_key, 5) END;
  v_q text := NULLIF(lower(trim(COALESCE(p_q, ''))), '');
  v_rows jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  IF p_source NOT IN ('all', 'admin', 'support', 'agent') THEN RAISE EXCEPTION 'bad_source' USING ERRCODE = '22023'; END IF;

  WITH a AS (
    SELECT l.id::text AS id, l.created_at AS at, 'admin'::text AS source, l.admin_id AS actor, l.action, l.entity_type, l.entity_id,
           NULL::uuid AS target, l.metadata->>'reason' AS reason, l.metadata AS detail
      FROM public.admin_audit_log l
     WHERE p_source IN ('all', 'admin') AND l.created_at >= v_from
       AND (v_key IS NULL OR l.entity_id IN (v_key, v_id) OR l.entity_id = v_user::text)
    UNION ALL
    SELECT s.id::text, s.created_at, CASE WHEN s.detail->>'via' = 'agent' THEN 'agent' ELSE 'support' END, s.actor_id, s.action,
           s.table_name, s.row_pk, s.target_user_id, COALESCE(s.detail->>'why', s.detail->>'reason'), s.detail
      FROM public.admin_support_audit s
     WHERE (p_source = 'all' OR (p_source = 'agent' AND s.detail->>'via' = 'agent')
            OR (p_source = 'support' AND COALESCE(s.detail->>'via', '') <> 'agent'))
       AND s.created_at >= v_from
       AND (v_key IS NULL OR s.target_user_id = v_user)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id, 'at', x.at, 'source', x.source, 'actor', (SELECT p.email FROM public.profiles p WHERE p.id = x.actor),
           'action', x.action, 'entity_type', x.entity_type, 'entity_id', x.entity_id,
           'target', (SELECT p.email FROM public.profiles p WHERE p.id = x.target), 'reason', x.reason, 'detail', x.detail)
         ORDER BY x.at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT * FROM a
           WHERE v_q IS NULL OR lower(a.action) LIKE '%' || v_q || '%' OR lower(COALESCE(a.entity_type, '')) LIKE '%' || v_q || '%'
              OR lower(COALESCE(a.entity_id, '')) LIKE '%' || v_q || '%' OR lower(COALESCE(a.reason, '')) LIKE '%' || v_q || '%'
           ORDER BY a.at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 300), 1000))) x;

  RETURN jsonb_build_object('at', now(), 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_audit(integer, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_audit(integer, text, text, text, integer) TO authenticated, service_role;

-- ── Vue d'ensemble ─────────────────────────────────────────────────────────
-- Les compteurs ; l'état (en règle / à traiter / en retard) se décide au front
-- (`src/admin/legal/status.ts`, testé) pour que les seuils se lisent en un endroit.

CREATE OR REPLACE FUNCTION public.admin_legal_overview(p_versions jsonb, p_required jsonb, p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object(
    'at', now(),
    'requests', (SELECT jsonb_build_object(
        'open', count(*),
        'overdue', count(*) FILTER (WHERE r.received_at + make_interval(months => 1 + r.extension_months) < now()),
        'next', min(r.received_at + make_interval(months => 1 + r.extension_months)))
      FROM public.privacy_requests r WHERE r.status IN ('open', 'in_progress')),
    'incidents', (SELECT jsonb_build_object(
        'open', count(*),
        'cnil_pending', count(*) FILTER (WHERE i.cnil_notified_at IS NULL),
        'overdue', count(*) FILTER (WHERE i.cnil_notified_at IS NULL AND i.discovered_at + interval '72 hours' < now()),
        'next', min(i.discovered_at + interval '72 hours') FILTER (WHERE i.cnil_notified_at IS NULL))
      FROM public.crm_incidents i WHERE i.closed_at IS NULL),
    'terms', (SELECT jsonb_build_object(
        'pros', count(*),
        'missing', count(*) FILTER (WHERE cardinality(public._admin_legal_missing(p.products, a.docs, p_required, p_versions)) > 0))
      FROM public._admin_legal_pros(p_include_demo) p JOIN public._admin_legal_accepted(p_include_demo) a ON a.key = p.key
     WHERE NOT p.closed),
    'sellers', (SELECT jsonb_build_object(
        'with_stripe', count(*),
        'incomplete', count(*) FILTER (WHERE p.legal_name IS NULL OR (p.siret IS NULL AND p.rna IS NULL) OR p.legal_address IS NULL))
      FROM public._admin_legal_pros(p_include_demo) p WHERE NOT p.closed AND p.stripe_account IS NOT NULL),
    'deadlines', (SELECT jsonb_build_object(
        'active', count(*),
        'undated', count(*) FILTER (WHERE d.due_at IS NULL),
        'soon', count(*) FILTER (WHERE d.due_at >= current_date AND d.due_at <= current_date + 30),
        'overdue', count(*) FILTER (WHERE d.due_at < current_date),
        'next', min(d.due_at) FILTER (WHERE d.due_at >= current_date))
      FROM public.admin_credential_deadlines d WHERE d.is_active),
    'support', jsonb_build_object(
        'grants', (SELECT count(*) FROM public.admin_support_grants g WHERE g.status = 'active' AND g.revoked_at IS NULL),
        'sessions', (SELECT count(*) FROM public.admin_support_sessions s WHERE s.ended_at IS NULL AND s.expires_at > now())),
    'reports', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE c.decision = 'pending'), 'total', count(*))
      FROM public.content_reports c)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_legal_overview(jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_legal_overview(jsonb, jsonb, boolean) TO authenticated, service_role;
