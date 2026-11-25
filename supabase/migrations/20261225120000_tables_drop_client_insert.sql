-- Tables VIP, vague A — P6.3 : plus aucune écriture client directe d'une réservation de table.
--
-- Toute création passe par create-table-checkout (service_role → reserve_table_slot) ou create_manual_table_reservation
-- (SECURITY DEFINER, droits vérifiés). Vérifié par recherche dans src/ et supabase/functions/ le 24/11 : aucun écran ni
-- aucune fonction n'insère dans table_reservations avec un jeton utilisateur. La policy INSERT « Users can create
-- reservations » (pending, user_id = moi) ne servait donc qu'à un client malin : réserver une table à n'importe quel
-- moment sans checkout, en tenant une table et sa capacité de zone sans payer (elle expirait seulement au nettoyage).
-- Les autres policies (lecture, UPDATE pro, super admin ALL) ne bougent pas.

DROP POLICY IF EXISTS "Users can create reservations" ON public.table_reservations;
