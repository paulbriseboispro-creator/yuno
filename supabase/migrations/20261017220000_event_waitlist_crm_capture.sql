-- ============================================================================
-- Liste privée (event_waitlist) : prénom, nom et accord marketing dans le CRM
-- (2026-10-17)
--
-- Une soirée en mode « Privé » ne vend rien : sa liste privée est TOUTE la
-- collecte. Or l'inscription ne gardait qu'un `full_name` libre, et rien
-- n'arrivait dans le registre de consentement du club / de l'organisateur : le
-- pro avait des adresses dans une table que ni l'Audience, ni les segments, ni
-- les campagnes ne lisent.
--
-- Même doctrine que la guest list (20260911150000), même forme :
--
--   1. La ligne porte la réponse (`newsletter_opt_in`) et le nom en deux
--      champs (`first_name`, `last_name`). `full_name` reste écrit : les
--      emails de la liste, l'écran owner et les anciens bundles le lisent.
--
--   2. Un trigger dédié écrit l'abonnement du destinataire NOMMÉ à l'écran
--      (le club, sinon l'organisateur ; co-soirée org-led = club partenaire,
--      miroir de la résolution front). Il ne fait jamais échouer
--      l'inscription qu'il observe.
--
--   3. La preuve (texte exact affiché) est écrite par le client via
--      `record_marketing_consent_grant` (source `waitlist`), comme ailleurs.
-- ============================================================================

ALTER TABLE public.event_waitlist
  ADD COLUMN IF NOT EXISTS first_name        text,
  ADD COLUMN IF NOT EXISTS last_name         text,
  ADD COLUMN IF NOT EXISTS newsletter_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_waitlist.newsletter_opt_in IS
  'Accord email donné au club (ou à l''organisateur) de la soirée en rejoignant la liste privée. Le trigger auto_subscribe_event_waitlist l''écrit dans newsletter_subscriptions.';

-- Bornes de longueur : le trigger de validation générique ne connaît que
-- full_name ; on ne le réécrit pas (il sert six tables), la borne vit ici.
ALTER TABLE public.event_waitlist
  DROP CONSTRAINT IF EXISTS event_waitlist_names_len;
ALTER TABLE public.event_waitlist
  ADD CONSTRAINT event_waitlist_names_len CHECK (
    length(coalesce(first_name, '')) <= 100 AND length(coalesce(last_name, '')) <= 100
  );

-- ── Le trigger d'abonnement de la liste privée ──────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_subscribe_event_waitlist()
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
  IF v_email = '' OR NOT COALESCE(NEW.newsletter_opt_in, false) THEN
    RETURN NEW;
  END IF;

  -- Destinataire nommé à l'écran = celui qui reçoit l'abonnement (club, sinon
  -- organisateur ; co-soirée org-led : club et organisateur partenaires).
  SELECT COALESCE(e.venue_id, e.partner_venue_id),
         COALESCE(e.organizer_user_id, e.partner_organizer_id)
    INTO v_venue_id, v_organizer_user_id
    FROM public.events e
   WHERE e.id = NEW.event_id;

  v_first := COALESCE(NULLIF(btrim(NEW.first_name), ''),
                      NULLIF(split_part(btrim(COALESCE(NEW.full_name, '')), ' ', 1), ''));
  v_last  := COALESCE(NULLIF(btrim(NEW.last_name), ''),
                      NULLIF(btrim(regexp_replace(COALESCE(NEW.full_name, ''), '^\S+\s*', '')), ''));

  -- Les index d'unicité sont PARTIELS et portent sur lower(email) : la cible
  -- ON CONFLICT répète l'expression ET le prédicat (42P10 sinon).
  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    VALUES (NEW.user_id, v_venue_id, v_email, true, 'waitlist', 'waitlist', now(), v_first, v_last)
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now();
  ELSIF v_organizer_user_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    VALUES (NEW.user_id, v_organizer_user_id, v_email, true, 'waitlist', 'waitlist', now(), v_first, v_last)
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une écriture marketing ne fait JAMAIS échouer l'inscription qu'elle observe.
  RAISE WARNING 'auto_subscribe_event_waitlist: % (entry %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_subscribe_event_waitlist() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_event_waitlist_newsletter ON public.event_waitlist;
CREATE TRIGGER trg_event_waitlist_newsletter
  AFTER INSERT ON public.event_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.auto_subscribe_event_waitlist();
