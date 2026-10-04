-- ============================================================================
-- Yuno CRM — écran Réglages (/crm/settings).
--
-- 1. L'identité de l'espace se lit et s'écrit ICI : nom, ville, logo (club :
--    `venues` ; organisation : `organizer_profiles` + `profiles`), et le type
--    affiché (« Club » / « Organisateur », `crm_settings.business_type` : un
--    libellé, la portée ne change jamais). Écriture : titulaire ou admin
--    (crm_user_manages_team). Le délai de 30 jours entre deux changements de
--    nom (guard_name_rename_cooldown) s'applique tel quel.
-- 2. crm_rules_preview : ce que donneraient les règles « habitué » et « à
--    réactiver » pour TOUTES leurs valeurs possibles, et combien de clients la
--    durée de conservation effacerait. Un seul appel : l'écran bouge ses
--    curseurs sans revenir au serveur. Même base et même ordre du cycle de vie
--    que la liste Clients (_crm_people_build : sans soirée → endormi → habitué).
-- 3. La durée de conservation s'applique pour de vrai : crm_retention_sweep
--    (cron quotidien) efface de l'espace les clients sans aucune activité
--    (soirée, achat, clic, ouverture, ajout) depuis la durée choisie. Effacer =
--    retirer l'identité de tout ce que l'espace garde sur la personne ; un
--    désabonnement reste, lui, en mémoire (c'est ce qui empêche un réimport de
--    lui réécrire). Les ventes externes gardent leur montant, sans identité.
--    Le registre des automatisations (email_automation_sends) n'est pas touché :
--    il garantit qu'une recette « une fois » ne repart jamais à la même adresse.
--    Choisir ou changer la durée : titulaire ou admin (retention_forbidden).
-- 4. request_crm_space_deletion : le titulaire SEUL demande la suppression de
--    l'espace (nom recopié). Yuno la confirme avant d'effacer : alerte super
--    admin, la demande reste visible dans Réglages.
-- ============================================================================

ALTER TABLE public.crm_settings
  ADD COLUMN IF NOT EXISTS business_type text CHECK (business_type IS NULL OR business_type IN ('club', 'organizer')),
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid;

