-- ─────────────────────────────────────────────────────────────────────────────
-- Automations CRM client-scopées : win_back, birthday, vip_upsell.
--
-- Deux familles :
--   • vip_upsell est EVENT-scopée → elle rejoint get_due_push_automations
--     (fenêtre [start−48h, start−24h), soirées avec tables activées) ; l'audience
--     « détenteurs de billet sans table » est résolue par le dispatcher
--     (_shared/push-automations.ts, scope ticket_no_table). Le verrou existant
--     (index unique (event_id, template_key) WHERE source='auto') suffit.
--   • win_back / birthday sont USER-scopées (aucune soirée porteuse) → nouveau
--     couple RPC + ledger, drainé par _shared/customer-automations.ts depuis
--     process-scheduled-campaigns. Anti-spam en trois couches : ledger par
--     (club, automation, user) avec cooldown, cap global 3 push non
--     transactionnels/24 h (notification_log, vérifié par le dispatcher), et
--     kill-switch plateforme (platform_notification_settings).
--
-- Paramétrage : venue_push_automations.params jsonb — win_back {days} (défaut
-- 45, presets UI 30/45/60/90). Une colonne aujourd'hui, zéro migration demain.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) CHECK étendu + params ----------------------------------------------------

ALTER TABLE public.venue_push_automations
  DROP CONSTRAINT IF EXISTS venue_push_automations_automation_key_check;
ALTER TABLE public.venue_push_automations
  ADD CONSTRAINT venue_push_automations_automation_key_check CHECK (automation_key IN (
    'reminder_day_of', 'event_live', 'thank_you', 'almost_sold_out', 'drinks_preorder',
    'win_back', 'birthday', 'vip_upsell'
  ));

ALTER TABLE public.venue_push_automations
  ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Ledger anti-répétition par (club, automation, user) ----------------------

CREATE TABLE IF NOT EXISTS public.venue_automation_sends (
  venue_id       text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  automation_key text NOT NULL,
  user_id        uuid NOT NULL,
  last_sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, automation_key, user_id)
);

-- Service-role uniquement : RLS activée, aucune policy.
ALTER TABLE public.venue_automation_sends ENABLE ROW LEVEL SECURITY;

-- 3) Claim atomique (anti double-fire entre deux runs de cron concurrents) ----
--
-- INSERT … ON CONFLICT DO UPDATE conditionnel : le UPDATE ne passe que si le
-- cooldown est écoulé. FOUND = ce run a gagné le droit d'envoyer.

CREATE OR REPLACE FUNCTION public.try_claim_customer_automation(
  p_venue_id text,
  p_key text,
  p_user_id uuid,
  p_cooldown_days int
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role only' USING ERRCODE = '42501';
  END IF;

  INSERT INTO venue_automation_sends AS vas (venue_id, automation_key, user_id, last_sent_at)
  VALUES (p_venue_id, p_key, p_user_id, now())
  ON CONFLICT (venue_id, automation_key, user_id) DO UPDATE
    SET last_sent_at = now()
    WHERE vas.last_sent_at < now() - make_interval(days => p_cooldown_days);

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.try_claim_customer_automation(text, text, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_customer_automation(text, text, uuid, int) TO service_role;

-- 4) Cibles « dues » des automations user-scopées ------------------------------
--
--   win_back : clients dont la dernière visite date de plus de N jours
--     (params.days, défaut 45) mais de moins d'un an (au-delà, le client est
--     parti — le push serait du spam), non bannis, pas relancés depuis 90 j.
--   birthday : anniversaire aujourd'hui (profiles.birth_date), pas fêté
--     depuis 300 j (dédup annuelle avec marge).
-- LIMIT 500 par run et par famille : à la première activation sur un gros
-- club, la file s'écoule en quelques passages de cron au lieu d'un flood.

