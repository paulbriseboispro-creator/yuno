-- Synchro d'un compte Billetterie + CRM : la cadence de l'offre (décision D7).
--
-- crm_sync_scope et le trigger de création ne réglaient la cadence que d'un
-- compte CRM PUR (crm_scope_limits). Un compte qui a ajouté le CRM à sa
-- Billetterie (Amoris, premier vrai compte Shotgun) gardait la cadence par
-- défaut de la colonne, 60 min, au lieu des 15 min de l'offre : la semaine
-- d'une soirée, une heure de retard sur les ventes.
--
-- Désormais : 15 min tant que l'offre CRM vit (essai, abonnement, offerte),
-- 60 min sinon. Ses limites (envoi, équipe…) restent celles de la Billetterie,
-- et la fin d'essai ne coupe toujours pas sa synchro (seul un compte CRM pur
-- est mis en pause) : règle à trancher par Paul, laissée telle quelle.
-- crm_billing_sweep (horaire) rappelle crm_sync_scope pour chaque compte.

CREATE OR REPLACE FUNCTION public.crm_sync_scope(p_scope_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limits jsonb := public.crm_scope_limits(p_scope_key);
  v_minutes integer;
  v_far timestamptz := now() + interval '100 years';
BEGIN
  IF v_limits IS NULL THEN
    -- Compte Billetterie + CRM (20261018230000, décision D7) : ses limites
    -- restent celles de la Billetterie (crm_scope_limits ne vaut que pour un
    -- compte CRM pur), mais sa synchro suit la cadence de l'offre CRM — 15 min
    -- tant qu'elle vit, la cadence par défaut (60 min) sinon. La fin d'essai ne
    -- met PAS sa synchro en pause : règle laissée telle quelle, à trancher.
    IF public.crm_scope_has_crm(p_scope_key) THEN
      v_minutes := COALESCE((public.crm_plan_limits(public.crm_effective_plan(p_scope_key))->>'sync_minutes')::int, 60);
      UPDATE public.ticketing_connections c
         SET sync_interval_minutes = v_minutes,
             next_sync_at = LEAST(c.next_sync_at, now() + make_interval(mins => v_minutes))
       WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = p_scope_key
         AND c.sync_interval_minutes IS DISTINCT FROM v_minutes
         AND c.next_sync_at < now() + interval '50 years';
    END IF;
    RETURN;
  END IF;
  IF NOT COALESCE((v_limits->>'sync')::boolean, false) THEN
    UPDATE public.ticketing_connections c
       SET next_sync_at = v_far
     WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = p_scope_key
       AND c.next_sync_at < now() + interval '50 years';
    RETURN;
  END IF;
  v_minutes := (v_limits->>'sync_minutes')::int;
  UPDATE public.ticketing_connections c
     SET sync_interval_minutes = v_minutes,
         next_sync_at = CASE WHEN c.next_sync_at > now() + interval '50 years' THEN now()
                             ELSE LEAST(c.next_sync_at, now() + make_interval(mins => v_minutes)) END
   WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = p_scope_key
     AND (c.sync_interval_minutes IS DISTINCT FROM v_minutes OR c.next_sync_at > now() + interval '50 years');
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_connection_interval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id);
  v_limits jsonb := public.crm_scope_limits(v_key);
BEGIN
  IF v_limits IS NOT NULL THEN
    NEW.sync_interval_minutes := COALESCE((v_limits->>'sync_minutes')::int, 15);
    IF NOT COALESCE((v_limits->>'sync')::boolean, false) THEN
      NEW.next_sync_at := now() + interval '100 years';
    END IF;
  ELSIF public.crm_scope_has_crm(v_key) THEN
    -- Billetterie + CRM : cadence de l'offre CRM, jamais de pause (crm_sync_scope).
    NEW.sync_interval_minutes := COALESCE((public.crm_plan_limits(public.crm_effective_plan(v_key))->>'sync_minutes')::int, 60);
  END IF;
  RETURN NEW;
END;
$function$;

-- Les connexions existantes prennent leur cadence tout de suite.
SELECT public.crm_sync_scope(k)
  FROM (SELECT DISTINCT public.crm_scope_key(c.venue_id, c.organizer_user_id) AS k
          FROM public.ticketing_connections c) s
 WHERE k IS NOT NULL;