CREATE TABLE IF NOT EXISTS public.crm_retention_runs (
  id bigserial PRIMARY KEY,
  scope_key text NOT NULL,
  venue_id text,
  organizer_user_id uuid,
  retention_months smallint NOT NULL,
  erased integer NOT NULL DEFAULT 0,
  ran_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_retention_runs_scope_idx ON public.crm_retention_runs (scope_key, ran_at DESC);
ALTER TABLE public.crm_retention_runs ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lu par get_crm_settings, écrit par crm_retention_sweep.

-- ── Identité ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._crm_identity(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_venue_id IS NOT NULL THEN (
      SELECT jsonb_build_object('name', v.name, 'city', v.city, 'logo_url', v.logo_url,
                                'name_changed_at', v.name_changed_at,
                                -- Club encore en onboarding Stripe : le guard laisse renommer.
                                'rename_locked_until', CASE WHEN COALESCE(v.stripe_onboarding_complete, false)
                                                             AND v.name_changed_at > now() - interval '30 days'
                                                            THEN v.name_changed_at + interval '30 days' END,
                                'holder', v.owner_id = auth.uid())
        FROM public.venues v WHERE v.id = p_venue_id)
    ELSE (
      SELECT jsonb_build_object('name', COALESCE(NULLIF(o.display_name, ''), p.organization_name, ''),
                                'city', o.city,
                                'logo_url', COALESCE(o.avatar_url, p.organization_logo_url),
                                'name_changed_at', o.name_changed_at,
                                'rename_locked_until', CASE WHEN o.name_changed_at > now() - interval '30 days'
                                                            THEN o.name_changed_at + interval '30 days' END,
                                'holder', o.user_id = auth.uid())
        FROM public.organizer_profiles o
        LEFT JOIN public.profiles p ON p.id = o.user_id
       WHERE o.user_id = p_organizer_user_id)
  END;
$$;
REVOKE ALL ON FUNCTION public._crm_identity(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_identity(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_crm_settings(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  s public.crm_settings%ROWTYPE;
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_last jsonb;
  v_manages boolean;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  SELECT * INTO s FROM public.crm_settings WHERE scope_key = v_key;
  SELECT jsonb_build_object('at', x.ran_at, 'erased', x.erased) INTO v_last
    FROM public.crm_retention_runs x WHERE x.scope_key = v_key AND x.erased > 0
   ORDER BY x.ran_at DESC LIMIT 1;
  v_manages := public.crm_user_manages_team(auth.uid(), p_venue_id, p_organizer_user_id);

  RETURN jsonb_build_object(
    'regular_min_nights', r.regular_min_nights,
    'regular_window_months', r.regular_window_months,
    'lapse_months', r.lapse_months,
    'night_end_hour', r.night_end_hour,
    'retention_months', r.retention_months,
    'business_type', COALESCE(s.business_type, CASE WHEN p_venue_id IS NOT NULL THEN 'club' ELSE 'organizer' END),
    'identity', public._crm_identity(p_venue_id, p_organizer_user_id),
    'deletion_requested_at', s.deletion_requested_at,
    'retention_last', v_last,
    'can', jsonb_build_object(
      'edit', public.crm_scope_writable(p_venue_id, p_organizer_user_id),
      'identity', v_manages,
      'retention', v_manages,
      'delete', COALESCE((public._crm_identity(p_venue_id, p_organizer_user_id)->>'holder')::boolean, false)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_settings(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_settings(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_crm_settings(p_venue_id text, p_organizer_user_id uuid, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_cur smallint;
  v_new smallint;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  v_key := public.crm_scope_key(p_venue_id, p_organizer_user_id);

  -- La durée de conservation efface des clients : titulaire ou admin seulement.
  IF p_settings ? 'retention_months' THEN
    SELECT retention_months INTO v_cur FROM public.crm_settings WHERE scope_key = v_key;
    v_new := NULLIF(p_settings->>'retention_months', '')::smallint;
    IF v_new IS DISTINCT FROM v_cur
       AND NOT public.crm_user_manages_team(auth.uid(), p_venue_id, p_organizer_user_id) THEN
      RAISE EXCEPTION 'retention_forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.crm_settings AS s (scope_key, venue_id, organizer_user_id, regular_min_nights,
                                        regular_window_months, lapse_months, night_end_hour,
                                        retention_months, business_type, updated_by)
  VALUES (
    v_key, p_venue_id, p_organizer_user_id,
    COALESCE((p_settings->>'regular_min_nights')::smallint, 3),
    COALESCE((p_settings->>'regular_window_months')::smallint, 6),
    COALESCE((p_settings->>'lapse_months')::smallint, 4),
    COALESCE((p_settings->>'night_end_hour')::smallint, 6),
    NULLIF(p_settings->>'retention_months', '')::smallint,
    NULLIF(p_settings->>'business_type', ''),
    auth.uid()
  )
  ON CONFLICT (scope_key) DO UPDATE SET
    regular_min_nights = COALESCE((p_settings->>'regular_min_nights')::smallint, s.regular_min_nights),
    regular_window_months = COALESCE((p_settings->>'regular_window_months')::smallint, s.regular_window_months),
    lapse_months = COALESCE((p_settings->>'lapse_months')::smallint, s.lapse_months),
    night_end_hour = COALESCE((p_settings->>'night_end_hour')::smallint, s.night_end_hour),
    retention_months = CASE WHEN p_settings ? 'retention_months'
                            THEN NULLIF(p_settings->>'retention_months', '')::smallint
                            ELSE s.retention_months END,
    business_type = CASE WHEN p_settings ? 'business_type'
                         THEN NULLIF(p_settings->>'business_type', '')
                         ELSE s.business_type END,
    updated_by = auth.uid(),
    updated_at = now();

  RETURN public.get_crm_settings(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_crm_settings(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_crm_settings(text, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_crm_identity(
  p_venue_id text, p_organizer_user_id uuid, p_name text, p_city text, p_logo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_city text := NULLIF(btrim(COALESCE(p_city, '')), '');
  v_logo text := NULLIF(btrim(COALESCE(p_logo_url, '')), '');
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id)
     OR NOT public.crm_user_manages_team(auth.uid(), p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 32 THEN
    RAISE EXCEPTION 'invalid_city' USING ERRCODE = '22023';
  END IF;
  -- Un logo vient de notre stockage public, jamais d'une adresse quelconque
  -- (il part dans chaque e-mail : pas de pixel de suivi tiers).
  IF v_logo IS NOT NULL AND v_logo !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/' THEN
    RAISE EXCEPTION 'invalid_logo' USING ERRCODE = '22023';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    UPDATE public.venues
       SET name = v_name, city = v_city, logo_url = v_logo
     WHERE id = p_venue_id
       AND (name IS DISTINCT FROM v_name OR city IS DISTINCT FROM v_city OR logo_url IS DISTINCT FROM v_logo);
  ELSE
    UPDATE public.organizer_profiles
       SET display_name = v_name, city = v_city, avatar_url = v_logo
     WHERE user_id = p_organizer_user_id
       AND (display_name IS DISTINCT FROM v_name OR city IS DISTINCT FROM v_city OR avatar_url IS DISTINCT FROM v_logo);
    UPDATE public.profiles
       SET organization_name = v_name, organization_logo_url = v_logo
     WHERE id = p_organizer_user_id
       AND (organization_name IS DISTINCT FROM v_name OR organization_logo_url IS DISTINCT FROM v_logo);
  END IF;

  RETURN public.get_crm_settings(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_crm_identity(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_crm_identity(text, uuid, text, text, text) TO authenticated;

-- ── Activité de chaque client (aperçu des règles, conservation) ─────────────

-- Construit `_ca` : une ligne par client de la base (même base que la liste
-- Clients), avec ses soirées sur 6 / 12 / 24 mois, ses mois pleins depuis la
-- dernière soirée et sa dernière activité, quelle qu'elle soit.
CREATE OR REPLACE FUNCTION public._crm_activity_build(p_venue_id text, p_organizer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_n integer;
BEGIN
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ca;
  CREATE TEMP TABLE _ca ON COMMIT DROP AS
  WITH win AS (
    SELECT t.email,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start > now() - interval '6 months') AS n6,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start > now() - interval '12 months') AS n12,
           count(DISTINCT t.event_id) FILTER (WHERE t.event_start > now() - interval '24 months') AS n24,
           max(t.bought_at) AS last_buy
      FROM _cpt t
     WHERE t.email IS NOT NULL AND t.event_start <= now()
     GROUP BY t.email
  ), eng AS (
    SELECT lower(c.email) AS email,
           max(GREATEST(c.last_seen_at, c.last_opened_at, c.last_clicked_at, c.added_at, c.created_at,
                        c.yuno_last_at, c.last_purchase_at)) AS last_eng
      FROM _cr c
     WHERE c.email IS NOT NULL
     GROUP BY 1
  )
  SELECT p.email,
         p.nights,
         p.last_night,
         COALESCE(w.n6, 0)::int AS n6,
         COALESCE(w.n12, 0)::int AS n12,
         COALESCE(w.n24, 0)::int AS n24,
         CASE WHEN p.last_night IS NULL THEN -1
              ELSE LEAST(13, (extract(year FROM age(now(), p.last_night)) * 12
                              + extract(month FROM age(now(), p.last_night)))::int) END AS months_since,
         GREATEST(p.last_night, p.added_at, w.last_buy, e.last_eng) AS last_activity
    FROM _cp p
    LEFT JOIN win w ON w.email = p.email
    LEFT JOIN eng e ON e.email = p.email;

  SELECT count(*) INTO v_n FROM _ca;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_activity_build(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_activity_build(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_rules_preview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_total integer;
  v_came integer;
  v_hab jsonb;
  v_lapsed jsonb;
  v_erase jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_total := public._crm_activity_build(p_venue_id, p_organizer_user_id);
  SELECT count(*) FILTER (WHERE nights > 0) INTO v_came FROM _ca;

  -- Groupes de clients par (soirées 6/12/24 mois plafonnées à 6, mois depuis
  -- la dernière soirée) : quelques centaines de lignes, puis toutes les
  -- combinaisons de règles. Ordre du cycle de vie de la liste Clients :
  -- un client endormi (mois ≥ seuil) n'est jamais compté habitué.
  WITH g AS (
    SELECT LEAST(n6, 6) AS n6, LEAST(n12, 6) AS n12, LEAST(n24, 6) AS n24, months_since, count(*) AS c
      FROM _ca WHERE nights > 0
     GROUP BY 1, 2, 3, 4
  ), combos AS (
    SELECT w, m, n,
           COALESCE((SELECT sum(g.c) FROM g
                      WHERE g.months_since < m
                        AND CASE w WHEN 6 THEN g.n6 WHEN 12 THEN g.n12 ELSE g.n24 END >= n), 0)::int AS c
      FROM unnest(ARRAY[6, 12, 24]) w, generate_series(2, 12) m, generate_series(1, 6) n
  ), by_m AS (
    SELECT w, m, jsonb_agg(c ORDER BY n) AS arr FROM combos GROUP BY w, m
  ), by_w AS (
    SELECT w, jsonb_object_agg(m::text, arr) AS o FROM by_m GROUP BY w
  )
  SELECT jsonb_object_agg(w::text, o) INTO v_hab FROM by_w;

  SELECT jsonb_object_agg(m::text, c) INTO v_lapsed
    FROM (SELECT m, (SELECT count(*) FROM _ca WHERE nights > 0 AND months_since >= m)::int AS c
            FROM generate_series(2, 12) m) q;

  SELECT jsonb_object_agg(k::text, c) INTO v_erase
    FROM (SELECT k, (SELECT count(*) FROM _ca
                      WHERE COALESCE(last_activity, '-infinity'::timestamptz) < now() - make_interval(months => k))::int AS c
            FROM unnest(ARRAY[24, 36, 60]) k) q;

  RETURN jsonb_build_object('total', v_total, 'came', v_came, 'hab', v_hab, 'lapsed', v_lapsed,
                            'erase', v_erase, 'at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.crm_rules_preview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_rules_preview(text, uuid) TO authenticated, service_role;

-- ── Conservation : effacer pour de vrai ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emails text[];
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}') INTO v_emails
    FROM unnest(p_emails) e WHERE e IS NOT NULL AND btrim(e) <> '';
  IF cardinality(v_emails) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.crm_contact_notes WHERE scope_key = v_key AND lower(email) = ANY (v_emails);

  DELETE FROM public.crm_import_journal j
   USING public.crm_imports i
   WHERE i.list_import_id = j.list_import_id AND i.scope_key = v_key AND lower(j.email) = ANY (v_emails);

  DELETE FROM public.imported_contacts c
   WHERE ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
     AND lower(c.email) = ANY (v_emails);

  -- Un désabonnement reste : c'est la mémoire du refus.
  DELETE FROM public.newsletter_subscriptions ns
   WHERE ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
     AND lower(ns.email) = ANY (v_emails)
     AND ns.opted_in;

  DELETE FROM public.venue_sms_contacts vc
   WHERE ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
     AND lower(vc.email) = ANY (v_emails)
     AND NOT vc.unsubscribed;

  -- Les ventes de la billetterie connectée gardent leur montant, sans identité.
  UPDATE public.external_tickets t
     SET buyer_email = NULL, buyer_first_name = NULL, buyer_last_name = NULL, buyer_phone = NULL,
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL,
         raw = '{}'::jsonb
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- Les envois passés restent comptés, sous une adresse qui ne désigne plus personne.
  UPDATE public.email_campaign_recipients r
     SET email = 'erased-' || md5(lower(r.email)) || '@erased.invalid',
         first_name = NULL, last_name = NULL, user_id = NULL
    FROM public.email_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND r.status NOT IN ('pending', 'sending')
     AND lower(r.email) = ANY (v_emails);

  UPDATE public.email_campaign_events ev
     SET recipient_email = 'erased-' || md5(lower(ev.recipient_email)) || '@erased.invalid',
         metadata = ((COALESCE(ev.metadata, '{}'::jsonb) - 'to' - 'headers')
                     #- '{open,ipAddress}' #- '{open,userAgent}'
                     #- '{click,ipAddress}' #- '{click,userAgent}')
    FROM public.email_campaigns c
   WHERE c.id = ev.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND lower(ev.recipient_email) = ANY (v_emails);

  DELETE FROM public.contact_base_cache cb
   WHERE cb.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id)
     AND lower(cb.email) = ANY (v_emails);
  UPDATE public.contact_base_cache_state
     SET dirty_at = now()
   WHERE scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id);

  RETURN cardinality(v_emails);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_erase_contacts(text, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_erase_contacts(text, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_retention_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  s record;
  v_emails text[];
  v_n integer;
  v_total integer := 0;
BEGIN
  FOR s IN
    SELECT cs.scope_key, cs.venue_id, cs.organizer_user_id, cs.retention_months
      FROM public.crm_settings cs
     WHERE cs.retention_months IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = cs.venue_id AND v.product = 'crm')
         OR EXISTS (SELECT 1 FROM public.organizer_profiles o
                     WHERE o.user_id = cs.organizer_user_id AND o.product = 'crm'))
  LOOP
    BEGIN
      PERFORM public._crm_activity_build(s.venue_id, s.organizer_user_id);
      SELECT COALESCE(array_agg(email), '{}') INTO v_emails
        FROM (SELECT email FROM _ca
               WHERE COALESCE(last_activity, '-infinity'::timestamptz) < now() - make_interval(months => s.retention_months)
               LIMIT 5000) q;
      v_n := public._crm_erase_contacts(s.venue_id, s.organizer_user_id, v_emails);
      INSERT INTO public.crm_retention_runs (scope_key, venue_id, organizer_user_id, retention_months, erased)
      VALUES (s.scope_key, s.venue_id, s.organizer_user_id, s.retention_months, v_n);
      v_total := v_total + v_n;
    EXCEPTION WHEN others THEN
      -- Un espace en panne ne bloque pas les autres ; l'erreur se lit dans les alertes.
      PERFORM public.emit_admin_notification(
        'admin_crm_retention_failed', 'Conservation CRM en échec', SQLERRM, 'normal',
        'crm_scope', s.scope_key, jsonb_build_object('sqlstate', SQLSTATE),
        'crm_retention_failed:' || s.scope_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
    END;
  END LOOP;
  DELETE FROM public.crm_retention_runs WHERE ran_at < now() - interval '13 months';
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_retention_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_retention_sweep() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-retention-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-retention-sweep');
  PERFORM cron.schedule('crm-retention-sweep', '43 3 * * *', 'SELECT public.crm_retention_sweep()');
END $$;

-- ── Demande de suppression de l'espace ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_crm_space_deletion(p_venue_id text, p_organizer_user_id uuid, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id jsonb := public._crm_identity(p_venue_id, p_organizer_user_id);
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id)
     OR NOT COALESCE((v_id->>'holder')::boolean, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF lower(btrim(COALESCE(p_confirm, ''))) <> lower(btrim(COALESCE(v_id->>'name', ''))) THEN
    RAISE EXCEPTION 'confirm_mismatch' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.crm_settings AS s (scope_key, venue_id, organizer_user_id, deletion_requested_at,
                                        deletion_requested_by, updated_by)
  VALUES (v_key, p_venue_id, p_organizer_user_id, now(), auth.uid(), auth.uid())
  ON CONFLICT (scope_key) DO UPDATE SET
    deletion_requested_at = COALESCE(s.deletion_requested_at, now()),
    deletion_requested_by = COALESCE(s.deletion_requested_by, auth.uid()),
    updated_at = now();

  PERFORM public.emit_admin_notification(
    'admin_crm_deletion_request',
    'Suppression demandée : ' || COALESCE(v_id->>'name', v_key),
    'Le titulaire demande la suppression de son espace Yuno CRM. À confirmer avec lui avant d''effacer.',
    'high', 'crm_scope', v_key,
    jsonb_build_object('scope_key', v_key, 'venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                       'name', v_id->>'name', 'requested_by', auth.uid()),
    'crm_deletion_request:' || v_key, NULL);

  RETURN public.get_crm_settings(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.request_crm_space_deletion(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_crm_space_deletion(text, uuid, text) TO authenticated;
