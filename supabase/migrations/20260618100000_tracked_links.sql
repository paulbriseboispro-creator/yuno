-- Tracked links — système unifié d'attribution par canal (owner / organizer / promoteur).
-- Liens nommés (instagram, tiktok, newsletter, flyer-paris…) pointant vers un event,
-- une venue ou un profil organisateur. Compte les clics et attribue les achats
-- (billets / tables VIP / boissons) au bon lien, avec revenu attribué.

-- =============================================================================
-- 1. Table tracked_links (créateur + cible polymorphes)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tracked_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text UNIQUE NOT NULL,            -- slug court pour /l/:code
  label              text NOT NULL,                   -- nom affiché ("instagram")
  owner_kind         text NOT NULL CHECK (owner_kind IN ('venue','organizer','promoter')),
  venue_id           text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid,                            -- auth user (organizer-owned)
  promoter_id        uuid REFERENCES public.promoters(id) ON DELETE CASCADE,
  created_by         uuid NOT NULL DEFAULT auth.uid(),
  target_kind        text NOT NULL CHECK (target_kind IN ('event','venue','organizer')),
  event_id           uuid REFERENCES public.events(id) ON DELETE CASCADE,
  target_venue_id    text REFERENCES public.venues(id) ON DELETE CASCADE,
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  clicks_count       integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracked_links_owner_chk CHECK (
    (owner_kind = 'venue'     AND venue_id IS NOT NULL          AND promoter_id IS NULL) OR
    (owner_kind = 'organizer' AND organizer_user_id IS NOT NULL AND promoter_id IS NULL) OR
    (owner_kind = 'promoter'  AND promoter_id IS NOT NULL)
  ),
  CONSTRAINT tracked_links_target_chk CHECK (
    (target_kind = 'event'     AND event_id IS NOT NULL)          OR
    (target_kind = 'venue'     AND target_venue_id IS NOT NULL)   OR
    (target_kind = 'organizer' AND organizer_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tracked_links_venue     ON public.tracked_links(venue_id)          WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracked_links_org       ON public.tracked_links(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracked_links_promoter  ON public.tracked_links(promoter_id)       WHERE promoter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracked_links_event     ON public.tracked_links(event_id)          WHERE event_id IS NOT NULL;

-- =============================================================================
-- 2. Table tracked_link_clicks (log brut — calqué sur promoter_clicks)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tracked_link_clicks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracked_link_id  uuid NOT NULL REFERENCES public.tracked_links(id) ON DELETE CASCADE,
  clicked_at       timestamptz NOT NULL DEFAULT now(),
  ip_hash          text,
  user_agent       text,
  referrer         text,
  visitor_id       text,
  device_type      text
);
CREATE INDEX IF NOT EXISTS idx_tracked_link_clicks_link ON public.tracked_link_clicks(tracked_link_id);

-- =============================================================================
-- 3. Colonnes d'attribution sur les lignes d'achat (réutilise le pattern purchase_source)
-- =============================================================================
ALTER TABLE public.tickets            ADD COLUMN IF NOT EXISTS tracked_link_id uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS tracked_link_id uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL;
ALTER TABLE public.orders             ADD COLUMN IF NOT EXISTS tracked_link_id uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_tracked_link            ON public.tickets(tracked_link_id)            WHERE tracked_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_table_reservations_tracked_link ON public.table_reservations(tracked_link_id) WHERE tracked_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tracked_link             ON public.orders(tracked_link_id)             WHERE tracked_link_id IS NOT NULL;

-- =============================================================================
-- 4. RLS
-- =============================================================================
ALTER TABLE public.tracked_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_link_clicks ENABLE ROW LEVEL SECURITY;

-- Le propriétaire gère ses propres liens (CRUD complet).
DROP POLICY IF EXISTS tracked_links_owner_all ON public.tracked_links;
CREATE POLICY tracked_links_owner_all ON public.tracked_links
  FOR ALL TO authenticated
  USING (
    (owner_kind = 'venue'     AND EXISTS (SELECT 1 FROM public.venues v    WHERE v.id = tracked_links.venue_id   AND v.owner_id = auth.uid())) OR
    (owner_kind = 'organizer' AND organizer_user_id = auth.uid()) OR
    (owner_kind = 'promoter'  AND EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = tracked_links.promoter_id AND p.user_id = auth.uid()))
  )
  WITH CHECK (
    (owner_kind = 'venue'     AND EXISTS (SELECT 1 FROM public.venues v    WHERE v.id = tracked_links.venue_id   AND v.owner_id = auth.uid())) OR
    (owner_kind = 'organizer' AND organizer_user_id = auth.uid()) OR
    (owner_kind = 'promoter'  AND EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = tracked_links.promoter_id AND p.user_id = auth.uid()))
  );

