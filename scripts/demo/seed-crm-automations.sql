-- ============================================================================
-- Démo Yuno CRM : 7 semaines d'automatisations pour crm@womber.fr, afin que
-- l'écran Automatisations montre ce qu'elles ont envoyé et fait vendre.
-- Rien ne part : les campagnes enfants sont écrites directement en « sent »,
-- avec leurs destinataires, ouvertures et clics, et le registre
-- email_automation_sends (envoyés + écartés) comme le moteur l'aurait tenu.
--
-- Recettes : « Nouvelle soirée » (6 h après la publication), « Dernier appel »
-- (la veille, acheteurs écartés), « Merci d'être venu » (lendemain, personnes
-- scannées), « L'habitué décroche » (6 semaines sans venir), « Reconquête »
-- (mensuelle, mise en pause il y a 12 jours). Heures calmes 23 h → 9 h Paris.
-- Un acheteur des 7 jours qui suivent un envoi clique d'abord (8 fois sur 10),
-- SEULEMENT si aucun e-mail du compte ne lui a déjà attribué ce billet : les
-- résultats des envois manuels (seed-crm-messages.sql) ne bougent pas.
--
-- Rejouable : efface puis recrée les enfants marqués theme_json.seed =
-- 'crm-automations' de CE compte (destinataires et événements en cascade) et
-- vide le registre de ses recettes.
-- Prérequis : seed-crm-demo.sql, seed-crm-messages.sql, seed-crm-automations.ts
--   supabase db query --linked -f scripts/demo/seed-crm-automations.sql
-- ============================================================================

BEGIN;
SET LOCAL statement_timeout = '900s';

-- Allumées depuis 7 semaines ; la reconquête coupée il y a 12 jours. Le
-- trigger d'écriture repose updated_at / enabled_at à now() : coupé
-- (session_replication_role) le temps de ces deux lignes seulement, jamais
-- pendant le reste du semis (les suppressions en cascade en dépendent).
SET session_replication_role = replica;
UPDATE public.email_automations a
   SET enabled = (a.kind <> 'win_back'), enabled_at = now() - interval '49 days',
       updated_at = CASE WHEN a.kind = 'win_back' THEN now() - interval '12 days' ELSE now() - interval '49 days' END
  FROM auth.users u
 WHERE u.id = a.organizer_user_id AND lower(u.email) = 'crm@womber.fr' AND public.is_demo_email(u.email)
   AND a.venue_id IS NULL AND a.template_id IS NOT NULL
   AND a.kind IN ('new_event', 'last_call', 'post_event_thanks', 'regular_lapse', 'win_back');
SET session_replication_role = origin;

