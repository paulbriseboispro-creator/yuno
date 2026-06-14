-- Créer la table events pour gérer les événements/soirées
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT end_after_start CHECK (end_at > start_at)
);

-- Activer RLS sur events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Politique: tout le monde peut voir les événements actifs
CREATE POLICY "Everyone can view active events"
ON public.events
FOR SELECT
USING (is_active = true);

-- Politique: les owners peuvent tout voir
CREATE POLICY "Owners can view all events"
ON public.events
FOR SELECT
USING (has_role(auth.uid(), 'owner'::app_role));

-- Politique: les owners peuvent créer des événements
CREATE POLICY "Owners can create events"
ON public.events
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'owner'::app_role));

-- Politique: les owners peuvent modifier des événements
CREATE POLICY "Owners can update events"
ON public.events
FOR UPDATE
USING (has_role(auth.uid(), 'owner'::app_role));

-- Politique: les owners peuvent supprimer des événements
CREATE POLICY "Owners can delete events"
ON public.events
FOR DELETE
USING (has_role(auth.uid(), 'owner'::app_role));

-- Politique: les barmans peuvent voir tous les événements
CREATE POLICY "Barmen can view all events"
ON public.events
FOR SELECT
USING (has_role(auth.uid(), 'barman'::app_role));

-- Ajouter event_id à la table orders
ALTER TABLE public.orders 
ADD COLUMN event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

-- Index pour améliorer les performances
CREATE INDEX idx_events_venue_id ON public.events(venue_id);
CREATE INDEX idx_events_start_at ON public.events(start_at);
CREATE INDEX idx_orders_event_id ON public.orders(event_id);

-- Trigger pour mettre à jour updated_at
CREATE TRIGGER update_events_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Activer realtime pour events
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;