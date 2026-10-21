-- ============================================================================
-- Espace invité : la PHOTO DE PROFIL de l'invité (21/10, demande de Paul)
-- ============================================================================
-- • L'organisateur peut en précharger une (logo / photo du club) à
--   l'invitation, et la changer tant que l'invité ne l'a pas changée.
-- • L'invité la change depuis son espace, connecté au compte rattaché ; dès
--   qu'il l'a fait (`photo_set_by = 'guest'`), l'organisateur ne l'écrase plus.
-- • Fichiers : bucket `guest-pass-photos`, public en lecture par URL, 1 Mo,
--   WebP / JPEG / PNG seulement (limites du bucket, vérifiées par Storage),
--   chemin `<id de l'accès>/<fichier>`. Écriture : l'organisateur de la soirée
--   (partie principale, niveau ≥ 2) ou le compte rattaché, jamais un anonyme,
--   jamais en accès assisté. Aucune lecture par liste pour les autres.
-- • L'URL enregistrée doit être un fichier de CE dossier dans CE bucket.
-- • La photo s'affiche dans l'espace, sur la carte du profil, sur la fiche de
--   l'organisateur et dans « Qui fait vendre ».
-- ============================================================================

ALTER TABLE public.event_guest_passes
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_set_by text CHECK (photo_set_by IN ('organizer', 'guest'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('guest-pass-photos', 'guest-pass-photos', true, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 1048576,
  allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png'];

-- Qui peut écrire la photo de cet accès (fichier comme URL).
CREATE OR REPLACE FUNCTION public._guest_pass_photo_writer(p_pass_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_me record;
BEGIN
  IF auth.uid() IS NULL OR p_pass_id IS NULL OR public.is_support_session() THEN RETURN NULL; END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = p_pass_id;
  IF NOT FOUND OR v_pass.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  IF now() > public._guest_pass_close_at(v_pass.event_id) THEN RETURN NULL; END IF;
  IF v_pass.account_user_id = auth.uid() THEN RETURN 'guest'; END IF;
  IF v_pass.photo_set_by = 'guest' THEN RETURN NULL; END IF;
  SELECT * INTO v_me FROM public.my_event_party(v_pass.event_id);
  IF v_me.party_key IS NOT NULL AND v_me.role IN ('lead', 'partner') AND v_me.level >= 2 THEN RETURN 'organizer'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_photo_writer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._guest_pass_photo_writer(uuid) TO authenticated;

-- Le dossier d'un objet du bucket, lu comme un id d'accès (NULL sinon).
CREATE OR REPLACE FUNCTION public._guest_pass_photo_folder(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND p_name ~ '^[^/]+/[A-Za-z0-9._-]+$'
         THEN split_part(p_name, '/', 1)::uuid END;
$$;
GRANT EXECUTE ON FUNCTION public._guest_pass_photo_folder(text) TO authenticated;

DROP POLICY IF EXISTS "Guest pass photo writers read" ON storage.objects;
CREATE POLICY "Guest pass photo writers read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'guest-pass-photos' AND public._guest_pass_photo_writer(public._guest_pass_photo_folder(name)) IS NOT NULL);
DROP POLICY IF EXISTS "Guest pass photo writers upload" ON storage.objects;
CREATE POLICY "Guest pass photo writers upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'guest-pass-photos' AND public._guest_pass_photo_writer(public._guest_pass_photo_folder(name)) IS NOT NULL);
DROP POLICY IF EXISTS "Guest pass photo writers update" ON storage.objects;
CREATE POLICY "Guest pass photo writers update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'guest-pass-photos' AND public._guest_pass_photo_writer(public._guest_pass_photo_folder(name)) IS NOT NULL)
  WITH CHECK (bucket_id = 'guest-pass-photos' AND public._guest_pass_photo_writer(public._guest_pass_photo_folder(name)) IS NOT NULL);
DROP POLICY IF EXISTS "Guest pass photo writers delete" ON storage.objects;
CREATE POLICY "Guest pass photo writers delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'guest-pass-photos' AND public._guest_pass_photo_writer(public._guest_pass_photo_folder(name)) IS NOT NULL);

-- Une URL de photo acceptable pour CET accès : un fichier de son dossier.
CREATE OR REPLACE FUNCTION public._guest_pass_photo_url_ok(p_pass_id uuid, p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_url ~ ('^https://fulawxvdlwtdlpkycixe\.supabase\.co/storage/v1/object/public/guest-pass-photos/'
                  || p_pass_id::text || '/[A-Za-z0-9._-]+\.(webp|jpe?g|png)$');
$$;
REVOKE ALL ON FUNCTION public._guest_pass_photo_url_ok(uuid, text) FROM PUBLIC, anon;

-- L'organisateur : précharger ou changer la photo, tant que l'invité ne l'a pas fait.
CREATE OR REPLACE FUNCTION public.set_event_guest_pass_photo(p_pass_id uuid, p_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = p_pass_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._guest_pass_manager(v_pass.event_id);
  IF v_pass.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_pass.photo_set_by = 'guest' THEN RAISE EXCEPTION 'guest_photo_locked'; END IF;
  IF p_url IS NOT NULL AND NOT public._guest_pass_photo_url_ok(p_pass_id, p_url) THEN RAISE EXCEPTION 'invalid_photo'; END IF;
  UPDATE public.event_guest_passes
     SET photo_url = p_url, photo_set_by = CASE WHEN p_url IS NULL THEN NULL ELSE 'organizer' END
   WHERE id = p_pass_id;
  RETURN jsonb_build_object('ok', true, 'photo_url', p_url);
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_guest_pass_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_guest_pass_photo(uuid, text) TO authenticated;

-- L'invité, connecté au compte rattaché : sa photo, ou aucune (ses initiales).
-- Une fois qu'il a choisi, l'organisateur ne la touche plus.
CREATE OR REPLACE FUNCTION public.guest_pass_set_photo(p_token text, p_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  IF p_url IS NOT NULL AND NOT public._guest_pass_photo_url_ok(v_pass.id, p_url) THEN RAISE EXCEPTION 'invalid_photo'; END IF;
  UPDATE public.event_guest_passes SET photo_url = p_url, photo_set_by = 'guest' WHERE id = v_pass.id;
  RETURN jsonb_build_object('ok', true, 'photo_url', p_url);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_set_photo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_pass_set_photo(text, text) TO authenticated;

-- La carte du profil.
CREATE OR REPLACE FUNCTION public.get_my_guest_passes()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'pass_id', h.id, 'guest_name', h.guest_name, 'guest_kind', h.guest_kind, 'photo_url', h.photo_url,
           'event_title', e.title, 'event_start_at', e.start_at,
           'poster_url', coalesce(e.poster_url, e.image_url),
           'inviter_name', (SELECT p.display_name FROM public.event_parties(h.event_id) p WHERE p.party_key = h.created_by_party))
         ORDER BY e.start_at), '[]'::jsonb)
    FROM public.event_guest_passes h
    JOIN public.events e ON e.id = h.event_id
   WHERE auth.uid() IS NOT NULL AND h.account_user_id = auth.uid() AND h.revoked_at IS NULL
     AND now() <= coalesce(e.end_at, e.start_at + interval '8 hours') + interval '7 days';
$$;
REVOKE ALL ON FUNCTION public.get_my_guest_passes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_guest_passes() TO authenticated;

-- L'espace, la liste de l'organisateur et « Qui fait vendre » rendent la photo :
-- on ajoute le champ aux définitions EN BASE (la même transaction vérifie que
-- chaque fragment attendu est bien là, sinon tout est annulé).
DO $do$
DECLARE
  v_def text;
  v_new text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_event_guest_space(text)',
     $a$'places_requested', v_pass.places_requested, 'door_mode', v_pass.door_mode,$a$,
     $b$'places_requested', v_pass.places_requested, 'door_mode', v_pass.door_mode, 'photo_url', v_pass.photo_url, 'photo_set_by', v_pass.photo_set_by,$b$),
    -- (la ligne compte déjà près de 100 arguments, le plafond de jsonb_build_object : on concatène)
    ('public.list_event_guest_passes(uuid)',
     $a$jsonb_agg(jsonb_build_object(
               'id', h.id, 'guest_kind', h.guest_kind, 'guest_name', h.guest_name,$a$,
     $b$jsonb_agg(jsonb_build_object('photo_url', h.photo_url, 'photo_set_by', h.photo_set_by) || jsonb_build_object(
               'id', h.id, 'guest_kind', h.guest_kind, 'guest_name', h.guest_name,$b$),
    ('public.get_collab_party_breakdown(uuid)',
     $a$'id', h.id, 'name', h.guest_name, 'kind', h.guest_kind,$a$,
     $b$'id', h.id, 'name', h.guest_name, 'kind', h.guest_kind, 'photo_url', h.photo_url,$b$),
    -- « Yuno » et « Direct » rendent toutes les colonnes (comme une partie), pour
    -- que l'écran les retire proprement du « sans partenaire identifié ».
    ('public.get_collab_party_breakdown(uuid)', $a$    (SELECT jsonb_build_object('tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0),
              'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END)
       FROM (SELECT 1) one LEFT JOIN agg a ON a.pkey = 'yuno'),$a$, $b$    (SELECT jsonb_build_object('tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0),
              'table_guests', COALESCE(a.table_guests, 0), 'guests', COALESCE(a.guests, 0), 'entered', COALESCE(a.entered, 0),
              'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END)
       FROM (SELECT 1) one LEFT JOIN agg a ON a.pkey = 'yuno'),$b$),
    ('public.get_collab_party_breakdown(uuid)', $a$    (SELECT jsonb_build_object('tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0),
              'guests', COALESCE(a.guests, 0),
              'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END)
       FROM (SELECT 1) one LEFT JOIN agg a ON a.pkey = 'direct')$a$, $b$    (SELECT jsonb_build_object('tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0),
              'table_guests', COALESCE(a.table_guests, 0), 'guests', COALESCE(a.guests, 0), 'entered', COALESCE(a.entered, 0),
              'revenue', CASE WHEN v_money THEN COALESCE(a.ca, 0) END)
       FROM (SELECT 1) one LEFT JOIN agg a ON a.pkey = 'direct')$b$)
  ) AS t(fn, old_txt, new_txt) LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.old_txt IN v_def) = 0 THEN RAISE EXCEPTION 'fragment introuvable dans %', r.fn; END IF;
    v_new := replace(v_def, r.old_txt, r.new_txt);
    EXECUTE v_new;
  END LOOP;
END
$do$;
