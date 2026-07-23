-- =====================================================================
-- Liens par canal d'une guest list — on REPREND le système `tracked_links`
-- (celui des owners pour partager leurs soirées) au lieu du mécanisme maison
-- `guest_list_share_links` introduit la veille, qui refaisait en moins bien ce
-- qui existait déjà : canaux auto-créés, clics dédupliqués, conversions,
-- redirection /l/<code>, et pour un promoteur le ?ref= qui déclenche sa
-- commission.
--
-- Ajouts :
--   1. `target_kind = 'guestlist'` + colonne `guest_list_id` sur tracked_links.
--   2. `guest_list_entries.tracked_link_id` : une inscription guest list
--      devient une conversion du lien qui l'a amenée.
--   3. record_tracked_link_click résout la cible guest list (token de la part).
--   4. get_tracked_link_stats compte les inscriptions guest list.
--   5. seed_guest_list_tracked_links : les 4 canaux par défaut, comme pour un
--      event ou un club — le détenteur n'a plus qu'à partager.
--
-- Et retrait de guest_list_share_links (+ share_link_id), remplacé.
-- =====================================================================

-- ── 1) Ouvrir la cible « guest list » ────────────────────────────────────
ALTER TABLE public.tracked_links
  ADD COLUMN IF NOT EXISTS guest_list_id uuid REFERENCES public.guest_lists(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tracked_links_guest_list
  ON public.tracked_links (guest_list_id) WHERE guest_list_id IS NOT NULL;

-- DEUX contraintes gouvernent la cible : celle sur l'énuméré (inline, nom
-- auto-généré) ET celle de cohérence. Ne toucher qu'à l'une laisse l'autre
-- refuser 'guestlist'.
ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_target_kind_check;
ALTER TABLE public.tracked_links
  ADD CONSTRAINT tracked_links_target_kind_check
  CHECK (target_kind IN ('event', 'venue', 'organizer', 'guestlist'));

ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_target_chk;
ALTER TABLE public.tracked_links
  ADD CONSTRAINT tracked_links_target_chk CHECK (
       (target_kind = 'event'     AND event_id IS NOT NULL)
    OR (target_kind = 'venue'     AND target_venue_id IS NOT NULL)
    OR (target_kind = 'organizer' AND organizer_user_id IS NOT NULL)
    OR (target_kind = 'guestlist' AND guest_list_id IS NOT NULL)
  );

-- ── 2) Attribution d'une inscription guest list ──────────────────────────
ALTER TABLE public.guest_list_entries
  ADD COLUMN IF NOT EXISTS tracked_link_id uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_list_entries_tracked_link
  ON public.guest_list_entries (tracked_link_id) WHERE tracked_link_id IS NOT NULL;

-- ── 3) Résolution du clic (v3 : + branche guest list) ────────────────────
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
  v_link        public.tracked_links%ROWTYPE;
  v_event_venue text;
  v_org_slug    text;
  v_promo_code  text;
  v_recent      boolean := false;
  v_gl_token    text;
  v_gl_event    uuid;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

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
  -- Guest list : on renvoie le token de la PART, seul moyen d'ouvrir une part
  -- déléguée (elles ne sont pas listées sur la page publique de la soirée).
  IF v_link.target_kind = 'guestlist' THEN
    SELECT gl.share_token, gl.event_id INTO v_gl_token, v_gl_event
    FROM public.guest_lists gl
    WHERE gl.id = v_link.guest_list_id AND gl.is_active = true;
    IF v_gl_event IS NOT NULL THEN
      SELECT COALESCE(e.venue_id, e.partner_venue_id) INTO v_event_venue
      FROM public.events e WHERE e.id = v_gl_event;
    END IF;
  END IF;
  IF v_link.owner_kind = 'promoter' THEN
    SELECT promo_code INTO v_promo_code FROM public.promoters WHERE id = v_link.promoter_id;
  END IF;

  RETURN jsonb_build_object(
    'found',              true,
    'tracked_link_id',    v_link.id,
    'target_kind',        v_link.target_kind,
    'event_id',           v_link.event_id,
    'event_venue_id',     v_event_venue,
    'target_venue_id',    v_link.target_venue_id,
    'organizer_slug',     v_org_slug,
    'promo_code',         v_promo_code,
    'guest_list_token',   v_gl_token,
    'guest_list_event_id', v_gl_event
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.record_tracked_link_click(text,text,text,text,text,text) TO anon, authenticated;

-- ── 4) Stats (v4 : filtre guest list + inscriptions en conversions) ──────
DROP FUNCTION IF EXISTS public.get_tracked_link_stats(text,text,uuid,uuid,uuid,uuid,text);

