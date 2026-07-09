-- CRM push : les campagnes deviennent scoppables (super admin OU club), avec
-- audience détaillée, planification et tracking par utilisateur
-- (sent/failed/clicked). Le CTR affiché = clicked / sent.

-- 1) Extensions de push_campaigns -------------------------------------------

-- Les envois déclenchés par le cron (campagnes planifiées) passent par le
-- service_role sans utilisateur : created_by devient nullable.
ALTER TABLE public.push_campaigns
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.push_campaigns
  ADD COLUMN IF NOT EXISTS venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid,
  ADD COLUMN IF NOT EXISTS audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS targeted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_push_campaigns_venue
  ON public.push_campaigns (venue_id, created_at DESC)
  WHERE venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_campaigns_scheduled
  ON public.push_campaigns (scheduled_at)
  WHERE status = 'scheduled';

-- Les owners voient l'historique des campagnes de LEUR club (l'écriture reste
-- réservée au service_role via l'edge function send-push-campaign).
CREATE POLICY "Venue owners view own push campaigns"
  ON public.push_campaigns FOR SELECT
  USING (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id));

-- 2) Tracking par utilisateur ------------------------------------------------

CREATE TABLE public.push_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.push_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('sent', 'failed', 'clicked')),
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id, event_type)
);

CREATE INDEX idx_pce_campaign ON public.push_campaign_events (campaign_id, event_type);

ALTER TABLE public.push_campaign_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages push campaign events"
  ON public.push_campaign_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Le clic est loggé côté client (PushClickTracker) par l'utilisateur lui-même,
-- via le paramètre ?pc=<campaign_id> porté par l'URL de la notification.
CREATE POLICY "Users log own clicks"
  ON public.push_campaign_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND event_type = 'clicked');

CREATE POLICY "Campaign owners read events"
  ON public.push_campaign_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.push_campaigns c
      WHERE c.id = campaign_id
        AND (
          public.is_super_admin()
          OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
        )
    )
  );
