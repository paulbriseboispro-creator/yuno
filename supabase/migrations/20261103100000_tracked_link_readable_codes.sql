-- Liens suivis : une adresse qui se LIT (décision de Paul du 2026-10-19).
--
-- `yunoapp.eu/l/y1etp142` dans la bio Instagram d'Amoris ressemblait à un lien
-- douteux : rien n'y disait la soirée ni la structure. Désormais la base
-- fabrique elle-même un code lisible, soirée + réseau :
--
--   yunoapp.eu/l/house-of-masquerade-insta       (lien Instagram de l'hôte)
--   yunoapp.eu/l/house-of-masquerade-telos       (lien partenaire)
--   yunoapp.eu/l/house-of-masquerade-woh-insta   (co-hôte, promoteur : son nom)
--   yunoapp.eu/l/goya-thursday-23-10-insta       (soirée récurrente ou même nom)
--   yunoapp.eu/l/amoris-insta                    (lien de profil)
--   yunoapp.eu/go/club-sonore-insta-story-2      (lien de partage du CRM)
--
-- Règles :
-- * UNE fabrique, `tracked_link_readable_code`, posée par le déclencheur
--   d'insertion : aucune des dix fonctions qui créent un lien ne change (elles
--   relisent toutes le code par RETURNING). Elle prend la main quand le code
--   arrive vide ou au format aléatoire (8 caractères, hors lien partenaire,
--   dont le code peut être choisi par le pro). Miroir TS exact :
--   src/lib/trackedLinkCode.ts, cas partagés
--   src/lib/__tests__/fixtures/tracked-link-codes.json.
-- * Le SMS garde un code court au hasard : chaque caractère du lien compte dans
--   le prix du SMS, et l'estimation de la Console suppose un lien de 22
--   caractères (SAMPLE_LINK).
-- * Un code qui change n'est JAMAIS perdu : l'ancien entre dans
--   `tracked_link_code_aliases` et continue de rediriger et de compter, sans
--   limite (un lien déjà posé dans une bio, sur une affiche, dans un e-mail
--   parti). Aucun nouveau code ne peut reprendre un ancien code.
-- * Les liens déjà créés sont renommés, SAUF les liens d'une soirée Shotgun
--   (CRM) : Shotgun rapporte `utm_source = yuno-<code>` sur chaque billet, et
--   les ventes déjà rapportées perdraient leur lien. Leurs nouveaux liens sont
--   lisibles. Les liens des publicités Meta gardent aussi le leur (l'annonce
--   chez Meta porte l'ancienne adresse ; personne ne lit ce code).
-- * Un code ne commence jamais par « m- », « s- » ou « d- » : `yuno-m-…`,
--   `yuno-s-…`, `yuno-d-…` sont des familles de source du CRM.

-- ── Les anciens codes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tracked_link_code_aliases (
  code             text PRIMARY KEY,
  tracked_link_id  uuid NOT NULL REFERENCES public.tracked_links(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracked_link_code_aliases_link_idx
  ON public.tracked_link_code_aliases (tracked_link_id);
ALTER TABLE public.tracked_link_code_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracked_link_code_aliases FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.tracked_link_code_aliases IS
  'Anciens codes d''un lien suivi : ils redirigent et comptent toujours (migration 20261103100000). Aucune policy : lu par les fonctions de redirection seulement.';

-- ── La règle d'écriture (miroir de src/lib/trackedLinkCode.ts) ──────────────
CREATE OR REPLACE FUNCTION public.tracked_link_slug(p_text text, p_max integer DEFAULT 28)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
DECLARE
  v     text;
  w     text;
  v_out text := '';
BEGIN
  -- Ligatures, puis accents retirés, puis minuscules : le même ordre que le TS.
  v := coalesce(p_text, '');
  v := replace(replace(v, 'œ', 'oe'), 'Œ', 'oe');
  v := replace(replace(v, 'æ', 'ae'), 'Æ', 'ae');
  v := replace(replace(v, 'ß', 'ss'), 'ẞ', 'ss');
  v := lower(regexp_replace(normalize(v, NFD), '[̀-ͯ]', '', 'g'));
  v := btrim(regexp_replace(v, '[^a-z0-9]+', '-', 'g'), '-');
  IF v = '' OR p_max < 1 THEN RETURN ''; END IF;
  IF length(v) <= p_max THEN RETURN v; END IF;
  -- Coupé au MOT : jamais « house-of-masquer ».
  FOREACH w IN ARRAY string_to_array(v, '-') LOOP
    EXIT WHEN length(v_out) + (CASE WHEN v_out = '' THEN 0 ELSE 1 END) + length(w) > p_max;
    v_out := CASE WHEN v_out = '' THEN w ELSE v_out || '-' || w END;
  END LOOP;
  IF v_out = '' THEN v_out := rtrim(left(v, p_max), '-'); END IF;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.tracked_link_channel_tag(p_word text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT CASE lower(btrim(coalesce(p_word, '')))
           WHEN 'instagram' THEN 'insta'
           WHEN 'meta' THEN 'ads'
           WHEN 'meta_ads' THEN 'ads'
           ELSE public.tracked_link_slug(p_word, 20) END;
$$;

-- `[préfixe]-soirée-[parties…]` en 60 caractères au plus : c'est le nom de la
-- soirée qui raccourcit, jamais la fin (le réseau, le partenaire).
CREATE OR REPLACE FUNCTION public.tracked_link_compose(p_prefix text, p_base_raw text, p_tail text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
DECLARE
  v_tail text;
  v_rest integer;
  v_out  text;
BEGIN
  v_tail := array_to_string(ARRAY(
    SELECT x FROM unnest(coalesce(p_tail, ARRAY[]::text[])) WITH ORDINALITY AS t(x, i)
     WHERE coalesce(x, '') <> '' ORDER BY i), '-');
  v_rest := CASE WHEN coalesce(p_prefix, '') <> '' THEN length(p_prefix) + 1 ELSE 0 END
          + CASE WHEN v_tail <> '' THEN length(v_tail) + 1 ELSE 0 END;
  v_out := array_to_string(ARRAY(
    SELECT x FROM unnest(ARRAY[
             p_prefix,
             public.tracked_link_slug(p_base_raw, greatest(8, least(28, 60 - v_rest))),
             v_tail]) WITH ORDINALITY AS t(x, i)
     WHERE coalesce(x, '') <> '' ORDER BY i), '-');
  v_out := btrim(left(v_out, 60), '-');
  RETURN regexp_replace(v_out, '^([msd])-', '\1');
END;
$$;

-- ── Un code est-il libre ? Qui le porte ? ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tracked_link_id_for_code(p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT tl.id FROM public.tracked_links tl WHERE tl.code = lower(btrim(p_code))),
    (SELECT a.tracked_link_id FROM public.tracked_link_code_aliases a WHERE a.code = lower(btrim(p_code))));
$$;

CREATE OR REPLACE FUNCTION public.tracked_link_code_is_free(p_code text, p_self uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(length(p_code), 0) BETWEEN 3 AND 60
     AND p_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     AND NOT EXISTS (SELECT 1 FROM public.tracked_links tl
                      WHERE tl.code = p_code AND tl.id IS DISTINCT FROM p_self)
     AND NOT EXISTS (SELECT 1 FROM public.tracked_link_code_aliases a
                      WHERE a.code = p_code AND a.tracked_link_id IS DISTINCT FROM p_self);
$$;

-- Le code aléatoire de secours (SMS, ou une fabrique qui n'a rien trouvé) ne
-- reprend jamais un ancien code.
CREATE OR REPLACE FUNCTION public.gen_tracked_link_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_code text;
  v_i int;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, floor(random() * 36)::int + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tracked_links WHERE code = v_code)
          AND NOT EXISTS (SELECT 1 FROM public.tracked_link_code_aliases WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- ── La fabrique ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tracked_link_readable_code(p_link public.tracked_links)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src       text := lower(btrim(coalesce(p_link.utm_source, '')));
  v_med       text := lower(btrim(coalesce(p_link.utm_medium, '')));
  v_ev_id     uuid := p_link.event_id;
  v_gl_ev     uuid;
  v_ev        record;
  v_has_ev    boolean := false;
  v_mirror    boolean := false;
  v_recurring boolean := false;
  v_is_host   boolean := true;
  v_base      text;
  v_owner     text;
  v_mid       text;
  v_suf       text;
  v_date      text;
  v_struct    text;
  v_plain     text;
  v_dated     text;
  v_cands     text[] := ARRAY[]::text[];
  v_root      text;
  v_c         text;
  v_n         integer;
  v_holder    record;
BEGIN
  -- Deux liens créés en même temps ne choisissent jamais le même code.
  PERFORM pg_advisory_xact_lock(hashtext('tracked_links.readable_code'));

  IF p_link.target_kind = 'guestlist' AND p_link.guest_list_id IS NOT NULL THEN
    SELECT gl.event_id INTO v_gl_ev FROM public.guest_lists gl WHERE gl.id = p_link.guest_list_id;
    v_ev_id := coalesce(v_gl_ev, v_ev_id);
  END IF;

  -- Qui partage : son nom entre dans l'adresse quand ce n'est pas l'hôte.
  v_owner := CASE p_link.owner_kind
    WHEN 'venue' THEN (SELECT v.name FROM public.venues v WHERE v.id = p_link.venue_id)
    WHEN 'organizer' THEN (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = p_link.organizer_user_id)
    WHEN 'promoter' THEN (SELECT coalesce(nullif(btrim(p.first_name), ''), p.promo_code) FROM public.promoters p WHERE p.id = p_link.promoter_id)
    WHEN 'dj' THEN (SELECT d.stage_name FROM public.djs d WHERE d.id = p_link.dj_id)
  END;

  IF p_link.target_kind IN ('event', 'guestlist') AND v_ev_id IS NOT NULL THEN
    SELECT e.title, e.slug, e.start_at, e.timezone, e.recurring_template_id,
           e.venue_id, e.organizer_user_id, e.external_source
      INTO v_ev
      FROM public.events e WHERE e.id = v_ev_id;
    v_has_ev := FOUND;
  END IF;

  IF v_has_ev THEN
    v_base := CASE WHEN public.tracked_link_slug(v_ev.title, 28) <> '' THEN v_ev.title ELSE v_ev.slug END;
    v_mirror := v_ev.external_source IS NOT NULL;
    v_recurring := v_ev.recurring_template_id IS NOT NULL;
    v_is_host := (p_link.owner_kind = 'venue' AND p_link.venue_id IS NOT NULL AND p_link.venue_id = v_ev.venue_id)
              OR (p_link.owner_kind = 'organizer' AND p_link.organizer_user_id = v_ev.organizer_user_id);
    BEGIN
      v_date := to_char(v_ev.start_at AT TIME ZONE coalesce(nullif(btrim(v_ev.timezone), ''), 'Europe/Paris'), 'DD-MM');
    EXCEPTION WHEN invalid_parameter_value THEN
      v_date := to_char(v_ev.start_at AT TIME ZONE 'Europe/Paris', 'DD-MM');
    END;
    -- « Jeudi Étudiant — 23/04 » porte déjà sa date : jamais deux fois.
    IF v_date IS NOT NULL AND '-' || public.tracked_link_slug(v_base, 60) || '-' LIKE '%-' || v_date || '-%' THEN
      v_date := NULL;
    END IF;
  ELSIF p_link.target_kind = 'venue' THEN
    v_base := (SELECT v.name FROM public.venues v WHERE v.id = p_link.target_venue_id);
  ELSE
    v_base := (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = p_link.organizer_user_id);
  END IF;
  IF public.tracked_link_slug(v_base, 28) = '' THEN v_base := 'yuno'; END IF;

  -- La fin de l'adresse : le réseau, ou qui partage.
  IF p_link.partner_name IS NOT NULL THEN
    v_suf := coalesce(nullif(public.tracked_link_slug(p_link.partner_name, 20), ''), 'partner');
  ELSIF v_med = 'party_link' OR v_src = 'coorg' THEN
    v_suf := coalesce(nullif(public.tracked_link_slug(v_owner, 20), ''), 'partner');
  ELSIF p_link.owner_kind = 'dj' THEN
    v_suf := coalesce(nullif(public.tracked_link_slug(coalesce(v_owner, p_link.label), 20), ''), 'dj');
  ELSIF v_med = 'paid_social' OR v_src IN ('meta', 'meta_ads') THEN
    v_suf := 'ads';
  ELSIF v_mirror AND v_src IN ('instagram', 'tiktok', 'whatsapp', 'facebook', 'snapchat', 'telegram')
        AND v_med IN ('story', 'bio', 'reel', 'video', 'post', 'group', 'dm', 'link') THEN
    v_suf := public.tracked_link_channel_tag(v_src) || '-' || v_med;
  ELSE
    v_suf := coalesce(nullif(public.tracked_link_channel_tag(coalesce(nullif(btrim(p_link.label), ''), v_src)), ''), 'link');
  END IF;

  IF p_link.owner_kind = 'promoter' THEN
    v_mid := coalesce(nullif(public.tracked_link_slug(v_owner, 20), ''), 'promoter');
  ELSIF v_has_ev AND NOT v_is_host AND p_link.owner_kind IN ('venue', 'organizer')
        AND p_link.partner_name IS NULL AND v_med <> 'party_link' AND v_src <> 'coorg' THEN
    v_mid := nullif(public.tracked_link_slug(v_owner, 20), '');
  ELSIF p_link.target_kind = 'guestlist' THEN
    v_mid := 'guestlist';
  END IF;

  IF NOT v_has_ev THEN
    v_plain := public.tracked_link_compose(NULL, v_base, ARRAY[v_suf]);
    v_cands := ARRAY[v_plain];
  ELSE
    v_plain := public.tracked_link_compose(NULL, v_base, ARRAY[v_mid, v_suf]);
    IF v_date IS NOT NULL THEN
      v_dated := public.tracked_link_compose(NULL, v_base, ARRAY[v_date, v_mid, v_suf]);
    END IF;
    -- Une soirée récurrente porte toujours sa date : chaque semaine a son lien.
    IF NOT v_recurring OR v_dated IS NULL THEN v_cands := v_cands || v_plain; END IF;
    IF v_dated IS NOT NULL THEN v_cands := v_cands || v_dated; END IF;
    -- Même nom de soirée ailleurs, même date : le nom de l'hôte devant.
    IF v_mid IS NULL AND v_is_host THEN
      v_struct := nullif(public.tracked_link_slug(v_owner, 16), '');
      IF v_struct IS NOT NULL AND public.tracked_link_slug(v_base, 28) NOT LIKE v_struct || '%' THEN
        IF NOT v_recurring OR v_dated IS NULL THEN
          v_cands := v_cands || public.tracked_link_compose(v_struct, v_base, ARRAY[v_suf]);
        END IF;
        IF v_date IS NOT NULL THEN
          v_cands := v_cands || public.tracked_link_compose(v_struct, v_base, ARRAY[v_date, v_suf]);
        END IF;
      END IF;
    END IF;
  END IF;

  FOREACH v_c IN ARRAY v_cands LOOP
    IF public.tracked_link_code_is_free(v_c, p_link.id) THEN RETURN v_c; END IF;
    -- Pris par un autre lien de CETTE soirée : celui d'une autre structure (les
    -- deux hôtes d'une co-soirée) → le nom de qui partage ; le même partageur
    -- (une 2e story, une 2e part de guest list) → on numérote, la date
    -- n'aiderait pas.
    SELECT coalesce(tl.event_id, gl.event_id) AS ev,
           tl.owner_kind IS NOT DISTINCT FROM p_link.owner_kind
             AND tl.venue_id IS NOT DISTINCT FROM p_link.venue_id
             AND tl.organizer_user_id IS NOT DISTINCT FROM p_link.organizer_user_id
             AND tl.promoter_id IS NOT DISTINCT FROM p_link.promoter_id
             AND tl.dj_id IS NOT DISTINCT FROM p_link.dj_id AS same_owner
      INTO v_holder
      FROM public.tracked_links tl
      LEFT JOIN public.guest_lists gl ON gl.id = tl.guest_list_id
     WHERE tl.id = public.tracked_link_id_for_code(v_c);
    IF v_has_ev AND v_holder.ev = v_ev_id THEN
      IF NOT v_holder.same_owner AND v_mid IS NULL
         AND nullif(public.tracked_link_slug(v_owner, 20), '') IS NOT NULL THEN
        v_c := public.tracked_link_compose(NULL, v_base,
                 ARRAY[CASE WHEN v_recurring THEN v_date END, public.tracked_link_slug(v_owner, 20), v_suf]);
        IF public.tracked_link_code_is_free(v_c, p_link.id) THEN RETURN v_c; END IF;
      END IF;
      v_root := v_c;
      EXIT;
    END IF;
  END LOOP;

  v_root := coalesce(v_root, v_dated, v_plain);
  IF v_root IS NOT NULL AND v_root <> '' THEN
    FOR v_n IN 2..99 LOOP
      v_c := rtrim(left(v_root, 59 - length(v_n::text)), '-') || '-' || v_n::text;
      IF public.tracked_link_code_is_free(v_c, p_link.id) THEN RETURN v_c; END IF;
    END LOOP;
  END IF;

  RETURN public.gen_tracked_link_code();
END;
$$;

COMMENT ON FUNCTION public.tracked_link_readable_code(public.tracked_links) IS
  'Code lisible d''un lien suivi : soirée + réseau (migration 20261103100000). Miroir TS : src/lib/trackedLinkCode.ts.';

-- ── Le déclencheur ───────────────────────────────────────────────────────────
-- SECURITY DEFINER : il lit les noms (soirées, clubs, promoteurs) quelle que
-- soit la RLS de qui crée le lien. Il ne décide rien sur l'identité de
-- l'appelant, donc rien ne l'éteint en DEFINER.
CREATE OR REPLACE FUNCTION public.tracked_links_readable_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF lower(coalesce(NEW.utm_source, '')) = 'sms' THEN
      IF coalesce(btrim(NEW.code), '') = '' THEN NEW.code := public.gen_tracked_link_code(); END IF;
    ELSIF coalesce(btrim(NEW.code), '') = ''
       OR (NEW.partner_name IS NULL AND NEW.code ~ '^[a-z0-9]{8}$') THEN
      NEW.code := public.tracked_link_readable_code(NEW);
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.code IS DISTINCT FROM OLD.code)
     AND EXISTS (SELECT 1 FROM public.tracked_link_code_aliases a
                  WHERE a.code = NEW.code AND a.tracked_link_id <> NEW.id) THEN
    RAISE EXCEPTION 'tracked_link_code_taken' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tracked_links_keep_old_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    INSERT INTO public.tracked_link_code_aliases (code, tracked_link_id)
    VALUES (OLD.code, NEW.id)
    ON CONFLICT (code) DO NOTHING;
    -- Revenir à un ancien code le reprend.
    DELETE FROM public.tracked_link_code_aliases WHERE code = NEW.code AND tracked_link_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tracked_links_readable_code ON public.tracked_links;
CREATE TRIGGER trg_tracked_links_readable_code
  BEFORE INSERT OR UPDATE OF code ON public.tracked_links
  FOR EACH ROW EXECUTE FUNCTION public.tracked_links_readable_code();

DROP TRIGGER IF EXISTS trg_tracked_links_keep_old_code ON public.tracked_links;
CREATE TRIGGER trg_tracked_links_keep_old_code
  AFTER UPDATE OF code ON public.tracked_links
  FOR EACH ROW EXECUTE FUNCTION public.tracked_links_keep_old_code();

REVOKE ALL ON FUNCTION public.tracked_link_slug(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_link_channel_tag(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_link_compose(text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_link_id_for_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_link_code_is_free(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_link_readable_code(public.tracked_links) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_links_readable_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_links_keep_old_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracked_link_slug(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_channel_tag(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_compose(text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_id_for_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_code_is_free(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_readable_code(public.tracked_links) TO service_role;

-- ── Les lectures par code reconnaissent les anciens codes ────────────────────
-- (corps lus en prod par pg_get_functiondef ; seule la recherche change, et
-- `crm_link_hit` accepte le tiret.)

CREATE OR REPLACE FUNCTION public.record_tracked_link_click(p_code text, p_visitor_id text DEFAULT NULL::text, p_device_type text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link        public.tracked_links%ROWTYPE;
  v_event_venue text;
  v_org_slug    text;
  v_promo_code  text;
  v_gl_token    text;
  v_gl_event    uuid;
  v_path_event  uuid;
  v_event_host  text;
  v_event_slug  text;
  v_ctx         record;
  v_key         text;
  v_country     text;
  v_ua          text;
  v_count       boolean := true;
  v_flood       integer;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links
   WHERE id = public.tracked_link_id_for_code(p_code) AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- ── Mesure : jamais bloquante ────────────────────────────────────────────
  BEGIN
    v_ua := left(COALESCE(p_user_agent, ''), 400);

    -- Robots d'aperçu (messageries, réseaux sociaux, moteurs) et outils headless.
    IF v_ua ~* '(bot\M|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedinbot|discord|slack|skype|embedly|pinterest|snapchat|google-?other|lighthouse|headless|curl/|wget/|python-requests|okhttp|axios|node-fetch|go-http-client)' THEN
      v_count := false;
    END IF;

    -- L'équipe Yuno qui teste ses propres liens ne gonfle pas les chiffres.
    IF v_count AND auth.uid() IS NOT NULL AND public.is_super_admin() THEN
      v_count := false;
    END IF;

    IF v_count THEN
      IF NULLIF(btrim(COALESCE(p_visitor_id, '')), '') IS NOT NULL THEN
        v_key := 'c:' || left(btrim(p_visitor_id), 80);
      ELSE
        SELECT * INTO v_ctx FROM public.links_visitor_context();
        v_key := v_ctx.o_hash;
        v_country := v_ctx.o_country;
      END IF;

      SELECT count(*) INTO v_flood FROM public.tracked_link_clicks
       WHERE tracked_link_id = v_link.id AND visitor_id = v_key
         AND clicked_at > now() - interval '1 hour';

      IF v_flood < 30 AND NOT EXISTS (
        SELECT 1 FROM public.tracked_link_clicks
         WHERE tracked_link_id = v_link.id AND visitor_id = v_key
           AND clicked_at > now() - interval '30 minutes'
      ) THEN
        INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type, country)
        VALUES (v_link.id, p_ip_hash, NULLIF(v_ua, ''), left(p_referrer, 200), v_key, p_device_type,
                v_country);
        UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_tracked_link_click: %', SQLERRM;
  END;

  -- ── Résolution de la cible (inchangée) ───────────────────────────────────
  IF v_link.target_kind = 'event' THEN
    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_link.event_id;
  END IF;
  IF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_org_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
  END IF;
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

  v_path_event := COALESCE(v_gl_event, v_link.event_id);
  IF v_path_event IS NOT NULL THEN
    SELECT NULLIF(btrim(e.slug), '') INTO v_event_slug FROM public.events e WHERE e.id = v_path_event;
    IF v_event_slug IS NOT NULL THEN
      SELECT NULLIF(btrim(public.event_host_slug(v_path_event)), '') INTO v_event_host;
    END IF;
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
    'guest_list_event_id', v_gl_event,
    'event_host',         v_event_host,
    'event_slug',         v_event_slug
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.get_tracked_link_preview_path(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.tracked_links%ROWTYPE;
  v_gl_event uuid;
  v_slug text;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links
   WHERE id = public.tracked_link_id_for_code(p_code) AND is_active = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_link.target_kind = 'event' THEN
    RETURN '/event/' || v_link.event_id::text;
  ELSIF v_link.target_kind = 'guestlist' THEN
    SELECT gl.event_id INTO v_gl_event FROM public.guest_lists gl WHERE gl.id = v_link.guest_list_id;
    IF v_gl_event IS NOT NULL THEN RETURN '/event/' || v_gl_event::text; END IF;
  ELSIF v_link.target_kind = 'venue' THEN
    RETURN '/club/' || v_link.target_venue_id;
  ELSIF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
    IF v_slug IS NOT NULL THEN RETURN '/o/' || v_slug; END IF;
  END IF;
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.crm_link_hit(p_code text, p_ip text DEFAULT NULL::text, p_ua text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_count boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link record;
  v_hash text;
  v_device text;
  v_country text;
  v_salt uuid;
  v_recent boolean := false;
  v_flood integer;
  v_ref text;
  v_ctx record;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9][A-Za-z0-9-]{2,62}[A-Za-z0-9]$' THEN RETURN NULL; END IF;

  SELECT tl.id, tl.code, tl.is_active, tl.utm_source, tl.utm_medium, e.external_ticket_url
    INTO v_link
    FROM public.tracked_links tl
    JOIN public.events e ON e.id = tl.event_id
   WHERE tl.id = public.tracked_link_id_for_code(p_code)
     AND tl.target_kind = 'event'
     AND e.external_source IS NOT NULL
     AND e.external_ticket_url IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_count AND v_link.is_active THEN
    BEGIN
      IF p_ip IS NULL AND p_ua IS NULL THEN
        SELECT * INTO v_ctx FROM public.links_visitor_context();
        v_hash := v_ctx.o_hash; v_device := v_ctx.o_device; v_country := v_ctx.o_country;
      ELSE
        INSERT INTO public.platform_daily_salts (day) VALUES (current_date) ON CONFLICT (day) DO NOTHING;
        SELECT salt INTO v_salt FROM public.platform_daily_salts WHERE day = current_date;
        v_hash := 'a:' || encode(sha256(convert_to(
          v_salt::text || COALESCE(left(p_ip, 64), '0.0.0.0') || COALESCE(left(p_ua, 400), ''), 'UTF8')), 'hex');
        SELECT device INTO v_device FROM public.platform_parse_ua(left(p_ua, 400), false);
        v_country := upper(NULLIF(left(btrim(COALESCE(p_country, '')), 2), ''));
        IF v_country IN ('XX', 'T1') THEN v_country := NULL; END IF;
      END IF;

      -- Anti-rafale : au-delà de 30 clics par heure d'un même visiteur sur un
      -- même lien, on redirige sans compter.
      SELECT count(*) INTO v_flood FROM public.tracked_link_clicks
       WHERE tracked_link_id = v_link.id AND visitor_id = v_hash AND clicked_at > now() - interval '1 hour';
      IF v_flood < 30 THEN
        SELECT EXISTS (
          SELECT 1 FROM public.tracked_link_clicks
           WHERE tracked_link_id = v_link.id AND visitor_id = v_hash AND clicked_at > now() - interval '30 minutes'
        ) INTO v_recent;
        -- Seul l'hôte du référent est gardé (« l.instagram.com »), jamais l'URL.
        v_ref := NULLIF(lower(substring(COALESCE(p_referrer, '') FROM '^[a-z]+://([^/:?#]+)')), '');
        INSERT INTO public.tracked_link_clicks (tracked_link_id, visitor_id, device_type, referrer, country)
        VALUES (v_link.id, v_hash, v_device, left(v_ref, 120), v_country);
        IF NOT v_recent THEN
          UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- La mesure ne doit jamais empêcher la redirection.
      RAISE WARNING 'crm_link_hit: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'url', v_link.external_ticket_url,
    'source', public.crm_link_source_for(v_link.utm_source, v_link.code),
    'medium', v_link.utm_medium,
    'campaign', 'yuno'
  );
END;
$function$;

-- ── Les liens déjà créés reçoivent leur adresse lisible ──────────────────────
-- Les soirées à venir d'abord (elles prennent l'adresse la plus courte), puis
-- les passées de la plus récente à la plus ancienne, puis les liens de profil.
DO $$
DECLARE
  v_link public.tracked_links%ROWTYPE;
  v_code text;
  v_done integer := 0;
BEGIN
  FOR v_link IN
    SELECT tl.*
      FROM public.tracked_links tl
      LEFT JOIN public.guest_lists gl ON gl.id = tl.guest_list_id
      LEFT JOIN public.events e ON e.id = coalesce(gl.event_id, tl.event_id)
     WHERE lower(coalesce(tl.utm_source, '')) <> 'sms'
       AND coalesce(tl.utm_medium, '') <> 'paid_social'
       AND e.external_source IS NULL
       AND (tl.partner_name IS NOT NULL OR tl.code ~ '^[a-z0-9]{8}$')
     ORDER BY (e.start_at >= now() - interval '12 hours') DESC NULLS LAST,
              CASE WHEN e.start_at >= now() - interval '12 hours' THEN e.start_at END ASC NULLS LAST,
              e.start_at DESC NULLS LAST,
              (tl.promoter_id IS NULL AND tl.dj_id IS NULL AND tl.partner_name IS NULL) DESC,
              tl.created_at, tl.id
  LOOP
    v_code := public.tracked_link_readable_code(v_link);
    IF v_code IS DISTINCT FROM v_link.code THEN
      UPDATE public.tracked_links SET code = v_code WHERE id = v_link.id;
      v_done := v_done + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'liens suivis renommés : %', v_done;
END;
$$;
