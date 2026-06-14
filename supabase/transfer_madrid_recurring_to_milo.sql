-- ============================================================
-- TRANSFERT SOIRÉES RÉCURRENTES : yuno-madrid → Milo (madbynight)
-- 51 templates à importer
-- À exécuter dans le SQL Editor du projet yuno-app (fulawxvdlwtdlpkycixe)
-- ============================================================

-- -------------------------------------------------------
-- ÉTAPE 1 : Vérification préalable
-- Exécuter ce SELECT séparément avant d'aller plus loin.
-- Doit retourner le compte de Milo avec ses venues.
-- -------------------------------------------------------
SELECT
  a.id AS affiliate_id,
  a.name AS affiliate_name,
  COUNT(av.id) AS nb_venues
FROM affiliates a
LEFT JOIN affiliate_venues av ON av.affiliate_id = a.id
WHERE a.name ILIKE '%madbynight%' OR a.name ILIKE '%milo%'
GROUP BY a.id, a.name;

-- -------------------------------------------------------
-- ÉTAPE 2 : Import des 51 soirées récurrentes
-- Les flyers restent hébergés sur yuno-madrid (Supabase public).
-- Les slugs sont conservés depuis yuno-madrid.
-- ON CONFLICT (slug) DO NOTHING = idempotent (safe à re-jouer).
-- -------------------------------------------------------
WITH
  milo AS (
    SELECT id FROM affiliates
    WHERE name ILIKE '%madbynight%' OR name ILIKE '%milo%'
    LIMIT 1
  ),
  venues AS (
    SELECT av.id, av.name
    FROM affiliate_venues av
    JOIN milo ON av.affiliate_id = milo.id
  )
INSERT INTO affiliate_recurring_templates
  (affiliate_id, affiliate_venue_id, name, day_of_week, start_time, end_time,
   price_from, is_free, genres, advance_days, is_active, flyer_url, slug)
SELECT
  milo.id,
  v.id,
  t.name,
  t.day_of_week,
  t.start_time,
  t.end_time,
  t.price_from,
  t.is_free,
  t.genres,
  t.advance_days,
  t.is_active,
  t.flyer_url,
  t.slug
