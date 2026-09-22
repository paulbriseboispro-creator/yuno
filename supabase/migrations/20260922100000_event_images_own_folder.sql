-- event-images : écrire dans SON PROPRE dossier suffit.
--
-- Jusqu'ici, les trois seules portes d'écriture du bucket `event-images`
-- demandaient un RÔLE :
--
--   * has_role(uid, 'owner')                      → le patron d'un club
--   * has_role(uid, 'organizer')                  → personne, ou presque
--   * venues.owner_id / manager_permissions       → le club, encore
--
-- Or « organizer » n'est pas un rôle `user_roles` : un organisateur se
-- reconnaît à `profiles.profile_type`, pas à une ligne de rôle. Les comptes
-- organisateurs RÉELS portent tous `roles = {client}` — les seuls à passer
-- cette porte sont les comptes de démonstration, à qui la ligne 'organizer' a
-- été donnée à la main. La démo cachait donc le trou : un organisateur qui
-- ajoutait la photo d'un artiste invité se faisait refuser l'upload en 403,
-- sans un mot à l'écran, et la photo ne s'affichait jamais.
--
-- La garde juste est celle que `event-posters` applique déjà depuis toujours :
-- le premier dossier du chemin est l'identifiant du compte. On écrit chez soi,
-- on ne touche pas au dossier du voisin, et la question « quel rôle a cette
-- personne ? » ne se pose plus — c'est elle qui a fait fuir les organisateurs,
-- puis les équipes d'organisateur, qui n'ont ni rôle ni club à leur nom.
--
-- Les policies existantes sont CONSERVÉES : elles servent encore les chemins
-- du club qui ne sont pas préfixés par un uid (`events/…-poster.jpg` de la
-- fiche soirée et des soirées récurrentes). Celle-ci s'ajoute à côté.

DROP POLICY IF EXISTS "Own folder upload event images" ON storage.objects;
CREATE POLICY "Own folder upload event images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Own folder update event images" ON storage.objects;
CREATE POLICY "Own folder update event images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Own folder delete event images" ON storage.objects;
CREATE POLICY "Own folder delete event images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);
