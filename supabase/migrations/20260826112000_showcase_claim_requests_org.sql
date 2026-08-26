-- ============================================================================
-- Comptes vitrine ORGANISATEUR — demandes d'activation.
--
-- showcase_claim_requests (20260826101000) apprend à porter une vitrine orga :
-- soit venue_id (club), soit organizer_user_id (orga), jamais les deux.
-- request_showcase_claim détecte la nature de la session fantôme appelante.
-- ============================================================================

ALTER TABLE public.showcase_claim_requests
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.showcase_claim_requests
  ADD CONSTRAINT showcase_claim_one_target
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

-- Une seule demande en attente par vitrine orga (miroir de uq_showcase_claim_pending).
-- Prédicat identique à l'arbitre ON CONFLICT ci-dessous (leçon du trigger
-- newsletter : un prédicat qui diverge = arbitre introuvable = INSERT qui casse).
-- Les lignes venue (organizer_user_id NULL) ne collisionnent jamais entre elles.
CREATE UNIQUE INDEX uq_showcase_claim_pending_org
  ON public.showcase_claim_requests (organizer_user_id)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- request_showcase_claim v2 : branche club (inchangée) + branche orga.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_showcase_claim(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_venue RECORD;
  v_org RECORD;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_shadow_email text;
  v_existing RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF v_email = '' OR length(v_email) > 255 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  SELECT lower(u.email) INTO v_shadow_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email = v_shadow_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  -- ── Branche CLUB : le demandeur est le fantôme, encore owner, venue cachée ──
  SELECT v.id, v.name INTO v_venue
    FROM public.venues v
   WHERE v.showcase_shadow_owner_id = v_uid
     AND v.owner_id = v_uid
     AND v.is_hidden
   LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_existing
      FROM public.showcase_claim_requests
     WHERE venue_id = v_venue.id AND status = 'pending';
    IF FOUND AND v_existing.updated_at > now() - interval '60 seconds' THEN
      RETURN jsonb_build_object('ok', true, 'throttled', true);
    END IF;

    INSERT INTO public.showcase_claim_requests (venue_id, shadow_user_id, requested_email)
    VALUES (v_venue.id, v_uid, v_email)
    ON CONFLICT (venue_id) WHERE status = 'pending'
    DO UPDATE SET requested_email = EXCLUDED.requested_email, updated_at = now();

    PERFORM public.emit_admin_notification(
      'admin_showcase_claim',
      'Activation demandée : ' || v_venue.name,
      v_venue.name || ' veut activer son compte vitrine. Contact : ' || v_email || '.',
      'high',
      'venue',
      v_venue.id,
      jsonb_build_object('kind', 'venue', 'venue_id', v_venue.id, 'venue_name', v_venue.name, 'email', v_email),
      'showcase_claim:' || v_venue.id || ':' || md5(v_email)
    );

    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ── Branche ORGA : le demandeur est le fantôme d'un profil orga vitrine ────
  SELECT op.user_id, op.display_name INTO v_org
    FROM public.organizer_profiles op
   WHERE op.user_id = v_uid
     AND op.is_showcase_shadow
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_showcase_session');
  END IF;

  SELECT * INTO v_existing
    FROM public.showcase_claim_requests
   WHERE organizer_user_id = v_org.user_id AND status = 'pending';
  IF FOUND AND v_existing.updated_at > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;

  INSERT INTO public.showcase_claim_requests (organizer_user_id, shadow_user_id, requested_email)
  VALUES (v_org.user_id, v_uid, v_email)
  ON CONFLICT (organizer_user_id) WHERE status = 'pending'
  DO UPDATE SET requested_email = EXCLUDED.requested_email, updated_at = now();

  PERFORM public.emit_admin_notification(
    'admin_showcase_claim',
    'Activation demandée : ' || v_org.display_name,
    v_org.display_name || ' (organisateur) veut activer son compte vitrine. Contact : ' || v_email || '.',
    'high',
    'organizer',
    v_org.user_id::text,
    jsonb_build_object('kind', 'organizer', 'organizer_user_id', v_org.user_id,
                       'organizer_name', v_org.display_name, 'email', v_email),
    'showcase_claim:org:' || v_org.user_id || ':' || md5(v_email)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.request_showcase_claim(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_showcase_claim(text) TO authenticated;
