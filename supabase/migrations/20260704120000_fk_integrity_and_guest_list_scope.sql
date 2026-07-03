-- ============================================================================
-- Intégrité relationnelle (FK manquantes) + colmatage RLS guest_lists.
--
-- Audit data-architecture 2026-07-04. Toutes les cibles ci-dessous ont été
-- vérifiées SANS orphelin sur la base live (fulawxvdlwtdlpkycixe) au moment de
-- l'écriture — les ADD CONSTRAINT valideront donc immédiatement. On utilise
-- quand même NOT VALID + VALIDATE pour ne prendre qu'un ShareUpdateExclusiveLock
-- (pas de lock table long) sur les grosses tables (orders, tickets).
--
-- NB : NE COUVRE PAS les colonnes volontairement sans FK (analytics haut-débit,
-- ledger invoices/revenue_distributions, order_pack_credits.pack_id polymorphe,
-- refs Stripe). Voir docs/DATA_ARCHITECTURE.md §"Colonnes FK-less assumées".
-- ============================================================================

-- ── 1. Rattachement au venue (ON DELETE CASCADE : la donnée meurt avec le club) ──
-- venue_id NOT NULL → CASCADE est le seul choix cohérent (une ligne sans club
-- n'a aucun sens). guest_lists.venue_id / email_campaigns.venue_id sont nullable
-- mais restent CASCADE (si présent, doit pointer un club vivant).

ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.guest_lists VALIDATE CONSTRAINT guest_lists_venue_id_fkey;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.email_campaigns VALIDATE CONSTRAINT email_campaigns_venue_id_fkey;

ALTER TABLE public.table_packs
  ADD CONSTRAINT table_packs_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.table_packs VALIDATE CONSTRAINT table_packs_venue_id_fkey;

ALTER TABLE public.venue_floor_plans
  ADD CONSTRAINT venue_floor_plans_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.venue_floor_plans VALIDATE CONSTRAINT venue_floor_plans_venue_id_fkey;

ALTER TABLE public.venue_hype_baseline
  ADD CONSTRAINT venue_hype_baseline_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.venue_hype_baseline VALIDATE CONSTRAINT venue_hype_baseline_venue_id_fkey;

ALTER TABLE public.vip_consumptions
  ADD CONSTRAINT vip_consumptions_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.vip_consumptions VALIDATE CONSTRAINT vip_consumptions_venue_id_fkey;

ALTER TABLE public.vip_service_moments
  ADD CONSTRAINT vip_service_moments_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.vip_service_moments VALIDATE CONSTRAINT vip_service_moments_venue_id_fkey;

ALTER TABLE public.vip_table_waitlist
  ADD CONSTRAINT vip_table_waitlist_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.vip_table_waitlist VALIDATE CONSTRAINT vip_table_waitlist_venue_id_fkey;

ALTER TABLE public.owner_ai_audit_log
  ADD CONSTRAINT owner_ai_audit_log_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.owner_ai_audit_log VALIDATE CONSTRAINT owner_ai_audit_log_venue_id_fkey;

ALTER TABLE public.upsell_cart_rules
  ADD CONSTRAINT upsell_cart_rules_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.upsell_cart_rules VALIDATE CONSTRAINT upsell_cart_rules_venue_id_fkey;

-- ── 2. Références drinks dans les règles d'upsell (SET NULL : la règle survit) ──
ALTER TABLE public.upsell_cart_rules
  ADD CONSTRAINT upsell_cart_rules_addon_drink_id_fkey
  FOREIGN KEY (addon_drink_id) REFERENCES public.drinks(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.upsell_cart_rules VALIDATE CONSTRAINT upsell_cart_rules_addon_drink_id_fkey;

ALTER TABLE public.upsell_cart_rules
  ADD CONSTRAINT upsell_cart_rules_reward_drink_id_fkey
  FOREIGN KEY (reward_drink_id) REFERENCES public.drinks(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.upsell_cart_rules VALIDATE CONSTRAINT upsell_cart_rules_reward_drink_id_fkey;

-- ── 3. Références "utilisateur" (SET NULL : garder l'ordre/résa même si le
--        compte disparaît — l'attribution devient anonyme, pas la commande). ──
ALTER TABLE public.orders
  ADD CONSTRAINT orders_claimed_by_user_id_fkey
  FOREIGN KEY (claimed_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_claimed_by_user_id_fkey;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_claimed_by_user_id_fkey
  FOREIGN KEY (claimed_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.tickets VALIDATE CONSTRAINT tickets_claimed_by_user_id_fkey;

ALTER TABLE public.table_reservations
  ADD CONSTRAINT table_reservations_claimed_by_user_id_fkey
  FOREIGN KEY (claimed_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.table_reservations VALIDATE CONSTRAINT table_reservations_claimed_by_user_id_fkey;

ALTER TABLE public.cloakroom_transactions
  ADD CONSTRAINT cloakroom_transactions_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.cloakroom_transactions VALIDATE CONSTRAINT cloakroom_transactions_staff_id_fkey;

-- ── 4. Attribution promoteur d'une guest list (SET NULL : la liste survit) ──
ALTER TABLE public.guest_list_entries
  ADD CONSTRAINT guest_list_entries_promoter_id_fkey
  FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.guest_list_entries VALIDATE CONSTRAINT guest_list_entries_promoter_id_fkey;

-- ── 5. Divers liens métier confirmés sans orphelin ──
ALTER TABLE public.owner_recurring_templates
  ADD CONSTRAINT owner_recurring_templates_partner_organizer_id_fkey
  FOREIGN KEY (partner_organizer_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.owner_recurring_templates VALIDATE CONSTRAINT owner_recurring_templates_partner_organizer_id_fkey;

ALTER TABLE public.sms_logs
  ADD CONSTRAINT sms_logs_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.sms_campaigns(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.sms_logs VALIDATE CONSTRAINT sms_logs_campaign_id_fkey;

ALTER TABLE public.guest_claim_otps
  ADD CONSTRAINT guest_claim_otps_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.guest_claim_otps VALIDATE CONSTRAINT guest_claim_otps_order_id_fkey;

-- ── 6. RLS guest_lists : la policy SELECT publique était USING(true) ──────────
-- Trou : tout anonyme pouvait `SELECT * FROM guest_lists` → énumération des
-- share_token (le flux lien-privé passe pourtant par la RPC SECURITY DEFINER
-- get_guest_list_by_token justement pour éviter ça), + lecture cross-tenant des
-- quotas/promoter_id/dj_id de tous les clubs. On remplace par 4 policies scopées.
-- Le front public (GuestListCheckout) filtre déjà is_active + visible_on_club_page,
-- donc aucune régression sur la page club ; le lien privé reste servi par la RPC.
DROP POLICY IF EXISTS "Anyone can view active guest lists" ON public.guest_lists;

CREATE POLICY "Public can view visible active guest lists"
ON public.guest_lists FOR SELECT TO anon, authenticated
USING (is_active = true AND visible_on_club_page = true);

CREATE POLICY "Owners and managers can view their venue guest lists"
ON public.guest_lists FOR SELECT TO authenticated
USING (is_venue_owner(auth.uid(), venue_id) OR can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Promoters can view their own guest list parts"
ON public.guest_lists FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.promoters p
  WHERE p.id = guest_lists.promoter_id AND p.user_id = auth.uid()
));

CREATE POLICY "DJs can view their own guest list parts"
ON public.guest_lists FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.djs d
  WHERE d.id = guest_lists.dj_id AND d.user_id = auth.uid()
));
-- (Les organisateurs conservent leur accès via la policy ALL préexistante
--  "Organizers manage own guest lists" : organizer_user_id = auth.uid().)
