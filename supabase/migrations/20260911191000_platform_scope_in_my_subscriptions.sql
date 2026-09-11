-- ============================================================================
-- « Mes abonnements » voit enfin Yuno (2026-09-11)
--
-- Depuis 20260911150000, quelqu'un peut s'abonner à Yuno lui-même : portée
-- plateforme, les DEUX colonnes de portée à NULL. Les deux fonctions de cet
-- écran n'ont jamais connu ce créneau, et le résultat était visible en prod :
--
--   * get_my_marketing_subscriptions classait la ligne avec
--     `CASE WHEN venue_id IS NOT NULL THEN 'venue' ELSE 'organizer'` — donc
--     'organizer' — et la nommait par COALESCE(..., 'Organisateur'). L'accord
--     donné à Yuno s'affichait sous le nom d'un organisateur fantôme.
--
--   * withdraw_my_marketing_consent levait `portée requise (club ou
--     organisateur)` sur cette même ligne. Le seul écran qui garantit que
--     retirer est aussi simple que donner (art. 7(3) RGPD) rendait donc le
--     retrait IMPOSSIBLE pour Yuno — et un retrait non conforme invalide le
--     mécanisme de consentement tout entier (EDPB 05/2020 §116).
--
-- Même leçon que marketing_scope_match() côté campagnes : la garde devient
-- « AU PLUS une portée », jamais « exactement une ». Et le prédicat de portée
-- doit porter une branche plateforme EXPLICITE — écrit en
-- `(p_venue_id IS NOT NULL AND …) OR (p_organizer_user_id IS NOT NULL AND …)`,
-- il est FAUX quand les deux sont NULL, donc muet sur toute la portée
-- plateforme sans jamais lever d'erreur.
-- ============================================================================

-- ── 1. La liste nomme Yuno ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_marketing_subscriptions()
RETURNS TABLE (
  scope_type text,
  venue_id text,
  organizer_user_id uuid,
  scope_name text,
  email_opted_in boolean,
  sms_opted_in boolean,
  since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  RETURN QUERY
  WITH email_subs AS (
    SELECT ns.venue_id, ns.organizer_user_id, ns.opted_in, ns.created_at
    FROM public.newsletter_subscriptions ns
    WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
      AND ns.opted_in
  ),
  sms_subs AS (
    SELECT sc.venue_id, sc.organizer_user_id, sc.sms_consent_at
    FROM public.venue_sms_contacts sc
    WHERE NOT sc.unsubscribed
      AND (sc.user_id = v_uid
           OR (v_phone IS NOT NULL AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
  ),
  scopes AS (
    SELECT e.venue_id, e.organizer_user_id FROM email_subs e
    UNION
    SELECT s.venue_id, s.organizer_user_id FROM sms_subs s
  )
  SELECT
    -- Trois portées, pas deux. La plateforme n'est ni un club ni un
    -- organisateur : elle se nomme, sinon elle se déguise en fantôme.
    CASE
      WHEN sc.venue_id IS NOT NULL THEN 'venue'
      WHEN sc.organizer_user_id IS NOT NULL THEN 'organizer'
      ELSE 'platform'
    END,
    sc.venue_id,
    sc.organizer_user_id,
    CASE
      WHEN sc.venue_id IS NULL AND sc.organizer_user_id IS NULL THEN 'Yuno'
      ELSE COALESCE(v.name, pr.organization_name, 'Organisateur')
    END,
    EXISTS (
      SELECT 1 FROM email_subs e
      WHERE e.venue_id IS NOT DISTINCT FROM sc.venue_id
        AND e.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id
    ),
    EXISTS (
      SELECT 1 FROM sms_subs s
      WHERE s.venue_id IS NOT DISTINCT FROM sc.venue_id
        AND s.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id
    ),
    LEAST(
      (SELECT min(e.created_at) FROM email_subs e
        WHERE e.venue_id IS NOT DISTINCT FROM sc.venue_id
          AND e.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id),
      (SELECT min(s.sms_consent_at) FROM sms_subs s
        WHERE s.venue_id IS NOT DISTINCT FROM sc.venue_id
          AND s.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id)
    )
  FROM scopes sc
  LEFT JOIN public.venues v ON v.id = sc.venue_id
  LEFT JOIN public.profiles pr ON pr.id = sc.organizer_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_marketing_subscriptions() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_marketing_subscriptions() TO authenticated;

-- ── 2. Le retrait accepte la portée plateforme ──────────────────────────────
CREATE OR REPLACE FUNCTION public.withdraw_my_marketing_consent(
  p_channel text,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_wording_text text DEFAULT '',
  p_locale text DEFAULT NULL,
  p_source text DEFAULT 'checkout'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_platform boolean := (p_venue_id IS NULL AND p_organizer_user_id IS NULL);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentification requise';
  END IF;
  IF p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'canal invalide: %', p_channel;
  END IF;
  -- « Au plus une portée » : club, organisateur, ou Yuno (les deux à NULL).
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'une seule portée à la fois (club OU organisateur)';
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  IF p_channel = 'email' THEN
    UPDATE public.newsletter_subscriptions ns
    SET opted_in = false, opted_out_at = now(), updated_at = now()
    WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
      AND (
        (v_platform AND ns.venue_id IS NULL AND ns.organizer_user_id IS NULL)
        OR (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
      );
  ELSE
    UPDATE public.venue_sms_contacts sc
    SET unsubscribed = true, unsubscribed_at = now()
    WHERE (
        (v_platform AND sc.venue_id IS NULL AND sc.organizer_user_id IS NULL)
        OR (p_venue_id IS NOT NULL AND sc.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND sc.organizer_user_id = p_organizer_user_id)
      )
      AND (sc.user_id = v_uid
           OR (v_phone IS NOT NULL
               AND public.normalize_phone_e164(sc.phone_e164) = v_phone));
  END IF;

  INSERT INTO public.marketing_consent_events (
    user_id, email, phone_e164, channel, venue_id, organizer_user_id,
    action, wording_text, locale, source
  ) VALUES (
    v_uid, v_email, v_phone, p_channel, p_venue_id, p_organizer_user_id,
    'withdrawn', COALESCE(NULLIF(p_wording_text, ''), 'withdrawal'), p_locale, p_source
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_my_marketing_consent(text, text, uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.withdraw_my_marketing_consent(text, text, uuid, text, text, text) TO authenticated;
