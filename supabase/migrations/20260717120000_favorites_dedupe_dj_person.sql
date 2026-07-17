-- Un abonnement DJ vise une PERSONNE, pas une fiche de club.
--
-- Contexte : depuis 20260126201110 (« allow multi-venue »), `djs` n'est plus
-- unique par user_id mais par (user_id, venue_id) — un même DJ a donc une ligne
-- par club où il joue. `favorites.dj_id` pointe l'une de ces lignes, et la
-- contrainte favorites_user_id_favorite_type_dj_id_key ne protège que le triplet
-- (user, type, dj_id). S'abonner à MARCO V depuis le club A puis depuis le club B
-- crée deux lignes parfaitement valides pour la base... et deux cartes dans
-- /favorites pour l'utilisateur, qui lui n'a jamais vu qu'un seul MARCO V.
--
-- Une contrainte UNIQUE ne peut pas exprimer ça : la personne vit dans une AUTRE
-- table (djs.user_id, NOT NULL), et Postgres n'indexe pas au travers d'une
-- jointure. D'où un trigger.

-- ── 1. Nettoyage des doublons déjà en base ───────────────────────────────────
-- On garde le plus ancien abonnement par (utilisateur, personne) : c'est celui
-- qui porte la vraie date d'abonnement.
DELETE FROM public.favorites f
USING (
  SELECT f2.id,
         row_number() OVER (
           PARTITION BY f2.user_id, d2.user_id
           ORDER BY f2.created_at, f2.id
         ) AS rn
  FROM public.favorites f2
  JOIN public.djs d2 ON d2.id = f2.dj_id
  WHERE f2.favorite_type = 'dj'
) dup
WHERE f.id = dup.id
  AND dup.rn > 1;

-- ── 2. Prévention à la source ────────────────────────────────────────────────
-- « Je suis MARCO V » est une intention idempotente : s'abonner via une autre
-- fiche du même DJ remplace l'abonnement existant au lieu de l'empiler. On ne
-- lève pas d'exception — le client ferait échouer un tap parfaitement légitime.
--
-- Le trigger ne touche QUE les lignes de NEW.user_id. Un user_id forgé ferait
-- de toute façon échouer le WITH CHECK de la RLS juste après, et le DELETE
-- serait annulé avec la transaction.
CREATE OR REPLACE FUNCTION public.favorites_dedupe_dj_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person uuid;
BEGIN
  IF NEW.favorite_type IS DISTINCT FROM 'dj' OR NEW.dj_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = NEW.dj_id;
  IF v_person IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.favorites f
  USING public.djs d
  WHERE f.dj_id = d.id
    AND f.user_id = NEW.user_id
    AND f.favorite_type = 'dj'
    AND d.user_id = v_person
    AND f.dj_id IS DISTINCT FROM NEW.dj_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS favorites_dedupe_dj_person_trg ON public.favorites;
CREATE TRIGGER favorites_dedupe_dj_person_trg
  BEFORE INSERT ON public.favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.favorites_dedupe_dj_person();

-- ── 3. Le même trou existe pour les favoris affiliés ─────────────────────────
-- La table d'origine (20251214170816) protégeait venue_id / event_id / drink_id ;
-- dj_id a été rattrapé en 20260217101225, mais affiliate_event_id et
-- affiliate_venue_id ont été ajoutés plus tard sans contrainte. Eux pointent une
-- entité unique (pas de déclinaison par club), donc un simple UNIQUE suffit.
-- NB : sous Postgres, deux NULL ne s'égalent pas — ces contraintes n'affectent
-- donc pas les lignes club/event/drink/dj où la colonne est NULL.
DELETE FROM public.favorites f
USING (
  SELECT id, row_number() OVER (
           PARTITION BY user_id, favorite_type, affiliate_event_id
           ORDER BY created_at, id
         ) AS rn
  FROM public.favorites
  WHERE affiliate_event_id IS NOT NULL
) dup
WHERE f.id = dup.id AND dup.rn > 1;

DELETE FROM public.favorites f
USING (
  SELECT id, row_number() OVER (
           PARTITION BY user_id, favorite_type, affiliate_venue_id
           ORDER BY created_at, id
         ) AS rn
  FROM public.favorites
  WHERE affiliate_venue_id IS NOT NULL
) dup
WHERE f.id = dup.id AND dup.rn > 1;

ALTER TABLE public.favorites
  DROP CONSTRAINT IF EXISTS favorites_user_id_favorite_type_affiliate_event_id_key;
ALTER TABLE public.favorites
  ADD CONSTRAINT favorites_user_id_favorite_type_affiliate_event_id_key
  UNIQUE (user_id, favorite_type, affiliate_event_id);

ALTER TABLE public.favorites
  DROP CONSTRAINT IF EXISTS favorites_user_id_favorite_type_affiliate_venue_id_key;
ALTER TABLE public.favorites
  ADD CONSTRAINT favorites_user_id_favorite_type_affiliate_venue_id_key
  UNIQUE (user_id, favorite_type, affiliate_venue_id);