-- Le propriétaire du lien lit le détail de ses clics. (Insertions via RPC SECURITY DEFINER.)
DROP POLICY IF EXISTS tracked_link_clicks_owner_select ON public.tracked_link_clicks;
CREATE POLICY tracked_link_clicks_owner_select ON public.tracked_link_clicks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tracked_links tl
    WHERE tl.id = tracked_link_clicks.tracked_link_id AND (
      (tl.owner_kind = 'venue'     AND EXISTS (SELECT 1 FROM public.venues v    WHERE v.id = tl.venue_id   AND v.owner_id = auth.uid())) OR
      (tl.owner_kind = 'organizer' AND tl.organizer_user_id = auth.uid()) OR
      (tl.owner_kind = 'promoter'  AND EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = tl.promoter_id AND p.user_id = auth.uid()))
    )
  ));

-- =============================================================================
-- 5. RPC record_tracked_link_click — clic public + résolution de la cible
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_tracked_link_click(
  p_code        text,
  p_visitor_id  text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_referrer    text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL,
  p_ip_hash     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_link         public.tracked_links%ROWTYPE;
  v_event_venue  text;
  v_org_slug     text;
  v_recent       boolean := false;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Dédup léger : même visiteur sur le même lien en <30 min ne recompte pas le clic.
  IF p_visitor_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tracked_link_clicks
      WHERE tracked_link_id = v_link.id AND visitor_id = p_visitor_id
        AND clicked_at > now() - interval '30 minutes'
    ) INTO v_recent;
  END IF;

  INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type)
  VALUES (v_link.id, p_ip_hash, p_user_agent, p_referrer, p_visitor_id, p_device_type);

  IF NOT v_recent THEN
    UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
  END IF;

  IF v_link.target_kind = 'event' THEN
    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_link.event_id;
  END IF;
  IF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_org_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
  END IF;

  RETURN jsonb_build_object(
    'found',           true,
    'tracked_link_id', v_link.id,
    'target_kind',     v_link.target_kind,
    'event_id',        v_link.event_id,
    'event_venue_id',  v_event_venue,
    'target_venue_id', v_link.target_venue_id,
    'organizer_slug',  v_org_slug
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.record_tracked_link_click(text,text,text,text,text,text) TO anon, authenticated;

-- =============================================================================
-- 6. RPC get_tracked_link_stats — clics + conversions + revenu attribué par lien
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_tracked_link_stats(
  p_owner_kind        text,
  p_venue_id          text  DEFAULT NULL,
  p_organizer_user_id uuid  DEFAULT NULL,
  p_promoter_id       uuid  DEFAULT NULL,
  p_event_id          uuid  DEFAULT NULL
) RETURNS TABLE (
  id          uuid,
  code        text,
  label       text,
  target_kind text,
  event_id    uuid,
  is_active   boolean,
  created_at  timestamptz,
  clicks      integer,
  conversions bigint,
  revenue     numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Autorisation : le caller doit posséder le scope demandé.
  IF p_owner_kind = 'venue' THEN
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'organizer' THEN
    IF p_organizer_user_id IS NULL OR p_organizer_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'promoter' THEN
    IF NOT EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = p_promoter_id AND p.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid owner_kind';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT tl.* FROM public.tracked_links tl
    WHERE tl.owner_kind = p_owner_kind
      AND ( (p_owner_kind = 'venue'     AND tl.venue_id = p_venue_id)
         OR (p_owner_kind = 'organizer' AND tl.organizer_user_id = p_organizer_user_id)
         OR (p_owner_kind = 'promoter'  AND tl.promoter_id = p_promoter_id) )
      AND (p_event_id IS NULL OR tl.event_id = p_event_id)
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT tracked_link_id, total_price AS amt FROM public.tickets            WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total_price AS amt FROM public.table_reservations WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total       AS amt FROM public.orders             WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
    ) all_conv
    GROUP BY tracked_link_id
  )
  SELECT l.id, l.code, l.label, l.target_kind, l.event_id, l.is_active, l.created_at,
         l.clicks_count, coalesce(conv.c, 0), coalesce(conv.rev, 0)
  FROM links l
  LEFT JOIN conv ON conv.tracked_link_id = l.id
  ORDER BY l.created_at DESC;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_tracked_link_stats(text,text,uuid,uuid,uuid) TO authenticated;
