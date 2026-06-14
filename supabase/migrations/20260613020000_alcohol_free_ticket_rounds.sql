-- Alcohol-free / minors-allowed ticket flag.
-- When a round is alcohol_free, it can be sold to minors and carries NO free drink.
-- Source of truth lives on the round (and the preset template that seeds it).

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS alcohol_free boolean NOT NULL DEFAULT false;

ALTER TABLE public.ticket_presets
  ADD COLUMN IF NOT EXISTS alcohol_free boolean NOT NULL DEFAULT false;

-- Invariant: an alcohol-free round never includes a free drink.
UPDATE public.ticket_rounds
  SET includes_drink = false
  WHERE alcohol_free = true AND includes_drink IS TRUE;
