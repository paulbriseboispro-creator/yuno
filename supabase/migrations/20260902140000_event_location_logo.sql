-- Logo du LIEU d'une soirée sans club Yuno.
--
-- Une soirée montée par un organisateur peut se tenir dans un endroit qui n'est
-- pas un club Yuno : le lieu ne vit alors que dans `location_name` /
-- `location_address`, en texte libre, sans aucune ligne `venues` à laquelle
-- accrocher une image. Les surfaces publiques (Explore faible densité, page
-- soirée) rendaient donc un cadre vide à la place du logo.
--
-- Cette colonne donne au lieu en texte libre la même identité visuelle qu'un
-- club : l'organisateur téléverse le logo depuis le formulaire de soirée, au
-- même endroit qu'il saisit le nom et l'adresse.
--
-- Rien à ouvrir côté RLS : `events` est déjà lisible publiquement pour les
-- soirées publiques et actives, et l'écriture reste réservée à l'organisateur
-- (mêmes policies que `location_name`, qui vit dans la même table).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS location_logo_url text;

COMMENT ON COLUMN public.events.location_logo_url IS
  'Logo du lieu en texte libre (soirée sans club Yuno). NULL quand la soirée se tient dans un club : le logo vient alors de venues.logo_url.';