FROM milo, (VALUES
  ('ZFX', 4, '23:00:00'::time, '05:30:00'::time, 20.0::numeric, false, ARRAY['house']::text[], 6, false, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612043694-screenshot-2026-05-06-at-182244.png', 'zfx', 'Los Amantes'),

  ('Teatro Kapital Thursday', 4, '23:00:00'::time, '06:00:00'::time, 21.0::numeric, false, ARRAY['reggaeton','house','open-format','latin','hip-hop']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613225468-670346107185806072870632612441850271225901951n.jpg', 'teatro-kapital-thursday', 'Teatro Kapital'),

  ('FEVER ROOM Thursday Victoria', 4, '00:00:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['house','reggaeton','open-format','afrobeats']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1778340513349-whatsapp-image-2026-05-09-at-162435.jpeg', 'fever-room-thursday-victoria', 'Victoria'),

  ('BONDED THURSDAY', 4, '00:00:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['open-format','reggaeton','house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612384472-screenshot-2026-05-24-at-104614.png', 'bonded-thursday', 'Bonded'),

  ('TIFFANY''S THURSDAY', 4, '00:00:00'::time, '05:30:00'::time, 12.0::numeric, false, ARRAY['open-format']::text[], 5, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309038924-screenshot-2026-06-01-at-121707.jpg', 'tiffanys-thursday', 'Tiffany'),

  ('AZUR Club by ASTRAL', 5, '18:00:00'::time, '02:30:00'::time, 16.0::numeric, false, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1778342854935-screenshot-2026-05-09-180726.png', 'azur-club-by-astral', 'Ginkgo'),

  ('ETNIA VIERNES', 5, '23:00:00'::time, '06:00:00'::time, 12.0::numeric, false, ARRAY['reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1778343616509-screenshot-2026-05-09-182001.png', 'etnia-viernes', 'Etnia'),

  ('NAZCA FRIDAY', 5, '23:45:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780342926407-671072234183385580292236611860682952061350505n.jpg', 'nazca-viernes', 'Nazca'),

  ('VICE CLUB AT BONDED', 5, '23:59:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['reggaeton','house','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780343003610-508998905180154138107359637731502286300301610n.jpg', 'vice-club-at-bonded', 'Bonded'),

  ('Teatro Kapital FRIDAY', 5, '23:00:00'::time, '06:00:00'::time, 27.0::numeric, false, ARRAY['house','reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613162823-650979573185708345290632614874386634953766978n.jpg', 'teatro-kapital', 'Teatro Kapital'),

  ('Teatro Kapital SATURDAY', 6, '23:00:00'::time, '06:00:00'::time, 27.0::numeric, false, ARRAY['house','reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613182313-66171853918579279745063261683233302035383826n.jpg', 'teatro-kapital-saturday', 'Teatro Kapital'),

  ('Teatro Kapital SUNDAY', 0, '23:00:00'::time, '06:00:00'::time, 21.0::numeric, false, ARRAY['house','reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613203129-670346107185806072870632612441850271225901951n.jpg', 'teatro-kapital-sunday', 'Teatro Kapital'),

  ('Teatro Kapital WEDNESDAY', 3, '23:00:00'::time, '06:00:00'::time, 21.0::numeric, false, ARRAY['house','reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613257871-650979573185708345290632614874386634953766978n.jpg', 'teatro-kapital-wednesday', 'Teatro Kapital'),

  ('VANDIDO WEDNESDAY', 3, '23:00:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['house','reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613026746-670660212180312006207994951406791349448029766n.jpg', 'wednesday-at-vandido', 'Vandido'),

  ('Istar Tuesday', 2, '00:00:00'::time, '06:00:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1778571340957-screenshot-2026-05-12-093428.png', 'istar-tuesday', 'Istar'),

  ('Istar Wednesday', 3, '00:00:00'::time, '06:00:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612258135-684204255180944772171490993887631244190479312n.webp', 'istar-wednesday', 'Istar'),

  ('Istar Thursday', 4, '00:00:00'::time, '06:00:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612279760-684204255180944772171490993887631244190479312n.webp', 'istar-thursday', 'Istar'),

  ('Istar Friday', 5, '00:00:00'::time, '06:00:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612312596-684204255180944772171490993887631244190479312n.webp', 'istar-friday', 'Istar'),

  ('Istar Saturday', 6, '00:00:00'::time, '06:00:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612332346-684204255180944772171490993887631244190479312n.webp', 'istar-saturday', 'Istar'),

  ('GABANA WEDNESDAY', 3, '00:00:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612956922-saveclipapp632250930184217438471386978624254102818954577n.jpg', 'gabana-wednesday', 'Gabana'),

  ('TODOS SANTOS WEDNESDAY', 3, '00:00:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['house','open-format','latin']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1778579981791-screenshot-2026-05-12-115932.png', 'todos-santos-wednesday', 'Todos Santos'),

  ('FITZ WEDNESDAY', 3, '00:00:00'::time, '06:00:00'::time, 10.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1778580307959-screenshot-2026-05-12-120433.png', 'fitz-wednesday', 'Fitz'),

  ('TODOS SANTOS JUEVES', 4, '00:00:00'::time, '06:00:00'::time, 25.0::numeric, false, ARRAY['reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780308994778-screenshot-2026-06-01-at-121618.jpg', 'todos-santos-jueves', 'Todos Santos'),

  ('VANDIDO JUEVES', 4, '00:00:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['open-format','reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779613109516-screenshot-2026-05-24-at-105822.png', 'vandido-jueves', 'Vandido'),

  ('VANDIDO VIERNES', 5, '23:59:00'::time, '06:00:00'::time, 25.0::numeric, false, ARRAY['reggaeton','open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309222760-screenshot-2026-06-01-at-121955.jpg', 'vandido-viernes', 'Vandido'),

  ('RUBICON FRIDAY', 5, '23:59:00'::time, '06:00:00'::time, 25.0::numeric, false, ARRAY['reggaeton','open-format','latin']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779612422470-screenshot-2026-05-24-at-104652.png', 'rubicon-viernes', 'Rubicon'),

  ('FITZ FRIDAY', 5, '23:59:00'::time, '06:00:00'::time, 0.0::numeric, true, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309391411-screenshot-2026-06-01-at-122303.jpg', 'fitz-friday', 'Fitz'),

  ('FITZ MONDAY', 1, '23:59:00'::time, '06:00:00'::time, 25.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779126708960-685071217180845442986218558296188639381645914n.jpg', 'fitz-monday', 'Fitz'),

  ('GUNILLA WEDNESDAY', 3, '23:59:00'::time, '05:30:00'::time, 20.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779610365612-screenshot-2026-05-24-at-101111.png', 'gunilla-wednesday', 'Gunilla'),

  ('FITZ TUESDAY', 2, '23:59:00'::time, '06:00:00'::time, 10.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779717349512-screenshot-2026-05-25-at-155540.png', 'fitz-tuesday', 'Fitz'),

  ('TIFFANY''S THE CLUB TUESDAY', 2, '23:59:00'::time, '06:00:00'::time, 12.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779717451941-684234552178780138535776364068457870269979437n.jpg', 'tiffanys-the-club-tuesday', 'Tiffany'),

  ('OH MY CLUB WEDNESDAY', 3, '23:00:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['open-format','reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779717563212-683795224183205681302835932044583229660590567n.webp', 'oh-my-club-wednesday', 'Oh My Club'),

  ('TIFFANY''S THE CLUB WEDNESDAY', 3, '23:59:00'::time, '05:30:00'::time, 12.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779717667840-683879423180817569592682628961454964168917910n.jpg', 'tiffanys-the-club-wednesday', 'Tiffany'),

  ('VERBENA X OPIUM WEDNESDAY', 3, '23:59:00'::time, '05:30:00'::time, 15.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779717819480-screenshot-2026-05-25-at-160330.png', 'verbena-x-opium-wednesday', 'Opium'),

  ('OH MY CLUB THURSDAY', 4, '23:45:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['open-format','reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779717941383-683670511183204220122835937126135029990680067n.webp', 'oh-my-club-thursday', 'Oh My Club'),

  ('NAZCA CLUB THURSDAY', 4, '23:59:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779718024948-680712818183386676282236615416049167888053662n.jpg', 'nazca-club-thursday', 'Nazca'),

  ('FITZ THURSDAY', 4, '23:59:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779718113126-685071217180845442986218558296188639381645914n.jpg', 'fitz-thursday', 'Fitz'),

  ('COPERNICO THE CLUB FRIDAY', 5, '23:59:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779718333442-saveclipapp687786146185274681370766464020990283410596348n.jpg', 'copernico-the-club-friday', 'Copernico'),

  ('Los Amantes Tuesday', 2, '23:30:00'::time, '05:30:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779864675880-saveclipapp669770362179721010860342159093448743493257941n.jpg', 'los-amantes-tuesday', 'Los Amantes'),

  ('Los Amantes Wednesday', 3, '23:30:00'::time, '05:30:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779864675880-saveclipapp669770362179721010860342159093448743493257941n.jpg', 'los-amantes-wednesday', 'Los Amantes'),

  ('Los Amantes Friday', 5, '23:30:00'::time, '05:30:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779864675880-saveclipapp669770362179721010860342159093448743493257941n.jpg', 'los-amantes-friday', 'Los Amantes'),

  ('Los Amantes Saturday', 6, '23:30:00'::time, '05:30:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779864675880-saveclipapp669770362179721010860342159093448743493257941n.jpg', 'los-amantes-saturday', 'Los Amantes'),

  ('Los Amantes Sunday', 0, '23:30:00'::time, '05:30:00'::time, 0.0::numeric, true, ARRAY['house']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1779864675880-saveclipapp669770362179721010860342159093448743493257941n.jpg', 'los-amantes-sunday', 'Los Amantes'),

  ('ETNIA THURSDAY', 4, '23:45:00'::time, '06:00:00'::time, 12.0::numeric, false, ARRAY['house','electronic']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309594644-491418315179445591119855267986343653510189421n.jpg', 'etnia-thursday', 'Etnia'),

  ('Copernico The CLub Thursday', 4, '23:59:00'::time, '05:30:00'::time, 15.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309778385-saveclipapp703227557185298916150766466356355581642277494n.jpg', 'copernico-the-club-thursday', 'Copernico'),

  ('Copernico The CLub Wednesday', 3, '23:59:00'::time, '05:30:00'::time, 15.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309778385-saveclipapp703227557185298916150766466356355581642277494n.jpg', 'copernico-the-club-wednesday', 'Copernico'),

  ('LOS AMANTES THURSDAY', 4, '23:59:00'::time, '05:30:00'::time, 0.0::numeric, true, ARRAY[]::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780309998777-saveclipapp669770362179721010860342159093448743493257941n.jpg', 'los-amantes-thursday', 'Los Amantes'),

  ('OPIUM LADIES NIGHT TUESDAY', 2, '23:45:00'::time, '05:30:00'::time, 15.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780310183584-screenshot-2026-06-01-at-123536.jpg', 'opium-ladies-night-tuesday', 'Opium'),

  ('OPIUM EUPHORIA THURSDAY', 4, '23:59:00'::time, '05:30:00'::time, 15.0::numeric, false, ARRAY['open-format']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780310312960-screenshot-2026-06-01-at-123822.jpg', 'opium-euphoria-thursday', 'Opium'),

  ('OPIUM JOLGORIO FRIDAY', 5, '23:59:00'::time, '06:00:00'::time, 15.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780310433752-screenshot-2026-06-01-at-124000.jpg', 'opium-jolgorio-friday', 'Opium'),

  ('JUST OPIUM SATURDAY', 6, '23:59:00'::time, '06:00:00'::time, 20.0::numeric, false, ARRAY['reggaeton']::text[], 7, true, 'https://ovyfdjqltpqqkffjpnfe.supabase.co/storage/v1/object/public/events/1780310522852-screenshot-2026-06-01-at-124155.jpg', 'just-opium-saturday', 'Opium')
) AS t(name, day_of_week, start_time, end_time, price_from, is_free, genres,
       advance_days, is_active, flyer_url, slug, venue_search)
JOIN venues v ON v.name ILIKE '%' || t.venue_search || '%'
ON CONFLICT (slug) DO NOTHING;

-- -------------------------------------------------------
-- ÉTAPE 3 : Vérification post-import
-- -------------------------------------------------------
SELECT
  t.name,
  t.day_of_week,
  t.is_active,
  v.name AS venue
FROM affiliate_recurring_templates t
JOIN affiliate_venues v ON v.id = t.affiliate_venue_id
WHERE t.affiliate_id = (
  SELECT id FROM affiliates
  WHERE name ILIKE '%madbynight%' OR name ILIKE '%milo%'
  LIMIT 1
)
ORDER BY t.day_of_week, t.name;

