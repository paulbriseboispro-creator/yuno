-- guest_claim_otps.order_id est polymorphe : une commande de boissons, un billet
-- ou une réservation de table. La migration 20260613060000 avait retiré la clé
-- étrangère vers orders(id) pour cette raison ; 20260704120000 l'a remise, ce qui
-- fait échouer l'INSERT du code (violation de clé) pour tout billet ou toute
-- table : le client reçoit un code par e-mail qui n'existe pas en base.
-- Le nettoyage que la cascade faisait est déjà assuré par la purge RGPD (24 h).
ALTER TABLE public.guest_claim_otps
  DROP CONSTRAINT IF EXISTS guest_claim_otps_order_id_fkey;
