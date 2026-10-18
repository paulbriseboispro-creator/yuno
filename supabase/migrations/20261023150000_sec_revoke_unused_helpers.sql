-- Suite de l'audit Yuno CRM du 18/10 — SEC-04 (P3) : les fonctions d'aide que
-- le navigateur n'appelle pas ne sont plus exécutables par lui.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- Au banc de séparation (isolation-results.md), dix fonctions rendaient la
-- même chose au compte A et au compte B : des clés et des indicateurs (rôle
-- d'une personne dans une organisation, « a le CRM », plafonds d'envoi), sans
-- donnée de client. Lu en prod le 18/10 (ACL, politiques RLS, vues, fonctions
-- SECURITY INVOKER, appels `rpc(` du front sur toutes les branches crm/* et
-- main) :
--
-- RÉVOQUÉES (service_role et les fonctions SECURITY DEFINER qui les appellent
-- continuent de les exécuter) :
--   · campaign_scope_is_event_principal, crm_org_role, crm_user_manages_team
--     (authenticated) ;
--   · email_sender_daily_cap, email_sender_monthly_free (PUBLIC, anon,
--     authenticated) ;
--   · count_transactional_email (anon, authenticated) : elle ÉCRIT un compteur
--     (e-mails transactionnels du mois), n'importe qui pouvait le gonfler ;
--     seul resend-webhook (service_role) l'appelle ;
--   · contact_base_scope_key : PUBLIC et anon seulement (contact_base_cache_refresh,
--     SECURITY INVOKER, la lit en tant que la personne connectée).
-- GARDÉES, et pourquoi :
--   · crm_user_in_scope : lue par les politiques RLS d'email_campaigns et
--     d'email_campaign_templates (une politique s'évalue avec les droits de
--     la personne) ;
--   · crm_scope_key, crm_scope_has_crm : lues par des fonctions MCP SECURITY
--     INVOKER (_mcp_email_products, _mcp_space_can_draft, _mcp_scenario_*) ;
--   · crm_practical_email_check : appelée par le front (src/crm/data/practical.ts).

REVOKE EXECUTE ON FUNCTION public.campaign_scope_is_event_principal(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_org_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_sender_daily_cap(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_sender_monthly_free(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_transactional_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.contact_base_scope_key(text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.campaign_scope_is_event_principal(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_org_role(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_sender_daily_cap(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_sender_monthly_free(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_transactional_email() TO service_role;
GRANT EXECUTE ON FUNCTION public.contact_base_scope_key(text, uuid) TO authenticated, service_role;
