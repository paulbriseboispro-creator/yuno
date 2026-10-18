-- ============================================================================
-- LINK-01 — Un lien de partage se crée AVEC la capture de sa story.
--
-- `crm_link_create` (20261007120000) vérifiait l'URL de la capture par
-- `p_image_url ~ '^https://[^[:space:]]{1,480}$'`. Postgres refuse toute
-- répétition bornée au-delà de 255 (« invalid regular expression: invalid
-- repetition count(s) », erreur 2201B, vérifié sur la prod le 18/10). Le test
-- est calculé dans le DECLARE, dès que `p_image_url` n'est pas NULL : créer un
-- lien SANS capture passe, créer un lien AVEC capture échoue TOUJOURS. Aucun
-- lien avec capture en prod au 18/10 (774 liens suivis, dont 15 de partage CRM).
--
-- Même règle, écrite autrement : `https://` puis au moins un caractère sans
-- espace, 488 caractères au plus (8 + 480). Le reste de la fonction est
-- `pg_get_functiondef` de la prod du 18/10 (identique à 20261007120000,
-- `same-as-prod.mjs crm_link_create`) : seule l'expression de `v_image` change,
-- avec la ligne de commentaire qui l'explique.
-- Signature inchangée : pas de rechargement du cache de PostgREST.
--
-- Recherché sur toute la prod (prosrc de toutes les fonctions, contraintes,
-- policies, domaines) : aucun autre quantificateur `{n,m}` au-delà de 255.
--
-- Prouvé au banc : node scripts/crm-bench/link01.mjs run. Répétition sur la
-- prod, en transaction annulée :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/link01.sql \
--     20261024100100_crm_link_create_image_regex.sql
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Rejouer la définition de 20261007120000 (lignes 17 à 70), qui remet
-- l'expression `{1,480}` — donc l'erreur 2201B dès qu'une capture est jointe —
-- puis : DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261024100100';
-- Les liens créés entre-temps gardent leur `image_url` (une URL https valide).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_link_create(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_platform text, p_placement text, p_label text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 60), '');
  v_n integer;
  -- Une répétition bornée ne peut pas dépasser 255 dans une expression
  -- Postgres : la longueur se vérifie à part.
  v_image text := CASE WHEN p_image_url ~ '^https://[^[:space:]]+$' AND length(p_image_url) <= 488 THEN p_image_url END;
  v_row public.tracked_links%ROWTYPE;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT public._crm_link_creatable(p_platform, p_placement) THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_n FROM public.tracked_links WHERE event_id = p_event_id;
  IF v_n >= 300 THEN RAISE EXCEPTION 'too_many_links' USING ERRCODE = '54000'; END IF;

  IF v_label IS NULL THEN
    SELECT count(*) + 1 INTO v_n FROM public.tracked_links
     WHERE event_id = p_event_id AND utm_source = p_platform AND utm_medium = p_placement;
    v_label := initcap(p_placement) || ' ' || v_n;
  END IF;

  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium, utm_campaign, image_url)
  VALUES (public.gen_tracked_link_code(), v_label,
          CASE WHEN p_venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
          p_venue_id, CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END, auth.uid(),
          'event', p_event_id, p_platform, p_placement, 'yuno', v_image)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label', v_row.label,
    'platform', v_row.utm_source, 'placement', v_row.utm_medium, 'created_at', v_row.created_at,
    'image_url', v_row.image_url);
END;
$function$;

-- Droits de la prod du 18/10 : {postgres, authenticated, service_role}.
REVOKE ALL ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_create(text, uuid, uuid, text, text, text, text) TO authenticated, service_role;
