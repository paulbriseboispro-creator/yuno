-- ============================================================================
-- Soirées externes : l'historique de trafic survit à la soirée
--
-- Le 25/09/2026, le bouton « Purger les soirées passées » a supprimé toutes
-- les soirées passées de Mad by Night (et celles du soir même). Les vues
-- (`affiliate_visitor_sessions`) et les clics (`affiliate_clicks`) ont
-- survécu, mais leur `affiliate_event_id` est passé à NULL (ON DELETE SET
-- NULL) : 300 vues sur 301 et tous les clics ne disaient plus QUELLE soirée
-- ils concernaient, et le classement par soirée était vide.
--
-- 1. Chaque vue / clic porte désormais une PHOTO de sa soirée
--    (`event_slug`, `event_name`, `event_date`), posée à l'insertion et
--    complétée avant toute suppression. Les écrans groupent par cette photo.
-- 2. Reconstruction de l'historique :
--      - soirée encore en base → photo depuis la ligne (et, si la soirée a
--        été RECRÉÉE avec le même slug, le lien est rétabli) ;
--      - soirée supprimée → slug relu dans l'URL d'arrivée
--        (`/affiliate-event/<slug>`), nom retrouvé par le modèle récurrent
--        dont le slug est le préfixe, date relue dans le slug ;
--      - clic → rattaché à la dernière vue du même visiteur sur une page
--        soirée dans les 3 h qui précèdent.
-- 3. Une soirée qui porte des ventes déclarées (commissions) ne se supprime
--    plus depuis un client : la cascade effaçait le registre des commissions.
-- 4. Nettoyages : sessions de développement (localhost) marquées internes,
--    `/rp/<slug>` (page publique d'agence) n'est plus classé « page soirée »,
--    purge quotidienne des battements « en ligne » de plus de 2 jours.
-- 5. `affiliate_night_date()` = miroir SQL de `currentNightDate()`
--    (src/lib/affiliateEventTime.ts) : la nuit en cours tient jusqu'à 8 h.
-- ============================================================================

-- ── 1. Colonnes de photo ────────────────────────────────────────────────────
ALTER TABLE public.affiliate_visitor_sessions
  ADD COLUMN IF NOT EXISTS event_slug text,
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS event_date date;

ALTER TABLE public.affiliate_clicks
  ADD COLUMN IF NOT EXISTS event_slug text,
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS event_date date;

CREATE INDEX IF NOT EXISTS idx_aff_sessions_affiliate_visited
  ON public.affiliate_visitor_sessions (affiliate_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_aff_clicks_affiliate_clicked
  ON public.affiliate_clicks (affiliate_id, clicked_at DESC);

-- ── Nuit en cours (miroir de currentNightDate) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.affiliate_night_date()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT ((now() AT TIME ZONE 'Europe/Paris') - interval '8 hours')::date;
$$;

-- ── Photo à l'insertion ────────────────────────────────────────────────────
-- SECURITY DEFINER : l'insertion vient d'un visiteur anonyme, qui ne lit pas
-- forcément la soirée (brouillon). Ce n'est pas un trigger de garde : il ne
-- discrimine sur aucun rôle, il complète la ligne.
CREATE OR REPLACE FUNCTION public.affiliate_tracking_event_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ev record;
BEGIN
  IF NEW.affiliate_event_id IS NOT NULL THEN
    SELECT slug, name, event_date, affiliate_venue_id INTO v_ev
      FROM public.affiliate_events WHERE id = NEW.affiliate_event_id;
    IF FOUND THEN
      NEW.event_slug := coalesce(NEW.event_slug, v_ev.slug);
      NEW.event_name := coalesce(NEW.event_name, v_ev.name);
      NEW.event_date := coalesce(NEW.event_date, v_ev.event_date);
      NEW.affiliate_venue_id := coalesce(NEW.affiliate_venue_id, v_ev.affiliate_venue_id);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Le suivi ne doit jamais faire échouer une vue ou un clic.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aff_sessions_event_snapshot ON public.affiliate_visitor_sessions;
CREATE TRIGGER trg_aff_sessions_event_snapshot
  BEFORE INSERT ON public.affiliate_visitor_sessions
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_tracking_event_snapshot();

DROP TRIGGER IF EXISTS trg_aff_clicks_event_snapshot ON public.affiliate_clicks;
CREATE TRIGGER trg_aff_clicks_event_snapshot
  BEFORE INSERT ON public.affiliate_clicks
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_tracking_event_snapshot();

-- ── Photo avant suppression (remplace la version qui ne gardait que le club
--    des clics) ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.affiliate_event_keep_clicks_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.affiliate_clicks
     SET affiliate_venue_id = coalesce(affiliate_venue_id, OLD.affiliate_venue_id),
         event_slug = coalesce(event_slug, OLD.slug),
         event_name = coalesce(event_name, OLD.name),
         event_date = coalesce(event_date, OLD.event_date)
   WHERE affiliate_event_id = OLD.id;
  UPDATE public.affiliate_visitor_sessions
     SET affiliate_venue_id = coalesce(affiliate_venue_id, OLD.affiliate_venue_id),
         event_slug = coalesce(event_slug, OLD.slug),
         event_name = coalesce(event_name, OLD.name),
         event_date = coalesce(event_date, OLD.event_date)
   WHERE affiliate_event_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_affiliate_event_keep_clicks_venue ON public.affiliate_events;
CREATE TRIGGER trg_affiliate_event_keep_clicks_venue
  BEFORE DELETE ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_event_keep_clicks_venue();

-- ── 3. Garde : une soirée avec ventes déclarées ne se supprime pas ─────────
-- SECURITY INVOKER et discrimination sur current_user (un trigger de garde
-- DEFINER s'exécuterait sous son propriétaire et se désactiverait) : les
-- cascades serveur (suppression d'un compte, service_role) passent.
CREATE OR REPLACE FUNCTION public.guard_affiliate_event_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND EXISTS (SELECT 1 FROM public.affiliate_reported_sales s WHERE s.affiliate_event_id = OLD.id) THEN
    RAISE EXCEPTION 'affiliate_event_has_reported_sales'
      USING ERRCODE = '23503',
            HINT = 'Cette soirée porte des ventes déclarées et des commissions : dépubliez-la au lieu de la supprimer.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_affiliate_event_delete ON public.affiliate_events;
CREATE TRIGGER trg_guard_affiliate_event_delete
  BEFORE DELETE ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_affiliate_event_delete();

-- ── 2. Reconstruction de l'historique ──────────────────────────────────────
-- 2a. Vues rattachées à une soirée encore en base.
UPDATE public.affiliate_visitor_sessions s
   SET event_slug = e.slug, event_name = e.name, event_date = e.event_date,
       affiliate_venue_id = coalesce(s.affiliate_venue_id, e.affiliate_venue_id)
  FROM public.affiliate_events e
 WHERE e.id = s.affiliate_event_id AND s.event_slug IS NULL;

-- 2b. Vues détachées : slug relu dans l'URL d'arrivée.
UPDATE public.affiliate_visitor_sessions s
   SET event_slug = substring(s.landing_page_full FROM '/affiliate-event/([^/?#]+)')
 WHERE s.affiliate_event_id IS NULL
   AND s.event_slug IS NULL
   AND s.landing_page_full ~ '/affiliate-event/[^/?#]+';

-- Soirée recréée avec le même slug (ex. les soirées du 25/09 régénérées) :
-- le lien est rétabli.
UPDATE public.affiliate_visitor_sessions s
   SET affiliate_event_id = e.id, event_name = e.name, event_date = e.event_date,
       affiliate_venue_id = coalesce(s.affiliate_venue_id, e.affiliate_venue_id)
  FROM public.affiliate_events e
 WHERE s.affiliate_event_id IS NULL
   AND s.event_slug IS NOT NULL
   AND e.slug = s.event_slug
   AND e.affiliate_id = s.affiliate_id;

-- Date relue dans le slug (« …-2026-09-25 » ou « …-2026-09-25-1 »).
UPDATE public.affiliate_visitor_sessions
   SET event_date = substring(event_slug FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})(-[0-9]+)?$')::date
 WHERE event_slug IS NOT NULL AND event_date IS NULL
   AND event_slug ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$';

-- Nom : celui du modèle récurrent dont le slug est le préfixe…
WITH tpl AS (
  SELECT affiliate_id, name,
         trim(both '-' FROM regexp_replace(lower(extensions.unaccent(name)), '[^a-z0-9]+', '-', 'g')) AS tslug
    FROM public.affiliate_recurring_templates
)
UPDATE public.affiliate_visitor_sessions s
   SET event_name = t.name
  FROM tpl t
 WHERE s.event_name IS NULL
   AND s.event_slug IS NOT NULL
   AND t.affiliate_id = s.affiliate_id
   AND t.tslug = regexp_replace(s.event_slug, '-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$', '');

-- …ou, à défaut, une soirée encore en base du même préfixe…
WITH names AS (
  SELECT DISTINCT ON (affiliate_id, prefix) affiliate_id, prefix, name
    FROM (
      SELECT affiliate_id, name,
             regexp_replace(slug, '-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$', '') AS prefix,
             event_date
        FROM public.affiliate_events
    ) x
   ORDER BY affiliate_id, prefix, event_date
)
UPDATE public.affiliate_visitor_sessions s
   SET event_name = n.name
  FROM names n
 WHERE s.event_name IS NULL
   AND s.event_slug IS NOT NULL
   AND n.affiliate_id = s.affiliate_id
   AND n.prefix = regexp_replace(s.event_slug, '-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$', '');

-- …sinon le slug mis en forme (« holy-fridays-2026-09-18 » → « Holy Fridays »).
UPDATE public.affiliate_visitor_sessions
   SET event_name = initcap(replace(regexp_replace(event_slug, '-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$', ''), '-', ' '))
 WHERE event_slug IS NOT NULL AND event_name IS NULL;

-- 2c. Clics rattachés à une soirée encore en base.
UPDATE public.affiliate_clicks c
   SET event_slug = e.slug, event_name = e.name, event_date = e.event_date,
       affiliate_venue_id = coalesce(c.affiliate_venue_id, e.affiliate_venue_id)
  FROM public.affiliate_events e
 WHERE e.id = c.affiliate_event_id AND c.event_slug IS NULL;

-- 2d. Clics détachés : la dernière vue d'une page soirée du même visiteur,
-- dans les 3 h qui précèdent (et sur le même club quand le clic en porte un).
WITH m AS (
  SELECT c.id,
         x.event_slug, x.event_name, x.event_date, x.affiliate_event_id
    FROM public.affiliate_clicks c
    JOIN LATERAL (
      SELECT s.event_slug, s.event_name, s.event_date, s.affiliate_event_id
        FROM public.affiliate_visitor_sessions s
       WHERE s.affiliate_id = c.affiliate_id
         AND s.visitor_id = c.visitor_id
         AND s.event_slug IS NOT NULL
         AND s.visited_at <= c.clicked_at
         AND s.visited_at > c.clicked_at - interval '3 hours'
         AND (c.affiliate_venue_id IS NULL OR s.affiliate_venue_id IS NULL
              OR s.affiliate_venue_id = c.affiliate_venue_id)
       ORDER BY s.visited_at DESC
       LIMIT 1
    ) x ON true
   WHERE c.event_slug IS NULL
     AND c.affiliate_event_id IS NULL
     AND c.visitor_id IS NOT NULL
)
UPDATE public.affiliate_clicks c
   SET event_slug = m.event_slug,
       event_name = m.event_name,
       event_date = m.event_date,
       affiliate_event_id = m.affiliate_event_id
  FROM m
 WHERE m.id = c.id;

-- ── 4. Nettoyages ──────────────────────────────────────────────────────────
-- Sessions de développement (serveur local) : jamais un visiteur.
UPDATE public.affiliate_visitor_sessions
   SET is_internal = true
 WHERE is_internal = false
   AND landing_page_full ~* '^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.)';

UPDATE public.affiliate_clicks c
   SET is_internal = true
 WHERE c.is_internal = false
   AND c.visitor_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.affiliate_visitor_sessions s
      WHERE s.visitor_id = c.visitor_id
        AND s.affiliate_id = c.affiliate_id
        AND s.landing_page_full ~* '^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.)'
   );

-- Types de page mal classés par l'ancien détecteur.
UPDATE public.affiliate_visitor_sessions
   SET entry_page_type = 'agency_page'
 WHERE entry_page ~ '^/rp/' AND entry_page_type IS DISTINCT FROM 'agency_page';

UPDATE public.affiliate_visitor_sessions
   SET entry_page_type = 'venue_page'
 WHERE entry_page ~ '^/affiliate-venue/' AND entry_page_type IS DISTINCT FROM 'venue_page';

-- Battements « en ligne » : une ligne par session, jamais relue au-delà de
-- 5 minutes. Purge quotidienne.
SELECT cron.schedule(
  'affiliate-live-pings-purge',
  '55 3 * * *',
  $$DELETE FROM public.affiliate_live_pings WHERE last_seen < now() - interval '2 days'$$
);

-- ── 5. Curation du linktree d'agence : la nuit en cours reste choisissable ─
CREATE OR REPLACE FUNCTION public.set_agency_linktree_events(p_affiliate_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  IF NOT public.can_manage_affiliate_linktree(p_affiliate_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.affiliate_linktree_events WHERE affiliate_id = p_affiliate_id;

  WITH raw AS (
    SELECT it->>'kind' AS kind, it->>'id' AS id_txt, ord
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(it, ord)
    WHERE it->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ext AS (
    SELECT DISTINCT ON (ae.id) ae.id, r.ord
    FROM raw r
    JOIN public.affiliate_events ae ON ae.id = r.id_txt::uuid
    WHERE r.kind = 'external'
      AND ae.affiliate_id = p_affiliate_id
      AND ae.event_date >= public.affiliate_night_date()
    ORDER BY ae.id, r.ord
  ),
  yun AS (
    SELECT DISTINCT ON (s.event_id) s.event_id AS id, r.ord
    FROM raw r
    JOIN public._agency_linktree_yuno_scope(p_affiliate_id) s ON s.event_id = r.id_txt::uuid
    WHERE r.kind = 'yuno'
    ORDER BY s.event_id, r.ord
  ),
  ins AS (
    INSERT INTO public.affiliate_linktree_events (affiliate_id, affiliate_event_id, event_id, sort_order)
    SELECT p_affiliate_id, id, NULL, ord::int FROM ext
    UNION ALL
    SELECT p_affiliate_id, NULL, id, ord::int FROM yun
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$function$;
