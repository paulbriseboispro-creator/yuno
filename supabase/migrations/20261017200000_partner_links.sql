-- ============================================================================
-- Liens partenaires — un lien et une page de stats par personne, pour UNE soirée
-- ============================================================================
-- Un club ou un organisateur branche un promoteur, un DJ, une amie qui fait
-- vendre… sur une seule soirée SANS lui créer de compte. Ce n'est pas un second
-- système : c'est un lien suivi (`tracked_links`, route /l/<code>) qui porte en
-- plus le nom de la personne et un jeton secret. Le jeton ouvre une page
-- publique (/stats/<jeton>) où la personne suit SES clics et SES ventes.
--
-- Règles :
-- • Un lien partenaire = owner_kind club ou organisateur, cible une soirée.
--   Ses ventes, clics et CA se comptent EXACTEMENT comme les autres liens
--   (mêmes statuts, CA club de fees.ts) : la Console et la page partenaire
--   disent les mêmes chiffres.
-- • Le jeton naît côté serveur (jamais choisi par le client), ne change pas
--   à l'édition, et ne se renouvelle que par reset_partner_link_page().
-- • La page publique ne rend JAMAIS une adresse, un téléphone ni un nom
--   complet : prénom + initiale de l'acheteur. Le contact du partenaire
--   (WhatsApp / email) reste lisible par l'équipe seule (RLS existante).
-- • Le CA n'apparaît sur la page que si l'équipe l'a choisi
--   (partner_shows_revenue).
-- • La page se ferme 7 jours après la fin de la soirée.
-- ============================================================================

ALTER TABLE public.tracked_links
  ADD COLUMN IF NOT EXISTS partner_name text,
  ADD COLUMN IF NOT EXISTS partner_role text,
  ADD COLUMN IF NOT EXISTS partner_contact text,
  ADD COLUMN IF NOT EXISTS partner_token text,
  ADD COLUMN IF NOT EXISTS partner_shows_revenue boolean NOT NULL DEFAULT true;

ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_partner_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_partner_chk CHECK (
  partner_name IS NULL OR (
    owner_kind IN ('venue', 'organizer')
    AND target_kind = 'event'
    AND char_length(partner_name) BETWEEN 1 AND 60
    AND partner_role IN ('promoter', 'dj', 'artist', 'ambassador', 'other')
    AND partner_token ~ '^[0-9a-f]{32}$'
    AND (partner_contact IS NULL OR char_length(partner_contact) <= 120)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tracked_links_partner_token_key
  ON public.tracked_links (partner_token) WHERE partner_token IS NOT NULL;

COMMENT ON COLUMN public.tracked_links.partner_token IS
  'Jeton secret de la page /stats/<jeton> d''un lien partenaire. Posé par le trigger, renouvelé par reset_partner_link_page().';

-- ---------------------------------------------------------------------------
-- Normalisation : le serveur pose le jeton, le libellé et l'utm_medium.
-- SECURITY INVOKER : un normaliseur, pas une garde.
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
    RETURN NEW;
  END IF;

  NEW.partner_name := btrim(regexp_replace(NEW.partner_name, '\s+', ' ', 'g'));
  NEW.partner_contact := nullif(btrim(NEW.partner_contact), '');
  NEW.partner_role := coalesce(NEW.partner_role, 'promoter');

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

DROP TRIGGER IF EXISTS trg_tracked_links_partner_normalize ON public.tracked_links;
CREATE TRIGGER trg_tracked_links_partner_normalize
  BEFORE INSERT OR UPDATE ON public.tracked_links
  FOR EACH ROW EXECUTE FUNCTION public.tracked_links_partner_normalize();

-- ---------------------------------------------------------------------------
-- Prénom + initiale, jamais plus.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._partner_buyer_label(p_first text, p_last text, p_full text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH n AS (
    SELECT
      nullif(btrim(coalesce(nullif(btrim(p_first), ''), split_part(btrim(coalesce(p_full, '')), ' ', 1))), '') AS f,
      nullif(btrim(coalesce(
        nullif(btrim(p_last), ''),
        CASE WHEN nullif(btrim(p_first), '') IS NULL
             THEN substr(btrim(coalesce(p_full, '')), length(split_part(btrim(coalesce(p_full, '')), ' ', 1)) + 1)
        END
      )), '') AS l
  )
  SELECT CASE WHEN f IS NULL THEN NULL
              ELSE left(initcap(lower(f)), 24) || coalesce(' ' || upper(left(l, 1)) || '.', '')
         END
  FROM n;
$$;

REVOKE ALL ON FUNCTION public._partner_buyer_label(text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Les ventes d'un lien — mêmes statuts et même CA que get_tracked_link_stats.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._partner_link_sales(p_link_id uuid)
RETURNS TABLE(kind text, at timestamptz, buyer text, item text, qty integer, amount numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'ticket', coalesce(t.paid_at, t.created_at),
         public._partner_buyer_label(coalesce(t.guest_first_name, p.first_name), coalesce(t.guest_last_name, p.last_name), t.full_name),
         coalesce(tr.name, t.ticket_type), coalesce(t.quantity, 1),
         greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
           - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))
    FROM public.tickets t
    LEFT JOIN public.ticket_rounds tr ON tr.id = t.ticket_round_id
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE t.tracked_link_id = p_link_id AND t.status IN ('paid', 'used')
  UNION ALL
  SELECT 'table', coalesce(r.paid_at, r.created_at),
         public._partner_buyer_label(coalesce(r.guest_first_name, p.first_name), coalesce(r.guest_last_name, p.last_name), r.full_name),
         tp.name, r.guest_count,
         greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
           - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))
    FROM public.table_reservations r
    LEFT JOIN public.table_packs tp ON tp.id = r.pack_id
    LEFT JOIN public.profiles p ON p.id = r.user_id
   WHERE r.tracked_link_id = p_link_id AND r.status IN ('paid', 'confirmed')
  UNION ALL
  SELECT 'order', o.created_at, NULL::text, NULL::text, NULL::integer,
         greatest(o.total - coalesce(o.service_fee, 0), 0)
           - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
    FROM public.orders o
   WHERE o.tracked_link_id = p_link_id AND o.status IN ('paid', 'served')
  UNION ALL
  SELECT 'guestlist', g.created_at,
         public._partner_buyer_label(NULL, NULL, coalesce(g.full_name, nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''))),
         NULL::text, 1, 0::numeric
    FROM public.guest_list_entries g
    LEFT JOIN public.profiles p ON p.id = g.user_id
   WHERE g.tracked_link_id = p_link_id AND g.status <> 'cancelled';
$$;

REVOKE ALL ON FUNCTION public._partner_link_sales(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- La page publique /stats/<jeton>.
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

-- ---------------------------------------------------------------------------
-- Nouveau jeton : l'ancienne page cesse de répondre (lien de vente inchangé).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_partner_link_page(p_link_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.tracked_links%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links WHERE id = p_link_id AND partner_name IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.tracked_link_team_can_read(v_link.owner_kind, v_link.venue_id, v_link.organizer_user_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('yuno.partner_token_reset', 'on', true);
  UPDATE public.tracked_links SET partner_token = partner_token
   WHERE id = p_link_id
   RETURNING partner_token INTO v_token;
  PERFORM set_config('yuno.partner_token_reset', '', true);
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_partner_link_page(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_partner_link_page(uuid) TO authenticated;
