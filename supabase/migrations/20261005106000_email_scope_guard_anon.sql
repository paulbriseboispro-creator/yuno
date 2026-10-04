-- ============================================================================
-- Garde des écrans e-mail : un visiteur sans compte ne passe plus.
--
-- _email_scope_guard testait `p_organizer_user_id = auth.uid()` : sans
-- session, auth.uid() est NULL, la comparaison vaut NULL, `IF NOT (NULL OR
-- false)` ne lève pas, et la garde laissait passer. Les six lectures qui
-- l'appellent étaient ouvertes à anon : statistiques et aperçu des
-- automatisations, suggestions, heures d'ouverture, renvois, et l'historique
-- des e-mails automatiques d'un client lu par son adresse
-- (get_customer_automation_emails). Vérifié en transaction annulée le 04/10.
--
-- La garde rend « refusé » sur tout résultat NULL, et ces lectures de la
-- Console ne sont plus exécutables par anon (aucun écran public ne les lit).
-- Corps repris de la base liée (pg_get_functiondef, 04/10).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._email_scope_guard(p_venue_id text, p_organizer_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT COALESCE(public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT COALESCE(p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin(), false) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_campaign_resend_stats(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_customer_automation_emails(text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_email_automation_suggestions(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_email_send_time_insights(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_email_automation(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_resend_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_automation_emails(text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_email_automation_suggestions(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_email_send_time_insights(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_email_automation(text, uuid, text) TO authenticated, service_role;
