-- Add is_loyalty_reward column to tickets table for tracking free tickets from loyalty rewards
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_loyalty_reward boolean DEFAULT false;

-- Add metadata column to reward_redemptions for storing discount details
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;