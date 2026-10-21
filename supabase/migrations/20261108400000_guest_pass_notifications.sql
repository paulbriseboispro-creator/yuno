-- ============================================================================
-- Espace invité : les NOTIFICATIONS de l'invité (21/10, liste validée par Paul)
-- ============================================================================
-- La cloche ne porte que ce qui demande une action ou change la soirée.
--   CONTRAT (cloche + e-mail)  proposé, modifié, signé par les deux.
--   ARGENT  (cloche + e-mail)  décompte figé (à vérifier), relance la veille de
--                              l'échéance du virement, virement annoncé.
--   SOIRÉE  (cloche + e-mail)  horaire, adresse, line-up changés, annulation,
--                              report — une série de retouches = UNE notification
--                              (regroupement 20 min, e-mail parti après le calme).
--   JOUR J                     « Les portes ouvrent ce soir » (cloche),
--                              « Le bilan est prêt » (cloche + e-mail).
--   GUEST LIST (cloche)        places données / modifiées, part pleine, demande
--                              acceptée ou refusée.
--   PORTE   (cloche)           « qui tient la porte » changé, staff invité par
--                              l'organisateur, staff qui a accepté.
--   VENTES  (cloche)           un récap par jour au plus, paliers 50 / 75 / complet.
-- Jamais une notification par billet ou par clic, jamais de push.
--
-- • Une ligne = un accès (`pass_id`) ; elle se lit avec le COMPTE rattaché
--   (`_guest_pass_live`), « lu » par ligne donc par compte. Une notification
--   née avant le rattachement attend le compte.
-- • Émission par UNE fonction, `_guest_pass_notify` (dedup_key = une fois,
--   group_key = regroupement), jamais un INSERT direct ; les corps de trigger
--   attrapent tout : une notification ne fait jamais échouer l'écriture métier.
-- • Le texte est rendu à l'affichage (langue de l'espace) et dans l'e-mail
--   (langue de l'accès) à partir de `type` + `data` : mots `guestSpace.bell.*`.
-- • E-mails : `email_state` pending → drainés par `process-scheduled-campaigns`
--   (`claim_guest_pass_notification_emails`), jamais vers une adresse démo, le
--   lien mène à l'espace (ou à l'invitation tant que personne n'a rattaché).
-- • Balayage `guest_pass_notifications_sweep()` (cron 15 min) : décompte à
--   figer, portes ce soir, bilan, relance, part pleine, récap des ventes, paliers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.guest_pass_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id      uuid NOT NULL REFERENCES public.event_guest_passes(id) ON DELETE CASCADE,
  type         text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key    text,
  group_key    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  email_state  text NOT NULL DEFAULT 'none' CHECK (email_state IN ('none', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  email_after  timestamptz,
  email_sent_at timestamptz,
  email_attempts integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_pass_notifications_dedup ON public.guest_pass_notifications (pass_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS guest_pass_notifications_pass ON public.guest_pass_notifications (pass_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_pass_notifications_email ON public.guest_pass_notifications (email_after) WHERE email_state = 'pending';
ALTER TABLE public.guest_pass_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_pass_notifications FROM anon, authenticated;

-- La porte unique d'émission. p_email : part aussi par e-mail. p_group : regroupe
-- avec une ligne du même groupe créée il y a moins de 20 min (données remplacées,
-- e-mail repoussé de 20 min, rien de deux fois). p_dedup : une fois pour toutes.
CREATE OR REPLACE FUNCTION public._guest_pass_notify(
  p_pass_id uuid, p_type text, p_data jsonb DEFAULT '{}'::jsonb,
  p_dedup text DEFAULT NULL, p_group text DEFAULT NULL, p_email boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_pass_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.event_guest_passes WHERE id = p_pass_id AND revoked_at IS NULL) THEN
    RETURN;
  END IF;
  IF p_group IS NOT NULL THEN
    UPDATE public.guest_pass_notifications
       SET data = coalesce(data, '{}'::jsonb) || coalesce(p_data, '{}'::jsonb), type = p_type,
           updated_at = now(), read_at = NULL,
           email_after = CASE WHEN email_state = 'pending' THEN now() + interval '20 minutes' ELSE email_after END
     WHERE id = (SELECT n.id FROM public.guest_pass_notifications n
                  WHERE n.pass_id = p_pass_id AND n.group_key = p_group
                    AND n.created_at > now() - interval '20 minutes' AND n.email_state IN ('none', 'pending')
                  ORDER BY n.created_at DESC LIMIT 1)
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN; END IF;
  END IF;
  INSERT INTO public.guest_pass_notifications (pass_id, type, data, dedup_key, group_key, email_state, email_after)
  VALUES (p_pass_id, p_type, coalesce(p_data, '{}'::jsonb), p_dedup, p_group,
          CASE WHEN p_email THEN 'pending' ELSE 'none' END,
          CASE WHEN p_email THEN now() + CASE WHEN p_group IS NOT NULL THEN interval '20 minutes' ELSE interval '0' END END)
  ON CONFLICT (pass_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notify(uuid, text, jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- ─── L'accès lui-même : contrat, argent, porte, demande de places ────────────
CREATE OR REPLACE FUNCTION public._guest_pass_notify_pass_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
BEGIN
  BEGIN
    IF NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT p.display_name INTO v_org FROM public.event_parties(NEW.event_id) p WHERE p.party_key = NEW.created_by_party;
    v_org := coalesce(v_org, '');
    -- Contrat proposé / modifié (une nouvelle version).
    IF NEW.contract_status = 'proposed' AND coalesce(NEW.contract_version, 0) > 0
       AND (OLD.contract_status IS DISTINCT FROM 'proposed' OR NEW.contract_version IS DISTINCT FROM OLD.contract_version) THEN
      PERFORM public._guest_pass_notify(NEW.id, CASE WHEN NEW.contract_version > 1 THEN 'contractChanged' ELSE 'contract' END,
        jsonb_build_object('org', v_org, 'n', NEW.contract_version), 'contract:v' || NEW.contract_version, NULL, true);
    END IF;
    -- Contrat signé par les deux.
    IF NEW.contract_status = 'signed' AND OLD.contract_status IS DISTINCT FROM 'signed' THEN
      PERFORM public._guest_pass_notify(NEW.id, 'contractSigned',
        jsonb_build_object('name', coalesce(NEW.contract_signer_name, ''), 'org', v_org, 'n', NEW.contract_version),
        'signed:v' || NEW.contract_version, NULL, true);
    END IF;
    -- Décompte figé : à vérifier.
    IF NEW.statement_frozen_at IS NOT NULL AND OLD.statement_frozen_at IS NULL THEN
      PERFORM public._guest_pass_notify(NEW.id, 'frozen', jsonb_build_object('amount', coalesce(NEW.transfer_amount, 0)), 'frozen', NULL, true);
    END IF;
    -- Virement annoncé par l'organisateur.
    IF NEW.transfer_status = 'sent' AND OLD.transfer_status IS DISTINCT FROM 'sent' THEN
      PERFORM public._guest_pass_notify(NEW.id, 'transferSent', jsonb_build_object('org', v_org), 'transfer:sent:' || coalesce(NEW.transfer_sent_at::text, ''), NULL, true);
    END IF;
    -- Qui tient la porte.
    IF NEW.door_mode IS DISTINCT FROM OLD.door_mode AND NEW.door_mode IS NOT NULL THEN
      PERFORM public._guest_pass_notify(NEW.id, 'doorMode', jsonb_build_object('mode', NEW.door_mode, 'org', v_org), NULL, 'door_mode', false);
    END IF;
    -- Demande de places traitée : refusée (porte `decline_event_guest_pass_places`) ou acceptée.
    IF OLD.places_requested IS NOT NULL AND NEW.places_requested IS NULL THEN
      IF current_setting('yuno.gp_places_declined', true) = NEW.id::text THEN
        PERFORM public._guest_pass_notify(NEW.id, 'placesDeclined', jsonb_build_object('n', OLD.places_requested, 'org', v_org), NULL, NULL, false);
      ELSE
        PERFORM set_config('yuno.gp_places_accepted', NEW.id::text, true);
        PERFORM public._guest_pass_notify(NEW.id, 'placesAccepted', jsonb_build_object('n', OLD.places_requested, 'org', v_org), NULL, NULL, false);
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'guest pass notify: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notify_pass_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_guest_pass_notify ON public.event_guest_passes;
CREATE TRIGGER trg_zz_guest_pass_notify AFTER UPDATE ON public.event_guest_passes
  FOR EACH ROW EXECUTE FUNCTION public._guest_pass_notify_pass_change();

-- Refuser une demande de places (l'organisateur, niveau ≥ 2).
CREATE OR REPLACE FUNCTION public.decline_event_guest_pass_places(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._guest_pass_manager(v_pass.event_id);
  IF v_pass.places_requested IS NULL THEN RETURN jsonb_build_object('ok', true); END IF;
  PERFORM set_config('yuno.gp_places_declined', p_pass_id::text, true);
  UPDATE public.event_guest_passes SET places_requested = NULL WHERE id = p_pass_id;
  PERFORM set_config('yuno.gp_places_declined', '', true);
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.decline_event_guest_pass_places(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_event_guest_pass_places(uuid) TO authenticated;

-- ─── La part de guest list de l'invité : places données / modifiées ──────────
CREATE OR REPLACE FUNCTION public._guest_pass_notify_places()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.guest_pass_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.quota IS NOT DISTINCT FROM OLD.quota THEN RETURN NEW; END IF;
    -- Une demande acceptée a déjà sa notification (même transaction).
    IF current_setting('yuno.gp_places_accepted', true) = NEW.guest_pass_id::text THEN RETURN NEW; END IF;
    PERFORM public._guest_pass_notify(NEW.guest_pass_id, 'glPlaces', jsonb_build_object('n', coalesce(NEW.quota, 0)), NULL, 'gl_places', false);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'guest pass notify places: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notify_places() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_guest_pass_notify_places ON public.guest_lists;
CREATE TRIGGER trg_zz_guest_pass_notify_places AFTER INSERT OR UPDATE OF quota ON public.guest_lists
  FOR EACH ROW EXECUTE FUNCTION public._guest_pass_notify_places();

-- ─── Le staff de porte du club invité ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._guest_pass_notify_door_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
BEGIN
  BEGIN
    IF NEW.guest_pass_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND coalesce(NEW.invited_by_kind, '') <> 'guest' THEN
      SELECT p.display_name INTO v_org FROM public.event_parties(NEW.event_id) p WHERE p.party_key = NEW.invited_by_party;
      PERFORM public._guest_pass_notify(NEW.guest_pass_id, 'staffAdded',
        jsonb_build_object('name', NEW.display_name, 'org', coalesce(v_org, '')), 'staff:add:' || NEW.id, NULL, false);
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
      PERFORM public._guest_pass_notify(NEW.guest_pass_id, 'staffAccepted',
        jsonb_build_object('name', NEW.display_name), 'staff:ok:' || NEW.id, NULL, false);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'guest pass notify staff: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notify_door_staff() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_guest_pass_notify_staff ON public.event_door_staff;
CREATE TRIGGER trg_zz_guest_pass_notify_staff AFTER INSERT OR UPDATE OF status ON public.event_door_staff
  FOR EACH ROW EXECUTE FUNCTION public._guest_pass_notify_door_staff();

-- ─── La soirée change : horaire, lieu, annulation, report ───────────────────
CREATE OR REPLACE FUNCTION public._guest_pass_notify_event_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass record;
  v_type text;
  v_group text;
  v_data jsonb;
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.event_guest_passes h WHERE h.event_id = NEW.id AND h.revoked_at IS NULL) THEN
      RETURN NEW;
    END IF;
    IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') THEN
      v_type := 'nightCancelled'; v_group := 'night:cancelled'; v_data := '{}'::jsonb;
    ELSIF NEW.status = 'postponed' AND OLD.status IS DISTINCT FROM 'postponed' THEN
      v_type := 'nightPostponed'; v_group := 'night:postponed'; v_data := jsonb_build_object('start', NEW.start_at);
    ELSIF NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at THEN
      v_type := 'nightTime'; v_group := 'night:time'; v_data := jsonb_build_object('start', NEW.start_at, 'end', NEW.end_at, 'tz', coalesce(NEW.timezone, 'Europe/Paris'));
    ELSIF NEW.location_name IS DISTINCT FROM OLD.location_name OR NEW.location_address IS DISTINCT FROM OLD.location_address
       OR NEW.location_city IS DISTINCT FROM OLD.location_city THEN
      v_type := 'nightPlace'; v_group := 'night:place';
      v_data := jsonb_build_object('place', concat_ws(', ', NEW.location_name, CASE WHEN coalesce(NEW.location_is_secret, false) THEN NULL ELSE NEW.location_address END, NEW.location_city));
    ELSE
      RETURN NEW;
    END IF;
    FOR v_pass IN SELECT h.id FROM public.event_guest_passes h WHERE h.event_id = NEW.id AND h.revoked_at IS NULL LOOP
      PERFORM public._guest_pass_notify(v_pass.id, v_type, v_data, NULL, v_group, true);
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'guest pass notify event: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notify_event_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_guest_pass_notify_event ON public.events;
CREATE TRIGGER trg_zz_guest_pass_notify_event
  AFTER UPDATE OF start_at, end_at, location_name, location_address, location_city, cancelled_at, status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public._guest_pass_notify_event_change();

-- ─── Le line-up change (DJ Yuno ou artistes invités) ─────────────────────────
CREATE OR REPLACE FUNCTION public._guest_pass_notify_lineup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid := coalesce(NEW.event_id, OLD.event_id);
  v_pass record;
BEGIN
  BEGIN
    FOR v_pass IN SELECT h.id FROM public.event_guest_passes h
                   JOIN public.events e ON e.id = h.event_id
                  WHERE h.event_id = v_event AND h.revoked_at IS NULL
                    AND now() < coalesce(e.end_at, e.start_at + interval '8 hours') LOOP
      PERFORM public._guest_pass_notify(v_pass.id, 'lineup', '{}'::jsonb, NULL, 'night:lineup', true);
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'guest pass notify lineup: %', SQLERRM;
  END;
  RETURN coalesce(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notify_lineup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_guest_pass_notify_lineup ON public.event_djs;
CREATE TRIGGER trg_zz_guest_pass_notify_lineup AFTER INSERT OR DELETE ON public.event_djs
  FOR EACH ROW EXECUTE FUNCTION public._guest_pass_notify_lineup();
DROP TRIGGER IF EXISTS trg_zz_guest_pass_notify_lineup ON public.event_guest_artists;
CREATE TRIGGER trg_zz_guest_pass_notify_lineup AFTER INSERT OR DELETE OR UPDATE OF name ON public.event_guest_artists
  FOR EACH ROW EXECUTE FUNCTION public._guest_pass_notify_lineup();

-- ─── Le balayage : ce que le temps fait arriver ─────────────────────────────
CREATE OR REPLACE FUNCTION public.guest_pass_notifications_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_n int := 0;
  v_tz text;
  v_now_local timestamp;
  v_day_start timestamptz;
  v_end timestamptz;
  v_today int;
  v_mine int;
  v_sold int;
  v_cap int;
  v_level int;
  v_done int;
  v_quota int;
  v_taken int;
BEGIN
  FOR r IN
    SELECT h.*, e.start_at AS e_start, e.end_at AS e_end, coalesce(e.timezone, 'Europe/Paris') AS e_tz,
           e.max_tickets AS e_max, e.cancelled_at AS e_cancelled, e.status AS e_status
      FROM public.event_guest_passes h
      JOIN public.events e ON e.id = h.event_id
     WHERE h.revoked_at IS NULL
       AND now() < coalesce(e.end_at, e.start_at + interval '8 hours') + interval '7 days'
  LOOP
    BEGIN
      v_tz := r.e_tz;
      v_now_local := now() AT TIME ZONE v_tz;
      v_end := coalesce(r.e_end, r.e_start + interval '8 hours');

      -- Décompte d'un contrat signé, 48 h après la fin (la notification part du trigger).
      IF r.contract_status = 'signed' AND r.statement_frozen_at IS NULL AND now() > v_end + interval '48 hours' THEN
        PERFORM public._guest_pass_freeze_if_due(r.id);
      END IF;

      IF r.e_cancelled IS NULL AND coalesce(r.e_status, 'active') = 'active' THEN
        -- Les portes ouvrent ce soir (le jour de la soirée, à partir de midi, heure du lieu).
        IF (r.e_start AT TIME ZONE v_tz)::date = v_now_local::date AND extract(hour FROM v_now_local) >= 12 AND now() < r.e_start THEN
          PERFORM public._guest_pass_notify(r.id, 'doorsTonight', jsonb_build_object('start', r.e_start, 'tz', v_tz), 'doors', NULL, false);
        END IF;
        -- Le bilan est prêt (6 h après la fin, pendant 3 jours).
        IF now() >= v_end + interval '6 hours' AND now() < v_end + interval '72 hours' THEN
          PERFORM public._guest_pass_notify(r.id, 'recapReady', '{}'::jsonb, 'recap', NULL, true);
        END IF;
      END IF;

      -- La veille de l'échéance du virement, si rien n'est réglé.
      IF r.statement_frozen_at IS NOT NULL AND r.transfer_due_at IS NOT NULL
         AND coalesce(r.transfer_status, '') NOT IN ('received')
         AND now() BETWEEN r.transfer_due_at - interval '36 hours' AND r.transfer_due_at THEN
        PERFORM public._guest_pass_notify(r.id, 'dueReminder', jsonb_build_object('due', r.transfer_due_at, 'tz', v_tz), 'due:' || r.transfer_due_at::date, NULL, true);
      END IF;

      -- Part de guest list pleine.
      SELECT gl.quota, (SELECT count(*) FROM public.guest_list_entries g WHERE g.guest_list_id = gl.id AND g.status <> 'cancelled')
        INTO v_quota, v_taken
        FROM public.guest_lists gl WHERE gl.guest_pass_id = r.id;
      IF coalesce(v_quota, 0) > 0 AND v_taken >= v_quota AND now() < v_end THEN
        PERFORM public._guest_pass_notify(r.id, 'glFull', jsonb_build_object('n', v_quota), 'glfull:' || v_quota, NULL, false);
      END IF;

      -- Ventes : avant la fin seulement.
      IF now() < v_end AND r.e_cancelled IS NULL THEN
        v_day_start := (v_now_local::date)::timestamp AT TIME ZONE v_tz;
        SELECT coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0),
               coalesce(sum(greatest(coalesce(t.quantity, 1), 1)) FILTER (
                 WHERE public._guest_space_sale_key(t.tracked_link_id, t.id, NULL, t.attribution_source, t.purchase_source) = 'guest:' || r.id), 0)
          INTO v_today, v_mine
          FROM public.tickets t
         WHERE t.event_id = r.event_id AND t.status IN ('paid', 'used') AND coalesce(t.paid_at, t.created_at) >= v_day_start;
        -- Un récap par jour, le soir (21 h, heure du lieu), s'il s'est vendu quelque chose.
        IF extract(hour FROM v_now_local) >= 21 AND v_today > 0 THEN
          PERFORM public._guest_pass_notify(r.id, 'salesDay', jsonb_build_object('n', v_today, 'mine', v_mine),
            'sales:' || v_now_local::date, NULL, false);
        END IF;
        -- Paliers de remplissage : 50 %, 75 %, complet (le plus haut atteint, une fois).
        SELECT coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) INTO v_sold
          FROM public.tickets t WHERE t.event_id = r.event_id AND t.status IN ('paid', 'used');
        v_cap := CASE
          WHEN coalesce(r.e_max, 0) > 0 THEN r.e_max
          WHEN EXISTS (SELECT 1 FROM public.ticket_rounds tr WHERE tr.event_id = r.event_id)
               AND NOT EXISTS (SELECT 1 FROM public.ticket_rounds tr WHERE tr.event_id = r.event_id AND coalesce(tr.max_tickets, 0) <= 0)
            THEN (SELECT sum(tr.max_tickets) FROM public.ticket_rounds tr WHERE tr.event_id = r.event_id)
          ELSE NULL END;
        IF coalesce(v_cap, 0) > 0 THEN
          v_level := CASE WHEN v_sold >= v_cap THEN 100 WHEN v_sold * 4 >= v_cap * 3 THEN 75 WHEN v_sold * 2 >= v_cap THEN 50 ELSE 0 END;
          SELECT coalesce(max((n.data->>'pct')::int), 0) INTO v_done
            FROM public.guest_pass_notifications n WHERE n.pass_id = r.id AND n.type = 'fill';
          IF v_level > v_done THEN
            PERFORM public._guest_pass_notify(r.id, 'fill', jsonb_build_object('pct', v_level, 'sold', v_sold, 'cap', v_cap), 'fill:' || v_level, NULL, false);
          END IF;
        END IF;
      END IF;
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'guest pass sweep %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'passes', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_notifications_sweep() FROM PUBLIC, anon, authenticated;

-- ─── Lecture par le compte rattaché ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guest_pass_notifications(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', n.id, 'type', n.type, 'data', n.data, 'at', n.updated_at, 'read', n.read_at IS NOT NULL,
             -- Attend encore un geste de l'invité ?
             'action', CASE
               WHEN n.type IN ('contract', 'contractChanged') THEN v_pass.contract_status = 'proposed'
                    AND v_pass.contract_version = (n.data->>'n')::int
               WHEN n.type = 'transferSent' THEN v_pass.transfer_status = 'sent'
               WHEN n.type IN ('frozen', 'dueReminder') THEN coalesce(v_pass.transfer_status, '') NOT IN ('received')
                    AND v_pass.statement_response IS NULL AND v_pass.transfer_status IS DISTINCT FROM 'sent'
               ELSE false END)
           ORDER BY n.updated_at DESC)
      FROM (SELECT * FROM public.guest_pass_notifications WHERE pass_id = v_pass.id ORDER BY updated_at DESC LIMIT 40) n
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_notifications(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_pass_notifications(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guest_pass_notifications_read(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
  v_n int;
BEGIN
  v_pass := public._guest_pass_live(p_token);
  UPDATE public.guest_pass_notifications SET read_at = now() WHERE pass_id = v_pass.id AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'read', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_pass_notifications_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_pass_notifications_read(text) TO authenticated;

-- ─── File d'e-mails (service_role, process-scheduled-campaigns) ─────────────
CREATE OR REPLACE FUNCTION public.claim_guest_pass_notification_emails(p_limit int DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_out jsonb := '[]'::jsonb;
  v_email text;
  v_path text;
  v_demo boolean;
BEGIN
  FOR r IN
    SELECT n.id, n.type, n.data, n.pass_id, h.account_user_id, h.account_email, h.contact_email, h.language,
           h.guest_name, h.event_id, h.created_by_party, h.revoked_at, e.title, e.start_at, coalesce(e.timezone, 'Europe/Paris') AS tz,
           coalesce(e.poster_url, e.image_url) AS poster_url
      FROM public.guest_pass_notifications n
      JOIN public.event_guest_passes h ON h.id = n.pass_id
      JOIN public.events e ON e.id = h.event_id
     WHERE n.email_state = 'pending' AND n.email_after <= now()
     ORDER BY n.email_after
     LIMIT greatest(1, least(coalesce(p_limit, 40), 100))
     FOR UPDATE OF n SKIP LOCKED
  LOOP
    v_email := coalesce(r.account_email, r.contact_email);
    v_demo := r.event_id = ANY (public.demo_event_ids()) OR (v_email IS NOT NULL AND public.is_demo_email(v_email));
    IF r.revoked_at IS NOT NULL OR v_email IS NULL OR v_demo THEN
      UPDATE public.guest_pass_notifications SET email_state = 'skipped' WHERE id = r.id;
      CONTINUE;
    END IF;
    -- Rattaché : l'espace (connexion puis retour). Sinon : une invitation neuve.
    v_path := CASE WHEN r.account_user_id IS NOT NULL THEN '/invite/' || r.pass_id
                   ELSE '/h/' || public._guest_pass_mint_invite(r.pass_id, NULL) END;
    UPDATE public.guest_pass_notifications SET email_state = 'sending', email_attempts = email_attempts + 1 WHERE id = r.id;
    v_out := v_out || jsonb_build_object(
      'id', r.id, 'type', r.type, 'data', r.data, 'email', v_email, 'language', r.language,
      'guest_name', r.guest_name, 'event_title', r.title, 'event_start_at', r.start_at, 'timezone', r.tz,
      'poster_url', r.poster_url, 'path', v_path,
      'inviter_name', (SELECT p.display_name FROM public.event_parties(r.event_id) p WHERE p.party_key = r.created_by_party));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_guest_pass_notification_emails(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_pass_notification_emails(int) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_guest_pass_notification_emails(p_sent uuid[], p_failed uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.guest_pass_notifications SET email_state = 'sent', email_sent_at = now() WHERE id = ANY (coalesce(p_sent, '{}'));
  -- Un échec revient en file 30 min plus tard, trois essais au plus.
  UPDATE public.guest_pass_notifications
     SET email_state = CASE WHEN email_attempts >= 3 THEN 'failed' ELSE 'pending' END,
         email_after = now() + interval '30 minutes'
   WHERE id = ANY (coalesce(p_failed, '{}'));
$$;
REVOKE ALL ON FUNCTION public.mark_guest_pass_notification_emails(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_guest_pass_notification_emails(uuid[], uuid[]) TO service_role;

-- Une ligne restée « sending » (envoi interrompu) repart au bout d'une heure.
CREATE OR REPLACE FUNCTION public._guest_pass_notification_emails_unstick()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.guest_pass_notifications SET email_state = 'pending', email_after = now()
   WHERE email_state = 'sending' AND email_after < now() - interval '1 hour' AND email_attempts < 3;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_notification_emails_unstick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('guest-pass-notify-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'guest-pass-notify-sweep');
  PERFORM cron.schedule('guest-pass-notify-sweep', '7,22,37,52 * * * *',
    'SELECT public.guest_pass_notifications_sweep(); SELECT public._guest_pass_notification_emails_unstick();');
END $$;
