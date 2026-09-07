-- Une formule VIP portait DEUX champs de texte libre : `description`, saisie par
-- le pro dans les trois formulaires (club, organisateur, co-soirée) et rendue
-- par AUCUNE surface client, et `included_items`, le seul texte que le client
-- voyait réellement. Le pro écrivait donc dans le vide.
--
-- On garde `description` (le mot que le pro comprend, le champ qu'il remplit) et
-- on abandonne `included_items` : ce qui est inclus se dira dans la description.
-- Avant d'arrêter d'afficher `included_items`, on recopie son contenu dans les
-- descriptions restées vides — sinon les formules déjà décrites en production
-- perdraient leur texte au premier déploiement.
UPDATE public.table_packs
SET description = included_items
WHERE included_items IS NOT NULL
  AND btrim(included_items) <> ''
  AND (description IS NULL OR btrim(description) = '');

-- La colonne `included_items` reste en base : elle ne coûte rien, elle garde la
-- trace de ce qui a été saisi, et la supprimer casserait les bundles OTA encore
-- installés qui la sélectionnent encore. Les formulaires ne l'écrivent plus.
COMMENT ON COLUMN public.table_packs.included_items IS
  'Obsolète depuis 2026-09-07 : le texte libre d''une formule vit dans `description`. Conservée en lecture seule pour l''historique.';
