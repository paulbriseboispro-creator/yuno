-- Durcissement Stripe des co-soirées (revue du 29/09, point 3).
--
--  • revenue_distributions.refunded_cents : remboursements DÉJÀ appliqués aux
--    jambes (cumul Stripe `amount_refunded`). Un remboursement partiel réduit
--    une jambe retenue au prorata du DELTA et un second remboursement reverse sa
--    part d'une jambe déjà versée — avant, le premier partiel annulait toute la
--    jambe retenue (les billets restants disparaissaient du partage) et le
--    second n'était jamais reversé. La colonne sert aussi de verrou optimiste :
--    deux livraisons du même `charge.refunded` n'appliquent le delta qu'une fois.
--  • primary/secondary_fail_count : échecs de libération d'une jambe. Le cron
--    retente à chaque passage ; au 3e échec, une alerte super admin part (une
--    seule fois par jambe, dedup_key) au lieu d'un silence éternel.
ALTER TABLE public.revenue_distributions
  ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_fail_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS secondary_fail_count integer NOT NULL DEFAULT 0;

-- Les fonctions edge (service_role) émettent les alertes d'exploitation Stripe.
GRANT EXECUTE ON FUNCTION public.emit_admin_notification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID)
  TO service_role;
