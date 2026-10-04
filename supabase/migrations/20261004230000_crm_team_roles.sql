-- ============================================================================
-- Yuno CRM — les rôles de l'équipe d'un espace (design « Compte › Équipe et
-- accès » de Paul) : Propriétaire, Administrateur, Éditeur, Lecteur.
--
--                         Propriétaire  Admin  Éditeur  Lecteur
--   Voir le chiffre d'affaires   ✓        ✓       –        –
--   Voir analyses et clients     ✓        ✓       ✓        ✓
--   Envoyer, dépenser des Yunits ✓        ✓       ✓        –
--   Importer, modifier clients   ✓        ✓       ✓        –
--   Gérer l'équipe et les accès  ✓        ✓       –        –
--   Abonnement et facturation    ✓        –       –        –
--
-- Un espace organisation : le fondateur, puis org_members (admin, editor et
-- le nouveau viewer). Un espace club : le propriétaire, puis les gérants
-- (manager_permissions), traités en administrateurs (chiffre d'affaires
-- selon can_view_analytics / can_view_finance).
--
-- Portes :
--   crm_scope_allowed   lire (le lecteur y entre) ;
--   crm_scope_writable  écrire (les 7 RPC d'écriture de la Console) ;
--   crm_scope_sees_money / _crm_money_gate  le chiffre d'affaires : les RPC
--     de lecture qui rendent des montants passent par une enveloppe qui met
--     revenue / spent / amount à null pour l'éditeur et le lecteur ;
--   crm_user_manages_team  l'équipe (fondateur ou admin).
-- Les écritures directes (campagnes, modèles) passaient déjà par
-- crm_user_in_scope, qui exige l'éditeur : le lecteur n'écrit rien.
-- ============================================================================

-- ── 1. Le rôle Lecteur ─────────────────────────────────────────────────────
ALTER TABLE public.org_members DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE public.org_members ADD CONSTRAINT org_members_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'editor'::text, 'scanner'::text, 'viewer'::text]));

-- ── 2. Portes ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_org_role(p_user_id uuid, p_organizer_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_user_id IS NULL OR p_organizer_user_id IS NULL THEN NULL
              WHEN p_user_id = p_organizer_user_id THEN 'owner'
              ELSE (SELECT m.role FROM public.org_members m
                     WHERE m.organizer_user_id = p_organizer_user_id AND m.member_user_id = p_user_id
                       AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor', 'viewer')
                     ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END LIMIT 1) END;
$$;
REVOKE ALL ON FUNCTION public.crm_org_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_org_role(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
    COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND public.crm_org_role(auth.uid(), p_organizer_user_id) IS NOT NULL)
    )));
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_writable(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
    COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND public.crm_org_role(auth.uid(), p_organizer_user_id) IN ('owner', 'admin', 'editor'))
    )));
$function$;
REVOKE ALL ON FUNCTION public.crm_scope_writable(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_writable(text, uuid) TO authenticated, service_role;

-- Le chiffre d'affaires : propriétaire, admin (ou membre « voir la finance »),
-- gérant d'un club qui voit les analyses ou la finance, super admin.
CREATE OR REPLACE FUNCTION public.crm_scope_sees_money(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.venue_id = p_venue_id AND mp.user_id = auth.uid()
                          AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)))))
      OR (p_organizer_user_id IS NOT NULL AND (
            public.crm_org_role(auth.uid(), p_organizer_user_id) IN ('owner', 'admin')
            OR public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')))
    ));
$function$;
REVOKE ALL ON FUNCTION public.crm_scope_sees_money(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_sees_money(text, uuid) TO authenticated, service_role;

-- L'équipe : le fondateur ou un admin (organisation), le propriétaire (club).
CREATE OR REPLACE FUNCTION public.crm_user_manages_team(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    public.is_super_admin()
    OR (p_venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = p_user_id))
    OR (p_organizer_user_id IS NOT NULL AND (
          public.crm_org_role(p_user_id, p_organizer_user_id) IN ('owner', 'admin')
          OR public.org_member_has_permission(p_user_id, p_organizer_user_id, 'manage_team'))));
$function$;
REVOKE ALL ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) TO authenticated, service_role;

