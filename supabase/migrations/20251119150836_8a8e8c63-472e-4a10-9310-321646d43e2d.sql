-- Add column to store banner position
ALTER TABLE venues ADD COLUMN IF NOT EXISTS cover_position jsonb DEFAULT '{"x": 50, "y": 50}'::jsonb;