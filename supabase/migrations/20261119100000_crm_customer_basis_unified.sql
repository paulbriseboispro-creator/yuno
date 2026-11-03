-- Yuno CRM « Vos clients » : UN SEUL chiffre « joignables par e-mail » côté pro
-- (demande de Paul, 03/11). Jusqu'ici la Console montrait deux nombres : les
-- personnes qui ont donné leur accord (registre) et, à part, « Vos clients »
-- (exception clients, article L34-5 alinéa 2). Le pro voit désormais UNE
-- population, avec deux étiquettes par personne :
--   « Accepté »         = accord marketing donné (registre de consentement) ;
--   « Pas de mention »  = client d'une soirée du compte, ni accord ni refus.
-- La distinction RESTE en base (legal_basis du destinataire et de la campagne,
-- crm_customer_contacts, disjoncteur, pied de page, exclusions, bêta, Admin CRM) :
-- rien de tout cela ne change, pas plus que les gardes serveur. Un client « Pas de
-- mention » n'est joignable QUE si le titulaire a signé (crm_customer_basis_open)
-- et, pour une campagne, si son contenu ne parle que des soirées du compte.
--
--   1. `_cp.email_cust` : client éligible, base ouverte, sans accord (« Pas de
--      mention »). Posé par _crm_people_build (et à faux par _tix_people_build :
--      _crm_filter_sql lit la colonne des deux côtés). `email_ok` ne change PAS :
--      tout moteur qui lit `email_ok` reste à l'accord seul (scénarios, recettes,
--      SMS, « Qui cibler »).
--   2. Lecteurs d'AFFICHAGE : le « joignable par e-mail » compte email_ok OU
--      email_cust (Clients, segments, Accueil, audiences du Studio, filtre
--      « canal »). Liste et fiche client rendent `email_basis`.
--   3. Choix AUTOMATIQUE de la base légale d'une campagne marketing du CRM : au
--      passage en « programmée / en cours », la base devient `customer` si la base
--      du compte est ouverte ET le contenu ne parle que de ses soirées, sinon
--      `consent` (la campagne part, sans les « Pas de mention »). Le pro ne choisit
--      plus rien ; la garde, la file et le moteur d'envoi sont inchangés.
--      « Envoyer maintenant » (un brouillon mis en file) : la même règle juste avant
--      la résolution de l'audience, dans enqueue_campaign_recipients.
--   4. `crm_email_audience_unified(campagne)` : ce que viserait la campagne, en UN nombre.
-- Aucun envoi, aucune donnée touchée.

SET lock_timeout = '3s';

-- ── 1. La colonne `email_cust` de la base des personnes ─────────────────────
DO $$
DECLARE
  v_def text; v_new text;
  v_anchor text := E'  SELECT count(*) INTO v_n FROM _cp;\n  RETURN v_n;';
