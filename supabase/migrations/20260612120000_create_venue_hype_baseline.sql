-- ────────────────────────────────────────────────────────────────────────────
--  venue_hype_baseline
--  Self-reported "before Yuno" baseline for a venue. Feeds the hype forecast
--  engine with a calibrated prior so the very first events already get a
--  meaningful projection instead of falling back to a generic nightlife curve.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_hype_baseline (
  venue_id           TEXT PRIMARY KEY,
  -- Room capacity (max people the venue can hold).
  capacity           INTEGER,
  -- Typical attendance on a good night, and on a quiet night (a range).
  typical_attendance INTEGER,
  slow_attendance    INTEGER,
  -- When customers usually buy: 'door' | 'mixed' | 'advance'.
  -- Shapes how back-loaded the expected sales curve is.
  sales_timing       TEXT,
  -- How often the venue sells out: 'never'|'rarely'|'sometimes'|'often'|'always'.
  -- Calibrates the early sellout probability.
  sellout_frequency  TEXT,
  -- Optional context: average ticket price they're used to.
  avg_ticket_price   NUMERIC,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT venue_hype_baseline_sales_timing_chk
    CHECK (sales_timing IS NULL OR sales_timing IN ('door', 'mixed', 'advance')),
  CONSTRAINT venue_hype_baseline_sellout_freq_chk
    CHECK (sellout_frequency IS NULL OR sellout_frequency IN ('never', 'rarely', 'sometimes', 'often', 'always'))
);

ALTER TABLE public.venue_hype_baseline ENABLE ROW LEVEL SECURITY;

-- Venue owner has full read/write access to their own baseline.
CREATE POLICY "venue owner full access on venue_hype_baseline"
  ON public.venue_hype_baseline
  FOR ALL
  USING (
    venue_id IN (
      SELECT v.id::text FROM public.venues v WHERE v.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT v.id::text FROM public.venues v WHERE v.owner_id = auth.uid()
    )
  );

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.touch_venue_hype_baseline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_venue_hype_baseline_updated_at ON public.venue_hype_baseline;
CREATE TRIGGER trg_venue_hype_baseline_updated_at
  BEFORE UPDATE ON public.venue_hype_baseline
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_venue_hype_baseline_updated_at();
