-- Add RLS policy to allow users to delete their own pending orders
CREATE POLICY "Users can delete their own pending orders"
ON orders
FOR DELETE
USING (auth.uid() = user_id AND status = 'pending');