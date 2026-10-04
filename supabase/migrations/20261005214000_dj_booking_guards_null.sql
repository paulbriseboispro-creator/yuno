-- ============================================================================
-- Bookings DJ : les gardes rendent « refusé » sur un test NULL.
--
-- `r.dj_user_id <> auth.uid()`, `c.created_by = auth.uid() OR …` : sans
-- session, ces tests valent NULL et la garde s'ouvrait. Prouvé le 04/10 en
-- transaction annulée, avec la seule clé publique : accepter, refuser ou
-- annuler la demande de booking d'un DJ, signer ou annuler son contrat,
-- révoquer une invitation de son équipe.
-- Pour un compte connecté : un manager sans club (get_user_venue_id NULL)
-- passait create_dj_booking_request / cancel_dj_booking_request (aucun compte
-- n'a ce rôle aujourd'hui), et match_djs_for_event s'ouvrait à tout compte
-- connecté sur une soirée de club sans organisateur (organizer_user_id NULL ;
-- prouvé sur une soirée démo).
-- Tests entourés d'un COALESCE(…, false) ou passés en IS DISTINCT FROM ; ces
-- fonctions ne sont plus exécutables par anon.
-- Corps repris de la base liée (pg_get_functiondef, 04/10).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_dj_booking_request(p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r       public.dj_booking_requests%ROWTYPE;
  v_src   public.djs%ROWTYPE;
  v_dj_id uuid;
  v_set_id uuid;
  v_start timestamptz;
  v_end   timestamptz;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.dj_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF r.expires_at < now() THEN
    UPDATE public.dj_booking_requests SET status = 'expired', updated_at = now() WHERE id = p_id;
    RAISE EXCEPTION 'Request has expired';
  END IF;

  -- Résout (ou crée) la ligne djs SOUS LE SCOPE DU BOOKER pour cette personne.
  IF r.venue_id IS NOT NULL THEN
    SELECT id INTO v_dj_id FROM public.djs
      WHERE user_id = r.dj_user_id AND venue_id = r.venue_id LIMIT 1;
  ELSE
    SELECT id INTO v_dj_id FROM public.djs
      WHERE user_id = r.dj_user_id AND organizer_user_id = r.organizer_user_id LIMIT 1;
  END IF;

  IF v_dj_id IS NULL THEN
    SELECT * INTO v_src FROM public.djs
      WHERE user_id = r.dj_user_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    INSERT INTO public.djs (user_id, venue_id, organizer_user_id, first_name, last_name,
                            stage_name, music_genres, is_active)
    VALUES (r.dj_user_id, r.venue_id, r.organizer_user_id,
            COALESCE(v_src.first_name, ''), COALESCE(v_src.last_name, ''), v_src.stage_name,
            COALESCE(v_src.music_genres, '{}'), true)
    RETURNING id INTO v_dj_id;
  END IF;

  v_start := COALESCE(r.start_time, r.requested_date::timestamptz + interval '22 hours');
  v_end   := COALESCE(r.end_time,   r.requested_date::timestamptz + interval '28 hours');

  INSERT INTO public.dj_sets (dj_id, venue_id, organizer_user_id, event_id, title, start_time, end_time, fee)
  VALUES (v_dj_id, r.venue_id, r.organizer_user_id, r.event_id,
          COALESCE(r.message, 'Booking'), v_start, v_end, COALESCE(r.agreed_fee, 0))
  RETURNING id INTO v_set_id;

  -- Demande liée à une soirée : l'acceptation vaut inscription au line-up public.
  -- Garde anti-doublon par PERSONNE (une autre ligne djs du même artiste peut
  -- déjà être à l'affiche via un ajout direct sous un autre scope).
  IF r.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_djs ed
    JOIN public.djs d ON d.id = ed.dj_id
    WHERE ed.event_id = r.event_id AND d.user_id = r.dj_user_id
  ) THEN
    INSERT INTO public.event_djs (event_id, dj_id)
    VALUES (r.event_id, v_dj_id)
    ON CONFLICT (event_id, dj_id) DO NOTHING;
  END IF;

  UPDATE public.dj_booking_requests
     SET status = 'accepted', dj_response_note = NULLIF(btrim(p_note), ''),
         responded_at = now(), created_dj_set_id = v_set_id, updated_at = now()
   WHERE id = p_id;

  RETURN v_set_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.decline_dj_booking_request(p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.dj_booking_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.dj_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  UPDATE public.dj_booking_requests
     SET status = 'declined', dj_response_note = NULLIF(btrim(p_note), ''),
         responded_at = now(), updated_at = now()
   WHERE id = p_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_dj_booking_request(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.dj_booking_requests%ROWTYPE;
  v_set_dj_id uuid;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT COALESCE(r.created_by = auth.uid()
          OR (r.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), r.venue_id))
          OR (r.venue_id IS NOT NULL AND public.has_role(auth.uid(), 'manager')
              AND public.get_user_venue_id(auth.uid()) = r.venue_id)
          OR (r.organizer_user_id IS NOT NULL AND r.organizer_user_id = auth.uid()), false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF r.status NOT IN ('pending', 'accepted') THEN RAISE EXCEPTION 'Cannot cancel this request'; END IF;

  -- Si déjà accepté, retire le set futur créé — et le line-up qui en découlait.
  -- On ne touche au line-up que si le set futur a bien été supprimé : une soirée
  -- passée reste affichée telle qu'elle a eu lieu.
  IF r.status = 'accepted' AND r.created_dj_set_id IS NOT NULL THEN
    DELETE FROM public.dj_sets WHERE id = r.created_dj_set_id AND start_time > now()
    RETURNING dj_id INTO v_set_dj_id;
    IF v_set_dj_id IS NOT NULL AND r.event_id IS NOT NULL THEN
      DELETE FROM public.event_djs WHERE event_id = r.event_id AND dj_id = v_set_dj_id;
    END IF;
  END IF;

  UPDATE public.dj_booking_requests SET status = 'cancelled', updated_at = now() WHERE id = p_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_dj_booking_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.dj_booking_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.dj_booking_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT COALESCE(c.created_by = auth.uid() OR c.dj_user_id = auth.uid()
          OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid()), false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_dj_setup','pending_signatures','pending_payment') THEN
    RAISE EXCEPTION 'Cannot cancel after funds are held (use refund)';
  END IF;
  UPDATE public.dj_booking_contracts SET status = 'cancelled' WHERE id = p_contract_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.sign_dj_booking_contract(p_contract_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c          public.dj_booking_contracts%ROWTYPE;
  v_is_club  boolean;
  v_is_dj    boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.dj_booking_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Contract is not awaiting signatures (status=%)', c.status;
  END IF;

  v_is_dj   := COALESCE(c.dj_user_id = auth.uid(), false);
  v_is_club := COALESCE((c.created_by = auth.uid())
               OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
               OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid()), false);
  IF NOT (v_is_dj OR v_is_club) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_club THEN
    UPDATE public.dj_booking_contracts
       SET club_signed_at = COALESCE(club_signed_at, now()),
           club_signed_by = COALESCE(club_signed_by, auth.uid()),
           club_signed_ip = COALESCE(club_signed_ip, p_ip),
           club_signed_user_agent = COALESCE(club_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  ELSE
    UPDATE public.dj_booking_contracts
       SET dj_signed_at = COALESCE(dj_signed_at, now()),
           dj_signed_by = COALESCE(dj_signed_by, auth.uid()),
           dj_signed_ip = COALESCE(dj_signed_ip, p_ip),
           dj_signed_user_agent = COALESCE(dj_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  END IF;

  SELECT * INTO c FROM public.dj_booking_contracts WHERE id = p_contract_id;
  v_both := c.club_signed_at IS NOT NULL AND c.dj_signed_at IS NOT NULL;

  IF v_both THEN
    UPDATE public.dj_booking_contracts
       SET status = 'pending_payment',
           terms_snapshot = jsonb_build_object(
             'cachet_cents', c.cachet_cents,
             'acompte_cents', c.acompte_cents,
             'stripe_fee_cents', c.stripe_fee_cents,
             'currency', c.currency,
             'cancellation_policy', c.cancellation_policy,
             'club_signed_at', c.club_signed_at,
             'dj_signed_at', c.dj_signed_at,
             'dj_user_id', c.dj_user_id,
             'created_by', c.created_by,
             'dj_set_id', c.dj_set_id,
             'frozen_at', now()
           )
     WHERE id = p_contract_id;
    RETURN 'pending_payment';
  END IF;

  RETURN 'pending_signatures';
END; $function$;

CREATE OR REPLACE FUNCTION public.dj_revoke_team_invitation(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv public.dj_team_invitations;
begin
  select * into inv from public.dj_team_invitations where id = p_id;
  if inv.id is null or inv.dj_user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.dj_team_invitations set status = 'revoked' where id = p_id;

  if inv.member_user_id is not null then
    update public.dj_team_members set status = 'revoked'
      where dj_user_id = inv.dj_user_id and member_user_id = inv.member_user_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_dj_booking_request(p_dj_user_id uuid, p_requested_date date, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_agreed_fee numeric DEFAULT NULL::numeric, p_message text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_requested_genres text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL)
     OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of venue or organizer scope is required';
  END IF;

  -- Scope club : propriétaire OU manager du même club.
  IF p_venue_id IS NOT NULL
     AND NOT public.is_venue_owner(auth.uid(), p_venue_id)
     AND NOT COALESCE(public.has_role(auth.uid(), 'manager') AND public.get_user_venue_id(auth.uid()) = p_venue_id, false) THEN
    RAISE EXCEPTION 'Unauthorized: not the venue owner';
  END IF;
  IF p_organizer_user_id IS NOT NULL AND p_organizer_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: organizer scope mismatch';
  END IF;
  IF p_dj_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot book yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.djs WHERE user_id = p_dj_user_id AND is_active = true) THEN
    RAISE EXCEPTION 'Target is not an active DJ';
  END IF;

  INSERT INTO public.dj_booking_requests (
    venue_id, organizer_user_id, created_by, dj_user_id, requested_date,
    start_time, end_time, agreed_fee, message, event_id, requested_genres
  ) VALUES (
    p_venue_id, p_organizer_user_id, auth.uid(), p_dj_user_id, p_requested_date,
    p_start, p_end, p_agreed_fee, NULLIF(btrim(p_message), ''), p_event_id,
    COALESCE(p_requested_genres, '{}')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.match_djs_for_event(p_event_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(user_id uuid, dj_id uuid, handle text, slug text, stage_name text, city text, profile_image_url text, music_genres text[], is_verified boolean, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_event RECORD;
  v_emb   extensions.vector(1536);
BEGIN
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id, e.venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Le caller doit être un booker de CETTE soirée.
  IF NOT (
    (v_event.venue_id IS NOT NULL AND public.is_venue_owner(v_user, v_event.venue_id))
    OR COALESCE(v_event.organizer_user_id = v_user, false)
    OR COALESCE(v_event.partner_organizer_id = v_user, false)
  ) THEN
    RETURN;
  END IF;

  SELECT ee.embedding INTO v_emb
  FROM public.event_embeddings ee
  WHERE ee.event_id = p_event_id;

  -- Pas encore d'embedding pour cette soirée (cron pas passé) → aucun match,
  -- le front masque la section.
  IF v_emb IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH best AS (
    SELECT DISTINCT ON (de.user_id)
      de.user_id,
      de.dj_id,
      1 - (de.embedding OPERATOR(extensions.<=>) v_emb) AS similarity
    FROM public.dj_embeddings de
    JOIN public.djs d ON d.id = de.dj_id
    WHERE d.is_active = true
    ORDER BY de.user_id, (de.embedding OPERATOR(extensions.<=>) v_emb) ASC
  )
  SELECT
    b.user_id,
    b.dj_id,
    h.handle,
    d.slug,
    COALESCE(NULLIF(btrim(d.stage_name), ''),
             btrim(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, ''))) AS stage_name,
    d.city,
    d.profile_image_url,
    COALESCE(d.music_genres, '{}') AS music_genres,
    COALESCE(d.is_verified, false) AS is_verified,
    b.similarity
  FROM best b
  JOIN public.djs d ON d.id = b.dj_id
  LEFT JOIN public.dj_handles h ON h.user_id = b.user_id
  -- Sous 0.15 de similarité cosine, le « match » n'en est plus un : mieux vaut
  -- ne rien proposer que du bruit.
  WHERE b.similarity > 0.15
  ORDER BY b.similarity DESC
  LIMIT greatest(1, least(p_limit, 20));
END;
$function$;


REVOKE ALL ON FUNCTION public.accept_dj_booking_request(p_id uuid, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_dj_booking_request(p_id uuid, p_note text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.decline_dj_booking_request(p_id uuid, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_dj_booking_request(p_id uuid, p_note text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_dj_booking_request(p_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_dj_booking_request(p_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_dj_booking_contract(p_contract_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_dj_booking_contract(p_contract_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sign_dj_booking_contract(p_contract_id uuid, p_ip text, p_user_agent text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_dj_booking_contract(p_contract_id uuid, p_ip text, p_user_agent text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.dj_revoke_team_invitation(p_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dj_revoke_team_invitation(p_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_dj_booking_request(p_dj_user_id uuid, p_requested_date date, p_start timestamp with time zone, p_end timestamp with time zone, p_agreed_fee numeric, p_message text, p_event_id uuid, p_venue_id text, p_organizer_user_id uuid, p_requested_genres text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_dj_booking_request(p_dj_user_id uuid, p_requested_date date, p_start timestamp with time zone, p_end timestamp with time zone, p_agreed_fee numeric, p_message text, p_event_id uuid, p_venue_id text, p_organizer_user_id uuid, p_requested_genres text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.match_djs_for_event(p_event_id uuid, p_limit integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_djs_for_event(p_event_id uuid, p_limit integer) TO authenticated, service_role;
