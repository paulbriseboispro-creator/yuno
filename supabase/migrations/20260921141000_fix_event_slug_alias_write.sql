-- =============================================================================
-- Renommer une soirée levait 42501 — pour TOUT LE MONDE
-- =============================================================================
-- `event_slug_aliases` garde l'ancienne adresse publique d'une soirée pour que
-- les liens déjà partagés continuent de résoudre. La table a la RLS activée et
-- AUCUNE policy : c'est voulu, personne n'écrit son historique d'URL à la main.
--
-- Mais le trigger qui l'alimente, `sync_event_slug`, était resté SECURITY
-- INVOKER : il écrivait donc avec les droits de l'appelant, et se faisait
-- refuser par sa propre table. Conséquence mesurée le 2026-09-21 (bloc DO
-- annulé, `SET LOCAL ROLE authenticated` avec les claims de l'organisateur) :
--
--     UPDATE events SET title = '…'
--     → 42501 new row violates row-level security policy for "event_slug_aliases"
--
-- Autrement dit, changer le TITRE d'une soirée échouait pour l'organisateur
-- lui-même, pour le club, et pour l'équipe. Seul un appel service_role passait.
-- Le renommage ne se voyait que sur une soirée dont le slug n'avait jamais été
-- posé (OLD.slug NULL), d'où un bug intermittent et jamais attribué.
--
-- Les quatre triggers frères — `sync_venue_slug`, `sync_organizer_slug`,
-- `sync_affiliate_linktree_slug`, `sync_member_linktree_slug` — sont DÉJÀ
-- SECURITY DEFINER. `sync_event_slug` était le seul oublié ; on l'aligne.
--
-- Sûreté : la ligne écrite est entièrement dérivée du système (`NEW.id` et
-- `OLD.slug`), rien ne vient de l'appelant, et le trigger ne s'exécute qu'après
-- qu'une policy d'UPDATE sur `events` a déjà laissé passer la modification. On
-- n'ouvre donc aucune porte : on laisse la table tenir son propre historique.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_event_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_new text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := public.gen_event_slug(NEW.title, NEW.id, NEW.organizer_user_id, NEW.venue_id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : un slug explicitement modifié l'emporte (on ne le réécrit pas).
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;
  -- Renommage OU changement de host : resynchroniser, archiver l'ancien.
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.organizer_user_id IS DISTINCT FROM OLD.organizer_user_id
     OR (NEW.organizer_user_id IS NULL AND NEW.venue_id IS DISTINCT FROM OLD.venue_id) THEN
    v_new := public.gen_event_slug(NEW.title, NEW.id, NEW.organizer_user_id, NEW.venue_id);
    IF v_new IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL THEN
      INSERT INTO public.event_slug_aliases (event_id, slug)
        VALUES (NEW.id, OLD.slug) ON CONFLICT (event_id, slug) DO NOTHING;
      NEW.slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

COMMENT ON FUNCTION public.sync_event_slug() IS
  'Tient le slug d''une soirée et archive l''ancien dans event_slug_aliases. SECURITY DEFINER comme ses quatre triggers frères : la table d''alias n''a aucune policy, un trigger INVOKER s''y faisait refuser et cassait tout renommage de soirée.';
