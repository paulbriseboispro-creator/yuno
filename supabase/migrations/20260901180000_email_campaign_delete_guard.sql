-- ───────────────────────────────────────────────────────────────────────────
-- Suppression d'une campagne : les BROUILLONS uniquement.
--
-- Le pro doit pouvoir jeter ses essais (le studio crée une ligne dès la
-- première seconde, les brouillons s'accumulent vite). Mais une campagne
-- PARTIE est une archive : ses destinataires, ses ouvertures, ses clics et son
-- revenu attribué racontent ce qui s'est passé ce soir-là. La supprimer
-- effacerait `email_campaign_recipients` et `email_campaign_events` en cascade,
-- sans retour possible.
--
-- Le front n'affiche la corbeille que sur les brouillons ; ce trigger est ce
-- qui rend la règle VRAIE, y compris pour un appel REST bricolé à la main.
--
-- ⚠️ SECURITY INVOKER obligatoire (même raison que guard_promoter_payout_write) :
--    un trigger de garde SECURITY DEFINER s'exécuterait sous son propriétaire,
--    `current_user` ne vaudrait jamais 'authenticated', et la garde se
--    désactiverait elle-même.
--
-- La discrimination sur `current_user` laisse passer tout ce qui n'est PAS un
-- appel client direct — et c'est vital : la décommission d'un club
-- (`DELETE FROM venues`, cron sous postgres) et la suppression de compte
-- (edge `delete-account` sous service_role) cascadent sur cette table. Les
-- bloquer casserait les deux purges.
--
-- `email_suppressions.campaign_id` est en SET NULL : une adresse supprimée
-- reste supprimée même si la campagne qui l'a révélée disparaît. On ne
-- ressuscite jamais un désabonné.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_email_campaign_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  -- Crons, purges, edge functions : la main reste aux jobs serveur.
  IF current_user <> 'authenticated' THEN
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'campaign_delete_forbidden'
      USING HINT = 'Seul un brouillon peut être supprimé : une campagne partie garde ses destinataires, ses statistiques et son revenu attribué.';
  END IF;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_email_campaign_delete ON public.email_campaigns;
CREATE TRIGGER trg_guard_email_campaign_delete
  BEFORE DELETE ON public.email_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_email_campaign_delete();

COMMENT ON FUNCTION public.guard_email_campaign_delete() IS
  'Refuse la suppression d''une campagne non-brouillon depuis un client authentifié. Laisse passer les cascades serveur (décommission de club, suppression de compte).';
