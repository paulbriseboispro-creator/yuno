-- Guest list perso DJ — nouvelle relation DJ <-> owner/orga.
-- Un DJ d'un line-up peut recevoir de son club/orga une allocation de places
-- guest list (quota fixe par l'hote) qu'il partage via un lien prive.
-- Choix d'archi : on REUTILISE la table guest_lists existante (colonne dj_id)
-- plutot qu'une table separee, pour que le scanner de porte, le decompte owner,
-- la RFM et surtout l'edge function create-guest-list-entry marchent SANS modif.
-- La GL DJ porte le venue_id (ou organizer_user_id) de l'hote + un dj_id : le
-- videur/owner voient automatiquement ses invites (la policy SELECT de
-- guest_list_entries joint via guest_lists.venue_id).

-- =============================================================================
-- 1. Colonne proprietaire DJ
-- =============================================================================
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS dj_id uuid REFERENCES public.djs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_guest_lists_dj ON public.guest_lists(dj_id) WHERE dj_id IS NOT NULL;

-- =============================================================================
-- 2. Unicite : 1 liste hote + 1 liste par DJ par event
--    (avant : UNIQUE(event_id) = 1 seule liste/event, bloquait la coexistence).
--    On retrouve le nom reel de la contrainte (auto-genere) via sa definition
--    pour eviter de dependre d'un nom devine.
-- =============================================================================
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.guest_lists'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (event_id)';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guest_lists DROP CONSTRAINT %I', c);
  END IF;
END $$;

-- Une seule liste "hote" (venue/orga, dj_id NULL) par event — preserve l'invariant existant.
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_host_uniq
  ON public.guest_lists(event_id) WHERE dj_id IS NULL;

-- Une seule liste par (event, DJ).
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_dj_uniq
  ON public.guest_lists(event_id, dj_id) WHERE dj_id IS NOT NULL;

-- Le CHECK (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL) reste valide :
-- une GL DJ porte toujours le venue_id/organizer_user_id de l'hote.

-- =============================================================================
-- 3. RLS — le DJ lit les inscrits de SES listes (en plus des policies
--    owner/orga existantes, qui couvrent deja la gestion via venue_id/organizer).
--    La ligne guest_lists elle-meme est deja lisible par tous (policy "Anyone can
--    view active guest lists" USING (true)) : le DJ accede a son share_token.
-- =============================================================================
DROP POLICY IF EXISTS "DJs read own guest list entries" ON public.guest_list_entries;
CREATE POLICY "DJs read own guest list entries"
  ON public.guest_list_entries FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.guest_lists gl
    JOIN public.djs d ON d.id = gl.dj_id
    WHERE gl.id = guest_list_entries.guest_list_id
      AND d.user_id = auth.uid()
  ));
