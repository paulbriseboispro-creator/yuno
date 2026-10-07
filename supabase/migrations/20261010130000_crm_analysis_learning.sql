-- ============================================================================
-- Yuno CRM — analyse client, lot E : apprendre sans exposer les données
-- (2026-10-07). Plan : docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md §13.
--
-- Le principe : les données personnelles ne quittent JAMAIS la portée de leur
-- compte. Ce qui en sort, ce sont des COMPTAGES agrégés et anonymes :
--   « 140 passages testés, 61 choix conformes, 33 attendus au hasard ».
--
-- crm_learning_keys      clé de contributeur OPAQUE (aléatoire) par compte,
--                        effacée avec le compte (et ses contributions avec).
-- crm_learning_contrib   une ligne par (contributeur, version des règles,
--                        famille, variante de seuil, trimestre) : O, E, V, n.
--                        Cellules sous 10 supprimées à la source. Jamais :
--                        e-mail, empreinte d'e-mail, identifiant de personne,
--                        titre de soirée, nom d'artiste, ville.
-- crm_learning_priors    leçons communes, publiées seulement si 5 comptes au
--                        moins contribuent ET qu'aucun ne pèse plus de 50 % de
--                        E (règle du secret statistique). Gain commun =
--                        ΣO / ΣE. Lues par les écrans comme « observée sur N
--                        comptes Yuno », jamais comme confirmée ici.
-- Réglage des seuils : chaque compte contribue les comptages d'une petite
--   grille (rareté 10/20/30 %, 1res heures 24/72 h, distance 50/80/150 km).
--   Le meilleur jeu se choisit sur les comptes « laissés de côté » un à un ;
--   il devient une PROPOSITION de nouvelle version des règles, que Paul valide
--   (geste audité, motif obligatoire). Jamais appliqué seul.
--
-- Interdit (et absent de ce code) : entraîner un modèle sur des lignes de
-- personnes, envoyer des données personnelles à une IA pour « apprendre »,
-- croiser deux comptes au niveau d'une personne.
--
-- Drapeaux : crm_settings.learning_contrib (le compte, oui par défaut, refus
-- possible dans Réglages) ET crm_learning_settings.enabled (global, ÉTEINT
-- tant que la clause « statistiques anonymes » n'est pas validée par un
-- juriste — décision de Paul du 07/10). Comptes démo : toujours exclus.
-- ============================================================================

ALTER TABLE public.crm_settings
  ADD COLUMN IF NOT EXISTS learning_contrib boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.crm_learning_settings (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled    boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason     text
);
INSERT INTO public.crm_learning_settings (id, enabled) VALUES (true, false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.crm_learning_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_learning_keys (
  scope_key         text PRIMARY KEY,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  contributor       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
ALTER TABLE public.crm_learning_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_learning_contrib (
  contributor   uuid NOT NULL REFERENCES public.crm_learning_keys(contributor) ON DELETE CASCADE,
  rules_version integer NOT NULL,
  family        text NOT NULL,
  variant       text NOT NULL DEFAULT '',
  quarter       date NOT NULL,
  kind          text NOT NULL,
  o             numeric NOT NULL,
  e             numeric NOT NULL,
  v             numeric NOT NULL,
  n             integer NOT NULL CHECK (n >= 10),
  n0            integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contributor, rules_version, family, variant, quarter)
);
ALTER TABLE public.crm_learning_contrib ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_learning_priors (
  rules_version integer NOT NULL,
  family        text NOT NULL,
  variant       text NOT NULL DEFAULT '',
  kind          text NOT NULL,
  accounts      integer NOT NULL,
  o             numeric NOT NULL,
  e             numeric NOT NULL,
  v             numeric NOT NULL,
  n             integer NOT NULL,
  gain          numeric,
  z             numeric,
  status        text NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rules_version, family, variant)
);
ALTER TABLE public.crm_learning_priors ENABLE ROW LEVEL SECURITY;
-- Aucune policy sur ces tables : service_role et fonctions SECURITY DEFINER.

