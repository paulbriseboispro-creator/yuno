-- Create helper functions for loyalty point adjustments
CREATE OR REPLACE FUNCTION public.increment_balance(current_val numeric, amount integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT current_val + amount;
$$;

CREATE OR REPLACE FUNCTION public.decrement_balance(current_val numeric, amount integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, current_val - amount);
$$;