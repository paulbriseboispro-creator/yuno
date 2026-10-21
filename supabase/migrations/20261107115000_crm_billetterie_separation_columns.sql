-- Yuno CRM ⇄ Yuno Tickets : SÉPARATION STRICTE — 1/2, le socle (ajouts seulement, rien n'est retiré).
--
-- Décision de Paul (20/10) : les deux outils ne partagent plus aucune donnée ; seul le bouton de bascule
-- relie un compte qui a les deux. Une colonne `product` (NULL = Yuno Tickets, 'crm' = Yuno CRM) est posée sur
-- chaque table que les deux outils se partageaient : registre de consentement e-mail, repoussoir, listes
-- importées (contacts, e-mail, SMS), contacts importés, contacts SMS, modèles d'e-mail, engagement ;
-- `email_automations.product` existait déjà. Les index d'unicité PAR PRODUIT sont créés à côté des anciens.
-- La bascule (retrait des anciens index, remplacement des fonctions d'écriture, copie des données d'un
-- compte à deux produits) est la migration suivante, en UNE transaction.
--
-- Un compte à un seul produit n'a rien à dire : _separation_default_product() pose le produit à l'insertion
-- (compte CRM pur = 'crm', compte sans CRM = NULL) ; un compte à deux produits : l'écrivain choisit.
-- Deux exceptions légales restent TRANSVERSES : la liste de suppression (rebond, plainte, STOP) et la
-- désinscription (« stop » vaut pour les deux outils d'un même pro).

-- ── Socle commun : le produit d'une ligne ───────────────────────────────────────────────────
-- NULL = Yuno Tickets (Billetterie), 'crm' = Yuno CRM. Un compte qui n'a qu'un produit n'a pas à le dire :
--   • compte CRM PUR (crm_scope_is_crm) : toute ligne née chez lui est du CRM, quel que soit l'écrivain (semis de démo,
--     scripts, anciens appels) ;
--   • compte SANS CRM : toute ligne est de la Billetterie ;
--   • compte à DEUX produits : l'écrivain choisit (les fonctions d'écriture passent toujours le produit).
CREATE OR REPLACE FUNCTION public._separation_default_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id);
BEGIN
  IF v_scope IS NULL THEN
    NEW.product := NULL;                       -- portée plateforme (Yuno écrit à sa propre base) : jamais un produit
  ELSIF public.crm_scope_is_crm(v_scope) THEN
    NEW.product := 'crm';
  ELSIF NOT public.crm_scope_has_crm(v_scope) THEN
    NEW.product := NULL;
  ELSIF NEW.product IS NOT NULL AND NEW.product <> 'crm' THEN
    NEW.product := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._separation_default_product() FROM PUBLIC, anon, authenticated, service_role;

-- ════ Registre de consentement e-mail (newsletter_subscriptions) ════
-- ── A-0. Helpers ───────────────────────────────────────────────────────────────────────────────
-- Id déterministe d'une COPIE vers le produit CRM : les migrations A (registre) et C (listes) n'ont pas à
-- se passer de table de correspondance ; la copie d'une ligne du registre pointe sur la copie de sa liste.
CREATE OR REPLACE FUNCTION public._sep3_copy_id(p_id uuid)
 RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $f$ SELECT md5('sep3-crm-copy|' || p_id::text)::uuid $f$;
REVOKE ALL ON FUNCTION public._sep3_copy_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sep3_copy_id(uuid) TO service_role;

