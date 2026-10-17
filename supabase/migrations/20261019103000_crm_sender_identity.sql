-- Yuno CRM : aucun e-mail ne part sans l'identité de l'expéditeur.
--
-- Constaté le 17/10 sur le premier vrai compte (Shotgun de WOH testé dans
-- l'espace Amoris) : `crm_email_settings` était vide, un envoi serait parti
-- « Amoris <amoris@news.yunoapp.eu> » sans adresse postale, à 299 personnes qui
-- avaient dit oui à WOH. Rien ne le bloquait.
--
-- Une campagne CRM (crm_campaign_is_crm) ne part plus — ni maintenant, ni
-- programmée, ni en test, ni par une automatisation, un scénario ou une page
-- d'inscription — tant que l'espace n'a pas, dans Réglages › Envoi :
--   1. un nom d'expéditeur (ce que la boîte de réception affiche) ;
--   2. une raison sociale (qui envoie au sens de la loi : LCEN art. 20,
--      CPCE L.34-5) ;
--   3. une adresse postale complète (numéro, rue, code postal, ville) ;
-- et que le TITULAIRE de l'espace a accepté les Conditions Yuno CRM et
-- l'accord de sous-traitance (legal_acceptances `terms_crm` + `dpa`).
--
-- La raison sociale vit dans `crm_email_settings`, PAS dans
-- `organizer_profiles.legal_name` / `venues.legal_name` : celle-là est le
-- vendeur des reçus de la Billetterie. Un compte Billetterie + CRM peut écrire
-- au nom d'une autre structure que celle qui vend (Amoris teste le Shotgun de
-- WOH). L'identité du compte n'est qu'une SUGGESTION à l'écran, jamais
-- recopiée d'office : la personne la saisit ou la confirme.
--
-- Porte unique : `_crm_email_identity(venue, orga)` (manques stables :
-- sender_name, legal_name, postal_address, terms). Miroir front des règles de
-- champ : `src/crm/lib/emailIdentity.ts` (testé).
--
-- Où elle s'applique :
--   - trigger `trg_guard_crm_sender_identity` (email_campaigns, passage en
--     `sending` / `scheduled`) : une campagne MANUELLE est refusée
--     (`crm_sender_identity`, P0001) ; un ENFANT (automatisation, scénario,
--     page d'inscription, renvoi, relance) est mis EN PAUSE
--     (`paused_reason = 'sender_identity'`) — lever ferait tomber la collecte
--     des autres comptes, même modèle que `guard_crm_send_frozen` ;
--   - send-campaign : test et mise en file refusés (402 `crm_sender_identity`) ;
--   - reprise : dès que l'identité est complète (Réglages › Envoi, ou
--     acceptation des conditions par le titulaire), les enfants en pause
--     repartent, sauf ceux d'une soirée déjà commencée (annulés : rien ne part
--     en retard).
-- Le périmètre démo est exempté : il n'envoie jamais rien (demo_no_send).
--
-- Et une recette réglée depuis la Console CRM porte `product = 'crm'`
-- (email_automations), dont héritent ses e-mails : sur un compte Billetterie +
-- CRM, ils étaient classés Billetterie et échappaient à tout ceci (§ 7).

-- ── 1. La raison sociale de l'expéditeur ─────────────────────────────────────
ALTER TABLE public.crm_email_settings
  ADD COLUMN IF NOT EXISTS legal_name text
  CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 2 AND 160);

