-- ============================================================================
-- Yuno CRM — les portes de portée rendent « faux », jamais NULL.
--
-- crm_scope_writable, crm_scope_sees_money et crm_user_manages_team testent
-- `crm_org_role(...) IN (...)`. Pour un compte qui n'est pas de l'espace,
-- crm_org_role rend NULL, `NULL IN (...)` vaut NULL et toute la porte rendait
-- NULL. Or les écritures testent `IF NOT porte(...) THEN RAISE` : NOT NULL est
-- NULL, le IF ne lève pas, et l'écriture passait (import de contacts,
-- segments, réglages, fiche client, rôle ou retrait d'un membre d'équipe sur
-- l'espace d'un autre). Même piège que `uid IN (a, NULL)`.
--
-- Corps repris de la base liée (pg_get_functiondef, 04/10), seul un
-- COALESCE(…, false) les entoure.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_scope_writable(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
    COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND public.crm_org_role(auth.uid(), p_organizer_user_id) IN ('owner', 'admin', 'editor'))
    ))), false);
$function$;

CREATE OR REPLACE FUNCTION public.crm_scope_sees_money(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.venue_id = p_venue_id AND mp.user_id = auth.uid()
                          AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)))))
      OR (p_organizer_user_id IS NOT NULL AND (
            public.crm_org_role(auth.uid(), p_organizer_user_id) IN ('owner', 'admin')
            OR public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')))
    )), false);
$function$;

CREATE OR REPLACE FUNCTION public.crm_user_manages_team(p_user_id uuid, p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(p_user_id IS NOT NULL AND (
    public.is_super_admin()
    OR (p_venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = p_user_id))
    OR (p_organizer_user_id IS NOT NULL AND (
          public.crm_org_role(p_user_id, p_organizer_user_id) IN ('owner', 'admin')
          OR public.org_member_has_permission(p_user_id, p_organizer_user_id, 'manage_team')))), false);
$function$;

REVOKE ALL ON FUNCTION public.crm_scope_writable(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_writable(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_scope_sees_money(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_scope_sees_money(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) TO authenticated, service_role;
