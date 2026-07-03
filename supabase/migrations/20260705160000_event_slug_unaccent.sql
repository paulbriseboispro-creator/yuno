-- Slugs d'events : translittérer les accents avant de slugifier.
-- Avant : `regexp_replace(lower(title), '[^a-z0-9]+', '-')` SUPPRIMAIT les lettres accentuées
-- → « Jeudi Étudiant » donnait `jeudi-tudiant`, « Soirée Été » → `soire-t`. Moche pour une
-- app FR. On passe le titre par `unaccent()` d'abord → `jeudi-etudiant`, `soiree-ete`.
-- Sûr maintenant : la feature vient de sortir, aucun lien d'event partagé/indexé encore.

-- Supabase installe les extensions dans le schéma `extensions` -> on qualifie l'appel
-- (`extensions.unaccent`) pour ne dépendre d'aucun search_path.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.gen_event_slug(
  p_title text,
  p_event_id uuid DEFAULT NULL,
  p_org uuid DEFAULT NULL,
  p_venue text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(lower(extensions.unaccent(coalesce(p_title, 'event'))), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' THEN base := 'event'; END IF;
  cand := base;
  WHILE EXISTS (
          SELECT 1 FROM public.events e
           WHERE e.slug = cand
             AND e.id IS DISTINCT FROM p_event_id
             AND ( (p_org IS NOT NULL  AND e.organizer_user_id = p_org)
                OR (p_org IS NULL      AND e.organizer_user_id IS NULL AND e.venue_id IS NOT DISTINCT FROM p_venue) )
        )
     OR EXISTS (
          SELECT 1 FROM public.event_slug_aliases a
            JOIN public.events e ON e.id = a.event_id
           WHERE a.slug = cand
             AND a.event_id IS DISTINCT FROM p_event_id
             AND ( (p_org IS NOT NULL  AND e.organizer_user_id = p_org)
                OR (p_org IS NULL      AND e.organizer_user_id IS NULL AND e.venue_id IS NOT DISTINCT FROM p_venue) )
        )
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

-- Régénère UNIQUEMENT les titres accentués (les seuls slugs abîmés), en boucle ordonnée
-- (chaque UPDATE est vu par le gen suivant -> désambiguïsation -2/-3 correcte pour les
-- récurrences). Pas de clear massif : on ne touche pas les lignes saines (dont une avec un
-- FK tables_owner_user_id orphelin hérité, qui casserait tout UPDATE — cf. NOT VALID).
-- Aucun lien d'event encore partagé/indexé -> régénération directe, pas d'alias.
DO $$
DECLARE r record; v_new text;
BEGIN
  FOR r IN SELECT id, title, slug, organizer_user_id, venue_id
             FROM public.events
            WHERE title ~ '[àâäáãéèêëíìîïóòôöõúùûüýÿçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÇÑ]'
            ORDER BY created_at NULLS LAST, id LOOP
    v_new := public.gen_event_slug(r.title, r.id, r.organizer_user_id, r.venue_id);
    IF v_new IS DISTINCT FROM r.slug THEN
      UPDATE public.events SET slug = v_new WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
