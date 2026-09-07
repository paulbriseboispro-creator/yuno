-- Billets communauté : un tarif réservé aux abonnés du compte qui porte la
-- soirée (club ou organisateur) — abonnés du profil Yuno, abonnés à la
-- newsletter, ou l'un OU l'autre. Les autres voient le tarif verrouillé avec
-- l'action qui le débloque (suivre le profil / s'abonner à la newsletter).
--
-- Hôte de la communauté = le compte qui a créé la soirée :
--   events.venue_id NOT NULL → le club (favorites 'club' + newsletter venue_id)
--   sinon                    → l'organisateur (organizer_profile_followers +
--                              newsletter organizer_user_id)
-- Les deux ne sont jamais posés ensemble (vérifié en prod : 0 ligne).
--
-- La porte est SERVEUR : check_community_access (service_role) est appelée par
-- create-ticket-checkout avant toute réservation. Le front ne fait qu'afficher.

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'everyone';

ALTER TABLE public.ticket_rounds DROP CONSTRAINT IF EXISTS ticket_rounds_audience_check;
ALTER TABLE public.ticket_rounds
  ADD CONSTRAINT ticket_rounds_audience_check
  CHECK (audience IN ('everyone', 'followers', 'newsletter', 'community'));

COMMENT ON COLUMN public.ticket_rounds.audience IS
  'everyone | followers (abonnés du profil Yuno) | newsletter (abonnés newsletter) | community (l''un ou l''autre)';

