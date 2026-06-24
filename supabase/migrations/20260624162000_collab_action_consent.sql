-- =============================================================================
-- Mettre en pause / supprimer une co-soirée = ACCORD DES DEUX PARTIES.
--
-- Demande de Paul :
--   1. Pour mettre en pause OU supprimer une soirée en collaboration, les deux
--      parties (club + organisateur) doivent accepter avant que ça s'applique.
--   2. Si la soirée est EN COURS (live) avec des ventes, l'action ne s'applique
--      pas tout de suite : elle est programmée pour APRÈS la fin de la soirée.
--
-- Modèle : une demande d'action (`event_collab_action_requests`). Le demandeur
-- valide automatiquement son côté ; l'autre partie doit approuver. Quand les deux
-- ont approuvé :
--   • soirée en cours  → status 'scheduled', exécution à end_at (cron).
--   • sinon            → exécution immédiate.
--
-- « delete » supprime la soirée entièrement pour les deux parties. Un garde-fou
-- BEFORE DELETE empêche toute suppression unilatérale d'une co-soirée active
-- (page Événements comprise) hors de ce flux à double accord.
--
-- Remplace l'ancien garde-fou « COLLAB_LOCKED_BY_SALES » (blocage dur) pour
-- pause/suppression : le double accord prime, et la seule contrainte restante est
-- le report quand la soirée est en cours. (manage_event_collaboration('resume')
-- reste le chemin unilatéral de réactivation.)
-- =============================================================================

-- ── 1. Table des demandes d'action ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_collab_action_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  action             text NOT NULL CHECK (action IN ('pause','delete')),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','scheduled','executed','cancelled','rejected')),
  requested_by       uuid NOT NULL,
  requested_by_role  text NOT NULL CHECK (requested_by_role IN ('venue','organizer')),
  venue_approved     boolean NOT NULL DEFAULT false,
  organizer_approved boolean NOT NULL DEFAULT false,
  scheduled_for      timestamptz,
  venue_id           text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);

-- Une seule demande active par soirée à la fois.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_collab_action_active
  ON public.event_collab_action_requests (event_id)
  WHERE status IN ('pending','scheduled');

CREATE INDEX IF NOT EXISTS idx_collab_action_due
  ON public.event_collab_action_requests (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_collab_action_event
  ON public.event_collab_action_requests (event_id);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.event_collab_action_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.event_collab_action_requests ENABLE ROW LEVEL SECURITY;

-- Les deux parties (et super admin) lisent les demandes de leur soirée. Toute
-- mutation passe par les RPC SECURITY DEFINER ci-dessous — pas de policy write.
DROP POLICY IF EXISTS collab_action_select ON public.event_collab_action_requests;
CREATE POLICY collab_action_select ON public.event_collab_action_requests
  FOR SELECT USING (
    organizer_user_id = auth.uid()
    OR public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

GRANT SELECT ON public.event_collab_action_requests TO authenticated;

-- ── 2. Garde-fou : pas de suppression unilatérale d'une co-soirée active ───────
CREATE OR REPLACE FUNCTION public.guard_collab_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('app.collab_delete_ok', true) IS DISTINCT FROM '1'
     AND NOT COALESCE(public.is_super_admin(), false)
     AND (OLD.partner_organizer_id IS NOT NULL OR OLD.partner_venue_id IS NOT NULL)
     AND EXISTS (
       SELECT 1 FROM public.event_collab_contracts c
       WHERE c.event_id = OLD.id AND c.status IN ('active','locked','closed')
     )
  THEN
    RAISE EXCEPTION 'COLLAB_DELETE_REQUIRES_CONSENT: cette soirée est en collaboration active — la suppression doit être validée par les deux parties';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_collab_event_delete ON public.events;
CREATE TRIGGER trg_guard_collab_event_delete
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_collab_event_delete();

-- ── 3. Exécution effective (pause ou suppression) ─────────────────────────────
CREATE OR REPLACE FUNCTION public._execute_event_collab_action(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.event_collab_action_requests%ROWTYPE;
  v_title text;
BEGIN
  SELECT * INTO r FROM public.event_collab_action_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.status NOT IN ('pending','scheduled') THEN RETURN; END IF;

  SELECT title INTO v_title FROM public.events WHERE id = r.event_id;
  v_title := COALESCE(v_title, 'une soirée');

  IF r.action = 'pause' THEN
    UPDATE public.events SET collab_paused_at = now(), is_active = false WHERE id = r.event_id;
    UPDATE public.event_collab_action_requests
       SET status = 'executed', resolved_at = now(), updated_at = now()
     WHERE id = p_request_id;
    PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_done', 'Co-soirée mise en pause',
      '« ' || v_title || ' » a été mise en pause d''un commun accord.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', 'pause', 'event_id', r.event_id));
    PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_done', 'Co-soirée mise en pause',
      '« ' || v_title || ' » a été mise en pause d''un commun accord.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', 'pause', 'event_id', r.event_id));
    RETURN;
  END IF;

  -- action = 'delete' : notifier AVANT (la ligne de demande disparaît en cascade
  -- avec la soirée).
  PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
    'collab_action_done', 'Co-soirée supprimée',
    '« ' || v_title || ' » a été supprimée d''un commun accord.',
    'normal', 'event_collab_action', NULL, jsonb_build_object('action', 'delete'));
  PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
    'collab_action_done', 'Co-soirée supprimée',
    '« ' || v_title || ' » a été supprimée d''un commun accord.',
    'normal', 'event_collab_action', NULL, jsonb_build_object('action', 'delete'));

  -- Lever le garde-fou pour CETTE transaction seulement, puis supprimer.
  PERFORM set_config('app.collab_delete_ok', '1', true);
  DELETE FROM public.events WHERE id = r.event_id;  -- cascade : contrats + demande
