-- ============================================================================
-- Renommage = liens à jour, partout. Généralise le pattern organisateur/DJ/event
-- (slug propre + table d'alias + resync au renommage + résolution anon-safe)
-- aux trois familles de profils qui ne l'avaient pas :
--
--   1. Agences / affiliés  — affiliates.linktree_slug alimente /p/:slug,
--      /rp/:slug et /p/:slug/agenda. La synchro d'identité agence→affilié
--      copiait name mais JAMAIS le slug : une agence renommée (MadByNight →
--      Amoris) gardait son ancienne URL. Corrigé ici.
--   2. Promoteurs membres  — affiliate_members.linktree_slug (/promo/:slug).
--   3. Clubs               — venues n'avait AUCUN slug : l'id texte était l'URL,
--      donc un club renommé gardait une URL périmée à vie. On ajoute venues.slug
--      (l'id reste la clé interne, immuable) ; l'id et les anciens slugs
--      continuent de résoudre (redirection canonique côté front).
--
-- DJ, organisateurs et events ont déjà leur resync (20260621170000,
-- 20260621180000, 20260705150000) — rien à faire pour eux ici, sinon faire
-- suivre le slug de club dans les URLs d'événements (section 4).
--
-- agencies.slug n'est consommé par aucune page publique (les /p/ et /rp/
-- passent par affiliates.linktree_slug) : on le laisse volontairement intact.
--
-- Règles house respectées :
--   * fonctions de resync en SECURITY DEFINER (les tables d'alias ont la RLS
--     activée sans policy INSERT — cf. fix 20260624163000) ;
--   * résolution via RPC SECURITY DEFINER GRANT anon (pas de policy SELECT) ;
--   * un slug modifié explicitement l'emporte (l'ancien est archivé aussi :
--     l'édition manuelle du slug dans AffiliateSettings ne casse plus rien).
-- ============================================================================

-- ============================================================================
-- 1. Agences / affiliés — /p/:slug, /rp/:slug, /p/:slug/agenda
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.affiliate_slug_aliases (
  slug         text PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_slug_aliases_affiliate_idx
  ON public.affiliate_slug_aliases(affiliate_id);
ALTER TABLE public.affiliate_slug_aliases ENABLE ROW LEVEL SECURITY;

-- Générateur : slug propre dérivé du nom (accents retirés via search_norm),
-- désambiguïsé en -2, -3… contre les slugs vivants ET les alias retirés.
CREATE OR REPLACE FUNCTION public.gen_affiliate_linktree_slug(p_name text, p_exclude uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(public.search_norm(coalesce(p_name, 'agence')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' OR base IS NULL THEN base := 'agence'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.affiliates
                 WHERE linktree_slug = cand AND id IS DISTINCT FROM p_exclude)
     OR EXISTS (SELECT 1 FROM public.affiliate_slug_aliases
                 WHERE slug = cand AND affiliate_id IS DISTINCT FROM p_exclude)
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

-- Resync : quand le nom change (renommage direct OU synchro agence→affilié),
-- le slug suit et l'ancien devient un alias. Un slug modifié explicitement
-- est respecté (et son prédécesseur archivé).
CREATE OR REPLACE FUNCTION public.sync_affiliate_linktree_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_new text;
BEGIN
  IF NEW.linktree_slug IS DISTINCT FROM OLD.linktree_slug THEN
    IF OLD.linktree_slug IS NOT NULL AND NEW.linktree_slug IS NOT NULL THEN
      INSERT INTO public.affiliate_slug_aliases (slug, affiliate_id)
        VALUES (OLD.linktree_slug, NEW.id) ON CONFLICT (slug) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.linktree_slug IS NOT NULL THEN
    v_new := public.gen_affiliate_linktree_slug(NEW.name, NEW.id);
    IF v_new IS DISTINCT FROM OLD.linktree_slug THEN
      INSERT INTO public.affiliate_slug_aliases (slug, affiliate_id)
        VALUES (OLD.linktree_slug, NEW.id) ON CONFLICT (slug) DO NOTHING;
      NEW.linktree_slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS affiliates_linktree_slug_sync ON public.affiliates;
CREATE TRIGGER affiliates_linktree_slug_sync
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.sync_affiliate_linktree_slug();

-- Résolution : slug courant → alias → NULL (anon-safe, ne renvoie que le
-- slug canonique d'un profil actif — la page refait sa propre requête).
CREATE OR REPLACE FUNCTION public.resolve_affiliate_slug(p_slug text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_slug text;
BEGIN
  SELECT linktree_slug INTO v_slug FROM public.affiliates
   WHERE linktree_slug = lower(p_slug) AND is_active = true;
  IF v_slug IS NOT NULL THEN RETURN v_slug; END IF;

  SELECT a.linktree_slug INTO v_slug
    FROM public.affiliate_slug_aliases al
    JOIN public.affiliates a ON a.id = al.affiliate_id
   WHERE al.slug = lower(p_slug) AND a.is_active = true;
  RETURN v_slug;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_affiliate_slug(text) TO anon, authenticated;

-- ============================================================================
-- 2. Promoteurs membres — /promo/:slug (+ /promo/:slug/agenda)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.affiliate_member_slug_aliases (
  slug       text PRIMARY KEY,
  member_id  uuid NOT NULL REFERENCES public.affiliate_members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_member_slug_aliases_member_idx
  ON public.affiliate_member_slug_aliases(member_id);
ALTER TABLE public.affiliate_member_slug_aliases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.gen_member_linktree_slug(p_name text, p_exclude uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(public.search_norm(coalesce(p_name, 'promoteur')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' OR base IS NULL THEN base := 'promoteur'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.affiliate_members
                 WHERE linktree_slug = cand AND id IS DISTINCT FROM p_exclude)
     OR EXISTS (SELECT 1 FROM public.affiliate_member_slug_aliases
                 WHERE slug = cand AND member_id IS DISTINCT FROM p_exclude)
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_member_linktree_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_new text; v_name text;
BEGIN
  IF NEW.linktree_slug IS DISTINCT FROM OLD.linktree_slug THEN
    IF OLD.linktree_slug IS NOT NULL AND NEW.linktree_slug IS NOT NULL THEN
      INSERT INTO public.affiliate_member_slug_aliases (slug, member_id)
        VALUES (OLD.linktree_slug, NEW.id) ON CONFLICT (slug) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name
      OR NEW.last_name IS DISTINCT FROM OLD.last_name)
     AND OLD.linktree_slug IS NOT NULL THEN
    v_name := NULLIF(btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), '');
    v_new := public.gen_member_linktree_slug(COALESCE(v_name, 'promoteur'), NEW.id);
    IF v_new IS DISTINCT FROM OLD.linktree_slug THEN
      INSERT INTO public.affiliate_member_slug_aliases (slug, member_id)
        VALUES (OLD.linktree_slug, NEW.id) ON CONFLICT (slug) DO NOTHING;
      NEW.linktree_slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS affiliate_members_slug_sync ON public.affiliate_members;
CREATE TRIGGER affiliate_members_slug_sync
  BEFORE UPDATE ON public.affiliate_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_linktree_slug();

CREATE OR REPLACE FUNCTION public.resolve_member_slug(p_slug text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_slug text;
BEGIN
  SELECT linktree_slug INTO v_slug FROM public.affiliate_members
   WHERE linktree_slug = lower(p_slug) AND is_active = true;
  IF v_slug IS NOT NULL THEN RETURN v_slug; END IF;

  SELECT m.linktree_slug INTO v_slug
    FROM public.affiliate_member_slug_aliases al
    JOIN public.affiliate_members m ON m.id = al.member_id
   WHERE al.slug = lower(p_slug) AND m.is_active = true;
  RETURN v_slug;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_member_slug(text) TO anon, authenticated;

-- ============================================================================
-- 3. Clubs — /club/:slug. L'id texte reste la clé interne (jamais renommé,
--    aucune FK touchée) ; le slug devient la face publique et suit le nom.
-- ============================================================================

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS slug text;

CREATE TABLE IF NOT EXISTS public.venue_slug_aliases (
  slug       text PRIMARY KEY,
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_slug_aliases_venue_idx
  ON public.venue_slug_aliases(venue_id);
ALTER TABLE public.venue_slug_aliases ENABLE ROW LEVEL SECURITY;

-- Le slug d'un club ne doit entrer en collision ni avec un slug vivant, ni
-- avec l'ID d'un AUTRE club (même espace d'URL /club/:param), ni avec un alias.
-- Son propre id est autorisé : un club bien nommé garde son URL historique.
CREATE OR REPLACE FUNCTION public.gen_venue_slug(p_name text, p_exclude text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(public.search_norm(coalesce(p_name, 'club')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' OR base IS NULL THEN base := 'club'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.venues
                 WHERE slug = cand AND id IS DISTINCT FROM p_exclude)
     OR EXISTS (SELECT 1 FROM public.venues
                 WHERE id = cand AND id IS DISTINCT FROM p_exclude)
     OR EXISTS (SELECT 1 FROM public.venue_slug_aliases
                 WHERE slug = cand AND venue_id IS DISTINCT FROM p_exclude)
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_venue_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_new text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := public.gen_venue_slug(NEW.name, NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    IF OLD.slug IS NOT NULL AND NEW.slug IS NOT NULL THEN
      INSERT INTO public.venue_slug_aliases (slug, venue_id)
        VALUES (OLD.slug, NEW.id) ON CONFLICT (slug) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    v_new := public.gen_venue_slug(NEW.name, NEW.id);
    IF v_new IS DISTINCT FROM OLD.slug THEN
      IF OLD.slug IS NOT NULL THEN
        INSERT INTO public.venue_slug_aliases (slug, venue_id)
          VALUES (OLD.slug, NEW.id) ON CONFLICT (slug) DO NOTHING;
      END IF;
      NEW.slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS venues_slug_sync ON public.venues;
CREATE TRIGGER venues_slug_sync
  BEFORE INSERT OR UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.sync_venue_slug();

-- Résolution /club/:param → (id interne, slug canonique). Le param peut être
-- le slug courant, l'id historique, ou un ancien slug. La page redirige vers
-- le slug canonique et requête par id — la RLS gouverne les données comme avant.
CREATE OR REPLACE FUNCTION public.resolve_venue_slug(p_slug text)
RETURNS TABLE (venue_id text, slug text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY
    SELECT v.id, COALESCE(NULLIF(v.slug, ''), v.id) FROM public.venues v
     WHERE v.slug = lower(p_slug) OR v.id = p_slug
     ORDER BY (v.id = p_slug) DESC
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT v.id, COALESCE(NULLIF(v.slug, ''), v.id)
      FROM public.venue_slug_aliases a
      JOIN public.venues v ON v.id = a.venue_id
     WHERE a.slug = lower(p_slug)
     LIMIT 1;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_venue_slug(text) TO anon, authenticated;

-- L'accès anon à venues est en GRANT par colonne (20260703140000) : la
-- nouvelle colonne doit être accordée explicitement, sinon les pages publiques
-- ne peuvent pas la lire.
GRANT SELECT (slug) ON public.venues TO anon;

-- Backfill : chaque club reçoit son slug dérivé du nom. gen_venue_slug exclut
-- l'id propre → un club dont l'id correspond déjà au nom garde son URL telle
-- quelle. Les autres changent d'URL canonique, l'id continuant de résoudre.
DO $$
DECLARE r record; v_new text;
BEGIN
  FOR r IN SELECT id, name FROM public.venues WHERE slug IS NULL OR btrim(slug) = '' LOOP
    v_new := public.gen_venue_slug(r.name, r.id);
    UPDATE public.venues SET slug = v_new WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS venues_slug_key ON public.venues(slug);

-- ============================================================================
-- 4. URLs d'événements de club : le host suit le slug du club.
--    resolve_event_path accepte id / slug / ancien slug côté entrée, et
--    renvoie le slug canonique côté sortie. event_host_slug pareil.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_event_path(p_host text, p_slug text)
RETURNS TABLE (event_id uuid, host text, slug text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_org uuid; v_org_slug text; v_venue text; v_host text;
BEGIN
  -- --- Branche VENUE : host = slug courant, id historique, ou ancien slug. ---
  SELECT v.id, COALESCE(NULLIF(v.slug, ''), v.id) INTO v_venue, v_host
    FROM public.venues v
   WHERE v.id = p_host OR v.slug = lower(p_host)
   ORDER BY (v.id = p_host) DESC
   LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT v.id, COALESCE(NULLIF(v.slug, ''), v.id) INTO v_venue, v_host
      FROM public.venue_slug_aliases a
      JOIN public.venues v ON v.id = a.venue_id
     WHERE a.slug = lower(p_host)
     LIMIT 1;
  END IF;
  IF v_venue IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, v_host, e.slug
        FROM public.events e
       WHERE e.venue_id = v_venue
         AND e.organizer_user_id IS NULL
         AND e.is_active = true
         AND ( e.slug = p_slug
            OR EXISTS (SELECT 1 FROM public.event_slug_aliases a
                        WHERE a.event_id = e.id AND a.slug = p_slug) )
       ORDER BY (e.slug = p_slug) DESC
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- --- Branche ORGA : host = slug d'orga (courant ou alias), quel que soit is_public. ---
  SELECT o.user_id INTO v_org FROM public.organizer_profiles o WHERE o.slug = p_host;
  IF v_org IS NULL THEN
    SELECT al.user_id INTO v_org FROM public.organizer_slug_aliases al WHERE al.slug = p_host;
  END IF;
  IF v_org IS NOT NULL THEN
    SELECT o.slug INTO v_org_slug FROM public.organizer_profiles o WHERE o.user_id = v_org;
    RETURN QUERY
      SELECT e.id, v_org_slug, e.slug
        FROM public.events e
       WHERE e.organizer_user_id = v_org
         AND e.is_active = true
         AND ( e.slug = p_slug
            OR EXISTS (SELECT 1 FROM public.event_slug_aliases a
                        WHERE a.event_id = e.id AND a.slug = p_slug) )
       ORDER BY (e.slug = p_slug) DESC
       LIMIT 1;
  END IF;
  RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_event_path(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_host_slug(p_event_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
           WHEN e.organizer_user_id IS NOT NULL
             THEN (SELECT o.slug FROM public.organizer_profiles o WHERE o.user_id = e.organizer_user_id)
           ELSE (SELECT COALESCE(NULLIF(v.slug, ''), v.id) FROM public.venues v WHERE v.id = e.venue_id)
         END
    FROM public.events e WHERE e.id = p_event_id;
$$;
GRANT EXECUTE ON FUNCTION public.event_host_slug(uuid) TO anon, authenticated;

-- ============================================================================
-- 5. Réparation de l'existant : l'agence renommée MadByNight → Amoris garde un
--    linktree_slug périmé (la synchro ne touchait pas le slug). On ne resynchronise
--    QUE ce cas connu — les slugs personnalisés à la main des autres affiliés
--    sont respectés (le resync automatique ne vaut que pour les renommages futurs).
--    Le trigger ci-dessus archive 'madbynight' en alias : l'ancien lien redirige.
-- ============================================================================
UPDATE public.affiliates
   SET linktree_slug = public.gen_affiliate_linktree_slug(name, id)
 WHERE linktree_slug = 'madbynight'
   AND public.search_norm(name) NOT LIKE '%madbynight%';
