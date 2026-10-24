-- Ferme le droit EXECUTE hérité (PUBLIC / anon) sur 9 fonctions SECURITY DEFINER
-- du moteur d'e-mails et 3 fonctions de déclencheur. Même classe de défaut que
-- 20260925193000 : Postgres accorde EXECUTE à PUBLIC par défaut, Supabase ajoute
-- anon / authenticated, et CREATE OR REPLACE conserve ces droits.
--
-- Appelants réels vérifiés le 21/10/2026 (src/, supabase/functions/, cron.job) :
--   service_role seul (edge via client admin) :
--     collect_email_automations, collect_campaign_followups, collect_campaign_resends,
--     get_recipient_block_conds, email_automation_covers_event.
--     email_marketing_pressure : aucun appelant client ni edge, lue seulement par
--     email_send_policy (SECURITY DEFINER, donc au nom du propriétaire).
--   authenticated + service_role (Console, garde interne auth.uid()) :
--     purge_email_list, admin_customer_detail (is_super_admin), count_campaign_recipients.
--   Fonctions de déclencheur : le droit EXECUTE n'est vérifié qu'à la création du
--     trigger, jamais au tir ; plus aucun rôle client n'a de raison de l'avoir.
--
-- Laissées publiques exprès : get_my_marketing_consent et get_event_marketing_hosts
--   (checkout invité : sans auth.uid() elles rendent faux / la liste publique des hôtes),
--   unsubscribe_by_token, preview_unsubscribe, submit_crm_signup, crm_signup_confirm.

REVOKE EXECUTE ON FUNCTION public.collect_email_automations()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.collect_campaign_followups()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.collect_campaign_resends()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recipient_block_conds(uuid, text[])      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_automation_covers_event(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_marketing_pressure(text)               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.collect_email_automations()                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.collect_campaign_followups()                 TO service_role;
GRANT  EXECUTE ON FUNCTION public.collect_campaign_resends()                   TO service_role;
GRANT  EXECUTE ON FUNCTION public.get_recipient_block_conds(uuid, text[])      TO service_role;
GRANT  EXECUTE ON FUNCTION public.email_automation_covers_event(uuid, text)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.email_marketing_pressure(text)               TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_email_list(uuid)                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_customer_detail(text)                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_campaign_recipients(text, text, text, uuid, uuid)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.purge_email_list(uuid)                                        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_customer_detail(text)                                   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.count_campaign_recipients(text, text, text, uuid, uuid)       TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.guard_crm_send_frozen()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_subscribe_guest_list_entry()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_subscribe_newsletter_on_purchase()  FROM PUBLIC, anon, authenticated;

-- Contrôle : la migration échoue si un droit visé reste ouvert.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
           p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'collect_email_automations','collect_campaign_followups','collect_campaign_resends',
       'get_recipient_block_conds','email_automation_covers_event','email_marketing_pressure',
       'purge_email_list','admin_customer_detail','count_campaign_recipients',
       'guard_crm_send_frozen','auto_subscribe_guest_list_entry','auto_subscribe_newsletter_on_purchase')
  LOOP
    IF r.anon_x THEN RAISE EXCEPTION 'anon garde EXECUTE sur %', r.sig; END IF;
    IF r.auth_x AND r.proname NOT IN ('purge_email_list','admin_customer_detail','count_campaign_recipients') THEN
      RAISE EXCEPTION 'authenticated garde EXECUTE sur %', r.sig;
    END IF;
  END LOOP;
END $$;
