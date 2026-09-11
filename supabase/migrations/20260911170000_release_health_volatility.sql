-- admin_release_health() lit des sources volatiles (taille de la base,
-- statistiques des tables, historique pg_cron). La marquer STABLE autorisait
-- le planificateur à réutiliser un résultat dans la même requête : `supabase
-- db lint` le signalait, et c'est le genre de raccourci qui rend un tableau de
-- santé faux sans jamais lever d'erreur. Elle redevient VOLATILE (le défaut).
ALTER FUNCTION public.admin_release_health() VOLATILE;
