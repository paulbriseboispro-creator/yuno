-- DJ Marketplace (Barreau C) — RPCs.
-- Toutes SECURITY DEFINER (bypass RLS pour agréger l'identité par-personne en sécurité).
-- Tiers (verified/rising/resident), recherche classée, cycle de booking, dispo, admin verify,
-- + extension du profil public (rate + tiers).

-- =============================================================================
-- 1. get_dj_tiers — trust layer + complétude, PAR PERSONNE (user_id)
--    verified = is_verified sur n'importe quelle ligne de la personne.
--    rising   = (>=10 nouveaux followers ET >=25% de croissance sur 30j) OU >=3 sets sur 90j.
--    resident = résidence déclarée active OU >=4 sets même scope sur 180j.
--    completeness_pct = somme pondérée des champs de profil (le levier "soigne ton profil").
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_tiers(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_row          public.djs%ROWTYPE;
  v_verified     boolean;
  v_followers    int;
  v_new_30       int;
  v_sets_90      int;
  v_rising       boolean;
  v_resident     jsonb;
  v_has_photo    boolean;
  v_has_rate     boolean;
  v_completeness numeric;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.djs
   WHERE user_id = p_user_id AND is_active = true
   ORDER BY (cover_image_url IS NOT NULL) DESC,
            (profile_image_url IS NOT NULL) DESC,
            updated_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_verified := EXISTS (SELECT 1 FROM public.djs WHERE user_id = p_user_id AND is_verified = true);

  SELECT count(DISTINCT f.user_id) INTO v_followers
    FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
   WHERE d.user_id = p_user_id AND f.favorite_type = 'dj';

  SELECT count(DISTINCT f.user_id) INTO v_new_30
    FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
   WHERE d.user_id = p_user_id AND f.favorite_type = 'dj'
     AND f.created_at >= now() - interval '30 days';

  SELECT count(*) INTO v_sets_90
    FROM public.dj_sets s JOIN public.djs d ON d.id = s.dj_id
   WHERE d.user_id = p_user_id AND s.start_time >= now() - interval '90 days';

  -- Rising : plancher absolu (>=10) pour éviter le bruit 1->2 = 100%.
  v_rising := (v_new_30 >= 10
               AND v_new_30::numeric >= 0.25 * GREATEST(v_followers - v_new_30, 1))
              OR v_sets_90 >= 3;

  -- Resident : résidences déclarées actives + dérivées (>=4 sets/180j) par scope, avec nom.
  SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(t)), '[]'::jsonb) INTO v_resident
  FROM (
    SELECT 'venue'::text AS type, v.id::text AS id, v.name AS name
      FROM public.dj_residencies r JOIN public.venues v ON v.id = r.venue_id
     WHERE r.dj_user_id = p_user_id AND r.status = 'active' AND r.venue_id IS NOT NULL
    UNION
    SELECT 'organizer', op.user_id::text, op.display_name
      FROM public.dj_residencies r JOIN public.organizer_profiles op ON op.user_id = r.organizer_user_id
     WHERE r.dj_user_id = p_user_id AND r.status = 'active' AND r.organizer_user_id IS NOT NULL
    UNION
    SELECT 'venue', v.id::text, v.name
      FROM public.dj_sets s JOIN public.djs d ON d.id = s.dj_id JOIN public.venues v ON v.id = s.venue_id
     WHERE d.user_id = p_user_id AND s.venue_id IS NOT NULL AND s.start_time >= now() - interval '180 days'
     GROUP BY v.id, v.name HAVING count(*) >= 4
    UNION
    SELECT 'organizer', op.user_id::text, op.display_name
      FROM public.dj_sets s JOIN public.djs d ON d.id = s.dj_id
      JOIN public.organizer_profiles op ON op.user_id = s.organizer_user_id
     WHERE d.user_id = p_user_id AND s.organizer_user_id IS NOT NULL AND s.start_time >= now() - interval '180 days'
     GROUP BY op.user_id, op.display_name HAVING count(*) >= 4
  ) t;

  v_has_photo := EXISTS (SELECT 1 FROM public.dj_photos WHERE user_id = p_user_id);
  v_has_rate  := EXISTS (SELECT 1 FROM public.dj_rate_card
                          WHERE user_id = p_user_id AND is_public = true
                            AND (min_fee IS NOT NULL OR max_fee IS NOT NULL));

  v_completeness :=
      (CASE WHEN v_row.profile_image_url IS NOT NULL THEN 0.18 ELSE 0 END)
    + (CASE WHEN v_row.cover_image_url IS NOT NULL THEN 0.10 ELSE 0 END)
    + (CASE WHEN length(COALESCE(NULLIF(btrim(v_row.bio), ''), v_row.description, '')) >= 60 THEN 0.14 ELSE 0 END)
    + (CASE WHEN COALESCE(array_length(v_row.music_genres, 1), 0) >= 1 THEN 0.10 ELSE 0 END)
    + (CASE WHEN COALESCE(btrim(v_row.city), '') <> '' THEN 0.08 ELSE 0 END)
    + (CASE WHEN COALESCE(v_row.instagram_url,'')<>'' OR COALESCE(v_row.soundcloud_url,'')<>''
              OR COALESCE(v_row.spotify_url,'')<>'' OR COALESCE(v_row.tiktok_url,'')<>''
              OR COALESCE(v_row.youtube_url,'')<>'' THEN 0.10 ELSE 0 END)
    + (CASE WHEN COALESCE(v_row.featured_track_url,'')<>'' THEN 0.10 ELSE 0 END)
    + (CASE WHEN v_has_photo THEN 0.10 ELSE 0 END)
    + (CASE WHEN v_has_rate THEN 0.10 ELSE 0 END);

  RETURN jsonb_build_object(
    'verified', v_verified,
    'rising', v_rising,
    'resident', (jsonb_array_length(v_resident) > 0),
    'resident_scopes', v_resident,
    'followers_count', COALESCE(v_followers, 0),
    'completeness_pct', round(v_completeness, 2)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_tiers(uuid) TO anon, authenticated;

-- =============================================================================
-- 2. search_djs_marketplace — découverte classée, dédupliquée par personne.
--    Le classement est le levier "soigne ton profil pour remonter".
--    p_booker_mode : n'expose le tarif qu'aux bookers authentifiés (les fans ne voient pas l'argent).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.search_djs_marketplace(
  p_genre        text    DEFAULT NULL,
  p_city         text    DEFAULT NULL,
  p_played_venue text    DEFAULT NULL,
  p_min_followers int    DEFAULT NULL,
  p_min_fee      numeric DEFAULT NULL,
  p_max_fee      numeric DEFAULT NULL,
  p_available_on date    DEFAULT NULL,
  p_booker_mode  boolean DEFAULT false,
  p_limit        int     DEFAULT 40,
  p_offset       int     DEFAULT 0
) RETURNS TABLE (
  user_id           uuid,
  handle            text,
  slug              text,
  stage_name        text,
  city              text,
  country           text,
  profile_image_url text,
  music_genres      text[],
  is_verified       boolean,
  rising            boolean,
  resident          boolean,
  resident_scopes   jsonb,
  followers_count   int,
  min_fee           numeric,
  max_fee           numeric,
  currency          text,
  rate_note         text,
  available         boolean,
  completeness_pct  numeric,
  rank_score        numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_booker boolean;
BEGIN
  v_booker := COALESCE(p_booker_mode, false) AND auth.uid() IS NOT NULL;

  RETURN QUERY
  WITH persons AS (
    SELECT DISTINCT ON (d.user_id)
      d.user_id, d.stage_name, d.first_name, d.last_name, d.city, d.country,
      d.profile_image_url, d.music_genres
    FROM public.djs d
    WHERE d.is_active = true AND d.user_id IS NOT NULL
      AND (p_city  IS NULL OR lower(COALESCE(d.city, '')) = lower(p_city))
      AND (p_genre IS NULL OR EXISTS (SELECT 1 FROM unnest(d.music_genres) g WHERE lower(g) = lower(p_genre)))
    ORDER BY d.user_id,
             (d.cover_image_url IS NOT NULL) DESC,
             (d.profile_image_url IS NOT NULL) DESC,
             d.updated_at DESC NULLS LAST
  ),
  enriched AS (
    SELECT
      p.user_id,
      h.handle,
      (SELECT dd.slug FROM public.djs dd
        WHERE dd.user_id = p.user_id AND dd.slug IS NOT NULL
        ORDER BY dd.updated_at DESC NULLS LAST LIMIT 1) AS slug,
      COALESCE(NULLIF(btrim(p.stage_name), ''),
               btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,''))) AS stage_name,
      p.city, p.country, p.profile_image_url, COALESCE(p.music_genres, '{}') AS music_genres,
      t.tiers,
      rc.min_fee, rc.max_fee, rc.currency, rc.rate_note,
      COALESCE(rc.is_public, false) AS rate_public,
      CASE WHEN p_available_on IS NULL THEN true ELSE NOT (
             EXISTS (SELECT 1 FROM public.dj_availability a
                      WHERE a.user_id = p.user_id AND a.blocked_date = p_available_on)
          OR EXISTS (SELECT 1 FROM public.dj_sets s JOIN public.djs d2 ON d2.id = s.dj_id
                      WHERE d2.user_id = p.user_id AND s.start_time::date = p_available_on)
          OR EXISTS (SELECT 1 FROM public.dj_booking_requests br
                      WHERE br.dj_user_id = p.user_id AND br.status = 'accepted'
                        AND br.requested_date = p_available_on)
      ) END AS available,
      (SELECT count(*) FROM public.dj_sets s JOIN public.djs d3 ON d3.id = s.dj_id
        WHERE d3.user_id = p.user_id AND s.start_time >= now() - interval '90 days')::int AS sets_90
    FROM persons p
    LEFT JOIN public.dj_handles h ON h.user_id = p.user_id
    LEFT JOIN public.dj_rate_card rc ON rc.user_id = p.user_id
    CROSS JOIN LATERAL (SELECT public.get_dj_tiers(p.user_id) AS tiers) t
  )
  SELECT
    e.user_id, e.handle, e.slug, e.stage_name, e.city, e.country, e.profile_image_url, e.music_genres,
    (e.tiers->>'verified')::boolean,
    (e.tiers->>'rising')::boolean,
    (e.tiers->>'resident')::boolean,
    e.tiers->'resident_scopes',
    (e.tiers->>'followers_count')::int,
    CASE WHEN v_booker AND e.rate_public THEN e.min_fee   ELSE NULL END,
    CASE WHEN v_booker AND e.rate_public THEN e.max_fee   ELSE NULL END,
    CASE WHEN v_booker AND e.rate_public THEN e.currency  ELSE NULL END,
    CASE WHEN v_booker AND e.rate_public THEN e.rate_note ELSE NULL END,
    e.available,
    (e.tiers->>'completeness_pct')::numeric,
    ( 30 * (CASE WHEN (e.tiers->>'verified')::boolean THEN 1 ELSE 0 END)
    + 20 * (CASE WHEN (e.tiers->>'rising')::boolean   THEN 1 ELSE 0 END)
    + 15 * (CASE WHEN (e.tiers->>'resident')::boolean THEN 1 ELSE 0 END)
    + 25 * (e.tiers->>'completeness_pct')::numeric
    + 0.10 * LEAST((e.tiers->>'followers_count')::int, 300)
    + 12 * (LEAST(e.sets_90, 6)::numeric / 6) )::numeric AS rank_score
  FROM enriched e
  WHERE e.tiers IS NOT NULL
    AND (p_min_followers IS NULL OR (e.tiers->>'followers_count')::int >= p_min_followers)
    AND (p_played_venue IS NULL OR EXISTS (
          SELECT 1 FROM public.event_djs ed
          JOIN public.djs d4 ON d4.id = ed.dj_id AND d4.user_id = e.user_id
          JOIN public.events ev ON ev.id = ed.event_id AND ev.venue_id = p_played_venue))
    AND (p_available_on IS NULL OR e.available = true)
    AND ( NOT v_booker OR (p_min_fee IS NULL AND p_max_fee IS NULL) OR (
          e.rate_public AND COALESCE(e.min_fee, e.max_fee) IS NOT NULL
          AND COALESCE(e.min_fee, e.max_fee) <= COALESCE(p_max_fee, 'infinity'::numeric)
          AND COALESCE(e.max_fee, e.min_fee) >= COALESCE(p_min_fee, 0)
        ))
  ORDER BY rank_score DESC, e.stage_name ASC
  LIMIT COALESCE(p_limit, 40) OFFSET COALESCE(p_offset, 0);
