-- Add bar configuration to venues
ALTER TABLE public.venues 
ADD COLUMN IF NOT EXISTS bar_count integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS bar_names text[] DEFAULT ARRAY['Bar Principal'];

-- Add bar selection to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS selected_bar text,
ADD COLUMN IF NOT EXISTS assigned_bar text;

-- Create reward type enum for promoters
DO $$ BEGIN
  CREATE TYPE public.promoter_reward_type AS ENUM ('money', 'free_entry', 'vip', 'drinks');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create condition type enum for promoters
DO $$ BEGIN
  CREATE TYPE public.promoter_condition_type AS ENUM ('tickets', 'drinks', 'tables', 'revenue');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add reward configuration to promoters
ALTER TABLE public.promoters
ADD COLUMN IF NOT EXISTS reward_type text DEFAULT 'money',
ADD COLUMN IF NOT EXISTS reward_config jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS min_condition_type text,
ADD COLUMN IF NOT EXISTS min_condition_value integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS condition_met boolean DEFAULT false;