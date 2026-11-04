-- Accès assisté par l'agent (Claude Code) — 2026-11-03.
--
-- Paul veut pouvoir dire, depuis le chat, « mets à jour cet e-mail de 3AM avec
-- ce design et cette audience », sans que l'agent clique dans un navigateur.
-- L'agent passe donc par le MÊME accès assisté que Paul : une session GoTrue
-- du pro, ouverte seulement sur un grant ACTIF approuvé par lui, enregistrée
-- dans admin_support_sessions — donc soumise à tous les verrous existants
-- (argent, identité, 2FA, suppression). Rien de nouveau n'est accordé.
--
-- Ce fichier ne fait que DISTINGUER ces sessions : qui l'a ouverte (Console ou
-- agent), et la référence de la conversation Claude qui l'a ouverte. Le journal
-- des gestes reste admin_support_audit (detail.via = 'agent').
-- Outil : scripts/support/agent.mjs.

ALTER TABLE public.admin_support_sessions
  ADD COLUMN IF NOT EXISTS opened_via text NOT NULL DEFAULT 'console',
  ADD COLUMN IF NOT EXISTS agent_ref text;

DO $$ BEGIN
  ALTER TABLE public.admin_support_sessions
    ADD CONSTRAINT admin_support_sessions_opened_via_chk CHECK (opened_via IN ('console', 'agent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.admin_support_sessions.opened_via IS
  'console = « Voir sa Console » du super admin ; agent = scripts/support/agent.mjs (Claude Code), mêmes verrous.';
COMMENT ON COLUMN public.admin_support_sessions.agent_ref IS
  'Référence de la conversation Claude qui a ouvert la session (agent seulement).';
