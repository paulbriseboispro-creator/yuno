-- Fuseau horaire par venue et par événement.
--
-- Contexte : les soirées sont stockées en `timestamptz` (instant absolu, déjà
-- correct). Mais AFFICHER une heure murale (« 23h30 ») exige de connaître le
-- fuseau cible. Jusqu'ici tout le code supposait Europe/Paris en dur, ce qui
-- rendait juste par hasard (toutes les venues sont en FR/ES, même décalage) et
-- a produit le bug des notifications serveur (rendues en UTC → « 21h30 »).
--
-- On matérialise le fuseau comme DONNÉE :
--   • la venue porte son fuseau (dérivé de sa ville, éditable) ;
--   • chaque événement fige le fuseau choisi par l'owner à la publication ;
--   • un trigger fait hériter le fuseau de la venue si l'insertion l'omet, pour
--     qu'aucun chemin de création ne puisse « oublier » le fuseau.

-- ── 1) venues.timezone (dérivé de la ville, éditable) ────────────────────────
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS timezone text;
COMMENT ON COLUMN public.venues.timezone IS
  'Fuseau IANA de la venue (ex. Europe/Paris). Défaut des nouveaux événements. Éditable.';

-- Backfill des venues existantes depuis leur ville connue (FR + ES + voisins).
-- Europe/Paris, Europe/Madrid et Europe/Brussels partagent le même décalage ;
-- seuls Europe/London et Europe/Lisbon (WET) diffèrent réellement.
UPDATE public.venues SET timezone = CASE
  WHEN lower(coalesce(city, '')) IN (
    'madrid','segovia','barcelona','sevilla','seville','valencia','málaga',
    'malaga','bilbao','ibiza','marbella','zaragoza','alicante','granada'
  ) THEN 'Europe/Madrid'
  WHEN lower(coalesce(city, '')) IN (
    'london','londres','manchester','birmingham','liverpool','leeds',
    'glasgow','edinburgh'
  ) THEN 'Europe/London'
  WHEN lower(coalesce(city, '')) IN ('lisbon','lisboa','porto') THEN 'Europe/Lisbon'
  WHEN lower(coalesce(city, '')) IN ('brussels','bruxelles','antwerp','anvers')
    THEN 'Europe/Brussels'
  ELSE 'Europe/Paris'
END
WHERE timezone IS NULL;

-- anon n'a PAS de SELECT au niveau table sur venues (uniquement des grants
-- colonne par colonne). Toute nouvelle colonne lisible côté public DOIT être
-- grantée explicitement, sinon elle est invisible à l'anon (liste vide silencieuse).
GRANT SELECT (timezone) ON public.venues TO anon;
GRANT SELECT (timezone) ON public.venues TO authenticated;

-- ── 2) events.timezone (figé à la publication) ───────────────────────────────
-- Nullable : NULL => on retombe sur Europe/Paris côté lecture (front + edge).
-- Le trigger ci-dessous le remplit depuis la venue quand l'insertion l'omet.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS timezone text;
COMMENT ON COLUMN public.events.timezone IS
  'Fuseau IANA figé à la publication (ex. Europe/Paris). NULL => Europe/Paris à la lecture.';

-- Aligner les événements existants sur le fuseau de leur venue.
UPDATE public.events e
SET timezone = v.timezone
FROM public.venues v
WHERE e.venue_id = v.id
  AND v.timezone IS NOT NULL
  AND e.timezone IS NULL;

-- events a un SELECT au niveau table pour anon/authenticated : la nouvelle
-- colonne est déjà lisible, pas de grant colonne nécessaire.

-- ── 3) Héritage automatique du fuseau venue à l'insertion ────────────────────
-- Garantit qu'aucun chemin de création (formulaire owner/org, récurrents,
-- propositions collab) ne puisse insérer un événement sans fuseau.
-- SECURITY INVOKER (défaut) : ne lit que venues.timezone, aucune écriture
-- sensible, ne discrimine pas sur le rôle.
CREATE OR REPLACE FUNCTION public.events_default_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.timezone IS NULL OR btrim(NEW.timezone) = '' THEN
    SELECT v.timezone INTO NEW.timezone
    FROM public.venues v
    WHERE v.id = NEW.venue_id;
    IF NEW.timezone IS NULL OR btrim(NEW.timezone) = '' THEN
      NEW.timezone := 'Europe/Paris';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_default_timezone ON public.events;
CREATE TRIGGER trg_events_default_timezone
BEFORE INSERT ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.events_default_timezone();
