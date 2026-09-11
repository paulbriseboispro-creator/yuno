-- « Charge la liste avant la porte » : le rappel qui arme le scan hors ligne.
--
-- Aucun serveur ne peut écrire dans le cache d'un téléphone. La seule façon de
-- garantir que la liste y soit AVANT le sous-sol sans réseau, c'est de pousser
-- une notification au staff de porte pendant qu'il a encore du réseau —
-- l'ouverture de Yuno Pro télécharge alors la soirée dès le premier écran.
--
-- Toutes les heures ; la fonction ne retient que les soirées qui ouvrent dans
-- 2 à 5 h et n'écrit qu'une notification par personne et par soirée.

-- Registre super admin (/admin/notifications) : le toggle existe dès le départ,
-- sinon la clé n'apparaît pas dans la page et personne ne peut la couper.
INSERT INTO public.platform_notification_settings (notification_key, enabled, category)
VALUES ('door_manifest_preload', true, 'reminder')
ON CONFLICT (notification_key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('door-manifest-preload-hourly')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'door-manifest-preload-hourly');

    PERFORM cron.schedule(
      'door-manifest-preload-hourly',
      '15 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/door-manifest-preload',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', private.get_cron_secret()
        ),
        body := jsonb_build_object('triggered_at', now())
      );
      $cron$
    );
  END IF;
END $$;
