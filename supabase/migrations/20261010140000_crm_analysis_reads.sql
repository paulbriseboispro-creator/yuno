-- ============================================================================
-- Yuno CRM — analyse client, lot D : les lectures des écrans (2026-10-07).
--
-- Une RPC par écran, gardée par la portée (crm_scope_allowed : tout rôle qui
-- voit déjà les clients nommés, lecteur compris). Aucune ne rend de montant.
-- Elles ne lisent QUE les tables pré-calculées (lots B, C, E) : jamais
-- _crm_people_build, jamais les billets.
--
--   crm_analysis_overview   Analyses › Communauté › « Ce qui fait venir »
--   crm_client_analysis     fiche client : hypothèses + faits de la personne
--   crm_night_analysis      tiroir d'une soirée : ce qu'elle a attiré
--   crm_artists_analysis    artistes : qui amène des nouveaux, et qui revient
--   crm_admin_analysis      Admin CRM : couverture et statuts (agrégats)
--
-- Seuil de silence : aucun taux sous 10 personnes (`min_sample`), le SQL rend
-- null et l'écran montre les nombres bruts.
-- ============================================================================

-- La variante « en vigueur » d'une famille (celle des règles actives), pour
-- retrouver sa leçon commune.
CREATE OR REPLACE FUNCTION public._crm_an_cur_variant(p_family text, p_variant text, p_cfg jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_family
    WHEN 'artist' THEN 'res:' || trim_scale(COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2))::text
    WHEN 'launch' THEN 'h:' || trim_scale(COALESCE((p_cfg->'buy'->>'launch_hours')::numeric, 24))::text
    WHEN 'passing' THEN 'km:' || trim_scale(COALESCE((p_cfg->'distance'->>'far_km')::numeric, 80))::text
    ELSE COALESCE(p_variant, '') END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_cur_variant(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_an_cur_variant(text, text, jsonb) TO authenticated, service_role;

-- Statut d'une famille sur le compte, avec sa leçon commune quand elle est
-- publiée (jamais confondue : `prior` est à part).
CREATE OR REPLACE FUNCTION public._crm_an_families_json(p_scope_key text, p_cfg jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'family', fs.family, 'variant', fs.variant, 'kind', fs.kind,
           'availability', fs.availability, 'status', fs.status,
           'o', round(fs.o, 1), 'e', round(fs.e, 1), 'n', fs.n, 'gain', fs.gain, 'z', fs.z,
           'direction', fs.direction, 'detail', fs.detail, 'since', fs.status_since,
           'computed_at', fs.computed_at,
           'prior', CASE WHEN pr.family IS NOT NULL THEN jsonb_build_object(
                      'accounts', pr.accounts, 'gain', pr.gain, 'status', pr.status, 'n', pr.n) END)
         ORDER BY array_position(ARRAY['affinity', 'behaviour', 'return'], fs.kind), fs.family, fs.variant), '[]'::jsonb)
    FROM public.crm_family_status fs
    LEFT JOIN public.crm_learning_priors pr
      ON pr.rules_version = fs.rules_version AND pr.family = fs.family
     AND pr.variant = public._crm_an_cur_variant(fs.family, fs.variant, p_cfg)
   WHERE fs.scope_key = p_scope_key;
