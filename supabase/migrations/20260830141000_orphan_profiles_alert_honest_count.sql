-- ============================================================================
-- `sweep_orphan_profiles()` annonçait `emitted: 1` même quand le dédoublonnage
-- avait bloqué l'insertion : au repos, le cron rapportait tous les matins avoir
-- émis une alerte qu'il n'avait pas émise.
--
-- `emit_admin_notification` renvoie l'id inséré, ou NULL quand le `ON CONFLICT`
-- a mordu. On lit cette réponse au lieu de la jeter.
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
  v_id      UUID;
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
  -- répète jamais, et elle reparle dès qu'un chiffre bouge.
  v_id := public.emit_admin_notification(
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

  RETURN jsonb_build_object(
    'orphans', v_orphans,
    'venues', v_venues,
    'emitted', CASE WHEN v_id IS NULL THEN 0 ELSE 1 END
  );
END;
$fn$;
