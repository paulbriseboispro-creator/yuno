-- Historique d'envois FICTIF pour la démo email (2026-09-27).
--
-- À jouer APRÈS seed-demo-contacts.mjs. Sans historique, les 1 200 contacts
-- fictifs sont tous « nouveaux » : ni actifs, ni silencieux, et la
-- segmentation intelligente n'a rien à proposer sur l'engagement. On pose
-- donc, pour le club womber et pour organizer@womber.fr :
--   • les destinataires des campagnes démo DÉJÀ au statut « envoyée » ;
--   • deux campagnes récentes (J-20 et J-5) montées sur les modèles Yuno ;
--   • ouvertures et clics tirés d'une « appétence » stable par contact
--     (md5 de l'email) : certains ouvrent tout, d'autres jamais ;
--   • ~1 % de désabonnés sur la dernière campagne.
-- RIEN n'est envoyé : ce sont des lignes en base, sur des adresses
-- @example.* (non routables), dans un périmètre où tout envoi est refusé
-- (demo_no_send). Aucune ligne dans email_suppressions.
--
-- Rejouable : efface d'abord ses propres lignes (adresses @example.* des
-- campagnes du périmètre démo), puis les recrée.

BEGIN;

CREATE TEMP TABLE _scope ON COMMIT DROP AS
  SELECT 'womber'::text AS venue_id, NULL::uuid AS org_id, 'club'::text AS k
  UNION ALL
  SELECT NULL, (SELECT id FROM auth.users WHERE email = 'organizer@womber.fr'), 'org';

-- ─── 1. Deux campagnes récentes par portée (ids fixes = rejouable) ──────────
CREATE TEMP TABLE _new(id uuid, k text, name text, subject text, days int, tpl_name text) ON COMMIT DROP;
INSERT INTO _new VALUES
  ('00000000-de00-4000-8000-000000000101', 'club', 'Rentrée au club — programme de septembre', 'La rentrée est là, {{prénom}} : tout le programme', 20, 'Nouvelle soirée'),
  ('00000000-de00-4000-8000-000000000102', 'club', 'Ce week-end : tables VIP', 'Plus que quelques tables pour samedi', 5, 'Dernier appel'),
  ('00000000-de00-4000-8000-000000000201', 'org',  'Line-up dévoilé', 'Le line-up est tombé, {{prénom}}', 20, 'Nouvelle soirée'),
  ('00000000-de00-4000-8000-000000000202', 'org',  'Dernières places — samedi', 'Dernières places pour samedi', 5, 'Dernier appel');

INSERT INTO public.email_campaigns
  (id, venue_id, organizer_user_id, name, subject, preheader, type, status, sent_at,
   blocks_json, blocks_version, theme_json, social_links_json, logo_url, event_id, audience_type)
SELECT n.id, s.venue_id, s.org_id, n.name, n.subject, coalesce(t.preheader, ''), 'promotional', 'sent',
       now() - make_interval(days => n.days),
       coalesce(t.blocks_json, '[]'::jsonb), 2, coalesce(t.theme_json, '{}'::jsonb),
       coalesce(t.social_links_json, '{}'::jsonb), t.logo_url,
       (SELECT e.id FROM public.events e
         WHERE e.status = 'active' AND e.start_at >= now()
           AND (e.venue_id = s.venue_id OR e.organizer_user_id = s.org_id)
         ORDER BY e.start_at LIMIT 1),
       'all_subscribers'
  FROM _new n
  JOIN _scope s ON s.k = n.k
  LEFT JOIN LATERAL (
    SELECT * FROM public.email_campaign_templates t
     WHERE t.name = n.tpl_name
       AND (t.venue_id = s.venue_id OR t.organizer_user_id = s.org_id)
     ORDER BY t.created_at LIMIT 1) t ON true
ON CONFLICT (id) DO UPDATE SET sent_at = EXCLUDED.sent_at, status = 'sent';

-- ─── 2. Les campagnes envoyées du périmètre démo ────────────────────────────
CREATE TEMP TABLE _camp ON COMMIT DROP AS
  SELECT c.id, c.sent_at, s.venue_id, s.org_id,
         row_number() OVER (PARTITION BY s.k ORDER BY c.sent_at DESC) AS recency
    FROM public.email_campaigns c
    JOIN _scope s ON (c.venue_id = s.venue_id OR c.organizer_user_id = s.org_id)
   WHERE c.status = 'sent' AND c.sent_at IS NOT NULL
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL;

DELETE FROM public.email_campaign_events ev USING _camp c
 WHERE ev.campaign_id = c.id AND (ev.recipient_email LIKE '%@example.%' OR ev.recipient_email LIKE '%•%');
DELETE FROM public.email_campaign_recipients r USING _camp c
 WHERE r.campaign_id = c.id AND (r.email LIKE '%@example.%' OR r.email LIKE '%•%');

