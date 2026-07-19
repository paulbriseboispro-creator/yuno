-- Registre plateforme des notifications push AUTOMATIQUES — piloté par le
-- super admin depuis /admin/notifications.
--
-- Trois briques :
--   1. platform_notification_settings : UN toggle global par type de notification
--      auto (transactionnelles, rappels, engagement, marketing, automatisations
--      club). C'est le kill switch au-dessus de tout — les edge functions le
--      lisent via _shared/auto-push.ts avant chaque envoi. Ligne absente = activé
--      (fail-open : une notification transactionnelle ne doit jamais mourir d'un
--      seed oublié).
--   2. auto_push_events : tracking par envoi (sent / failed / clicked) pour les
--      push auto UNITAIRES (achat, remboursement, commande prête, rappels…).
--      Les push auto en fan-out (automatisations club, nouvel événement) restent
--      trackés par la mécanique campagnes (push_campaigns source='auto' +
--      push_campaign_events) — la RPC ci-dessous agrège les deux sources.
--      Le clic est loggé côté client via le paramètre ?an=<key> (PushClickTracker),
--      miroir du ?pc=<campaign_id> des campagnes.
--   3. get_auto_push_stats() : agrégat par notification_key pour la page admin
--      (totaux + fenêtre 30 j + dernier envoi), gated super admin.

-- 1) Toggles globaux ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_notification_settings (
  notification_key text PRIMARY KEY,
  enabled          boolean NOT NULL DEFAULT true,
  category         text NOT NULL DEFAULT 'transactional'
    CHECK (category IN ('transactional', 'reminder', 'engagement', 'marketing', 'club_automation')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);

ALTER TABLE public.platform_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage notification settings"
  ON public.platform_notification_settings FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  -- Transactionnelles (client)
  ('purchase_ticket',    'transactional'),
  ('purchase_table',     'transactional'),
  ('order_ready',        'transactional'),
  ('refund_confirmed',   'transactional'),
  ('guest_list_added',   'transactional'),
  -- Rappels (détenteurs de billets)
  ('event_reminder_4h',  'reminder'),
  ('event_reminder_30m', 'reminder'),
  -- Engagement (abonnements / follows)
  ('new_event',          'engagement'),
  ('dj_lineup',          'engagement'),
  ('waitlist_presale',   'engagement'),
  -- Marketing (crons plateforme — à surveiller au CTR)
  ('cart_abandonment',   'marketing'),
  ('inactivity_reminder','marketing'),
  ('weekly_digest',      'marketing'),
  -- Automatisations club (opt-in par owner ; ceci est le master switch plateforme)
  ('reminder_day_of',    'club_automation'),
  ('event_live',         'club_automation'),
  ('thank_you',          'club_automation'),
  ('almost_sold_out',    'club_automation'),
  ('drinks_preorder',    'club_automation')
ON CONFLICT (notification_key) DO NOTHING;

-- 2) Tracking des push auto unitaires ----------------------------------------

CREATE TABLE IF NOT EXISTS public.auto_push_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_key text NOT NULL,
  user_id          uuid NOT NULL,
  event_type       text NOT NULL CHECK (event_type IN ('sent', 'failed', 'clicked')),
  platform         text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_push_events_key
  ON public.auto_push_events (notification_key, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_push_events_user
  ON public.auto_push_events (user_id, created_at DESC);

ALTER TABLE public.auto_push_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages auto push events"
  ON public.auto_push_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Le clic est loggé côté client (PushClickTracker) par l'utilisateur lui-même,
-- via le paramètre ?an=<notification_key> porté par l'URL de la notification.
CREATE POLICY "Users log own auto push clicks"
  ON public.auto_push_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND event_type = 'clicked');

CREATE POLICY "Super admins read auto push events"
  ON public.auto_push_events FOR SELECT
  USING (public.is_super_admin());

-- 3) Visibilité super admin sur les toggles d'automatisation des clubs --------
-- (la page admin affiche « activée par N clubs » ; l'écriture reste aux owners)

CREATE POLICY "Super admins view venue push automations"
  ON public.venue_push_automations FOR SELECT
  USING (public.is_super_admin());

-- 4) Agrégat pour la page admin -----------------------------------------------
-- Fusionne les deux sources de tracking : auto_push_events (push unitaires) et
-- push_campaign_events des campagnes AUTO (fan-out par template_key). Renvoie
-- zéro ligne pour un non-super-admin.

CREATE OR REPLACE FUNCTION public.get_auto_push_stats()
RETURNS TABLE (
  notification_key text,
  sent_total    bigint,
  failed_total  bigint,
  clicked_total bigint,
  sent_30d      bigint,
  failed_30d    bigint,
  clicked_30d   bigint,
  last_sent_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH all_events AS (
    SELECT e.notification_key, e.event_type, e.created_at
    FROM public.auto_push_events e
    UNION ALL
    SELECT pc.template_key, pce.event_type, pce.created_at
    FROM public.push_campaign_events pce
    JOIN public.push_campaigns pc ON pc.id = pce.campaign_id
    WHERE pc.source = 'auto' AND pc.template_key IS NOT NULL
  )
  SELECT
    ae.notification_key,
    count(*) FILTER (WHERE ae.event_type = 'sent'),
    count(*) FILTER (WHERE ae.event_type = 'failed'),
    count(*) FILTER (WHERE ae.event_type = 'clicked'),
    count(*) FILTER (WHERE ae.event_type = 'sent'    AND ae.created_at > now() - interval '30 days'),
    count(*) FILTER (WHERE ae.event_type = 'failed'  AND ae.created_at > now() - interval '30 days'),
    count(*) FILTER (WHERE ae.event_type = 'clicked' AND ae.created_at > now() - interval '30 days'),
    max(ae.created_at) FILTER (WHERE ae.event_type = 'sent')
  FROM all_events ae
  WHERE public.is_super_admin()
  GROUP BY ae.notification_key;
$$;

REVOKE ALL ON FUNCTION public.get_auto_push_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auto_push_stats() TO authenticated, service_role;
