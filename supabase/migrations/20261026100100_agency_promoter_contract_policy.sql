-- ============================================================================
-- SEC-09 (2/2) — Un chef d'agence ne place un promoteur que chez un club (ou
-- un organisateur) avec qui son agence a un contrat ACTIF.
--
-- Constaté sur la prod le 18/10 (lecture seule, audit CRM, BACKLOG 16i) : la
-- policy « Agency owner manages own promoters » de `promoters` est un ALL dont
-- USING et WITH CHECK ne regardent que l'agence :
--   (agency_id IS NOT NULL AND is_agency_owner(auth.uid(), agency_id))
-- `venue_id` et `organizer_user_id` n'y sont jamais vérifiés. Un chef d'agence
-- pouvait donc, par un simple POST / PATCH PostgREST :
--   • créer un promoteur de son agence dans n'importe quel club, avec ses
--     propres taux de commission et de remise ;
--   • déplacer un de ses promoteurs vers un autre club.
-- Ce promoteur est alors « du club » pour tout le reste : les checkouts le
-- trouvent par son code sur les soirées de ce club (remise sur la caisse du
-- club, commission à sa charge), `record_promoter_conversion` le voit dans le
-- périmètre. Le parcours normal, lui, exige déjà un contrat actif :
-- `invite-promoter` refuse `no_active_contract`, et la fiche est créée en
-- service_role par `accept-promoter-invitation`.
-- Prouvé au banc sur les définitions de la prod (scripts/crm-bench/sec09.mjs).
--
-- Ce que fait cette migration, et rien d'autre :
--   • `agency_owner_can_place_promoter(agence, club, organisateur)` : l'appelant
--     est chef de l'agence ET chaque périmètre renseigné (club, organisateur) a
--     un contrat `active` avec elle (au moins un périmètre) ;
--   • `promoter_agency_scope_unchanged(id, agence, club, organisateur)` : la
--     fiche existe déjà, pour cette agence, avec ce même club et ce même
--     organisateur (lue sous les droits du propriétaire : une policy de
--     `promoters` ne peut pas relire `promoters` sans récursion) ;
--   • la policy ALL est remplacée par quatre policies, une par commande :
--       SELECT  inchangé (l'agence voit tous ses promoteurs, contrat fini compris) ;
--       INSERT  exige un contrat actif pour le périmètre de la nouvelle fiche ;
--       UPDATE  USING inchangé ; WITH CHECK = contrat actif pour le nouveau
--               périmètre, OU périmètre inchangé (une agence dont le contrat
--               est en pause ou fini gère encore ses fiches : groupes, plafonds,
--               ventes autorisées, comme aujourd'hui) ;
--       DELETE  inchangé (SEC-08 traite la suppression à part).
-- Les autres policies de la table (club, manager, organisateur, promoteur,
-- super admin) ne changent pas. Rien côté front : l'app agence n'écrit que
-- agency_can_sell_*, agency_*_cap et agency_group_id, sans toucher au
-- périmètre ; la fiche naît toujours en service_role.
--
-- Répéter avant d'appliquer : node scripts/crm-bench/sec09.mjs run (banc),
-- puis la répétition annulée sur la prod (voir 20261026100000).
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Remet la policy de la prod du 18/10 (et donc la faille) :
--
--   DROP POLICY IF EXISTS "Agency owner views own promoters" ON public.promoters;
--   DROP POLICY IF EXISTS "Agency owner adds promoters under an active contract" ON public.promoters;
--   DROP POLICY IF EXISTS "Agency owner updates own promoters" ON public.promoters;
--   DROP POLICY IF EXISTS "Agency owner removes own promoters" ON public.promoters;
--   CREATE POLICY "Agency owner manages own promoters" ON public.promoters
--     AS PERMISSIVE FOR ALL TO authenticated
--     USING ((agency_id IS NOT NULL) AND is_agency_owner(auth.uid(), agency_id))
--     WITH CHECK ((agency_id IS NOT NULL) AND is_agency_owner(auth.uid(), agency_id));
--   DROP FUNCTION IF EXISTS public.agency_owner_can_place_promoter(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.promoter_agency_scope_unchanged(uuid, uuid, text, uuid);
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261026100100';
--
-- (bloc 7 de docs/audit/2026-10-18-crm-readiness/ROLLBACK.sql)
-- ============================================================================

-- ── 1. Le chef d'agence peut-il placer un promoteur dans ce périmètre ? ─────
CREATE OR REPLACE FUNCTION public.agency_owner_can_place_promoter(
  p_agency_id uuid,
  p_venue_id text,
  p_organizer_user_id uuid
)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_agency_id IS NOT NULL
     AND (p_venue_id IS NOT NULL OR p_organizer_user_id IS NOT NULL)
     AND public.is_agency_owner(auth.uid(), p_agency_id)
     AND (p_venue_id IS NULL OR EXISTS (
           SELECT 1 FROM public.agency_venue_contracts c
            WHERE c.agency_id = p_agency_id
              AND c.venue_id = p_venue_id
              AND c.status = 'active'))
     AND (p_organizer_user_id IS NULL OR EXISTS (
           SELECT 1 FROM public.agency_venue_contracts c
            WHERE c.agency_id = p_agency_id
              AND c.organizer_user_id = p_organizer_user_id
              AND c.status = 'active'));
$function$;

REVOKE ALL ON FUNCTION public.agency_owner_can_place_promoter(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_owner_can_place_promoter(uuid, text, uuid) TO authenticated, service_role;

-- ── 2. La fiche garde-t-elle son agence et son périmètre ? ──────────────────
-- Ne répond que pour une agence dont l'appelant est le chef : on ne sonde pas
-- le périmètre d'une fiche d'une autre agence.
CREATE OR REPLACE FUNCTION public.promoter_agency_scope_unchanged(
  p_promoter_id uuid,
  p_agency_id uuid,
  p_venue_id text,
  p_organizer_user_id uuid
)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_agency_id IS NOT NULL
     AND public.is_agency_owner(auth.uid(), p_agency_id)
     AND EXISTS (
       SELECT 1 FROM public.promoters p
        WHERE p.id = p_promoter_id
          AND p.agency_id = p_agency_id
          AND p.venue_id IS NOT DISTINCT FROM p_venue_id
          AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id);
$function$;

REVOKE ALL ON FUNCTION public.promoter_agency_scope_unchanged(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promoter_agency_scope_unchanged(uuid, uuid, text, uuid) TO authenticated, service_role;

-- ── 3. Une policy par commande à la place du ALL ────────────────────────────
DROP POLICY IF EXISTS "Agency owner manages own promoters" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner views own promoters" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner adds promoters under an active contract" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner updates own promoters" ON public.promoters;
DROP POLICY IF EXISTS "Agency owner removes own promoters" ON public.promoters;

CREATE POLICY "Agency owner views own promoters" ON public.promoters
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id IS NOT NULL) AND public.is_agency_owner(auth.uid(), agency_id));

CREATE POLICY "Agency owner adds promoters under an active contract" ON public.promoters
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((agency_id IS NOT NULL)
    AND public.agency_owner_can_place_promoter(agency_id, venue_id, organizer_user_id));

CREATE POLICY "Agency owner updates own promoters" ON public.promoters
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((agency_id IS NOT NULL) AND public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK ((agency_id IS NOT NULL)
    AND (public.agency_owner_can_place_promoter(agency_id, venue_id, organizer_user_id)
         OR public.promoter_agency_scope_unchanged(id, agency_id, venue_id, organizer_user_id)));

CREATE POLICY "Agency owner removes own promoters" ON public.promoters
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((agency_id IS NOT NULL) AND public.is_agency_owner(auth.uid(), agency_id));
