-- B3 — Relance de cachet côté DJ.
-- Un DJ ne peut pas écrire dans staff_notifications (RLS venue-staff), et créer une
-- nouvelle edge function est bloqué (cap 402). Donc on passe par une RPC SECURITY
-- DEFINER : elle valide que l'appelant est bien le DJ du set, que le cachet est dû,
-- limite à une relance / 24h, puis insère une notification dans l'inbox de l'owner.
-- Venue-scopé uniquement (staff_notifications.venue_id NOT NULL).

CREATE OR REPLACE FUNCTION public.dj_remind_unpaid_fee(p_dj_set_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    (venue_id, event_id, target_role, notification_type, title, message, reference_type, reference_id, priority)
  VALUES
    (v_set.venue_id, v_set.event_id, 'owner', 'dj_fee_reminder',
     v_name || ' attend son cachet',
     v_name || ' te relance pour un cachet en attente de ' || COALESCE(v_set.fee, 0)::text
       || ' € (set du ' || to_char(v_set.start_time, 'DD/MM/YYYY') || ').',
     'dj_set', v_set.id, 'normal');

  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.dj_remind_unpaid_fee(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dj_remind_unpaid_fee(uuid) TO authenticated;
