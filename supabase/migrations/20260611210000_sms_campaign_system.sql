-- SMS Campaign System
-- Adds per-checkout SMS consent, venue contact list, and campaign recipient RPCs.

-- 1. Add sms_opt_in to tickets
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;

-- 2. Add sms_opt_in to table_reservations
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;

-- 3. venue_sms_contacts — one row per (venue, phone) pair, upserted at checkout
CREATE TABLE IF NOT EXISTS public.venue_sms_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  phone_e164 TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  sms_consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consent_source TEXT NOT NULL DEFAULT 'checkout',
  source_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  is_vip BOOLEAN NOT NULL DEFAULT false,
  unsubscribed BOOLEAN NOT NULL DEFAULT false,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_sms_contacts_unique_phone UNIQUE (venue_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_sms_contacts_venue ON public.venue_sms_contacts (venue_id) WHERE NOT unsubscribed;
CREATE INDEX IF NOT EXISTS idx_sms_contacts_event ON public.venue_sms_contacts (source_event_id) WHERE source_event_id IS NOT NULL;

ALTER TABLE public.venue_sms_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_contacts_owner_all" ON public.venue_sms_contacts
  FOR ALL TO authenticated
  USING (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- 4. RPC: resolve_sms_campaign_recipients
-- Returns distinct non-unsubscribed contacts for a venue, filtered by segment.
CREATE OR REPLACE FUNCTION public.resolve_sms_campaign_recipients(
  p_venue_id TEXT,
  p_segment_type TEXT,             -- 'all' | 'event' | 'vip'
  p_event_id UUID DEFAULT NULL
)
RETURNS TABLE(
  contact_id UUID,
  phone_e164 TEXT,
  full_name TEXT,
  user_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.phone_e164, c.full_name, c.user_id
  FROM public.venue_sms_contacts c
  WHERE c.venue_id = p_venue_id
    AND NOT c.unsubscribed
    AND CASE
          WHEN p_segment_type = 'event' THEN c.source_event_id = p_event_id
          WHEN p_segment_type = 'vip'   THEN c.is_vip = true
          ELSE true  -- 'all'
        END
  ORDER BY c.sms_consent_at DESC;
END; $$;

GRANT EXECUTE ON FUNCTION public.resolve_sms_campaign_recipients(TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sms_campaign_recipients(TEXT, TEXT, UUID) TO service_role;

-- 5. RPC: count_sms_campaign_recipients
CREATE OR REPLACE FUNCTION public.count_sms_campaign_recipients(
  p_venue_id TEXT,
  p_segment_type TEXT,
  p_event_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.venue_sms_contacts c
  WHERE c.venue_id = p_venue_id
    AND NOT c.unsubscribed
    AND CASE
          WHEN p_segment_type = 'event' THEN c.source_event_id = p_event_id
          WHEN p_segment_type = 'vip'   THEN c.is_vip = true
          ELSE true
        END;
  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.count_sms_campaign_recipients(TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_sms_campaign_recipients(TEXT, TEXT, UUID) TO service_role;
