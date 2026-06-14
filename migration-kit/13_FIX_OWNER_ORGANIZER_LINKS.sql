-- ============================================================
-- CORRECTIONS : Tous les liens de rôles
-- Coller ENTIER dans Supabase Dashboard > SQL Editor > Run
-- ============================================================

-- ============================================================
-- FIX 1 — Owner "Canavan's Theatre - Irish"
-- → paul.brisebois.pro@gmail.com (compte principal) devient owner
-- → pbrisebois.ieu2025 conserve le rôle owner dans user_roles
-- ============================================================
UPDATE venues
SET owner_id = (
  SELECT id FROM auth.users
  WHERE email = 'paul.brisebois.pro@gmail.com'
  LIMIT 1
)
WHERE name ILIKE '%Canavan%' OR name ILIKE '%irish%';

-- S'assurer que paul.brisebois.pro a le rôle owner dans user_roles
INSERT INTO user_roles (user_id, role, email)
SELECT
  au.id,
  'owner',
  au.email
FROM auth.users au
WHERE au.email = 'paul.brisebois.pro@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = au.id AND role = 'owner'
  );

-- S'assurer que pbrisebois.ieu2025 a aussi le rôle owner dans user_roles
INSERT INTO user_roles (user_id, role, email)
SELECT
  au.id,
  'owner',
  au.email
FROM auth.users au
WHERE au.email = 'pbrisebois.ieu2025@student.ie.edu'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = au.id AND role = 'owner'
  );

-- ============================================================
-- FIX 2 — Organisateur "Vida Events"
-- → paulsneakers8@gmail.com
-- ============================================================
UPDATE organizer_profiles
SET user_id = (
  SELECT id FROM auth.users
  WHERE email = 'paulsneakers8@gmail.com'
  LIMIT 1
)
WHERE display_name ILIKE '%vida%';

-- S'assurer que paulsneakers8 a profile_type = 'organizer'
UPDATE profiles
SET profile_type = 'organizer'
WHERE id = (
  SELECT id FROM auth.users
  WHERE email = 'paulsneakers8@gmail.com'
  LIMIT 1
)
AND (profile_type IS NULL OR profile_type != 'organizer');

-- ============================================================
-- FIX 3 — DJ "Portalis"
-- → paulsneakers8@gmail.com
-- ============================================================
UPDATE djs
SET user_id = (
  SELECT id FROM auth.users
  WHERE email = 'paulsneakers8@gmail.com'
  LIMIT 1
)
WHERE stage_name ILIKE '%portalis%'
   OR (first_name ILIKE '%paul%' AND last_name ILIKE '%sneaker%');

-- ============================================================
-- FIX 4 — Promoteur Irish club (profil Paul Brisebois)
-- → paulsneakers8@gmail.com
-- ============================================================
UPDATE promoters
SET user_id = (
  SELECT id FROM auth.users
  WHERE email = 'paulsneakers8@gmail.com'
  LIMIT 1
)
WHERE venue_id = (
  SELECT id FROM venues
  WHERE name ILIKE '%Canavan%' OR name ILIKE '%irish%'
  LIMIT 1
)
AND (
  first_name ILIKE '%paul%'
  OR last_name ILIKE '%brisebois%'
  OR last_name ILIKE '%briseboi%'
);

-- ============================================================
-- VÉRIFICATION FINALE
-- ============================================================
SELECT 'owner irish' AS fix, v.name AS entity, au.email AS linked_to
FROM venues v
JOIN auth.users au ON v.owner_id = au.id
WHERE v.name ILIKE '%Canavan%' OR v.name ILIKE '%irish%'

UNION ALL

SELECT 'organizer vida events', op.display_name, au.email
FROM organizer_profiles op
JOIN auth.users au ON op.user_id = au.id
WHERE op.display_name ILIKE '%vida%'

UNION ALL

SELECT 'dj portalis', d.stage_name, au.email
FROM djs d
JOIN auth.users au ON d.user_id = au.id
WHERE d.stage_name ILIKE '%portalis%'

UNION ALL

SELECT 'promoter irish', p.promo_code, au.email
FROM promoters p
JOIN auth.users au ON p.user_id = au.id
WHERE p.venue_id = (
  SELECT id FROM venues
  WHERE name ILIKE '%Canavan%' OR name ILIKE '%irish%'
  LIMIT 1
)

UNION ALL

SELECT 'profile_type paulsneakers', p.email, p.profile_type::text
FROM profiles p
JOIN auth.users au ON p.id = au.id
WHERE au.email = 'paulsneakers8@gmail.com';
