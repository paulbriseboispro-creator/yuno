-- ============================================================================
-- Fin de poste + appels entre postes
-- ============================================================================
-- Deux manques du journal de nuit :
--
--   1. `night_ops_events` n'acceptait que `shift_start` : impossible de savoir
--      qui est ENCORE en poste, ni de clore un service. `shift_end` entre au
--      catalogue — même RLS (le staff écrit sa propre ligne), même mécanique
--      best-effort côté client.
--
--   2. Un videur qui a besoin de l'hôte VIP à la porte n'avait AUCUN moyen de
--      le joindre depuis l'app : il criait dans le club ou sortait son
--      téléphone perso. `staff_station_call` envoie un appel type entre postes
--      via staff_notifications (realtime in-app + push APNs), avec un
--      anti-spam d'une minute par émetteur.
--
-- Ces appels sont de l'opérationnel initié par un humain (comme door_incident),
-- pas des notifications automatiques : ils suivent le canal staff_notifications
-- existant, pas le registre des automations.
-- ============================================================================


-- ── 1. shift_end au catalogue du journal de nuit ─────────────────────────────

ALTER TABLE public.night_ops_events
  DROP CONSTRAINT IF EXISTS night_ops_events_kind_chk;

ALTER TABLE public.night_ops_events
  ADD CONSTRAINT night_ops_events_kind_chk CHECK (kind IN (
    'incident_fight', 'incident_refusal', 'incident_medical',
    'incident_crowd', 'incident_other', 'shift_start', 'shift_end'
  ));


-- ── 2. Appels entre postes ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.staff_station_call(p_target_role text, p_call_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_venue     text;
  v_from_name text;
  v_from_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_target_role NOT IN ('bouncer', 'barman', 'cloakroom', 'vip_host', 'manager') THEN
    RAISE EXCEPTION 'invalid target role' USING ERRCODE = '22023';
  END IF;

  IF p_call_kind NOT IN ('backup', 'security', 'vip_arrival', 'stock', 'info') THEN
    RAISE EXCEPTION 'invalid call kind' USING ERRCODE = '22023';
  END IF;

  SELECT p.venue_id INTO v_venue FROM public.profiles p WHERE p.id = v_uid;
  IF v_venue IS NULL OR NOT public.is_night_staff_of_venue(v_venue) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Anti-spam : un appel par minute et par émetteur. Un appel est une sirène,
  -- pas un chat — marteler le bouton ne doit pas marteler les téléphones.
  IF EXISTS (
    SELECT 1 FROM public.staff_notifications n
     WHERE n.venue_id = v_venue
       AND n.notification_type = 'station_call'
       AND n.metadata->>'actor_id' = v_uid::text
       AND n.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'call throttled' USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(NULLIF(p.staff_display_name, ''), NULLIF(p.first_name, ''), split_part(p.email, '@', 1))
    INTO v_from_name
    FROM public.profiles p WHERE p.id = v_uid;

  SELECT ur.role::text INTO v_from_role
    FROM public.user_roles ur
   WHERE ur.user_id = v_uid
     AND ur.role IN ('manager', 'vip_host', 'cloakroom', 'bouncer', 'barman')
   ORDER BY array_position(
     ARRAY['manager', 'vip_host', 'cloakroom', 'bouncer', 'barman'], ur.role::text
   )
   LIMIT 1;

  INSERT INTO public.staff_notifications (
    venue_id, target_role, notification_type, title, message, priority, metadata
  ) VALUES (
    v_venue, p_target_role, 'station_call',
    'Appel de poste',
    COALESCE(v_from_name, 'Un collègue') || ' — ' || p_call_kind,
    'urgent',
    jsonb_build_object(
      'call_kind', p_call_kind,
      'from_name', v_from_name,
      'from_role', v_from_role,
      'actor_id', v_uid
    )
  );

  RETURN jsonb_build_object('sent', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_station_call(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_station_call(text, text) TO authenticated;


-- ── 3. Le pont push connaît les nouveaux types ───────────────────────────────
-- Même fonction, liste blanche élargie : appel de poste (urgent), consigne du
-- soir (high) et bravo (normal) réveillent le téléphone. Le libellé localisé
-- vit dans send-push-notification, comme pour les quatre types existants.

DROP TRIGGER IF EXISTS trg_staff_notification_push ON public.staff_notifications;
CREATE TRIGGER trg_staff_notification_push
  AFTER INSERT ON public.staff_notifications
  FOR EACH ROW
  WHEN (NEW.notification_type IN (
    'vip_entry',          -- un client VIP vient d'entrer      -> vip_host
    'vip_order_request',  -- un client demande une commande    -> vip_host
    'bar_order_new',      -- une commande entre en file        -> barman
    'door_incident',      -- incident signalé à la porte       -> bouncer
    'station_call',       -- appel entre postes                -> rôle ciblé
    'night_brief',        -- consigne du soir publiée          -> staff terrain
    'staff_kudos'         -- bravo nominatif                   -> destinataire
  ))
  EXECUTE FUNCTION private.notify_staff_push();
