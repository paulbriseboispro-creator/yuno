-- ============================================================================
-- Le carnet des partenaires invités par email (espace invité d'une soirée).
--
-- Constat (Paul, 07/11) : Tia Felisa, invitée par email sur une soirée
-- d'Amoris, n'apparaît plus nulle part quand on prépare la soirée suivante —
-- la recherche « Ajouter un club ou une organisation » ne connaît que les
-- comptes Yuno, et un accès invité n'est qu'une ligne `event_guest_passes` liée
-- à UNE soirée. Même problème, et même réponse, que les artistes invités
-- (`get_guest_artist_book`) : ne saisir une personne qu'une fois.
--
-- Rien de nouveau à stocker : chaque accès déjà créé EST l'enregistrement du
-- partenaire (nom, type, adresse, langue, porte, photo). Le carnet les regroupe
-- par adresse e-mail et les rend à qui travaille pour la même partie.
--
--  • get_guest_partner_book(p_event_id) : les partenaires invités par email par
--    les parties de l'appelant (niveau gestion), une ligne par adresse, la plus
--    récente d'abord. Avec `p_event_id`, ceux déjà sur cette soirée sont écartés.
--  • reuse_guest_pass_photo : reprend sur un nouvel accès la photo d'un ancien
--    (même adresse, même partie invitante) sans rien copier dans le Storage ;
--    set_event_guest_pass_photo n'accepte que le dossier de l'accès lui-même.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_guest_partner_book(p_event_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  -- Ni visiteur, ni accès assisté : le carnet est le contact d'un pro.
  IF v_uid IS NULL OR public.is_support_session() THEN RETURN '[]'::jsonb; END IF;

  WITH mine AS (
    -- Les parties pour lesquelles l'appelant gère (niveau ≥ 2) : jugées UNE fois chacune.
    SELECT k.party
      FROM (SELECT DISTINCT h.created_by_party AS party
              FROM public.event_guest_passes h
             WHERE h.created_by_party IS NOT NULL) k
     WHERE public.coorg_party_level(v_uid, k.party) >= 2
  ), passes AS (
    SELECT h.*, e.title AS event_title, e.start_at AS event_start
      FROM public.event_guest_passes h
      JOIN mine m ON m.party = h.created_by_party
      LEFT JOIN public.events e ON e.id = h.event_id
     WHERE h.contact_email IS NOT NULL
  ), here AS (
    SELECT lower(h.contact_email) AS em
      FROM public.event_guest_passes h
     WHERE p_event_id IS NOT NULL AND h.event_id = p_event_id
       AND h.revoked_at IS NULL AND h.contact_email IS NOT NULL
  ), book AS (
    SELECT DISTINCT ON (lower(p.contact_email))
           p.guest_kind,
           p.guest_name,
           lower(p.contact_email) AS email,
           p.language,
           p.door_mode,
           (SELECT x.photo_url FROM passes x
             WHERE lower(x.contact_email) = lower(p.contact_email) AND x.photo_url IS NOT NULL
             ORDER BY x.created_at DESC LIMIT 1) AS photo_url,
           (SELECT x.id FROM passes x
             WHERE lower(x.contact_email) = lower(p.contact_email) AND x.photo_url IS NOT NULL
             ORDER BY x.created_at DESC LIMIT 1) AS photo_pass_id,
           count(*) OVER (PARTITION BY lower(p.contact_email))::integer AS times_invited,
           p.event_title AS last_event_title,
           p.event_start AS last_event_at,
           p.created_at AS last_at,
           bool_or(p.account_user_id IS NOT NULL) OVER (PARTITION BY lower(p.contact_email)) AS linked
      FROM passes p
     WHERE lower(p.contact_email) NOT IN (SELECT em FROM here)
     ORDER BY lower(p.contact_email), p.created_at DESC
  )
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.last_at DESC), '[]'::jsonb)
    INTO v_out
    FROM (SELECT * FROM book ORDER BY last_at DESC LIMIT 60) s;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_guest_partner_book(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_partner_book(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_guest_partner_book(uuid) IS
  'Partenaires déjà invités par email (espace invité) par les parties de l''appelant : un par adresse, pour les réinviter en un clic.';

CREATE OR REPLACE FUNCTION public.reuse_guest_pass_photo(p_pass_id uuid, p_from_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_from public.event_guest_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = p_pass_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._guest_pass_manager(v_pass.event_id);
  IF v_pass.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  -- Une photo choisie par l'invité lui-même n'est plus touchée par l'organisateur.
  IF v_pass.photo_set_by = 'guest' THEN RAISE EXCEPTION 'guest_photo_locked'; END IF;

  SELECT * INTO v_from FROM public.event_guest_passes WHERE id = p_from_pass_id;
  IF NOT FOUND OR v_from.photo_url IS NULL
     OR lower(v_from.contact_email) IS DISTINCT FROM lower(v_pass.contact_email)
     OR v_from.created_by_party IS DISTINCT FROM v_pass.created_by_party
     OR NOT public._guest_pass_photo_url_ok(v_from.id, v_from.photo_url) THEN
    RAISE EXCEPTION 'invalid_photo';
  END IF;

  UPDATE public.event_guest_passes
     SET photo_url = v_from.photo_url, photo_set_by = 'organizer'
   WHERE id = p_pass_id;
  RETURN jsonb_build_object('ok', true, 'photo_url', v_from.photo_url);
END;
$$;
REVOKE ALL ON FUNCTION public.reuse_guest_pass_photo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reuse_guest_pass_photo(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
