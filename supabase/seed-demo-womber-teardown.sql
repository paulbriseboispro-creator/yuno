-- ============================================================================
-- TEARDOWN — Supprime toutes les données démo semées par seed-demo-womber.sql.
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
--
-- Par défaut : efface uniquement les DONNÉES démo. Conserve owner@womber.fr,
-- la ligne du club, et les comptes liés (orga/promo/affilié/DJ/staff).
-- Pour aussi SUPPRIMER les comptes liés : décommente "OPTION B" en bas.
-- ============================================================================

DO $$
DECLARE
  v_owner  uuid;  v_venue text;  v_org uuid;
  v_promo  uuid;  v_aff uuid;     v_dj uuid;
  v_pv uuid; v_po uuid; v_aid uuid; v_djv uuid; v_djo uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'owner@womber.fr introuvable — rien à nettoyer.'; END IF;

  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL; END IF;

  SELECT id INTO v_org   FROM auth.users WHERE email = 'organizer@womber.fr';
  SELECT id INTO v_promo FROM auth.users WHERE email = 'promoter@womber.fr';
  SELECT id INTO v_aff   FROM auth.users WHERE email = 'affiliate@womber.fr';
  SELECT id INTO v_dj    FROM auth.users WHERE email = 'dj@womber.fr';
  SELECT id INTO v_pv  FROM promoters WHERE user_id = v_promo AND venue_id = v_venue;
  SELECT id INTO v_po  FROM promoters WHERE user_id = v_promo AND organizer_user_id = v_org;
  SELECT id INTO v_aid FROM affiliates WHERE user_id = v_aff;
  SELECT id INTO v_djv FROM djs WHERE user_id = v_dj AND venue_id = v_venue;
  SELECT id INTO v_djo FROM djs WHERE user_id = v_dj AND organizer_user_id = v_org;

  -- Promoteur
  DELETE FROM promoter_conversions WHERE promoter_id IN (v_pv, v_po);
  DELETE FROM promoter_clicks      WHERE promoter_id IN (v_pv, v_po);
  DELETE FROM promoter_payouts     WHERE promoter_id IN (v_pv, v_po);
  DELETE FROM promoter_event_assignments WHERE promoter_id IN (v_pv, v_po);
  DELETE FROM promoter_announcements WHERE venue_id = v_venue OR organizer_user_id = v_org;
  DELETE FROM promoter_teams       WHERE venue_id = v_venue OR organizer_user_id = v_org;
  DELETE FROM commission_templates WHERE venue_id = v_venue OR organizer_user_id = v_org;

  -- Guest lists
  DELETE FROM guest_list_entries WHERE guest_list_id IN (SELECT id FROM guest_lists WHERE venue_id = v_venue OR organizer_user_id = v_org);
  DELETE FROM guest_lists WHERE venue_id = v_venue OR organizer_user_id = v_org;

  -- DJ
  DELETE FROM event_djs WHERE dj_id IN (v_djv, v_djo);
  DELETE FROM dj_sets   WHERE dj_id IN (v_djv, v_djo);

  -- Ventes
  DELETE FROM tickets            WHERE purchase_source = 'demo_seed';
  DELETE FROM table_reservations WHERE purchase_source = 'demo_seed';
  DELETE FROM orders WHERE venue_id = v_venue AND (order_number LIKE 'DEMO-%' OR user_email LIKE '%@demo.womber.fr');

  -- Events + catalogue
  DELETE FROM ticket_rounds WHERE event_id IN (SELECT id FROM events WHERE access_code = 'DEMO_SEED' AND (venue_id = v_venue OR organizer_user_id = v_org));
  DELETE FROM visitor_sessions WHERE session_id LIKE 'demo-%';
  DELETE FROM venue_customers  WHERE venue_id = v_venue AND email LIKE '%@demo.womber.fr';
  DELETE FROM table_packs WHERE venue_id = v_venue;
  DELETE FROM vip_tables  WHERE venue_id = v_venue;
  DELETE FROM table_zones WHERE venue_id = v_venue;
  DELETE FROM events WHERE access_code = 'DEMO_SEED' AND (venue_id = v_venue OR organizer_user_id = v_org);
  DELETE FROM upsell_drink_packs WHERE venue_id = v_venue;
  DELETE FROM drinks WHERE venue_id = v_venue;

  -- Factures démo (script make-invoices-yuno.sql)
  DELETE FROM invoices WHERE invoice_number LIKE 'YUNO-%' AND (venue_id = v_venue OR organizer_user_id = v_org);

  -- Marketing / loyalty / partenariat
  DELETE FROM loyalty_rewards  WHERE venue_id = v_venue;
  DELETE FROM loyalty_settings WHERE venue_id = v_venue;
  DELETE FROM email_campaigns WHERE venue_id = v_venue OR organizer_user_id = v_org;
  DELETE FROM sms_campaigns   WHERE venue_id = v_venue OR organizer_id = v_org;
  DELETE FROM venue_organizer_partnerships WHERE venue_id = v_venue AND organizer_user_id = v_org;

  -- Affilié
  DELETE FROM affiliate_visitor_sessions WHERE affiliate_id = v_aid;
  DELETE FROM affiliate_clicks WHERE affiliate_id = v_aid;
  DELETE FROM affiliate_events WHERE affiliate_id = v_aid;
  DELETE FROM affiliate_venues WHERE affiliate_id = v_aid;

  RAISE NOTICE 'Données démo supprimées pour le club Yuno % (comptes/identités conservés).', v_venue;
END $$;

-- ============================================================================
-- OPTION B (décommenter pour supprimer AUSSI les comptes liés + identités).
-- Ne supprime jamais owner@womber.fr ni le club.
-- ============================================================================
-- DO $$
-- DECLARE v_org uuid; v_promo uuid; v_aff uuid; v_dj uuid; v_ids uuid[];
-- BEGIN
--   SELECT id INTO v_org   FROM auth.users WHERE email='organizer@womber.fr';
--   SELECT id INTO v_promo FROM auth.users WHERE email='promoter@womber.fr';
--   SELECT id INTO v_aff   FROM auth.users WHERE email='affiliate@womber.fr';
--   SELECT id INTO v_dj    FROM auth.users WHERE email='dj@womber.fr';
--   DELETE FROM org_staff   WHERE organizer_user_id = v_org;
--   DELETE FROM org_members WHERE organizer_user_id = v_org;
--   DELETE FROM djs        WHERE user_id = v_dj;
--   DELETE FROM promoters  WHERE user_id = v_promo;
--   DELETE FROM affiliates WHERE user_id = v_aff;
--   SELECT array_agg(id) INTO v_ids FROM auth.users WHERE email IN (
--     'organizer@womber.fr','promoter@womber.fr','affiliate@womber.fr','dj@womber.fr',
--     'bouncer@womber.fr','barman@womber.fr','cloakroom@womber.fr');
--   DELETE FROM user_roles WHERE user_id = ANY(v_ids);
--   DELETE FROM auth.identities WHERE user_id = ANY(v_ids);
--   DELETE FROM auth.users WHERE id = ANY(v_ids);  -- profiles cascade
-- END $$;
