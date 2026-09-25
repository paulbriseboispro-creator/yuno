-- La relance de cachet d'un DJ doit OUVRIR la page où l'on paie ce cachet.
--
-- Le centre de notifications de la Console mène chaque notification à la page
-- de son action (src/lib/notifications.ts, notifLink). « X attend son cachet »
-- se règle sur la fiche du DJ (/owner/djs/<dj_id>, bouton « marquer payé ») ;
-- or la ligne ne portait que le set (reference_id = dj_sets.id), pas le DJ.
-- On pose donc `dj_id` (et le montant) dans metadata, et on complète les lignes
-- déjà émises. Corps repris de l'état LIVE (pg_get_functiondef), seule
-- l'INSERT change.

CREATE OR REPLACE FUNCTION public.dj_remind_unpaid_fee(p_dj_set_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_set    public.dj_sets%ROWTYPE;
  v_dj     public.djs%ROWTYPE;
  v_name   text;
  v_recent boolean;
BEGIN
  SELECT s.* INTO v_set FROM public.dj_sets s WHERE s.id = p_dj_set_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- L'appelant doit être le DJ propriétaire du set.
  SELECT d.* INTO v_dj FROM public.djs d
   WHERE d.id = v_set.dj_id AND d.user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_set.fee_paid OR COALESCE(v_set.fee, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_due');
  END IF;

  -- La relance n'arrive que dans l'inbox d'un owner de venue.
  IF v_set.venue_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_venue');
  END IF;

  -- Anti-spam : une relance par set toutes les 24h.
  SELECT EXISTS (
    SELECT 1 FROM public.staff_notifications n
    WHERE n.reference_type = 'dj_set' AND n.reference_id = v_set.id
      AND n.notification_type = 'dj_fee_reminder'
      AND n.created_at > now() - interval '24 hours'
  ) INTO v_recent;
  IF v_recent THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  v_name := COALESCE(
    NULLIF(btrim(v_dj.stage_name), ''),
    NULLIF(btrim(COALESCE(v_dj.first_name, '') || ' ' || COALESCE(v_dj.last_name, '')), ''),
    'DJ'
  );

  INSERT INTO public.staff_notifications
    (venue_id, event_id, target_role, notification_type, title, message, reference_type, reference_id, priority, metadata)
  VALUES
    (v_set.venue_id, v_set.event_id, 'owner', 'dj_fee_reminder',
     v_name || ' attend son cachet',
     v_name || ' te relance pour un cachet en attente de ' || COALESCE(v_set.fee, 0)::text
       || ' € (set du ' || to_char(v_set.start_time, 'DD/MM/YYYY') || ').',
     'dj_set', v_set.id, 'normal',
     jsonb_build_object('dj_id', v_dj.id, 'fee', v_set.fee));

  RETURN jsonb_build_object('ok', true);
END; $function$;

-- Lignes déjà émises : le DJ se retrouve par le set.
UPDATE public.staff_notifications n
   SET metadata = COALESCE(n.metadata, '{}'::jsonb) || jsonb_build_object('dj_id', s.dj_id)
  FROM public.dj_sets s
 WHERE n.notification_type = 'dj_fee_reminder'
   AND n.reference_type = 'dj_set'
   AND s.id = n.reference_id
   AND NOT (COALESCE(n.metadata, '{}'::jsonb) ? 'dj_id');
