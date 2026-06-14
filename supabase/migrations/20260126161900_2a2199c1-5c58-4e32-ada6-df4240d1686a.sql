-- Drop the existing constraint that doesn't include free_ticket
ALTER TABLE loyalty_rewards DROP CONSTRAINT IF EXISTS loyalty_rewards_reward_type_check;

-- Add new constraint with correct reward types: free_drink, free_ticket, discount
ALTER TABLE loyalty_rewards ADD CONSTRAINT loyalty_rewards_reward_type_check 
  CHECK (reward_type = ANY (ARRAY['free_drink', 'free_ticket', 'discount']));