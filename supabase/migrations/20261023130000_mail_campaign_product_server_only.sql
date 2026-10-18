-- Suite de l'audit Yuno CRM du 18/10 — MAIL-07 (P3) : le produit d'une
-- campagne e-mail (`email_campaigns.product`) n'est plus choisi par le
-- navigateur.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- AVANT : rien ne gardait la colonne. Sur un compte Billetterie + CRM, un
-- client pouvait poser `product = 'suite'` sur une campagne CRM (ou en créer
-- une ainsi sur un compte CRM pur) : `crm_campaign_is_crm` la classait
-- Billetterie, elle partait sur les e-mails OFFERTS de la Billetterie au lieu
-- des Yunits, et sans la garde d'identité de l'expéditeur du CRM.
--
-- MAINTENANT (trigger INVOKER, qui discrimine sur `current_user`, comme les
-- gardes du cycle promoteur ; jamais SECURITY DEFINER, il se désactiverait) :
--   · INSERT d'un client : seul 'crm' (la Console CRM le pose sur ses
--     brouillons) ou NULL (la Billetterie, puis la règle de la portée) passe ;
--     toute autre valeur devient NULL ;
--   · UPDATE d'un client : la valeur ne change pas (rétablie en silence : un
--     écran qui renvoie la ligne entière continue de marcher).
-- Le serveur (service_role, fonctions SECURITY DEFINER, triggers des
-- automatisations) écrit comme avant. Nommé « trg_0_… » pour passer AVANT
-- `trg_a_email_automation_child_product` (ordre alphabétique) : la copie du
-- produit d'une recette n'est jamais effacée.

CREATE OR REPLACE FUNCTION public.guard_email_campaign_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.product IS NOT NULL AND NEW.product <> 'crm' THEN
      NEW.product := NULL;
    END IF;
  ELSIF NEW.product IS DISTINCT FROM OLD.product THEN
    NEW.product := OLD.product;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_email_campaign_product() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_guard_email_campaign_product ON public.email_campaigns;
CREATE TRIGGER trg_0_guard_email_campaign_product
  BEFORE INSERT OR UPDATE OF product ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_email_campaign_product();
