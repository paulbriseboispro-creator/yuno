-- Create floor-plans bucket for VIP table layouts (organizer & venue uploads)
INSERT INTO storage.buckets (id, name, public)
VALUES ('floor-plans', 'floor-plans', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read access (plans are shown to clients on the booking page)
CREATE POLICY "Floor plans are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'floor-plans');

-- Authenticated users can upload floor plans
CREATE POLICY "Authenticated users can upload floor plans"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'floor-plans');

-- Authenticated users can update floor plans
CREATE POLICY "Authenticated users can update floor plans"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'floor-plans');

-- Authenticated users can delete floor plans
CREATE POLICY "Authenticated users can delete floor plans"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'floor-plans');