-- Phase 3: Minimum Spend et Upsell Tracking

-- 1. Ajouter minimum_spend aux table_packs
ALTER TABLE public.table_packs
ADD COLUMN IF NOT EXISTS minimum_spend NUMERIC DEFAULT 0;

-- 2. Ajouter minimum_spend aux table_reservations (copié du pack lors de la réservation)
ALTER TABLE public.table_reservations
ADD COLUMN IF NOT EXISTS minimum_spend NUMERIC DEFAULT 0;

-- 3. Ajouter staff_id à vip_consumptions pour tracker qui a servi
ALTER TABLE public.vip_consumptions
ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES auth.users(id);

-- 4. Créer la table vip_upsell_stats pour les analytics
CREATE TABLE IF NOT EXISTS public.vip_upsell_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  reservation_id UUID NOT NULL REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES auth.users(id),
  minimum_spend NUMERIC NOT NULL DEFAULT 0,
  total_consumed NUMERIC NOT NULL DEFAULT 0,
  upsell_amount NUMERIC NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_vip_upsell_stats_venue_event 
ON public.vip_upsell_stats(venue_id, event_id);

CREATE INDEX IF NOT EXISTS idx_vip_upsell_stats_staff 
ON public.vip_upsell_stats(staff_id);

CREATE INDEX IF NOT EXISTS idx_vip_consumptions_staff 
ON public.vip_consumptions(staff_id);

-- 6. Enable RLS
ALTER TABLE public.vip_upsell_stats ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies pour vip_upsell_stats
-- Owners can view stats for their venues
CREATE POLICY "Owners can view upsell stats for their venues"
ON public.vip_upsell_stats
FOR SELECT
USING (public.is_venue_owner(auth.uid(), venue_id));

-- VIP Host/Staff with venue access can view
CREATE POLICY "Staff can view upsell stats for their venue"
ON public.vip_upsell_stats
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.venue_id = vip_upsell_stats.venue_id
  )
);

-- Insert allowed for staff of the venue
CREATE POLICY "Staff can insert upsell stats"
ON public.vip_upsell_stats
FOR INSERT
WITH CHECK (
  public.is_venue_owner(auth.uid(), venue_id) OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.venue_id = vip_upsell_stats.venue_id
  )
);

-- 8. Fonction pour calculer les stats upsell d'une réservation
CREATE OR REPLACE FUNCTION public.calculate_vip_upsell(p_reservation_id UUID)
RETURNS TABLE(
  minimum_spend NUMERIC,
  total_consumed NUMERIC,
  upsell_amount NUMERIC,
  remaining_to_minimum NUMERIC,
  upsell_percent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_minimum NUMERIC;
  v_consumed NUMERIC;
  v_upsell NUMERIC;
  v_remaining NUMERIC;
BEGIN
  -- Get minimum spend from reservation
  SELECT COALESCE(tr.minimum_spend, 0) INTO v_minimum
  FROM table_reservations tr
  WHERE tr.id = p_reservation_id;
  
  -- Calculate total consumed
  SELECT COALESCE(SUM(total_price), 0) INTO v_consumed
  FROM vip_consumptions
  WHERE table_reservation_id = p_reservation_id;
  
  -- Calculate upsell (amount above minimum)
  v_upsell := GREATEST(0, v_consumed - v_minimum);
  
  -- Calculate remaining to reach minimum
  v_remaining := GREATEST(0, v_minimum - v_consumed);
  
  RETURN QUERY SELECT 
    v_minimum,
    v_consumed,
    v_upsell,
    v_remaining,
    CASE WHEN v_minimum > 0 THEN ROUND((v_consumed / v_minimum) * 100, 1) ELSE 100 END;
END;
$$;

-- 9. Commentaires pour documentation
COMMENT ON COLUMN public.table_packs.minimum_spend IS 'Minimum de consommation requis pour ce pack';
COMMENT ON COLUMN public.table_reservations.minimum_spend IS 'Minimum de consommation copié du pack au moment de la réservation';
COMMENT ON COLUMN public.vip_consumptions.staff_id IS 'ID du staff qui a servi cet item (pour commission tracking)';
COMMENT ON TABLE public.vip_upsell_stats IS 'Statistiques d''upsell par réservation pour analytics';