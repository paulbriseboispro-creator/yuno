-- VIP table packs : heure d'arrivée limite (optionnelle).
-- Quand elle est renseignée (HH:MM, 24 h, heure locale du club), le flux de
-- réservation client affiche « Arrivée avant <heure> » pour que les clients ne
-- puissent pas arriver arbitrairement tard et monopoliser une table toute la nuit.
-- NULL = pas de limite pour ce pack (valeur par défaut, paramètre totalement optionnel).
ALTER TABLE public.table_packs
  ADD COLUMN IF NOT EXISTS arrival_deadline text
  CONSTRAINT table_packs_arrival_deadline_format
  CHECK (arrival_deadline IS NULL OR arrival_deadline ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

COMMENT ON COLUMN public.table_packs.arrival_deadline IS
  'Heure d''arrivée limite optionnelle (HH:MM, 24 h, heure locale du club). NULL = pas de limite. Affichée sur le flux de réservation client.';
