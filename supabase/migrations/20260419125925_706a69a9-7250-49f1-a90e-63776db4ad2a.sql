-- Phase 3: Co-events + split payments

-- 1. Event mode enum
DO $$ BEGIN
  CREATE TYPE public.event_mode AS ENUM ('solo_venue', 'solo_organizer', 'co_event', 'venue_rental', 'org_hosted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Extend events with co-event fields
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_mode public.event_mode,
  ADD COLUMN IF NOT EXISTS partner_venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_organizer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_split_rules jsonb;

CREATE INDEX IF NOT EXISTS idx_events_partner_venue ON public.events(partner_venue_id) WHERE partner_venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_partner_organizer ON public.events(partner_organizer_id) WHERE partner_organizer_id IS NOT NULL;

-- Backfill event_mode based on current data
UPDATE public.events
SET event_mode = CASE
  WHEN venue_id IS NOT NULL AND organizer_user_id IS NULL THEN 'solo_venue'::public.event_mode
  WHEN venue_id IS NULL AND organizer_user_id IS NOT NULL THEN 'solo_organizer'::public.event_mode
  WHEN venue_id IS NOT NULL AND organizer_user_id IS NOT NULL THEN 'co_event'::public.event_mode
  ELSE 'solo_venue'::public.event_mode
END
WHERE event_mode IS NULL;

-- 3. Revenue distributions ledger (one per payment_intent)
CREATE TABLE IF NOT EXISTS public.revenue_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id text NOT NULL UNIQUE,
  checkout_session_id text,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  item_type text NOT NULL CHECK (item_type IN ('ticket','table','drink')),
  ticket_id uuid,
  table_reservation_id uuid,
  order_id uuid,
  gross_amount_cents integer NOT NULL,
  yuno_fee_cents integer NOT NULL DEFAULT 0,
  primary_account_id text,
  primary_amount_cents integer NOT NULL DEFAULT 0,
  primary_recipient_kind text CHECK (primary_recipient_kind IN ('venue','organizer')),
  primary_recipient_venue_id text,
  primary_recipient_organizer_id uuid,
  secondary_account_id text,
  secondary_amount_cents integer NOT NULL DEFAULT 0,
  secondary_recipient_kind text CHECK (secondary_recipient_kind IN ('venue','organizer')),
  secondary_recipient_venue_id text,
  secondary_recipient_organizer_id uuid,
  secondary_transfer_id text,
  secondary_transfer_status text NOT NULL DEFAULT 'not_required' CHECK (secondary_transfer_status IN ('not_required','pending','succeeded','failed','refunded')),
  secondary_transfer_error text,
  secondary_transfer_attempts integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rev_dist_event ON public.revenue_distributions(event_id);
CREATE INDEX IF NOT EXISTS idx_rev_dist_secondary_status ON public.revenue_distributions(secondary_transfer_status) WHERE secondary_transfer_status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_rev_dist_primary_venue ON public.revenue_distributions(primary_recipient_venue_id);
CREATE INDEX IF NOT EXISTS idx_rev_dist_primary_organizer ON public.revenue_distributions(primary_recipient_organizer_id);
CREATE INDEX IF NOT EXISTS idx_rev_dist_secondary_venue ON public.revenue_distributions(secondary_recipient_venue_id);
CREATE INDEX IF NOT EXISTS idx_rev_dist_secondary_organizer ON public.revenue_distributions(secondary_recipient_organizer_id);

ALTER TABLE public.revenue_distributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage revenue_distributions"
  ON public.revenue_distributions FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Venues see their own distributions"
  ON public.revenue_distributions FOR SELECT
  USING (
    (primary_recipient_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), primary_recipient_venue_id))
    OR (secondary_recipient_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), secondary_recipient_venue_id))
  );

CREATE POLICY "Organizers see their own distributions"
  ON public.revenue_distributions FOR SELECT
  USING (
    (primary_recipient_organizer_id IS NOT NULL AND primary_recipient_organizer_id = auth.uid())
    OR (secondary_recipient_organizer_id IS NOT NULL AND secondary_recipient_organizer_id = auth.uid())
  );

CREATE TRIGGER trg_rev_dist_updated_at
  BEFORE UPDATE ON public.revenue_distributions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Helper to recompute event_mode on insert/update
CREATE OR REPLACE FUNCTION public.compute_event_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.event_mode IS NULL THEN
    IF NEW.venue_id IS NOT NULL AND NEW.partner_organizer_id IS NOT NULL THEN
      NEW.event_mode := 'co_event';
    ELSIF NEW.organizer_user_id IS NOT NULL AND NEW.partner_venue_id IS NOT NULL THEN
      NEW.event_mode := 'co_event';
    ELSIF NEW.venue_id IS NOT NULL THEN
      NEW.event_mode := 'solo_venue';
    ELSIF NEW.organizer_user_id IS NOT NULL THEN
      NEW.event_mode := 'solo_organizer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_event_mode ON public.events;
CREATE TRIGGER trg_compute_event_mode
  BEFORE INSERT OR UPDATE OF venue_id, organizer_user_id, partner_venue_id, partner_organizer_id, event_mode
  ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.compute_event_mode();