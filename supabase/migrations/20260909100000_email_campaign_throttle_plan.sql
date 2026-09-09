-- Lissage intelligent de l'envoi (écran Planification de l'Email Studio).
--
-- Jusqu'ici « Lisser le débit » posait un plafond fixe et invisible de
-- 1 000 emails par heure glissante. Le lissage devient un PLAN choisi par le
-- pro et montré à l'écran avant l'envoi :
--   · sur une heure      → 4 vagues, une par quart d'heure ;
--   · sur la journée     → une vague par heure jusqu'à 23 h ;
--   · sur plusieurs jours → une vague par heure, N jours de suite.
--
-- Trois colonnes, deux lues par le worker :
--   throttle_per_hour        plafond d'envois PAR FENÊTRE glissante. Le nom
--                            reste pour la compat (fenêtre de 60 min par défaut,
--                            donc « par heure » dans le cas courant).
--   throttle_window_minutes  taille de la fenêtre : 15 (« sur une heure »),
--                            30 ou 60 (journée / plusieurs jours).
--   throttle_plan            le choix du pro, pour rouvrir l'écran tel quel :
--                            {"mode":"hour"|"day"|"days","days":n,"custom":bool}.
--                            Donnée d'écran : send-campaign ne la lit jamais.
--
-- Plancher abaissé de 50 à 10 : « sur une heure » pour 120 contacts, c'est
-- 30 emails par quart d'heure, et c'est un réglage légitime.

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS throttle_window_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS throttle_plan jsonb;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_throttle_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_throttle_check
  CHECK (throttle_per_hour IS NULL OR throttle_per_hour >= 10);

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_throttle_window_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_throttle_window_check
  CHECK (throttle_window_minutes IN (15, 30, 60));

COMMENT ON COLUMN public.email_campaigns.throttle_per_hour IS
  'Plafond d''envois par fenêtre glissante de throttle_window_minutes (NULL = pas de lissage).';
COMMENT ON COLUMN public.email_campaigns.throttle_window_minutes IS
  'Fenêtre glissante du lissage : 15 (sur une heure), 30 ou 60 (journée, plusieurs jours).';
COMMENT ON COLUMN public.email_campaigns.throttle_plan IS
  'Plan de lissage choisi à l''écran ({mode, days, custom}) — jamais lu par le worker.';
