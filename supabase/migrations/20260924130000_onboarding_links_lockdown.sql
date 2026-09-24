-- ═══════════════════════════════════════════════════════════════════════════
-- SÉCURITÉ — verrouillage de onboarding_links (prise de contrôle de club).
--
-- La faille (migration 20260701130000) : la policy « Creators manage own
-- onboarding links » (FOR ALL, WITH CHECK created_by = auth.uid()) laissait
-- N'IMPORTE QUEL compte connecté écrire directement dans la table par
-- PostgREST, sans passer par l'edge function qui vérifie les droits :
--   • INSERT { role: 'owner', venue_id: <n'importe quel club> } puis
--     redeem_onboarding_link avec sa propre session → l'edge (service_role)
--     exécutait venues.owner_id = lui : le club changeait de propriétaire ;
--   • UPDATE d'un de ses liens staff pour le changer en lien owner ailleurs ;
--   • lien manager de n'importe quel club avec toutes les permissions ;
--   • lien organisateur sans être super admin.
-- Les policies « équipe du club » et « organisateur » avaient le même trou à
-- leur échelle : un manager (permission staff) pouvait émettre un lien OWNER
-- de son propre club et le récupérer.
--
-- Le front ne lit ni n'écrit jamais cette table : création et utilisation
-- passent par l'edge accept-staff-invitation (service_role), qui porte les
-- vraies règles. Correctif :
--   1. plus AUCUNE écriture client (policies d'écriture supprimées, droits
--      INSERT/UPDATE/DELETE retirés) — la lecture reste pour l'équipe ;
--   2. garde de base (trigger SECURITY INVOKER sur current_user) si un droit
--      d'écriture revenait un jour par erreur ;
--   3. onboarding_link_issuer_allowed() : LA règle « qui peut émettre quoi »,
--      miroir de handleCreateOnboardingLink ;
--   4. révocation de tout lien encore actif émis par quelqu'un qui n'en
--      avait pas le droit ;
--   5. alerte super admin (urgente) pour chaque lien illégitime DÉJÀ utilisé :
--      c'est la liste des comptes et des clubs à contrôler à la main.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Plus d'écriture client ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Creators manage own onboarding links" ON public.onboarding_links;
DROP POLICY IF EXISTS "Venue team manage venue onboarding links" ON public.onboarding_links;
DROP POLICY IF EXISTS "Organizers manage own onboarding links" ON public.onboarding_links;
DROP POLICY IF EXISTS "Super admins manage all onboarding links" ON public.onboarding_links;

CREATE POLICY "Creators read own onboarding links"
  ON public.onboarding_links FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Venue team read venue onboarding links"
  ON public.onboarding_links FOR SELECT
  TO authenticated
  USING (venue_id IS NOT NULL
         AND (public.is_venue_owner(auth.uid(), venue_id)
              OR public.manager_has_permission(auth.uid(), venue_id, 'staff')));

CREATE POLICY "Organizers read own onboarding links"
  ON public.onboarding_links FOR SELECT
  TO authenticated
  USING (organizer_user_id IS NOT NULL
         AND (organizer_user_id = auth.uid()
              OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'manage_team')));

CREATE POLICY "Super admins read onboarding links"
  ON public.onboarding_links FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.onboarding_links FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.onboarding_link_redemptions FROM anon, authenticated;

-- ── 2. Garde de base ────────────────────────────────────────────────────────
-- SECURITY INVOKER et test sur current_user : un trigger de garde SECURITY
-- DEFINER s'exécuterait sous son propriétaire et se désactiverait lui-même.
-- Le service_role (edge accept-staff-invitation) et les migrations passent.
CREATE OR REPLACE FUNCTION public.guard_onboarding_link_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'onboarding links are issued by the server only'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_onboarding_link_write ON public.onboarding_links;
CREATE TRIGGER trg_guard_onboarding_link_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.onboarding_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_onboarding_link_write();

