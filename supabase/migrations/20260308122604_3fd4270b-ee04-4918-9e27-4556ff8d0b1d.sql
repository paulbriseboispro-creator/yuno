
-- Migrate existing venue_onboarding records from 7-step to 9-step format
-- Old mapping: 1=Basics, 2=Stripe, 3=Staff, 4=Menu, 5=Event, 6=Preview, 7=GoLive
-- New mapping: 1=Basics, 2=Design, 3=Branding, 4=Stripe, 5=Staff, 6=Menu, 7=Event, 8=Preview, 9=GoLive

UPDATE public.venue_onboarding
SET 
  steps = jsonb_build_object(
    '1', COALESCE(steps->'1', '{"status":"not_started","completed_at":null}'::jsonb),
    '2', '{"status":"not_started","completed_at":null}'::jsonb,
    '3', '{"status":"not_started","completed_at":null}'::jsonb,
    '4', COALESCE(steps->'2', '{"status":"not_started","completed_at":null}'::jsonb),
    '5', COALESCE(steps->'3', '{"status":"not_started","completed_at":null}'::jsonb),
    '6', COALESCE(steps->'4', '{"status":"not_started","completed_at":null}'::jsonb),
    '7', COALESCE(steps->'5', '{"status":"not_started","completed_at":null}'::jsonb),
    '8', COALESCE(steps->'6', '{"status":"not_started","completed_at":null}'::jsonb),
    '9', COALESCE(steps->'7', '{"status":"not_started","completed_at":null}'::jsonb)
  ),
  current_step = CASE 
    WHEN current_step = 1 THEN 1
    WHEN current_step = 2 THEN 4
    WHEN current_step = 3 THEN 5
    WHEN current_step = 4 THEN 6
    WHEN current_step = 5 THEN 7
    WHEN current_step = 6 THEN 8
    WHEN current_step = 7 THEN 9
    ELSE current_step
  END,
  updated_at = now()
WHERE completed_at IS NULL
  AND NOT (steps ? '9');
