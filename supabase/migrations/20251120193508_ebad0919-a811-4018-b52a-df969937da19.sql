-- Create visitor tracking table
CREATE TABLE IF NOT EXISTS public.visitor_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_agent TEXT,
  ip_address TEXT,
  visited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  added_to_cart BOOLEAN DEFAULT false,
  proceeded_to_checkout BOOLEAN DEFAULT false,
  completed_order BOOLEAN DEFAULT false,
  order_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;

-- Create policies for visitor sessions
CREATE POLICY "Everyone can insert visitor sessions"
ON public.visitor_sessions
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Owners can view visitor sessions"
ON public.visitor_sessions
FOR SELECT
USING (has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'barman'::app_role));

-- Add foreign key to venues
ALTER TABLE public.visitor_sessions
ADD CONSTRAINT visitor_sessions_venue_id_fkey
FOREIGN KEY (venue_id) REFERENCES public.venues(id);

-- Add foreign key to orders
ALTER TABLE public.visitor_sessions
ADD CONSTRAINT visitor_sessions_order_id_fkey
FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_venue_id ON public.visitor_sessions(venue_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visited_at ON public.visitor_sessions(visited_at);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_session_id ON public.visitor_sessions(session_id);