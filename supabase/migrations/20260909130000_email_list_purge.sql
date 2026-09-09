-- Purge des listes importées : garder le propre, détruire le mort.
--
-- Jusqu'ici un désabonné ou une adresse injoignable restait dans la liste
-- importée (ligne newsletter_subscriptions à opted_in=false / opted_out_at,
-- ou adresse présente dans email_suppressions) : exclue à l'envoi, mais
-- toujours là, et toujours dans les exports. Le pro veut une liste propre.
--
-- Le piège : la ligne désabonnée EST la mémoire du refus (le DO UPDATE de
-- import_email_contacts refuse de la réactiver). La détruire sans rien
-- garder, c'est réabonner la personne au prochain import du même fichier.
-- D'où le repoussoir email_opt_outs, par portée : la purge y verse chaque
-- adresse avant de la supprimer, et l'import l'y consulte. Ne JAMAIS purger
-- email_opt_outs : c'est lui qui rend la purge légale.
--
--   get_email_lists_health(portée)  → par import : total, actifs, désabonnés,
--                                     injoignables, déjà purgés
--   purge_email_list(import)        → verse au repoussoir, supprime les
--                                     abonnements morts, efface l'email dans
--                                     imported_contacts (la matière), rend
--                                     les comptes
--   export_email_list(import)       → les actifs seulement (jamais un
--                                     désabonné, jamais une adresse morte)
--   import_email_contacts           → corps LIVE + NOT EXISTS sur le
--                                     repoussoir (même signature, donc
--                                     CREATE OR REPLACE)

-- ── 1. Repoussoir par portée ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text,
  organizer_user_id uuid,
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribed', 'suppressed')),
  import_id uuid REFERENCES public.email_list_imports(id) ON DELETE SET NULL,
  opted_out_at timestamptz,
  purged_at timestamptz NOT NULL DEFAULT now(),
  purged_by uuid,
  CHECK (NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_venue
  ON public.email_opt_outs (lower(email), venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_organizer
  ON public.email_opt_outs (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_opt_outs_platform
  ON public.email_opt_outs (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_opt_outs_import ON public.email_opt_outs (import_id) WHERE import_id IS NOT NULL;
ALTER TABLE public.email_opt_outs ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lecture et écriture par les RPC SECURITY DEFINER seulement.
COMMENT ON TABLE public.email_opt_outs IS
  'Repoussoir par portée : adresses purgées d''une liste importée (désabonnées ou injoignables). Consulté par import_email_contacts ; ne jamais vider.';

-- ── 2. Accès à un import : la ligne, ou une exception ────────────────────────
CREATE OR REPLACE FUNCTION public._email_list_import_for_actor(p_import_id uuid)
RETURNS public.email_list_imports
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  imp public.email_list_imports;
BEGIN
  SELECT * INTO imp FROM public.email_list_imports WHERE id = p_import_id;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  IF imp.venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), imp.venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF imp.organizer_user_id IS NOT NULL THEN
    IF NOT (imp.organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN imp;
END;
$$;
REVOKE ALL ON FUNCTION public._email_list_import_for_actor(uuid) FROM PUBLIC;

-- ── 3. Santé des listes d'une portée (une requête pour toutes) ───────────────
CREATE OR REPLACE FUNCTION public.get_email_lists_health(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH imports AS (
    SELECT i.id, i.filename, i.list_name, i.created_at
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
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
$$;
REVOKE ALL ON FUNCTION public.get_email_lists_health(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_lists_health(text, uuid) TO authenticated, service_role;

-- ── 4. Purge : verser au repoussoir, puis détruire ───────────────────────────
CREATE OR REPLACE FUNCTION public.purge_email_list(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
  INSERT INTO public.email_opt_outs (venue_id, organizer_user_id, email, reason, import_id, opted_out_at, purged_by)
  SELECT imp.venue_id, imp.organizer_user_id, d.email, d.reason, p_import_id, d.opted_out_at, auth.uid()
    FROM _dead d
  ON CONFLICT DO NOTHING;

  -- 2. Les abonnements morts.
  DELETE FROM public.newsletter_subscriptions s WHERE s.id IN (SELECT id FROM _dead);

  -- 3. La matière (imported_contacts) : l'email disparaît, la ligne ne reste
  --    que si elle porte encore un téléphone.
  UPDATE public.imported_contacts c
     SET email = NULL
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, imp.venue_id, imp.organizer_user_id)
     AND c.email IS NOT NULL
     AND lower(c.email) IN (SELECT email FROM _dead);
  DELETE FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, imp.venue_id, imp.organizer_user_id)
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
$$;
REVOKE ALL ON FUNCTION public.purge_email_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_email_list(uuid) TO authenticated, service_role;

-- ── 5. Export : le propre, rien d'autre ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.export_email_list(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  imp public.email_list_imports;
  v_out jsonb;
BEGIN
  imp := public._email_list_import_for_actor(p_import_id);
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Export indisponible en session support';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', s.email,
           'first_name', s.first_name,
           'last_name', s.last_name,
           'consent_source', s.consent_source,
           'consent_recorded_at', s.consent_recorded_at,
           'created_at', s.created_at
         ) ORDER BY lower(s.email)), '[]'::jsonb)
    INTO v_out
    FROM public.newsletter_subscriptions s
   WHERE s.import_id = p_import_id
     AND s.opted_in AND s.opted_out_at IS NULL
     AND NOT public.is_email_suppressed(s.email);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.export_email_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_email_list(uuid) TO authenticated, service_role;

-- ── 6. L'import consulte le repoussoir (corps LIVE, même signature) ──────────
CREATE OR REPLACE FUNCTION public.import_email_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_reactivated integer := 0;
  v_optout integer := 0;
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
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    -- Portée plateforme : la base marketing de Yuno elle-même.
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  -- 3. Jamais depuis une session support.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;

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
    INSERT INTO public.email_list_imports
      (venue_id, organizer_user_id, filename, consent_source, consent_details,
       collected_since, attested_by, list_name)
    VALUES (p_venue_id, p_organizer_user_id, p_filename, p_consent_source,
            p_consent_details, p_collected_since, v_uid,
            NULLIF(btrim(COALESCE(p_list_name, '')), ''))
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.email_list_imports
     WHERE id = v_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
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
         first_name, last_name)
      SELECT p_venue_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
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
         first_name, last_name)
      SELECT p_organizer_user_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
         AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = i.addr
                            AND public.marketing_scope_match(o.venue_id, o.organizer_user_id, p_venue_id, p_organizer_user_id))
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
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
$function$