-- ── 1. Contribution d'un compte (appelée par le moteur, passe complète) ─────
CREATE OR REPLACE FUNCTION public._crm_an_contribute(p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_contributor uuid;
  v_ok boolean;
  v_quarter date := date_trunc('quarter', now())::date;
  v_min int := GREATEST(10, COALESCE((p_cfg->>'min_sample')::int, 10));
BEGIN
  v_ok := COALESCE((SELECT enabled FROM public.crm_learning_settings WHERE id), false)
      AND COALESCE((SELECT s.learning_contrib FROM public.crm_settings s WHERE s.scope_key = v_key), true)
      AND NOT COALESCE(public.is_demo_marketing_scope(p_venue_id, p_organizer_user_id), true);

  IF NOT v_ok THEN
    -- Un compte qui refuse (ou un drapeau global éteint) : rien ne sort, et
    -- ce qui était sorti est retiré.
    DELETE FROM public.crm_learning_contrib c USING public.crm_learning_keys k
     WHERE k.scope_key = v_key AND c.contributor = k.contributor;
    RETURN;
  END IF;

  INSERT INTO public.crm_learning_keys (scope_key, venue_id, organizer_user_id)
  VALUES (v_key, p_venue_id, p_organizer_user_id) ON CONFLICT (scope_key) DO NOTHING;
  SELECT contributor INTO v_contributor FROM public.crm_learning_keys WHERE scope_key = v_key;

  -- Ce trimestre : on remplace. Cellules sous 10 supprimées à la source.
  DELETE FROM public.crm_learning_contrib WHERE contributor = v_contributor AND quarter = v_quarter;
  INSERT INTO public.crm_learning_contrib (contributor, rules_version, family, variant, quarter, kind, o, e, v, n, n0)
  SELECT v_contributor, (p_cfg->>'rules_version')::int, s.family, s.variant, v_quarter, s.kind,
         round(s.o, 4), round(s.e, 4), round(s.v, 4), s.n, s.n0
    FROM _anstat s
   WHERE s.n >= v_min AND (s.kind <> 'return' OR COALESCE(s.n0, 0) >= v_min);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_contribute(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_contribute(text, uuid, jsonb) TO service_role;

-- ── 2. Publication des leçons communes ──────────────────────────────────────
-- Dernier trimestre connu de chaque contributeur. 5 comptes au moins, aucun
-- au-dessus de 50 % de E ; sinon la leçon est retirée.
CREATE OR REPLACE FUNCTION public.crm_learning_publish()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_min_accounts int := 5;
  v_published int;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS _lp;
  CREATE TEMP TABLE _lp ON COMMIT DROP AS
  WITH last AS (
    SELECT DISTINCT ON (c.contributor, c.rules_version, c.family, c.variant) c.*
      FROM public.crm_learning_contrib c
     ORDER BY c.contributor, c.rules_version, c.family, c.variant, c.quarter DESC
  )
  SELECT rules_version, family, variant, min(kind) AS kind, count(*)::int AS accounts,
         sum(o) AS o, sum(e) AS e, sum(v) AS v, sum(n)::int AS n, sum(n0)::int AS n0,
         max(e) / NULLIF(sum(e), 0) AS max_share
    FROM last GROUP BY 1, 2, 3;

  DELETE FROM public.crm_learning_priors p
   WHERE NOT EXISTS (SELECT 1 FROM _lp l WHERE l.rules_version = p.rules_version AND l.family = p.family
                       AND l.variant = p.variant AND l.accounts >= v_min_accounts AND l.max_share <= 0.5);

  INSERT INTO public.crm_learning_priors AS p (rules_version, family, variant, kind, accounts, o, e, v, n, gain, z, status, published_at)
  SELECT l.rules_version, l.family, l.variant, l.kind, l.accounts, l.o, l.e, l.v, l.n,
         CASE WHEN l.e > 0 THEN round(l.o / l.e, 3) END,
         CASE WHEN l.v > 0 THEN round((l.o - l.e) / sqrt(l.v), 3) END,
         public._crm_an_status(l.kind, l.o, l.e, l.v, l.n, l.n0,
                               CASE WHEN l.v > 0 THEN (l.o - l.e) / sqrt(l.v) END, v_cfg),
         now()
    FROM _lp l
   WHERE l.accounts >= v_min_accounts AND l.max_share <= 0.5
  ON CONFLICT (rules_version, family, variant) DO UPDATE SET
    kind = EXCLUDED.kind, accounts = EXCLUDED.accounts, o = EXCLUDED.o, e = EXCLUDED.e, v = EXCLUDED.v,
    n = EXCLUDED.n, gain = EXCLUDED.gain, z = EXCLUDED.z, status = EXCLUDED.status, published_at = now();
  GET DIAGNOSTICS v_published = ROW_COUNT;

  RETURN jsonb_build_object('published', v_published,
                            'contributors', (SELECT count(DISTINCT contributor) FROM public.crm_learning_contrib));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_learning_publish() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_learning_publish() TO authenticated, service_role;

-- ── 3. Proposition de nouveaux seuils (comptes laissés de côté un à un) ────
-- Pour chaque seuil de la grille et chaque contributeur i : la variante qui
-- maximise le z commun des AUTRES comptes ; on la note et on lit son z chez i.
-- La variante choisie le plus souvent l'emporte (puis le meilleur z moyen
-- chez les comptes laissés de côté). 5 contributeurs au moins par seuil. Si
-- un seuil change, une version de règles naît en proposition, inactive.
CREATE OR REPLACE FUNCTION public.crm_learning_propose()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_ver int := (v_cfg->>'rules_version')::int;
  v_new jsonb := v_cfg - 'rules_version';
  v_evidence jsonb := '{}'::jsonb;
  v_changed boolean := false;
  r record;
  v_next int;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    WITH params(param, family, prefix, path, cur) AS (VALUES
      ('resident_share', 'artist', 'res:', ARRAY['rarity', 'resident_share'], (v_cfg->'rarity'->>'resident_share')::numeric),
      ('launch_hours', 'launch', 'h:', ARRAY['buy', 'launch_hours'], (v_cfg->'buy'->>'launch_hours')::numeric),
      ('far_km', 'passing', 'km:', ARRAY['distance', 'far_km'], (v_cfg->'distance'->>'far_km')::numeric)
    ), last AS (
      SELECT DISTINCT ON (c.contributor, c.family, c.variant) c.*
        FROM public.crm_learning_contrib c
       WHERE c.rules_version = v_ver
       ORDER BY c.contributor, c.family, c.variant, c.quarter DESC
    ), cells AS (
      SELECT p.param, p.path, p.cur, l.contributor, substr(l.variant, length(p.prefix) + 1)::numeric AS val,
             l.o, l.e, l.v
        FROM params p JOIN last l ON l.family = p.family AND l.variant LIKE p.prefix || '%'
    ), contributors AS (
      SELECT param, count(DISTINCT contributor) AS k FROM cells GROUP BY 1
    ), loo AS (
      -- Pour chaque compte laissé de côté : la meilleure variante chez les autres.
      SELECT c.param, i.contributor,
             (SELECT x.val FROM cells x
               WHERE x.param = c.param AND x.contributor <> i.contributor
               GROUP BY x.val
              HAVING sum(x.v) > 0
               -- À égalité, la règle en vigueur gagne.
               ORDER BY (sum(x.o) - sum(x.e)) / sqrt(sum(x.v)) DESC, bool_or(x.val = x.cur) DESC, x.val
               LIMIT 1) AS best
        FROM (SELECT DISTINCT param FROM cells) c
        JOIN (SELECT DISTINCT param, contributor FROM cells) i ON i.param = c.param
    ), scored AS (
      SELECT l.param, l.best, count(*) AS votes,
             avg(CASE WHEN x.v > 0 THEN (x.o - x.e) / sqrt(x.v) END) AS held_out_z
        FROM loo l LEFT JOIN cells x ON x.param = l.param AND x.contributor = l.contributor AND x.val = l.best
       WHERE l.best IS NOT NULL
       GROUP BY 1, 2
    )
    , cur_z AS (
      -- Score de la règle en vigueur chez chaque compte, pour comparaison.
      SELECT x.param, avg(CASE WHEN x.v > 0 THEN (x.o - x.e) / sqrt(x.v) END) AS z
        FROM cells x WHERE x.val = x.cur GROUP BY 1
    )
    SELECT DISTINCT ON (s.param) s.param, s.best, s.votes, s.held_out_z, cz.z AS current_z, p.path, p.cur, k.k AS accounts
      FROM scored s JOIN params p ON p.param = s.param JOIN contributors k ON k.param = s.param
      LEFT JOIN cur_z cz ON cz.param = s.param
     WHERE k.k >= 5
     ORDER BY s.param, s.votes DESC, s.held_out_z DESC NULLS LAST, (s.best = p.cur) DESC, s.best
  LOOP
    v_evidence := v_evidence || jsonb_build_object(r.param, jsonb_build_object(
      'current', r.cur, 'proposed', r.best, 'votes', r.votes, 'accounts', r.accounts,
      'held_out_z', round(r.held_out_z, 3), 'current_z', round(r.current_z, 3)));
    -- Un changement de seuil exige une majorité des comptes laissés de côté
    -- ET un meilleur score qu'aujourd'hui chez eux.
    IF r.best IS DISTINCT FROM r.cur AND r.votes * 2 > r.accounts
       AND COALESCE(r.held_out_z, 0) > COALESCE(r.current_z, 0) THEN
      v_changed := true;
      v_new := jsonb_set(v_new, r.path, to_jsonb(r.best));
    END IF;
  END LOOP;

  IF NOT v_changed THEN
    RETURN jsonb_build_object('proposed', false, 'evidence', v_evidence);
  END IF;
  -- Une proposition identique encore en attente n'est pas recréée.
  IF EXISTS (SELECT 1 FROM public.crm_analysis_rules ar
              WHERE ar.origin = 'proposal' AND NOT ar.active AND ar.approved_at IS NULL AND ar.config = v_new) THEN
    RETURN jsonb_build_object('proposed', false, 'pending', true, 'evidence', v_evidence);
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM public.crm_analysis_rules;
  INSERT INTO public.crm_analysis_rules (version, config, active, origin, evidence)
  VALUES (v_next, v_new, false, 'proposal', v_evidence || jsonb_build_object('from_version', v_ver));
  RETURN jsonb_build_object('proposed', true, 'version', v_next, 'evidence', v_evidence);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_learning_propose() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_learning_propose() TO authenticated, service_role;

-- ── 4. Gestes du super admin (audités, motif obligatoire) ───────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_rules_approve(p_version integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old int;
BEGIN
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(public.is_support_session(), false) THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_analysis_rules WHERE version = p_version) THEN
    RAISE EXCEPTION 'unknown_version' USING ERRCODE = '22023';
  END IF;
  SELECT version INTO v_old FROM public.crm_analysis_rules WHERE active;
  UPDATE public.crm_analysis_rules SET active = false WHERE active AND version <> p_version;
  UPDATE public.crm_analysis_rules
     SET active = true, approved_by = auth.uid(), approved_at = now(), approved_reason = btrim(p_reason)
   WHERE version = p_version;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_analysis_rules_approve', 'crm_analysis_rules', p_version::text,
          jsonb_build_object('reason', btrim(p_reason), 'previous', v_old));
  -- Toutes les portées se recalculent à la prochaine nuit.
  UPDATE public.crm_analysis_state SET full_at = NULL;
  RETURN jsonb_build_object('active', p_version, 'previous', v_old);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_rules_approve(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_rules_approve(integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_admin_learning_set(p_enabled boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(public.is_support_session(), false) THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.crm_learning_settings SET enabled = p_enabled, updated_by = auth.uid(), updated_at = now(),
         reason = btrim(p_reason) WHERE id;
  IF NOT p_enabled THEN
    DELETE FROM public.crm_learning_contrib;
    DELETE FROM public.crm_learning_priors;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_learning_set', 'crm_learning_settings', 'global',
          jsonb_build_object('enabled', p_enabled, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('enabled', p_enabled);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_learning_set(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_learning_set(boolean, text) TO authenticated;

-- ── 5. Réglage du compte (titulaire seul, jamais en accès assisté) ──────────
CREATE OR REPLACE FUNCTION public.crm_learning_contrib_set(p_venue_id text, p_organizer_user_id uuid, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_holder boolean;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_holder := auth.uid() IS NOT NULL AND (
       (p_venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid()))
    OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid()));
  IF NOT COALESCE(v_holder, false) THEN
    RAISE EXCEPTION 'holder_only' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(public.is_support_session(), false) THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN RAISE EXCEPTION 'invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.crm_settings AS s (scope_key, venue_id, organizer_user_id, learning_contrib, updated_by)
  VALUES (v_key, p_venue_id, p_organizer_user_id, p_on, auth.uid())
  ON CONFLICT (scope_key) DO UPDATE SET learning_contrib = EXCLUDED.learning_contrib,
    updated_by = auth.uid(), updated_at = now();
  IF NOT p_on THEN
    DELETE FROM public.crm_learning_contrib c USING public.crm_learning_keys k
     WHERE k.scope_key = v_key AND c.contributor = k.contributor;
  END IF;
  RETURN jsonb_build_object('learning_contrib', p_on,
                            'global_enabled', COALESCE((SELECT enabled FROM public.crm_learning_settings WHERE id), false));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_learning_contrib_set(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_learning_contrib_set(text, uuid, boolean) TO authenticated;

-- Lecture du réglage (Réglages de la Console).
CREATE OR REPLACE FUNCTION public.crm_learning_contrib_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'learning_contrib', COALESCE((SELECT s.learning_contrib FROM public.crm_settings s
                                   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id)), true),
    'global_enabled', COALESCE((SELECT enabled FROM public.crm_learning_settings WHERE id), false),
    'demo', COALESCE(public.is_demo_marketing_scope(p_venue_id, p_organizer_user_id), false),
    'holder', auth.uid() IS NOT NULL AND (
       (p_venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid()))
    OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid())));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_learning_contrib_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_learning_contrib_get(text, uuid) TO authenticated;

-- ── 6. Cron : publier puis proposer, une fois les portées recalculées ───────
DO $$
BEGIN
  PERFORM cron.unschedule('crm-learning-publish') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-learning-publish');
  PERFORM cron.schedule('crm-learning-publish', '23 5 * * *',
    'SELECT public.crm_learning_publish(); SELECT public.crm_learning_propose();');
END $$;