DO $seed$
DECLARE
  v_uid uuid;
  v_now timestamptz := now();
  v_on timestamptz := now() - interval '49 days';
  v_pause timestamptz := now() - interval '12 days';
  v_s record;
  v_tpl record;
  v_aid uuid;
  v_cid uuid;
  v_rate numeric;
  v_open int;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  IF NOT public.is_demo_email('crm@womber.fr') OR NOT public.is_demo_marketing_scope(NULL, v_uid) THEN
    RAISE EXCEPTION 'périmètre démo introuvable';
  END IF;

  CREATE TEMP TABLE _sa ON COMMIT DROP AS
    SELECT a.id, a.kind, a.template_id FROM public.email_automations a
     WHERE a.organizer_user_id = v_uid AND a.venue_id IS NULL;
  IF (SELECT count(*) FROM _sa WHERE template_id IS NOT NULL
        AND kind IN ('new_event', 'last_call', 'post_event_thanks', 'regular_lapse', 'win_back')) < 5 THEN
    RAISE EXCEPTION 'recettes non réglées : lancer seed-crm-automations.ts d''abord';
  END IF;

  DELETE FROM public.email_automation_sends WHERE automation_id IN (SELECT id FROM _sa);
  DELETE FROM public.email_campaigns
   WHERE organizer_user_id = v_uid AND venue_id IS NULL AND child_kind = 'automation'
     AND theme_json->>'seed' = 'crm-automations';

  PERFORM public._crm_people_build(NULL, v_uid, NULL);
  CREATE TEMP TABLE _sp ON COMMIT DROP AS
    SELECT p.email, p.first_name, p.last_name, p.added_at FROM _cp p WHERE p.email_ok;
  CREATE TEMP TABLE _st ON COMMIT DROP AS
    SELECT t.id, t.email, t.amount, t.bought_at, t.event_id, t.event_start, t.scanned_at
      FROM public._crm_tickets(NULL, v_uid) t WHERE t.email IS NOT NULL;
  CREATE INDEX ON _st (email, bought_at);
  CREATE INDEX ON _st (email, event_id);
  CREATE INDEX ON _st (email, event_start);
  CREATE INDEX ON _st (event_id);
  CREATE INDEX ON _sp (email);
  ANALYZE _st;
  ANALYZE _sp;
  CREATE TEMP TABLE _se ON COMMIT DROP AS
    SELECT e.id, e.title, e.start_at, COALESCE(e.end_at, e.start_at + interval '8 hours') AS end_at, e.published_at
      FROM public.events e WHERE e.organizer_user_id = v_uid AND e.external_source IS NOT NULL;

  -- ---------------------------------------------------------------- Les envois
  CREATE TEMP TABLE _ss (
    idx serial, kind text, trigger_key text, trigger_event_id uuid, bind_event_id uuid,
    due timestamptz, sent_at timestamptz, label text
  ) ON COMMIT DROP;

  INSERT INTO _ss (kind, trigger_key, trigger_event_id, bind_event_id, due, label)
  SELECT 'new_event', e.id::text, e.id, e.id, e.published_at + interval '6 hours', e.title FROM _se e
  UNION ALL
  SELECT 'last_call', e.id::text, e.id, e.id, e.start_at - interval '24 hours', e.title FROM _se e
  UNION ALL
  SELECT 'post_event_thanks', e.id::text, e.id,
         (SELECT n.id FROM _se n WHERE n.start_at > e.end_at + interval '12 hours' ORDER BY n.start_at LIMIT 1),
         e.end_at + interval '12 hours', e.title FROM _se e
  UNION ALL
  -- 6 semaines après la dernière venue : un lot par soirée quittée.
  SELECT 'regular_lapse', 'rl-' || to_char(e.start_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'), NULL,
         (SELECT n.id FROM _se n WHERE n.start_at > e.start_at + interval '42 days' + interval '24 hours' ORDER BY n.start_at LIMIT 1),
         e.start_at + interval '42 days', NULL FROM _se e
  UNION ALL
  -- Reconquête : premier mardi du mois, 11 h.
  SELECT 'win_back', 'wb-' || to_char(m, 'YYYY-MM'), NULL,
         (SELECT n.id FROM _se n WHERE n.start_at > d.at + interval '24 hours' ORDER BY n.start_at LIMIT 1),
         d.at, NULL
    FROM generate_series(date_trunc('month', v_on), v_now, interval '1 month') m
    CROSS JOIN LATERAL (
      SELECT ((m::date + ((9 - extract(isodow FROM m)::int) % 7)) + time '11:00') AT TIME ZONE 'Europe/Paris' AS at
    ) d;

  UPDATE _ss SET sent_at = CASE
      WHEN extract(hour FROM due AT TIME ZONE 'Europe/Paris') >= 23
        THEN (((due AT TIME ZONE 'Europe/Paris')::date + 1) + time '09:00') AT TIME ZONE 'Europe/Paris'
      WHEN extract(hour FROM due AT TIME ZONE 'Europe/Paris') < 9
        THEN ((due AT TIME ZONE 'Europe/Paris')::date + time '09:00') AT TIME ZONE 'Europe/Paris'
      ELSE due END + interval '3 minutes';
  DELETE FROM _ss WHERE due < v_on OR sent_at > v_now - interval '10 minutes'
     OR (kind = 'win_back' AND sent_at > v_pause);
  UPDATE _ss s SET label = COALESCE(s.label, e.title) FROM _se e WHERE e.id = s.bind_event_id;

  -- ------------------------------------------------------- Les destinataires
  CREATE TEMP TABLE _sr (idx int, email text, first_name text, last_name text, skip text) ON COMMIT DROP;
  CREATE INDEX ON _sr (email, idx);
  CREATE INDEX ON _sr (idx);

  -- Nouvelle soirée : toute la base consentante, sauf qui a déjà sa place.
  INSERT INTO _sr
  SELECT s.idx, p.email, p.first_name, p.last_name,
         CASE WHEN EXISTS (SELECT 1 FROM _st t WHERE t.email = p.email AND t.event_id = s.trigger_event_id AND t.bought_at <= s.due)
              THEN 'bought' END
    FROM _ss s JOIN _sp p ON COALESCE(p.added_at, '-infinity') <= s.due
   WHERE s.kind = 'new_event';
  -- Deux annonces à moins de 48 h : la seconde s'efface (une soirée, un message).
  UPDATE _sr r SET skip = 'cooldown'
    FROM _ss s
   WHERE s.idx = r.idx AND s.kind = 'new_event' AND r.skip IS NULL
     AND EXISTS (SELECT 1 FROM _ss s2 JOIN _sr r2 ON r2.idx = s2.idx
                  WHERE s2.kind = 'new_event' AND s2.sent_at < s.sent_at AND s2.sent_at > s.sent_at - interval '48 hours'
                    AND r2.email = r.email AND r2.skip IS NULL);

  -- Dernier appel : la base, acheteurs écartés ; un peu de pression évitée.
  INSERT INTO _sr
  SELECT s.idx, p.email, p.first_name, p.last_name,
         CASE WHEN EXISTS (SELECT 1 FROM _st t WHERE t.email = p.email AND t.event_id = s.trigger_event_id AND t.bought_at <= s.due)
                THEN 'bought'
              WHEN abs(hashtext(p.email || s.idx::text || 'cd')) % 100 < 12 THEN 'cooldown' END
    FROM _ss s JOIN _sp p ON COALESCE(p.added_at, '-infinity') <= s.due
   WHERE s.kind = 'last_call';

  -- Merci : les personnes scannées à la porte.
  INSERT INTO _sr
  SELECT DISTINCT ON (s.idx, p.email) s.idx, p.email, p.first_name, p.last_name, NULL
    FROM _ss s
    JOIN _st t ON t.event_id = s.trigger_event_id AND t.scanned_at IS NOT NULL
    JOIN _sp p ON p.email = t.email
   WHERE s.kind = 'post_event_thanks';

  -- L'habitué décroche : 3 soirées ou plus en 120 jours, la dernière il y a
  -- 6 semaines, rien acheté depuis.
  INSERT INTO _sr
  SELECT s.idx, p.email, p.first_name, p.last_name, NULL
    FROM _ss s
    JOIN _sp p ON true
   WHERE s.kind = 'regular_lapse'
     AND (SELECT max(t.event_start) FROM _st t WHERE t.email = p.email AND t.bought_at <= s.due AND t.event_start <= s.due)
         = (SELECT e.start_at FROM _se e WHERE s.due = e.start_at + interval '42 days')
     AND (SELECT count(DISTINCT t.event_id) FROM _st t
           WHERE t.email = p.email AND t.event_start <= s.due - interval '42 days'
             AND t.event_start > s.due - interval '162 days') >= 3
     AND NOT EXISTS (SELECT 1 FROM _st t WHERE t.email = p.email AND t.bought_at <= s.due AND t.event_start > s.due);

  -- Reconquête : venus au moins une fois, plus rien depuis 90 jours ; une fois par personne.
  INSERT INTO _sr
  SELECT s.idx, p.email, p.first_name, p.last_name, NULL
    FROM _ss s
    JOIN _sp p ON true
   WHERE s.kind = 'win_back'
     AND (SELECT max(t.event_start) FROM _st t WHERE t.email = p.email AND t.event_start <= s.due) < s.due - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM _st t WHERE t.email = p.email AND t.bought_at <= s.due AND t.event_start > s.due);
  DELETE FROM _sr r USING _ss s
   WHERE s.idx = r.idx AND s.kind = 'win_back'
     AND EXISTS (SELECT 1 FROM _sr r2 JOIN _ss s2 ON s2.idx = r2.idx
                  WHERE s2.kind = 'win_back' AND s2.sent_at < s.sent_at AND r2.email = r.email);

  -- ------------------------------------------------------------- L'écriture
  FOR v_s IN SELECT * FROM _ss ORDER BY sent_at LOOP
    SELECT a.id INTO v_aid FROM _sa a WHERE a.kind = v_s.kind;
    SELECT t.* INTO v_tpl FROM public.email_campaign_templates t JOIN _sa a ON a.template_id = t.id WHERE a.kind = v_s.kind;
    v_cid := NULL;

    IF EXISTS (SELECT 1 FROM _sr r WHERE r.idx = v_s.idx AND r.skip IS NULL) THEN
      INSERT INTO public.email_campaigns (
        organizer_user_id, venue_id, name, type, subject, preheader, blocks_json, blocks_version,
        theme_json, social_links_json, logo_url, event_id, status, sent_at, send_started_at, created_at, created_by,
        audiences_json, exclusions_json, quiet_hours, automation_id, automation_trigger_event_id, child_kind)
      VALUES (
        v_uid, NULL, left(COALESCE(NULLIF(v_tpl.name, ''), v_s.kind) || ' · ' || COALESCE(v_s.label, to_char(v_s.sent_at, 'YYYY-MM')), 80),
        'promotional', COALESCE(NULLIF(v_tpl.subject, ''), v_tpl.name), COALESCE(v_tpl.preheader, ''),
        CASE WHEN v_s.bind_event_id IS NULL THEN public._email_blocks_without_live(v_tpl.blocks_json)
             ELSE COALESCE(v_tpl.blocks_json, '[]'::jsonb) END, 2,
        COALESCE(v_tpl.theme_json, '{}'::jsonb) || jsonb_build_object('seed', 'crm-automations'),
        COALESCE(v_tpl.social_links_json, '{}'::jsonb), v_tpl.logo_url,
        v_s.bind_event_id, 'sent', v_s.sent_at, v_s.sent_at, v_s.sent_at - interval '3 minutes', v_uid,
        '[]'::jsonb, '{}'::jsonb, true, v_aid, v_s.trigger_event_id, 'automation')
      RETURNING id INTO v_cid;

      INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, status, sent_at, created_at)
      SELECT v_cid, r.email, r.first_name, r.last_name,
             CASE WHEN abs(hashtext(r.email || 'b' || v_cid::text)) % 1000 < 1 THEN 'bounced' ELSE 'sent' END,
             v_s.sent_at + make_interval(secs => abs(hashtext(r.email || v_cid::text)) % 240),
             v_s.sent_at - interval '3 minutes'
        FROM _sr r WHERE r.idx = v_s.idx AND r.skip IS NULL;
    END IF;

    INSERT INTO public.email_automation_sends (
      automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
      email, campaign_id, status, skip_reason, due_at, created_at)
    SELECT v_aid, NULL, v_uid, v_s.kind, v_s.trigger_key, v_s.trigger_event_id, v_s.bind_event_id,
           r.email, CASE WHEN r.skip IS NULL THEN v_cid END,
           CASE WHEN r.skip IS NULL THEN 'queued' ELSE 'skipped' END, r.skip, v_s.due, v_s.due
      FROM _sr r WHERE r.idx = v_s.idx
    ON CONFLICT DO NOTHING;

    CONTINUE WHEN v_cid IS NULL;

    v_rate := CASE v_s.kind WHEN 'new_event' THEN 0.10 WHEN 'last_call' THEN 0.08 WHEN 'post_event_thanks' THEN 0.07
                            WHEN 'regular_lapse' THEN 0.16 ELSE 0.06 END;
    v_open := CASE v_s.kind WHEN 'new_event' THEN 400 WHEN 'last_call' THEN 360 WHEN 'post_event_thanks' THEN 520
                            WHEN 'regular_lapse' THEN 480 ELSE 290 END;

    -- Clics : l'acheteur des 7 jours (8 sur 10) dont le billet n'est encore
    -- rattaché à aucun e-mail du compte, puis le taux de la recette chez ceux
    -- qui n'achètent rien dans la semaine.
    WITH r AS (
      SELECT x.email, abs(hashtext(x.email || v_cid::text)) % 1000 AS h,
             (SELECT min(t.bought_at) FROM _st t
               WHERE t.email = x.email AND t.bought_at > v_s.sent_at + interval '30 minutes'
                 AND t.bought_at < v_s.sent_at + interval '7 days'
                 AND NOT EXISTS (SELECT 1 FROM public.email_campaign_events ev
                                   JOIN public.email_campaigns c ON c.id = ev.campaign_id
                                  WHERE c.organizer_user_id = v_uid AND c.venue_id IS NULL AND c.status = 'sent'
                                    AND ev.event_type = 'clicked' AND lower(ev.recipient_email) = t.email
                                    AND ev.created_at <= t.bought_at AND ev.created_at > t.bought_at - interval '7 days')) AS buy,
             EXISTS (SELECT 1 FROM _st t WHERE t.email = x.email
                       AND t.bought_at > v_s.sent_at AND t.bought_at < v_s.sent_at + interval '8 days') AS bought_week
        FROM public.email_campaign_recipients x WHERE x.campaign_id = v_cid AND x.status = 'sent'
    ), k AS (
      SELECT r.email,
             CASE WHEN r.buy IS NOT NULL THEN v_s.sent_at + (r.buy - v_s.sent_at) * (0.15 + (r.h % 60) / 100.0)
                  ELSE v_s.sent_at + make_interval(mins => 4 + r.h % 1500) END AS at,
             CASE WHEN r.buy IS NULL AND r.h % 4 = 0 THEN 'https://www.instagram.com/yunoapp.fr'
                  ELSE 'https://yunoapp.eu/l/democrm?yc=' || v_cid END AS link
        FROM r
       WHERE (r.buy IS NOT NULL AND r.h < 800) OR (NOT r.bought_week AND r.h < v_rate * 1000)
    )
    INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, created_at, metadata)
    SELECT v_cid, k.email, e.t, CASE WHEN e.t = 'opened' THEN k.at - interval '2 minutes' ELSE k.at END,
           CASE WHEN e.t = 'clicked' THEN jsonb_build_object('click', jsonb_build_object('link', k.link)) ELSE '{}'::jsonb END
      FROM k CROSS JOIN (VALUES ('opened'), ('clicked')) AS e(t);

    -- Ouvertures sans clic.
    INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, created_at, metadata)
    SELECT v_cid, x.email, 'opened', v_s.sent_at + make_interval(mins => 3 + abs(hashtext(x.email || 'o' || v_cid::text)) % 900), '{}'::jsonb
      FROM public.email_campaign_recipients x
     WHERE x.campaign_id = v_cid AND x.status = 'sent'
       AND abs(hashtext(x.email || 'o' || v_cid::text)) % 1000 < v_open
       AND NOT EXISTS (SELECT 1 FROM public.email_campaign_events ev
                        WHERE ev.campaign_id = v_cid AND ev.recipient_email = x.email AND ev.event_type = 'opened');

    UPDATE public.email_campaigns c
       SET recipients_count = s.n, total_recipients = s.n, delivered_count = s.n - s.b,
           opens_count = s.o, clicks_count = s.k, clickers_count = s.k
      FROM (SELECT (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = v_cid) AS n,
                   (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = v_cid AND status = 'bounced') AS b,
                   (SELECT count(DISTINCT recipient_email) FROM public.email_campaign_events WHERE campaign_id = v_cid AND event_type = 'opened') AS o,
                   (SELECT count(DISTINCT recipient_email) FROM public.email_campaign_events WHERE campaign_id = v_cid AND event_type = 'clicked') AS k) s
     WHERE c.id = v_cid;
  END LOOP;
END
$seed$;

COMMIT;
