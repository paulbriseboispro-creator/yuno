-- Modèles propres à une soirée (demande de Paul, 03/11) : chaque recette garde son
-- modèle de BASE ; pour une soirée précise, le pro peut poser un modèle UNIQUE et
-- TEMPORAIRE qui remplace le modèle de base pour cette soirée seulement — et une
-- campagne peut relancer ses cliqueurs avec un modèle propre à sa soirée. Premier
-- usage : la relance « A cliqué sans acheter » de l'Act III de 3 AM.
--
--   1. `email_campaign_templates.for_event_id` : un modèle PROPRE À UNE SOIRÉE. Il
--      garde ses blocs reliés à la soirée (exception à stripEventBindings), n'entre
--      dans AUCUNE bibliothèque (le front filtre `for_event_id IS NULL`), et
--      `expires_at` (fin de la soirée + 14 jours) est posé par la base, jamais par le
--      client. La soirée doit être une soirée de la portée (miroir du compte pour le
--      CRM, soirée menée / partenaire / co-hébergée pour la Billetterie) et ne change
--      jamais après la création.
--   2. `email_automation_event_templates` : un modèle propre par (recette, soirée),
--      écrit par la seule RPC `email_automation_event_template_set`. Retirer le lien
--      ne supprime pas le modèle (une campagne peut s'en servir) : il expire seul.
--   3. Le modèle de BASE d'une recette n'est jamais un modèle de soirée (garde).
--   4. collect_email_automations : pour chaque soirée d'une recette (la soirée qui
--      déclenche, sinon celle annoncée), le modèle propre non expiré remplace le
--      modèle de base ; l'objet du modèle propre l'emporte sur l'objet de la recette.
--      Une campagne enfant déjà en route garde son contenu ; un modèle différent ouvre
--      une nouvelle campagne enfant. Le reste (registre, politique d'envoi, Yunits,
--      identité, gel, démo) ne change pas : seules les lignes du modèle changent.
--   5. collect_campaign_followups : un modèle propre à une AUTRE soirée ne sert jamais.
--   6. Chaque campagne enfant (recette ou relance) dit quel modèle a servi :
--      `source_template_id` et `source_template_event_id` (NULL = modèle de base).
--   7. Purge quotidienne des modèles de soirée expirés depuis 30 jours (les campagnes
--      parties gardent leur contenu et `source_template_event_id`).
-- Aucun envoi, aucune donnée touchée.

SET lock_timeout = '3s';

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────
ALTER TABLE public.email_campaign_templates
  ADD COLUMN IF NOT EXISTS for_event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_email_campaign_templates_for_event
  ON public.email_campaign_templates (for_event_id) WHERE for_event_id IS NOT NULL;
COMMENT ON COLUMN public.email_campaign_templates.for_event_id IS
  'Modèle propre à UNE soirée (20261123100000) : hors bibliothèque, blocs reliés à la soirée, expire seul (expires_at).';
COMMENT ON COLUMN public.email_campaign_templates.expires_at IS
  'Modèle de soirée : fin de la soirée + 14 jours, posé par la base. Après, le modèle de base reprend.';

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES public.email_campaign_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_template_event_id uuid;
CREATE INDEX IF NOT EXISTS idx_email_campaigns_source_template
  ON public.email_campaigns (source_template_id) WHERE source_template_id IS NOT NULL;
COMMENT ON COLUMN public.email_campaigns.source_template_id IS
  'Campagne enfant (recette, relance) : le modèle qui a servi.';
COMMENT ON COLUMN public.email_campaigns.source_template_event_id IS
  'Campagne enfant : soirée du modèle propre qui a servi ; NULL = modèle de base.';

