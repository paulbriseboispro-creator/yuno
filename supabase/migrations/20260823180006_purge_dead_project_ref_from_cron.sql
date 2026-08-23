-- ============================================================================
-- P1 PLATEFORME — Purge défensive du ref Supabase mort (kredmghiqesyrmjqvxen)
-- dans la planification cron.
--
-- Constat d'audit : 20260430181933 embarquait l'URL ET la clé anon de l'ancien
-- projet Lovable dans private.reschedule_edge_cron, et a replanifié 16 jobs
-- avec ces valeurs.
--
-- État réel vérifié en prod le 2026-08-23 :
--   • private.reschedule_edge_cron a DÉJÀ été corrigée par 20260511120000
--     (URL fulawxvdlwtdlpkycixe, plus de header Authorization — les fonctions
--     cron sont verify_jwt=false et s'authentifient par x-cron-secret) ;
--   • les 32 jobs cron.job actuels pointent tous https://fulawxvdlwtdlpkycixe… ;
--     `cleanup-pending-purchases` est bien planifié (*/15 * * * *, jobid 57).
--
-- Cette migration rend l'invariant EXÉCUTOIRE plutôt que constaté :
--   1. ré-asserte le corps corrigé de reschedule_edge_cron (idempotent,
--      identique à 20260511120000) — tout futur `SELECT
--      private.reschedule_edge_cron(...)` replanifie forcément vers la prod ;
--   2. réécrit la commande de tout job qui référencerait encore l'ancien ref
--      (0 attendu — filet si un job manuel traînait hors inventaire) ;
--   3. échoue le push si un job polluant subsiste après réécriture.
-- NB : l'ancienne clé anon Lovable encode le ref en base64 dans le JWT ; elle
-- n'apparaît donc jamais en clair dans cron.job. Si un vieux header traînait,
-- il serait inerte (verify_jwt=false) — seule l'URL décide de la cible.
-- ============================================================================

-- 1. Corps corrigé (copie conforme de 20260511120000, ré-assertée).
CREATE OR REPLACE FUNCTION private.reschedule_edge_cron(
  p_job_name text,
  p_schedule text,
  p_function_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_url text := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/' || p_function_path;
  v_command text;
BEGIN
  BEGIN
    PERFORM cron.unschedule(p_job_name);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_command := format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('triggered_at', now())
    );
  $cmd$, v_url);

  PERFORM cron.schedule(p_job_name, p_schedule, v_command);
END;
$$;

REVOKE ALL ON FUNCTION private.reschedule_edge_cron(text, text, text) FROM PUBLIC, anon, authenticated;

-- 2. Réécrire tout job encore pointé sur l'ancien projet (0 attendu).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid, command
      FROM cron.job
     WHERE command LIKE '%kredmghiqesyrmjqvxen%'
  LOOP
    PERFORM cron.alter_job(
      job_id  := r.jobid,
      command := replace(
        r.command,
        'https://kredmghiqesyrmjqvxen.supabase.co',
        'https://fulawxvdlwtdlpkycixe.supabase.co'
      )
    );
    RAISE NOTICE 'cron job % repointé de l''ancien ref vers la prod', r.jobid;
  END LOOP;
END;
$$;

-- 3. Filet : plus aucun job ne doit citer l'ancien ref.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%kredmghiqesyrmjqvxen%') THEN
    RAISE EXCEPTION 'des jobs cron référencent encore le projet mort kredmghiqesyrmjqvxen';
  END IF;
END;
$$;
