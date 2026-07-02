-- Caps de permission par promoteur définis par l'agence.
-- Permet à l'agence de restreindre ce que chaque promoteur peut vendre
-- et de fixer des plafonds de ventes par type.

ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS agency_can_sell_tickets boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agency_can_sell_tables  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agency_ticket_cap       int,   -- NULL = pas de plafond
  ADD COLUMN IF NOT EXISTS agency_table_cap        int;   -- NULL = pas de plafond