-- ── 2. La soirée d'un modèle appartient à la portée ─────────────────────────
CREATE OR REPLACE FUNCTION public._email_template_event_in_scope(p_venue_id text, p_organizer_user_id uuid, p_product text, p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_event_id IS NOT NULL AND (p_venue_id IS NOT NULL OR p_organizer_user_id IS NOT NULL) AND CASE
    WHEN p_product = 'crm' THEN public._crm_customer_own_event(p_venue_id, p_organizer_user_id, p_event_id)
    ELSE EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = p_event_id AND e.external_source IS NULL
         AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
                                           OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id))))
           OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
                                           OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id))))))
  END;
$$;
REVOKE ALL ON FUNCTION public._email_template_event_in_scope(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Écrire ou lire les modèles de soirée d'une portée : CRM = règles de la Console CRM ;
-- Billetterie = celles des automatisations (propriétaire du club, l'organisateur).
CREATE OR REPLACE FUNCTION public._email_event_tpl_scope_ok(p_venue_id text, p_organizer_user_id uuid, p_product text, p_write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN false
    WHEN p_product = 'crm' THEN
      CASE WHEN p_write THEN public.crm_scope_writable(p_venue_id, p_organizer_user_id)
           ELSE public.crm_scope_allowed(p_venue_id, p_organizer_user_id) END
    ELSE COALESCE(auth.role(), '') = 'service_role'
      OR (auth.uid() IS NOT NULL AND (public.is_super_admin()
          OR (p_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), p_venue_id))
          OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid())))
  END;
