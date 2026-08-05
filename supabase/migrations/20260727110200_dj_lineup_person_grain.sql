-- ============================================================================
-- Fix line-up DJ : grain PERSONNE + email réparé.
--
-- BUG 1 (grain) : les deux RPC filtraient `WHERE f.dj_id = p_dj_id` (une FICHE
-- par club), alors qu'un suivi DJ est par PERSONNE (djs.user_id). Un fan qui suit
-- MARCO V via la fiche du Club A n'était JAMAIS notifié quand MARCO V joue au
-- Club B (fiche B). → on résout la personne depuis p_dj_id puis on cible toutes
-- ses fiches.
--
-- BUG 2 (email mort) : get_dj_lineup_email_targets sélectionnait
-- `p.unsubscribe_token` — colonne INEXISTANTE sur profiles (42703) → la fonction
-- jetait à chaque appel, aucun email jamais envoyé. Le token vit sur
-- `newsletter_subscriptions` (par email+venue, avec opted_in). → on n'émaille que
-- les followers ayant opt-in à la newsletter du CLUB de l'event (consentement),
-- avec leur vrai token de désabonnement. Plus étroit mais conforme et fonctionnel.
-- ============================================================================

-- ── Push targets : grain personne ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dj_lineup_notification_targets(
  p_event_id uuid,
  p_dj_id    uuid
) RETURNS TABLE (
  user_id  uuid,
  endpoint text,
  p256dh   text,
  auth     text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_city   text;
  v_ok     boolean;
  v_person uuid;
BEGIN
  SELECT e.location_city,
         (e.is_active AND e.end_at >= now() AND e.visibility = 'public')
    INTO v_city, v_ok
  FROM public.events e WHERE e.id = p_event_id;

  IF NOT FOUND OR v_ok IS NOT TRUE THEN RETURN; END IF;

  -- p_dj_id est une fiche → on cible tous les followers de la PERSONNE.
  SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = p_dj_id;
  IF v_person IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT f.user_id, ps.endpoint, ps.p256dh, ps.auth
  FROM public.favorites f
  JOIN public.push_subscriptions ps ON ps.user_id = f.user_id
  LEFT JOIN public.profiles pr ON pr.id = f.user_id
  WHERE f.favorite_type = 'dj'
    AND f.dj_id IN (SELECT id FROM public.djs WHERE user_id = v_person)
    AND (
      f.notify_all_locations = true
      OR (
        v_city IS NOT NULL AND pr.city IS NOT NULL AND (
          lower(btrim(pr.city)) = lower(btrim(v_city))
          OR position(lower(btrim(v_city)) IN lower(btrim(pr.city))) > 0
          OR position(lower(btrim(pr.city)) IN lower(btrim(v_city))) > 0
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dj_lineup_notifications n
      WHERE n.user_id = f.user_id AND n.event_id = p_event_id AND n.dj_id = p_dj_id
    );
END; $$;

REVOKE ALL ON FUNCTION public.get_dj_lineup_notification_targets(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_lineup_notification_targets(uuid,uuid) TO service_role;

-- ── Email targets : grain personne + token newsletter par venue (opt-in) ──────
CREATE OR REPLACE FUNCTION public.get_dj_lineup_email_targets(
  p_event_id uuid,
  p_dj_id    uuid
) RETURNS TABLE (
  user_id            uuid,
  email              text,
  first_name         text,
  preferred_language text,
  unsubscribe_token  text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_city   text;
  v_venue  text;
  v_ok     boolean;
  v_person uuid;
BEGIN
  SELECT e.location_city, e.venue_id,
         (e.is_active AND e.end_at >= now() AND e.visibility = 'public')
    INTO v_city, v_venue, v_ok
  FROM public.events e WHERE e.id = p_event_id;

  IF NOT FOUND OR v_ok IS NOT TRUE OR v_city IS NULL OR v_venue IS NULL THEN RETURN; END IF;

  SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = p_dj_id;
  IF v_person IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT ON (f.user_id)
    f.user_id,
    p.email,
    p.first_name,
    p.preferred_language,
    ns.unsubscribe_token::text
  FROM public.favorites f
  JOIN public.profiles p ON p.id = f.user_id
  -- Consentement : seulement les opt-in à la newsletter du club de l'event.
  JOIN public.newsletter_subscriptions ns
    ON lower(ns.email) = lower(p.email) AND ns.venue_id = v_venue AND ns.opted_in = true
  WHERE f.favorite_type = 'dj'
    AND f.dj_id IN (SELECT id FROM public.djs WHERE user_id = v_person)
    AND p.email IS NOT NULL
    AND p.city IS NOT NULL
    AND (
      lower(btrim(p.city)) = lower(btrim(v_city))
      OR position(lower(btrim(v_city)) IN lower(btrim(p.city))) > 0
      OR position(lower(btrim(p.city)) IN lower(btrim(v_city))) > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dj_lineup_notifications n
      WHERE n.user_id = f.user_id AND n.event_id = p_event_id AND n.dj_id = p_dj_id
    )
  ORDER BY f.user_id, f.created_at ASC;
END; $$;

REVOKE ALL ON FUNCTION public.get_dj_lineup_email_targets(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_lineup_email_targets(uuid,uuid) TO service_role;