END; $$;

-- ── 4. Demander une action (le demandeur valide son côté) ──────────────────────
CREATE OR REPLACE FUNCTION public.request_event_collab_action(p_event_id uuid, p_action text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_venue_id     text;
  v_org_id       uuid;
  v_is_venue     boolean;
  v_is_org       boolean;
  v_role         text;
  v_req_id       uuid;
  v_title        text;
  v_actor        text;
  v_label        text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_action NOT IN ('pause','delete') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found'; END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
    FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cette soirée n''est pas une collaboration';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_role := CASE WHEN v_is_org THEN 'organizer' ELSE 'venue' END;

  IF EXISTS (SELECT 1 FROM public.event_collab_action_requests r
             WHERE r.event_id = p_event_id AND r.status IN ('pending','scheduled')) THEN
    RAISE EXCEPTION 'COLLAB_ACTION_PENDING: une demande est déjà en cours pour cette soirée';
  END IF;

  INSERT INTO public.event_collab_action_requests (
    event_id, action, status, requested_by, requested_by_role,
    venue_approved, organizer_approved, venue_id, organizer_user_id
  ) VALUES (
    p_event_id, p_action, 'pending', auth.uid(), v_role,
    (v_role = 'venue'), (v_role = 'organizer'), v_venue_id, v_org_id
  ) RETURNING id INTO v_req_id;

  SELECT title INTO v_title FROM public.events WHERE id = p_event_id;
  v_title := COALESCE(v_title, 'une soirée');
  v_label := CASE WHEN p_action = 'pause' THEN 'mettre en pause' ELSE 'supprimer' END;

  -- Notifier la partie adverse, dont l'accord est requis.
  IF v_role = 'venue' THEN
    SELECT name INTO v_actor FROM public.venues WHERE id = v_venue_id;
    PERFORM public.notify_collab_party('organizer', v_venue_id, v_org_id, p_event_id,
      'collab_action_request', 'Demande sur une co-soirée',
      COALESCE(v_actor, 'Le club') || ' souhaite ' || v_label || ' « ' || v_title || ' ». Ton accord est requis.',
      'high', 'event_collab_action', v_req_id,
      jsonb_build_object('action', p_action, 'event_id', p_event_id, 'requested_by_role', v_role));
  ELSE
    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = v_org_id;
    PERFORM public.notify_collab_party('venue', v_venue_id, v_org_id, p_event_id,
      'collab_action_request', 'Demande sur une co-soirée',
      COALESCE(v_actor, 'L''organisateur') || ' souhaite ' || v_label || ' « ' || v_title || ' ». Ton accord est requis.',
      'high', 'event_collab_action', v_req_id,
      jsonb_build_object('action', p_action, 'event_id', p_event_id, 'requested_by_role', v_role));
  END IF;

  RETURN v_req_id;
END; $$;

-- ── 5. Répondre à une demande (approuver / refuser / annuler) ──────────────────
CREATE OR REPLACE FUNCTION public.respond_event_collab_action(p_request_id uuid, p_approve boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r          public.event_collab_action_requests%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_role     text;
  v_start    timestamptz;
  v_end      timestamptz;
  v_ongoing  boolean;
  v_both     boolean;
  v_title    text;
  v_label    text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.event_collab_action_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status NOT IN ('pending','scheduled') THEN
    RAISE EXCEPTION 'COLLAB_ACTION_RESOLVED: cette demande est déjà traitée';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), r.venue_id);
  v_is_org   := (r.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_role := CASE WHEN v_is_org THEN 'organizer' ELSE 'venue' END;

  SELECT title, start_at, end_at INTO v_title, v_start, v_end
    FROM public.events WHERE id = r.event_id;
  v_title := COALESCE(v_title, 'une soirée');
  v_label := CASE WHEN r.action = 'pause' THEN 'mise en pause' ELSE 'suppression' END;

  -- Refus (autre partie) ou annulation (demandeur) → on clôt la demande.
  IF NOT p_approve THEN
    UPDATE public.event_collab_action_requests
       SET status = CASE WHEN v_role = r.requested_by_role THEN 'cancelled' ELSE 'rejected' END,
           resolved_at = now(), updated_at = now()
     WHERE id = p_request_id;
    -- Prévenir la partie qui n'agit pas maintenant.
    IF v_role = 'venue' THEN
      PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
        'collab_action_rejected', 'Demande annulée',
        'La ' || v_label || ' de « ' || v_title || ' » n''aura pas lieu.',
        'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id));
    ELSE
      PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
        'collab_action_rejected', 'Demande annulée',
        'La ' || v_label || ' de « ' || v_title || ' » n''aura pas lieu.',
        'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id));
    END IF;
    RETURN 'cancelled';
  END IF;

  -- Approbation : poser le flag de MON côté.
  IF v_is_venue THEN
    UPDATE public.event_collab_action_requests SET venue_approved = true, updated_at = now() WHERE id = p_request_id;
  END IF;
  IF v_is_org THEN
    UPDATE public.event_collab_action_requests SET organizer_approved = true, updated_at = now() WHERE id = p_request_id;
  END IF;

  SELECT (venue_approved AND organizer_approved) INTO v_both
    FROM public.event_collab_action_requests WHERE id = p_request_id;
  IF NOT v_both THEN
    RETURN 'pending';  -- on attend encore l'autre partie
  END IF;

  -- Les deux ont accepté. Soirée EN COURS → différer après la fin.
  v_ongoing := (v_start IS NOT NULL AND now() >= v_start AND now() < v_end);
  IF v_ongoing THEN
    UPDATE public.event_collab_action_requests
       SET status = 'scheduled', scheduled_for = v_end, updated_at = now()
     WHERE id = p_request_id;
    PERFORM public.notify_collab_party('organizer', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_scheduled', 'Action programmée',
      'La ' || v_label || ' de « ' || v_title || ' » est validée. Elle s''appliquera à la fin de la soirée en cours.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id, 'scheduled_for', v_end));
    PERFORM public.notify_collab_party('venue', r.venue_id, r.organizer_user_id, r.event_id,
      'collab_action_scheduled', 'Action programmée',
      'La ' || v_label || ' de « ' || v_title || ' » est validée. Elle s''appliquera à la fin de la soirée en cours.',
      'normal', 'event_collab_action', r.id, jsonb_build_object('action', r.action, 'event_id', r.event_id, 'scheduled_for', v_end));
    RETURN 'scheduled';
  END IF;

  -- Sinon, exécution immédiate.
  PERFORM public._execute_event_collab_action(p_request_id);
  RETURN 'executed';
END; $$;

-- ── 6. Cron : exécuter les actions programmées arrivées à échéance ─────────────
CREATE OR REPLACE FUNCTION public.process_due_collab_actions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.event_collab_action_requests
    WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= now()
    ORDER BY scheduled_for
    LIMIT 200
  LOOP
    BEGIN
      PERFORM public._execute_event_collab_action(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'process_due_collab_actions: échec demande %: %', r.id, SQLERRM;
    END;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.request_event_collab_action(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_event_collab_action(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_collab_actions() TO service_role;

-- Toutes les 15 min : applique les pauses/suppressions programmées (pure SQL,
-- pas d'edge function → pas de cap 402).
DO $$ BEGIN
  PERFORM cron.unschedule('process-due-collab-actions');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('process-due-collab-actions', '*/15 * * * *',
  $$SELECT public.process_due_collab_actions();$$);
