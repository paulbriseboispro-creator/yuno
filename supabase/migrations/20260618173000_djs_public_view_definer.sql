-- Make the public DJ profile page reachable by anonymous visitors.
--
-- A `public.djs_public` view already exists and already exposes only public-safe
-- columns of active DJs (it deliberately omits whatsapp_number, pending_amount,
-- total_paid). anon already has SELECT on it. BUT the view was set to
-- `security_invoker = true`, so it evaluated the base `djs` RLS as the calling
-- (anon) role. `djs` has no anon SELECT policy by design, so the view returned
-- zero rows and /dj/:slug always rendered "DJ introuvable" for logged-out users.
--
-- Flip the view back to owner (definer) semantics. It then bypasses base-table
-- RLS and returns active DJs, while its fixed column list guarantees no financial
-- or contact data can leak. The base `djs` table stays locked to anon, so the
-- only public surface remains this curated projection.
--
-- NOTE for future security audits: the "Security Definer View" advisor will flag
-- this view. That is intentional here — it is a vetted public projection with a
-- safe column allow-list. Do NOT switch it back to security_invoker=true without
-- first adding an anon SELECT policy to `djs`, which would re-expose the base
-- table's sensitive columns through PostgREST.

alter view public.djs_public set (security_invoker = false);

grant select on public.djs_public to anon, authenticated;
