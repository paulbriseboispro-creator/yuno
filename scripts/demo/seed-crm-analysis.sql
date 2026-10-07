-- ============================================================================
-- Démo Yuno CRM — l'analyse client (« Ce qui fait venir »), crm@womber.fr.
-- À rejouer APRÈS seed-crm-demo.sql, seed-crm-nights.sql et
-- seed-crm-guestlist.sql (joué par refresh-crm-demo.sh). Rejouable : il ne
-- crée aucune ligne, il RETOUCHE les soirées et billets du semis de base
-- (connexion 'demo-crm') pour y mettre des motifs réalistes et mélangés, puis
-- lance un calcul complet de l'analyse.
--
-- Ce qu'il sème (sans changer le nombre de billets d'une soirée ni d'une
-- personne : les échanges se font billet contre billet) :
--   • un line-up : 2 résidents (≈ 60 % et 25 % des soirées) et 8 têtes
--     d'affiche invitées, une soirée sur 8 chacune ; un client sur deux est « fan »
--     d'une tête d'affiche : ses billets sont échangés, quand c'est possible,
--     contre ceux d'un autre client à une soirée proche où elle joue ;
--   • des formats (club, plein air, rooftop) ;
--   • des délais d'achat tenus par la personne : un groupe achète toujours
--     tôt (dans les 24 h de la mise en vente), un groupe toujours à la dernière
--     minute, les autres au fil de l'eau ;
--   • des commandes de plusieurs billets : surtout des billets de PERSONNES
--     DIFFÉRENTES achetés ensemble, et quelques commandes au même nom ;
--   • des codes postaux (Paris et petite couronne surtout, quelques grandes
--     villes) et des clients de passage à l'étranger.
-- Le moteur décide seul de ce qui est confirmé : la démo doit montrer au
-- moins une famille confirmée, une pas confirmée et une à tester ; une démo
-- où tout est confirmé mentirait.
--
-- Aucune donnée réelle : adresses @example.com du semis de base, noms
-- d'artistes inventés, sans accent dans les adresses.
--   supabase db query --linked -f scripts/demo/seed-crm-analysis.sql
-- ============================================================================

