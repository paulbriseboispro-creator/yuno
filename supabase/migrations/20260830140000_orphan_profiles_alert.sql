-- ============================================================================
-- Alerte : des profils n'ont plus de compte auth en face.
--
-- Relevé du 30/08 : 40 lignes dans `profiles` pour 33 comptes. Sept profils
-- orphelins, dont deux qui possèdent un club (Le Bonsaï, Casanova). Personne ne
-- peut se connecter en tant qu'eux, et le club qu'ils possèdent n'a donc plus
-- d'administrateur. Le tout était invisible : rien ne comptait ces lignes.
--
-- Cause reproduite : la suppression « en douceur » (`should_soft_delete`) garde
-- la ligne `auth.users` avec `deleted_at`, donc la FK `profiles_id_fkey ON
-- DELETE CASCADE` ne se déclenche pas et le profil survit. Une réinscription sur
-- le même email crée alors un SECOND profil. La suppression franche cascade
-- correctement — c'est déjà ce que fait l'edge `delete-account`.
-- État des lieux et plan complet : docs/ORPHAN_PROFILES.md.
--
-- Ce balayage ne RÉPARE rien et ne supprime rien : supprimer une de ces lignes
-- emporterait en cascade les clubs, billets et commandes qui y pendent. Il
-- compte, et il le dit.
--
-- Fonction et cron SÉPARÉS de `run_admin_alert_sweep()` à dessein : la réécrire
-- pour y insérer un bloc obligerait à redéclarer ses 200 lignes d'alertes, avec
-- le risque d'en perdre une en silence. Ici on n'ajoute qu'à côté.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sweep_orphan_profiles()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_orphans INT;
  v_venues  INT;
BEGIN
  PERFORM public.assert_admin_or_backend();

  SELECT count(*) INTO v_orphans
    FROM public.profiles p
   WHERE NOT EXISTS (
     SELECT 1 FROM auth.users u
      WHERE u.id = p.id AND u.deleted_at IS NULL
   );

  IF v_orphans = 0 THEN
    RETURN jsonb_build_object('orphans', 0, 'venues', 0, 'emitted', 0);
  END IF;

  -- Un club dont le propriétaire n'a plus de compte n'a plus d'administrateur :
  -- c'est ce qui fait passer l'alerte de « à savoir » à « à traiter ».
  SELECT count(*) INTO v_venues
    FROM public.venues v
   WHERE v.owner_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = v.owner_id AND u.deleted_at IS NULL
     );

  -- La clé de dédoublonnage porte les DEUX compteurs : au repos l'alerte ne se
  -- répète jamais, et elle reparle dès qu'un chiffre bouge. Une clé datée
  -- rappellerait tous les matins un état déjà connu et deviendrait du bruit.
  PERFORM public.emit_admin_notification(
    'admin_orphan_profiles',
    v_orphans || ' profil(s) sans compte',
    v_orphans || ' ligne(s) de `profiles` n''ont plus de compte auth : personne ne ' ||
      'peut s''y connecter, et elles peuvent posséder un club, des billets ou des ' ||
      'commandes.' ||
      CASE WHEN v_venues > 0
           THEN ' ' || v_venues || ' club(s) se retrouvent ainsi sans administrateur.'
           ELSE '' END ||
      ' Cause habituelle : une suppression « en douceur ». Ne pas supprimer ces ' ||
      'lignes — la cascade emporterait ce qu''elles possèdent. Voir ' ||
      'docs/ORPHAN_PROFILES.md.',
    CASE WHEN v_venues > 0 THEN 'high' ELSE 'normal' END,
    'profiles', NULL,
    jsonb_build_object('orphan_profiles', v_orphans, 'venues_without_owner', v_venues),
    'orphan_profiles:' || v_orphans || ':' || v_venues
  );

  RETURN jsonb_build_object('orphans', v_orphans, 'venues', v_venues, 'emitted', 1);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_orphan_profiles() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sweep_orphan_profiles() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('admin-orphan-profiles-sweep')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-orphan-profiles-sweep');

    -- 7 h 20 UTC : juste après `admin-alert-sweep` (7 h 00), sans se marcher dessus.
    PERFORM cron.schedule('admin-orphan-profiles-sweep', '20 7 * * *',
      $cron$ SELECT public.sweep_orphan_profiles(); $cron$);
  END IF;
END $$;
