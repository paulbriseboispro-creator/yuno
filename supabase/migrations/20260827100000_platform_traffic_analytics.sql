-- ═══════════════════════════════════════════════════════════════════════════
-- Trafic plateforme — mesure d'audience site + app SANS cookie (« GA maison »).
--
-- Modèle Plausible : AUCUN stockage côté client (ni cookie, ni localStorage).
-- L'identité visiteur est calculée côté serveur :
--   - anonyme  : sha256(sel_du_jour || IP || user-agent) — le sel tourne chaque
--     jour et est purgé à J+2, donc impossible de relier deux jours entre eux ;
--   - connecté : md5(auth.uid()) — pseudonyme stable (l'utilisateur a déjà un
--     compte chez nous, base légale intérêt légitime).
-- Aucune IP brute n'est jamais stockée. Purge à 13 mois (aligné RGPD/CNIL).
--
-- Le tracking existant (visitor_sessions / affiliate_*) est scoped par vertical
-- et gaté par le consentement : il reste intact. Cette couche-ci répond à la
-- question plateforme : combien de visiteurs, d'où, vers quoi, jusqu'où.
--
-- Écritures UNIQUEMENT via les RPC SECURITY DEFINER ci-dessous (pattern
-- affiliate 20260724100000) ; lecture UNIQUEMENT via les RPC gatées
-- is_super_admin(). RLS totale, aucune policy : les tables sont invisibles.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Tables ─────────────────────────────────────────────────────────────────

