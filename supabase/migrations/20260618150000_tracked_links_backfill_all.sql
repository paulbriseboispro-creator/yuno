-- Backfill complet des liens trackés par défaut.
--
-- Le backfill initial (20260618120000) ne couvrait que les soirées actives ET à
-- venir (`is_active = true AND end_at >= now()`). Résultat : les soirées passées,
-- inactives, ou créées alors que le trigger échouait silencieusement
-- (20260618130000 avale les erreurs de seeding) n'ont AUCUN lien tracké, d'où le
-- "Aucun lien tracké" constaté sur certaines soirées (owner ET organisateur).
--
-- Ici on (re)seed TOUTES les soirées rattachées à un club OU à un organisateur.
-- `seed_event_tracked_links` est idempotent canal par canal, donc rejouer sur des
-- soirées déjà pourvues ne crée aucun doublon.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.events
    WHERE venue_id IS NOT NULL OR organizer_user_id IS NOT NULL
  LOOP
    PERFORM public.seed_event_tracked_links(r.id);
  END LOOP;
END $$;

-- Permet le self-heal côté front : si la section "Liens" d'une soirée détenue par
-- l'utilisateur est vide au chargement, l'UI peut appeler ce RPC pour générer les
-- canaux par défaut à la volée. La fonction est SECURITY DEFINER (l'INSERT
-- contourne la RLS) et idempotente.
GRANT EXECUTE ON FUNCTION public.seed_event_tracked_links(uuid) TO authenticated;