-- ── 2. Porte unique : l'identité d'envoi d'un espace ─────────────────────────
-- Règles de champ (miroir exact : src/crm/lib/emailIdentity.ts) :
--   nom d'expéditeur  2 à 60 caractères ;
--   raison sociale    2 à 160 caractères ;
--   adresse postale   au moins 10 caractères, au moins un chiffre (numéro ou
--                     code postal) et deux lettres — « Paris » seul ne suffit pas.
CREATE OR REPLACE FUNCTION public._crm_email_identity(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key     text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s         public.crm_email_settings%ROWTYPE;
  v_holder  uuid;
  v_demo    boolean;
  v_terms   timestamptz;
  v_dpa     timestamptz;
  v_addr    text;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  -- Portée plateforme (Yuno écrit en son nom) : pas concernée.
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ready', true, 'missing', '[]'::jsonb);
  END IF;

  SELECT * INTO s FROM public.crm_email_settings WHERE scope_key = v_key;
  v_holder := CASE WHEN p_venue_id IS NOT NULL
                   THEN (SELECT v.owner_id FROM public.venues v WHERE v.id = p_venue_id)
                   ELSE p_organizer_user_id END;
  v_demo := public.is_demo_marketing_scope(p_venue_id, p_organizer_user_id);

  IF char_length(btrim(COALESCE(s.sender_name, ''))) NOT BETWEEN 2 AND 60 THEN
    v_missing := array_append(v_missing, 'sender_name');
  END IF;
  IF char_length(btrim(COALESCE(s.legal_name, ''))) NOT BETWEEN 2 AND 160 THEN
    v_missing := array_append(v_missing, 'legal_name');
  END IF;
  v_addr := btrim(COALESCE(s.postal_address, ''));
  IF char_length(v_addr) < 10 OR v_addr !~ '[0-9]' OR v_addr !~ '[[:alpha:]].*[[:alpha:]]' THEN
    v_missing := array_append(v_missing, 'postal_address');
  END IF;

  -- Conditions Yuno CRM + accord de sous-traitance, acceptés par le titulaire
  -- (CrmLegalGate). Une version postérieure vaut acceptation ; la porte du
  -- front redemande la version courante. La démo n'accepte rien (exemptée).
  IF v_holder IS NOT NULL THEN
    SELECT max(la.accepted_at) FILTER (WHERE la.doc_type = 'terms_crm'),
           max(la.accepted_at) FILTER (WHERE la.doc_type = 'dpa')
      INTO v_terms, v_dpa
      FROM public.legal_acceptances la
     WHERE la.user_id = v_holder AND la.doc_type IN ('terms_crm', 'dpa')
       AND la.doc_version >= '2026-10-08';
  END IF;
  IF NOT v_demo AND (v_terms IS NULL OR v_dpa IS NULL) THEN
    v_missing := array_append(v_missing, 'terms');
  END IF;

  RETURN jsonb_build_object(
    'ready', cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing),
    'terms_accepted_at', CASE WHEN v_terms IS NOT NULL AND v_dpa IS NOT NULL THEN greatest(v_terms, v_dpa) END,
    'demo', v_demo
  );
END;
$$;

