-- Packs de billets (billetterie libre) : ranger les billets d'une soirée dans
-- des groupes nommés (« Accès Tia Felisa », « Tia Felisa + Chin Chin »), chacun
-- avec ses propres rounds ou options. La page de choix les montre en sections
-- repliables, ouvertes par défaut.
--
-- Un pack appartient à UNE soirée (`ticket_groups.event_id`). Un billet y entre
-- par `ticket_rounds.group_id`. Le NOM du pack est recopié sur le billet
-- (`ticket_rounds.group_label`, colonne déjà lue par le PDF du billet) par la
-- base seule : tout lecteur hors de la page de choix (paiement, e-mail, Wallet,
-- porte, commandes) dit « Pack · Billet » sans jointure. Deux packs peuvent donc
-- avoir chacun un « First Release » sans que le client ni le videur les confondent.
--
-- `group_label` n'avait aucun écrivain (ancien billet de groupe, jamais livré) :
-- 0 ligne non nulle en prod au 04/11.

CREATE TABLE IF NOT EXISTS public.ticket_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  description text CHECK (description IS NULL OR char_length(description) <= 200),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_groups_event ON public.ticket_groups (event_id, position);

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.ticket_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_rounds_group ON public.ticket_rounds (group_id) WHERE group_id IS NOT NULL;

-- ── Qui écrit un pack : exactement qui écrit les billets de la soirée ────────
-- Miroir de l'union des policies d'écriture de ticket_rounds (club : owner ou
-- manager « tickets », owner rattaché ; organisateur seul ; gestion de soirée
-- par can_manage_event_tables, co-hôte éditeur compris ; super admin).
CREATE OR REPLACE FUNCTION public.can_manage_ticket_groups(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_super_admin()
    OR public.can_manage_event_tables(_user_id, _event_id)
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = _event_id
        AND (
          (e.venue_id IS NOT NULL AND (
             public.is_venue_owner(_user_id, e.venue_id)
             OR public.manager_has_permission(_user_id, e.venue_id, 'tickets')
          ))
          OR (e.venue_id IS NULL AND e.organizer_user_id = _user_id)
          OR (public.has_role(_user_id, 'owner') AND (
               EXISTS (SELECT 1 FROM public.venues v WHERE v.id = e.venue_id AND v.owner_id = _user_id)
               OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.venue_id = e.venue_id)
          ))
        )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_ticket_groups(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_ticket_groups(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.ticket_groups ENABLE ROW LEVEL SECURITY;

-- Lecture publique, comme les billets (la page de choix est anonyme).
DROP POLICY IF EXISTS "Everyone can view ticket groups" ON public.ticket_groups;
CREATE POLICY "Everyone can view ticket groups" ON public.ticket_groups
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Ticket managers manage ticket groups" ON public.ticket_groups;
CREATE POLICY "Ticket managers manage ticket groups" ON public.ticket_groups
  FOR ALL TO authenticated
  USING (public.can_manage_ticket_groups(auth.uid(), event_id))
  WITH CHECK (public.can_manage_ticket_groups(auth.uid(), event_id));

GRANT SELECT ON public.ticket_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_groups TO authenticated;
GRANT ALL ON public.ticket_groups TO service_role;

-- ── Le billet porte le nom de son pack ──────────────────────────────────────
-- Toujours recalculé : un pack d'une AUTRE soirée (copie d'une soirée, série
-- récurrente qui recopie les billets) est retiré en silence plutôt que de faire
-- échouer la copie ; group_label ne s'écrit jamais à la main.
CREATE OR REPLACE FUNCTION public.ticket_round_group_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.group_id IS NULL THEN
    NEW.group_label := NULL;
    RETURN NEW;
  END IF;
  SELECT g.name INTO v_name
    FROM public.ticket_groups g
   WHERE g.id = NEW.group_id AND g.event_id = NEW.event_id;
  IF NOT FOUND THEN
    NEW.group_id := NULL;
    NEW.group_label := NULL;
  ELSE
    NEW.group_label := v_name;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_round_group_label() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_round_group_label ON public.ticket_rounds;
CREATE TRIGGER trg_ticket_round_group_label
  BEFORE INSERT OR UPDATE OF group_id, group_label, event_id ON public.ticket_rounds
  FOR EACH ROW EXECUTE FUNCTION public.ticket_round_group_label();

-- Renommer un pack renomme ses billets ; le supprimer les remet hors pack.
CREATE OR REPLACE FUNCTION public.ticket_group_sync_rounds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.ticket_rounds SET group_id = NULL WHERE group_id = OLD.id;
    RETURN OLD;
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.description := NULLIF(btrim(COALESCE(NEW.description, '')), '');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ticket_group_rename_rounds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.ticket_rounds SET group_label = NEW.name WHERE group_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_group_sync_rounds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ticket_group_rename_rounds() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_group_normalize ON public.ticket_groups;
CREATE TRIGGER trg_ticket_group_normalize
  BEFORE INSERT OR UPDATE ON public.ticket_groups
  FOR EACH ROW EXECUTE FUNCTION public.ticket_group_sync_rounds();

DROP TRIGGER IF EXISTS trg_ticket_group_release_rounds ON public.ticket_groups;
CREATE TRIGGER trg_ticket_group_release_rounds
  BEFORE DELETE ON public.ticket_groups
  FOR EACH ROW EXECUTE FUNCTION public.ticket_group_sync_rounds();

DROP TRIGGER IF EXISTS trg_ticket_group_rename_rounds ON public.ticket_groups;
CREATE TRIGGER trg_ticket_group_rename_rounds
  AFTER UPDATE OF name ON public.ticket_groups
  FOR EACH ROW EXECUTE FUNCTION public.ticket_group_rename_rounds();

-- ── La liste de porte (hors ligne comprise) dit « Pack · Billet » ───────────
-- Remplacement ciblé dans la définition VIVANTE de get_event_scan_manifest
-- (jamais recopiée d'un ancien fichier) : seul le libellé du tarif change.
DO $$
DECLARE
  v_def text;
  v_new text;
  v_from text := '''round'', tr.name';
  v_to   text := '''round'', CASE WHEN NULLIF(btrim(tr.group_label), '''') IS NULL THEN tr.name ELSE btrim(tr.group_label) || '' · '' || tr.name END';
BEGIN
  v_def := pg_get_functiondef('public.get_event_scan_manifest(uuid)'::regprocedure);
  IF position(v_to IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 2 THEN
    RAISE EXCEPTION 'get_event_scan_manifest: expected 2 round labels';
  END IF;
  v_new := replace(v_def, v_from, v_to);
  EXECUTE v_new;
END
$$;
