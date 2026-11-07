-- « A déjà une place » se relit AU MOMENT de l'envoi, pour toute campagne CRM.
--
-- Constat du 07/11 (3AM × Act III) : `excludeEventBuyers` n'était jugé qu'à la constitution de la
-- file. L'envoi s'étalant sur 4 jours (vagues), 3 destinataires ont reçu « ta place sur la guest
-- list » après avoir déjà pris la leur (46,7 h, 36 h, 14,7 h avant leur envoi). La revérification
-- (`policy:plan_holder_after_queue`) ne vivait que pour les plans de soirée, et ne lisait que
-- `buyer_email`.
--
-- Désormais : toute campagne CRM qui exclut les détenteurs d'une soirée (`excludeEventBuyers`) ou
-- qui appartient à un plan, sur l'acheteur ET le titulaire du billet. Le Yunit est rendu, comme pour
-- un plan. (La Billetterie garde ses crédits : hors de ce correctif.)
SET lock_timeout = '3s';

DO $$
DECLARE
  v_def text;
  v_old_if text := $q$IF EXISTS (SELECT 1 FROM public.email_campaigns ec WHERE ec.id = p_campaign_id AND ec.night_plan_id IS NOT NULL) THEN$q$;
  v_new_if text := $q$IF EXISTS (SELECT 1 FROM public.email_campaigns ec
              WHERE ec.id = p_campaign_id AND ec.event_id IS NOT NULL
                AND (ec.night_plan_id IS NOT NULL
                     OR (COALESCE((ec.exclusions_json->>'excludeEventBuyers')::boolean, false) AND public.crm_campaign_is_crm(ec.id)))) THEN$q$;
  v_old_m text := $q$AND lower(t.buyer_email) = lower(r.email))
    ), hu AS ($q$;
  v_new_m text := $q$AND (lower(t.buyer_email) = lower(r.email) OR lower(t.holder_email) = lower(r.email)))
    ), hu AS ($q$;
  v_old_r text := $q$error_message = 'policy:plan_holder_after_queue'$q$;
  v_new_r text := $q$error_message = CASE WHEN EXISTS (SELECT 1 FROM public.email_campaigns e2 WHERE e2.id = p_campaign_id AND e2.night_plan_id IS NOT NULL)
                                          THEN 'policy:plan_holder_after_queue' ELSE 'policy:holder_after_queue' END$q$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.proname = 'claim_campaign_recipients' AND p.pronamespace = 'public'::regnamespace;
  IF v_def IS NULL OR position(v_old_if IN v_def) = 0 OR position(v_old_m IN v_def) = 0 OR position(v_old_r IN v_def) = 0 THEN
    RAISE EXCEPTION 'claim_campaign_recipients : définition inattendue, rien n''est modifié';
  END IF;
  v_def := replace(replace(replace(v_def, v_old_if, v_new_if), v_old_m, v_new_m), v_old_r, v_new_r);
  EXECUTE v_def;
END $$;
