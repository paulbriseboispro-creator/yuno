-- ============================================================================
-- Démo Yuno CRM : des envois d'e-mails passés pour crm@womber.fr, afin que
-- Segments, l'accueil (bilan du dernier envoi) et les analyses montrent des
-- clics et des ventes attribuées. Rien ne part : les lignes sont écrites
-- directement en statut « sent », avec leurs ouvertures et leurs clics.
--
-- Rejouable : efface puis recrée les campagnes marquées theme_json.seed =
-- 'crm-messages' de CE compte (destinataires et événements partent en
-- cascade). Destinataires = membres joignables par e-mail du segment visé
-- (adresses @example.com du semis seed-crm-demo.sql). Un acheteur dans les
-- 7 jours qui suivent l'envoi clique d'abord (8 fois sur 10) : c'est ce clic
-- qui lui attribue sa place.
-- Heures, modèles et objets variés (dont certains au prénom) : l'écran
-- Analyse a de quoi comparer. Quelques adresses en erreur et désinscriptions.
-- Le contenu (blocs du Studio) se pose ensuite par seed-crm-email-content.ts.
-- Prérequis : seed-crm-demo.sql
--   supabase db query --linked -f scripts/demo/seed-crm-messages.sql
-- ============================================================================

DO $seed$
DECLARE
  v_uid uuid;
  v_c record;
  v_cid uuid;
  v_sent timestamptz;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  IF NOT public.is_demo_email('crm@womber.fr') THEN RAISE EXCEPTION 'périmètre démo introuvable'; END IF;

  DELETE FROM public.email_campaigns
   WHERE organizer_user_id = v_uid AND venue_id IS NULL AND theme_json->>'seed' = 'crm-messages';

  PERFORM public._crm_people_build(NULL, v_uid, NULL);
  DROP TABLE IF EXISTS _seed_t;
  CREATE TEMP TABLE _seed_t ON COMMIT DROP AS
    SELECT t.email, t.bought_at FROM public._crm_tickets(NULL, v_uid) t;

  FOR v_c IN
    SELECT * FROM (VALUES
      ('2026-06-02'::date, 18, 'Afro House Club #13 : le line-up', 'Afro House Club #13 : le line-up est tombé', 'lineup', 'occ', 0.12),
      ('2026-06-23'::date, 12, 'Prévente Techno Bunker #14', '{{prénom}}, la prévente Techno Bunker ouvre', 'annonce', 'hab', 0.30),
      ('2026-07-07'::date, 10, 'Vous nous manquez', 'Vous nous manquez, {{prénom}}', 'manque', 'end', 0.05),
      ('2026-07-18'::date, 16, 'Disco Fever #15 : dernières places', 'Disco Fever #15 : les dernières places partent ce soir, ne traînez pas', 'lastcall', 'all', 0.13),
      ('2026-08-01'::date, 14, 'Open Air Closing #16 : on vous attend', 'Open Air Closing #16 : on vous attend', 'annonce', 'nou', 0.18),
      ('2026-08-16'::date, 20, 'Rooftop Sunset #17 : le line-up', '{{prénom}}, le line-up du Rooftop Sunset', 'lineup', 'hab', 0.32),
      ('2026-08-30'::date, 18, 'Deep Night #18 : invitation', 'Deep Night #18 : votre invitation', 'annonce', 'occ', 0.14),
      ('2026-09-13'::date, 12, 'Bass Culture #19 : prévente', 'Prévente Bass Culture #19 : 48 h seulement pour les habitués, avant tout le monde', 'annonce', 'hab', 0.34),
      ('2026-09-16'::date, 10, 'Bienvenue dans la famille', 'Bienvenue dans la famille, {{prénom}}', 'bienvenue', 'nou', 0.20),
      ('2026-09-24'::date, 18, 'Minimal Room #20 : billetterie ouverte', 'Minimal Room #20 : la billetterie est ouverte', 'annonce', 'all', 0.15),
      ('2026-09-28'::date, 20, 'On ne vous a pas vus depuis un moment', 'On ne vous a pas vus depuis un moment', 'manque', 'end', 0.06),
      ('2026-10-01'::date, 18, 'Minimal Room #20 : le line-up', 'Minimal Room #20 : le line-up', 'lineup', 'hab', 0.36)
    ) AS x(d, hr, name, subject, kind, seg, rate)
    WHERE x.d < (now() AT TIME ZONE 'Europe/Paris')::date
  LOOP
    v_sent := (v_c.d + make_time(v_c.hr, 0, 0)) AT TIME ZONE 'Europe/Paris';
    INSERT INTO public.email_campaigns (
      organizer_user_id, venue_id, name, subject, template_kind, type, status, sent_at, send_started_at, created_at, created_by,
      blocks_version, audiences_json, theme_json)
    VALUES (
      v_uid, NULL, v_c.name, v_c.subject, v_c.kind, 'promotional', 'sent', v_sent, v_sent, v_sent - interval '1 day', v_uid,
      2, jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', v_c.seg, 'f', '{}'::jsonb))),
      jsonb_build_object('seed', 'crm-messages'))
    RETURNING id INTO v_cid;

    INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, status, sent_at, created_at)
    SELECT v_cid, p.email, p.first_name, p.last_name,
           -- Quelques adresses en erreur (moins de 1 %), comme dans la vraie vie.
           CASE WHEN abs(hashtext(p.email || 'b' || v_c.d::text)) % 1000 < 7 THEN 'bounced' ELSE 'sent' END,
           v_sent, v_sent
      FROM _cp p
     WHERE p.email_ok AND (v_c.seg = 'all' OR p.lifecycle = v_c.seg);

    -- Clics : l'acheteur des 7 jours suivants (8 sur 10), puis le taux du segment.
    WITH r AS (
      SELECT x.email,
             (SELECT min(t.bought_at) FROM _seed_t t
               WHERE t.email = x.email AND t.bought_at > v_sent + interval '30 minutes' AND t.bought_at < v_sent + interval '7 days') AS buy,
             abs(hashtext(x.email || v_cid::text)) % 1000 AS h
        FROM public.email_campaign_recipients x WHERE x.campaign_id = v_cid AND x.status = 'sent'
    ), k AS (
      SELECT r.email, r.h,
             CASE WHEN r.buy IS NOT NULL THEN v_sent + (r.buy - v_sent) * (0.15 + (r.h % 60) / 100.0)
                  ELSE v_sent + make_interval(mins => 4 + r.h % 1500) END AS at,
             CASE WHEN r.buy IS NULL AND r.h % 4 = 0 THEN 'https://www.instagram.com/yunoapp.fr'
                  ELSE 'https://yunoapp.eu/l/democrm?yc=' || v_cid END AS link
        FROM r
       WHERE (r.buy IS NOT NULL AND r.h < 800) OR (r.buy IS NULL AND r.h < v_c.rate * 1000)
    )
    INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, created_at, metadata)
    SELECT v_cid, k.email, e.t, CASE WHEN e.t = 'opened' THEN k.at - interval '2 minutes' ELSE k.at END,
           CASE WHEN e.t = 'clicked' THEN jsonb_build_object('click', jsonb_build_object('link', k.link)) ELSE '{}'::jsonb END
      FROM k CROSS JOIN (VALUES ('opened'), ('clicked')) AS e(t);

    -- Ouvertures sans clic.
    INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, created_at, metadata)
    SELECT v_cid, x.email, 'opened', v_sent + make_interval(mins => 3 + abs(hashtext(x.email || 'o' || v_cid::text)) % 900), '{}'::jsonb
      FROM public.email_campaign_recipients x
     WHERE x.campaign_id = v_cid AND x.status = 'sent'
       -- Un objet au prénom s'ouvre davantage, un objet trop long moins.
       AND abs(hashtext(x.email || 'o' || v_cid::text)) % 1000
           < 380 + CASE WHEN v_c.subject LIKE '%{{%' THEN 70 ELSE 0 END - CASE WHEN char_length(v_c.subject) > 45 THEN 70 ELSE 0 END
       AND NOT EXISTS (SELECT 1 FROM public.email_campaign_events ev
                        WHERE ev.campaign_id = v_cid AND ev.recipient_email = x.email AND ev.event_type = 'opened');

    UPDATE public.email_campaigns c
       SET recipients_count = s.n, total_recipients = s.n, delivered_count = s.n - s.b,
           opens_count = s.o, clicks_count = s.k, clickers_count = s.k,
           unsubscribes_count = (s.n * 0.003)::int
      FROM (SELECT (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = v_cid) AS n,
                   (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = v_cid AND status = 'bounced') AS b,
                   (SELECT count(DISTINCT recipient_email) FROM public.email_campaign_events WHERE campaign_id = v_cid AND event_type = 'opened') AS o,
                   (SELECT count(DISTINCT recipient_email) FROM public.email_campaign_events WHERE campaign_id = v_cid AND event_type = 'clicked') AS k) s
     WHERE c.id = v_cid;
  END LOOP;

  -- Chaque envoi relié à la soirée qu'il nomme (comme seed-crm-nights.sql).
  UPDATE public.email_campaigns c SET event_id = e.id
    FROM public.events e
   WHERE c.organizer_user_id = v_uid AND c.venue_id IS NULL AND c.theme_json->>'seed' = 'crm-messages'
     AND e.organizer_user_id = v_uid AND e.external_source IS NOT NULL
     AND c.name LIKE '%' || e.title || '%';
END
$seed$;
