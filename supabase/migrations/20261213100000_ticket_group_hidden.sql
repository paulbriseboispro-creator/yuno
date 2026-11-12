-- Masquer un pack de billets (billetterie libre), décision de Paul du 12/11 :
-- un pack masqué n'apparaît plus du tout sur la page de choix des billets, et
-- aucun de ses billets ne se vend (le paiement le refuse comme un billet caché).
--
-- `ticket_groups.hidden` est le réglage du pro. Il est recopié sur chaque
-- billet du pack (`ticket_rounds.group_hidden`) par la base seule, comme le nom
-- du pack (`group_label`) : la règle de lecture d'un billet (`ticketPhase`,
-- `isRowListed`, src/lib/freeTicketing.ts ⇄ _shared/free-ticketing.ts) n'a
-- besoin d'aucune jointure, et le checkout (`select *`) le voit tout de suite.
-- Le `hidden` propre de chaque billet n'est jamais touché : afficher de
-- nouveau le pack rend à chaque billet son propre réglage.

ALTER TABLE public.ticket_groups
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS group_hidden boolean NOT NULL DEFAULT false;

-- Le billet porte le nom ET l'état de son pack, toujours recalculés.
CREATE OR REPLACE FUNCTION public.ticket_round_group_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_hidden boolean;
BEGIN
  IF NEW.group_id IS NULL THEN
    NEW.group_label := NULL;
    NEW.group_hidden := false;
    RETURN NEW;
  END IF;
  SELECT g.name, g.hidden INTO v_name, v_hidden
    FROM public.ticket_groups g
   WHERE g.id = NEW.group_id AND g.event_id = NEW.event_id;
  IF NOT FOUND THEN
    NEW.group_id := NULL;
    NEW.group_label := NULL;
    NEW.group_hidden := false;
  ELSE
    NEW.group_label := v_name;
    NEW.group_hidden := COALESCE(v_hidden, false);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_round_group_label() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_round_group_label ON public.ticket_rounds;
CREATE TRIGGER trg_ticket_round_group_label
  BEFORE INSERT OR UPDATE OF group_id, group_label, group_hidden, event_id ON public.ticket_rounds
  FOR EACH ROW EXECUTE FUNCTION public.ticket_round_group_label();

-- Masquer / afficher un pack masque / affiche ses billets.
CREATE OR REPLACE FUNCTION public.ticket_group_hide_rounds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.hidden IS DISTINCT FROM OLD.hidden THEN
    UPDATE public.ticket_rounds SET group_hidden = NEW.hidden WHERE group_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_group_hide_rounds() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_group_hide_rounds ON public.ticket_groups;
CREATE TRIGGER trg_ticket_group_hide_rounds
  AFTER UPDATE OF hidden ON public.ticket_groups
  FOR EACH ROW EXECUTE FUNCTION public.ticket_group_hide_rounds();

-- Demande de Paul : le pack « Chin Chin + Tía Felisa » de House Of Love VOL.1
-- (Amoris) est masqué dès maintenant. Aucun billet vendu dans ce pack.
UPDATE public.ticket_groups
   SET hidden = true
 WHERE event_id = '94ea9bbb-73eb-4f97-8b00-53def4917749'
   AND name = 'Chin Chin + Tía Felisa';