$$;
REVOKE ALL ON FUNCTION public._crm_an_families_json(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_families_json(text, jsonb) TO service_role;

-- ── 1. Analyses › Communauté › « Ce qui fait venir » ────────────────────────
CREATE OR REPLACE FUNCTION public.crm_analysis_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg jsonb := public.crm_analysis_config();
  v_min int := COALESCE((v_cfg->>'min_sample')::int, 10);
  v_state jsonb;
  v_new jsonb;
  v_once jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('computed_at', s.computed_at, 'full_at', s.full_at, 'rules_version', s.rules_version,
                            'people', s.people, 'stats', s.stats,
                            'coverage', CASE WHEN s.coverage IS NOT NULL THEN jsonb_build_object(
                              'families', s.coverage->'families', 'totals', s.coverage->'totals',
                              'scan_share', s.coverage->'scan_share', 'zip_share', s.coverage->'zip_share',
                              'launch_share', s.coverage->'launch_share', 'multi_share', s.coverage->'multi_share',
                              'multi_holder_share', s.coverage->'multi_holder_share') END)
    INTO v_state FROM public.crm_analysis_state s WHERE s.scope_key = v_key;

  -- Nouveaux venus des 12 derniers mois : quelle hypothèse (moyenne ou forte)
  -- revient chez combien d'entre eux.
  WITH nw AS (
    SELECT pp.tags FROM public.crm_person_profile pp
     WHERE pp.scope_key = v_key AND (pp.first_facts->>'start_at')::timestamptz >= now() - interval '365 days'
  )
  SELECT jsonb_build_object(
           'n', (SELECT count(*) FROM nw),
           'by_family', COALESCE((SELECT jsonb_object_agg(z.f, z.c) FROM (
                           SELECT substr(t, 3) AS f, count(*) AS c FROM nw, unnest(nw.tags) t
                            WHERE t LIKE 'h:%' GROUP BY 1) z), '{}'::jsonb))
    INTO v_new;

  -- Venus une seule fois (soirée de plus de 30 jours) : locaux, de passage,
  -- distance inconnue. Les « de passage » ne sont JAMAIS retirés en silence.
  SELECT jsonb_build_object(
           'n', count(*),
           'local', count(*) FILTER (WHERE 'loc' = ANY (pp.tags)),
           'passing', count(*) FILTER (WHERE 'pass' = ANY (pp.tags)),
           'unknown', count(*) FILTER (WHERE NOT ('loc' = ANY (pp.tags)) AND NOT ('pass' = ANY (pp.tags))))
    INTO v_once
    FROM public.crm_person_profile pp
   WHERE pp.scope_key = v_key AND pp.nights = 1
     AND (pp.first_facts->>'start_at')::timestamptz < now() - interval '30 days';

  RETURN jsonb_build_object(
    'state', v_state,
    'min_sample', v_min,
    'rules_version', (v_cfg->>'rules_version')::int,
    'families', public._crm_an_families_json(v_key, v_cfg),
    'newcomers', v_new,
    'once', v_once);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_analysis_overview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_analysis_overview(text, uuid) TO authenticated, service_role;

-- ── 2. Fiche client ─────────────────────────────────────────────────────────
-- Les hypothèses de la personne, chacune avec le statut de SA famille sur le
-- compte (et la leçon commune à part). Jamais dans un export.
CREATE OR REPLACE FUNCTION public.crm_client_analysis(p_venue_id text, p_organizer_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg jsonb := public.crm_analysis_config();
  v_em text := lower(btrim(COALESCE(p_email, '')));
  pp public.crm_person_profile%ROWTYPE;
  v_excluded boolean;
  v_hyps jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_excluded := EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = v_key AND o.email = v_em);
  SELECT * INTO pp FROM public.crm_person_profile WHERE scope_key = v_key AND email = v_em;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('excluded', v_excluded, 'profile', false,
      'computed_at', (SELECT computed_at FROM public.crm_analysis_state WHERE scope_key = v_key));
  END IF;

  SELECT COALESCE(jsonb_agg(h.h || jsonb_build_object(
           'status', fs.status, 'availability', fs.availability, 'kind', fs.kind,
           'gain', fs.gain, 'o', round(fs.o, 1), 'e', round(fs.e, 1), 'n', fs.n, 'direction', fs.direction,
           'detail', fs.detail, 'since', fs.status_since,
           'prior', CASE WHEN pr.family IS NOT NULL THEN jsonb_build_object('accounts', pr.accounts, 'gain', pr.gain, 'status', pr.status) END)
         ORDER BY h.ord), '[]'::jsonb)
    INTO v_hyps
    FROM jsonb_array_elements(pp.hyps) WITH ORDINALITY h(h, ord)
    LEFT JOIN public.crm_family_status fs
      ON fs.scope_key = v_key AND fs.family = h.h->>'f'
     AND fs.variant = CASE WHEN h.h->>'f' = 'channel' THEN COALESCE(h.h->'p'->>'src', '') ELSE '' END
    LEFT JOIN public.crm_learning_priors pr
      ON pr.rules_version = fs.rules_version AND pr.family = fs.family
     AND pr.variant = public._crm_an_cur_variant(fs.family, fs.variant, v_cfg);

  RETURN jsonb_build_object(
    'excluded', v_excluded, 'profile', true, 'computed_at', pp.computed_at,
    'nights', pp.nights, 'first', pp.first_facts, 'agg', pp.agg, 'hyps', v_hyps,
    'dist_km', pp.dist_km, 'passing', pp.passing);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_client_analysis(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_client_analysis(text, uuid, text) TO authenticated, service_role;

-- ── 3. Tiroir d'une soirée : ce qu'elle a attiré ────────────────────────────
-- p_event_id = la soirée MIROIR (events.id), comme le tiroir.
CREATE OR REPLACE FUNCTION public.crm_night_analysis(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg jsonb := public.crm_analysis_config();
  v_min int := COALESCE((v_cfg->>'min_sample')::int, 10);
  np public.crm_night_profile%ROWTYPE;
  v_med jsonb;
  v_new jsonb;
  v_arts jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO np FROM public.crm_night_profile WHERE scope_key = v_key AND event_id = p_event_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('profile', false); END IF;

  -- Une soirée « habituelle » du compte (médianes, soirées de 10 entrées et plus).
  SELECT jsonb_build_object(
           'new_share', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x.new_share)::numeric, 3),
           'launch_48h_share', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x.launch_48h_share)
                                      FILTER (WHERE x.launch_48h_share IS NOT NULL))::numeric, 3),
           'nights', count(*))
    INTO v_med
    FROM public.crm_night_profile x WHERE x.scope_key = v_key AND x.entries >= v_min;

  -- Hypothèses (moyennes ou fortes) chez les nouveaux venus de CETTE soirée.
  WITH nw AS (
    SELECT pp.tags FROM public.crm_person_profile pp
     WHERE pp.scope_key = v_key AND pp.first_facts->>'nid' = np.external_event_id::text
  )
  SELECT jsonb_build_object('n', (SELECT count(*) FROM nw),
           'by_family', COALESCE((SELECT jsonb_object_agg(z.f, z.c) FROM (
                           SELECT substr(t, 3) AS f, count(*) AS c FROM nw, unnest(nw.tags) t
                            WHERE t LIKE 'h:%' GROUP BY 1) z), '{}'::jsonb))
    INTO v_new;

  SELECT COALESCE(jsonb_agg(a.a || jsonb_build_object(
           'nights', st.nights, 'new_brought', st.new_brought, 'fans', st.fans,
           'return_rate', CASE WHEN st.new_eligible >= v_min THEN round(st.new_returned::numeric / st.new_eligible, 3) END,
           'new_eligible', st.new_eligible, 'new_returned', st.new_returned) ORDER BY a.ord), '[]'::jsonb)
    INTO v_arts
    FROM jsonb_array_elements(np.artists) WITH ORDINALITY a(a, ord)
    LEFT JOIN public.crm_artist_stats st ON st.scope_key = v_key AND st.artist_key = a.a->>'k';

  RETURN jsonb_build_object(
    'profile', true, 'computed_at', np.computed_at, 'title', np.title, 'starts_at', np.starts_at,
    'series', np.series, 'slot', np.slot, 'weekday', np.weekday, 'format', np.format, 'genres', np.genres,
    'entries', np.entries, 'buyers', np.buyers, 'new_people', np.new_people,
    'new_share', CASE WHEN np.entries >= v_min THEN np.new_share END,
    'launch_known', np.launch_known,
    'launch_48h_share', CASE WHEN np.buyers >= v_min THEN np.launch_48h_share END,
    'origin', np.new_origin,
    'return', jsonb_build_object('eligible', np.new_eligible, 'returned', np.new_returned,
                                 'rate', CASE WHEN np.new_eligible >= v_min THEN round(np.new_returned::numeric / np.new_eligible, 3) END),
    'artists', v_arts, 'usual', v_med, 'newcomers', v_new, 'min_sample', v_min,
    'far_km', COALESCE((v_cfg->'distance'->>'far_km')::numeric, 80));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_analysis(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_analysis(text, uuid, uuid) TO authenticated, service_role;

-- ── 4. Artistes : qui amène des nouveaux, et des nouveaux qui reviennent ────
CREATE OR REPLACE FUNCTION public.crm_artists_analysis(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
                                                       p_limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg jsonb := public.crm_analysis_config();
  v_min int := COALESCE((v_cfg->>'min_sample')::int, 10);
  v_res numeric := COALESCE((v_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_minb int := COALESCE((v_cfg->'rarity'->>'min_nights')::int, 5);
  v_base jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Le retour d'un nouveau venu « en général » sur ce compte, pour comparer.
  SELECT jsonb_build_object('eligible', COALESCE(sum(new_eligible), 0), 'returned', COALESCE(sum(new_returned), 0),
                            'rate', CASE WHEN COALESCE(sum(new_eligible), 0) >= v_min
                                         THEN round(sum(new_returned)::numeric / sum(new_eligible), 3) END)
    INTO v_base FROM public.crm_night_profile WHERE scope_key = v_key;

  RETURN jsonb_build_object(
    'min_sample', v_min,
    'resident_share', v_res,
    'baseline', v_base,
    'family', (SELECT f FROM jsonb_array_elements(public._crm_an_families_json(v_key, v_cfg)) f
                WHERE f->>'family' = 'artist' LIMIT 1),
    'artists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'k', s.artist_key, 'name', s.name, 'slug', s.slug, 'avatar', s.avatar,
                  'nights', s.nights, 'entries', s.entries, 'new_brought', s.new_brought, 'fans', s.fans,
                  'share', s.share, 'last_night', s.last_night,
                  -- Résident : joue à plus de `resident_share` des soirées du compte.
                  'resident', s.share IS NOT NULL AND s.share > v_res
                              AND (SELECT count(*) FROM public.crm_night_profile np WHERE np.scope_key = v_key) >= v_minb,
                  'new_eligible', s.new_eligible, 'new_returned', s.new_returned,
                  'return_rate', CASE WHEN s.new_eligible >= v_min THEN round(s.new_returned::numeric / s.new_eligible, 3) END)
                  ORDER BY s.new_brought DESC, s.entries DESC, s.name)
                FROM (SELECT * FROM public.crm_artist_stats WHERE scope_key = v_key
                       ORDER BY new_brought DESC, entries DESC, name LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 200))) s),
               '[]'::jsonb),
    'total', (SELECT count(*) FROM public.crm_artist_stats WHERE scope_key = v_key));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_artists_analysis(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_artists_analysis(text, uuid, integer) TO authenticated, service_role;

-- ── 5. Admin CRM : couverture et statuts d'un compte (agrégats seulement) ───
CREATE OR REPLACE FUNCTION public.crm_admin_analysis(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_venue text;
  v_org uuid;
BEGIN
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_scope_key LIKE 'venue:%' THEN v_venue := substr(p_scope_key, 7);
  ELSIF p_scope_key ~ '^org:[0-9a-f-]{36}$' THEN v_org := substr(p_scope_key, 5)::uuid;
  ELSE RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'state', (SELECT jsonb_build_object('computed_at', s.computed_at, 'full_at', s.full_at, 'rules_version', s.rules_version,
                                        'people', s.people, 'duration_ms', s.duration_ms, 'last_error', s.last_error,
                                        'last_error_at', s.last_error_at, 'stats', s.stats,
                                        'dirty', (SELECT count(*) FROM public.crm_analysis_dirty d WHERE d.scope_key = s.scope_key))
                FROM public.crm_analysis_state s WHERE s.scope_key = p_scope_key),
    'coverage', public._crm_signal_coverage(v_venue, v_org),
    'families', public._crm_an_families_json(p_scope_key, v_cfg),
    'learning', jsonb_build_object(
      'global_enabled', COALESCE((SELECT enabled FROM public.crm_learning_settings WHERE id), false),
      'account_contributes', COALESCE((SELECT learning_contrib FROM public.crm_settings WHERE scope_key = p_scope_key), true),
      'demo', COALESCE(public.is_demo_marketing_scope(v_venue, v_org), false),
      'cells', (SELECT count(*) FROM public.crm_learning_contrib c JOIN public.crm_learning_keys k ON k.contributor = c.contributor
                 WHERE k.scope_key = p_scope_key)));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_analysis(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_analysis(text) TO authenticated;

-- Admin CRM › Réglages : l'apprentissage commun (drapeau global, leçons,
-- propositions de règles). Agrégats seulement.
CREATE OR REPLACE FUNCTION public.crm_admin_learning_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT jsonb_build_object('enabled', enabled, 'updated_at', updated_at, 'reason', reason)
                   FROM public.crm_learning_settings WHERE id),
    'contributors', (SELECT count(DISTINCT contributor) FROM public.crm_learning_contrib),
    'priors', COALESCE((SELECT jsonb_agg(jsonb_build_object('rules_version', p.rules_version, 'family', p.family,
                          'variant', p.variant, 'accounts', p.accounts, 'n', p.n, 'gain', p.gain, 'z', p.z,
                          'status', p.status, 'published_at', p.published_at) ORDER BY p.family, p.variant)
                          FROM public.crm_learning_priors p), '[]'::jsonb),
    'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', r.version, 'active', r.active, 'origin', r.origin,
                          'config', r.config, 'evidence', r.evidence, 'approved_at', r.approved_at,
                          'approved_reason', r.approved_reason, 'created_at', r.created_at) ORDER BY r.version DESC)
                          FROM public.crm_analysis_rules r), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_learning_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_learning_overview() TO authenticated;
