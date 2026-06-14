-- Add age verification fields to profiles table
ALTER TABLE public.profiles
ADD COLUMN birth_date date,
ADD COLUMN age_verified_at timestamp with time zone;