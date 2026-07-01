-- Système d'agence autonome — Phase 1 (1/4) : nouveau rôle applicatif `agency`.
-- Une agence est un tenant autonome (compte propre) qui gère un groupe de
-- promoteurs et contracte avec plusieurs clubs / organisateurs.
--
-- ADD VALUE doit être committé avant toute utilisation → fichier de migration
-- dédié (le push CLI exécute chaque fichier dans sa propre transaction).

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'agency';