DO $seed$
DECLARE
  v_uid uuid;
  v_conn uuid;
  v_guests text[] := ARRAY['Nova Kane','Ilyo','Marla Voss','Teo Brass','Sable Rose','Kurt Okan','Lune Aria','Dax Hollow'];
  v_res jsonb := '[{"id":"901001","name":"Nuits Démo Resident","slug":"nuits-demo-resident"},{"id":"901002","name":"Clara Sound","slug":"clara-sound"}]'::jsonb;
  v_ev record;
  v_i integer := 0;
  v_g integer;
  v_lineup jsonb;
  t record;
  u record;  -- (id, ev, em) du billet échangé
  v_swaps integer := 0;
  v_fav integer;
  v_res_out jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM setseed(0.27);

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  SELECT id INTO v_conn FROM public.ticketing_connections
   WHERE organizer_user_id = v_uid AND external_org_id = 'demo-crm' LIMIT 1;
  IF v_conn IS NULL THEN RAISE EXCEPTION 'connexion demo-crm absente : lancer seed-crm-demo.sql'; END IF;

  -- ── 1. Line-up et format de chaque soirée ────────────────────────────────
  FOR v_ev IN SELECT * FROM public.external_events WHERE connection_id = v_conn ORDER BY start_at LOOP
    v_i := v_i + 1;
    -- Une tête d'affiche invitée par soirée, qui revient toutes les 8 soirées
    -- (≈ 12 % des soirées : toujours « rare », jamais résidente).
    v_g := 1 + ((v_i * 3) % array_length(v_guests, 1));
    v_lineup := jsonb_build_array(jsonb_build_object(
      'id', (902000 + v_g)::text, 'name', v_guests[v_g],
      'slug', lower(replace(v_guests[v_g], ' ', '-'))));
    IF v_i % 5 IN (0, 1, 3) THEN v_lineup := v_lineup || jsonb_build_array(v_res->0); END IF;
    IF v_i % 4 = 2 THEN v_lineup := v_lineup || jsonb_build_array(v_res->1); END IF;
    UPDATE public.external_events SET
      artists = v_lineup,
      -- 12 rue de la Nuit, Paris 11e (adresse fictive du semis de base).
      latitude = 48.8589, longitude = 2.3770,
      type_of_place = CASE WHEN name ILIKE 'Open Air%' THEN 'open_air' WHEN name ILIKE 'Rooftop%' THEN 'rooftop' ELSE 'club' END
     WHERE id = v_ev.id;
  END LOOP;
  -- La mémoire des annonces : ces soirées existaient avant Yuno, date inconnue.
  DELETE FROM public.crm_artist_seen WHERE connection_id = v_conn;
  INSERT INTO public.crm_artist_seen (connection_id, external_event_id, artist_key, first_seen_at, announce_known)
  SELECT e.connection_id, e.external_id, public._crm_artist_key(a), COALESCE(e.published_at, e.first_seen_at), false
    FROM public.external_events e CROSS JOIN LATERAL jsonb_array_elements(e.artists) a
   WHERE e.connection_id = v_conn
  ON CONFLICT DO NOTHING;

  -- ── 2. Les fans : billets échangés vers les soirées de leur tête d'affiche ─
  -- Un échange = deux billets (deux soirées proches) qui échangent leur
  -- acheteur : le compte de chaque soirée et de chaque personne ne bouge pas.
  DROP TABLE IF EXISTS _fan;
  CREATE TEMP TABLE _fan ON COMMIT DROP AS
  SELECT lower(buyer_email) AS em, 1 + abs(hashtext('fan' || lower(buyer_email))) % array_length(v_guests, 1) AS fav
    FROM public.external_tickets
   WHERE connection_id = v_conn AND buyer_email IS NOT NULL AND status = 'valid'
     AND COALESCE(raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata')
   GROUP BY 1
  HAVING count(*) >= 2 AND abs(hashtext('isfan' || lower(buyer_email))) % 2 = 0;

  -- Qui a déjà une place à quelle soirée (tenu à jour à chaque échange).
  DROP TABLE IF EXISTS _att;
  CREATE TEMP TABLE _att ON COMMIT DROP AS
  SELECT DISTINCT lower(buyer_email) AS em, external_event_id AS ev
    FROM public.external_tickets WHERE connection_id = v_conn AND buyer_email IS NOT NULL;
  CREATE UNIQUE INDEX ON _att (em, ev);
  -- Les billets candidats à un échange, par soirée de tête d'affiche.
  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT y.id, y.external_event_id AS ev, lower(y.buyer_email) AS em, m.start_at,
         (m.artists->0->>'id')::int - 902000 AS g
    FROM public.external_tickets y
    JOIN public.external_events m ON m.connection_id = y.connection_id AND m.external_id = y.external_event_id
   WHERE y.connection_id = v_conn AND y.status = 'valid' AND y.buyer_email IS NOT NULL
     AND COALESCE(y.raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata')
     AND m.start_at < now();
  CREATE INDEX ON _cand (g, start_at);

  FOR t IN
    SELECT x.id, x.external_event_id, lower(x.buyer_email) AS em, f.fav, e.start_at
      FROM public.external_tickets x
      JOIN _fan f ON f.em = lower(x.buyer_email)
      JOIN public.external_events e ON e.connection_id = x.connection_id AND e.external_id = x.external_event_id
     WHERE x.connection_id = v_conn AND x.status = 'valid' AND e.start_at < now()
       AND COALESCE(x.raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata')
       AND NOT e.artists @> jsonb_build_array(jsonb_build_object('id', (902000 + f.fav)::text))
     ORDER BY random()
  LOOP
    -- Pas toujours : un fan reste parfois venu « pour autre chose ».
    CONTINUE WHEN random() < 0.08;
    SELECT c.id, c.ev, c.em INTO u
      FROM _cand c
     WHERE c.g = t.fav
       AND c.start_at BETWEEN t.start_at - interval '70 days' AND t.start_at + interval '70 days'
       AND NOT EXISTS (SELECT 1 FROM _fan f2 WHERE f2.em = c.em AND f2.fav = t.fav)
       AND NOT EXISTS (SELECT 1 FROM _att a WHERE a.em = t.em AND a.ev = c.ev)
       AND NOT EXISTS (SELECT 1 FROM _att a WHERE a.em = c.em AND a.ev = t.external_event_id)
     ORDER BY random() LIMIT 1;
    CONTINUE WHEN u.id IS NULL;
    -- Échange des identités (acheteur, profil) entre les deux billets.
    WITH a AS (SELECT * FROM public.external_tickets WHERE id = t.id),
         b AS (SELECT * FROM public.external_tickets WHERE id = u.id)
    UPDATE public.external_tickets x SET
      buyer_email = s.buyer_email, buyer_first_name = s.buyer_first_name, buyer_last_name = s.buyer_last_name,
      buyer_phone = s.buyer_phone, newsletter_optin = s.newsletter_optin, age = s.age, gender = s.gender,
      city = s.city, zip_code = s.zip_code, country_code = s.country_code
      FROM (SELECT t.id AS tid, b.* FROM b UNION ALL SELECT u.id AS tid, a.* FROM a) s
     WHERE x.id = s.tid;
    -- Les deux personnes ont changé de soirée.
    DELETE FROM _att WHERE (em = t.em AND ev = t.external_event_id) OR (em = u.em AND ev = u.ev);
    INSERT INTO _att VALUES (t.em, u.ev), (u.em, t.external_event_id) ON CONFLICT DO NOTHING;
    UPDATE _cand SET em = t.em WHERE id = u.id;
    v_swaps := v_swaps + 1;
    u := NULL;
  END LOOP;

  -- ── 3. Délais d'achat tenus par la personne ──────────────────────────────
  -- « Toujours tôt » : dans les 24 h de la mise en vente ; « dernière minute » :
  -- la veille ou le jour même. Les autres gardent leur date.
  UPDATE public.external_tickets x SET purchased_at = CASE
      WHEN abs(hashtext('pace' || lower(x.buyer_email))) % 9 = 0
        THEN e.launched_at + make_interval(mins => 5 + abs(hashtext('m' || x.id::text)) % 1300)
      ELSE e.start_at - make_interval(mins => 30 + abs(hashtext('m' || x.id::text)) % 1200) END
    FROM public.external_events e
   WHERE x.connection_id = v_conn AND e.connection_id = x.connection_id AND e.external_id = x.external_event_id
     AND e.start_at < now() AND e.launched_at IS NOT NULL
     AND COALESCE(x.raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata')
     AND abs(hashtext('pace' || lower(x.buyer_email))) % 9 IN (0, 1);

  -- ── 4. Commandes de plusieurs billets ────────────────────────────────────
  -- Billets de la même soirée regroupés deux par deux (parfois trois) dans la
  -- même commande, à la même heure : surtout des personnes différentes.
  WITH c AS (
    SELECT x.id, x.external_event_id, x.purchased_at,
           row_number() OVER (PARTITION BY x.external_event_id ORDER BY abs(hashtext('ord' || x.id::text))) AS r
      FROM public.external_tickets x
     WHERE x.connection_id = v_conn AND x.status = 'valid'
       AND COALESCE(x.raw->>'deal_channel', '') NOT IN ('invitation', 'duplicata')
       AND abs(hashtext('grp' || lower(x.buyer_email))) % 10 < 3
  ), g AS (
    SELECT c.*, (c.r + 1) / 2 AS grp FROM c
  ), lead AS (
    SELECT external_event_id, grp, min(id::text) AS oid, min(purchased_at) AS at FROM g GROUP BY 1, 2 HAVING count(*) >= 2
  )
  UPDATE public.external_tickets x SET external_order_id = x.external_event_id || '-grp-' || l.grp, purchased_at = l.at
    FROM g JOIN lead l ON l.external_event_id = g.external_event_id AND l.grp = g.grp
   WHERE x.id = g.id;
  -- Quelques commandes au même nom (« achète pour sa bande ») : le second
  -- billet de la commande prend l'identité du premier.
  WITH o AS (
    SELECT external_order_id, min(id::text) AS first_id
      FROM public.external_tickets
     WHERE connection_id = v_conn AND external_order_id LIKE '%-grp-%'
       AND abs(hashtext('same' || external_order_id)) % 8 = 0
     GROUP BY 1
  )
  UPDATE public.external_tickets x SET
    buyer_email = f.buyer_email, buyer_first_name = f.buyer_first_name, buyer_last_name = f.buyer_last_name,
    newsletter_optin = f.newsletter_optin, age = f.age, gender = f.gender, city = f.city
    FROM o JOIN public.external_tickets f ON f.id::text = o.first_id
   WHERE x.external_order_id = o.external_order_id AND x.connection_id = v_conn AND x.id <> f.id;

  -- ── 5. Codes postaux et clients de passage ───────────────────────────────
  UPDATE public.external_tickets x SET
    zip_code = CASE
      WHEN z.k < 52 THEN '750' || lpad((1 + z.h % 20)::text, 2, '0')
      WHEN z.k < 64 THEN (ARRAY['93100', '93200', '92100', '94300', '93500', '92200'])[1 + z.h % 6]
      WHEN z.k < 72 THEN (ARRAY['69001', '59000', '13001', '33000', '44000', '67000'])[1 + z.h % 6]
      WHEN z.k < 78 THEN NULL
      ELSE NULL END,
    country_code = CASE WHEN z.k >= 78 AND z.k < 84 THEN (ARRAY['BE', 'ES', 'GB', 'DE', 'NL', 'IT'])[1 + z.h % 6] ELSE 'FR' END,
    city = CASE WHEN z.k >= 64 AND z.k < 72 THEN (ARRAY['Lyon', 'Lille', 'Marseille', 'Bordeaux', 'Nantes', 'Strasbourg'])[1 + z.h % 6] ELSE x.city END
    FROM (SELECT id, abs(hashtext('zip' || lower(buyer_email))) % 100 AS k, abs(hashtext('zh' || lower(buyer_email))) AS h
            FROM public.external_tickets WHERE connection_id = v_conn) z
   WHERE x.id = z.id AND x.connection_id = v_conn;

  -- ── 6. Analyse complète ──────────────────────────────────────────────────
  v_res_out := public.crm_analysis_compute(NULL, v_uid, true, 0);
  RAISE NOTICE 'analyse démo : % échanges ; %', v_swaps, v_res_out;
END
$seed$;

-- Ce que la démo montre (une ligne par famille).
SELECT family, variant, availability, status, round(o, 1) AS o, round(e, 1) AS e, n, gain, z, direction
  FROM public.crm_family_status
 WHERE scope_key = (SELECT 'org:' || id::text FROM auth.users WHERE lower(email) = 'crm@womber.fr')
 ORDER BY kind, family, variant;