-- Sel quotidien du hash visiteur anonyme. Purgé à J+2 (pas de re-liaison possible).
CREATE TABLE IF NOT EXISTS public.platform_daily_salts (
  day  date PRIMARY KEY,
  salt uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.platform_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_hash     text NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  entry_path       text,
  exit_path        text,
  referrer_host    text,
  channel          text NOT NULL DEFAULT 'direct',
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  device           text,
  browser          text,
  os               text,
  language         text,
  country          text,
  is_native        boolean NOT NULL DEFAULT false,
  is_authenticated boolean NOT NULL DEFAULT false,
  pageview_count   integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.platform_page_views (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES public.platform_sessions(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  path        text NOT NULL,
  page_group  text NOT NULL DEFAULT 'other',
  -- Rempli par les battements de cœur (temps passé réel sur la page).
  duration_seconds integer
);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_hash_seen ON public.platform_sessions (visitor_hash, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_started   ON public.platform_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_seen      ON public.platform_sessions (last_seen_at);
CREATE INDEX IF NOT EXISTS idx_platform_pv_time            ON public.platform_page_views (occurred_at);
CREATE INDEX IF NOT EXISTS idx_platform_pv_session         ON public.platform_page_views (session_id, occurred_at);

-- RLS totale, aucune policy (comme ota_*) : infra invisible côté client.
ALTER TABLE public.platform_daily_salts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_page_views  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_daily_salts FROM anon, authenticated;
REVOKE ALL ON TABLE public.platform_sessions    FROM anon, authenticated;
REVOKE ALL ON TABLE public.platform_page_views  FROM anon, authenticated;

-- ─── Classifieurs (internes, jamais exposés) ────────────────────────────────

-- Regroupe un chemin en section lisible. L'ordre des tests compte :
-- achat > checkout > event > venue > listes. Doit suivre src/App.tsx.
CREATE OR REPLACE FUNCTION public.platform_page_group(p_path text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_path IN ('/verify-ticket-payment','/verify-table-payment','/verify-payment')
      OR p_path LIKE '/order-confirmation%' OR p_path LIKE '/order/%'
      OR p_path LIKE '/guest/finalize%' OR p_path LIKE '/claim%'
      THEN 'purchase'
    WHEN p_path ~ '/tickets/[^/]+$' OR p_path ~ '/table/[^/]+$'
      OR p_path LIKE '%/guestlist-checkout' OR p_path IN ('/cart','/click-collect')
      THEN 'checkout'
    WHEN p_path ~ '^/events/[^/]+/[^/]+' OR p_path LIKE '/event/%'
      OR p_path ~ '^/club/[^/]+/event/' OR p_path LIKE '/affiliate-event/%'
      THEN 'event'
    WHEN p_path ~ '^/club/[^/]+' OR p_path LIKE '/affiliate-venue/%' OR p_path LIKE '/vip-menu/%'
      THEN 'venue'
    WHEN p_path IN ('/', '/home') THEN 'home'
    WHEN p_path = '/explore' THEN 'explore'
    WHEN p_path IN ('/clubs','/events','/djs','/tickets','/vip-tables','/order-drinks','/map')
      THEN 'browse'
    WHEN p_path LIKE '/l/%' OR p_path LIKE '/p/%' OR p_path LIKE '/promo/%'
      OR p_path LIKE '/promoteur/%' OR p_path LIKE '/rp/%'
      THEN 'promo-link'
    WHEN p_path LIKE '/dj/%' THEN 'dj'
    ELSE 'other'
  END
$$;

-- Canal d'acquisition façon Shopify. utm prime sur le référent.
CREATE OR REPLACE FUNCTION public.platform_channel(p_utm_source text, p_utm_medium text, p_ref_host text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_utm_medium,'') ~* 'cpc|ppc|paid|ads' THEN 'paid'
    WHEN coalesce(p_utm_source,'') = 'yuno-push' THEN 'push'
    WHEN coalesce(p_utm_source,'') = 'affiliate-link' OR coalesce(p_utm_medium,'') ~* 'affiliate' THEN 'affiliate'
    WHEN coalesce(p_utm_medium,'') ~* 'email|newsletter' THEN 'email'
    WHEN coalesce(p_ref_host,'') ~* 'instagram|facebook|fb\.|tiktok|twitter|(^|\.)x\.com|(^|\.)t\.co|linkedin|snapchat|whatsapp|telegram|youtube|reddit|pinterest'
      THEN 'social'
    WHEN coalesce(p_ref_host,'') ~* 'google|bing|duckduckgo|yahoo|qwant|ecosia|baidu' THEN 'search'
    WHEN nullif(p_utm_source,'') IS NOT NULL OR nullif(p_utm_medium,'') IS NOT NULL THEN 'campaign'
    WHEN nullif(p_ref_host,'') IS NOT NULL THEN 'referral'
    ELSE 'direct'
  END
$$;

-- Parse user-agent minimaliste. Les navigateurs in-app (Instagram, TikTok…)
-- passent AVANT Chrome/Safari : c'est le trafic bio-Instagram qui nous
-- intéresse le plus en nightlife.
CREATE OR REPLACE FUNCTION public.platform_parse_ua(
  p_ua text, p_native boolean,
  OUT device text, OUT browser text, OUT os text
)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  ua text := coalesce(p_ua, '');
BEGIN
  IF ua ~* 'ipad|tablet' OR (ua ~* 'android' AND ua !~* 'mobile') THEN device := 'tablet';
  ELSIF ua ~* 'mobi|iphone|ipod|android' THEN device := 'mobile';
  ELSE device := 'desktop';
  END IF;

  os := CASE
    WHEN ua ~* 'iphone|ipad|ipod' THEN 'iOS'
    WHEN ua ~* 'android' THEN 'Android'
    WHEN ua ~* 'mac os x|macintosh' THEN 'macOS'
    WHEN ua ~* 'windows' THEN 'Windows'
    WHEN ua ~* 'linux' THEN 'Linux'
    WHEN ua = '' THEN 'unknown'
    ELSE 'other'
  END;

  browser := CASE
    WHEN coalesce(p_native, false) THEN 'app'
    WHEN ua ~* 'instagram' THEN 'Instagram'
    WHEN ua ~* 'fban|fbav|fb_iab' THEN 'Facebook'
    WHEN ua ~* 'musical_ly|bytedance|tiktok' THEN 'TikTok'
    WHEN ua ~* 'snapchat' THEN 'Snapchat'
    WHEN ua ~* 'edg/' THEN 'Edge'
    WHEN ua ~* 'opr/|opera' THEN 'Opera'
    WHEN ua ~* 'samsungbrowser' THEN 'Samsung Internet'
    WHEN ua ~* 'firefox|fxios' THEN 'Firefox'
    WHEN ua ~* 'crios|chrome/' THEN 'Chrome'
    WHEN ua ~* 'safari' THEN 'Safari'
    WHEN ua = '' THEN 'unknown'
    ELSE 'other'
  END;
END $$;

REVOKE ALL ON FUNCTION public.platform_page_group(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_channel(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_parse_ua(text, boolean) FROM PUBLIC, anon, authenticated;

-- ─── Ingestion (appelée par le front, fire-and-forget) ──────────────────────

CREATE OR REPLACE FUNCTION public.track_platform_view(
  p_path          text,
  p_referrer_host text DEFAULT NULL,
  p_utm_source    text DEFAULT NULL,
  p_utm_medium    text DEFAULT NULL,
  p_utm_campaign  text DEFAULT NULL,
  p_language      text DEFAULT NULL,
  p_is_native     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_headers  json;
  v_ip       text;
  v_ua       text;
  v_country  text;
  v_salt     uuid;
  v_hash     text;
  v_sid      uuid;
  v_vid      bigint;
  v_path     text;
  v_ref      text;
  v_now      timestamptz := now();
  v_device   text;
  v_browser  text;
  v_os       text;
  v_recent   integer;
BEGIN
  -- Jamais compter le super admin : les visites de l'équipe fausseraient tout.
  IF auth.uid() IS NOT NULL AND public.is_super_admin() THEN
    RETURN NULL;
  END IF;

  v_path := left(coalesce(nullif(trim(p_path), ''), '/'), 300);
  IF v_path NOT LIKE '/%' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
    v_ip      := nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    v_ua      := nullif(left(coalesce(v_headers->>'user-agent', ''), 400), '');
    v_country := upper(nullif(left(coalesce(v_headers->>'cf-ipcountry', ''), 2), ''));
    IF v_country IN ('XX', 'T1') THEN v_country := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL; v_ua := NULL; v_country := NULL;
  END;

  -- Identité visiteur : uid pseudonymisé pour les connectés, hash salé-jour
  -- (IP + UA) pour les anonymes. Aucune IP brute stockée.
  IF auth.uid() IS NOT NULL THEN
    v_hash := 'u:' || md5(auth.uid()::text);
  ELSE
    INSERT INTO platform_daily_salts (day) VALUES (current_date) ON CONFLICT (day) DO NOTHING;
    SELECT salt INTO v_salt FROM platform_daily_salts WHERE day = current_date;
    v_hash := 'a:' || encode(sha256(convert_to(v_salt::text || coalesce(v_ip, '0.0.0.0') || coalesce(v_ua, ''), 'UTF8')), 'hex');
  END IF;

  -- Session : réutiliser si activité < 30 min (fenêtre GA).
  SELECT id INTO v_sid
  FROM platform_sessions
  WHERE visitor_hash = v_hash AND last_seen_at > v_now - interval '30 minutes'
  ORDER BY last_seen_at DESC
  LIMIT 1;

  IF v_sid IS NULL THEN
    -- Garde anti-flood : max 40 nouvelles sessions / heure / visiteur.
    SELECT count(*) INTO v_recent
    FROM platform_sessions
    WHERE visitor_hash = v_hash AND started_at > v_now - interval '1 hour';
    IF v_recent >= 40 THEN RETURN NULL; END IF;

    v_ref := nullif(left(lower(coalesce(p_referrer_host, '')), 120), '');
    -- Un référent interne n'est pas une acquisition.
    IF v_ref IS NOT NULL AND (v_ref LIKE '%yunoapp.eu%' OR v_ref LIKE 'localhost%') THEN
      v_ref := NULL;
    END IF;

    SELECT t.device, t.browser, t.os INTO v_device, v_browser, v_os
    FROM public.platform_parse_ua(v_ua, coalesce(p_is_native, false)) t;

    INSERT INTO platform_sessions (
      visitor_hash, started_at, last_seen_at, entry_path, exit_path,
      referrer_host, channel, utm_source, utm_medium, utm_campaign,
      device, browser, os, language, country,
      is_native, is_authenticated, pageview_count
    ) VALUES (
      v_hash, v_now, v_now, v_path, v_path,
      v_ref,
      public.platform_channel(nullif(p_utm_source, ''), nullif(p_utm_medium, ''), v_ref),
      left(nullif(p_utm_source, ''), 120), left(nullif(p_utm_medium, ''), 120), left(nullif(p_utm_campaign, ''), 120),
      v_device, v_browser, v_os,
      lower(left(nullif(p_language, ''), 2)), v_country,
      coalesce(p_is_native, false), auth.uid() IS NOT NULL, 1
    )
    RETURNING id INTO v_sid;
  ELSE
    -- Garde anti-flood : max 80 vues / minute / session.
    SELECT count(*) INTO v_recent
    FROM platform_page_views
    WHERE session_id = v_sid AND occurred_at > v_now - interval '1 minute';
    IF v_recent >= 80 THEN RETURN NULL; END IF;

    UPDATE platform_sessions
    SET last_seen_at     = v_now,
        exit_path        = v_path,
        pageview_count   = pageview_count + 1,
        is_authenticated = is_authenticated OR auth.uid() IS NOT NULL,
        country          = coalesce(country, v_country)
    WHERE id = v_sid;
  END IF;

  INSERT INTO platform_page_views (session_id, occurred_at, path, page_group)
  VALUES (v_sid, v_now, v_path, public.platform_page_group(v_path))
  RETURNING id INTO v_vid;

  RETURN jsonb_build_object('s', v_sid, 'v', v_vid);
END $$;

REVOKE ALL ON FUNCTION public.track_platform_view(text, text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_platform_view(text, text, text, text, text, text, boolean) TO anon, authenticated;

-- Battement de cœur : temps passé réel + présence « en direct ». La paire
-- (session uuid, view id) sert de clé composite inforgeable (pattern affiliate).
-- Durée monotone et bornée à 6 h — pas de vandalisme tardif possible.
CREATE OR REPLACE FUNCTION public.platform_heartbeat(
  p_session_id uuid,
  p_view_id    bigint,
  p_seconds    integer
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE platform_page_views
  SET duration_seconds = GREATEST(
        coalesce(duration_seconds, 0),
        LEAST(GREATEST(coalesce(p_seconds, 0), 0), 21600)
      )
  WHERE id = p_view_id
    AND session_id = p_session_id
    AND occurred_at > now() - interval '6 hours';

  UPDATE platform_sessions
  SET last_seen_at = now()
  WHERE id = p_session_id
    AND last_seen_at > now() - interval '6 hours'
    AND EXISTS (
      SELECT 1 FROM platform_page_views v
      WHERE v.id = p_view_id AND v.session_id = p_session_id
    );
$$;

REVOKE ALL ON FUNCTION public.platform_heartbeat(uuid, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_heartbeat(uuid, bigint, integer) TO anon, authenticated;

-- ─── Lecture (dashboard super admin) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_platform_traffic(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from      timestamptz := p_from;
  v_to        timestamptz := p_to;
  v_gran      text;
  v_step      interval;
  v_totals    jsonb;
  v_series    jsonb;
  v_channels  jsonb;
  v_referrers jsonb;
  v_campaigns jsonb;
  v_pages     jsonb;
  v_groups    jsonb;
  v_entries   jsonb;
  v_exits     jsonb;
  v_devices   jsonb;
  v_browsers  jsonb;
  v_os        jsonb;
  v_countries jsonb;
  v_langs     jsonb;
  v_funnel    jsonb;
  v_sales     jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to <= v_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF v_to - v_from > interval '400 days' THEN
    v_from := v_to - interval '400 days';
  END IF;
  IF v_to - v_from <= interval '3 days' THEN
    v_gran := 'hour'; v_step := interval '1 hour';
  ELSE
    v_gran := 'day'; v_step := interval '1 day';
  END IF;

  SELECT jsonb_build_object(
    'visitors',            count(DISTINCT visitor_hash),
    'sessions',            count(*),
    'pageviews',           coalesce(sum(pageview_count), 0),
    'avg_session_seconds', coalesce(round(avg(extract(epoch FROM (last_seen_at - started_at)))), 0),
    'bounce_rate',         CASE WHEN count(*) > 0
                             THEN round(100.0 * count(*) FILTER (WHERE pageview_count <= 1) / count(*), 1)
                             ELSE 0 END,
    'native_sessions',     count(*) FILTER (WHERE is_native),
    'authed_sessions',     count(*) FILTER (WHERE is_authenticated)
  )
  INTO v_totals
  FROM platform_sessions
  WHERE started_at >= v_from AND started_at < v_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           't', b.bucket,
           'visitors', coalesce(s.visitors, 0),
           'sessions', coalesce(s.sessions, 0),
           'pageviews', coalesce(pv.n, 0)
         ) ORDER BY b.bucket), '[]'::jsonb)
  INTO v_series
  FROM (SELECT generate_series(date_trunc(v_gran, v_from), v_to, v_step) AS bucket) b
  LEFT JOIN (
    SELECT date_trunc(v_gran, started_at) AS d, count(DISTINCT visitor_hash) AS visitors, count(*) AS sessions
    FROM platform_sessions
    WHERE started_at >= v_from AND started_at < v_to
    GROUP BY 1
  ) s ON s.d = b.bucket
  LEFT JOIN (
    SELECT date_trunc(v_gran, occurred_at) AS d, count(*) AS n
    FROM platform_page_views
    WHERE occurred_at >= v_from AND occurred_at < v_to
    GROUP BY 1
  ) pv ON pv.d = b.bucket
  WHERE b.bucket < v_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'sessions', n, 'visitors', v) ORDER BY n DESC), '[]'::jsonb)
  INTO v_channels
  FROM (
    SELECT channel, count(*) AS n, count(DISTINCT visitor_hash) AS v
    FROM platform_sessions
    WHERE started_at >= v_from AND started_at < v_to
    GROUP BY channel
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('host', referrer_host, 'sessions', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_referrers
  FROM (
    SELECT referrer_host, count(*) AS n
    FROM platform_sessions
    WHERE started_at >= v_from AND started_at < v_to AND referrer_host IS NOT NULL
    GROUP BY referrer_host
    ORDER BY n DESC
    LIMIT 12
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('campaign', campaign, 'source', source, 'sessions', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_campaigns
  FROM (
    SELECT coalesce(utm_campaign, '—') AS campaign, utm_source AS source, count(*) AS n
    FROM platform_sessions
    WHERE started_at >= v_from AND started_at < v_to
      AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)
    GROUP BY 1, 2
    ORDER BY n DESC
    LIMIT 12
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', views, 'sessions', sessions, 'avg_seconds', avg_seconds) ORDER BY views DESC), '[]'::jsonb)
  INTO v_pages
  FROM (
    SELECT path, count(*) AS views, count(DISTINCT session_id) AS sessions,
           round(avg(duration_seconds)) AS avg_seconds
    FROM platform_page_views
    WHERE occurred_at >= v_from AND occurred_at < v_to
    GROUP BY path
    ORDER BY views DESC
    LIMIT 15
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('grp', page_group, 'views', views, 'sessions', sessions) ORDER BY views DESC), '[]'::jsonb)
  INTO v_groups
  FROM (
    SELECT page_group, count(*) AS views, count(DISTINCT session_id) AS sessions
    FROM platform_page_views
    WHERE occurred_at >= v_from AND occurred_at < v_to
    GROUP BY page_group
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('path', entry_path, 'sessions', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT entry_path, count(*) AS n
    FROM platform_sessions
    WHERE started_at >= v_from AND started_at < v_to AND entry_path IS NOT NULL
    GROUP BY entry_path
    ORDER BY n DESC
    LIMIT 10
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('path', exit_path, 'sessions', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_exits
  FROM (
    SELECT exit_path, count(*) AS n
    FROM platform_sessions
    WHERE started_at >= v_from AND started_at < v_to AND exit_path IS NOT NULL
    GROUP BY exit_path
    ORDER BY n DESC
    LIMIT 10
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_devices
  FROM (SELECT coalesce(device, 'unknown') AS k, count(*) AS n FROM platform_sessions
        WHERE started_at >= v_from AND started_at < v_to GROUP BY 1) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_browsers
  FROM (SELECT coalesce(browser, 'unknown') AS k, count(*) AS n FROM platform_sessions
        WHERE started_at >= v_from AND started_at < v_to GROUP BY 1 ORDER BY n DESC LIMIT 10) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_os
  FROM (SELECT coalesce(os, 'unknown') AS k, count(*) AS n FROM platform_sessions
        WHERE started_at >= v_from AND started_at < v_to GROUP BY 1 ORDER BY n DESC LIMIT 8) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_countries
  FROM (SELECT coalesce(country, '—') AS k, count(*) AS n FROM platform_sessions
        WHERE started_at >= v_from AND started_at < v_to GROUP BY 1 ORDER BY n DESC LIMIT 12) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_langs
  FROM (SELECT coalesce(language, '—') AS k, count(*) AS n FROM platform_sessions
        WHERE started_at >= v_from AND started_at < v_to GROUP BY 1 ORDER BY n DESC LIMIT 8) x;

  SELECT jsonb_build_object(
    'sessions',    (SELECT count(*) FROM platform_sessions WHERE started_at >= v_from AND started_at < v_to),
    'event_views', (SELECT count(DISTINCT session_id) FROM platform_page_views
                    WHERE occurred_at >= v_from AND occurred_at < v_to AND page_group = 'event'),
    'checkouts',   (SELECT count(DISTINCT session_id) FROM platform_page_views
                    WHERE occurred_at >= v_from AND occurred_at < v_to AND page_group = 'checkout'),
    'purchases',   (SELECT count(DISTINCT session_id) FROM platform_page_views
                    WHERE occurred_at >= v_from AND occurred_at < v_to AND page_group = 'purchase')
  ) INTO v_funnel;

  -- Ventes réelles de la période (mêmes filtres de statut que la compta admin).
  v_sales := jsonb_build_object(
    'tickets', (SELECT jsonb_build_object('n', count(*), 'revenue', coalesce(sum(coalesce(total_price, 0)), 0))
                FROM tickets
                WHERE status IN ('paid', 'used')
                  AND coalesce(paid_at, created_at) >= v_from AND coalesce(paid_at, created_at) < v_to),
    'tables',  (SELECT jsonb_build_object('n', count(*), 'revenue', coalesce(sum(coalesce(total_price, 0)), 0))
                FROM table_reservations
                WHERE status IN ('paid', 'confirmed')
                  AND coalesce(paid_at, created_at) >= v_from AND coalesce(paid_at, created_at) < v_to),
    'drinks',  (SELECT jsonb_build_object('n', count(*), 'revenue', coalesce(sum(coalesce(total, 0)), 0))
                FROM orders
                WHERE status IN ('paid', 'served')
                  AND coalesce(paid_at, created_at) >= v_from AND coalesce(paid_at, created_at) < v_to)
  );

  RETURN jsonb_build_object(
    'granularity', v_gran,
    'totals', v_totals,
    'series', v_series,
    'channels', v_channels,
    'referrers', v_referrers,
    'campaigns', v_campaigns,
    'pages', v_pages,
    'groups', v_groups,
    'entries', v_entries,
    'exits', v_exits,
    'devices', v_devices,
    'browsers', v_browsers,
    'os', v_os,
    'countries', v_countries,
    'languages', v_langs,
    'funnel', v_funnel,
    'sales', v_sales
  );
END $$;

REVOKE ALL ON FUNCTION public.get_platform_traffic(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_traffic(timestamptz, timestamptz) TO authenticated;

-- Visiteurs « en ce moment » (fenêtre 5 min), pollé toutes les 30 s.
CREATE OR REPLACE FUNCTION public.get_platform_traffic_live()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'count',   (SELECT count(*) FROM platform_sessions WHERE last_seen_at > now() - interval '5 minutes'),
    'native',  (SELECT count(*) FROM platform_sessions WHERE last_seen_at > now() - interval '5 minutes' AND is_native),
    'last30m', (SELECT count(*) FROM platform_page_views WHERE occurred_at > now() - interval '30 minutes'),
    'pages',   (SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
                FROM (
                  SELECT exit_path AS path, device, country, is_native,
                         extract(epoch FROM (now() - last_seen_at))::int AS seconds_ago
                  FROM platform_sessions
                  WHERE last_seen_at > now() - interval '5 minutes'
                  ORDER BY last_seen_at DESC
                  LIMIT 30
                ) x)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_platform_traffic_live() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_traffic_live() TO authenticated;

-- ─── Purge (rétention 13 mois, alignée sur purge_expired_personal_data) ─────

CREATE OR REPLACE FUNCTION public.purge_platform_traffic()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  -- Supprimer les sessions cascade leurs pages vues.
  DELETE FROM platform_sessions WHERE last_seen_at < now() - interval '13 months';
  -- Vues orphelines d'une session encore vivante mais très vieilles (défensif).
  DELETE FROM platform_page_views WHERE occurred_at < now() - interval '13 months';
  -- Sels : à J+2 la re-liaison anonyme devient impossible.
  DELETE FROM platform_daily_salts WHERE day < current_date - 2;
$$;

REVOKE ALL ON FUNCTION public.purge_platform_traffic() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('platform-traffic-purge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-traffic-purge');

    PERFORM cron.schedule('platform-traffic-purge', '25 3 * * *',
      $cron$ SELECT public.purge_platform_traffic(); $cron$);
  END IF;
END $$;
