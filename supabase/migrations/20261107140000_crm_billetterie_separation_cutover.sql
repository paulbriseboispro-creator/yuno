-- Yuno CRM ⇄ Yuno Tickets : SÉPARATION STRICTE — 2/2, la bascule (UNE transaction).
--
-- À appliquer APRÈS la migration de socle et les migrations d'isolation précédentes, hors passage d'un
-- cron lourd. Dans cette transaction, dans cet ordre :
--   1. les ANCIENS index d'unicité tombent (un accord par adresse et par portée) ;
--   2. les recettes et les modèles passent « un slot par produit » ;
--   3. les fonctions de lecture ET d'écriture sont remplacées par leur version « un produit par ligne »
--      (tout `ON CONFLICT` cite le nouvel index ; les lecteurs filtrent le produit de leur outil, ou celui
--      de la campagne / de la recette pour le moteur d'envoi) ;
--   4. les données : compte CRM pur = tout en 'crm' ; compte à deux produits = les lignes d'origine CRM
--      (connecteur, pages d'inscription, imports faits depuis la Console CRM) changent de produit sur place,
--      les fichiers importés sont COPIÉS (le CRM garde sa base, la Billetterie la sienne), les accords nés
--      d'une surface Yuno (achat, guest list, waitlist…) ne sont JAMAIS copiés dans le CRM ;
--   5. les contrôles : la migration s'arrête si un invariant est faux.
-- Garde md5 : la migration s'arrête si l'une des fonctions remplacées a changé depuis l'audit du 20/10.
-- Après : NOTIFY pgrst (nouvelles signatures), régénérer src/integrations/supabase/types.ts, redéployer
-- les fonctions edge listées dans le rapport.

DO $guard$
DECLARE r record; v_oid oid;
BEGIN
  IF to_regprocedure('public._separation_default_product()') IS NULL THEN
    RAISE EXCEPTION 'appliquer d''abord la migration de socle de la séparation (colonnes product)';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public._email_automation_enabled(text, uuid, text)', '92e922dc10d87cb64a574df8b044f908'),
    ('public._email_automation_next_event(text, uuid)', 'd63a2f226774e482759256247e1717f3'),
    ('public._email_automation_preview(text, uuid, text)', '5311169220bd687ceacdc515c82aeda2'),
    ('public._email_automation_suggestions(text, uuid)', '637f8ad98c75e913befdaa369bf9501d'),
    ('public._email_engagement_rank(text, text, uuid)', '944efb6163f3b14581c81d7ec5afdc66'),
    ('public._email_engagement_ranks(text[], text, uuid)', '4515f32dccdb253d546d8179a7744bde'),
    ('public._mcp_email_scope_events(text, uuid)', '63a42dab60a096d4ec7859247767ca01'),
    ('public._regular_lapse_candidates(text, uuid, interval)', '3ed8943f8731f2a178d45e30d3b523b6'),
    ('public.check_contact_import(text, uuid, text[], text[])', '6dba12caa27fdc3fbca266390a4a54bb'),
    ('public.get_email_automation_stats(text, uuid, integer)', '92af869ddd3eec2ca37e78903235494e'),
    ('public.get_email_lists_health(text, uuid)', 'c9c3a21edf7f05464d3426cccf7f966e'),
    ('public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb, text, boolean)', 'ff5eada18b80c96daf9dbb2e8ca14cc4'),
    ('public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid, text)', '9c7bdc24f33d06a346a19654e8f55637'),
    ('public.import_sms_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text)', 'db98ecf5bd2c92cceda4db351c5964c1'),
    ('public.list_contact_base(text, uuid, text, uuid, text, text, uuid, text, integer, integer)', 'f78f0a49a379fb834d21a196a932245a'),
    ('public.set_sms_sender_identity(text, uuid, text, text)', 'e465bc184c2675ce517f2c3eff896ee2'),
    ('public._admin_customer_identity(text)', '514fd5c5a2d638e069fe524bb38eaecb'),
    ('public._coorg_apply_cohost_consent(uuid, text, text[], text, text, text)', 'fcee6f22ad6e7b9eb2820bb70db69ed1'),
    ('public._crm_campaign_audience(uuid)', '6cb722ab60dfcc5a8ce5d5256bd15b96'),
    ('public._crm_email_attrib(text, uuid)', 'a22a7d2bdff3711dda9ff81c5807fb8e'),
    ('public._crm_email_stats(text, uuid, timestamp with time zone, timestamp with time zone)', 'f05972dd7be87b5aaadcd1c62d56be8a'),
    ('public._crm_file_history(text, uuid, timestamp with time zone)', '7164cedd828d12d0d0b4f5ffed9125db'),
    ('public._crm_notif_list(text, uuid, uuid, boolean)', 'd8d75d06c93da8008e6cb9e436febb45'),
    ('public._crm_scenario_advance(text, text, uuid, timestamp with time zone, boolean, text)', '6753e2e00697484d8ed857fc6f113bd7'),
    ('public._crm_scenario_candidates(crm_scenarios, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, boolean)', '69c44bf5e46b90e381632063582d46f0'),
    ('public._crm_scenario_content(text, uuid, jsonb)', '94597f9f6c1b8998aca792e2924fc743'),
    ('public._crm_scenario_message(crm_scenarios, crm_scenario_versions, text, jsonb, boolean, text)', 'db53a36dbbcc24747227d5500b2e589f'),
    ('public._crm_scenario_pick_events(text, uuid, text[])', '507a526b296438508e382f8e43d21152'),
    ('public._crm_signup_ensure_group(uuid, uuid)', 'c64ab13b3ebebb6e43a094603efbe9cd'),
    ('public._crm_signup_known(crm_signup_pages, text, text)', 'cdb76d225bcecd2b03ea614b58f95f30'),
    ('public._crm_source_label(text, uuid, text)', '71de674fbe0ed9bbec487832d2d90807'),
    ('public._email_send_policy_many(text[], text)', 'e72cc14ba16dc6f3abcb72ea46efb2d7'),
    ('public._enqueue_campaign_recipients_core(uuid)', '31eefc087006820454bc83e5853a674f'),
    ('public._enqueue_crm_sms_recipients(uuid)', '229ff50773e0a95b1bec1090cebab007'),
    ('public._first_return_candidates(text, uuid, timestamp with time zone)', 'd18246a0bcd693772a06b40d0392fe7f'),
    ('public._mcp_email_audience(text, text, text, uuid, text)', '8fa107427fa9354e8a30a22ae8afbe3b'),
    ('public._mcp_email_tool(text, text, text, text, text, jsonb, uuid)', 'bd40c29038d4e807d7be7bc7561cc45e'),
    ('public._mcp_email_write(text, text, text, text, jsonb, uuid, uuid, text)', '58f39485ec7c409634578b928bdffa2e'),
    ('public._mcp_scenario_tool(text, text, text, jsonb)', '5249f66700a41b80a332562738de5ddc'),
    ('public._mcp_signup_events(text, uuid)', 'c852b7bc03dde84f38cbfb467e2d0e05'),
    ('public._mcp_signup_tool(text, text, text, text, text, jsonb, uuid)', 'f3af5bbb131076b16c736702b881744a'),
    ('public._mcp_ticketing(text, text, text, jsonb, uuid)', '4fd6c7f0027f7d791ae468a1d281547a'),
    ('public._resolve_meta_audience_rows(uuid, text, text)', '41b7ee87e8889427161879b145f855cc'),
    ('public.admin_customer_detail(text)', 'b654d7a8a6153810b5bee9754ade50bc'),
    ('public.admin_product_insights(timestamp with time zone, timestamp with time zone, boolean)', '67adcf49a6be11075466cd158c6dc5d3'),
    ('public.analyze_contact_lists(text, uuid)', '366287c38029e540a018f885d7152222'),
    ('public.auto_subscribe_event_waitlist()', '40d59d886133be71456e5a667f9a1c6f'),
    ('public.auto_subscribe_guest_list_entry()', '9025de5617dbc64427e203cb75209f25'),
    ('public.auto_subscribe_newsletter_on_purchase()', '51e1669dbc74ae810ece4ac021837659'),
    ('public.claim_campaign_recipients(uuid, integer)', 'abd7a71cdaba2442bf0b3091f8ca0c9e'),
    ('public.collect_campaign_followups()', 'f6f55cf4d75f424067065a430ae9ee3e'),
    ('public.collect_campaign_resends()', '146f047b486637c9bcf0ccb8a5bb5c43'),
    ('public.collect_email_automations()', 'd3955395a10a0c2ae335a3e7365f5ac2'),
    ('public.community_membership(uuid, uuid, text)', 'b7dc69dba2009c549cf604afc2c03417'),
    ('public.contact_base_cache_refresh(interval)', '60be087dcab587e2b4814e5209d3f22b'),
    ('public.contact_engagement_sweep()', 'bd96e601feca751e19447d90e438987f'),
    ('public.contact_import_absorb(uuid)', '4d024fabfe64b1038973bde85056b733'),
    ('public.count_campaign_recipients(text, text, text, uuid, uuid)', '46f8dd4e99eac21de0ece903f1490224'),
    ('public.count_campaign_recipients_org(uuid, text, text, uuid)', 'a6fd301bc0b0ba24d7d7becc113c80f4'),
    ('public.count_organizer_audience_kinds(uuid, uuid)', 'b04ff3689264c32d41c324c912550192'),
    ('public.count_sms_campaign_recipients(text, uuid, text, uuid, uuid, uuid, uuid[], text)', '54b209b05142be7fb629c2b2c9e608e5'),
    ('public.crm_admin_product(boolean)', 'd91c852fb147c74e1d1e798100345e87'),
    ('public.crm_ana_traffic__core(text, uuid, text, uuid)', 'f6cf68d1f25b41f57ecc27896af7e8c5'),
    ('public.crm_automation_save(text, uuid, text, boolean, integer, text, uuid)', '560bed11c351f6cea865b97e07fe4db9'),
    ('public.crm_automation_sms_save(text, uuid, text, boolean, text, integer)', '0b2c1f9f390027043948db8df4989c7d'),
    ('public.crm_automations__core(text, uuid, text)', 'f50d5ca3a9b6affb80d93e8eeb8fa726'),
    ('public.crm_client__core(text, uuid, text)', 'a8582f4e54a34b814f846afa865ead3d'),
    ('public.crm_email_audience_preview(text, uuid, jsonb, uuid, integer, boolean, uuid)', '8069d97e6667964ffb3f4f9787488d3e'),
    ('public.crm_email_audience_sizes(text, uuid, uuid[])', 'a844eb6614bf38b7653fa3fa385f717f'),
    ('public.crm_email_campaigns__core(text, uuid)', 'b3d2fbe0cdbcbf34798be341f7b7b8fb'),
    ('public.crm_email_overview__core(text, uuid, integer)', '332a7247157b64a78073f7d8501281c5'),
    ('public.crm_email_recipient_emails(text, uuid, uuid, text)', '6da953c68a15e8820d7758d7b05a6da3'),
    ('public.crm_email_recipients__core(text, uuid, uuid, text, text, integer)', '3dcae9c788e8e335fdb128c91fcc1374'),
    ('public.crm_email_result__core(text, uuid, uuid)', '83f8141552bfde1cc2aafb342748f0f0'),
    ('public.crm_email_result_segments__core(text, uuid, uuid)', '3fa185380b6540006602681f510982be'),
    ('public.crm_email_send_options(text, uuid)', 'bb79d304e96360f2569f70dd78649673'),
    ('public.crm_first_return_sms_collect()', 'd08121b9663491f630b38b6994612e71'),
    ('public.crm_first_steps(text, uuid)', '9f2f8e422ed21809df16062874b15ebc'),
    ('public.crm_holdout_overview(text, uuid, integer)', '8685b56f51c0444117a94e3e9bbdfee2'),
    ('public.crm_import_commit(text, uuid, uuid, jsonb, text, text, text, boolean, jsonb, text)', 'b0be50c30c8df7aaa1672c5cc2a1e82f'),
    ('public.crm_import_undo(text, uuid, uuid)', 'f3bdc3768086c4a31a4e37e745019df2'),
    ('public.crm_imports_overview(text, uuid)', '8e9ef0c30cd4eceae9b2a39f8648e5ec'),
    ('public.crm_journey__core(text, uuid, text, uuid, uuid, text, text)', '0292ddf99feb0706652c15202f6bedfc'),
    ('public.crm_practical_night(text, uuid, uuid)', '35464ec242ffa42a4a22a592b7adaf37'),
    ('public.crm_scenario_counts(text, uuid, jsonb, uuid, text)', '82a0e5fd63823014d74b184604d825ee'),
    ('public.crm_scenario_preview(text, uuid, uuid)', '2394fe65d49196170326acd7908baae6'),
    ('public.crm_scenario_publish(text, uuid, uuid, timestamp with time zone)', '9bc02a129d34fb9e786f2562a89c51e2'),
    ('public.crm_scenario_set_status(text, uuid, uuid, text)', 'f84fc6a79e93b62ba5ec844b95e78081'),
    ('public.crm_search(text, uuid, text)', '96c00ddc1e6d34d4ad621e88b90db6c7'),
    ('public.crm_signup_confirm(text, text)', '34a8be12eb21e2fa5d215c66cd22bda2'),
    ('public.crm_signup_page_save(text, uuid, uuid, jsonb)', '17ca75a0a47f1ebaac328047323e54e7'),
    ('public.crm_signup_relance_collect()', '94cea634bab176eed28535d4ca67210d'),
    ('public.crm_sms_audience_preview(text, uuid, jsonb, uuid, integer, boolean, uuid)', 'f1f15881879cd9e62366c52501fe1d94'),
    ('public.email_automation_covers_event(uuid, text)', '0ab1bf7836937aa2076d610800605a75'),
    ('public.email_automation_suggestions_sweep()', '2dfb97f8d03b3fafbe2ce17a497a4a3a'),
    ('public.email_automation_weekly_digest(text, text)', 'f18eaa49a48579d238dffbcc1b0e0d77'),
    ('public.email_marketing_pressure(text)', '67fa7cb02402f9759a912e27839ae8eb'),
    ('public.export_venue_ad_audience(text)', '3ae1fa90d942a8b21b0cd0fc749fcff7'),
    ('public.get_analytics_campaigns(text, uuid, uuid, timestamp with time zone, timestamp with time zone)', 'f89ed17a0af98111ec159ca5a23f2d10'),
    ('public.get_community_period(text, uuid, integer)', 'aa92c86fa65ef9ebd311c9e31f7ed2c9'),
    ('public.get_contact_intelligence_overview(text, uuid)', '1694dab550c97a264488db8f303bab26'),
    ('public.get_crm_billing(text, uuid)', '219e8cf7e4d849023b9b1d75a48b5a49'),
    ('public.get_crm_night_report__core(uuid)', '5a3eae3f36d89f087cc5e09f7ad3b3a4'),
    ('public.get_crm_overview__core(text, uuid)', 'e0d85760fb169a52d89d52181f96e99f'),
    ('public.get_customer_automation_emails(text, uuid, text)', '9f46a15e1991c0d7c487ba3cd3c4d014'),
    ('public.get_dj_lineup_email_targets(uuid, uuid)', '75630c7115339a5cbb7d167171870575'),
    ('public.get_email_campaign_attribution(text, text)', 'c5c7407c0d6b5302e4549aaac7a9e1d8'),
    ('public.get_email_send_time_insights(text, uuid)', 'bd5689a7c2e9b44e342abbb3d646d474'),
    ('public.get_event_community(uuid)', 'a8bc911c6786d332cef8d0e5f2884ae0'),
    ('public.get_event_marketing_hosts(uuid)', 'bfe7bb878a188acbfa61b0e6892ad89f'),
    ('public.get_my_marketing_consent(text, uuid)', '47d1077f63f41ea0d720ce4502dad851'),
    ('public.get_recipient_block_conds(uuid, text[])', 'bcd4540676dfffd1bd563883575515b0'),
    ('public.guard_crm_send_frozen()', '7cc74778b25a240a17e6d6c539a59220'),
    ('public.guard_recipe_vs_scenario()', 'f6e2f471e619f2ae17ad09bc3bcacadb'),
    ('public.handoff_showcase_organizer(uuid, uuid)', 'ae18ce1e1997e25f251d80398c7a964b'),
    ('public.meta_lead_to_contact(text)', '31998a7d869d464fc7b328645846cfc4'),
    ('public.preview_unsubscribe(uuid)', 'a637a2a2c870ac3b2c06f5ef8a0a9783'),
    ('public.purge_email_list(uuid)', '7aacf31550e7062635545ab85c4568e3'),
    ('public.record_campaign_list_baseline(uuid)', 'dabe82ff81ae42230b877219373866ad'),
    ('public.refresh_campaign_list_impacts(text, uuid)', 'e2bd0a47d441486bd3f4b29faaf21a64'),
    ('public.resolve_campaign_audience(uuid)', 'b6f34464910b9c11471aba88c581972b'),
    ('public.resolve_sale_attribution(text, uuid, uuid, text, timestamp with time zone, uuid, uuid, text, uuid)', '4e834a253411840aee797ad3cf77f92d'),
    ('public.resolve_sms_campaign_recipients(text, uuid, text, uuid, uuid, uuid, uuid[], text)', '6df7f7f53013496905dc72a823f1d0bb'),
    ('public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text, text, text, text, text)', '812191c9c4456f06d963c6c5c600c702'),
    ('public.subscribe_my_community_newsletter(uuid, text, text, text)', 'c534e1d9066d5dde0c69f2dc97402a5e'),
    ('public.ticketing_connections_withdraw_consents()', 'ee15c2fcc85b685e18ab38b6be96712f'),
    ('public.unsubscribe_by_token(uuid)', 'dfa0d0b969a7dc67a5d4d4100a14c195')
  ) AS v(sig, md5) LOOP
    v_oid := to_regprocedure(r.sig);
    IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% a changé depuis l''audit du 20/10 : régénérer la migration depuis pg_get_functiondef', r.sig;
    END IF;
  END LOOP;
END $guard$;

-- ── 0. Les portées concernées ────────────────────────────────────────────────
-- crm_scope_has_crm = le CRM existe sur le compte (pur OU à deux produits) ;
-- crm_scope_is_crm  = compte CRM PUR (extra_products ne contient pas 'suite').
CREATE TEMP TABLE IF NOT EXISTS _d_scopes (scope_key text PRIMARY KEY, venue_id text, organizer_user_id uuid, pure boolean) ON COMMIT DROP;
TRUNCATE _d_scopes;
INSERT INTO _d_scopes
SELECT s.scope_key, s.venue_id, s.organizer_user_id, public.crm_scope_is_crm(s.scope_key)
  FROM (SELECT 'venue:' || v.id AS scope_key, v.id AS venue_id, NULL::uuid AS organizer_user_id FROM public.venues v
        UNION ALL
        SELECT 'org:' || o.user_id, NULL::text, o.user_id FROM public.organizer_profiles o) s
 WHERE public.crm_scope_has_crm(s.scope_key);

-- ── 1. Les anciens index d'unicité ─────────────────────────────────────────────────────────
-- ── A-2b. On retire les ANCIENS index (un seul accord par adresse et par portée) ────────────────────
-- À partir d'ici, tout `ON CONFLICT (lower(email), venue_id|organizer_user_id)` sans `product` lève 42P10 :
-- les 12 écrivains listés dans le rapport (§ écrivains) sont patchés dans CETTE transaction.
DROP INDEX IF EXISTS public.uniq_newsletter_subs_email_venue;
DROP INDEX IF EXISTS public.uniq_newsletter_subs_email_organizer;

DROP INDEX IF EXISTS public.uniq_email_opt_outs_venue;
DROP INDEX IF EXISTS public.uniq_email_opt_outs_organizer;
-- (uniq_email_opt_outs_platform : inchangé, product NULL)

ALTER TABLE public.venue_sms_contacts DROP CONSTRAINT IF EXISTS venue_sms_contacts_unique_phone;
ALTER TABLE public.venue_sms_contacts DROP CONSTRAINT IF EXISTS venue_sms_contacts_unique_org_phone;

-- ═════════════════════════════════════════════════════════════════════════════
-- D-1. email_automations : UN slot par (portée, recette, PRODUIT)
-- ═════════════════════════════════════════════════════════════════════════════
-- `product` existe depuis 20261019103000 (CHECK IN ('suite','crm')). 'suite' n'a jamais été
-- écrit par un client : la Billetterie écrit NULL. On normalise et on resserre le CHECK, sinon
-- NULL et 'suite' seraient deux valeurs distinctes pour l'index unique NULLS NOT DISTINCT.
UPDATE public.email_automations SET product = NULL WHERE product = 'suite';

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.email_automations'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ~ '\mproduct\M' LOOP
    EXECUTE format('ALTER TABLE public.email_automations DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.email_automations
  ADD CONSTRAINT email_automations_product_check CHECK (product IS NULL OR product = 'crm'),
  -- Les recettes de Yuno lui-même (portée plateforme : les deux colonnes NULL) restent product NULL.
  ADD CONSTRAINT email_automations_platform_no_product CHECK (product IS NULL OR venue_id IS NOT NULL OR organizer_user_id IS NOT NULL);

-- Règle (ii) du brief : un compte CRM PUR n'a que des recettes CRM.
-- (Règle (iii) : sur un compte à deux produits, les recettes déjà 'crm' restent 'crm', les NULL restent
--  Billetterie — le contrôle R-1 du 20/10 n'a trouvé aucune recette CRM sans produit : rien à copier.)
ALTER TABLE public.email_automations DISABLE TRIGGER trg_email_automations_before_write;  -- ne pas toucher updated_at
UPDATE public.email_automations a
   SET product = 'crm'
 WHERE a.product IS NULL AND (a.venue_id IS NOT NULL OR a.organizer_user_id IS NOT NULL)
   AND public.crm_scope_is_crm(public.crm_scope_key(a.venue_id, a.organizer_user_id));
ALTER TABLE public.email_automations ENABLE TRIGGER trg_email_automations_before_write;

-- Index uniques : (portée, recette) devient (portée, recette, produit). NULLS NOT DISTINCT : NULL
-- (Billetterie) compte comme une valeur. Les WHERE partiels d'origine sont gardés. Même noms qu'avant.
DROP INDEX IF EXISTS public.uniq_email_automations_org_kind;
CREATE UNIQUE INDEX uniq_email_automations_org_kind
  ON public.email_automations (organizer_user_id, kind, product) NULLS NOT DISTINCT
  WHERE organizer_user_id IS NOT NULL;
DROP INDEX IF EXISTS public.uniq_email_automations_venue_kind;
CREATE UNIQUE INDEX uniq_email_automations_venue_kind
  ON public.email_automations (venue_id, kind, product) NULLS NOT DISTINCT
  WHERE venue_id IS NOT NULL;
-- uniq_email_automations_platform_kind (kind) WHERE venue_id IS NULL AND organizer_user_id IS NULL : INCHANGÉ
-- (la portée plateforme ne se sépare pas ; le CHECK ci-dessus lui interdit product = 'crm').

COMMENT ON COLUMN public.email_automations.product IS
  'Produit propriétaire de la recette : NULL = Yuno Tickets (Billetterie), ''crm'' = Yuno CRM. Un slot par (portée, recette, produit). Posé à l''insertion par le trigger _separation_default_product (compte mono-produit) ou par l''écrivain (compte à deux produits : crm_automation_save écrit ''crm'', la page Automatisations de la Billetterie ne passe rien).';


DROP TRIGGER IF EXISTS trg_email_automations_product_default ON public.email_automations;
CREATE TRIGGER trg_email_automations_product_default
  BEFORE INSERT ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public._separation_default_product();
DROP TRIGGER IF EXISTS trg_0_email_automations_product_guard ON public.email_automations;
CREATE TRIGGER trg_0_email_automations_product_guard
  BEFORE UPDATE OF product ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketing_product_immutable();
-- Ordre des triggers BEFORE INSERT (alphabétique) : trg_crm_automation_limit (lit scope_limits, NULL hors compte
-- CRM pur : indépendant du produit) → trg_email_automations_before_write → trg_email_automations_product_default
-- → trg_guard_recipe_vs_scenario (lit NEW.product, patché). Le défaut passe donc AVANT la seule garde qui lit product.

-- Données. Un modèle n'est PAS un registre : on ne copie que ce qui est utilisé des deux côtés.
ALTER TABLE public.email_campaign_templates DISABLE TRIGGER trg_email_campaign_templates_updated_at;

-- (ii) compte CRM pur : tout est CRM.
UPDATE public.email_campaign_templates t SET product = 'crm'
 WHERE t.product IS NULL
   AND public.crm_scope_is_crm(public.crm_scope_key(t.venue_id, t.organizer_user_id));

-- (iii) compte à deux produits.
--  a. modèles cités par un objet du CRM : recette CRM, graphe de scénario (brouillon ou version publiée),
--     relance d'une campagne CRM → ils DEVIENNENT du CRM (même id : les graphes de scénario sont immuables) ;
--  b. si la Billetterie les cite aussi (recette NULL, relance d'une campagne Billetterie) → copie Billetterie
--     (nouvel id) et ses références sont redirigées ;
--  c. les modèles que le CRM ne cite pas restent dans la bibliothèque de la Billetterie (pas de copie : le CRM
--     les recrée depuis ses kits ; décision à confirmer par Paul).
CREATE TEMP TABLE _d_tpl_crm ON COMMIT DROP AS
SELECT t.id
  FROM public.email_campaign_templates t
  JOIN _d_scopes s ON NOT s.pure
   AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE t.product IS NULL AND (
        EXISTS (SELECT 1 FROM public.email_automations a WHERE a.template_id = t.id AND a.product = 'crm')
     OR EXISTS (SELECT 1 FROM public.crm_scenarios sc WHERE sc.scope_key = s.scope_key AND position(t.id::text IN sc.draft::text) > 0)
     OR EXISTS (SELECT 1 FROM public.crm_scenario_versions v WHERE v.scope_key = s.scope_key AND position(t.id::text IN v.graph::text) > 0)
     OR EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.followup_template_id = t.id AND public.crm_campaign_is_crm(c.id)));

CREATE TEMP TABLE _d_tpl_both ON COMMIT DROP AS
SELECT t.id AS old_id, gen_random_uuid() AS new_id
  FROM public.email_campaign_templates t
  JOIN _d_tpl_crm c ON c.id = t.id
 WHERE EXISTS (SELECT 1 FROM public.email_automations a WHERE a.template_id = t.id AND a.product IS NULL)
    OR EXISTS (SELECT 1 FROM public.email_campaigns ec WHERE ec.followup_template_id = t.id AND NOT public.crm_campaign_is_crm(ec.id));

INSERT INTO public.email_campaign_templates
SELECT (jsonb_populate_record(t, jsonb_build_object('id', b.new_id, 'product', NULL))).*
  FROM public.email_campaign_templates t JOIN _d_tpl_both b ON b.old_id = t.id;
UPDATE public.email_automations a SET template_id = b.new_id
  FROM _d_tpl_both b WHERE a.template_id = b.old_id AND a.product IS NULL;
UPDATE public.email_campaigns ec SET followup_template_id = b.new_id
  FROM _d_tpl_both b WHERE ec.followup_template_id = b.old_id AND NOT public.crm_campaign_is_crm(ec.id);

UPDATE public.email_campaign_templates t SET product = 'crm' FROM _d_tpl_crm c WHERE t.id = c.id;
ALTER TABLE public.email_campaign_templates ENABLE TRIGGER trg_email_campaign_templates_updated_at;

-- Données (dérivées : recalculées par refresh_contact_engagement ; on garde la continuité d'affichage).
-- (ii) compte CRM pur → product = 'crm' (la clé générée prend le suffixe), états déplacés sous la clé `|crm`.
UPDATE public.contact_engagement ce SET product = 'crm'
 WHERE ce.product IS NULL AND public.crm_scope_is_crm(public.crm_scope_key(ce.venue_id, ce.organizer_user_id));
UPDATE public.contact_engagement_state st SET scope_key = st.scope_key || '|crm'
 WHERE st.scope_key NOT LIKE '%|crm'
   AND public.crm_scope_is_crm(public.crm_scope_key(st.venue_id, st.organizer_user_id));
-- (iii) compte à deux produits → COPIE des lignes en 'crm' (le CRM garde son affichage jusqu'au 1er refresh) ;
-- les deux états passent à « jamais rafraîchi » : le prochain passage du sweep (agent C) recalcule chaque produit
-- avec SES campagnes, SON registre et SES contacts (la copie contient encore le mélange d'avant).
INSERT INTO public.contact_engagement
  (venue_id, organizer_user_id, product, email, user_id, origin, emails_sent, emails_delivered, opens, clicks, click_events,
   opens_90d, clicks_90d, first_sent_at, last_sent_at, last_opened_at, last_clicked_at, bounced_at, complained_at,
   unsubscribed_at, suppressed, subscribed, status, status_changed_at, created_at, updated_at)
SELECT ce.venue_id, ce.organizer_user_id, 'crm', ce.email, ce.user_id, ce.origin, ce.emails_sent, ce.emails_delivered, ce.opens, ce.clicks, ce.click_events,
       ce.opens_90d, ce.clicks_90d, ce.first_sent_at, ce.last_sent_at, ce.last_opened_at, ce.last_clicked_at, ce.bounced_at, ce.complained_at,
       ce.unsubscribed_at, ce.suppressed, ce.subscribed, ce.status, ce.status_changed_at, ce.created_at, ce.updated_at
  FROM public.contact_engagement ce
  JOIN _d_scopes s ON NOT s.pure
   AND ce.venue_id IS NOT DISTINCT FROM s.venue_id AND ce.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE ce.product IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.contact_engagement x WHERE x.scope_key = ce.scope_key || '|crm' AND x.email = ce.email);
INSERT INTO public.contact_engagement_state (scope_key, venue_id, organizer_user_id, refreshed_at, duration_ms, summary)
SELECT st.scope_key || '|crm', st.venue_id, st.organizer_user_id, 'epoch'::timestamptz, st.duration_ms, st.summary
  FROM public.contact_engagement_state st
  JOIN _d_scopes s ON NOT s.pure AND st.scope_key = public.contact_base_scope_key(s.venue_id, s.organizer_user_id)
ON CONFLICT (scope_key) DO NOTHING;
UPDATE public.contact_engagement_state st SET refreshed_at = 'epoch'::timestamptz
  FROM _d_scopes s WHERE NOT s.pure AND st.scope_key = public.contact_base_scope_key(s.venue_id, s.organizer_user_id);
-- Le bilan « campagne → base » (email_campaign_list_impact) est une carte de la Billetterie : rien pour une campagne CRM.
DELETE FROM public.email_campaign_list_impact i
 USING public.email_campaigns c WHERE c.id = i.campaign_id AND public.crm_campaign_is_crm(c.id);

-- Continuité : un compte dont l'identité était « OK » via la fiche ne doit pas se retrouver bloqué.
-- Copie (une fois, sans écraser) pour les comptes CRM purs et pour les comptes dont le SMS CRM est ouvert.
-- Un compte à deux produits dont le SMS CRM n'est pas ouvert ne reçoit RIEN : il saisit l'identité du CRM
-- (la fiche s'affiche comme suggestion « Utiliser … », jamais copiée d'office).
WITH fiche AS (
  SELECT 'venue:' || v.id AS scope_key, v.legal_name, v.siret, NULL::text AS rna, v.vat_number AS vat FROM public.venues v
  UNION ALL
  SELECT 'org:' || o.user_id, o.legal_name, o.siret, o.rna_number, o.vat_number FROM public.organizer_profiles o
), norm AS (
  SELECT f.scope_key, left(btrim(COALESCE(f.legal_name, '')), 160) AS legal_name,
         CASE WHEN regexp_replace(COALESCE(f.siret, ''), '[^0-9]', '', 'g') ~ '^[0-9]{14}$' THEN regexp_replace(f.siret, '[^0-9]', '', 'g') END AS siret,
         CASE WHEN upper(regexp_replace(COALESCE(f.rna, ''), '\s', '', 'g')) ~ '^W[0-9]{9}$' THEN upper(regexp_replace(f.rna, '\s', '', 'g')) END AS rna,
         CASE WHEN length(btrim(COALESCE(f.vat, ''))) BETWEEN 6 AND 40 THEN btrim(f.vat) END AS vat
    FROM fiche f
)
INSERT INTO public.crm_sms_settings (scope_key, legal_name, siret, rna_number, vat_number)
SELECT n.scope_key, n.legal_name, n.siret, n.rna, n.vat
  FROM norm n JOIN _d_scopes s ON s.scope_key = n.scope_key
 WHERE (s.pure OR public.crm_sms_access_open(s.scope_key)) AND length(n.legal_name) >= 2
ON CONFLICT (scope_key) DO UPDATE SET
  legal_name = COALESCE(public.crm_sms_settings.legal_name, EXCLUDED.legal_name),
  siret      = COALESCE(public.crm_sms_settings.siret, EXCLUDED.siret),
  rna_number = COALESCE(public.crm_sms_settings.rna_number, EXCLUDED.rna_number),
  vat_number = COALESCE(public.crm_sms_settings.vat_number, EXCLUDED.vat_number);

-- ── 2. Les fonctions ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_recipe_is_crm(p_product text, p_kind text, p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Une recette est du CRM : si elle est marquée (email_automations.product = 'crm'), si son type n'existe que dans le CRM
  -- (click_no_buy, first_return), ou si le compte est un compte CRM PUR (tout y est CRM). La portée plateforme n'est jamais CRM.
  SELECT COALESCE(p_product = 'crm', false)
      OR COALESCE(p_kind IN ('click_no_buy', 'first_return'), false)
      OR COALESCE(public.crm_scope_is_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id)), false);
$function$;
REVOKE ALL ON FUNCTION public._email_recipe_is_crm(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_recipe_is_crm(text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._email_scope_campaign_ids(p_venue_id text, p_organizer_user_id uuid, p_crm boolean)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_pure boolean;
  v_has boolean;
  v uuid[];
BEGIN
  -- Les campagnes d'une portée qui sont du produit demandé (p_crm = true : CRM ; false : Billetterie).
  -- Chemins rapides : portée plateforme (jamais CRM), compte CRM pur (tout est CRM), compte sans CRM (rien n'est CRM) :
  -- aucune résolution par campagne. Compte à deux produits : crm_campaign_is_crm(campagne) (produit, audience CRM, mère).
  IF v_scope IS NULL THEN
    v_pure := false; v_has := false;
  ELSE
    v_pure := COALESCE(public.crm_scope_is_crm(v_scope), false);
    v_has := COALESCE(public.crm_scope_has_crm(v_scope), false);
  END IF;
  IF v_pure OR NOT v_has THEN
    IF COALESCE(p_crm, false) <> v_pure THEN RETURN '{}'::uuid[]; END IF;
    SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v FROM public.email_campaigns c
     WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
    RETURN v;
  END IF;
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND COALESCE(public.crm_campaign_is_crm(c.id), false) = COALESCE(p_crm, false);
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public._email_scope_campaign_ids(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_scope_campaign_ids(text, uuid, boolean) TO service_role;

DROP FUNCTION public.get_email_automation_suggestions(text, uuid);
CREATE OR REPLACE FUNCTION public.get_email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  RETURN public._email_automation_suggestions(p_venue_id, p_organizer_user_id, p_product);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_email_automation_suggestions(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_automation_suggestions(text, uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public._email_automation_enabled(text, uuid, text);
CREATE OR REPLACE FUNCTION public._email_automation_enabled(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_product text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_automations a
     WHERE a.kind = p_kind AND a.enabled AND a.product IS NOT DISTINCT FROM p_product
       AND ((p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id))
  );
$function$;
REVOKE ALL ON FUNCTION public._email_automation_enabled(text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._email_automation_enabled(text, uuid, text, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public._email_automation_next_event(text, uuid);
CREATE OR REPLACE FUNCTION public._email_automation_next_event(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT e.id
    FROM public.events e
   WHERE e.status = 'active'
     AND (e.is_active OR e.external_source IS NOT NULL)
     AND COALESCE(p_product = 'crm', false) = (e.external_source IS NOT NULL)
     AND e.cancelled_at IS NULL
     AND e.start_at > now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
   ORDER BY e.start_at ASC
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public._email_automation_next_event(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._email_automation_next_event(text, uuid, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public._email_automation_preview(text, uuid, text);
CREATE OR REPLACE FUNCTION public._email_automation_preview(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD;
  v_delay interval;
  v_threshold integer;
  v_enabled_at timestamptz;
  v_eligible integer := 0;
  v_base integer := 0;
  v_event_id uuid;
  v_event_title text;
  v_due timestamptz;
  v_start timestamptz;
  v_pub timestamptz;
  v_next uuid;
  -- Séparation CRM / Billetterie : l'aperçu se calcule sur UN produit (NULL = Billetterie, 'crm' = CRM).
  v_crm boolean := COALESCE(p_product = 'crm', false);
  v_prod text := CASE WHEN COALESCE(p_product = 'crm', false) THEN 'crm' END;
  v_same uuid[];
BEGIN
  IF (p_venue_id IS NULL AND p_organizer_user_id IS NULL) OR p_kind IS NULL THEN
    RETURN jsonb_build_object('eligible', 0, 'base', 0, 'next_event_id', NULL, 'next_event_title', NULL, 'next_due_at', NULL);
  END IF;

  SELECT x.* INTO a FROM public.email_automations x
   WHERE x.kind = p_kind
     AND ((p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = p_organizer_user_id))
     AND COALESCE(public._email_recipe_is_crm(x.product, x.kind, x.venue_id, x.organizer_user_id), false) = v_crm
   LIMIT 1;
  v_delay := make_interval(hours => COALESCE(a.delay_hours, CASE p_kind
    WHEN 'abandoned_checkout' THEN 2 WHEN 'last_call' THEN 24 WHEN 'post_event_thanks' THEN 12
    WHEN 'post_event_missed' THEN 24 WHEN 'welcome' THEN 24 WHEN 'win_back' THEN 2160
    WHEN 'table_upsell' THEN 72 WHEN 'new_event' THEN 6 WHEN 'regular_lapse' THEN 1008 WHEN 'click_no_buy' THEN 24 WHEN 'first_return' THEN 504 ELSE 24 END));
  v_threshold := COALESCE(a.threshold_pct, 85);
  v_enabled_at := COALESCE(a.enabled_at, now());
  v_next := public._email_automation_next_event(p_venue_id, p_organizer_user_id, v_prod);

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL
     AND s.product IS NOT DISTINCT FROM v_prod;

  IF p_kind IN ('last_call', 'new_event') THEN
    SELECT e.id, e.title, e.start_at, e.published_at INTO v_event_id, v_event_title, v_start, v_pub
      FROM public.events e
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours'
       AND (p_kind = 'last_call' OR (
             (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
             AND e.published_at IS NOT NULL AND e.start_at > now() + interval '48 hours'))
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
     ORDER BY (CASE WHEN p_kind = 'new_event' THEN e.published_at END) DESC NULLS LAST, e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := CASE WHEN p_kind = 'last_call' THEN v_start - v_delay ELSE v_pub + v_delay END;
      SELECT count(*) INTO v_eligible
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.product IS NOT DISTINCT FROM v_prod
         AND NOT public._email_event_holder(v_event_id, s.email)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(s.email)));
    ELSE
      v_eligible := CASE WHEN p_kind = 'new_event' THEN v_base ELSE 0 END;
    END IF;

  ELSIF p_kind = 'table_upsell' THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_event_title, v_start
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := v_start - v_delay;
      SELECT count(DISTINCT lower(t.user_email)) INTO v_eligible
        FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r
                          WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email)
                            AND r.status IN ('paid', 'used', 'confirmed', 'pending'))
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = lower(t.user_email) AND s.opted_in AND s.opted_out_at IS NULL
                        AND s.product IS NOT DISTINCT FROM v_prod
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(t.user_email)));
    END IF;

  ELSIF p_kind = 'tier_closing' THEN
    SELECT e.id, e.title INTO v_event_id, v_event_title
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * v_threshold
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds n
                    WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                      AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_same := public._email_scope_campaign_ids(p_venue_id, p_organizer_user_id, v_crm);
      SELECT count(*) INTO v_eligible FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c
          JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND c.id = ANY (v_same)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id
                OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i
      WHERE NOT public._email_event_holder(v_event_id, i.em)
        AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                     WHERE lower(s.email) = i.em AND s.opted_in AND s.opted_out_at IS NULL
                       AND s.product IS NOT DISTINCT FROM v_prod
                       AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
        AND (a.id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.email_automation_sends l
           WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = i.em));
    END IF;

  ELSIF p_kind = 'abandoned_checkout' THEN
    WITH pend AS (
      SELECT DISTINCT ON (lower(x.em), x.event_id) lower(x.em) AS em, x.event_id, x.created_at
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at
            FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND t.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at
            FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND r.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
        ) x
       ORDER BY lower(x.em), x.event_id, x.created_at DESC
    ),
    open AS (
      SELECT p.* FROM pend p
       WHERE NOT public._email_event_holder(p.event_id, p.em)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em))
    )
    SELECT count(*),
           min(o.created_at + v_delay) FILTER (WHERE o.created_at + v_delay > now()),
           (SELECT o2.event_id FROM open o2 WHERE o2.created_at + v_delay > now() ORDER BY o2.created_at LIMIT 1)
      INTO v_eligible, v_due, v_event_id
      FROM open o;
    IF v_event_id IS NOT NULL THEN
      SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
    END IF;

  ELSIF p_kind = 'welcome' THEN
    SELECT count(*), min(s.created_at + v_delay) FILTER (WHERE s.created_at + v_delay > now())
      INTO v_eligible, v_due
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND s.product IS NOT DISTINCT FROM v_prod
       AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%'
       AND COALESCE(s.source, '') NOT LIKE 'platform%'
       AND COALESCE(s.source, '') NOT LIKE 'checkout%'
       AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= LEAST(v_enabled_at, now())
       AND s.created_at >= now() - interval '14 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email)));
    v_event_id := v_next;

  ELSIF p_kind IN ('post_event_thanks', 'post_event_missed') THEN
    -- Éligibles = la dernière soirée finie et scannée (5 j) ; prochain départ
    -- = la fin de la prochaine soirée + délai.
    SELECT e.id INTO v_event_id
      FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND (e.external_source IS NOT NULL) = v_crm
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now() AND e.end_at >= now() - interval '5 days'
       AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
         OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
         OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')))
     ORDER BY e.end_at DESC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      WITH came AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND ge.entry_scanned
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      holders AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      pop AS (
        SELECT em FROM came WHERE p_kind = 'post_event_thanks'
        UNION ALL
        SELECT h.em FROM holders h WHERE p_kind = 'post_event_missed' AND NOT EXISTS (SELECT 1 FROM came c WHERE c.em = h.em)
          -- Même règle que le moteur : porte mesurée (_crm_door_measured).
          AND public._crm_door_measured((SELECT count(*) FROM holders), (SELECT count(*) FROM came))
      )
      SELECT count(*) INTO v_eligible
        FROM pop
       WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = pop.em AND s.opted_in AND s.opted_out_at IS NULL
                        AND s.product IS NOT DISTINCT FROM v_prod
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = pop.em));
    END IF;
    SELECT e.id, e.title, e.end_at + v_delay INTO v_event_id, v_event_title, v_due
      FROM public.events e
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now()
     ORDER BY e.start_at ASC
     LIMIT 1;

  ELSIF p_kind = 'click_no_buy' THEN
    v_same := public._email_scope_campaign_ids(p_venue_id, p_organizer_user_id, v_crm);
    -- Même porte que le moteur : clics nominatifs vers la billetterie d'une
    -- soirée à venir, sans place à la même adresse, encore à relancer.
    -- Fenêtre = délai + 24 h, la même que le moteur : ce que l'aperçu compte
    -- est exactement ce que la recette relance si on l'allume maintenant.
    WITH k AS (
      SELECT lower(x.recipient_email) AS em, e.id AS eid, e.start_at, max(x.created_at) AS last_click
        FROM public.email_campaigns c
        JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
        JOIN public.events e
          ON e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
         AND e.start_at > now() + interval '2 hours'
         AND NOT e.tickets_sold_out
         AND (
           (e.external_ticket_url IS NOT NULL
            AND public._link_base(COALESCE(x.metadata->'click'->>'link', x.metadata->>'link')) = public._link_base(e.external_ticket_url))
           OR (c.event_id = e.id
               AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/')
         )
       WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND c.id = ANY (v_same)
         AND x.recipient_email IS NOT NULL
         AND x.created_at > now() - v_delay - interval '24 hours'
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = c.id AND lower(r.email) = lower(x.recipient_email))
       GROUP BY lower(x.recipient_email), e.id, e.start_at
    ),
    open AS (
      SELECT k.* FROM k
       WHERE k.last_click + v_delay > now() - interval '24 hours'
         AND position('@' in k.em) > 1
         AND NOT public._email_event_holder(k.eid, k.em)
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = k.em AND s.opted_in AND s.opted_out_at IS NULL
                        AND s.product IS NOT DISTINCT FROM v_prod
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = k.eid::text AND lower(l.email) = k.em))
    )
    SELECT count(*),
           min(o.last_click + v_delay) FILTER (WHERE o.last_click + v_delay > now()),
           (SELECT o2.eid FROM open o2 ORDER BY o2.start_at LIMIT 1)
      INTO v_eligible, v_due, v_event_id
      FROM open o;

  ELSIF p_kind = 'win_back' THEN
    SELECT count(*) INTO v_eligible
      FROM public.newsletter_subscriptions s
      JOIN (
        SELECT x.em, max(x.at) AS last_at FROM (
          SELECT lower(t.user_email) AS em, t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE NOT v_crm AND t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT lower(r.user_email), r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE NOT v_crm AND r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT lower(ge.email), ge.entry_scanned_at FROM public.guest_list_entries ge
            JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE NOT v_crm AND ge.email IS NOT NULL AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
           WHERE v_crm AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
             AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
        ) x
       GROUP BY x.em
      ) act ON act.em = lower(s.email)
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND s.product IS NOT DISTINCT FROM v_prod
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - v_delay
       AND act.last_at > now() - v_delay - interval '120 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
            AND l.created_at > now() - interval '180 days'));
    v_event_id := v_next;

  ELSIF p_kind = 'regular_lapse' THEN
    -- Même porte que le moteur. La soirée affichée est celle que Yuno a
    -- choisie pour le plus récent d'entre eux (chacun reçoit la sienne).
    SELECT count(*), (array_agg(r.pick_event_id ORDER BY r.last_at DESC) FILTER (WHERE r.pick_event_id IS NOT NULL))[1]
      INTO v_eligible, v_event_id
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, v_delay, v_prod) r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND s.product IS NOT DISTINCT FROM v_prod
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = r.em
            AND l.created_at > now() - interval '120 days'));
    v_event_id := COALESCE(v_event_id, v_next);

  ELSIF p_kind = 'first_return' THEN
    -- Même porte que le moteur : ceux dont l'envoi serait dû cette semaine.
    SELECT count(*), (array_agg(r.pick_event_id ORDER BY r.due_at DESC) FILTER (WHERE r.pick_event_id IS NOT NULL))[1]
      INTO v_eligible, v_event_id
      FROM public._first_return_candidates(p_venue_id, p_organizer_user_id, now() - interval '7 days') r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND s.product IS NOT DISTINCT FROM v_prod
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = r.em AND l.trigger_key = 'fr'));
    v_event_id := COALESCE(v_event_id, v_next);
  END IF;

  IF v_event_id IS NOT NULL AND v_event_title IS NULL THEN
    SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'eligible', COALESCE(v_eligible, 0),
    'base', COALESCE(v_base, 0),
    'next_event_id', v_event_id,
    'next_event_title', v_event_title,
    'next_due_at', CASE WHEN v_due > now() THEN v_due END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._email_automation_preview(text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._email_automation_preview(text, uuid, text, text) TO service_role;

DROP FUNCTION IF EXISTS public._email_automation_suggestions(text, uuid);
CREATE OR REPLACE FUNCTION public._email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  out jsonb := '[]'::jsonb;
  v_base integer := 0;
  n integer;
  v_event_id uuid;
  v_title text;
  v_start timestamptz;
  v_pct integer;
  -- Séparation CRM / Billetterie : les suggestions se calculent sur UN produit (NULL = Billetterie, 'crm' = CRM).
  v_crm boolean := COALESCE(p_product = 'crm', false);
  v_prod text := CASE WHEN COALESCE(p_product = 'crm', false) THEN 'crm' END;
  v_same uuid[];
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN RETURN out; END IF;
  -- La démo n'est pas un chiffre.
  IF p_venue_id IS NOT NULL AND p_venue_id = ANY (public.demo_venue_ids()) THEN RETURN out; END IF;
  IF p_organizer_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_organizer_user_id AND public.is_demo_email(p.email)
  ) THEN RETURN out; END IF;

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL
     AND s.product IS NOT DISTINCT FROM v_prod;

  -- Panier abandonné : ≥ 3 paiements commencés et jamais finis sur 30 j.
  IF NOT v_crm AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'abandoned_checkout', p_product) THEN
    SELECT count(*) INTO n FROM (
      SELECT DISTINCT lower(x.em), x.event_id FROM (
        SELECT t.user_email AS em, t.event_id FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.status = 'pending' AND t.user_email IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT r.user_email, r.event_id FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.status = 'pending' AND r.user_email IS NOT NULL AND r.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
      ) x
      WHERE NOT public._email_event_holder(x.event_id, x.em)
    ) y;
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'abandoned_checkout', 'reason_key', 'em.auto.sug.abandoned',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Dernier appel : prochaine soirée sous 10 j qui vend encore, base ≥ 50.
  IF v_base >= 50 AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'last_call', p_product) THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_title, v_start
      FROM public.events e
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours' AND e.start_at <= now() + interval '10 days'
       AND (((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out) OR (e.tables_enabled AND NOT e.tables_sold_out)
            OR (NOT e.guest_list_sold_out AND EXISTS (SELECT 1 FROM public.guest_lists gl WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out)))
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL AND s.product IS NOT DISTINCT FROM v_prod AND NOT public._email_event_holder(v_event_id, s.email);
      out := out || jsonb_build_object('kind', 'last_call', 'reason_key', 'em.auto.sug.lastCall',
               'reason_vars', jsonb_build_object('event', v_title, 'd', GREATEST(0, floor(extract(epoch FROM (v_start - now())) / 86400))::integer, 'n', n),
               'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Passe en table : prochaine soirée avec tables libres et ≥ 20 billets vendus.
  IF NOT v_crm AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'table_upsell', p_product) THEN
    v_event_id := NULL;
    SELECT e.id, e.title INTO v_event_id, v_title
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
       AND (SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t WHERE t.event_id = e.id AND t.status IN ('paid', 'used')) >= 20
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(DISTINCT lower(t.user_email)) INTO n FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email) AND r.status IN ('paid', 'used', 'confirmed', 'pending'));
      out := out || jsonb_build_object('kind', 'table_upsell', 'reason_key', 'em.auto.sug.tableUpsell',
               'reason_vars', jsonb_build_object('event', v_title, 'n', n), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Nouvelle soirée : ≥ 1 soirée publiée sur 30 j sans aucune campagne reliée.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'new_event', p_product) THEN
    SELECT count(*) INTO n FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND (e.external_source IS NOT NULL) = v_crm
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.published_at >= now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.event_id = e.id
                         AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 1 THEN
      out := out || jsonb_build_object('kind', 'new_event', 'reason_key', 'em.auto.sug.newEvent',
               'reason_vars', jsonb_build_object('n', n), 'reach', v_base);
    END IF;
  END IF;

  -- Merci / On t'a manqué : ≥ 1 soirée passée avec scans sur 30 j.
  SELECT count(*) INTO n FROM public.events e
   WHERE e.status = 'active' AND e.cancelled_at IS NULL
     AND (e.external_source IS NOT NULL) = v_crm
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
     AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
       OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
       OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')));
  IF n >= 1 THEN
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_thanks', p_product) THEN
      out := out || jsonb_build_object('kind', 'post_event_thanks', 'reason_key', 'em.auto.sug.thanks',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT em) FROM (
                   SELECT lower(t.user_email) AS em FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                    WHERE NOT v_crm AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)) AND t.user_email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
                    WHERE NOT v_crm AND ge.entry_scanned AND ge.email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(xt.buyer_email) FROM public.external_tickets xt JOIN public.events e ON e.id = xt.event_id
                    WHERE v_crm AND xt.scanned_at IS NOT NULL AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                 ) c));
    END IF;
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_missed', p_product) THEN
      out := out || jsonb_build_object('kind', 'post_event_missed', 'reason_key', 'em.auto.sug.missed',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                  WHERE NOT v_crm AND t.status = 'paid' AND NOT t.used AND NOT COALESCE(t.entry_scanned, false) AND t.user_email IS NOT NULL
                    AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                    AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))));
    END IF;
  END IF;

  -- L'habitué décroche : ≥ 3 habitués (deux sorties par mois) silencieux
  -- depuis six semaines, que personne n'a encore relancés.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'regular_lapse', p_product) THEN
    SELECT count(*) INTO n
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, interval '42 days', v_prod) r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL AND s.product IS NOT DISTINCT FROM v_prod
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'regular_lapse', 'reason_key', 'em.auto.sug.regularLapse',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Reconquête : ≥ 30 clients silencieux depuis 60 j (dernière venue entre 60 et 240 j).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'win_back', p_product) THEN
    -- Dernière venue calculée UNE fois par adresse (20261016240000) : la
    -- version par abonné (LATERAL) relisait tous les billets Shotgun du
    -- compte pour chacun — plus de 2 minutes sur un compte de 30 000
    -- billets, et l'écran Automatisations ne s'ouvrait plus. Même règle.
    WITH act AS (
      SELECT x.em, max(x.at) AS last_at FROM (
        SELECT lower(t.user_email) AS em, t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE NOT v_crm AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT lower(r.user_email), r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE NOT v_crm AND r.status IN ('paid', 'used') AND r.user_email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT lower(ge.email), ge.entry_scanned_at FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
         WHERE NOT v_crm AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL AND ge.email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
         WHERE v_crm AND xt.status IN ('valid', 'transferred') AND xt.buyer_email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
      ) x
      GROUP BY x.em
    )
    SELECT count(*) INTO n
      FROM public.newsletter_subscriptions s
      JOIN act ON act.em = lower(s.email)
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND s.product IS NOT DISTINCT FROM v_prod
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - interval '60 days'
       AND act.last_at > now() - interval '240 days';
    IF n >= 30 THEN
      out := out || jsonb_build_object('kind', 'win_back', 'reason_key', 'em.auto.sug.winBack',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Bienvenue : ≥ 10 nouvelles inscriptions sur 30 j (hors imports, checkout, plateforme).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'welcome', p_product) THEN
    SELECT count(*) INTO n FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL AND s.product IS NOT DISTINCT FROM v_prod AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%' AND COALESCE(s.source, '') NOT LIKE 'platform%' AND COALESCE(s.source, '') NOT LIKE 'checkout%' AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= now() - interval '30 days';
    IF n >= 10 THEN
      out := out || jsonb_build_object('kind', 'welcome', 'reason_key', 'em.auto.sug.welcome',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Le tarif monte : une soirée en paliers dont le palier ouvert dépasse 70 %, avec un palier plus cher ensuite.
  IF NOT v_crm AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'tier_closing', p_product) THEN
    v_event_id := NULL;
    SELECT e.id, e.title, cur.pct INTO v_event_id, v_title, v_pct
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price, (r.tickets_sold * 100 / r.max_tickets)::integer AS pct
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * 70
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds nx WHERE nx.event_id = e.id AND nx.position > cur.position AND nx.price > cur.price AND NOT nx.manually_sold_out AND nx.tickets_sold < nx.max_tickets)
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_same := public._email_scope_campaign_ids(p_venue_id, p_organizer_user_id, v_crm);
      SELECT count(*) INTO n FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND c.id = ANY (v_same)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i WHERE NOT public._email_event_holder(v_event_id, i.em);
      out := out || jsonb_build_object('kind', 'tier_closing', 'reason_key', 'em.auto.sug.tier',
               'reason_vars', jsonb_build_object('event', v_title, 'p', v_pct), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Les plus larges d'abord.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'reach')::integer DESC), '[]'::jsonb) INTO out
    FROM jsonb_array_elements(out) x;
  RETURN out;
END;
$function$;
REVOKE ALL ON FUNCTION public._email_automation_suggestions(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._email_automation_suggestions(text, uuid, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public._email_engagement_rank(text, text, uuid);
CREATE OR REPLACE FUNCTION public._email_engagement_rank(p_email text, p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- (a) a ouvert ou cliqué un email marketing sous 90 j (tous expéditeurs).
    WHEN EXISTS (
      SELECT 1 FROM public.email_campaign_events ev
       WHERE lower(ev.recipient_email) = lower(p_email)
         AND ev.event_type IN ('opened', 'clicked')
         AND ev.created_at > now() - interval '90 days'
    ) THEN 0
    -- (b) est venu sous 180 j : billet payé, table payée ou scan de liste invités, dans la portée.
    WHEN EXISTS (
      SELECT 1 FROM public.tickets t JOIN public.events e ON e.id = t.event_id
       WHERE p_product IS DISTINCT FROM 'crm' AND lower(t.user_email) = lower(p_email) AND t.status IN ('paid', 'used')
         AND t.created_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
       WHERE p_product IS DISTINCT FROM 'crm' AND lower(r.user_email) = lower(p_email) AND r.status IN ('paid', 'used')
         AND r.created_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.guest_list_entries ge
        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
        JOIN public.events e ON e.id = gl.event_id
       WHERE p_product IS DISTINCT FROM 'crm' AND lower(ge.email) = lower(p_email) AND ge.entry_scanned
         AND ge.entry_scanned_at > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
    ) OR EXISTS (
      SELECT 1 FROM public.external_tickets xt
       WHERE p_product = 'crm' AND lower(xt.buyer_email) = lower(p_email) AND xt.status IN ('valid', 'transferred')
         AND COALESCE(xt.purchased_at, xt.first_seen_at) > now() - interval '180 days'
         AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
    ) THEN 1
    -- (c) inscrit au registre de la portée sous 30 j.
    WHEN EXISTS (
      SELECT 1 FROM public.newsletter_subscriptions s
       WHERE lower(s.email) = lower(p_email)
         AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.product IS NOT DISTINCT FROM p_product
         AND s.created_at > now() - interval '30 days'
    ) THEN 2
    ELSE 3
  END;
$function$;
REVOKE ALL ON FUNCTION public._email_engagement_rank(text, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._email_engagement_rank(text, text, uuid, text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public._email_engagement_ranks(text[], text, uuid);
CREATE OR REPLACE FUNCTION public._email_engagement_ranks(p_emails text[], p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL::text)
 RETURNS TABLE(email text, rnk integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  r0 AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  r1 AS (
    SELECT lower(t.user_email) AS em
      FROM public.tickets t JOIN public.events ev ON ev.id = t.event_id
     WHERE p_product IS DISTINCT FROM 'crm' AND t.status IN ('paid', 'used') AND t.created_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(t.user_email) IN (SELECT em FROM e)
    UNION
    SELECT lower(r.user_email)
      FROM public.table_reservations r JOIN public.events ev ON ev.id = r.event_id
     WHERE p_product IS DISTINCT FROM 'crm' AND r.status IN ('paid', 'used') AND r.created_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(r.user_email) IN (SELECT em FROM e)
    UNION
    SELECT lower(ge.email)
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      JOIN public.events ev ON ev.id = gl.event_id
     WHERE p_product IS DISTINCT FROM 'crm' AND ge.entry_scanned AND ge.entry_scanned_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(ge.email) IN (SELECT em FROM e)
    UNION
    SELECT lower(xt.buyer_email)
      FROM public.external_tickets xt
     WHERE p_product = 'crm' AND xt.status IN ('valid', 'transferred')
       AND COALESCE(xt.purchased_at, xt.first_seen_at) > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
       AND lower(xt.buyer_email) IN (SELECT em FROM e)
  ),
  r2 AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.product IS NOT DISTINCT FROM p_product
       AND s.created_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE WHEN r0.em IS NOT NULL THEN 0
              WHEN r1.em IS NOT NULL THEN 1
              WHEN r2.em IS NOT NULL THEN 2
              ELSE 3 END
    FROM e
    LEFT JOIN r0 ON r0.em = e.em
    LEFT JOIN (SELECT DISTINCT em FROM r1) r1 ON r1.em = e.em
    LEFT JOIN r2 ON r2.em = e.em;
$function$;
REVOKE ALL ON FUNCTION public._email_engagement_ranks(text[], text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._email_engagement_ranks(text[], text, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public._mcp_email_scope_events(text, uuid);
CREATE OR REPLACE FUNCTION public._mcp_email_scope_events(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(x.id), '{}') FROM public.events x
   WHERE x.cancelled_at IS NULL
     AND (p_product IS NULL OR (p_product = 'crm') = (x.external_source IS NOT NULL))
     AND (
     (p_organizer_user_id IS NOT NULL AND (x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id
        OR x.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id))))
     OR (p_venue_id IS NOT NULL AND (x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id
        OR x.id IN (SELECT public.cohost_event_ids_venue(p_venue_id)))))
$function$;
REVOKE ALL ON FUNCTION public._mcp_email_scope_events(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mcp_email_scope_events(text, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public._regular_lapse_candidates(text, uuid, interval);
CREATE OR REPLACE FUNCTION public._regular_lapse_candidates(p_venue_id text, p_organizer_user_id uuid, p_gap interval, p_product text DEFAULT NULL)
 RETURNS TABLE(em text, user_id uuid, last_at timestamp with time zone, nights integer, pick_event_id uuid, pick_reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scope_ev AS (
    SELECT e.id, e.start_at, e.recurring_template_id,
           ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')::date AS night,
           ARRAY(
             SELECT DISTINCT lower(btrim(g))
               FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
              WHERE g IS NOT NULL AND btrim(g) <> ''
           ) AS genres
      FROM public.events e
     WHERE e.cancelled_at IS NULL
       AND e.start_at < now()
       AND e.start_at > now() - p_gap - interval '120 days'
       AND COALESCE(p_product = 'crm', false) = (e.external_source IS NOT NULL)
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
  ),
  visits AS (
    SELECT lower(t.user_email) AS em, t.user_id, t.event_id
      FROM public.tickets t JOIN scope_ev ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
    UNION
    SELECT lower(r.user_email), r.user_id, r.event_id
      FROM public.table_reservations r JOIN scope_ev ev ON ev.id = r.event_id
     WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'used', 'confirmed')
    UNION
    SELECT lower(ge.email), ge.user_id, gl.event_id
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      JOIN scope_ev ev ON ev.id = gl.event_id
     WHERE ge.email IS NOT NULL AND ge.entry_scanned
    UNION
    -- Yuno CRM : billets de la billetterie connectée.
    SELECT lower(xt.buyer_email), NULL::uuid, xt.event_id
      FROM public.external_tickets xt JOIN scope_ev ev ON ev.id = xt.event_id
     WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
  ),
  v AS (
    SELECT x.em, x.user_id, ev.id AS event_id, ev.start_at, ev.night, ev.recurring_template_id, ev.genres
      FROM visits x JOIN scope_ev ev ON ev.id = x.event_id
     WHERE position('@' in x.em) > 1
  ),
  last_v AS (
    SELECT v.em, max(v.start_at) AS last_at,
           (array_agg(v.user_id) FILTER (WHERE v.user_id IS NOT NULL))[1] AS user_id
      FROM v GROUP BY v.em
  ),
  lapsed AS (
    SELECT l.em, l.user_id, l.last_at,
           count(DISTINCT v.night)::integer AS nights,
           array_agg(DISTINCT v.recurring_template_id) FILTER (WHERE v.recurring_template_id IS NOT NULL) AS series,
           mode() WITHIN GROUP (ORDER BY extract(isodow FROM v.night)) AS dow
      FROM last_v l
      JOIN v ON v.em = l.em AND v.start_at > l.last_at - interval '60 days' AND v.start_at <= l.last_at
     WHERE l.last_at <= now() - p_gap
       AND l.last_at > now() - p_gap - interval '30 days'
     GROUP BY l.em, l.user_id, l.last_at
    HAVING count(DISTINCT v.night) >= 4
  ),
  -- Ses goûts : les genres des soirées où il est venu (toute la fenêtre),
  -- plus ceux de son quiz Yuno s'il a un compte.
  tastes AS (
    SELECT p.em,
           ARRAY(
             SELECT DISTINCT g FROM (
               SELECT unnest(v.genres) AS g FROM v WHERE v.em = p.em
               UNION ALL
               SELECT lower(btrim(tg)) FROM public.user_taste_profiles tp, unnest(COALESCE(tp.genres, '{}'::text[])) tg
                WHERE p.user_id IS NOT NULL AND tp.user_id = p.user_id
             ) z WHERE g IS NOT NULL AND g <> ''
           ) AS genres
      FROM lapsed p
  ),
  upcoming AS (
    SELECT e.id, e.start_at, e.recurring_template_id,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           ARRAY(
             SELECT DISTINCT lower(btrim(g))
               FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
              WHERE g IS NOT NULL AND btrim(g) <> ''
           ) AS genres
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours'
       AND e.start_at <= now() + interval '35 days'
       AND COALESCE(p_product = 'crm', false) = (e.external_source IS NOT NULL)
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
  )
  SELECT p.em, p.user_id, p.last_at, p.nights, pick.id, pick.reason
    FROM lapsed p
    JOIN tastes ts ON ts.em = p.em
    LEFT JOIN LATERAL (
      SELECT u.id,
             CASE WHEN u.series_hit THEN 'series' WHEN u.genre_hits > 0 THEN 'genre'
                  WHEN u.dow_hit THEN 'weekday' ELSE 'next' END AS reason
        FROM (
          SELECT up.id, up.start_at,
                 (up.recurring_template_id IS NOT NULL AND up.recurring_template_id = ANY (COALESCE(p.series, '{}'::uuid[]))) AS series_hit,
                 (SELECT count(*) FROM unnest(up.genres) g WHERE g = ANY (ts.genres))::integer AS genre_hits,
                 (up.dow = p.dow) AS dow_hit
            FROM upcoming up
        ) u
       ORDER BY (CASE WHEN u.series_hit THEN 4 ELSE 0 END) + 2 * LEAST(2, u.genre_hits) + (CASE WHEN u.dow_hit THEN 1 ELSE 0 END) DESC,
                u.start_at ASC
       LIMIT 1
    ) pick ON true
   -- Il revient déjà : une place pour une soirée à venir de la portée.
   WHERE NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.start_at > now() AND e.cancelled_at IS NULL AND COALESCE(p_product = 'crm', false) = (e.external_source IS NOT NULL)
        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        AND public._email_event_holder(e.id, p.em)
   )
$function$;
REVOKE ALL ON FUNCTION public._regular_lapse_candidates(text, uuid, interval, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._regular_lapse_candidates(text, uuid, interval, text) TO service_role;

DROP FUNCTION IF EXISTS public.check_contact_import(text, uuid, text[], text[]);
CREATE OR REPLACE FUNCTION public.check_contact_import(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_emails text[] DEFAULT '{}'::text[], p_phones text[] DEFAULT '{}'::text[], p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_fp_email text;
  v_fp_phone text;
  v_emails integer := 0;
  v_phones integer := 0;
  v_known_emails integer := 0;
  v_known_phones integer := 0;
  v_dup jsonb := NULL;
  v_overlaps jsonb := '[]'::jsonb;
  v_product text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'check_contact_import: une seule portée à la fois';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  v_product := public._import_product(p_venue_id, p_organizer_user_id, p_product);
  IF COALESCE(array_length(p_emails, 1), 0) + COALESCE(array_length(p_phones, 1), 0) > 200000 THEN
    RAISE EXCEPTION 'Fichier trop grand pour la vérification';
  END IF;

  DROP TABLE IF EXISTS _chk_e;
  DROP TABLE IF EXISTS _chk_p;

  CREATE TEMP TABLE _chk_e ON COMMIT DROP AS
    SELECT DISTINCT lower(btrim(x)) AS e
      FROM unnest(COALESCE(p_emails, '{}'::text[])) x
     WHERE lower(btrim(COALESCE(x, ''))) ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$';

  CREATE TEMP TABLE _chk_p ON COMMIT DROP AS
    SELECT DISTINCT public.normalize_phone_e164(x) AS p
      FROM unnest(COALESCE(p_phones, '{}'::text[])) x
     WHERE public.normalize_phone_e164(x) ~ '^\+[1-9][0-9]{6,14}$';

  SELECT count(*) INTO v_emails FROM _chk_e;
  SELECT count(*) INTO v_phones FROM _chk_p;
  SELECT public.contact_fingerprint(array_agg(e)) INTO v_fp_email FROM _chk_e;
  SELECT public.contact_fingerprint(array_agg(p)) INTO v_fp_phone FROM _chk_p;

  SELECT count(*) INTO v_known_emails
    FROM _chk_e c
   WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.e
                    AND s.product IS NOT DISTINCT FROM v_product
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id));

  SELECT count(*) INTO v_known_phones
    FROM _chk_p c
   WHERE EXISTS (SELECT 1 FROM public.venue_sms_contacts vc
                  WHERE vc.phone_e164 = c.p
                    AND vc.product IS NOT DISTINCT FROM v_product
                    AND public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id));

  -- Doublon exact : une liste vivante de la portée porte la même empreinte.
  -- L'email fait foi quand le fichier en contient ; sinon le numéro.
  IF v_fp_email IS NOT NULL THEN
    SELECT jsonb_build_object('channel', 'email', 'import_id', i.id, 'list_name', i.list_name,
                              'filename', i.filename, 'created_at', i.created_at, 'size', v_emails)
      INTO v_dup
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.product IS NOT DISTINCT FROM v_product
       AND i.superseded_by IS NULL AND i.fingerprint = v_fp_email
     ORDER BY i.created_at DESC LIMIT 1;
  END IF;
  IF v_dup IS NULL AND v_fp_email IS NULL AND v_fp_phone IS NOT NULL THEN
    SELECT jsonb_build_object('channel', 'sms', 'import_id', i.id, 'list_name', i.list_name,
                              'filename', i.filename, 'created_at', i.created_at, 'size', v_phones)
      INTO v_dup
      FROM public.sms_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.product IS NOT DISTINCT FROM v_product
       AND i.superseded_by IS NULL AND i.fingerprint = v_fp_phone
     ORDER BY i.created_at DESC LIMIT 1;
  END IF;

  -- Recouvrement liste par liste, les deux canaux ensemble.
  WITH e AS (
    SELECT i.id, 'email'::text AS channel, i.list_name, i.filename, i.created_at,
           (SELECT count(*) FROM public.newsletter_subscriptions s WHERE s.import_id = i.id) AS size,
           (SELECT count(*) FROM public.newsletter_subscriptions s
             JOIN _chk_e c ON c.e = lower(s.email) WHERE s.import_id = i.id) AS shared
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.product IS NOT DISTINCT FROM v_product
       AND i.superseded_by IS NULL
  ), s AS (
    SELECT i.id, 'sms'::text AS channel, i.list_name, i.filename, i.created_at,
           (SELECT count(*) FROM public.venue_sms_contacts vc WHERE vc.import_id = i.id) AS size,
           (SELECT count(*) FROM public.venue_sms_contacts vc
             JOIN _chk_p c ON c.p = vc.phone_e164 WHERE vc.import_id = i.id) AS shared
      FROM public.sms_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.product IS NOT DISTINCT FROM v_product
       AND i.superseded_by IS NULL
  ), all_lists AS (
    SELECT * FROM e UNION ALL SELECT * FROM s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'import_id', id, 'channel', channel, 'list_name', list_name, 'filename', filename,
           'created_at', created_at, 'size', size, 'shared', shared
         ) ORDER BY shared DESC, created_at DESC), '[]'::jsonb)
    INTO v_overlaps
    FROM (SELECT * FROM all_lists WHERE shared > 0 ORDER BY shared DESC LIMIT 8) x;

  DROP TABLE IF EXISTS _chk_e;
  DROP TABLE IF EXISTS _chk_p;

  RETURN jsonb_build_object(
    'emails', v_emails,
    'phones', v_phones,
    'known_emails', v_known_emails,
    'known_phones', v_known_phones,
    'new_emails', v_emails - v_known_emails,
    'new_phones', v_phones - v_known_phones,
    'fingerprint_email', v_fp_email,
    'fingerprint_phone', v_fp_phone,
    'duplicate_of', v_dup,
    'overlaps', v_overlaps);
END;
$function$;
REVOKE ALL ON FUNCTION public.check_contact_import(text, uuid, text[], text[], text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_contact_import(text, uuid, text[], text[], text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_email_automation_stats(text, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_email_automation_stats(p_venue_id text, p_organizer_user_id uuid, p_days integer DEFAULT NULL::integer, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_from timestamptz := CASE WHEN p_days IS NULL THEN '-infinity'::timestamptz ELSE now() - make_interval(days => p_days) END;
  v_all boolean := p_days IS NULL;
BEGIN
  -- Porte du produit demandé : la Console CRM (équipe CRM) ou la porte e-mail de la Billetterie.
  IF p_product = 'crm' THEN
    IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.kind), '[]'::jsonb) INTO result
    FROM (
      SELECT a.id, a.kind, a.enabled, a.enabled_at, a.delay_hours, a.threshold_pct, a.template_id, a.subject,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL) AS pending,
             -- En attente d'envoi dans une campagne enfant (file, quota, nuit).
             (SELECT count(*) FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c ON c.id = r.campaign_id
               WHERE c.automation_id = a.id AND r.status = 'pending') AS in_flight,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.created_at >= v_from) AS queued,
             (SELECT COALESCE(jsonb_object_agg(x.skip_reason, x.n), '{}'::jsonb)
                FROM (SELECT l.skip_reason, count(*) AS n FROM public.email_automation_sends l
                       WHERE l.automation_id = a.id AND l.status = 'skipped' AND l.created_at >= v_from
                       GROUP BY l.skip_reason) x) AS skipped,
             (SELECT max(l.created_at) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS last_queued_at,
             (SELECT count(*) FROM public.email_campaigns c
               WHERE c.automation_id = a.id
                 AND (v_all OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                        WHERE r.campaign_id = c.id AND r.status = 'sent' AND r.sent_at >= v_from))) AS campaigns,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.recipients_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id = r.campaign_id
                         WHERE c.automation_id = a.id AND r.status = 'sent' AND r.sent_at >= v_from) END AS sent,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.delivered_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'delivered' AND ev.created_at >= v_from) END AS delivered,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.opens_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'opened' AND ev.created_at >= v_from) END AS opens,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.clickers_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'clicked' AND ev.created_at >= v_from) END AS clickers,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.unsubscribes_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'unsubscribed' AND ev.created_at >= v_from) END AS unsubscribes,
             (SELECT COALESCE(jsonb_agg(c.id), '[]'::jsonb) FROM public.email_campaigns c
               WHERE c.automation_id = a.id
                 AND (v_all OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                        WHERE r.campaign_id = c.id AND r.status = 'sent' AND r.sent_at >= v_from))) AS campaign_ids
        FROM public.email_automations a
       WHERE ((p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id)
          OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL AND a.venue_id IS NULL AND a.organizer_user_id IS NULL))
         AND a.product IS NOT DISTINCT FROM p_product
    ) s;

  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_email_automation_stats(text, uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid, integer, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_email_lists_health(text, uuid);
CREATE OR REPLACE FUNCTION public.get_email_lists_health(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_lists_health: une seule portée à la fois';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT COALESCE(p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH imports AS (
    SELECT i.id, i.filename, i.list_name, i.created_at
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.product IS NOT DISTINCT FROM p_product
       AND i.superseded_by IS NULL
     ORDER BY i.created_at DESC
     LIMIT 50
  ),
  subs AS (
    SELECT s.import_id,
           count(*) AS total,
           count(*) FILTER (WHERE s.opted_in AND s.opted_out_at IS NULL AND NOT public.is_email_suppressed(s.email)) AS active,
           count(*) FILTER (WHERE public.is_email_suppressed(s.email)) AS dead,
           count(*) FILTER (WHERE NOT public.is_email_suppressed(s.email) AND (NOT s.opted_in OR s.opted_out_at IS NOT NULL)) AS unsubscribed
      FROM public.newsletter_subscriptions s
     WHERE s.import_id IN (SELECT id FROM imports)
     GROUP BY s.import_id
  ),
  purged AS (
    SELECT o.import_id, count(*) AS n
      FROM public.email_opt_outs o
     WHERE o.import_id IN (SELECT id FROM imports)
     GROUP BY o.import_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'import_id', i.id,
           'filename', i.filename,
           'list_name', i.list_name,
           'created_at', i.created_at,
           'total', COALESCE(s.total, 0),
           'active', COALESCE(s.active, 0),
           'unsubscribed', COALESCE(s.unsubscribed, 0),
           'dead', COALESCE(s.dead, 0),
           'purged', COALESCE(p.n, 0)
         ) ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM imports i
    LEFT JOIN subs s ON s.import_id = i.id
    LEFT JOIN purged p ON p.import_id = i.id;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_email_lists_health(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_email_lists_health(text, uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb, text, boolean);
CREATE OR REPLACE FUNCTION public.import_contact_list(p_rows jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_list_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_default_country text DEFAULT NULL::text, p_channels jsonb DEFAULT '{"sms": true, "email": true}'::jsonb, p_detected jsonb DEFAULT NULL::jsonb, p_mode text DEFAULT 'append'::text, p_final boolean DEFAULT false, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_via_support boolean := public.is_support_session();
  v_list public.contact_list_imports%ROWTYPE;
  v_submitted integer := 0;
  v_rows integer := 0;
  v_emails integer := 0;
  v_phones integer := 0;
  v_both integer := 0;
  v_invalid integer := 0;
  v_email_res jsonb := NULL;
  v_sms_res jsonb := NULL;
  v_email_payload jsonb;
  v_sms_payload jsonb;
  v_want_email boolean := COALESCE((p_channels->>'email')::boolean, true);
  v_want_sms boolean := COALESCE((p_channels->>'sms')::boolean, true);
  v_mode text := CASE WHEN lower(COALESCE(p_mode, 'append')) = 'merge' THEN 'merge' ELSE 'append' END;
  v_fp_email text; v_fp_phone text; v_fp_all text;
  v_twin uuid := NULL;
  v_absorb jsonb := NULL;
  v_product text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_contact_list: une seule portée à la fois';
  END IF;
  -- Même autorisation que l'import email (le plus strict des deux) : les deux
  -- RPC appelées en dessous doivent passer.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;
  -- Session support : AUTORISÉE (décision de lancement, voir CLAUDE.md).
  -- Elle n'est pas silencieuse pour autant : `attested_by` porte l'uid du PRO
  -- (la session est la sienne), donc sans drapeau le dossier de consentement
  -- dirait que le pro a attesté lui-même. `attested_via_support` dit qui a
  -- vraiment saisi, et le trigger d'audit nomme l'admin.
  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  -- 1. La liste (créée au 1er lot, réutilisée ensuite).
  IF p_list_import_id IS NULL THEN
    v_product := public._import_product(p_venue_id, p_organizer_user_id, p_product);
    INSERT INTO public.contact_list_imports
      (venue_id, organizer_user_id, list_name, filename, consent_source, consent_details,
       collected_since, default_country, detected_columns, channels, attested_by, attested_via_support, product)
    VALUES (p_venue_id, p_organizer_user_id,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_filename, p_consent_source, p_consent_details, p_collected_since,
            p_default_country, COALESCE(p_detected, '{}'::jsonb),
            jsonb_build_object('email', v_want_email, 'sms', v_want_sms), v_uid, v_via_support, v_product)
    RETURNING * INTO v_list;
  ELSE
    SELECT * INTO v_list FROM public.contact_list_imports
     WHERE id = p_list_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
    v_product := v_list.product;
    v_want_email := COALESCE((v_list.channels->>'email')::boolean, v_want_email);
    v_want_sms := COALESCE((v_list.channels->>'sms')::boolean, v_want_sms);
  END IF;

  -- 2. Typage défensif de chaque ligne.
  CREATE TEMP TABLE _ucl ON COMMIT DROP AS
  WITH raw AS (
    SELECT x, row_number() OVER () AS ord FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  ), typed AS (
    SELECT ord,
      CASE WHEN lower(btrim(COALESCE(x->>'email',''))) ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$'
           THEN lower(btrim(x->>'email')) END AS email,
      CASE WHEN public.normalize_phone_e164(x->>'phone') ~ '^\+[1-9][0-9]{6,14}$'
           THEN public.normalize_phone_e164(x->>'phone') END AS phone,
      NULLIF(left(btrim(COALESCE(x->>'first_name','')), 80), '') AS first_name,
      NULLIF(left(btrim(COALESCE(x->>'last_name','')), 80), '') AS last_name,
      CASE WHEN upper(btrim(COALESCE(x->>'country_code',''))) ~ '^[A-Z]{2}$' THEN upper(btrim(x->>'country_code')) END AS country_code,
      NULLIF(left(btrim(COALESCE(x->>'country','')), 80), '') AS country,
      NULLIF(left(btrim(COALESCE(x->>'region','')), 80), '') AS region,
      NULLIF(left(btrim(COALESCE(x->>'city','')), 80), '') AS city,
      NULLIF(left(btrim(COALESCE(x->>'postal_code','')), 20), '') AS postal_code,
      NULLIF(left(btrim(COALESCE(x->>'zone','')), 80), '') AS zone,
      CASE WHEN COALESCE(x->>'age','') ~ '^[0-9]{1,3}$' AND (x->>'age')::int BETWEEN 12 AND 110 THEN (x->>'age')::int END AS age,
      CASE WHEN x->>'gender' IN ('female','male','other') THEN x->>'gender' END AS gender,
      CASE WHEN x->>'newsletter_opt_in' IN ('true','false') THEN (x->>'newsletter_opt_in')::boolean END AS newsletter_opt_in,
      CASE WHEN COALESCE(x->>'added_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (x->>'added_at')::timestamptz END AS added_at,
      CASE WHEN COALESCE(x->>'last_purchase_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (x->>'last_purchase_at')::timestamptz END AS last_purchase_at,
      CASE WHEN COALESCE(x->>'total_spent','') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN GREATEST(0, (x->>'total_spent')::numeric) END AS total_spent,
      CASE WHEN COALESCE(x->>'event_count','') ~ '^[0-9]{1,6}$' THEN (x->>'event_count')::int END AS event_count,
      CASE WHEN jsonb_typeof(x->'extra') = 'object' THEN x->'extra' END AS extra
    FROM raw
  )
  SELECT DISTINCT ON (COALESCE(email, phone)) *
    FROM typed
   WHERE email IS NOT NULL OR phone IS NOT NULL
   ORDER BY COALESCE(email, phone),
            ((phone IS NOT NULL)::int + (total_spent IS NOT NULL)::int + (event_count IS NOT NULL)::int
             + (last_purchase_at IS NOT NULL)::int + (zone IS NOT NULL)::int + (city IS NOT NULL)::int) DESC,
            ord;

  SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL), count(*) FILTER (WHERE phone IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone IS NOT NULL)
    INTO v_rows, v_emails, v_phones, v_both FROM _ucl;
  v_invalid := v_submitted - v_rows;

  -- 3. Les lignes typées (idempotent sur une même liste).
  INSERT INTO public.imported_contacts
    (list_import_id, venue_id, organizer_user_id, email, phone_e164, first_name, last_name,
     country_code, country, region, city, postal_code, zone, age, gender, newsletter_opt_in,
     added_at, last_purchase_at, total_spent, event_count, extra, product)
  SELECT v_list.id, p_venue_id, p_organizer_user_id, u.email, u.phone, u.first_name, u.last_name,
         u.country_code, u.country, u.region, u.city, u.postal_code, u.zone, u.age, u.gender,
         u.newsletter_opt_in, u.added_at, u.last_purchase_at, u.total_spent, u.event_count, u.extra, v_product
    FROM _ucl u
  ON CONFLICT (list_import_id, COALESCE(email,''), COALESCE(phone_e164,'')) DO UPDATE
    SET first_name = COALESCE(EXCLUDED.first_name, public.imported_contacts.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.imported_contacts.last_name),
        country_code = COALESCE(EXCLUDED.country_code, public.imported_contacts.country_code),
        country = COALESCE(EXCLUDED.country, public.imported_contacts.country),
        region = COALESCE(EXCLUDED.region, public.imported_contacts.region),
        city = COALESCE(EXCLUDED.city, public.imported_contacts.city),
        postal_code = COALESCE(EXCLUDED.postal_code, public.imported_contacts.postal_code),
        zone = COALESCE(EXCLUDED.zone, public.imported_contacts.zone),
        age = COALESCE(EXCLUDED.age, public.imported_contacts.age),
        gender = COALESCE(EXCLUDED.gender, public.imported_contacts.gender),
        newsletter_opt_in = COALESCE(EXCLUDED.newsletter_opt_in, public.imported_contacts.newsletter_opt_in),
        added_at = COALESCE(EXCLUDED.added_at, public.imported_contacts.added_at),
        last_purchase_at = COALESCE(EXCLUDED.last_purchase_at, public.imported_contacts.last_purchase_at),
        total_spent = COALESCE(EXCLUDED.total_spent, public.imported_contacts.total_spent),
        event_count = COALESCE(EXCLUDED.event_count, public.imported_contacts.event_count),
        extra = COALESCE(EXCLUDED.extra, public.imported_contacts.extra);

  -- 4. Canal email → la RPC existante (attestation, désabonnés, suppression).
  IF v_want_email AND v_emails > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name))
      INTO v_email_payload FROM _ucl u WHERE u.email IS NOT NULL;
    v_email_res := public.import_email_contacts(
      v_email_payload, p_consent_source, p_venue_id, p_organizer_user_id, p_filename,
      p_consent_details, p_collected_since, v_list.email_import_id, p_list_name, v_product);
    IF v_list.email_import_id IS NULL THEN
      v_list.email_import_id := (v_email_res->>'import_id')::uuid;
      UPDATE public.contact_list_imports SET email_import_id = v_list.email_import_id WHERE id = v_list.id;
    END IF;
  END IF;

  -- 5. Canal SMS → la RPC existante (liste repoussoir STOP, jamais réabonné).
  IF v_want_sms AND v_phones > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('phone', u.phone, 'first_name', u.first_name, 'last_name', u.last_name))
      INTO v_sms_payload FROM _ucl u WHERE u.phone IS NOT NULL;
    v_sms_res := public.import_sms_contacts(
      v_sms_payload, p_consent_source, p_venue_id, p_organizer_user_id, p_filename,
      p_consent_details, p_collected_since, v_list.sms_import_id, p_list_name, p_default_country, v_product);
    IF v_list.sms_import_id IS NULL THEN
      v_list.sms_import_id := (v_sms_res->>'import_id')::uuid;
      UPDATE public.contact_list_imports SET sms_import_id = v_list.sms_import_id WHERE id = v_list.id;
    END IF;
    -- Le contact SMS connaît son email : c'est ce qui relie les deux canaux.
    UPDATE public.venue_sms_contacts vc
       SET email = u.email
      FROM _ucl u
     WHERE vc.import_id = v_list.sms_import_id
       AND vc.phone_e164 = u.phone
       AND u.email IS NOT NULL
       AND vc.email IS NULL;
  END IF;

  -- Effectifs RECOMPTÉS depuis les lignes stockées : un ré-import idempotent
  -- de la même liste ne gonfle jamais les compteurs.
  UPDATE public.contact_list_imports li
     SET row_count = s.n, email_count = s.e, phone_count = s.p, both_count = s.b
    FROM (SELECT count(*) AS n,
                 count(*) FILTER (WHERE email IS NOT NULL) AS e,
                 count(*) FILTER (WHERE phone_e164 IS NOT NULL) AS p,
                 count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL) AS b
            FROM public.imported_contacts WHERE list_import_id = v_list.id) s
   WHERE li.id = v_list.id;

  DROP TABLE IF EXISTS _ucl;

  -- 6. Dernier lot : empreintes, doublon exact, fusion.
  IF p_final THEN
    SELECT public.contact_fingerprint(array_agg(c.email) FILTER (WHERE c.email IS NOT NULL)),
           public.contact_fingerprint(array_agg(c.phone_e164) FILTER (WHERE c.phone_e164 IS NOT NULL)),
           public.contact_fingerprint(array_agg(COALESCE(c.email, '') || '|' || COALESCE(c.phone_e164, '')))
      INTO v_fp_email, v_fp_phone, v_fp_all
      FROM public.imported_contacts c WHERE c.list_import_id = v_list.id;

    UPDATE public.contact_list_imports SET fingerprint = v_fp_all WHERE id = v_list.id;
    IF v_list.email_import_id IS NOT NULL THEN
      UPDATE public.email_list_imports SET fingerprint = v_fp_email WHERE id = v_list.email_import_id;
    END IF;
    IF v_list.sms_import_id IS NOT NULL THEN
      UPDATE public.sms_list_imports SET fingerprint = v_fp_phone WHERE id = v_list.sms_import_id;
    END IF;

    -- Le jumeau : une liste vivante de la portée qui porte la même empreinte.
    -- L'email fait foi quand le fichier en contient ; sinon le numéro.
    IF v_fp_email IS NOT NULL THEN
      SELECT i.id INTO v_twin FROM public.email_list_imports i
       WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND i.product IS NOT DISTINCT FROM v_list.product
         AND i.superseded_by IS NULL AND i.fingerprint = v_fp_email
         AND i.id <> COALESCE(v_list.email_import_id, '00000000-0000-0000-0000-000000000000'::uuid)
       ORDER BY i.created_at LIMIT 1;
    ELSIF v_fp_phone IS NOT NULL THEN
      SELECT i.id INTO v_twin FROM public.sms_list_imports i
       WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND i.product IS NOT DISTINCT FROM v_list.product
         AND i.superseded_by IS NULL AND i.fingerprint = v_fp_phone
         AND i.id <> COALESCE(v_list.sms_import_id, '00000000-0000-0000-0000-000000000000'::uuid)
       ORDER BY i.created_at LIMIT 1;
    END IF;

    -- Doublon exact = fusion d'office : le fichier qui vient d'arriver porte la
    -- donnée la plus fraîche, il prend la liste ; l'ancienne est retirée sans
    -- être détruite. Un import refait à l'identique ne crée donc jamais une
    -- seconde liste, même si le client n'a pas demandé la vérification.
    IF v_twin IS NOT NULL OR v_mode = 'merge' THEN
      v_absorb := public.contact_import_absorb(v_list.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'list_import_id', v_list.id,
    'email_import_id', v_list.email_import_id,
    'sms_import_id', v_list.sms_import_id,
    'submitted', v_submitted,
    'rows', v_rows,
    'emails', v_emails,
    'phones', v_phones,
    'both', v_both,
    'invalid', v_invalid,
    'email', v_email_res,
    'sms', v_sms_res,
    'mode', v_mode,
    'duplicate_of', v_twin,
    'absorbed', v_absorb
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_contact_list(jsonb, text, text, uuid, text, text, date, uuid, text, text, jsonb, jsonb, text, boolean, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid, text);
CREATE OR REPLACE FUNCTION public.import_email_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_via_support boolean := public.is_support_session();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_reactivated integer := 0;
  v_optout integer := 0;
  v_product text;
BEGIN
  -- 1. Périmètre : exactement un propriétaire.
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_email_contacts: une seule portée à la fois';
  END IF;

  -- 2. Autorisation.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT COALESCE(p_organizer_user_id = v_uid OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    -- Portée plateforme : la base marketing de Yuno elle-même.
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  -- Session support : AUTORISÉE (décision de lancement, voir CLAUDE.md).
  -- Elle n'est pas silencieuse pour autant : `attested_by` porte l'uid du PRO
  -- (la session est la sienne), donc sans drapeau le dossier de consentement
  -- dirait que le pro a attesté lui-même. `attested_via_support` dit qui a
  -- vraiment saisi, et le trigger d'audit nomme l'admin.

  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted
    FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  -- 4. Ligne d'import (créée au 1er lot, réutilisée par les suivants).
  IF v_import_id IS NULL THEN
    v_product := public._import_product(p_venue_id, p_organizer_user_id, p_product);
    INSERT INTO public.email_list_imports
      (venue_id, organizer_user_id, filename, consent_source, consent_details,
       collected_since, attested_by, attested_via_support, list_name, product)
    VALUES (p_venue_id, p_organizer_user_id, p_filename, p_consent_source,
            p_consent_details, p_collected_since, v_uid, v_via_support,
            NULLIF(btrim(COALESCE(p_list_name, '')), ''), v_product)
    RETURNING id INTO v_import_id;
  ELSE
    SELECT i.product INTO v_product FROM public.email_list_imports i
     WHERE i.id = v_import_id
       AND public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  END IF;

  -- 5. Normalisation + dédoublonnage intra-fichier + validation.
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  WITH raw AS (
    SELECT lower(btrim(COALESCE(x->>'email',''))) AS addr,
           NULLIF(btrim(COALESCE(x->>'first_name','')), '') AS fname,
           NULLIF(btrim(COALESCE(x->>'last_name','')), '')  AS lname,
           row_number() OVER () AS ord
      FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) x
  )
  SELECT DISTINCT ON (addr) addr, fname, lname,
         addr ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$' AS valid
    FROM raw
   ORDER BY addr, ord;

  SELECT count(*) FILTER (WHERE valid),
         count(*) FILTER (WHERE NOT valid)
    INTO v_valid, v_invalid FROM _in;
  v_dupes := v_submitted - (v_valid + v_invalid);

  SELECT count(*) INTO v_suppressed
    FROM _in WHERE valid AND public.is_email_suppressed(addr);

  -- 6. Écriture. Le WHERE du DO UPDATE est la règle n°2 : un désabonné
  --    explicite n'est jamais réactivé par un import. Le NOT EXISTS sur
  --    email_opt_outs prolonge la règle APRÈS une purge : la ligne désabonnée
  --    n'existe plus, c'est le repoussoir qui se souvient.
  IF p_venue_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name, product)
      SELECT p_venue_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname, v_product
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND o.product IS NOT DISTINCT FROM v_product
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name, product)
      SELECT p_organizer_user_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname, v_product
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND o.product IS NOT DISTINCT FROM v_product
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  ELSE
    -- Portée plateforme. Arbitre = l'index PARTIEL uniq_newsletter_subs_email_platform.
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, organizer_user_id, email, opted_in, source, import_id, consent_source,
         consent_recorded_at, first_name, last_name)
      SELECT NULL, NULL, i.addr, true, 'platform:import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND o.product IS NOT DISTINCT FROM v_product
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  END IF;

  -- Ce que le DO UPDATE n'a pas touché : déjà abonné actif, ou désabonné
  -- explicite qu'on respecte. On les compte pour le rapport d'import.
  v_optout := GREATEST(0, (v_valid - v_suppressed) - (v_inserted + v_reactivated));

  UPDATE public.email_list_imports
     SET submitted_count = submitted_count + v_submitted,
         inserted_count = inserted_count + v_inserted,
         reactivated_count = reactivated_count + v_reactivated,
         duplicate_count = duplicate_count + v_dupes,
         invalid_count = invalid_count + v_invalid,
         suppressed_count = suppressed_count + v_suppressed,
         unchanged_count = unchanged_count + v_optout
   WHERE id = v_import_id;

  DROP TABLE IF EXISTS _in;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'submitted', v_submitted,
    'valid', v_valid,
    'invalid', v_invalid,
    'duplicates', v_dupes,
    'suppressed', v_suppressed,
    'inserted', v_inserted,
    'reactivated', v_reactivated,
    'unchanged', v_optout
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_email_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.import_sms_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text);
CREATE OR REPLACE FUNCTION public.import_sms_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_default_country text DEFAULT NULL::text, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_via_support boolean := public.is_support_session();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_unchanged integer := 0;
  v_product text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_sms_contacts: une seule portée à la fois';
  END IF;
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  -- Session support : AUTORISÉE (décision de lancement, voir CLAUDE.md).
  -- Elle n'est pas silencieuse pour autant : `attested_by` porte l'uid du PRO
  -- (la session est la sienne), donc sans drapeau le dossier de consentement
  -- dirait que le pro a attesté lui-même. `attested_via_support` dit qui a
  -- vraiment saisi, et le trigger d'audit nomme l'admin.
  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  IF v_import_id IS NULL THEN
    v_product := public._import_product(p_venue_id, p_organizer_user_id, p_product);
    INSERT INTO public.sms_list_imports
      (venue_id, organizer_user_id, filename, list_name, consent_source, consent_details,
       collected_since, default_country, attested_by, attested_via_support, product)
    VALUES (p_venue_id, p_organizer_user_id, p_filename,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_consent_source, p_consent_details, p_collected_since, p_default_country, v_uid, v_via_support, v_product)
    RETURNING id INTO v_import_id;
  ELSE
    SELECT i.product INTO v_product FROM public.sms_list_imports i
     WHERE i.id = v_import_id
       AND public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  END IF;

  -- Normalisation + dédoublonnage intra-fichier + validation.
  CREATE TEMP TABLE _sms_in ON COMMIT DROP AS
  WITH raw AS (
    SELECT public.normalize_phone_e164(COALESCE(x->>'phone','')) AS phone,
           NULLIF(btrim(COALESCE(x->>'first_name','')), '') AS fname,
           NULLIF(btrim(COALESCE(x->>'last_name','')), '')  AS lname,
           row_number() OVER () AS ord
      FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) x
  )
  SELECT DISTINCT ON (COALESCE(phone, 'invalid-' || ord::text))
         phone, fname, lname,
         phone IS NOT NULL AND phone ~ '^\+[1-9][0-9]{6,14}$' AS valid
    FROM raw
   ORDER BY COALESCE(phone, 'invalid-' || ord::text), ord;

  SELECT count(*) FILTER (WHERE valid), count(*) FILTER (WHERE NOT valid)
    INTO v_valid, v_invalid FROM _sms_in;
  v_dupes := v_submitted - (v_valid + v_invalid);

  -- Liste repoussoir : un numéro qui a répondu STOP ou s'est retiré, où que ce
  -- soit chez ce pro, n'est jamais réabonné par un import. Un STOP est global
  -- (le numéro d'envoi est partagé) : on regarde toutes les portées.
  CREATE TEMP TABLE _sms_block ON COMMIT DROP AS
  SELECT DISTINCT i.phone
    FROM _sms_in i
   WHERE i.valid AND EXISTS (
     SELECT 1 FROM public.venue_sms_contacts c
      WHERE c.phone_e164 = i.phone AND c.unsubscribed
   );
  SELECT count(*) INTO v_suppressed FROM _sms_block;

  IF p_venue_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip, product)
      SELECT p_venue_id, NULL, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false, v_product
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (venue_id, organizer_user_id, phone_e164, product) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip, product)
      SELECT NULL, p_organizer_user_id, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false, v_product
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (venue_id, organizer_user_id, phone_e164, product) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  ELSE
    -- Portée plateforme : l'arbitre est l'index PARTIEL posé par
    -- 20260908210000. Sans le WHERE, Postgres ne le reconnaît pas (42P10).
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT NULL, NULL, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (phone_e164) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  END IF;

  -- Déjà présents (consentement checkout ou import antérieur) : on ne touche à
  -- rien, la preuve d'origine reste la première.
  v_unchanged := GREATEST(0, (v_valid - v_suppressed) - v_inserted);

  UPDATE public.sms_list_imports
     SET submitted_count = submitted_count + v_submitted,
         inserted_count = inserted_count + v_inserted,
         duplicate_count = duplicate_count + v_dupes,
         invalid_count = invalid_count + v_invalid,
         suppressed_count = suppressed_count + v_suppressed,
         unchanged_count = unchanged_count + v_unchanged
   WHERE id = v_import_id;

  DROP TABLE IF EXISTS _sms_in;
  DROP TABLE IF EXISTS _sms_block;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'submitted', v_submitted,
    'valid', v_valid,
    'invalid', v_invalid,
    'duplicates', v_dupes,
    'suppressed', v_suppressed,
    'inserted', v_inserted,
    'unchanged', v_unchanged
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.import_sms_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_sms_contacts(jsonb, text, text, uuid, text, text, date, uuid, text, text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_contact_base(text, uuid, text, uuid, text, text, uuid, text, integer, integer);
CREATE OR REPLACE FUNCTION public.list_contact_base(p_venue_id text, p_organizer_user_id uuid, p_search text, p_segment_id uuid, p_status text, p_origin text, p_list_import_id uuid, p_sort text, p_limit integer, p_offset integer, p_product text DEFAULT 'suite')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_where text := 'true';
  v_order text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_def jsonb;
  v_q text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'list_contact_base: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, p_product);

  IF p_segment_id IS NOT NULL THEN
    SELECT cs.definition INTO v_def FROM public.contact_segments cs
     WHERE cs.id = p_segment_id
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id);
    v_where := v_where || ' AND ' || COALESCE(public.contact_definition_predicate(v_def, 'c'), 'false');
  END IF;
  IF p_status IS NOT NULL AND p_status IN ('active','passive','silent','new','unreachable','unsubscribed') THEN
    v_where := v_where || format(' AND c.eng_status = %L', p_status);
  END IF;
  IF p_origin IS NOT NULL AND p_origin IN ('import','yuno','both') THEN
    v_where := v_where || format(' AND c.origin = %L', p_origin);
  END IF;
  IF p_list_import_id IS NOT NULL THEN
    v_where := v_where || format(' AND c.list_import_id = %L::uuid', p_list_import_id);
  END IF;
  IF NULLIF(btrim(COALESCE(p_search, '')), '') IS NOT NULL THEN
    v_q := '%' || replace(replace(replace(lower(btrim(p_search)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_where := v_where || format(' AND (c.email ILIKE %L OR lower(COALESCE(c.first_name, '''') || '' '' || COALESCE(c.last_name, '''')) LIKE %L OR COALESCE(c.phone_e164, '''') LIKE %L OR lower(COALESCE(c.city, '''')) LIKE %L)', v_q, v_q, v_q, v_q);
  END IF;

  v_order := CASE COALESCE(p_sort, 'recent')
    WHEN 'spent' THEN 'c.total_spent DESC NULLS LAST, c.email'
    WHEN 'engaged' THEN 'c.last_clicked_at DESC NULLS LAST, c.last_opened_at DESC NULLS LAST, c.email'
    WHEN 'name' THEN 'lower(COALESCE(c.last_name, '''')), lower(COALESCE(c.first_name, '''')), c.email'
    WHEN 'events' THEN 'c.event_count DESC NULLS LAST, c.email'
    ELSE 'c.last_seen_at DESC NULLS LAST, c.created_at DESC, c.email'
  END;

  EXECUTE format('SELECT count(*) FROM _cr c WHERE %s', v_where) INTO v_total;
  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
      SELECT c.id, c.email, c.phone_e164, c.first_name, c.last_name, c.origin, c.eng_status AS status,
             c.emails_sent, c.opens, c.clicks, c.last_opened_at, c.last_clicked_at, c.unsubscribed_at, c.bounced,
             c.total_spent, c.event_count, c.last_purchase_at, c.yuno_spent, c.yuno_events, c.imported_spent, c.imported_events,
             c.ticket_count, c.table_count, c.order_count, c.guest_list_count, c.last_seen_at,
             c.city, c.zone, c.country_code, c.age, c.gender, c.added_at,
             c.email_ok, c.phone_ok, c.has_account, c.list_import_id
        FROM _cr c WHERE %s ORDER BY %s LIMIT %s OFFSET %s) t
  $q$, v_where, v_order, GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)), GREATEST(0, COALESCE(p_offset, 0)))
    INTO v_rows;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_contact_base(text, uuid, text, uuid, text, text, uuid, text, integer, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_contact_base(text, uuid, text, uuid, text, text, uuid, text, integer, integer, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.set_sms_sender_identity(text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.set_sms_sender_identity(p_venue_id text, p_organizer_user_id uuid, p_legal_name text, p_registration text, p_product text DEFAULT 'crm'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name  text := NULLIF(left(btrim(COALESCE(p_legal_name, '')), 160), '');
  v_raw   text := upper(regexp_replace(COALESCE(p_registration, ''), '\s', '', 'g'));
  v_siret text;
  v_rna   text;
  v_vat   text;
  v_crm   boolean := COALESCE(p_product = 'crm', false);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR p_organizer_user_id = auth.uid()) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN RAISE EXCEPTION 'bad_legal_name' USING ERRCODE = '22023'; END IF;

  IF regexp_replace(v_raw, '[^0-9]', '', 'g') ~ '^[0-9]{14}$' AND v_raw ~ '^[0-9.\-]+$' THEN
    v_siret := regexp_replace(v_raw, '[^0-9]', '', 'g');
  ELSIF v_raw ~ '^W[0-9]{9}$' THEN
    v_rna := v_raw;
  ELSIF v_raw ~ '^[A-Z]{2}[0-9A-Z]{6,13}$' THEN
    v_vat := v_raw;
  ELSE
    RAISE EXCEPTION 'bad_registration' USING ERRCODE = '22023';
  END IF;

  IF v_crm THEN
    -- Yuno CRM : l'identité d'annonceur SMS du CRM vit dans crm_sms_settings.
    -- Elle n'écrit JAMAIS la fiche légale du compte (vendeur des reçus de la Billetterie).
    IF p_venue_id IS NOT NULL AND v_rna IS NOT NULL THEN RAISE EXCEPTION 'bad_registration' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.crm_sms_settings (scope_key, updated_by)
    VALUES (public.crm_scope_key(p_venue_id, p_organizer_user_id), auth.uid())
    ON CONFLICT (scope_key) DO NOTHING;
    UPDATE public.crm_sms_settings SET legal_name = v_name,
           siret = COALESCE(v_siret, siret), rna_number = COALESCE(v_rna, rna_number),
           vat_number = COALESCE(v_vat, vat_number), updated_by = auth.uid(), updated_at = now()
     WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  ELSIF p_venue_id IS NOT NULL THEN
    IF v_rna IS NOT NULL THEN RAISE EXCEPTION 'bad_registration' USING ERRCODE = '22023'; END IF;
    UPDATE public.venues SET legal_name = v_name,
           siret = COALESCE(v_siret, siret), vat_number = COALESCE(v_vat, vat_number)
     WHERE id = p_venue_id;
  ELSE
    UPDATE public.organizer_profiles SET legal_name = v_name,
           siret = COALESCE(v_siret, siret), rna_number = COALESCE(v_rna, rna_number),
           vat_number = COALESCE(v_vat, vat_number)
     WHERE user_id = p_organizer_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id, CASE WHEN v_crm THEN 'crm' ELSE 'suite' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_sms_sender_identity(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sms_sender_identity(text, uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._admin_customer_identity(p_email text)
 RETURNS TABLE(user_id uuid, first_name text, last_name text, city text, gender text, phone text, birth_date date, avatar_url text, preferred_language text, account_created_at timestamp with time zone, is_suspended boolean, has_account boolean, profile_count integer, app_platforms text[], has_app boolean, push_on boolean, email_opt_in boolean, sms_opt_in boolean, email_suppressed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH pick AS (
    SELECT p.*
    FROM public.profiles p
    WHERE lower(p.email) = lower(p_email)
    ORDER BY (EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)) DESC,
             p.created_at DESC
    LIMIT 1
  )
  -- CROSS JOIN sur une ligne fantôme + LEFT JOIN : la fonction rend toujours
  -- exactement une ligne, avec ou sans profil derrière.
  SELECT
    pick.id, pick.first_name, pick.last_name, pick.city, pick.gender,
    pick.phone, pick.birth_date, pick.avatar_url, pick.preferred_language,
    pick.created_at, COALESCE(pick.is_suspended, false),
    (pick.id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pick.id)),
    (SELECT count(*)::int FROM public.profiles p2 WHERE lower(p2.email) = lower(p_email)),
    -- L'app se déduit des abonnements push : c'est le seul rattachement
    -- appareil→personne qu'on ait (ota_devices n'a pas de custom_id).
    -- Sous-estime donc les gens qui ont l'app et ont refusé les notifications.
    COALESCE((SELECT array_agg(DISTINCT ps.platform)
              FROM public.push_subscriptions ps WHERE ps.user_id = pick.id), '{}'::text[]),
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = pick.id),
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = pick.id),
    -- Ces trois-là ne supposent AUCUN compte : ils se testent sur l'email.
    EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
             WHERE lower(ns.email) = lower(p_email) AND ns.opted_in AND ns.product IS NULL),
    COALESCE(pick.phone_sms_opt_in, false)
      OR EXISTS (SELECT 1 FROM public.venue_sms_contacts sc
                  WHERE lower(sc.email) = lower(p_email) AND NOT COALESCE(sc.unsubscribed, false) AND sc.product IS NULL),
    EXISTS (SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(p_email))
  FROM (SELECT 1) AS one
  LEFT JOIN pick ON true;
$function$;

CREATE OR REPLACE FUNCTION public._coorg_apply_cohost_consent(p_event_id uuid, p_email text, p_host_keys text[], p_wording text, p_locale text, p_source text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_ev record; v_primary text; v_uid uuid; p record; v_n integer := 0;
  v_ev_demo boolean;
BEGIN
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_email = '' OR COALESCE(array_length(p_host_keys, 1), 0) = 0 THEN RETURN 0; END IF;
  v_primary := CASE WHEN v_ev.venue_id IS NOT NULL THEN 'venue:' || v_ev.venue_id ELSE 'org:' || v_ev.organizer_user_id END;
  v_ev_demo := p_event_id = ANY (public.demo_event_ids());
  SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  FOR p IN SELECT * FROM public.event_parties(p_event_id) x
            WHERE x.share_crm AND x.party_key <> v_primary AND x.party_key = ANY (p_host_keys)
              -- Soirée réelle : jamais un contact réel versé dans un compte démo.
              AND (v_ev_demo OR NOT public.coorg_party_is_demo(x.kind, x.venue_id, x.organizer_user_id))
  LOOP
    IF p.kind = 'venue' THEN
      INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, product)
      VALUES (v_uid, p.venue_id, v_email, true, 'cohost_purchase', 'ticketing', now(), NULL)
      ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    ELSE
      INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, product)
      VALUES (v_uid, p.organizer_user_id, v_email, true, 'cohost_purchase', 'ticketing', now(), NULL)
      ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    END IF;
    INSERT INTO public.marketing_consent_events (user_id, email, channel, venue_id, organizer_user_id,
                                                 action, wording_key, wording_text, locale, source)
    VALUES (v_uid, v_email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'consent.emailOffersFrom',
            left(btrim(p_wording), 1000), p_locale, left(COALESCE(p_source, 'checkout'), 60) || ':cohost');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.email_campaigns%ROWTYPE;
  a jsonb;
  v_def jsonb;
  v_preds text[] := '{}';
  v_recent integer;
  v_excl_buyers boolean;
  v_same uuid[];
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR (c.venue_id IS NULL AND c.organizer_user_id IS NULL) THEN RETURN; END IF;

  FOR a IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.audiences_json) = 'array' THEN c.audiences_json ELSE '[]'::jsonb END) x LOOP
    CONTINUE WHEN a->>'kind' IS DISTINCT FROM 'crm';
    v_def := NULL;
    IF COALESCE(a->>'segmentId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (a->>'segmentId')::uuid
         AND ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.organizer_user_id IS NOT NULL AND s.organizer_user_id = c.organizer_user_id));
      CONTINUE WHEN v_def IS NULL;           -- segment supprimé : il ne vise plus personne
    ELSE
      v_def := COALESCE(a->'def', '{}'::jsonb);
    END IF;
    v_preds := array_append(v_preds, '(' || public._crm_filter_sql(v_def, 'p') || ')');
  END LOOP;
  IF cardinality(v_preds) = 0 THEN RETURN; END IF;   -- audience vide ⇒ personne

  v_recent := CASE WHEN COALESCE(c.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
                   THEN (c.exclusions_json->>'recentDays')::integer END;
  v_excl_buyers := COALESCE(c.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1') AND c.event_id IS NOT NULL;
  -- Séparation CRM / Billetterie : « reçu un e-mail depuis N jours » ne compte que les campagnes du CRM.
  v_same := CASE WHEN v_recent IS NULL THEN NULL ELSE public._email_scope_campaign_ids(c.venue_id, c.organizer_user_id, true) END;

  PERFORM public._crm_people_build(c.venue_id, c.organizer_user_id, NULL);

  RETURN QUERY EXECUTE format($q$
    SELECT DISTINCT ON (p.email) p.email::text, COALESCE(p.first_name, ns.first_name)::text,
           COALESCE(p.last_name, ns.last_name)::text, ns.user_id, ns.unsubscribe_token
      FROM _cp p
      JOIN public.newsletter_subscriptions ns
        ON lower(ns.email) = p.email AND ns.opted_in
       AND ((%1$L::text IS NOT NULL AND ns.venue_id = %1$L::text)
         OR (%2$L::uuid IS NOT NULL AND ns.organizer_user_id = %2$L::uuid))
       AND ns.product = 'crm'
     WHERE p.email_ok AND (%3$s)
       AND (%4$L::integer IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.id <> %5$L::uuid
                AND c2.venue_id IS NOT DISTINCT FROM %1$L::text
                AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                AND c2.id = ANY (%8$L::uuid[])
                AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %4$L::integer)
                AND lower(r.email) = p.email))
       AND (NOT %6$L::boolean OR NOT (%7$L::uuid = ANY (p.events)))
     ORDER BY p.email, ns.created_at DESC
  $q$, c.venue_id, c.organizer_user_id, array_to_string(v_preds, ' OR '), v_recent, c.id, v_excl_buyers, c.event_id, v_same);
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_email_attrib(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_hosts text[];
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT lower(substring(e.external_ticket_url FROM '^https?://([^/:?#]+)')))
    INTO v_hosts
    FROM public.events e
   WHERE e.external_ticket_url IS NOT NULL AND e.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND public.crm_campaign_is_crm(c.id)
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);
  SELECT count(*) INTO v_n FROM _cma;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_email_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ces;
  CREATE TEMP TABLE _ces ON COMMIT DROP AS
  SELECT ec.id, ec.name, ec.subject, ec.sent_at, ec.audiences_json, ec.template_kind, ec.event_id,
         r.n, r.bounced, r.complained, GREATEST(r.n - r.bounced, 0) AS received,
         COALESCE(o.opened, 0) AS opened,
         COALESCE(k.clicked, 0) AS clicked, COALESCE(k.ticketing, 0) AS ticketing,
         COALESCE(b.purchases, 0) AS purchases, COALESCE(b.revenue, 0) AS revenue,
         COALESCE(ec.unsubscribes_count, 0) AS unsub,
         COALESCE(b.buyers, 0) AS buyers
    FROM public.email_campaigns ec
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE rr.status IN ('sent', 'complained', 'bounced')) AS n,
             count(*) FILTER (WHERE rr.status = 'bounced') AS bounced,
             count(*) FILTER (WHERE rr.status = 'complained') AS complained
        FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id
    ) r
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT lower(e.recipient_email)) AS opened FROM public.email_campaign_events e
       WHERE e.campaign_id = ec.id AND e.event_type = 'opened'
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT kk.email) AS clicked, count(DISTINCT kk.email) FILTER (WHERE kk.ticketing) AS ticketing
        FROM _cmk kk WHERE kk.campaign_id = ec.id
    ) k ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS purchases, COALESCE(sum(aa.amount), 0) AS revenue, count(DISTINCT aa.email) AS buyers
        FROM _cma aa WHERE aa.campaign_id = ec.id
    ) b ON true
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id
     AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(ec.id)
     AND ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
     AND ec.sent_at >= p_from AND ec.sent_at < p_to;
  SELECT count(*) INTO v_n FROM _ces;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_file_history(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(email text, f_nights integer, f_spent numeric, f_paid integer, f_first timestamp with time zone, f_last timestamp with time zone, f_asof timestamp with time zone, f_list uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (lower(c.email))
         lower(c.email),
         GREATEST(COALESCE(c.event_count, 0),
                  CASE WHEN COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL THEN 1 ELSE 0 END),
         COALESCE(c.total_spent, 0),
         CASE WHEN COALESCE(c.total_spent, 0) > 0 THEN GREATEST(COALESCE(c.event_count, 0), 1) ELSE 0 END,
         LEAST(c.added_at, c.last_purchase_at),
         c.last_purchase_at,
         COALESCE(c.last_purchase_at, c.created_at),
         c.list_import_id
    FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND c.product = 'crm'
     AND c.email IS NOT NULL
     AND (COALESCE(c.event_count, 0) > 0 OR COALESCE(c.total_spent, 0) > 0 OR c.last_purchase_at IS NOT NULL)
     AND c.created_at <= COALESCE(p_at, now())
     AND (c.last_purchase_at IS NULL OR c.last_purchase_at <= COALESCE(p_at, now()))
   ORDER BY lower(c.email), c.created_at DESC,
            ((c.event_count IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.last_purchase_at IS NOT NULL)::int) DESC,
            c.id;
$function$;

CREATE OR REPLACE FUNCTION public._crm_notif_list(p_venue_id text, p_organizer_user_id uuid, p_user uuid, p_enrich boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_def jsonb := public.crm_notif_defaults();
  v_pref public.crm_notification_prefs%ROWTYPE;
  v_kinds jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_balance integer := public.crm_yunits_balance(v_scope);
  v_threshold integer;
  v_short boolean := false;
  v_cum integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_left integer := 2;
  k text;
  r record;
  it jsonb;
  st public.crm_notification_states%ROWTYPE;
  v_buyers integer;
BEGIN
  -- Préférences « dans Yuno » de la personne (défauts complétés).
  SELECT * INTO v_pref FROM public.crm_notification_prefs WHERE scope_key = v_scope AND user_id = p_user;
  FOR k IN SELECT jsonb_object_keys(v_def) LOOP
    v_kinds := v_kinds || jsonb_build_object(k,
      CASE WHEN COALESCE((v_def->k->>'lock')::boolean, false) THEN v_def->k
           ELSE (v_def->k) || COALESCE(v_pref.prefs->k, '{}'::jsonb) END);
  END LOOP;
  v_threshold := COALESCE(v_pref.low_balance, (cfg->>'low_balance')::int, 2000);

  -- ── À faire ───────────────────────────────────────────────────────────────
  -- Un envoi programmé dans l'heure.
  FOR r IN SELECT c.id, c.name, c.scheduled_at FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now() AND c.scheduled_at <= now() + interval '1 hour'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL AND public.crm_campaign_is_crm(c.id)
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_soon:' || r.id, 'kind', 'send_soon', 'cat', 'envois', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', 'prog', 'at', LEAST(now(), r.scheduled_at - interval '1 hour'), 'due_at', r.scheduled_at,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.scheduled_at,
                                   'recipients', public._crm_campaign_estimate(r.id)));
  END LOOP;

  -- Des Yunits qui manquent pour les envois programmés (le premier qui casse).
  FOR r IN SELECT c.id, c.name, c.scheduled_at,
                  public._crm_campaign_estimate(c.id) * (cfg->'rates'->>'email')::int AS cost
             FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now() AND public.crm_campaign_is_crm(c.id)
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
            ORDER BY c.scheduled_at LOOP
    v_cum := v_cum + COALESCE(r.cost, 0);
    IF v_cum > v_balance THEN
      v_short := true;
      v_items := v_items || jsonb_build_object('id', 'yunits_short:' || r.id, 'kind', 'yunits_short', 'cat', 'envois', 'tone', 'todo',
        'need', true, 'lock', false, 'pref', 'bloque', 'at', now(), 'due_at', r.scheduled_at,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'missing', v_cum - v_balance, 'cost', r.cost, 'balance', v_balance));
      EXIT;
    END IF;
  END LOOP;

  -- La synchro Shotgun interrompue (verrouillée), puis reprise.
  FOR r IN SELECT c.id, c.status, c.last_ok_at, c.last_error_at, c.fail_count FROM public.ticketing_connections c
            WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id) LOOP
    IF r.status = 'token_invalid'
       OR (r.last_error_at IS NOT NULL AND (r.last_ok_at IS NULL OR r.last_error_at > r.last_ok_at) AND COALESCE(r.fail_count, 0) >= 3) THEN
      v_items := v_items || jsonb_build_object('id', 'sync_broken:' || r.id || ':' || to_char(COALESCE(r.last_ok_at, r.last_error_at, now()), 'YYYYMMDD'),
        'kind', 'sync_broken', 'cat', 'donnees', 'tone', 'todo', 'need', true, 'lock', true, 'pref', 'sync',
        'at', COALESCE(r.last_error_at, now()), 'due_at', NULL, 'params', jsonb_build_object('since_at', COALESCE(r.last_ok_at, r.last_error_at)));
    ELSIF r.last_error_at IS NOT NULL AND r.last_error_at > now() - interval '7 days' AND r.last_ok_at > r.last_error_at THEN
      v_items := v_items || jsonb_build_object('id', 'sync_resolved:' || r.id || ':' || to_char(r.last_ok_at, 'YYYYMMDD'),
        'kind', 'sync_resolved', 'cat', 'donnees', 'tone', 'ok', 'need', false, 'lock', false, 'pref', 'sync',
        'at', r.last_ok_at, 'due_at', NULL, 'params', '{}'::jsonb);
    END IF;
  END LOOP;

  -- L'abonnement : essai qui finit, compte en pause.
  FOR r IN SELECT s.status, s.trial_ends_at, s.stripe_subscription_id FROM public.crm_subscriptions s WHERE s.scope_key = v_scope LOOP
    IF r.status = 'trialing' AND r.stripe_subscription_id IS NULL AND r.trial_ends_at > now() AND r.trial_ends_at <= now() + interval '3 days' THEN
      v_items := v_items || jsonb_build_object('id', 'trial_ending:' || to_char(r.trial_ends_at, 'YYYYMMDD'),
        'kind', 'trial_ending', 'cat', 'compte', 'tone', 'warn', 'need', true, 'lock', false, 'pref', NULL,
        'at', r.trial_ends_at - interval '3 days', 'due_at', NULL,
        'params', jsonb_build_object('days', GREATEST(1, ceil(extract(epoch FROM r.trial_ends_at - now()) / 86400))::int));
    END IF;
  END LOOP;
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'account_paused', 'kind', 'account_paused', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', true, 'pref', NULL, 'at', now(), 'due_at', NULL, 'params', '{}'::jsonb);
  END IF;

  -- Accès assisté (20261019420000) : une demande de l'équipe Yuno attend la
  -- réponse du titulaire (le consentement est le sien : elle ne vise que lui),
  -- et une session de l'équipe Yuno en cours dans le compte.
  FOR r IN SELECT g.id, g.created_at FROM public.admin_support_grants g
            WHERE g.target_user_id = p_user AND g.status = 'pending' AND g.revoked_at IS NULL
              AND (g.expires_at IS NULL OR g.expires_at > now())
            ORDER BY g.created_at DESC LIMIT 1 LOOP
    v_items := v_items || jsonb_build_object('id', 'support_request:' || r.id, 'kind', 'support_request', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', NULL, 'at', r.created_at, 'due_at', NULL,
      'params', jsonb_build_object('grant_id', r.id));
  END LOOP;
  FOR r IN SELECT s.id, s.created_at, s.expires_at FROM public.admin_support_sessions s
            WHERE s.target_user_id = p_user AND s.status = 'active' AND s.expires_at > now()
            ORDER BY s.created_at DESC LIMIT 1 LOOP
    v_items := v_items || jsonb_build_object('id', 'support_live:' || r.id, 'kind', 'support_live', 'cat', 'compte', 'tone', 'warn',
      'need', false, 'lock', true, 'pref', NULL, 'at', r.created_at, 'due_at', NULL,
      'params', jsonb_build_object('until_at', r.expires_at));
  END LOOP;

  -- Accès SMS (bêta privée, 20261029100000) : ouvert par l'équipe Yuno.
  FOR r IN SELECT a.decided_at FROM public.crm_sms_access a
            WHERE a.scope_key = v_scope AND a.status = 'granted'
              AND a.decided_at > now() - interval '14 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'sms_access_granted:' || to_char(r.decided_at, 'YYYYMMDD'),
      'kind', 'sms_access_granted', 'cat', 'compte', 'tone', 'ok', 'need', false, 'lock', false, 'pref', NULL,
      'at', r.decided_at, 'due_at', NULL, 'params', '{}'::jsonb);
  END LOOP;

  -- ── Historique (30 jours) ─────────────────────────────────────────────────
  FOR r IN SELECT c.id, c.name, c.sent_at, COALESCE(NULLIF(c.recipients_count, 0), c.total_recipients, 0) AS n,
                  COALESCE(c.clickers_count, 0) AS clickers, COALESCE(c.policy_skipped_count, 0) + COALESCE(c.suppressed_count, 0) AS excluded
             FROM public.email_campaigns c
            WHERE c.status = 'sent' AND c.sent_at > now() - interval '30 days'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL AND public.crm_campaign_is_crm(c.id)
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_done:' || r.id, 'kind', 'send_done', 'cat', 'envois', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'prog', 'at', r.sent_at, 'due_at', NULL,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.sent_at, 'recipients', r.n));
    IF r.sent_at < now() - interval '20 hours' THEN
      SELECT buyers INTO v_buyers FROM public.crm_notif_report_cache WHERE campaign_id = r.id;
      IF v_buyers IS NULL AND p_enrich AND v_left > 0 THEN
        v_left := v_left - 1;
        BEGIN
          v_buyers := COALESCE((public.crm_email_result__core(p_venue_id, p_organizer_user_id, r.id)->'stats'->>'purchases')::int, 0);
          BEGIN
            INSERT INTO public.crm_notif_report_cache (campaign_id, buyers) VALUES (r.id, v_buyers)
            ON CONFLICT (campaign_id) DO UPDATE SET buyers = EXCLUDED.buyers, computed_at = now();
          EXCEPTION WHEN others THEN NULL;
          END;
        EXCEPTION WHEN others THEN v_buyers := NULL;
        END;
      END IF;
      v_items := v_items || jsonb_build_object('id', 'send_report:' || r.id, 'kind', 'send_report', 'cat', 'envois', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'rapport', 'at', r.sent_at + interval '20 hours', 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'clickers', r.clickers, 'buyers', v_buyers));
    END IF;
    IF r.excluded > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'send_blocked:' || r.id, 'kind', 'send_blocked', 'cat', 'envois', 'tone', 'warn',
        'need', false, 'lock', false, 'pref', 'bloque', 'at', r.sent_at, 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'excluded', r.excluded));
    END IF;
  END LOOP;

  FOR r IN SELECT i.list_import_id, i.finished_at, i.new_count, i.existing_count, i.file_dup_count FROM public.crm_imports i
            WHERE i.scope_key = v_scope AND i.status = 'done' AND i.finished_at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'import_done:' || r.list_import_id, 'kind', 'import_done', 'cat', 'donnees', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'import', 'at', r.finished_at, 'due_at', NULL,
      'params', jsonb_build_object('added', COALESCE(r.new_count, 0), 'merged', COALESCE(r.existing_count, 0) + COALESCE(r.file_dup_count, 0)));
  END LOOP;

  FOR r IN SELECT count(*)::int AS n FROM public.contact_engagement e WHERE e.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id) || '|crm' AND e.status = 'unreachable' LOOP
    IF r.n > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'contacts_unreadable:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
        'kind', 'contacts_unreadable', 'cat', 'donnees', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'import',
        'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
        'params', jsonb_build_object('n', r.n));
    END IF;
  END LOOP;

  FOR r IN SELECT m.id, m.at, m.delta FROM public.crm_yunit_moves m
            WHERE m.scope_key = v_scope AND m.kind = 'credit' AND m.lot_kind = 'purchase' AND m.at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'recharge_done:' || r.id, 'kind', 'recharge_done', 'cat', 'compte', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'facture', 'at', r.at, 'due_at', NULL,
      'params', jsonb_build_object('amount', r.delta, 'balance', v_balance));
  END LOOP;

  IF NOT v_short AND v_balance < v_threshold AND public.crm_effective_plan(v_scope) <> 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'yunits_low:' || v_threshold || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
      'kind', 'yunits_low', 'cat', 'envois', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'solde',
      'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('balance', v_balance, 'threshold', v_threshold));
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    FOR r IN SELECT om.id, om.accepted_at, om.member_user_id,
                    COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), om.member_email) AS name
               FROM public.org_members om LEFT JOIN public.profiles p ON p.id = om.member_user_id
              WHERE om.organizer_user_id = p_organizer_user_id AND om.invitation_status = 'accepted'
                AND om.accepted_at > now() - interval '30 days' AND om.member_user_id IS DISTINCT FROM p_user LOOP
      v_items := v_items || jsonb_build_object('id', 'team_joined:' || r.id, 'kind', 'team_joined', 'cat', 'compte', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'equipe', 'at', r.accepted_at, 'due_at', NULL,
        'params', jsonb_build_object('name', r.name));
    END LOOP;
  END IF;

  -- Scénarios : l'étape « Me prévenir » (20261016130000), un compteur par jour
  -- et par étape, jamais une alerte par personne. Le libellé est celui de la
  -- version en ligne (sinon du brouillon).
  FOR r IN SELECT d.scenario_id, d.node_id, d.day, d.n, s.name,
                  COALESCE(v.graph->'nodes'->d.node_id->>'label', s.draft->'nodes'->d.node_id->>'label') AS label
             FROM public.crm_scenario_notify_daily d
             JOIN public.crm_scenarios s ON s.id = d.scenario_id
             LEFT JOIN public.crm_scenario_versions v ON v.id = s.live_version_id
            WHERE s.scope_key = v_scope AND d.n > 0
              AND d.day > (now() AT TIME ZONE 'Europe/Paris')::date - 30 LOOP
    v_items := v_items || jsonb_build_object('id', 'scenario_notify:' || r.scenario_id || ':' || r.node_id || ':' || to_char(r.day, 'YYYYMMDD'),
      'kind', 'scenario_notify', 'cat', 'envois', 'tone', 'info', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', LEAST(now(), (r.day::timestamp + interval '23 hours 59 minutes') AT TIME ZONE 'Europe/Paris'), 'due_at', NULL,
      'params', jsonb_build_object('scenario_id', r.scenario_id, 'name', r.name, 'label', COALESCE(r.label, ''), 'n', r.n,
                                   'seen_at', (r.day::timestamp + interval '12 hours') AT TIME ZONE 'Europe/Paris',
                                   'today', r.day = (now() AT TIME ZONE 'Europe/Paris')::date));
  END LOOP;

  -- Plan de soirée prêt (lot A1) : compte en essai, premier import fait,
  -- analyse calculée, prochaine soirée à plus de 24 h. Une entrée par soirée.
  FOR r IN SELECT e.id, e.title, e.start_at, GREATEST(an.computed_at, tc.done_at) AS at
             FROM public.crm_subscriptions cs
             JOIN public.crm_analysis_state an ON an.scope_key = v_scope AND an.computed_at IS NOT NULL
             CROSS JOIN LATERAL (SELECT max(c.initial_import_done_at) AS done_at FROM public.ticketing_connections c
                                  WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
                                    AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)) tc
             CROSS JOIN LATERAL (SELECT ev.id, ev.title, ev.start_at FROM public.events ev
                                  WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
                                    AND ev.start_at > now() + interval '24 hours'
                                    AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
                                      OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
                                  ORDER BY ev.start_at LIMIT 1) e
            WHERE cs.scope_key = v_scope AND cs.status = 'trialing' AND COALESCE(cs.trial_ends_at, now() + interval '1 day') > now()
              AND tc.done_at IS NOT NULL LOOP
    v_items := v_items || jsonb_build_object('id', 'night_plan_ready:' || r.id,
      'kind', 'night_plan_ready', 'cat', 'donnees', 'tone', 'todo', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', LEAST(now(), r.at), 'due_at', r.start_at,
      'params', jsonb_build_object('event_id', r.id, 'title', r.title, 'start_at', r.start_at));
  END LOOP;

  -- Bilan de la semaine (lot A3) : le lundi à partir de 8 h (Paris).
  IF now() >= ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris')
     AND (EXISTS (SELECT 1 FROM public.email_campaigns c
                   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
                     AND public.crm_campaign_is_crm(c.id)
                     AND c.sent_at >= ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days') AT TIME ZONE 'Europe/Paris')
                     AND c.sent_at < ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'))
       OR EXISTS (SELECT 1 FROM public.crm_scenarios s WHERE s.scope_key = v_scope AND s.status = 'active')
       OR EXISTS (SELECT 1 FROM public.events ev
                   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
                     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id)))) THEN
    v_items := v_items || jsonb_build_object(
      'id', 'weekly_review:' || to_char(date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days', 'IYYYIW'),
      'kind', 'weekly_review', 'cat', 'envois', 'tone', 'info', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('from_at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days') AT TIME ZONE 'Europe/Paris',
                                   'to_at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '1 day') AT TIME ZONE 'Europe/Paris'));
  END IF;

  -- ── Préférences et état de la personne ────────────────────────────────────
  FOR it IN SELECT x FROM jsonb_array_elements(v_items) x LOOP
    k := it->>'pref';
    -- Coupée « dans Yuno » : on ne la montre pas (sauf alerte verrouillée).
    CONTINUE WHEN k IS NOT NULL AND NOT COALESCE((it->>'lock')::boolean, false)
                  AND COALESCE((v_kinds->k->>'app')::boolean, true)
                  AND NOT COALESCE((v_kinds->k->>'a')::boolean, true);
    SELECT * INTO st FROM public.crm_notification_states
     WHERE scope_key = v_scope AND user_id = p_user AND item_id = it->>'id';
    v_out := v_out || jsonb_build_array((it - 'pref') || jsonb_build_object(
      'icon', it->>'kind', 'resolved', false, 'href', NULL,
      'read', st.read_at IS NOT NULL, 'archived', st.archived_at IS NOT NULL,
      'snoozed_until', CASE WHEN st.snoozed_until > now() THEN st.snoozed_until END));
  END LOOP;

  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'need')::boolean DESC, (x->>'at')::timestamptz DESC)
                     FROM jsonb_array_elements(v_out) x), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_started timestamp with time zone, p_demo boolean, p_hold text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round  integer;
  v_pair   record;
  s        public.crm_scenarios%ROWTYPE;
  v        public.crm_scenario_versions%ROWTYPE;
  n        jsonb;
  v_t      text;
  v_sql    text;
  v_ev     record;
  v_moved  integer := 0;
  v_exits  integer := 0;
  v_sent   integer := 0;
  v_k      integer;
  v_res    jsonb;
BEGIN
  FOR v_round IN 1..32 LOOP
    EXIT WHEN clock_timestamp() - p_started > interval '4 seconds';
    TRUNCATE _scn_due;
    INSERT INTO _scn_due (id)
    SELECT r.id FROM public.crm_scenario_runs r
      JOIN public.crm_scenarios sc ON sc.id = r.scenario_id AND sc.status = 'active'
     WHERE r.scope_key = p_scope AND r.status = 'active' AND r.due_at <= now()
     ORDER BY r.due_at LIMIT 2000
     FOR UPDATE OF r SKIP LOCKED;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM _scn_due);

    -- Sorties forcées (non réglables).
    WITH x AS (
      SELECT r.id, CASE
               WHEN EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = p_scope AND o.email = r.email) THEN 'optout'
               WHEN public.is_email_suppressed(r.email) THEN 'suppressed'
               WHEN EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                             WHERE lower(ns.email) = r.email AND ns.opted_out_at IS NOT NULL AND NOT COALESCE(ns.opted_in, false)
                               AND ns.venue_id IS NOT DISTINCT FROM p_venue_id AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
                               AND ns.product = 'crm') THEN 'unsubscribed'
               WHEN EXISTS (SELECT 1 FROM public.venue_sms_contacts vc JOIN public.sms_stop_list st ON st.phone_e164 = vc.phone_e164
                             WHERE lower(vc.email) = r.email AND (st.scope_key IS NULL OR st.scope_key = p_scope)
                               AND vc.venue_id IS NOT DISTINCT FROM p_venue_id
                               AND (p_venue_id IS NOT NULL OR vc.organizer_user_id = p_organizer_user_id)) THEN 'stop'
               WHEN r.event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = r.event_id AND e.cancelled_at IS NOT NULL) THEN 'event_cancelled'
             END AS why
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
    ), done AS (
      UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = x.why, updated_at = now()
        FROM x WHERE r.id = x.id AND x.why IS NOT NULL
      RETURNING r.id
    )
    DELETE FROM _scn_due d USING done WHERE d.id = done.id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_exits := v_exits + v_k;

    -- Objectif atteint : sortie, comptée (l'heure de l'achat ou du scan fait foi).
    -- En ensembles : une jointure, jamais une sous-requête par personne.
    WITH rr AS (
      SELECT r.id, r.email, r.event_id, r.entered_at, vv.graph->'goal'->>'type' AS gt
        FROM public.crm_scenario_runs r
        JOIN _scn_due d ON d.id = r.id
        JOIN public.crm_scenario_versions vv ON vv.id = r.version_id
       WHERE jsonb_typeof(vv.graph->'goal') = 'object'
    ), gl AS (
      SELECT rr.id,
             min(CASE WHEN rr.gt IN ('bought_event', 'bought_any') AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                           AND COALESCE(t.purchased_at, t.first_seen_at) >= rr.entered_at
                           AND (rr.gt = 'bought_any' OR t.event_id = rr.event_id)
                      THEN COALESCE(t.purchased_at, t.first_seen_at)
                      WHEN rr.gt = 'entered' AND t.event_id = rr.event_id AND t.scanned_at IS NOT NULL
                      THEN t.scanned_at END) AS at
        FROM rr
        JOIN public.external_tickets t ON lower(t.buyer_email) = rr.email
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       GROUP BY rr.id
    ), done AS (
      UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = 'goal', goal_at = gl.at, updated_at = now()
        FROM gl WHERE r.id = gl.id AND gl.at IS NOT NULL
      RETURNING r.id
    )
    DELETE FROM _scn_due d USING done WHERE d.id = done.id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_exits := v_exits + v_k;

    -- Les nœuds, par paquet (version, nœud).
    FOR v_pair IN
      SELECT r.version_id, r.node_id, count(*) AS k
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
       GROUP BY r.version_id, r.node_id
    LOOP
      EXIT WHEN clock_timestamp() - p_started > interval '4 seconds';
      SELECT * INTO v FROM public.crm_scenario_versions WHERE id = v_pair.version_id;
      SELECT * INTO s FROM public.crm_scenarios WHERE id = v.scenario_id;
      n := v.graph->'nodes'->v_pair.node_id;
      v_t := n->>'type';
      TRUNCATE _scn_grp;
      INSERT INTO _scn_grp (id, email, event_id, entered_at, node_since, holdout, last_message_at, version_id, scope_key)
      SELECT r.id, r.email, r.event_id, r.entered_at, r.node_since, r.holdout, r.last_message_at, r.version_id, r.scope_key
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
       WHERE r.version_id = v_pair.version_id AND r.node_id = v_pair.node_id;

      IF n IS NULL OR v_t = 'end' THEN
        UPDATE _scn_grp SET next_id = NULL, go_next = true;
      ELSIF v_t = 'wait' AND n->>'mode' = 'duration' THEN
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next'
         WHERE g.node_since + make_interval(hours => (n->>'hours')::integer) <= now();
        UPDATE public.crm_scenario_runs r SET due_at = g.node_since + make_interval(hours => (n->>'hours')::integer)
          FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
      ELSIF v_t = 'wait' AND n->>'mode' = 'until_event' THEN
        -- Une heure par soirée (pas par personne).
        UPDATE _scn_grp g SET retry_at = et.at
          FROM (SELECT x.event_id, public._crm_scenario_event_time(x.event_id, n) AS at
                  FROM (SELECT DISTINCT y.event_id FROM _scn_grp y) x) et
         WHERE et.event_id IS NOT DISTINCT FROM g.event_id;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next' WHERE g.retry_at IS NULL OR g.retry_at <= now();
        UPDATE public.crm_scenario_runs r SET due_at = g.retry_at FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
      ELSIF v_t IN ('branch', 'wait') THEN
        -- Une condition : la même compilation que le filtre (le chiffre = l'envoi).
        PERFORM public._crm_scenario_need_cp(p_venue_id, p_organizer_user_id);
        FOR v_ev IN SELECT DISTINCT g.event_id FROM _scn_grp g LOOP
          v_sql := public._crm_cond_sql(public._crm_cond_resolve(p_scope, n->'cond', v_ev.event_id), 'p', 'r');
          EXECUTE format('UPDATE _scn_grp g SET cond_ok = true FROM _cp p, public.crm_scenario_runs r
                           WHERE p.email = g.email AND r.id = g.id AND g.event_id IS NOT DISTINCT FROM %L::uuid AND (%s)',
                         v_ev.event_id, v_sql);
        END LOOP;
        IF v_t = 'branch' THEN
          UPDATE _scn_grp g SET go_next = true, next_id = CASE WHEN g.cond_ok THEN n->>'yes' ELSE n->>'no' END;
        ELSE
          UPDATE _scn_grp g SET go_next = true, next_id = n->>'next' WHERE g.cond_ok;
          UPDATE _scn_grp g SET go_next = true, next_id = n->>'timeout'
           WHERE NOT g.go_next AND g.node_since + make_interval(hours => (n->>'max_hours')::integer) <= now();
          UPDATE public.crm_scenario_runs r
             SET due_at = LEAST(g.node_since + make_interval(hours => (n->>'max_hours')::integer), now() + interval '1 hour')
            FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
        END IF;
      ELSIF v_t = 'split' THEN
        -- Test A/B déterministe : la même personne prend toujours le même chemin.
        UPDATE _scn_grp g SET go_next = true, next_id = pth.nxt
          FROM (SELECT y.id, (SELECT pa.value->>'next'
                                FROM (SELECT z.value, sum((z.value->>'pct')::integer) OVER (ORDER BY z.o) AS cum
                                        FROM jsonb_array_elements(n->'paths') WITH ORDINALITY AS z(value, o)) pa
                               WHERE (abs(hashtext(y.id::text || ':' || v_pair.node_id)) % 100) < pa.cum
                               ORDER BY pa.cum LIMIT 1) AS nxt
                  FROM _scn_grp y) pth
         WHERE pth.id = g.id;
      ELSIF v_t IN ('email', 'sms') THEN
        v_res := public._crm_scenario_message(s, v, v_pair.node_id, n, p_demo, p_hold);
        v_sent := v_sent + COALESCE((v_res->>'sent')::integer, 0);
        UPDATE _scn_grp g SET next_id = n->>'next' WHERE g.go_next;
      ELSIF v_t = 'tag' THEN
        IF NOT p_demo THEN
          INSERT INTO public.crm_contact_notes (scope_key, email, venue_id, organizer_user_id, tags, updated_at)
          SELECT p_scope, g.email, p_venue_id, p_organizer_user_id,
                 CASE WHEN n->>'op' = 'add' THEN ARRAY[btrim(n->>'tag')] ELSE '{}'::text[] END, now()
            FROM _scn_grp g WHERE NOT g.holdout
          ON CONFLICT (scope_key, email) DO UPDATE
            SET tags = CASE WHEN n->>'op' = 'add'
                            THEN (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(crm_contact_notes.tags, '{}') || ARRAY[btrim(n->>'tag')]) x)
                            ELSE array_remove(COALESCE(crm_contact_notes.tags, '{}'), btrim(n->>'tag')) END,
                updated_at = now();
        END IF;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next';
      ELSIF v_t = 'notify' THEN
        INSERT INTO public.crm_scenario_notify_daily (scenario_id, node_id, day, n)
        SELECT s.id, v_pair.node_id, current_date, count(*) FROM _scn_grp
        ON CONFLICT (scenario_id, node_id, day) DO UPDATE SET n = crm_scenario_notify_daily.n + EXCLUDED.n;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next';
      ELSE
        -- Nœud inconnu (version ancienne) : la personne sort proprement.
        UPDATE _scn_grp g SET go_next = true, next_id = NULL;
      END IF;

      -- Registre (nœuds non-messages) et passage au suivant.
      IF v_t IS NULL OR v_t NOT IN ('email', 'sms') THEN
        INSERT INTO public.crm_scenario_steps (run_id, node_id, scenario_id, version_id, status, done_at)
        SELECT g.id, v_pair.node_id, s.id, v.id, 'passed', now() FROM _scn_grp g WHERE g.go_next
        ON CONFLICT (run_id, node_id, pass) DO NOTHING;
      END IF;
      UPDATE public.crm_scenario_runs r
         SET node_id = g.next_id, node_since = now(), due_at = now(), updated_at = now(),
             status = CASE WHEN g.next_id IS NULL OR v_t = 'end' THEN 'done' ELSE r.status END,
             exit_reason = CASE WHEN g.next_id IS NULL OR v_t = 'end' THEN 'end' ELSE r.exit_reason END
        FROM _scn_grp g WHERE r.id = g.id AND g.go_next;
      GET DIAGNOSTICS v_k = ROW_COUNT;
      v_moved := v_moved + v_k;
      -- Ce paquet est traité pour ce tour.
      DELETE FROM _scn_due d USING _scn_grp g WHERE d.id = g.id;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('moved', v_moved, 'exits', v_exits, 'sent', v_sent);
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_scenario_candidates(p_s crm_scenarios, p_graph jsonb, p_published timestamp with time zone, p_ticket_mark timestamp with time zone, p_signup_mark timestamp with time zone, p_dry boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t       jsonb := p_graph->'trigger';
  tt      text := p_graph->'trigger'->>'type';
  v_venue text := p_s.venue_id;
  v_org   uuid := p_s.organizer_user_id;
  v_key   text := p_s.scope_key;
  v_n     integer := 0;
  v_def   jsonb;
  v_evs   uuid[];
BEGIN
  TRUNCATE _scn_cand;

  IF tt IN ('event_published', 'before_event') THEN
    -- Les soirées dues aujourd'hui ; la base entière en est l'audience.
    SELECT array_agg(e.id) INTO v_evs
      FROM public.events e
      LEFT JOIN LATERAL (SELECT x.published_at FROM public.external_events x WHERE x.event_id = e.id ORDER BY x.synced_at DESC LIMIT 1) x ON true
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.status = 'active'
       AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
       AND e.start_at > now()
       -- Une soirée dont la base a déjà été lue en entier n'est pas relue.
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb) ? e.id::text)
       AND CASE tt
             -- Publiée depuis la mise en ligne du scénario, il y a moins de 48 h.
             WHEN 'event_published' THEN COALESCE(x.published_at, e.created_at) >= p_published
                                     AND COALESCE(x.published_at, e.created_at) > now() - interval '48 hours'
                                     AND e.start_at > now() + interval '24 hours'
             -- Le jour J-N, heure de la soirée.
             ELSE ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date - (t->>'days')::integer)
                  = (now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
                  AND (t->>'series' IS NULL OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
                  AND (t->>'genre' IS NULL OR lower(t->>'genre') = ANY (
                        SELECT lower(btrim(g)) FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g WHERE g IS NOT NULL))
           END;
    IF v_evs IS NOT NULL THEN
      PERFORM public._crm_scenario_need_cp(v_venue, v_org);
      INSERT INTO _scn_cand (email, event_id, window_end)
      SELECT p.email, e.id,
             CASE WHEN tt = 'event_published' THEN LEAST(e.start_at, now() + interval '48 hours') ELSE e.start_at END
        FROM _cp p CROSS JOIN public.events e WHERE e.id = ANY (v_evs)
      ON CONFLICT DO NOTHING;
    END IF;

  ELSIF tt = 'after_event' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT lower(tk.buyer_email), e.id,
           COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) + interval '24 hours'
      FROM public.events e
      JOIN public.external_tickets tk ON tk.event_id = e.id AND tk.buyer_email IS NOT NULL
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) <= now()
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) > now() - interval '24 hours'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') >= p_published - interval '24 hours'
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb) ? e.id::text)
       AND CASE t->>'who'
             WHEN 'entered' THEN tk.scanned_at IS NOT NULL
             -- Absents : seulement si la porte a scanné (sinon « pas scanné » ne veut pas dire « pas venu »).
             WHEN 'absent_buyers' THEN tk.scanned_at IS NULL AND public._crm_ticket_is_sale(tk.status, tk.deal_channel)
                                       AND public._crm_event_scan_known(e.id)
                                       AND NOT EXISTS (SELECT 1 FROM public.external_tickets t2
                                                        WHERE t2.event_id = e.id AND lower(t2.buyer_email) = lower(tk.buyer_email)
                                                          AND t2.scanned_at IS NOT NULL)
             ELSE tk.status IN ('valid', 'transferred')
           END
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'ticket_bought' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT ON (lower(tk.buyer_email), tk.event_id) lower(tk.buyer_email), tk.event_id,
           COALESCE(tk.purchased_at, tk.first_seen_at) + interval '48 hours'
      FROM public.external_tickets tk
      JOIN public.events e ON e.id = tk.event_id
     WHERE ((v_venue IS NOT NULL AND tk.venue_id = v_venue) OR (v_org IS NOT NULL AND tk.organizer_user_id = v_org))
       AND tk.buyer_email IS NOT NULL AND public._crm_ticket_is_sale(tk.status, tk.deal_channel)
       -- Vu par la synchro depuis le dernier passage (l'heure d'achat peut précéder la synchro).
       AND tk.first_seen_at > GREATEST(COALESCE(p_ticket_mark, p_published), p_published)
       AND COALESCE(tk.purchased_at, tk.first_seen_at) > now() - interval '48 hours'
       AND (t->>'series' IS NULL OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
       AND (NOT COALESCE((t->>'first')::boolean, false) OR NOT EXISTS (
              SELECT 1 FROM public.external_tickets t0
               WHERE ((v_venue IS NOT NULL AND t0.venue_id = v_venue) OR (v_org IS NOT NULL AND t0.organizer_user_id = v_org))
                 AND lower(t0.buyer_email) = lower(tk.buyer_email) AND public._crm_ticket_is_sale(t0.status, t0.deal_channel)
                 AND COALESCE(t0.purchased_at, t0.first_seen_at) < COALESCE(tk.purchased_at, tk.first_seen_at)
                 AND t0.event_id IS DISTINCT FROM tk.event_id))
     ORDER BY lower(tk.buyer_email), tk.event_id, COALESCE(tk.purchased_at, tk.first_seen_at)
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'signup_confirmed' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT lower(en.email), pg.event_id, en.confirmed_at + interval '48 hours'
      FROM public.crm_signup_entries en
      JOIN public.crm_signup_pages pg ON pg.id = en.page_id
     WHERE pg.id = (t->>'page_id')::uuid
       AND pg.venue_id IS NOT DISTINCT FROM v_venue AND pg.organizer_user_id IS NOT DISTINCT FROM v_org
       AND en.email IS NOT NULL AND en.confirmed_at IS NOT NULL
       AND en.confirmed_at > GREATEST(COALESCE(p_signup_mark, p_published), p_published)
       AND en.confirmed_at > now() - interval '48 hours'
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'chance_high' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT sc.email, sc.event_id, e.start_at - interval '2 hours'
      FROM public.crm_person_night_score sc
      JOIN public.events e ON e.id = sc.event_id
     WHERE sc.scope_key = v_key AND sc.label = 'high'
       AND e.start_at > now() + interval '24 hours' AND e.cancelled_at IS NULL
       -- Les chances changent la nuit : une lecture par soirée et par jour.
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb)
                ? (e.id::text || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')))
       AND NOT public._email_event_holder(e.id, sc.email)
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'click_no_buy' THEN
    -- Un clic NOMINATIF dans un e-mail de la portée vers la billetterie d'une
    -- soirée à venir, il y a N heures (fenêtre de 24 h), puis aucune place.
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT k.em, k.event_id, LEAST(k.last_click + make_interval(hours => (t->>'hours')::integer) + interval '24 hours',
                                   e.start_at - interval '2 hours')
      FROM (
        SELECT lower(ev.recipient_email) AS em, c.event_id, max(ev.created_at) AS last_click
          FROM public.email_campaign_events ev
          JOIN public.email_campaigns c ON c.id = ev.campaign_id
          JOIN public.events e2 ON e2.id = c.event_id
         WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
           AND c.venue_id IS NOT DISTINCT FROM v_venue AND c.organizer_user_id IS NOT DISTINCT FROM v_org
           AND e2.external_ticket_url IS NOT NULL AND e2.external_source IS NOT NULL
           AND public.crm_campaign_is_crm(c.id)
           AND public._link_base(ev.metadata->'click'->>'link') = public._link_base(e2.external_ticket_url)
           AND ev.created_at > now() - make_interval(hours => (t->>'hours')::integer) - interval '24 hours'
         GROUP BY 1, 2
      ) k
      JOIN public.events e ON e.id = k.event_id
     WHERE k.last_click <= now() - make_interval(hours => (t->>'hours')::integer)
       AND k.last_click >= p_published
       AND e.start_at > now() + interval '2 hours' AND e.cancelled_at IS NULL
       AND NOT public._email_event_holder(e.id, k.em)
    ON CONFLICT DO NOTHING;

  ELSIF tt IN ('segment_joined', 'manual_segment', 'absence') THEN
    IF tt = 'manual_segment' AND COALESCE((p_s.trigger_state->>'manual_done')::boolean, false) THEN RETURN 0; END IF;
    IF tt = 'absence' AND COALESCE(p_s.trigger_state->'done', '[]'::jsonb)
                          ? ('day:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) THEN RETURN 0; END IF;
    IF tt = 'segment_joined' AND COALESCE(p_s.trigger_state->>'day', '') = to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
       AND COALESCE((p_s.trigger_state->>'baseline')::boolean, false) THEN RETURN 0; END IF;
    PERFORM public._crm_scenario_need_cp(v_venue, v_org);
    IF tt = 'absence' THEN
      INSERT INTO _scn_cand (email, event_id, window_end)
      SELECT p.email, NULL, now() + interval '24 hours'
        FROM _cp p
       WHERE p.last_night < now() - make_interval(days => (t->>'days')::integer)
         AND p.last_night >= now() - make_interval(days => (t->>'days')::integer) - interval '1 day'
         AND NOT p.upcoming
      ON CONFLICT DO NOTHING;
    ELSE
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (t->>'segment_id')::uuid AND s.scope_key = v_key;
      IF v_def IS NULL THEN RETURN 0; END IF;
      EXECUTE format('INSERT INTO _scn_cand (email, event_id, window_end) SELECT p.email, NULL, now() + interval ''7 days'' FROM _cp p WHERE %s ON CONFLICT DO NOTHING',
                     public._crm_filter_sql(v_def, 'p'));
      IF tt = 'segment_joined' THEN
        IF NOT COALESCE((p_s.trigger_state->>'baseline')::boolean, false) THEN
          -- Première lecture : la base est posée, personne n'entre.
          IF p_dry THEN TRUNCATE _scn_cand; RETURN 0; END IF;
          INSERT INTO public.crm_scenario_seen (scenario_id, email) SELECT p_s.id, c.email FROM _scn_cand c ON CONFLICT DO NOTHING;
          TRUNCATE _scn_cand;
          UPDATE public.crm_scenarios SET trigger_state = trigger_state || jsonb_build_object('baseline', true, 'day',
                   to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) WHERE id = p_s.id;
          RETURN 0;
        END IF;
        -- Les nouveaux membres seulement ; ils rejoignent la base.
        DELETE FROM _scn_cand c USING public.crm_scenario_seen sn WHERE sn.scenario_id = p_s.id AND sn.email = c.email;
        IF p_dry THEN SELECT count(*) INTO v_n FROM _scn_cand; RETURN v_n; END IF;
        INSERT INTO public.crm_scenario_seen (scenario_id, email) SELECT p_s.id, c.email FROM _scn_cand c ON CONFLICT DO NOTHING;
        UPDATE public.crm_scenarios SET trigger_state = trigger_state || jsonb_build_object('day',
                 to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) WHERE id = p_s.id;
      ELSIF NOT p_dry THEN
        UPDATE public.crm_scenarios SET trigger_state = trigger_state || '{"manual_done": true}'::jsonb WHERE id = p_s.id;
      END IF;
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM _scn_cand;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_scenario_content(p_venue_id text, p_organizer_user_id uuid, p_graph jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  errs    jsonb := '[]'::jsonb;
  warns   jsonb := '[]'::jsonb;
  t       jsonb := p_graph->'trigger';
  n       record;
  v_seg   text;
  v_fam   text;
  v_page_event uuid;
  v_sms   boolean := false;
  v_ready boolean;
  v_score text;
BEGIN
  -- Déclencheur : segment et page du compte.
  IF t->>'type' IN ('segment_joined', 'manual_segment') AND public._crm_scn_uuid(t->'segment_id')
     AND NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.id = (t->>'segment_id')::uuid AND s.scope_key = v_key) THEN
    errs := public._crm_scn_push(errs, 'unknown_segment', NULL, 'trigger.segment_id');
  END IF;
  IF t->>'type' = 'signup_confirmed' AND public._crm_scn_uuid(t->'page_id') THEN
    SELECT pg.event_id INTO v_page_event FROM public.crm_signup_pages pg
     WHERE pg.id = (t->>'page_id')::uuid
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
    IF NOT FOUND THEN
      errs := public._crm_scn_push(errs, 'unknown_page', NULL, 'trigger.page_id');
    ELSIF v_page_event IS NULL AND public._crm_scenario_uses_event(p_graph) THEN
      errs := public._crm_scn_push(errs, 'page_without_event', NULL, 'trigger.page_id');
    END IF;
  END IF;

  -- Segments cités par le filtre d'entrée.
  FOREACH v_seg IN ARRAY public._crm_cond_segment_ids(p_graph->'entry'->'filter') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.id::text = v_seg AND s.scope_key = v_key) THEN
      errs := public._crm_scn_push(errs, 'unknown_segment', NULL, 'entry.filter');
    END IF;
  END LOOP;

  FOR n IN SELECT x.id, x.v FROM jsonb_each(CASE WHEN jsonb_typeof(p_graph->'nodes') = 'object' THEN p_graph->'nodes' ELSE '{}'::jsonb END) x(id, v) LOOP
    IF n.v->>'type' = 'email' AND public._crm_scn_uuid(n.v->'template_id')
       AND NOT EXISTS (SELECT 1 FROM public.email_campaign_templates tp
                        WHERE tp.id = (n.v->>'template_id')::uuid AND tp.product = 'crm'
                          AND tp.venue_id IS NOT DISTINCT FROM p_venue_id
                          AND tp.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
      errs := public._crm_scn_push(errs, 'unknown_template', n.id, 'template_id');
    END IF;
    IF n.v->>'type' IN ('email', 'sms') AND n.v->>'event' = 'fixed' AND public._crm_scn_uuid(n.v->'event_id') THEN
      IF NOT EXISTS (SELECT 1 FROM public.events e
                      WHERE e.id = (n.v->>'event_id')::uuid AND e.external_source IS NOT NULL
                        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
                          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
        errs := public._crm_scn_push(errs, 'unknown_event', n.id, 'event_id');
      ELSIF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = (n.v->>'event_id')::uuid AND e.start_at > now()) THEN
        errs := public._crm_scn_push(errs, 'event_past', n.id, 'event_id');
      END IF;
    END IF;
    IF n.v->>'type' = 'sms' THEN v_sms := true; END IF;
    IF n.v->>'type' IN ('branch', 'wait') THEN
      FOREACH v_seg IN ARRAY public._crm_cond_segment_ids(n.v->'cond') LOOP
        IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.id::text = v_seg AND s.scope_key = v_key) THEN
          errs := public._crm_scn_push(errs, 'unknown_segment', n.id, 'cond');
        END IF;
      END LOOP;
      -- Une famille qui n'est pas confirmée sur le compte ne retient personne.
      FOREACH v_fam IN ARRAY public._crm_cond_leaf_values(n.v->'cond', 'sc_family') LOOP
        IF NOT public._crm_family_confirmed(v_key, v_fam) THEN
          warns := public._crm_scn_push(warns, 'family_not_confirmed', n.id, 'cond:' || v_fam);
        END IF;
      END LOOP;
      IF cardinality(public._crm_cond_leaf_values(n.v->'cond', 'sc_chance')) > 0 THEN
        SELECT m.status INTO v_score FROM public.crm_score_model m WHERE m.scope_key = v_key;
        IF COALESCE(v_score, '') <> 'ok' THEN warns := public._crm_scn_push(warns, 'chance_unavailable', n.id, 'cond'); END IF;
      END IF;
    END IF;
  END LOOP;
  FOREACH v_fam IN ARRAY public._crm_cond_leaf_values(p_graph->'entry'->'filter', 'sc_family') LOOP
    IF NOT public._crm_family_confirmed(v_key, v_fam) THEN
      warns := public._crm_scn_push(warns, 'family_not_confirmed', NULL, 'entry.filter:' || v_fam);
    END IF;
  END LOOP;
  IF cardinality(public._crm_cond_leaf_values(p_graph->'entry'->'filter', 'sc_chance')) > 0 THEN
    SELECT m.status INTO v_score FROM public.crm_score_model m WHERE m.scope_key = v_key;
    IF COALESCE(v_score, '') <> 'ok' THEN warns := public._crm_scn_push(warns, 'chance_unavailable', NULL, 'entry.filter'); END IF;
  END IF;

  -- Un SMS exige l'identité légale de l'expéditeur.
  IF v_sms THEN
    v_ready := COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id, 'crm')->>'identity_ok')::boolean, false);
    IF NOT v_ready THEN errs := public._crm_scn_push(errs, 'sms_identity', NULL, 'sms'); END IF;
  END IF;
  RETURN jsonb_build_object('errors', public._crm_scn_sorted(errs), 'warnings', public._crm_scn_sorted(warns));
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_scenario_message(p_s crm_scenarios, p_v crm_scenario_versions, p_node_id text, p_node jsonb, p_demo boolean, p_hold text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key    text := p_s.scope_key;
  v_ch     text := p_node->>'type';
  v_rates  jsonb := public.crm_sms_rates();
  v_rate   integer;
  v_room   bigint;
  v_tpl    public.email_campaign_templates%ROWTYPE;
  v_grp    record;
  v_child  uuid;
  v_blocks jsonb;
  v_label  text;
  v_seg    integer := public._crm_sms_segments_estimate(p_node->>'body');
  v_sent   integer := 0;
  v_cap    integer;
BEGIN
  -- La soirée du message, et la fenêtre (48 h après l'arrivée, jamais après
  -- « 2 h avant la soirée » quand le message en parle).
  UPDATE _scn_grp g SET msg_event = CASE p_node->>'event'
      WHEN 'scenario' THEN g.event_id
      WHEN 'fixed' THEN (p_node->>'event_id')::uuid
      ELSE NULL END;
  IF p_node->>'event' = 'for_person' THEN
    UPDATE _scn_grp g SET msg_event = pk.event_id
      FROM public._crm_scenario_pick_events(p_s.venue_id, p_s.organizer_user_id, ARRAY(SELECT email FROM _scn_grp)) pk
     WHERE pk.email = g.email;
  END IF;
  INSERT INTO public.crm_scenario_steps (run_id, node_id, scenario_id, version_id, status, reason, due_at, window_end)
  SELECT g.id, p_node_id, p_s.id, p_v.id, 'held', 'queued', now(),
         LEAST(now() + interval '48 hours', COALESCE((SELECT e.start_at - interval '2 hours' FROM public.events e WHERE e.id = g.msg_event), 'infinity'::timestamptz))
    FROM _scn_grp g
  ON CONFLICT (run_id, node_id, pass) DO NOTHING;
  UPDATE _scn_grp g SET window_end = st.window_end, reason = NULL
    FROM public.crm_scenario_steps st WHERE st.run_id = g.id AND st.node_id = p_node_id AND st.pass = 1;

  -- Le témoin ne reçoit rien ; il suit le chemin.
  UPDATE _scn_grp g SET outcome = 'holdout' WHERE g.holdout;
  -- Plus de soirée à vendre, ou fenêtre passée : expiré (le dernier report dit pourquoi).
  UPDATE _scn_grp g SET outcome = 'expired', reason = COALESCE(
           (SELECT st.reason FROM public.crm_scenario_steps st WHERE st.run_id = g.id AND st.node_id = p_node_id AND st.pass = 1 AND st.reason <> 'queued'),
           'late')
   WHERE g.outcome IS NULL AND (now() > g.window_end OR (p_node->>'event' IN ('scenario', 'fixed', 'for_person') AND g.msg_event IS NULL));
  UPDATE _scn_grp g SET reason = 'no_event' WHERE g.outcome = 'expired' AND g.msg_event IS NULL AND p_node->>'event' <> 'none' AND g.reason = 'late';

  IF v_ch = 'email' THEN
    -- L'accord e-mail de la portée (le registre de consentement), sinon expiré.
    UPDATE _scn_grp g SET outcome = 'expired', reason = 'no_consent'
     WHERE g.outcome IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.newsletter_subscriptions s
        WHERE lower(s.email) = g.email AND s.opted_in AND s.opted_out_at IS NULL
          AND s.venue_id IS NOT DISTINCT FROM p_s.venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id
          AND s.product = 'crm');
  ELSE
    UPDATE _scn_grp g SET phone = ph.phone_e164
      FROM (
        SELECT DISTINCT ON (lower(vc.email)) lower(vc.email) AS em, vc.phone_e164
          FROM public.venue_sms_contacts vc
         WHERE lower(vc.email) IN (SELECT x.email FROM _scn_grp x)
           AND vc.product = 'crm'
           AND vc.venue_id IS NOT DISTINCT FROM p_s.venue_id
           AND (p_s.venue_id IS NOT NULL OR vc.organizer_user_id = p_s.organizer_user_id)
           AND NOT COALESCE(vc.unsubscribed, false) AND vc.sms_consent_at > now() - interval '36 months'
           AND vc.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         ORDER BY lower(vc.email), vc.sms_consent_at DESC) ph
     WHERE ph.em = g.email AND g.outcome IS NULL;
    UPDATE _scn_grp g SET outcome = 'expired', reason = 'no_consent'
     WHERE g.outcome IS NULL AND (g.phone IS NULL
       OR EXISTS (SELECT 1 FROM public.sms_stop_list st WHERE st.phone_e164 = g.phone AND (st.scope_key IS NULL OR st.scope_key = v_key))
       OR public.sms_tariff_zone(g.phone) = 'blocked');
  END IF;

  -- Le compte ne peut pas envoyer : reporté.
  IF p_hold IS NOT NULL THEN
    UPDATE _scn_grp g SET reason = p_hold WHERE g.outcome IS NULL;
    UPDATE _scn_grp g SET outcome = 'held' WHERE g.outcome IS NULL;
  END IF;

  -- 20 h depuis le message précédent de CETTE personne (tous scénarios du compte).
  -- (« aurait envoyé » compte aussi : un passage de démo ne fait pas deux messages.)
  UPDATE _scn_grp g SET outcome = 'held', reason = 'spacing', retry_at = x.last + interval '20 hours'
    FROM (
      SELECT r.email, max(st.done_at) AS last FROM public.crm_scenario_steps st JOIN public.crm_scenario_runs r ON r.id = st.run_id
       WHERE r.scope_key = v_key AND r.email IN (SELECT y.email FROM _scn_grp y)
         AND st.status IN ('sent', 'would_send') AND st.done_at > now() - interval '20 hours'
       GROUP BY r.email
    ) x
   WHERE x.email = g.email AND g.outcome IS NULL;

  -- Plafonds globaux (décision 3) : la politique d'envoi Yuno.
  IF v_ch = 'email' THEN
    UPDATE _scn_grp g SET outcome = CASE WHEN pol.reason = 'suppressed' THEN 'expired' ELSE 'held' END, reason = pol.reason
      FROM public._email_send_policy_many(ARRAY(SELECT email FROM _scn_grp WHERE outcome IS NULL), 'automation') pol
     WHERE pol.email = g.email AND g.outcome IS NULL AND pol.reason IS NOT NULL;
  ELSE
    SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s WHERE s.scope_key = v_key;
    UPDATE _scn_grp g SET outcome = 'held', reason = 'pressure_sms'
      FROM (
        SELECT r.phone_e164, count(*) AS n FROM public.sms_campaign_recipients r JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
         WHERE r.phone_e164 IN (SELECT y.phone FROM _scn_grp y WHERE y.phone IS NOT NULL)
           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days'
           AND c2.venue_id IS NOT DISTINCT FROM p_s.venue_id
           AND c2.organizer_id IS NOT DISTINCT FROM CASE WHEN p_s.venue_id IS NULL THEN p_s.organizer_user_id END
         GROUP BY r.phone_e164
      ) k
     WHERE k.phone_e164 = g.phone AND g.outcome IS NULL AND k.n >= COALESCE(v_cap, 1);
  END IF;

  -- Démo : rien ne part.
  IF p_demo THEN
    UPDATE _scn_grp g SET outcome = 'would_send' WHERE g.outcome IS NULL;
  END IF;

  -- Yunits : seuls ceux que le solde couvre partent ; les autres attendent.
  IF EXISTS (SELECT 1 FROM _scn_grp WHERE outcome IS NULL) THEN
    v_rate := CASE WHEN v_ch = 'email' THEN GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1))
                   ELSE GREATEST(1, (v_rates->>'intl')::integer) * v_seg END;
    v_room := GREATEST(0, COALESCE(public.crm_yunits_balance(v_key), 0)) / v_rate;
    UPDATE _scn_grp g SET outcome = 'held', reason = 'yunits'
      FROM (SELECT x.id, row_number() OVER (ORDER BY x.window_end, x.email) AS rn FROM _scn_grp x WHERE x.outcome IS NULL) q
     WHERE q.id = g.id AND q.rn > v_room;
  END IF;

  -- Envoi : par la campagne enfant (e-mail) ou une campagne SMS programmée.
  IF v_ch = 'email' AND EXISTS (SELECT 1 FROM _scn_grp WHERE outcome IS NULL) THEN
    SELECT * INTO v_tpl FROM public.email_campaign_templates tp
     WHERE tp.id = (p_node->>'template_id')::uuid
       AND tp.venue_id IS NOT DISTINCT FROM p_s.venue_id AND tp.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id;
    IF v_tpl.id IS NULL THEN
      UPDATE _scn_grp g SET outcome = 'expired', reason = 'no_template' WHERE g.outcome IS NULL;
    END IF;
    FOR v_grp IN SELECT DISTINCT g.msg_event FROM _scn_grp g WHERE g.outcome IS NULL LOOP
      SELECT m.campaign_id INTO v_child FROM public.crm_scenario_messages m
       WHERE m.version_id = p_v.id AND m.node_id = p_node_id AND m.channel = 'email'
         AND m.event_key = COALESCE(v_grp.msg_event, '00000000-0000-0000-0000-000000000000'::uuid)
         AND m.campaign_id IS NOT NULL;
      IF v_child IS NULL THEN
        SELECT COALESCE(NULLIF(e.title, ''), to_char(now(), 'YYYY-MM')) INTO v_label FROM public.events e WHERE e.id = v_grp.msg_event;
        v_blocks := CASE WHEN v_grp.msg_event IS NULL THEN public._email_blocks_without_live(v_tpl.blocks_json)
                         ELSE COALESCE(v_tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, child_kind, total_recipients, created_by, product)
        VALUES
          (p_s.venue_id, p_s.organizer_user_id,
           left(p_s.name || ' · ' || COALESCE(v_label, to_char(now(), 'YYYY-MM')), 80), 'promotional',
           COALESCE(NULLIF(btrim(p_node->>'subject'), ''), NULLIF(v_tpl.subject, ''), v_tpl.name), COALESCE(v_tpl.preheader, ''),
           v_blocks, 2, COALESCE(v_tpl.theme_json, '{}'::jsonb), COALESCE(v_tpl.social_links_json, '{}'::jsonb), v_tpl.logo_url,
           v_grp.msg_event, 'sending', '[]'::jsonb, '{}'::jsonb, true, 'scenario', 0,
           COALESCE(p_s.created_by, v_tpl.created_by, p_s.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = p_s.venue_id)),
           'crm')
        RETURNING id INTO v_child;
        -- Elle est sa propre mère (comme les relances des pages d'inscription) :
        -- hors des listes Campagnes et des bilans d'e-mails, sans accusé « campagne
        -- envoyée » ; ses chiffres vivent dans le rapport du scénario.
        UPDATE public.email_campaigns SET parent_campaign_id = v_child WHERE id = v_child;
        INSERT INTO public.crm_scenario_messages (version_id, node_id, channel, event_key, campaign_id)
        VALUES (p_v.id, p_node_id, 'email', COALESCE(v_grp.msg_event, '00000000-0000-0000-0000-000000000000'::uuid), v_child);
      END IF;
      -- Déjà destinataire de cette campagne (un retour sur la même soirée) : pas deux fois.
      UPDATE _scn_grp g SET outcome = 'expired', reason = 'already_sent'
        FROM public.email_campaign_recipients q
       WHERE q.campaign_id = v_child AND lower(q.email) = g.email AND g.outcome IS NULL
         AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event;
      -- Le débit des Yunits se fait ici (déclencheur des campagnes enfants) ;
      -- une ligne qu'il refuse revient en attente, sa place libérée.
      INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_child, g.email, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
        FROM _scn_grp g
        LEFT JOIN LATERAL (
          SELECT s.first_name, s.last_name, s.unsubscribe_token FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = g.email
             AND s.venue_id IS NOT DISTINCT FROM p_s.venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id
             AND s.product = 'crm'
           LIMIT 1) s ON true
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING;
      UPDATE _scn_grp g SET outcome = 'held', reason = CASE q.error_message WHEN 'paused' THEN 'plan_paused' ELSE 'yunits' END
        FROM public.email_campaign_recipients q
       WHERE q.campaign_id = v_child AND lower(q.email) = g.email AND q.status = 'skipped'
         AND q.error_message IN ('yunits', 'paused') AND g.outcome IS NULL;
      DELETE FROM public.email_campaign_recipients q USING _scn_grp g
       WHERE q.campaign_id = v_child AND lower(q.email) = g.email AND q.status = 'skipped'
         AND q.error_message IN ('yunits', 'paused') AND g.outcome = 'held';
      UPDATE _scn_grp g SET outcome = 'sent', campaign_id = v_child
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event;
      UPDATE public.email_campaigns c
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = (SELECT count(*) FROM public.email_campaign_recipients q WHERE q.campaign_id = c.id)
       WHERE c.id = v_child AND c.status IN ('sent', 'sending', 'draft');
      v_child := NULL;
    END LOOP;
  ELSIF v_ch = 'sms' AND EXISTS (SELECT 1 FROM _scn_grp WHERE outcome IS NULL) THEN
    FOR v_grp IN SELECT DISTINCT g.msg_event FROM _scn_grp g WHERE g.outcome IS NULL LOOP
      INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                        event_id, quiet_hours, estimated_recipients, segments_per_message, estimated_credits)
      VALUES (p_s.venue_id, CASE WHEN p_s.venue_id IS NULL THEN p_s.organizer_user_id END,
              COALESCE(p_s.created_by, p_s.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = p_s.venue_id)),
              left(p_s.name || ' · SMS', 120), p_node->>'body',
              jsonb_build_object('type', 'crm', 'automation', 'scenario', 'scenario_id', p_s.id, 'node', p_node_id),
              'draft', v_grp.msg_event, true, 0, v_seg, 0)
      RETURNING id INTO v_child;
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name, email)
      SELECT DISTINCT ON (g.phone) v_child, g.phone,
             NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), NULLIF(btrim(COALESCE(s.first_name, '')), ''), g.email
        FROM _scn_grp g
        LEFT JOIN LATERAL (SELECT s.first_name, s.last_name FROM public.newsletter_subscriptions s
                            WHERE lower(s.email) = g.email
                              AND s.venue_id IS NOT DISTINCT FROM p_s.venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_s.organizer_user_id
                              AND s.product = 'crm'
                            LIMIT 1) s ON true
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event
       ORDER BY g.phone, g.email
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING;
      UPDATE public.sms_campaigns c SET status = 'scheduled', scheduled_at = now(),
             total_recipients = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = c.id),
             estimated_recipients = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = c.id),
             estimated_credits = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = c.id)
       WHERE c.id = v_child;
      INSERT INTO public.crm_scenario_messages (version_id, node_id, channel, event_key, sms_campaign_id)
      VALUES (p_v.id, p_node_id, 'sms', COALESCE(v_grp.msg_event, '00000000-0000-0000-0000-000000000000'::uuid), v_child);
      UPDATE _scn_grp g SET outcome = 'sent', sms_campaign_id = v_child
       WHERE g.outcome IS NULL AND g.msg_event IS NOT DISTINCT FROM v_grp.msg_event;
      v_child := NULL;
    END LOOP;
  END IF;

  -- Filet : rien ne reste sans issue.
  UPDATE _scn_grp g SET outcome = 'held', reason = 'retry' WHERE g.outcome IS NULL;
  -- Registre de l'étape, puis le suivant.
  UPDATE public.crm_scenario_steps st
     SET status = CASE g.outcome WHEN 'held' THEN 'held' ELSE g.outcome END,
         reason = CASE WHEN g.outcome IN ('held', 'expired') THEN g.reason END,
         campaign_id = COALESCE(g.campaign_id, st.campaign_id), sms_campaign_id = COALESCE(g.sms_campaign_id, st.sms_campaign_id),
         done_at = CASE WHEN g.outcome <> 'held' THEN now() END
    FROM _scn_grp g
   WHERE st.run_id = g.id AND st.node_id = p_node_id AND st.pass = 1 AND g.outcome IS NOT NULL;
  -- Les reportés reviennent : à l'heure dite (espacement), sinon dans une heure.
  UPDATE public.crm_scenario_runs r
     SET due_at = LEAST(COALESCE(g.retry_at, now() + interval '1 hour'), g.window_end + interval '1 minute'), updated_at = now()
    FROM _scn_grp g WHERE r.id = g.id AND g.outcome = 'held';
  UPDATE public.crm_scenario_runs r SET last_message_at = now()
    FROM _scn_grp g WHERE r.id = g.id AND g.outcome IN ('sent', 'would_send');
  -- Journal prévu / réel : contacté pour cette soirée.
  UPDATE public.crm_prediction_people pp SET contacted_at = COALESCE(pp.contacted_at, now())
    FROM _scn_grp g
   WHERE g.outcome = 'sent' AND g.msg_event IS NOT NULL
     AND pp.scope_key = v_key AND pp.event_id = g.msg_event AND pp.email = g.email;
  SELECT count(*) INTO v_sent FROM _scn_grp WHERE outcome IN ('sent', 'would_send');
  UPDATE _scn_grp g SET go_next = true WHERE g.outcome IN ('sent', 'would_send', 'holdout', 'expired');
  RETURN jsonb_build_object('sent', v_sent);
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_scenario_pick_events(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
 RETURNS TABLE(email text, event_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT public.crm_scope_key(p_venue_id, p_organizer_user_id) AS k,
           COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2) AS res
  ), upcoming AS (
    SELECT e.id, e.start_at,
           's:' || lower(public._crm_night_series(e.title)) AS series,
           ARRAY(SELECT DISTINCT 'g:' || lower(btrim(g))
                   FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
                  WHERE g IS NOT NULL AND btrim(g) <> '') AS genres,
           ARRAY(SELECT DISTINCT 'a:' || z.k
                   FROM public.external_events x
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) a
                   CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z
                  WHERE x.event_id = e.id AND z.k IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st, sc
                                     WHERE st.scope_key = sc.k AND st.artist_key = z.k AND st.share > sc.res)) AS arts
      FROM public.events e
     WHERE e.status = 'active' AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours' AND e.start_at <= now() + interval '35 days'
       AND ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
  ), people AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) x WHERE x IS NOT NULL
  )
  SELECT pe.em, pick.id
    FROM people pe
    LEFT JOIN sc ON true
    LEFT JOIN public.crm_person_profile pp ON pp.scope_key = sc.k AND pp.email = pe.em
    CROSS JOIN LATERAL (
      SELECT u.id FROM upcoming u
       ORDER BY (CASE WHEN COALESCE(pp.tags, '{}') && u.arts THEN 4 ELSE 0 END)
                + (CASE WHEN u.series = ANY (COALESCE(pp.tags, '{}')) THEN 4 ELSE 0 END)
                + 2 * LEAST(2, (SELECT count(*) FROM unnest(u.genres) g WHERE g = ANY (COALESCE(pp.tags, '{}'))))::integer DESC,
                u.start_at ASC
       LIMIT 1
    ) pick;
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_ensure_group(p_id uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_list uuid;
  v_email uuid;
  v_name text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p.contact_import_id IS NOT NULL THEN RETURN p.contact_import_id; END IF;
  v_name := left('Page · ' || p.title, 60);
  INSERT INTO public.email_list_imports (venue_id, organizer_user_id, product, filename, consent_source, consent_details, attested_by, list_name)
  VALUES (p.venue_id, p.organizer_user_id, 'crm', 'signup_page:' || p.id, 'website_form',
          'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée et adresse confirmée par lien', p_actor, v_name)
  RETURNING id INTO v_email;
  INSERT INTO public.contact_list_imports (venue_id, organizer_user_id, product, email_import_id, list_name, filename, consent_source, consent_details, channels, attested_by)
  VALUES (p.venue_id, p.organizer_user_id, 'crm', v_email, v_name, 'signup_page:' || p.id, 'website_form',
          'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée (adresse confirmée par lien, téléphone saisi par le fan)', '{"sms": false, "email": true}'::jsonb, p_actor)
  RETURNING id INTO v_list;
  UPDATE public.crm_signup_pages SET contact_import_id = v_list, email_import_id = v_email WHERE id = p.id;
  RETURN v_list;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_signup_known(p crm_signup_pages, p_email text, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_email IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.external_tickets t
                     WHERE t.buyer_email = p_email AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                       AND ((p.venue_id IS NOT NULL AND t.venue_id = p.venue_id) OR (p.organizer_user_id IS NOT NULL AND t.organizer_user_id = p.organizer_user_id)))
         OR EXISTS (SELECT 1 FROM public.imported_contacts c
                     WHERE c.email = p_email AND c.venue_id IS NOT DISTINCT FROM p.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
                       AND c.list_import_id IN (SELECT li.id FROM public.contact_list_imports li WHERE li.product = 'crm'))
         OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions n
                     WHERE lower(n.email) = p_email AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id AND n.product = 'crm')
         OR EXISTS (SELECT 1 FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
                     WHERE lower(x.email) = p_email AND pp.id <> p.id
                       AND pp.venue_id IS NOT DISTINCT FROM p.venue_id AND pp.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)))
      OR (p_phone IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.imported_contacts c
                     WHERE c.phone_e164 = p_phone AND c.venue_id IS NOT DISTINCT FROM p.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
                       AND c.list_import_id IN (SELECT li.id FROM public.contact_list_imports li WHERE li.product = 'crm'))
         OR EXISTS (SELECT 1 FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
                     WHERE x.phone = p_phone AND pp.id <> p.id
                       AND pp.venue_id IS NOT DISTINCT FROM p.venue_id AND pp.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)));
$function$;

CREATE OR REPLACE FUNCTION public._crm_source_label(p_venue_id text, p_organizer_user_id uuid, p_src text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN x.s IS NULL THEN jsonb_build_object('src', NULL, 'kind', 'of') ELSE jsonb_build_object(
    'src', x.s,
    'kind', public._crm_ticket_source(jsonb_build_object('utm_source', x.s)),
    'label', COALESCE(l.label, (
      SELECT ec.name FROM public.email_campaigns ec
       WHERE x.s LIKE 'yuno-m-%' AND length(x.s) >= 15
         AND left(replace(ec.id::text, '-', ''), 8) = substr(x.s, 8, 8)
         AND ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND public.crm_campaign_is_crm(ec.id)
       ORDER BY ec.created_at DESC LIMIT 1)),
    'platform', l.utm_source, 'placement', l.utm_medium, 'event_id', l.event_id) END
  FROM (SELECT NULLIF(lower(btrim(COALESCE(p_src, ''))), '') AS s) x
  LEFT JOIN LATERAL (
    SELECT tl.label, tl.utm_source, tl.utm_medium, tl.event_id FROM public.tracked_links tl
     WHERE x.s LIKE 'yuno-%' AND x.s !~ '^yuno-[msd]-' AND tl.code = substr(x.s, 6)
       AND ((p_venue_id IS NOT NULL AND tl.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND tl.organizer_user_id = p_organizer_user_id))
     LIMIT 1) l ON true;
$function$;

CREATE OR REPLACE FUNCTION public._email_send_policy_many(p_emails text[], p_kind text)
 RETURNS TABLE(email text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  cfg AS (
    SELECT k.tier,
           CASE k.tier WHEN 'campaign' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END AS cap24,
           CASE k.tier WHEN 'campaign' THEN 8 WHEN 'urgent' THEN 5 ELSE 3 END AS cap7
      FROM (SELECT CASE
              WHEN p_kind IN ('campaign', 'resend') THEN 'campaign'
              WHEN p_kind IN ('abandoned_checkout', 'upsell', 'tier_closing', 'click_no_buy') THEN 'urgent'
              ELSE 'automation' END AS tier) k
  ),
  sends AS (
    SELECT lower(r.email) AS em, r.sent_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'sent' AND r.sent_at > now() - interval '90 days'
       AND COALESCE(c.type, 'promotional') = 'promotional'
       AND lower(r.email) IN (SELECT em FROM e)
    UNION ALL
    SELECT lower(l.email), l.sent_at
      FROM public.marketing_email_log l
     WHERE l.sent_at > now() - interval '90 days'
       AND lower(l.email) IN (SELECT em FROM e)
  ),
  agg AS (
    SELECT s.em,
           count(*) FILTER (WHERE s.sent_at > now() - interval '24 hours') AS n24,
           count(*) FILTER (WHERE s.sent_at > now() - interval '7 days') AS n7d,
           count(*) AS sent90
      FROM sends s
     GROUP BY s.em
  ),
  eng AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  oo AS (
    SELECT lower(s.email) AS em, count(DISTINCT COALESCE(s.venue_id, s.organizer_user_id::text, 'platform')) AS n
      FROM public.newsletter_subscriptions s
     WHERE s.opted_out_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
     GROUP BY lower(s.email)
  ),
  sup AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.email_suppressions s
     WHERE lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE
           WHEN position('@' in e.em) <= 1 THEN 'suppressed'
           WHEN sup.em IS NOT NULL THEN 'suppressed'
           WHEN COALESCE(a.sent90, 0) >= 8 AND eng.em IS NULL THEN 'fatigue'
           WHEN cfg.tier <> 'campaign' AND COALESCE(oo.n, 0) >= 2 THEN 'averse'
           WHEN COALESCE(a.n24, 0) >= cfg.cap24 THEN 'pressure_24h'
           WHEN COALESCE(a.n7d, 0) >= cfg.cap7 THEN 'pressure_7d'
         END
    FROM e
    CROSS JOIN cfg
    LEFT JOIN agg a ON a.em = e.em
    LEFT JOIN eng ON eng.em = e.em
    LEFT JOIN oo ON oo.em = e.em
    LEFT JOIN sup ON sup.em = e.em;
$function$;

CREATE OR REPLACE FUNCTION public._enqueue_campaign_recipients_core(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_queued integer := 0;
  v_suppressed integer := 0;
  v_policy integer := 0;
  v_total integer := 0;
  v_sent integer := 0;
  v_kind text;
  v_prod text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;

  -- Un email de service (informational) n'est pas du marketing : pas de règle
  -- de pression, seule la liste de suppression s'applique.
  SELECT CASE WHEN COALESCE(c.type, 'promotional') = 'promotional' THEN 'campaign' ELSE NULL END
    INTO v_kind FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  v_prod := CASE WHEN public.crm_campaign_is_crm(p_campaign_id) THEN 'crm' END;

  WITH aud AS (
    SELECT DISTINCT ON (lower(a.email))
           lower(a.email) AS addr, a.first_name AS fname, a.last_name AS lname,
           a.unsubscribe_token AS tok
      FROM public.resolve_campaign_audience(p_campaign_id) a
     WHERE a.email IS NOT NULL AND position('@' in a.email) > 1
     ORDER BY lower(a.email)
  ), rules AS (
    -- Les règles Yuno en UNE passe sur toute l'audience : ligne à ligne,
    -- elles coûtaient ~1 ms par adresse (17 s pour 12 000, au-delà du
    -- plafond de 8 s de l'API : la campagne ne partait pas).
    SELECT p.email, p.reason
      FROM public._email_send_policy_many(ARRAY(SELECT addr FROM aud), COALESCE(v_kind, 'campaign')) p
     WHERE v_kind IS NOT NULL
  ), flagged AS (
    SELECT a.addr, a.fname, a.lname, a.tok,
           (sx.em IS NOT NULL) AS supp,
           CASE WHEN v_kind IS NULL THEN NULL ELSE p.reason END AS pol
      FROM aud a
      LEFT JOIN rules p ON p.email = a.addr
      -- Liste de suppression lue en une jointure (= is_email_suppressed).
      LEFT JOIN (SELECT DISTINCT lower(s.email) AS em FROM public.email_suppressions s
                  WHERE lower(s.email) IN (SELECT addr FROM aud)) sx ON sx.em = a.addr
  ), ins AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, unsubscribe_token, status)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, f.tok, 'pending'
      FROM flagged f WHERE NOT f.supp AND (f.pol IS NULL OR f.pol = 'suppressed')
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  ), sup AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, status, error_message)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, 'suppressed',
           'Adresse sur la liste de suppression (bounce ou plainte)'
      FROM flagged f WHERE f.supp
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  ), pol AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, status, error_message)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, 'skipped', 'policy:' || f.pol
      FROM flagged f WHERE NOT f.supp AND f.pol IS NOT NULL AND f.pol <> 'suppressed'
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins),
         (SELECT count(*) FROM flagged WHERE supp),
         (SELECT count(*) FROM flagged WHERE NOT supp AND pol IS NOT NULL AND pol <> 'suppressed')
    INTO v_queued, v_suppressed, v_policy;

  UPDATE public.email_campaign_recipients r
     SET first_name = COALESCE(r.first_name, ns.first_name),
         last_name  = COALESCE(r.last_name,  ns.last_name)
    FROM public.email_campaigns c
    JOIN public.newsletter_subscriptions ns
      ON public.marketing_scope_match(ns.venue_id, ns.organizer_user_id,
                                      c.venue_id, c.organizer_user_id)
     AND ns.product IS NOT DISTINCT FROM v_prod
   WHERE c.id = p_campaign_id
     AND r.campaign_id = p_campaign_id
     AND lower(ns.email) = lower(r.email)
     AND (r.first_name IS NULL OR r.last_name IS NULL)
     AND (ns.first_name IS NOT NULL OR ns.last_name IS NOT NULL);

  SELECT count(*), count(*) FILTER (WHERE status = 'sent')
    INTO v_total, v_sent
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND status NOT IN ('suppressed', 'skipped');

  UPDATE public.email_campaigns
     SET total_recipients = v_total,
         suppressed_count = v_suppressed,
         policy_skipped_count = v_policy,
         recipients_count = v_sent,
         send_started_at = COALESCE(send_started_at, now()),
         status = CASE WHEN v_total > v_sent THEN 'sending' ELSE status END,
         paused_reason = NULL,
         error_message = NULL
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'queued', v_queued, 'suppressed', v_suppressed, 'policy_skipped', v_policy,
    'total', v_total, 'already_sent', v_sent, 'remaining', v_total - v_sent
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._enqueue_crm_sms_recipients(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_scope  text;
  v_pred   text;
  v_days   integer;
  v_excl   boolean;
  v_cap    integer;
  v_total  integer;
  v_pending integer;
  v_pct    integer;
  v_held   integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION '_enqueue_crm_sms_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;
  v_scope := public.crm_scope_key(c.venue_id, c.organizer_id);
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le compte est en pause, aucun envoi ne part.';
  END IF;

  v_pred := public._crm_audience_pred(c.segment_filters->'audiences', c.venue_id, c.organizer_id);
  IF v_pred IS NOT NULL THEN
    v_days := CASE WHEN (c.segment_filters->>'recent_days') ~ '^[0-9]+$'
                    AND (c.segment_filters->>'recent_days')::int BETWEEN 1 AND 90
                   THEN (c.segment_filters->>'recent_days')::int END;
    v_excl := COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false) AND c.event_id IS NOT NULL;
    SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s WHERE s.scope_key = v_scope;
    v_cap := COALESCE(v_cap, 1);
    PERFORM public._crm_people_build(c.venue_id, c.organizer_id, NULL);

    EXECUTE format($q$
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name, lang, email)
      SELECT %6$L::uuid, s.phone,
             NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
             NULLIF(btrim(s.first_name), ''), 'fr', s.email
        FROM (
          SELECT DISTINCT ON (p.phone) p.phone, p.first_name, p.last_name, p.email, p.events
            FROM _cp p
           WHERE p.phone_ok AND p.phone ~ '^\+[1-9][0-9]{6,14}$' AND (%3$s)
           ORDER BY p.phone, p.first_name NULLS LAST
        ) s
       WHERE NOT (%7$L::boolean AND %4$L::uuid = ANY (s.events))
         AND NOT (%5$L::integer IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.sms_campaign_recipients r
                          JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
                         WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                           AND c2.id <> %6$L::uuid AND r.phone_e164 = s.phone
                           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - make_interval(days => %5$L::integer)
                           AND c2.product = 'crm')
                OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                             JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                            WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                              AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                              AND lower(r.email) = s.email
                              AND public.crm_campaign_is_crm(c2.id))))
         AND (SELECT count(*) FROM public.sms_campaign_recipients r
                JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
               WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                 AND c2.id <> %6$L::uuid AND r.phone_e164 = s.phone
                 AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days') < %8$L::integer
         AND NOT EXISTS (SELECT 1 FROM public.sms_stop_list x WHERE x.phone_e164 = s.phone)
         AND public.sms_tariff_zone(s.phone) <> 'blocked'
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING
    $q$, c.venue_id, c.organizer_id, v_pred, c.event_id, v_days, p_campaign_id, v_excl, v_cap);

    -- « 10 % non contactés, pour mesurer l'effet réel » (20261013120000).
    v_pct := public.crm_holdout_pct(v_scope);
    IF c.event_id IS NOT NULL AND v_pct > 0 AND public._crm_audience_is_targeting(c.segment_filters->'audiences') THEN
      UPDATE public.sms_campaign_recipients r
         SET status = 'skipped', error_code = 'holdout', error_message = 'holdout'
       WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
         AND public._crm_holdout_pick(p_campaign_id::text, COALESCE(r.email, r.phone_e164), v_pct);
      GET DIAGNOSTICS v_held = ROW_COUNT;
    END IF;
  END IF;

  SELECT count(*) FILTER (WHERE status <> 'skipped'), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;
  UPDATE public.sms_campaigns
     SET total_recipients = v_total, estimated_recipients = v_total,
         holdout_count = (SELECT count(*) FROM public.sms_campaign_recipients r
                           WHERE r.campaign_id = p_campaign_id AND r.status = 'skipped' AND r.error_code = 'holdout')
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('total', v_total, 'pending', v_pending, 'crm', true, 'holdout', v_held);
END;
$function$;

CREATE OR REPLACE FUNCTION public._first_return_candidates(p_venue_id text, p_organizer_user_id uuid, p_since timestamp with time zone)
 RETURNS TABLE(em text, first_end timestamp with time zone, due_at timestamp with time zone, delay_days integer, pick_event_id uuid, pick_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT public.crm_scope_key(p_venue_id, p_organizer_user_id) AS k,
           public._first_return_delay_days(p_venue_id, p_organizer_user_id) AS d,
           COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2) AS res
  ),
  -- MATERIALIZED : la fenêtre de dates d'abord (une centaine de personnes),
  -- le test « a déjà une place » ensuite. Sans lui, le planificateur testait
  -- chaque client venu une fois contre chaque soirée à venir avant de filtrer
  -- les dates : 126 s pour l'écran Automatisations d'un compte de 12 000 contacts.
  once AS MATERIALIZED (
    SELECT p.email AS em, p.tags,
           COALESCE(e.end_at, e.start_at + interval '6 hours') AS first_end,
           lower(public._crm_night_series(e.title)) AS series,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           sc.d
      FROM sc
      JOIN public.crm_person_profile p ON p.scope_key = sc.k
      JOIN public.events e ON e.id = NULLIF(p.first_facts->>'event_id', '')::uuid
     WHERE p.nights = 1
       AND NOT ('pass' = ANY (p.tags))
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(days => sc.d) <= now()
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(days => sc.d) > now() - interval '7 days'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(days => sc.d) >= COALESCE(p_since, '-infinity'::timestamptz)
  ),
  upcoming AS (
    SELECT e.id, e.start_at,
           lower(public._crm_night_series(e.title)) AS series,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           ARRAY(SELECT DISTINCT 'g:' || lower(btrim(g))
                   FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
                  WHERE g IS NOT NULL AND btrim(g) <> '') AS genres,
           ARRAY(SELECT DISTINCT 'a:' || z.k
                   FROM public.external_events x
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) a
                   CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z
                  WHERE x.event_id = e.id AND z.k IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st, sc
                                     WHERE st.scope_key = sc.k AND st.artist_key = z.k AND st.share > sc.res)) AS arts
      FROM public.events e
     WHERE e.status = 'active' AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours'
       AND e.start_at <= now() + interval '35 days'
       AND ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
  )
  SELECT o.em, o.first_end, o.first_end + make_interval(days => o.d), o.d, pick.id, pick.reason
    FROM once o
    LEFT JOIN LATERAL (
      SELECT u.id,
             CASE WHEN u.artist_hit THEN 'artist' WHEN u.series_hit THEN 'series' WHEN u.genre_hits > 0 THEN 'genre'
                  WHEN u.dow_hit THEN 'weekday' ELSE 'next' END AS reason
        FROM (
          SELECT up.id, up.start_at,
                 (up.series IS NOT NULL AND up.series = o.series) AS series_hit,
                 (o.tags && up.arts) AS artist_hit,
                 (SELECT count(*) FROM unnest(up.genres) g WHERE g = ANY (o.tags))::integer AS genre_hits,
                 (up.dow = o.dow) AS dow_hit
            FROM upcoming up
        ) u
       ORDER BY (CASE WHEN u.artist_hit THEN 4 ELSE 0 END) + (CASE WHEN u.series_hit THEN 4 ELSE 0 END)
                + 2 * LEAST(2, u.genre_hits) + (CASE WHEN u.dow_hit THEN 1 ELSE 0 END) DESC,
                u.start_at ASC
       LIMIT 1
    ) pick ON true
   -- Il revient déjà : une place pour une soirée à venir de la portée.
   WHERE NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.start_at > now() AND e.cancelled_at IS NULL AND e.external_source IS NOT NULL
        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        AND public._email_event_holder(e.id, o.em)
   );
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_audience(p_id text, p_product text, p_venue_id text, p_organizer_user_id uuid, p_lang text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id   text := lower(btrim(coalesce(p_id, '')));
  v_i    integer := CASE WHEN p_lang = 'en' THEN 1 WHEN p_lang = 'es' THEN 3 ELSE 2 END;
  v_uuid uuid;
  v_name text;
  v_def  jsonb;
  v_lbl  text[];
BEGIN
  IF p_product = 'crm' THEN
    IF v_id = 'all' THEN
      RETURN (SELECT jsonb_agg(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', k), 'label', lbl[v_i]) ORDER BY o)
                FROM (VALUES (1, 'hab', ARRAY['Regulars', 'Habitués', 'Habituales']),
                             (2, 'occ', ARRAY['Occasional', 'Occasionnels', 'Ocasionales']),
                             (3, 'nou', ARRAY['New', 'Nouveaux', 'Nuevos']),
                             (4, 'end', ARRAY['Dormant', 'Endormis', 'Dormidos']),
                             (5, 'none', ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'])) x(o, k, lbl));
    END IF;
    IF v_id ~ '^lifecycle:(hab|occ|nou|end|none)$' THEN
      v_lbl := CASE split_part(v_id, ':', 2)
        WHEN 'hab' THEN ARRAY['Regulars', 'Habitués', 'Habituales']
        WHEN 'occ' THEN ARRAY['Occasional', 'Occasionnels', 'Ocasionales']
        WHEN 'nou' THEN ARRAY['New', 'Nouveaux', 'Nuevos']
        WHEN 'end' THEN ARRAY['Dormant', 'Endormis', 'Dormidos']
        ELSE ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'] END;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', split_part(v_id, ':', 2)), 'label', v_lbl[v_i]));
    END IF;
    IF v_id ~ '^segment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uuid := split_part(v_id, ':', 2)::uuid;
      SELECT s.name INTO v_name FROM public.crm_segments s
       WHERE s.id = v_uuid
         AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id));
      IF NOT FOUND THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'segmentId', v_uuid, 'label', v_name));
    END IF;
    -- « Qui cibler » d'une soirée (plan de soirée, 20261016155000) : la soirée
    -- doit être une soirée miroir du compte, encore à venir.
    IF v_id ~ '^target:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(likely|concept|lineup|genre|early|last_minute|once_local)$' THEN
      v_uuid := split_part(v_id, ':', 2)::uuid;
      SELECT e.title INTO v_name FROM public.events e
       WHERE e.id = v_uuid AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
         AND COALESCE(e.end_at, e.start_at + interval '6 hours') > now()
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));
      IF NOT FOUND THEN RETURN NULL; END IF;
      v_lbl := CASE split_part(v_id, ':', 3)
        WHEN 'likely' THEN ARRAY['Most likely to come', 'Les plus probables', 'Los más probables']
        WHEN 'concept' THEN ARRAY['Concept regulars without a ticket', 'Fidèles du concept sans place', 'Fieles del concepto sin entrada']
        WHEN 'lineup' THEN ARRAY['Saw an artist of the line-up', 'Ont vu un artiste du line-up', 'Vieron a un artista del line-up']
        WHEN 'genre' THEN ARRAY['Their most attended genre', 'Leur genre le plus fréquenté', 'Su género más frecuentado']
        WHEN 'early' THEN ARRAY['Buy early', 'Achètent tôt', 'Compran pronto']
        WHEN 'last_minute' THEN ARRAY['Buy at the last minute', 'Achètent à la dernière minute', 'Compran en el último momento']
        ELSE ARRAY['Came once, live nearby', 'Venus une fois, habitent près', 'Vinieron una vez, viven cerca'] END;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm',
        'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('ntgt', jsonb_build_object('e', v_uuid, 'a', split_part(v_id, ':', 3)))),
        'label', left(v_lbl[v_i] || ' · ' || v_name, 80)));
    END IF;
    IF v_id ~ '^preset:' THEN
      SELECT d, l INTO v_def, v_lbl FROM (VALUES
        ('preset:vip', '{"seg":"all","f":{"sp":"200+"}}'::jsonb, ARRAY['Big spenders', 'Gros dépensiers', 'Grandes gastadores']),
        ('preset:loyal', '{"seg":"all","f":{"nb_min":4}}'::jsonb, ARRAY['Loyal customers (4 nights or more)', 'Fidèles (4 soirées ou plus)', 'Fieles (4 fiestas o más)']),
        ('preset:buyers', '{"seg":"all","f":{"paid_min":1}}'::jsonb, ARRAY['Ticket buyers', 'Acheteurs de billets', 'Compradores de entradas']),
        ('preset:recent', '{"seg":"all","f":{"last_lt_days":90}}'::jsonb, ARRAY['Came in the last 3 months', 'Venus ces 3 derniers mois', 'Vinieron en los últimos 3 meses']),
        ('preset:lapsed', '{"seg":"all","f":{"last_gt_days":90,"last_lt_days":365}}'::jsonb, ARRAY['To reactivate (3 to 12 months)', 'À réactiver (3 à 12 mois)', 'Por reactivar (3 a 12 meses)']),
        ('preset:has_upcoming', '{"seg":"all","f":{"up":"yes"}}'::jsonb, ARRAY['Already have their place', 'Ont déjà leur place', 'Ya tienen su entrada']),
        ('preset:no_upcoming', '{"seg":"all","f":{"up":"no"}}'::jsonb, ARRAY['No place yet for what’s next', 'Pas encore de place pour la suite', 'Sin entrada aún para lo próximo']),
        ('preset:clickers', '{"seg":"all","f":{"click_lt_days":90}}'::jsonb, ARRAY['Clicked in the last 3 months', 'Ont cliqué ces 3 derniers mois', 'Hicieron clic en los últimos 3 meses']),
        ('preset:gl_loyal', '{"seg":"all","f":{"gl":"loyal"}}'::jsonb, ARRAY['Guest list regulars', 'Habitués de la guest list', 'Habituales de la lista de invitados'])
      ) x(k, d, l) WHERE x.k = v_id;
      IF v_def IS NULL THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', v_def, 'label', v_lbl[v_i]));
    END IF;
    RETURN NULL;
  END IF;

  -- Billetterie (Suite) : audiences v2 du moteur d'envoi (resolve_campaign_audience).
  IF v_id IN ('all', 'kind:all_subscribers') THEN RETURN jsonb_build_array(jsonb_build_object('kind', 'all_subscribers')); END IF;
  IF v_id ~ '^kind:(vip|big_spenders|regulars|new_customers|dormant)$' THEN
    RETURN jsonb_build_array(jsonb_build_object('kind', split_part(v_id, ':', 2)));
  END IF;
  IF v_id ~ '^(segment|contact_segment|import):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := split_part(v_id, ':', 2)::uuid;
    IF v_id LIKE 'segment:%' THEN
      IF p_venue_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.venue_segments s WHERE s.id = v_uuid AND s.venue_id = p_venue_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'segment', 'segmentId', v_uuid));
    ELSIF v_id LIKE 'contact_segment:%' THEN
      IF NOT EXISTS (SELECT 1 FROM public.contact_segments s WHERE s.id = v_uuid
                      AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'contact_segment', 'segmentId', v_uuid));
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.email_list_imports i WHERE i.id = v_uuid AND i.superseded_at IS NULL AND i.product IS NULL
                      AND i.venue_id IS NOT DISTINCT FROM p_venue_id AND i.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'import', 'importId', v_uuid));
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_product);
  v_product  text;
  gate       record;
  v_ids      uuid[];
  v_event    uuid;
  v          jsonb;
  v_aud      jsonb := '[]'::jsonb;
  v_n        integer;
  v_all      integer := 0;
  r          record;
  v_lang     text;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_product = 'crm' THEN 'crm' ELSE 'suite' END);
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;
  v_lang := coalesce(v_lang, 'fr');

  CASE p_tool
  -- ── Kit de design ─────────────────────────────────────────────────────────
  WHEN 'get_email_design_kit' THEN
    v_ids := public._mcp_email_scope_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'product', v_product,
      'products_available', to_jsonb(v_products),
      'can_create_drafts', public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product),
      'language_hint', v_lang,
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', vv.name, 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', op.display_name, 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'sender', (SELECT jsonb_strip_nulls(jsonb_build_object('name', cs.sender_name, 'postal_address', cs.postal_address,
                          'quiet_hours', cs.quiet_hours))
                   FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org)),
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name, 'status', x.status,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark', 'radius', x.theme_json->'radius')))
            FROM (SELECT ec.name, ec.status, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids)
                     AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                     AND (v_product = 'crm' OR e.external_source IS NULL)
                     AND (e.is_active OR e.external_source IS NOT NULL)
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._mcp_email_event_facts(v_event) END,
      'recent_drafts', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('draft_id', x.id, 'name', x.name, 'subject', nullif(x.subject, '—'),
                   'product', coalesce(x.product, 'suite'), 'prepared_by', x.ai_author, 'edited', to_char(x.updated_at, 'YYYY-MM-DD HH24:MI'))))
            FROM (SELECT ec.* FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.status = 'draft' AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                   ORDER BY ec.updated_at DESC LIMIT 8) x), '[]'::jsonb));

  -- ── Audiences ─────────────────────────────────────────────────────────────
  WHEN 'list_email_audiences' THEN
    IF v_product = 'crm' THEN
      v := public.crm_email_send_options(v_venue, v_org);   -- construit _cso (joignables)
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'auto', '[]'::jsonb)) x LOOP
        v_all := v_all + coalesce((r.x->>'reach')::integer, 0);
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'lifecycle:' || (r.x->>'key'),
          'label', (public._mcp_email_audience('lifecycle:' || (r.x->>'key'), 'crm', v_venue, v_org, v_lang)->0->>'label'),
          'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', CASE r.x->>'key'
            WHEN 'hab' THEN 'Regulars: came to several nights recently (the account''s regular rule).'
            WHEN 'occ' THEN 'Occasional: came, but not often enough to be a regular.'
            WHEN 'nou' THEN 'New: first night recently, or a ticket for an upcoming night and no night yet.'
            WHEN 'end' THEN 'Dormant: used to come, has not come back for several months.'
            ELSE 'Known contacts who never came to a night (imports, signups).' END)));
      END LOOP;
      v_aud := jsonb_build_array(jsonb_build_object('id', 'all',
                 'label', CASE v_lang WHEN 'en' THEN 'Whole base' WHEN 'es' THEN 'Toda la base' ELSE 'Toute la base' END,
                 'reachable', v_all, 'rule', 'Every contact who accepted your emails (all lifecycle groups). Use it for a global announcement.'))
               || v_aud;
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'saved', '[]'::jsonb)) x LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'segment:' || (r.x->>'id'), 'label', r.x->>'name', 'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', coalesce(nullif(r.x->>'description', ''), 'Saved segment of the account.'))));
      END LOOP;
      FOR r IN SELECT * FROM (VALUES
          ('preset:vip', 'Spent 200 € or more in total.'),
          ('preset:loyal', 'Came to 4 nights or more.'),
          ('preset:buyers', 'Bought at least one paid ticket.'),
          ('preset:recent', 'Came in the last 3 months.'),
          ('preset:lapsed', 'Last night 3 to 12 months ago.'),
          ('preset:has_upcoming', 'Already have a ticket or an invitation for an upcoming night.'),
          ('preset:no_upcoming', 'No ticket yet for an upcoming night.'),
          ('preset:clickers', 'Clicked an email link in the last 3 months.'),
          ('preset:gl_loyal', 'Came on the guest list 3 nights or more, never paid.')) p(k, rule)
      LOOP
        BEGIN
          EXECUTE format('SELECT count(*)::integer FROM _cso p WHERE (%s)',
                         public._crm_filter_sql(public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->'def', 'p'))
            INTO v_n;
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', r.k, 'label', public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->>'label',
          'reachable', v_n, 'rule', r.rule, 'kind', 'yuno_preset')));
      END LOOP;
      RETURN jsonb_build_object('ok', true, 'product', 'crm', 'audiences', v_aud,
        'reachable_means', 'Contacts with an email who accepted your emails (newsletter opt-in) and are not suppressed. Yuno sending rules may still protect some at send time.',
        'exclusions', jsonb_build_object(
          'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night (recommended for a last call, not for a first announcement).',
          'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));
    END IF;

    -- Billetterie
    IF v_venue IS NOT NULL THEN
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', r.kind, NULL, NULL);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', v_n, 'rule', r.rule)));
      END LOOP;
      FOR r IN SELECT s.id, s.name FROM public.venue_segments s WHERE s.venue_id = v_venue ORDER BY s.created_at DESC LIMIT 20 LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', 'custom_segment', NULL, r.id);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'segment:' || r.id, 'label', r.name, 'reachable', v_n, 'rule', 'Saved customer segment.')));
      END LOOP;
    ELSE
      BEGIN
        v := public.count_organizer_audience_kinds(v_org, NULL);
      EXCEPTION WHEN others THEN v := '{}'::jsonb;
      END;
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', (v->>r.kind)::integer, 'rule', r.rule)));
      END LOOP;
    END IF;
    FOR r IN SELECT s.id, s.name, s.description FROM public.contact_segments s
              WHERE s.venue_id IS NOT DISTINCT FROM v_venue AND s.organizer_user_id IS NOT DISTINCT FROM v_org
              ORDER BY s.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'contact_segment:' || r.id, 'label', r.name,
                 'rule', coalesce(nullif(r.description, ''), 'Segment of the contact base (imports and Yuno customers).'))));
    END LOOP;
    FOR r IN SELECT i.id, coalesce(nullif(i.list_name, ''), i.filename) AS name, i.inserted_count FROM public.email_list_imports i
              WHERE i.venue_id IS NOT DISTINCT FROM v_venue AND i.organizer_user_id IS NOT DISTINCT FROM v_org AND i.superseded_at IS NULL
                AND i.product IS NULL
              ORDER BY i.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'import:' || r.id, 'label', r.name,
                 'imported', r.inserted_count, 'rule', 'Imported contact list (only its opted-in contacts receive).')));
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'product', 'suite', 'audiences', v_aud,
      'reachable_means', 'Contacts who accepted your emails (newsletter opt-in) and are not suppressed.',
      'exclusions', jsonb_build_object(
        'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night.',
        'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));

  -- ── Relire un brouillon ou une campagne ───────────────────────────────────
  WHEN 'get_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT jsonb_build_object(
        'ok', true, 'draft_id', ec.id, 'name', ec.name, 'status', ec.status,
        'product', coalesce(ec.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(ec.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END),
        'subject', nullif(ec.subject, '—'), 'subject_b', ec.subject_b, 'ab_test', ec.ab_enabled, 'preheader', ec.preheader,
        'language', coalesce(ec.language, 'fr'), 'prepared_by', ec.ai_author,
        'event', CASE WHEN ec.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = ec.event_id) END,
        'audience', ec.audiences_json, 'exclusions', ec.exclusions_json,
        'theme', ec.theme_json, 'social_links', ec.social_links_json,
        'blocks_version', ec.blocks_version, 'sections', ec.blocks_json,
        'version', public._mcp_draft_version(ec.updated_at), 'edited_at', ec.updated_at, 'ai_edited_at', ec.ai_updated_at,
        'sent_at', ec.sent_at, 'recipients', CASE WHEN ec.status IN ('sent', 'sending') THEN ec.recipients_count END,
        'venue_id', ec.venue_id, 'organizer_user_id', ec.organizer_user_id)
      INTO v
      FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    RETURN v;

  -- ── Images ajoutées par l'IA (emplacements d'envoi et images prêtes) ─────
  WHEN 'list_email_images' THEN
    RETURN jsonb_build_object('ok', true, 'images', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'image_id', i.id, 'name', i.name,
               'status', CASE WHEN i.status = 'waiting' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
               'url', i.url, 'width', i.width, 'height', i.height, 'source', i.source,
               'upload_page', CASE WHEN i.status = 'waiting' AND i.expires_at > now() THEN 'https://yunoapp.eu/ai/image/' || i.code END,
               'added', to_char(i.created_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI')))
             ORDER BY i.created_at DESC)
        FROM (SELECT m.* FROM public.mcp_email_images m
               WHERE m.venue_id IS NOT DISTINCT FROM v_venue AND m.organizer_user_id IS NOT DISTINCT FROM v_org
                 AND m.created_at > now() - interval '30 days'
                 AND (m.status = 'ready' OR (m.status = 'waiting' AND m.expires_at > now() - interval '1 hour'))
               ORDER BY m.created_at DESC LIMIT 20) i), '[]'::jsonb));

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_email_write(p_tool text, p_kind text, p_space_id text, p_space_product text, p_args jsonb, p_uid uuid, p_grant uuid, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_space_product);
  v_product  text;
  v_lang     text;
  v_ids      uuid[];
  v_event    uuid;
  v_has_ev   boolean := p_args ? 'event';
  v_aud      jsonb;
  v_one      jsonb;
  v_id       text;
  v_blocks   jsonb;
  v_theme    jsonb;
  v_social   jsonb;
  v_logo     text;
  v_excl     jsonb;
  v_quiet    boolean := true;
  v_waves    boolean := false;
  v_audtype  text;
  v_segid    uuid;
  c          public.email_campaigns%ROWTYPE;
  v_new      uuid;
  v_net      integer;
  v_prev     jsonb;
BEGIN
  -- ── Le brouillon visé (modification) ou le produit choisi (création) ──
  IF p_tool = 'update_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT * INTO c FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    IF c.status <> 'draft' THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_editable', 'status', c.status); END IF;
    -- Contrôle de version : l'IA modifie la version qu'elle a lue. Si le pro
    -- l'a retouchée dans le Studio entre-temps, rien n'est écrit.
    IF nullif(p_args->>'expected_version', '') IS NOT NULL
       AND p_args->>'expected_version' <> public._mcp_draft_version(c.updated_at) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_changed', 'version', public._mcp_draft_version(c.updated_at));
    END IF;
    v_product := coalesce(c.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(c.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END);
  ELSIF p_tool = 'create_email_draft' THEN
    v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_space_product = 'crm' THEN 'crm' ELSE 'suite' END);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  IF NOT public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden', 'product', v_product);
  END IF;

  v_lang := CASE WHEN p_args->>'language' IN ('fr', 'en', 'es') THEN p_args->>'language' END;

  -- ── Soirée ──
  IF v_has_ev THEN
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NULL OR lower(p_args->>'event') IN ('none', 'null') THEN
      v_event := NULL;
    ELSE
      v_ids := public._mcp_email_scope_events(v_venue, v_org, v_product);
      IF v_product = 'suite' THEN
        SELECT coalesce(array_agg(x), '{}') INTO v_ids FROM unnest(v_ids) x
         WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id = x AND e.external_source IS NULL);
      END IF;
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
  END IF;

  -- ── Audience ──
  IF p_args ? 'audience' THEN
    v_aud := '[]'::jsonb;
    FOR v_id IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_args->'audience') = 'array' THEN p_args->'audience' ELSE '[]'::jsonb END) LOOP
      v_one := public._mcp_email_audience(v_id, v_product, v_venue, v_org, coalesce(v_lang, 'fr'));
      IF v_one IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'audience_not_found', 'audience', v_id); END IF;
      v_aud := v_aud || v_one;
    END LOOP;
    -- Un nom posé par l'IA remplace le libellé d'une audience CRM définie par règle.
    IF v_product = 'crm' AND nullif(btrim(coalesce(p_args->>'audience_label', '')), '') IS NOT NULL
       AND jsonb_array_length(v_aud) = 1 AND NOT (v_aud->0 ? 'segmentId') THEN
      v_aud := jsonb_build_array((v_aud->0) || jsonb_build_object('label', left(btrim(p_args->>'audience_label'), 80)));
    END IF;
    IF v_product = 'crm' THEN
      v_audtype := CASE WHEN jsonb_array_length(v_aud) > 0 THEN 'imported_list' END;
    ELSIF jsonb_array_length(v_aud) = 1 THEN
      v_audtype := CASE v_aud->0->>'kind'
        WHEN 'segment' THEN 'custom_segment'
        WHEN 'import' THEN 'imported_list'
        WHEN 'contact_segment' THEN 'imported_list'
        ELSE v_aud->0->>'kind' END;
      v_segid := CASE WHEN v_aud->0->>'kind' = 'segment' AND v_venue IS NOT NULL THEN (v_aud->0->>'segmentId')::uuid END;
    ELSE
      v_audtype := CASE WHEN jsonb_array_length(v_aud) > 0 THEN 'all_subscribers' END;
    END IF;
  END IF;

  -- ── Contenu (déjà nettoyé et contrôlé par le Worker ; revérifié ici) ──
  IF p_args ? 'blocks' THEN
    v_blocks := p_args->'blocks';
    IF jsonb_typeof(v_blocks) <> 'array' OR jsonb_array_length(v_blocks) NOT BETWEEN 1 AND 40
       OR length(v_blocks::text) > 300000
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_blocks) b
                   WHERE jsonb_typeof(b) <> 'object'
                      OR coalesce(b->>'type', '') NOT IN ('html', 'header', 'image', 'text', 'cta', 'divider', 'spacer', 'social',
                                                          'event', 'tickets', 'guestlist', 'table', 'countdown', 'lineup')
                      OR coalesce(b->>'id', '') = '') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;
  IF p_args ? 'theme' THEN
    v_theme := p_args->'theme';
    IF jsonb_typeof(v_theme) <> 'object' OR length(v_theme::text) > 4000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;
  IF p_args ? 'exclusions' AND jsonb_typeof(p_args->'exclusions') = 'object' THEN
    v_excl := jsonb_strip_nulls(jsonb_build_object(
      'recentDays', CASE WHEN (p_args->'exclusions'->>'recentDays') ~ '^[0-9]{1,2}$' AND (p_args->'exclusions'->>'recentDays')::integer BETWEEN 1 AND 30
                         THEN (p_args->'exclusions'->>'recentDays')::integer END,
      'excludeEventBuyers', CASE WHEN (p_args->'exclusions'->>'excludeEventBuyers') IN ('true', 'false') THEN (p_args->'exclusions'->>'excludeEventBuyers')::boolean END));
  END IF;

  -- ── Création ──
  IF p_tool = 'create_email_draft' THEN
    IF v_blocks IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_content'); END IF;
    IF v_venue IS NOT NULL THEN
      SELECT vv.logo_url, jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
               'facebook', vv.facebook_url, 'x', vv.twitter_url))
        INTO v_logo, v_social FROM public.venues vv WHERE vv.id = v_venue;
    ELSE
      SELECT op.avatar_url, jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))
        INTO v_logo, v_social FROM public.organizer_profiles op WHERE op.user_id = v_org;
    END IF;
    SELECT coalesce(cs.quiet_hours, true), coalesce(cs.waves, false) INTO v_quiet, v_waves
      FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org);
    v_quiet := coalesce(v_quiet, true);
    v_waves := coalesce(v_waves, false) AND v_product = 'crm';

    INSERT INTO public.email_campaigns (
      name, type, subject, subject_b, ab_enabled, preheader, blocks_json, blocks_version, theme_json, social_links_json,
      logo_url, event_id, audiences_json, audience_type, segment_id, exclusions_json, quiet_hours,
      throttle_per_hour, throttle_window_minutes, throttle_plan,
      status, venue_id, organizer_user_id, created_by, product, language, ai_author, mcp_grant_id, ai_updated_at)
    VALUES (
      left(coalesce(nullif(btrim(p_args->>'name'), ''), 'E-mail'), 200), 'promotional',
      left(coalesce(nullif(btrim(p_args->>'subject'), ''), '—'), 250),
      nullif(left(btrim(coalesce(p_args->>'subject_b', '')), 250), ''),
      nullif(btrim(coalesce(p_args->>'subject_b', '')), '') IS NOT NULL,
      left(coalesce(p_args->>'preheader', ''), 300),
      v_blocks, 2, coalesce(v_theme, '{}'::jsonb), coalesce(v_social, '{}'::jsonb),
      v_logo, v_event, coalesce(v_aud, '[]'::jsonb), v_audtype, v_segid,
      coalesce(v_excl, jsonb_build_object('recentDays', 3)), v_quiet,
      CASE WHEN v_waves THEN 500 END, 60, CASE WHEN v_waves THEN jsonb_build_object('mode', 'hour', 'days', 2, 'custom', true) END,
      'draft', v_venue, v_org, p_uid, v_product, v_lang, left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60), p_grant, now())
    RETURNING * INTO c;
  ELSE
    UPDATE public.email_campaigns ec SET
      name = CASE WHEN nullif(btrim(coalesce(p_args->>'name', '')), '') IS NOT NULL THEN left(btrim(p_args->>'name'), 200) ELSE ec.name END,
      subject = CASE WHEN nullif(btrim(coalesce(p_args->>'subject', '')), '') IS NOT NULL THEN left(btrim(p_args->>'subject'), 250) ELSE ec.subject END,
      subject_b = CASE WHEN p_args ? 'subject_b' THEN nullif(left(btrim(coalesce(p_args->>'subject_b', '')), 250), '') ELSE ec.subject_b END,
      ab_enabled = CASE WHEN p_args ? 'subject_b' THEN nullif(btrim(coalesce(p_args->>'subject_b', '')), '') IS NOT NULL ELSE ec.ab_enabled END,
      preheader = CASE WHEN p_args ? 'preheader' THEN left(coalesce(p_args->>'preheader', ''), 300) ELSE ec.preheader END,
      language = CASE WHEN p_args ? 'language' THEN v_lang ELSE ec.language END,
      event_id = CASE WHEN v_has_ev THEN v_event ELSE ec.event_id END,
      audiences_json = coalesce(v_aud, ec.audiences_json),
      audience_type = CASE WHEN v_aud IS NOT NULL THEN v_audtype ELSE ec.audience_type END,
      segment_id = CASE WHEN v_aud IS NOT NULL THEN v_segid ELSE ec.segment_id END,
      exclusions_json = coalesce(v_excl, ec.exclusions_json),
      theme_json = coalesce(v_theme, ec.theme_json),
      blocks_json = coalesce(v_blocks, ec.blocks_json),
      blocks_version = 2,
      ai_author = coalesce(ec.ai_author, left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60)),
      mcp_grant_id = coalesce(ec.mcp_grant_id, p_grant),
      ai_updated_at = now()
     WHERE ec.id = c.id AND ec.status = 'draft'
    RETURNING * INTO c;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_editable'); END IF;
  END IF;

  -- ── Effectif net de l'audience (ne fait jamais échouer l'écriture) ──
  IF jsonb_array_length(coalesce(c.audiences_json, '[]'::jsonb)) > 0 THEN
    BEGIN
      IF v_product = 'crm' THEN
        v_prev := public.crm_email_audience_preview(v_venue, v_org, c.audiences_json, c.event_id,
                    CASE WHEN (c.exclusions_json->>'recentDays') ~ '^[0-9]+$' THEN (c.exclusions_json->>'recentDays')::integer END,
                    coalesce((c.exclusions_json->>'excludeEventBuyers')::boolean, false), c.id);
        v_net := (v_prev->>'net')::integer;
      ELSE
        v_net := (public.count_campaign_audience(c.id)->>'net')::integer;
      END IF;
    EXCEPTION WHEN others THEN v_net := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'draft_id', c.id, 'created', p_tool = 'create_email_draft', 'name', c.name, 'status', c.status,
    'product', v_product, 'language', coalesce(c.language, 'fr'),
    'subject', nullif(c.subject, '—'), 'ab_test', c.ab_enabled,
    'event', CASE WHEN c.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = c.event_id) END,
    'audience', jsonb_build_object(
      'groups', (SELECT coalesce(jsonb_agg(coalesce(a->>'label', a->>'kind')), '[]'::jsonb) FROM jsonb_array_elements(coalesce(c.audiences_json, '[]'::jsonb)) a),
      'recipients_now', v_net,
      'exclusions', c.exclusions_json),
    'sections', jsonb_array_length(c.blocks_json),
    'version', public._mcp_draft_version(c.updated_at),
    'venue_id', c.venue_id, 'organizer_user_id', c.organizer_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_scenario_tool(p_tool text, p_kind text, p_space_id text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_key   text := public.crm_scope_key(v_venue, v_org);
  v_id    uuid;
  v_list  jsonb;
  v_det   jsonb;
  v_rep   jsonb;
  v_ev    uuid;
  v_ref   text;
BEGIN
  IF NOT coalesce(public.crm_scope_allowed(v_venue, v_org), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF NOT coalesce(public.crm_scope_has_crm(v_key), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;

  IF p_tool = 'list_scenarios' THEN
    v_list := public.crm_scenarios(v_venue, v_org);
    RETURN jsonb_build_object('ok', true,
      'can_edit', v_list->'can_edit',
      'scenarios', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x->'id', 'name', x->'name', 'status', x->'status', 'state', x->'state', 'trigger', x->'trigger',
                 'version', x->'version', 'has_unpublished_changes', x->'has_changes', 'published_at', x->'published_at',
                 'updated_at', x->'updated_at', 'entered', x->'entered', 'on_their_way', x->'active', 'reached_goal', x->'goal',
                 'not_contacted', x->'holdout', 'not_contacted_reached_goal', x->'goal_holdout', 'holdout_measure', x->'measure',
                 'prepared_by_ai', x->'ai_author'))
          FROM jsonb_array_elements(v_list->'scenarios') x), '[]'::jsonb));

  ELSIF p_tool = 'get_scenario_report' THEN
    v_id := public._mcp_scenario_pick(v_key, p_args->>'scenario');
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'scenario_not_found'); END IF;
    v_det := public.crm_scenario(v_venue, v_org, v_id);
    IF coalesce((v_det->>'version')::integer, 0) > 0 THEN
      v_rep := public.crm_scenario_report(v_venue, v_org, v_id);
    END IF;
    RETURN jsonb_build_object('ok', true,
      'scenario', jsonb_build_object(
        'id', v_det->'id', 'name', v_det->'name', 'status', v_det->'status', 'state', v_det->'state',
        'version', v_det->'version', 'has_unpublished_changes', v_det->'has_changes',
        'published_at', v_det->'published_at', 'prepared_by_ai', v_det->'ai_author',
        'draft', v_det->'draft', 'live', v_det->'live'->'graph',
        'errors', v_det->'errors', 'warnings', v_det->'warnings', 'stats', v_det->'stats'),
      'report', v_rep,
      'url', 'https://crm.yunoapp.eu/crm/automations/scenarios/' || v_id);

  ELSIF p_tool = 'get_scenario_kit' THEN
    RETURN jsonb_build_object('ok', true,
      'can_edit', coalesce(public.crm_scope_writable(v_venue, v_org), false),
      'email_templates', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'subject', t.subject) ORDER BY t.updated_at DESC)
          FROM (SELECT * FROM public.email_campaign_templates t
                 WHERE t.venue_id IS NOT DISTINCT FROM v_venue AND t.organizer_user_id IS NOT DISTINCT FROM v_org
                   AND t.product = 'crm'
                 ORDER BY t.updated_at DESC LIMIT 60) t), '[]'::jsonb),
      'segments', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
          FROM public.crm_segments g WHERE g.scope_key = v_key), '[]'::jsonb),
      'signup_pages', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'status', p.status, 'has_night', p.event_id IS NOT NULL) ORDER BY p.updated_at DESC)
          FROM public.crm_signup_pages p
         WHERE p.venue_id IS NOT DISTINCT FROM v_venue AND p.organizer_user_id IS NOT DISTINCT FROM v_org), '[]'::jsonb),
      'upcoming_nights', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) ORDER BY e.start_at)
          FROM (SELECT e.id, e.title, e.start_at FROM public.events e
                 WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.start_at > now()
                   AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
                 ORDER BY e.start_at LIMIT 12) e), '[]'::jsonb),
      -- Familles « ce qui fait venir » confirmées sur le compte : seules elles
      -- retiennent quelqu'un dans une condition sc_family.
      'confirmed_families', coalesce((
        SELECT jsonb_agg(f) FROM unnest(ARRAY['artist','genre','format','slot','weekday','place','series','early','launch',
                                              'last_minute','door','group','table','discovery','passing','invited','group_first',
                                              'brought','channel']) f
         WHERE public._crm_family_confirmed(v_key, f)), '[]'::jsonb),
      'chances_available', coalesce((SELECT m.status = 'ok' FROM public.crm_score_model m WHERE m.scope_key = v_key), false),
      'sms_sender_ready', coalesce((public.get_sms_sender_readiness(v_venue, v_org, 'crm')->>'identity_ok')::boolean, false),
      'holdout_pct', public.crm_holdout_pct(v_key),
      'yunits', jsonb_build_object('email', greatest(1, coalesce((public.crm_pricing_config()->'rates'->>'email')::integer, 1)),
                                   'sms', public.crm_sms_rates()),
      'console_url', 'https://crm.yunoapp.eu/crm/automations?tab=scenarios');

  -- Plan d'une soirée à venir : id, partie du titre, ou rien / « next » = la prochaine.
  ELSIF p_tool = 'get_night_plan' THEN
    v_ref := nullif(btrim(coalesce(p_args->>'event', '')), '');
    IF v_ref IS NOT NULL AND lower(v_ref) <> 'next' THEN
      IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_ev := v_ref::uuid;
      ELSE
        SELECT e.id INTO v_ev FROM public.events e
         WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
           AND coalesce(e.end_at, e.start_at + interval '6 hours') > now()
           AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
           AND position(lower(v_ref) IN lower(e.title)) > 0
         ORDER BY e.start_at LIMIT 1;
        IF v_ev IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
      END IF;
    END IF;
    v_det := public.crm_night_plan(v_venue, v_org, v_ev);
    IF NOT coalesce((v_det->>'ok')::boolean, false) THEN RETURN v_det; END IF;
    RETURN v_det || jsonb_build_object(
      'console_url', 'https://crm.yunoapp.eu/crm/nights/' || (v_det->'event'->>'id') || '/plan',
      'note', 'Every number here is computed by Yuno from the account data. A person counts once, in the first '
           || 'audience of the suggested order that contains them (first_n). cost_* are Yunits (SMS at the France rate); '
           || 'audience_id is ready for create_email_draft. status is what the account data says about a hypothesis family, never a certainty about a person.');

  -- Bilan de la semaine écoulée (lundi → dimanche, Paris), calculé à la lecture.
  ELSIF p_tool = 'get_weekly_review' THEN
    RETURN public.crm_weekly_review(v_venue, v_org) || jsonb_build_object('console_url', 'https://crm.yunoapp.eu/crm/review');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_signup_events(p_venue_id text, p_organizer_user_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(e.id), '{}') FROM public.events e
   WHERE e.cancelled_at IS NULL AND e.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
$function$;

CREATE OR REPLACE FUNCTION public._mcp_signup_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_ids   uuid[];
  v_event uuid;
  v_lang  text;
  p       public.crm_signup_pages%ROWTYPE;
BEGIN
  IF NOT coalesce(public.crm_scope_allowed(v_venue, v_org), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF NOT ('crm' = ANY (public._mcp_email_products(v_venue, v_org, p_product))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;

  IF p_tool = 'get_signup_page_kit' THEN
    v_ids := public._mcp_signup_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'can_create', public._mcp_space_can_draft(p_uid, v_venue, v_org, 'crm'),
      'can_publish', public._crm_signup_owner(v_venue, v_org),
      'language_hint', coalesce(v_lang, 'fr'),
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', COALESCE(public.crm_space_display_name(v_venue, NULL), vv.name), 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', COALESCE(public.crm_space_display_name(NULL, v_org), op.display_name), 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark')))
            FROM (SELECT ec.name, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND public.crm_campaign_is_crm(ec.id)
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL OR EXISTS (
                      SELECT 1 FROM public.external_events xe WHERE xe.event_id = x.id AND xe.cover_url IS NOT NULL),
                   'sold_out', coalesce(x.tickets_sold_out, false))) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids) AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._crm_signup_event(v_event) END,
      'pages', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'page_id', x.id, 'title', nullif(x.title, ''), 'kind', x.kind, 'state', public._crm_signup_state(x),
                   'design', CASE WHEN x.custom_design IS NOT NULL THEN 'custom' ELSE x.design->>'tpl' END,
                   'prepared_by', x.ai_author, 'proposal_pending', CASE WHEN x.ai_proposal IS NOT NULL THEN true END,
                   'public_url', CASE WHEN x.status <> 'draft' THEN 'https://crm.yunoapp.eu/j/' || x.slug END,
                   'event', (SELECT e.title FROM public.events e WHERE e.id = x.event_id),
                   'signups', (SELECT count(*) FROM public.crm_signup_entries y WHERE y.page_id = x.id),
                   'edited', to_char(x.updated_at AT TIME ZONE coalesce(p_tz, 'Europe/Paris'), 'YYYY-MM-DD HH24:MI'))) ORDER BY x.updated_at DESC)
            FROM (SELECT * FROM public.crm_signup_pages sp
                   WHERE sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org
                   ORDER BY sp.updated_at DESC LIMIT 20) x), '[]'::jsonb));
  ELSIF p_tool = 'get_signup_page' THEN
    IF coalesce(p_args->>'page_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'page_not_found');
    END IF;
    SELECT * INTO p FROM public.crm_signup_pages sp
     WHERE sp.id = (p_args->>'page_id')::uuid
       AND sp.venue_id IS NOT DISTINCT FROM v_venue AND sp.organizer_user_id IS NOT DISTINCT FROM v_org;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'page_not_found'); END IF;
    RETURN jsonb_build_object('ok', true,
        'can_publish', public._crm_signup_owner(v_venue, v_org),
        'event_facts', CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_event(p.event_id) END)
      || public._mcp_signup_page_view(p);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_ticketing(p_tool text, p_kind text, p_space_id text, p_args jsonb, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind <> 'venue' THEN p_space_id::uuid END;
  v_event  uuid;
  e        public.events%ROWTYPE;
  v_sold   integer;
  v_list   jsonb := v_args->'tickets';
  v_n      integer;
  t        jsonb;
  i        integer;
  v_ids    uuid[] := '{}';
  v_keys   text[] := '{}';
  v_names  text[] := '{}';
  v_links  uuid[] := '{}';
  v_id     uuid;
  v_key    text;
  v_ref    text;
  v_j      integer;
  v_bad    text;
  v_cursor uuid;
  v_steps  integer;
  v_sale   text;
  v_vis    text;
  v_qty    integer;
  v_price  numeric;
  v_entry  text;
  v_vfrom  timestamptz;
  v_sstart timestamptz;
  v_send   timestamptz;
  v_drink  boolean;
  r        public.ticket_rounds%ROWTYPE;
  v_created integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
BEGIN
  v_event := public._mcp_resolve_event(coalesce(nullif(btrim(v_args->>'event'), ''), 'next'),
                                       public._mcp_email_scope_events(v_venue, v_org, 'suite'));
  IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
  SELECT * INTO e FROM public.events WHERE id = v_event;
  IF e.external_source IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'external_event'); END IF;

  -- Les droits de la Console sur la billetterie (policies de ticket_rounds).
  IF NOT (
       (e.venue_id IS NOT NULL AND (public.is_venue_owner(p_uid, e.venue_id) OR public.manager_has_permission(p_uid, e.venue_id, 'tickets')))
    OR (e.organizer_user_id = p_uid AND e.venue_id IS NULL)
    OR public.can_manage_event_tables(p_uid, e.id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden');
  END IF;

  IF p_tool = 'get_ticketing' THEN
    RETURN jsonb_build_object('ok', true) || public._mcp_ticketing_view(e.id);
  END IF;

  -- ── set_ticketing ─────────────────────────────────────────────────────────
  IF coalesce(e.end_at, e.start_at + interval '8 hours') < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_over');
  END IF;
  IF coalesce(e.ticketing_enabled, false) AND coalesce((v_args->>'apply_to_live')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ticketing_live');
  END IF;
  SELECT coalesce(sum(tickets_sold), 0) INTO v_sold FROM public.ticket_rounds WHERE event_id = e.id;
  IF coalesce(e.ticket_selling_mode, 'rounds') <> 'free' AND v_sold > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mode_has_sales');
  END IF;
  IF jsonb_typeof(v_list) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'error', 'tickets_required'); END IF;
  v_n := jsonb_array_length(v_list);
  IF v_n < 1 OR v_n > 40 THEN RETURN jsonb_build_object('ok', false, 'error', 'tickets_count'); END IF;

  -- 1) Identité de chaque ligne : un billet existant de CETTE soirée (id), sinon un nouvel id.
  FOR i IN 0 .. v_n - 1 LOOP
    t := v_list->i;
    IF jsonb_typeof(t) <> 'object' OR length(btrim(coalesce(t->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'name: 1 to 80 characters');
    END IF;
    v_id := NULL;
    IF coalesce(t->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO v_id FROM public.ticket_rounds WHERE id = (t->>'id')::uuid AND event_id = e.id;
      IF v_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'unknown_ticket_id', 'index', i + 1);
      END IF;
      IF v_id = ANY (v_ids) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'duplicate_ticket', 'index', i + 1);
      END IF;
    END IF;
    v_ids := array_append(v_ids, coalesce(v_id, gen_random_uuid()));
    v_keys := array_append(v_keys, lower(btrim(coalesce(nullif(t->>'ref', ''), t->>'id', t->>'name'))));
    v_names := array_append(v_names, lower(btrim(t->>'name')));
  END LOOP;

  -- 2) Un billet vendu ne disparaît jamais.
  SELECT string_agg(r2.name, ', ') INTO v_bad FROM public.ticket_rounds r2
   WHERE r2.event_id = e.id AND r2.tickets_sold > 0 AND NOT (r2.id = ANY (v_ids));
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_remove_sold', 'tickets', v_bad);
  END IF;

  -- 3) Les liens « s'ouvre quand … est complet » : par ref, id ou nom exact d'un billet de la liste.
  FOR i IN 0 .. v_n - 1 LOOP
    t := v_list->i;
    v_ref := lower(btrim(coalesce(t->>'opens_after', '')));
    v_sale := coalesce(nullif(t->>'sale', ''), CASE WHEN v_ref <> '' THEN 'after' ELSE 'now' END);
    IF v_sale NOT IN ('now', 'at', 'manual', 'after') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'sale: now, at, manual or after');
    END IF;
    IF v_sale = 'after' THEN
      IF v_ref = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'opens_after_required', 'index', i + 1);
      END IF;
      v_id := NULL;
      FOR v_j IN 1 .. v_n LOOP
        IF v_keys[v_j] = v_ref OR v_ids[v_j]::text = v_ref OR v_names[v_j] = v_ref THEN v_id := v_ids[v_j]; EXIT; END IF;
      END LOOP;
      IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_opens_after', 'index', i + 1); END IF;
      IF v_id = v_ids[i + 1] THEN RETURN jsonb_build_object('ok', false, 'error', 'chain_self', 'index', i + 1); END IF;
      v_links := array_append(v_links, v_id);
    ELSE
      v_links := array_append(v_links, NULL::uuid);
    END IF;
    -- Tout le reste de la ligne est vérifié ICI, avant la moindre écriture :
    -- une erreur au 5e billet ne laisse jamais les 4 premiers écrits.
    v_vis := coalesce(nullif(t->>'visibility', ''), CASE WHEN coalesce(t->>'visible_from', '') <> '' THEN 'at' ELSE 'now' END);
    IF v_vis NOT IN ('now', 'at', 'hidden') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'visibility: now, at or hidden');
    END IF;
    v_price := CASE WHEN jsonb_typeof(t->'price') = 'number' THEN (t->>'price')::numeric END;
    IF v_price IS NULL OR v_price < 0 OR v_price > 10000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'price: a number from 0 to 10000 (euros)');
    END IF;
    v_qty := CASE WHEN jsonb_typeof(t->'quantity') = 'number' THEN (t->>'quantity')::numeric::int END;
    IF v_qty IS NOT NULL AND (v_qty < 1 OR v_qty >= 999999) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'quantity: 1 or more, or null for no limit');
    END IF;
    IF (SELECT tickets_sold FROM public.ticket_rounds WHERE id = v_ids[i + 1]) > coalesce(v_qty, 999999) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'quantity_below_sold', 'index', i + 1,
        'sold', (SELECT tickets_sold FROM public.ticket_rounds WHERE id = v_ids[i + 1]));
    END IF;
    v_entry := nullif(btrim(coalesce(t->>'entry_before', '')), '');
    IF v_entry IS NOT NULL AND v_entry !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'entry_before: HH:MM (local time of the night)');
    END IF;
    v_vfrom := CASE WHEN v_vis = 'at' THEN nullif(t->>'visible_from', '')::timestamptz END;
    v_sstart := CASE WHEN v_sale = 'at' THEN nullif(t->>'sale_starts_at', '')::timestamptz END;
    v_send := nullif(t->>'sale_ends_at', '')::timestamptz;
    IF (v_vis = 'at' AND v_vfrom IS NULL) OR (v_sale = 'at' AND v_sstart IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'date_required', 'index', i + 1);
    END IF;
    IF v_sstart IS NOT NULL AND v_send IS NOT NULL AND v_send <= v_sstart THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket', 'index', i + 1, 'message', 'sale_ends_at must be after sale_starts_at');
    END IF;
  END LOOP;
  -- Pas de boucle : deux billets qui s'attendent ne s'ouvriraient jamais.
  FOR i IN 1 .. v_n LOOP
    v_cursor := v_links[i];
    v_steps := 0;
    WHILE v_cursor IS NOT NULL AND v_steps <= v_n LOOP
      IF v_cursor = v_ids[i] THEN
        RETURN jsonb_build_object('ok', false, 'error', 'chain_cycle', 'index', i);
      END IF;
      v_cursor := v_links[array_position(v_ids, v_cursor)];
      v_steps := v_steps + 1;
    END LOOP;
  END LOOP;

  -- 4) Écriture. Mode libre d'abord (une soirée sans vente dans un autre mode
  -- repart de zéro), puis billets retirés, billets posés, enfin les liens.
  IF coalesce(e.ticket_selling_mode, 'rounds') <> 'free' THEN
    DELETE FROM public.ticket_rounds WHERE event_id = e.id;
    UPDATE public.events SET ticket_selling_mode = 'free' WHERE id = e.id;
  END IF;
  WITH d AS (DELETE FROM public.ticket_rounds WHERE event_id = e.id AND NOT (id = ANY (v_ids)) RETURNING 1)
  SELECT count(*) INTO v_removed FROM d;

  FOR i IN 0 .. v_n - 1 LOOP
    t := v_list->i;
    v_sale := coalesce(nullif(t->>'sale', ''), CASE WHEN coalesce(t->>'opens_after', '') <> '' THEN 'after' ELSE 'now' END);
    v_vis := coalesce(nullif(t->>'visibility', ''), CASE WHEN coalesce(t->>'visible_from', '') <> '' THEN 'at' ELSE 'now' END);
    v_price := (t->>'price')::numeric;
    v_qty := CASE WHEN jsonb_typeof(t->'quantity') = 'number' THEN (t->>'quantity')::numeric::int END;
    v_entry := nullif(btrim(coalesce(t->>'entry_before', '')), '');
    v_vfrom := CASE WHEN v_vis = 'at' THEN nullif(t->>'visible_from', '')::timestamptz END;
    v_sstart := CASE WHEN v_sale = 'at' THEN nullif(t->>'sale_starts_at', '')::timestamptz END;
    v_send := nullif(t->>'sale_ends_at', '')::timestamptz;
    v_drink := coalesce((t->>'includes_drink')::boolean, false);

    SELECT * INTO r FROM public.ticket_rounds WHERE id = v_ids[i + 1];
    IF FOUND THEN
      UPDATE public.ticket_rounds SET
        name = btrim(t->>'name'), price = v_price, max_tickets = coalesce(v_qty, 999999), position = i,
        entry_deadline = v_entry::time, includes_drink = v_drink,
        drink_deadline_type = CASE WHEN v_drink THEN coalesce(nullif(r.drink_deadline_type, ''), 'none') ELSE 'none' END,
        drink_deadline_hours = CASE WHEN v_drink THEN r.drink_deadline_hours END,
        drink_cutoff_time = CASE WHEN v_drink THEN r.drink_cutoff_time END,
        hidden = (v_vis = 'hidden'), visible_from = v_vfrom,
        sale_starts_at = v_sstart, sale_ends_at = v_send,
        -- « après » : la garde du lien décide (étape 5) ; épuisé reste fermé.
        is_active = CASE WHEN v_sale = 'after' THEN r.is_active
                         WHEN coalesce(r.manually_sold_out, false) OR r.tickets_sold >= coalesce(v_qty, 999999) THEN false
                         ELSE v_sale IN ('now', 'at') END
      WHERE id = r.id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.ticket_rounds (id, event_id, name, price, max_tickets, position, last_tickets_threshold,
        ticket_type, auto_activate, is_active, hidden, visible_from, sale_starts_at, sale_ends_at,
        includes_drink, drink_deadline_type, entry_deadline)
      VALUES (v_ids[i + 1], e.id, btrim(t->>'name'), v_price, coalesce(v_qty, 999999), i, 20,
        'standard', false, v_sale IN ('now', 'at'), v_vis = 'hidden', v_vfrom, v_sstart, v_send,
        v_drink, 'none', v_entry::time);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- 5) Les liens, posés une fois que tous les billets existent : la garde
  -- (guard_ticket_round_opens_after) ouvre un billet dont le précédent est déjà
  -- complet et garde ouvert un billet déjà ouvert par un lien inchangé.
  FOR i IN 1 .. v_n LOOP
    UPDATE public.ticket_rounds SET opens_after_round_id = v_links[i]
     WHERE id = v_ids[i] AND opens_after_round_id IS DISTINCT FROM v_links[i];
  END LOOP;

  IF v_args ? 'capacity' THEN
    UPDATE public.events SET max_tickets = CASE WHEN jsonb_typeof(v_args->'capacity') = 'number' AND (v_args->>'capacity')::numeric >= 1
                                                THEN (v_args->>'capacity')::numeric::int END
     WHERE id = e.id;
  END IF;

  RETURN jsonb_build_object('ok', true,
    'changes', jsonb_build_object('created', v_created, 'updated', v_updated, 'removed', v_removed))
    || public._mcp_ticketing_view(e.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._resolve_meta_audience_rows(p_connection_id uuid, p_kind text, p_ref text)
 RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text;
  v_org   uuid;
BEGIN
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org
    FROM public.meta_connections mc WHERE mc.id = p_connection_id;
  IF NOT FOUND OR (v_venue IS NULL AND v_org IS NULL) THEN RETURN; END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE ((v_venue IS NOT NULL AND vsc.venue_id = v_venue) OR (v_org IS NOT NULL AND vsc.organizer_user_id = v_org))
       AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL
       AND vsc.sms_consent_at >= now() - interval '36 months'
       AND vsc.product IS NULL
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE ((v_venue IS NOT NULL AND ns.venue_id = v_venue) OR (v_org IS NOT NULL AND ns.organizer_user_id = v_org))
       AND ns.opted_in = true AND ns.product IS NULL
       AND NOT public.is_email_suppressed(ns.email)
  ),
  consenting AS (
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           COALESCE(n.first_name, pr.first_name) AS fn,
           COALESCE(n.last_name, pr.last_name) AS ln
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    SELECT s.em, s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  ),
  scope_events AS (
    SELECT e.id FROM public.events e
     WHERE (v_venue IS NOT NULL AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue))
        OR (v_org IS NOT NULL AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
  ),
  activity AS (
    SELECT lower(t.user_email) AS em, t.event_id, 'ticket'::text AS kind, t.created_at
      FROM public.tickets t WHERE t.paid_at IS NOT NULL AND t.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(tr.user_email), tr.event_id, 'table', tr.created_at
      FROM public.table_reservations tr WHERE tr.paid_at IS NOT NULL AND tr.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(o.user_email), o.event_id, 'order', o.created_at
      FROM public.orders o WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND ((v_venue IS NOT NULL AND o.venue_id = v_venue) OR o.event_id IN (SELECT id FROM scope_events))
    UNION ALL
    SELECT lower(gle.email), g.event_id, 'guest_list', gle.created_at
      FROM public.guest_list_entries gle JOIN public.guest_lists g ON g.id = gle.guest_list_id
     WHERE gle.status <> 'cancelled' AND g.event_id IN (SELECT id FROM scope_events)
  ),
  selected AS (
    SELECT c.* FROM consenting c
     WHERE CASE p_kind
       WHEN 'builtin' THEN
         CASE p_ref
           WHEN 'all_consenting' THEN true
           WHEN 'buyers_12m'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind IN ('ticket','table','order') AND a.created_at >= now() - interval '12 months')
           WHEN 'vip_tables'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'table')
           WHEN 'guest_list'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'guest_list')
           WHEN 'regulars_3'    THEN (SELECT count(DISTINCT a.event_id) FROM activity a WHERE a.em = c.em) >= 3
           ELSE false
         END
       WHEN 'venue_segment' THEN
         v_venue IS NOT NULL AND c.em IN (
           SELECT lower(r.email) FROM public.venue_segments vs
             CROSS JOIN LATERAL public.resolve_venue_segment(v_venue, vs.definition) r
            WHERE vs.id::text = p_ref AND vs.venue_id = v_venue)
       WHEN 'contact_segment' THEN
         c.em IN (
           SELECT lower(r.email) FROM public.contact_segments cs
             CROSS JOIN LATERAL public.resolve_contact_segment_def(v_venue, v_org, cs.definition) r
            WHERE cs.id::text = p_ref
              AND cs.venue_id IS NOT DISTINCT FROM v_venue AND cs.organizer_user_id IS NOT DISTINCT FROM v_org
              AND r.email IS NOT NULL)
       ELSE false END
  )
  SELECT NULLIF(s.em, '')::text, s.phone_e164::text, s.fn::text, s.ln::text,
         (CASE
            WHEN s.phone_e164 LIKE '+33%' THEN 'FR' WHEN s.phone_e164 LIKE '+34%' THEN 'ES'
            WHEN s.phone_e164 LIKE '+44%' THEN 'GB' WHEN s.phone_e164 LIKE '+49%' THEN 'DE'
            WHEN s.phone_e164 LIKE '+39%' THEN 'IT' WHEN s.phone_e164 LIKE '+32%' THEN 'BE'
            WHEN s.phone_e164 LIKE '+41%' THEN 'CH' WHEN s.phone_e164 LIKE '+351%' THEN 'PT'
            WHEN s.phone_e164 LIKE '+31%' THEN 'NL' ELSE '' END)::text
    FROM selected s
   WHERE NULLIF(s.em, '') IS NOT NULL OR s.phone_e164 IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_customer_detail(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_em TEXT := lower(trim(p_email));
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'identity', (
      SELECT jsonb_build_object(
        'user_id', i.user_id, 'first_name', i.first_name, 'last_name', i.last_name,
        'phone', i.phone, 'city', i.city, 'gender', i.gender,
        'age', CASE WHEN i.birth_date IS NOT NULL
                    THEN date_part('year', age(i.birth_date))::int END,
        'created_at', i.account_created_at, 'preferred_language', i.preferred_language,
        'party_persona', (SELECT p.party_persona FROM profiles p WHERE p.id = i.user_id),
        'is_suspended', i.is_suspended,
        'sms_opt_in', i.sms_opt_in, 'avatar_url', i.avatar_url,
        -- Ce qui décide de l'action : compte, app, canaux joignables.
        'has_account', i.has_account, 'profile_count', i.profile_count,
        'has_app', i.has_app, 'app_platforms', i.app_platforms,
        'email_opt_in', i.email_opt_in, 'email_suppressed', i.email_suppressed
      ) FROM public._admin_customer_identity(v_em) i
    ),
    'tags', COALESCE((SELECT to_jsonb(c.tags) FROM crm_customers c WHERE c.email = v_em), '[]'::jsonb),
    'notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'body', n.body, 'created_at', n.created_at
      ) ORDER BY n.created_at DESC)
      FROM crm_customer_notes n WHERE n.email = v_em
    ), '[]'::jsonb),
    -- Timeline COMPLÈTE : la guest list en fait partie. La version précédente
    -- lisait _admin_paid_activity, donc un client venu sans payer avait une
    -- fiche vide alors qu'il était bien là.
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'amount', round(r.amount, 2), 'created_at', r.created_at,
        'is_paid', r.is_paid,
        'venue_name', COALESCE(v.name, r.venue_id), 'event_title', e.title
      ) ORDER BY r.created_at DESC)
      FROM (
        SELECT a.kind, a.amount, a.created_at, a.venue_id, a.event_id, a.is_paid
        FROM public._admin_customer_activity() a
        WHERE a.em = v_em
        ORDER BY a.created_at DESC LIMIT 50
      ) r
      LEFT JOIN venues v ON v.id = r.venue_id
      LEFT JOIN events e ON e.id = r.event_id
    ), '[]'::jsonb),
    'stats', (
      SELECT jsonb_build_object(
        'total_spent', round(b.total_spent, 2),
        'rev_30d', round(b.rev_30d, 2), 'rev_90d', round(b.rev_90d, 2),
        'avg_basket', round(b.avg_basket, 2),
        'visit_nights', b.visit_nights, 'tx_count', b.tx_count,
        'ticket_count', b.ticket_count, 'order_count', b.order_count, 'table_count', b.table_count,
        'venues_count', b.venues_count,
        'first_at', b.first_at, 'last_at', b.last_at,
        'r', b.r_score, 'f', b.f_score, 'm', b.m_score,
        'segment', b.segment, 'tier', b.tier, 'category', b.category
      ) FROM _admin_customer_rfm() b WHERE b.em = v_em LIMIT 1
    ),
    'per_venue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'venue_id', pv.venue_id, 'venue_name', COALESCE(v.name, pv.venue_id),
        'revenue', round(pv.revenue, 2), 'tx_count', pv.tx_count, 'last_at', pv.last_at
      ) ORDER BY pv.revenue DESC)
      FROM (
        SELECT a.venue_id, sum(a.amount) AS revenue, count(*) AS tx_count, max(a.created_at) AS last_at
        FROM _admin_paid_activity() a
        WHERE a.em = v_em AND a.venue_id IS NOT NULL
        GROUP BY a.venue_id
      ) pv LEFT JOIN venues v ON v.id = pv.venue_id
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'amount', round(r.amount, 2), 'created_at', r.created_at,
        'venue_name', COALESCE(v.name, r.venue_id), 'event_title', e.title
      ) ORDER BY r.created_at DESC)
      FROM (
        SELECT a.kind, a.amount, a.created_at, a.venue_id, a.event_id
        FROM _admin_paid_activity() a
        WHERE a.em = v_em
        ORDER BY a.created_at DESC LIMIT 20
      ) r
      LEFT JOIN venues v ON v.id = r.venue_id
      LEFT JOIN events e ON e.id = r.event_id
    ), '[]'::jsonb),
    'incidents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'venue_name', COALESCE(v.name, ci.venue_id),
        'type', ci.incident_type, 'reason', ci.reason, 'created_at', ci.created_at
      ) ORDER BY ci.created_at DESC)
      FROM customer_incidents ci
      JOIN venue_customers vc ON vc.id = ci.venue_customer_id
      LEFT JOIN venues v ON v.id = ci.venue_id
      WHERE lower(vc.email) = v_em
    ), '[]'::jsonb),
    'banned_venues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'venue_name', COALESCE(v.name, vbe.venue_id), 'reason', vbe.ban_reason, 'banned_at', vbe.banned_at
      ))
      FROM venue_banned_emails vbe LEFT JOIN venues v ON v.id = vbe.venue_id
      WHERE vbe.email = v_em
    ), '[]'::jsonb),
    'newsletter_opt_in', (
      SELECT COALESCE(bool_or(ns.opted_in), false)
      FROM newsletter_subscriptions ns WHERE lower(ns.email) = v_em AND ns.product IS NULL
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_product_insights(p_from timestamp with time zone, p_to timestamp with time zone, p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
           CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  real_profiles AS (
    SELECT p.* FROM public.profiles p
    WHERE (p_include_demo OR NOT public.is_demo_email(p.email))
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
  ),
  pv AS (
    SELECT pv.path, pv.page_group, pv.duration_seconds, pv.occurred_at, pv.session_id
    FROM public.platform_page_views pv
    WHERE pv.occurred_at >= p_from AND pv.occurred_at <= p_to
  ),
  ev_views AS (
    -- Une vue de page soirée → la soirée : /event/<uuid>, /events/<venue>/<slug>,
    -- /club/<venue>/event/<slug>. Les soirées partenaires (/affiliate-event/<slug>)
    -- restent des chemins bruts.
    SELECT e.id, e.title, e.start_at, COALESCE(vn.name, e.location_name) AS venue_name,
      count(*) AS views, count(DISTINCT pv.session_id) AS sessions, round(avg(pv.duration_seconds)) AS avg_seconds
    FROM pv
    JOIN public.events e ON (
      pv.path LIKE '/event/' || e.id::text || '%'
      OR (e.slug IS NOT NULL AND (pv.path ~ ('^/events/[^/]+/' || e.slug || '$') OR pv.path ~ ('^/club/[^/]+/event/' || e.slug || '$')))
    )
    CROSS JOIN d
    LEFT JOIN public.venues vn ON vn.id = COALESCE(e.venue_id, e.partner_venue_id)
    WHERE pv.page_group = 'event' AND NOT COALESCE(e.id = ANY (d.de), false)
    GROUP BY e.id, e.title, e.start_at, vn.name
  ),
  fav AS (
    SELECT f.* FROM public.favorites f JOIN real_profiles rp ON rp.id = f.user_id
  )
  SELECT jsonb_build_object(
    'page_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('group', page_group, 'views', n, 'sessions', s, 'avg_seconds', avg_s) ORDER BY n DESC)
      FROM (SELECT page_group, count(*) AS n, count(DISTINCT session_id) AS s, round(avg(duration_seconds)) AS avg_s FROM pv GROUP BY page_group) x
    ), '[]'::jsonb),
    'top_events_viewed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'start_at', start_at, 'venue_name', venue_name,
        'views', views, 'sessions', sessions, 'avg_seconds', avg_seconds,
        'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = ev_views.id AND ge.created_at >= p_from AND ge.created_at <= p_to),
        'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = ev_views.id AND t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at <= p_to)
      ) ORDER BY views DESC)
      FROM (SELECT * FROM ev_views ORDER BY views DESC LIMIT 12) ev_views
    ), '[]'::jsonb),
    'top_paths', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('path', path, 'group', page_group, 'views', n, 'avg_seconds', avg_s) ORDER BY n DESC)
      FROM (SELECT path, page_group, count(*) AS n, round(avg(duration_seconds)) AS avg_s FROM pv
            WHERE page_group IN ('venue', 'browse', 'explore', 'dj', 'promo-link', 'other') GROUP BY path, page_group ORDER BY count(*) DESC LIMIT 15) x
    ), '[]'::jsonb),
    'favorites', jsonb_build_object(
      'by_type', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('type', favorite_type, 'period', n_period, 'total', n_total) ORDER BY n_total DESC)
        FROM (SELECT favorite_type, count(*) FILTER (WHERE created_at >= p_from AND created_at <= p_to) AS n_period, count(*) AS n_total FROM fav GROUP BY favorite_type) x
      ), '[]'::jsonb),
      'top_events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT event_id, count(*) AS n FROM fav WHERE event_id IS NOT NULL GROUP BY event_id ORDER BY count(*) DESC LIMIT 8) x
        JOIN public.events e ON e.id = x.event_id CROSS JOIN d WHERE NOT COALESCE(e.id = ANY (d.de), false)
      ), '[]'::jsonb),
      'top_venues', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', vn.id, 'name', vn.name, 'city', vn.city, 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT venue_id, count(*) AS n FROM fav WHERE venue_id IS NOT NULL GROUP BY venue_id ORDER BY count(*) DESC LIMIT 8) x
        JOIN public.venues vn ON vn.id = x.venue_id CROSS JOIN d WHERE NOT COALESCE(vn.id = ANY (d.dv), false)
      ), '[]'::jsonb),
      'top_djs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', dj.id, 'name', COALESCE(dj.stage_name, dj.first_name), 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT dj_id, count(*) AS n FROM fav WHERE dj_id IS NOT NULL GROUP BY dj_id ORDER BY count(*) DESC LIMIT 8) x
        JOIN public.djs dj ON dj.id = x.dj_id
      ), '[]'::jsonb)
    ),
    'follows', jsonb_build_object(
      'by_subject', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('subject', subject_type, 'follows', f, 'unfollows', u) ORDER BY f DESC)
        FROM (SELECT fe.subject_type, count(*) FILTER (WHERE fe.action = 'follow') AS f, count(*) FILTER (WHERE fe.action = 'unfollow') AS u
              FROM public.audience_follow_events fe JOIN real_profiles rp ON rp.id = fe.follower_user_id
              WHERE fe.created_at >= p_from AND fe.created_at <= p_to GROUP BY fe.subject_type) x
      ), '[]'::jsonb)
    ),
    'taste', jsonb_build_object(
      'profiles', (SELECT count(*) FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id),
      'genres', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('k', g, 'n', n) ORDER BY n DESC)
        FROM (SELECT g, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id, unnest(COALESCE(tp.genres, ARRAY[tp.music_style])) AS g WHERE g IS NOT NULL GROUP BY g ORDER BY count(*) DESC LIMIT 12) x
      ), '[]'::jsonb),
      'night_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.night_type AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.night_type IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'budget', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.budget AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.budget IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'frequency', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.frequency AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.frequency IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'drink', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.drink_preference AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.drink_preference IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'booking', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.booking_pref AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.booking_pref IS NOT NULL GROUP BY 1) x), '[]'::jsonb)
    ),
    'audience', jsonb_build_object(
      'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT initcap(lower(trim(city))) AS k, count(*) AS n FROM real_profiles WHERE NULLIF(trim(city), '') IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 12) x), '[]'::jsonb),
      'languages', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(preferred_language, '?') AS k, count(*) AS n FROM real_profiles GROUP BY 1) x), '[]'::jsonb),
      'genders', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(gender, '?') AS k, count(*) AS n FROM real_profiles GROUP BY 1) x), '[]'::jsonb),
      'ages', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY k) FROM (
        SELECT CASE
          WHEN age < 18 THEN '<18' WHEN age < 21 THEN '18-20' WHEN age < 25 THEN '21-24'
          WHEN age < 30 THEN '25-29' WHEN age < 35 THEN '30-34' ELSE '35+' END AS k, count(*) AS n
        FROM (SELECT date_part('year', age(birth_date))::int AS age FROM real_profiles WHERE birth_date IS NOT NULL) a GROUP BY 1) x), '[]'::jsonb),
      'personas', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT party_persona AS k, count(*) AS n FROM real_profiles WHERE party_persona IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'session_countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(country, '?') AS k, count(*) AS n FROM public.platform_sessions WHERE started_at >= p_from AND started_at <= p_to GROUP BY 1 ORDER BY count(*) DESC LIMIT 10) x), '[]'::jsonb),
      'session_languages', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(language, '?') AS k, count(*) AS n FROM public.platform_sessions WHERE started_at >= p_from AND started_at <= p_to GROUP BY 1 ORDER BY count(*) DESC LIMIT 8) x), '[]'::jsonb),
      'session_devices', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(device, '?') || CASE WHEN is_native THEN ' · app' ELSE '' END AS k, count(*) AS n FROM public.platform_sessions WHERE started_at >= p_from AND started_at <= p_to GROUP BY 1) x), '[]'::jsonb)
    ),
    'entry', jsonb_build_object(
      'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id CROSS JOIN d
        WHERE ge.created_at >= p_from AND ge.created_at <= p_to AND NOT COALESCE(gl.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(ge.email))),
      'guestlist_scanned', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id CROSS JOIN d
        WHERE ge.entry_scanned AND ge.created_at >= p_from AND ge.created_at <= p_to AND NOT COALESCE(gl.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(ge.email))),
      'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t CROSS JOIN d
        WHERE t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at <= p_to AND NOT COALESCE(t.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(t.user_email))),
      'tickets_scanned', (SELECT count(*) FROM public.tickets t CROSS JOIN d
        WHERE t.paid_at IS NOT NULL AND t.entry_scanned AND t.created_at >= p_from AND t.created_at <= p_to AND NOT COALESCE(t.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(t.user_email))),
      'tables', (SELECT count(*) FROM public.table_reservations tr CROSS JOIN d
        WHERE tr.status IN ('paid', 'confirmed') AND tr.created_at >= p_from AND tr.created_at <= p_to AND NOT COALESCE(tr.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))),
      'wallet_passes', (SELECT count(*) FROM public.wallet_passes wp WHERE wp.created_at >= p_from AND wp.created_at <= p_to AND NOT wp.voided),
      'wallet_by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT pass_type AS k, count(*) AS n FROM public.wallet_passes WHERE created_at >= p_from AND created_at <= p_to GROUP BY 1) x), '[]'::jsonb),
      'guest_checkout_share', (
        SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE is_guest)::numeric / count(*) * 100) ELSE NULL END
        FROM (
          SELECT t.is_guest FROM public.tickets t CROSS JOIN d WHERE t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at <= p_to AND NOT COALESCE(t.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(t.user_email))
          UNION ALL
          SELECT tr.is_guest FROM public.table_reservations tr CROSS JOIN d WHERE tr.status IN ('paid', 'confirmed') AND tr.created_at >= p_from AND tr.created_at <= p_to AND NOT COALESCE(tr.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))
        ) g
      ),
      'abandoned_carts', (SELECT count(*) FROM public.cart_snapshots cs JOIN real_profiles rp ON rp.id = cs.user_id WHERE cs.created_at >= p_from AND cs.created_at <= p_to AND NOT COALESCE(cs.converted, false))
    ),
    'notifications', jsonb_build_object(
      'push_users', (SELECT count(DISTINCT ps.user_id) FROM public.push_subscriptions ps JOIN real_profiles rp ON rp.id = ps.user_id),
      'push_by_platform', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT COALESCE(ps.platform, 'web') AS k, count(DISTINCT ps.user_id) AS n FROM public.push_subscriptions ps JOIN real_profiles rp ON rp.id = ps.user_id GROUP BY 1) x), '[]'::jsonb),
      'auto_push', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('key', notification_key, 'sent', sent, 'clicked', clicked, 'failed', failed,
          'ctr', CASE WHEN sent > 0 THEN round(clicked::numeric / sent * 100, 1) ELSE 0 END) ORDER BY sent DESC)
        FROM (
          SELECT ae.notification_key,
            count(*) FILTER (WHERE ae.event_type = 'sent') AS sent,
            count(*) FILTER (WHERE ae.event_type = 'clicked') AS clicked,
            count(*) FILTER (WHERE ae.event_type = 'failed') AS failed
          FROM public.auto_push_events ae JOIN real_profiles rp ON rp.id = ae.user_id
          WHERE ae.created_at >= p_from AND ae.created_at <= p_to GROUP BY ae.notification_key ORDER BY count(*) DESC LIMIT 12
        ) x
      ), '[]'::jsonb),
      'discovery_sent', (SELECT count(*) FROM public.discovery_selections ds JOIN real_profiles rp ON rp.id = ds.user_id WHERE ds.created_at >= p_from AND ds.created_at <= p_to),
      'discovery_opened', (SELECT count(*) FROM public.discovery_selections ds JOIN real_profiles rp ON rp.id = ds.user_id WHERE ds.created_at >= p_from AND ds.created_at <= p_to AND ds.opened_at IS NOT NULL),
      'discovery_opt_out', (SELECT count(*) FROM real_profiles WHERE COALESCE(discovery_opt_out, false)),
      'newsletter_opt_in', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE ns.opted_in AND ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND (p_include_demo OR NOT public.is_demo_email(ns.email))),
      'newsletter_opt_out_period', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE NOT ns.opted_in AND ns.product IS NULL AND ns.updated_at >= p_from AND ns.updated_at <= p_to AND (p_include_demo OR NOT public.is_demo_email(ns.email)))
    ),
    'feedback', jsonb_build_object(
      'open', (SELECT count(*) FROM public.feedback_issues f WHERE f.status IN ('open', 'in_progress')),
      'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT category AS k, count(*) AS n FROM public.feedback_issues WHERE created_at >= p_from AND created_at <= p_to GROUP BY 1) x), '[]'::jsonb),
      'recent', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'category', f.category, 'priority', f.priority, 'status', f.status, 'at', f.created_at, 'reporter', p.email, 'venue', vn.name) ORDER BY f.created_at DESC)
        FROM (SELECT * FROM public.feedback_issues ORDER BY created_at DESC LIMIT 8) f
        LEFT JOIN public.profiles p ON p.id = f.reported_by LEFT JOIN public.venues vn ON vn.id = f.venue_id
      ), '[]'::jsonb),
      'incidents', (SELECT count(*) FROM public.customer_incidents ci WHERE ci.created_at >= p_from AND ci.created_at <= p_to),
      'email_complaints', (SELECT count(*) FROM public.email_suppressions es WHERE es.created_at >= p_from AND es.created_at <= p_to)
    ),
    'ai_questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'q', a.prompt_preview, 'lang', a.language, 'turns', a.turn_count, 'status', a.status) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.ai_usage_events e WHERE e.assistant = 'client' AND e.prompt_preview IS NOT NULL
            AND e.created_at >= p_from AND e.created_at <= p_to AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
            ORDER BY e.created_at DESC LIMIT 30) a
    ), '[]'::jsonb),
    'pro_questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'q', a.prompt_preview, 'assistant', a.assistant, 'tools', a.tool_calls, 'status', a.status) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.ai_usage_events e WHERE e.assistant IN ('owner', 'agency') AND e.prompt_preview IS NOT NULL
            AND e.created_at >= p_from AND e.created_at <= p_to AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
            ORDER BY e.created_at DESC LIMIT 20) a
    ), '[]'::jsonb),
    'links_interest', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('target', target, 'n', n) ORDER BY n DESC)
      FROM (SELECT le.target, count(*) AS n FROM public.links_events le WHERE le.kind = 'click' AND le.occurred_at >= p_from AND le.occurred_at <= p_to GROUP BY le.target ORDER BY count(*) DESC LIMIT 10) x
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.analyze_contact_lists(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer := 0;
  v_min integer;
  v_lists integer := 0;
  v_cov jsonb;
  v_facts jsonb;
  v_sugs jsonb := '[]'::jsonb;
  v_home_country text;
  v_home_n integer := 0;
  v_zone_field text := 'zone';
  v_spend_top numeric;
  v_spend_median numeric;
  v_cnt_country integer; v_cnt_zone integer; v_cnt_city integer; v_cnt_spent integer;
  v_cnt_events integer; v_cnt_last integer; v_cnt_age integer; v_cnt_gender integer; v_cnt_news integer;
  v_emails integer; v_phones integer; v_both integer; v_email_ok integer; v_phone_ok integer;
  v_cnt_sent integer; v_cnt_yuno integer; v_campaigns integer;
  r record;
  v_c integer; v_ce integer; v_cp integer;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'analyze_contact_lists: une seule portée à la fois (club OU organisateur OU plateforme)';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);
  SELECT count(*) INTO v_lists FROM public.contact_list_imports li
   WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND li.product IS NULL;
  SELECT count(*) INTO v_campaigns FROM public.email_campaigns ec
   WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND ec.status = 'sent'
     AND NOT public.crm_campaign_is_crm(ec.id);

  IF v_n = 0 THEN
    DROP TABLE IF EXISTS _cr;
    RETURN jsonb_build_object('generated_at', now(), 'contacts', 0, 'lists', v_lists, 'campaigns', v_campaigns, 'suggestions', '[]'::jsonb);
  END IF;

  v_min := GREATEST(10, round(v_n * 0.01));

  SELECT count(*) FILTER (WHERE country_code IS NOT NULL),
         count(*) FILTER (WHERE zone IS NOT NULL),
         count(*) FILTER (WHERE city IS NOT NULL),
         count(*) FILTER (WHERE total_spent IS NOT NULL),
         count(*) FILTER (WHERE event_count IS NOT NULL),
         count(*) FILTER (WHERE last_purchase_at IS NOT NULL),
         count(*) FILTER (WHERE age IS NOT NULL),
         count(*) FILTER (WHERE gender IN ('female','male')),
         count(*) FILTER (WHERE newsletter_opt_in IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok),
         count(*) FILTER (WHERE emails_sent > 0),
         count(*) FILTER (WHERE origin IN ('yuno', 'both'))
    INTO v_cnt_country, v_cnt_zone, v_cnt_city, v_cnt_spent, v_cnt_events, v_cnt_last,
         v_cnt_age, v_cnt_gender, v_cnt_news, v_emails, v_phones, v_both, v_email_ok, v_phone_ok,
         v_cnt_sent, v_cnt_yuno
    FROM _cr;

  v_cov := jsonb_build_object(
    'country', v_cnt_country, 'zone', v_cnt_zone, 'city', v_cnt_city, 'spent', v_cnt_spent,
    'events', v_cnt_events, 'last_purchase', v_cnt_last, 'age', v_cnt_age, 'gender', v_cnt_gender,
    'newsletter', v_cnt_news, 'engagement', v_cnt_sent, 'yuno', v_cnt_yuno);

  SELECT country_code, count(*) INTO v_home_country, v_home_n
    FROM _cr WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count(*) DESC LIMIT 1;
  IF v_cnt_zone < GREATEST(v_cnt_city, 1) * 0.6 THEN v_zone_field := 'city'; END IF;

  SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_spent),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total_spent)
    INTO v_spend_top, v_spend_median
    FROM _cr WHERE total_spent > 0;

  v_facts := jsonb_build_object(
    'top_countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'n', n) ORDER BY n DESC)
                       FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
                             GROUP BY country_code ORDER BY n DESC LIMIT 8) t), '[]'::jsonb),
    'zone_field', v_zone_field,
    'top_zones', COALESCE((SELECT jsonb_agg(jsonb_build_object('value', v, 'n', n) ORDER BY n DESC)
                   FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
                           FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
                          GROUP BY 1 ORDER BY n DESC LIMIT 10) t), '[]'::jsonb),
    'spend', jsonb_build_object(
      'zero', (SELECT count(*) FROM _cr WHERE total_spent = 0),
      'paid', (SELECT count(*) FROM _cr WHERE total_spent > 0),
      'median_paid', round(COALESCE(v_spend_median, 0), 2),
      'top_threshold', round(COALESCE(v_spend_top, 0), 2),
      'total', (SELECT round(COALESCE(sum(total_spent), 0), 2) FROM _cr),
      'tables', (SELECT count(*) FROM _cr WHERE total_spent / NULLIF(event_count, 0) >= 60)),
    'events', jsonb_build_object(
      'one', (SELECT count(*) FROM _cr WHERE event_count = 1),
      'two_three', (SELECT count(*) FROM _cr WHERE event_count BETWEEN 2 AND 3),
      'four_plus', (SELECT count(*) FROM _cr WHERE event_count >= 4)),
    'recency', jsonb_build_object(
      'd90', (SELECT count(*) FROM _cr WHERE last_purchase_at > now() - interval '90 days'),
      'd365', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '90 days' AND last_purchase_at > now() - interval '365 days'),
      'older', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '365 days')),
    'age', jsonb_build_object(
      'avg', (SELECT round(avg(age), 1) FROM _cr WHERE age IS NOT NULL),
      'b18_21', (SELECT count(*) FROM _cr WHERE age BETWEEN 18 AND 21),
      'b22_25', (SELECT count(*) FROM _cr WHERE age BETWEEN 22 AND 25),
      'b26_30', (SELECT count(*) FROM _cr WHERE age BETWEEN 26 AND 30),
      'b31', (SELECT count(*) FROM _cr WHERE age >= 31)),
    'gender', jsonb_build_object(
      'female', (SELECT count(*) FROM _cr WHERE gender = 'female'),
      'male', (SELECT count(*) FROM _cr WHERE gender = 'male')),
    'newsletter_yes', (SELECT count(*) FROM _cr WHERE newsletter_opt_in = true),
    'channels', jsonb_build_object('emails', v_emails, 'phones', v_phones, 'both', v_both,
                                   'emails_reachable', v_email_ok, 'phones_reachable', v_phone_ok),
    'engagement', jsonb_build_object(
      'campaigns', v_campaigns,
      'sent_any', v_cnt_sent,
      'active', (SELECT count(*) FROM _cr WHERE eng_status = 'active'),
      'passive', (SELECT count(*) FROM _cr WHERE eng_status = 'passive'),
      'silent', (SELECT count(*) FROM _cr WHERE eng_status = 'silent'),
      'new', (SELECT count(*) FROM _cr WHERE eng_status = 'new'),
      'unreachable', (SELECT count(*) FROM _cr WHERE eng_status = 'unreachable'),
      'unsubscribed', (SELECT count(*) FROM _cr WHERE eng_status = 'unsubscribed')),
    'origin', jsonb_build_object(
      'import', (SELECT count(*) FROM _cr WHERE origin = 'import'),
      'yuno', (SELECT count(*) FROM _cr WHERE origin = 'yuno'),
      'both', (SELECT count(*) FROM _cr WHERE origin = 'both'),
      'with_account', (SELECT count(*) FROM _cr WHERE has_account))
  );

  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand (ord serial, key text, grp text, def jsonb, params jsonb, min_n integer) ON COMMIT DROP;

  IF v_cnt_country >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_country:' || code, 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country', 'in', jsonb_build_array(code)))),
           jsonb_build_object('code', code)
      FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
             GROUP BY country_code HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 6) t;
    IF v_home_country IS NOT NULL THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('geo_abroad', 'geo',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country_not', 'in', jsonb_build_array(v_home_country)))),
         jsonb_build_object('home', v_home_country));
    END IF;
  END IF;
  IF GREATEST(v_cnt_zone, v_cnt_city) >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_zone:' || lower(v), 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', v_zone_field, 'in', jsonb_build_array(v)))),
           jsonb_build_object('zone', v, 'field', v_zone_field)
      FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
              FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
             GROUP BY 1 HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 8) t;
  END IF;

  IF v_cnt_spent >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('spend_free', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'eq', 'value', 0))),
       '{}'::jsonb),
      ('spend_tickets', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'spent', 'op', 'gt', 'value', 0),
         jsonb_build_object('type', 'spent_per_event', 'op', 'lt', 'value', 60))),
       jsonb_build_object('median', round(COALESCE(v_spend_median, 0)))),
      ('spend_tables', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent_per_event', 'op', 'gte', 'value', 60))),
       jsonb_build_object('threshold', 60));
    IF COALESCE(v_spend_top, 0) > 0 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('spend_top', 'spend',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'gte', 'value', round(v_spend_top)))),
         jsonb_build_object('threshold', round(v_spend_top)));
    END IF;
  END IF;

  IF v_cnt_events >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('freq_once', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1))), '{}'::jsonb),
      ('freq_regular', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'events', 'op', 'lte', 'value', 3))), '{}'::jsonb),
      ('freq_loyal', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'gte', 'value', 4))), '{}'::jsonb);
  END IF;

  IF v_cnt_last >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('recent_active', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 90))), '{}'::jsonb),
      ('recent_lapsed', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 90), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 365))), '{}'::jsonb),
      ('recent_dormant', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 365))), '{}'::jsonb);
    IF v_cnt_events >= v_n * 0.3 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('winback_regulars', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 120))), '{}'::jsonb),
        ('new_recent', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 60))), '{}'::jsonb);
    END IF;
  END IF;

  IF v_cnt_age >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('age_18_21', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 18, 'max', 21))), '{}'::jsonb),
      ('age_22_25', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 22, 'max', 25))), '{}'::jsonb),
      ('age_26_30', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 26, 'max', 30))), '{}'::jsonb),
      ('age_31_plus', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 31, 'max', 120))), '{}'::jsonb);
  END IF;
  IF v_cnt_gender >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('gender_female', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('female')))), '{}'::jsonb),
      ('gender_male', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('male')))), '{}'::jsonb);
  END IF;

  IF v_cnt_news >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('newsletter_yes', 'consent', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'newsletter_opt_in', 'value', true))), '{}'::jsonb);
  END IF;

  IF v_phones > 0 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('channel_both', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', true), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb),
      ('channel_sms_only', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', false), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb);
  END IF;

  -- Engagement : dès qu'une campagne est partie. Ce que les emails ont appris.
  IF v_campaigns > 0 AND v_cnt_sent > 0 THEN
    INSERT INTO _cand (key, grp, def, params, min_n) VALUES
      ('eng_active', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'engagement', 'in', jsonb_build_array('active')))), '{}'::jsonb, 5),
      ('eng_clickers', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'last_click_days', 'op', 'lte', 'value', 90))), '{}'::jsonb, 5),
      ('eng_passive', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'engagement', 'in', jsonb_build_array('passive')))), '{}'::jsonb, 5),
      ('eng_silent', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'engagement', 'in', jsonb_build_array('silent')))), '{}'::jsonb, v_min),
      ('eng_never_sent', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'emails_received', 'op', 'eq', 'value', 0))), '{}'::jsonb, v_min);
  END IF;

  -- Source : la base a deux origines dès qu'un client est venu par Yuno.
  IF v_cnt_yuno > 0 THEN
    INSERT INTO _cand (key, grp, def, params, min_n) VALUES
      ('src_yuno', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'origin', 'in', jsonb_build_array('yuno', 'both')))), '{}'::jsonb, 3),
      ('src_yuno_only', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'origin', 'in', jsonb_build_array('yuno')))), '{}'::jsonb, 3),
      ('src_both', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'origin', 'in', jsonb_build_array('both')))), '{}'::jsonb, 3),
      ('src_guest_list', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'guest_lists', 'op', 'gte', 'value', 1))), '{}'::jsonb, 3);
  END IF;

  FOR r IN SELECT * FROM _cand ORDER BY ord LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.def, 'c'))
      INTO v_c, v_ce, v_cp;
    IF v_c >= COALESCE(r.min_n, v_min) THEN
      v_sugs := v_sugs || jsonb_build_object(
        'key', r.key, 'group', r.grp, 'definition', r.def, 'params', r.params,
        'contacts', v_c, 'emails', v_ce, 'phones', v_cp,
        'share', round(v_c::numeric / v_n, 4),
        'existing_id', (SELECT cs.id FROM public.contact_segments cs
                         WHERE cs.suggestion_key = r.key
                           AND (public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id))
                         LIMIT 1));
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _cand;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'contacts', v_n,
    'lists', v_lists,
    'campaigns', v_campaigns,
    'min_size', v_min,
    'home_country', v_home_country,
    'coverage', v_cov,
    'facts', v_facts,
    'suggestions', v_sugs
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_subscribe_event_waitlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text := lower(btrim(COALESCE(NEW.email, '')));
  v_first text;
  v_last text;
BEGIN
  IF v_email = '' OR NOT COALESCE(NEW.newsletter_opt_in, false) THEN
    RETURN NEW;
  END IF;

  -- Destinataire nommé à l'écran = celui qui reçoit l'abonnement (club, sinon
  -- organisateur ; co-soirée org-led : club et organisateur partenaires).
  SELECT COALESCE(e.venue_id, e.partner_venue_id),
         COALESCE(e.organizer_user_id, e.partner_organizer_id)
    INTO v_venue_id, v_organizer_user_id
    FROM public.events e
   WHERE e.id = NEW.event_id;

  v_first := COALESCE(NULLIF(btrim(NEW.first_name), ''),
                      NULLIF(split_part(btrim(COALESCE(NEW.full_name, '')), ' ', 1), ''));
  v_last  := COALESCE(NULLIF(btrim(NEW.last_name), ''),
                      NULLIF(btrim(regexp_replace(COALESCE(NEW.full_name, ''), '^\S+\s*', '')), ''));

  -- Les index d'unicité sont PARTIELS et portent sur lower(email) : la cible
  -- ON CONFLICT répète l'expression ET le prédicat (42P10 sinon).
  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name, product)
    VALUES (NEW.user_id, v_venue_id, v_email, true, 'waitlist', 'waitlist', now(), v_first, v_last, NULL)
    ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now();
  ELSIF v_organizer_user_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name, product)
    VALUES (NEW.user_id, v_organizer_user_id, v_email, true, 'waitlist', 'waitlist', now(), v_first, v_last, NULL)
    ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une écriture marketing ne fait JAMAIS échouer l'inscription qu'elle observe.
  RAISE WARNING 'auto_subscribe_event_waitlist: % (entry %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_subscribe_guest_list_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text := lower(btrim(COALESCE(NEW.email, '')));
  v_first text;
  v_last text;
BEGIN
  IF v_email = '' THEN
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.newsletter_opt_in, false) OR COALESCE(NEW.platform_opt_in, false)) THEN
    RETURN NEW;
  END IF;

  -- Destinataire nommé sur la case cochée = celui qui reçoit l'abonnement.
  -- Une co-soirée org-led porte son club dans partner_venue_id : sans le
  -- COALESCE, la case nommait le club et l'abonnement n'allait nulle part.
  -- MIROIR de la résolution front (GuestListSignup consentScope).
  SELECT COALESCE(e.venue_id, e.partner_venue_id),
         COALESCE(e.organizer_user_id, e.partner_organizer_id)
    INTO v_venue_id, v_organizer_user_id
    FROM public.guest_lists gl
    JOIN public.events e ON e.id = gl.event_id
   WHERE gl.id = NEW.guest_list_id;

  v_first := NULLIF(split_part(btrim(COALESCE(NEW.full_name, '')), ' ', 1), '');
  v_last  := NULLIF(btrim(regexp_replace(COALESCE(NEW.full_name, ''), '^\S+\s*', '')), '');

  -- 2a. Le club, sinon l'organisateur. Les index d'unicité sont PARTIELS et
  -- portent sur lower(email) : la cible ON CONFLICT doit répéter l'expression
  -- ET le prédicat, sinon 42P10 à l'exécution (leçon du 08/08).
  IF COALESCE(NEW.newsletter_opt_in, false) THEN
    IF v_venue_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions
        (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name, product)
      VALUES (NEW.user_id, v_venue_id, v_email, true, 'guest_list', 'ticketing', now(), v_first, v_last, NULL)
      ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
            first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
            last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
            updated_at = now();
    ELSIF v_organizer_user_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions
        (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name, product)
      VALUES (NEW.user_id, v_organizer_user_id, v_email, true, 'guest_list', 'ticketing', now(), v_first, v_last, NULL)
      ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
            first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
            last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
            updated_at = now();
    END IF;
  END IF;

  -- 2b. Yuno. Arbitre = l'index PARTIEL uniq_newsletter_subs_email_platform.
  IF COALESCE(NEW.platform_opt_in, false) THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, venue_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    VALUES (NEW.user_id, NULL, NULL, v_email, true, 'platform:guest_list', 'ticketing', now(), v_first, v_last)
    ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une écriture marketing ne fait JAMAIS échouer l'inscription qu'elle
  -- observe. Même doctrine que le trigger d'achat et que les alertes admin.
  RAISE WARNING 'auto_subscribe_guest_list_entry: % (entry %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter_on_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text;
  v_user_id uuid;
  v_optin boolean;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT venue_id, organizer_user_id INTO v_venue_id, v_organizer_user_id
      FROM public.events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT tz.venue_id INTO v_venue_id
      FROM public.table_zones tz WHERE tz.id = NEW.zone_id;
    -- Zone event-scopée (soirée d'organisateur sans club) : venue_id NULL sur
    -- la zone. La portée est alors celle de la soirée — sans ce repli, un
    -- acheteur de table d'un organisateur n'entrait JAMAIS dans son registre.
    IF v_venue_id IS NULL AND NEW.event_id IS NOT NULL THEN
      SELECT venue_id, organizer_user_id INTO v_venue_id, v_organizer_user_id
        FROM public.events WHERE id = NEW.event_id;
    END IF;
  END IF;

  IF NOT v_optin OR v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Les index d'unicité sont PARTIELS et portent sur lower(email) : la cible
  -- ON CONFLICT doit répéter à la fois l'expression ET le prédicat, sinon
  -- Postgres ne trouve pas d'arbitre (42P10 à l'exécution).
  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source, product)
    VALUES (v_user_id, v_venue_id, LOWER(v_email), true, 'ticket_purchase', NULL)
    ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now();
  END IF;

  IF v_organizer_user_id IS NOT NULL AND v_venue_id IS NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source, product)
    VALUES (v_user_id, v_organizer_user_id, LOWER(v_email), true, 'ticket_purchase', NULL)
    ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- L'abonnement marketing est un effet de bord best-effort : s'il casse, on
  -- le journalise et la vente continue. Il a déjà bloqué toutes les ventes
  -- d'un club pendant des semaines — plus jamais.
  RAISE WARNING 'auto_subscribe_newsletter_on_purchase: % (table %, id %)', SQLERRM, TG_TABLE_NAME, NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer, ab_variant text, batch_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gate boolean := false;
  -- audit 18/10
  c record;
  v_marketing boolean := true;
  v_ids uuid[];
  v_skipped integer := 0;
  v_scope text;
  -- MAIL-03
  v_key text;
  v_open record;
  v_want integer;
  v_crm boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_campaign_recipients: service_role only';
  END IF;

  -- Phase de test A/B en cours : seules les lignes avec variante sont
  -- réclamables. Le reste attend le gagnant.
  SELECT ec.venue_id, ec.organizer_user_id, ec.name,
         (ec.ab_enabled AND COALESCE(ec.subject_b, '') <> '' AND ec.ab_winner IS NULL) AS gate,
         -- audit 18/10 : marketing = tout sauf l'e-mail de service et l'e-mail pratique.
         (COALESCE(ec.type, 'promotional') <> 'informational' AND NOT COALESCE(ec.practical, false)) AS marketing
    INTO c
    FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  v_gate := COALESCE(c.gate, false);
  v_crm := COALESCE(public.crm_campaign_is_crm(p_campaign_id), false);
  v_marketing := COALESCE(c.marketing, true);

  -- MAIL-03 : un lot déjà confié à Resend et pas encore soldé passe d'abord,
  -- en entier (quelle que soit p_limit : il a été dimensionné à sa première
  -- réclamation, ≤ 100), et seul. Il n'est repris que si TOUTES ses lignes
  -- sont rendues à la file et dues : une ligne encore « sending » veut dire
  -- qu'un autre worker l'a en main.
  FOR v_open IN
    SELECT r.batch_key AS k
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.batch_key IS NOT NULL
       AND r.status IN ('pending', 'sending')
     GROUP BY r.batch_key
    HAVING bool_and(r.status = 'pending' AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now()))
     ORDER BY min(r.created_at), r.batch_key
     LIMIT 5
  LOOP
    SELECT count(*) INTO v_want
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.batch_key = v_open.k AND r.status = 'pending';
    SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
      FROM (
        SELECT r.id
          FROM public.email_campaign_recipients r
         WHERE r.campaign_id = p_campaign_id AND r.batch_key = v_open.k AND r.status = 'pending'
         FOR UPDATE SKIP LOCKED
      ) x;
    IF v_ids IS NOT NULL AND cardinality(v_ids) = v_want THEN
      v_key := v_open.k;
      EXIT;
    END IF;
    v_ids := NULL; -- une partie du lot est verrouillée ailleurs : le suivant.
  END LOOP;

  IF v_key IS NULL THEN
    -- audit 18/10 : on verrouille d'abord le lot, on trie ensuite.
    SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
      FROM (
        SELECT r.id
          FROM public.email_campaign_recipients r
         WHERE r.campaign_id = p_campaign_id
           AND r.status = 'pending'
           AND r.batch_key IS NULL -- MAIL-03 : une ligne d'un lot ouvert repart avec son lot.
           AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
           AND (NOT v_gate OR r.ab_variant IS NOT NULL)
         ORDER BY r.id
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100))
         FOR UPDATE SKIP LOCKED
      ) x;
    IF v_ids IS NULL THEN
      RETURN;
    END IF;
    -- Clé neuve, unique : jamais deux lots différents sous la même clé.
    v_key := 'yb-' || left(p_campaign_id::text, 8) || '-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- audit 18/10 : l'accord se relit au moment de l'envoi, pas seulement à la
  -- mise en file.
  IF v_marketing THEN
    WITH bad AS (
      SELECT r.id,
             CASE WHEN EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = lower(r.email))
                  THEN 'policy:suppressed_after_queue'
                  ELSE 'policy:opted_out_after_queue' END AS reason
        FROM public.email_campaign_recipients r
       WHERE r.id = ANY (v_ids)
         AND (EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = lower(r.email))
              OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                          WHERE lower(ns.email) = lower(r.email) AND ns.opted_in = false
                            AND ns.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
                            AND ns.venue_id IS NOT DISTINCT FROM c.venue_id
                            AND ns.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id)
              OR EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = lower(r.email)
                            AND o.venue_id IS NOT DISTINCT FROM c.venue_id
                            AND o.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id))
    ), upd AS (
      UPDATE public.email_campaign_recipients q
         SET status = 'skipped', error_message = bad.reason, claimed_at = NULL
        FROM bad
       WHERE q.id = bad.id
      RETURNING 1
    )
    SELECT count(*) INTO v_skipped FROM upd;

    IF v_skipped > 0 THEN
      UPDATE public.email_campaigns
         SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + v_skipped
       WHERE id = p_campaign_id;
      v_scope := public.crm_scope_key(c.venue_id, c.organizer_user_id);
      IF v_scope IS NOT NULL AND public.crm_campaign_is_crm(p_campaign_id) THEN
        -- Débité à la mise en file, jamais parti : le Yunit revient.
        PERFORM public.crm_yunits_refund(v_scope, v_skipped, 'email', 'email_campaign', p_campaign_id::text, c.name);
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  UPDATE public.email_campaign_recipients r
     SET status = 'sending',
         claimed_at = now(),
         attempts = r.attempts + 1,
         batch_key = v_key -- MAIL-03
   WHERE r.id = ANY (v_ids)
     AND r.status = 'pending'
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts, r.ab_variant, r.batch_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.collect_campaign_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  tpl RECORD;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
  v_parents integer := 0;
  v_crm boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_followups: service_role only';
  END IF;

  FOR p IN
    SELECT c.id, c.name, c.venue_id, c.organizer_user_id, c.event_id, c.quiet_hours,
           c.followup_delay_hours AS delay_h, c.followup_template_id, c.followup_campaign_id,
           c.resend_campaign_id,
           e.start_at
      FROM public.email_campaigns c
      JOIN public.events e ON e.id = c.event_id
     WHERE c.followup_enabled
       AND c.parent_campaign_id IS NULL
       AND c.followup_template_id IS NOT NULL
       AND c.event_id IS NOT NULL
       AND c.status IN ('sent', 'sending', 'paused')
       AND c.type = 'promotional'
       AND e.start_at > now() - interval '7 days'
  LOOP
    v_parents := v_parents + 1;
    v_crm := COALESCE(public.crm_campaign_is_crm(p.id), false);

    WITH clicks AS (
      SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS first_click
        FROM public.email_campaign_events ev
       WHERE ev.campaign_id IN (p.id, p.resend_campaign_id)
         AND ev.event_type = 'clicked'
         AND COALESCE(ev.metadata->'click'->>'link', ev.metadata->>'link', '')
             ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)'
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email))
       GROUP BY lower(ev.recipient_email)
    ),
    due AS (
      SELECT c.em, c.first_click, c.first_click + make_interval(hours => p.delay_h) AS due_at
        FROM clicks c
       WHERE c.first_click + make_interval(hours => p.delay_h) <= now()
         AND NOT EXISTS (SELECT 1 FROM public.email_campaign_followups f
                          WHERE f.parent_campaign_id = p.id AND lower(f.email) = c.em)
    ),
    judged AS (
      SELECT d.em, d.first_click, d.due_at,
             CASE
               WHEN d.due_at >= p.start_at THEN 'event_over'
               WHEN public.is_email_suppressed(d.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = d.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND s.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
               ) THEN 'unsubscribed'
               WHEN EXISTS (
                 SELECT 1 FROM public.tickets t
                  WHERE NOT v_crm AND t.event_id = p.event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE NOT v_crm AND r.event_id = p.event_id AND r.status IN ('paid', 'confirmed') AND lower(r.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.external_tickets xt
                  WHERE v_crm AND xt.event_id = p.event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = d.em
               ) THEN 'bought'
               WHEN NOT v_crm AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                  JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p.event_id AND lower(ge.email) = d.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               WHEN EXISTS (
                 SELECT 1 FROM public.email_campaign_followups f2
                  WHERE f2.event_id = p.event_id AND lower(f2.email) = d.em AND f2.status = 'queued'
               ) THEN 'already_event'
               ELSE NULL
             END AS reason
        FROM due d
    ),
    ins AS (
      INSERT INTO public.email_campaign_followups
        (parent_campaign_id, event_id, email, clicked_at, due_at, status, skip_reason)
      SELECT p.id, p.event_id, j.em, j.first_click, j.due_at,
             CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

    SELECT count(*) INTO v_new
      FROM public.email_campaign_followups f
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;
    IF v_new = 0 THEN CONTINUE; END IF;

    v_child := p.followup_campaign_id;
    IF v_child IS NULL THEN
      SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = p.followup_template_id;
      IF tpl.id IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.email_campaigns
        (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
         theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
         quiet_hours, parent_campaign_id, child_kind, total_recipients, created_by, product)
      VALUES
        (p.venue_id, p.organizer_user_id, 'Relance · ' || p.name, 'promotional',
         COALESCE(NULLIF(tpl.subject, ''), 'Relance'), COALESCE(tpl.preheader, ''),
         COALESCE(tpl.blocks_json, '[]'::jsonb), 2,
         COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
         p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
         p.quiet_hours, p.id, 'followup', 0, tpl.created_by, CASE WHEN v_crm THEN 'crm' END)
      RETURNING id INTO v_child;
      UPDATE public.email_campaigns SET followup_campaign_id = v_child WHERE id = p.id;
    END IF;

    WITH todo AS (
      SELECT f.id, lower(f.email) AS em
        FROM public.email_campaign_followups f
       WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL
    ),
    ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
        FROM todo t
        LEFT JOIN LATERAL (
          SELECT s.first_name, s.last_name, s.unsubscribe_token
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = t.em
             AND s.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
           LIMIT 1
        ) s ON true
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    UPDATE public.email_campaign_followups f
       SET followup_campaign_id = v_child
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;

    UPDATE public.email_campaigns
       SET status = 'sending', paused_reason = NULL, error_message = NULL,
           total_recipients = COALESCE(total_recipients, 0) + v_new
     WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object(
    'parents', v_parents, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.collect_campaign_resends()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_child uuid;
  v_new integer;
  v_parents integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
  v_crm boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_resends: service_role only';
  END IF;

  FOR p IN
    SELECT c.*, e.start_at AS event_start_at
      FROM public.email_campaigns c
      LEFT JOIN public.events e ON e.id = c.event_id
     WHERE c.resend_enabled
       AND c.resend_done_at IS NULL
       AND c.resend_campaign_id IS NULL
       AND c.child_kind IS NULL
       AND c.parent_campaign_id IS NULL
       AND c.automation_id IS NULL
       AND c.status = 'sent'
       AND c.type = 'promotional'
       AND c.sent_at IS NOT NULL
       AND c.sent_at + make_interval(hours => c.resend_delay_hours) <= now()
       AND c.sent_at > now() - interval '10 days'
     ORDER BY c.sent_at
     LIMIT 20
  LOOP
    v_parents := v_parents + 1;
    v_crm := COALESCE(public.crm_campaign_is_crm(p.id), false);

    IF p.event_start_at IS NOT NULL AND p.event_start_at <= now() + interval '2 hours' THEN
      UPDATE public.email_campaigns SET resend_done_at = now() WHERE id = p.id;
      CONTINUE;
    END IF;

    INSERT INTO public.email_campaigns
      (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
       theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
       quiet_hours, throttle_per_hour, throttle_window_minutes, parent_campaign_id, child_kind,
       total_recipients, created_by, product)
    VALUES
      (p.venue_id, p.organizer_user_id, left('Renvoi · ' || p.name, 80), 'promotional',
       COALESCE(NULLIF(p.resend_subject, ''), p.subject), COALESCE(p.preheader, ''),
       COALESCE(p.blocks_json, '[]'::jsonb), COALESCE(p.blocks_version, 1),
       COALESCE(p.theme_json, '{}'::jsonb), COALESCE(p.social_links_json, '{}'::jsonb), p.logo_url,
       p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
       true, p.throttle_per_hour, COALESCE(p.throttle_window_minutes, 60), p.id, 'resend',
       0, p.created_by, CASE WHEN v_crm THEN 'crm' END)
    RETURNING id INTO v_child;

    WITH base AS (
      SELECT r.email, r.first_name, r.last_name, r.unsubscribe_token, r.user_id
        FROM public.email_campaign_recipients r
       WHERE r.campaign_id = p.id
         AND r.status = 'sent'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_campaign_events ev
            WHERE ev.campaign_id = p.id AND lower(ev.recipient_email) = lower(r.email)
              AND ev.event_type IN ('opened', 'clicked', 'bounced', 'complained', 'unsubscribed')
         )
         AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions s
            WHERE lower(s.email) = lower(r.email) AND s.opted_in AND s.opted_out_at IS NULL
              AND s.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
              AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
         )
         AND (p.event_id IS NULL OR NOT (
           EXISTS (SELECT 1 FROM public.tickets t
                    WHERE NOT v_crm AND t.event_id = p.event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.table_reservations tr
                       WHERE NOT v_crm AND tr.event_id = p.event_id AND tr.status IN ('paid', 'confirmed', 'used') AND lower(tr.user_email) = lower(r.email))
           -- Yuno CRM : déjà acheté sur la billetterie connectée.
           OR EXISTS (SELECT 1 FROM public.external_tickets xt
                       WHERE v_crm AND xt.event_id = p.event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                       WHERE NOT v_crm AND gl.event_id = p.event_id AND lower(ge.email) = lower(r.email)
                         AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
         ))
    ),
    -- Règles Yuno : suppression, pression du palier campagne, fatigue — en
    -- UNE passe sur tout le lot (ligne à ligne, un renvoi à 9 000 non-ouvreurs
    -- dépassait le plafond de 8 s de l'API).
    pol AS (
      SELECT x.email, x.reason
        FROM public._email_send_policy_many(ARRAY(SELECT lower(b.email) FROM base b), 'resend') x
    ),
    ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, user_id, status)
      SELECT v_child, b.email, b.first_name, b.last_name, b.unsubscribe_token, b.user_id, 'pending'
        FROM base b
        JOIN pol ON pol.email = lower(b.email) AND pol.reason IS NULL
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    IF v_new = 0 THEN
      DELETE FROM public.email_campaigns WHERE id = v_child;
      UPDATE public.email_campaigns SET resend_done_at = now() WHERE id = p.id;
      CONTINUE;
    END IF;

    UPDATE public.email_campaigns SET total_recipients = v_new WHERE id = v_child;
    UPDATE public.email_campaigns SET resend_campaign_id = v_child, resend_done_at = now() WHERE id = p.id;
    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object('parents', v_parents, 'enqueued', v_enqueued, 'children', to_jsonb(v_children));
END;
$function$;

CREATE OR REPLACE FUNCTION public.collect_email_automations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_holdout integer := 0;
  a RECORD;
  tpl RECORD;
  grp RECORD;
  v_delay interval;
  v_next uuid;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_automations integer := 0;
  v_children uuid[] := '{}';
  v_blocks jsonb;
  v_name text;
  v_label text;
  v_platform boolean;
  -- Une recette « à toute la base » travaille par LOTS : une personne déjà
  -- inscrite au registre pour ce déclencheur n'est plus candidate, le passage
  -- suivant (5 min plus tard) prend le lot suivant. Avant, le LIMIT tombait
  -- AVANT ce filtre : les 5 000 premiers revenaient à chaque passage et le
  -- reste de la base ne recevait jamais rien.
  v_batch constant integer := 3000;
  -- L'appel passe par l'API (plafond de 8 s) : au-delà de ce budget, les
  -- recettes restantes attendent le passage suivant plutôt que de faire
  -- tomber TOUT le passage (et les recettes de tous les comptes avec lui).
  v_started timestamptz := clock_timestamp();
  v_budget_hit boolean := false;
  -- Compte Yuno CRM pur : les e-mails automatiques se paient en Yunits. Ce que
  -- le solde ne couvre pas n'est pas inscrit au registre (il reviendra).
  v_scope text;
  v_rate integer;
  v_room integer;
  v_held integer := 0;
  -- Séparation CRM / Billetterie : le produit est celui de la RECETTE (une ligne par portée, type ET produit).
  v_crm boolean := false;
  v_prod text;
  v_same uuid[];
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_email_automations: service_role only';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _auto_cand (
    em text,
    trigger_key text,
    trigger_event_id uuid,
    bind_event_id uuid,
    due_at timestamptz,
    optin boolean,
    user_id uuid,
    first_name text,
    last_name text,
    -- Ordre de priorité entre plusieurs soirées d'un même contact dans un
    -- même passage (la plus proche d'abord) : voir le cooldown intra-passage.
    ord timestamptz
  ) ON COMMIT DROP;

  -- Les pros d'abord, Yuno en dernier : à soirée égale, le pro passe avant (R5).
  -- Puis par PRIORITÉ de recette : un contact ne reçoit qu'une automatisation
  -- par passage (cooldown), c'est donc l'ordre ci-dessous qui décide laquelle —
  -- l'urgent (panier, tarif) avant la relation (merci, on t'a manqué), la vente
  -- (table, dernier appel, annonce) avant l'accueil (bienvenue, reconquête).
  FOR a IN
    SELECT x.*, (x.venue_id IS NULL AND x.organizer_user_id IS NULL) AS is_platform
      FROM public.email_automations x
     WHERE x.enabled AND x.template_id IS NOT NULL AND x.enabled_at IS NOT NULL
       -- Démo : une recette allumée s'affiche, elle n'envoie JAMAIS.
       AND NOT public.is_demo_marketing_scope(x.venue_id, x.organizer_user_id)
     ORDER BY (x.venue_id IS NULL AND x.organizer_user_id IS NULL),
              CASE x.kind
                WHEN 'abandoned_checkout' THEN 0 WHEN 'tier_closing' THEN 1 WHEN 'click_no_buy' THEN 1
                WHEN 'post_event_thanks' THEN 2 WHEN 'post_event_missed' THEN 3
                WHEN 'table_upsell' THEN 4 WHEN 'last_call' THEN 5 WHEN 'new_event' THEN 6
                WHEN 'regular_lapse' THEN 7 WHEN 'first_return' THEN 7 WHEN 'welcome' THEN 8 ELSE 9 END,
              x.created_at
  LOOP
    v_platform := a.is_platform;
    -- Les recettes de SOIRÉE n'ont pas de sens à l'échelle de Yuno : pas de
    -- dernier appel, d'annonce, de palier ni d'upsell à toute la base pour
    -- chaque soirée de chaque club.
    -- « L'habitué décroche » non plus : un rythme de sortie se lit chez UN
    -- club ou UN organisateur, pas sur toute la plateforme.
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse', 'click_no_buy', 'first_return') THEN CONTINUE; END IF;
    IF clock_timestamp() - v_started > interval '4 seconds' THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    -- Produit de la recette : email_automations.product = 'crm', recettes CRM-only (click_no_buy, first_return) ou compte CRM pur.
    -- La portée plateforme (Yuno) n'est jamais CRM.
    v_crm := NOT v_platform AND COALESCE(public._email_recipe_is_crm(a.product, a.kind, a.venue_id, a.organizer_user_id), false);
    v_prod := CASE WHEN v_crm THEN 'crm' END;
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id, v_prod) END;
    TRUNCATE _auto_cand;
    v_room := NULL;
    v_holdout := 0;
    IF NOT v_platform THEN
      v_scope := public.crm_scope_key(a.venue_id, a.organizer_user_id);
      IF v_scope IS NOT NULL AND v_crm THEN
        -- Témoin (20261013120000) : une part tirée au hasard ne reçoit pas la recette.
        v_holdout := public.crm_holdout_pct(v_scope);
        IF public.crm_effective_plan(v_scope) = 'paused' THEN
          v_room := 0;
        ELSE
          v_rate := GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));
          v_room := GREATEST(0, COALESCE(public.crm_yunits_balance(v_scope), 0) / v_rate
                    - (SELECT count(*)::integer FROM public.email_automation_sends l
                        WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL));
        END IF;
      END IF;
    END IF;

    -- ── 5a. Candidats par recette ─────────────────────────────────────────
    IF a.kind = 'welcome' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'once', NULL, v_next, s.created_at + v_delay, true, s.user_id, s.first_name, s.last_name, s.created_at + v_delay
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.product IS NOT DISTINCT FROM v_prod
         AND s.import_id IS NULL
         AND COALESCE(s.source, '') NOT LIKE 'import%'
         AND (v_platform OR COALESCE(s.source, '') NOT LIKE 'platform%')
         AND COALESCE(s.source, '') NOT LIKE 'checkout%'
         -- Yuno CRM : un accord rapporté par une billetterie connectée n'est pas
         -- une inscription : jamais de « bienvenue » à tout un historique importé.
         AND COALESCE(s.source, '') NOT LIKE 'connector%'
         AND COALESCE(s.source, '') NOT LIKE 'platform:checkout%'
         AND s.created_at >= a.enabled_at
         AND s.created_at >= now() - interval '14 days'
         AND s.created_at + v_delay <= now()
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email))
       LIMIT 500;

    ELSIF a.kind = 'abandoned_checkout' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(x.em), x.event_id)
             lower(x.em), x.event_id::text, x.event_id, x.event_id, x.created_at + v_delay,
             x.optin, x.user_id, x.first_name, x.last_name, x.created_at + v_delay
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at, COALESCE(t.newsletter_opt_in, false) AS optin, t.user_id,
                 COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS first_name,
                 COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS last_name
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND t.created_at >= a.enabled_at
             AND t.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at, COALESCE(r.newsletter_opt_in, false), r.user_id,
                 COALESCE(r.guest_first_name, NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), '')),
                 COALESCE(r.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(r.full_name, ''), '^\S+\s*', '')), ''))
            FROM public.table_reservations r
            JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND r.created_at >= a.enabled_at
             AND r.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
        ) x
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = x.event_id::text AND lower(l.email) = lower(x.em))
       ORDER BY lower(x.em), x.event_id, x.optin DESC, x.created_at DESC
       LIMIT 500;

      -- L'accord coché au checkout est versé dans le registre du CLUB ou de
      -- l'ORGANISATEUR (c'est leur case, pas celle de Yuno).
      IF a.venue_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.venue_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      ELSIF a.organizer_user_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.organizer_user_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      END IF;

    ELSIF a.kind = 'last_call' THEN
      -- N h avant chaque soirée qui a encore quelque chose à vendre : toute la
      -- base opt-in (imports compris), les plus engagés d'abord, par lots
      -- (v_batch) : qui est déjà au registre pour cette soirée sort du lot.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
           AND s.product IS NOT DISTINCT FROM v_prod
         WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.start_at > a.enabled_at
           AND e.start_at - v_delay <= now()
           AND e.start_at > now() + interval '2 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id, v_prod) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, now(), true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'new_event' THEN
      -- Annonce d'une soirée PUBLIÉE (published_at, jamais created_at, jamais
      -- une re-génération de modèle récurrent), N h après la mise en ligne, à
      -- toute la base opt-in — c'est LA recette qui met un fichier importé au
      -- travail. Le jugement écarte la rafale (une seule annonce par
      -- publication groupée sous 24 h) puis applique le cooldown.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, e.published_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
           AND s.product IS NOT DISTINCT FROM v_prod
         WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
           AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.published_at IS NOT NULL
           AND e.published_at >= a.enabled_at
           AND e.published_at >= now() - interval '7 days'
           AND e.published_at + v_delay <= now()
           AND e.start_at > now() + interval '48 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND (e.recurring_template_id IS NULL OR NOT EXISTS (
                 SELECT 1 FROM public.events e2
                  WHERE e2.recurring_template_id = e.recurring_template_id
                    AND e2.id <> e.id AND e2.created_at < e.created_at))
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id, v_prod) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, p.published_at + v_delay, true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'table_upsell' THEN
      -- « Passe en table » : N h avant le début, aux détenteurs d'un billet
      -- payé, tant que la soirée ouvre des tables et qu'il en reste au moins
      -- une (même calcul que le bloc Table VIP de l'email : formules actives
      -- moins réservations, formules marquées complètes exclues).
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(t.user_email), e.id)
             lower(t.user_email), e.id::text, e.id, e.id, now(), true, t.user_id,
             COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')),
             COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')),
             e.start_at
        FROM public.events e
        JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
        JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
       WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
         AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
           OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
         AND e.tables_enabled AND NOT e.tables_sold_out
         AND COALESCE(tl.n, 0) > 0
         AND e.start_at > a.enabled_at
         AND e.start_at - v_delay <= now()
         AND e.start_at > now() + interval '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(t.user_email))
       ORDER BY lower(t.user_email), e.id, t.created_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'tier_closing' THEN
      v_same := public._email_scope_campaign_ids(a.venue_id, a.organizer_user_id, v_crm);
      -- « Le tarif monte » : le palier ouvert a dépassé le seuil, il reste au
      -- moins un billet et un palier suivant plus cher existe. Cible = ceux qui
      -- ont montré un intérêt sans acheter : clic sur la soirée dans un email
      -- de la portée, ou inscrit en liste d'attente. Un seul envoi par personne
      -- et par soirée, quel que soit le nombre de paliers.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (p.em, p.event_id)
             p.em, p.event_id::text, p.event_id, p.event_id, now(), true, NULL, NULL, NULL, p.start_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.slug, e.start_at
              FROM public.events e
              JOIN LATERAL (
                SELECT r.position, r.price
                  FROM public.ticket_rounds r
                 WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
                   AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
                   AND r.tickets_sold * 100 >= r.max_tickets * a.threshold_pct
                 ORDER BY r.position LIMIT 1
              ) cur ON true
             WHERE e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
               AND e.ticketing_enabled AND NOT e.tickets_sold_out
               AND e.start_at > a.enabled_at
               AND e.start_at > now() + interval '2 hours'
               AND EXISTS (
                 SELECT 1 FROM public.ticket_rounds n
                  WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                    AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
          )
          SELECT ev.id AS event_id, lower(x.recipient_email) AS em, ev.start_at
            FROM ev
            JOIN public.email_campaigns c
              ON public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
             AND c.id = ANY (v_same)
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
           WHERE x.created_at > now() - interval '60 days'
             AND x.recipient_email IS NOT NULL
             AND (
               (c.event_id = ev.id AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '')
                  ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)')
               OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || ev.id::text || '%'
               OR (ev.slug IS NOT NULL AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/events/%/' || ev.slug || '%')
             )
          UNION
          SELECT w.event_id, lower(w.email), ev.start_at
            FROM public.event_waitlist w JOIN ev ON ev.id = w.event_id
           WHERE w.email IS NOT NULL
        ) p
       WHERE p.em IS NOT NULL AND position('@' in p.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em)
       ORDER BY p.em, p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'click_no_buy' THEN
      v_same := public._email_scope_campaign_ids(a.venue_id, a.organizer_user_id, v_crm);
      -- « A cliqué sans acheter » : un clic NOMINATIF dans un e-mail de la
      -- portée vers la billetterie d'une soirée à venir, puis aucune place à
      -- la même adresse N h après le DERNIER clic (jugé plus bas, au moment
      -- où l'envoi est dû). Une visite venue d'ailleurs est anonyme : jamais
      -- ici. Une relance due depuis plus de 24 h ne part plus.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT k.em, k.eid::text, k.eid, k.eid, k.last_click + v_delay, true, NULL, NULL, NULL, k.start_at
        FROM (
          SELECT lower(x.recipient_email) AS em, e.id AS eid, e.start_at, max(x.created_at) AS last_click
            FROM public.email_campaigns c
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
            JOIN public.events e
              ON e.status = 'active' AND (CASE WHEN v_crm THEN e.external_source IS NOT NULL ELSE (e.is_active AND e.external_source IS NULL) END) AND e.cancelled_at IS NULL
             AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND e.start_at > now() + interval '2 hours'
             AND NOT e.tickets_sold_out
             AND (
               -- Bouton d'un e-mail CRM : la page de CETTE soirée sur la billetterie connectée.
               (e.external_ticket_url IS NOT NULL
                AND public._link_base(COALESCE(x.metadata->'click'->>'link', x.metadata->>'link')) = public._link_base(e.external_ticket_url))
               -- Lien Yuno (suivi /l/, page soirée) d'une campagne reliée à cette soirée.
               OR (c.event_id = e.id
                   AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/')
             )
           WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
             AND c.id = ANY (v_same)
             AND x.recipient_email IS NOT NULL
             AND x.created_at > now() - v_delay - interval '24 hours'
             -- Un vrai destinataire de la campagne : jamais l'envoi de test du pro.
             AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                          WHERE r.campaign_id = c.id AND lower(r.email) = lower(x.recipient_email))
           GROUP BY lower(x.recipient_email), e.id, e.start_at
        ) k
       WHERE k.last_click + v_delay <= now()
         AND k.last_click + v_delay > now() - interval '24 hours'
         AND position('@' in k.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = k.eid::text AND lower(l.email) = k.em)
       ORDER BY k.start_at, k.em
       LIMIT v_batch;

    ELSIF a.kind IN ('post_event_thanks', 'post_event_missed') THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(p.em), p.event_id)
             lower(p.em), p.event_id::text, p.event_id, v_next, now(), true, NULL, NULL, NULL, p.end_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.end_at
              FROM public.events e
             WHERE e.status = 'active' AND e.cancelled_at IS NULL
               AND (e.external_source IS NOT NULL) = v_crm
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
               AND e.end_at >= a.enabled_at
               AND e.end_at + v_delay <= now()
               AND e.end_at >= now() - interval '5 days'
          ),
          came AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND ge.entry_scanned
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          holders AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'confirmed', 'used')
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          -- « On t'a manqué » seulement sur une soirée à porte mesurée
          -- (_crm_door_measured : au moins 10 détenteurs scannés et 10 % d'entre
          -- eux, 20261020200000). Shotgun laisse le scan vide
          -- quand un AUTRE prestataire a scanné, et une porte qui a arrêté de
          -- scanner ferait écrire « on t'a manqué » à des gens venus.
          scanned_events AS (
            SELECT hc.event_id FROM (SELECT event_id, count(*) AS n FROM holders GROUP BY event_id) hc
              JOIN (SELECT event_id, count(*) AS n FROM came GROUP BY event_id) cc ON cc.event_id = hc.event_id
             WHERE public._crm_door_measured(hc.n, cc.n))
          SELECT c.event_id, c.em, ev.end_at FROM came c JOIN ev ON ev.id = c.event_id WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em, ev.end_at FROM holders h
            JOIN ev ON ev.id = h.event_id
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = lower(p.em))
       ORDER BY lower(p.em), p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'win_back' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'wb-' || to_char(now(), 'YYYY-MM'), NULL, v_next, now(), true, s.user_id, s.first_name, s.last_name, now()
        FROM public.newsletter_subscriptions s
        JOIN (
          SELECT x.em, max(x.at) AS last_at FROM (
            SELECT lower(t.user_email) AS em, t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
             WHERE NOT v_crm AND t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT lower(r.user_email), r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
             WHERE NOT v_crm AND r.user_email IS NOT NULL AND r.status IN ('paid', 'confirmed', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT lower(ge.email), ge.entry_scanned_at FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
             WHERE NOT v_crm AND ge.email IS NOT NULL AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
             WHERE v_crm AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND xt.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND xt.organizer_user_id = a.organizer_user_id))
          ) x
         GROUP BY x.em
        ) act ON act.em = lower(s.email)
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.product IS NOT DISTINCT FROM v_prod
         AND act.last_at IS NOT NULL
         AND act.last_at <= now() - v_delay
         AND act.last_at > now() - v_delay - interval '120 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '180 days'
         )
         -- L'habitué relancé par « il décroche » n'est pas reconquis trois
         -- semaines plus tard : la même personne, le même silence, un seul email.
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.kind = 'regular_lapse' AND l.status = 'queued' AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '60 days'
              AND EXISTS (SELECT 1 FROM public.email_automations x2 WHERE x2.id = l.automation_id
                         AND COALESCE(public._email_recipe_is_crm(x2.product, x2.kind, x2.venue_id, x2.organizer_user_id), false) = v_crm)
              AND l.venue_id IS NOT DISTINCT FROM a.venue_id
              AND l.organizer_user_id IS NOT DISTINCT FROM a.organizer_user_id
         )
      ORDER BY public._email_engagement_rank(lower(s.email), a.venue_id, a.organizer_user_id, v_prod) ASC, act.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'regular_lapse' THEN
      -- « L'habitué décroche » : deux sorties par mois puis plus rien depuis
      -- N jours (six semaines par défaut). Détection et choix de la soirée
      -- par personne dans _regular_lapse_candidates (ses goûts : la série qu'il
      -- fréquentait, ses genres, son jour de sortie). Un épisode de silence =
      -- un email (trigger_key = date de la dernière venue), et pas plus d'un
      -- tous les 120 jours. Sans aucune soirée à venir, personne : une
      -- invitation sans soirée n'invite à rien — le prochain passage le reprend.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'rl-' || to_char(r.last_at, 'YYYY-MM-DD'), NULL, COALESCE(r.pick_event_id, v_next), now(), true,
             COALESCE(s.user_id, r.user_id), s.first_name, s.last_name, now()
        FROM public._regular_lapse_candidates(a.venue_id, a.organizer_user_id, v_delay, v_prod) r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND s.product IS NOT DISTINCT FROM v_prod
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = r.em
              AND l.created_at > now() - interval '120 days'
         )
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id, v_prod) ASC, r.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'first_return' THEN
      -- « Faire revenir après la 1re soirée » (20261011130000) : venus une seule
      -- fois, pas de passage, la 1re soirée finie depuis le délai médian de
      -- retour du compte ; la soirée choisie POUR la personne (concept, artiste
      -- déjà vu, genre, jour) dans _first_return_candidates. Une fois par
      -- personne (trigger_key 'fr'). Rien sans soirée à venir.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'fr', NULL, COALESCE(r.pick_event_id, v_next), r.due_at, true,
             s.user_id, s.first_name, s.last_name, r.due_at
        FROM public._first_return_candidates(a.venue_id, a.organizer_user_id, a.enabled_at - interval '7 days') r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND s.product IS NOT DISTINCT FROM v_prod
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id, v_prod) ASC, r.due_at ASC
       LIMIT 300;
    END IF;

    -- ── 5b. Jugement, au moment où l'envoi est dû ─────────────────────────
    WITH cand AS (
      SELECT DISTINCT ON (c.em, c.trigger_key) c.*
        FROM _auto_cand c
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = c.trigger_key AND lower(l.email) = c.em
       )
       ORDER BY c.em, c.trigger_key, c.optin DESC
    ),
    -- Règles Yuno (pression, fatigue, aversion) calculées en UNE passe sur
    -- tout le lot : appelées ligne à ligne, elles coûtaient ~1 ms par contact
    -- (14 s pour une base de 12 000), au-delà du plafond de l'API.
    pol AS (
      SELECT p.email, p.reason
        FROM public._email_send_policy_many(ARRAY(SELECT DISTINCT c.em FROM cand c), a.kind) p
    ),
    -- Rafale de publications : jugée une fois par SOIRÉE, pas par contact.
    burst AS (
      SELECT x.eid FROM (SELECT DISTINCT c.trigger_event_id AS eid FROM cand c
                          WHERE a.kind = 'new_event' AND c.trigger_event_id IS NOT NULL) x
       WHERE EXISTS (
         SELECT 1 FROM public.events e
           JOIN public.events e2 ON e2.id <> e.id
            AND e2.status = 'active' AND (CASE WHEN v_crm THEN e2.external_source IS NOT NULL ELSE (e2.is_active AND e2.external_source IS NULL) END) AND e2.cancelled_at IS NULL
            AND (e2.visibility = 'public' OR e2.external_source IS NOT NULL)
            AND e2.venue_id IS NOT DISTINCT FROM e.venue_id
            AND e2.organizer_user_id IS NOT DISTINCT FROM e.organizer_user_id
            AND e2.published_at IS NOT NULL AND e2.published_at >= a.enabled_at
            AND abs(extract(epoch FROM (e2.published_at - e.published_at))) <= 86400
            AND e2.start_at > now() + interval '48 hours'
            AND (e2.start_at < e.start_at OR (e2.start_at = e.start_at AND e2.id < e.id))
          WHERE e.id = x.eid)
    ),
    judged0 AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL
                    AND a.kind IN ('last_call', 'abandoned_checkout', 'table_upsell', 'tier_closing', 'new_event', 'click_no_buy')
                    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.trigger_event_id AND e.start_at <= now())
                 THEN 'event_over'
               -- R5 : quelqu'un d'autre (club, orga du co-event, Yuno) l'a déjà
               -- écrit pour cette soirée et cette recette.
               WHEN c.trigger_event_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.kind = a.kind AND l.trigger_event_id = c.trigger_event_id
                    AND lower(l.email) = c.em AND l.status = 'queued'
               ) THEN 'already_event'
               -- Rafale de publications : un club qui met 6 dates en ligne
               -- d'un coup n'annonce que la plus proche ; les autres sont
               -- tracées ici pour que le bilan l'explique.
               WHEN a.kind = 'new_event' AND c.trigger_event_id IN (SELECT b.eid FROM burst b) THEN 'already_event'
               WHEN public.is_email_suppressed(c.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND s.product IS NOT DISTINCT FROM v_prod
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
               ) THEN CASE WHEN a.kind = 'abandoned_checkout' THEN 'no_consent' ELSE 'unsubscribed' END
               WHEN a.kind = 'table_upsell' AND EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = c.trigger_event_id AND lower(r.user_email) = c.em
                    AND r.status IN ('paid', 'used', 'confirmed', 'pending')
               ) THEN 'has_table'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE NOT v_crm AND t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE NOT v_crm AND r.event_id = c.trigger_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = c.em)
                 -- Yuno CRM : déjà acheté sur la billetterie connectée.
                 OR EXISTS (SELECT 1 FROM public.external_tickets xt
                             WHERE v_crm AND xt.event_id = c.trigger_event_id AND xt.status IN ('valid', 'transferred')
                               AND (lower(xt.buyer_email) = c.em OR lower(xt.holder_email) = c.em))
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND NOT v_crm AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               -- Une automatisation par 48 h et par portée ; les trois recettes
               -- URGENTES (panier abandonné, tarif qui monte, clic sans achat)
               -- font exception : elles répondent à un geste du client.
               WHEN a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND EXISTS (SELECT 1 FROM public.email_automations x2 WHERE x2.id = l.automation_id
                         AND COALESCE(public._email_recipe_is_crm(x2.product, x2.kind, x2.venue_id, x2.organizer_user_id), false) = v_crm)
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id)
                      OR (v_platform AND l.venue_id IS NULL AND l.organizer_user_id IS NULL))
               ) THEN 'cooldown'
               -- Règles Yuno (pression, fatigue, aversion), tous expéditeurs.
               ELSE pol.reason
             END AS reason
        FROM cand c
        LEFT JOIN pol ON pol.email = c.em
    ),
    -- Cooldown INTRA-passage : plusieurs soirées dues en même temps pour un
    -- même contact (trois dates à J-3, six publications d'un coup) ne font
    -- qu'UN email — la plus proche ; les autres sont tracées « cooldown ».
    -- Les lignes insérées par une même instruction sont invisibles aux
    -- sous-requêtes du CASE ci-dessus, d'où ce second temps.
    judged AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE
               WHEN j.reason IS NULL AND a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy')
                    AND row_number() OVER (PARTITION BY j.em, (j.reason IS NULL) ORDER BY j.ord NULLS LAST, j.trigger_key) > 1
                 THEN 'cooldown'
               ELSE j.reason
             END AS reason
        FROM judged0 j
    ),
    -- Yunits : seuls les v_room premiers envois dus entrent au registre ; les
    -- autres reviennent au passage suivant (après une recharge).
    -- « 10 % non contactés, pour mesurer l'effet réel » (20261013120000) :
    -- parmi ceux qui allaient recevoir la recette, AVANT le compte des Yunits.
    judged1 AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE WHEN j.reason IS NULL AND v_holdout > 0
                       AND public._crm_holdout_pick(a.id::text || ':' || j.trigger_key, j.em, v_holdout)
                  THEN 'holdout' ELSE j.reason END AS reason
        FROM judged j
    ),
    judged2 AS (
      SELECT j.*,
             CASE WHEN j.reason IS NULL
                  THEN row_number() OVER (PARTITION BY (j.reason IS NULL) ORDER BY j.due_at, j.em, j.trigger_key) END AS qn
        FROM judged1 j
    ),
    held AS (
      SELECT count(*)::integer AS n FROM judged2 j
       WHERE j.reason IS NULL AND v_room IS NOT NULL AND j.qn > v_room
    ),
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged2 j
       WHERE j.reason IS NOT NULL OR v_room IS NULL OR j.qn <= v_room
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped'),
           v_held + (SELECT h.n FROM held h)
      INTO v_queued, v_skipped, v_held FROM ins;

    -- ── 5c. Campagnes enfants ─────────────────────────────────────────────
    SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = a.template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    FOR grp IN
      SELECT l.bind_event_id, l.trigger_event_id, count(*) AS n
        FROM public.email_automation_sends l
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
       GROUP BY l.bind_event_id, l.trigger_event_id
    LOOP
      SELECT c.id INTO v_child
        FROM public.email_campaigns c
       WHERE c.automation_id = a.id
         AND c.event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND c.automation_trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
         AND (grp.bind_event_id IS NOT NULL OR grp.trigger_event_id IS NOT NULL
              OR c.created_at >= date_trunc('month', now()))
         AND c.status NOT IN ('cancelled', 'failed')
       ORDER BY c.created_at DESC
       LIMIT 1;

      IF v_child IS NULL THEN
        SELECT COALESCE(e.title, '') INTO v_label
          FROM public.events e WHERE e.id = COALESCE(grp.trigger_event_id, grp.bind_event_id);
        IF v_label IS NULL OR v_label = '' THEN v_label := to_char(now(), 'YYYY-MM'); END IF;
        v_name := left(COALESCE(NULLIF(tpl.name, ''), a.kind) || ' · ' || v_label, 80);
        v_blocks := CASE WHEN grp.bind_event_id IS NULL
                         THEN public._email_blocks_without_live(tpl.blocks_json)
                         ELSE COALESCE(tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, automation_id, automation_trigger_event_id, child_kind, total_recipients, created_by, product)
        VALUES
          (a.venue_id, a.organizer_user_id, v_name, 'promotional',
           COALESCE(NULLIF(a.subject, ''), NULLIF(tpl.subject, ''), tpl.name), COALESCE(tpl.preheader, ''),
           v_blocks, 2,
           COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
           grp.bind_event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
           true, a.id, grp.trigger_event_id, 'automation', 0, COALESCE(a.created_by, tpl.created_by), v_prod)
        RETURNING id INTO v_child;
      END IF;

      WITH todo AS (
        SELECT l.id, lower(l.email) AS em
          FROM public.email_automation_sends l
         WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
           AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
           AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
      ),
      ins AS (
        INSERT INTO public.email_campaign_recipients
          (campaign_id, email, first_name, last_name, unsubscribe_token, status)
        SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
          FROM todo t
          LEFT JOIN LATERAL (
            SELECT s.first_name, s.last_name, s.unsubscribe_token
              FROM public.newsletter_subscriptions s
             WHERE lower(s.email) = t.em
               AND s.product IS NOT DISTINCT FROM v_prod
               AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
             LIMIT 1
          ) s ON true
        ON CONFLICT (campaign_id, lower(email)) DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO v_new FROM ins;

      UPDATE public.email_automation_sends l
         SET campaign_id = v_child
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
         AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id;

      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

      v_enqueued := v_enqueued + v_new;
      v_children := array_append(v_children, v_child);
      v_child := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'automations', v_automations, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children),
    'budget_hit', v_budget_hit,
    'yunits_held', v_held
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_membership(p_event_id uuid, p_user_id uuid, p_email text)
 RETURNS TABLE(is_follower boolean, is_subscriber boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text;
  v_org uuid;
  v_email text := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
BEGIN
  SELECT h.venue_id, h.organizer_user_id INTO v_venue, v_org
  FROM public.event_community_host(p_event_id) h;

  IF p_user_id IS NOT NULL AND v_email IS NULL THEN
    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  END IF;

  is_follower := false;
  is_subscriber := false;

  IF p_user_id IS NOT NULL THEN
    IF v_venue IS NOT NULL THEN
      is_follower := EXISTS (
        SELECT 1 FROM public.favorites f
        WHERE f.user_id = p_user_id AND f.favorite_type = 'club' AND f.venue_id = v_venue
      );
    ELSIF v_org IS NOT NULL THEN
      is_follower := EXISTS (
        SELECT 1 FROM public.organizer_profile_followers o
        WHERE o.user_id = p_user_id AND o.organizer_user_id = v_org
      );
    END IF;
  END IF;

  IF v_venue IS NOT NULL OR v_org IS NOT NULL THEN
    is_subscriber := EXISTS (
      SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE ns.opted_in AND ns.product IS NULL
        AND ((v_venue IS NOT NULL AND ns.venue_id = v_venue)
          OR (v_org IS NOT NULL AND ns.organizer_user_id = v_org))
        AND ((p_user_id IS NOT NULL AND ns.user_id = p_user_id)
          OR (v_email IS NOT NULL AND lower(ns.email) = v_email))
    );
  END IF;

  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE PROCEDURE public.contact_base_cache_refresh(IN p_budget interval DEFAULT '00:00:40'::interval)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  r record;
  v_state public.contact_base_cache_state%ROWTYPE;
BEGIN
  FOR r IN
    SELECT q.scope_key, q.venue_id, q.organizer_user_id FROM (
      -- Lues depuis 15 min, ET marquées (une écriture dans une source suivie :
      -- fichier, engagement, billets de la billetterie) ou construites il y a
      -- plus de 15 min (filet des sources sans marque : ventes Yuno, comptes).
      -- Avant (20261018240000), toute portée lue était reconstruite à chaque
      -- passe du cron, même sans aucun changement : 3 277 reconstructions,
      -- 2,1 s en moyenne, le plus gros consommateur de la base.
      SELECT s.scope_key, s.venue_id, s.organizer_user_id, 0 AS prio, s.last_read_at AS t
        FROM public.contact_base_cache_state s
       WHERE s.last_read_at > now() - interval '15 minutes'
         AND public.contact_base_cache_due(s.built_at, s.dirty_at)
      UNION ALL
      -- Toute portée qui a importé un fichier : prête avant la première visite.
      SELECT DISTINCT public.contact_base_scope_key(li.venue_id, li.organizer_user_id) || CASE WHEN li.product = 'crm' THEN '|crm' ELSE '' END,
             li.venue_id, li.organizer_user_id, 1, NULL::timestamptz
        FROM public.contact_list_imports li
       WHERE NOT EXISTS (SELECT 1 FROM public.contact_base_cache_state s
                          WHERE s.scope_key = public.contact_base_scope_key(li.venue_id, li.organizer_user_id) || CASE WHEN li.product = 'crm' THEN '|crm' ELSE '' END)
    ) q
    ORDER BY q.prio, q.t DESC NULLS LAST
  LOOP
    EXIT WHEN clock_timestamp() - v_t0 > p_budget;
    BEGIN
      IF pg_try_advisory_xact_lock(hashtext('contact_base_cache:' || r.scope_key)) THEN
        SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = r.scope_key;
        IF NOT FOUND OR public.contact_base_cache_due(v_state.built_at, v_state.dirty_at) THEN
          PERFORM public._contact_base_cache_build(r.scope_key, r.venue_id, r.organizer_user_id, false);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact_base_cache_refresh(%): %', r.scope_key, SQLERRM;
    END;
    COMMIT;
  END LOOP;
END;
$procedure$;

CREATE OR REPLACE FUNCTION public.contact_engagement_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_done integer := 0;
  v_err integer := 0;
BEGIN
  FOR r IN
    WITH cand AS (
      -- Un événement email (ouverture, clic, bounce…) depuis le dernier passage.
      SELECT c.venue_id, c.organizer_user_id, max(e.created_at) AS since
        FROM public.email_campaign_events e
        JOIN public.email_campaigns c ON c.id = e.campaign_id
       WHERE e.created_at > now() - interval '1 day'
       GROUP BY 1, 2
      UNION ALL
      -- Une campagne en cours d'envoi, ou une tranche partie depuis.
      SELECT c.venue_id, c.organizer_user_id,
             max(CASE WHEN c.status = 'sending' THEN now() - interval '10 minutes' ELSE c.last_slice_at END)
        FROM public.email_campaigns c
       WHERE c.status = 'sending' OR c.last_slice_at > now() - interval '1 day'
       GROUP BY 1, 2
      UNION ALL
      -- Fenêtres glissantes (90 / 180 j) : deux fois par jour suffit.
      SELECT c.venue_id, c.organizer_user_id, now() - interval '12 hours'
        FROM public.email_campaigns c
       WHERE c.status IN ('sent', 'sending', 'paused')
         AND c.sent_at > now() - interval '30 days'
       GROUP BY 1, 2
      UNION ALL
      -- Toute portée qui a importé un fichier : une fois par jour.
      SELECT li.venue_id, li.organizer_user_id, now() - interval '24 hours'
        FROM public.contact_list_imports li
       GROUP BY 1, 2
    ), due AS (
      SELECT venue_id, organizer_user_id, max(since) AS since FROM cand GROUP BY 1, 2
    ), duep AS (
      -- Un état d'engagement PAR PRODUIT (clé « v:… » ou « …|crm ») : un compte à deux produits est rafraîchi deux fois,
      -- chaque produit avec SES campagnes, SON registre et SES contacts ; un compte CRM pur une fois, en 'crm'.
      SELECT d0.venue_id, d0.organizer_user_id, d0.since, pr.p AS product
        FROM due d0
        CROSS JOIN LATERAL unnest(CASE
          WHEN d0.venue_id IS NULL AND d0.organizer_user_id IS NULL THEN ARRAY[NULL::text]
          WHEN public.crm_scope_is_crm(public.crm_scope_key(d0.venue_id, d0.organizer_user_id)) THEN ARRAY['crm'::text]
          WHEN public.crm_scope_has_crm(public.crm_scope_key(d0.venue_id, d0.organizer_user_id)) THEN ARRAY[NULL::text, 'crm'::text]
          ELSE ARRAY[NULL::text] END) AS pr(p)
    )
    SELECT d.venue_id, d.organizer_user_id, d.product
      FROM duep d
      LEFT JOIN public.contact_engagement_state s
        ON s.scope_key = COALESCE('v:' || d.venue_id, 'o:' || d.organizer_user_id::text, 'p') || CASE WHEN d.product = 'crm' THEN '|crm' ELSE '' END
     WHERE s.refreshed_at IS NULL OR s.refreshed_at < d.since
     ORDER BY s.refreshed_at NULLS FIRST
     LIMIT 25
  LOOP
    BEGIN
      PERFORM public.refresh_contact_engagement(r.venue_id, r.organizer_user_id, r.product);
      -- Le bilan « campagne → base » est une carte de la Billetterie (D) : jamais pour la passe 'crm'.
      IF r.product IS DISTINCT FROM 'crm' THEN
        PERFORM public.refresh_campaign_list_impacts(r.venue_id, r.organizer_user_id);
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      RAISE WARNING 'contact_engagement_sweep(%, %): %', r.venue_id, r.organizer_user_id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('scopes', v_done, 'errors', v_err);
END;
$function$;

CREATE OR REPLACE FUNCTION public.contact_import_absorb(p_list_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_list public.contact_list_imports%ROWTYPE;
  v_prev uuid[];
  v_id uuid;
  v_emails integer := 0;
  v_phones integer := 0;
  v_retired_email uuid[] := '{}'::uuid[];
  v_retired_sms uuid[] := '{}'::uuid[];
BEGIN
  SELECT * INTO v_list FROM public.contact_list_imports WHERE id = p_list_import_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('emails_moved', 0, 'phones_moved', 0,
                              'retired_email_lists', '[]'::jsonb, 'retired_sms_lists', '[]'::jsonb);
  END IF;

  -- ── Emails ──
  IF v_list.email_import_id IS NOT NULL THEN
    -- Qui possédait ces adresses avant nous ? (avant de bouger quoi que ce soit)
    SELECT COALESCE(array_agg(DISTINCT s.import_id), '{}'::uuid[]) INTO v_prev
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
       AND s.product IS NOT DISTINCT FROM v_list.product
       AND s.import_id IS NOT NULL
       AND s.import_id <> v_list.email_import_id
       AND EXISTS (SELECT 1 FROM public.imported_contacts c
                    WHERE c.list_import_id = p_list_import_id
                      AND c.email IS NOT NULL AND lower(c.email) = lower(s.email));

    WITH moved AS (
      UPDATE public.newsletter_subscriptions s
         SET import_id = v_list.email_import_id, updated_at = now()
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
         AND s.product IS NOT DISTINCT FROM v_list.product
         AND s.import_id IS DISTINCT FROM v_list.email_import_id
         AND EXISTS (SELECT 1 FROM public.imported_contacts c
                      WHERE c.list_import_id = p_list_import_id
                        AND c.email IS NOT NULL AND lower(c.email) = lower(s.email))
      RETURNING 1
    )
    SELECT count(*) INTO v_emails FROM moved;

    FOREACH v_id IN ARRAY v_prev LOOP
      IF NOT EXISTS (SELECT 1 FROM public.newsletter_subscriptions WHERE import_id = v_id) THEN
        UPDATE public.email_list_imports
           SET superseded_by = v_list.email_import_id, superseded_at = now()
         WHERE id = v_id AND superseded_by IS NULL;
        IF FOUND THEN v_retired_email := v_retired_email || v_id; END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Numéros ──
  IF v_list.sms_import_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT vc.import_id), '{}'::uuid[]) INTO v_prev
      FROM public.venue_sms_contacts vc
     WHERE public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
       AND vc.product IS NOT DISTINCT FROM v_list.product
       AND vc.import_id IS NOT NULL
       AND vc.import_id <> v_list.sms_import_id
       AND EXISTS (SELECT 1 FROM public.imported_contacts c
                    WHERE c.list_import_id = p_list_import_id
                      AND c.phone_e164 IS NOT NULL AND c.phone_e164 = vc.phone_e164);

    WITH moved AS (
      UPDATE public.venue_sms_contacts vc
         SET import_id = v_list.sms_import_id
       WHERE public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
         AND vc.product IS NOT DISTINCT FROM v_list.product
         AND vc.import_id IS DISTINCT FROM v_list.sms_import_id
         AND EXISTS (SELECT 1 FROM public.imported_contacts c
                      WHERE c.list_import_id = p_list_import_id
                        AND c.phone_e164 IS NOT NULL AND c.phone_e164 = vc.phone_e164)
      RETURNING 1
    )
    SELECT count(*) INTO v_phones FROM moved;

    FOREACH v_id IN ARRAY v_prev LOOP
      IF NOT EXISTS (SELECT 1 FROM public.venue_sms_contacts WHERE import_id = v_id) THEN
        UPDATE public.sms_list_imports
           SET superseded_by = v_list.sms_import_id, superseded_at = now()
         WHERE id = v_id AND superseded_by IS NULL;
        IF FOUND THEN v_retired_sms := v_retired_sms || v_id; END IF;
      END IF;
    END LOOP;
  END IF;

  -- La liste unifiée d'où venaient ces fichiers suit ses deux canaux : elle est
  -- retirée quand elle n'a plus aucun canal vivant.
  UPDATE public.contact_list_imports li
     SET superseded_by = p_list_import_id, superseded_at = now()
   WHERE li.id <> p_list_import_id
     AND li.product IS NOT DISTINCT FROM v_list.product
     AND li.superseded_by IS NULL
     AND (li.email_import_id IS NULL OR li.email_import_id = ANY(v_retired_email))
     AND (li.sms_import_id IS NULL OR li.sms_import_id = ANY(v_retired_sms))
     AND (li.email_import_id IS NOT NULL OR li.sms_import_id IS NOT NULL);

  -- Un brouillon qui visait une liste retirée partirait à zéro destinataire
  -- sans rien dire : on le recâble sur la liste qui la remplace.
  IF array_length(v_retired_email, 1) > 0 THEN
    UPDATE public.email_campaigns ec
       SET audiences_json = (
             SELECT COALESCE(jsonb_agg(DISTINCT CASE
                      WHEN el->>'kind' = 'import' AND (el->>'importId')::uuid = ANY(v_retired_email)
                        THEN jsonb_build_object('kind', 'import', 'importId', v_list.email_import_id::text)
                      ELSE el END), '[]'::jsonb)
               FROM jsonb_array_elements(ec.audiences_json) el)
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, v_list.venue_id, v_list.organizer_user_id)
       AND public.crm_campaign_is_crm(ec.id) = (v_list.product IS NOT DISTINCT FROM 'crm')
       AND ec.status IN ('draft', 'scheduled')
       AND jsonb_typeof(ec.audiences_json) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(ec.audiences_json) el
                    WHERE el->>'kind' = 'import'
                      AND (el->>'importId') ~ '^[0-9a-f-]{36}$'
                      AND (el->>'importId')::uuid = ANY(v_retired_email));
  END IF;

  RETURN jsonb_build_object(
    'emails_moved', v_emails,
    'phones_moved', v_phones,
    'retired_email_lists', to_jsonb(v_retired_email),
    'retired_sms_lists', to_jsonb(v_retired_sms));
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_campaign_recipients(p_venue_id text, p_type text, p_audience_type text, p_event_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Informational: acheteurs ticket d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.tickets
    WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: réservations table d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.table_reservations
    WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: tous les acheteurs (ticket + table)
  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  -- Marketing: filtrage commun = abonnés opt-in venue
  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE venue_id = p_venue_id AND opted_in = true AND product IS NULL;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.venue_id = p_venue_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true AND ns.product IS NULL;
    ELSIF p_audience_type = 'custom_segment' AND p_segment_id IS NOT NULL THEN
      -- Segment sauvegardé ∩ opt-in : même intersection que resolve_campaign_audience.
      SELECT COUNT(DISTINCT LOWER(ns.email)) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.resolve_venue_segment(
             p_venue_id,
             (SELECT vs.definition FROM public.venue_segments vs
               WHERE vs.id = p_segment_id AND vs.venue_id = p_venue_id)
           ) seg ON LOWER(seg.email) = LOWER(ns.email)
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true AND ns.product IS NULL;
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc
        ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = p_venue_id
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true AND ns.product IS NULL
        AND CASE p_audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_campaign_recipients_org(p_organizer_user_id uuid, p_type text, p_audience_type text, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF NOT COALESCE(p_organizer_user_id = auth.uid() OR public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND t.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(tr.user_email)) INTO v_count
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.event_id = p_event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH allowed AS (
      SELECT id FROM public.events
      WHERE id = p_event_id
        AND (organizer_user_id = p_organizer_user_id OR partner_organizer_id = p_organizer_user_id)
    ), emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id IN (SELECT id FROM allowed) AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id IN (SELECT id FROM allowed) AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE organizer_user_id = p_organizer_user_id AND opted_in = true AND product IS NULL;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.organizer_user_id = p_organizer_user_id
      JOIN public.events e ON e.id = t.event_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true AND ns.product IS NULL
        AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      WITH agg AS (
        SELECT LOWER(t.user_email) AS email,
               SUM(t.total_price)::numeric AS spent,
               COUNT(DISTINCT t.event_id) AS visits,
               MAX(t.created_at) AS last_seen
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE t.status = 'paid' AND t.user_email IS NOT NULL
          AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)
        GROUP BY LOWER(t.user_email)
      )
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN agg a ON a.email = LOWER(ns.email)
      WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true AND ns.product IS NULL
        AND CASE p_audience_type
          WHEN 'vip' THEN a.spent >= 500
          WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
          WHEN 'new_customers' THEN a.visits = 1
          WHEN 'big_spenders' THEN a.spent >= 1000
          WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_organizer_audience_kinds(p_organizer_user_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_organizer_user_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR p_organizer_user_id = auth.uid()
          OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Mêmes seuils que resolve_campaign_audience (portée organisateur) : ce que
  -- l'écran affiche est ce que l'envoi résoudra.
  WITH cust AS (
    SELECT c.email, COALESCE(c.spent, 0) AS spent, COALESCE(c.event_count, 0) AS visits, c.last_at
      FROM public.contact_scope_customers(NULL, p_organizer_user_id) c
  ), subs AS (
    SELECT DISTINCT ON (LOWER(ns.email)) LOWER(ns.email) AS addr, cu.spent, cu.visits, cu.last_at
      FROM public.newsletter_subscriptions ns
      LEFT JOIN cust cu ON cu.email = LOWER(ns.email)
     WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true AND ns.product IS NULL
     ORDER BY LOWER(ns.email)
  )
  SELECT jsonb_build_object(
    'all_subscribers', count(*),
    'vip',           count(*) FILTER (WHERE COALESCE(s.spent, 0) >= 500),
    'big_spenders',  count(*) FILTER (WHERE COALESCE(s.spent, 0) >= 1000),
    'regulars',      count(*) FILTER (WHERE COALESCE(s.visits, 0) BETWEEN 2 AND 4),
    'new_customers', count(*) FILTER (WHERE COALESCE(s.visits, 0) <= 1),
    'dormant',       count(*) FILTER (WHERE s.last_at IS NOT NULL AND s.last_at < now() - interval '90 days'),
    'event_subscribers', CASE WHEN p_event_id IS NULL THEN 0 ELSE
      count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.event_id = p_event_id AND t.status = 'paid' AND LOWER(t.user_email) = s.addr)) END
  ) INTO v
  FROM subs s;
  RETURN COALESCE(v, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_sms_campaign_recipients(p_venue_id text, p_organizer_user_id uuid, p_segment_type text, p_event_id uuid DEFAULT NULL::uuid, p_import_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid, p_segment_ids uuid[] DEFAULT NULL::uuid[], p_match text DEFAULT 'any'::text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_segment_ids, ARRAY[p_segment_id])) x WHERE x IS NOT NULL);
  v_need integer := CASE WHEN COALESCE(p_match, 'any') = 'all' THEN 1 ELSE 0 END;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  v_need := CASE WHEN v_need = 1 THEN cardinality(v_ids) ELSE 1 END;
  WITH cseg AS (
    SELECT r.phone_e164 AS ph, cs.id AS sid
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE cardinality(v_ids) > 0 AND cs.id = ANY(v_ids)
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND r.phone_e164 IS NOT NULL
  ), cph AS (
    SELECT ph FROM cseg GROUP BY ph HAVING count(DISTINCT sid) >= v_need
  )
  SELECT count(*) INTO v_count
    FROM (
      SELECT DISTINCT c.phone_e164
        FROM public.venue_sms_contacts c
       WHERE NOT c.unsubscribed
         AND c.product IS NULL
         AND c.sms_consent_at > now() - interval '36 months'
         AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND CASE COALESCE(p_segment_type, 'all')
               WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
               WHEN 'vip'    THEN c.is_vip
               WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
               WHEN 'contact_segment' THEN cardinality(v_ids) > 0 AND c.phone_e164 IN (SELECT ph FROM cph)
               WHEN 'pros'    THEN EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                    AND lower(ns.email) = lower(c.email)
                    AND ns.source IN ('platform:pros','platform:leads'))
               WHEN 'clients' THEN EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                    AND lower(ns.email) = lower(c.email)
                    AND ns.source IN ('platform:clients','platform:waitlist'))
               WHEN 'not_event' THEN p_event_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = p_event_id
                      AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                      AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM public.table_reservations tr
                    WHERE tr.event_id = p_event_id
                      AND tr.status <> 'refunded'
                      AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
                 )
               ELSE true
             END
    ) d;
  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_admin_product(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_ids text[];
  v_usage jsonb; v_ttv jsonb; v_wait jsonb; v_recipes jsonb; v_retention jsonb;
  v_live integer; v_paid integer;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(r->>'id'), '{}') INTO v_ids FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned';
  SELECT count(*), count(*) FILTER (WHERE r->>'state' IN ('paid', 'late')) INTO v_live, v_paid FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned';

  -- Qui utilise quoi : les sept étapes, sur les comptes vivants.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('step', i, 'n',
           (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned' AND (r->'ob'->>i)::boolean),
           'paid', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'state' IN ('paid', 'late') AND (r->'ob'->>i)::boolean)) ORDER BY i), '[]'::jsonb)
    INTO v_usage FROM generate_series(0, 6) i;

  -- Délais médians depuis l'inscription, en jours.
  WITH acc AS (
    SELECT r->>'id' AS id, (r->>'signup_at')::timestamptz AS signup_at, (r->>'sub_created')::timestamptz AS sub_at,
           (r->>'venue_id') AS vid, (r->>'organizer_user_id')::uuid AS oid
      FROM jsonb_array_elements(v_rows) r WHERE r->>'signup_at' IS NOT NULL
  ), t AS (
    SELECT a.id, a.signup_at,
           (SELECT c.initial_import_done_at FROM public.ticketing_connections c WHERE (a.vid IS NOT NULL AND c.venue_id = a.vid) OR (a.oid IS NOT NULL AND c.organizer_user_id = a.oid) ORDER BY c.created_at LIMIT 1) AS synced_at,
           (SELECT min(COALESCE(e.sent_at, e.send_started_at)) FROM public.email_campaigns e WHERE e.automation_id IS NULL AND e.status IN ('sent', 'sending') AND public.crm_campaign_is_crm(e.id)
              AND ((a.vid IS NOT NULL AND e.venue_id = a.vid) OR (a.oid IS NOT NULL AND e.organizer_user_id = a.oid))) AS sent_at,
           (SELECT min(l.created_at) FROM public.crm_yunit_lots l WHERE l.scope_key = a.id AND l.kind = 'purchase') AS bought_at
      FROM acc a
  )
  SELECT jsonb_build_object(
      'n', count(*),
      'sync', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM synced_at - signup_at) / 86400) FILTER (WHERE synced_at IS NOT NULL),
      'sent', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - signup_at) / 86400) FILTER (WHERE sent_at IS NOT NULL),
      'bought', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM bought_at - signup_at) / 86400) FILTER (WHERE bought_at IS NOT NULL),
      'n_sync', count(*) FILTER (WHERE synced_at IS NOT NULL), 'n_sent', count(*) FILTER (WHERE sent_at IS NOT NULL), 'n_bought', count(*) FILTER (WHERE bought_at IS NOT NULL))
    INTO v_ttv FROM t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('feature', feature, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_wait FROM (
    SELECT feature, count(*) AS n FROM public.crm_feature_waitlist WHERE scope_key = ANY(v_ids) OR scope_key IS NULL GROUP BY feature) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_recipes FROM (
    SELECT a.kind, count(*) AS n FROM public.email_automations a
     WHERE a.enabled AND a.product = 'crm' AND public.crm_scope_key(a.venue_id, a.organizer_user_id) = ANY(v_ids) GROUP BY a.kind) q;

  -- Ce qui fait rester : part de payants selon le nombre de recettes allumées.
  SELECT jsonb_build_object(
      'with_recipes', count(*) FILTER (WHERE (r->>'recipes')::int >= 3),
      'with_recipes_paid', count(*) FILTER (WHERE (r->>'recipes')::int >= 3 AND r->>'state' IN ('paid', 'late')),
      'without', count(*) FILTER (WHERE (r->>'recipes')::int < 3),
      'without_paid', count(*) FILTER (WHERE (r->>'recipes')::int < 3 AND r->>'state' IN ('paid', 'late')))
    INTO v_retention FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned';

  RETURN jsonb_build_object('at', now(), 'live', v_live, 'paid', v_paid, 'usage', v_usage, 'ttv', v_ttv, 'waitlist', v_wait, 'recipes', v_recipes, 'retention', v_retention);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_series jsonb; v_sources jsonb; v_clicks jsonb; v_new jsonb; v_events jsonb; v_first jsonb; v_gained jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Premier achat de chaque client dans l'espace (toutes époques).
  DROP TABLE IF EXISTS _afirst;
  CREATE TEMP TABLE _afirst ON COMMIT DROP AS
  SELECT DISTINCT ON (a.email) a.email, a.id, a.bought_at, a.src, a.ci, a.pi
    FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL
   ORDER BY a.email, a.bought_at, a.id;

  -- Clics sur les messages Yuno (un clic = une personne et une campagne).
  DROP TABLE IF EXISTS _aclk;
  CREATE TEMP TABLE _aclk ON COMMIT DROP AS
  SELECT k.campaign_id, k.email, k.at, k.event_id,
         public._crm_ana_bucket(m, k.at) AS ci,
         CASE m->>'mode'
           WHEN 'hour' THEN CASE WHEN k.at >= (m->>'start')::timestamptz - make_interval(hours => v_n) AND k.at < (m->>'start')::timestamptz THEN 0 END
           WHEN 'day' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                     BETWEEN (m->>'start')::date - v_n AND (m->>'start')::date - 1 THEN 0 END
           WHEN 'month' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                       >= ((m->>'start')::date - interval '12 months')::date
                                   AND public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int) < (m->>'start')::date THEN 0 END
           ELSE NULL END AS pi
    FROM (
      SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS at, c.event_id
        FROM public.email_campaign_events ev
        JOIN public.email_campaigns c ON c.id = ev.campaign_id
       WHERE ev.event_type = 'clicked'
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND ev.created_at > now() - interval '25 months'
         AND public.crm_campaign_is_crm(c.id)
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  -- Agrégé UNE fois par (case, source), puis lu par case : avant, chaque
  -- case × source relisait tous les billets (20261016210000).
  DROP TABLE IF EXISTS _aser;
  CREATE TEMP TABLE _aser ON COMMIT DROP AS
  SELECT a.ci, a.src, round(sum(a.amount), 2) AS rev, sum(a.qty) AS tk
    FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci, a.src;
  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.rev FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.tk FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE(ck.n, 0),
           'new_buyers', COALESCE(nb.n, 0)
         ) ORDER BY g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g
    LEFT JOIN (SELECT c.ci, count(*) AS n FROM _aclk c WHERE c.ci IS NOT NULL GROUP BY c.ci) ck ON ck.ci = g
    LEFT JOIN (SELECT f.ci, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.ci) nb ON nb.ci = g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  WITH cur AS (
    SELECT a.src, count(DISTINCT a.ord) AS orders, sum(a.qty) AS tk, count(DISTINCT a.email) AS buyers,
           round(sum(a.amount), 2) AS rev
      FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.src
  ), prv AS (
    SELECT a.src, sum(a.qty) AS tk FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.src
  ), nf AS (
    SELECT f.src, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.src
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', COALESCE(cur.orders, 0),
           'tickets', COALESCE(cur.tk, 0),
           'buyers', COALESCE(cur.buyers, 0),
           'new_buyers', COALESCE(nf.n, 0),
           'revenue', COALESCE(cur.rev, 0),
           'prev_tickets', COALESCE(prv.tk, 0)
         ) ORDER BY s.o), '[]'::jsonb)
    INTO v_sources
    FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) WITH ORDINALITY s(k, o)
    LEFT JOIN cur ON cur.src = s.k
    LEFT JOIN prv ON prv.src = s.k
    LEFT JOIN nf ON nf.src = s.k;

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE ci IS NOT NULL),
           'prev', count(*) FILTER (WHERE pi IS NOT NULL))
    INTO v_clicks FROM _aclk;

  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND ci IS NOT NULL),
           'new', (SELECT count(*) FROM _afirst WHERE ci IS NOT NULL),
           'prev_buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND pi IS NOT NULL),
           'prev_new', (SELECT count(*) FROM _afirst WHERE pi IS NOT NULL))
    INTO v_new;

  -- Contacts gagnés : entrés dans la base pendant la fenêtre (premier achat,
  -- import, inscription), quelle que soit la porte.
  -- La case de chaque contact se calcule UNE fois (avant : une fois par case
  -- de la série, soit 31 × la base).
  WITH j AS (
    SELECT public._crm_ana_bucket(m, LEAST(f.bought_at, COALESCE(c.added_at, c.created_at))) AS b
      FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
     WHERE c.email IS NOT NULL
  ), jb AS (
    SELECT j.b, count(*) AS n FROM j WHERE j.b IS NOT NULL GROUP BY j.b
  )
  SELECT jsonb_build_object(
           'total', COALESCE((SELECT sum(jb.n) FROM jb), 0),
           'series', (SELECT jsonb_agg(COALESCE(jb.n, 0) ORDER BY g)
                        FROM generate_series(0, v_n - 1) g LEFT JOIN jb ON jb.b = g))
    INTO v_gained;

  -- Soirées : acheteurs, part de nouveaux, clics de vos messages vers elles.
  WITH per AS (
    SELECT a.event_id, count(DISTINCT a.email) AS buyers,
           count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers
      FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
       AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
           'state', CASE WHEN e.night = (m->>'today')::date THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
           'buyers', p.buyers, 'new_buyers', p.new_buyers,
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id)
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation_save(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_enabled boolean DEFAULT NULL::boolean, p_delay_hours integer DEFAULT NULL::integer, p_subject text DEFAULT NULL::text, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     WHERE t.id = p_template_id AND t.product = 'crm'
       AND t.venue_id IS NOT DISTINCT FROM p_venue_id AND t.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ) THEN
    RAISE EXCEPTION 'bad_template' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.email_automations a
   WHERE a.kind = p_kind AND a.product = 'crm'
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
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation_sms_save(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_enabled boolean, p_body text, p_delay_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.email_automations%ROWTYPE;
  v_body text := NULLIF(btrim(COALESCE(p_body, '')), '');
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS DISTINCT FROM 'first_return' THEN RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023'; END IF;
  IF p_delay_days IS NOT NULL AND p_delay_days NOT IN (3, 5, 7) THEN RAISE EXCEPTION 'bad_delay' USING ERRCODE = '22023'; END IF;
  IF v_body IS NOT NULL AND char_length(v_body) > 480 THEN RAISE EXCEPTION 'body_too_long' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p_enabled, false) AND v_body IS NULL THEN RAISE EXCEPTION 'empty_body' USING ERRCODE = '22023'; END IF;

  UPDATE public.email_automations a
     SET sms_enabled = COALESCE(p_enabled, a.sms_enabled),
         sms_body = CASE WHEN p_body IS NULL THEN a.sms_body ELSE v_body END,
         sms_delay_days = COALESCE(p_delay_days, a.sms_delay_days)
   WHERE a.kind = p_kind AND a.product = 'crm'
     AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('sms_enabled', v_row.sms_enabled, 'sms_body', v_row.sms_body, 'sms_delay_days', v_row.sms_delay_days);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_automations__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n int := CASE WHEN p_period = '90d' THEN 13 ELSE 5 END;
  v_now timestamptz := now();
  v_from timestamptz;
  v_pfrom timestamptz;
  v_kinds text[] := ARRAY['new_event', 'last_call', 'click_no_buy', 'post_event_thanks', 'post_event_missed', 'first_return', 'regular_lapse', 'win_back'];
  v_recipes jsonb; v_weeks jsonb; v_tot jsonb; v_prev jsonb; v_feed jsonb; v_sug jsonb;
  v_limit jsonb; v_base int; v_active int;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_n * 7);
  v_pfrom := v_from - make_interval(days => v_n * 7);

  -- Clics et achats rattachés (règle des résultats d'e-mail : billet acheté
  -- sous 7 jours après un clic, rattaché au dernier clic).
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _xa;
  CREATE TEMP TABLE _xa ON COMMIT DROP AS
  SELECT a.* FROM public.email_automations a
   WHERE a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND a.kind = ANY (v_kinds)
     AND public._email_recipe_is_crm(a.product, a.kind, a.venue_id, a.organizer_user_id);

  -- Campagnes enfants des recettes.
  DROP TABLE IF EXISTS _xc;
  CREATE TEMP TABLE _xc ON COMMIT DROP AS
  SELECT c.id, a.kind, c.subject FROM public.email_campaigns c JOIN _xa a ON a.id = c.automation_id;

  DROP TABLE IF EXISTS _xr;
  CREATE TEMP TABLE _xr ON COMMIT DROP AS
  SELECT r.campaign_id, c.kind, lower(r.email) AS email, r.sent_at, r.first_name, r.last_name
    FROM public.email_campaign_recipients r JOIN _xc c ON c.id = r.campaign_id
   WHERE r.status IN ('sent', 'complained') AND r.sent_at IS NOT NULL;
  CREATE INDEX ON _xr (kind, sent_at);

  DROP TABLE IF EXISTS _xk;
  CREATE TEMP TABLE _xk ON COMMIT DROP AS
  SELECT k.campaign_id, c.kind, k.email, k.at FROM _cmk k JOIN _xc c ON c.id = k.campaign_id;

  DROP TABLE IF EXISTS _xb;
  CREATE TEMP TABLE _xb ON COMMIT DROP AS
  SELECT m.id, m.email, m.amount, m.bought_at, c.kind FROM _cma m JOIN _xc c ON c.id = m.campaign_id;

  SELECT jsonb_agg(jsonb_build_object(
           'kind', k.kind, 'id', a.id, 'enabled', COALESCE(a.enabled, false), 'enabled_at', a.enabled_at,
           'updated_at', a.updated_at, 'delay_hours', a.delay_hours, 'subject', a.subject, 'template_id', a.template_id,
           'template_name', tpl.name, 'template_subject', tpl.subject,
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_from),
           'sent', (SELECT count(*) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.kind = k.kind AND x.at >= v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.kind = k.kind AND b.bought_at >= v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.kind = k.kind AND b.bought_at >= v_from),
           'all', jsonb_build_object(
             'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.kind = k.kind),
             'purchases', (SELECT count(*) FROM _xb b WHERE b.kind = k.kind),
             'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.kind = k.kind)),
           -- Envois des 13 dernières semaines (la plus ancienne d'abord).
           'weekly', (SELECT jsonb_agg((SELECT count(*) FROM _xr r WHERE r.kind = k.kind
                                         AND r.sent_at >= v_now - make_interval(days => (13 - g) * 7)
                                         AND r.sent_at < v_now - make_interval(days => (12 - g) * 7)) ORDER BY g)
                        FROM generate_series(0, 12) g),
           -- Rythme d'envoi des 4 dernières semaines : ce qu'elle consomme.
           'week_avg', (SELECT round(count(*) / 4.0, 1) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_now - interval '28 days'),
           'last_sent_at', (SELECT max(r.sent_at) FROM _xr r WHERE r.kind = k.kind),
           'pending', CASE WHEN a.id IS NULL THEN 0 ELSE
             (SELECT count(*) FROM public.email_automation_sends l WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL)
             + (SELECT count(*) FROM public.email_campaign_recipients q JOIN _xc c ON c.id = q.campaign_id WHERE c.kind = k.kind AND q.status = 'pending') END,
           'skipped', CASE WHEN a.id IS NULL THEN 0 ELSE
             (SELECT count(*) FROM public.email_automation_sends l WHERE l.automation_id = a.id AND l.status = 'skipped' AND l.created_at >= v_from) END,
           'preview', public._email_automation_preview(p_venue_id, p_organizer_user_id, k.kind, 'crm'),
           -- « Faire revenir après la 1re soirée » : délai calé sur le compte et étape SMS.
           'auto_delay_days', CASE WHEN k.kind = 'first_return' THEN public._first_return_delay_days(p_venue_id, p_organizer_user_id) END,
           'sms', CASE WHEN k.kind = 'first_return' THEN jsonb_build_object(
             'enabled', COALESCE(a.sms_enabled, false), 'body', a.sms_body, 'delay_days', COALESCE(a.sms_delay_days, 5),
             -- Partis vraiment (20261014120000) ; en attente de Yunits ; non
             -- envoyés, la fenêtre passée.
             'sent', (SELECT count(*) FROM public.crm_first_return_sms s
                        JOIN public.sms_campaign_recipients q ON q.campaign_id = s.campaign_id AND q.phone_e164 = s.phone_e164
                       WHERE s.automation_id = a.id AND s.created_at >= v_from
                         AND q.status IN ('sent', 'delivered', 'undelivered')),
             'waiting', (SELECT count(*) FROM public.crm_first_return_sms s
                           JOIN public.sms_campaigns c ON c.id = s.campaign_id
                          WHERE s.automation_id = a.id AND s.expired_at IS NULL
                            AND c.status = 'draft' AND c.error_message = 'crm_yunits_insufficient'),
             'expired', (SELECT count(*) FROM public.crm_first_return_sms s
                          WHERE s.automation_id = a.id AND s.expired_at >= v_from),
             'identity_ok', COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id)->>'identity_ok')::boolean, false)) END
         ) ORDER BY k.ord)
    INTO v_recipes
    FROM unnest(v_kinds) WITH ORDINALITY k(kind, ord)
    LEFT JOIN _xa a ON a.kind = k.kind
    LEFT JOIN public.email_campaign_templates tpl ON tpl.id = a.template_id;

  -- Une case par semaine, la plus ancienne d'abord (la dernière est en cours).
  SELECT jsonb_agg(jsonb_build_object(
           'start', v_now - make_interval(days => (v_n - g) * 7),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b
                        WHERE b.bought_at >= v_now - make_interval(days => (v_n - g) * 7)
                          AND b.bought_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'purchases', (SELECT count(*) FROM _xb b
                          WHERE b.bought_at >= v_now - make_interval(days => (v_n - g) * 7)
                            AND b.bought_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'sent', (SELECT count(*) FROM _xr r
                     WHERE r.sent_at >= v_now - make_interval(days => (v_n - g) * 7)
                       AND r.sent_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r
                          WHERE r.sent_at >= v_now - make_interval(days => (v_n - g) * 7)
                            AND r.sent_at < v_now - make_interval(days => (v_n - g - 1) * 7))
         ) ORDER BY g)
    INTO v_weeks FROM generate_series(0, v_n - 1) g;

  SELECT jsonb_build_object(
           'sent', (SELECT count(*) FROM _xr r WHERE r.sent_at >= v_from),
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.sent_at >= v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.at >= v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.bought_at >= v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.bought_at >= v_from),
           'recipes', (SELECT count(DISTINCT r.kind) FROM _xr r WHERE r.sent_at >= v_from))
    INTO v_tot;
  SELECT jsonb_build_object(
           'sent', (SELECT count(*) FROM _xr r WHERE r.sent_at >= v_pfrom AND r.sent_at < v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.at >= v_pfrom AND x.at < v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.bought_at >= v_pfrom AND b.bought_at < v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.bought_at >= v_pfrom AND b.bought_at < v_from))
    INTO v_prev;

  -- Les derniers envois : prénom et initiale seulement.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'first_name', NULLIF(trim(f.first_name), ''),
           'last_initial', upper(left(NULLIF(trim(f.last_name), ''), 1)),
           'kind', f.kind, 'subject', f.subject, 'at', f.sent_at) ORDER BY f.sent_at DESC), '[]'::jsonb)
    INTO v_feed
    FROM (SELECT x.first_name, x.last_name, x.kind, x.sent_at, x.subject
            FROM (SELECT r.first_name, r.last_name, r.kind, r.sent_at, c.subject,
                         row_number() OVER (PARTITION BY r.campaign_id ORDER BY r.sent_at DESC) AS rn
                    FROM _xr r JOIN _xc c ON c.id = r.campaign_id) x
           -- Deux lignes par envoi au plus : un lot du matin ne cache pas les autres recettes.
           WHERE x.rn <= 2
           ORDER BY x.sent_at DESC LIMIT 8) f;

  -- Ce que le moteur propose d'allumer (recettes éteintes, faits des 30 j).
  SELECT COALESCE(jsonb_agg(s.value) FILTER (WHERE s.value->>'kind' = ANY (v_kinds)), '[]'::jsonb)
    INTO v_sug
    FROM jsonb_array_elements(public._email_automation_suggestions(p_venue_id, p_organizer_user_id, 'crm')) s;

  v_limit := public.crm_scope_limits(public.crm_scope_key(p_venue_id, p_organizer_user_id))->'automations';
  SELECT count(*) INTO v_active FROM _xa WHERE enabled;
  SELECT count(*) INTO v_base FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL AND s.product = 'crm';

  RETURN jsonb_build_object(
    'period', CASE WHEN p_period = '90d' THEN '90d' ELSE '30d' END, 'weeks_n', v_n, 'from', v_from, 'now', v_now,
    'recipes', COALESCE(v_recipes, '[]'::jsonb), 'weeks', COALESCE(v_weeks, '[]'::jsonb),
    'totals', v_tot, 'prev', v_prev, 'feed', v_feed, 'suggestions', v_sug,
    'limit', CASE WHEN v_limit IS NULL OR v_limit = 'null'::jsonb THEN NULL ELSE v_limit END, 'active', v_active, 'base', v_base,
    'has_connection', EXISTS (SELECT 1 FROM public.ticketing_connections tc
                               WHERE (p_venue_id IS NOT NULL AND tc.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND tc.organizer_user_id = p_organizer_user_id))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_client__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_p record;
  v_buys jsonb;
  v_guests jsonb;
  v_msgs jsonb;
  v_months jsonb;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT * INTO v_p FROM _cp p WHERE p.email = v_em;
  IF v_p.email IS NULL THEN RETURN NULL; END IF;

  -- Achats : une ligne par soirée (montant de la soirée, billets).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_buys FROM (
    SELECT jsonb_build_object('kind', 'buy', 'at', min(t.bought_at), 'event_id', t.event_id, 'title', e.title,
                              'event_start', min(t.event_start), 'amount', round(sum(t.amount), 2), 'tickets', sum(t.qty),
                              'scanned', bool_or(t.scanned_at IS NOT NULL), 'first', min(t.event_start) = v_p.first_night,
                              'upcoming', min(t.event_start) > now(),
                              -- Par où est arrivé l'achat : la source que Shotgun rend sur le
                              -- premier billet de la personne pour cette soirée.
                              'source', public._crm_source_label(p_venue_id, p_organizer_user_id, (
                                SELECT lower(et.utm->>'utm_source') FROM public.external_tickets et
                                 WHERE et.event_id = t.event_id AND lower(et.buyer_email) = v_em
                                   AND public._crm_ticket_is_sale(et.status, et.deal_channel)
                                 ORDER BY COALESCE(et.purchased_at, et.first_seen_at) LIMIT 1))) AS x
      FROM _cpt t LEFT JOIN public.events e ON e.id = t.event_id
     WHERE t.email = v_em
     GROUP BY t.event_id, e.title
  ) q;

  -- Guest list : une ligne par soirée où la personne était invitée ou
  -- inscrite gratuitement (20261008100000). `came` n'est faux qu'une fois la
  -- porte vraiment scannée (`scan_known`) : sinon on ne sait pas.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'event_start' DESC), '[]'::jsonb) INTO v_guests FROM (
    SELECT jsonb_build_object('kind', 'guest', 'event_id', g.event_id, 'title', e.title,
             'event_start', min(g.event_start), 'at', min(g.at),
             'gl', CASE WHEN bool_and(g.kind = 'inv') THEN 'inv' WHEN bool_and(g.kind = 'free') THEN 'free' ELSE 'mix' END,
             'list', string_agg(DISTINCT g.deal, ', '),
             'came', bool_or(g.scanned_at IS NOT NULL), 'scanned_at', min(g.scanned_at),
             'scan_known', public._crm_event_scan_known(g.event_id),
             'upcoming', min(g.event_end) > now()) AS x
      FROM _cpg g LEFT JOIN public.events e ON e.id = g.event_id
     WHERE g.email = v_em AND g.event_id IS NOT NULL
     GROUP BY g.event_id, e.title
  ) q;

  -- Messages : e-mails reçus (et clics), SMS reçus.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object('kind', 'email', 'at', r.sent_at, 'name', c.name, 'campaign_id', c.id,
             'opened', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'opened'),
             'clicked', k.at IS NOT NULL,
             -- La soirée dont parlait l'e-mail, le premier clic, et si la personne a
             -- acheté cette soirée dans les 7 jours qui suivent (ou par la source de
             -- CETTE campagne, que Shotgun rend sur le billet).
             'event_id', c.event_id, 'event_title', ce.title, 'clicked_at', k.at,
             'bought_after', CASE WHEN c.event_id IS NULL OR k.at IS NULL THEN NULL ELSE EXISTS (
               SELECT 1 FROM public.external_tickets et
                WHERE et.event_id = c.event_id AND lower(et.buyer_email) = v_em
                  AND public._crm_ticket_is_sale(et.status, et.deal_channel)
                  AND (lower(et.utm->>'utm_source') = 'yuno-m-' || left(replace(c.id::text, '-', ''), 8)
                       OR COALESCE(et.purchased_at, et.first_seen_at) BETWEEN k.at AND k.at + interval '7 days')) END) AS x
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      LEFT JOIN public.events ce ON ce.id = c.event_id
      LEFT JOIN LATERAL (SELECT min(ev.created_at) AS at FROM public.email_campaign_events ev
                          WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'clicked') k ON true
     WHERE lower(r.email) = v_em AND r.status = 'sent' AND r.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND public.crm_campaign_is_crm(c.id)
     ORDER BY r.sent_at DESC LIMIT 40
  ) q;

  SELECT jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'),
           -- Soirées faites, même règle que la base (_cpa, DATA-02).
           'n', (SELECT count(DISTINCT z.event_id) FROM _cpa z
                  WHERE z.email = v_em AND z.came
                    AND date_trunc('month', z.event_start AT TIME ZONE 'Europe/Paris') = m)) ORDER BY m)
    INTO v_months
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') m;

  RETURN jsonb_build_object(
    'email', v_p.email, 'first_name', v_p.first_name, 'last_name', v_p.last_name, 'phone', v_p.phone,
    'email_ok', v_p.email_ok, 'phone_ok', v_p.phone_ok, 'bounced', v_p.bounced, 'eng_status', v_p.eng_status,
    'lifecycle', v_p.lifecycle, 'nights', v_p.nights, 'nights_win', v_p.nights_win, 'spent', v_p.spent,
    'first_night', v_p.first_night, 'last_night', v_p.last_night, 'added_at', v_p.added_at,
    'tonight', v_p.tonight, 'source', v_p.source, 'utm_source', v_p.utm_source, 'origin', v_p.origin,
    'first_source', public._crm_source_label(p_venue_id, p_organizer_user_id, v_p.utm_source),
    'tags', COALESCE(to_jsonb(v_p.tags), '[]'::jsonb), 'note', v_p.note,
    'buys', v_buys, 'messages', v_msgs, 'months', v_months,
    'guests', v_guests,
    -- Historique d'un fichier importé : ce qu'il dit et comment il compte (20261008210000).
    'history', CASE WHEN v_p.hist_mode IS NULL THEN NULL ELSE jsonb_build_object(
        'nights', v_p.hist_nights, 'spent', v_p.hist_spent, 'last', v_p.hist_last, 'mode', v_p.hist_mode,
        'list', (SELECT COALESCE(NULLIF(btrim(ci.title), ''), NULLIF(btrim(li.list_name), ''), li.filename)
                   FROM public.contact_list_imports li
                   LEFT JOIN public.crm_imports ci ON ci.list_import_id = li.id
                  WHERE li.id = v_p.hist_list)) END,
    'gl', jsonb_build_object('n', v_p.gl_n, 'came', v_p.gl_came, 'first', v_p.gl_first, 'conv', v_p.gl_conv,
                             'paid_n', v_p.paid_n, 'noshow', v_p.gl_noshow),
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_audience_preview(p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb, p_event_id uuid DEFAULT NULL::uuid, p_recent_days integer DEFAULT NULL::integer, p_exclude_buyers boolean DEFAULT false, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_days integer := CASE WHEN p_recent_days BETWEEN 1 AND 90 THEN p_recent_days END;
  v jsonb;
  v_same uuid[];
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_pred := public._crm_audience_pred(p_audiences, p_venue_id, p_organizer_user_id);
  IF v_pred IS NULL THEN
    RETURN jsonb_build_object('reach', 0, 'x_buyers', 0, 'x_recent', 0, 'net', 0);
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  v_same := CASE WHEN v_days IS NULL THEN NULL ELSE public._email_scope_campaign_ids(p_venue_id, p_organizer_user_id, true) END;

  EXECUTE format($q$
    WITH sel AS (
      SELECT p.email, p.events FROM _cp p
       WHERE p.email_ok AND (%3$s)
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                      WHERE lower(ns.email) = p.email AND ns.opted_in
                        AND ns.venue_id IS NOT DISTINCT FROM %1$L::text
                        AND ns.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                        AND ns.product = 'crm')
    ), f AS (
      SELECT s.email,
             (%4$L::uuid IS NOT NULL AND %4$L::uuid = ANY (s.events)) AS buyer,
             (%5$L::integer IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.email_campaign_recipients r
                  JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                 WHERE c2.id IS DISTINCT FROM %6$L::uuid
                   AND c2.venue_id IS NOT DISTINCT FROM %1$L::text
                   AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                   AND c2.id = ANY (%8$L::uuid[])
                   AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                   AND lower(r.email) = s.email)) AS recent
        FROM sel s
    )
    SELECT jsonb_build_object(
      'reach', count(*),
      'x_buyers', count(*) FILTER (WHERE buyer),
      'x_recent', count(*) FILTER (WHERE recent AND NOT (buyer AND %7$L::boolean)),
      'net', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent))
      FROM f
  $q$, p_venue_id, p_organizer_user_id, v_pred, p_event_id, v_days, p_campaign_id, COALESCE(p_exclude_buyers, false), v_same)
  INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_audience_sizes(p_venue_id text, p_organizer_user_id uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_pred text;
  v_n integer;
  v jsonb := '{}'::jsonb;
  v_built boolean := false;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR c IN
    SELECT ec.id, ec.audiences_json, ec.status, ec.total_recipients
      FROM public.email_campaigns ec
     WHERE ec.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
        AND public.crm_campaign_is_crm(ec.id)
     LIMIT 60
  LOOP
    IF c.status IN ('sending', 'sent', 'paused') AND COALESCE(c.total_recipients, 0) > 0 THEN
      v := v || jsonb_build_object(c.id::text, c.total_recipients);
      CONTINUE;
    END IF;
    v_pred := public._crm_audience_pred(c.audiences_json, p_venue_id, p_organizer_user_id);
    IF v_pred IS NULL THEN
      v := v || jsonb_build_object(c.id::text, 0);
      CONTINUE;
    END IF;
    IF NOT v_built THEN
      PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
      v_built := true;
    END IF;
    EXECUTE format('SELECT count(*) FROM _cp p WHERE p.email_ok AND (%s)', v_pred) INTO v_n;
    v := v || jsonb_build_object(c.id::text, v_n);
  END LOOP;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_campaigns__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT COALESCE(jsonb_agg(public._crm_email_row(ec) || CASE WHEN s.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
           'stats', jsonb_build_object('n', s.n, 'received', s.received, 'opened', s.opened, 'clicked', s.clicked,
                     'ticketing', s.ticketing, 'purchases', s.purchases, 'revenue', round(s.revenue, 2),
                     'bounced', s.bounced, 'complained', s.complained, 'unsub', s.unsub)) END
           ORDER BY COALESCE(ec.sent_at, ec.scheduled_at, ec.updated_at) DESC), '[]'::jsonb)
    INTO v
    FROM public.email_campaigns ec
    LEFT JOIN _ces s ON s.id = ec.id
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(ec.id)
     AND ec.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'failed');
  RETURN jsonb_build_object('campaigns', v);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := CASE WHEN p_days IN (30, 90) THEN p_days ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => v_days);
  v_pfrom timestamptz := now() - make_interval(days => 2 * v_days);
  v_cur jsonb; v_prev jsonb; v_list jsonb; v_up jsonb; v_last jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, v_pfrom, v_to);

  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'received', COALESCE(sum(received), 0),
           'opened', COALESCE(sum(opened), 0), 'clicked', COALESCE(sum(clicked), 0), 'ticketing', COALESCE(sum(ticketing), 0),
           'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_cur FROM _ces WHERE sent_at >= v_from;
  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'received', COALESCE(sum(received), 0),
           'opened', COALESCE(sum(opened), 0), 'clicked', COALESCE(sum(clicked), 0), 'ticketing', COALESCE(sum(ticketing), 0),
           'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_prev FROM _ces WHERE sent_at < v_from;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at, 'n', n,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY sent_at), '[]'::jsonb)
    INTO v_list FROM _ces WHERE sent_at >= v_from;

  -- Prochains envois et brouillons.
  SELECT COALESCE(jsonb_agg(public._crm_email_row(ec) ORDER BY ec.status = 'draft', COALESCE(ec.scheduled_at, ec.updated_at)), '[]'::jsonb)
    INTO v_up
    FROM public.email_campaigns ec
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND public.crm_campaign_is_crm(ec.id)
     AND (ec.status = 'draft' OR (ec.status = 'scheduled' AND ec.scheduled_at > now() - interval '1 hour'));

  -- Les dernières campagnes envoyées.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
    SELECT jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'n', n, 'received', received,
             'opened', opened, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
      FROM _ces ORDER BY sent_at DESC LIMIT 3) z;
  -- Assez d'historique : les 3 dernières tout temps, pas seulement la période.
  IF jsonb_array_length(v_last) < 3 THEN
    PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', v_to);
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
      SELECT jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'n', n, 'received', received,
               'opened', opened, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
        FROM _ces ORDER BY sent_at DESC LIMIT 3) z;
  END IF;

  RETURN jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'current', v_cur, 'previous', v_prev,
    'campaigns', v_list, 'upcoming', v_up, 'last', v_last,
    'ever_sent', EXISTS (SELECT 1 FROM public.email_campaigns ec
                          WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
                            AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL AND ec.status IN ('sent', 'sending')
                            AND public.crm_campaign_is_crm(ec.id)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_recipient_emails(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      AND public.crm_campaign_is_crm(c.id);
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_email_recipients_build(p_venue_id, p_organizer_user_id, p_campaign_id);
  SELECT COALESCE(jsonb_agg(z.email), '[]'::jsonb) INTO v FROM (
    SELECT x.email FROM _crr x
     WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
     ORDER BY x.email LIMIT 5000) z;
  RETURN jsonb_build_object('emails', v);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_recipients__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text DEFAULT 'all'::text, p_q text DEFAULT NULL::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer; v jsonb;
  v_q text := NULLIF(lower(btrim(COALESCE(p_q, ''))), '');
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      AND public.crm_campaign_is_crm(c.id);
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_email_recipients_build(p_venue_id, p_organizer_user_id, p_campaign_id);

  SELECT count(*) INTO v_total FROM _crr x
   WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
     AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', email, 'first_name', first_name, 'last_name', last_name, 'status', status,
           'lifecycle', lifecycle, 'opened', opened, 'clicked', clicked, 'bought', revenue > 0, 'revenue', round(revenue, 2))), '[]'::jsonb)
    INTO v FROM (
      SELECT * FROM _crr x
       WHERE public._crm_recipient_match(p_filter, x.opened, x.clicked, x.revenue, x.status)
         AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%')
       ORDER BY x.revenue DESC, x.clicked DESC, x.opened DESC, x.email
       LIMIT 50 OFFSET GREATEST(p_offset, 0)) z;
  RETURN jsonb_build_object('total', v_total, 'rows', v,
    'counts', (SELECT jsonb_build_object('all', count(*), 'opened', count(*) FILTER (WHERE opened), 'clicked', count(*) FILTER (WHERE clicked),
                 'bought', count(*) FILTER (WHERE revenue > 0), 'hot', count(*) FILTER (WHERE clicked AND revenue <= 0),
                 'unopened', count(*) FILTER (WHERE NOT opened AND status = 'sent'),
                 'bounced', count(*) FILTER (WHERE status = 'bounced')) FROM _crr));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ec public.email_campaigns%ROWTYPE;
  v_me record;
  v_avg record;
  v_rank integer; v_total integer;
  v_tl jsonb; v_links jsonb; v_list jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ec FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      AND public.crm_campaign_is_crm(c.id);
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT * INTO v_me FROM _ces WHERE id = p_campaign_id;
  SELECT count(*) AS n_campaigns,
         CASE WHEN sum(received) > 0 THEN sum(opened)::numeric / sum(received) END AS open_rate,
         CASE WHEN sum(received) > 0 THEN sum(clicked)::numeric / sum(received) END AS click_rate,
         CASE WHEN sum(n) > 0 THEN sum(purchases)::numeric * 1000 / sum(n) END AS per_k
    INTO v_avg FROM _ces;
  SELECT count(*) INTO v_total FROM _ces;
  SELECT r INTO v_rank FROM (
    SELECT id, rank() OVER (ORDER BY CASE WHEN n > 0 THEN purchases::numeric / n ELSE 0 END DESC) AS r FROM _ces) z
   WHERE z.id = p_campaign_id;

  -- Réactions heure par heure sur 72 h (première ouverture / premier clic par personne).
  IF ec.sent_at IS NOT NULL THEN
    WITH firsts AS (
      SELECT e.event_type, lower(e.recipient_email) AS em, min(e.created_at) AS at
        FROM public.email_campaign_events e
       WHERE e.campaign_id = p_campaign_id AND e.event_type IN ('opened', 'clicked')
       GROUP BY 1, 2
    )
    SELECT jsonb_agg(jsonb_build_object('h', g.h,
             'opens', (SELECT count(*) FROM firsts f WHERE f.event_type = 'opened' AND f.at < ec.sent_at + make_interval(hours => g.h)),
             'clicks', (SELECT count(*) FROM firsts f WHERE f.event_type = 'clicked' AND f.at < ec.sent_at + make_interval(hours => g.h)))
           ORDER BY g.h)
      INTO v_tl FROM generate_series(0, 72, 3) g(h);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('link', l.link, 'clicks', l.clicks, 'people', l.people) ORDER BY l.people DESC), '[]'::jsonb)
      INTO v_links FROM (
        SELECT regexp_replace(e.metadata->'click'->>'link', '([?&])yc=[^&]*&?', '\1', 'g') AS link,
               count(*) AS clicks, count(DISTINCT lower(e.recipient_email)) AS people
          FROM public.email_campaign_events e
         WHERE e.campaign_id = p_campaign_id AND e.event_type = 'clicked' AND e.metadata->'click'->>'link' IS NOT NULL
         GROUP BY 1 ORDER BY 3 DESC LIMIT 12) l;
  END IF;

  -- Les autres campagnes envoyées (pour passer de l'une à l'autre).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at) ORDER BY sent_at DESC), '[]'::jsonb)
    INTO v_list FROM (SELECT id, name, sent_at FROM _ces ORDER BY sent_at DESC LIMIT 24) z;

  RETURN public._crm_email_row(ec) || jsonb_build_object(
    'stats', CASE WHEN v_me.id IS NULL THEN NULL ELSE jsonb_build_object(
      'n', v_me.n, 'received', v_me.received, 'opened', v_me.opened, 'clicked', v_me.clicked, 'ticketing', v_me.ticketing,
      'purchases', v_me.purchases, 'buyers', v_me.buyers, 'revenue', round(v_me.revenue, 2), 'bounced', v_me.bounced, 'complained', v_me.complained,
      'unsub', v_me.unsub, 'non_openers', GREATEST(v_me.received - v_me.opened - v_me.complained, 0)) END,
    'avg', jsonb_build_object('campaigns', v_avg.n_campaigns, 'open_rate', round(v_avg.open_rate, 4), 'click_rate', round(v_avg.click_rate, 4), 'per_k', round(v_avg.per_k, 2)),
    'rank', v_rank, 'rank_of', v_total,
    'timeline', COALESCE(v_tl, '[]'::jsonb), 'links', COALESCE(v_links, '[]'::jsonb), 'others', v_list,
    'resend', jsonb_build_object('enabled', ec.resend_enabled, 'subject', ec.resend_subject, 'done_at', ec.resend_done_at, 'campaign_id', ec.resend_campaign_id),
    'blocks_version', ec.blocks_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_result_segments__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_at timestamptz;
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT c.sent_at INTO v_at FROM public.email_campaigns c
   WHERE c.id = p_campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
      AND public.crm_campaign_is_crm(c.id);
  IF v_at IS NULL THEN RETURN '[]'::jsonb; END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_at);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  WITH r AS (
    SELECT DISTINCT lower(x.email) AS em FROM public.email_campaign_recipients x
     WHERE x.campaign_id = p_campaign_id AND x.status IN ('sent', 'complained', 'bounced')
  ), o AS (
    SELECT DISTINCT lower(e.recipient_email) AS em FROM public.email_campaign_events e
     WHERE e.campaign_id = p_campaign_id AND e.event_type = 'opened' AND e.recipient_email IS NOT NULL
  ), k AS (
    SELECT DISTINCT email AS em FROM _cmk WHERE campaign_id = p_campaign_id
  ), b AS (
    SELECT email AS em, count(*) AS n, sum(amount) AS rev FROM _cma WHERE campaign_id = p_campaign_id GROUP BY 1
  ), z AS (
    SELECT COALESCE(cp.lifecycle, 'none') AS lc, count(*) AS n, count(o.em) AS opened, count(k.em) AS clicked,
           COALESCE(sum(b.n), 0) AS purchases, COALESCE(sum(b.rev), 0) AS revenue
      FROM r
      LEFT JOIN _cp cp ON cp.email = r.em
      LEFT JOIN o ON o.em = r.em
      LEFT JOIN k ON k.em = r.em
      LEFT JOIN b ON b.em = r.em
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('lifecycle', lc, 'n', n, 'opened', opened, 'clicked', clicked,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY n DESC), '[]'::jsonb)
    INTO v FROM z;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_send_options(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auto jsonb;
  v_saved jsonb := '[]'::jsonb;
  s record;
  r record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  -- Joignables : la même porte que l'envoi (opt-in newsletter de la portée).
  DROP TABLE IF EXISTS _cso;
  CREATE TEMP TABLE _cso ON COMMIT DROP AS
  SELECT p.*, 0::integer AS open_n FROM _cp p
   WHERE p.email_ok AND EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = p.email AND ns.opted_in
        AND ns.venue_id IS NOT DISTINCT FROM p_venue_id
        AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
        AND ns.product = 'crm');

  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at > now() - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND COALESCE(public.crm_campaign_is_crm(ec.id), false)
  ), o AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id)::integer AS n
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened' AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cso p SET open_n = o.n FROM o WHERE o.em = p.email;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', k.key, 'reach', COALESCE(a.reach, 0),
           'open_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.op / a.rec) END,
           'click_pct', CASE WHEN COALESCE(a.rec, 0) >= 20 THEN round(100.0 * a.cl / a.rec) END)
         ORDER BY k.ord), '[]'::jsonb)
    INTO v_auto
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) k(key, ord)
    LEFT JOIN (
      SELECT lifecycle, count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl
        FROM _cso GROUP BY lifecycle
    ) a ON a.lifecycle = k.key;

  FOR s IN
    SELECT id, name, description, definition FROM public.crm_segments
     WHERE venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY created_at DESC LIMIT 40
  LOOP
    EXECUTE format('SELECT count(*)::integer AS reach, sum(msg_n) AS rec, sum(LEAST(open_n, msg_n)) AS op, sum(LEAST(click_n, msg_n)) AS cl FROM _cso p WHERE (%s)',
                   public._crm_filter_sql(s.definition, 'p'))
      INTO r;
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'name', s.name, 'description', s.description, 'reach', COALESCE(r.reach, 0),
      'open_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.op / r.rec) END,
      'click_pct', CASE WHEN COALESCE(r.rec, 0) >= 20 THEN round(100.0 * r.cl / r.rec) END));
  END LOOP;

  RETURN jsonb_build_object('auto', v_auto, 'saved', v_saved,
    'rules', (SELECT to_jsonb(sr) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) sr));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_first_return_sms_collect()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a        record;
  g        record;
  v_scope  text;
  v_cid    uuid;
  v_n      integer;
  v_total  integer := 0;
  v_camps  integer := 0;
  w        record;
  v_left   integer;
  v_fr     integer;
  v_rates  jsonb := public.crm_sms_rates();
  v_retried integer := 0;
  v_expired integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR a IN
    SELECT x.* FROM public.email_automations x
     WHERE x.kind = 'first_return' AND x.enabled AND x.sms_enabled
       AND NULLIF(btrim(COALESCE(x.sms_body, '')), '') IS NOT NULL
  LOOP
   -- Une recette en erreur ne fait jamais tomber la collecte des autres comptes.
   BEGIN
    CONTINUE WHEN public.is_demo_marketing_scope(a.venue_id, a.organizer_user_id);
    v_scope := public.crm_scope_key(a.venue_id, a.organizer_user_id);
    CONTINUE WHEN public.crm_effective_plan(v_scope) = 'paused';
    CONTINUE WHEN NOT COALESCE((public.get_sms_sender_readiness(a.venue_id, a.organizer_user_id)->>'identity_ok')::boolean, false);

    -- Étape SMS retombée en brouillon faute de Yunits (20261014120000) : rien
    -- n'est parti. Chaque personne attend tant que sa fenêtre est ouverte
    -- (e-mail parti il y a moins de « délai + 3 » jours), que la soirée n'a pas
    -- commencé, qu'elle n'a pas pris de place et que son numéro reste
    -- joignable ; sinon elle ne partira plus (expired_at, « non envoyés »). La
    -- campagne repart seule dès que le solde couvre ceux qui restent.
    FOR w IN
      SELECT c.id, c.event_id, c.segments_per_message FROM public.sms_campaigns c
       WHERE c.status = 'draft' AND c.error_message = 'crm_yunits_insufficient'
         AND c.segment_filters->>'automation_id' = a.id::text
    LOOP
      UPDATE public.crm_first_return_sms s SET expired_at = now()
       WHERE s.automation_id = a.id AND s.campaign_id = w.id AND s.expired_at IS NULL
         AND (NOT EXISTS (
                SELECT 1 FROM public.email_automation_sends l
                  JOIN public.email_campaign_recipients r ON r.campaign_id = l.campaign_id AND lower(r.email) = lower(l.email)
                 WHERE l.automation_id = a.id AND l.trigger_key = 'fr' AND lower(l.email) = s.email
                   AND r.sent_at > now() - make_interval(days => a.sms_delay_days + 3))
           OR NOT EXISTS (SELECT 1 FROM public.events e
                           WHERE e.id = w.event_id AND e.cancelled_at IS NULL AND e.start_at > now() + interval '3 hours')
           OR EXISTS (SELECT 1 FROM public.events ev
                       WHERE ev.start_at > now() AND ev.cancelled_at IS NULL
                         AND ((a.venue_id IS NOT NULL AND ev.venue_id = a.venue_id)
                           OR (a.organizer_user_id IS NOT NULL AND ev.organizer_user_id = a.organizer_user_id))
                         AND public._email_event_holder(ev.id, s.email))
           OR EXISTS (SELECT 1 FROM public.sms_stop_list st
                       WHERE st.phone_e164 = s.phone_e164 AND (st.scope_key IS NULL OR st.scope_key = v_scope)));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_expired := v_expired + v_n;
      DELETE FROM public.sms_campaign_recipients q
       WHERE q.campaign_id = w.id AND q.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM public.crm_first_return_sms s
                          WHERE s.campaign_id = w.id AND s.phone_e164 = q.phone_e164 AND s.expired_at IS NULL);
      SELECT count(*), count(*) FILTER (WHERE q.phone_e164 LIKE '+33%') INTO v_left, v_fr
        FROM public.sms_campaign_recipients q WHERE q.campaign_id = w.id AND q.status = 'pending';
      IF v_left = 0 THEN
        UPDATE public.sms_campaigns SET status = 'cancelled', error_message = 'first_return_window_closed'
         WHERE id = w.id AND status = 'draft';
      ELSIF public.crm_yunits_balance(v_scope) >= GREATEST(1, COALESCE(w.segments_per_message, 1))
              * (v_fr * (v_rates->>'fr')::integer + (v_left - v_fr) * (v_rates->>'intl')::integer) THEN
        UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = now(), error_message = NULL,
               total_recipients = v_left, estimated_recipients = v_left, estimated_credits = v_left
         WHERE id = w.id AND status = 'draft';
        v_retried := v_retried + v_left;
      END IF;
    END LOOP;

    DROP TABLE IF EXISTS _frs;
    CREATE TEMP TABLE _frs ON COMMIT DROP AS
    WITH sent AS (
      -- L'e-mail est PARTI il y a N jours (fenêtre de 3 jours : rien en retard).
      SELECT DISTINCT ON (lower(l.email)) lower(l.email) AS em, c.event_id, r.first_name, r.last_name
        FROM public.email_automation_sends l
        JOIN public.email_campaigns c ON c.id = l.campaign_id
        JOIN public.email_campaign_recipients r ON r.campaign_id = c.id AND lower(r.email) = lower(l.email)
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.trigger_key = 'fr'
         AND r.sent_at IS NOT NULL
         AND r.sent_at <= now() - make_interval(days => a.sms_delay_days)
         AND r.sent_at > now() - make_interval(days => a.sms_delay_days + 3)
         AND c.event_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.crm_first_return_sms s WHERE s.automation_id = a.id AND s.email = lower(l.email))
       ORDER BY lower(l.email), r.sent_at DESC
    )
    SELECT s.em, s.event_id, s.first_name, s.last_name, ph.phone_e164
      FROM sent s
      JOIN public.events e ON e.id = s.event_id AND e.cancelled_at IS NULL AND e.start_at > now() + interval '3 hours'
      JOIN LATERAL (
        SELECT vc.phone_e164 FROM public.venue_sms_contacts vc
         WHERE lower(vc.email) = s.em
           AND vc.product = 'crm'
           AND ((a.venue_id IS NOT NULL AND vc.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND vc.organizer_user_id = a.organizer_user_id))
           AND NOT COALESCE(vc.unsubscribed, false)
           AND vc.sms_consent_at > now() - interval '36 months'
           AND vc.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         ORDER BY vc.sms_consent_at DESC LIMIT 1
      ) ph ON true
     -- Toujours sans place : ni pour cette soirée, ni pour une autre à venir.
     WHERE NOT EXISTS (
             SELECT 1 FROM public.events ev
              WHERE ev.start_at > now() AND ev.cancelled_at IS NULL
                AND ((a.venue_id IS NOT NULL AND ev.venue_id = a.venue_id)
                  OR (a.organizer_user_id IS NOT NULL AND ev.organizer_user_id = a.organizer_user_id))
                AND public._email_event_holder(ev.id, s.em))
       AND NOT EXISTS (SELECT 1 FROM public.sms_stop_list st
                        WHERE st.phone_e164 = ph.phone_e164 AND (st.scope_key IS NULL OR st.scope_key = v_scope))
       AND public.sms_tariff_zone(ph.phone_e164) <> 'blocked';

    FOR g IN SELECT f.event_id, ev.title, count(*) AS n FROM _frs f JOIN public.events ev ON ev.id = f.event_id GROUP BY 1, 2 LOOP
      INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                        event_id, quiet_hours, estimated_recipients, segments_per_message, estimated_credits)
      VALUES (a.venue_id, CASE WHEN a.venue_id IS NULL THEN a.organizer_user_id END,
              COALESCE(a.created_by, a.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = a.venue_id)),
              left('Faire revenir après la 1re soirée · ' || COALESCE(g.title, ''), 120),
              a.sms_body, jsonb_build_object('type', 'crm', 'automation', 'first_return', 'automation_id', a.id),
              'draft', g.event_id, true, g.n, 1, g.n)
      RETURNING id INTO v_cid;
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name)
      SELECT v_cid, f.phone_e164, NULLIF(btrim(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), ''), f.first_name
        FROM (SELECT DISTINCT ON (phone_e164) * FROM _frs WHERE event_id = g.event_id ORDER BY phone_e164, em) f
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      INSERT INTO public.crm_first_return_sms (automation_id, email, phone_e164, event_id, campaign_id)
      SELECT a.id, f.em, f.phone_e164, f.event_id, v_cid FROM _frs f WHERE f.event_id = g.event_id
      ON CONFLICT DO NOTHING;
      UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = now(), total_recipients = v_n,
             estimated_recipients = v_n, estimated_credits = v_n
       WHERE id = v_cid;
      v_total := v_total + v_n;
      v_camps := v_camps + 1;
    END LOOP;
   EXCEPTION WHEN others THEN
    RAISE WARNING 'crm_first_return_sms_collect (%): %', a.id, SQLERRM;
   END;
  END LOOP;
  RETURN jsonb_build_object('campaigns', v_camps, 'recipients', v_total, 'retried', v_retried, 'expired', v_expired);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_first_steps(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope    text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_now      timestamptz := now();
  v_crm_only boolean;
  v_holder   uuid;
  v_conn     record;
  v_ident    jsonb;
  v_sent     record;
  v_draft    record;
  v_recipes  integer;
  v_scen     integer;
  v_claude   boolean;
  v_segments integer;
  v_team     integer;
  v_buyers   integer;
  v_ev       record;
  v_sub      record;
  v_pref     record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Un compte au seul produit CRM : toutes ses campagnes et recettes sont du CRM.
  -- Un compte Billetterie + CRM : seulement celles marquées `product = 'crm'`.
  v_crm_only := public.crm_scope_is_crm(v_scope);
  v_holder := CASE WHEN p_venue_id IS NOT NULL
                   THEN (SELECT v.owner_id FROM public.venues v WHERE v.id = p_venue_id)
                   ELSE p_organizer_user_id END;

  -- 1. Shotgun : la connexion de la portée (la plus récente).
  SELECT c.status, c.external_org_name, c.initial_import_done_at, c.last_ok_at,
         NULLIF(c.stats->>'tickets', '')::bigint AS tickets,
         NULLIF(c.stats->>'events', '')::bigint AS events,
         NULLIF(c.stats->>'buyers', '')::bigint AS buyers
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE c.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND c.organizer_user_id = p_organizer_user_id))
   ORDER BY c.created_at DESC
   LIMIT 1;

  -- 2. Identité de l'expéditeur : la même porte que l'envoi.
  v_ident := public._crm_email_identity(p_venue_id, p_organizer_user_id);

  -- 3. Premier e-mail : une campagne manuelle partie, en cours ou programmée.
  SELECT count(*)::int AS n, min(COALESCE(c.sent_at, c.scheduled_at, c.updated_at)) AS first_at
    INTO v_sent
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.status IN ('sent', 'sending', 'scheduled')
     AND (v_crm_only OR c.product = 'crm');

  SELECT c.id, c.name, c.updated_at
    INTO v_draft
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.status = 'draft'
     AND (v_crm_only OR c.product = 'crm')
   ORDER BY c.updated_at DESC
   LIMIT 1;

  -- 4. Automatisation : une recette allumée, ou un scénario en ligne.
  SELECT count(*)::int INTO v_recipes
    FROM public.email_automations a
   WHERE a.enabled
     AND ((p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND a.organizer_user_id = p_organizer_user_id))
     AND a.product = 'crm';
  SELECT count(*)::int INTO v_scen
    FROM public.crm_scenarios s
   WHERE s.scope_key = v_scope AND s.status = 'active';

  -- 5. Claude (ou toute IA branchée par le MCP) : une connexion vivante sur l'espace,
  --    la sienne ou celle d'un membre de l'équipe.
  SELECT EXISTS (SELECT 1 FROM public.mcp_grants g WHERE g.revoked_at IS NULL AND v_scope = ANY (g.spaces))
    INTO v_claude;

  -- Pour aller plus loin : segments et équipe (même règle que l'Admin CRM).
  SELECT count(*)::int INTO v_segments FROM public.crm_segments s WHERE s.scope_key = v_scope;
  v_team := CASE WHEN p_venue_id IS NULL
                 THEN (SELECT count(*) FROM public.org_members m
                        WHERE m.organizer_user_id = p_organizer_user_id AND m.invitation_status = 'accepted')
                 ELSE (SELECT count(*) FROM public.manager_permissions mp WHERE mp.venue_id = p_venue_id) END;

  -- Le vrai résultat, une fois un e-mail parti : des acheteurs dont le billet
  -- porte la source d'un e-mail Yuno (`utm_source` yuno-m-…, famille « em »).
  IF COALESCE(v_sent.n, 0) > 0 THEN
    SELECT count(DISTINCT lower(t.buyer_email))::int INTO v_buyers
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.utm IS NOT NULL
       AND lower(t.utm->>'utm_source') LIKE 'yuno-m-%'
       AND t.status IN ('valid', 'transferred')
       AND t.buyer_email IS NOT NULL;
  END IF;

  -- La prochaine soirée (même règle que l'Accueil) : le premier e-mail s'y relie.
  SELECT e.id, e.title, e.start_at,
         ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
           - (v_now AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date) AS days_to
    INTO v_ev
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_now
     AND x.cancelled_at IS NULL
   ORDER BY e.start_at ASC
   LIMIT 1;

  SELECT s.status, s.offer, s.offer_until, s.trial_ends_at, s.created_at
    INTO v_sub
    FROM public.crm_subscriptions s
   WHERE s.scope_key = v_scope;

  SELECT f.dismissed_at, f.snoozed_until, f.finished_at
    INTO v_pref
    FROM public.crm_first_steps f
   WHERE f.user_id = auth.uid() AND f.scope_key = v_scope;

  RETURN jsonb_build_object(
    'now', v_now,
    'steps', jsonb_build_object(
      'shotgun', jsonb_build_object(
        'done', COALESCE(v_conn.status = 'active', false),
        'state', CASE WHEN v_conn.status IS NULL THEN 'off'
                      WHEN v_conn.status IN ('token_invalid', 'error') THEN 'broken'
                      WHEN v_conn.status = 'active' AND v_conn.initial_import_done_at IS NULL THEN 'importing'
                      WHEN v_conn.status = 'active' THEN 'on'
                      ELSE 'off' END,
        'org', v_conn.external_org_name,
        'tickets', v_conn.tickets, 'events', v_conn.events, 'buyers', v_conn.buyers),
      'identity', jsonb_build_object(
        'done', COALESCE((v_ident->>'ready')::boolean, false),
        'missing', COALESCE(v_ident->'missing', '[]'::jsonb)),
      'email', jsonb_build_object(
        'done', COALESCE(v_sent.n, 0) > 0,
        'n', COALESCE(v_sent.n, 0),
        'draft', CASE WHEN v_draft.id IS NOT NULL
                      THEN jsonb_build_object('id', v_draft.id, 'name', v_draft.name, 'updated_at', v_draft.updated_at) END),
      'automation', jsonb_build_object(
        'done', COALESCE(v_recipes, 0) + COALESCE(v_scen, 0) > 0,
        'recipes', COALESCE(v_recipes, 0), 'scenarios', COALESCE(v_scen, 0)),
      'claude', jsonb_build_object('done', COALESCE(v_claude, false)),
      'segments', jsonb_build_object('done', COALESCE(v_segments, 0) > 0, 'n', COALESCE(v_segments, 0)),
      'team', jsonb_build_object('done', COALESCE(v_team, 0) > 0, 'n', COALESCE(v_team, 0))),
    'outcome', CASE WHEN COALESCE(v_sent.n, 0) > 0 THEN jsonb_build_object('buyers', COALESCE(v_buyers, 0)) END,
    'next_night', CASE WHEN v_ev.id IS NOT NULL
                       THEN jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'days_to', v_ev.days_to) END,
    'offer', CASE WHEN v_sub.status IS NOT NULL THEN jsonb_build_object(
                    'status', v_sub.status, 'offer', v_sub.offer, 'offer_until', v_sub.offer_until,
                    'trial_ends_at', v_sub.trial_ends_at) END,
    'opened_at', v_sub.created_at,
    'yunits', public.crm_yunits_balance(v_scope),
    'holder', jsonb_build_object(
      'is_me', v_holder IS NOT DISTINCT FROM auth.uid(),
      'first_name', (SELECT NULLIF(btrim(p.first_name), '') FROM public.profiles p WHERE p.id = v_holder)),
    'pref', jsonb_build_object(
      'dismissed_at', v_pref.dismissed_at, 'snoozed_until', v_pref.snoozed_until, 'finished_at', v_pref.finished_at)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_from  timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 180), 1), 730));
  v_sends jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH grp AS (
    -- E-mails « Qui cibler »
    SELECT 'email'::text AS channel, c.id::text AS id, c.name AS label, c.event_id,
           min(r.created_at) AS t0, r.email,
           (r.status = 'skipped' AND r.error_message = 'holdout') AS ctl
      FROM public.email_campaigns c
      JOIN public.email_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.holdout_count > 0 AND c.event_id IS NOT NULL AND public.crm_campaign_is_crm(c.id)
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.created_at >= v_from
       AND (r.status NOT IN ('skipped', 'suppressed') OR r.error_message = 'holdout')
     GROUP BY c.id, c.name, c.event_id, r.email, r.status, r.error_message
    UNION ALL
    -- SMS « Qui cibler »
    SELECT 'sms', c.id::text, c.name, c.event_id, min(r.created_at), r.email,
           (r.status = 'skipped' AND r.error_code = 'holdout')
      FROM public.sms_campaigns c
      JOIN public.sms_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.holdout_count > 0 AND c.event_id IS NOT NULL AND r.email IS NOT NULL AND c.product = 'crm'
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
       AND c.created_at >= v_from
       AND (r.status <> 'skipped' OR r.error_code = 'holdout')
     GROUP BY c.id, c.name, c.event_id, r.email, r.status, r.error_code
    UNION ALL
    -- Recettes
    SELECT 'recipe', a.kind, NULL, COALESCE(l.trigger_event_id, l.bind_event_id), l.created_at, lower(l.email),
           (l.status = 'skipped' AND l.skip_reason = 'holdout')
      FROM public.email_automation_sends l
      JOIN public.email_automations a ON a.id = l.automation_id AND a.product = 'crm'
     WHERE l.venue_id IS NOT DISTINCT FROM p_venue_id AND l.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND l.created_at >= v_from AND COALESCE(l.trigger_event_id, l.bind_event_id) IS NOT NULL
       AND (l.status = 'queued' OR l.skip_reason = 'holdout')
       AND EXISTS (SELECT 1 FROM public.email_automation_sends h
                    WHERE h.automation_id = l.automation_id AND h.skip_reason = 'holdout')
  ), y AS (
    SELECT g.*, EXISTS (
             SELECT 1 FROM public.external_tickets t
              WHERE t.event_id = g.event_id AND lower(t.buyer_email) = lower(g.email)
                AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                AND COALESCE(t.purchased_at, t.first_seen_at) > g.t0) AS bought
      FROM grp g
  ), s AS (
    SELECT y.channel, y.id, max(y.label) AS label,
           CASE WHEN count(DISTINCT y.event_id) = 1 THEN (array_agg(y.event_id))[1] END AS event_id,
           count(*) FILTER (WHERE NOT y.ctl) AS n_c, count(*) FILTER (WHERE NOT y.ctl AND y.bought) AS b_c,
           count(*) FILTER (WHERE y.ctl) AS n_h, count(*) FILTER (WHERE y.ctl AND y.bought) AS b_h,
           min(y.t0) AS sent_at,
           bool_and(EXISTS (SELECT 1 FROM public.events e WHERE e.id = y.event_id AND e.start_at < now())) AS done,
           count(DISTINCT y.event_id) AS nights
      FROM y GROUP BY y.channel, y.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', s.channel, 'id', s.id, 'label', s.label, 'event_id', s.event_id,
           'sent_at', s.sent_at, 'done', s.done, 'nights', s.nights,
           'contacted', jsonb_build_object('n', s.n_c, 'buyers', s.b_c),
           'control', jsonb_build_object('n', s.n_h, 'buyers', s.b_h),
           -- Acheteurs en plus = contactés × (taux contacté − taux témoin) ;
           -- z du test de deux proportions (≥ 2 : différence nette).
           'extra', CASE WHEN s.n_c >= 10 AND s.n_h >= 10
                         THEN round(s.n_c * (s.b_c::numeric / s.n_c - s.b_h::numeric / s.n_h), 1) END,
           'z', CASE WHEN s.n_c >= 10 AND s.n_h >= 10 AND (s.b_c + s.b_h) > 0 AND (s.b_c + s.b_h) < (s.n_c + s.n_h) THEN round((
                  (s.b_c::numeric / s.n_c - s.b_h::numeric / s.n_h)
                  / sqrt(((s.b_c + s.b_h)::numeric / (s.n_c + s.n_h)) * (1 - (s.b_c + s.b_h)::numeric / (s.n_c + s.n_h))
                         * (1.0 / s.n_c + 1.0 / s.n_h)))::numeric, 2) END)
         ORDER BY s.sent_at DESC), '[]'::jsonb)
    INTO v_sends FROM s;

  RETURN jsonb_build_object('pct', public.crm_holdout_pct(v_key), 'sends', v_sends);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_import_commit(p_venue_id text, p_organizer_user_id uuid, p_list_import_id uuid, p_rows jsonb, p_consent text, p_mode text, p_title text, p_final boolean DEFAULT false, p_stats jsonb DEFAULT NULL::jsonb, p_kind text DEFAULT 'file'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_consent text := CASE WHEN p_consent = 'yes' THEN 'yes' ELSE 'no' END;
  v_mode text := CASE WHEN p_mode = 'keep' THEN 'keep' ELSE 'complete' END;
  v_kind text := CASE WHEN p_kind = 'manual' THEN 'manual' ELSE 'file' END;
  v_channels jsonb;
  v_details text;
  v_list uuid := p_list_import_id;
  v_res jsonb;
  v_ci public.crm_imports%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 2000 THEN
    RAISE EXCEPTION 'invalid_rows' USING ERRCODE = '22023';
  END IF;
  v_channels := CASE WHEN v_consent = 'yes' THEN '{"email": true, "sms": true}'::jsonb ELSE '{"email": false, "sms": false}'::jsonb END;
  v_details := CASE WHEN v_consent = 'yes'
                    THEN 'Console CRM : le pro atteste l''accord de ces personnes pour recevoir ses e-mails et SMS.'
                    ELSE 'Console CRM : contacts enregistrés sans accord, aucun envoi.' END;

  -- 1er lot : la liste naît vide (import_contact_list la crée), puis on la note.
  IF v_list IS NULL THEN
    v_res := public.import_contact_list(
      '[]'::jsonb, 'other', p_venue_id, p_organizer_user_id, left(COALESCE(p_title, 'Import'), 200), v_details,
      NULL, NULL, left(COALESCE(p_title, 'Import'), 60), 'FR', v_channels, NULL, 'append', false, 'crm');
    v_list := (v_res->>'list_import_id')::uuid;
    INSERT INTO public.crm_imports (list_import_id, scope_key, venue_id, organizer_user_id, kind, title, consent, mode, created_by)
    VALUES (v_list, v_scope, p_venue_id, p_organizer_user_id, v_kind, left(COALESCE(p_title, 'Import'), 200), v_consent, v_mode, auth.uid());
  END IF;

  SELECT * INTO v_ci FROM public.crm_imports WHERE list_import_id = v_list AND scope_key = v_scope;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ci.status <> 'running' THEN RAISE EXCEPTION 'import_closed' USING ERRCODE = '22023'; END IF;

  -- Journal : l'état d'abonnement e-mail d'avant, pour chaque adresse du lot
  -- déjà connue de la portée (une adresse nouvelle n'a pas d'avant).
  IF v_ci.consent = 'yes' THEN
    INSERT INTO public.crm_import_journal (list_import_id, email, prev_opted_in, prev_import_id, prev_first_name, prev_last_name)
    SELECT v_list, lower(ns.email), ns.opted_in, ns.import_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.product = 'crm'
       AND lower(ns.email) IN (SELECT lower(btrim(x->>'email')) FROM jsonb_array_elements(p_rows) x WHERE x ? 'email')
    ON CONFLICT (list_import_id, email) DO NOTHING;
  END IF;

  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 0 OR p_final THEN
    v_res := public.import_contact_list(
      COALESCE(p_rows, '[]'::jsonb), 'other', p_venue_id, p_organizer_user_id, v_ci.title, v_details,
      NULL, v_list, NULL, 'FR', v_channels, NULL, 'append', COALESCE(p_final, false), 'crm');
  END IF;

  IF p_stats IS NOT NULL THEN
    UPDATE public.crm_imports
       SET new_count = GREATEST(0, COALESCE((p_stats->>'new')::int, new_count)),
           existing_count = GREATEST(0, COALESCE((p_stats->>'existing')::int, existing_count)),
           file_dup_count = GREATEST(0, COALESCE((p_stats->>'dup')::int, file_dup_count)),
           bad_count = GREATEST(0, COALESCE((p_stats->>'bad')::int, bad_count))
     WHERE list_import_id = v_list;
  END IF;
  IF p_final THEN
    UPDATE public.crm_imports SET status = 'done', finished_at = now() WHERE list_import_id = v_list;
  END IF;
  RETURN jsonb_build_object('list_import_id', v_list, 'rows', COALESCE(v_res->'rows', '0'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_import_undo(p_venue_id text, p_organizer_user_id uuid, p_list_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ci public.crm_imports%ROWTYPE;
  v_email_import uuid;
  v_sms_import uuid;
  v_contacts integer;
  v_restored integer := 0;
  v_deleted integer := 0;
  v_sms integer := 0;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ci FROM public.crm_imports WHERE list_import_id = p_list_import_id AND scope_key = v_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ci.status = 'undone' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  SELECT email_import_id, sms_import_id INTO v_email_import, v_sms_import
    FROM public.contact_list_imports WHERE id = p_list_import_id;

  IF v_email_import IS NOT NULL THEN
    -- Réactivés par cet import : leur état d'avant (sauf désabonnement depuis).
    WITH r AS (
      UPDATE public.newsletter_subscriptions ns
         SET opted_in = j.prev_opted_in, import_id = j.prev_import_id,
             first_name = j.prev_first_name, last_name = j.prev_last_name, updated_at = now()
        FROM public.crm_import_journal j
       WHERE j.list_import_id = p_list_import_id
         AND lower(ns.email) = j.email
         AND ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND ns.product = 'crm'
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_restored FROM r;
    -- Créés par cet import : retirés (un désabonné reste, c'est sa mémoire).
    WITH d AS (
      DELETE FROM public.newsletter_subscriptions ns
       WHERE ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND ns.product = 'crm'
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND NOT EXISTS (SELECT 1 FROM public.crm_import_journal j WHERE j.list_import_id = p_list_import_id AND j.email = lower(ns.email))
      RETURNING 1
    ) SELECT count(*) INTO v_deleted FROM d;
  END IF;

  IF v_sms_import IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.venue_sms_contacts vc
       WHERE vc.import_id = v_sms_import
         AND vc.product = 'crm'
         AND COALESCE(vc.unsubscribed, false) = false
      RETURNING 1
    ) SELECT count(*) INTO v_sms FROM d;
  END IF;

  WITH d AS (DELETE FROM public.imported_contacts WHERE list_import_id = p_list_import_id RETURNING 1)
  SELECT count(*) INTO v_contacts FROM d;

  UPDATE public.contact_list_imports SET superseded_at = now() WHERE id = p_list_import_id AND superseded_at IS NULL;
  UPDATE public.crm_imports SET status = 'undone', undone_at = now(), undone_by = auth.uid() WHERE list_import_id = p_list_import_id;

  RETURN jsonb_build_object('ok', true, 'contacts', v_contacts, 'emails_removed', v_deleted, 'emails_restored', v_restored, 'sms_removed', v_sms);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_imports_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_conn jsonb;
  v_sync jsonb;
  v_imports jsonb;
  v_legacy jsonb;
  v_day date;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'state', CASE WHEN c.status IN ('token_invalid', 'error') THEN 'broken'
                         WHEN c.status = 'disconnected' THEN 'off' ELSE 'on' END,
           'status', c.status, 'org_name', c.external_org_name,
           'last_ok_at', c.last_ok_at, 'last_error_at', c.last_error_at)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE c.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
   ORDER BY c.updated_at DESC LIMIT 1;

  -- Dernier jour où Shotgun a apporté des acheteurs : nouveaux (premier billet
  -- vu ce jour-là) et déjà présents (un billet plus ancien existait).
  WITH t AS (
    SELECT lower(et.buyer_email) AS email, et.first_seen_at
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
  )
  SELECT max((first_seen_at AT TIME ZONE 'Europe/Paris')::date) INTO v_day FROM t;
  IF v_day IS NOT NULL THEN
    WITH t AS (
      SELECT lower(et.buyer_email) AS email, et.first_seen_at
        FROM public.external_tickets et
       WHERE et.buyer_email IS NOT NULL
         AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
    ), f AS (SELECT email, min(first_seen_at) AS first_at FROM t GROUP BY email),
    d AS (SELECT DISTINCT email FROM t WHERE (first_seen_at AT TIME ZONE 'Europe/Paris')::date = v_day)
    -- « Nouveau » = absent de la base AVANT ce jour : ni billet Shotgun plus
    -- ancien, ni contact du registre ou d'un fichier importé. Au premier
    -- import, un acheteur déjà dans la base (fichier importé avant) est
    -- « déjà présent », plus « nouveau ».
    SELECT jsonb_build_object(
             'day', v_day,
             'new', count(*) FILTER (WHERE (f.first_at AT TIME ZONE 'Europe/Paris')::date = v_day AND NOT k.known),
             'existing', count(*) FILTER (WHERE (f.first_at AT TIME ZONE 'Europe/Paris')::date < v_day OR k.known))
      INTO v_sync
      FROM d JOIN f ON f.email = d.email
      CROSS JOIN LATERAL (
        SELECT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE lower(ns.email) = d.email
                    AND ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
                    AND ns.product = 'crm'
                    AND ns.created_at < (v_day::timestamp AT TIME ZONE 'Europe/Paris'))
            OR EXISTS (
                 SELECT 1 FROM public.imported_contacts ic
                  WHERE ic.email = d.email
                    AND ((p_venue_id IS NOT NULL AND ic.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND ic.organizer_user_id = p_organizer_user_id))
                    AND ic.product = 'crm'
                    AND ic.created_at < (v_day::timestamp AT TIME ZONE 'Europe/Paris')) AS known
      ) k;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.list_import_id, 'kind', i.kind, 'title', i.title, 'consent', i.consent,
           'created_at', i.created_at, 'status', i.status, 'undone_at', i.undone_at,
           'new', i.new_count, 'existing', i.existing_count, 'dup', i.file_dup_count, 'bad', i.bad_count)
           ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_imports
    FROM (SELECT * FROM public.crm_imports WHERE scope_key = v_scope AND status <> 'running' ORDER BY created_at DESC LIMIT 30) i;

  -- Fichiers importés avant la Console CRM (outil d'import de la Suite).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', COALESCE(l.list_name, l.filename), 'created_at', l.created_at, 'rows', l.row_count)
           ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO v_legacy
    FROM (SELECT * FROM public.contact_list_imports l
           WHERE public.marketing_scope_match(l.venue_id, l.organizer_user_id, p_venue_id, p_organizer_user_id)
             AND l.product = 'crm'
             AND l.superseded_by IS NULL AND l.superseded_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.crm_imports c WHERE c.list_import_id = l.id)
           ORDER BY l.created_at DESC LIMIT 10) l;

  RETURN jsonb_build_object('connection', v_conn, 'sync', v_sync, 'imports', v_imports, 'legacy', v_legacy);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_journey__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_campaign uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'all'::text, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_days int := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 WHEN '12m' THEN 365 ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz;
  v_pfrom timestamptz;
  v_seg text := CASE WHEN p_seg IN ('nou', 'occ', 'hab', 'end', 'none') THEN p_seg ELSE 'all' END;
  v_ch text := CASE WHEN p_channel IN ('email', 'sms', 'ig') THEN p_channel ELSE 'all' END;
  v_write boolean := public.crm_scope_writable(p_venue_id, p_organizer_user_id);
  v_camp_id uuid; v_camp_at timestamptz;
  v_funnel jsonb; v_prev jsonb; v_steps jsonb; v_paths jsonb; v_delays jsonb; v_camps jsonb;
  v_examples jsonb; v_cover jsonb; v_spark jsonb; v_bars jsonb; v_options jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_to - make_interval(days => v_days);
  -- Pas de fenêtre précédente au-delà de 90 jours (comme Analyses).
  v_pfrom := CASE WHEN v_days <= 90 THEN v_from - make_interval(days => v_days) ELSE v_from END;

  IF p_campaign IS NOT NULL THEN
    SELECT c.id, c.sent_at INTO v_camp_id, v_camp_at FROM public.email_campaigns c
     WHERE c.id = p_campaign AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id AND public.crm_campaign_is_crm(c.id);
  END IF;

  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  -- Tous les envois reçus de la portée (automatisations comprises), lus une
  -- seule fois : les questions « qu'a-t-il reçu avant ? » passent par ici.
  DROP TABLE IF EXISTS _jrc;
  CREATE TEMP TABLE _jrc ON COMMIT DROP AS
  SELECT r.campaign_id, lower(r.email) AS email, c.sent_at, (ec.automation_id IS NOT NULL) AS auto
    FROM _cmc c
    JOIN public.email_campaigns ec ON ec.id = c.id
    JOIN public.email_campaign_recipients r ON r.campaign_id = c.id AND r.status IN ('sent', 'complained');
  CREATE INDEX ON _jrc (email, sent_at);
  CREATE INDEX ON _jrc (campaign_id, email);

  -- Campagnes de la sélection : courante (w = 0), précédente (w = 1). Une
  -- campagne choisie l'est quelle que soit la période.
  DROP TABLE IF EXISTS _jc;
  CREATE TEMP TABLE _jc ON COMMIT DROP AS
  SELECT c.id, c.name, c.sent_at, c.event_id,
         CASE WHEN p_campaign IS NOT NULL OR c.sent_at >= v_from THEN 0 ELSE 1 END AS w
    FROM public.email_campaigns c
   WHERE v_ch IN ('all', 'email')
     AND c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND public.crm_campaign_is_crm(c.id)
     AND (p_campaign IS NOT NULL OR (c.sent_at >= v_pfrom AND c.sent_at < v_to))
     AND (p_campaign IS NULL OR c.id = p_campaign)
     AND (p_event IS NULL OR p_campaign IS NOT NULL OR c.event_id = p_event);

  DROP TABLE IF EXISTS _jo;
  CREATE TEMP TABLE _jo ON COMMIT DROP AS
  SELECT DISTINCT e.campaign_id, lower(e.recipient_email) AS email
    FROM public.email_campaign_events e JOIN _jc c ON c.id = e.campaign_id
   WHERE e.event_type IN ('opened', 'clicked') AND e.recipient_email IS NOT NULL;
  CREATE INDEX ON _jo (campaign_id, email);

  -- Une ligne par (campagne, personne).
  DROP TABLE IF EXISTS _jr;
  CREATE TEMP TABLE _jr ON COMMIT DROP AS
  SELECT c.id AS campaign_id, c.w, c.sent_at, r.email,
         COALESCE(p.lifecycle, 'none') AS lifecycle, COALESCE(p.email_ok, false) AS email_ok,
         (o.email IS NOT NULL) AS opened,
         EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = c.id AND k.email = r.email) AS clicked,
         b.bought_at, b.event_id AS bought_event, b.amount,
         false AS back
    FROM _jc c
    JOIN _jrc r ON r.campaign_id = c.id
    LEFT JOIN _cp p ON p.email = r.email
    LEFT JOIN _jo o ON o.campaign_id = c.id AND o.email = r.email
    LEFT JOIN LATERAL (
      SELECT (array_agg(a.bought_at ORDER BY a.bought_at))[1] AS bought_at,
             (array_agg(t.event_id ORDER BY a.bought_at))[1] AS event_id,
             sum(a.amount) AS amount
        FROM _cma a LEFT JOIN _cpt t ON t.id = a.id
       WHERE a.campaign_id = c.id AND a.email = r.email
    ) b ON true
   WHERE v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg;
  UPDATE _jr SET opened = true WHERE clicked AND NOT opened;
  UPDATE _jr j SET back = true
   WHERE j.bought_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM _cpt t WHERE t.email = j.email AND t.bought_at > j.bought_at
                    AND t.bought_at <= j.bought_at + interval '90 days'
                    AND t.event_id IS DISTINCT FROM j.bought_event);
  CREATE INDEX ON _jr (email);
  CREATE INDEX ON _jr (campaign_id);

  -- Une ligne par personne (fenêtre courante) : son étape la plus avancée, et
  -- la campagne qui la porte à chaque étape (la plus récente).
  DROP TABLE IF EXISTS _jpp;
  CREATE TEMP TABLE _jpp ON COMMIT DROP AS
  SELECT j.email, max(j.lifecycle) AS lifecycle, bool_or(j.email_ok) AS email_ok,
         bool_or(j.opened) AS o, bool_or(j.clicked) AS c, bool_or(j.bought_at IS NOT NULL) AS b, bool_or(j.back) AS bk,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC))[1] AS c0,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC) FILTER (WHERE j.opened))[1] AS c1,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC) FILTER (WHERE j.clicked))[1] AS c2,
         (array_agg(j.campaign_id ORDER BY j.sent_at DESC) FILTER (WHERE j.bought_at IS NOT NULL))[1] AS c3,
         min(j.bought_at) AS bought_at
    FROM _jr j WHERE j.w = 0 GROUP BY j.email;

  SELECT jsonb_build_array(count(*), count(*) FILTER (WHERE o), count(*) FILTER (WHERE c),
                           count(*) FILTER (WHERE b), count(*) FILTER (WHERE bk))
    INTO v_funnel FROM _jpp;
  IF p_campaign IS NULL AND v_days <= 90 THEN
    SELECT jsonb_build_array(
             count(DISTINCT email), count(DISTINCT email) FILTER (WHERE opened), count(DISTINCT email) FILTER (WHERE clicked),
             count(DISTINCT email) FILTER (WHERE bought_at IS NOT NULL), count(DISTINCT email) FILTER (WHERE back))
      INTO v_prev FROM _jr WHERE w = 1;
  END IF;

  -- Personnes touchées (14 cases) et acheteurs (6 cases) sur la fenêtre.
  IF p_campaign IS NULL THEN
    SELECT jsonb_agg((SELECT count(DISTINCT j.email) FROM _jr j
                       WHERE j.w = 0 AND j.sent_at >= v_from + make_interval(secs => g * v_days * 86400 / 14.0)
                         AND j.sent_at < v_from + make_interval(secs => (g + 1) * v_days * 86400 / 14.0)) ORDER BY g)
      INTO v_spark FROM generate_series(0, 13) g;
    SELECT jsonb_agg((SELECT count(*) FROM _jpp p
                       WHERE p.bought_at >= v_from + make_interval(secs => g * v_days * 86400 / 6.0)
                         AND p.bought_at < v_from + make_interval(secs => (g + 1) * v_days * 86400 / 6.0)) ORDER BY g)
      INTO v_bars FROM generate_series(0, 5) g;
  END IF;

  -- Qui s'arrête après chaque étape.
  DROP TABLE IF EXISTS _jl;
  CREATE TEMP TABLE _jl ON COMMIT DROP AS
  SELECT k, p.email, p.lifecycle, p.email_ok,
         CASE k WHEN 0 THEN p.c0 WHEN 1 THEN p.c1 WHEN 2 THEN p.c2 ELSE p.c3 END AS cid
    FROM generate_series(0, 3) k
    JOIN _jpp p ON CASE k WHEN 0 THEN NOT p.o WHEN 1 THEN p.o AND NOT p.c
                          WHEN 2 THEN p.c AND NOT p.b ELSE p.b AND NOT p.bk END;
  SELECT jsonb_agg(jsonb_build_object(
           'k', kk.k,
           'lost', (SELECT count(*) FROM _jl l WHERE l.k = kk.k),
           'reach', (SELECT count(*) FROM _jl l WHERE l.k = kk.k AND l.email_ok),
           'by_campaign', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.cid, 'name', c.name, 'n', q.n) ORDER BY q.n DESC, c.name), '[]'::jsonb)
                             FROM (SELECT l.cid, count(*) AS n FROM _jl l WHERE l.k = kk.k GROUP BY l.cid ORDER BY count(*) DESC LIMIT 4) q
                             JOIN _jc c ON c.id = q.cid),
           'by_seg', (SELECT jsonb_build_object(
                         'hab', count(*) FILTER (WHERE l.lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE l.lifecycle = 'occ'),
                         'nou', count(*) FILTER (WHERE l.lifecycle = 'nou'), 'end', count(*) FILTER (WHERE l.lifecycle = 'end'),
                         'none', count(*) FILTER (WHERE l.lifecycle NOT IN ('hab', 'occ', 'nou', 'end')))
                        FROM _jl l WHERE l.k = kk.k),
           -- L'audience exacte pour « Relancer » (écriture seulement, 2 000 au plus).
           'emails', CASE WHEN v_write AND (SELECT count(*) FROM _jl l WHERE l.k = kk.k AND l.email_ok) BETWEEN 1 AND 2000
                          THEN (SELECT jsonb_agg(l.email) FROM _jl l WHERE l.k = kk.k AND l.email_ok) END
         ) ORDER BY kk.k)
    INTO v_steps FROM generate_series(0, 3) kk(k);

  -- Délai du premier clic (30 jours avant) au premier achat rattaché, et
  -- messages reçus (automatisations comprises) dans les 30 jours d'avant.
  WITH d AS (
    SELECT p.email, p.bought_at, 0 AS w,
           extract(epoch FROM p.bought_at - (SELECT min(k.at) FROM _cmk k WHERE k.email = p.email AND k.at <= p.bought_at
                                                AND k.at > p.bought_at - interval '30 days')) / 3600.0 AS h
      FROM _jpp p WHERE p.b
    UNION ALL
    SELECT x.email, x.bought_at, 1,
           extract(epoch FROM x.bought_at - (SELECT min(k.at) FROM _cmk k WHERE k.email = x.email AND k.at <= x.bought_at
                                                AND k.at > x.bought_at - interval '30 days')) / 3600.0
      FROM (SELECT j.email, min(j.bought_at) AS bought_at FROM _jr j WHERE j.w = 1 AND j.bought_at IS NOT NULL GROUP BY j.email) x
  )
  SELECT jsonb_build_object(
           'n', count(*) FILTER (WHERE d.w = 0),
           'b', jsonb_build_array(count(*) FILTER (WHERE d.w = 0 AND d.h < 24), count(*) FILTER (WHERE d.w = 0 AND d.h >= 24 AND d.h < 72),
                                  count(*) FILTER (WHERE d.w = 0 AND d.h >= 72 AND d.h < 192), count(*) FILTER (WHERE d.w = 0 AND d.h >= 192)),
           'median_h', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.h) FILTER (WHERE d.w = 0))::numeric, 2),
           'prev_median_h', CASE WHEN p_campaign IS NULL AND v_days <= 90
                                 THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.h) FILTER (WHERE d.w = 1))::numeric, 2) END,
           'touches', (SELECT round(avg(x.n), 1) FROM (
                         SELECT (SELECT count(DISTINCT r.campaign_id) FROM _jrc r
                                  WHERE r.email = d2.email AND r.sent_at <= d2.bought_at AND r.sent_at > d2.bought_at - interval '30 days') AS n
                           FROM _jpp d2 WHERE d2.b) x))
    INTO v_delays FROM d;

  -- Chemins des acheteurs : premier achat de chacun sur la fenêtre (ou
  -- rattaché à la campagne choisie), avec ce qui l'a précédé.
  WITH buys AS (
    SELECT DISTINCT ON (t.email) t.email, t.bought_at, t.id
      FROM _cpt t LEFT JOIN _cp p ON p.email = t.email
     WHERE (p_campaign IS NOT NULL OR (t.bought_at >= v_from AND t.bought_at < v_to))
       AND (p_campaign IS NULL OR EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id AND a.campaign_id = p_campaign))
       AND (p_event IS NULL OR p_campaign IS NOT NULL OR t.event_id = p_event)
       AND (v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg)
       AND t.email IS NOT NULL
     ORDER BY t.email, t.bought_at
  ), cls AS (
    SELECT b.email,
           (SELECT count(DISTINCT r.campaign_id) FROM _jrc r
             WHERE r.email = b.email AND r.sent_at <= b.bought_at AND r.sent_at > b.bought_at - interval '14 days') AS msgs,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.email = b.email AND k.at <= b.bought_at AND k.at > b.bought_at - interval '7 days') AS clicked,
           (SELECT public._crm_ticket_source(et.utm) FROM public.external_tickets et WHERE et.id = b.id) AS src
      FROM buys b
  ), keyed AS (
    SELECT CASE
             WHEN cls.msgs >= 2 AND cls.clicked THEN 'mm_click'
             WHEN cls.msgs >= 1 AND cls.clicked THEN 'm_click'
             WHEN cls.msgs >= 1 THEN 'm_noclick'
             ELSE 'src_' || COALESCE(cls.src, 'di') END AS key,
           cls.msgs > 0 AS has_msg
      FROM cls
  )
  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE v_ch = 'all' OR keyed.has_msg),
           'with_msg', count(*) FILTER (WHERE keyed.has_msg),
           'without_msg', count(*) FILTER (WHERE NOT keyed.has_msg),
           'list', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', q.key, 'n', q.n) ORDER BY q.n DESC, q.key)
                               FROM (SELECT k2.key, count(*) AS n FROM keyed k2 WHERE v_ch IN ('all', 'email') AND (v_ch = 'all' OR k2.has_msg) GROUP BY k2.key) q), '[]'::jsonb))
    INTO v_paths FROM keyed
   -- SMS et Instagram n'envoient pas encore : rien à montrer pour ces canaux.
   WHERE v_ch IN ('all', 'email');

  -- Couverture : acheteurs de la fenêtre, et ceux dont l'achat suit un clic.
  IF p_campaign IS NULL AND v_ch IN ('all', 'email') THEN
    SELECT jsonb_build_object(
             'buyers', count(DISTINCT t.email),
             'attributed', count(DISTINCT t.email) FILTER (WHERE EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id)))
      INTO v_cover
      FROM _cpt t LEFT JOIN _cp p ON p.email = t.email
     WHERE t.bought_at >= v_from AND t.bought_at < v_to AND t.email IS NOT NULL
       AND (p_event IS NULL OR t.event_id = p_event)
       AND (v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg);
  END IF;

  -- Classement des campagnes de la fenêtre.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'event_id', c.event_id,
           'event_title', (SELECT e.title FROM public.events e WHERE e.id = c.event_id),
           'received', s.received, 'opened', s.opened, 'clicked', s.clicked, 'buyers', s.buyers, 'back', s.back,
           'ticket_clicks', (SELECT count(DISTINCT k.email) FROM _cmk k JOIN _jr j ON j.campaign_id = k.campaign_id AND j.email = k.email
                              WHERE k.campaign_id = c.id AND k.ticketing),
           'revenue', s.revenue,
           'buyers_seg', s.buyers_seg,
           'within2d', (SELECT count(*) FROM _jr j WHERE j.campaign_id = c.id AND j.bought_at < c.sent_at + interval '2 days')
         ) ORDER BY c.sent_at DESC), '[]'::jsonb)
    INTO v_camps
    FROM _jc c
    CROSS JOIN LATERAL (
      SELECT count(*) AS received, count(*) FILTER (WHERE j.opened) AS opened, count(*) FILTER (WHERE j.clicked) AS clicked,
             count(*) FILTER (WHERE j.bought_at IS NOT NULL) AS buyers, count(*) FILTER (WHERE j.back) AS back,
             round(COALESCE(sum(j.amount), 0), 2) AS revenue,
             jsonb_build_object('hab', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'hab'),
                                'occ', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'occ'),
                                'nou', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'nou'),
                                'end', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle = 'end'),
                                'none', count(*) FILTER (WHERE j.bought_at IS NOT NULL AND j.lifecycle NOT IN ('hab', 'occ', 'nou', 'end'))) AS buyers_seg
        FROM _jr j WHERE j.campaign_id = c.id
    ) s
   WHERE c.w = 0 AND s.received > 0;

  -- Exemples réels : acheteur après un message, clic sans achat, ouverture
  -- sans clic, achat sans message (sur la fenêtre).
  WITH ex AS (
    (SELECT 'bought'::text AS kind, p.email, 0 AS ord FROM _jpp p WHERE p.b ORDER BY p.bought_at DESC LIMIT 1)
    UNION ALL
    (SELECT 'clicked', p.email, 1 FROM _jpp p WHERE p.c AND NOT p.b
      ORDER BY (SELECT max(k.at) FROM _cmk k WHERE k.email = p.email) DESC NULLS LAST LIMIT 1)
    UNION ALL
    (SELECT 'opened', p.email, 2 FROM _jpp p WHERE p.o AND NOT p.c
      ORDER BY (SELECT max(j.sent_at) FROM _jr j WHERE j.email = p.email AND j.opened) DESC NULLS LAST LIMIT 1)
    UNION ALL
    (SELECT 'direct', t.email, 3 FROM _cpt t LEFT JOIN _cp p ON p.email = t.email
      WHERE p_campaign IS NULL AND v_ch = 'all' AND t.bought_at >= v_from AND t.bought_at < v_to AND t.email IS NOT NULL
        AND (p_event IS NULL OR t.event_id = p_event)
        AND (v_seg = 'all' OR COALESCE(p.lifecycle, 'none') = v_seg)
        AND NOT EXISTS (SELECT 1 FROM _cma a WHERE a.id = t.id)
        AND NOT EXISTS (SELECT 1 FROM _jrc r
                         WHERE r.email = t.email AND r.sent_at <= t.bought_at AND r.sent_at > t.bought_at - interval '14 days')
      ORDER BY t.bought_at DESC LIMIT 1)
  )
  SELECT COALESCE(jsonb_agg(public._crm_journey_person(e.kind, e.email, v_from) ORDER BY e.ord), '[]'::jsonb)
    INTO v_examples
    FROM (SELECT DISTINCT ON (ex.email) ex.kind, ex.email, ex.ord FROM ex ORDER BY ex.email, ex.ord) e;

  -- Choix des filtres (indépendants des filtres) : campagnes des 12 derniers mois.
  SELECT jsonb_build_object('campaigns', COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'event_id', c.event_id) ORDER BY c.sent_at DESC), '[]'::jsonb))
    INTO v_options
    FROM public.email_campaigns c
   WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL AND c.sent_at > now() - interval '12 months'
     AND public.crm_campaign_is_crm(c.id)
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_to, 'days', v_days, 'seg', v_seg, 'channel', v_ch,
    'campaign', CASE WHEN v_camp_id IS NOT NULL THEN jsonb_build_object('id', v_camp_id, 'sent_at', v_camp_at) END,
    'funnel', v_funnel, 'prev', v_prev, 'spark', v_spark, 'bars', v_bars, 'steps', v_steps, 'delays', v_delays,
    'paths', v_paths, 'cover', v_cover, 'campaigns', v_camps, 'examples', v_examples, 'options', v_options,
    'thanks_auto', EXISTS (SELECT 1 FROM public.email_automations a WHERE a.kind = 'post_event_thanks' AND a.enabled AND a.product = 'crm'
                            AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id),
    'has_campaigns', EXISTS (SELECT 1 FROM _cmc c JOIN public.email_campaigns ec ON ec.id = c.id
                              WHERE ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL),
    'has_connection', EXISTS (SELECT 1 FROM public.ticketing_connections tc
                               WHERE (p_venue_id IS NOT NULL AND tc.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND tc.organizer_user_id = p_organizer_user_id))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_state jsonb;
  v_holders integer := 0;
  v_reach integer := 0;
  v_optin integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_state := public._crm_practical_night_state(p_venue_id, p_organizer_user_id, p_event_id, NULL);
  IF v_state->>'reason' = 'not_mirror' THEN RETURN v_state; END IF;

  WITH h AS (
    SELECT DISTINCT lower(btrim(xt.buyer_email)) AS addr
      FROM public.external_tickets xt
     WHERE xt.event_id = p_event_id AND xt.status = 'valid'
       AND public.marketing_scope_match(xt.venue_id, xt.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND xt.buyer_email IS NOT NULL
       AND btrim(xt.buyer_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
  SELECT count(*),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = h.addr)),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
              AND lower(ns.email) = h.addr AND ns.opted_in AND ns.product = 'crm'))
    INTO v_holders, v_reach, v_optin
    FROM h;

  RETURN v_state || jsonb_build_object(
    'holders', v_holders, 'reachable', v_reach, 'marketing_optin', v_optin,
    'yunits_per_email', (public.crm_practical_email_rules()->>'yunits_per_email')::integer
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario_counts(p_venue_id text, p_organizer_user_id uuid, p_tree jsonb, p_event uuid DEFAULT NULL::uuid, p_ctx text DEFAULT 'entry'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_total integer;
  v_out   jsonb := '{}'::jsonb;
  v_path  record;
  v_sql   text;
  v_n     integer;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_event IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event AND e.external_source IS NOT NULL
          AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
    RAISE EXCEPTION 'unknown_event' USING ERRCODE = '22023';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT count(*) INTO v_total FROM _cp p WHERE p.email_ok OR p.phone_ok;

  -- Chaque groupe (racine comprise), désigné par son chemin.
  FOR v_path IN
    WITH RECURSIVE g(node, path) AS (
      SELECT p_tree, ''::text WHERE jsonb_typeof(p_tree) = 'object' AND p_tree ? 'op'
      UNION ALL
      SELECT it.value, CASE WHEN g.path = '' THEN (it.o - 1)::text ELSE g.path || '.' || (it.o - 1) END
        FROM g CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(g.node->'items') = 'array' THEN g.node->'items' ELSE '[]'::jsonb END) WITH ORDINALITY AS it(value, o)
       WHERE jsonb_typeof(it.value) = 'object' AND it.value ? 'op'
    )
    SELECT g.node, g.path FROM g LIMIT 40
  LOOP
    -- Une feuille d'inscription : pas d'effectif avant le lancement.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(public._crm_cond_errors(v_path.node, 'entry')) e WHERE e->>'code' = 'not_in_entry') THEN
      v_out := v_out || jsonb_build_object(v_path.path, NULL);
      CONTINUE;
    END IF;
    v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_path.node, p_event), 'p', 'r');
    EXECUTE format('SELECT count(*) FROM _cp p CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %L::text AS scope_key, %L::uuid AS event_id,
                      p.email, now() AS entered_at, NULL::uuid AS version_id) r WHERE (p.email_ok OR p.phone_ok) AND (%s)',
                   v_key, p_event, v_sql) INTO v_n;
    v_out := v_out || jsonb_build_object(v_path.path, v_n);
  END LOOP;
  RETURN jsonb_build_object('total', v_total, 'groups', v_out,
                            'errors', public._crm_cond_errors(p_tree, CASE WHEN p_ctx = 'entry' THEN 'entry' ELSE 'step' END));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario_preview(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key    text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s        public.crm_scenarios%ROWTYPE;
  v        public.crm_scenario_versions%ROWTYPE;
  g        jsonb;
  t        jsonb;
  tt       text;
  v_check  jsonb;
  v_content jsonb;
  v_now    jsonb;
  v_rates  jsonb := public.crm_sms_rates();
  v_email  integer := GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));
  v_seg    integer := 1;
  v_week   numeric;
  v_basis  text;
  v_ev     record;
  v_sql    text;
  v_k      integer;
  v_sum    numeric := 0;
  v_filter jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  g := s.draft;
  t := g->'trigger';
  tt := t->>'type';
  v_filter := g->'entry'->'filter';
  v_check := public._crm_scenario_graph_errors(g);
  v_content := public._crm_scenario_content(p_venue_id, p_organizer_user_id, g);

  -- Le coût au plus, par entrant : le chemin le plus cher (SMS au tarif d'un
  -- numéro étranger au pire ; un SMS compte ses segments).
  SELECT COALESCE(max(public._crm_sms_segments_estimate(n.v->>'body')), 1) INTO v_seg
    FROM jsonb_each(CASE WHEN jsonb_typeof(g->'nodes') = 'object' THEN g->'nodes' ELSE '{}'::jsonb END) n(id, v)
   WHERE n.v->>'type' = 'sms';

  -- Qui entrerait aujourd'hui : le moteur À BLANC (rien n'est écrit), seulement
  -- pour un graphe lisible.
  IF jsonb_array_length(v_check->'errors') = 0 THEN
    PERFORM public._crm_scenario_temp();
    v.id := gen_random_uuid();
    v.scenario_id := s.id;
    v.scope_key := v_key;
    v.graph := g;
    v.published_at := now();
    v_now := public._crm_scenario_enter(s, v, NULL, NULL, true);
  END IF;

  -- Estimation par semaine sur les 8 dernières (base d'aujourd'hui, filtre
  -- d'entrée appliqué ; jamais un chiffre présenté comme une mesure).
  IF jsonb_array_length(v_check->'errors') = 0 AND tt IN ('before_event', 'event_published', 'after_event', 'ticket_bought',
                                                          'signup_confirmed', 'absence', 'click_no_buy') THEN
    PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
    IF tt IN ('before_event', 'event_published', 'after_event', 'ticket_bought') THEN
      v_basis := 'events';
      FOR v_ev IN
        SELECT e.id FROM public.events e
         WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
           AND e.start_at BETWEEN now() - interval '56 days' AND now()
           AND (tt NOT IN ('before_event', 'ticket_bought') OR t->>'series' IS NULL
                OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
         LIMIT 40
      LOOP
        v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_filter, v_ev.id), 'p', 'r');
        EXECUTE format($q$
          SELECT count(*) FROM _cp p
           CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %1$L::text AS scope_key, %2$L::uuid AS event_id, p.email,
                                      now() AS entered_at, NULL::uuid AS version_id) r
           WHERE (p.email_ok OR p.phone_ok) AND (%3$s)
             AND CASE %4$L
                   -- Après la soirée : ceux qui y étaient (scan) ou avaient une place.
                   WHEN 'after_event' THEN EXISTS (SELECT 1 FROM public.external_tickets tk WHERE tk.event_id = %2$L::uuid
                                                     AND lower(tk.buyer_email) = p.email
                                                     AND CASE %5$L WHEN 'entered' THEN tk.scanned_at IS NOT NULL
                                                                   -- Même règle que le moteur (_crm_scenario_candidates).
                                                                   WHEN 'absent_buyers' THEN tk.scanned_at IS NULL
                                                                        AND public._crm_ticket_is_sale(tk.status, tk.deal_channel)
                                                                        AND public._crm_event_scan_known(tk.event_id)
                                                                   ELSE true END)
                   -- Billet acheté : les acheteurs de cette soirée.
                   WHEN 'ticket_bought' THEN EXISTS (SELECT 1 FROM public.external_tickets tk WHERE tk.event_id = %2$L::uuid
                                                       AND lower(tk.buyer_email) = p.email AND public._crm_ticket_is_sale(tk.status, tk.deal_channel))
                   ELSE true END
        $q$, v_key, v_ev.id, v_sql, tt, COALESCE(t->>'who', 'all')) INTO v_k;
        v_sum := v_sum + v_k;
      END LOOP;
      v_week := round(v_sum / 8.0, 1);
    ELSIF tt = 'signup_confirmed' THEN
      v_basis := 'signups';
      SELECT count(DISTINCT lower(en.email)) / 8.0 INTO v_week
        FROM public.crm_signup_entries en
       WHERE en.page_id = (t->>'page_id')::uuid AND en.confirmed_at > now() - interval '56 days';
    ELSIF tt = 'absence' THEN
      v_basis := 'absence';
      v_sql := public._crm_cond_sql(public._crm_cond_resolve(v_key, v_filter, NULL), 'p', 'r');
      EXECUTE format($q$
        SELECT count(*) / 8.0 FROM _cp p
         CROSS JOIN LATERAL (SELECT NULL::uuid AS id, %1$L::text AS scope_key, NULL::uuid AS event_id, p.email,
                                    now() AS entered_at, NULL::uuid AS version_id) r
         WHERE (p.email_ok OR p.phone_ok) AND (%2$s)
           AND p.last_night < now() - make_interval(days => %3$L::integer)
           AND p.last_night >= now() - make_interval(days => %3$L::integer) - interval '56 days'
      $q$, v_key, v_sql, (t->>'days')::integer) INTO v_week;
    ELSIF tt = 'click_no_buy' THEN
      v_basis := 'clicks';
      SELECT count(*) / 8.0 INTO v_week FROM (
        SELECT DISTINCT lower(ev.recipient_email), c.event_id
          FROM public.email_campaign_events ev
          JOIN public.email_campaigns c ON c.id = ev.campaign_id
          JOIN public.events e2 ON e2.id = c.event_id
         WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
           AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
           AND e2.external_ticket_url IS NOT NULL AND e2.external_source IS NOT NULL
           AND public.crm_campaign_is_crm(c.id)
           AND public._link_base(ev.metadata->'click'->>'link') = public._link_base(e2.external_ticket_url)
           AND ev.created_at > now() - interval '56 days'
           AND NOT EXISTS (SELECT 1 FROM public.external_tickets tk WHERE tk.event_id = c.event_id
                            AND lower(tk.buyer_email) = lower(ev.recipient_email) AND tk.status IN ('valid', 'transferred'))) z;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'errors', public._crm_scn_sorted((v_check->'errors') || (v_content->'errors')),
    'warnings', v_content->'warnings',
    'stats', v_check->'stats',
    'now', v_now,
    'week', jsonb_build_object('estimate', v_week, 'basis', v_basis),
    'cost', jsonb_build_object(
      'email', v_email, 'sms_fr', (v_rates->>'fr')::integer, 'sms_intl', (v_rates->>'intl')::integer, 'sms_segments', v_seg,
      'max_emails', (v_check->'stats'->>'maxEmails')::integer, 'max_sms', (v_check->'stats'->>'maxSms')::integer,
      'max_fr', COALESCE((v_check->'stats'->>'maxEmails')::integer, 0) * v_email
                + COALESCE((v_check->'stats'->>'maxSms')::integer, 0) * v_seg * (v_rates->>'fr')::integer,
      'max_intl', COALESCE((v_check->'stats'->>'maxEmails')::integer, 0) * v_email
                + COALESCE((v_check->'stats'->>'maxSms')::integer, 0) * v_seg * (v_rates->>'intl')::integer),
    'holdout_pct', public.crm_holdout_pct(v_key),
    'can_publish', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) AND NOT public.is_support_session());
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario_publish(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_expected timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
  v_check jsonb;
  v_content jsonb;
  v_errs jsonb;
  v_ver uuid;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'archived' THEN RAISE EXCEPTION 'archived' USING ERRCODE = 'P0001'; END IF;
  IF p_expected IS NOT NULL AND s.draft_updated_at IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'draft_changed' USING ERRCODE = 'P0001';
  END IF;

  v_check := public._crm_scenario_graph_errors(s.draft);
  v_content := public._crm_scenario_content(p_venue_id, p_organizer_user_id, s.draft);
  v_errs := public._crm_scn_sorted((v_check->'errors') || (v_content->'errors'));
  IF jsonb_array_length(v_errs) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errs, 'warnings', v_content->'warnings');
  END IF;

  INSERT INTO public.crm_scenario_versions (scenario_id, scope_key, version, graph, stats, published_by)
  VALUES (s.id, v_key, s.version_no + 1, s.draft, v_check->'stats', auth.uid())
  RETURNING id INTO v_ver;
  UPDATE public.crm_scenarios x
     SET live_version_id = v_ver, version_no = s.version_no + 1, status = 'active',
         published_at = now(), paused_at = NULL, updated_at = now()
   WHERE x.id = s.id;
  -- La recette copiée s'éteint (« jamais les deux sur un même sujet »).
  IF s.source_kind IS NOT NULL THEN
    UPDATE public.email_automations a SET enabled = false
     WHERE a.kind = s.source_kind AND a.enabled AND a.product = 'crm'
       AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'version_id', v_ver, 'version', s.version_no + 1, 'warnings', v_content->'warnings');
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'paused', 'archived') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'archived' THEN RAISE EXCEPTION 'archived' USING ERRCODE = 'P0001'; END IF;
  IF p_status = 'active' THEN
    IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
    IF s.live_version_id IS NULL THEN RAISE EXCEPTION 'never_published' USING ERRCODE = 'P0001'; END IF;
    IF s.source_kind IS NOT NULL THEN
      UPDATE public.email_automations a SET enabled = false
       WHERE a.kind = s.source_kind AND a.enabled AND a.product = 'crm'
         AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
    END IF;
  ELSIF p_status = 'paused' AND s.status = 'draft' THEN
    RAISE EXCEPTION 'never_published' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.crm_scenarios x
     SET status = p_status, updated_at = now(),
         paused_at = CASE WHEN p_status = 'paused' THEN now() ELSE NULL END,
         archived_at = CASE WHEN p_status = 'archived' THEN now() END
   WHERE x.id = s.id;
  IF p_status = 'archived' THEN
    UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = 'archived', updated_at = now()
     WHERE r.scenario_id = s.id AND r.status = 'active';
  END IF;
  RETURN jsonb_build_object('id', s.id, 'status', p_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_search(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_q text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q text := btrim(COALESCE(p_q, ''));
  v_like text;
  v_clients jsonb;
  v_campaigns jsonb;
  v_nights jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_like := '%' || replace(replace(lower(public.unaccent_safe(v_q)), '%', ''), '_', '') || '%';

  IF v_q <> '' THEN
    WITH people AS (
      SELECT lower(t.buyer_email) AS em,
             max(t.buyer_first_name) AS fn, max(t.buyer_last_name) AS ln,
             count(DISTINCT t.event_id) FILTER (WHERE t.status IN ('valid', 'transferred')) AS nights,
             max(COALESCE(t.purchased_at, t.first_seen_at)) AS last_at
        FROM public.external_tickets t
       WHERE t.buyer_email IS NOT NULL
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       GROUP BY 1
      UNION ALL
      SELECT lower(s.email), max(s.first_name), max(s.last_name), 0, max(s.created_at)
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.product = 'crm'
       GROUP BY 1
    ), merged AS (
      SELECT em, max(fn) AS fn, max(ln) AS ln, max(nights) AS nights, max(last_at) AS last_at
        FROM people GROUP BY em
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('email', em, 'first_name', fn, 'last_name', ln, 'nights', nights, 'last_at', last_at)), '[]'::jsonb)
      INTO v_clients
      FROM (
        SELECT * FROM merged
         WHERE lower(public.unaccent_safe(COALESCE(fn, '') || ' ' || COALESCE(ln, '') || ' ' || em)) LIKE v_like
         ORDER BY nights DESC, last_at DESC NULLS LAST
         LIMIT 4
      ) q;
  ELSE
    v_clients := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'at') DESC NULLS LAST), '[]'::jsonb) INTO v_campaigns FROM (
    SELECT jsonb_build_object('id', c.id, 'name', c.name, 'channel', 'email', 'status', c.status,
                              'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                              'recipients', COALESCE(c.total_recipients, c.recipients_count)) AS x
      FROM public.email_campaigns c
     WHERE c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND COALESCE(public.crm_campaign_is_crm(c.id), false)
       AND (v_q = '' OR lower(public.unaccent_safe(COALESCE(c.name, '') || ' ' || COALESCE(c.subject, ''))) LIKE v_like)
     ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at) DESC NULLS LAST
     LIMIT CASE WHEN v_q = '' THEN 1 ELSE 4 END
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'rank')::int, (x->>'start_at')), '[]'::jsonb) INTO v_nights FROM (
    SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                              'rank', CASE WHEN e.end_at > now() THEN 0 ELSE 1 END,
                              'sold', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                                        WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred'))) AS x
      FROM public.events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.external_source IS NOT NULL
       AND (v_q = '' OR lower(public.unaccent_safe(COALESCE(e.title, ''))) LIKE v_like)
       AND (v_q <> '' OR e.end_at > now())
     ORDER BY CASE WHEN e.end_at > now() THEN 0 ELSE 1 END, abs(extract(epoch FROM e.start_at - now()))
     LIMIT CASE WHEN v_q = '' THEN 1 ELSE 4 END
  ) q;

  RETURN jsonb_build_object('clients', v_clients, 'campaigns', v_campaigns, 'nights', v_nights);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_signup_confirm(p_slug text, p_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e public.crm_signup_entries;
  p public.crm_signup_pages;
  v_blocked boolean;
  v_sub boolean := false;
BEGIN
  IF length(COALESCE(p_token, '')) < 20 THEN RETURN 'invalid'; END IF;
  SELECT x.* INTO e FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
   WHERE pp.slug = lower(p_slug) AND x.confirm_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE OF x;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF e.confirmed_at IS NOT NULL THEN RETURN 'already'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = e.page_id;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;

  INSERT INTO public.marketing_consent_events (email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
  VALUES (e.email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', e.consent_text, e.lang, 'signup_page:' || p.id);
  IF e.phone IS NOT NULL THEN
    INSERT INTO public.marketing_consent_events (email, phone_e164, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
    VALUES (e.email, e.phone, 'sms', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', e.consent_text, e.lang, 'signup_page:' || p.id);
  END IF;

  IF p.contact_import_id IS NOT NULL THEN
    INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, product, email, phone_e164, first_name, last_name, city, newsletter_opt_in, added_at, extra)
    VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, 'crm', e.email,
            CASE WHEN e.phone ~ '^\+[0-9]{8,15}$' THEN e.phone END, e.first_name, e.last_name, e.city, true, now(),
            jsonb_build_object('signup_page', p.id, 'src', e.src, 'answers', e.answers, 'instagram', e.instagram, 'birthdate', e.birthdate))
    ON CONFLICT DO NOTHING;
  END IF;

  v_blocked := public.is_email_suppressed(e.email)
    OR EXISTS (SELECT 1 FROM public.email_opt_outs o WHERE lower(o.email) = lower(e.email)
                AND o.venue_id IS NOT DISTINCT FROM p.venue_id AND o.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
                AND o.product = 'crm')
    -- Désabonné : sa ligne CRM, OU un stop explicite (opted_out_at) donné dans la Billetterie du même pro (un stop vaut pour les deux outils).
    OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions n WHERE lower(n.email) = lower(e.email)
                AND ((n.product = 'crm' AND NOT n.opted_in) OR (n.product IS NULL AND n.opted_out_at IS NOT NULL))
                AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id);
  IF NOT v_blocked THEN
    IF p.venue_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name, product)
      VALUES (p.venue_id, e.email, true, 'signup_page', p.email_import_id, 'website_form', now(), e.first_name, 'crm')
      ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO NOTHING;
    ELSE
      INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name, product)
      VALUES (p.organizer_user_id, e.email, true, 'signup_page', p.email_import_id, 'website_form', now(), e.first_name, 'crm')
      ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    END IF;
    v_sub := true;
  END IF;
  UPDATE public.crm_signup_entries SET confirmed_at = now(), subscribed = v_sub WHERE id = e.id;
  RETURN 'ok';
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_signup_page_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := p_id;
  v_base text;
  v_slug text;
  k text;
  v_q jsonb;
  v_o text;
  v_f jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_rel jsonb := '{}'::jsonb;
  v_step jsonb;
  v_kind text;
  v_ai timestamptz;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('kind', 'event_id', 'title', 'tagline', 'button_label', 'thanks_message', 'poster_url', 'design', 'fields', 'show_count',
                 'reward', 'opens_at', 'sale_opens_at', 'closes_mode', 'closes_at', 'countdown', 'relance', 'lang',
                 'occasion', 'theme', 'custom_design', '_seen_ai_at') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Le design sur mesure ne s'écrit que par le MCP (nettoyé par le Worker) ;
  -- la Console ne peut que l'enlever (retour à un gabarit).
  IF p_patch ? 'custom_design' AND jsonb_typeof(p_patch->'custom_design') <> 'null' THEN RAISE EXCEPTION 'bad_custom' USING ERRCODE = '22023'; END IF;
  -- L'écran qui enregistre a-t-il vu la dernière version de l'IA ? Sinon il
  -- l'écraserait avec un état d'avant : refusé, l'écran adopte et réessaie.
  IF p_patch ? '_seen_ai_at' AND v_id IS NOT NULL THEN
    SELECT ai_updated_at INTO v_ai FROM public.crm_signup_pages WHERE id = v_id;
    IF v_ai IS NOT NULL AND (nullif(p_patch->>'_seen_ai_at', '') IS NULL OR v_ai > (p_patch->>'_seen_ai_at')::timestamptz) THEN
      RAISE EXCEPTION 'ai_changed' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_patch ? 'kind' AND p_patch->>'kind' NOT IN ('prevente', 'venue', 'attente', 'communaute') THEN RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'closes_mode' AND p_patch->>'closes_mode' NOT IN ('sale', 'eve', 'manual', 'never', 'date') THEN RAISE EXCEPTION 'bad_dates' USING ERRCODE = '22023'; END IF;

  -- Champs : contact, champs en plus (obligatoires ou non), deux questions au plus (2 à 6 réponses).
  IF p_patch ? 'fields' THEN
    v_f := p_patch->'fields';
    IF jsonb_typeof(v_f) <> 'object' OR COALESCE(v_f->>'contact', 'both') NOT IN ('both', 'email', 'phone', 'all') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(COALESCE(v_f->'extra', '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(COALESCE(v_f->'extra', '{}'::jsonb)) LOOP
      IF k NOT IN ('nom', 'naissance', 'insta', 'ville') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
      IF COALESCE((v_f->'extra'->k->>'on')::boolean, false) THEN
        v_extra := v_extra || jsonb_build_object(k, jsonb_build_object('on', true, 'req', COALESCE((v_f->'extra'->k->>'req')::boolean, false)));
      END IF;
    END LOOP;
    IF jsonb_typeof(COALESCE(v_f->'questions', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_f->'questions', '[]'::jsonb)) > 2 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(v_f->'questions', '[]'::jsonb)) LOOP
      IF length(trim(COALESCE(v_q->>'label', ''))) = 0 OR length(v_q->>'label') > 60 OR jsonb_typeof(v_q->'options') <> 'array'
         OR jsonb_array_length(v_q->'options') < 2 OR jsonb_array_length(v_q->'options') > 6 THEN
        RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023';
      END IF;
      FOR v_o IN SELECT jsonb_array_elements_text(v_q->'options') LOOP
        IF length(trim(v_o)) = 0 OR length(v_o) > 40 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = (p_patch->>'event_id')::uuid AND e.external_source IS NOT NULL
          AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
    RAISE EXCEPTION 'bad_event' USING ERRCODE = '22023';
  END IF;

  -- Relance : trois étapes au plus, le contenu de l'e-mail composé par la Console.
  IF p_patch ? 'relance' THEN
    IF jsonb_typeof(p_patch->'relance') <> 'object' THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(p_patch->'relance') LOOP
      IF k NOT IN ('open', 'nudge', 'last') THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
      v_step := p_patch->'relance'->k;
      IF jsonb_typeof(v_step) <> 'object' THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
      IF length(COALESCE(v_step->>'msg', '')) > 480 OR length(COALESCE(v_step->>'subject', '')) > 150
         OR (v_step ? 'email_blocks' AND (jsonb_typeof(v_step->'email_blocks') <> 'array' OR length((v_step->'email_blocks')::text) > 40000))
         OR (v_step ? 'delay' AND COALESCE(v_step->>'delay', '') NOT IN ('', '24h', '48h', '3d', '2d', '1d', '0d'))
         OR (NULLIF(v_step->>'cta_url', '') IS NOT NULL AND v_step->>'cta_url' !~ '^https?://' ) THEN
        RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023';
      END IF;
      v_rel := v_rel || jsonb_build_object(k, jsonb_build_object(
        'on', COALESCE((v_step->>'on')::boolean, false), 'email', COALESCE((v_step->>'email')::boolean, false),
        'sms', COALESCE((v_step->>'sms')::boolean, false), 'delay', COALESCE(v_step->>'delay', ''),
        'msg', COALESCE(v_step->>'msg', ''), 'subject', left(COALESCE(v_step->>'subject', ''), 150),
        'preheader', left(COALESCE(v_step->>'preheader', ''), 200),
        'email_blocks', COALESCE(v_step->'email_blocks', '[]'::jsonb), 'email_theme', COALESCE(v_step->'email_theme', '{}'::jsonb),
        'email_logo', NULLIF(left(COALESCE(v_step->>'email_logo', ''), 600), ''), 'cta_url', NULLIF(left(COALESCE(v_step->>'cta_url', ''), 600), '')));
    END LOOP;
  END IF;

  IF v_id IS NULL THEN
    v_base := COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(translate(COALESCE(p_patch->>'title', ''),
                'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', '-', 'g')), ''), 'page');
    v_base := left(v_base, 40);
    IF length(v_base) < 3 THEN v_base := v_base || '-page'; END IF;
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE slug = v_slug) LOOP
      v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
    END LOOP;
    INSERT INTO public.crm_signup_pages (venue_id, organizer_user_id, slug, created_by, design)
    VALUES (p_venue_id, p_organizer_user_id, v_slug, auth.uid(), '{"tpl":"soiree","pal":"red","bg":"","acc":"","font":"","migrated":true}'::jsonb)
    RETURNING id INTO v_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE id = v_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_signup_pages SET
    kind = CASE WHEN p_patch ? 'kind' THEN p_patch->>'kind'
                WHEN p_patch ? 'occasion' AND p_patch->>'occasion' = 'community' THEN 'communaute' ELSE kind END,
    event_id = CASE WHEN p_patch ? 'event_id' THEN NULLIF(p_patch->>'event_id', '')::uuid ELSE event_id END,
    title = CASE WHEN p_patch ? 'title' THEN left(trim(p_patch->>'title'), 40) ELSE title END,
    tagline = CASE WHEN p_patch ? 'tagline' THEN left(trim(p_patch->>'tagline'), 140) ELSE tagline END,
    button_label = CASE WHEN p_patch ? 'button_label' THEN left(trim(p_patch->>'button_label'), 30) ELSE button_label END,
    thanks_message = CASE WHEN p_patch ? 'thanks_message' THEN left(trim(p_patch->>'thanks_message'), 200) ELSE thanks_message END,
    poster_url = CASE WHEN p_patch ? 'poster_url' THEN CASE WHEN COALESCE(p_patch->>'poster_url', '') ~ '^https://' THEN left(p_patch->>'poster_url', 600) END ELSE poster_url END,
    design = CASE WHEN p_patch ? 'design' AND jsonb_typeof(p_patch->'design') = 'object' THEN jsonb_build_object(
              'tpl', CASE WHEN p_patch->'design'->>'tpl' IN ('soiree', 'affiche', 'brutal', 'edito', 'ticket', 'affichage', 'verre', 'epure', 'flyer', 'terminal') THEN p_patch->'design'->>'tpl' ELSE 'soiree' END,
              'pal', CASE WHEN COALESCE(p_patch->'design'->>'pal', '') ~ '^(custom|red|lime|ice|rose|bone|p[0-4])$' THEN p_patch->'design'->>'pal' ELSE 'red' END,
              'bg', CASE WHEN COALESCE(p_patch->'design'->>'bg', '') ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'design'->>'bg' ELSE '' END,
              'acc', CASE WHEN COALESCE(p_patch->'design'->>'acc', '') ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'design'->>'acc' ELSE '' END,
              'font', CASE WHEN p_patch->'design'->>'font' IN ('brico', 'anton', 'serif', 'space', 'black', 'mono') THEN p_patch->'design'->>'font' ELSE '' END,
              'migrated', true) ELSE design END,
    fields = CASE WHEN p_patch ? 'fields' THEN jsonb_build_object(
              'contact', COALESCE(p_patch->'fields'->>'contact', 'both'),
              'extra', v_extra,
              'questions', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'label', left(trim(q->>'label'), 60),
                   'multi', COALESCE((q->>'multi')::boolean, false),
                   'party', CASE WHEN COALESCE((q->>'party')::boolean, false) THEN true END,
                   'options', (SELECT jsonb_agg(left(trim(o), 40)) FROM jsonb_array_elements_text(q->'options') o))))
                 FROM jsonb_array_elements(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) q), '[]'::jsonb)) ELSE fields END,
    show_count = CASE WHEN p_patch ? 'show_count' THEN COALESCE((p_patch->>'show_count')::boolean, false) ELSE show_count END,
    reward = CASE WHEN p_patch ? 'reward' THEN CASE WHEN jsonb_typeof(p_patch->'reward') = 'object' THEN jsonb_build_object(
                'on', COALESCE((p_patch->'reward'->>'on')::boolean, false),
                'preset', CASE WHEN p_patch->'reward'->>'preset' IN ('prio', 'drink', 'pre', 'custom') THEN p_patch->'reward'->>'preset' ELSE 'drink' END,
                'label', left(trim(COALESCE(p_patch->'reward'->>'label', '')), 40),
                'how', left(trim(COALESCE(p_patch->'reward'->>'how', '')), 70),
                'icon', CASE WHEN p_patch->'reward'->>'icon' IN ('gift', 'ticket', 'bolt', 'users', 'clock') THEN p_patch->'reward'->>'icon' ELSE 'gift' END) END ELSE reward END,
    opens_at = CASE WHEN p_patch ? 'opens_at' THEN NULLIF(p_patch->>'opens_at', '')::timestamptz ELSE opens_at END,
    sale_opens_at = CASE WHEN p_patch ? 'sale_opens_at' THEN NULLIF(p_patch->>'sale_opens_at', '')::timestamptz ELSE sale_opens_at END,
    closes_mode = CASE WHEN p_patch ? 'closes_mode' THEN p_patch->>'closes_mode' ELSE closes_mode END,
    closes_at = CASE WHEN p_patch ? 'closes_at' THEN NULLIF(p_patch->>'closes_at', '')::timestamptz ELSE closes_at END,
    countdown = CASE WHEN p_patch ? 'countdown' THEN COALESCE((p_patch->>'countdown')::boolean, true) ELSE countdown END,
    relance = CASE WHEN p_patch ? 'relance' THEN v_rel ELSE relance END,
    lang = CASE WHEN p_patch->>'lang' IN ('en', 'fr', 'es') THEN p_patch->>'lang' ELSE lang END,
    custom_design = CASE WHEN p_patch ? 'custom_design' THEN NULL ELSE custom_design END,
    updated_at = now()
   WHERE id = v_id
   RETURNING kind INTO v_kind;
  UPDATE public.crm_signup_pages SET occasion = CASE WHEN v_kind = 'communaute' THEN 'community' ELSE 'night' END WHERE id = v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_signup_relance_collect()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_step text;
  s jsonb;
  v_due timestamptz;
  v_exp timestamptz;
  v_open_due timestamptz;
  v_ev jsonb;
  v_start timestamptz;
  v_camp uuid;
  v_new integer;
  v_total integer := 0;
  v_pages integer := 0;
  v_kind_policy text;
BEGIN
  FOR p IN
    SELECT * FROM public.crm_signup_pages
     WHERE status IN ('live', 'closed') AND relance <> '{}'::jsonb
       AND NOT public.is_demo_marketing_scope(venue_id, organizer_user_id)
  LOOP
    v_ev := public._crm_signup_event(p.event_id);
    v_start := NULLIF(v_ev->>'start_at', '')::timestamptz;
    v_open_due := CASE p.kind
      WHEN 'prevente' THEN p.sale_opens_at
      WHEN 'venue' THEN CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_night_at(p.event_id, 1, time '18:00') END
      WHEN 'attente' THEN p.notified_at
      ELSE NULL END;

    FOREACH v_step IN ARRAY ARRAY['open', 'nudge', 'last'] LOOP
      s := p.relance->v_step;
      CONTINUE WHEN s IS NULL OR NOT COALESCE((s->>'on')::boolean, false) OR NOT COALESCE((s->>'email')::boolean, false);
      CONTINUE WHEN jsonb_typeof(s->'email_blocks') <> 'array' OR jsonb_array_length(s->'email_blocks') = 0;
      CONTINUE WHEN v_step <> 'open' AND p.kind NOT IN ('prevente', 'attente');

      IF v_step = 'open' AND p.kind = 'communaute' THEN
        v_due := now() - interval '2 days'; v_exp := now() + interval '1 minute';   -- par inscription, plus bas
      ELSIF v_step = 'open' THEN
        v_due := v_open_due; v_exp := LEAST(v_open_due + interval '2 days', COALESCE(v_start, 'infinity'::timestamptz));
      ELSIF v_step = 'nudge' THEN
        v_due := v_open_due + CASE s->>'delay' WHEN '24h' THEN interval '24 hours' WHEN '3d' THEN interval '3 days' ELSE interval '48 hours' END;
        v_exp := LEAST(v_due + interval '2 days', COALESCE(v_start, 'infinity'::timestamptz));
      ELSE
        CONTINUE WHEN p.event_id IS NULL;
        v_due := public._crm_signup_night_at(p.event_id, CASE s->>'delay' WHEN '1d' THEN 1 WHEN '0d' THEN 0 ELSE 2 END, time '12:00');
        v_exp := COALESCE(v_start, v_due + interval '1 day');
      END IF;
      CONTINUE WHEN v_due IS NULL OR now() < v_due OR now() > v_exp;
      v_kind_policy := CASE WHEN v_step = 'open' AND p.kind <> 'communaute' THEN 'tier_closing' ELSE 'automation' END;

      -- Les destinataires de ce passage (heures calmes : la campagne les respecte,
      -- sauf « C'est ouvert », attendu à l'heure dite).
      CREATE TEMP TABLE IF NOT EXISTS _sr (entry_id uuid, email text, first_name text, last_name text, token uuid) ON COMMIT DROP;
      TRUNCATE _sr;
      INSERT INTO _sr (entry_id, email, first_name, last_name, token)
      SELECT e.id, lower(e.email), e.first_name, e.last_name, ns.unsubscribe_token
        FROM public.crm_signup_entries e
        JOIN LATERAL (
          SELECT n.unsubscribe_token FROM public.newsletter_subscriptions n
           WHERE lower(n.email) = lower(e.email) AND n.opted_in AND n.opted_out_at IS NULL
             AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
             AND n.product = 'crm'
           LIMIT 1) ns ON true
       WHERE e.page_id = p.id AND e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)
         AND NOT public.is_demo_email(e.email)
         AND NOT EXISTS (SELECT 1 FROM public.crm_signup_sends x WHERE x.entry_id = e.id AND x.step = v_step AND x.channel = 'email')
         AND (v_step <> 'open' OR p.kind <> 'communaute' OR e.confirmed_at > now() - interval '2 days')
         AND (v_step = 'open' OR e.id NOT IN (SELECT entry_id FROM public._crm_signup_buyer_ids(p.id)))
         AND public.email_send_policy(lower(e.email), v_kind_policy) IS NULL;
      SELECT count(*) INTO v_new FROM _sr;
      CONTINUE WHEN v_new = 0;

      -- La campagne enfant de (page, étape), créée au premier envoi, remplie ensuite.
      SELECT campaign_id INTO v_camp FROM public.crm_signup_relance_campaigns WHERE page_id = p.id AND step = v_step;
      IF v_camp IS NULL THEN
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version, theme_json, social_links_json,
           logo_url, event_id, status, audiences_json, exclusions_json, quiet_hours, child_kind, total_recipients, product)
        VALUES
          (p.venue_id, p.organizer_user_id, left('Page d’inscription · ' || p.title || ' · ' || v_step, 200), 'promotional',
           COALESCE(NULLIF(s->>'subject', ''), p.title), COALESCE(s->>'preheader', ''), s->'email_blocks', 2,
           COALESCE(s->'email_theme', '{}'::jsonb), '{}'::jsonb, NULLIF(s->>'email_logo', ''), p.event_id, 'sending',
           '[]'::jsonb, '{}'::jsonb, NOT (v_step = 'open' AND p.kind <> 'communaute'), 'signup', 0, 'crm')
        RETURNING id INTO v_camp;
        -- Elle est sa propre mère : hors des listes, sans accusé « campagne envoyée ».
        UPDATE public.email_campaigns SET parent_campaign_id = v_camp WHERE id = v_camp;
        INSERT INTO public.crm_signup_relance_campaigns (page_id, step, campaign_id) VALUES (p.id, v_step, v_camp);
      ELSE
        -- Le contenu suit la dernière version enregistrée par le pro.
        UPDATE public.email_campaigns SET subject = COALESCE(NULLIF(s->>'subject', ''), subject), preheader = COALESCE(s->>'preheader', preheader),
               blocks_json = s->'email_blocks', theme_json = COALESCE(s->'email_theme', theme_json), logo_url = COALESCE(NULLIF(s->>'email_logo', ''), logo_url)
         WHERE id = v_camp;
      END IF;

      INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_camp, r.email, r.first_name, r.last_name, r.token, 'pending' FROM _sr r
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING;
      INSERT INTO public.crm_signup_sends (page_id, entry_id, step, channel, campaign_id)
      SELECT p.id, r.entry_id, v_step, 'email', v_camp FROM _sr r
      ON CONFLICT (entry_id, step, channel) DO NOTHING;
      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_camp AND status IN ('sent', 'sending', 'draft');
      v_total := v_total + v_new;
      v_pages := v_pages + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('enqueued', v_total, 'steps', v_pages);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_sms_audience_preview(p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb, p_event_id uuid DEFAULT NULL::uuid, p_recent_days integer DEFAULT NULL::integer, p_exclude_buyers boolean DEFAULT false, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_days integer := CASE WHEN p_recent_days BETWEEN 1 AND 90 THEN p_recent_days END;
  v_cap integer;
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_pred := public._crm_audience_pred(p_audiences, p_venue_id, p_organizer_user_id);
  IF v_pred IS NULL THEN
    RETURN jsonb_build_object('reach', 0, 'x_buyers', 0, 'x_recent', 0, 'x_cap', 0, 'net', 0, 'net_intl', 0);
  END IF;
  SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cap := COALESCE(v_cap, 1);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  EXECUTE format($q$
    WITH sel AS (
      SELECT p.email, p.phone, p.events FROM _cp p WHERE p.phone_ok AND public.sms_tariff_zone(p.phone) <> 'blocked' AND (%3$s)
    ), sms7 AS (
      SELECT r.phone_e164 AS phone, count(*) AS n
        FROM public.sms_campaign_recipients r
        JOIN public.sms_campaigns c ON c.id = r.campaign_id
       WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_id IS NOT DISTINCT FROM %2$L::uuid
         AND c.id IS DISTINCT FROM %6$L::uuid
         AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days'
       GROUP BY 1
    ), f AS (
      SELECT s.email, s.phone,
             (%4$L::uuid IS NOT NULL AND %4$L::uuid = ANY (s.events)) AS buyer,
             (%5$L::integer IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.sms_campaign_recipients r
                          JOIN public.sms_campaigns c ON c.id = r.campaign_id
                         WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                           AND c.id IS DISTINCT FROM %6$L::uuid AND r.phone_e164 = s.phone
                           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - make_interval(days => %5$L::integer)
                           AND c.product = 'crm')
                OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                             JOIN public.email_campaigns c ON c.id = r.campaign_id
                            WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                              AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                              AND lower(r.email) = s.email
                              AND public.crm_campaign_is_crm(c.id)))) AS recent,
             COALESCE((SELECT m.n FROM sms7 m WHERE m.phone = s.phone), 0) >= %8$L::integer AS capped
        FROM sel s
    )
    SELECT jsonb_build_object(
      'reach', count(*),
      'x_buyers', count(*) FILTER (WHERE buyer AND %7$L::boolean),
      'x_recent', count(*) FILTER (WHERE recent AND NOT (buyer AND %7$L::boolean)),
      'x_cap', count(*) FILTER (WHERE capped AND NOT recent AND NOT (buyer AND %7$L::boolean)),
      'net', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent AND NOT capped),
      'net_intl', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent AND NOT capped
                                     AND public.sms_tariff_zone(phone) = 'intl'))
      FROM f
  $q$, p_venue_id, p_organizer_user_id, v_pred, p_event_id, v_days, p_campaign_id, COALESCE(p_exclude_buyers, false), v_cap)
  INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_automation_covers_event(p_event_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.email_automations a
      ON a.enabled AND a.template_id IS NOT NULL AND a.kind = p_kind AND a.product IS NULL
     AND ((a.venue_id IS NOT NULL AND a.venue_id = e.venue_id)
       OR (a.organizer_user_id IS NOT NULL AND a.organizer_user_id = e.organizer_user_id)
       OR (a.venue_id IS NULL AND a.organizer_user_id IS NULL))
    WHERE e.id = p_event_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.email_automation_suggestions_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  o RECORD;
  item jsonb;
  v_month text := to_char(now(), 'YYYY-MM');
  v_scopes integer := 0;
  v_emitted integer := 0;
  v_id uuid;
BEGIN
  -- Clubs : un propriétaire, pas démo, pas décommissionné, une base opt-in.
  FOR v IN
    SELECT ve.id
      FROM public.venues ve
     WHERE ve.owner_id IS NOT NULL AND ve.decommissioned_at IS NULL AND NOT COALESCE(ve.is_hidden, false)
       AND NOT (ve.id = ANY (public.demo_venue_ids()))
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.venue_id = ve.id AND s.opted_in AND s.opted_out_at IS NULL AND s.product IS NULL)
  LOOP
    v_scopes := v_scopes + 1;
    FOR item IN SELECT * FROM jsonb_array_elements(public._email_automation_suggestions(v.id, NULL)) LOOP
      v_id := public.emit_staff_notification(
        p_venue_id => v.id, p_target_role => 'owner', p_type => 'automation_suggested',
        p_title => 'Yuno te propose d''allumer : ' || public._email_automation_kind_label(item->>'kind'),
        p_message => public._email_automation_suggestion_text(item),
        p_priority => 'low', p_reference_type => 'email_automation', p_reference_id => NULL,
        p_event_id => NULLIF(item->>'event_id', '')::uuid, p_metadata => item,
        p_dedup_key => 'auto_sug:v:' || v.id || ':' || (item->>'kind') || ':' || v_month);
      IF v_id IS NOT NULL THEN v_emitted := v_emitted + 1; END IF;
    END LOOP;
  END LOOP;

  -- Organisateurs : une soirée sur 60 j, pas démo, une base opt-in.
  FOR o IN
    SELECT DISTINCT e.organizer_user_id AS id
      FROM public.events e
      JOIN public.profiles p ON p.id = e.organizer_user_id
     WHERE e.organizer_user_id IS NOT NULL AND e.start_at > now() - interval '60 days'
       AND NOT public.is_demo_email(p.email)
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.organizer_user_id = e.organizer_user_id AND s.opted_in AND s.opted_out_at IS NULL AND s.product IS NULL)
  LOOP
    v_scopes := v_scopes + 1;
    FOR item IN SELECT * FROM jsonb_array_elements(public._email_automation_suggestions(NULL, o.id)) LOOP
      v_id := public.emit_organizer_notification(
        p_organizer_user_id => o.id, p_type => 'automation_suggested',
        p_title => 'Yuno te propose d''allumer : ' || public._email_automation_kind_label(item->>'kind'),
        p_message => public._email_automation_suggestion_text(item),
        p_priority => 'low', p_reference_type => 'email_automation', p_reference_id => NULL,
        p_event_id => NULLIF(item->>'event_id', '')::uuid, p_metadata => item,
        p_dedup_key => 'auto_sug:o:' || o.id::text || ':' || (item->>'kind') || ':' || v_month);
      IF v_id IS NOT NULL THEN v_emitted := v_emitted + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('scopes', v_scopes, 'emitted', v_emitted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_automation_weekly_digest(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_from timestamptz := now() - interval '7 days';
BEGIN
  IF p_subject_type NOT IN ('venue', 'organizer') OR p_subject_id IS NULL THEN
    RETURN jsonb_build_object('emails', 0, 'sales', 0, 'revenue', 0);
  END IF;

  WITH children AS (
    SELECT c.id FROM public.email_campaigns c
     WHERE c.automation_id IS NOT NULL AND NOT public.crm_campaign_is_crm(c.id)
       AND CASE WHEN p_subject_type = 'venue' THEN c.venue_id = p_subject_id
                ELSE c.organizer_user_id::text = p_subject_id END
  ),
  sent AS (
    SELECT count(*) AS n FROM public.email_campaign_recipients r
     WHERE r.campaign_id IN (SELECT id FROM children) AND r.status = 'sent' AND r.sent_at >= v_from
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  clicks AS (
    SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS click_at
      FROM public.email_campaign_events ev
     WHERE ev.campaign_id IN (SELECT id FROM children)
       AND ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
       AND ev.created_at >= v_from - interval '72 hours'
     GROUP BY lower(ev.recipient_email)
  ),
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, lower(t.user_email) AS em, t.created_at,
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= v_from
    UNION ALL
    SELECT 'table:' || r.id::text, lower(r.user_email), r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= v_from
    UNION ALL
    SELECT 'order:' || o.id::text, lower(o.user_email), o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL AND o.created_at >= v_from
       AND CASE WHEN p_subject_type = 'venue' THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events) END
  ),
  attributed AS (
    SELECT DISTINCT s.sale_key, s.net
      FROM clicks c JOIN sales s ON s.em = c.em
       AND s.created_at >= c.click_at AND s.created_at < c.click_at + interval '72 hours'
  )
  SELECT jsonb_build_object(
    'emails', (SELECT n FROM sent),
    'sales', (SELECT count(*) FROM attributed),
    'revenue', round(COALESCE((SELECT sum(net) FROM attributed), 0)::numeric, 0)
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_marketing_pressure(p_email text)
 RETURNS TABLE(n24 integer, n7d integer, sent90 integer, engaged90 boolean, optouts30 integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH em AS (SELECT lower(p_email) AS e),
  sends AS (
    SELECT r.sent_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      JOIN em ON lower(r.email) = em.e
     WHERE r.status = 'sent' AND r.sent_at > now() - interval '90 days'
       AND COALESCE(c.type, 'promotional') = 'promotional'
    UNION ALL
    SELECT l.sent_at FROM public.marketing_email_log l JOIN em ON lower(l.email) = em.e
     WHERE l.sent_at > now() - interval '90 days'
  )
  SELECT
    (SELECT count(*) FROM sends WHERE sent_at > now() - interval '24 hours')::integer,
    (SELECT count(*) FROM sends WHERE sent_at > now() - interval '7 days')::integer,
    (SELECT count(*) FROM sends)::integer,
    EXISTS (
      SELECT 1 FROM public.email_campaign_events ev JOIN em ON lower(ev.recipient_email) = em.e
       WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
    ),
    (SELECT count(DISTINCT COALESCE(s.venue_id, s.organizer_user_id::text, 'platform')) FROM public.newsletter_subscriptions s JOIN em ON lower(s.email) = em.e
      WHERE s.opted_out_at > now() - interval '30 days')::integer;
$function$;

CREATE OR REPLACE FUNCTION public.export_venue_ad_audience(p_venue_id text)
 RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_super_admin() OR is_venue_owner(auth.uid(), p_venue_id)) THEN
    RAISE EXCEPTION 'Not authorized for venue %' , p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE vsc.venue_id = p_venue_id AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL AND vsc.product IS NULL
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id
      FROM public.newsletter_subscriptions ns
     WHERE ns.venue_id = p_venue_id AND ns.opted_in = true AND ns.product IS NULL
  ),
  merged AS (
    -- Opt-in newsletter, enrichi du téléphone si le même email a aussi consenti au SMS
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           pr.first_name, pr.last_name
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    -- Consentement SMS pur (pas d'opt-in newsletter au même email)
    SELECT s.em,
           s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  )
  SELECT
    NULLIF(m.em, '')::text,
    m.phone_e164::text,
    m.first_name::text,
    m.last_name::text,
    (CASE
      WHEN m.phone_e164 LIKE '+33%' THEN 'FR'
      WHEN m.phone_e164 LIKE '+34%' THEN 'ES'
      WHEN m.phone_e164 LIKE '+44%' THEN 'GB'
      WHEN m.phone_e164 LIKE '+49%' THEN 'DE'
      WHEN m.phone_e164 LIKE '+39%' THEN 'IT'
      WHEN m.phone_e164 LIKE '+32%' THEN 'BE'
      WHEN m.phone_e164 LIKE '+41%' THEN 'CH'
      WHEN m.phone_e164 LIKE '+351%' THEN 'PT'
      WHEN m.phone_e164 LIKE '+31%' THEN 'NL'
      WHEN m.phone_e164 LIKE '+352%' THEN 'LU'
      WHEN m.phone_e164 LIKE '+377%' THEN 'MC'
      WHEN m.phone_e164 LIKE '+1%' THEN 'US'
      ELSE ''
    END)::text AS country
  FROM merged m
  WHERE NULLIF(m.em, '') IS NOT NULL OR m.phone_e164 IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_campaigns(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g       record;
  v_ids   uuid[];
  v_now   timestamptz := now();
  v_from  timestamptz;
  v_to    timestamptz;
  v_email jsonb;
  v_push  jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_event_id IS NOT NULL THEN
    SELECT coalesce(e.published_at, e.start_at - interval '60 days'), coalesce(e.end_at, e.start_at + interval '8 hours') INTO v_from, v_to FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_to := coalesce(p_to, v_now); v_from := coalesce(p_from, v_to - interval '30 days');
  END IF;

  -- Les ventes de la portée (sujet) : une ligne par vente payée, avec email et user.
  WITH sales AS MATERIALIZED (
    SELECT p.email, p.user_id, p.at_ts, p.amount, p.event_id
      FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar IN ('tickets', 'tables') AND (p_event_id IS NULL OR p.event_id = p_event_id)
       AND p.at_ts BETWEEN v_from AND v_to + interval '7 days'
  ),
  camps AS (
    SELECT c.id, c.name, c.subject, c.sent_at, c.event_id, coalesce(c.recipients_count, c.total_recipients, 0) AS sent,
           coalesce(c.delivered_count, 0) AS delivered, coalesce(c.opens_count, 0) AS opens, coalesce(c.clicks_count, 0) AS clicks,
           coalesce(c.clickers_count, 0) AS clickers, c.automation_id IS NOT NULL AS automated
      FROM public.email_campaigns c
     WHERE c.sent_at IS NOT NULL AND c.status IN ('sent', 'completed', 'done', 'sending', 'paused')
       AND coalesce(c.type, 'promotional') = 'promotional'
       AND NOT public.crm_campaign_is_crm(c.id)
       AND ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND ((p_event_id IS NOT NULL AND (c.event_id = p_event_id OR c.automation_trigger_event_id = p_event_id))
            OR (p_event_id IS NULL AND c.sent_at BETWEEN v_from AND v_to))
  ),
  clicks AS (
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS first_click
      FROM public.email_campaign_events ev JOIN camps c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' GROUP BY 1, 2
  ),
  attributed AS (
    SELECT k.campaign_id,
           count(DISTINCT s.email) FILTER (WHERE s.at_ts <= k.first_click + interval '3 days') AS buyers_3d,
           count(*) FILTER (WHERE s.at_ts <= k.first_click + interval '3 days') AS orders_3d,
           round(sum(s.amount) FILTER (WHERE s.at_ts <= k.first_click + interval '3 days'), 2) AS revenue_3d,
           count(DISTINCT s.email) AS buyers_7d, count(*) AS orders_7d, round(sum(s.amount), 2) AS revenue_7d
      FROM clicks k JOIN sales s ON s.email = k.email AND s.at_ts > k.first_click AND s.at_ts <= k.first_click + interval '7 days'
     GROUP BY k.campaign_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'subject', c.subject, 'sent_at', c.sent_at, 'event_id', c.event_id, 'automated', c.automated,
    'sent', c.sent, 'delivered', c.delivered, 'opens', c.opens, 'clicks', c.clicks, 'clickers', c.clickers,
    'click_rate', CASE WHEN c.delivered >= 20 THEN round(100.0 * c.clickers / c.delivered, 1) END,
    'open_rate_partial', CASE WHEN c.delivered >= 20 THEN round(100.0 * least(c.opens, c.delivered) / c.delivered, 1) END,
    'orders_3d', coalesce(a.orders_3d, 0), 'buyers_3d', coalesce(a.buyers_3d, 0), 'revenue_3d', CASE WHEN g.money THEN coalesce(a.revenue_3d, 0) END,
    'orders_7d', coalesce(a.orders_7d, 0), 'buyers_7d', coalesce(a.buyers_7d, 0), 'revenue_7d', CASE WHEN g.money THEN coalesce(a.revenue_7d, 0) END
  ) ORDER BY c.sent_at DESC), '[]'::jsonb)
    INTO v_email FROM camps c LEFT JOIN attributed a ON a.campaign_id = c.id;

  WITH sales AS MATERIALIZED (
    SELECT p.email, p.user_id, p.at_ts, p.amount FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar IN ('tickets', 'tables') AND p.user_id IS NOT NULL AND (p_event_id IS NULL OR p.event_id = p_event_id)
       AND p.at_ts BETWEEN v_from AND v_to + interval '7 days'
  ),
  pc AS (
    SELECT c.id, c.title, coalesce(c.scheduled_at, c.created_at) AS sent_at, c.event_id, c.source, coalesce(c.targeted_count, 0) AS targeted,
           coalesce(c.sent_count, 0) AS sent
      FROM public.push_campaigns c
     WHERE c.status IN ('sent', 'completed', 'done')
       AND ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND ((p_event_id IS NOT NULL AND c.event_id = p_event_id) OR (p_event_id IS NULL AND coalesce(c.scheduled_at, c.created_at) BETWEEN v_from AND v_to))
  ),
  taps AS (
    SELECT ev.campaign_id, ev.user_id, min(ev.created_at) AS first_tap
      FROM public.push_campaign_events ev JOIN pc ON pc.id = ev.campaign_id
     WHERE ev.event_type IN ('clicked', 'opened') AND ev.user_id IS NOT NULL GROUP BY 1, 2
  ),
  attributed AS (
    SELECT t.campaign_id,
           count(*) FILTER (WHERE s.at_ts <= t.first_tap + interval '3 days') AS orders_3d,
           round(sum(s.amount) FILTER (WHERE s.at_ts <= t.first_tap + interval '3 days'), 2) AS revenue_3d,
           count(*) AS orders_7d, round(sum(s.amount), 2) AS revenue_7d
      FROM taps t JOIN sales s ON s.user_id = t.user_id AND s.at_ts > t.first_tap AND s.at_ts <= t.first_tap + interval '7 days'
     GROUP BY t.campaign_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'title', pc.title, 'sent_at', pc.sent_at, 'event_id', pc.event_id, 'automated', pc.source = 'auto',
    'targeted', pc.targeted, 'sent', pc.sent, 'taps', coalesce((SELECT count(*) FROM taps t WHERE t.campaign_id = pc.id), 0),
    'orders_3d', coalesce(a.orders_3d, 0), 'revenue_3d', CASE WHEN g.money THEN coalesce(a.revenue_3d, 0) END,
    'orders_7d', coalesce(a.orders_7d, 0), 'revenue_7d', CASE WHEN g.money THEN coalesce(a.revenue_7d, 0) END
  ) ORDER BY pc.sent_at DESC), '[]'::jsonb)
    INTO v_push FROM pc LEFT JOIN attributed a ON a.campaign_id = pc.id;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'from', v_from, 'to', v_to, 'email', v_email, 'push', v_push);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_community_period(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_hours integer DEFAULT 720)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  v_now       timestamptz := now();
  v_from      timestamptz;
  v_prev_from timestamptz;
  v_win_from  timestamptz;
  v_me        text;
  v_stype     text;
  v_sid       text;
  v_result    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_me := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue:' || g.scope_venue ELSE 'org:' || g.scope_org::text END;
  v_stype := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END;
  v_sid := CASE WHEN g.scope_venue IS NOT NULL THEN g.scope_venue ELSE g.scope_org::text END;
  v_from := CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_now - make_interval(hours => p_hours) END;
  v_prev_from := CASE WHEN p_hours IS NULL THEN NULL ELSE v_from - make_interval(hours => p_hours) END;

  WITH
  scope_ev AS MATERIALIZED (
    SELECT x.id FROM public.events x WHERE x.id = ANY (g.scope_ids) AND x.cancelled_at IS NULL
  ),
  rows_all AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.event_id, lower(btrim(t.user_email)) AS email, t.user_id,
           COALESCE(t.paid_at, t.created_at) AS at_ts,
           greatest(COALESCE(t.quantity, 1), 1) AS heads,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0), greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id IN (SELECT id FROM scope_ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', r.event_id, lower(btrim(r.user_email)), r.user_id, COALESCE(r.paid_at, r.created_at),
           greatest(COALESCE(r.guest_count, 0), 1),
           greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id IN (SELECT id FROM scope_ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'guest_list', gl.event_id, lower(nullif(btrim(ge.email), '')), ge.user_id, ge.created_at, 1, 0::numeric
      FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scope_ev) AND ge.status <> 'cancelled'
  ),
  win_rows AS MATERIALIZED (SELECT * FROM rows_all WHERE at_ts >= v_from),
  people AS MATERIALIZED (
    SELECT r.email, min(r.at_ts) AS first_at,
           (array_agg(r.user_id) FILTER (WHERE r.user_id IS NOT NULL))[1] AS user_id,
           bool_or(r.pillar IN ('tickets', 'tables')) AS buyer, bool_or(r.pillar = 'guest_list') AS guest,
           sum(r.heads) FILTER (WHERE r.pillar <> 'guest_list') AS heads_paid, COALESCE(sum(r.amount), 0) AS amount
      FROM win_rows r WHERE r.email IS NOT NULL GROUP BY r.email
  ),
  no_email AS (SELECT count(*) AS n FROM win_rows WHERE email IS NULL),
  people_prev AS (
    SELECT count(DISTINCT email) AS n FROM rows_all
     WHERE email IS NOT NULL AND v_prev_from IS NOT NULL AND at_ts >= v_prev_from AND at_ts < v_from
  ),
  -- Déjà connus AVANT la période, et nombre de soirées faites (toute la vie de la portée).
  life AS (
    SELECT r.email, count(DISTINCT r.event_id) AS nights, min(r.at_ts) AS first_ever
      FROM rows_all r WHERE r.email IN (SELECT email FROM people) GROUP BY r.email
  ),
  ns AS MATERIALIZED (
    SELECT lower(n.email) AS email, n.opted_in, n.created_at
      FROM public.newsletter_subscriptions n
     WHERE ((g.scope_venue IS NOT NULL AND n.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND n.organizer_user_id = g.scope_org))
       AND n.product IS NULL
       AND lower(n.email) IN (SELECT email FROM people)
  ),
  sm AS MATERIALIZED (
    SELECT lower(c.email) AS email, c.phone_e164, c.sms_consent_at
      FROM public.venue_sms_contacts c
     WHERE ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND c.product IS NULL
       AND COALESCE(c.unsubscribed, false) = false AND lower(c.email) IN (SELECT email FROM people)
  ),
  app AS (
    SELECT DISTINCT p.email FROM people p
     WHERE p.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.platform = 'ios')
  ),
  acct AS (
    SELECT DISTINCT p.email FROM people p
     WHERE p.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.profiles pf WHERE lower(pf.email) = p.email)
  ),
  me_ns AS (SELECT DISTINCT email FROM ns WHERE opted_in),
  me_sm AS (SELECT DISTINCT email FROM sm WHERE email IS NOT NULL),
  fresh AS (SELECT p.email FROM people p JOIN life l ON l.email = p.email WHERE l.first_ever >= v_from),
  reach AS (
    SELECT count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns)) AS email_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_sm)) AS sms_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM app)) AS app,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM acct)) AS account,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns) OR p.email IN (SELECT email FROM me_sm) OR p.email IN (SELECT email FROM app)) AS any_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh)) AS fresh_n,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh) AND p.email IN (SELECT email FROM me_ns)) AS fresh_email_ok,
           count(*) FILTER (WHERE p.buyer) AS buyers,
           count(*) FILTER (WHERE p.guest AND NOT p.buyer) AS guests_only,
           COALESCE(sum(p.heads_paid), 0) AS heads_paid, COALESCE(sum(p.amount), 0) AS amount
      FROM people p
  ),
  loyalty AS (
    SELECT count(*) FILTER (WHERE COALESCE(l.nights, 1) <= 1) AS first_time,
           count(*) FILTER (WHERE l.nights = 2) AS second_time, count(*) FILTER (WHERE l.nights >= 3) AS regulars
      FROM people p LEFT JOIN life l ON l.email = p.email
  ),
  fw AS MATERIALIZED (
    SELECT f.follower_user_id, f.action, f.source, f.created_at
      FROM public.audience_follow_events f
     WHERE f.subject_type = v_stype AND f.subject_id = v_sid
       AND f.created_at >= CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_from - interval '60 days' END
  ),
  fw_sum AS (
    SELECT count(*) FILTER (WHERE action = 'follow' AND created_at >= v_from) AS gained,
           count(*) FILTER (WHERE action = 'unfollow' AND created_at >= v_from) AS lost,
           count(*) FILTER (WHERE action = 'follow' AND created_at >= v_from AND source = 'event_page') AS from_event_page,
           count(DISTINCT follower_user_id) FILTER (WHERE action = 'follow' AND created_at >= v_from
              AND follower_user_id IN (SELECT user_id FROM people WHERE user_id IS NOT NULL)) AS from_attendees,
           count(*) FILTER (WHERE action = 'follow' AND created_at < v_from AND p_hours IS NOT NULL) AS before_follows,
           count(*) FILTER (WHERE action = 'follow' AND created_at >= COALESCE(v_prev_from, v_from) AND created_at < v_from AND p_hours IS NOT NULL) AS prev_gained
      FROM fw
  ),
  snap AS (
    SELECT s.followers_total FROM public.audience_daily_snapshots s
     WHERE s.subject_type = v_stype AND s.subject_id = v_sid ORDER BY s.snapshot_date DESC LIMIT 1
  ),
  win AS (SELECT CASE WHEN p_hours IS NULL THEN COALESCE((SELECT min(at_ts) FROM rows_all), v_now) ELSE v_from END AS from_ts),
  tl_people AS (
    SELECT to_char(p.first_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh)) AS fresh
      FROM people p GROUP BY 1
  ),
  tl_fw AS (
    SELECT to_char(created_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(*) AS followers
      FROM fw WHERE action = 'follow' AND created_at >= v_from GROUP BY 1
  ),
  tl_ns AS (
    SELECT to_char(created_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(DISTINCT email) AS optins
      FROM ns WHERE opted_in AND created_at >= v_from GROUP BY 1
  ),
  tl_days AS (SELECT date FROM tl_people UNION SELECT date FROM tl_fw UNION SELECT date FROM tl_ns),
  timeline AS (
    SELECT d.date, COALESCE(pp.people, 0) AS people, COALESCE(pp.fresh, 0) AS fresh,
           COALESCE(ff.followers, 0) AS followers, COALESCE(nn.optins, 0) AS optins
      FROM tl_days d LEFT JOIN tl_people pp ON pp.date = d.date LEFT JOIN tl_fw ff ON ff.date = d.date LEFT JOIN tl_ns nn ON nn.date = d.date
     ORDER BY d.date DESC LIMIT 366
  )
  SELECT jsonb_build_object(
    'ok', true, 'now', v_now, 'tz', g.tz, 'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'me', v_me, 'event', null,
    'period', jsonb_build_object('hours', p_hours, 'from', (SELECT from_ts FROM win), 'to', v_now),
    'window', jsonb_build_object('from', (SELECT from_ts FROM win), 'to', v_now),
    'people', (SELECT jsonb_build_object('total', people, 'buyers', buyers, 'guestsOnly', guests_only, 'headsPaid', heads_paid,
                 'noEmail', (SELECT n FROM no_email), 'spend', CASE WHEN g.money AND buyers > 0 THEN round(amount, 2) END) FROM reach),
    'crm', (SELECT jsonb_build_object('new', fresh_n, 'known', people - fresh_n, 'emailOk', email_ok, 'smsOk', sms_ok, 'app', app,
                 'account', account, 'anyReach', any_ok, 'newEmailOk', fresh_email_ok) FROM reach),
    'loyalty', (SELECT jsonb_build_object('first', first_time, 'second', second_time, 'regulars', regulars) FROM loyalty),
    'retention', null,
    'parties', '[]'::jsonb,
    'followers', (SELECT jsonb_build_object('gained', gained, 'lost', lost, 'eventPage', from_event_page, 'attendees', from_attendees,
                 'total', (SELECT followers_total FROM snap),
                 'baselinePerDay', CASE WHEN p_hours IS NULL THEN 0 ELSE round(before_follows::numeric / 60.0, 2) END) FROM fw_sum),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'people', people, 'fresh', fresh,
                 'followers', followers, 'optins', optins) ORDER BY date) FROM timeline), '[]'::jsonb),
    'previous', CASE WHEN p_hours IS NULL THEN null
                     ELSE jsonb_build_object('people', (SELECT n FROM people_prev), 'followers', (SELECT prev_gained FROM fw_sum)) END
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_community_takeaways(
    v_result, greatest(1, round(extract(epoch FROM (v_now - (v_result #>> '{period,from}')::timestamptz)) / 86400.0))));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer := 0;
  v_segs jsonb := '[]'::jsonb;
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
  v_refreshed timestamptz;
  v_eng jsonb; v_orig jsonb; v_reach integer; v_reach_sms integer;
  r record;
  c_n integer; c_e integer; c_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT s.refreshed_at INTO v_refreshed FROM public.contact_engagement_state s WHERE s.scope_key = v_key;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  FOR r IN
    SELECT cs.* FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at DESC
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.definition, 'c'))
      INTO c_n, c_e, c_p;
    v_segs := v_segs || jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'definition', r.definition,
      'origin', r.origin, 'suggestion_key', r.suggestion_key, 'created_at', r.created_at,
      'counts', jsonb_build_object('contacts', COALESCE(c_n,0), 'emails', COALESCE(c_e,0), 'phones', COALESCE(c_p,0)));
  END LOOP;

  SELECT jsonb_build_object(
           'active', count(*) FILTER (WHERE eng_status = 'active'),
           'passive', count(*) FILTER (WHERE eng_status = 'passive'),
           'silent', count(*) FILTER (WHERE eng_status = 'silent'),
           'new', count(*) FILTER (WHERE eng_status = 'new'),
           'unreachable', count(*) FILTER (WHERE eng_status = 'unreachable'),
           'unsubscribed', count(*) FILTER (WHERE eng_status = 'unsubscribed'),
           'sent_any', count(*) FILTER (WHERE emails_sent > 0)),
         jsonb_build_object(
           'import', count(*) FILTER (WHERE origin = 'import'),
           'yuno', count(*) FILTER (WHERE origin = 'yuno'),
           'both', count(*) FILTER (WHERE origin = 'both'),
           'with_account', count(*) FILTER (WHERE has_account)),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok)
    INTO v_eng, v_orig, v_reach, v_reach_sms
    FROM _cr;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)
                AND li.product IS NULL
                AND li.superseded_by IS NULL), '[]'::jsonb),
    'segments', v_segs,
    'contacts', v_n,
    'reachable_emails', COALESCE(v_reach, 0),
    'reachable_phones', COALESCE(v_reach_sms, 0),
    'engagement', v_eng,
    'origin', v_orig,
    'refreshed_at', v_refreshed,
    'impacts', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.sent_at DESC) FROM (
        SELECT ec.sent_at, jsonb_build_object(
                 'campaign_id', i.campaign_id, 'name', ec.name, 'subject', ec.subject, 'sent_at', ec.sent_at,
                 'recipients', ec.recipients_count, 'opens', ec.opens_count, 'clickers', ec.clickers_count,
                 'unsubscribes', ec.unsubscribes_count, 'bounced', ec.bounced_count, 'complained', ec.complained_count,
                 'baseline', i.baseline, 'baseline_at', i.baseline_at, 'current', i.current, 'computed_at', i.computed_at) AS obj
          FROM public.email_campaign_list_impact i
          JOIN public.email_campaigns ec ON ec.id = i.campaign_id
         WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND NOT public.crm_campaign_is_crm(ec.id)
           AND ec.status = 'sent' AND ec.sent_at > now() - interval '60 days'
         ORDER BY ec.sent_at DESC LIMIT 6) x), '[]'::jsonb),
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND li.product IS NULL
                    AND (public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  );
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
   WHERE a.enabled AND a.product = 'crm' AND a.venue_id IS NOT DISTINCT FROM p_venue_id
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

CREATE OR REPLACE FUNCTION public.get_crm_night_report__core(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e public.events%ROWTYPE;
  v_tz text;
  v_prev uuid;
  v_totals jsonb;
  v_curve jsonb;
  v_prev_curve jsonb;
  v_prev_info jsonb;
  v_deals jsonb;
  v_audience jsonb;
  v_campaigns jsonb;
  v_utm jsonb;
  v_ext jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR e.external_source IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.crm_scope_allowed(e.venue_id, e.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');

  SELECT jsonb_build_object('left_tickets', ee.left_tickets, 'deals_offered', jsonb_array_length(COALESCE(ee.deals, '[]'::jsonb)),
                            'launched_at', ee.launched_at, 'published_at', ee.published_at, 'artists', ee.artists, 'genres', ee.genres)
    INTO v_ext FROM public.external_events ee WHERE ee.event_id = e.id LIMIT 1;

  -- Totaux. Nouveaux = première soirée de la personne dans la portée.
  WITH mine AS (
    SELECT t.* FROM public.external_tickets t WHERE t.event_id = e.id
  ), scope_first AS (
    SELECT lower(t.buyer_email) AS em, min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_at
      FROM public.external_tickets t
     WHERE t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred')
       AND ((e.venue_id IS NOT NULL AND t.venue_id = e.venue_id)
         OR (e.organizer_user_id IS NOT NULL AND t.organizer_user_id = e.organizer_user_id))
       AND lower(t.buyer_email) IN (SELECT lower(m.buyer_email) FROM mine m WHERE m.buyer_email IS NOT NULL)
     GROUP BY lower(t.buyer_email)
  ), my_buyers AS (
    SELECT lower(m.buyer_email) AS em, min(COALESCE(m.purchased_at, m.first_seen_at)) AS at
      FROM mine m WHERE m.buyer_email IS NOT NULL AND m.status IN ('valid', 'transferred')
     GROUP BY lower(m.buyer_email)
  )
  SELECT jsonb_build_object(
    'tickets', (SELECT COALESCE(sum(GREATEST(quantity, 1)), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'revenue', (SELECT COALESCE(round(sum(COALESCE(price, 0) * GREATEST(quantity, 1)), 2), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'fees', (SELECT COALESCE(round(sum(COALESCE(fees, 0) * GREATEST(quantity, 1)), 2), 0) FROM mine WHERE status IN ('valid', 'transferred')),
    'buyers', (SELECT count(*) FROM my_buyers),
    'new_buyers', (SELECT count(*) FROM my_buyers b JOIN scope_first f ON f.em = b.em WHERE f.first_at >= b.at),
    'scanned', (SELECT count(*) FROM mine WHERE scanned_at IS NOT NULL),
    'scan_known', (SELECT bool_or(scanned_at IS NOT NULL) FROM mine),
    'refunded', (SELECT count(*) FROM mine WHERE status IN ('refunded', 'cancelled')),
    'with_email', (SELECT count(*) FROM mine WHERE buyer_email IS NOT NULL),
    'all_tickets', (SELECT count(*) FROM mine),
    'optin_buyers', (SELECT count(DISTINCT lower(buyer_email)) FROM mine WHERE newsletter_optin IS TRUE AND status IN ('valid', 'transferred'))
  ) INTO v_totals;

  -- Courbe J-N : billets vendus par jour calendaire avant la soirée (fuseau de la soirée).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'tickets', n) ORDER BY d DESC), '[]'::jsonb) INTO v_curve FROM (
    SELECT GREATEST(((e.start_at AT TIME ZONE v_tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date), 0) AS d,
           sum(GREATEST(t.quantity, 1)) AS n
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
     GROUP BY 1
  ) c;

  -- Soirée de comparaison : la précédente de la portée (billetterie connectée).
  SELECT p.id INTO v_prev FROM public.events p
   WHERE p.external_source IS NOT NULL AND p.id <> e.id AND p.start_at < e.start_at AND p.cancelled_at IS NULL
     AND ((e.venue_id IS NOT NULL AND p.venue_id = e.venue_id)
       OR (e.organizer_user_id IS NOT NULL AND p.organizer_user_id = e.organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = p.id)
   ORDER BY p.start_at DESC LIMIT 1;
  IF v_prev IS NOT NULL THEN
    SELECT jsonb_build_object('event_id', p.id, 'title', p.title, 'start_at', p.start_at,
             'tickets', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t WHERE t.event_id = p.id AND t.status IN ('valid', 'transferred')),
             'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0) FROM public.external_tickets t WHERE t.event_id = p.id AND t.status IN ('valid', 'transferred')))
      INTO v_prev_info FROM public.events p WHERE p.id = v_prev;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'tickets', n) ORDER BY d DESC), '[]'::jsonb) INTO v_prev_curve FROM (
      SELECT GREATEST(((p.start_at AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'Europe/Paris'))::date
                     - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'Europe/Paris'))::date), 0) AS d,
             sum(GREATEST(t.quantity, 1)) AS n
        FROM public.external_tickets t JOIN public.events p ON p.id = t.event_id
       WHERE t.event_id = v_prev AND t.status IN ('valid', 'transferred')
       GROUP BY 1
    ) c;
  END IF;

  -- Tarifs.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_deals FROM (
    SELECT jsonb_build_object('name', COALESCE(t.deal_name, '—'),
             'tickets', sum(GREATEST(t.quantity, 1)),
             'revenue', round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2)) AS x
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
     GROUP BY COALESCE(t.deal_name, '—')
  ) q;

  -- Public (ce que la billetterie a transmis ; la couverture est rendue).
  SELECT jsonb_build_object(
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC) FROM (
                SELECT initcap(lower(t.city)) AS city, count(DISTINCT lower(COALESCE(t.buyer_email, t.external_id))) AS n
                  FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND NULLIF(btrim(t.city), '') IS NOT NULL
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 6) c), '[]'::jsonb),
    'ages', COALESCE((SELECT jsonb_agg(jsonb_build_object('band', band, 'n', n) ORDER BY band) FROM (
                SELECT CASE WHEN t.age < 21 THEN '18-20' WHEN t.age < 25 THEN '21-24' WHEN t.age < 30 THEN '25-29'
                            WHEN t.age < 35 THEN '30-34' ELSE '35+' END AS band, count(*) AS n
                  FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.age IS NOT NULL
                 GROUP BY 1) a), '[]'::jsonb),
    'genders', COALESCE((SELECT jsonb_object_agg(g, n) FROM (
                SELECT t.gender AS g, count(*) AS n FROM public.external_tickets t
                 WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.gender IS NOT NULL
                 GROUP BY 1) g), '{}'::jsonb),
    'with_city', (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND NULLIF(btrim(t.city), '') IS NOT NULL),
    'with_age', (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.age IS NOT NULL)
  ) INTO v_audience;

  -- Emails de la soirée et ventes attribuées (1er clic → achat de CETTE soirée < 72 h).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sent_at' DESC NULLS LAST), '[]'::jsonb) INTO v_campaigns FROM (
    SELECT jsonb_build_object(
             'campaign_id', c.id, 'name', c.name, 'subject', c.subject, 'sent_at', c.sent_at, 'status', c.status,
             'automation', c.automation_id IS NOT NULL,
             'recipients', COALESCE(c.total_recipients, c.recipients_count, 0),
             'opens', COALESCE(c.opens_count, 0), 'clicks', COALESCE(c.clicks_count, 0),
             'attributed_tickets', COALESCE(att.tickets, 0), 'attributed_revenue', COALESCE(att.revenue, 0)
           ) AS x
      FROM public.email_campaigns c
      LEFT JOIN LATERAL (
        SELECT sum(GREATEST(t.quantity, 1)) AS tickets, round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2) AS revenue
          FROM (SELECT lower(ce.recipient_email) AS em, min(ce.created_at) AS click_at
                  FROM public.email_campaign_events ce
                 WHERE ce.campaign_id = c.id AND ce.event_type = 'clicked' AND ce.recipient_email IS NOT NULL
                 GROUP BY 1) k
          JOIN public.external_tickets t ON t.event_id = e.id AND lower(t.buyer_email) = k.em
               AND t.status IN ('valid', 'transferred')
               AND COALESCE(t.purchased_at, t.first_seen_at) >= k.click_at
               AND COALESCE(t.purchased_at, t.first_seen_at) < k.click_at + interval '72 hours'
      ) att ON true
     WHERE (c.event_id = e.id OR c.automation_trigger_event_id = e.id)
       AND public.crm_campaign_is_crm(c.id)
       AND c.status IN ('sent', 'sending', 'completed')
  ) q;

  -- Sources UTM rapportées par la billetterie.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tickets')::int DESC), '[]'::jsonb) INTO v_utm FROM (
    SELECT jsonb_build_object('source', COALESCE(t.utm->>'utm_source', '—'), 'medium', t.utm->>'utm_medium',
             'tickets', sum(GREATEST(t.quantity, 1)),
             'revenue', round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2)) AS x
      FROM public.external_tickets t
     WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred') AND t.utm IS NOT NULL
     GROUP BY COALESCE(t.utm->>'utm_source', '—'), t.utm->>'utm_medium'
     ORDER BY sum(GREATEST(t.quantity, 1)) DESC LIMIT 8
  ) q;

  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                                'timezone', v_tz, 'cover_url', COALESCE(e.poster_url, e.image_url),
                                'url', e.external_ticket_url, 'cancelled', e.cancelled_at IS NOT NULL,
                                'sold_out', e.tickets_sold_out, 'location_city', e.location_city,
                                'entry_target', e.entry_target, 'external', v_ext),
    'totals', v_totals, 'curve', v_curve,
    'compare', CASE WHEN v_prev IS NULL THEN NULL ELSE jsonb_build_object('event', v_prev_info, 'curve', v_prev_curve) END,
    'deals', v_deals, 'audience', v_audience, 'campaigns', v_campaigns, 'utm', v_utm
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_crm_overview__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conn jsonb;
  v_base jsonb;
  v_sales jsonb;
  v_upcoming jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('provider', c.provider, 'status', c.status, 'external_org_name', c.external_org_name,
                            'last_ok_at', c.last_ok_at, 'initial_import_done_at', c.initial_import_done_at,
                            'running', c.locked_until IS NOT NULL AND c.locked_until > now(), 'stats', c.stats)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;

  WITH subs AS (
    SELECT lower(s.email) AS em, bool_or(s.opted_in AND s.opted_out_at IS NULL) AS ok,
           bool_or(COALESCE(s.source, '') LIKE 'connector:%') AS from_ticketing
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.product = 'crm'
     GROUP BY lower(s.email)
  ), buyers AS (
    SELECT DISTINCT lower(t.buyer_email) AS em
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL AND t.status IN ('valid', 'transferred')
  )
  SELECT jsonb_build_object(
           'contacts', (SELECT count(*) FROM (SELECT em FROM subs UNION SELECT em FROM buyers) u),
           'reachable', (SELECT count(*) FROM subs WHERE ok AND NOT public.is_email_suppressed(em)),
           'reachable_from_ticketing', (SELECT count(*) FROM subs WHERE ok AND from_ticketing),
           'buyers', (SELECT count(*) FROM buyers)
         ) INTO v_base;

  SELECT jsonb_build_object(
           'tickets', COALESCE(sum(GREATEST(t.quantity, 1)), 0),
           'revenue', COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0),
           'buyers', count(DISTINCT lower(t.buyer_email)),
           'nights', count(DISTINCT t.event_id)
         ) INTO v_sales
    FROM public.external_tickets t
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND t.status IN ('valid', 'transferred')
     AND COALESCE(t.purchased_at, t.first_seen_at) > now() - interval '90 days';

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'start_at'), '[]'::jsonb) INTO v_upcoming FROM (
    SELECT jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
             'cover_url', COALESCE(e.poster_url, e.image_url), 'url', e.external_ticket_url,
             'sold_out', e.tickets_sold_out, 'cancelled', e.cancelled_at IS NOT NULL,
             'tickets', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')),
             'tickets_today', (SELECT COALESCE(sum(GREATEST(t.quantity, 1)), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred')
                            AND COALESCE(t.purchased_at, t.first_seen_at) >= date_trunc('day', now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')),
             'revenue', (SELECT COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)), 2), 0) FROM public.external_tickets t
                          WHERE t.event_id = e.id AND t.status IN ('valid', 'transferred'))
           ) AS x
      FROM public.events e
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at > now()
     ORDER BY e.start_at ASC
     LIMIT 5
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'start_at' DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
             'cover_url', COALESCE(e.poster_url, e.image_url),
             'tickets', COALESCE(sum(GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 0),
             'buyers', count(DISTINCT lower(t.buyer_email)) FILTER (WHERE t.status IN ('valid', 'transferred')),
             'scanned', count(*) FILTER (WHERE t.scanned_at IS NOT NULL),
             'revenue', COALESCE(round(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (WHERE t.status IN ('valid', 'transferred')), 2), 0)
           ) AS x
      FROM public.events e
      LEFT JOIN public.external_tickets t ON t.event_id = e.id
     WHERE e.external_source IS NOT NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now()
     GROUP BY e.id
     ORDER BY e.start_at DESC
     LIMIT 5
  ) q;

  RETURN jsonb_build_object('connection', v_conn, 'base', v_base, 'sales_90d', v_sales,
                            'upcoming', v_upcoming, 'recent', v_recent);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_automation_emails(p_venue_id text, p_organizer_user_id uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  IF p_email IS NULL OR position('@' in p_email) <= 1 THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb) INTO result
    FROM (
      SELECT l.kind, l.status, l.skip_reason, l.created_at, l.due_at, l.campaign_id,
             e.title AS event_title,
             r.sent_at,
             (r.sent_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.email_campaign_events ev
                WHERE ev.campaign_id = l.campaign_id AND lower(ev.recipient_email) = lower(l.email) AND ev.event_type = 'opened')) AS opened,
             (r.sent_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.email_campaign_events ev
                WHERE ev.campaign_id = l.campaign_id AND lower(ev.recipient_email) = lower(l.email) AND ev.event_type = 'clicked')) AS clicked
        FROM public.email_automation_sends l
        LEFT JOIN public.events e ON e.id = COALESCE(l.trigger_event_id, l.bind_event_id)
        LEFT JOIN public.email_campaign_recipients r
          ON r.campaign_id = l.campaign_id AND lower(r.email) = lower(l.email)
       WHERE lower(l.email) = lower(p_email)
         AND NOT EXISTS (SELECT 1 FROM public.email_automations a2 WHERE a2.id = l.automation_id AND a2.product = 'crm')
         AND ((p_venue_id IS NOT NULL AND l.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND l.organizer_user_id = p_organizer_user_id))
       ORDER BY l.created_at DESC
       LIMIT 50
    ) x;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dj_lineup_email_targets(p_event_id uuid, p_dj_id uuid)
 RETURNS TABLE(user_id uuid, email text, first_name text, preferred_language text, unsubscribe_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_city   text;
  v_venue  text;
  v_ok     boolean;
  v_person uuid;
BEGIN
  SELECT e.location_city, e.venue_id,
         (e.is_active AND e.end_at >= now() AND e.visibility = 'public')
    INTO v_city, v_venue, v_ok
  FROM public.events e WHERE e.id = p_event_id;

  IF NOT FOUND OR v_ok IS NOT TRUE OR v_city IS NULL OR v_venue IS NULL THEN RETURN; END IF;

  SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = p_dj_id;
  IF v_person IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT ON (f.user_id)
    f.user_id,
    p.email,
    p.first_name,
    p.preferred_language,
    ns.unsubscribe_token::text
  FROM public.favorites f
  JOIN public.profiles p ON p.id = f.user_id
  JOIN public.newsletter_subscriptions ns
    ON lower(ns.email) = lower(p.email) AND ns.venue_id = v_venue AND ns.opted_in = true AND ns.product IS NULL
  WHERE f.favorite_type = 'dj'
    AND f.dj_id IN (SELECT d2.id FROM public.djs d2 WHERE d2.user_id = v_person)
    AND p.email IS NOT NULL
    AND p.city IS NOT NULL
    AND (
      lower(btrim(p.city)) = lower(btrim(v_city))
      OR position(lower(btrim(v_city)) IN lower(btrim(p.city))) > 0
      OR position(lower(btrim(p.city)) IN lower(btrim(v_city))) > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dj_lineup_notifications n
      WHERE n.user_id = f.user_id AND n.event_id = p_event_id AND n.dj_id = p_dj_id
    )
  ORDER BY f.user_id, f.created_at ASC;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type NOT IN ('venue', 'organizer') THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE e.external_source IS NULL AND CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  -- 1er clic par (campagne, email) sur les campagnes email du sujet (90 j)
  clicks AS (
    SELECT ece.campaign_id, lower(ece.recipient_email) AS em, min(ece.created_at) AS click_at
      FROM public.email_campaign_events ece
      JOIN public.email_campaigns ec ON ec.id = ece.campaign_id
     WHERE ece.event_type = 'clicked'
       AND ece.recipient_email IS NOT NULL
       AND ec.created_at >= now() - interval '90 days'
       AND NOT public.crm_campaign_is_crm(ec.id)
       AND CASE WHEN p_subject_type = 'venue'
                THEN ec.venue_id = p_subject_id
                ELSE ec.organizer_user_id::text = p_subject_id
           END
     GROUP BY ece.campaign_id, lower(ece.recipient_email)
  ),
  -- Actions du sujet avec NET (fees.ts), matchées par email. `units` = ce que
  -- le pilier compte vraiment : billets vendus, convives attablés, 1 inscrit.
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, 'ticket'::text AS kind,
           lower(t.user_email) AS em, t.created_at,
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net,
           GREATEST(coalesce(t.quantity, 1), 1)::int AS units
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= now() - interval '90 days'
    UNION ALL
    SELECT 'table:' || r.id::text, 'table', lower(r.user_email), r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))),
           GREATEST(coalesce(r.guest_count, 0), 0)::int
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= now() - interval '90 days'
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, 'order', lower(o.user_email), o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))),
           0
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND o.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
    UNION ALL
    -- Liste invités : zéro euro, mais c'est une entrée gagnée. Sur une soirée
    -- sans billetterie c'est la SEULE chose que l'email peut produire — la
    -- taire revenait à afficher « 0 € » sur une campagne qui a rempli la porte.
    SELECT 'guestlist:' || gle.id::text, 'guestlist', lower(gle.email), gle.created_at,
           0::numeric, 1
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scoped_events)
       AND gle.status <> 'cancelled'
       AND gle.email IS NOT NULL AND btrim(gle.email) <> ''
       AND gle.created_at >= now() - interval '90 days'
    UNION ALL
    -- Yuno CRM : achat sur la billetterie connectée (valeur faciale, hors frais).
    SELECT 'external:' || xt.id::text, 'ticket', lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at),
           (COALESCE(xt.price, 0) * GREATEST(xt.quantity, 1))::numeric, GREATEST(xt.quantity, 1)
      FROM public.external_tickets xt
     WHERE xt.event_id IN (SELECT id FROM scoped_events) AND xt.status IN ('valid', 'transferred') AND xt.buyer_email IS NOT NULL
       AND COALESCE(xt.purchased_at, xt.first_seen_at) >= now() - interval '90 days'
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.kind, s.em, s.net, s.units
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2)                                   AS revenue,
           count(DISTINCT em) FILTER (WHERE kind <> 'guestlist')         AS buyers,
           count(*)           FILTER (WHERE kind = 'ticket')             AS ticket_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'ticket'), 0)        AS ticket_units,
           round(coalesce(sum(net) FILTER (WHERE kind = 'ticket'), 0)::numeric, 2)    AS ticket_revenue,
           count(*)           FILTER (WHERE kind = 'table')              AS table_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'table'), 0)         AS table_guests,
           round(coalesce(sum(net) FILTER (WHERE kind = 'table'), 0)::numeric, 2)     AS table_revenue,
           count(*)           FILTER (WHERE kind = 'guestlist')          AS gl_entries,
           count(DISTINCT em) FILTER (WHERE kind = 'guestlist')          AS gl_people,
           count(*)           FILTER (WHERE kind = 'order')              AS drink_orders,
           round(coalesce(sum(net) FILTER (WHERE kind = 'order'), 0)::numeric, 2)     AS drink_revenue
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', campaign_id,
        'revenue', revenue,
        'buyers', buyers,
        'tickets',   jsonb_build_object('orders', ticket_orders, 'units', ticket_units, 'revenue', ticket_revenue),
        'tables',    jsonb_build_object('orders', table_orders,  'guests', table_guests, 'revenue', table_revenue),
        'guestlist', jsonb_build_object('entries', gl_entries,   'people', gl_people),
        'drinks',    jsonb_build_object('orders', drink_orders,  'revenue', drink_revenue)
      ))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_send_time_insights(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  WITH opens AS (
    SELECT extract(hour from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer AS h,
           extract(isodow from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer AS d
      FROM public.email_campaign_events ev
      JOIN public.email_campaigns c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'opened'
       AND ev.created_at > now() - interval '120 days'
       AND NOT public.crm_campaign_is_crm(c.id)
       AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  ),
  by_hour AS (
    SELECT g.h, count(o.h) AS n FROM generate_series(0, 23) AS g(h) LEFT JOIN opens o ON o.h = g.h GROUP BY g.h
  ),
  by_dow AS (
    SELECT g.d, count(o.d) AS n FROM generate_series(1, 7) AS g(d) LEFT JOIN opens o ON o.d = g.d GROUP BY g.d
  ),
  windows AS (
    -- Fenêtre glissante de 2 h : l'heure h compte ses ouvertures et celles de h+1.
    SELECT a.h, a.n + b.n AS n
      FROM by_hour a JOIN by_hour b ON b.h = (a.h + 1) % 24
  ),
  totals AS (SELECT count(*) AS sample FROM opens)
  SELECT jsonb_build_object(
    'sample', t.sample,
    'by_hour', (SELECT jsonb_agg(n ORDER BY h) FROM by_hour),
    'by_dow', (SELECT jsonb_agg(n ORDER BY d) FROM by_dow),
    'best_hour', CASE WHEN t.sample >= 30 THEN (SELECT h FROM windows ORDER BY n DESC, h ASC LIMIT 1) END,
    'best_dow', CASE WHEN t.sample >= 30 THEN (SELECT d FROM by_dow ORDER BY n DESC, d ASC LIMIT 1) END
  ) INTO result
  FROM totals t;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_community(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  e           record;
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_tz        text;
  v_end       timestamptz;
  v_phase     text;
  v_win_start timestamptz;
  v_win_end   timestamptz;
  v_me        text;
  v_later_cnt integer;
  v_result    jsonb;
  v_take      jsonb := '[]'::jsonb;
  v_people    integer;
  v_fresh     integer;
  v_any       integer;
  v_noemail   integer;
  v_gained    integer;
  v_days      numeric;
  v_expected  numeric;
  v_top       record;
  v_known     integer;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT ev.*, COALESCE(ev.timezone, v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_event_id;

  v_tz := e.tz;
  v_end := COALESCE(e.end_at, e.start_at + interval '8 hours');
  v_phase := CASE WHEN v_now < e.start_at THEN 'before' WHEN v_now < v_end THEN 'live' ELSE 'after' END;
  v_me := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue:' || g.scope_venue ELSE 'org:' || g.scope_org::text END;

  -- Début de fenêtre : la première vente / inscription, sinon la publication.
  SELECT least(
           COALESCE((SELECT min(COALESCE(t.paid_at, t.created_at)) FROM public.tickets t
                      WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')), 'infinity'::timestamptz),
           COALESCE((SELECT min(COALESCE(r.paid_at, r.created_at)) FROM public.table_reservations r
                      WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')), 'infinity'::timestamptz),
           COALESCE((SELECT min(ge.created_at) FROM public.guest_list_entries ge
                       JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                      WHERE gl.event_id = p_event_id AND ge.status <> 'cancelled'), 'infinity'::timestamptz),
           COALESCE(e.published_at, e.created_at))
    INTO v_win_start;
  v_win_end := LEAST(v_end + interval '72 hours', v_now);
  IF v_win_start IS NULL OR v_win_start = 'infinity'::timestamptz THEN v_win_start := e.created_at; END IF;

  WITH
  promo AS (
    SELECT pr.id,
           CASE WHEN pr.organizer_user_id IS NOT NULL THEN 'org:' || pr.organizer_user_id
                WHEN pr.venue_id IS NOT NULL THEN 'venue:' || pr.venue_id END AS pkey
      FROM public.promoters pr
  ),
  links AS (
    SELECT tl.id,
           COALESCE((SELECT pm.pkey FROM promo pm WHERE pm.id = tl.promoter_id),
                    CASE WHEN tl.organizer_user_id IS NOT NULL THEN 'org:' || tl.organizer_user_id
                         WHEN tl.venue_id IS NOT NULL THEN 'venue:' || tl.venue_id END) AS pkey
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id
  ),
  -- ── Une ligne par venue (billet, table, inscription), avec la partie qui l'a amenée
  rows_all AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, lower(btrim(t.user_email)) AS email, t.user_id,
           COALESCE(t.paid_at, t.created_at) AS at_ts,
           greatest(COALESCE(t.quantity, 1), 1) AS heads,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount,
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.ticket_id = t.id AND pm.pkey IS NOT NULL LIMIT 1)) AS pkey
      FROM public.tickets t
      LEFT JOIN links l ON l.id = t.tracked_link_id
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', lower(btrim(r.user_email)), r.user_id,
           COALESCE(r.paid_at, r.created_at),
           greatest(COALESCE(r.guest_count, 0), 1),
           greatest(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)),
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.table_reservation_id = r.id AND pm.pkey IS NOT NULL LIMIT 1))
      FROM public.table_reservations r
      LEFT JOIN links l ON l.id = r.tracked_link_id
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'guest_list', lower(nullif(btrim(ge.email), '')), ge.user_id, ge.created_at, 1, 0::numeric,
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM promo pm WHERE pm.id = ge.promoter_id),
             (SELECT pm.pkey FROM promo pm WHERE pm.id = gl.promoter_id),
             CASE WHEN gl.organizer_user_id IS NOT NULL THEN 'org:' || gl.organizer_user_id
                  WHEN gl.venue_id IS NOT NULL THEN 'venue:' || gl.venue_id END)
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      LEFT JOIN links l ON l.id = ge.tracked_link_id
     WHERE gl.event_id = p_event_id AND ge.status <> 'cancelled'
  ),
  -- ── Les personnes (un email = une personne) ───────────────────────────────
  people AS MATERIALIZED (
    SELECT r.email,
           min(r.at_ts) AS first_at,
           (array_agg(r.user_id) FILTER (WHERE r.user_id IS NOT NULL))[1] AS user_id,
           sum(r.heads) FILTER (WHERE r.pillar <> 'guest_list') AS heads_paid,
           bool_or(r.pillar IN ('tickets', 'tables')) AS buyer,
           bool_or(r.pillar = 'guest_list') AS guest,
           COALESCE(sum(r.amount), 0) AS amount,
           (array_agg(r.pkey ORDER BY r.at_ts) FILTER (WHERE r.pkey IS NOT NULL))[1] AS pkey
      FROM rows_all r
     WHERE r.email IS NOT NULL
     GROUP BY r.email
  ),
  no_email AS (SELECT count(*) AS n FROM rows_all WHERE email IS NULL),
  scope_events AS MATERIALIZED (
    SELECT x.id, x.start_at FROM public.events x
     WHERE x.id = ANY (g.scope_ids) AND x.id <> p_event_id AND x.cancelled_at IS NULL
  ),
  -- ── Fidélité : à combien de soirées ANTÉRIEURES de la portée chacun est venu
  -- (ensembliste : on lit les soirées d'avant UNE fois, puis on les recoupe
  -- avec les personnes — jamais une recherche par personne).
  prior_ev AS MATERIALIZED (SELECT id FROM scope_events WHERE start_at < e.start_at),
  prior_rows AS MATERIALIZED (
    SELECT lower(btrim(t.user_email)) AS email, t.event_id FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM prior_ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT lower(btrim(r.user_email)), r.event_id FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM prior_ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT lower(btrim(ge.email)), gl.event_id FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM prior_ev) AND ge.status <> 'cancelled'
  ),
  prior_hits AS (
    SELECT pr.email, pr.event_id FROM prior_rows pr WHERE pr.email IN (SELECT email FROM people)
  ),
  prior_n AS (SELECT email, count(DISTINCT event_id) AS n FROM prior_hits GROUP BY email),
  -- ── Retour : venus à une soirée POSTÉRIEURE (déjà passée) de la portée ────
  later_events AS MATERIALIZED (
    SELECT id FROM scope_events WHERE start_at > v_end AND start_at < v_now
  ),
  later_rows AS MATERIALIZED (
    SELECT lower(btrim(t.user_email)) AS email FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM later_events) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT lower(btrim(r.user_email)) FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM later_events) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT lower(btrim(ge.email)) FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM later_events) AND ge.status <> 'cancelled'
  ),
  later_hits AS (
    SELECT DISTINCT lr.email FROM later_rows lr WHERE lr.email IN (SELECT email FROM people)
  ),
  -- ── Les parties de la soirée (une seule hors collab) ──────────────────────
  parties AS MATERIALIZED (
    SELECT pt.party_key, pt.kind, pt.venue_id, pt.organizer_user_id, pt.role, pt.share_crm,
           pt.display_name, pt.avatar_url, pt.ord,
           CASE WHEN pt.kind = 'venue' THEN 'venue' ELSE 'organizer' END AS subject_type,
           CASE WHEN pt.kind = 'venue' THEN pt.venue_id ELSE pt.organizer_user_id::text END AS subject_id
      FROM public.event_parties(p_event_id) pt
  ),
  -- ── Le registre de consentement de chaque partie, restreint aux personnes ─
  ns AS MATERIALIZED (
    SELECT p.party_key, lower(n.email) AS email, n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.venue_id = p.venue_id AND n.product IS NULL
     WHERE p.kind = 'venue' AND lower(n.email) IN (SELECT email FROM people)
    UNION ALL
    SELECT p.party_key, lower(n.email), n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.organizer_user_id = p.organizer_user_id AND n.product IS NULL
     WHERE p.kind = 'org' AND lower(n.email) IN (SELECT email FROM people)
  ),
  sm AS MATERIALIZED (
    SELECT p.party_key, lower(c.email) AS email, c.phone_e164, c.sms_consent_at, c.source_event_id
      FROM parties p
      JOIN public.venue_sms_contacts c ON c.venue_id = p.venue_id AND c.product IS NULL
     WHERE p.kind = 'venue' AND COALESCE(c.unsubscribed, false) = false
       AND (c.source_event_id = p_event_id OR lower(c.email) IN (SELECT email FROM people))
    UNION ALL
    SELECT p.party_key, lower(c.email), c.phone_e164, c.sms_consent_at, c.source_event_id
      FROM parties p
      JOIN public.venue_sms_contacts c ON c.organizer_user_id = p.organizer_user_id AND c.product IS NULL
     WHERE p.kind = 'org' AND COALESCE(c.unsubscribed, false) = false
       AND (c.source_event_id = p_event_id OR lower(c.email) IN (SELECT email FROM people))
  ),
  -- ── Abonnés : le journal de chaque partie, dans la fenêtre de la soirée ───
  fw AS MATERIALIZED (
    SELECT p.party_key, f.follower_user_id, f.action, f.source, f.created_at
      FROM parties p
      JOIN public.audience_follow_events f
        ON f.subject_type = p.subject_type AND f.subject_id = p.subject_id
     WHERE f.created_at >= v_win_start - interval '60 days' AND f.created_at <= v_win_end
  ),
  fw_party AS (
    SELECT p.party_key,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at >= v_win_start) AS gained,
           count(*) FILTER (WHERE f.action = 'unfollow' AND f.created_at >= v_win_start) AS lost,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at >= v_win_start AND f.source = 'event_page') AS from_event_page,
           count(DISTINCT f.follower_user_id) FILTER (
             WHERE f.action = 'follow' AND f.created_at >= v_win_start
               AND f.follower_user_id IN (SELECT user_id FROM people WHERE user_id IS NOT NULL)) AS from_attendees,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at < v_win_start) AS before_follows
      FROM parties p LEFT JOIN fw f ON f.party_key = p.party_key
     GROUP BY p.party_key
  ),
  snap AS (
    SELECT DISTINCT ON (s.subject_type, s.subject_id) s.subject_type, s.subject_id, s.followers_total
      FROM public.audience_daily_snapshots s
     WHERE (s.subject_type, s.subject_id) IN (SELECT subject_type, subject_id FROM parties)
     ORDER BY s.subject_type, s.subject_id, s.snapshot_date DESC
  ),
  -- ── Chiffres de chaque partie ─────────────────────────────────────────────
  party_rows AS (
    SELECT p.party_key, p.display_name, p.kind, p.role, p.share_crm, p.avatar_url, p.ord,
           (SELECT count(*) FROM people x WHERE x.pkey = p.party_key) AS brought,
           (SELECT count(*) FROM people x WHERE x.pkey = p.party_key
               AND NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = x.email)) AS brought_new,
           (SELECT count(DISTINCT n.email) FROM ns n WHERE n.party_key = p.party_key AND n.opted_in) AS email_total,
           (SELECT count(DISTINCT n.email) FROM ns n
             WHERE n.party_key = p.party_key AND n.opted_in AND n.created_at >= v_win_start) AS email_gained,
           (SELECT count(DISTINCT COALESCE(s.phone_e164, s.email)) FROM sm s WHERE s.party_key = p.party_key) AS sms_total,
           (SELECT count(DISTINCT COALESCE(s.phone_e164, s.email)) FROM sm s
             WHERE s.party_key = p.party_key
               AND (s.source_event_id = p_event_id OR s.sms_consent_at >= v_win_start)) AS sms_gained,
           COALESCE(fp.gained, 0) AS followers_gained, COALESCE(fp.lost, 0) AS followers_lost,
           COALESCE(fp.from_event_page, 0) AS followers_event_page, COALESCE(fp.from_attendees, 0) AS followers_attendees,
           COALESCE(fp.before_follows, 0) AS followers_before,
           (SELECT sn.followers_total FROM snap sn WHERE sn.subject_type = p.subject_type AND sn.subject_id = p.subject_id) AS followers_total
      FROM parties p LEFT JOIN fw_party fp ON fp.party_key = p.party_key
  ),
  -- ── Joignabilité des personnes, pour la partie de l'appelant ──────────────
  me_ns AS (SELECT DISTINCT email FROM ns WHERE party_key = v_me AND opted_in),
  me_sm AS (SELECT DISTINCT email FROM sm WHERE party_key = v_me AND email IS NOT NULL),
  app AS (
    SELECT DISTINCT p.email
      FROM people p
     WHERE p.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.platform = 'ios')
  ),
  acct AS (
    SELECT DISTINCT p.email
      FROM people p
     WHERE p.user_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.profiles pf WHERE lower(pf.email) = p.email)
  ),
  reach AS (
    SELECT count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns)) AS email_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_sm)) AS sms_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM app)) AS app,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM acct)) AS account,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns) OR p.email IN (SELECT email FROM me_sm)
                                OR p.email IN (SELECT email FROM app)) AS any_ok,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)) AS fresh,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)
                              AND p.email IN (SELECT email FROM me_ns)) AS fresh_email_ok,
           count(*) FILTER (WHERE p.buyer) AS buyers,
           count(*) FILTER (WHERE p.guest AND NOT p.buyer) AS guests_only,
           COALESCE(sum(p.heads_paid), 0) AS heads_paid,
           COALESCE(sum(p.amount), 0) AS amount
      FROM people p
  ),
  loyalty AS (
    SELECT count(*) FILTER (WHERE COALESCE(pn.n, 0) = 0) AS first_time,
           count(*) FILTER (WHERE pn.n = 1) AS second_time,
           count(*) FILTER (WHERE pn.n >= 2) AS regulars
      FROM people p LEFT JOIN prior_n pn ON pn.email = p.email
  ),
  retention AS (
    SELECT (SELECT count(*) FROM later_events) AS later_events,
           (SELECT count(*) FROM later_hits) AS returned
  ),
  -- ── Dans le temps (d = jours calendaires avant la soirée) ─────────────────
  tl_people AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (p.first_at AT TIME ZONE v_tz)::date AS d,
           count(*) AS people,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)) AS fresh
      FROM people p GROUP BY 1
  ),
  tl_fw AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (f.created_at AT TIME ZONE v_tz)::date AS d, count(*) AS followers
      FROM fw f
     WHERE f.party_key = v_me AND f.action = 'follow' AND f.created_at >= v_win_start
     GROUP BY 1
  ),
  tl_ns AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (n.created_at AT TIME ZONE v_tz)::date AS d, count(DISTINCT n.email) AS optins
      FROM ns n
     WHERE n.party_key = v_me AND n.opted_in AND n.created_at >= v_win_start
     GROUP BY 1
  ),
  tl_days AS (
    SELECT d FROM tl_people UNION SELECT d FROM tl_fw UNION SELECT d FROM tl_ns
  ),
  timeline AS (
    SELECT t.d, COALESCE(pp.people, 0) AS people, COALESCE(pp.fresh, 0) AS fresh,
           COALESCE(ff.followers, 0) AS followers, COALESCE(nn.optins, 0) AS optins
      FROM tl_days t
      LEFT JOIN tl_people pp ON pp.d = t.d
      LEFT JOIN tl_fw ff ON ff.d = t.d
      LEFT JOIN tl_ns nn ON nn.d = t.d
     WHERE t.d BETWEEN -3 AND 120
  ),
  -- Le même flux d'abonnés, hors soirée : la moyenne quotidienne des 60 jours avant.
  baseline AS (
    SELECT count(*) FILTER (WHERE f.action = 'follow' AND f.created_at < v_win_start)::numeric / 60.0 AS per_day
      FROM fw f WHERE f.party_key = v_me
  )
  SELECT jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'me', v_me,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', v_end, 'poster', e.poster_url,
      'cancelled', e.cancelled_at IS NOT NULL, 'phase', v_phase
    ),
    'window', jsonb_build_object('from', v_win_start, 'to', v_win_end),
    'people', (SELECT jsonb_build_object(
        'total', people, 'buyers', buyers, 'guestsOnly', guests_only, 'headsPaid', heads_paid,
        'noEmail', (SELECT n FROM no_email),
        'spend', CASE WHEN g.money AND buyers > 0 THEN round(amount, 2) END
      ) FROM reach),
    'crm', (SELECT jsonb_build_object(
        'new', fresh, 'known', people - fresh,
        'emailOk', email_ok, 'smsOk', sms_ok, 'app', app, 'account', account, 'anyReach', any_ok,
        'newEmailOk', fresh_email_ok
      ) FROM reach),
    'loyalty', (SELECT jsonb_build_object('first', first_time, 'second', second_time, 'regulars', regulars) FROM loyalty),
    'retention', (SELECT CASE WHEN later_events >= 1 AND v_phase = 'after' AND v_end < v_now - interval '14 days'
                              THEN jsonb_build_object('laterEvents', later_events, 'returned', returned) END
                    FROM retention),
    'parties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'party', party_key, 'name', display_name, 'kind', kind, 'role', role, 'shareCrm', share_crm,
        'avatar', avatar_url, 'mine', party_key = v_me,
        'brought', brought, 'broughtNew', brought_new,
        'emailTotal', email_total, 'emailGained', email_gained,
        'smsTotal', sms_total, 'smsGained', sms_gained,
        'followersGained', followers_gained, 'followersLost', followers_lost,
        'followersEventPage', followers_event_page, 'followersAttendees', followers_attendees,
        'followersTotal', followers_total
      ) ORDER BY ord, party_key) FROM party_rows), '[]'::jsonb),
    'followers', (SELECT jsonb_build_object(
        'gained', followers_gained, 'lost', followers_lost, 'eventPage', followers_event_page,
        'attendees', followers_attendees, 'total', followers_total,
        'baselinePerDay', round((SELECT per_day FROM baseline), 2)
      ) FROM party_rows WHERE party_key = v_me),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', d, 'people', people, 'fresh', fresh, 'followers', followers, 'optins', optins) ORDER BY d DESC) FROM timeline), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_community_takeaways(v_result, greatest(1, round(extract(epoch FROM (v_win_end - v_win_start)) / 86400.0))));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_marketing_hosts(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT (p_event_id = ANY (public.demo_event_ids())) AS ev_demo),
  me AS MATERIALIZED (
    SELECT u.id AS uid, lower(u.email) AS email
      FROM auth.users u
     WHERE u.id = auth.uid()
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', p.party_key, 'kind', p.kind, 'venue_id', p.venue_id,
           'organizer_user_id', p.organizer_user_id, 'name', p.display_name, 'role', p.role,
           'email_opted_in', COALESCE((
             SELECT ns.opted_in AND ns.updated_at > now() - interval '36 months'
               FROM public.newsletter_subscriptions ns, me
              WHERE ns.product IS NULL
                AND (ns.user_id = me.uid OR lower(ns.email) = me.email)
                AND ((p.kind = 'venue' AND ns.venue_id = p.venue_id)
                     OR (p.kind = 'org' AND ns.organizer_user_id = p.organizer_user_id))
              ORDER BY ns.updated_at DESC
              LIMIT 1
           ), false)
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    FROM public.event_parties(p_event_id) p, d
   WHERE p.share_crm AND COALESCE(btrim(p.display_name), '') <> ''
     -- Soirée réelle : aucun client réel ne s'abonne à un compte démo.
     AND (d.ev_demo OR NOT public.coorg_party_is_demo(p.kind, p.venue_id, p.organizer_user_id));
$function$;

CREATE OR REPLACE FUNCTION public.get_my_marketing_consent(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(email_opted_in boolean, sms_opted_in boolean, email_since timestamp with time zone, sms_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_stale timestamptz := now() - interval '36 months';
BEGIN
  IF v_uid IS NULL OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RETURN QUERY SELECT false, false, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT ns.opted_in AND ns.updated_at > v_stale
      FROM public.newsletter_subscriptions ns
      WHERE ns.product IS NULL
        AND (ns.user_id = v_uid OR lower(ns.email) = v_email)
        AND (
          (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
        )
      ORDER BY ns.updated_at DESC
      LIMIT 1
    ), false),
    COALESCE((
      SELECT NOT sc.unsubscribed AND sc.sms_consent_at > v_stale
      FROM public.venue_sms_contacts sc
      WHERE sc.product IS NULL AND (
          (p_venue_id IS NOT NULL AND sc.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND sc.organizer_user_id = p_organizer_user_id)
        )
        AND (sc.user_id = v_uid
             OR (v_phone IS NOT NULL
                 AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    ), false),
    (
      SELECT ns.created_at
      FROM public.newsletter_subscriptions ns
      WHERE ns.product IS NULL
        AND (ns.user_id = v_uid OR lower(ns.email) = v_email)
        AND (
          (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
        )
      ORDER BY ns.updated_at DESC
      LIMIT 1
    ),
    (
      SELECT sc.sms_consent_at
      FROM public.venue_sms_contacts sc
      WHERE sc.product IS NULL AND (
          (p_venue_id IS NOT NULL AND sc.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND sc.organizer_user_id = p_organizer_user_id)
        )
        AND (sc.user_id = v_uid
             OR (v_phone IS NOT NULL
                 AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_recipient_block_conds(p_campaign_id uuid, p_emails text[])
 RETURNS TABLE(email text, cond text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  v_crm boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'get_recipient_block_conds: service_role only';
  END IF;

  SELECT venue_id, organizer_user_id INTO c
    FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN; END IF;
  v_crm := COALESCE(public.crm_campaign_is_crm(p_campaign_id), false);

  RETURN QUERY
  WITH addrs AS (
    SELECT DISTINCT lower(e2.addr) AS addr FROM unnest(p_emails) AS e2(addr)
  ), has_table AS (
    -- vip_table : a déjà réservé une table chez ce sender
    SELECT a.addr
      FROM addrs a
     WHERE NOT v_crm AND EXISTS (
       SELECT 1 FROM public.table_reservations tr
         JOIN public.events ev ON ev.id = tr.event_id
        WHERE lower(tr.user_email) = a.addr
          AND tr.status IN ('paid', 'confirmed')
          AND ((c.venue_id IS NOT NULL AND (ev.venue_id = c.venue_id OR ev.partner_venue_id = c.venue_id OR ev.id in (select public.cohost_event_ids_venue(c.venue_id))))
            OR (c.organizer_user_id IS NOT NULL AND (ev.organizer_user_id = c.organizer_user_id OR ev.partner_organizer_id = c.organizer_user_id OR ev.id in (select public.cohost_event_ids_org(c.organizer_user_id))))))
  ), has_ticket AS (
    -- buyers : a déjà acheté un billet chez ce sender
    SELECT a.addr
      FROM addrs a
     WHERE (v_crm AND EXISTS (SELECT 1 FROM public.external_tickets xt
                WHERE lower(xt.buyer_email) = a.addr AND xt.status IN ('valid', 'transferred')
                  AND ((c.venue_id IS NOT NULL AND xt.venue_id = c.venue_id)
                    OR (c.organizer_user_id IS NOT NULL AND xt.organizer_user_id = c.organizer_user_id))))
        OR (NOT v_crm AND EXISTS (
       SELECT 1 FROM public.tickets t
         JOIN public.events ev ON ev.id = t.event_id
        WHERE lower(t.user_email) = a.addr
          AND t.status = 'paid'
          AND ((c.venue_id IS NOT NULL AND (ev.venue_id = c.venue_id OR ev.partner_venue_id = c.venue_id OR ev.id in (select public.cohost_event_ids_venue(c.venue_id))))
            OR (c.organizer_user_id IS NOT NULL AND (ev.organizer_user_id = c.organizer_user_id OR ev.partner_organizer_id = c.organizer_user_id OR ev.id in (select public.cohost_event_ids_org(c.organizer_user_id)))))))
  )
  SELECT h.addr::text, 'vip_table'::text FROM has_table h
  UNION ALL
  -- no_vip_table : le COMPLÉMENT exact sur le même lot — « le bloc Table VIP
  -- pour ceux qui en ont pris une, le bloc Liste invités pour les autres ».
  SELECT a.addr::text, 'no_vip_table'::text FROM addrs a
   WHERE NOT EXISTS (SELECT 1 FROM has_table h WHERE h.addr = a.addr)
  UNION ALL
  SELECT h.addr::text, 'buyers'::text FROM has_ticket h
  UNION ALL
  SELECT a.addr::text, 'no_buyers'::text FROM addrs a
   WHERE NOT EXISTS (SELECT 1 FROM has_ticket h WHERE h.addr = a.addr)
  UNION ALL
  -- new_subscribers : abonné newsletter depuis moins de 30 jours
  SELECT a.addr::text, 'new_subscribers'::text
    FROM addrs a
   WHERE EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = a.addr
        AND ns.created_at > now() - interval '30 days'
        AND ns.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
        AND ((c.venue_id IS NOT NULL AND ns.venue_id = c.venue_id)
          OR (c.organizer_user_id IS NOT NULL AND ns.organizer_user_id = c.organizer_user_id)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_crm_send_frozen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text;
  v_org uuid;
BEGIN
  IF NEW.status NOT IN ('sending', 'scheduled') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'sms_campaigns' THEN
    v_org := NEW.organizer_id;
  ELSE
    v_org := NEW.organizer_user_id;
  END IF;
  v_scope := public.crm_scope_key(NEW.venue_id, v_org);
  -- Le gel est un geste de l'Admin CRM : il ne vaut que pour les envois du CRM.
  -- La Billetterie d'un compte à deux produits n'est pas gelée (décision 20/10 : deux outils séparés).
  IF TG_TABLE_NAME = 'sms_campaigns' THEN
    IF NEW.product IS DISTINCT FROM 'crm' THEN RETURN NEW; END IF;
  ELSIF NOT public._crm_campaign_row_is_crm(NEW.id, NEW.venue_id, NEW.organizer_user_id, NEW.product, NEW.audiences_json, NEW.parent_campaign_id) THEN
    RETURN NEW;
  END IF;
  IF v_scope IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.crm_settings s WHERE s.scope_key = v_scope AND s.sending_frozen_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- Deux IF imbriqués : NEW.automation_id n'existe pas sur sms_campaigns (« record new has no field » si le
  -- planificateur évalue le 2e terme d'un AND avant le 1er) — mesuré au banc : sans ça le gel d'un SMS CRM
  -- levait cette erreur au lieu de crm_send_frozen, que send-sms-campaign sait traduire.
  IF TG_TABLE_NAME = 'email_campaigns' THEN
    IF NEW.automation_id IS NOT NULL THEN
      NEW.status := 'paused';
      NEW.paused_reason := 'frozen';
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'crm_send_frozen' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_recipe_vs_scenario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.enabled AND NEW.product = 'crm' AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.enabled, false))
     AND (NEW.venue_id IS NOT NULL OR NEW.organizer_user_id IS NOT NULL)
     AND (NEW.product = 'crm' OR public.crm_scope_is_crm(public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id)))
     AND EXISTS (
       SELECT 1 FROM public.crm_scenarios s
        WHERE s.source_kind = NEW.kind AND s.status IN ('active', 'paused')
          AND s.venue_id IS NOT DISTINCT FROM NEW.venue_id
          AND s.organizer_user_id IS NOT DISTINCT FROM NEW.organizer_user_id) THEN
    RAISE EXCEPTION 'scenario_covers_recipe' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handoff_showcase_organizer(p_shadow_user_id uuid, p_new_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_shadow boolean;
  v_merge boolean;
  v_shadow_profile public.organizer_profiles%ROWTYPE;
  v_aliases text[];
  v_pair text[];
  v_pairs constant text[][] := ARRAY[
    -- Cœur : le contenu construit par l'admin.
    ARRAY['events', 'organizer_user_id'],
    ARRAY['events', 'partner_organizer_id'],
    ARRAY['events', 'tables_owner_user_id'],
    ARRAY['guest_lists', 'organizer_user_id'],
    ARRAY['guest_list_templates', 'organizer_user_id'],
    ARRAY['ticket_presets', 'organizer_user_id'],
    ARRAY['table_zones', 'created_by_user_id'],
    ARRAY['table_packs', 'created_by_user_id'],
    ARRAY['venue_floor_plans', 'owner_user_id'],
    ARRAY['owner_recurring_templates', 'organizer_user_id'],
    ARRAY['owner_recurring_templates', 'partner_organizer_id'],
    ARRAY['organizer_onboarding', 'user_id'],
    -- Équipe, staff, invitations.
    ARRAY['org_members', 'organizer_user_id'],
    ARRAY['org_staff', 'organizer_user_id'],
    ARRAY['staff_invitations', 'organizer_user_id'],
    ARRAY['onboarding_links', 'organizer_user_id'],
    -- CRM, notifications, audience.
    ARRAY['organizer_notifications', 'organizer_user_id'],
    ARRAY['organizer_profile_followers', 'organizer_user_id'],
    ARRAY['organizer_banned_emails', 'organizer_user_id'],
    ARRAY['organizer_customer_incidents', 'organizer_user_id'],
    ARRAY['organizer_customer_notes', 'organizer_user_id'],
    ARRAY['customer_activity_log', 'organizer_user_id'],
    ARRAY['email_campaigns', 'organizer_user_id'],
    ARRAY['newsletter_subscriptions', 'organizer_user_id'],
    ARRAY['marketing_consent_events', 'organizer_user_id'],
    ARRAY['sms_credit_balances', 'organizer_id'],
    ARRAY['sms_credit_transactions', 'organizer_id'],
    ARRAY['sms_logs', 'organizer_id'],
    ARRAY['sms_campaigns', 'organizer_id'],
    -- Tracking & analytics bruts.
    ARRAY['tracked_links', 'organizer_user_id'],
    ARRAY['attribution_touchpoints', 'organizer_user_id'],
    ARRAY['visitor_events', 'organizer_user_id'],
    ARRAY['visitor_sessions', 'organizer_user_id'],
    ARRAY['live_visitor_pings', 'organizer_user_id'],
    -- Facturation.
    ARRAY['invoices', 'organizer_user_id'],
    ARRAY['invoice_numbers', 'organizer_user_id'],
    -- Promoteurs.
    ARRAY['promoters', 'organizer_user_id'],
    ARRAY['promoter_teams', 'organizer_user_id'],
    ARRAY['promoter_announcements', 'organizer_user_id'],
    ARRAY['promoter_payouts', 'organizer_user_id'],
    ARRAY['promoter_invitations', 'organizer_user_id'],
    ARRAY['commission_templates', 'organizer_user_id'],
    -- DJ.
    ARRAY['djs', 'organizer_user_id'],
    ARRAY['dj_sets', 'organizer_user_id'],
    ARRAY['dj_invitations', 'organizer_user_id'],
    ARRAY['dj_booking_requests', 'organizer_user_id'],
    ARRAY['dj_residencies', 'organizer_user_id'],
    ARRAY['dj_booking_contracts', 'organizer_user_id'],
    -- Collab & partenariats.
    ARRAY['event_collab_contracts', 'organizer_user_id'],
    ARRAY['event_collab_series_contracts', 'organizer_user_id'],
    ARRAY['event_collab_amendments', 'organizer_user_id'],
    ARRAY['event_collab_action_requests', 'organizer_user_id'],
    ARRAY['collab_table_settlements', 'organizer_user_id'],
    ARRAY['venue_organizer_partnerships', 'organizer_user_id'],
    ARRAY['venue_claim_invitations', 'organizer_user_id'],
    -- Agence.
    ARRAY['agency_venue_contracts', 'organizer_user_id'],
    ARRAY['agency_conversions', 'organizer_user_id'],
    ARRAY['agency_payouts', 'organizer_user_id']
  ];
BEGIN
  IF p_shadow_user_id IS NULL OR p_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'handoff_bad_args';
  END IF;
  IF p_shadow_user_id = p_new_owner_id THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT op.is_showcase_shadow INTO v_is_shadow
    FROM public.organizer_profiles op
   WHERE op.user_id = p_shadow_user_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_is_shadow THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT * INTO v_shadow_profile FROM public.organizer_profiles WHERE user_id = p_shadow_user_id;
  v_merge := EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = p_new_owner_id);

  IF NOT v_merge THEN
    -- ── Mode ADOPTION : le profil vitrine change de porteur ──────────────────
    -- Alias détachés (FK sans ON UPDATE CASCADE) puis re-posés.
    SELECT array_agg(slug) INTO v_aliases
      FROM public.organizer_slug_aliases WHERE user_id = p_shadow_user_id;
    DELETE FROM public.organizer_slug_aliases WHERE user_id = p_shadow_user_id;

    -- is_showcase_shadow reste TRUE jusqu'à la fin : pendant le re-parentage
    -- des events, zz_showcase_hide_event les maintient non-découvrables (le
    -- profil est privé — pas de cartes Explore vers des pages introuvables).
    UPDATE public.organizer_profiles
       SET user_id = p_new_owner_id
     WHERE user_id = p_shadow_user_id;

    IF v_aliases IS NOT NULL THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
      SELECT unnest(v_aliases), p_new_owner_id
      ON CONFLICT (slug) DO NOTHING;
    END IF;
  ELSE
    -- ── Mode FUSION : le contenu rejoint le profil orga existant ─────────────
    -- Dédoublonnage des tables à contrainte UNIQUE par organisateur (no-ops en
    -- pratique — une vitrine n'a ni ventes ni SMS) AVANT le re-parentage.
    DELETE FROM public.organizer_profile_followers f
     WHERE f.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.organizer_profile_followers x
                    WHERE x.organizer_user_id = p_new_owner_id AND x.user_id = f.user_id);
    DELETE FROM public.org_staff s
     WHERE s.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.org_staff x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND lower(x.email) = lower(s.email) AND x.role = s.role);
    DELETE FROM public.organizer_banned_emails b
     WHERE b.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.organizer_banned_emails x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND lower(x.email) = lower(b.email));
    DELETE FROM public.newsletter_subscriptions n
     WHERE n.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND x.product IS NOT DISTINCT FROM n.product
                      AND lower(x.email) = lower(n.email));
    DELETE FROM public.venue_organizer_partnerships vp
     WHERE vp.organizer_user_id = p_shadow_user_id
       AND vp.status IN ('pending', 'active')
       AND EXISTS (SELECT 1 FROM public.venue_organizer_partnerships x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND x.venue_id = vp.venue_id AND x.status IN ('pending', 'active'));
    -- L'état du prospect prime (lignes uniques par user) :
    DELETE FROM public.organizer_onboarding o
     WHERE o.user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.organizer_onboarding x WHERE x.user_id = p_new_owner_id);
    DELETE FROM public.sms_credit_balances s
     WHERE s.organizer_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.sms_credit_balances x WHERE x.organizer_id = p_new_owner_id);
    DELETE FROM public.audience_daily_snapshots a
     WHERE a.subject_type = 'organizer' AND a.subject_id = p_shadow_user_id::text
       AND EXISTS (SELECT 1 FROM public.audience_daily_snapshots x
                    WHERE x.subject_type = 'organizer'
                      AND x.subject_id = p_new_owner_id::text
                      AND x.snapshot_date = a.snapshot_date);

    -- Les alias du fantôme passent au prospect (sa row organizer_profiles
    -- existe, la FK est satisfaite).
    UPDATE public.organizer_slug_aliases
       SET user_id = p_new_owner_id
     WHERE user_id = p_shadow_user_id;
  END IF;

  -- Re-parentage de toutes les données keyées sur le fantôme (commun).
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', v_pair[1], v_pair[2], v_pair[2])
      USING p_new_owner_id, p_shadow_user_id;
  END LOOP;

  -- Journal d'audience (subject_id est un text).
  UPDATE public.audience_follow_events
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;
  UPDATE public.audience_daily_snapshots
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;
  UPDATE public.audience_recap_log
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;

  IF v_merge THEN
    -- Le profil fantôme disparaît (libère son slug), qui devient un alias du
    -- prospect — les liens d'aperçu partagés continuent de résoudre.
    DELETE FROM public.organizer_profiles WHERE user_id = p_shadow_user_id;
    IF COALESCE(v_shadow_profile.slug, '') <> '' THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
      VALUES (v_shadow_profile.slug, p_new_owner_id)
      ON CONFLICT (slug) DO NOTHING;
    END IF;

    -- Le profil existant ADOPTE la présentation vitrine. Le trigger de slug
    -- regénère depuis le nouveau display_name : le slug vitrine exact est
    -- libre (profil supprimé, alias au prospect → exclus de la
    -- désambiguïsation) et l'ancien slug du prospect est archivé en alias.
    -- Le cooldown de renommage laisse passer (auth.uid() NULL en service role).
    UPDATE public.organizer_profiles
       SET display_name = v_shadow_profile.display_name,
           bio = COALESCE(v_shadow_profile.bio, bio),
           avatar_url = COALESCE(v_shadow_profile.avatar_url, avatar_url),
           cover_url = COALESCE(v_shadow_profile.cover_url, cover_url),
           city = COALESCE(v_shadow_profile.city, city),
           instagram_url = COALESCE(v_shadow_profile.instagram_url, instagram_url),
           website_url = COALESCE(v_shadow_profile.website_url, website_url)
     WHERE user_id = p_new_owner_id;
  END IF;

  -- Le fantôme redevient un compte inerte : plus organisateur, plus de rôle.
  -- (Neutraliser profile_type d'abord, sinon le trigger de synchro recréerait
  -- le rôle.)
  UPDATE public.profiles
     SET profile_type = 'club', organization_name = NULL
   WHERE id = p_shadow_user_id;
  DELETE FROM public.user_roles
   WHERE user_id = p_shadow_user_id AND role = 'organizer';

  -- Les liens preview de la vitrine meurent avec la réclamation.
  UPDATE public.demo_preview_links
     SET is_active = false, revoked_at = now()
   WHERE organizer_user_id = p_shadow_user_id AND revoked_at IS NULL;

  UPDATE public.showcase_claim_requests
     SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE organizer_user_id = p_shadow_user_id AND status = 'pending';

  IF NOT v_merge THEN
    -- Fin de vitrine (adoption) : le marqueur tombe. Les events restent
    -- volontairement non-découvrables tant que le profil est privé — la
    -- publication du profil relance leur évaluation (20260826115000).
    UPDATE public.organizer_profiles
       SET is_showcase_shadow = false
     WHERE user_id = p_new_owner_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'shadow_user_id', p_shadow_user_id, 'merged', v_merge);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meta_lead_to_contact(p_leadgen_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l public.meta_leads%ROWTYPE;
  v_venue text; v_org uuid;
  v_email text; v_first text; v_last text;
  v_sub uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'meta_lead_to_contact: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.meta_leads WHERE leadgen_id = p_leadgen_id;
  IF NOT FOUND OR l.connection_id IS NULL THEN RETURN NULL; END IF;
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org FROM public.meta_connections mc WHERE mc.id = l.connection_id;
  v_email := lower(btrim(l.contact_email));
  IF v_email IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RETURN NULL; END IF;
  IF public.is_email_suppressed(v_email) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.email_opt_outs eo WHERE lower(eo.email) = v_email
               AND eo.venue_id IS NOT DISTINCT FROM v_venue AND eo.organizer_user_id IS NOT DISTINCT FROM v_org
               AND eo.product IS NULL) THEN
    RETURN NULL;
  END IF;
  v_first := NULLIF(split_part(COALESCE(l.contact_name, ''), ' ', 1), '');
  v_last  := NULLIF(regexp_replace(COALESCE(l.contact_name, ''), '^\S+\s*', ''), '');

  SELECT ns.id INTO v_sub FROM public.newsletter_subscriptions ns
   WHERE lower(ns.email) = v_email
     AND ns.venue_id IS NOT DISTINCT FROM v_venue AND ns.organizer_user_id IS NOT DISTINCT FROM v_org
     AND ns.product IS NULL
   LIMIT 1;
  IF v_sub IS NULL THEN
    -- Un « stop » donné dans l'autre outil du pro vaut ici aussi : jamais d'accord neuf par-dessus.
    IF public._newsletter_explicit_stop(v_venue, v_org, v_email) THEN RETURN NULL; END IF;
    INSERT INTO public.newsletter_subscriptions
      (venue_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name, product)
    VALUES (v_venue, v_org, v_email, true, 'meta_lead_ads', 'social', COALESCE(l.received_at, now()), v_first, v_last, NULL)
    RETURNING id INTO v_sub;
  ELSE
    -- Déjà présent : on complète le nom, on ne réabonne JAMAIS un désabonné.
    UPDATE public.newsletter_subscriptions
       SET first_name = COALESCE(first_name, v_first), last_name = COALESCE(last_name, v_last), updated_at = now()
     WHERE id = v_sub;
  END IF;

  IF l.contact_phone IS NOT NULL AND l.contact_phone ~ '^\+[0-9]{8,15}$' THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.venue_sms_contacts v WHERE v.phone_e164 = l.contact_phone
                       AND v.venue_id IS NOT DISTINCT FROM v_venue AND v.organizer_user_id IS NOT DISTINCT FROM v_org
                       AND v.product IS NULL) THEN
        INSERT INTO public.venue_sms_contacts (venue_id, organizer_user_id, phone_e164, full_name, email, sms_consent_at, consent_source)
        VALUES (v_venue, v_org, l.contact_phone, l.contact_name, v_email, COALESCE(l.received_at, now()), 'meta_lead_ads');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- le SMS est un bonus : un refus (contrainte, STOP) ne perd pas l'email
    END;
  END IF;

  UPDATE public.meta_leads SET processed_at = now(), error = NULL WHERE leadgen_id = p_leadgen_id;
  RETURN v_sub;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_unsubscribe(p_token uuid)
 RETURNS TABLE(email text, scope_name text, already_unsubscribed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ns.email,
         COALESCE(CASE WHEN ns.product = 'crm' THEN public.crm_space_display_name(ns.venue_id, ns.organizer_user_id) END,
                  v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text AS scope_name,
         NOT ns.opted_in AS already_unsubscribed
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.purge_email_list(p_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  imp public.email_list_imports;
  v_unsub integer := 0;
  v_dead integer := 0;
  v_remaining integer := 0;
BEGIN
  imp := public._email_list_import_for_actor(p_import_id);
  -- Détruire des contacts appartient au pro seul, jamais au support.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Purge indisponible en session support';
  END IF;

  CREATE TEMP TABLE _dead ON COMMIT DROP AS
    SELECT s.id, lower(s.email) AS email, s.opted_out_at,
           CASE WHEN public.is_email_suppressed(s.email) THEN 'suppressed' ELSE 'unsubscribed' END AS reason
      FROM public.newsletter_subscriptions s
     WHERE s.import_id = p_import_id
       AND (NOT s.opted_in OR s.opted_out_at IS NOT NULL OR public.is_email_suppressed(s.email));

  SELECT count(*) FILTER (WHERE reason = 'unsubscribed'),
         count(*) FILTER (WHERE reason = 'suppressed')
    INTO v_unsub, v_dead FROM _dead;

  -- 1. Le repoussoir d'abord : si l'insertion échoue, rien n'est détruit.
  INSERT INTO public.email_opt_outs (venue_id, organizer_user_id, email, reason, import_id, opted_out_at, purged_by, product)
  SELECT imp.venue_id, imp.organizer_user_id, d.email, d.reason, p_import_id, d.opted_out_at, auth.uid(), pr.p
    FROM _dead d
    CROSS JOIN (VALUES (NULL::text), ('crm'::text)) pr(p)
   WHERE pr.p IS NOT DISTINCT FROM imp.product
      OR (public.crm_scope_has_crm(public.crm_scope_key(imp.venue_id, imp.organizer_user_id))
          AND NOT public.crm_scope_is_crm(public.crm_scope_key(imp.venue_id, imp.organizer_user_id)))
  ON CONFLICT DO NOTHING;

  -- 2. Les abonnements morts.
  DELETE FROM public.newsletter_subscriptions s WHERE s.id IN (SELECT id FROM _dead);

  -- 3. La matière (imported_contacts) : l'email disparaît, la ligne ne reste
  --    que si elle porte encore un téléphone.
  UPDATE public.imported_contacts c
     SET email = NULL
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, imp.venue_id, imp.organizer_user_id)
     AND c.product IS NOT DISTINCT FROM imp.product
     AND c.email IS NOT NULL
     AND lower(c.email) IN (SELECT email FROM _dead);
  DELETE FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, imp.venue_id, imp.organizer_user_id)
     AND c.product IS NOT DISTINCT FROM imp.product
     AND c.email IS NULL AND c.phone_e164 IS NULL;

  SELECT count(*) INTO v_remaining
    FROM public.newsletter_subscriptions s WHERE s.import_id = p_import_id;

  DROP TABLE IF EXISTS _dead;

  RETURN jsonb_build_object(
    'removed', v_unsub + v_dead,
    'unsubscribed', v_unsub,
    'dead', v_dead,
    'remaining', v_remaining
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_campaign_list_baseline(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; v_snap jsonb;
BEGIN
  SELECT id, venue_id, organizer_user_id INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- E-1 : la photo « avant / après » de la base est un écran de la Billetterie (CampaignImpactCard) ; une campagne du CRM n'y entre pas.
  IF public.crm_campaign_is_crm(p_campaign_id) THEN RETURN false; END IF;
  IF NOT public.contact_scope_allowed_or_internal(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_campaign_list_impact i WHERE i.campaign_id = p_campaign_id AND i.baseline IS NOT NULL) THEN
    RETURN false;
  END IF;
  v_snap := public.contact_base_snapshot(c.venue_id, c.organizer_user_id);
  INSERT INTO public.email_campaign_list_impact (campaign_id, venue_id, organizer_user_id, baseline, baseline_at)
  VALUES (p_campaign_id, c.venue_id, c.organizer_user_id, v_snap, now())
  ON CONFLICT (campaign_id) DO UPDATE SET baseline = EXCLUDED.baseline, baseline_at = EXCLUDED.baseline_at
   WHERE public.email_campaign_list_impact.baseline IS NULL;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_campaign_list_impacts(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap jsonb;
  v_n integer := 0;
  v_c record;
  v_now jsonb;
  v_rec_status jsonb;
  v_new_engaged integer;
  v_reactivated integer;
  v_engaged integer;
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
BEGIN
  IF NOT public.contact_scope_allowed_or_internal(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_campaigns ec
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ec.status = 'sent' AND ec.sent_at > now() - interval '30 days'
       AND NOT public.crm_campaign_is_crm(ec.id)) THEN
    RETURN 0;
  END IF;

  v_snap := public.contact_base_snapshot(p_venue_id, p_organizer_user_id);

  FOR v_c IN
    SELECT ec.id, ec.sent_at, COALESCE(ec.send_started_at, ec.sent_at) AS started_at
      FROM public.email_campaigns ec
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ec.status = 'sent' AND ec.sent_at > now() - interval '30 days'
       AND NOT public.crm_campaign_is_crm(ec.id)
  LOOP
    SELECT jsonb_build_object(
             'active', count(*) FILTER (WHERE ce.status = 'active'),
             'passive', count(*) FILTER (WHERE ce.status = 'passive'),
             'silent', count(*) FILTER (WHERE ce.status = 'silent'),
             'new', count(*) FILTER (WHERE ce.status = 'new'),
             'unreachable', count(*) FILTER (WHERE ce.status = 'unreachable'),
             'unsubscribed', count(*) FILTER (WHERE ce.status = 'unsubscribed'),
             'total', count(*))
      INTO v_rec_status
      FROM public.email_campaign_recipients r
      LEFT JOIN public.contact_engagement ce ON ce.email = lower(r.email) AND ce.scope_key = v_key
     WHERE r.campaign_id = v_c.id AND r.status IN ('sent', 'bounced', 'complained');

    SELECT count(*),
           count(*) FILTER (WHERE p.em IS NULL),
           count(*) FILTER (WHERE p.em IS NOT NULL AND p.last_prior < v_c.started_at - interval '180 days')
      INTO v_engaged, v_new_engaged, v_reactivated
      FROM (
        SELECT DISTINCT lower(e.recipient_email) AS em
          FROM public.email_campaign_events e
         WHERE e.campaign_id = v_c.id AND e.event_type IN ('opened', 'clicked')
           AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                        WHERE r.campaign_id = v_c.id AND lower(r.email) = lower(e.recipient_email))
      ) g
      LEFT JOIN (
        SELECT lower(e.recipient_email) AS em, max(e.created_at) AS last_prior
          FROM public.email_campaign_events e
          JOIN public.email_campaigns c2 ON c2.id = e.campaign_id
         WHERE public.marketing_scope_match(c2.venue_id, c2.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND c2.id <> v_c.id AND NOT public.crm_campaign_is_crm(c2.id) AND e.event_type IN ('opened', 'clicked')
           AND e.created_at < v_c.started_at
         GROUP BY lower(e.recipient_email)
      ) p ON p.em = g.em;

    v_now := v_snap || jsonb_build_object(
      'recipients', v_rec_status,
      'engaged', COALESCE(v_engaged, 0),
      'newly_engaged', COALESCE(v_new_engaged, 0),
      'reactivated', COALESCE(v_reactivated, 0));

    INSERT INTO public.email_campaign_list_impact (campaign_id, venue_id, organizer_user_id, current, computed_at)
    VALUES (v_c.id, p_venue_id, p_organizer_user_id, v_now, now())
    ON CONFLICT (campaign_id) DO UPDATE SET current = EXCLUDED.current, computed_at = EXCLUDED.computed_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
  -- Mode de combinaison des audiences cochées : 'any' (réunir, défaut) ou
  -- 'all' (croiser : le contact doit être dans CHAQUE audience cochée).
  v_match_all boolean := false;
  v_aud_n integer := 0;
  -- Séparation CRM / Billetterie : produit de la CAMPAGNE (NULL = Billetterie, 'crm' = CRM).
  v_prod text;
  v_same uuid[];
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;
  v_prod := CASE WHEN public.crm_campaign_is_crm(p_campaign_id) THEN 'crm' END;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := COALESCE((v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin(), false);
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  -- E-mail pratique (Yuno CRM) : l'équipe de l'espace le compose aussi.
  IF v_campaign.practical AND NOT v_is_authorized THEN
    v_is_authorized := public.crm_scope_allowed(v_campaign.venue_id, v_campaign.organizer_user_id);
  END IF;
  IF NOT COALESCE(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── E-mail pratique (Yuno CRM, 20261019150000) ───────────────────────────
  -- Les détenteurs d'un billet valide de la soirée, seuls, sans accord
  -- marketing : l'information d'un achat, jamais une audience combinable.
  IF v_campaign.practical THEN
    RETURN QUERY SELECT * FROM public._crm_practical_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Console Yuno CRM ─────────────────────────────────────────────────────
  -- Audiences {kind:'crm', segmentId?, def} : la base clients du CRM, filtrée
  -- par la même définition que l'écran Clients (_crm_filter_sql), et toujours
  -- passée par le registre de consentement de la portée (_crm_campaign_audience).
  IF jsonb_typeof(v_campaign.audiences_json) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.audiences_json) x WHERE x->>'kind' = 'crm') THEN
    RETURN QUERY SELECT * FROM public._crm_campaign_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Portée plateforme ────────────────────────────────────────────────────
  -- Yuno écrit à SA base, jamais à celle d'un club. Une seule source : le
  -- registre plateforme (`newsletter_subscriptions` avec les deux colonnes de
  -- portée à NULL), alimenté par `sync_platform_marketing_contacts` et par les
  -- imports attestés. C'est lui qui porte le jeton de désinscription : aucune
  -- adresse ne peut entrer dans une campagne sans porte de sortie.
  IF v_campaign.venue_id IS NULL AND v_campaign.organizer_user_id IS NULL THEN
    v_audiences := COALESCE(v_campaign.audiences_json, '[]'::jsonb);
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    IF jsonb_typeof(v_audiences) <> 'array' OR jsonb_array_length(v_audiences) = 0 THEN
      RETURN;                       -- audience vide ⇒ personne, jamais « tout le monde »
    END IF;

    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    RETURN QUERY
    WITH cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a
          WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.venue_id IS NULL AND c2.organizer_user_id IS NULL
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    -- Les acheteurs d'une soirée ne sont joignables en informatif QUE par ses
    -- parties PRINCIPALES : un co-hôte n'a que les contacts qui l'ont nommé
    -- (case du checkout), jamais toute la liste des acheteurs.
    IF NOT public.campaign_scope_is_event_principal(v_campaign.venue_id, v_campaign.organizer_user_id, v_campaign.event_id) THEN
      RETURN;
    END IF;
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    -- « Reçu un e-mail depuis N jours » ne compte que les campagnes du MÊME produit.
    v_same := CASE WHEN v_excl_recent_days IS NULL THEN NULL
                   ELSE public._email_scope_campaign_ids(v_campaign.venue_id, v_campaign.organizer_user_id, v_prod IS NOT NULL) END;
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr, vs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), cseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
      ), vseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM seg_emails GROUP BY addr
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(ch.n, 0)::integer AS seg_hits, COALESCE(vh.n, 0)::integer AS vseg_hits,
               COALESCE(p.first_name, vc.first_name, ns.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name, ns.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               ns.import_id AS imp,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
          LEFT JOIN vseg_hits vh ON vh.addr = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
           AND ns.product IS NOT DISTINCT FROM v_prod
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE (
           SELECT count(*) FROM jsonb_array_elements(v_audiences) a
            WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN false  -- compté via vseg_hits
              WHEN 'contact_segment' THEN false  -- compté via seg_hits
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id AND c2.id = ANY (v_same)
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      -- Un client est quelqu'un qui est VENU : billets, tables ET guest list
      -- (contact_scope_customers, la même source que la base de contacts).
      -- Avant, seuls les billets comptaient : un organisateur qui ne vend que
      -- des tables n'avait ni VIP, ni habitué, ni dormant.
      SELECT c.email AS addr,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name AS fname0,
             c.last_name AS lname0
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name, a.fname0) AS fname,
             COALESCE(p.last_name, ns.last_name, a.lname0) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
         AND ns.product IS NOT DISTINCT FROM v_prod
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a2
          WHERE a2->>'kind' NOT IN ('contact_segment','segment') AND CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id AND c2.id = ANY (v_same)
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR (
             NOT EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                            AND LOWER(t.user_email) = m.addr)
             AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                          WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                            AND LOWER(tr.user_email) = m.addr)));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ns.product IS NOT DISTINCT FROM v_prod
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT c.email,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name, c.last_name
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    )
    SELECT a.email::text,
           a.first_name::text,
           a.last_name::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true AND ns.product IS NOT DISTINCT FROM v_prod
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sale_attribution(p_kind text, p_id uuid, p_event_id uuid, p_email text, p_at timestamp with time zone, p_tracked_link_id uuid, p_promo_code_id uuid, p_purchase_source text, p_promoter_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(source text, ref text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src text; v_ref text; v_pid uuid; v_camp uuid;
BEGIN
  -- 1. Promoteur : conversion enregistrée, promoteur porté par l'inscription, ou lien de promoteur.
  v_pid := p_promoter_id;
  IF v_pid IS NULL AND p_id IS NOT NULL THEN
    SELECT pc.promoter_id INTO v_pid FROM public.promoter_conversions pc
     WHERE pc.status IS DISTINCT FROM 'cancelled'
       AND ((p_kind = 'ticket' AND pc.ticket_id = p_id) OR (p_kind = 'table' AND pc.table_reservation_id = p_id)
            OR (p_kind = 'order' AND pc.order_id = p_id) OR (p_kind = 'guest_list' AND pc.guest_list_entry_id = p_id))
     ORDER BY pc.created_at LIMIT 1;
  END IF;
  IF v_pid IS NOT NULL THEN RETURN QUERY SELECT 'promoter'::text, v_pid::text; RETURN; END IF;

  -- 2. Lien suivi / UTM.
  IF p_tracked_link_id IS NOT NULL THEN
    SELECT a.source, a.ref INTO v_src, v_ref FROM public.attribution_from_tracked_link(p_tracked_link_id) a;
    IF v_src IS NOT NULL THEN RETURN QUERY SELECT v_src, v_ref; RETURN; END IF;
  END IF;

  -- 3. Code promo.
  IF p_promo_code_id IS NOT NULL THEN RETURN QUERY SELECT 'promo_code'::text, p_promo_code_id::text; RETURN; END IF;

  -- 4. Campagne email : un clic de la même adresse dans les 7 jours avant la vente.
  IF nullif(trim(p_email), '') IS NOT NULL AND p_at IS NOT NULL THEN
    SELECT ev.campaign_id INTO v_camp FROM public.email_campaign_events ev
     WHERE ev.event_type = 'clicked' AND lower(ev.recipient_email) = lower(trim(p_email))
       AND ev.created_at BETWEEN p_at - interval '7 days' AND p_at
       AND NOT public.crm_campaign_is_crm(ev.campaign_id)
     ORDER BY ev.created_at DESC LIMIT 1;
    IF v_camp IS NOT NULL THEN RETURN QUERY SELECT 'email'::text, v_camp::text; RETURN; END IF;
  END IF;

  -- 5. Source d'arrivée portée par le checkout, sinon direct.
  RETURN QUERY SELECT public.attribution_from_purchase_source(p_purchase_source),
                      CASE WHEN nullif(p_purchase_source, '') IS NOT NULL AND lower(p_purchase_source) NOT IN ('direct') THEN lower(p_purchase_source) END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sms_campaign_recipients(p_venue_id text, p_organizer_user_id uuid, p_segment_type text, p_event_id uuid DEFAULT NULL::uuid, p_import_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid, p_segment_ids uuid[] DEFAULT NULL::uuid[], p_match text DEFAULT 'any'::text)
 RETURNS TABLE(contact_id uuid, phone_e164 text, full_name text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_segment_ids, ARRAY[p_segment_id])) x WHERE x IS NOT NULL);
  v_need integer := CASE WHEN COALESCE(p_match, 'any') = 'all' THEN 1 ELSE 0 END;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: service_role only';
  END IF;
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: une seule portée à la fois';
  END IF;
  -- Croiser : le numéro doit être dans CHAQUE segment ; réunir : dans au moins un.
  v_need := CASE WHEN v_need = 1 THEN cardinality(v_ids) ELSE 1 END;

  RETURN QUERY
  WITH cseg AS (
    SELECT r.phone_e164 AS ph, cs.id AS sid
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE cardinality(v_ids) > 0 AND cs.id = ANY(v_ids)
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND r.phone_e164 IS NOT NULL
  ), cph AS (
    SELECT ph FROM cseg GROUP BY ph HAVING count(DISTINCT sid) >= v_need
  )
  SELECT DISTINCT ON (c.phone_e164)
         c.id, c.phone_e164, c.full_name, c.user_id
    FROM public.venue_sms_contacts c
   WHERE NOT c.unsubscribed
     AND c.product IS NULL
     AND c.sms_consent_at > now() - interval '36 months'
     AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
     AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND CASE COALESCE(p_segment_type, 'all')
           WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
           WHEN 'vip'    THEN c.is_vip
           WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
           WHEN 'contact_segment' THEN cardinality(v_ids) > 0 AND c.phone_e164 IN (SELECT ph FROM cph)
           WHEN 'pros'    THEN EXISTS (
             SELECT 1 FROM public.newsletter_subscriptions ns
              WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                AND lower(ns.email) = lower(c.email)
                AND ns.source IN ('platform:pros','platform:leads'))
           WHEN 'clients' THEN EXISTS (
             SELECT 1 FROM public.newsletter_subscriptions ns
              WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                AND lower(ns.email) = lower(c.email)
                AND ns.source IN ('platform:clients','platform:waitlist'))
           WHEN 'not_event' THEN p_event_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM public.tickets t
                WHERE t.event_id = p_event_id
                  AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                  AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.table_reservations tr
                WHERE tr.event_id = p_event_id
                  AND tr.status <> 'refunded'
                  AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
             )
           ELSE true
         END
   ORDER BY c.phone_e164, c.sms_consent_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_crm_signup(p_slug text, p_first_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_answers jsonb DEFAULT '{}'::jsonb, p_consent boolean DEFAULT false, p_consent_text text DEFAULT NULL::text, p_lang text DEFAULT 'fr'::text, p_src text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_birthdate text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.crm_signup_pages;
  v_ctx record;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_contact text;
  v_domain text;
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' AND length(p_answers::text) <= 2000 THEN p_answers ELSE '{}'::jsonb END;
  v_party smallint;
  v_birth date;
  v_party_q text;
  v_id uuid;
  x text;
  v_lang text := CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug);
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF NOT public._crm_signup_open(p) THEN RETURN 'closed'; END IF;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;
  IF NOT COALESCE(p_consent, false) OR length(trim(COALESCE(p_consent_text, ''))) < 10 THEN RETURN 'consent_required'; END IF;
  IF length(trim(COALESCE(p_first_name, ''))) = 0 THEN RETURN 'invalid'; END IF;

  -- Le contact demandé par la page.
  v_contact := COALESCE(p.fields->>'contact', 'both');
  IF v_contact = 'email' THEN v_phone := NULL; END IF;
  IF v_contact = 'phone' THEN v_email := NULL; END IF;
  IF v_contact IN ('email', 'all') AND v_email IS NULL THEN RETURN 'invalid_email'; END IF;
  IF v_contact IN ('phone', 'all') AND v_phone IS NULL THEN RETURN 'invalid_phone'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RETURN 'invalid'; END IF;
  IF v_email IS NOT NULL THEN
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN RETURN 'invalid_email'; END IF;
    v_domain := split_part(v_email, '@', 2);
    IF EXISTS (SELECT 1 FROM public.crm_disposable_domains WHERE domain = v_domain) THEN RETURN 'disposable'; END IF;
    IF public.is_demo_email(v_email) THEN RETURN 'demo'; END IF;
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RETURN 'invalid_phone'; END IF;

  -- Champs obligatoires de la page.
  FOR x IN SELECT k FROM jsonb_each(COALESCE(p.fields->'extra', '{}'::jsonb)) AS j(k, v) WHERE COALESCE((v->>'req')::boolean, false) LOOP
    IF (x = 'nom' AND length(trim(COALESCE(p_last_name, ''))) = 0) OR (x = 'naissance' AND length(trim(COALESCE(p_birthdate, ''))) = 0)
       OR (x = 'insta' AND length(trim(COALESCE(p_instagram, ''))) = 0) OR (x = 'ville' AND length(trim(COALESCE(p_city, ''))) = 0) THEN
      RETURN 'invalid';
    END IF;
  END LOOP;
  BEGIN
    v_birth := NULLIF(trim(COALESCE(p_birthdate, '')), '')::date;
    IF v_birth IS NOT NULL AND (v_birth < date '1900-01-01' OR v_birth > current_date) THEN v_birth := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN v_birth := NULL;
  END;
  -- « Tu viens à combien ? » : la taille du groupe (« 4+ » → 4).
  SELECT q->>'label' INTO v_party_q FROM jsonb_array_elements(COALESCE(p.fields->'questions', '[]'::jsonb)) q WHERE COALESCE((q->>'party')::boolean, false) LIMIT 1;
  IF v_party_q IS NOT NULL AND v_answers ? v_party_q THEN
    v_party := LEAST(20, GREATEST(1, NULLIF(substring(v_answers->>v_party_q FROM '^\s*(\d{1,2})'), '')::int))::smallint;
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.crm_signup_entries WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p.id AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN 'rate_limited';
  END IF;

  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND lower(email) = v_email) THEN
    -- Déjà inscrit sans avoir confirmé : un nouveau lien repart (au plus toutes les 10 minutes).
    UPDATE public.crm_signup_entries SET confirm_sent_at = NULL, confirm_hash = NULL, created_at = GREATEST(created_at, now() - interval '2 days')
     WHERE page_id = p.id AND lower(email) = v_email AND confirmed_at IS NULL
       AND (confirm_sent_at IS NULL OR confirm_sent_at < now() - interval '10 minutes');
    RETURN 'already';
  END IF;
  IF v_email IS NULL AND EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND email IS NULL AND phone = v_phone) THEN
    RETURN 'already';
  END IF;

  INSERT INTO public.crm_signup_entries (page_id, first_name, last_name, email, phone, birthdate, instagram, city, answers, party_size,
                                         src, lang, consent_text, visitor_hash, was_known, confirmed_at, subscribed)
  VALUES (p.id, left(trim(p_first_name), 60), NULLIF(left(trim(COALESCE(p_last_name, '')), 60), ''), v_email, v_phone, v_birth,
          NULLIF(left(regexp_replace(trim(COALESCE(p_instagram, '')), '^@+', ''), 40), ''), NULLIF(left(trim(COALESCE(p_city, '')), 60), ''),
          v_answers, v_party,
          CASE WHEN lower(p_src) ~ '^[a-z0-9_-]{1,30}$' THEN lower(p_src) END, v_lang,
          left(trim(p_consent_text), 600), v_ctx.o_hash, public._crm_signup_known(p, v_email, v_phone),
          -- Sans e-mail, aucun lien de confirmation possible : la case cochée fait foi.
          CASE WHEN v_email IS NULL THEN now() END, CASE WHEN v_email IS NULL THEN false END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND v_email IS NULL THEN
    -- Preuve du consentement (téléphone) et place dans le groupe de la page. Le
    -- registre SMS reste fermé côté CRM : le numéro n'y entre pas.
    INSERT INTO public.marketing_consent_events (phone_e164, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
    VALUES (v_phone, 'sms', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', left(trim(p_consent_text), 600), v_lang, 'signup_page:' || p.id);
    IF p.contact_import_id IS NOT NULL THEN
      INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, product, phone_e164, first_name, last_name, city, newsletter_opt_in, added_at, extra)
      VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, 'crm', v_phone, left(trim(p_first_name), 60), NULLIF(left(trim(COALESCE(p_last_name, '')), 60), ''),
              NULLIF(left(trim(COALESCE(p_city, '')), 60), ''), false, now(),
              jsonb_build_object('signup_page', p.id, 'src', lower(p_src), 'answers', v_answers))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN 'ok';
END;
$function$;

CREATE OR REPLACE FUNCTION public.subscribe_my_community_newsletter(p_event_id uuid, p_wording_text text, p_locale text DEFAULT NULL::text, p_source text DEFAULT 'community_ticket'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_venue text;
  v_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'login_required';
  END IF;
  IF COALESCE(btrim(p_wording_text), '') = '' THEN
    RAISE EXCEPTION 'wording_required';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL THEN RETURN false; END IF;

  SELECT h.venue_id, h.organizer_user_id INTO v_venue, v_org
  FROM public.event_community_host(p_event_id) h;
  IF v_venue IS NULL AND v_org IS NULL THEN RETURN false; END IF;

  -- Index d'unicité PARTIELS sur lower(email) : la cible ON CONFLICT répète
  -- l'expression ET le prédicat (cf. auto_subscribe_newsletter_on_purchase).
  IF v_venue IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, product)
    VALUES (v_uid, v_venue, v_email, true, p_source, 'website_form', now(), NULL)
    ON CONFLICT (lower(email), venue_id, product) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
          consent_recorded_at = now(),
          updated_at = now();
  ELSE
    INSERT INTO public.newsletter_subscriptions
      (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, product)
    VALUES (v_uid, v_org, v_email, true, p_source, 'website_form', now(), NULL)
    ON CONFLICT (lower(email), organizer_user_id, product) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
          consent_recorded_at = now(),
          updated_at = now();
  END IF;

  PERFORM public.record_marketing_consent_grant(
    'email', p_wording_text, v_venue, v_org, v_email, NULL,
    'community.newsletterCta', p_locale, p_source
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ticketing_connections_withdraw_consents()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH off AS (
    DELETE FROM public.newsletter_subscriptions s
     WHERE ((OLD.venue_id IS NOT NULL AND s.venue_id = OLD.venue_id)
         OR (OLD.venue_id IS NULL AND s.organizer_user_id = OLD.organizer_user_id))
       AND s.opted_in
       AND COALESCE(s.source, '') = 'connector:' || OLD.provider
       AND s.product = 'crm'
    RETURNING s.email, s.user_id
  )
  INSERT INTO public.marketing_consent_events
    (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
  SELECT o.user_id, lower(o.email), 'email', OLD.venue_id,
         CASE WHEN OLD.venue_id IS NULL THEN OLD.organizer_user_id END,
         'withdrawn', 'connector_purged',
         'Données de la billetterie (' || OLD.provider || ') supprimées par le pro : accord versé par la billetterie retiré',
         'connector:' || OLD.provider
    FROM off o;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(p_token uuid)
 RETURNS TABLE(success boolean, scope_name text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id uuid;
  v_email text;
  v_scope_name text;
  v_venue_id text;
  v_org_id uuid;
BEGIN
  SELECT ns.id, ns.email,
         COALESCE(CASE WHEN ns.product = 'crm' THEN public.crm_space_display_name(ns.venue_id, ns.organizer_user_id) END,
                  v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text,
         ns.venue_id, ns.organizer_user_id
    INTO v_sub_id, v_email, v_scope_name, v_venue_id, v_org_id
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;

  IF v_sub_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- EXCEPTION LÉGALE : un « stop » vaut pour TOUS les outils de ce pro (Yuno Tickets et Yuno CRM) :
  -- la ligne du lien ET celle de l'autre produit (même portée, même adresse). Jamais la portée plateforme.
  UPDATE public.newsletter_subscriptions ns
  SET opted_in = false, opted_out_at = now(), updated_at = now()
  WHERE ns.id = v_sub_id
     OR (ns.opted_in
         AND lower(ns.email) = lower(v_email)
         AND ns.venue_id IS NOT DISTINCT FROM v_venue_id
         AND ns.organizer_user_id IS NOT DISTINCT FROM v_org_id
         AND (v_venue_id IS NOT NULL OR v_org_id IS NOT NULL));

  RETURN QUERY SELECT true, v_scope_name, v_email;
END;
$function$;


-- ── 3. Les données ─────────────────────────────────────────────────────────────────────────
-- ── 0. Les portées concernées ───────────────────────────────────────────────
CREATE TEMP TABLE _sp_scopes ON COMMIT DROP AS
SELECT s.venue_id, s.organizer_user_id,
       public.crm_scope_is_crm(public.crm_scope_key(s.venue_id, s.organizer_user_id)) AS pure,
       (public.crm_scope_has_crm(public.crm_scope_key(s.venue_id, s.organizer_user_id))
        AND NOT public.crm_scope_is_crm(public.crm_scope_key(s.venue_id, s.organizer_user_id))) AS two
  FROM (SELECT venue_id, organizer_user_id FROM public.contact_list_imports
        UNION SELECT venue_id, organizer_user_id FROM public.email_list_imports
        UNION SELECT venue_id, organizer_user_id FROM public.sms_list_imports
        UNION SELECT venue_id, organizer_user_id FROM public.imported_contacts
        UNION SELECT venue_id, organizer_user_id FROM public.venue_sms_contacts) s
 WHERE s.venue_id IS NOT NULL OR s.organizer_user_id IS NOT NULL;
-- ── 1. (ii) Compte CRM pur : tout en 'crm', sur place ───────────────────────
UPDATE public.contact_list_imports t SET product = 'crm' FROM _sp_scopes s
 WHERE s.pure AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
   AND t.product IS DISTINCT FROM 'crm';
UPDATE public.email_list_imports t SET product = 'crm' FROM _sp_scopes s
 WHERE s.pure AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
   AND t.product IS DISTINCT FROM 'crm';
UPDATE public.sms_list_imports t SET product = 'crm' FROM _sp_scopes s
 WHERE s.pure AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
   AND t.product IS DISTINCT FROM 'crm';
UPDATE public.imported_contacts t SET product = 'crm' FROM _sp_scopes s
 WHERE s.pure AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
   AND t.product IS DISTINCT FROM 'crm';
UPDATE public.venue_sms_contacts t SET product = 'crm' FROM _sp_scopes s
 WHERE s.pure AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
   AND t.product IS DISTINCT FROM 'crm';
-- ── 2. (i) Compte à deux produits : les listes d'ORIGINE CRM restent chez le CRM, sur place ──
CREATE TEMP TABLE _sp_crm_lists ON COMMIT DROP AS
SELECT li.id AS contact_id, li.email_import_id, li.sms_import_id
  FROM public.contact_list_imports li
  JOIN _sp_scopes s ON s.two AND li.venue_id IS NOT DISTINCT FROM s.venue_id AND li.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE li.product IS DISTINCT FROM 'crm'
   AND (EXISTS (SELECT 1 FROM public.crm_imports ci WHERE ci.list_import_id = li.id)
        OR li.filename LIKE 'signup_page:%');

UPDATE public.contact_list_imports t SET product = 'crm' WHERE t.id IN (SELECT contact_id FROM _sp_crm_lists) AND t.product IS DISTINCT FROM 'crm';
UPDATE public.email_list_imports t SET product = 'crm'
 WHERE t.product IS DISTINCT FROM 'crm'
   AND (t.id IN (SELECT email_import_id FROM _sp_crm_lists WHERE email_import_id IS NOT NULL)
        OR (t.filename LIKE 'signup_page:%' AND EXISTS (SELECT 1 FROM _sp_scopes s WHERE s.two
              AND t.venue_id IS NOT DISTINCT FROM s.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id)));
UPDATE public.sms_list_imports t SET product = 'crm'
 WHERE t.product IS DISTINCT FROM 'crm' AND t.id IN (SELECT sms_import_id FROM _sp_crm_lists WHERE sms_import_id IS NOT NULL);

-- Les lignes suivent leur liste (idempotent, valable pour les trois cas) :
UPDATE public.imported_contacts ic SET product = 'crm'
  FROM public.contact_list_imports l WHERE ic.list_import_id = l.id AND l.product = 'crm' AND ic.product IS DISTINCT FROM 'crm';
UPDATE public.venue_sms_contacts vc SET product = 'crm'
  FROM public.sms_list_imports l WHERE vc.import_id = l.id AND l.product = 'crm' AND vc.product IS DISTINCT FROM 'crm';
-- ── 3. (iii) Compte à deux produits : tout le reste est COPIÉ en 'crm' ──────
-- « Le reste » = les listes encore sans produit des portées à deux produits (y compris les listes retirées par fusion : le CRM
-- garde exactement la base qu'il lisait, retraits compris). Chaque copie a l'id public._sep3_copy_id(ancien id) : rejouable
-- sans doublon (NOT EXISTS sur l'id), et l'agent A retrouve la copie d'une liste sans table de correspondance.
-- 3a. Les listes e-mail et SMS d'abord (les listes unifiées pointent dessus).
INSERT INTO public.email_list_imports
  (id, venue_id, organizer_user_id, filename, list_name, consent_source, consent_details, collected_since,
   attested_at, attested_by, attested_via_support, created_at, submitted_count, inserted_count, reactivated_count,
   duplicate_count, invalid_count, suppressed_count, unchanged_count, fingerprint, superseded_at, product)
SELECT public._sep3_copy_id(e.id), e.venue_id, e.organizer_user_id, e.filename, e.list_name, e.consent_source, e.consent_details, e.collected_since,
       e.attested_at, e.attested_by, e.attested_via_support, e.created_at, e.submitted_count, e.inserted_count, e.reactivated_count,
       e.duplicate_count, e.invalid_count, e.suppressed_count, e.unchanged_count, e.fingerprint, e.superseded_at, 'crm'
  FROM public.email_list_imports e
  JOIN _sp_scopes s ON s.two AND e.venue_id IS NOT DISTINCT FROM s.venue_id AND e.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE e.product IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.email_list_imports x WHERE x.id = public._sep3_copy_id(e.id));

INSERT INTO public.sms_list_imports
  (id, venue_id, organizer_user_id, filename, list_name, consent_source, consent_details, collected_since, default_country,
   attested_at, attested_by, attested_via_support, created_at, submitted_count, inserted_count,
   duplicate_count, invalid_count, suppressed_count, unchanged_count, fingerprint, superseded_at, product)
SELECT public._sep3_copy_id(e.id), e.venue_id, e.organizer_user_id, e.filename, e.list_name, e.consent_source, e.consent_details, e.collected_since, e.default_country,
       e.attested_at, e.attested_by, e.attested_via_support, e.created_at, e.submitted_count, e.inserted_count,
       e.duplicate_count, e.invalid_count, e.suppressed_count, e.unchanged_count, e.fingerprint, e.superseded_at, 'crm'
  FROM public.sms_list_imports e
  JOIN _sp_scopes s ON s.two AND e.venue_id IS NOT DISTINCT FROM s.venue_id AND e.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE e.product IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.sms_list_imports x WHERE x.id = public._sep3_copy_id(e.id));

-- « liste retirée par fusion » : le lien superseded_by suit la copie de la liste cible (reste NULL si la cible n'a pas de copie).
UPDATE public.email_list_imports n SET superseded_by = public._sep3_copy_id(o.superseded_by)
  FROM public.email_list_imports o
 WHERE n.product = 'crm' AND n.id = public._sep3_copy_id(o.id) AND o.product IS NULL
   AND o.superseded_by IS NOT NULL AND n.superseded_by IS NULL
   AND EXISTS (SELECT 1 FROM public.email_list_imports t WHERE t.id = public._sep3_copy_id(o.superseded_by));
UPDATE public.sms_list_imports n SET superseded_by = public._sep3_copy_id(o.superseded_by)
  FROM public.sms_list_imports o
 WHERE n.product = 'crm' AND n.id = public._sep3_copy_id(o.id) AND o.product IS NULL
   AND o.superseded_by IS NOT NULL AND n.superseded_by IS NULL
   AND EXISTS (SELECT 1 FROM public.sms_list_imports t WHERE t.id = public._sep3_copy_id(o.superseded_by));

-- 3b. Les listes unifiées (l'analyse Billetterie n'est PAS recopiée : le CRM ne l'utilise pas).
INSERT INTO public.contact_list_imports
  (id, venue_id, organizer_user_id, list_name, filename, consent_source, consent_details, collected_since, default_country,
   detected_columns, channels, attested_at, attested_by, attested_via_support, created_at, row_count, email_count, phone_count,
   both_count, fingerprint, superseded_at, email_import_id, sms_import_id, product)
SELECT public._sep3_copy_id(l.id), l.venue_id, l.organizer_user_id, l.list_name, l.filename, l.consent_source, l.consent_details, l.collected_since, l.default_country,
       l.detected_columns, l.channels, l.attested_at, l.attested_by, l.attested_via_support, l.created_at, l.row_count, l.email_count, l.phone_count,
       l.both_count, l.fingerprint, l.superseded_at,
       (SELECT x.id FROM public.email_list_imports x WHERE x.id = public._sep3_copy_id(l.email_import_id)),
       (SELECT x.id FROM public.sms_list_imports x WHERE x.id = public._sep3_copy_id(l.sms_import_id)),
       'crm'
  FROM public.contact_list_imports l
  JOIN _sp_scopes s ON s.two AND l.venue_id IS NOT DISTINCT FROM s.venue_id AND l.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE l.product IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.contact_list_imports x WHERE x.id = public._sep3_copy_id(l.id));
UPDATE public.contact_list_imports n SET superseded_by = public._sep3_copy_id(o.superseded_by)
  FROM public.contact_list_imports o
 WHERE n.product = 'crm' AND n.id = public._sep3_copy_id(o.id) AND o.product IS NULL
   AND o.superseded_by IS NOT NULL AND n.superseded_by IS NULL
   AND EXISTS (SELECT 1 FROM public.contact_list_imports t WHERE t.id = public._sep3_copy_id(o.superseded_by));

-- 3c. La matière : les contacts importés (created_at conservé : contact_rows trie dessus, _crm_file_history aussi).
INSERT INTO public.imported_contacts
  (id, list_import_id, venue_id, organizer_user_id, email, phone_e164, first_name, last_name, country_code, country, region, city,
   postal_code, zone, age, gender, newsletter_opt_in, added_at, last_purchase_at, total_spent, event_count, extra, created_at, product)
SELECT gen_random_uuid(), public._sep3_copy_id(ic.list_import_id), ic.venue_id, ic.organizer_user_id, ic.email, ic.phone_e164, ic.first_name, ic.last_name,
       ic.country_code, ic.country, ic.region, ic.city, ic.postal_code, ic.zone, ic.age, ic.gender, ic.newsletter_opt_in,
       ic.added_at, ic.last_purchase_at, ic.total_spent, ic.event_count, ic.extra, ic.created_at, 'crm'
  FROM public.imported_contacts ic
  JOIN public.contact_list_imports l ON l.id = ic.list_import_id AND l.product IS NULL
  JOIN _sp_scopes s ON s.two AND l.venue_id IS NOT DISTINCT FROM s.venue_id AND l.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE EXISTS (SELECT 1 FROM public.contact_list_imports c WHERE c.id = public._sep3_copy_id(l.id))
   AND NOT EXISTS (SELECT 1 FROM public.imported_contacts x WHERE x.list_import_id = public._sep3_copy_id(ic.list_import_id));

-- 3d. Les contacts SMS IMPORTÉS (ceux d'une liste SMS copiée) ; l'état STOP / désabonné est recopié tel quel.
--     Les contacts SMS nés de Yuno (checkout, guest list, Meta) ne sont pas copiés.
INSERT INTO public.venue_sms_contacts
  (id, venue_id, organizer_user_id, phone_e164, full_name, user_id, email, sms_consent_at, consent_source, source_event_id,
   is_vip, unsubscribed, unsubscribed_at, import_id, created_at, product)
SELECT gen_random_uuid(), vc.venue_id, vc.organizer_user_id, vc.phone_e164, vc.full_name, vc.user_id, vc.email, vc.sms_consent_at,
       vc.consent_source, vc.source_event_id, vc.is_vip, vc.unsubscribed, vc.unsubscribed_at, public._sep3_copy_id(vc.import_id), vc.created_at, 'crm'
  FROM public.venue_sms_contacts vc
  JOIN public.sms_list_imports l ON l.id = vc.import_id AND l.product IS NULL
  JOIN _sp_scopes s ON s.two AND l.venue_id IS NOT DISTINCT FROM s.venue_id AND l.organizer_user_id IS NOT DISTINCT FROM s.organizer_user_id
 WHERE vc.product IS NULL
   AND EXISTS (SELECT 1 FROM public.sms_list_imports c WHERE c.id = public._sep3_copy_id(l.id))
ON CONFLICT (venue_id, phone_e164, organizer_user_id, product) DO NOTHING;
-- ── 4. Caches de la base de contacts : dérivés, reconstruits à la première lecture ──
-- Compte à deux produits : les deux clés (Billetterie et « …|crm ») changent de contenu.
-- Compte CRM pur : la clé « …|crm » (pré-semée par la migration des contacts) reste valable, rien à purger.
CREATE TEMP TABLE _sp_cache_keys ON COMMIT DROP AS
SELECT st.scope_key FROM public.contact_base_cache_state st
 WHERE public.crm_scope_has_crm(public.crm_scope_key(st.venue_id, st.organizer_user_id))
   AND NOT public.crm_scope_is_crm(public.crm_scope_key(st.venue_id, st.organizer_user_id));
DELETE FROM public.contact_base_cache c WHERE c.scope_key IN (SELECT scope_key FROM _sp_cache_keys);
DELETE FROM public.contact_base_cache_state st WHERE st.scope_key IN (SELECT scope_key FROM _sp_cache_keys);

-- ── A-3. Données ────────────────────────────────────────────────────────────────────────────────
-- Le trigger BEFORE UPDATE `trg_newsletter_subs_updated_at` remettrait updated_at à now() : il sert à la
-- péremption des 36 mois (get_my_marketing_consent) — on ne rajeunit pas un consentement par migration.
ALTER TABLE public.newsletter_subscriptions DISABLE TRIGGER trg_newsletter_subs_updated_at;

-- Les portées qui ont le CRM (compte CRM pur, ou compte à deux produits). Calculé UNE fois.
CREATE TEMP TABLE _sep3_scopes ON COMMIT DROP AS
SELECT s.venue_id, s.organizer_user_id, public.crm_scope_is_crm(s.sk) AS pure
  FROM (SELECT DISTINCT ns.venue_id, ns.organizer_user_id,
               public.crm_scope_key(ns.venue_id, ns.organizer_user_id) AS sk
          FROM public.newsletter_subscriptions ns
         WHERE ns.venue_id IS NOT NULL OR ns.organizer_user_id IS NOT NULL) s
 WHERE public.crm_scope_has_crm(s.sk);

-- (ii) Compte CRM PUR : tout son registre est du CRM (la Billetterie n'y est pas ouverte). DÉPLACÉ, pas copié.
UPDATE public.newsletter_subscriptions ns
   SET product = 'crm'
  FROM _sep3_scopes sc
 WHERE sc.pure AND ns.product IS NULL
   AND ((sc.venue_id IS NOT NULL AND ns.venue_id = sc.venue_id)
     OR (sc.organizer_user_id IS NOT NULL AND ns.organizer_user_id = sc.organizer_user_id));

-- (i) Compte à DEUX produits, a) lignes d'origine CRM : changent de produit SUR PLACE (jamais copiées).
--     connector:% = billetterie connectée (Shotgun) ; signup_page% = pages d'inscription du CRM (/j/).
UPDATE public.newsletter_subscriptions ns
   SET product = 'crm'
  FROM _sep3_scopes sc
 WHERE NOT sc.pure AND ns.product IS NULL
   AND (ns.source LIKE 'connector:%' OR ns.source LIKE 'signup_page%')
   AND ((sc.venue_id IS NOT NULL AND ns.venue_id = sc.venue_id)
     OR (sc.organizer_user_id IS NOT NULL AND ns.organizer_user_id = sc.organizer_user_id));

-- (i) b) lignes d'un fichier importé DEPUIS LA CONSOLE CRM : la liste est passée au CRM (mission C) — la ligne la suit.
--     [groupe needs-C-lists : suppose email_list_imports.product ; sans effet tant que C n'a rien marqué]
UPDATE public.newsletter_subscriptions ns
   SET product = 'crm'
  FROM public.email_list_imports l, _sep3_scopes sc
 WHERE NOT sc.pure AND ns.product IS NULL
   AND ns.import_id = l.id AND l.product = 'crm'
   AND ((sc.venue_id IS NOT NULL AND ns.venue_id = sc.venue_id)
     OR (sc.organizer_user_id IS NOT NULL AND ns.organizer_user_id = sc.organizer_user_id));

-- (iii) Compte à DEUX produits, c) lignes venues d'un fichier IMPORTÉ côté Billetterie : COPIÉES vers le CRM
--     (le CRM de WOH vit sur ses contacts importés ; la Billetterie garde les siens).
--     Décision de Paul : on ne copie JAMAIS un accord né d'une surface Yuno (achat, guest list, waitlist,
--     checkout, formulaire, suivi, co-organisation, lead Meta, panier) : ces lignes restent product NULL.
--     La copie garde l'état (un désabonné reste désabonné), ses dates, son nom ; NOUVEL id, NOUVEAU jeton
--     (DEFAULT), PAS de user_id (aucun compte client Yuno rattaché à un contact du CRM) ; son import_id
--     pointe sur la COPIE de la liste (id déterministe) si la mission C l'a créée, sinon NULL.
INSERT INTO public.newsletter_subscriptions
  (user_id, venue_id, organizer_user_id, email, opted_in, source, created_at, updated_at, opted_out_at,
   import_id, consent_source, consent_recorded_at, first_name, last_name, product)
SELECT NULL, ns.venue_id, ns.organizer_user_id, ns.email, ns.opted_in, ns.source, ns.created_at, ns.updated_at, ns.opted_out_at,
       (SELECT l.id FROM public.email_list_imports l WHERE l.id = public._sep3_copy_id(ns.import_id)),
       ns.consent_source, ns.consent_recorded_at, ns.first_name, ns.last_name, 'crm'
  FROM public.newsletter_subscriptions ns
  JOIN _sep3_scopes sc
    ON NOT sc.pure
   AND ((sc.venue_id IS NOT NULL AND ns.venue_id = sc.venue_id)
     OR (sc.organizer_user_id IS NOT NULL AND ns.organizer_user_id = sc.organizer_user_id))
 WHERE ns.product IS NULL
   AND (ns.source = 'import' OR ns.import_id IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscriptions c
                    WHERE c.product = 'crm' AND lower(c.email) = lower(ns.email)
                      AND c.venue_id IS NOT DISTINCT FROM ns.venue_id
                      AND c.organizer_user_id IS NOT DISTINCT FROM ns.organizer_user_id);

ALTER TABLE public.newsletter_subscriptions ENABLE TRIGGER trg_newsletter_subs_updated_at;

-- (iv) Compte Billetterie pur : rien. Portée plateforme : rien (product NULL).

-- Données : CRM pur → tout 'crm' ; compte à deux produits → l'effacement chez la billetterie (reason 'erased', écrit
-- par ticketing_apply_erasures) est du CRM et se DÉPLACE ; les lignes de purge de liste (unsubscribed / suppressed)
-- restent à la Billetterie ET sont COPIÉES au CRM : c'est une mémoire de refus (jamais réinscrire), la copier est
-- protecteur et ne fait entrer aucun client dans le CRM.
UPDATE public.email_opt_outs o SET product = 'crm'
  FROM _sep3_scopes sc
 WHERE o.product IS NULL
   AND ((sc.pure) OR (NOT sc.pure AND o.reason = 'erased'))
   AND ((sc.venue_id IS NOT NULL AND o.venue_id = sc.venue_id)
     OR (sc.organizer_user_id IS NOT NULL AND o.organizer_user_id = sc.organizer_user_id));

INSERT INTO public.email_opt_outs (venue_id, organizer_user_id, email, reason, import_id, opted_out_at, purged_at, purged_by, product)
SELECT o.venue_id, o.organizer_user_id, o.email, o.reason,
       (SELECT l.id FROM public.email_list_imports l WHERE l.id = public._sep3_copy_id(o.import_id)),
       o.opted_out_at, o.purged_at, o.purged_by, 'crm'
  FROM public.email_opt_outs o
  JOIN _sep3_scopes sc
    ON NOT sc.pure
   AND ((sc.venue_id IS NOT NULL AND o.venue_id = sc.venue_id)
     OR (sc.organizer_user_id IS NOT NULL AND o.organizer_user_id = sc.organizer_user_id))
 WHERE o.product IS NULL AND o.reason <> 'erased'
   AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs c
                    WHERE c.product = 'crm' AND lower(c.email) = lower(o.email)
                      AND c.venue_id IS NOT DISTINCT FROM o.venue_id
                      AND c.organizer_user_id IS NOT DISTINCT FROM o.organizer_user_id);

-- ── A-5. Le connecteur recrée ce qui manque ───────────────────────────────────────────────────────
-- Une adresse dont l'unique ancienne ligne était d'origine Yuno (billet / guest list…) alors que Shotgun a rapporté
-- son accord n'a pas encore de ligne CRM : la prochaine passe COMPLÈTE de ticketing_after_sync (idempotente,
-- ensembliste) la crée — sauf stop explicite posé dans la Billetterie (clause ajoutée par les patchs).
UPDATE public.ticketing_connections SET post_full_at = NULL;

-- ── 5. Contrôles : la migration échoue si un compte CRM pur garde du « Billetterie » ──
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.imported_contacts t
   WHERE t.product IS DISTINCT FROM 'crm' AND public.crm_scope_is_crm(public.crm_scope_key(t.venue_id, t.organizer_user_id));
  IF n > 0 THEN RAISE EXCEPTION '% imported_contacts de compte CRM pur sans produit crm', n; END IF;
  SELECT count(*) INTO n FROM public.venue_sms_contacts t
   WHERE t.product IS DISTINCT FROM 'crm' AND public.crm_scope_is_crm(public.crm_scope_key(t.venue_id, t.organizer_user_id));
  IF n > 0 THEN RAISE EXCEPTION '% venue_sms_contacts de compte CRM pur sans produit crm', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT venue_id, organizer_user_id, product FROM public.contact_list_imports
    UNION ALL SELECT venue_id, organizer_user_id, product FROM public.email_list_imports
    UNION ALL SELECT venue_id, organizer_user_id, product FROM public.sms_list_imports) t
   WHERE t.product IS DISTINCT FROM 'crm' AND public.crm_scope_is_crm(public.crm_scope_key(t.venue_id, t.organizer_user_id));
  IF n > 0 THEN RAISE EXCEPTION '% liste(s) de compte CRM pur sans produit crm', n; END IF;
  -- Aucune ligne importée ne contredit sa liste.
  SELECT count(*) INTO n FROM public.imported_contacts ic JOIN public.contact_list_imports l ON l.id = ic.list_import_id
   WHERE ic.product IS DISTINCT FROM l.product;
  IF n > 0 THEN RAISE EXCEPTION '% imported_contacts qui contredisent le produit de leur liste', n; END IF;
  -- Aucune ligne de la plateforme ne porte de produit.
  SELECT count(*) INTO n FROM public.venue_sms_contacts t WHERE t.product IS NOT NULL AND t.venue_id IS NULL AND t.organizer_user_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% contacts SMS de la plateforme avec un produit', n; END IF;
END $$;

ALTER TABLE public.contact_list_imports VALIDATE CONSTRAINT contact_list_imports_product_check;
ALTER TABLE public.contact_list_imports VALIDATE CONSTRAINT contact_list_imports_product_scope_check;
ALTER TABLE public.email_list_imports   VALIDATE CONSTRAINT email_list_imports_product_check;
ALTER TABLE public.email_list_imports   VALIDATE CONSTRAINT email_list_imports_product_scope_check;
ALTER TABLE public.sms_list_imports     VALIDATE CONSTRAINT sms_list_imports_product_check;
ALTER TABLE public.sms_list_imports     VALIDATE CONSTRAINT sms_list_imports_product_scope_check;
ALTER TABLE public.imported_contacts    VALIDATE CONSTRAINT imported_contacts_product_check;
ALTER TABLE public.imported_contacts    VALIDATE CONSTRAINT imported_contacts_product_scope_check;
ALTER TABLE public.venue_sms_contacts   VALIDATE CONSTRAINT venue_sms_contacts_product_check;
ALTER TABLE public.venue_sms_contacts   VALIDATE CONSTRAINT venue_sms_contacts_product_scope_check;

-- ============================================================================
-- COORDINATION AVEC L'AGENT A (registre e-mail) — aucun SQL à jouer ici
--   · ordre : A-0 (helper _sep3_copy_id) → sep3-C-ddl.sql → fonctions C → CE FICHIER → A-1 … A-6 ;
--   · A copie les accords d'origine « fichier » vers 'crm' en pointant import_id sur public._sep3_copy_id(ancien import_id)
--     (A-3 (iii)) : c'est pour cela que les copies de listes ci-dessus ont des ids déterministes ;
--   · deux corrections à reporter dans sep3-A-migration.sql (voir rapport C §8) : l'import_id ne prouve PAS l'origine d'un accord
--     (l'ancien contact_import_absorb a déplacé l'import_id de TOUT accord de la portée dont l'adresse figure dans le fichier, y compris
--     des accords nés de Yuno) — A-3 (i)(b) et (iii) doivent filtrer sur `source` (import / signup_page / connector), pas sur import_id seul.
-- ============================================================================

-- ═════════════════════════════════════════════════════════════════════════════
-- D-5. Fonctions : voir sep3-D-patches.json (DROP + CREATE des signatures changées) puis GRANT :
-- ═════════════════════════════════════════════════════════════════════════════
-- (à placer APRÈS la (re)création des fonctions)
REVOKE EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid, integer, text) TO authenticated, service_role;
REVOKE ALL     ON FUNCTION public._email_automation_enabled(text, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._email_automation_enabled(text, uuid, text, text) TO service_role, authenticated;
REVOKE ALL     ON FUNCTION public.refresh_contact_engagement(text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refresh_contact_engagement(text, uuid, text) TO authenticated, service_role;
REVOKE ALL     ON FUNCTION public.get_sms_sender_readiness(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_sms_sender_readiness(text, uuid, text) TO authenticated, service_role;
REVOKE ALL     ON FUNCTION public.set_sms_sender_identity(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_sms_sender_identity(text, uuid, text, text, text) TO authenticated, service_role;
-- guard_crm_send_frozen : le texte de 20261005240000 dit SECURITY INVOKER, la prod est DEFINER depuis 20261021100000.
-- Le CREATE OR REPLACE issu du texte de la migration le repasse en INVOKER : on le ré-affirme.
ALTER FUNCTION public.guard_crm_send_frozen() SECURITY DEFINER;
ALTER FUNCTION public.guard_crm_send_frozen() SET search_path = public;

-- ── A-6. Invariants : la migration s'arrête si l'un est faux ──────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM (SELECT 1 FROM public.newsletter_subscriptions
                                GROUP BY unsubscribe_token HAVING count(*) > 1) x;
  IF v > 0 THEN RAISE EXCEPTION 'sep3-A : % jeton(s) de désinscription en double', v; END IF;
  SELECT count(*) INTO v FROM public.newsletter_subscriptions
   WHERE product IS NOT NULL AND venue_id IS NULL AND organizer_user_id IS NULL;
  IF v > 0 THEN RAISE EXCEPTION 'sep3-A : % ligne(s) CRM sur la portée plateforme', v; END IF;
  SELECT count(*) INTO v FROM public.newsletter_subscriptions
   WHERE (source LIKE 'connector:%' OR source LIKE 'signup_page%') AND product IS DISTINCT FROM 'crm'
     AND (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL)
     AND public.crm_scope_has_crm(public.crm_scope_key(venue_id, organizer_user_id));
  IF v > 0 THEN RAISE EXCEPTION 'sep3-A : % ligne(s) d''origine CRM restée(s) côté Billetterie', v; END IF;
  SELECT count(*) INTO v FROM public.newsletter_subscriptions
   WHERE product = 'crm'
     AND source IN ('ticket_purchase', 'guest_list', 'waitlist', 'cohost_purchase', 'meta_lead_ads', 'checkout_started', 'community_ticket')
     AND NOT public.crm_scope_is_crm(public.crm_scope_key(venue_id, organizer_user_id));
  IF v > 0 THEN RAISE EXCEPTION 'sep3-A : % accord(s) né(s) d''une surface Yuno copié(s) dans le CRM', v; END IF;
  SELECT count(*) INTO v FROM public.newsletter_subscriptions ns
   WHERE ns.product IS NOT NULL AND NOT public.crm_scope_has_crm(public.crm_scope_key(ns.venue_id, ns.organizer_user_id));
  IF v > 0 THEN RAISE EXCEPTION 'sep3-A : % ligne(s) CRM sur un compte sans CRM', v; END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D-6. Contrôles (la migration échoue si la séparation n'est pas complète)
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.email_automations a
   WHERE a.product IS DISTINCT FROM 'crm' AND (a.venue_id IS NOT NULL OR a.organizer_user_id IS NOT NULL)
     AND public.crm_scope_is_crm(public.crm_scope_key(a.venue_id, a.organizer_user_id));
  IF n > 0 THEN RAISE EXCEPTION 'D: % recette(s) d''un compte CRM pur sans product crm', n; END IF;
  SELECT count(*) INTO n FROM public.email_campaign_templates t
   WHERE t.product IS DISTINCT FROM 'crm' AND public.crm_scope_is_crm(public.crm_scope_key(t.venue_id, t.organizer_user_id));
  IF n > 0 THEN RAISE EXCEPTION 'D: % modèle(s) d''un compte CRM pur sans product crm', n; END IF;
  SELECT count(*) INTO n FROM public.contact_engagement ce WHERE COALESCE(ce.product = 'crm', false) <> (ce.scope_key LIKE '%|crm');
  IF n > 0 THEN RAISE EXCEPTION 'D: % ligne(s) d''engagement avec une clé incohérente', n; END IF;
  SELECT count(*) INTO n FROM public.email_automations a
   JOIN public.email_campaign_templates t ON t.id = a.template_id
   WHERE a.template_id IS NOT NULL AND a.product IS DISTINCT FROM t.product;
  IF n > 0 THEN RAISE EXCEPTION 'D: % recette(s) qui citent un modèle de l''autre produit', n; END IF;
END $$;

NOTIFY pgrst, 'reload schema';
