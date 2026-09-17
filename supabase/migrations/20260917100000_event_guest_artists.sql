-- ═══════════════════════════════════════════════════════════════════════════
-- Line-up invité : des artistes SANS compte Yuno sur l'affiche d'une soirée
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Contexte. Le line-up public d'une soirée vit dans `event_djs` → `djs`, et
-- `djs.user_id` est NOT NULL : un artiste n'entre à l'affiche que s'il a un
-- compte Yuno. La plupart des line-ups d'un club ou d'un BDE comptent pourtant
-- des noms qui ne seront jamais sur Yuno. Ils manquaient donc à l'affiche
-- publique, au dos du pass Wallet et au texte que lit le moteur de goût.
--
-- Cette table les porte, et RIEN d'autre : un nom, une photo, un lien
-- Instagram. Pas de compte, pas de booking, pas de cachet, pas de page
-- publique, pas de marketplace — un artiste invité n'est jamais un `djs`.
-- C'est ce qui garde le handshake booking (dj_booking_requests → event_djs)
-- intact : il ne concerne que les artistes qui peuvent répondre.
--
-- Le clic vers l'Instagram de l'artiste est mesuré SANS cookie, même modèle
-- que `track_links_event` : le serveur reconstruit le visiteur par un hash
-- salé-jour (`links_visitor_context()`), rien n'est posé sur l'appareil.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La garde d'écriture ──────────────────────────────────────────────────
-- Copie EXACTE de la policy « Event design holders manage event_djs » : le
-- line-up invité appartient au même domaine (« design ») que le line-up DJ,
-- donc exactement les mêmes personnes le tiennent. Extraite en fonction pour
-- que la table, la RPC de lecture et l'edge function parlent d'une seule voix.
CREATE OR REPLACE FUNCTION public.can_manage_event_design(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM events e
    LEFT JOIN venues v ON (v.id = e.venue_id OR v.id = e.partner_venue_id)
    WHERE e.id = _event_id
      AND (
        is_super_admin()
        OR (v.owner_id = _user_id
            AND collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design')
                = ANY (ARRAY['venue', 'both']))
        OR ((e.organizer_user_id = _user_id OR e.partner_organizer_id = _user_id)
            AND collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design')
                = ANY (ARRAY['organizer', 'both']))
        OR is_org_team_member(_user_id, COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  );
$$;

COMMENT ON FUNCTION public.can_manage_event_design(uuid, uuid) IS
  'Détenteur du domaine « design » d''une soirée (affiche, line-up). Miroir de la policy event_djs.';

-- ── 2. Les artistes invités ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_guest_artists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name              text NOT NULL,
  photo_url         text,
  -- URL normalisée côté serveur (trigger) : https://www.instagram.com/<handle>/
  instagram_url     text,
  instagram_handle  text,
  position          integer NOT NULL DEFAULT 0,
  -- Compteur dénormalisé : la page pro affiche un chiffre sans scanner le journal.
  instagram_clicks  integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_guest_artists_name_chk   CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT event_guest_artists_handle_chk CHECK (instagram_handle IS NULL OR instagram_handle ~ '^[A-Za-z0-9._]{1,30}$')
);

COMMENT ON TABLE public.event_guest_artists IS
  'Line-up invité : artistes sans compte Yuno (nom + photo + Instagram). Affichage seul — jamais un djs, jamais un booking.';

CREATE INDEX IF NOT EXISTS idx_event_guest_artists_event
  ON public.event_guest_artists (event_id, position, created_at);

-- Un même artiste ne figure qu'une fois sur une soirée. La contrainte porte sur
-- le nom en minuscules : le handle est facultatif (un artiste sans Instagram
-- reste légitime), donc il ne peut pas servir de clé.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_guest_artists_event_name
  ON public.event_guest_artists (event_id, lower(btrim(name)));

-- ── 3. Normalisation du lien Instagram ──────────────────────────────────────
-- Le pro colle ce qu'il a sous la main : « @nom », « nom »,
-- « instagram.com/nom?igsh=… », « https://www.instagram.com/nom/ ». Le serveur
-- range tout ça en un handle et une URL canonique — c'est ce qui rend le
-- compteur de clics et la récupération de photo fiables, et c'est aussi ce qui
-- interdit qu'un champ « Instagram » serve à poser un lien vers autre chose.
CREATE OR REPLACE FUNCTION public.normalize_instagram_handle(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  v := btrim(coalesce(p_raw, ''));
  IF v = '' THEN RETURN NULL; END IF;

  -- Retire le protocole, le host et tout ce qui suit le handle.
  v := regexp_replace(v, '^\s*https?://', '', 'i');
  v := regexp_replace(v, '^(www\.|m\.)?instagram\.com/', '', 'i');
  v := regexp_replace(v, '^@', '');
  v := split_part(split_part(split_part(v, '?', 1), '#', 1), '/', 1);

  IF v !~ '^[A-Za-z0-9._]{1,30}$' THEN RETURN NULL; END IF;
  RETURN lower(v);
END;
$$;

CREATE OR REPLACE FUNCTION public.event_guest_artists_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_handle text;
BEGIN
  NEW.name := btrim(NEW.name);

  -- Le handle se déduit de ce qui a été saisi : l'URL d'abord (c'est le champ
  -- du formulaire), le handle ensuite (appels programmatiques).
  v_handle := public.normalize_instagram_handle(coalesce(NEW.instagram_url, NEW.instagram_handle));
  NEW.instagram_handle := v_handle;
  NEW.instagram_url := CASE WHEN v_handle IS NULL
                            THEN NULL
                            ELSE 'https://www.instagram.com/' || v_handle || '/' END;

  -- La photo est une URL, et seulement http(s) : un `javascript:` ou un
  -- `data:` dans un <img src> de la page publique n'a rien à faire ici.
  IF NEW.photo_url IS NOT NULL AND NEW.photo_url !~* '^https?://' THEN
    NEW.photo_url := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    -- Le compteur n'appartient pas au pro : seule la RPC de clic l'écrit.
    NEW.instagram_clicks := OLD.instagram_clicks;
    NEW.created_by := OLD.created_by;
  ELSE
    NEW.instagram_clicks := 0;
    NEW.created_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

-- La liste de colonnes n'est PAS cosmétique : sans elle, l'incrément du
-- compteur fait par track_guest_artist_click déclencherait ce trigger, qui
-- rétablirait aussitôt OLD.instagram_clicks — le compteur resterait à zéro
-- pour toujours. « UPDATE OF <colonnes du formulaire> » fait que la mise à
-- jour du seul compteur ne réveille rien.
DROP TRIGGER IF EXISTS trg_event_guest_artists_normalize ON public.event_guest_artists;
CREATE TRIGGER trg_event_guest_artists_normalize
  BEFORE INSERT OR UPDATE OF name, photo_url, instagram_url, instagram_handle, position
  ON public.event_guest_artists
  FOR EACH ROW EXECUTE FUNCTION public.event_guest_artists_normalize();

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.event_guest_artists ENABLE ROW LEVEL SECURITY;

-- Le line-up est public, comme event_djs : la page soirée est servie à l'anon.
DROP POLICY IF EXISTS "Anyone can view event_guest_artists" ON public.event_guest_artists;
CREATE POLICY "Anyone can view event_guest_artists"
  ON public.event_guest_artists FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Event design holders manage event_guest_artists" ON public.event_guest_artists;
CREATE POLICY "Event design holders manage event_guest_artists"
  ON public.event_guest_artists FOR ALL
  USING (public.can_manage_event_design(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event_design(auth.uid(), event_id));

-- ── 5. Le journal des clics sortants ────────────────────────────────────────
-- RLS totale, aucune policy : seules les fonctions definer y touchent.
CREATE TABLE IF NOT EXISTS public.guest_artist_link_clicks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id    uuid NOT NULL REFERENCES public.event_guest_artists(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL,
  clicked_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_artist_link_clicks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_guest_artist_clicks_artist
  ON public.guest_artist_link_clicks (artist_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_artist_clicks_event
  ON public.guest_artist_link_clicks (event_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_artist_clicks_dedup
  ON public.guest_artist_link_clicks (artist_id, visitor_hash, clicked_at DESC);

-- ── 6. Ingestion du clic ────────────────────────────────────────────────────
-- Appelée par la page publique en fire-and-forget. Elle ne lève jamais : un
-- clic vers Instagram doit partir même si la mesure échoue.
CREATE OR REPLACE FUNCTION public.track_guest_artist_click(p_artist_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event  uuid;
  v_ctx    record;
  v_recent integer;
BEGIN
  IF p_artist_id IS NULL THEN RETURN; END IF;

  SELECT event_id INTO v_event FROM event_guest_artists WHERE id = p_artist_id;
  IF v_event IS NULL THEN RETURN; END IF;

  -- Jamais compter l'équipe.
  IF auth.uid() IS NOT NULL AND is_super_admin() THEN RETURN; END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();

  -- Dédup 30 min par visiteur et par artiste : un aller-retour vers Instagram
  -- puis un second clic, c'est la même personne curieuse, pas deux.
  IF EXISTS (
    SELECT 1 FROM guest_artist_link_clicks
    WHERE artist_id = p_artist_id
      AND visitor_hash = v_ctx.o_hash
      AND clicked_at > now() - interval '30 minutes'
  ) THEN
    RETURN;
  END IF;

  -- Anti-flood : 60 clics / heure / visiteur, toutes soirées confondues.
  SELECT count(*) INTO v_recent
  FROM guest_artist_link_clicks
  WHERE visitor_hash = v_ctx.o_hash AND clicked_at > now() - interval '1 hour';
  IF v_recent >= 60 THEN RETURN; END IF;

  INSERT INTO guest_artist_link_clicks (artist_id, event_id, visitor_hash)
  VALUES (p_artist_id, v_event, v_ctx.o_hash);

  UPDATE event_guest_artists
  SET instagram_clicks = instagram_clicks + 1
  WHERE id = p_artist_id;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.track_guest_artist_click(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.track_guest_artist_click(uuid) TO anon, authenticated;

-- ── 7. Lecture pro ──────────────────────────────────────────────────────────
-- Clics totaux, visiteurs distincts et clics des 7 derniers jours par artiste.
CREATE OR REPLACE FUNCTION public.get_event_guest_artist_clicks(p_event_id uuid)
RETURNS TABLE (
  artist_id        uuid,
  name             text,
  instagram_handle text,
  clicks           integer,
  unique_visitors  integer,
  clicks_7d        integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_manage_event_design(auth.uid(), p_event_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.instagram_handle,
    a.instagram_clicks,
    COALESCE(c.uniques, 0)::integer,
    COALESCE(c.last7, 0)::integer
  FROM event_guest_artists a
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT k.visitor_hash)::integer AS uniques,
           count(*) FILTER (WHERE k.clicked_at > now() - interval '7 days')::integer AS last7
    FROM guest_artist_link_clicks k
    WHERE k.artist_id = a.id
  ) c ON true
  WHERE a.event_id = p_event_id
  ORDER BY a.position, a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_guest_artist_clicks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_event_guest_artist_clicks(uuid) TO authenticated;

-- ── 8. Purge ────────────────────────────────────────────────────────────────
-- Le journal ne sert qu'à la dédup et au détail ; le total vit dans le
-- compteur dénormalisé, qui lui ne s'efface pas.
CREATE OR REPLACE FUNCTION public.purge_guest_artist_clicks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM guest_artist_link_clicks WHERE clicked_at < now() - interval '13 months';
$$;

REVOKE ALL ON FUNCTION public.purge_guest_artist_clicks() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('guest-artist-clicks-purge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'guest-artist-clicks-purge');
    PERFORM cron.schedule('guest-artist-clicks-purge', '45 3 * * *',
      $cron$ SELECT public.purge_guest_artist_clicks(); $cron$);
  END IF;
END $$;
