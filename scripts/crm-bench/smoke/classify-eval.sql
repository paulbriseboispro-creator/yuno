-- Jeu d'évaluation du classement des clics et de la minimisation (annulé par rehearse.mjs).
-- Chaque cas reprend un schéma OBSERVÉ (3AM × Act III, WOH, partage de lien) ; les attendus sont
-- ceux de la règle : « de personne » (clicked) ou « automatique » (auto_click), clic par clic.
-- Vérité terrain : seulement les acheteurs connus ; les autres cas sont des schémas, pas des étiquettes.
DO $$
DECLARE
  cid uuid := gen_random_uuid();
  t0 timestamptz := now() - interval '2 hours';
  SG text := 'https://shotgun.live/events/x?ids=1&utm_source=yuno-m-test';
  IG text := 'https://www.instagram.com/club/';
  PB text := 'https://yunoapp.eu/?utm_source=yuno&utm_medium=powered_by';
  WIN text := 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
  IPH text := 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  ANDR text := 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';
  FBX text := 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
  c record; bad text := ''; res jsonb := '[]'::jsonb; got text; i integer;
  cases jsonb := jsonb_build_array(
    -- email, secondes depuis t0, lien, ip, user-agent, attendu
    jsonb_build_array('humain.rapide@x.fr', 16, SG, '1.1.1.1', IPH, 'clicked'),
    jsonb_build_array('humain.mac@x.fr', 3600, SG, '2.2.2.2', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605', 'clicked'),
    jsonb_build_array('scan.rafale@ecole.fr', 40, PB, '4.251.36.204', WIN, 'auto_click'),
    jsonb_build_array('scan.rafale@ecole.fr', 40, IG, '4.251.36.204', WIN, 'auto_click'),
    jsonb_build_array('scan.rafale@ecole.fr', 41, SG, '4.251.36.204', WIN, 'auto_click'),
    jsonb_build_array('scan.rafale@ecole.fr', 41, SG, '4.251.36.204', WIN, 'auto_click'),
    jsonb_build_array('limite.deux@x.fr', 60, SG, '5.5.5.5', WIN, 'clicked'),           -- limite connue : deux clics rapprochés ne suffisent pas
    jsonb_build_array('limite.deux@x.fr', 61, IG, '5.5.5.5', WIN, 'clicked'),
    jsonb_build_array('ferme.reseau@ecole.fr', 30, SG, '10.0.0.1', WIN, 'auto_click'),
    jsonb_build_array('ferme.reseau@ecole.fr', 150, SG, '10.0.0.2', WIN, 'auto_click'),
    jsonb_build_array('ferme.reseau@ecole.fr', 270, SG, '10.0.0.3', WIN, 'auto_click'),
    jsonb_build_array('ferme.reseau@ecole.fr', 390, SG, '10.0.0.4', WIN, 'auto_click'),
    jsonb_build_array('partage@x.fr', 7200, SG, '9.9.9.9', IPH, 'clicked'),              -- le vrai clic
    jsonb_build_array('partage@x.fr', 7500, FBX, '2a03:2880::1', FBX, 'auto_click'),     -- aperçus de messagerie de partage
    jsonb_build_array('partage@x.fr', 7500, SG, '2a03:2880::2', FBX, 'auto_click'),
    jsonb_build_array('partage@x.fr', 7501, SG, '34.221.1.1', WIN, 'auto_click'),
    jsonb_build_array('partage@x.fr', 7502, SG, '2a03:2880::3', ANDR, 'auto_click'),
    jsonb_build_array('partage@x.fr', 9000, SG, '9.9.9.9', IPH, 'clicked'),              -- il revient plus tard
    jsonb_build_array('multi.appareils@x.fr', 100, SG, '3.3.3.3', WIN, 'clicked'),       -- WOH : trois clics espacés, achat 4 s après
    jsonb_build_array('multi.appareils@x.fr', 106, IG, '3.3.3.4', ANDR, 'clicked'),
    jsonb_build_array('multi.appareils@x.fr', 133, SG, '3.3.3.3', WIN, 'clicked'),
    jsonb_build_array('multi.appareils@x.fr', 137, SG, '3.3.3.5', WIN, 'clicked'),
    jsonb_build_array('lecteur.connu@x.fr', 50, SG, '7.7.7.7', 'Mozilla/5.0 (compatible; Proofpoint-LinkScan)', 'auto_click'),
    jsonb_build_array('mobile.relay@x.fr', 100, SG, '172.224.1.1', IPH, 'clicked'),      -- Private Relay : adresses réseau qui tournent, mais mobile
    jsonb_build_array('mobile.relay@x.fr', 200, SG, '172.224.1.2', IPH, 'clicked'),
    jsonb_build_array('mobile.relay@x.fr', 300, SG, '172.224.1.3', IPH, 'clicked'),
    jsonb_build_array('mobile.relay@x.fr', 400, SG, '172.224.1.4', IPH, 'clicked'));
  e jsonb;
BEGIN
  INSERT INTO public.email_campaigns
    SELECT (jsonb_populate_record(NULL::public.email_campaigns, to_jsonb(x) || jsonb_build_object('id', cid))).*
      FROM public.email_campaigns x WHERE x.id = 'ec6daa79-91b3-4c79-ad08-b8c58c7704db';

  FOR e IN SELECT * FROM jsonb_array_elements(cases) LOOP
    INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata, created_at)
    VALUES (cid, e->>0, 'clicked',
            jsonb_build_object('click', jsonb_build_object('link', e->>2, 'ipAddress', e->>3, 'userAgent', e->>4,
                               'timestamp', to_char((t0 + make_interval(secs => (e->>1)::int)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'))),
            t0 + make_interval(secs => (e->>1)::int));
  END LOOP;

  -- Résultat clic par clic : on compare dans l'ordre d'insertion (created_at, puis ordre des lignes).
  i := 0;
  FOR c IN SELECT ev.recipient_email, ev.event_type, ev.created_at FROM public.email_campaign_events ev WHERE ev.campaign_id = cid ORDER BY ev.created_at, ev.id LOOP
    NULL;
  END LOOP;
  FOR c IN
    SELECT (cs->>0) AS em, (cs->>1)::int AS s, (cs->>5) AS want,
           (SELECT ev.event_type FROM public.email_campaign_events ev
             WHERE ev.campaign_id = cid AND lower(ev.recipient_email) = lower(cs->>0)
               AND ev.created_at = t0 + make_interval(secs => (cs->>1)::int)
               AND ev.metadata #>> '{click,ipAddress}' = cs->>3 AND ev.metadata #>> '{click,link}' = cs->>2 LIMIT 1) AS got
      FROM jsonb_array_elements(cases) cs
  LOOP
    res := res || jsonb_build_array(jsonb_build_object('e', c.em, 's', c.s, 'want', c.want, 'got', c.got));
    IF c.got IS DISTINCT FROM c.want THEN bad := bad || (c.em || '@' || c.s || ' veut ' || c.want || ' a ' || COALESCE(c.got, 'null') || '; '); END IF;
  END LOOP;

  -- Ouvertures : nature posée à l'insertion.
  INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata)
  VALUES (cid, 'o1@x.fr', 'opened', '{"open":{"userAgent":"Mozilla/5.0","ipAddress":"2a04::1"}}'),
         (cid, 'o2@x.fr', 'opened', '{"open":{"userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/109 Safari/537.36","ipAddress":"1.2.3.4"}}'),
         (cid, 'o3@x.fr', 'opened', '{"open":{"userAgent":"YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html","ipAddress":"5.6.7.8"}}');
  IF (SELECT open_class FROM public.email_campaign_events WHERE campaign_id = cid AND recipient_email = 'o1@x.fr') <> 'proxy' THEN bad := bad || 'o1 proxy; '; END IF;
  IF (SELECT open_class FROM public.email_campaign_events WHERE campaign_id = cid AND recipient_email = 'o2@x.fr') <> 'client' THEN bad := bad || 'o2 client; '; END IF;
  IF (SELECT open_class FROM public.email_campaign_events WHERE campaign_id = cid AND recipient_email = 'o3@x.fr') <> 'proxy' THEN bad := bad || 'o3 proxy; '; END IF;

  -- Minimisation : on vieillit les événements du jeu, on minimise, puis un clic tardif ne rejuge rien.
  UPDATE public.email_campaign_events SET created_at = created_at - interval '3000 days' WHERE campaign_id = cid;
  PERFORM public.email_events_minimize(100000, 30);
  IF EXISTS (SELECT 1 FROM public.email_campaign_events WHERE campaign_id = cid AND (metadata #> '{click,ipAddress}' IS NOT NULL OR metadata #> '{open,userAgent}' IS NOT NULL)) THEN bad := bad || 'ip ou ua encore là; '; END IF;
  IF (SELECT count(*) FROM public.email_campaign_events WHERE campaign_id = cid AND event_type = 'auto_click') <> 13 THEN bad := bad || 'auto_click après minimisation; '; END IF;
  IF (SELECT open_class FROM public.email_campaign_events WHERE campaign_id = cid AND recipient_email = 'o2@x.fr') <> 'client' THEN bad := bad || 'o2 perdu; '; END IF;
  INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata)
  VALUES (cid, 'ferme.reseau@ecole.fr', 'clicked', jsonb_build_object('click', jsonb_build_object('link', SG, 'ipAddress', '10.0.0.9', 'userAgent', WIN, 'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'))));
  IF (SELECT count(*) FROM public.email_campaign_events WHERE campaign_id = cid AND event_type = 'auto_click') <> 13 THEN bad := bad || 'un clic tardif a rejugé des lignes minimisées; '; END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION 'ECHEC %', bad;
  END IF;
  RAISE EXCEPTION 'SMOKE_OK % cas conformes, minimisation et clic tardif conformes', jsonb_array_length(cases);
END $$;