-- ─── 3. Destinataires : abonnés fictifs déjà là au moment de l'envoi ────────
CREATE TEMP TABLE _rcpt ON COMMIT DROP AS
  SELECT c.id AS campaign_id, c.sent_at, c.recency, ns.email, ns.first_name, ns.last_name, ns.unsubscribe_token,
         -- appétence stable par contact, tirage propre à chaque campagne
         (('x' || substr(md5(ns.email), 1, 8))::bit(32)::bigint / 4294967296.0) AS appetite,
         (('x' || substr(md5(ns.email || c.id::text), 1, 8))::bit(32)::bigint / 4294967296.0) AS roll,
         (('x' || substr(md5(c.id::text || ns.email), 1, 8))::bit(32)::bigint / 4294967296.0) AS roll2
    FROM _camp c
    JOIN public.newsletter_subscriptions ns
      ON (ns.venue_id = c.venue_id OR ns.organizer_user_id = c.org_id)
     AND (ns.email LIKE '%@example.%' OR ns.email LIKE '%•%')
    JOIN public.imported_contacts ic
      ON lower(ic.email) = lower(ns.email)
     AND (ic.venue_id = c.venue_id OR ic.organizer_user_id = c.org_id)
   -- le registre de consentement fait foi (comme un vrai envoi), pas la colonne du fichier
   WHERE (ns.opted_in OR ns.opted_out_at >= c.sent_at)
     AND coalesce(ic.added_at, c.sent_at) <= c.sent_at;

INSERT INTO public.email_campaign_recipients
  (campaign_id, email, first_name, last_name, unsubscribe_token, status, sent_at, attempts, resend_email_id)
SELECT campaign_id, email, first_name, last_name, unsubscribe_token, 'sent', sent_at, 1,
       'seed.' || md5(campaign_id::text || email)
  FROM _rcpt;

-- ouvre si le tirage passe sous l'appétence ; clique pour une partie des ouvreurs
CREATE TEMP TABLE _ev ON COMMIT DROP AS
  SELECT r.*, (r.roll < 0.08 + 0.62 * r.appetite) AS opened,
         (r.roll < 0.08 + 0.62 * r.appetite AND r.roll2 < 0.04 + 0.36 * r.appetite) AS clicked
    FROM _rcpt r;

INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, resend_email_id, metadata, created_at)
SELECT campaign_id, email, 'sent', 'seed.' || md5(campaign_id::text || email), '{}'::jsonb, sent_at FROM _ev
UNION ALL
SELECT campaign_id, email, 'delivered', 'seed.' || md5(campaign_id::text || email), '{}'::jsonb, sent_at + interval '20 seconds' FROM _ev
UNION ALL
SELECT campaign_id, email, 'opened', 'seed.' || md5(campaign_id::text || email), '{}'::jsonb,
       sent_at + make_interval(mins => (roll * 2880)::int) FROM _ev WHERE opened
UNION ALL
SELECT campaign_id, email, 'clicked', 'seed.' || md5(campaign_id::text || email),
       jsonb_build_object('click', jsonb_build_object('link',
         CASE WHEN roll2 < 0.02 + 0.2 * appetite THEN 'https://yunoapp.eu/event?utm_source=newsletter'
              ELSE 'https://yunoapp.eu/tables?utm_source=newsletter' END)),
       sent_at + make_interval(mins => (roll * 2880)::int + 3) FROM _ev WHERE clicked;

-- ─── 4. Quelques désabonnés, sur la dernière campagne de chaque portée ──────
UPDATE public.newsletter_subscriptions ns
   SET opted_in = false, opted_out_at = e.sent_at + interval '2 hours'
  FROM _ev e
 WHERE e.recency = 1 AND e.roll2 > 0.988 AND lower(ns.email) = lower(e.email)
   AND (ns.email LIKE '%@example.%' OR ns.email LIKE '%•%');

-- ─── 5. Compteurs des campagnes = ce qui vient d'être posé ──────────────────
UPDATE public.email_campaigns c
   SET recipients_count = x.n, delivered_count = x.n, opens_count = x.o,
       clicks_count = x.cl, clickers_count = x.cl, unsubscribes_count = x.u,
       bounced_count = 0, complained_count = 0, failed_count = 0
  FROM (SELECT campaign_id, count(*) n, count(*) FILTER (WHERE opened) o,
               count(*) FILTER (WHERE clicked) cl,
               count(*) FILTER (WHERE recency = 1 AND roll2 > 0.988) u
          FROM _ev GROUP BY campaign_id) x
 WHERE c.id = x.campaign_id;

COMMIT;

-- Puis, pour chaque portée : SELECT public.refresh_contact_engagement('womber', NULL);
-- et refresh_contact_engagement(NULL, <organizer@womber.fr>) — en service_role,
-- ou « Actualiser » dans la page Contacts.
