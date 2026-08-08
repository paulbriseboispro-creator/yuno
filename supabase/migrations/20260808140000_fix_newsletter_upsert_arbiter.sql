-- ============================================================================
-- Fix : l'inscription newsletter au checkout tuait la vente (« Failed to
-- create ticket », 2026-08-08).
--
-- Les index d'unicité de newsletter_subscriptions vivent en prod sur
-- l'EXPRESSION lower(email) — posés à la main lors d'une dédup, jamais
-- committés (les migrations 20260428103535 les déclarent sur la colonne
-- brute email). Or un arbitre ON CONFLICT ne peut inférer un index
-- d'expression que si la cible répète l'expression : le trigger
-- auto_subscribe_newsletter_on_purchase, corrigé le 20/07 avec
-- ON CONFLICT (email, venue_id) WHERE venue_id IS NOT NULL, levait donc
-- 42P10 « no unique or exclusion constraint matching the ON CONFLICT
-- specification » à l'exécution — et comme il est AFTER INSERT sur tickets
-- et table_reservations, il annulait TOUT l'achat dès que
-- newsletter_opt_in = true. Le front renvoie true automatiquement quand le
-- consentement email du club est déjà actif (TicketCheckout
-- effectiveNewsletterOptIn) : pour un habitué abonné, AUCUN achat ne
-- passait, sur toutes les soirées du club.
--
-- Trois actions :
--   1. Codifier les index lower(email) dans l'historique (drop + recreate
--      idempotent) : une base rebâtie depuis les migrations converge vers
--      l'état prod réel au lieu de recréer la dérive.
--   2. Réécrire le trigger avec les arbitres alignés sur ces index.
--   3. Blinder le corps : EXCEPTION WHEN OTHERS → WARNING. Une écriture
--      marketing ne doit JAMAIS faire échouer la vente qu'elle observe —
--      même doctrine que les triggers d'alerte admin et que la garde
--      tracked_link_id (_shared/tracked-link.ts).
-- ============================================================================

-- 1. Les index d'unicité, version lower(email) — l'état prod réel, désormais versionné.
DROP INDEX IF EXISTS public.uniq_newsletter_subs_email_venue;
CREATE UNIQUE INDEX uniq_newsletter_subs_email_venue
  ON public.newsletter_subscriptions (lower(email), venue_id)
  WHERE venue_id IS NOT NULL;

DROP INDEX IF EXISTS public.uniq_newsletter_subs_email_organizer;
CREATE UNIQUE INDEX uniq_newsletter_subs_email_organizer
  ON public.newsletter_subscriptions (lower(email), organizer_user_id)
  WHERE organizer_user_id IS NOT NULL;

-- 2 + 3. Trigger : arbitres alignés + vente insubmersible.
CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text;
  v_user_id uuid;
  v_optin boolean;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT venue_id, organizer_user_id INTO v_venue_id, v_organizer_user_id
      FROM public.events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT tz.venue_id INTO v_venue_id
      FROM public.table_zones tz WHERE tz.id = NEW.zone_id;
  END IF;

  IF NOT v_optin OR v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Les index d'unicité sont PARTIELS et portent sur lower(email) : la cible
  -- ON CONFLICT doit répéter à la fois l'expression ET le prédicat, sinon
  -- Postgres ne trouve pas d'arbitre (42P10 à l'exécution).
  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
    VALUES (v_user_id, v_venue_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now();
  END IF;

  IF v_organizer_user_id IS NOT NULL AND v_venue_id IS NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source)
    VALUES (v_user_id, v_organizer_user_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now();
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- L'abonnement marketing est un effet de bord best-effort : s'il casse, on
  -- le journalise et la vente continue. Il a déjà bloqué toutes les ventes
  -- d'un club pendant des semaines — plus jamais.
  RAISE WARNING 'auto_subscribe_newsletter_on_purchase: % (table %, id %)', SQLERRM, TG_TABLE_NAME, NEW.id;
  RETURN NEW;
END;
$$;
