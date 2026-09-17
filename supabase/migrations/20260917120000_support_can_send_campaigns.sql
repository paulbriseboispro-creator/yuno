-- Envoi de campagne DEPUIS une session support (décision de lancement)
-- ============================================================================
--
-- Suite de `20260915170000_support_can_import_contacts.sql`, même raison et
-- même échéance. Le support pouvait déjà REMPLIR la base d'un pro ; il ne
-- pouvait pas appuyer sur « envoyer ». Les premiers clients ne veulent pas
-- encore toucher à l'outil eux-mêmes, et une campagne que personne n'envoie ne
-- prouve rien — ni au client, ni à nous.
--
-- Ce qui ne bouge pas : le registre de consentement, la politique d'envoi
-- (`email_send_policy`), le disjoncteur plaintes/bounces, le warm-up et les
-- quotas. Le support appuie sur un bouton ; il ne contourne aucune règle.
--
-- Ce que ça coûte, et comment on le paie. La session support est celle DU PRO :
-- sans marqueur, le rapport de campagne dirait qu'il a envoyé lui-même, et
-- c'est faux. D'où deux traces, comme pour l'import :
--   1. `email_campaigns.sent_via_support`, posé par `send-campaign` au moment
--      où la file est constituée,
--   2. une ligne `admin_support_audit` d'action `campaign_send`, qui nomme
--      l'admin réel, la session et le grant.
--
-- Pas de trigger d'audit sur `email_campaigns` : l'Email Studio enregistre à
-- chaque frappe, un trigger AFTER UPDATE noierait le journal d'accès assisté
-- sous les autosaves. C'est l'edge qui écrit la ligne, une fois, à l'envoi.
--
-- À RETIRER après le lancement : remettre le refus `support_session_forbidden`
-- en tête du mode 'send' de `send-campaign`. La colonne et les lignes d'audit
-- déjà écrites restent.

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS sent_via_support boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.email_campaigns.sent_via_support IS
  'Envoi déclenché par le support Yuno dans une session assistée (la session est celle du pro).';