CREATE OR REPLACE FUNCTION public.get_tracked_link_stats(
  p_owner_kind        text,
  p_venue_id          text  DEFAULT NULL,
  p_organizer_user_id uuid  DEFAULT NULL,
  p_promoter_id       uuid  DEFAULT NULL,
  p_dj_id             uuid  DEFAULT NULL,
  p_event_id          uuid  DEFAULT NULL,
  p_target_kind       text  DEFAULT NULL,
  p_guest_list_id     uuid  DEFAULT NULL
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
  ELSIF p_owner_kind = 'dj' THEN
    IF NOT EXISTS (SELECT 1 FROM public.djs d WHERE d.id = p_dj_id AND d.user_id = auth.uid()) THEN
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
         OR (p_owner_kind = 'promoter'  AND tl.promoter_id = p_promoter_id)
         OR (p_owner_kind = 'dj'        AND tl.dj_id = p_dj_id) )
      AND (p_event_id IS NULL OR tl.event_id = p_event_id)
      AND (p_target_kind IS NULL OR tl.target_kind = p_target_kind)
      AND (p_guest_list_id IS NULL OR tl.guest_list_id = p_guest_list_id)
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT tracked_link_id, total_price AS amt FROM public.tickets            WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total_price AS amt FROM public.table_reservations WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      SELECT tracked_link_id, total       AS amt FROM public.orders             WHERE tracked_link_id IS NOT NULL AND status IN ('paid','served')
      UNION ALL
      -- Une inscription guest list est gratuite : elle compte comme conversion,
      -- jamais comme chiffre d'affaires.
      SELECT tracked_link_id, 0::numeric   AS amt FROM public.guest_list_entries WHERE tracked_link_id IS NOT NULL AND status <> 'cancelled'
    ) all_conv
    GROUP BY tracked_link_id
  )
  SELECT l.id, l.code, l.label, l.target_kind, l.event_id, l.is_active, l.created_at,
         l.clicks_count, coalesce(conv.c, 0), coalesce(conv.rev, 0)
  FROM links l
  LEFT JOIN conv ON conv.tracked_link_id = l.id
  ORDER BY l.created_at DESC;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_tracked_link_stats(text,text,uuid,uuid,uuid,uuid,text,uuid) TO authenticated;

-- ── 5) Canaux par défaut d'une part ──────────────────────────────────────
-- Mêmes 4 canaux que pour une soirée ou un club. owner_kind suit le DÉTENTEUR
-- de la part (promoteur → sa commission ; DJ → son lien ; sinon le club ou
-- l'organisateur), pour rester conforme à tracked_links_owner_chk.
CREATE OR REPLACE FUNCTION public.seed_guest_list_tracked_links(p_guest_list_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_gl         public.guest_lists%ROWTYPE;
  v_owner_kind text;
  v_venue_id   text;
  v_org_user   uuid;
  v_promoter   uuid;
  v_dj         uuid;
  v_created_by uuid;
  v_channel    text;
  v_channels   text[] := ARRAY['instagram','tiktok','newsletter','whatsapp'];
BEGIN
  SELECT * INTO v_gl FROM public.guest_lists WHERE id = p_guest_list_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Appelée depuis le client : seul un détenteur de la part peut semer.
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_guest_list_part(auth.uid(), p_guest_list_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF v_gl.holder_type = 'promoter' AND v_gl.promoter_id IS NOT NULL THEN
    v_owner_kind := 'promoter';
    v_promoter := v_gl.promoter_id;
    SELECT user_id INTO v_created_by FROM public.promoters WHERE id = v_gl.promoter_id;
  ELSIF v_gl.holder_type = 'dj' AND v_gl.dj_id IS NOT NULL THEN
    v_owner_kind := 'dj';
    v_dj := v_gl.dj_id;
    SELECT user_id INTO v_created_by FROM public.djs WHERE id = v_gl.dj_id;
  ELSIF v_gl.venue_id IS NOT NULL THEN
    v_owner_kind := 'venue';
    v_venue_id := v_gl.venue_id;
    SELECT owner_id INTO v_created_by FROM public.venues WHERE id = v_gl.venue_id;
  ELSIF v_gl.organizer_user_id IS NOT NULL THEN
    v_owner_kind := 'organizer';
    v_org_user := v_gl.organizer_user_id;
    v_created_by := v_gl.organizer_user_id;
  ELSE
    RETURN;
  END IF;

  v_created_by := COALESCE(v_created_by, auth.uid());
  IF v_created_by IS NULL THEN RETURN; END IF;

  FOREACH v_channel IN ARRAY v_channels LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.tracked_links
      WHERE guest_list_id = p_guest_list_id AND lower(label) = v_channel
    ) THEN
      INSERT INTO public.tracked_links
        (code, label, owner_kind, venue_id, organizer_user_id, promoter_id, dj_id,
         created_by, target_kind, guest_list_id, event_id, utm_source, utm_medium)
      VALUES
        (public.gen_tracked_link_code(), v_channel, v_owner_kind, v_venue_id, v_org_user, v_promoter, v_dj,
         v_created_by, 'guestlist', p_guest_list_id, v_gl.event_id, v_channel, 'guestlist_link');
    END IF;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.seed_guest_list_tracked_links(uuid) TO authenticated;

-- ── 6) Retrait du mécanisme maison remplacé ──────────────────────────────
DROP FUNCTION IF EXISTS public.get_guest_list_share_link_stats(uuid);
ALTER TABLE public.guest_list_entries DROP COLUMN IF EXISTS share_link_id;
DROP TABLE IF EXISTS public.guest_list_share_links;
