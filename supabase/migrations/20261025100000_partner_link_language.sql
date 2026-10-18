-- ============================================================================
-- Liens partenaires : la page de stats parle la langue choisie par le pro
-- ============================================================================
-- Demande de Paul (18/10) : la page /stats/<jeton> d'un partenaire existe en
-- anglais, français et espagnol, et c'est le pro qui choisit la langue à la
-- création du lien (modifiable ensuite). Le message d'envoi (WhatsApp / email)
-- suit la même langue. Avant, la page suivait la langue du téléphone du
-- visiteur.
--
-- • `tracked_links.partner_language` ('en' | 'fr' | 'es'), NULL hors lien
--   partenaire, posée par le trigger de normalisation ('en' si le client ne
--   l'envoie pas).
-- • Les liens partenaires déjà créés passent en anglais (décision de Paul).
-- • get_partner_link_page rend `language` (page ouverte comme page fermée).
--
-- Corps des deux fonctions repris de la prod (pg_get_functiondef, identiques
-- à 20261017200000) ; seules les lignes de la langue changent.
-- ============================================================================

ALTER TABLE public.tracked_links
  ADD COLUMN IF NOT EXISTS partner_language text;

COMMENT ON COLUMN public.tracked_links.partner_language IS
  'Langue de la page /stats/<jeton> et du message d''envoi d''un lien partenaire (en | fr | es), choisie par le pro.';

-- Les liens partenaires existants : en anglais. Le trigger de normalisation
-- (BEFORE UPDATE) reste neutre ici : il garde le jeton et rétablit les champs
-- qu'il pose déjà.
UPDATE public.tracked_links
   SET partner_language = 'en'
 WHERE partner_name IS NOT NULL
   AND partner_language IS DISTINCT FROM 'en';

ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_partner_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_partner_chk CHECK (
  partner_name IS NULL OR (
    owner_kind IN ('venue', 'organizer')
    AND target_kind = 'event'
    AND char_length(partner_name) BETWEEN 1 AND 60
    AND partner_role IN ('promoter', 'dj', 'artist', 'ambassador', 'other')
    AND partner_token ~ '^[0-9a-f]{32}$'
    AND (partner_contact IS NULL OR char_length(partner_contact) <= 120)
    AND partner_language IN ('en', 'fr', 'es')
  )
);

-- ---------------------------------------------------------------------------
-- Normalisation : + la langue de la page.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracked_links_partner_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_turned_on boolean;
BEGIN
  IF NEW.partner_name IS NULL THEN
    NEW.partner_role := NULL;
    NEW.partner_contact := NULL;
    NEW.partner_token := NULL;
    NEW.partner_language := NULL;
    RETURN NEW;
  END IF;

  NEW.partner_name := btrim(regexp_replace(NEW.partner_name, '\s+', ' ', 'g'));
  NEW.partner_contact := nullif(btrim(NEW.partner_contact), '');
  NEW.partner_role := coalesce(NEW.partner_role, 'promoter');
  -- La langue de la page est choisie par le pro ; un client qui ne l'envoie
  -- pas (ancien bundle) crée une page en anglais.
  NEW.partner_language := coalesce(lower(nullif(btrim(NEW.partner_language), '')), 'en');

  -- Un nom de canal est une clé ailleurs (semis, email → lien « newsletter ») :
  -- un partenaire ne le porte jamais.
  IF lower(NEW.partner_name) IN ('instagram', 'tiktok', 'newsletter', 'facebook',
                                 'whatsapp', 'flyer', 'snapchat', 'coorg') THEN
    RAISE EXCEPTION 'partner_name_reserved' USING ERRCODE = '22023';
  END IF;

  NEW.label := NEW.partner_name;
  NEW.utm_medium := 'partner_link';

  -- Montrer le CA au partenaire, c'est montrer de l'argent : seul qui le voit
  -- lui-même peut l'ouvrir (sinon un éditeur lirait le CA par la page).
  IF NEW.partner_shows_revenue AND auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      v_turned_on := true;
    ELSE
      v_turned_on := NOT OLD.partner_shows_revenue;
    END IF;
    IF v_turned_on
       AND NOT public.tracked_link_team_sees_money(NEW.owner_kind, NEW.venue_id, NEW.organizer_user_id) THEN
      NEW.partner_shows_revenue := false;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.partner_token := replace(gen_random_uuid()::text, '-', '');
  ELSIF coalesce(current_setting('yuno.partner_token_reset', true), '') = 'on' OR OLD.partner_token IS NULL THEN
    NEW.partner_token := replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.partner_token := OLD.partner_token;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- La page publique : + `language`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_partner_link_page(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.tracked_links%ROWTYPE;
  v_ev record;
  v_tz text;
  v_close timestamptz;
  v_host text;
  v_owner text;
  v_money boolean;
  v_today date;
  v_totals jsonb;
  v_sales jsonb;
  v_days jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_link FROM public.tracked_links
   WHERE partner_token = p_token AND partner_name IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT e.id, e.title, e.start_at, e.end_at, e.timezone, e.venue_id, e.organizer_user_id,
         coalesce(e.poster_url, e.image_url) AS poster, e.location_name, e.location_city
    INTO v_ev
    FROM public.events e WHERE e.id = v_link.event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_tz := coalesce(nullif(v_ev.timezone, ''), 'Europe/Paris');
  v_close := coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') + interval '7 days';
  v_money := v_link.partner_shows_revenue;

  SELECT coalesce(
           (SELECT v.name FROM public.venues v WHERE v.id = v_ev.venue_id),
           (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = v_ev.organizer_user_id)
         ) INTO v_host;
  SELECT CASE v_link.owner_kind
           WHEN 'venue' THEN (SELECT v.name FROM public.venues v WHERE v.id = v_link.venue_id)
           ELSE (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = v_link.organizer_user_id)
         END INTO v_owner;

  IF now() > v_close THEN
    RETURN jsonb_build_object(
      'found', true, 'closed', true,
      'language', v_link.partner_language,
      'partner_name', v_link.partner_name,
      'event_title', v_ev.title,
      'owner_name', v_owner
    );
  END IF;

  SELECT jsonb_build_object(
           'clicks', v_link.clicks_count,
           'sales', count(*),
           'revenue', CASE WHEN v_money THEN coalesce(sum(s.amount), 0) END
         ),
         coalesce(jsonb_agg(jsonb_build_object(
           'kind', s.kind, 'at', s.at, 'buyer', s.buyer, 'item', s.item, 'qty', s.qty,
           'amount', CASE WHEN v_money THEN s.amount END
         ) ORDER BY s.at DESC) FILTER (WHERE s.kind IS NOT NULL), '[]'::jsonb)
    INTO v_totals, v_sales
    FROM public._partner_link_sales(v_link.id) s;

  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT jsonb_agg(jsonb_build_object('day', d::date, 'clicks', coalesce(c.n, 0)) ORDER BY d)
    INTO v_days
    FROM generate_series(v_today - 6, v_today, interval '1 day') AS d
    LEFT JOIN (
      SELECT (k.clicked_at AT TIME ZONE v_tz)::date AS day, count(*) AS n
        FROM public.tracked_link_clicks k
       WHERE k.tracked_link_id = v_link.id
         AND k.clicked_at >= (v_today - 6)::timestamp AT TIME ZONE v_tz
       GROUP BY 1
    ) c ON c.day = d::date;

  RETURN jsonb_build_object(
    'found', true,
    'closed', false,
    'language', v_link.partner_language,
    'partner_name', v_link.partner_name,
    'partner_role', v_link.partner_role,
    'code', v_link.code,
    'is_active', v_link.is_active,
    'shows_revenue', v_money,
    'owner_name', v_owner,
    'closes_at', v_close,
    'event', jsonb_build_object(
      'title', v_ev.title,
      'start_at', v_ev.start_at,
      'end_at', v_ev.end_at,
      'timezone', v_tz,
      'poster_url', v_ev.poster,
      'location_name', v_ev.location_name,
      'location_city', v_ev.location_city,
      'host_name', v_host
    ),
    'totals', v_totals,
    'days', coalesce(v_days, '[]'::jsonb),
    'sales', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_sales) x LIMIT 200) y)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_link_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_link_page(text) TO anon, authenticated;