$$;
REVOKE ALL ON FUNCTION public._email_event_tpl_scope_ok(text, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_email_template_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.for_event_id IS DISTINCT FROM OLD.for_event_id THEN
    RAISE EXCEPTION 'event_template_locked' USING ERRCODE = '22023',
      HINT = 'La soirée d''un modèle ne change pas : créer un autre modèle.';
  END IF;
  IF NEW.for_event_id IS NULL THEN
    NEW.expires_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NOT public._email_template_event_in_scope(NEW.venue_id, NEW.organizer_user_id, NEW.product, NEW.for_event_id) THEN
    RAISE EXCEPTION 'event_not_in_scope' USING ERRCODE = '42501';
  END IF;
  -- Fin de la soirée + 14 jours : de quoi couvrir le merci et « on t'a manqué ».
  SELECT COALESCE(e.end_at, e.start_at + interval '8 hours') + interval '14 days'
    INTO NEW.expires_at FROM public.events e WHERE e.id = NEW.for_event_id;
  RETURN NEW;
END;
$$;
-- Après trg_email_campaign_templates_product_default (ordre alphabétique) : le produit est posé.
DROP TRIGGER IF EXISTS trg_email_campaign_templates_zz_event ON public.email_campaign_templates;
CREATE TRIGGER trg_email_campaign_templates_zz_event
  BEFORE INSERT OR UPDATE ON public.email_campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_email_template_event();

-- ── 3. Le modèle de base d'une recette n'est jamais un modèle de soirée ──────
CREATE OR REPLACE FUNCTION public.guard_automation_base_template()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.template_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id)
     AND EXISTS (SELECT 1 FROM public.email_campaign_templates t WHERE t.id = NEW.template_id AND t.for_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'event_template_not_base' USING ERRCODE = '22023',
      HINT = 'Un modèle propre à une soirée se pose sur la soirée, pas comme modèle de base.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_email_automations_base_template ON public.email_automations;
CREATE TRIGGER trg_email_automations_base_template
  BEFORE INSERT OR UPDATE OF template_id ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public.guard_automation_base_template();

-- ── 4. Un modèle propre par (recette, soirée) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_automation_event_templates (
  automation_id uuid NOT NULL REFERENCES public.email_automations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.email_campaign_templates(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_email_automation_event_templates_tpl ON public.email_automation_event_templates (template_id);
ALTER TABLE public.email_automation_event_templates ENABLE ROW LEVEL SECURITY;
-- Aucune policy : tout passe par les RPC ci-dessous.
REVOKE ALL ON public.email_automation_event_templates FROM anon, authenticated;
COMMENT ON TABLE public.email_automation_event_templates IS
  'Modèle propre à une soirée pour une recette (20261123100000) ; écrit par email_automation_event_template_set seule.';

CREATE OR REPLACE FUNCTION public.email_automation_event_template_set(p_automation_id uuid, p_event_id uuid, p_template_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.email_automations%ROWTYPE;
  v_prod text;
BEGIN
  SELECT * INTO a FROM public.email_automations WHERE id = p_automation_id;
  IF a.id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'automation_not_found' USING ERRCODE = '22023'; END IF;
  v_prod := CASE WHEN COALESCE(public._email_recipe_is_crm(a.product, a.kind, a.venue_id, a.organizer_user_id), false) THEN 'crm' END;
  IF NOT public._email_event_tpl_scope_ok(a.venue_id, a.organizer_user_id, v_prod, true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Retirer : la recette reprend son modèle de base pour cette soirée. Le modèle
  -- reste (une campagne peut s'en servir) et expire seul.
  IF p_template_id IS NULL THEN
    DELETE FROM public.email_automation_event_templates WHERE automation_id = a.id AND event_id = p_event_id;
    RETURN jsonb_build_object('ok', true, 'removed', true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_campaign_templates t
     WHERE t.id = p_template_id AND t.for_event_id = p_event_id
       AND t.venue_id IS NOT DISTINCT FROM a.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM a.organizer_user_id
       AND t.product IS NOT DISTINCT FROM v_prod
  ) THEN
    RAISE EXCEPTION 'bad_template' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.email_automation_event_templates (automation_id, event_id, template_id, created_by)
  VALUES (a.id, p_event_id, p_template_id, auth.uid())
  ON CONFLICT (automation_id, event_id) DO UPDATE
    SET template_id = EXCLUDED.template_id, created_by = EXCLUDED.created_by, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'removed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.email_automation_event_template_set(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_automation_event_template_set(uuid, uuid, uuid) TO authenticated, service_role;

-- Les modèles de soirée d'une portée, non expirés depuis plus de 30 jours, avec ce qui
-- s'en sert (recettes, relances de campagne) et combien d'e-mails ils ont fait partir.
CREATE OR REPLACE FUNCTION public.email_event_templates(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prod text := CASE WHEN p_product = 'crm' THEN 'crm' END;
BEGIN
  IF NOT public._email_event_tpl_scope_ok(p_venue_id, p_organizer_user_id, v_prod, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', t.id, 'name', t.name, 'subject', t.subject, 'updated_at', t.updated_at,
             'event_id', t.for_event_id, 'event_title', e.title, 'event_start', e.start_at,
             'expires_at', t.expires_at, 'expired', t.expires_at <= now(),
             'automations', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind) ORDER BY a.kind)
                 FROM public.email_automation_event_templates o
                 JOIN public.email_automations a ON a.id = o.automation_id
                WHERE o.template_id = t.id), '[]'::jsonb),
             'campaigns', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status) ORDER BY c.created_at DESC)
                 FROM public.email_campaigns c
                WHERE c.followup_template_id = t.id AND c.parent_campaign_id IS NULL), '[]'::jsonb),
             'sent', (SELECT count(*) FROM public.email_campaigns c
                        JOIN public.email_campaign_recipients r ON r.campaign_id = c.id
                       WHERE c.source_template_id = t.id AND r.status = 'sent')
           ) ORDER BY e.start_at, t.updated_at DESC)
      FROM public.email_campaign_templates t
      JOIN public.events e ON e.id = t.for_event_id
     WHERE t.for_event_id IS NOT NULL
       AND t.venue_id IS NOT DISTINCT FROM p_venue_id AND t.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND t.product IS NOT DISTINCT FROM v_prod
       AND (t.expires_at IS NULL OR t.expires_at > now() - interval '30 days')), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.email_event_templates(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_event_templates(text, uuid, text) TO authenticated, service_role;

-- ── 5. Les moteurs ──────────────────────────────────────────────────────────
-- Remplacements ciblés sur la définition VIVANTE (jamais une copie d'une ancienne
-- migration) ; un repère introuvable fait échouer la migration.
CREATE TEMP TABLE _patch_evtpl (fn text, ord int, old text, new text);
INSERT INTO _patch_evtpl (fn, ord, old, new) VALUES
  -- Recettes : déclarations.
  ('collect_email_automations()', 1,
   E'  v_same uuid[];\nBEGIN',
   E'  v_same uuid[];\n  -- Modèle propre à la soirée (20261123100000) : le modèle de ce groupe, et sa soirée\n  -- quand c''est un modèle propre (NULL = modèle de base de la recette).\n  v_tpl_id uuid;\n  v_tpl_ev uuid;\nBEGIN'),
  -- Recettes : le modèle de chaque groupe (soirée).
  ('collect_email_automations()', 2,
   E'       GROUP BY l.bind_event_id, l.trigger_event_id\n    LOOP\n',
   E'       GROUP BY l.bind_event_id, l.trigger_event_id\n    LOOP\n'
   || E'      -- Modèle propre à CETTE soirée (celle qui déclenche, sinon celle annoncée), non\n'
   || E'      -- expiré : il remplace le modèle de base pour ce groupe seulement.\n'
   || E'      v_tpl_ev := NULL;\n'
   || E'      SELECT o.template_id, t.for_event_id INTO v_tpl_id, v_tpl_ev\n'
   || E'        FROM public.email_automation_event_templates o\n'
   || E'        JOIN public.email_campaign_templates t ON t.id = o.template_id\n'
   || E'       WHERE o.automation_id = a.id AND o.event_id = COALESCE(grp.trigger_event_id, grp.bind_event_id)\n'
   || E'         AND t.for_event_id = o.event_id AND (t.expires_at IS NULL OR t.expires_at > now())\n'
   || E'         AND t.venue_id IS NOT DISTINCT FROM a.venue_id AND t.organizer_user_id IS NOT DISTINCT FROM a.organizer_user_id\n'
   || E'       LIMIT 1;\n'
   || E'      IF NOT FOUND THEN v_tpl_id := a.template_id; v_tpl_ev := NULL; END IF;\n'
   || E'      SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = v_tpl_id;\n'
   || E'      IF tpl.id IS NULL THEN CONTINUE; END IF;\n'),
  -- Recettes : une campagne enfant par modèle (un enfant déjà en route garde son contenu).
  ('collect_email_automations()', 3,
   E'         AND c.status NOT IN (''cancelled'', ''failed'')\n       ORDER BY c.created_at DESC',
   E'         AND c.status NOT IN (''cancelled'', ''failed'')\n'
   || E'         AND (c.source_template_id = v_tpl_id OR (c.source_template_id IS NULL AND v_tpl_ev IS NULL))\n'
   || E'       ORDER BY c.created_at DESC'),
  -- Recettes : l'objet d'un modèle propre l'emporte sur l'objet de la recette.
  ('collect_email_automations()', 4,
   E'COALESCE(NULLIF(a.subject, ''''), NULLIF(tpl.subject, ''''), tpl.name)',
   E'CASE WHEN v_tpl_ev IS NOT NULL THEN COALESCE(NULLIF(tpl.subject, ''''), NULLIF(a.subject, ''''), tpl.name)\n'
   || E'                ELSE COALESCE(NULLIF(a.subject, ''''), NULLIF(tpl.subject, ''''), tpl.name) END'),
  ('collect_email_automations()', 5,
   E'child_kind, total_recipients, created_by, product)',
   E'child_kind, total_recipients, created_by, product,\n           source_template_id, source_template_event_id)'),
  ('collect_email_automations()', 6,
   E'''automation'', 0, COALESCE(a.created_by, tpl.created_by), v_prod)',
   E'''automation'', 0, COALESCE(a.created_by, tpl.created_by), v_prod,\n           tpl.id, v_tpl_ev)'),
  -- Relance après clic : un modèle propre à une autre soirée ne sert jamais.
  ('collect_campaign_followups()', 1,
   E'    IF tpl.id IS NULL THEN CONTINUE; END IF;\n',
   E'    IF tpl.id IS NULL THEN CONTINUE; END IF;\n'
   || E'    -- Modèle propre à une AUTRE soirée (20261123100000) : jamais.\n'
   || E'    IF tpl.for_event_id IS NOT NULL AND tpl.for_event_id IS DISTINCT FROM p.event_id THEN CONTINUE; END IF;\n'),
  ('collect_campaign_followups()', 2,
   E'child_kind, total_recipients, created_by, product, legal_basis)',
   E'child_kind, total_recipients, created_by, product, legal_basis,\n         source_template_id, source_template_event_id)'),
  ('collect_campaign_followups()', 3,
   E'         CASE WHEN v_cust THEN ''customer'' ELSE ''consent'' END)\n      RETURNING id, legal_basis INTO v_child, v_child_lb;',
   E'         CASE WHEN v_cust THEN ''customer'' ELSE ''consent'' END,\n'
   || E'         tpl.id, tpl.for_event_id)\n      RETURNING id, legal_basis INTO v_child, v_child_lb;'),
  -- Scénarios : un nœud e-mail prend un modèle de la bibliothèque, jamais un modèle de soirée.
  ('_crm_scenario_content(text,uuid,jsonb)', 1,
   E'WHERE tp.id = (n.v->>''template_id'')::uuid AND tp.product = ''crm''',
   E'WHERE tp.id = (n.v->>''template_id'')::uuid AND tp.product = ''crm'' AND tp.for_event_id IS NULL'),
  ('_mcp_scenario_tool', 1,
   E'AND t.product = ''crm''\n                 ORDER BY t.updated_at DESC LIMIT 60',
   E'AND t.product = ''crm'' AND t.for_event_id IS NULL\n                 ORDER BY t.updated_at DESC LIMIT 60');

DO $$
DECLARE r record; q record; v_oid oid; v_def text; v_new text;
BEGIN
  FOR r IN SELECT DISTINCT fn FROM _patch_evtpl LOOP
    IF position('(' IN r.fn) > 0 THEN
      v_oid := to_regprocedure('public.' || r.fn);
    ELSE
      SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.fn;
    END IF;
    IF v_oid IS NULL THEN RAISE EXCEPTION 'fonction introuvable : %', r.fn; END IF;
    v_def := pg_get_functiondef(v_oid);
    IF position('20261123100000' IN v_def) > 0 OR position('for_event_id IS NULL' IN v_def) > 0 THEN CONTINUE; END IF;   -- déjà posé
    v_new := v_def;
    FOR q IN SELECT * FROM _patch_evtpl WHERE fn = r.fn ORDER BY ord LOOP
      IF (length(v_new) - length(replace(v_new, q.old, ''))) / length(q.old) <> 1 THEN
        RAISE EXCEPTION '% : repère absent ou ambigu : %', r.fn, left(q.old, 120);
      END IF;
      v_new := replace(v_new, q.old, q.new);
    END LOOP;
    EXECUTE v_new;
  END LOOP;
END $$;
DROP TABLE _patch_evtpl;

-- ── 6. Purge des modèles de soirée expirés ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_expired_event_templates()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.email_campaign_templates t
   WHERE t.for_event_id IS NOT NULL AND t.expires_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_event_templates() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('email-event-templates-purge')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-event-templates-purge');
  PERFORM cron.schedule('email-event-templates-purge', '47 4 * * *', 'SELECT public.purge_expired_event_templates()');
END $$;
