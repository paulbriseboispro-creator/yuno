// Anon-safe column allow-lists for tables that are read on public (unauthenticated)
// surfaces. These MUST stay in sync with the column-level GRANTs to the `anon`
// role (see migration 20260703140000_restrict_anon_sensitive_columns.sql).
//
// Sensitive columns deliberately EXCLUDED from anon reads:
//   venues:              legal_name, legal_address, siret, vat_number, invoice_prefix,
//                        stripe_account_id, stripe_charges_enabled,
//                        stripe_onboarding_complete, stripe_payouts_enabled
//   organizer_profiles:  billing_email, legal_name, legal_address, siret, vat_number
//
// NOTE: minor_auth_doc_url / minor_auth_doc_name stay anon-readable on purpose — they
// are the venue/organizer's blank minor-authorization TEMPLATE that a guest (minor)
// buyer must download during ticket checkout (see TicketCheckout).
//
// If you add a new column that public pages need, add it here AND grant it to anon
// in a follow-up migration. Never select('*') on these tables from an anon-reachable
// path — it will 403 once the column grants land.

export const PUBLIC_VENUE_COLUMNS = [
  'id', 'name', 'address', 'city', 'description', 'short_description', 'music_genre',
  'cover_url', 'cover_position', 'logo_url', 'gallery_images', 'floor_plan_url',
  'latitude', 'longitude', 'x', 'y', 'min_age', 'minors_allowed',
  'minor_auth_doc_url', 'minor_auth_doc_name',
  'menu_enabled', 'free_drink_mode', 'click_collect_mode', 'cloakroom_price',
  'bar_count', 'bar_names', 'absorb_yuno_fees', 'cancellation_insurance_enabled',
  'custom_domain', 'is_hidden', 'hidden_from_map', 'owner_id', 'created_at',
  'instagram_url', 'facebook_url', 'twitter_url', 'tiktok_url', 'whatsapp_number',
  'vip_menu_display_mode', 'vip_menu_visibility', 'vip_placement_enabled', 'vip_preorder_enabled',
].join(',');

export const PUBLIC_ORGANIZER_COLUMNS = [
  'user_id', 'slug', 'display_name', 'bio', 'avatar_url', 'cover_url', 'city',
  'is_public', 'website_url', 'instagram_url', 'minors_allowed',
  'minor_auth_doc_url', 'minor_auth_doc_name',
  'can_sell_alcohol', 'can_sell_alcohol_confirmed_at', 'bde_verified', 'bde_verified_at',
  'absorb_yuno_fees', 'created_at', 'updated_at',
].join(',');
