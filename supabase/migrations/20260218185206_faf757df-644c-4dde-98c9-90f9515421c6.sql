
-- Table to store custom training entries for the Yuno chatbot
CREATE TABLE public.chatbot_training (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.chatbot_training ENABLE ROW LEVEL SECURITY;

-- Only super admins can manage training data
CREATE POLICY "Super admins can manage chatbot training"
ON public.chatbot_training
FOR ALL
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Trigger for updated_at
CREATE TRIGGER update_chatbot_training_updated_at
BEFORE UPDATE ON public.chatbot_training
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
