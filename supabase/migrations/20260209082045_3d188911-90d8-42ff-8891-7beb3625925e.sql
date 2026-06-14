-- Add duration_seconds column to track how long each visitor stayed
ALTER TABLE public.visitor_sessions ADD COLUMN IF NOT EXISTS duration_seconds integer DEFAULT NULL;

-- Add user_id column to better track returning visitors
ALTER TABLE public.visitor_sessions ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT NULL;