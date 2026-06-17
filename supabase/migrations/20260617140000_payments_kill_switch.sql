-- Global payments kill-switch.
-- When ON, every real checkout (subscriptions, tickets, VIP tables, drinks, SMS)
-- is refused server-side. Demo accounts (@womber.fr) are never affected — they
-- always run a no-charge simulation, independent of this flag (live mode safety).
--
-- Toggled from the Super Admin dashboard. Lives next to maintenance_mode so it
-- reuses the same RLS (super-admin write, public read) and realtime channel.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS payments_disabled BOOLEAN NOT NULL DEFAULT false;

-- The frontend reads app_settings with a column-level grant (see
-- 20260503141922), same path maintenance_mode uses. Add the new column so the
-- kill-switch is visible to the public read path (banner + disabled CTAs).
-- Write stays super-admin-only via the existing RLS UPDATE policy.
GRANT SELECT (payments_disabled) ON public.app_settings TO anon, authenticated;

-- Keep the hardened public projection in sync: public pages (anon ticket/table
-- purchase) read the kill-switch through this view. security_invoker is re-set
-- because recreating the view drops view-level options.
-- payments_disabled is appended LAST: CREATE OR REPLACE VIEW only allows adding
-- columns at the end of the select list, never inserting in the middle.
CREATE OR REPLACE VIEW public.app_settings_public AS
SELECT
  id,
  maintenance_mode,
  maintenance_message,
  terms_version,
  terms_url,
  updated_at,
  payments_disabled
FROM public.app_settings
WHERE id = 'global';

ALTER VIEW public.app_settings_public SET (security_invoker = true);
GRANT SELECT ON public.app_settings_public TO anon, authenticated;