-- ── 3. Qui peut émettre quoi (miroir de handleCreateOnboardingLink) ─────────
CREATE OR REPLACE FUNCTION public.onboarding_link_issuer_allowed(
  p_role              text,
  p_venue_id          text,
  p_organizer_user_id uuid,
  p_issuer            uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
BEGIN
  IF p_issuer IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = p_issuer AND role = 'admin'::public.app_role)
    INTO v_admin;
  IF v_admin THEN RETURN true; END IF;

  -- Propriété d'un club et espace organisateur : super admin seulement.
  IF p_role IN ('owner', 'organizer') THEN RETURN false; END IF;

  IF p_venue_id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM public.venues v
                    WHERE v.id = p_venue_id AND v.owner_id = p_issuer)
        OR public.manager_has_permission(p_issuer, p_venue_id, 'staff');
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    RETURN p_organizer_user_id = p_issuer
        OR public.is_org_team_member(p_issuer, p_organizer_user_id, 'admin');
  END IF;

  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.onboarding_link_issuer_allowed(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_link_issuer_allowed(text, text, uuid, uuid) TO service_role;

-- ── 4 + 5. Nettoyage et audit ───────────────────────────────────────────────
DO $audit$
DECLARE
  r record;
BEGIN
  -- Alerte d'abord (avant révocation), pour chaque lien illégitime déjà utilisé.
  FOR r IN
    SELECT l.id AS link_id, l.role, l.venue_id, l.organizer_user_id, l.created_by,
           l.created_at, rd.user_id AS redeemed_by, rd.redeemed_at,
           v.name AS venue_name, v.owner_id AS current_owner,
           pc.email AS creator_email, pr.email AS redeemer_email
      FROM public.onboarding_link_redemptions rd
      JOIN public.onboarding_links l ON l.id = rd.link_id
      LEFT JOIN public.venues v ON v.id = l.venue_id
      LEFT JOIN public.profiles pc ON pc.id = l.created_by
      LEFT JOIN public.profiles pr ON pr.id = rd.user_id
     WHERE NOT public.onboarding_link_issuer_allowed(l.role, l.venue_id, l.organizer_user_id, l.created_by)
        -- Un owner qui a émis un lien owner pour SON club (re-transfert) reste
        -- suspect : seul le super admin transfère un club.
        OR (l.role = 'owner' AND NOT EXISTS (
              SELECT 1 FROM public.user_roles ur
               WHERE ur.user_id = l.created_by AND ur.role = 'admin'::public.app_role))
  LOOP
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_security_onboarding_link',
        'SÉCURITÉ — lien d''onboarding illégitime utilisé',
        'Rôle ' || r.role
          || coalesce(' sur le club ' || r.venue_name || ' (' || r.venue_id || ')', '')
          || ' — émis par ' || coalesce(r.creator_email, r.created_by::text)
          || ', utilisé par ' || coalesce(r.redeemer_email, r.redeemed_by::text)
          || ' le ' || to_char(r.redeemed_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI')
          || CASE WHEN r.role = 'owner' AND r.current_owner = r.redeemed_by
                  THEN '. Cette personne est AUJOURD''HUI propriétaire du club : vérifier et rétablir le vrai owner.'
                  ELSE '. Vérifier les droits accordés.' END,
        'urgent', 'onboarding_link', r.link_id::text,
        jsonb_build_object(
          'link_id', r.link_id, 'role', r.role, 'venue_id', r.venue_id,
          'organizer_user_id', r.organizer_user_id, 'created_by', r.created_by,
          'creator_email', r.creator_email, 'redeemed_by', r.redeemed_by,
          'redeemer_email', r.redeemer_email, 'redeemed_at', r.redeemed_at,
          'current_owner', r.current_owner
        ),
        'security_onboarding_link:' || r.link_id::text || ':' || r.redeemed_by::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Puis on coupe tout lien encore actif que son émetteur n'avait pas le droit
  -- d'émettre (le trigger de garde laisse passer : current_user = propriétaire).
  UPDATE public.onboarding_links l
     SET is_active = false,
         revoked_at = coalesce(l.revoked_at, now())
   WHERE l.is_active
     AND (NOT public.onboarding_link_issuer_allowed(l.role, l.venue_id, l.organizer_user_id, l.created_by)
          OR (l.role = 'owner' AND NOT EXISTS (
                SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = l.created_by AND ur.role = 'admin'::public.app_role)));
END
$audit$;
