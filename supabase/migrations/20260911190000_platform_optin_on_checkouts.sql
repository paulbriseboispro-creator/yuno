-- ============================================================================
-- Billets + tables : l'accord donné à Yuno s'écrit aussi depuis un checkout
-- (2026-09-11)
--
-- La guest list demande les trois accords depuis 20260911150000 : le club
-- (email), le club (SMS), et Yuno. Les deux autres piliers n'en demandaient que
-- deux — un acheteur de billet pouvait donc dire oui au club sans que Yuno ait
-- jamais eu l'occasion de poser sa propre question. Trois lignes distinctes,
-- trois destinataires distincts : le consentement donné au Club A ne couvre
-- jamais Yuno (EDPB 05/2020 §65), et l'email ne couvre jamais le SMS.
--
-- Pourquoi une FONCTION appelée par l'edge, et pas une colonne + un trigger
-- comme sur la guest list :
--
--   * `tickets` accepterait la colonne sans douleur, mais une réservation de
--     table naît dans `reserve_table_slot(...)`. Lui ajouter un paramètre
--     impose un DROP + CREATE (CREATE OR REPLACE ne change pas une signature,
--     il crée une surcharge — et une surcharge rend l'appel des bundles edge
--     en cache ambigu, erreur 300). On ne re-signe pas le chemin de l'argent
--     pour un effet de bord marketing.
--
--   * Un seul mécanisme pour les deux piliers vaut mieux que deux. La preuve
--     RGPD, elle, reste là où elle a toujours été : marketing_consent_events,
--     écrit côté client par record_platform_marketing_consent avec le libellé
--     RÉELLEMENT affiché (EDPB 05/2020 §108).
--
-- Le moment de l'écriture est celui du club : à la création de la vente, y
-- compris quand elle est encore `pending` (trg_tickets_auto_subscribe est un
-- AFTER INSERT). Cocher la case EST l'acte positif ; qu'un paiement Stripe soit
-- ensuite abandonné ne retire pas un consentement donné.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subscribe_platform_marketing(
  p_email text,
  p_user_id uuid DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_source text DEFAULT 'platform:checkout'
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_first text;
  v_last  text;
BEGIN
  IF v_email = '' THEN
    RETURN;
  END IF;

  v_first := NULLIF(split_part(btrim(COALESCE(p_full_name, '')), ' ', 1), '');
  v_last  := NULLIF(btrim(regexp_replace(COALESCE(p_full_name, ''), '^\S+\s*', '')), '');

  -- Portée plateforme = les DEUX colonnes de portée à NULL. L'arbitre est
  -- l'index PARTIEL uniq_newsletter_subs_email_platform : la cible ON CONFLICT
  -- doit répéter l'expression lower(email) ET le prédicat, sinon 42P10 à
  -- l'exécution (leçon du 08/08).
  INSERT INTO public.newsletter_subscriptions
    (user_id, venue_id, organizer_user_id, email, opted_in, source,
     consent_source, consent_recorded_at, first_name, last_name)
  VALUES
    (p_user_id, NULL, NULL, v_email, true, COALESCE(NULLIF(btrim(p_source), ''), 'platform:checkout'),
     'ticketing', now(), v_first, v_last)
  ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
    SET opted_in = true, opted_out_at = NULL,
        user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
        first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
        last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
        updated_at = now();

EXCEPTION WHEN OTHERS THEN
  -- Une écriture marketing ne fait JAMAIS échouer la vente qu'elle observe.
  -- Même doctrine que auto_subscribe_newsletter_on_purchase, qui a déjà bloqué
  -- toutes les ventes d'un club pendant des semaines.
  RAISE WARNING 'subscribe_platform_marketing: % (email %)', SQLERRM, v_email;
END;
$$;

COMMENT ON FUNCTION public.subscribe_platform_marketing(text, uuid, text, text) IS
  'Abonne une adresse à la portée PLATEFORME (Yuno lui-même). Appelée par les edge functions de checkout billets/tables, jamais par un client. La guest list passe, elle, par auto_subscribe_guest_list_entry.';

-- service_role SEUL : c'est une écriture d'abonnement, pas une déclaration de
-- consentement. Un client qui pourrait l'appeler s'abonnerait lui-même sans
-- qu'aucune case n'ait été montrée ni archivée.
REVOKE ALL ON FUNCTION public.subscribe_platform_marketing(text, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.subscribe_platform_marketing(text, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscribe_platform_marketing(text, uuid, text, text) TO service_role;