REVOKE ALL ON FUNCTION public._crm_email_identity(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_email_identity(text, uuid) TO service_role;

-- Lecture pour la Console (écran Envoi, test, automatisations) : même porte
-- que les réglages d'envoi.
CREATE OR REPLACE FUNCTION public.crm_email_sender_readiness(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public._crm_email_identity(p_venue_id, p_organizer_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_sender_readiness(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_sender_readiness(text, uuid) TO authenticated, service_role;

-- ── 3. Une campagne PAS ENCORE enregistrée est-elle du CRM ? ──────────────────
-- Miroir de crm_campaign_is_crm sur les valeurs d'une ligne (un trigger BEFORE
-- INSERT ne peut pas relire la table).
CREATE OR REPLACE FUNCTION public._crm_campaign_row_is_crm(
  p_id uuid, p_venue_id text, p_organizer_user_id uuid, p_product text, p_audiences jsonb, p_parent uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF v_scope IS NULL THEN RETURN false; END IF;
  IF public.crm_scope_is_crm(v_scope) THEN RETURN true; END IF;
  IF NOT public.crm_scope_has_crm(v_scope) THEN RETURN false; END IF;
  IF p_product IS NOT NULL THEN RETURN p_product = 'crm'; END IF;
  IF jsonb_typeof(p_audiences) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_audiences) e WHERE e->>'kind' = 'crm') THEN
    RETURN true;
  END IF;
  IF p_parent IS NOT NULL AND p_parent IS DISTINCT FROM p_id THEN
    RETURN public.crm_campaign_is_crm(p_parent);
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_campaign_row_is_crm(uuid, text, uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_campaign_row_is_crm(uuid, text, uuid, text, jsonb, uuid) TO service_role;

-- ── 4. La garde : rien ne passe en envoi sans identité ───────────────────────
-- SECURITY DEFINER : elle lit crm_email_settings (RLS sans policy) et appelle
-- des fonctions fermées aux clients. Elle ne discrimine pas sur current_user.
CREATE OR REPLACE FUNCTION public.guard_crm_sender_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id jsonb;
BEGIN
  IF NEW.status NOT IN ('sending', 'scheduled') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.venue_id IS NULL AND NEW.organizer_user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT public._crm_campaign_row_is_crm(NEW.id, NEW.venue_id, NEW.organizer_user_id, NEW.product,
                                         NEW.audiences_json, NEW.parent_campaign_id) THEN
    RETURN NEW;
  END IF;
  -- La démo n'envoie jamais (send-campaign rend demo_no_send) : pas de pause
  -- qui changerait ses écrans.
  IF public.is_demo_marketing_scope(NEW.venue_id, NEW.organizer_user_id) THEN RETURN NEW; END IF;

  v_id := public._crm_email_identity(NEW.venue_id, NEW.organizer_user_id);
  IF COALESCE((v_id->>'ready')::boolean, false) THEN RETURN NEW; END IF;

  -- Automatisation, scénario, page d'inscription, renvoi, relance : en pause,
  -- reprise par _crm_email_identity_resume quand l'identité est complète.
  IF NEW.automation_id IS NOT NULL OR NEW.child_kind IS NOT NULL THEN
    NEW.status := 'paused';
    NEW.paused_reason := 'sender_identity';
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'crm_sender_identity' USING ERRCODE = 'P0001',
    DETAIL = (v_id->'missing')::text,
    HINT = 'Yuno CRM : nom d’expéditeur, raison sociale, adresse postale (Réglages › Envoi) et conditions acceptées par le titulaire, avant tout envoi.';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_crm_sender_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_crm_sender_identity ON public.email_campaigns;
CREATE TRIGGER trg_guard_crm_sender_identity
  BEFORE INSERT OR UPDATE OF status ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_sender_identity();

-- ── 5. Reprise des envois en pause ───────────────────────────────────────────
-- Un enfant d'une soirée déjà commencée est annulé, jamais envoyé en retard.
CREATE OR REPLACE FUNCTION public._crm_email_identity_resume(p_venue_id text, p_organizer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.email_campaigns c
        WHERE c.status = 'paused' AND c.paused_reason = 'sender_identity'
          AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
            OR (p_venue_id IS NULL AND c.organizer_user_id = p_organizer_user_id))) THEN
    RETURN 0;
  END IF;
  IF NOT COALESCE((public._crm_email_identity(p_venue_id, p_organizer_user_id)->>'ready')::boolean, false) THEN
    RETURN 0;
  END IF;

  WITH todo AS (
    SELECT c1.id,
           (e.id IS NULL OR COALESCE(e.end_at, e.start_at + interval '8 hours') > now()) AS still_on
      FROM public.email_campaigns c1
      LEFT JOIN public.events e ON e.id = c1.event_id
     WHERE c1.status = 'paused' AND c1.paused_reason = 'sender_identity'
       AND ((p_venue_id IS NOT NULL AND c1.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND c1.organizer_user_id = p_organizer_user_id))
  ),
  upd AS (
    UPDATE public.email_campaigns c
       SET status = CASE WHEN t.still_on THEN 'sending' ELSE 'cancelled' END,
           paused_reason = NULL,
           error_message = CASE WHEN t.still_on THEN c.error_message
                                ELSE 'sender_identity: la soirée a commencé avant que l’identité soit complète, rien n’est parti' END
      FROM todo t
     WHERE c.id = t.id
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM upd;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_email_identity_resume(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_email_identity_resume(text, uuid) TO service_role;

-- Le titulaire accepte les conditions : les espaces qu'il tient reprennent.
-- Une erreur ici ne doit JAMAIS faire tomber l'acceptation qu'elle observe.
CREATE OR REPLACE FUNCTION public.crm_terms_resume_sends()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  IF NEW.user_id IS NULL OR NEW.doc_type NOT IN ('terms_crm', 'dpa') THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public._crm_email_identity_resume(NULL, NEW.user_id);
    FOR v IN SELECT id FROM public.venues WHERE owner_id = NEW.user_id LOOP
      PERFORM public._crm_email_identity_resume(v.id, NULL);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_terms_resume_sends() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_terms_resume ON public.legal_acceptances;
CREATE TRIGGER trg_crm_terms_resume
  AFTER INSERT ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.crm_terms_resume_sends();

-- ── 6. Réglages d'envoi : la raison sociale, l'état, les suggestions ─────────
-- Corps repris de la base liée (20261004229000), avec : `legal_name`,
-- `readiness` (porte unique), et en `defaults` l'identité légale du compte —
-- seulement pour qui peut écrire (identité légale privée, cf. 20260927120000).
CREATE OR REPLACE FUNCTION public.crm_email_settings_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.crm_email_settings%ROWTYPE;
  v_name text; v_reply text; v_city text; v_addr text; v_from text;
  v_legal text; v_legal_addr text;
  v_writer boolean;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_writer := public.crm_scope_writable(p_venue_id, p_organizer_user_id);
  SELECT * INTO s FROM public.crm_email_settings WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF p_venue_id IS NOT NULL THEN
    SELECT v.name, p.email, v.city, v.address, v.legal_name, v.legal_address
      INTO v_name, v_reply, v_city, v_addr, v_legal, v_legal_addr
      FROM public.venues v LEFT JOIN public.profiles p ON p.id = v.owner_id WHERE v.id = p_venue_id;
  ELSE
    SELECT COALESCE(NULLIF(btrim(p.organization_name), ''), NULLIF(btrim(op.display_name), ''), btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))),
           p.email, COALESCE(op.city, p.city), NULL, op.legal_name, op.legal_address
      INTO v_name, v_reply, v_city, v_addr, v_legal, v_legal_addr
      FROM public.profiles p LEFT JOIN public.organizer_profiles op ON op.user_id = p.id WHERE p.id = p_organizer_user_id;
  END IF;
  -- Nom dont l'adresse d'envoi est tirée : celui que lit send-campaign
  -- (resolveSender : nom du club, sinon nom de l'organisation du profil,
  -- sinon prénom nom), passé au même slug que slugifyVenueName.
  IF p_venue_id IS NOT NULL THEN
    v_from := v_name;
  ELSE
    SELECT COALESCE(NULLIF(p.organization_name, ''), NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), 'Organisateur')
      INTO v_from FROM public.profiles p WHERE p.id = p_organizer_user_id;
  END IF;
  v_from := COALESCE(NULLIF(left(btrim(regexp_replace(regexp_replace(
              regexp_replace(normalize(lower(COALESCE(v_from, '')), NFD), '[̀-ͯ]', '', 'g'),
              '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), '-'), 64), ''), 'club');

  RETURN jsonb_build_object(
    'from_local', v_from,
    'sender_name', s.sender_name, 'legal_name', s.legal_name, 'reply_to', s.reply_to, 'postal_address', s.postal_address,
    'quiet_hours', COALESCE(s.quiet_hours, true), 'waves', COALESCE(s.waves, false), 'notify_done', COALESCE(s.notify_done, true),
    'test_emails', COALESCE(to_jsonb(s.test_emails), '[]'::jsonb), 'updated_at', s.updated_at,
    'readiness', public._crm_email_identity(p_venue_id, p_organizer_user_id),
    'defaults', jsonb_build_object('sender_name', v_name, 'reply_to', v_reply, 'city', v_city, 'address', v_addr,
      'legal_name', CASE WHEN v_writer THEN NULLIF(btrim(v_legal), '') END,
      'legal_address', CASE WHEN v_writer THEN NULLIF(btrim(v_legal_addr), '') END));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_settings_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_settings_get(text, uuid) TO authenticated, service_role;

-- Écriture : corps repris de la base liée, avec la raison sociale, des refus
-- lisibles (au lieu de la violation de CHECK) et la reprise des envois en pause.
CREATE OR REPLACE FUNCTION public.crm_email_settings_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tests text[];
  v_sender text := NULLIF(btrim(p_patch->>'sender_name'), '');
  v_legal text := NULLIF(btrim(p_patch->>'legal_name'), '');
  v_postal text := NULLIF(btrim(p_patch->>'postal_address'), '');
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Le nom part dans l'en-tête « De : » : ni chevrons, ni guillemets, ni saut de ligne.
  IF p_patch ? 'sender_name' AND v_sender IS NOT NULL
     AND (char_length(v_sender) > 60 OR v_sender ~ '[<>"\r\n]') THEN
    RAISE EXCEPTION 'bad_sender_name' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'legal_name' AND v_legal IS NOT NULL
     AND (char_length(v_legal) NOT BETWEEN 2 AND 160 OR v_legal ~ '[<>\r\n]') THEN
    RAISE EXCEPTION 'bad_legal_name' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'postal_address' AND v_postal IS NOT NULL AND char_length(v_postal) > 240 THEN
    RAISE EXCEPTION 'bad_postal_address' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'test_emails' THEN
    SELECT COALESCE(array_agg(DISTINCT lower(btrim(x))), '{}') INTO v_tests
      FROM jsonb_array_elements_text(COALESCE(p_patch->'test_emails', '[]'::jsonb)) x
     WHERE btrim(x) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    IF cardinality(v_tests) > 5 THEN RAISE EXCEPTION 'too_many_test_emails' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.crm_email_settings (scope_key, venue_id, organizer_user_id, updated_by, updated_at)
  VALUES (v_key, p_venue_id, p_organizer_user_id, auth.uid(), now())
  ON CONFLICT (scope_key) DO NOTHING;
  UPDATE public.crm_email_settings SET
    sender_name = CASE WHEN p_patch ? 'sender_name' THEN v_sender ELSE sender_name END,
    legal_name = CASE WHEN p_patch ? 'legal_name' THEN v_legal ELSE legal_name END,
    reply_to = CASE WHEN p_patch ? 'reply_to' THEN NULLIF(lower(btrim(p_patch->>'reply_to')), '') ELSE reply_to END,
    postal_address = CASE WHEN p_patch ? 'postal_address' THEN v_postal ELSE postal_address END,
    quiet_hours = CASE WHEN p_patch ? 'quiet_hours' THEN (p_patch->>'quiet_hours')::boolean ELSE quiet_hours END,
    waves = CASE WHEN p_patch ? 'waves' THEN (p_patch->>'waves')::boolean ELSE waves END,
    notify_done = CASE WHEN p_patch ? 'notify_done' THEN (p_patch->>'notify_done')::boolean ELSE notify_done END,
    test_emails = CASE WHEN p_patch ? 'test_emails' THEN v_tests ELSE test_emails END,
    updated_by = auth.uid(), updated_at = now()
  WHERE scope_key = v_key;
  -- Identité complète : ce qui attendait repart.
  PERFORM public._crm_email_identity_resume(p_venue_id, p_organizer_user_id);
  RETURN public.crm_email_settings_get(p_venue_id, p_organizer_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_settings_set(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_settings_set(text, uuid, jsonb) TO authenticated, service_role;

-- ── 7. Les recettes réglées dans la Console CRM sont du CRM ──────────────────
-- Sur un compte Billetterie + CRM (Amoris, WOH), Billetterie et CRM partagent
-- la même ligne `email_automations` (portée, recette), sans produit : ses
-- e-mails étaient donc classés Billetterie par crm_campaign_is_crm (identité
-- du compte, quota offert de la Billetterie, aucune garde d'identité) — une
-- recette allumée depuis le CRM d'Amoris serait partie au nom d'« Amoris » aux
-- contacts de WOH. La Console CRM marque désormais la recette (`product`), et
-- chaque e-mail qu'elle monte en hérite à l'insertion : CRM partout (Yunits,
-- Réglages › Envoi, garde). Une recette jamais touchée par le CRM reste NULL.
ALTER TABLE public.email_automations
  ADD COLUMN IF NOT EXISTS product text CHECK (product IS NULL OR product IN ('suite', 'crm'));

CREATE OR REPLACE FUNCTION public.email_automation_child_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.automation_id IS NOT NULL AND NEW.product IS NULL THEN
    SELECT a.product INTO NEW.product FROM public.email_automations a WHERE a.id = NEW.automation_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.email_automation_child_product() FROM PUBLIC, anon, authenticated;

-- Nom choisi pour passer AVANT les gardes (les triggers d'un même événement
-- tournent par ordre alphabétique) : elles lisent `product`.
DROP TRIGGER IF EXISTS trg_a_email_automation_child_product ON public.email_campaigns;
CREATE TRIGGER trg_a_email_automation_child_product
  BEFORE INSERT ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.email_automation_child_product();

-- Corps repris de la base liée ; seul ajout : `product = 'crm'`.
CREATE OR REPLACE FUNCTION public.crm_automation_save(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_enabled boolean DEFAULT NULL::boolean, p_delay_hours integer DEFAULT NULL::integer, p_subject text DEFAULT NULL::text, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_row public.email_automations%ROWTYPE;
  v_allowed int[];
  v_default int;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Les délais proposés par l'écran (AUTOMATION_META, en heures).
  CASE p_kind
    WHEN 'new_event' THEN v_allowed := ARRAY[2, 6, 24]; v_default := 6;
    WHEN 'last_call' THEN v_allowed := ARRAY[12, 24, 48, 72]; v_default := 24;
    WHEN 'click_no_buy' THEN v_allowed := ARRAY[6, 12, 24, 48]; v_default := 24;
    WHEN 'post_event_thanks' THEN v_allowed := ARRAY[6, 12, 24, 48]; v_default := 12;
    WHEN 'post_event_missed' THEN v_allowed := ARRAY[12, 24, 48, 72]; v_default := 24;
    WHEN 'regular_lapse' THEN v_allowed := ARRAY[672, 1008, 1344]; v_default := 1008;
    WHEN 'win_back' THEN v_allowed := ARRAY[1080, 1440, 2160, 2880]; v_default := 2160;
    -- Calée sur le délai médian de retour du compte (_first_return_candidates) :
    -- la valeur stockée n'est qu'un repère.
    WHEN 'first_return' THEN v_allowed := ARRAY[504]; v_default := 504;
    ELSE RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023';
  END CASE;
  IF p_delay_hours IS NOT NULL AND NOT (p_delay_hours = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'bad_delay' USING ERRCODE = '22023';
  END IF;
  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.email_campaign_templates t
     WHERE t.id = p_template_id
       AND t.venue_id IS NOT DISTINCT FROM p_venue_id AND t.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ) THEN
    RAISE EXCEPTION 'bad_template' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.email_automations a
   WHERE a.kind = p_kind
     AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    INSERT INTO public.email_automations (venue_id, organizer_user_id, kind, enabled, delay_hours, subject, template_id, created_by, product)
    VALUES (p_venue_id, p_organizer_user_id, p_kind, false, COALESCE(p_delay_hours, v_default),
            NULLIF(trim(p_subject), ''), p_template_id, auth.uid(), 'crm')
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.email_automations a
     SET delay_hours = COALESCE(p_delay_hours, a.delay_hours),
         subject = CASE WHEN p_subject IS NULL THEN a.subject ELSE NULLIF(trim(p_subject), '') END,
         template_id = COALESCE(p_template_id, a.template_id),
         enabled = COALESCE(p_enabled, a.enabled),
         -- Réglée depuis la Console CRM : ses e-mails sont du CRM (identité de
         -- Réglages › Envoi, Yunits), y compris sur un compte Billetterie + CRM.
         product = 'crm'
   WHERE a.id = v_row.id
  RETURNING * INTO v_row;
  IF v_row.enabled AND v_row.template_id IS NULL THEN
    RAISE EXCEPTION 'template_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN to_jsonb(v_row) - 'created_by';
END;
$$;

REVOKE ALL ON FUNCTION public.crm_automation_save(text, uuid, text, boolean, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_automation_save(text, uuid, text, boolean, integer, text, uuid) TO authenticated, service_role;
