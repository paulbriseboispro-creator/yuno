-- ============================================================================
-- Quiz de goût — dimensions comportementales (remplace « énergie »)
-- ============================================================================
-- La 2e question « énergie » avait peu de valeur. On la remplace par 3 signaux
-- concrets et commercialement utiles (segmentation, ciblage VIP, cadence) :
--   frequency    : à quelle fréquence l'user sort (low/weekly/often/always)
--   budget       : dépense par soirée (budget/mid/high/vip)
--   booking_pref : billets vs tables VIP (tickets/tables/both)
-- Ces valeurs enrichissent le texte embeddé (taste-embeddings.ts) et servent de
-- segments. La colonne `energy` reste (inutilisée) pour ne rien casser.

ALTER TABLE public.user_taste_profiles
  ADD COLUMN IF NOT EXISTS frequency    text,
  ADD COLUMN IF NOT EXISTS budget       text,
  ADD COLUMN IF NOT EXISTS booking_pref text;