-- ─────────────────────────────────────────────────────────────────────────────
-- Hôte de la communauté d'une soirée (nom + slug publics pour les CTA).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.event_community_host(p_event_id uuid)
RETURNS TABLE(host_kind text, venue_id text, organizer_user_id uuid, host_name text, host_slug text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN e.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    e.venue_id,
    CASE WHEN e.venue_id IS NULL THEN e.organizer_user_id END,
    COALESCE(v.name, op.display_name, pr.organization_name, e.location_name),
    COALESCE(v.slug, op.slug)
  FROM public.events e
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN public.organizer_profiles op ON e.venue_id IS NULL AND op.user_id = e.organizer_user_id
  LEFT JOIN public.profiles pr ON e.venue_id IS NULL AND pr.id = e.organizer_user_id
  WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION public.event_community_host(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_community_host(uuid) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Appartenance d'une personne (compte et/ou email) à la communauté de la soirée.
-- Réservée au service_role : avec un email arbitraire elle dirait si une
-- adresse est abonnée à la newsletter d'un club — jamais exposée au client.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_membership(p_event_id uuid, p_user_id uuid, p_email text)
RETURNS TABLE(is_follower boolean, is_subscriber boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue text;
  v_org uuid;
  v_email text := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
BEGIN
  SELECT h.venue_id, h.organizer_user_id INTO v_venue, v_org
  FROM public.event_community_host(p_event_id) h;

  IF p_user_id IS NOT NULL AND v_email IS NULL THEN
    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  END IF;

  is_follower := false;
  is_subscriber := false;

  IF p_user_id IS NOT NULL THEN
    IF v_venue IS NOT NULL THEN
      is_follower := EXISTS (
        SELECT 1 FROM public.favorites f
        WHERE f.user_id = p_user_id AND f.favorite_type = 'club' AND f.venue_id = v_venue
      );
    ELSIF v_org IS NOT NULL THEN
      is_follower := EXISTS (
        SELECT 1 FROM public.organizer_profile_followers o
        WHERE o.user_id = p_user_id AND o.organizer_user_id = v_org
      );
    END IF;
  END IF;

  IF v_venue IS NOT NULL OR v_org IS NOT NULL THEN
    is_subscriber := EXISTS (
      SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE ns.opted_in
        AND ((v_venue IS NOT NULL AND ns.venue_id = v_venue)
          OR (v_org IS NOT NULL AND ns.organizer_user_id = v_org))
        AND ((p_user_id IS NOT NULL AND ns.user_id = p_user_id)
          OR (v_email IS NOT NULL AND lower(ns.email) = v_email))
    );
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.community_membership(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_membership(uuid, uuid, text) TO service_role;

-- Règle d'accès selon l'audience du billet. Une audience inconnue ferme la porte.
CREATE OR REPLACE FUNCTION public.community_audience_allows(p_audience text, p_follower boolean, p_subscriber boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_audience
    WHEN 'everyone'   THEN true
    WHEN 'followers'  THEN COALESCE(p_follower, false)
    WHEN 'newsletter' THEN COALESCE(p_subscriber, false)
    WHEN 'community'  THEN COALESCE(p_follower, false) OR COALESCE(p_subscriber, false)
    ELSE false
  END;
$$;

-- Porte serveur du checkout : ce billet est-il achetable par cette personne ?
CREATE OR REPLACE FUNCTION public.check_community_access(p_round_id uuid, p_user_id uuid, p_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid;
  v_audience text;
  v_follower boolean;
  v_subscriber boolean;
BEGIN
  SELECT r.event_id, r.audience INTO v_event, v_audience
  FROM public.ticket_rounds r WHERE r.id = p_round_id;
  IF v_event IS NULL THEN RETURN false; END IF;
  IF v_audience = 'everyone' THEN RETURN true; END IF;

  SELECT m.is_follower, m.is_subscriber INTO v_follower, v_subscriber
  FROM public.community_membership(v_event, p_user_id, p_email) m;

  RETURN public.community_audience_allows(v_audience, v_follower, v_subscriber);
END;
$$;

REVOKE ALL ON FUNCTION public.check_community_access(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_community_access(uuid, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Côté client : hôte + MON statut (auth.uid() seulement, jamais un email passé
-- en paramètre). Un anonyme obtient l'hôte (public) et false/false.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_community_access(p_event_id uuid)
RETURNS TABLE(
  host_kind text, venue_id text, organizer_user_id uuid, host_name text, host_slug text,
  is_follower boolean, is_subscriber boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_follower boolean := false;
  v_subscriber boolean := false;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT m.is_follower, m.is_subscriber INTO v_follower, v_subscriber
    FROM public.community_membership(p_event_id, v_uid, NULL) m;
  END IF;

  RETURN QUERY
  SELECT h.host_kind, h.venue_id, h.organizer_user_id, h.host_name, h.host_slug,
         COALESCE(v_follower, false), COALESCE(v_subscriber, false)
  FROM public.event_community_host(p_event_id) h;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_community_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_community_access(uuid) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Abonnement à la newsletter de l'hôte en un tap depuis le billet verrouillé.
-- Acte positif (bouton nommant le destinataire), preuve RGPD via
-- record_marketing_consent_grant avec le libellé RÉELLEMENT affiché.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscribe_my_community_newsletter(
  p_event_id uuid,
  p_wording_text text,
  p_locale text DEFAULT NULL,
  p_source text DEFAULT 'community_ticket'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_venue text;
  v_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'login_required';
  END IF;
  IF COALESCE(btrim(p_wording_text), '') = '' THEN
    RAISE EXCEPTION 'wording_required';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL THEN RETURN false; END IF;

  SELECT h.venue_id, h.organizer_user_id INTO v_venue, v_org
  FROM public.event_community_host(p_event_id) h;
  IF v_venue IS NULL AND v_org IS NULL THEN RETURN false; END IF;

  -- Index d'unicité PARTIELS sur lower(email) : la cible ON CONFLICT répète
  -- l'expression ET le prédicat (cf. auto_subscribe_newsletter_on_purchase).
  IF v_venue IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at)
    VALUES (v_uid, v_venue, v_email, true, p_source, 'website_form', now())
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
          consent_recorded_at = now(),
          updated_at = now();
  ELSE
    INSERT INTO public.newsletter_subscriptions
      (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at)
    VALUES (v_uid, v_org, v_email, true, p_source, 'website_form', now())
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
          consent_recorded_at = now(),
          updated_at = now();
  END IF;

  PERFORM public.record_marketing_consent_grant(
    'email', p_wording_text, v_venue, v_org, v_email, NULL,
    'community.newsletterCta', p_locale, p_source
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_my_community_newsletter(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscribe_my_community_newsletter(uuid, text, text, text) TO authenticated, service_role;
