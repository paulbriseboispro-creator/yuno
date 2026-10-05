-- Démo Yuno CRM : liens de partage des soirées (story, bio, reel, groupe…)
-- et sources de vente telles que Shotgun les rend vraiment.
-- Rejouable. Borné au compte démo crm@womber.fr. À relancer APRÈS
-- seed-crm-demo.sql (qui régénère les billets et leurs UTM).
--
-- 1. Sources réalistes sur tous les billets démo : Shotgun ne rend jamais
--    `utm_medium = social / email` (c'est la PLATEFORME : app, website,
--    widget), et une commande en ligne a toujours une source (`shotgun`,
--    `direct`, ou l'origine). Les billets sans source restent les ventes hors
--    ligne / importées.
-- 2. Liens de partage sur trois soirées à venir, clics étalés depuis leur
--    création, et une partie des billets achetés APRÈS la création d'un lien
--    rattachée à ce lien (`utm_source = yuno-<code>`), comme le ferait Shotgun.
--    La dernière story n'a encore aucune vente : l'écran montre aussi ce cas.

DO $$
DECLARE
  v_uid uuid;
  v_ev uuid;
  v_link record;
  v_i integer;
  v_n integer;
  v_at timestamptz;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;

  -- ── 1. Sources des billets démo (déterministes, par empreinte du billet) ──
  UPDATE public.external_tickets t
     SET utm = CASE
           WHEN t.utm IS NULL THEN
             CASE WHEN ('x' || substr(md5(t.id::text), 1, 2))::bit(8)::int < 140 THEN jsonb_build_object('utm_source', 'shotgun', 'utm_medium', 'app')
                  WHEN ('x' || substr(md5(t.id::text), 1, 2))::bit(8)::int < 205 THEN jsonb_build_object('utm_source', 'direct', 'utm_medium', 'website')
                  ELSE NULL END
           ELSE jsonb_build_object('utm_source', lower(t.utm->>'utm_source'),
                  'utm_medium', CASE WHEN ('x' || substr(md5(t.id::text), 3, 2))::bit(8)::int < 160 THEN 'app' ELSE 'website' END)
         END
   WHERE t.organizer_user_id = v_uid
     AND (t.utm IS NULL OR t.utm->>'utm_medium' IN ('social', 'email') OR t.utm->>'utm_source' LIKE 'yuno-%');

  -- Les billets déjà rattachés à un lien démo retrouvent leur source d'origine
  -- avant qu'on refasse les liens (rejouable).
  UPDATE public.external_tickets t
     SET utm = jsonb_build_object('utm_source', 'instagram', 'utm_medium', 'app')
   WHERE t.organizer_user_id = v_uid AND t.utm->>'utm_source' LIKE 'yuno-%' AND t.utm->>'utm_source' !~ '^yuno-[msd]-';

  -- ── 2. Liens de partage ───────────────────────────────────────────────────
  DELETE FROM public.tracked_links tl
   WHERE tl.organizer_user_id = v_uid AND tl.code LIKE 'demo%'
     AND tl.event_id IN (SELECT id FROM public.events WHERE organizer_user_id = v_uid AND external_source IS NOT NULL);

  FOR v_link IN
    SELECT * FROM (VALUES
      -- soirée (titre exact), code, libellé, réseau, emplacement, créé il y a N jours, clics, part des ventes (‰)
      ('Minimal Room #20', 'demomr20bio',   'Bio Instagram',          'instagram', 'bio',   16, 240, 160),
      ('Minimal Room #20', 'demomr20st1',   'Story 1 · Annonce',      'instagram', 'story', 13, 310, 230),
      ('Minimal Room #20', 'demomr20reel',  'Reel aftermovie',        'instagram', 'reel',  11, 180,  90),
      ('Minimal Room #20', 'demomr20wa',    'Groupe WhatsApp habitués','whatsapp', 'group',  9,  95, 120),
      ('Minimal Room #20', 'demomr20st2',   'Story 2 · Line-up',      'instagram', 'story',  7, 260, 200),
      ('Minimal Room #20', 'demomr20st3',   'Story 3 · J-7',          'instagram', 'story',  1,  64,   0),
      ('House Nation #21', 'demohn21bio',   'Bio Instagram',          'instagram', 'bio',   12, 140, 220),
      ('House Nation #21', 'demohn21st1',   'Story 1 · Annonce',      'instagram', 'story',  9, 190, 260),
      ('House Nation #21', 'demohn21tt',    'Vidéo TikTok teaser',    'tiktok',    'video',  6, 120,  90),
      ('Warehouse Session #22', 'demows22st1', 'Story 1 · Annonce',   'instagram', 'story', 10, 220, 240),
      ('Warehouse Session #22', 'demows22part','Partenaire · Collectif Nuit', 'other', 'partner', 8, 70, 110)
    ) AS x(title, code, label, platform, placement, days, clicks, share)
  LOOP
    SELECT id INTO v_ev FROM public.events
     WHERE organizer_user_id = v_uid AND external_source IS NOT NULL AND title = v_link.title LIMIT 1;
    CONTINUE WHEN v_ev IS NULL;
    v_at := date_trunc('hour', now() - make_interval(days => v_link.days)) + interval '19 hours';
    IF v_at > now() THEN v_at := now() - interval '20 hours'; END IF;

    INSERT INTO public.tracked_links (code, label, owner_kind, organizer_user_id, created_by, target_kind, event_id,
                                      utm_source, utm_medium, utm_campaign, clicks_count, created_at)
    VALUES (v_link.code, v_link.label, 'organizer', v_uid, v_uid, 'event', v_ev,
            v_link.platform, v_link.placement, 'yuno', v_link.clicks, v_at);

    -- Clics : plus nombreux les premières heures (une story vit 24 h), puis
    -- une traîne ; ~15 % de visiteurs reviennent.
    INSERT INTO public.tracked_link_clicks (tracked_link_id, clicked_at, visitor_id, device_type, referrer, country)
    SELECT tl.id,
           LEAST(now() - interval '3 minutes',
                 v_at + make_interval(secs => (power(random(), CASE WHEN v_link.placement = 'story' THEN 3 ELSE 1.4 END)
                                                * extract(epoch FROM now() - v_at))::int)),
           'demo:' || v_link.code || ':' || (g % GREATEST(1, (v_link.clicks * 0.86)::int)),
           CASE WHEN random() < 0.9 THEN 'mobile' ELSE 'desktop' END,
           CASE v_link.platform WHEN 'instagram' THEN 'l.instagram.com' WHEN 'tiktok' THEN 'www.tiktok.com' WHEN 'whatsapp' THEN NULL ELSE 'collectifnuit.fr' END,
           (ARRAY['FR','FR','FR','FR','BE','CH','ES'])[1 + floor(random() * 7)::int]
      FROM public.tracked_links tl, generate_series(1, v_link.clicks) g
     WHERE tl.code = v_link.code;

    -- Ventes : billets valides de la soirée achetés APRÈS la création du lien,
    -- venus d'Instagram / d'un accès direct, rattachés au lien selon sa part.
    IF v_link.share > 0 THEN
      UPDATE public.external_tickets t
         SET utm = jsonb_build_object('utm_source', public.crm_link_source(v_link.code), 'utm_medium', 'app')
       WHERE t.id IN (
         SELECT t2.id FROM public.external_tickets t2
          WHERE t2.organizer_user_id = v_uid AND t2.event_id = v_ev AND t2.status = 'valid'
            AND COALESCE(t2.purchased_at, t2.first_seen_at) >= v_at
            AND t2.utm->>'utm_source' IN ('instagram', 'direct', 'shotgun', 'tiktok')
            AND ('x' || substr(md5(t2.id::text || v_link.code), 1, 3))::bit(12)::int < v_link.share * 4.096
       );
    END IF;
  END LOOP;
END $$;
