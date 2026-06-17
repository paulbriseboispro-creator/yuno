-- Early-adopter GTM program + annual billing support.
--
-- Strategy (Yuno Pricing GTM v1.0):
--  * The first 15 hand-picked clubs get 3 months free, NO credit card, no commitment.
--    They are granted their plan directly in the DB (no Stripe subscription) with
--    `is_early_adopter = true`, status = 'trialing' and `trial_end = now() + 3 months`.
--  * After the 3 free months they convert via normal checkout (monthly OR annual).
--    If they pick ANNUAL, `price_locked` is set so their price is frozen for life
--    (we never migrate a price-locked subscription to a newer, higher price).
--  * Standard clubs get a 14-day trial WITH a credit card required at signup —
--    that flow lives entirely in Stripe, no extra columns needed here.
--
-- Annual billing itself needs no schema change: the billing interval is read live
-- from the Stripe price (recurring.interval); the annual price objects are resolved
-- by the club-subscription edge function from env (STRIPE_PRICE_*_ANNUAL).

ALTER TABLE public.venue_subscriptions
  ADD COLUMN IF NOT EXISTS is_early_adopter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venue_subscriptions.is_early_adopter IS
  'One of the first 15 pioneer clubs: 3 months free without a card, then price lock on annual.';
COMMENT ON COLUMN public.venue_subscriptions.price_locked IS
  'Annual early adopter — price frozen for life. Never migrate this subscription to a newer price.';

-- Fast lookup of the (max 15) early adopters for the admin dashboard.
CREATE INDEX IF NOT EXISTS idx_venue_subscriptions_early_adopter
  ON public.venue_subscriptions (is_early_adopter)
  WHERE is_early_adopter = true;