-- « Cette adresse a-t-elle posé un STOP explicite chez ce pro, dans l'un OU l'autre outil ? » (exception légale).
-- Sert aux écrivains AUTOMATIQUES (connecteur, lead Meta) : jamais d'accord neuf par-dessus un stop.
CREATE OR REPLACE FUNCTION public._newsletter_explicit_stop(p_venue_id text, p_organizer_user_id uuid, p_email text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT (p_venue_id IS NOT NULL OR p_organizer_user_id IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE lower(ns.email) = lower(p_email)
                    AND ns.opted_out_at IS NOT NULL
                    AND ns.venue_id IS NOT DISTINCT FROM p_venue_id
                    AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id);
$f$;
REVOKE ALL ON FUNCTION public._newsletter_explicit_stop(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._newsletter_explicit_stop(text, uuid, text) TO service_role;

-- Le client ne déplace jamais une ligne d'un produit à l'autre (policies « Users update own subs » /
-- « Owners manage newsletter subs » ouvrent toutes les colonnes). INVOKER : discrimine sur current_user.
CREATE OR REPLACE FUNCTION public.guard_newsletter_product_immutable()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $f$
BEGIN
  IF NEW.product IS DISTINCT FROM OLD.product
     AND current_user IN ('authenticated', 'anon')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'newsletter_subscriptions.product is set by Yuno only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$f$;
-- ── A-1. Colonne, CHECK, triggers ──────────────────────────────────────────────────────────────
ALTER TABLE public.newsletter_subscriptions ADD COLUMN IF NOT EXISTS product text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_subscriptions_product_chk') THEN
    ALTER TABLE public.newsletter_subscriptions
      ADD CONSTRAINT newsletter_subscriptions_product_chk CHECK (product IS NULL OR product = 'crm');
  END IF;
  -- La portée plateforme (marketing de Yuno lui-même) n'a qu'un produit : jamais 'crm'.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'newsletter_subscriptions_crm_scope_chk') THEN
    ALTER TABLE public.newsletter_subscriptions
      ADD CONSTRAINT newsletter_subscriptions_crm_scope_chk
      CHECK (product IS NULL OR venue_id IS NOT NULL OR organizer_user_id IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.newsletter_subscriptions.product IS
  'Produit propriétaire de l''accord : NULL = Yuno Tickets (Billetterie), ''crm'' = Yuno CRM. Une adresse a UNE ligne par produit chez un même pro (deux accords et deux jetons indépendants). La portée plateforme reste NULL. Seul un STOP est transverse (unsubscribe_by_token).';

DROP TRIGGER IF EXISTS trg_newsletter_subscriptions_product_default ON public.newsletter_subscriptions;
CREATE TRIGGER trg_newsletter_subscriptions_product_default
  BEFORE INSERT ON public.newsletter_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();

DROP TRIGGER IF EXISTS trg_newsletter_subscriptions_product_guard ON public.newsletter_subscriptions;
CREATE TRIGGER trg_newsletter_subscriptions_product_guard
  BEFORE UPDATE OF product ON public.newsletter_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_newsletter_product_immutable();
-- ── A-2. Index d'unicité PAR PRODUIT (NULLS NOT DISTINCT : NULL = Billetterie compte comme une valeur) ──
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_venue_product
  ON public.newsletter_subscriptions (lower(email), venue_id, product) NULLS NOT DISTINCT
  WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_organizer_product
  ON public.newsletter_subscriptions (lower(email), organizer_user_id, product) NULLS NOT DISTINCT
  WHERE organizer_user_id IS NOT NULL;
-- Inchangé (une seule ligne par adresse, product NULL) : uniq_newsletter_subs_email_platform,
-- (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL. La CHECK ci-dessus interdit 'crm' hors club / organisateur.
-- Inchangé aussi : newsletter_subscriptions_unsubscribe_token_key (jeton unique global) — les copies prennent le DEFAULT gen_random_uuid().

-- Lectures du CRM (product = 'crm') : les index (venue_id, opted_in) existants servent la Billetterie (la masse).
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_crm_venue
  ON public.newsletter_subscriptions (venue_id, opted_in) WHERE product = 'crm';
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_crm_organizer
  ON public.newsletter_subscriptions (organizer_user_id, opted_in) WHERE product = 'crm';

-- ════ Repoussoir e-mail (email_opt_outs) ════
-- ── A-4. [groupe `optouts`, à valider] Repoussoir `email_opt_outs` PAR PRODUIT ───────────────────────
-- Le repoussoir (adresse purgée d'une liste, ou effacée chez la billetterie) ne doit pas faire le pont entre les
-- deux outils : sans cela, la purge d'une liste CRM ferait écarter par claim_campaign_recipients les destinataires
-- d'une campagne Billetterie (et inversement). Même modèle que le registre : NULL = Billetterie, 'crm' = CRM.
ALTER TABLE public.email_opt_outs ADD COLUMN IF NOT EXISTS product text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_opt_outs_product_chk') THEN
    ALTER TABLE public.email_opt_outs ADD CONSTRAINT email_opt_outs_product_chk CHECK (product IS NULL OR product = 'crm');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_opt_outs_crm_scope_chk') THEN
    ALTER TABLE public.email_opt_outs ADD CONSTRAINT email_opt_outs_crm_scope_chk
      CHECK (product IS NULL OR venue_id IS NOT NULL OR organizer_user_id IS NOT NULL);
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_email_opt_outs_product_default ON public.email_opt_outs;
CREATE TRIGGER trg_email_opt_outs_product_default
  BEFORE INSERT ON public.email_opt_outs
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_venue_product
  ON public.email_opt_outs (lower(email), venue_id, product) NULLS NOT DISTINCT WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_organizer_product
  ON public.email_opt_outs (lower(email), organizer_user_id, product) NULLS NOT DISTINCT WHERE organizer_user_id IS NOT NULL;

-- ════ Listes importées, contacts importés, contacts SMS ════
-- ── 0. Garde : les tables et fonctions attendues existent ───────────────────
DO $guard$
BEGIN
  IF to_regprocedure('public.crm_scope_is_crm(text)') IS NULL
     OR to_regprocedure('public.crm_scope_has_crm(text)') IS NULL
     OR to_regprocedure('public.crm_scope_key(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'portes de portée CRM manquantes (crm_scope_is_crm / crm_scope_has_crm / crm_scope_key)';
  END IF;
  IF to_regprocedure('public._separation_default_product()') IS NULL THEN
    RAISE EXCEPTION 'public._separation_default_product() doit exister avant ce fichier (fonction du coordinateur)';
  END IF;
END $guard$;
-- ── 1. Colonnes + CHECK ─────────────────────────────────────────────────────
ALTER TABLE public.contact_list_imports ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.email_list_imports   ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.sms_list_imports     ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.imported_contacts    ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.venue_sms_contacts   ADD COLUMN IF NOT EXISTS product text;

COMMENT ON COLUMN public.contact_list_imports.product IS 'Produit propriétaire de la liste : NULL = Yuno Tickets, ''crm'' = Yuno CRM. Posé à la création, jamais changé par un client.';
COMMENT ON COLUMN public.email_list_imports.product   IS 'Produit propriétaire de la liste e-mail : NULL = Yuno Tickets, ''crm'' = Yuno CRM.';
COMMENT ON COLUMN public.sms_list_imports.product     IS 'Produit propriétaire de la liste SMS : NULL = Yuno Tickets, ''crm'' = Yuno CRM.';
COMMENT ON COLUMN public.imported_contacts.product    IS 'Produit de la liste d''origine (dénormalisé, dérivé par trigger de contact_list_imports.product) : NULL = Yuno Tickets, ''crm'' = Yuno CRM.';
COMMENT ON COLUMN public.venue_sms_contacts.product   IS 'Produit auquel l''accord SMS a été donné : NULL = Yuno Tickets (checkout, guest list, Meta, import Billetterie), ''crm'' = Yuno CRM. Un STOP vaut pour les deux produits (sms_stop_unsubscribe).';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_list_imports', 'email_list_imports', 'sms_list_imports', 'imported_contacts', 'venue_sms_contacts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_product_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (product IS NULL OR product = ''crm'') NOT VALID', t, t || '_product_check');
    END IF;
    -- La portée plateforme (marketing de Yuno lui-même : les deux colonnes de portée à NULL) n'est jamais scindée.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_product_scope_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (product IS NULL OR venue_id IS NOT NULL OR organizer_user_id IS NOT NULL) NOT VALID', t, t || '_product_scope_check');
    END IF;
  END LOOP;
END $$;
-- ── 2. Le helper des écrivains : quel produit pour CETTE portée ? ───────────
-- 'crm' demandé sur un compte sans CRM = refus ; compte CRM pur = toujours 'crm' ;
-- compte Billetterie pur = toujours NULL ; plateforme = toujours NULL ;
-- compte à deux produits = le produit demandé (NULL ou 'crm').
CREATE OR REPLACE FUNCTION public._import_product(p_venue_id text, p_organizer_user_id uuid, p_product text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_p text := CASE WHEN p_product IS NULL OR p_product IN ('', 'suite') THEN NULL ELSE p_product END;
BEGIN
  IF v_p IS NOT NULL AND v_p <> 'crm' THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
  IF v_scope IS NULL THEN RETURN NULL; END IF;                    -- plateforme : jamais scindée
  IF public.crm_scope_is_crm(v_scope) THEN RETURN 'crm'; END IF;   -- compte CRM pur
  IF NOT public.crm_scope_has_crm(v_scope) THEN                    -- compte Billetterie pur
    IF v_p = 'crm' THEN RAISE EXCEPTION 'crm_not_enabled' USING ERRCODE = '42501'; END IF;
    RETURN NULL;
  END IF;
  RETURN v_p;                                                      -- deux produits : le choix de l'écrivain
END;
$function$;
REVOKE ALL ON FUNCTION public._import_product(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._import_product(text, uuid, text) TO service_role;
-- ── 3. Index uniques ────────────────────────────────────────────────────────
-- venue_sms_contacts : DEUX contraintes (venue_id, phone_e164) et (organizer_user_id, phone_e164) empêchaient une
-- 2e ligne pour l'autre produit. Remplacées par UN index unique NON partiel à 4 colonnes, NULLS NOT DISTINCT :
--   · venue : (V, tel, NULL, produit) · organisateur : (NULL, tel, O, produit) · plateforme : (NULL, tel, NULL, NULL)
--   · non partiel : PostgREST (upsert onConflict, _shared/sms-consent.ts) sait nommer des colonnes, jamais un WHERE ;
--   · NB : un NULLS NOT DISTINCT sur (venue_id, phone_e164, product) seul aurait fait collisionner deux
--     ORGANISATEURS (venue_id NULL des deux côtés) : d'où organizer_user_id DANS la clé.
-- L'index partiel de la plateforme (uniq_sms_contacts_platform_phone) est GARDÉ tel quel : les écrivains de la
-- plateforme (import_sms_contacts, sync_platform_marketing_contacts) gardent leur ON CONFLICT (phone_e164) WHERE …
CREATE UNIQUE INDEX IF NOT EXISTS venue_sms_contacts_unique_scope_phone_product
  ON public.venue_sms_contacts (venue_id, phone_e164, organizer_user_id, product) NULLS NOT DISTINCT;
-- Les recherches « (organisateur, numéro) » s'appuyaient sur la contrainte supprimée.
CREATE INDEX IF NOT EXISTS idx_sms_contacts_org_phone
  ON public.venue_sms_contacts (organizer_user_id, phone_e164) WHERE organizer_user_id IS NOT NULL;

-- Lecture par produit (listes d'une portée).
CREATE INDEX IF NOT EXISTS idx_contact_list_imports_scope_product
  ON public.contact_list_imports (venue_id, organizer_user_id, product);
-- Inchangés (par liste, donc déjà par produit) : uq_imported_contacts_identity (list_import_id, COALESCE(email), COALESCE(phone)),
-- idx_*_fingerprint (non uniques ; le doublon exact se cherche avec un filtre produit dans check_contact_import / import_contact_list).
-- ── 4. Déclencheurs ─────────────────────────────────────────────────────────
-- 4a. Défaut par portée (fonction du coordinateur) : compte CRM pur ⇒ 'crm', compte sans CRM ⇒ NULL, deux produits ⇒ la valeur de l'écrivain.
DROP TRIGGER IF EXISTS trg_contact_list_imports_product_default ON public.contact_list_imports;
CREATE TRIGGER trg_contact_list_imports_product_default BEFORE INSERT ON public.contact_list_imports
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
DROP TRIGGER IF EXISTS trg_email_list_imports_product_default ON public.email_list_imports;
CREATE TRIGGER trg_email_list_imports_product_default BEFORE INSERT ON public.email_list_imports
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
DROP TRIGGER IF EXISTS trg_sms_list_imports_product_default ON public.sms_list_imports;
CREATE TRIGGER trg_sms_list_imports_product_default BEFORE INSERT ON public.sms_list_imports
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
DROP TRIGGER IF EXISTS trg_imported_contacts_product_default ON public.imported_contacts;
CREATE TRIGGER trg_imported_contacts_product_default BEFORE INSERT ON public.imported_contacts
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
DROP TRIGGER IF EXISTS trg_venue_sms_contacts_product_default ON public.venue_sms_contacts;
CREATE TRIGGER trg_venue_sms_contacts_product_default BEFORE INSERT ON public.venue_sms_contacts
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();

-- 4b. Une ligne importée a le produit de SA LISTE (la liste est la vérité) : les écrivains qui ne passent pas la colonne
--     (crm_signup_confirm, submit_crm_signup, anciens scripts) en héritent. Passe APRÈS 4a (ordre alphabétique des triggers :
--     trg_imported_contacts_product_default < trg_imported_contacts_product_from_list).
CREATE OR REPLACE FUNCTION public._imported_contact_product_from_list()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  SELECT li.product INTO NEW.product FROM public.contact_list_imports li WHERE li.id = NEW.list_import_id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._imported_contact_product_from_list() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_imported_contacts_product_from_list ON public.imported_contacts;
CREATE TRIGGER trg_imported_contacts_product_from_list BEFORE INSERT ON public.imported_contacts
  FOR EACH ROW EXECUTE FUNCTION public._imported_contact_product_from_list();

-- 4c. Un client (rôle authenticated / anon) ne change jamais le produit d'une ligne existante.
--     SECURITY INVOKER exprès : le test porte sur current_user (règle du dépôt pour les gardes).
--     venue_sms_contacts a une policy FOR ALL pour le pro (sms_contacts_owner_all) : sans ceci il pourrait faire basculer ses lignes.
CREATE OR REPLACE FUNCTION public.guard_import_product_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.product IS DISTINCT FROM OLD.product THEN
    NEW.product := OLD.product;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_import_product_immutable() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_list_imports', 'email_list_imports', 'sms_list_imports', 'imported_contacts', 'venue_sms_contacts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_product_immutable ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_product_immutable BEFORE UPDATE OF product ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_import_product_immutable()', t, t);
  END LOOP;
END $$;
-- ── 5. Id déterministe d'une copie vers le produit CRM ──────────────────────
-- IDENTIQUE à public._sep3_copy_id de sep3-A-migration.sql (A-0) : les deux migrations (listes = C, registre = A) se retrouvent
-- sans table de correspondance. CREATE OR REPLACE : sans danger si A l'a déjà créée.
CREATE OR REPLACE FUNCTION public._sep3_copy_id(p_id uuid)
 RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $f$ SELECT md5('sep3-crm-copy|' || p_id::text)::uuid $f$;
REVOKE ALL ON FUNCTION public._sep3_copy_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sep3_copy_id(uuid) TO service_role;

-- ════ Modèles d'e-mail, engagement, identité d'annonceur SMS ════
-- Un client ne change jamais le produit d'une ligne (sinon : collision de slot, ou recette qui passe de l'autre côté).
CREATE OR REPLACE FUNCTION public.guard_marketing_product_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.product IS DISTINCT FROM OLD.product THEN
    NEW.product := OLD.product;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_marketing_product_immutable() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- D-2. email_campaign_templates : bibliothèque de modèles PAR PRODUIT
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.email_campaign_templates ADD COLUMN IF NOT EXISTS product text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_campaign_templates_product_check') THEN
    ALTER TABLE public.email_campaign_templates ADD CONSTRAINT email_campaign_templates_product_check
      CHECK (product IS NULL OR product = 'crm');
  END IF;
END $$;
COMMENT ON COLUMN public.email_campaign_templates.product IS
  'Produit propriétaire du modèle : NULL = Yuno Tickets (galerie de la Billetterie), ''crm'' = Yuno CRM (recettes et scénarios). Les écrivains de la Console CRM passent ''crm'' ; les autres ne passent rien (NULL).';

DROP TRIGGER IF EXISTS trg_email_campaign_templates_product_default ON public.email_campaign_templates;
CREATE TRIGGER trg_email_campaign_templates_product_default
  BEFORE INSERT ON public.email_campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
DROP TRIGGER IF EXISTS trg_0_email_campaign_templates_product_guard ON public.email_campaign_templates;
CREATE TRIGGER trg_0_email_campaign_templates_product_guard
  BEFORE UPDATE OF product ON public.email_campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketing_product_immutable();


-- ═════════════════════════════════════════════════════════════════════════════
-- D-3. contact_engagement : engagement PAR PRODUIT (colonne product + clé `…|crm`)
-- ═════════════════════════════════════════════════════════════════════════════
-- Tranché : colonne `product` ET suffixe `|crm` dans scope_key (colonne générée), comme le cache de contacts
-- (`…|crm`). Avantage décisif : tout lecteur existant de la Billetterie (`scope_key = 'o:<uuid>'`) continue de ne
-- voir que SES lignes sans être modifié ; un lecteur du CRM doit demander `|| '|crm'` (ou filtrer product = 'crm').
-- Les clés uniques (scope_key, email) / (scope_key) et tous les ON CONFLICT existants restent valables.
ALTER TABLE public.contact_engagement ADD COLUMN IF NOT EXISTS product text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_engagement_product_check') THEN
    ALTER TABLE public.contact_engagement ADD CONSTRAINT contact_engagement_product_check
      CHECK (product IS NULL OR product = 'crm');
  END IF;
END $$;
-- PG 17 : ALTER COLUMN … SET EXPRESSION (réécrit la table et ses 2 index ; ~50 000 lignes en prod : < 1 s).
-- Repli si indisponible : DROP COLUMN scope_key ; ADD COLUMN scope_key text GENERATED ALWAYS AS (…) STORED ;
-- recréer uq_contact_engagement_scope_email (scope_key, email) et idx_contact_engagement_scope_status (scope_key, status).
ALTER TABLE public.contact_engagement ALTER COLUMN scope_key SET EXPRESSION AS (
  COALESCE('v:' || venue_id, 'o:' || organizer_user_id::text, 'p') || CASE WHEN product = 'crm' THEN '|crm' ELSE '' END);
COMMENT ON COLUMN public.contact_engagement.product IS
  'Produit mesuré : NULL = Billetterie (clés ''v:…''/''o:…''), ''crm'' = Yuno CRM (clé ''v:…|crm'' / ''o:…|crm''). Écrit par refresh_contact_engagement(venue, org, product).';

-- Lecture directe : l'engagement CRM n'est pas lisible par la seule équipe Billetterie (et réciproquement par scope_key).
DROP POLICY IF EXISTS contact_engagement_scope_read ON public.contact_engagement;
CREATE POLICY contact_engagement_scope_read ON public.contact_engagement FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id)
         AND (product IS NULL OR public.crm_scope_allowed(venue_id, organizer_user_id)));
DROP POLICY IF EXISTS contact_engagement_state_scope_read ON public.contact_engagement_state;
CREATE POLICY contact_engagement_state_scope_read ON public.contact_engagement_state FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id)
         AND (scope_key NOT LIKE '%|crm' OR public.crm_scope_allowed(venue_id, organizer_user_id)));


-- ═════════════════════════════════════════════════════════════════════════════
-- D-4. Identité d'annonceur SMS : celle du CRM vit dans crm_sms_settings
-- ═════════════════════════════════════════════════════════════════════════════
-- Avant : set_sms_sender_identity (Console CRM) ÉCRIVAIT venues.legal_name / siret / vat_number (organizer_profiles.*),
-- la fiche qui sert de VENDEUR aux reçus de la Billetterie. Désormais : crm_sms_settings.
ALTER TABLE public.crm_sms_settings
  ADD COLUMN IF NOT EXISTS legal_name text CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 2 AND 160),
  ADD COLUMN IF NOT EXISTS siret text CHECK (siret IS NULL OR siret ~ '^[0-9]{14}$'),
  ADD COLUMN IF NOT EXISTS rna_number text CHECK (rna_number IS NULL OR rna_number ~ '^W[0-9]{9}$'),
  ADD COLUMN IF NOT EXISTS vat_number text CHECK (vat_number IS NULL OR char_length(vat_number) BETWEEN 6 AND 40);

