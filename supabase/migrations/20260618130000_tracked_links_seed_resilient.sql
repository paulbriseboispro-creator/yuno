-- Sûreté : le seeding des liens trackés ne doit JAMAIS faire échouer la création
-- d'une soirée. Le trigger s'exécute dans la transaction de l'INSERT events, donc
-- une exception non rattrapée annulerait l'event. On avale toute erreur de seeding.

CREATE OR REPLACE FUNCTION public.trg_seed_event_tracked_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM public.seed_event_tracked_links(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort : on log et on continue, la soirée se crée quoi qu'il arrive.
    RAISE WARNING 'seed_event_tracked_links failed for event %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END; $$;
