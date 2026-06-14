-- Remove PostgreSQL's default PUBLIC execute grant, which also affects anonymous callers.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Intentionally public, token-validated flows only.
GRANT EXECUTE ON FUNCTION public.get_guest_list_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_unsubscribe(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(uuid) TO anon, authenticated;

-- Authenticated UI/admin RPCs with in-function authorization checks.
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_venue(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_client_scores(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_leaderboard_contest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_nightlife_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_visitor_stats(text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_maintenance_password(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(text, uuid) TO authenticated;

-- Authenticated helper predicates used by protected app and backend flows.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_venue_owner(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner_of_any_venue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_venue_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_venue(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_venue_staff(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_has_permission(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_organizer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_partner_organizer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_partner_venue_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_tables(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_split(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_staff(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_staff_for_event(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_team_member(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_member_has_permission(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_organizer_promoters(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_organizer_promoter_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_organizer_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_staff_organizer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_managing_organizer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_venue_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_venue_user_ids(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reservation_venue_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_customer_banned(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients_org(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_invitation_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_mfa_disable_rate_limit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_ticket_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ticket_capacity(uuid, uuid, uuid, text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_timeline(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_vip_upsell(uuid) TO authenticated;

-- Server-side service role keeps full access for backend functions and scheduled jobs.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;