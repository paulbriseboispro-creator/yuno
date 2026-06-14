
CREATE OR REPLACE FUNCTION public.admin_delete_venue(_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only super admins can delete venues
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Delete all related data in correct order to avoid FK violations
  -- 1. Loyalty & CRM
  DELETE FROM public.loyalty_transactions WHERE venue_id = _venue_id;
  DELETE FROM public.customer_loyalty WHERE venue_id = _venue_id;
  DELETE FROM public.loyalty_rewards WHERE venue_id = _venue_id;
  DELETE FROM public.loyalty_settings WHERE venue_id = _venue_id;
  DELETE FROM public.crm_notifications WHERE venue_id = _venue_id;
  DELETE FROM public.crm_campaigns WHERE venue_id = _venue_id;
  DELETE FROM public.customer_incidents WHERE venue_id = _venue_id;
  DELETE FROM public.venue_customers WHERE venue_id = _venue_id;

  -- 2. VIP consumptions (depend on table_reservations)
  DELETE FROM public.vip_consumptions WHERE table_reservation_id IN (
    SELECT tr.id FROM public.table_reservations tr
    JOIN public.table_zones tz ON tz.id = tr.zone_id
    WHERE tz.venue_id = _venue_id
  );

  -- 3. Table reservations & zones
  DELETE FROM public.table_reservations WHERE zone_id IN (
    SELECT id FROM public.table_zones WHERE venue_id = _venue_id
  );
  DELETE FROM public.event_table_settings WHERE event_id IN (
    SELECT id FROM public.events WHERE venue_id = _venue_id
  );
  DELETE FROM public.table_pack_presets WHERE venue_id = _venue_id;
  DELETE FROM public.table_zones WHERE venue_id = _venue_id;

  -- 4. Invoices & invoice numbers
  DELETE FROM public.invoices WHERE venue_id = _venue_id;
  DELETE FROM public.invoice_numbers WHERE venue_id = _venue_id;

  -- 5. Orders (depend on events)
  DELETE FROM public.order_items WHERE order_id IN (
    SELECT id FROM public.orders WHERE venue_id = _venue_id
  );
  DELETE FROM public.orders WHERE venue_id = _venue_id;

  -- 6. Tickets (depend on events)
  DELETE FROM public.ticket_attendees WHERE ticket_id IN (
    SELECT t.id FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE e.venue_id = _venue_id
  );
  DELETE FROM public.tickets WHERE event_id IN (
    SELECT id FROM public.events WHERE venue_id = _venue_id
  );
  DELETE FROM public.ticket_rounds WHERE event_id IN (
    SELECT id FROM public.events WHERE venue_id = _venue_id
  );

  -- 7. Cloakroom
  DELETE FROM public.cloakroom_transactions WHERE venue_id = _venue_id;

  -- 8. Guest lists
  DELETE FROM public.guest_list_entries WHERE guest_list_id IN (
    SELECT id FROM public.guest_lists WHERE venue_id = _venue_id
  );
  DELETE FROM public.guest_lists WHERE venue_id = _venue_id;

  -- 9. Event related
  DELETE FROM public.event_notes WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.event_djs WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.event_organizers WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.event_collab_invitations WHERE venue_id = _venue_id;
  DELETE FROM public.event_recap_sent WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.event_staff WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.notifications WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.favorites WHERE event_id IN (SELECT id FROM public.events WHERE venue_id = _venue_id);
  DELETE FROM public.cart_snapshots WHERE venue_id = _venue_id;

  -- 10. Events
  DELETE FROM public.events WHERE venue_id = _venue_id;

  -- 11. DJs & sets
  DELETE FROM public.dj_payments WHERE dj_id IN (SELECT id FROM public.djs WHERE venue_id = _venue_id);
  DELETE FROM public.dj_sets WHERE venue_id = _venue_id;
  DELETE FROM public.dj_invitations WHERE venue_id = _venue_id;
  DELETE FROM public.djs WHERE venue_id = _venue_id;

  -- 12. Drinks
  DELETE FROM public.favorites WHERE drink_id IN (SELECT id FROM public.drinks WHERE venue_id = _venue_id);
  DELETE FROM public.drink_requests WHERE venue_id = _venue_id;
  DELETE FROM public.drinks WHERE venue_id = _venue_id;

  -- 13. Staff & managers
  DELETE FROM public.manager_permissions WHERE venue_id = _venue_id;
  DELETE FROM public.staff_pins WHERE venue_id = _venue_id;

  -- 14. Promoters
  DELETE FROM public.promoter_invitations WHERE venue_id = _venue_id;
  DELETE FROM public.promoter_links WHERE venue_id = _venue_id;
  DELETE FROM public.promoter_clicks WHERE venue_id = _venue_id;
  DELETE FROM public.promoters WHERE venue_id = _venue_id;

  -- 15. Organizers
  DELETE FROM public.organizer_invitations WHERE venue_id = _venue_id;
  DELETE FROM public.organizers WHERE venue_id = _venue_id;

  -- 16. Venue-level data
  DELETE FROM public.venue_commissions WHERE venue_id = _venue_id;
  DELETE FROM public.visitor_sessions WHERE venue_id = _venue_id;
  DELETE FROM public.favorites WHERE venue_id = _venue_id;
  DELETE FROM public.feedback_issues WHERE venue_id = _venue_id;
  DELETE FROM public.owner_invitations WHERE venue_id = _venue_id;
  DELETE FROM public.push_subscriptions WHERE venue_id = _venue_id;
  DELETE FROM public.upsell_cart_rules WHERE venue_id = _venue_id;
  DELETE FROM public.upsell_packs WHERE venue_id = _venue_id;
  DELETE FROM public.upsell_promos WHERE venue_id = _venue_id;
  DELETE FROM public.upsell_ticket_offers WHERE venue_id = _venue_id;
  DELETE FROM public.vip_menu_items WHERE venue_id = _venue_id;

  -- 17. Finally delete the venue
  DELETE FROM public.venues WHERE id = _venue_id;
END;
$$;
