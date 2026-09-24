-- ═══════════════════════════════════════════════════════════════════════════
-- SÉCURITÉ — on ne se déclare plus organisateur soi-même.
--
-- La policy « Users can update own profile » (auth.uid() = id, sans garde de
-- colonne) laissait tout compte écrire son propre `profiles.profile_type =
-- 'organizer'` par PostgREST ; le trigger trg_sync_organizer_role_from_profile
-- lui accordait alors le rôle `organizer` (Console Organisateur, création de
-- soirées publiques, is_organizer_profile). Et la policy « Organizers manage
-- own profile » d'organizer_profiles (FOR ALL, user_id = auth.uid()) laissait
-- n'importe qui se créer une page organisateur PUBLIQUE — nom au choix.
--
-- Tous les chemins légitimes sont serveur : complete_pro_signup (SECURITY
-- DEFINER, inscription libre-service), accept-platform-invitation,
-- invite-platform-user, les liens d'onboarding, admin-account-recovery
-- (service_role). Le front ne fait que LIRE profile_type.
--
-- Garde = triggers SECURITY INVOKER qui testent current_user (un trigger de
-- garde SECURITY DEFINER s'exécuterait sous son propriétaire et se
-- désactiverait lui-même) : le service_role, les fonctions SECURITY DEFINER et
-- les migrations passent, un client `authenticated` / `anon` non.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. profiles.profile_type : écrit par le serveur seulement ───────────────
CREATE OR REPLACE FUNCTION public.guard_profile_type_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Une ligne créée par un client garde le type par défaut.
    IF NEW.profile_type IS DISTINCT FROM 'club'::public.profile_type THEN
      RAISE EXCEPTION 'profile_type is set by the server only' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.profile_type IS DISTINCT FROM OLD.profile_type THEN
    RAISE EXCEPTION 'profile_type is set by the server only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_type_write ON public.profiles;
CREATE TRIGGER trg_guard_profile_type_write
  BEFORE INSERT OR UPDATE OF profile_type ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_type_write();

-- ── 2. organizer_profiles : un client n'en crée que s'il EST organisateur ──
-- La mise à jour de SA page reste libre (onboarding, page Profil) ; la
-- création d'une page organisateur exige le statut, désormais serveur-only.
CREATE OR REPLACE FUNCTION public.guard_organizer_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NOT public.is_organizer_profile(NEW.user_id) THEN
    RAISE EXCEPTION 'only organizers have an organizer page' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_organizer_profile_insert ON public.organizer_profiles;
CREATE TRIGGER trg_guard_organizer_profile_insert
  BEFORE INSERT ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_organizer_profile_insert();

-- ── 3. Audit : comptes organisateur sans trace d'un chemin légitime ─────────
-- Tout chemin serveur crée la ligne organizer_profiles ; un profile_type
-- 'organizer' sans elle vient très probablement d'une auto-promotion.
DO $audit$
DECLARE
  v_n     integer;
  v_list  text;
BEGIN
  SELECT count(*),
         string_agg(coalesce(p.email, p.id::text), ', ' ORDER BY p.created_at DESC)
           FILTER (WHERE rn <= 20)
    INTO v_n, v_list
    FROM (
      SELECT p.*, row_number() OVER (ORDER BY p.created_at DESC) AS rn
        FROM public.profiles p
       WHERE p.profile_type = 'organizer'
         AND NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = p.id)
         AND NOT public.is_demo_email(p.email)
    ) p;

  IF v_n > 0 THEN
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_security_self_organizer',
        'SÉCURITÉ — comptes organisateur à vérifier',
        v_n || ' compte(s) ont le statut organisateur sans page organisateur, signe probable '
          || 'd''une auto-promotion (faille fermée le 24/09) : ' || v_list
          || '. Vérifier chacun ; au besoin repasser profile_type à club et retirer le rôle organizer.',
        'high', 'security', 'self_organizer',
        jsonb_build_object('count', v_n, 'sample', v_list),
        'security_self_organizer:20260924'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END
$audit$;
