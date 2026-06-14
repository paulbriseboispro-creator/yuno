-- Create table to store user taste profile from quiz
CREATE TABLE public.user_taste_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  music_style TEXT NOT NULL,
  drink_preference TEXT NOT NULL,
  vibe_preference TEXT NOT NULL,
  crowd_size TEXT NOT NULL,
  night_type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_taste_profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own taste profile
CREATE POLICY "Users can view own taste profile"
  ON public.user_taste_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own taste profile
CREATE POLICY "Users can create own taste profile"
  ON public.user_taste_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own taste profile
CREATE POLICY "Users can update own taste profile"
  ON public.user_taste_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_taste_profiles_updated_at
  BEFORE UPDATE ON public.user_taste_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add columns to profiles for personality title based on quiz
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS party_persona TEXT DEFAULT NULL;