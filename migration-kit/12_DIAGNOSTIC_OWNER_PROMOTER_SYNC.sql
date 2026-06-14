-- ============================================================
-- DIAGNOSTIC & CORRECTION : Owner-venue et profils promoteur
-- À exécuter dans Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- ============================================================
-- ÉTAPE 1 : Identifier les UUIDs des comptes concernés
-- ============================================================
SELECT
  id   AS user_id,
  email,
  created_at
FROM auth.users
WHERE email IN (
  'paulsneakers8@gmail.com',
  'pbrisebois.ieu2025@student.ie.edu'
)
ORDER BY email;

-- ============================================================
-- ÉTAPE 2 : Vérifier les rôles dans user_roles
-- ============================================================
SELECT
  ur.user_id,
  ur.role,
  au.email
FROM user_roles ur
JOIN auth.users au ON ur.user_id = au.id
WHERE au.email IN (
  'paulsneakers8@gmail.com',
  'pbrisebois.ieu2025@student.ie.edu'
)
ORDER BY au.email, ur.role;

-- ============================================================
-- ÉTAPE 3 (OWNER) : Vérifier quel venue pointe vers ces users
-- ============================================================
SELECT
  v.id        AS venue_id,
  v.name      AS venue_name,
  v.owner_id,
  au.email    AS owner_email
FROM venues v
LEFT JOIN auth.users au ON v.owner_id = au.id
WHERE
  v.name ILIKE '%irish%'
  OR v.owner_id IN (
    SELECT id FROM auth.users
    WHERE email IN (
      'paulsneakers8@gmail.com',
      'pbrisebois.ieu2025@student.ie.edu'
    )
  )
ORDER BY v.name;

-- ============================================================
-- ÉTAPE 4 (PROMOTEUR) : Vérifier les profils dans la table promoters
-- ============================================================
SELECT
  p.id,
  p.user_id,
  p.venue_id,
  v.name      AS venue_name,
  p.promo_code,
  p.is_active,
  au.email
FROM promoters p
JOIN auth.users au ON p.user_id = au.id
LEFT JOIN venues v ON p.venue_id = v.id
WHERE au.email = 'paulsneakers8@gmail.com'
ORDER BY p.is_active DESC, p.created_at;

-- ============================================================
-- CORRECTION A : Relier pbrisebois.ieu2025 comme owner du club Irish
-- Remplace [UUID_PBRISEBOIS] par l'UUID trouvé à l'étape 1
-- ============================================================
-- UPDATE venues
-- SET owner_id = '[UUID_PBRISEBOIS]'
-- WHERE name ILIKE '%irish%';

-- ============================================================
-- CORRECTION B1 : Réactiver un profil promoteur existant mais inactif
-- (si l'étape 4 montre is_active = false)
-- Remplace [UUID_PAULSNEAKERS] par l'UUID trouvé à l'étape 1
-- ============================================================
-- UPDATE promoters
-- SET is_active = true
-- WHERE user_id = '[UUID_PAULSNEAKERS]';

-- ============================================================
-- CORRECTION B2 : Créer un profil promoteur si inexistant
-- (si l'étape 4 ne retourne aucune ligne)
-- Remplace [UUID_PAULSNEAKERS] et [UUID_VENUE] par les vrais IDs
-- Le promo_code doit être unique — ex: 'PAULSNEAKERS'
-- ============================================================
-- INSERT INTO promoters (
--   user_id,
--   venue_id,
--   promo_code,
--   is_active,
--   ticket_commission_type,
--   ticket_commission_value,
--   table_commission_type,
--   table_commission_value
-- ) VALUES (
--   '[UUID_PAULSNEAKERS]',
--   '[UUID_VENUE]',
--   'PAULSNEAKERS',
--   true,
--   'percentage',
--   0,
--   'percentage',
--   0
-- )
-- ON CONFLICT DO NOTHING;

-- ============================================================
-- VÉRIFICATION FINALE
-- ============================================================
SELECT 'owner check' AS check_type,
  v.name, v.owner_id::text AS detail, au.email
FROM venues v
LEFT JOIN auth.users au ON v.owner_id = au.id
WHERE v.name ILIKE '%irish%'
UNION ALL
SELECT 'promoter check',
  COALESCE(v.name, '(no venue)'), p.promo_code, au.email
FROM promoters p
JOIN auth.users au ON p.user_id = au.id
LEFT JOIN venues v ON p.venue_id = v.id
WHERE au.email = 'paulsneakers8@gmail.com';
