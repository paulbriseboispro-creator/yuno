-- ============================================================================
-- Guest list : le 3e pilier demande enfin l'autorisation marketing
-- (2026-09-11)
--
-- Une inscription guest list est, en volume, la porte d'entrée n°1 de Yuno :
-- lien privé posté en story, aucun paiement, aucun compte. Jusqu'ici elle ne
-- demandait RIEN — ni pour le club/organisateur qui reçoit la personne, ni
-- pour Yuno. Un promoteur pouvait remplir sa soirée de 200 personnes et
-- n'avoir personne à qui réécrire le lendemain. Les billets et les tables, eux,
-- posent la question depuis le 20/07 (marketing_consent_per_venue).
--
-- Trois écritures, trois portées, la même doctrine que l'existant :
--
--   1. `guest_list_entries` porte la réponse (newsletter / sms / plateforme).
--      C'est la trace qui accompagne l'inscription, comme `newsletter_opt_in`
--      accompagne un billet.
--
--   2. Un trigger dédié — PAS auto_subscribe_newsletter_on_purchase — écrit
--      l'abonnement. Séparé volontairement : la guest list résout sa portée
--      autrement (club partenaire d'une co-soirée, organisateur seul) et ajoute
--      la portée plateforme, et cette fonction-là a déjà bloqué toutes les
--      ventes d'un club pendant des semaines (cf. 20260808140000). On ne la
--      rouvre pas pour un 3e appelant.
--
--   3. La preuve (marketing_consent_events) accepte désormais la portée
--      plateforme — deux colonnes de portée à NULL, exactement le créneau
--      décrit dans PLATFORM_MARKETING.md. La garde devient « au plus une
--      portée », jamais « exactement une » : c'est le même piège que
--      marketing_scope_match() a corrigé côté campagnes.
--
-- Réf. : EDPB 05/2020 §§65 (destinataire nommé), 108 (preuve), 110, 114
--        (retrait sur la même interface) ; CJUE C-673/17 (Planet49).
-- ============================================================================

-- ── 1. La réponse vit sur l'inscription ─────────────────────────────────────
ALTER TABLE public.guest_list_entries
  ADD COLUMN IF NOT EXISTS newsletter_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_opt_in        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_opt_in   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.guest_list_entries.newsletter_opt_in IS
  'Accord email donné au club (ou à l''organisateur) de la soirée, à l''inscription.';
COMMENT ON COLUMN public.guest_list_entries.sms_opt_in IS
  'Accord SMS donné au club (ou à l''organisateur). L''écriture dans venue_sms_contacts passe par _shared/sms-consent.ts, jamais par un trigger.';
COMMENT ON COLUMN public.guest_list_entries.platform_opt_in IS
  'Accord donné à Yuno lui-même (portée plateforme : venue_id ET organizer_user_id à NULL).';

-- ── 2. Le trigger d'abonnement de la guest list ─────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_subscribe_guest_list_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text := lower(btrim(COALESCE(NEW.email, '')));
  v_first text;
  v_last text;
BEGIN
  IF v_email = '' THEN
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.newsletter_opt_in, false) OR COALESCE(NEW.platform_opt_in, false)) THEN
    RETURN NEW;
  END IF;

  -- Destinataire nommé sur la case cochée = celui qui reçoit l'abonnement.
  -- Une co-soirée org-led porte son club dans partner_venue_id : sans le
  -- COALESCE, la case nommait le club et l'abonnement n'allait nulle part.
  -- MIROIR de la résolution front (GuestListSignup consentScope).
  SELECT COALESCE(e.venue_id, e.partner_venue_id),
         COALESCE(e.organizer_user_id, e.partner_organizer_id)
    INTO v_venue_id, v_organizer_user_id
    FROM public.guest_lists gl
    JOIN public.events e ON e.id = gl.event_id
   WHERE gl.id = NEW.guest_list_id;

  v_first := NULLIF(split_part(btrim(COALESCE(NEW.full_name, '')), ' ', 1), '');
  v_last  := NULLIF(btrim(regexp_replace(COALESCE(NEW.full_name, ''), '^\S+\s*', '')), '');

  -- 2a. Le club, sinon l'organisateur. Les index d'unicité sont PARTIELS et
  -- portent sur lower(email) : la cible ON CONFLICT doit répéter l'expression
  -- ET le prédicat, sinon 42P10 à l'exécution (leçon du 08/08).
  IF COALESCE(NEW.newsletter_opt_in, false) THEN
    IF v_venue_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions
        (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
      VALUES (NEW.user_id, v_venue_id, v_email, true, 'guest_list', 'ticketing', now(), v_first, v_last)
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
            first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
            last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
            updated_at = now();
    ELSIF v_organizer_user_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions
        (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
      VALUES (NEW.user_id, v_organizer_user_id, v_email, true, 'guest_list', 'ticketing', now(), v_first, v_last)
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
            first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
            last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
            updated_at = now();
    END IF;
  END IF;

  -- 2b. Yuno. Arbitre = l'index PARTIEL uniq_newsletter_subs_email_platform.
  IF COALESCE(NEW.platform_opt_in, false) THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, venue_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    VALUES (NEW.user_id, NULL, NULL, v_email, true, 'platform:guest_list', 'ticketing', now(), v_first, v_last)
    ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une écriture marketing ne fait JAMAIS échouer l'inscription qu'elle
  -- observe. Même doctrine que le trigger d'achat et que les alertes admin.
  RAISE WARNING 'auto_subscribe_guest_list_entry: % (entry %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_list_entry_newsletter ON public.guest_list_entries;
CREATE TRIGGER trg_guest_list_entry_newsletter
  AFTER INSERT ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.auto_subscribe_guest_list_entry();

-- ── 3. La preuve accepte la portée plateforme ───────────────────────────────
-- « Au plus une portée » : club, organisateur, ou Yuno (les deux à NULL). La
-- version XOR rendait la preuve d'un consentement donné à Yuno impossible à
-- écrire — donc ce consentement impossible à demander.
ALTER TABLE public.marketing_consent_events
  DROP CONSTRAINT IF EXISTS marketing_consent_events_scope_xor;
ALTER TABLE public.marketing_consent_events
  DROP CONSTRAINT IF EXISTS marketing_consent_events_scope_at_most_one;
ALTER TABLE public.marketing_consent_events
  ADD CONSTRAINT marketing_consent_events_scope_at_most_one CHECK (
    NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL)
  );

-- Preuve d'un accord donné à Yuno. Ouverte à `anon` pour la même raison que
-- record_marketing_consent_grant : c'est justement l'invité sans compte dont
-- aucune ligne `profiles` ne porte la trace. Elle n'écrit QUE le journal —
-- l'abonnement, lui, n'est écrit que par le trigger ci-dessus, c'est-à-dire
-- seulement quand une inscription réelle a été créée côté serveur.
CREATE OR REPLACE FUNCTION public.record_platform_marketing_consent(
  p_wording_text text,
  p_email text DEFAULT NULL,
  p_wording_key text DEFAULT NULL,
  p_locale text DEFAULT NULL,
  p_source text DEFAULT 'checkout'
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
BEGIN
  IF COALESCE(btrim(p_wording_text), '') = '' THEN
    RAISE EXCEPTION 'le texte affiché est requis comme preuve (EDPB 05/2020 §108)';
  END IF;

  IF v_uid IS NOT NULL AND v_email IS NULL THEN
    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  END IF;

  IF v_uid IS NULL AND v_email IS NULL THEN
    RETURN; -- sans sujet, la preuve ne se rattache à personne
  END IF;

  INSERT INTO public.marketing_consent_events (
    user_id, email, channel, venue_id, organizer_user_id,
    action, wording_key, wording_text, locale, source
  ) VALUES (
    v_uid, v_email, 'email', NULL, NULL,
    'granted', p_wording_key, btrim(p_wording_text), p_locale, p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_platform_marketing_consent(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_platform_marketing_consent(text, text, text, text, text) TO anon, authenticated;

-- « Suis-je déjà abonné à Yuno ? » — pour ne pas redemander de cocher à
-- quelqu'un qui a déjà dit oui (même règle que get_my_marketing_consent).
CREATE OR REPLACE FUNCTION public.get_my_platform_marketing_consent()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_stale timestamptz := now() - interval '36 months';
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  RETURN COALESCE((
    SELECT ns.opted_in AND ns.updated_at > v_stale
      FROM public.newsletter_subscriptions ns
     WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
       AND (ns.user_id = v_uid OR lower(ns.email) = v_email)
     ORDER BY ns.updated_at DESC
     LIMIT 1
  ), false);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_platform_marketing_consent() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_platform_marketing_consent() TO authenticated;

-- Retrait sur la même interface (EDPB 05/2020 §114) : sans lui, le mécanisme
-- de consentement tout entier devient non conforme (§116).
CREATE OR REPLACE FUNCTION public.withdraw_my_platform_marketing_consent(
  p_wording_text text DEFAULT '',
  p_locale text DEFAULT NULL,
  p_source text DEFAULT 'checkout'
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentification requise';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  UPDATE public.newsletter_subscriptions ns
     SET opted_in = false, opted_out_at = now(), updated_at = now()
   WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
     AND (ns.user_id = v_uid OR lower(ns.email) = v_email);

  INSERT INTO public.marketing_consent_events (
    user_id, email, channel, venue_id, organizer_user_id,
    action, wording_text, locale, source
  ) VALUES (
    v_uid, v_email, 'email', NULL, NULL,
    'withdrawn', COALESCE(NULLIF(p_wording_text, ''), 'withdrawal'), p_locale, p_source
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_my_platform_marketing_consent(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.withdraw_my_platform_marketing_consent(text, text, text) TO authenticated;
