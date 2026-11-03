-- L'envoi test REVIVAL du 04/11 reste INTERNE : rien d'inhabituel côté WOH (Paul).
--
-- Ce que WOH aurait vu, et qui est retiré :
--   · le nom de l'audience « Gmail actifs (90 jours), reprise Gmail » → son nom
--     d'origine « Clients à Paris » (la liste d'adresses reste, elle n'a pas de nom) ;
--   · le passage au niveau 3 dans l'historique et la page Santé → remplacé par un
--     plafond INTERNE (email_sender_health.internal_cap, fenêtre datée), que lit
--     email_sender_daily_cap après le niveau et que n'affiche aucun écran : le compte
--     reste au niveau 1 ; le rythme (150 / h) est déjà celui du niveau 1 ;
--   · le texte d'une pause de la surveillance renforcée → une phrase neutre.
-- Les alertes restent au super admin seul (admin_notifications).
SET lock_timeout = '3s';

ALTER TABLE public.email_sender_health
  ADD COLUMN IF NOT EXISTS internal_cap integer,
  ADD COLUMN IF NOT EXISTS internal_cap_from timestamptz,
  ADD COLUMN IF NOT EXISTS internal_cap_until timestamptz;

-- Plafond interne : remplace le plafond calculé dans sa fenêtre, jamais affiché.
DO $f$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.email_sender_daily_cap(text)'::regprocedure);
  IF position('internal_cap' IN d) = 0 THEN
    d := replace(d,
      E'  v_cap := LEAST(v_cap, (public._email_sender_level(p_scope_key)).daily_cap);\n  RETURN v_cap;',
      E'  v_cap := LEAST(v_cap, (public._email_sender_level(p_scope_key)).daily_cap);\n'
      || E'  -- Plafond interne d''un envoi test (20261128130000) : décidé par Yuno, daté, jamais affiché.\n'
      || E'  v_cap := COALESCE((SELECT h.internal_cap FROM public.email_sender_health h\n'
      || E'                      WHERE h.scope_key = p_scope_key AND h.internal_cap IS NOT NULL\n'
      || E'                        AND now() >= h.internal_cap_from AND now() < h.internal_cap_until), v_cap);\n'
      || E'  RETURN v_cap;');
    IF position('internal_cap' IN d) = 0 THEN RAISE EXCEPTION 'daily_cap_patch_failed'; END IF;
    EXECUTE d;
  END IF;
END $f$;

-- Plafond du jour pour WOH CRM : 1 000 de 9 h 55 à 23 h 30 (Paris). Pas de niveau, pas d'historique.
UPDATE public.email_sender_health
   SET internal_cap = 1000,
       internal_cap_from = timestamptz '2026-11-04 09:55:00 Europe/Paris',
       internal_cap_until = timestamptz '2026-11-04 23:30:00 Europe/Paris'
 WHERE scope_key = 'venue:woh';

-- Les tâches du niveau sont retirées (le plafond interne les remplace).
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('woh-revival-level-up', 'woh-revival-level-down');

-- Nom d'audience d'origine.
UPDATE public.email_campaigns
   SET audiences_json = jsonb_build_array(jsonb_set(audiences_json->0, '{label}', to_jsonb('Clients à Paris'::text)))
 WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d' AND status = 'scheduled';

-- Texte de pause neutre (le motif complet reste dans l'alerte super admin et le journal).
DO $f$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.email_test_watch(uuid)'::regprocedure);
  d := replace(d, $$error_message = 'Pause de la surveillance renforcée : ' || v_reason$$,
                  $$error_message = 'Envoi en pause : vérification en cours par l''équipe Yuno.'$$);
  IF position('vérification en cours' IN d) = 0 THEN RAISE EXCEPTION 'watch_patch_failed'; END IF;
  EXECUTE d;
END $f$;
