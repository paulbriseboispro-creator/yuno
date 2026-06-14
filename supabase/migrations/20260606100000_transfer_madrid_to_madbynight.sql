-- ============================================================
-- Transfer all Madrid clubs & events from fake "Yuno Madrid"
-- seed affiliate to the real MadByNight account (Milo).
--
-- Context:
--   Fake seed affiliate: id = a0000000-0000-0000-0000-000000000001
--                        name = "Yuno Madrid", user_id = paul's account
--   Real affiliate:      id = 213e5471-bef8-4c2e-91e3-29c6e4d79015
--                        name = "MadByNight", user_id = milodelloyecoiteux@gmail.com
--
-- Duplicate venue: "Fitz Madrid" exists in BOTH affiliates.
--   Yuno Madrid Fitz:  b403cbb0-eba3-4793-8d71-dd98d9fe26bd  (has events, to delete)
--   MadByNight Fitz:   e3700b47-ee12-4c1a-a7bb-4658b286b518  (keep this one)
-- ============================================================

BEGIN;

-- 1. Redirect Fitz events from the duplicate venue to MadByNight's Fitz
UPDATE public.affiliate_events
SET
  affiliate_id       = '213e5471-bef8-4c2e-91e3-29c6e4d79015',
  affiliate_venue_id = 'e3700b47-ee12-4c1a-a7bb-4658b286b518'
WHERE affiliate_venue_id = 'b403cbb0-eba3-4793-8d71-dd98d9fe26bd';

-- 2. Transfer all remaining events to MadByNight
UPDATE public.affiliate_events
SET affiliate_id = '213e5471-bef8-4c2e-91e3-29c6e4d79015'
WHERE affiliate_id = 'a0000000-0000-0000-0000-000000000001';

-- 3. Transfer all remaining venues (non-duplicate) to MadByNight
UPDATE public.affiliate_venues
SET affiliate_id = '213e5471-bef8-4c2e-91e3-29c6e4d79015'
WHERE affiliate_id = 'a0000000-0000-0000-0000-000000000001'
  AND id != 'b403cbb0-eba3-4793-8d71-dd98d9fe26bd';

-- 4. Delete the duplicate Fitz Madrid venue (now orphaned)
DELETE FROM public.affiliate_venues
WHERE id = 'b403cbb0-eba3-4793-8d71-dd98d9fe26bd';

-- 5. Remove the affiliate role from Paul's account (was only needed for the seed)
DELETE FROM public.user_roles
WHERE user_id = 'fceae0a5-d888-48f2-8c99-7c32c9559476'
  AND role = 'affiliate';

-- 6. Delete the fake "Yuno Madrid" seed affiliate
DELETE FROM public.affiliates
WHERE id = 'a0000000-0000-0000-0000-000000000001';

COMMIT;
