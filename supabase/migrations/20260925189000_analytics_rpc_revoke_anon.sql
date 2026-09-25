-- Les RPC d'analyse pro ne s'ouvrent pas aux visiteurs anonymes (2026-09-25).
-- Elles répondaient déjà `not_authenticated` sans session ; on retire le droit
-- d'exécution lui-même, comme pour leurs sœurs (get_event_report,
-- get_page_traffic, get_community_overview…).
REVOKE EXECUTE ON FUNCTION public.get_sales_overview(text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_events_sales_summary(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_live_view(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_overview(text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_events_sales_summary(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_live_view(text, uuid) TO authenticated, service_role;
