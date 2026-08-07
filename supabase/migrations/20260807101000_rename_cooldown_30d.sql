-- ============================================================================
-- Cooldown de renommage : un profil public ne change de nom qu'une fois tous
-- les 30 jours. Le renommage regénère les liens publics (cf. 20260807100000) ;
-- le limiter évite le zapping d'identité et la prolifération d'alias.
--
-- Périmètre : agencies (identité maître), affiliates (bras autonome — la synchro
-- agence→affilié passe aussi ici mais les fenêtres sont alignées puisque seule
-- l'agence peut renommer un affilié géré), venues (clubs en ligne uniquement),
-- organizer_profiles, djs (profils revendiqués uniquement), affiliate_members
-- (seulement s'ils ont une page /promo publiée).
--
-- Mécanique : colonne name_changed_at + garde générique BEFORE UPDATE.
--   * SECURITY INVOKER — règle house : un trigger de garde ne doit JAMAIS être
--     SECURITY DEFINER (il s'exécuterait sous son propriétaire).
--   * La discrimination se fait sur auth.uid(), PAS current_user : les surfaces
--     de renommage passent par des RPC SECURITY DEFINER (update_agency_profile)
--     où current_user est le propriétaire de la fonction. auth.uid() lit le JWT
--     de la requête et reste fiable dans les deux cas. Sans JWT (service_role,
--     SQL direct, migrations, crons) : aucun blocage, aucun horodatage —
--     name_changed_at trace les renommages UTILISATEUR uniquement.
--   * Erreur levée : 'rename_cooldown:<ISO du prochain renommage possible>' —
--     parsée telle quelle côté front (src/lib/renameGuard.ts).
-- ============================================================================

ALTER TABLE public.agencies           ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;
ALTER TABLE public.affiliates         ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;
ALTER TABLE public.venues             ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;
ALTER TABLE public.organizer_profiles ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;
ALTER TABLE public.djs                ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;
ALTER TABLE public.affiliate_members  ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_name_rename_cooldown()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_changed boolean := false;
  v_last timestamptz; v_next timestamptz; i int;
BEGIN
  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    IF (v_old ->> TG_ARGV[i]) IS DISTINCT FROM (v_new ->> TG_ARGV[i]) THEN
      v_changed := true;
    END IF;
  END LOOP;
  IF NOT v_changed THEN RETURN NEW; END IF;

  -- Écriture interne (service_role, migration, cron, synchro DEFINER sans JWT) :
  -- ni blocage ni horodatage.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Cas sans lien public à protéger : renommage libre.
  IF TG_TABLE_NAME = 'affiliate_members' AND (v_new ->> 'linktree_slug') IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'djs' AND (v_new ->> 'user_id') IS NULL THEN
    -- Entrée de line-up non revendiquée : édition routinière par le club.
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'venues'
     AND COALESCE((v_new ->> 'stripe_onboarding_complete')::boolean, false) = false THEN
    -- Club encore en onboarding : le nom se cherche, pas de verrou.
    RETURN NEW;
  END IF;

  v_last := (v_old ->> 'name_changed_at')::timestamptz;
  IF v_last IS NOT NULL AND v_last + interval '30 days' > now() THEN
    v_next := v_last + interval '30 days';
    RAISE EXCEPTION 'rename_cooldown:%',
      to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;

  NEW.name_changed_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS agencies_rename_cooldown ON public.agencies;
CREATE TRIGGER agencies_rename_cooldown
  BEFORE UPDATE OF name ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.guard_name_rename_cooldown('name');

DROP TRIGGER IF EXISTS affiliates_rename_cooldown ON public.affiliates;
CREATE TRIGGER affiliates_rename_cooldown
  BEFORE UPDATE OF name ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.guard_name_rename_cooldown('name');

DROP TRIGGER IF EXISTS venues_rename_cooldown ON public.venues;
CREATE TRIGGER venues_rename_cooldown
  BEFORE UPDATE OF name ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.guard_name_rename_cooldown('name');

DROP TRIGGER IF EXISTS organizer_profiles_rename_cooldown ON public.organizer_profiles;
CREATE TRIGGER organizer_profiles_rename_cooldown
  BEFORE UPDATE OF display_name ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_name_rename_cooldown('display_name');

DROP TRIGGER IF EXISTS djs_rename_cooldown ON public.djs;
CREATE TRIGGER djs_rename_cooldown
  BEFORE UPDATE OF stage_name, first_name, last_name ON public.djs
  FOR EACH ROW EXECUTE FUNCTION public.guard_name_rename_cooldown('stage_name', 'first_name', 'last_name');

DROP TRIGGER IF EXISTS affiliate_members_rename_cooldown ON public.affiliate_members;
CREATE TRIGGER affiliate_members_rename_cooldown
  BEFORE UPDATE OF first_name, last_name ON public.affiliate_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_name_rename_cooldown('first_name', 'last_name');
