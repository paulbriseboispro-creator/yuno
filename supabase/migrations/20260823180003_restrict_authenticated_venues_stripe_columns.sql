-- ============================================================================
-- P0 SÉCURITÉ (étape 2/2) — Retirer les internals Stripe + facturation de
-- venues au rôle `authenticated`.
--
-- Trou : 20260703140000 n'a restreint que `anon`. Vérifié en prod le
-- 2026-08-23 : authenticated garde un GRANT SELECT table-level → n'importe
-- quel compte client gratuit lit stripe_account_id, stripe_onboarding_complete,
-- stripe_charges_enabled, stripe_payouts_enabled et invoice_prefix de TOUS les
-- clubs via `venues?select=stripe_account_id`.
--
-- Mécanisme : identique à 20260703140000 (sémantique Postgres — un GRANT
-- table-level donne toutes les colonnes et un REVOKE de colonne ne le
-- soustrait pas). On retire le grant table-level et on re-grante colonne par
-- colonne le set sûr.
--
-- CE QUI RESTE LISIBLE PAR authenticated — décision assumée, documentée pour
-- l'audit : l'identité légale (legal_name, legal_address, siret, vat_number)
-- reste accordée. Deux flux CLIENT/CROSS-PARTY légitimes la lisent :
--   • les reçus/factures d'achat de n'importe quel acheteur
--     (src/pages/OrderConfirmation.tsx:308,462 — mention légale du vendeur) ;
--   • le rendu des contrats/avenants de collab côté organisateur
--     (src/lib/collabContractData.ts:24,84, src/lib/collabAmendmentData.ts:40,
--      src/components/owner/co-event/EventInvoicesModule.tsx:254).
-- Ces données sont par ailleurs publiques au registre Sirene pour une société
-- française. Le secret réel — le câblage Stripe Connect et la numérotation de
-- facturation interne — est, lui, retiré. Resserrer aussi l'identité légale
-- exigerait des RPC scoped « acheteur avec commande » / « partie au contrat » :
-- proposé en post-lancement, pas la veille du push.
--
-- ⚠️ ORDRE DE DÉPLOIEMENT (même contrainte que 20260703140000) :
-- pousser cette migration UNIQUEMENT après que le front patché est en ligne
-- (web + OTA natif adopté). 7 call-sites authenticated font aujourd'hui
-- `select('*')` sur venues et recevraient un 403 sur TOUTE la requête :
--   src/contexts/OwnerVenueContext.tsx:53      (racine du dashboard owner)
--   src/contexts/ManagerVenueContext.tsx:141   (racine du dashboard manager)
--   src/hooks/useOwnerVenue.tsx:49,80
--   src/pages/OwnerVenue.tsx:248
--   src/pages/admin/AdminVenueDetail.tsx:76
--   src/pages/admin/AdminVenues.tsx:111
-- Les lecteurs explicites des colonnes retirées doivent passer par la RPC
-- get_my_venue_private (20260823180002) :
--   src/components/collab/CollabEventDetail.tsx:160 (stripe_account_id, stripe_charges_enabled)
--   src/hooks/useOwnerOnboarding.tsx:58              (stripe_account_id)
--   src/components/onboarding/OnboardingStepPolish.tsx:48 (invoice_prefix)
--   src/pages/admin/AdminVenues.tsx:320 + src/pages/admin/directory/DirectoryVenues.tsx:39
--     (stripe_* — super admin, couvert par la RPC)
-- Les UPDATE owner sur venues ne cassent PAS : aucun call-site ne chaîne
-- .select() après .update() (vérifié sur les 24 update-sites), donc pas de
-- RETURNING sur colonnes retirées.
--
-- ⚠️ Règle pérenne à partir d'ici (comme pour anon depuis 20260703140000) :
-- toute NOUVELLE colonne de venues doit être explicitement GRANTée à
-- anon/authenticated si elle est destinée à être lue par le front.
-- ============================================================================

BEGIN;

REVOKE SELECT ON public.venues FROM authenticated;

-- Tout sauf : stripe_account_id, stripe_onboarding_complete,
-- stripe_charges_enabled, stripe_payouts_enabled, invoice_prefix.
GRANT SELECT (
  id, name, city, cover_url, created_at, logo_url, address, cover_position,
  click_collect_mode, owner_id, floor_plan_url, latitude, longitude,
  instagram_url, facebook_url, tiktok_url, twitter_url, gallery_images,
  whatsapp_number, custom_domain, legal_name, siret, vat_number, legal_address,
  is_hidden, bar_count, bar_names, cancellation_insurance_enabled,
  cloakroom_price, description, vip_placement_enabled, free_drink_mode,
  menu_enabled, hidden_from_map, short_description, music_genre, min_age,
  minors_allowed, minor_auth_doc_url, minor_auth_doc_name, absorb_yuno_fees,
  vip_menu_visibility, vip_preorder_enabled, vip_menu_display_mode,
  live_mode_enabled, solo_bottle_sale_enabled, post_checkout_upsell_enabled,
  search_name, search_city, slug, name_changed_at, timezone,
  decommissioned_at, purge_at
) ON public.venues TO authenticated;

COMMIT;
