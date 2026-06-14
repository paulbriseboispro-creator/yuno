-- Add last_name and phone columns to launch_waitlist
ALTER TABLE public.launch_waitlist 
ADD COLUMN IF NOT EXISTS last_name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT;