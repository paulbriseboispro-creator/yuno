-- ============================================================================
-- Portes d'autorisation : elles rendent « faux », jamais NULL.
--
-- Même piège que crm_scope_writable (20261005105000) et _email_scope_guard
-- (20261005106000), cette fois dans les portes partagées de la Suite. Une porte
-- SQL qui compare `x = auth.uid()` ou `get_user_venue_id(uid) = club` rend NULL
-- dès qu'un des deux côtés est NULL, et les appelants testent
-- `IF NOT porte(...) THEN RAISE` : NOT NULL vaut NULL, le IF ne lève pas.
--
-- Prouvé le 04/10 en transaction annulée (rien n'est resté) :
--   * can_manage_organizer rend NULL pour un visiteur SANS session. Avec la
--     seule clé publique, get_organizer_customer_segments rendait la base
--     clients complète de n'importe quel organisateur (3 687 lignes avec
--     e-mail, nom, téléphone sur le compte démo), et
--     organizer_save_customer_note écrivait sur ses fiches clients.
--   * is_organizer_promoter_admin rend NULL pour anon : contrats et règlements
--     agence ↔ organisateur passaient la garde (settle_club_to_agency,
--     sign_agency_venue_contract, set_agency_contract_status…).
--   * can_staff_flag_venue, is_night_staff_of_venue, can_run_bar et
--     can_run_vip_service rendent NULL pour un membre du staff SANS club
--     (profiles.venue_id NULL, le cas du staff d'un organisateur : un videur
--     et deux hôtes VIP en production) : staff_ban_customer et
--     get_staff_night_pulse s'ouvraient sur n'importe quel club, et les
--     gardes du service VIP et du bar (vip_serve_*, bar_redeem_units,
--     claim_order_prep) tiennent à ces deux dernières portes.
--   * can_read_audience rend NULL pour un sujet NULL (sans fuite : la lecture
--     qui suit ne trouve rien).
-- can_view_organizer_promoters, can_access_partnership et
-- can_read_staff_notification n'ont aujourd'hui que des appelants positifs
-- (policies RLS, où NULL et faux refusent pareil) : corrigées par prudence.
--
-- Corps repris de la base liée (pg_get_functiondef, 04/10) ; seul un
-- COALESCE(…, false) les entoure. Aucune policy ne nie ces portes (vérifié
-- dans pg_policies) : la RLS ne change pas. Les fonctions de la Console qui ne
-- tenaient qu'à ces portes (clients d'un organisateur, signalements du staff)
-- ne sont plus exécutables par anon : aucun écran public ne les appelle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_manage_organizer(p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    is_super_admin()
    OR p_organizer_user_id = auth.uid()
    OR is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_organizer_promoter_admin(_user_id uuid, _organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    _user_id = _organizer_user_id
      OR public.is_org_team_member(_user_id, _organizer_user_id, 'admin')
      OR public.is_super_admin()
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_view_organizer_promoters(_user_id uuid, _organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    _user_id = _organizer_user_id
      OR public.is_org_team_member(_user_id, _organizer_user_id, 'editor')
      OR public.org_member_has_permission(_user_id, _organizer_user_id, 'view_finance')
      OR public.is_super_admin()
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_access_partnership(_user_id uuid, _venue_id text, _organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    public.is_venue_owner(_user_id, _venue_id)
    OR _organizer_user_id = _user_id
    OR public.is_org_team_member(_user_id, _organizer_user_id, 'admin')
    OR public.is_super_admin()
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_staff_flag_venue(p_venue_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    is_super_admin()
    OR is_venue_owner(auth.uid(), p_venue_id)
    OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')
    OR (has_role(auth.uid(), 'bouncer') AND get_user_venue_id(auth.uid()) = p_venue_id)
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_night_staff_of_venue(p_venue_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    is_super_admin()
    OR is_venue_owner(auth.uid(), p_venue_id)
    OR manager_has_permission(auth.uid(), p_venue_id, 'staff')
    OR (
      get_user_venue_id(auth.uid()) = p_venue_id
      AND (
        has_role(auth.uid(), 'bouncer')
        OR has_role(auth.uid(), 'barman')
        OR has_role(auth.uid(), 'cloakroom')
        OR has_role(auth.uid(), 'vip_host')
      )
    )
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_run_bar(p_uid uuid, p_venue text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    p_uid IS NOT NULL AND p_venue IS NOT NULL AND (
    public.is_super_admin()
    OR public.is_venue_owner(p_uid, p_venue)
    OR (public.get_user_venue_id(p_uid) = p_venue
        AND (public.has_role(p_uid, 'barman') OR public.has_role(p_uid, 'manager')))
  )
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_run_vip_service(p_uid uuid, p_venue text, p_include_bar boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    p_uid IS NOT NULL AND p_venue IS NOT NULL AND (
    public.is_super_admin()
    OR public.is_venue_owner(p_uid, p_venue)
    OR public.manager_has_permission(p_uid, p_venue, 'tables')
    OR (
      public.get_user_venue_id(p_uid) = p_venue
      AND (
        public.has_role(p_uid, 'vip_host')
        OR public.has_role(p_uid, 'manager')
        OR (p_include_bar AND public.has_role(p_uid, 'barman'))
      )
    )
  )
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_read_staff_notification(_venue_id text, _target_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    public.is_venue_owner(auth.uid(), _venue_id)
    OR (
      _venue_id = public.get_user_venue_id(auth.uid())
      AND (
        coalesce(_target_role, '') <> 'owner'
        OR public.has_role(auth.uid(), 'owner'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.manager_permissions mp
          WHERE mp.user_id = auth.uid() AND mp.venue_id = _venue_id
        )
      )
    )
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_read_audience(p_subject_type text, p_subject_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN p_subject_type = 'dj' THEN
      p_subject_id::uuid = auth.uid()
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.dj_team_members
         WHERE member_user_id = auth.uid()
           AND dj_user_id = p_subject_id::uuid
           AND status = 'active'
      )
    WHEN p_subject_type = 'venue' THEN
      public.is_venue_owner(auth.uid(), p_subject_id) OR public.is_super_admin()
    WHEN p_subject_type = 'organizer' THEN
      public.can_manage_organizer(p_subject_id::uuid)
    WHEN p_subject_type = 'agency' THEN
      public.is_agency_owner(auth.uid(), p_subject_id::uuid) OR public.is_super_admin()
    ELSE false
  END
  ), false);
$function$;


REVOKE ALL ON FUNCTION public.can_manage_organizer(p_organizer_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_organizer(p_organizer_user_id uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_organizer_promoter_admin(_user_id uuid, _organizer_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organizer_promoter_admin(_user_id uuid, _organizer_user_id uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_view_organizer_promoters(_user_id uuid, _organizer_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_organizer_promoters(_user_id uuid, _organizer_user_id uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_access_partnership(_user_id uuid, _venue_id text, _organizer_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_partnership(_user_id uuid, _venue_id text, _organizer_user_id uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_staff_flag_venue(p_venue_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_staff_flag_venue(p_venue_id text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_night_staff_of_venue(p_venue_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_night_staff_of_venue(p_venue_id text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_run_bar(p_uid uuid, p_venue text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_run_bar(p_uid uuid, p_venue text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_run_vip_service(p_uid uuid, p_venue text, p_include_bar boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_run_vip_service(p_uid uuid, p_venue text, p_include_bar boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_read_staff_notification(_venue_id text, _target_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_staff_notification(_venue_id text, _target_role text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_read_audience(p_subject_type text, p_subject_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_audience(p_subject_type text, p_subject_id text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organizer_customer_segments(p_organizer_user_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.organizer_ban_customer(p_organizer_user_id uuid, p_email text, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organizer_ban_customer(p_organizer_user_id uuid, p_email text, p_reason text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.organizer_unban_customer(p_organizer_user_id uuid, p_email text, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organizer_unban_customer(p_organizer_user_id uuid, p_email text, p_reason text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.organizer_warn_customer(p_organizer_user_id uuid, p_email text, p_reason text, p_details text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organizer_warn_customer(p_organizer_user_id uuid, p_email text, p_reason text, p_details text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.organizer_save_customer_note(p_organizer_user_id uuid, p_email text, p_notes text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organizer_save_customer_note(p_organizer_user_id uuid, p_email text, p_notes text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_ban_customer(p_venue_id text, p_user_id uuid, p_email text, p_reason text, p_first_name text, p_last_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_ban_customer(p_venue_id text, p_user_id uuid, p_email text, p_reason text, p_first_name text, p_last_name text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_unban_customer(p_venue_id text, p_user_id uuid, p_email text, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_unban_customer(p_venue_id text, p_user_id uuid, p_email text, p_reason text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_warn_customer(p_venue_id text, p_user_id uuid, p_email text, p_reason text, p_details text, p_first_name text, p_last_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_warn_customer(p_venue_id text, p_user_id uuid, p_email text, p_reason text, p_details text, p_first_name text, p_last_name text) TO authenticated, service_role;
