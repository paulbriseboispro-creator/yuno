-- Guest list "parts / sous-listes" — unifie club / DJ / promoteur / nom-libre en
-- lignes de la table guest_lists. Une soiree = UNE guest list faite de parts, chacune
-- avec son detenteur (holder), son quota, ses perks et son share_token (donc son lien).
--
-- Choix d'archi (suite de 20260621150000_dj_guest_lists.sql) : on continue de REUTILISER
-- guest_lists. Le scanner de porte, le decompte owner, la RFM, get_guest_list_by_token et
-- create-guest-list-entry sont tous agnostiques du type de detenteur (ils ne lisent que
-- guest_list_id / entry.promoter_id). Une part promoteur ne demande donc AUCUNE modif du
-- scanner : la commission se declenche deja depuis guest_list_entries.promoter_id au scan.

-- =============================================================================
-- 1. Nouvelles colonnes
-- =============================================================================
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS holder_type  text,
  ADD COLUMN IF NOT EXISTS holder_label text,
  ADD COLUMN IF NOT EXISTS promoter_id  uuid REFERENCES public.promoters(id) ON DELETE SET NULL;
-- ON DELETE SET NULL (et non CASCADE) : supprimer un promoteur ne doit PAS effacer une part
-- pleine d'invites deja sur la liste de porte. La part survit (promoteur detache), l'owner
-- peut la renommer ou la supprimer. guest_list_entries.promoter_id reste independant.

-- =============================================================================
-- 2. Backfill holder_type des lignes existantes
-- =============================================================================
UPDATE public.guest_lists SET holder_type = 'dj'   WHERE holder_type IS NULL AND dj_id IS NOT NULL;
UPDATE public.guest_lists SET holder_type = 'club' WHERE holder_type IS NULL;  -- tout le reste = la liste hote

-- =============================================================================
-- 3. Garde defensive : si un event a >1 ligne "club" (legacy auto-create de
--    promoter-add-guest qui creait une 2e liste hote), on garde la plus ancienne
--    en 'club' et on relabel les autres en 'custom' pour que l'index club-unique
--    (etape 5) puisse se construire.
-- =============================================================================
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY event_id ORDER BY created_at) AS rn
  FROM public.guest_lists WHERE holder_type = 'club'
)
UPDATE public.guest_lists g
SET holder_type  = 'custom',
    holder_label = COALESCE(g.holder_label, 'Liste ' || left(g.id::text, 4))
FROM ranked
WHERE ranked.id = g.id AND ranked.rn > 1;

-- =============================================================================
-- 4. holder_type = source de verite, contraintes de coherence
-- =============================================================================
ALTER TABLE public.guest_lists
  ALTER COLUMN holder_type SET DEFAULT 'club',
  ALTER COLUMN holder_type SET NOT NULL;

ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_holder_type_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_holder_type_check
  CHECK (holder_type IN ('club','dj','promoter','custom'));

-- Coherence entre holder_type et sa FK / son label :
--   club     -> aucune FK detenteur
--   dj       -> dj_id requis
--   promoter -> promoter_id requis
--   custom   -> holder_label non vide (nom libre, sans compte)
ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_holder_coherence_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_holder_coherence_check CHECK (
    (holder_type = 'club'     AND dj_id IS NULL AND promoter_id IS NULL)
    OR (holder_type = 'dj'       AND dj_id IS NOT NULL)
    OR (holder_type = 'promoter' AND promoter_id IS NOT NULL)
    OR (holder_type = 'custom'   AND holder_label IS NOT NULL AND length(btrim(holder_label)) > 0)
  );

-- =============================================================================
-- 5. LE FIX CRITIQUE — l'ancien guest_lists_event_host_uniq = UNIQUE(event_id)
--    WHERE dj_id IS NULL bloquait toute 2e ligne non-DJ (donc tout part
--    custom/promoteur). On le remplace par une unicite par type de detenteur.
-- =============================================================================
DROP INDEX IF EXISTS public.guest_lists_event_host_uniq;

-- Exactement une part 'club' par event (preserve l'invariant "une liste hote").
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_club_uniq
  ON public.guest_lists(event_id) WHERE holder_type = 'club';

-- Une part par (event, promoteur) : un promoteur = une part par event.
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_promoter_uniq
  ON public.guest_lists(event_id, promoter_id) WHERE holder_type = 'promoter';

-- guest_lists_event_dj_uniq (event, dj_id) : inchange.
-- Parts 'custom' : AUCUNE unicite — plusieurs "Marco", "Team Insta" autorises.

-- Le CHECK de scope (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL) reste
-- valide : chaque part herite du venue_id/organizer_user_id de l'hote.

CREATE INDEX IF NOT EXISTS idx_guest_lists_promoter      ON public.guest_lists(promoter_id) WHERE promoter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_lists_event_holder  ON public.guest_lists(event_id, holder_type);

-- =============================================================================
-- 6. RLS — aucune nouvelle policy.
--    Les owners gerent via les helpers venue_id, les organizers via
--    organizer_user_id = auth.uid(), les DJs lisent via dj_id (20260621150000),
--    le public via is_active AND visible_on_club_page, et le RPC
--    get_guest_list_by_token (SECURITY DEFINER, SELECT *) est holder-agnostic.
--    Les parts custom/promoteur ont visible_on_club_page = false (atteignables
--    seulement par token), ce qui est le comportement voulu.
-- =============================================================================
