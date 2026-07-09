-- Mode Live en démo : session Live fabriquée SANS scan pour les comptes
-- @womber.fr (switch Explore ↔ Live du DemoSwitcher pendant les présentations).
--
-- Même pattern que demo_set_live / demo_is_live : SECURITY DEFINER + gate email
-- démo, résolution dynamique du club de owner@womber.fr. Retourne la même forme
-- que get_live_session() ; si aucun événement démo n'est dans sa fenêtre, la
-- fenêtre est synthétisée (now−1h → now+5h) pour que la surface /live vive
-- normalement (LAST CALL, timer de fin…) tout en restant liée à un vrai
-- événement (menu, tables, commandes, crédits = vraies données démo).

CREATE OR REPLACE FUNCTION public.demo_live_session()
RETURNS TABLE (
  state text,
  source text,
  event_id uuid,
  event_title text,
  event_start_at timestamptz,
  event_end_at timestamptz,
  venue_id text,
  venue_name text,
  entry_scanned_at timestamptz,
  table_reservation_id uuid,
  menu_enabled boolean,
  live_mode_enabled boolean,
  solo_bottle_sale_enabled boolean,
  client_rank integer,
  client_tier text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_venue text;
BEGIN
  IF COALESCE(auth.jwt() ->> 'email', '') NOT LIKE '%@womber.fr' THEN
    RAISE EXCEPTION 'Réservé aux comptes démo';
  END IF;

  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'live'::text,
    'ticket'::text,
    e.id,
    e.title,
    -- Fenêtre réelle si l'événement est en cours, sinon fenêtre synthétique
    CASE WHEN now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
         THEN e.start_at ELSE now() - interval '1 hour' END,
    CASE WHEN now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
         THEN e.end_at ELSE now() + interval '5 hours' END,
    v.id,
    v.name,
    now(),
    NULL::uuid,
    COALESCE(v.menu_enabled, false),
    true, -- le mode démo force le Live même si le toggle club est coupé
    v.solo_bottle_sale_enabled,
    12,        -- chip top-100 de démonstration
    'gold'::text
  FROM public.venues v
  JOIN public.events e ON e.venue_id = v.id
  WHERE v.id = v_venue
  ORDER BY
    -- priorité : événement en cours > prochain à venir > dernier passé
    CASE
      WHEN now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours' THEN 0
      WHEN e.start_at > now() THEN 1
      ELSE 2
    END,
    CASE WHEN e.start_at > now() THEN e.start_at END ASC,
    e.start_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.demo_live_session() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.demo_live_session() TO authenticated;