-- ── 3. Le chiffre d'affaires masqué ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_null_money(j jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_keys text[] := ARRAY['revenue', 'prev_revenue', 'attributed_revenue', 'spent', 'amount'];
  v_idx int[];
  v_out jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(j) = 'object' THEN
    -- Tableau positionnel (export : columns + rows).
    IF j ? 'columns' AND j ? 'rows' AND jsonb_typeof(j->'columns') = 'array' AND jsonb_typeof(j->'rows') = 'array' THEN
      SELECT array_agg((c.ord - 1)::int) INTO v_idx
        FROM jsonb_array_elements_text(j->'columns') WITH ORDINALITY c(name, ord) WHERE c.name = ANY (v_keys);
      IF v_idx IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg((SELECT jsonb_agg(CASE WHEN (e.ord - 1)::int = ANY (v_idx) THEN 'null'::jsonb ELSE e.val END ORDER BY e.ord)
                                     FROM jsonb_array_elements(r.val) WITH ORDINALITY e(val, ord)) ORDER BY r.ord), '[]'::jsonb)
          INTO v_out FROM jsonb_array_elements(j->'rows') WITH ORDINALITY r(val, ord);
        RETURN jsonb_set(j, '{rows}', v_out);
      END IF;
    END IF;
    SELECT COALESCE(jsonb_object_agg(e.key, CASE WHEN e.key = ANY (v_keys) THEN 'null'::jsonb ELSE public._crm_null_money(e.value) END), '{}'::jsonb)
      INTO v_out FROM jsonb_each(j) e;
    RETURN v_out;
  ELSIF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public._crm_null_money(a.value) ORDER BY a.ord), '[]'::jsonb)
      INTO v_out FROM jsonb_array_elements(j) WITH ORDINALITY a(value, ord);
    RETURN v_out;
  END IF;
  RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_null_money(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._crm_money_gate(p jsonb, p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN public.crm_scope_sees_money(p_venue_id, p_organizer_user_id) THEN p ELSE public._crm_null_money(p) END;
$$;
REVOKE ALL ON FUNCTION public._crm_money_gate(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Les espaces : le lecteur y entre, chaque rôle est rendu ─────────────
CREATE OR REPLACE FUNCTION public.get_my_crm_spaces()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT COALESCE(jsonb_agg(s ORDER BY s->>'sort', s->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'kind', 'venue',
             'key', 'venue:' || v.id,
             'venue_id', v.id,
             'organizer_user_id', NULL,
             'name', v.name,
             'city', v.city,
             'logo_url', v.logo_url,
             'role', CASE WHEN v.owner_id = me.uid THEN 'owner' ELSE 'manager' END,
             'sort', CASE WHEN v.owner_id = me.uid THEN '0' ELSE '2' END
           ) AS s
      FROM public.venues v, me
     WHERE me.uid IS NOT NULL
       AND v.product = 'crm'
       AND public.can_manage_venue(me.uid, v.id)
    UNION ALL
    SELECT jsonb_build_object(
             'kind', 'org',
             'key', 'org:' || o.user_id,
             'venue_id', NULL,
             'organizer_user_id', o.user_id,
             'name', COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation'),
             'city', o.city,
             'logo_url', COALESCE(o.avatar_url, p.organization_logo_url),
             'role', public.crm_org_role(me.uid, o.user_id),
             'sort', CASE WHEN o.user_id = me.uid THEN '0' ELSE '1' END
           )
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id, me
     WHERE me.uid IS NOT NULL
       AND o.product = 'crm'
       AND public.crm_org_role(me.uid, o.user_id) IS NOT NULL
  ) q;
$function$;

-- ── 5. Les RPC d'écriture passent par crm_scope_writable ────────────────────
CREATE OR REPLACE FUNCTION public.crm_client_save(p_venue_id text, p_organizer_user_id uuid, p_email text, p_tags text[] DEFAULT NULL::text[], p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_tags text[];
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_em = '' THEN RAISE EXCEPTION 'email_required' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(DISTINCT left(btrim(x), 24)) FILTER (WHERE btrim(x) <> '') INTO v_tags FROM unnest(COALESCE(p_tags, '{}')) x;

  INSERT INTO public.crm_contact_notes AS n (scope_key, email, venue_id, organizer_user_id, tags, note, updated_by)
  VALUES (v_key, v_em, p_venue_id, p_organizer_user_id, COALESCE(v_tags, '{}'), left(p_note, 4000), auth.uid())
  ON CONFLICT (scope_key, email) DO UPDATE SET
    tags = CASE WHEN p_tags IS NULL THEN n.tags ELSE COALESCE(v_tags, '{}') END,
    note = CASE WHEN p_note IS NULL THEN n.note ELSE left(p_note, 4000) END,
    updated_by = auth.uid(),
    updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_email_settings_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tests text[];
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
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
    sender_name = CASE WHEN p_patch ? 'sender_name' THEN NULLIF(btrim(p_patch->>'sender_name'), '') ELSE sender_name END,
    reply_to = CASE WHEN p_patch ? 'reply_to' THEN NULLIF(lower(btrim(p_patch->>'reply_to')), '') ELSE reply_to END,
    postal_address = CASE WHEN p_patch ? 'postal_address' THEN NULLIF(btrim(p_patch->>'postal_address'), '') ELSE postal_address END,
    quiet_hours = CASE WHEN p_patch ? 'quiet_hours' THEN (p_patch->>'quiet_hours')::boolean ELSE quiet_hours END,
    waves = CASE WHEN p_patch ? 'waves' THEN (p_patch->>'waves')::boolean ELSE waves END,
    notify_done = CASE WHEN p_patch ? 'notify_done' THEN (p_patch->>'notify_done')::boolean ELSE notify_done END,
    test_emails = CASE WHEN p_patch ? 'test_emails' THEN v_tests ELSE test_emails END,
    updated_by = auth.uid(), updated_at = now()
  WHERE scope_key = v_key;
  RETURN public.crm_email_settings_get(p_venue_id, p_organizer_user_id);
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
      NULL, NULL, left(COALESCE(p_title, 'Import'), 60), 'FR', v_channels, NULL, 'append', false);
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
       AND lower(ns.email) IN (SELECT lower(btrim(x->>'email')) FROM jsonb_array_elements(p_rows) x WHERE x ? 'email')
    ON CONFLICT (list_import_id, email) DO NOTHING;
  END IF;

  IF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 0 OR p_final THEN
    v_res := public.import_contact_list(
      COALESCE(p_rows, '[]'::jsonb), 'other', p_venue_id, p_organizer_user_id, v_ci.title, v_details,
      NULL, v_list, NULL, 'FR', v_channels, NULL, 'append', COALESCE(p_final, false));
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
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
      RETURNING 1
    ) SELECT count(*) INTO v_restored FROM r;
    -- Créés par cet import : retirés (un désabonné reste, c'est sa mémoire).
    WITH d AS (
      DELETE FROM public.newsletter_subscriptions ns
       WHERE ns.import_id = v_email_import
         AND ns.opted_out_at IS NULL
         AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND NOT EXISTS (SELECT 1 FROM public.crm_import_journal j WHERE j.list_import_id = p_list_import_id AND j.email = lower(ns.email))
      RETURNING 1
    ) SELECT count(*) INTO v_deleted FROM d;
  END IF;

  IF v_sms_import IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.venue_sms_contacts vc
       WHERE vc.import_id = v_sms_import
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

CREATE OR REPLACE FUNCTION public.crm_segment_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.crm_segments WHERE id = p_id AND scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_segment_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text, p_definition jsonb, p_template text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_id uuid;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'name_required' USING ERRCODE = '22023'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.crm_segments (scope_key, venue_id, organizer_user_id, name, description, template, definition, created_by)
    VALUES (v_key, p_venue_id, p_organizer_user_id, left(btrim(p_name), 80), p_description, p_template, COALESCE(p_definition, '{}'::jsonb), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.crm_segments
       SET name = left(btrim(p_name), 80),
           description = COALESCE(p_description, description),
           definition = COALESCE(p_definition, definition),
           updated_at = now()
     WHERE id = p_id AND scope_key = v_key
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_crm_settings(p_venue_id text, p_organizer_user_id uuid, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  v_key := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id::text END;

  INSERT INTO public.crm_settings AS s (scope_key, venue_id, organizer_user_id, regular_min_nights,
                                        regular_window_months, lapse_months, night_end_hour,
                                        retention_months, updated_by)
  VALUES (
    v_key, p_venue_id, p_organizer_user_id,
    COALESCE((p_settings->>'regular_min_nights')::smallint, 3),
    COALESCE((p_settings->>'regular_window_months')::smallint, 6),
    COALESCE((p_settings->>'lapse_months')::smallint, 4),
    COALESCE((p_settings->>'night_end_hour')::smallint, 6),
    NULLIF(p_settings->>'retention_months', '')::smallint,
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
    updated_by = auth.uid(),
    updated_at = now();

  RETURN public.get_crm_settings(p_venue_id, p_organizer_user_id);
END;
$function$;

-- ── 6. Les lectures qui rendent des montants passent par _crm_money_gate ───
ALTER FUNCTION public.crm_client(p_venue_id text, p_organizer_user_id uuid, p_email text) RENAME TO crm_client__core;
REVOKE ALL ON FUNCTION public.crm_client__core(p_venue_id text, p_organizer_user_id uuid, p_email text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_client__core(p_venue_id text, p_organizer_user_id uuid, p_email text) TO service_role;
CREATE FUNCTION public.crm_client(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_client__core(p_venue_id, p_organizer_user_id, p_email), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_client(p_venue_id text, p_organizer_user_id uuid, p_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_client(p_venue_id text, p_organizer_user_id uuid, p_email text) TO authenticated, service_role;

ALTER FUNCTION public.crm_clients_export(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_emails text[]) RENAME TO crm_clients_export__core;
REVOKE ALL ON FUNCTION public.crm_clients_export__core(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_emails text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_clients_export__core(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_emails text[]) TO service_role;
CREATE FUNCTION public.crm_clients_export(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_emails text[] DEFAULT NULL::text[])
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_clients_export__core(p_venue_id, p_organizer_user_id, p_def, p_emails), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_clients_export(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_emails text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_clients_export(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_emails text[]) TO authenticated, service_role;

ALTER FUNCTION public.crm_clients_list(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_sort text, p_dir integer, p_limit integer, p_offset integer) RENAME TO crm_clients_list__core;
REVOKE ALL ON FUNCTION public.crm_clients_list__core(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_sort text, p_dir integer, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_clients_list__core(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_sort text, p_dir integer, p_limit integer, p_offset integer) TO service_role;
CREATE FUNCTION public.crm_clients_list(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_def jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'last'::text, p_dir integer DEFAULT 1, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_clients_list__core(p_venue_id, p_organizer_user_id, p_def, p_sort, p_dir, p_limit, p_offset), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_clients_list(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_sort text, p_dir integer, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_clients_list(p_venue_id text, p_organizer_user_id uuid, p_def jsonb, p_sort text, p_dir integer, p_limit integer, p_offset integer) TO authenticated, service_role;

ALTER FUNCTION public.crm_email_analysis(p_venue_id text, p_organizer_user_id uuid) RENAME TO crm_email_analysis__core;
REVOKE ALL ON FUNCTION public.crm_email_analysis__core(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_analysis__core(p_venue_id text, p_organizer_user_id uuid) TO service_role;
CREATE FUNCTION public.crm_email_analysis(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_email_analysis__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_email_analysis(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_analysis(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.crm_email_campaigns(p_venue_id text, p_organizer_user_id uuid) RENAME TO crm_email_campaigns__core;
REVOKE ALL ON FUNCTION public.crm_email_campaigns__core(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_campaigns__core(p_venue_id text, p_organizer_user_id uuid) TO service_role;
CREATE FUNCTION public.crm_email_campaigns(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_email_campaigns__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_email_campaigns(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_campaigns(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.crm_email_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) RENAME TO crm_email_overview__core;
REVOKE ALL ON FUNCTION public.crm_email_overview__core(p_venue_id text, p_organizer_user_id uuid, p_days integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_overview__core(p_venue_id text, p_organizer_user_id uuid, p_days integer) TO service_role;
CREATE FUNCTION public.crm_email_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_email_overview__core(p_venue_id, p_organizer_user_id, p_days), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_email_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) TO authenticated, service_role;

ALTER FUNCTION public.crm_email_recipients(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text, p_q text, p_offset integer) RENAME TO crm_email_recipients__core;
REVOKE ALL ON FUNCTION public.crm_email_recipients__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text, p_q text, p_offset integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_recipients__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text, p_q text, p_offset integer) TO service_role;
CREATE FUNCTION public.crm_email_recipients(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text DEFAULT 'all'::text, p_q text DEFAULT NULL::text, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_email_recipients__core(p_venue_id, p_organizer_user_id, p_campaign_id, p_filter, p_q, p_offset), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_email_recipients(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text, p_q text, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_recipients(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid, p_filter text, p_q text, p_offset integer) TO authenticated, service_role;

ALTER FUNCTION public.crm_email_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) RENAME TO crm_email_result__core;
REVOKE ALL ON FUNCTION public.crm_email_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_result__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) TO service_role;
CREATE FUNCTION public.crm_email_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_email_result__core(p_venue_id, p_organizer_user_id, p_campaign_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_email_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.crm_email_result_segments(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) RENAME TO crm_email_result_segments__core;
REVOKE ALL ON FUNCTION public.crm_email_result_segments__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_email_result_segments__core(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) TO service_role;
CREATE FUNCTION public.crm_email_result_segments(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_email_result_segments__core(p_venue_id, p_organizer_user_id, p_campaign_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_email_result_segments(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_result_segments(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.crm_home(p_venue_id text, p_organizer_user_id uuid, p_period text) RENAME TO crm_home__core;
REVOKE ALL ON FUNCTION public.crm_home__core(p_venue_id text, p_organizer_user_id uuid, p_period text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_home__core(p_venue_id text, p_organizer_user_id uuid, p_period text) TO service_role;
CREATE FUNCTION public.crm_home(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_home__core(p_venue_id, p_organizer_user_id, p_period), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_home(p_venue_id text, p_organizer_user_id uuid, p_period text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_home(p_venue_id text, p_organizer_user_id uuid, p_period text) TO authenticated, service_role;

ALTER FUNCTION public.crm_night_detail(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) RENAME TO crm_night_detail__core;
REVOKE ALL ON FUNCTION public.crm_night_detail__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_night_detail__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO service_role;
CREATE FUNCTION public.crm_night_detail(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_night_detail__core(p_venue_id, p_organizer_user_id, p_event_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_night_detail(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_detail(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.crm_nights(p_venue_id text, p_organizer_user_id uuid) RENAME TO crm_nights__core;
REVOKE ALL ON FUNCTION public.crm_nights__core(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_nights__core(p_venue_id text, p_organizer_user_id uuid) TO service_role;
CREATE FUNCTION public.crm_nights(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_nights__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_nights(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_nights(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.crm_segment_detail(p_venue_id text, p_organizer_user_id uuid, p_seg_key text, p_period text) RENAME TO crm_segment_detail__core;
REVOKE ALL ON FUNCTION public.crm_segment_detail__core(p_venue_id text, p_organizer_user_id uuid, p_seg_key text, p_period text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_segment_detail__core(p_venue_id text, p_organizer_user_id uuid, p_seg_key text, p_period text) TO service_role;
CREATE FUNCTION public.crm_segment_detail(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_seg_key text DEFAULT NULL::text, p_period text DEFAULT '30d'::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_segment_detail__core(p_venue_id, p_organizer_user_id, p_seg_key, p_period), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_segment_detail(p_venue_id text, p_organizer_user_id uuid, p_seg_key text, p_period text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segment_detail(p_venue_id text, p_organizer_user_id uuid, p_seg_key text, p_period text) TO authenticated, service_role;

ALTER FUNCTION public.crm_segments_overview(p_venue_id text, p_organizer_user_id uuid, p_period text) RENAME TO crm_segments_overview__core;
REVOKE ALL ON FUNCTION public.crm_segments_overview__core(p_venue_id text, p_organizer_user_id uuid, p_period text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_segments_overview__core(p_venue_id text, p_organizer_user_id uuid, p_period text) TO service_role;
CREATE FUNCTION public.crm_segments_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.crm_segments_overview__core(p_venue_id, p_organizer_user_id, p_period), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_segments_overview(p_venue_id text, p_organizer_user_id uuid, p_period text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segments_overview(p_venue_id text, p_organizer_user_id uuid, p_period text) TO authenticated, service_role;

ALTER FUNCTION public.get_crm_night_report(p_event_id uuid) RENAME TO get_crm_night_report__core;
REVOKE ALL ON FUNCTION public.get_crm_night_report__core(p_event_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_night_report__core(p_event_id uuid) TO service_role;
CREATE FUNCTION public.get_crm_night_report(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (public.crm_scope_sees_money(e.venue_id, NULL) OR public.crm_scope_sees_money(NULL, e.organizer_user_id))) THEN public.get_crm_night_report__core(p_event_id) ELSE public._crm_null_money(public.get_crm_night_report__core(p_event_id)) END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_night_report(p_event_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_night_report(p_event_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_crm_nights(p_venue_id text, p_organizer_user_id uuid, p_limit integer, p_offset integer) RENAME TO get_crm_nights__core;
REVOKE ALL ON FUNCTION public.get_crm_nights__core(p_venue_id text, p_organizer_user_id uuid, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_nights__core(p_venue_id text, p_organizer_user_id uuid, p_limit integer, p_offset integer) TO service_role;
CREATE FUNCTION public.get_crm_nights(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.get_crm_nights__core(p_venue_id, p_organizer_user_id, p_limit, p_offset), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_crm_nights(p_venue_id text, p_organizer_user_id uuid, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_nights(p_venue_id text, p_organizer_user_id uuid, p_limit integer, p_offset integer) TO authenticated, service_role;

ALTER FUNCTION public.get_crm_overview(p_venue_id text, p_organizer_user_id uuid) RENAME TO get_crm_overview__core;
REVOKE ALL ON FUNCTION public.get_crm_overview__core(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_overview__core(p_venue_id text, p_organizer_user_id uuid) TO service_role;
CREATE FUNCTION public.get_crm_overview(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._crm_money_gate(public.get_crm_overview__core(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_crm_overview(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_overview(p_venue_id text, p_organizer_user_id uuid) TO authenticated, service_role;
