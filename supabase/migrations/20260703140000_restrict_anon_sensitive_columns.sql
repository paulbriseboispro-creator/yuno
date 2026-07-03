-- Restrict anonymous (unauthenticated) reads to non-sensitive columns on
-- public.venues and public.organizer_profiles.
--
-- Problem: anon could `select=*` these tables and read business/legal identity
-- (legal_name, legal_address, siret, vat_number, invoice_prefix), the billing
-- email, and Stripe Connect internals (stripe_account_id + onboarding/charge/payout
-- flags). Confirmed live leak on venues: legal_name="SAS Yuno", legal_address=...
--
-- Postgres semantics: a table-level GRANT SELECT lets a role read ALL columns and a
-- column-level REVOKE does NOT subtract from it. So we drop anon's table-level SELECT
-- and re-grant SELECT on the safe columns only. The `authenticated` role keeps its
-- table-level SELECT (owners/admins still read every column, gated by RLS row policies).
--
-- minor_auth_doc_url / minor_auth_doc_name stay granted on purpose: they are the blank
-- minor-authorization TEMPLATE a guest (minor) buyer downloads during ticket checkout.
--
-- DEPLOY ORDER: ship the frontend column-narrowing first (src/integrations/supabase/
-- publicColumns.ts + TableCheckout + OrganizerPublicProfile). Any remaining anon
-- select('*') on these tables will 403 once these grants land. Verify public pages
-- (/, /events, /club/:slug, /o/:slug, ticket + table checkout) after pushing.

BEGIN;

-- venues: anon reads everything EXCEPT legal/stripe/invoicing internals
REVOKE SELECT ON public.venues FROM anon;
GRANT SELECT (
  id, name, address, city, description, short_description, music_genre,
  cover_url, cover_position, logo_url, gallery_images, floor_plan_url,
  latitude, longitude, min_age, minors_allowed,
  minor_auth_doc_url, minor_auth_doc_name,
  menu_enabled, free_drink_mode, click_collect_mode, cloakroom_price,
  bar_count, bar_names, absorb_yuno_fees, cancellation_insurance_enabled,
  custom_domain, is_hidden, hidden_from_map, owner_id, created_at,
  instagram_url, facebook_url, twitter_url, tiktok_url, whatsapp_number,
  vip_menu_display_mode, vip_menu_visibility, vip_placement_enabled, vip_preorder_enabled
) ON public.venues TO anon;

-- organizer_profiles: anon reads the public profile subset only
REVOKE SELECT ON public.organizer_profiles FROM anon;
GRANT SELECT (
  user_id, slug, display_name, bio, avatar_url, cover_url, city,
  is_public, website_url, instagram_url, minors_allowed,
  minor_auth_doc_url, minor_auth_doc_name,
  can_sell_alcohol, can_sell_alcohol_confirmed_at, bde_verified, bde_verified_at,
  absorb_yuno_fees, created_at, updated_at
) ON public.organizer_profiles TO anon;

COMMIT;
