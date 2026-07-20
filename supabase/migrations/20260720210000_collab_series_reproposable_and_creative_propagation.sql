-- =============================================================================
-- Co-soirée récurrente : réparer deux blocages sur l'édition d'une série.
--
-- 1. UNICITÉ DU CONTRAT-CADRE — le schéma et la RPC se contredisaient.
--    `template_id uuid NOT NULL UNIQUE` (20260626140000) = UN contrat-cadre par
--    série, À VIE. Mais create_event_collab_series_contract ne refuse que les
--    cadres VIVANTS (« Un contrat-cadre existe déjà »), et son commentaire promet
--    l'inverse du schéma : « un cadre résilié/annulé peut être re-proposé ».
--    Conséquence : dès qu'un cadre a été résilié une fois, le garde métier laisse
--    passer et l'INSERT tape la contrainte UNIQUE. L'owner reçoit
--    « duplicate key value violates unique constraint
--      "event_collab_series_contracts_template_id_key" » en plein visage, sur une
--    sauvegarde où il ne faisait que changer l'affiche.
--    L'unicité devient PARTIELLE : un seul cadre vivant à la fois, autant de
--    cadres résiliés dans l'historique qu'il y a eu de collaborations. C'est
--    l'intention de la RPC, et ça garde la trace des contrats passés (preuve).
--
-- 2. ÉDITION DU VISUEL SANS EFFET — generate_recurring_events fait CONTINUE sur
--    toute date qui a déjà un event, et rien d'autre ne repropage un template
--    modifié. Changer l'affiche d'une série ne repeignait donc QUE les dates pas
--    encore générées : les soirées de la semaine à venir gardaient l'ancienne
--    image, sans que rien ne le dise. « Je change le design, ça ne change pas. »
--    Un trigger propage désormais les champs de CRÉATION aux occurrences FUTURES,
--    en ne touchant qu'aux occurrences restées identiques à l'ancienne valeur du
--    template — une date dont l'affiche a été personnalisée à la main garde la
--    sienne.
-- =============================================================================

-- 1. Unicité partielle : un seul contrat-cadre VIVANT par série ---------------
ALTER TABLE public.event_collab_series_contracts
  DROP CONSTRAINT IF EXISTS event_collab_series_contracts_template_id_key;

DROP INDEX IF EXISTS public.event_collab_series_contracts_live_template_idx;
CREATE UNIQUE INDEX event_collab_series_contracts_live_template_idx
  ON public.event_collab_series_contracts (template_id)
  WHERE status NOT IN ('cancelled', 'terminated');

COMMENT ON INDEX public.event_collab_series_contracts_live_template_idx IS
  'Un seul contrat-cadre vivant (draft/pending_signatures/active) par série. Les cadres résiliés ou annulés restent en historique et n''empêchent pas d''en re-proposer un.';

-- 2. Propagation des champs de création aux occurrences futures ---------------
-- SECURITY DEFINER : l'écriture sur `events` doit passer que l'éditeur soit le
-- club (lead) ou l'organisateur partenaire, sans dépendre des policies UPDATE de
-- `events`. Le garde-fou protect_event_columns_from_partner se retire de lui-même
-- hors du rôle `authenticated` (voir 20260625130000), donc il ne bloque pas ici —
-- et c'est correct : ce trigger ne touche à aucune colonne sensible (partage,
-- structure, mode), uniquement au visuel et au texte.
CREATE OR REPLACE FUNCTION public.propagate_recurring_template_creative()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rien de créatif n'a bougé → aucun balayage.
  IF NEW.name            IS NOT DISTINCT FROM OLD.name
 AND NEW.description      IS NOT DISTINCT FROM OLD.description
 AND NEW.poster_url       IS NOT DISTINCT FROM OLD.poster_url
 AND NEW.poster_position  IS NOT DISTINCT FROM OLD.poster_position
 AND NEW.music_genres     IS NOT DISTINCT FROM OLD.music_genres
 AND NEW.event_type       IS NOT DISTINCT FROM OLD.event_type
  THEN
    RETURN NEW;
  END IF;

  -- Occurrences FUTURES seulement : une soirée déjà commencée ou passée garde son
  -- affiche telle que le public l'a vue au moment d'acheter (cohérent avec
  -- l'immuabilité-à-la-vente du reste du modèle collab).
  --
  -- Chaque colonne n'est réécrite QUE si l'occurrence porte encore l'ANCIENNE
  -- valeur du template. Une date dont l'owner a personnalisé l'affiche ou le titre
  -- à la main n'est pas écrasée par une édition de la série.
  UPDATE public.events e
     SET title           = CASE WHEN e.title IS NOT DISTINCT FROM OLD.name
                                THEN NEW.name ELSE e.title END,
         description     = CASE WHEN e.description IS NOT DISTINCT FROM OLD.description
                                THEN NEW.description ELSE e.description END,
         poster_url      = CASE WHEN e.poster_url IS NOT DISTINCT FROM OLD.poster_url
                                THEN NEW.poster_url ELSE e.poster_url END,
         poster_position = CASE WHEN e.poster_position IS NOT DISTINCT FROM OLD.poster_position
                                THEN NEW.poster_position ELSE e.poster_position END,
         music_genres    = CASE WHEN e.music_genres IS NOT DISTINCT FROM OLD.music_genres
                                THEN NEW.music_genres ELSE e.music_genres END,
         music_genre     = CASE WHEN e.music_genres IS NOT DISTINCT FROM OLD.music_genres
                                THEN COALESCE(NEW.music_genres[1], e.music_genre) ELSE e.music_genre END,
         event_type      = CASE WHEN e.event_type IS NOT DISTINCT FROM OLD.event_type
                                THEN NEW.event_type ELSE e.event_type END
   WHERE e.recurring_template_id = NEW.id
     AND e.start_at > now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_recurring_template_creative ON public.owner_recurring_templates;
CREATE TRIGGER trg_propagate_recurring_template_creative
  AFTER UPDATE OF name, description, poster_url, poster_position, music_genres, event_type
  ON public.owner_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.propagate_recurring_template_creative();