BEGIN
  v_def := pg_get_functiondef('public._crm_people_build(text, uuid, timestamp with time zone, boolean)'::regprocedure);
  IF position('email_cust' IN v_def) = 0 THEN
    IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION '_crm_people_build : repère de fin introuvable'; END IF;
    v_new := replace(v_def, v_anchor,
E'  -- « Pas de mention » (20261119100000) : client éligible de « Vos clients », sans accord,
  -- dont la base est OUVERTE (signée et à jour). Un compte qui n''a pas signé n''en a aucun.
  ALTER TABLE _cp ADD COLUMN email_cust boolean NOT NULL DEFAULT false;
  IF v_scope IS NOT NULL AND public.crm_customer_basis_open(p_venue_id, p_organizer_user_id) THEN
    UPDATE _cp p SET email_cust = true
      FROM public.crm_customer_contacts cc
     WHERE cc.scope_key = v_scope AND cc.email = p.email AND cc.state = ''eligible'' AND NOT p.email_ok;
  END IF;

' || v_anchor);
    EXECUTE v_new;
  END IF;

  -- Billetterie : la même colonne, toujours fausse (_crm_filter_sql la lit des deux côtés).
  v_def := pg_get_functiondef('public._tix_people_build(text, uuid, timestamp with time zone, boolean)'::regprocedure);
  IF position('email_cust' IN v_def) = 0 THEN
    IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION '_tix_people_build : repère de fin introuvable'; END IF;
    v_new := replace(v_def, v_anchor,
E'  -- Colonne lue par _crm_filter_sql (20261119100000) : jamais de « clients » côté Billetterie.
  ALTER TABLE _cp ADD COLUMN email_cust boolean NOT NULL DEFAULT false;

' || v_anchor);
    EXECUTE v_new;
  END IF;
END $$;

-- ── 2. Lecteurs d'affichage : « joignable par e-mail » = accord OU « Pas de mention » ──
-- Chaque repère DOIT être trouvé (sinon la migration échoue, rien n'est posé à moitié).
-- L'Accueil lit la base de contacts `_cr` (contact_build_rows), pas `_cp` : même colonne.
CREATE OR REPLACE FUNCTION public._crm_customer_mark_cr(p_venue_id text, p_organizer_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF to_regclass('pg_temp._cr') IS NULL THEN RETURN; END IF;
  ALTER TABLE _cr ADD COLUMN IF NOT EXISTS email_cust boolean NOT NULL DEFAULT false;
  UPDATE _cr c SET email_cust = false WHERE c.email_cust;
  IF v_key IS NOT NULL AND public.crm_customer_basis_open(p_venue_id, p_organizer_user_id) THEN
    UPDATE _cr c SET email_cust = true
      FROM public.crm_customer_contacts cc
     WHERE cc.scope_key = v_key AND cc.email = lower(c.email) AND cc.state = 'eligible' AND NOT c.email_ok;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_customer_mark_cr(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_customer_mark_cr(text, uuid) TO service_role;

CREATE TEMP TABLE _patch (fn text, ord int, old text, new text);
INSERT INTO _patch (fn, ord, old, new) VALUES
  -- filtre « canal joignable » et « seuls / ensemble »
  ('_crm_filter_sql', 1, $o$format('%s.email_ok', a)$o$, $n$format('(%s.email_ok OR %s.email_cust)', a, a)$n$),
  ('_crm_filter_sql', 2, $o$format('(NOT %s.email_ok AND NOT %s.phone_ok)', a, a)$o$, $n$format('(NOT %s.email_ok AND NOT %s.email_cust AND NOT %s.phone_ok)', a, a, a)$n$),
  ('_crm_filter_sql', 3, $o$format('(%s.email_ok AND %s.phone_ok)', a, a)$o$, $n$format('((%s.email_ok OR %s.email_cust) AND %s.phone_ok)', a, a, a)$n$),
  ('_crm_filter_sql', 4, $o$format('(%s.email_ok AND NOT %s.phone_ok)', a, a)$o$, $n$format('((%s.email_ok OR %s.email_cust) AND NOT %s.phone_ok)', a, a, a)$n$),
  ('_crm_filter_sql', 5, $o$format('(%s.phone_ok AND NOT %s.email_ok)', a, a)$o$, $n$format('(%s.phone_ok AND NOT (%s.email_ok OR %s.email_cust))', a, a, a)$n$),
  -- écran Clients
  ('crm_clients_overview', 1, $o$(email_ok OR phone_ok)$o$, $n$(email_ok OR email_cust OR phone_ok)$n$),
  ('crm_clients_overview', 2, $o$WHERE email_ok OR phone_ok)$o$, $n$WHERE email_ok OR email_cust OR phone_ok)$n$),
  ('crm_clients_overview', 3, $o$WHERE NOT email_ok AND NOT phone_ok)$o$, $n$WHERE NOT email_ok AND NOT email_cust AND NOT phone_ok)$n$),
  ('crm_clients_list__core', 1, $o$'email_ok', p.email_ok,$o$,
     $n$'email_ok', (p.email_ok OR p.email_cust), 'email_basis', CASE WHEN p.email_ok THEN 'consent' WHEN p.email_cust THEN 'customer' END,$n$),
  ('crm_client__core', 1, $o$'email_ok', v_p.email_ok,$o$,
     $n$'email_ok', (v_p.email_ok OR v_p.email_cust), 'email_basis', CASE WHEN v_p.email_ok THEN 'consent' WHEN v_p.email_cust THEN 'customer' END,$n$),
  -- segments
  ('crm_audience_counts', 1, $o$p.email_ok OR p.phone_ok$o$, $n$p.email_ok OR p.email_cust OR p.phone_ok$n$),
  ('crm_audience_count', 1, $o$FILTER (WHERE email_ok)$o$, $n$FILTER (WHERE email_ok OR email_cust)$n$),
  ('crm_audience_count', 2, $o$FILTER (WHERE p.email_ok)$o$, $n$FILTER (WHERE p.email_ok OR p.email_cust)$n$),
  ('crm_segments_brief', 1, $o$p.email_ok OR p.phone_ok$o$, $n$p.email_ok OR p.email_cust OR p.phone_ok$n$),
  ('crm_segment_catalog', 1, $o$p.email_ok OR p.phone_ok$o$, $n$p.email_ok OR p.email_cust OR p.phone_ok$n$),
  ('crm_segments_overview__core', 1, $o$p.email_ok OR p.phone_ok$o$, $n$p.email_ok OR p.email_cust OR p.phone_ok$n$),
  ('crm_segments_overview__core', 2, $o$FILTER (WHERE p.email_ok),$o$, $n$FILTER (WHERE p.email_ok OR p.email_cust),$n$),
  -- Accueil : carte « joignables » (sur _cr, marquée juste après sa construction)
  ('crm_home__core', 0, $o$v_n_contacts := public.contact_build_rows(p_venue_id, p_organizer_user_id, 'crm');$o$,
     $n$v_n_contacts := public.contact_build_rows(p_venue_id, p_organizer_user_id, 'crm');
  PERFORM public._crm_customer_mark_cr(p_venue_id, p_organizer_user_id);$n$),
  ('crm_home__core', 1, $o$FILTER (WHERE email_ok OR phone_ok)$o$, $n$FILTER (WHERE email_ok OR email_cust OR phone_ok)$n$),
  ('crm_home__core', 2, $o$FILTER (WHERE email_ok AND phone_ok)$o$, $n$FILTER (WHERE (email_ok OR email_cust) AND phone_ok)$n$),
  ('crm_home__core', 3, $o$FILTER (WHERE email_ok AND NOT phone_ok)$o$, $n$FILTER (WHERE (email_ok OR email_cust) AND NOT phone_ok)$n$),
  ('crm_home__core', 4, $o$FILTER (WHERE phone_ok AND NOT email_ok)$o$, $n$FILTER (WHERE phone_ok AND NOT (email_ok OR email_cust))$n$),
  ('crm_home__core', 5, $o$FILTER (WHERE NOT email_ok AND NOT phone_ok)$o$, $n$FILTER (WHERE NOT email_ok AND NOT email_cust AND NOT phone_ok)$n$),
  ('crm_home__core', 6, $o$c.email = reg.email AND c.email_ok)$o$, $n$c.email = reg.email AND (c.email_ok OR c.email_cust))$n$),
  -- Export de la base : l'e-mail joignable et son étiquette (colonne ajoutée à la fin)
  ('crm_clients_export__core', 1, $o$p.spent, p.email_ok, p.phone_ok, p.source,$o$, $n$p.spent, (p.email_ok OR p.email_cust), p.phone_ok, p.source,$n$),
  ('crm_clients_export__core', 2, $o$array_to_string(COALESCE(p.tags, '{}'), ' ; '))$o$,
     $n$array_to_string(COALESCE(p.tags, '{}'), ' ; '), CASE WHEN p.email_ok THEN 'consent' WHEN p.email_cust THEN 'customer' END)$n$),
  ('crm_clients_export__core', 3, $o$"source","tags"]$o$, $n$"source","tags","email_basis"]$n$),
  -- « Qui cibler » et plan de soirée
  ('crm_night_targets', 1, $o$FILTER (WHERE c.email_ok)$o$, $n$FILTER (WHERE c.email_ok OR c.email_cust)$n$),
  ('crm_night_plan', 1, $o$FILTER (WHERE p.email_ok)::int AS ne$o$, $n$FILTER (WHERE p.email_ok OR p.email_cust)::int AS ne$n$),
  -- Parcours client
  ('_crm_journey_person', 1, $o$p.nights, p.email_ok, p.phone_ok$o$, $n$p.nights, (p.email_ok OR p.email_cust), p.phone_ok$n$),
  ('crm_journey__core', 1, $o$COALESCE(p.email_ok, false) AS email_ok$o$, $n$COALESCE(p.email_ok OR p.email_cust, false) AS email_ok$n$),
  -- Analyses › E-mails (audience) et Communauté (canaux, à réveiller)
  ('crm_email_analysis__core', 1, $o$FILTER (WHERE p.email_ok)$o$, $n$FILTER (WHERE p.email_ok OR p.email_cust)$n$),
  ('crm_email_analysis__core', 2, $o$NOT p.email_ok AND$o$, $n$NOT (p.email_ok OR p.email_cust) AND$n$),
  ('crm_email_analysis__core', 3, $o$FILTER (WHERE q.email_ok)$o$, $n$FILTER (WHERE q.email_ok OR q.email_cust)$n$),
  ('crm_ana_community__core', 1, $o$FILTER (WHERE email_ok AND phone_ok)$o$, $n$FILTER (WHERE (email_ok OR email_cust) AND phone_ok)$n$),
  ('crm_ana_community__core', 2, $o$FILTER (WHERE email_ok AND NOT phone_ok)$o$, $n$FILTER (WHERE (email_ok OR email_cust) AND NOT phone_ok)$n$),
  ('crm_ana_community__core', 3, $o$FILTER (WHERE phone_ok AND NOT email_ok)$o$, $n$FILTER (WHERE phone_ok AND NOT (email_ok OR email_cust))$n$),
  ('crm_ana_community__core', 4, $o$FILTER (WHERE NOT email_ok AND NOT phone_ok)$o$, $n$FILTER (WHERE NOT email_ok AND NOT email_cust AND NOT phone_ok)$n$),
  ('crm_ana_community__core', 5, $o$(email_ok OR phone_ok)$o$, $n$(email_ok OR email_cust OR phone_ok)$n$),
  -- Studio : tailles des audiences proposées
  ('crm_email_audience_sizes', 1, $o$WHERE p.email_ok AND (%s)$o$, $n$WHERE (p.email_ok OR p.email_cust) AND (%s)$n$),
  ('crm_email_send_options', 1, $o$WHERE p.email_ok AND EXISTS ($o$, $n$WHERE p.email_cust OR p.email_ok AND EXISTS ($n$);

DO $$
DECLARE r record; q record; v_oid oid; v_def text; v_new text;
BEGIN
  FOR r IN SELECT DISTINCT fn FROM _patch LOOP
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.fn;
    v_def := pg_get_functiondef(v_oid);
    IF position('email_cust' IN v_def) > 0 THEN CONTINUE; END IF;   -- déjà posé
    v_new := v_def;
    FOR q IN SELECT * FROM _patch WHERE fn = r.fn ORDER BY ord LOOP
      IF position(q.old IN v_new) = 0 THEN
        RAISE EXCEPTION '% : repère introuvable : %', r.fn, q.old;
      END IF;
      v_new := replace(v_new, q.old, q.new);
    END LOOP;
    EXECUTE v_new;
  END LOOP;
END $$;

DROP TABLE _patch;

-- ── 3. Choix automatique de la base légale d'une campagne ───────────────────
-- Ce qu'il adviendrait des « Pas de mention » pour cette campagne : `include` =
-- base ouverte ET campagne marketing manuelle ET contenu limité aux soirées du
-- compte. Sinon la campagne ne vise que les personnes qui ont donné leur accord.
CREATE OR REPLACE FUNCTION public._crm_customer_auto(c public.email_campaigns)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_issues jsonb;
BEGIN
  IF c.product IS DISTINCT FROM 'crm' OR COALESCE(c.practical, false) OR c.type IS NOT DISTINCT FROM 'informational'
     OR (c.venue_id IS NULL AND c.organizer_user_id IS NULL) THEN
    RETURN jsonb_build_object('include', false, 'reason', 'scope');
  END IF;
  IF COALESCE(c.resend_enabled, false) OR COALESCE(c.followup_enabled, false)
     OR c.automation_id IS NOT NULL OR c.child_kind IS NOT NULL OR c.parent_campaign_id IS NOT NULL THEN
    RETURN jsonb_build_object('include', false, 'reason', 'feature');
  END IF;
  IF NOT public.crm_customer_basis_open(c.venue_id, c.organizer_user_id) THEN
    RETURN jsonb_build_object('include', false, 'reason', 'closed');
  END IF;
  v_issues := public._crm_customer_content_issues(c.blocks_json, c.event_id, c.venue_id, c.organizer_user_id);
  IF jsonb_array_length(v_issues) > 0 THEN
    RETURN jsonb_build_object('include', false, 'reason', 'content', 'issues', v_issues);
  END IF;
  RETURN jsonb_build_object('include', true, 'reason', NULL);
END;
$$;

-- La garde pose la base légale au passage en « programmée / en cours » (brouillon
-- ou programmée seulement : une campagne partie la garde, c'est sa preuve).
DO $$
DECLARE
  v_def text; v_new text;
  v_anchor text := E'  IF NEW.legal_basis IS DISTINCT FROM ''customer'' THEN RETURN NEW; END IF;';
BEGIN
  v_def := pg_get_functiondef('public.guard_crm_customer_basis()'::regprocedure);
  IF position('_crm_customer_auto' IN v_def) > 0 THEN RETURN; END IF;   -- déjà posé
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'guard_crm_customer_basis : repère introuvable';
  END IF;
  v_new := replace(v_def, v_anchor,
E'  -- Choix automatique (20261119100000) : le pro ne choisit pas la base légale. « customer »
  -- si la base du compte est ouverte ET que le contenu ne parle que de ses soirées,
  -- « consent » sinon (la campagne part, sans les clients qui n''ont rien dit).
  IF NEW.status IN (''sending'', ''scheduled'') AND (TG_OP = ''INSERT'' OR OLD.status IN (''draft'', ''scheduled''))
     AND NEW.legal_basis IN (''consent'', ''customer'') THEN
    NEW.legal_basis := CASE WHEN COALESCE((public._crm_customer_auto(NEW)->>''include'')::boolean, false)
                            THEN ''customer'' ELSE ''consent'' END;
  END IF;
' || v_anchor);
  EXECUTE v_new;
END $$;

-- « Envoyer maintenant » met en file un BROUILLON (le statut ne passe à « en cours »
-- qu'après la résolution de l'audience) : la base légale se pose donc aussi juste
-- avant, dans enqueue_campaign_recipients, pour que l'audience résolue soit la bonne.
DO $$
DECLARE
  v_def text; v_new text;
  v_anchor text := E'  v_res := public._enqueue_campaign_recipients_core(p_campaign_id);';
BEGIN
  v_def := pg_get_functiondef('public.enqueue_campaign_recipients(uuid)'::regprocedure);
  IF position('_crm_customer_auto' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_def) = 0 OR position(E'  v_pct integer;\nBEGIN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients : repère introuvable';
  END IF;
  v_new := replace(v_def, E'  v_pct integer;\nBEGIN', E'  v_pct integer;\n  v_lb text;\nBEGIN');
  v_new := replace(v_new, v_anchor,
E'  -- Base légale posée AVANT la résolution (20261119100000) : un brouillon envoyé tout de suite.
  IF v_crm THEN
    SELECT CASE WHEN COALESCE((public._crm_customer_auto(c)->>''include'')::boolean, false) THEN ''customer'' ELSE ''consent'' END
      INTO v_lb FROM public.email_campaigns c WHERE c.id = p_campaign_id;
    UPDATE public.email_campaigns c SET legal_basis = v_lb
     WHERE c.id = p_campaign_id AND c.status IN (''draft'', ''scheduled'') AND c.legal_basis IS DISTINCT FROM v_lb
       AND NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.campaign_id = p_campaign_id);
  END IF;
' || v_anchor);
  EXECUTE v_new;
END $$;

-- ── 4. Ce que viserait une campagne, en UN nombre ───────────────────────────
-- `_crm_customer_campaign_audience` devient un cœur à deux modes : `p_force`
-- l'exécute même quand la campagne n'est pas encore « customer » (aperçu), le reste
-- est mot pour mot celui du lot 2. L'ancienne fonction en est le raccourci.
DO $$
DECLARE v_def text; v_new text;
BEGIN
  IF to_regprocedure('public._crm_customer_audience_core(uuid, boolean, boolean)') IS NOT NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public._crm_customer_campaign_audience(uuid)'::regprocedure);
  v_new := replace(v_def, 'public._crm_customer_campaign_audience(p_campaign_id uuid)', 'public._crm_customer_audience_core(p_campaign_id uuid, p_force boolean, p_raw boolean DEFAULT false)');
  IF v_new = v_def THEN RAISE EXCEPTION '_crm_customer_campaign_audience : en-tête introuvable'; END IF;
  v_def := v_new;
  v_new := replace(v_def, 'OR c.legal_basis <> ''customer'' THEN RETURN; END IF;', 'OR (NOT p_force AND c.legal_basis <> ''customer'') THEN RETURN; END IF;');
  IF v_new = v_def THEN RAISE EXCEPTION '_crm_customer_campaign_audience : condition introuvable'; END IF;
  -- `p_raw` : sans les exclusions de la campagne (acheteurs de la soirée, déjà écrits
  -- ces N jours), pour que l'aperçu dise combien chacune retire.
  v_def := v_new;
  v_new := replace(v_def, E'  v_same := CASE WHEN v_recent IS NULL', E'  IF p_raw THEN v_recent := NULL; v_excl_buyers := false; END IF;
  v_same := CASE WHEN v_recent IS NULL');
  IF v_new = v_def THEN RAISE EXCEPTION '_crm_customer_campaign_audience : exclusions introuvables'; END IF;
  EXECUTE v_new;
END $$;
REVOKE ALL ON FUNCTION public._crm_customer_audience_core(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_customer_audience_core(uuid, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_customer_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public._crm_customer_audience_core(p_campaign_id, false);
$$;

CREATE OR REPLACE FUNCTION public.crm_email_audience_unified(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.email_campaigns%ROWTYPE;
  v_auto jsonb;
  v_key text;
  v_total int; v_customer int; v_cap int; v_today int;
  v_reach int; v_buyers int := 0; v_raw text[];
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR NOT public.crm_scope_allowed(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_auto := public._crm_customer_auto(c);
  IF NOT COALESCE((v_auto->>'include')::boolean, false) THEN RETURN v_auto; END IF;

  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  -- Trois lectures de la même base : elle n'est construite qu'une fois (mémoire de transaction).
  PERFORM set_config('yuno.crm_cp_memo', v_key, true);
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.crm_customer_contacts cc WHERE cc.unsubscribe_token = a.unsubscribe_token))
    INTO v_total, v_customer
    FROM public._crm_customer_audience_core(p_campaign_id, true) a;
  -- Sans exclusions : la base de l'audience, et ses acheteurs de la soirée (même lecture
  -- que crm_email_audience_preview : reach, x_buyers, x_recent, net).
  SELECT COALESCE(array_agg(a.email), '{}') INTO v_raw FROM public._crm_customer_audience_core(p_campaign_id, true, true) a;
  v_reach := cardinality(v_raw);
  IF c.event_id IS NOT NULL AND COALESCE(c.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1') THEN
    SELECT count(*) INTO v_buyers FROM _cp p WHERE p.email = ANY (v_raw) AND c.event_id = ANY (p.events);
  END IF;
  SELECT COALESCE(b.ramp_cap, s.ramp_start) INTO v_cap
    FROM public.crm_customer_basis_settings s LEFT JOIN public.crm_customer_basis b ON b.scope_key = v_key WHERE s.id = 1;
  SELECT count(*) INTO v_today
    FROM public.email_campaign_recipients r JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
   WHERE r.legal_basis = 'customer' AND c2.venue_id IS NOT DISTINCT FROM c.venue_id AND c2.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id
     AND r.status IN ('pending', 'sending', 'sent', 'bounced', 'complained')
     AND (COALESCE(r.sent_at, r.next_attempt_at, now()) AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date;
  -- `ramp_waiting` : ceux que la montée progressive laisse partir les jours suivants (le total ne change pas).
  RETURN v_auto || jsonb_build_object('total', v_total, 'reach', v_reach, 'x_buyers', v_buyers,
    'x_recent', GREATEST(0, v_reach - v_total - v_buyers),
    'ramp_waiting', GREATEST(0, v_customer - GREATEST(0, v_cap - v_today)));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_email_audience_unified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_audience_unified(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._crm_customer_auto(public.email_campaigns) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_customer_auto(public.email_campaigns) TO service_role;

-- L'aperçu démo (transaction en lecture seule) lit ce compte comme l'ancien aperçu « clients ».
DO $$
DECLARE v_def text; v_new text;
  v_anchor text := '''crm_customer_audience_preview''';
BEGIN
  v_def := pg_get_functiondef('public.demo_preview_writable_rpc(text)'::regprocedure);
  IF position('crm_email_audience_unified' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'demo_preview_writable_rpc : repère « crm_customer_audience_preview » introuvable';
  END IF;
  v_new := replace(v_def, v_anchor, v_anchor || ', ''crm_email_audience_unified''');
  EXECUTE v_new;
END $$;
