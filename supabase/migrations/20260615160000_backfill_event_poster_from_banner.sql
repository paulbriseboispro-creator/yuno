-- Events now use a single 1:1 square photo (poster_url). The 16:9 banner
-- (image_url) is being retired from the product. For legacy events that only
-- had a banner and no poster, copy the banner into poster_url so they keep a
-- visible image (shown center-cropped to 1:1 like every other event photo).
--
-- Non-destructive and idempotent: only fills NULL posters, never overwrites an
-- existing poster_url. The image_url column itself is left in place for now —
-- it is still read by deployed edge functions and can only be dropped once those
-- are updated and redeployed (see supabase/DEFERRED_drop_event_banner.sql).
UPDATE public.events
SET poster_url = image_url
WHERE poster_url IS NULL
  AND image_url IS NOT NULL;
