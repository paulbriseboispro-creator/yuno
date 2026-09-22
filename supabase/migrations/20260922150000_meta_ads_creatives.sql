-- Publicité Meta — plusieurs créations par campagne, médias du pro, résultats
-- par création, ciblage détaillé.
--
-- Une campagne Yuno reste UN ensemble de pubs (un budget, un ciblage), mais
-- porte désormais de une à six créations : image, carrousel (2 à 10 images)
-- ou vidéo (avec sa couverture). Chaque création devient une pub dans le même
-- ensemble, et Meta déplace le budget vers celle qui vend le mieux — c'est le
-- test naturel d'un ensemble, celui que les agences font à la main.
--
-- `creatives`   : les créations telles que le pro les a composées (jsonb).
-- `meta_ads`    : une entrée par pub créée chez Meta (ad_id, creative_id,
--                 index, format, état de validation) — c'est par elle que la
--                 synchro horaire relie les résultats à la création.
-- `ad_insights` : résultats cumulés PAR PUB, copiés de Meta à chaque synchro
--                 (dépense, impressions, clics, achats).
-- `creative` / `meta_ad_id` / `meta_creative_id` restent remplis avec la
-- PREMIÈRE création : rien n'est cassé pour ce qui les lit encore.
--
-- Le ciblage jsonb accepte deux clés de plus : `interests` ([{id,name}], les
-- centres d'intérêt Meta) et `locales` ([int], les langues Meta).

ALTER TABLE public.meta_campaigns
  ADD COLUMN IF NOT EXISTS creatives   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS meta_ads    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ad_insights jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.meta_campaigns.creatives IS
  'Créations de la campagne : [{format:image|carousel|video, media:[{url,kind,thumbnail_url,headline,description}], headline, body, cta, description, link}]. Une pub Meta par création.';
COMMENT ON COLUMN public.meta_campaigns.meta_ads IS
  'Pubs créées chez Meta, dans l''ordre des créations : [{index, format, ad_id, creative_id, video_id, effective_status, review}].';
COMMENT ON COLUMN public.meta_campaigns.ad_insights IS
  'Résultats cumulés par pub (copie Meta, synchro horaire) : [{ad_id, spend_cents, impressions, reach, link_clicks, purchases, purchase_value_cents}].';

-- Campagnes créées avant : la création unique devient la première entrée.
UPDATE public.meta_campaigns c
   SET creatives = jsonb_build_array(jsonb_build_object(
         'format', 'image',
         'media', jsonb_build_array(jsonb_build_object('url', c.creative->>'image_url', 'kind', 'image')),
         'headline', c.creative->>'headline', 'body', c.creative->>'body', 'cta', c.creative->>'cta',
         'description', c.creative->'description', 'link', c.creative->>'link')),
       meta_ads = CASE WHEN c.meta_ad_id IS NULL THEN '[]'::jsonb
                  ELSE jsonb_build_array(jsonb_build_object('index', 0, 'format', 'image', 'ad_id', c.meta_ad_id, 'creative_id', COALESCE(c.meta_creative_id, ''))) END
 WHERE c.creatives = '[]'::jsonb AND c.creative ? 'image_url';

-- ── Médias des pubs : bucket dédié ───────────────────────────────────────────
-- Les visuels et vidéos que le pro choisit pour ses pubs. Public : Meta va
-- chercher l'image et la vidéo par URL (`adimages` bytes / `advideos`
-- file_url). Plafond 50 Mo (une vidéo verticale d'une minute en H.264),
-- images + vidéos seulement. Chaque compte écrit dans SON dossier.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ad-creatives', 'ad-creatives', true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 52428800,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];

DROP POLICY IF EXISTS "Public read ad creatives" ON storage.objects;
CREATE POLICY "Public read ad creatives"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ad-creatives');

DROP POLICY IF EXISTS "Users upload own ad creatives" ON storage.objects;
CREATE POLICY "Users upload own ad creatives"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'ad-creatives' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users update own ad creatives" ON storage.objects;
CREATE POLICY "Users update own ad creatives"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'ad-creatives' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users delete own ad creatives" ON storage.objects;
CREATE POLICY "Users delete own ad creatives"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'ad-creatives' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── Lecture : la page Publicité voit les créations et leurs résultats ────────
CREATE OR REPLACE FUNCTION public.get_my_meta_ads(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conn public.meta_connections%ROWTYPE;
  v_out  jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_my_meta_ads: at most one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.meta_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conn FROM public.meta_connections mc
   WHERE mc.venue_id IS NOT DISTINCT FROM p_venue_id AND mc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   LIMIT 1;

  v_out := jsonb_build_object(
    'connection', CASE WHEN v_conn.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conn.id, 'mode', v_conn.mode, 'status', v_conn.status, 'pixel_id', v_conn.pixel_id,
      'ad_account_id', v_conn.ad_account_id, 'page_id', v_conn.page_id, 'ig_user_id', v_conn.ig_user_id,
      'token_kind', v_conn.token_kind, 'assets', v_conn.assets, 'last_health', v_conn.last_health,
      'ads_ready', (v_conn.status = 'active' AND v_conn.ad_account_id IS NOT NULL AND v_conn.page_id IS NOT NULL)
    ) END,
    'audiences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'ref', a.ref, 'name', a.name, 'meta_audience_id', a.meta_audience_id,
        'lookalike_ratio', a.lookalike_ratio, 'lookalike_country', a.lookalike_country,
        'size_uploaded', a.size_uploaded, 'status', a.status, 'last_sync_at', a.last_sync_at, 'last_error', a.last_error,
        'created_at', a.created_at) ORDER BY a.created_at)
        FROM public.meta_audiences a WHERE a.connection_id = v_conn.id), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'status', c.status, 'effective_status', c.effective_status, 'objective', c.objective,
        'event_id', c.event_id, 'event_title', e.title, 'event_start_at', e.start_at, 'event_poster_url', e.poster_url,
        'budget_type', c.budget_type, 'budget_cents', c.budget_cents, 'currency', c.currency,
        'start_at', c.start_at, 'end_at', c.end_at, 'targeting', c.targeting, 'creative', c.creative, 'placements', c.placements,
        'creatives', c.creatives, 'meta_ads', c.meta_ads, 'ad_insights', c.ad_insights,
        'meta_campaign_id', c.meta_campaign_id, 'meta_ad_id', c.meta_ad_id, 'review_feedback', c.review_feedback,
        'last_error', c.last_error, 'last_synced_at', c.last_synced_at, 'created_at', c.created_at,
        'tracked_code', tl.code,
        'insights', (SELECT jsonb_build_object(
            'spend_cents', COALESCE(sum(i.spend_cents), 0), 'impressions', COALESCE(sum(i.impressions), 0),
            'reach', COALESCE(max(i.reach), 0), 'clicks', COALESCE(sum(i.clicks), 0), 'link_clicks', COALESCE(sum(i.link_clicks), 0),
            'purchases', COALESCE(sum(i.purchases), 0), 'purchase_value_cents', COALESCE(sum(i.purchase_value_cents), 0),
            'leads', COALESCE(sum(i.leads), 0),
            'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'spend_cents', d.spend_cents, 'clicks', d.link_clicks, 'purchases', d.purchases) ORDER BY d.day)
                               FROM public.meta_insights_daily d WHERE d.campaign_id = c.id), '[]'::jsonb))
          FROM public.meta_insights_daily i WHERE i.campaign_id = c.id),
        'attributed', jsonb_build_object(
          'tickets', (SELECT count(*) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tickets_revenue_cents', (SELECT COALESCE(round(sum(t.total_price) * 100), 0) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tables', (SELECT count(*) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'tables_revenue_cents', (SELECT COALESCE(round(sum(tr.total_price) * 100), 0) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'orders', (SELECT count(*) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'orders_revenue_cents', (SELECT COALESCE(round(sum(o.total) * 100), 0) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'guest_list', (SELECT count(*) FROM public.guest_list_entries g WHERE g.tracked_link_id = c.tracked_link_id AND g.status <> 'cancelled'),
          'clicks', COALESCE(tl.clicks_count, 0)
        )) ORDER BY c.created_at DESC)
        FROM public.meta_campaigns c
        LEFT JOIN public.events e ON e.id = c.event_id
        LEFT JOIN public.tracked_links tl ON tl.id = c.tracked_link_id
       WHERE c.connection_id = v_conn.id), '[]'::jsonb),
    'leads', jsonb_build_object(
      'total', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id),
      'last_30d', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.received_at >= now() - interval '30 days'),
      'pending', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.processed_at IS NULL),
      'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.leadgen_id, 'name', r.contact_name, 'email', r.contact_email, 'received_at', r.received_at, 'processed', r.processed_at IS NOT NULL, 'error', r.error) ORDER BY r.received_at DESC)
                            FROM (SELECT * FROM public.meta_leads l WHERE l.connection_id = v_conn.id ORDER BY l.received_at DESC LIMIT 20) r), '[]'::jsonb)
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'poster_url', e.poster_url, 'city', e.location_city) ORDER BY e.start_at)
        FROM public.events e
       WHERE e.end_at >= now()
         AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
           OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)))), '[]'::jsonb),
    'segments', jsonb_build_object(
      'venue', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vs.id, 'name', vs.name) ORDER BY vs.name) FROM public.venue_segments vs WHERE p_venue_id IS NOT NULL AND vs.venue_id = p_venue_id), '[]'::jsonb),
      'contact', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name) ORDER BY cs.name) FROM public.contact_segments cs WHERE cs.venue_id IS NOT DISTINCT FROM p_venue_id AND cs.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb)
    ),
    'home', jsonb_build_object(
      'city', COALESCE((SELECT v.city FROM public.venues v WHERE v.id = p_venue_id), (SELECT op.city FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id)),
      'latitude', (SELECT v.latitude FROM public.venues v WHERE v.id = p_venue_id),
      'longitude', (SELECT v.longitude FROM public.venues v WHERE v.id = p_venue_id)
    )
  );
  RETURN v_out;
END;
$function$
;