END; $$;

GRANT EXECUTE ON FUNCTION public.search_djs_marketplace(text, text, text, int, numeric, numeric, date, boolean, int, int) TO anon, authenticated;

-- =============================================================================
-- 3. Cycle de booking
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_dj_booking_request(
  p_dj_user_id      uuid,
  p_requested_date  date,
  p_start           timestamptz DEFAULT NULL,
  p_end             timestamptz DEFAULT NULL,
  p_agreed_fee      numeric     DEFAULT NULL,
  p_message         text        DEFAULT NULL,
  p_event_id        uuid        DEFAULT NULL,
  p_venue_id        text        DEFAULT NULL,
  p_organizer_user_id uuid      DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL)
     OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of venue or organizer scope is required';
  END IF;

  IF p_venue_id IS NOT NULL AND NOT public.is_venue_owner(auth.uid(), p_venue_id) THEN
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
    start_time, end_time, agreed_fee, message, event_id
  ) VALUES (
    p_venue_id, p_organizer_user_id, auth.uid(), p_dj_user_id, p_requested_date,
    p_start, p_end, p_agreed_fee, NULLIF(btrim(p_message), ''), p_event_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.accept_dj_booking_request(p_id uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  IF r.dj_user_id <> auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
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

  UPDATE public.dj_booking_requests
     SET status = 'accepted', dj_response_note = NULLIF(btrim(p_note), ''),
         responded_at = now(), created_dj_set_id = v_set_id, updated_at = now()
   WHERE id = p_id;

  RETURN v_set_id;
END; $$;

CREATE OR REPLACE FUNCTION public.decline_dj_booking_request(p_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.dj_booking_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.dj_user_id <> auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  UPDATE public.dj_booking_requests
     SET status = 'declined', dj_response_note = NULLIF(btrim(p_note), ''),
         responded_at = now(), updated_at = now()
   WHERE id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_dj_booking_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.dj_booking_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (r.created_by = auth.uid()
          OR (r.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), r.venue_id))
          OR (r.organizer_user_id IS NOT NULL AND r.organizer_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF r.status NOT IN ('pending', 'accepted') THEN RAISE EXCEPTION 'Cannot cancel this request'; END IF;

  -- Si déjà accepté, retire le set futur créé.
  IF r.status = 'accepted' AND r.created_dj_set_id IS NOT NULL THEN
    DELETE FROM public.dj_sets WHERE id = r.created_dj_set_id AND start_time > now();
  END IF;

  UPDATE public.dj_booking_requests SET status = 'cancelled', updated_at = now() WHERE id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.expire_dj_booking_requests()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.dj_booking_requests
     SET status = 'expired', updated_at = now()
   WHERE status = 'pending' AND expires_at < now();
END; $$;

GRANT EXECUTE ON FUNCTION public.create_dj_booking_request(uuid, date, timestamptz, timestamptz, numeric, text, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_dj_booking_request(uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_dj_booking_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_dj_booking_request(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_dj_booking_requests()           TO authenticated;

-- =============================================================================
-- 4. Disponibilités
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_dj_availability_block(p_date date, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.dj_availability (user_id, blocked_date, reason, source)
  VALUES (auth.uid(), p_date, NULLIF(btrim(p_reason), ''), 'manual')
  ON CONFLICT (user_id, blocked_date) DO UPDATE SET reason = EXCLUDED.reason, source = 'manual';
END; $$;

CREATE OR REPLACE FUNCTION public.clear_dj_availability_block(p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.dj_availability
   WHERE user_id = auth.uid() AND blocked_date = p_date AND source = 'manual';
END; $$;

-- Calendrier free/busy d'une personne : blocages manuels + sets + bookings acceptés.
CREATE OR REPLACE FUNCTION public.get_dj_availability(p_user_id uuid, p_from date, p_to date)
RETURNS TABLE (d date, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY
  SELECT a.blocked_date, 'manual'::text
    FROM public.dj_availability a
   WHERE a.user_id = p_user_id AND a.blocked_date BETWEEN p_from AND p_to
  UNION
  SELECT s.start_time::date, 'set'::text
    FROM public.dj_sets s JOIN public.djs d ON d.id = s.dj_id
   WHERE d.user_id = p_user_id AND s.start_time::date BETWEEN p_from AND p_to
  UNION
  SELECT br.requested_date, 'booking'::text
    FROM public.dj_booking_requests br
   WHERE br.dj_user_id = p_user_id AND br.status = 'accepted'
     AND br.requested_date BETWEEN p_from AND p_to;
END; $$;

GRANT EXECUTE ON FUNCTION public.set_dj_availability_block(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_dj_availability_block(date)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_availability(uuid, date, date) TO authenticated;

-- =============================================================================
-- 5. Admin : vérifier / dé-vérifier un DJ (toutes les lignes de la personne).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_set_dj_verified(
  p_dj_user_id uuid,
  p_verified   boolean,
  p_reason     text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.djs SET is_verified = p_verified WHERE user_id = p_dj_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DJ not found: %', p_dj_user_id; END IF;

  PERFORM public.log_admin_action(
    CASE WHEN p_verified THEN 'dj_verified' ELSE 'dj_unverified' END,
    'dj', p_dj_user_id::text, jsonb_build_object('reason', p_reason)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_set_dj_verified(uuid, boolean, text) TO authenticated;

-- =============================================================================
-- 6. Profil public : ajouter rising + resident_at + rate (si is_public).
--    CREATE OR REPLACE = on réécrit le corps existant (20260622010000) + 3 clés en fin.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_public_profile(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user      uuid;
  v_row       public.djs%ROWTYPE;
  v_handle    text;
  v_followers bigint;
  v_tiers     jsonb;
  v_rate      public.dj_rate_card%ROWTYPE;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.djs
   WHERE user_id = v_user AND is_active = true
   ORDER BY (cover_image_url IS NOT NULL) DESC,
            (profile_image_url IS NOT NULL) DESC,
            updated_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT handle INTO v_handle FROM public.dj_handles WHERE user_id = v_user;

  SELECT count(DISTINCT f.user_id) INTO v_followers
    FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
   WHERE d.user_id = v_user AND f.favorite_type = 'dj';

  v_tiers := public.get_dj_tiers(v_user);
  SELECT * INTO v_rate FROM public.dj_rate_card WHERE user_id = v_user AND is_public = true;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'stage_name', v_row.stage_name,
    'first_name', v_row.first_name,
    'last_name', v_row.last_name,
    'description', v_row.description,
    'bio', v_row.bio,
    'music_genres', v_row.music_genres,
    'profile_image_url', v_row.profile_image_url,
    'cover_image_url', v_row.cover_image_url,
    'instagram_url', v_row.instagram_url,
    'tiktok_url', v_row.tiktok_url,
    'soundcloud_url', v_row.soundcloud_url,
    'spotify_url', v_row.spotify_url,
    'youtube_url', v_row.youtube_url,
    'city', v_row.city,
    'country', v_row.country,
    'is_verified', v_row.is_verified,
    'slug', v_row.slug,
    'handle', v_handle,
    'followers_count', COALESCE(v_followers, 0),
    'featured_track_url', v_row.featured_track_url,
    'featured_track_title', v_row.featured_track_title,
    'rising', COALESCE((v_tiers->>'rising')::boolean, false),
    'resident_at', COALESCE(v_tiers->'resident_scopes', '[]'::jsonb),
    'rate', CASE WHEN v_rate.user_id IS NOT NULL
                 THEN jsonb_build_object('min_fee', v_rate.min_fee, 'max_fee', v_rate.max_fee,
                                         'currency', v_rate.currency, 'note', v_rate.rate_note)
                 ELSE NULL END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_public_profile(text) TO anon, authenticated;