CREATE OR REPLACE FUNCTION public.get_due_customer_automation_targets()
RETURNS TABLE (
  venue_id       text,
  venue_name     text,
  automation_key text,
  user_id        uuid,
  first_name     text,
  params         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (
    SELECT a.venue_id, v.name, a.automation_key, vc.user_id, vc.first_name, a.params
    FROM public.venue_push_automations a
    JOIN public.venues v ON v.id = a.venue_id
    JOIN public.venue_customers vc ON vc.venue_id = a.venue_id
    WHERE a.enabled = true
      AND a.automation_key = 'win_back'
      AND vc.user_id IS NOT NULL
      AND vc.is_banned = false
      AND vc.last_visit_at < now() - make_interval(days => GREATEST(7, COALESCE((a.params->>'days')::int, 45)))
      AND vc.last_visit_at > now() - interval '365 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.venue_automation_sends vas
        WHERE vas.venue_id = a.venue_id
          AND vas.automation_key = 'win_back'
          AND vas.user_id = vc.user_id
          AND vas.last_sent_at > now() - interval '90 days'
      )
    LIMIT 500
  )
  UNION ALL
  (
    SELECT a.venue_id, v.name, a.automation_key, vc.user_id, vc.first_name, a.params
    FROM public.venue_push_automations a
    JOIN public.venues v ON v.id = a.venue_id
    JOIN public.venue_customers vc ON vc.venue_id = a.venue_id
    JOIN public.profiles pr ON pr.id = vc.user_id
    WHERE a.enabled = true
      AND a.automation_key = 'birthday'
      AND vc.user_id IS NOT NULL
      AND vc.is_banned = false
      AND pr.birth_date IS NOT NULL
      AND to_char(pr.birth_date, 'MM-DD') = to_char(now(), 'MM-DD')
      AND NOT EXISTS (
        SELECT 1 FROM public.venue_automation_sends vas
        WHERE vas.venue_id = a.venue_id
          AND vas.automation_key = 'birthday'
          AND vas.user_id = vc.user_id
          AND vas.last_sent_at > now() - interval '300 days'
      )
    LIMIT 500
  );
$$;

REVOKE ALL ON FUNCTION public.get_due_customer_automation_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_customer_automation_targets() TO service_role;

-- 5) vip_upsell rejoint get_due_push_automations ------------------------------
--
-- Fenêtre [start−48h, start−24h) : assez tôt pour organiser sa soirée, assez
-- tard pour que l'intention soit réelle. Seulement si la soirée vend des
-- tables (events.tables_enabled). L'audience ticket_no_table est résolue par
-- le dispatcher. Corps intégralement restaté depuis 20260712100000.

CREATE OR REPLACE FUNCTION public.get_due_push_automations()
RETURNS TABLE (
  venue_id       text,
  venue_name     text,
  event_id       uuid,
  event_title    text,
  event_slug     text,
  automation_key text,
  start_at       timestamptz,
  end_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.venue_id,
    v.name,
    e.id,
    e.title,
    e.slug,
    a.automation_key,
    e.start_at,
    e.end_at
  FROM public.venue_push_automations a
  JOIN public.venues v ON v.id = a.venue_id
  JOIN public.events e ON e.venue_id = a.venue_id
  WHERE a.enabled = true
    AND e.venue_id IS NOT NULL
    AND e.is_active = true
    AND e.cancelled_at IS NULL
    -- Bornage pour garder la jointure petite (le cron passe toutes les 5 min).
    AND e.end_at   > now() - interval '12 hours'
    AND e.start_at < now() + interval '30 days'
    AND (
      (a.automation_key = 'reminder_day_of'
        AND now() >= e.start_at - interval '6 hours'
        AND now() <  e.start_at)
      OR (a.automation_key = 'event_live'
        AND now() >= e.start_at
        AND now() <  e.start_at + interval '3 hours')
      OR (a.automation_key = 'thank_you'
        AND now() >= e.end_at + interval '1 hour'
        AND now() <  e.end_at + interval '8 hours')
      OR (a.automation_key = 'almost_sold_out'
        AND e.start_at > now()
        AND e.max_tickets IS NOT NULL
        AND e.max_tickets > 0
        AND (
          SELECT count(*) FROM public.tickets t
          WHERE t.event_id = e.id AND t.status = 'paid'
        ) >= (e.max_tickets * 0.85))
      OR (a.automation_key = 'drinks_preorder'
        -- NULL = activé, comme le front (menu_enabled !== false).
        AND v.menu_enabled IS DISTINCT FROM false
        AND now() >= e.start_at - interval '9 hours'
        AND now() <  e.start_at - interval '6 hours')
      OR (a.automation_key = 'vip_upsell'
        AND e.tables_enabled = true
        AND now() >= e.start_at - interval '48 hours'
        AND now() <  e.start_at - interval '24 hours')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.push_campaigns pc
      WHERE pc.event_id = e.id
        AND pc.template_key = a.automation_key
        AND pc.source = 'auto'
    );
$$;

-- Réservé au service_role (appelée par le dispatcher cron), jamais exposée au client.
REVOKE ALL ON FUNCTION public.get_due_push_automations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_push_automations() TO service_role;

-- 6) Kill-switches plateforme (fail-open : absent = activé) -------------------

INSERT INTO public.platform_notification_settings (notification_key, enabled, category)
VALUES
  ('win_back',   true, 'club_automation'),
  ('birthday',   true, 'club_automation'),
  ('vip_upsell', true, 'club_automation')
ON CONFLICT (notification_key) DO NOTHING;
