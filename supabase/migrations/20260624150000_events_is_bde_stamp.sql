-- =====================================================================
-- Offre BDE — étape 2/3 : signal `events.is_bde` (anti-altération)
-- =====================================================================
-- Le prix s'affiche côté acheteur (front) ET se charge côté serveur (edge fn),
-- et un acheteur anonyme ne peut pas lire `organizer_profiles`. On stampe donc
-- sur chaque event un booléen `is_bde`, source unique pour le front comme pour
-- le back. La valeur est calculée par le trigger evaluate_event_discoverability
-- (réécrit à l'étape 3) à partir de organizer_profiles.bde_verified, jamais
-- depuis le payload client : un owner/orga ne peut pas se l'auto-attribuer pour
-- obtenir un plancher réduit.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_bde boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.is_bde IS
  'Stampé par evaluate_event_discoverability : true si l''organisateur (organizer_user_id) est bde_verified. Pilote le plancher de commission réduit et la confidentialité par défaut. Ne jamais faire confiance au payload client pour cette colonne.';

-- Backfill des events existants depuis le flag de l'organisateur. (No-op tant
-- qu'aucun organisateur n'est encore bde_verified, mais correct pour la suite.)
UPDATE public.events e
SET is_bde = true
FROM public.organizer_profiles op
WHERE e.organizer_user_id = op.user_id
  AND op.bde_verified = true
  AND e.is_bde = false;

-- Index partiel : les requêtes "events BDE" sont rares et ciblées.
CREATE INDEX IF NOT EXISTS idx_events_is_bde ON public.events(is_bde) WHERE is_bde = true;
