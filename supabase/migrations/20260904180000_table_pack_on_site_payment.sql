-- =============================================================================
-- Tables VIP « règlement sur place » : réserver sans payer via Yuno.
--
-- Cas d'usage (WOH × La Nuit, 11/09) : le lieu ne veut pas encore encaisser
-- via Yuno. Les tables sont proposées sur la page de la soirée, le client
-- réserve (nom, téléphone, email, nombre de personnes, table sur le plan), et
-- tout se règle au club. Aucun acompte, aucun compte Stripe requis, aucune
-- commission — la réservation est confirmée immédiatement (statut 'paid',
-- acompte 0, frais 0), l'organisateur l'exporte pour le club.
--
--   • table_packs.payment_mode        : 'online' (acompte/total via Yuno, défaut)
--                                       ou 'on_site' (rien à payer en ligne).
--   • table_reservations.payment_mode : trace du chemin ('online' | 'on_site'),
--     lue par les exports (« Règlement sur place ») et les rapports.
-- Le checkout serveur (create-table-checkout) est la seule porte : un pack
-- 'on_site' ne crée jamais de session Stripe, un pack 'online' ne passe jamais
-- sans compte Stripe actif.
-- =============================================================================

ALTER TABLE public.table_packs
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'online';
ALTER TABLE public.table_packs
  DROP CONSTRAINT IF EXISTS table_packs_payment_mode_check,
  ADD CONSTRAINT table_packs_payment_mode_check CHECK (payment_mode IN ('online', 'on_site'));

ALTER TABLE public.table_reservations
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'online';
ALTER TABLE public.table_reservations
  DROP CONSTRAINT IF EXISTS table_reservations_payment_mode_check,
  ADD CONSTRAINT table_reservations_payment_mode_check CHECK (payment_mode IN ('online', 'on_site', 'manual'));

-- Les réservations posées à la main par le pro sont déjà « hors ligne ».
UPDATE public.table_reservations SET payment_mode = 'manual'
 WHERE purchase_source IN ('manual', 'manual_open') AND payment_mode = 'online';
