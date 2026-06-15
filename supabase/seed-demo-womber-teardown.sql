-- ============================================================================
-- TEARDOWN — Supprime toutes les données démo semées par seed-demo-womber.sql.
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
--
-- Par défaut : efface uniquement les DONNÉES démo (events, ventes, clics, CRM...).
-- Conserve le compte owner@womber.fr, la ligne du club, et les 6 comptes liés
-- (orga/promo/affilié/staff) pour pouvoir re-seed vite.
--
-- Pour aussi SUPPRIMER les 6 comptes liés : décommente le bloc final "OPTION B".
-- (Le compte owner@womber.fr et le club ne sont JAMAIS supprimés ici.)
-- ============================================================================

DO $$
DECLARE
  v_owner     uuid;
  v_venue     text;
  v_org       uuid;
  v_promo     uuid;
  v_aff       uuid;
  v_promoter  uuid;
  v_affiliate uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'owner@womber.fr introuvable — rien à nettoyer.';
  END IF;

  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;

  SELECT id INTO v_org   FROM auth.users WHERE email = 'organizer@womber.fr';
  SELECT id INTO v_promo FROM auth.users WHERE email = 'promoter@womber.fr';
  SELECT id INTO v_aff   FROM auth.users WHERE email = 'affiliate@womber.fr';
  SELECT id INTO v_promoter  FROM promoters  WHERE user_id = v_promo;
  SELECT id INTO v_affiliate FROM affiliates WHERE user_id = v_aff;

  -- Données promoteur
  DELETE FROM promoter_conversions WHERE promoter_id = v_promoter;
  DELETE FROM promoter_clicks      WHERE promoter_id = v_promoter;
  DELETE FROM promoter_payouts     WHERE promoter_id = v_promoter;

  -- Guest lists
  DELETE FROM guest_list_entries WHERE guest_list_id IN (
    SELECT id FROM guest_lists WHERE venue_id = v_venue OR organizer_user_id = v_org);
  DELETE FROM guest_lists WHERE venue_id = v_venue OR organizer_user_id = v_org;

  -- Ventes
  DELETE FROM tickets            WHERE purchase_source = 'demo_seed';
  DELETE FROM table_reservations WHERE purchase_source = 'demo_seed';
  DELETE FROM orders WHERE venue_id = v_venue
    AND (order_number LIKE 'DEMO-%' OR user_email LIKE '%@demo.womber.fr');

  -- Events + catalogue
  DELETE FROM ticket_rounds WHERE event_id IN (
    SELECT id FROM events WHERE access_code = 'DEMO_SEED'
      AND (venue_id = v_venue OR organizer_user_id = v_org));
  DELETE FROM visitor_sessions WHERE venue_id = v_venue AND session_id LIKE 'demo-%';
  DELETE FROM venue_customers  WHERE venue_id = v_venue AND email LIKE '%@demo.womber.fr';
  DELETE FROM vip_tables  WHERE venue_id = v_venue;
  DELETE FROM table_zones WHERE venue_id = v_venue;
  DELETE FROM events WHERE access_code = 'DEMO_SEED'
    AND (venue_id = v_venue OR organizer_user_id = v_org);
  DELETE FROM drinks WHERE venue_id = v_venue;

  -- Affilié
  DELETE FROM affiliate_visitor_sessions WHERE affiliate_id = v_affiliate;
  DELETE FROM affiliate_clicks WHERE affiliate_id = v_affiliate;
  DELETE FROM affiliate_events WHERE affiliate_id = v_affiliate;
  DELETE FROM affiliate_venues WHERE affiliate_id = v_affiliate;

  RAISE NOTICE 'Données démo supprimées pour le club % (comptes liés conservés).', v_venue;
END $$;

-- ============================================================================
-- OPTION B (décommenter pour supprimer AUSSI les 6 comptes liés + leurs rôles).
-- Ne supprime jamais owner@womber.fr ni le club.
-- ============================================================================
-- DO $$
-- DECLARE
--   v_promo uuid; v_aff uuid; v_ids uuid[];
-- BEGIN
--   SELECT id INTO v_promo FROM auth.users WHERE email = 'promoter@womber.fr';
--   SELECT id INTO v_aff   FROM auth.users WHERE email = 'affiliate@womber.fr';
--   DELETE FROM promoters  WHERE user_id = v_promo;
--   DELETE FROM affiliates WHERE user_id = v_aff;
--   SELECT array_agg(id) INTO v_ids FROM auth.users WHERE email IN (
--     'organizer@womber.fr','promoter@womber.fr','affiliate@womber.fr',
--     'bouncer@womber.fr','barman@womber.fr','cloakroom@womber.fr');
--   DELETE FROM user_roles WHERE user_id = ANY(v_ids);
--   DELETE FROM auth.identities WHERE user_id = ANY(v_ids);
--   DELETE FROM auth.users WHERE id = ANY(v_ids);  -- profiles cascade
--   RAISE NOTICE 'Comptes liés supprimés.';
-- END $$;
