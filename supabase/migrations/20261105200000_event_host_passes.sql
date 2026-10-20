-- ============================================================================
-- Le club qui accueille une soirée : un accès à UNE soirée, pas une Console
-- ============================================================================
-- Plan : docs/designs/EVENT_HOST_PASS_PLAN.md (20/10/2026). Nom technique
-- `host_pass` ; le nom visible est À NOMMER par Paul.
--
-- Cas réel : Amoris organise House Of Masquerade chez Tia Felisa (Segovia), un
-- club sans compte Yuno. Inviter ce club en « Partenaire » lui créait un espace
-- organisateur entier, vide, avec conditions pro et guide de configuration,
-- pour regarder UNE soirée. Désormais l'organisateur lui envoie un lien : une
-- page de la soirée, sans compte ni mot de passe, faite d'agrégats.
--
-- Règles :
-- • `event_host_passes` : RLS sans policy, tout passe par les RPC ci-dessous.
-- • Créer / modifier / lister = une partie PRINCIPALE de la soirée (lead ou
--   partenaire), niveau ≥ 2, jamais en accès assisté, démo ↔ démo.
-- • Le jeton (32 hex) naît côté serveur et ne change jamais.
-- • La page publique ne rend QUE des agrégats : jamais un nom, un email, un
--   QR. Mêmes formules que get_event_report (CA club de fees.ts,
--   remboursements déduits ; entrées / attendus de la porte). Le CA n'y est
--   que si l'organisateur l'a laissé (par défaut oui, si lui-même le voit).
-- • Le lien du club = un lien partenaire (`tracked_links`, `partner_role =
--   'venue'`) au nom de la partie qui a créé l'accès : il compte, il ne verse
--   aucune commission.
-- • La page se ferme 7 jours après la fin de la soirée, et l'organisateur la
--   coupe quand il veut.
-- • Conversion : `claim_event_host_pass` rattache le club qui ouvre son compte
--   en Partenaire (co-hôte `viewer`) si l'adresse de son compte est celle de
--   l'invitation ; sinon l'organisateur est prévenu et l'invite lui-même.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Le lien du club : un rôle de partenaire de plus.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_partner_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_partner_chk CHECK (
  partner_name IS NULL OR (
    owner_kind IN ('venue', 'organizer')
    AND target_kind = 'event'
    AND char_length(partner_name) BETWEEN 1 AND 60
    AND partner_role IN ('promoter', 'dj', 'artist', 'ambassador', 'other', 'venue')
    AND partner_token ~ '^[0-9a-f]{32}$'
    AND (partner_contact IS NULL OR char_length(partner_contact) <= 120)
    AND partner_language IN ('en', 'fr', 'es')
  )
);

-- ---------------------------------------------------------------------------
-- 2. Les accès.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_host_passes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_name        text NOT NULL CHECK (char_length(venue_name) BETWEEN 1 AND 80),
  contact_email     text CHECK (contact_email IS NULL OR (char_length(contact_email) <= 254 AND contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_phone     text CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  language          text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr', 'es')),
  token             text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{32}$'),
  show_revenue      boolean NOT NULL DEFAULT true,
  tracked_link_id   uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL,
  organizer_contact_email text CHECK (organizer_contact_email IS NULL OR char_length(organizer_contact_email) <= 254),
  organizer_contact_phone text CHECK (organizer_contact_phone IS NULL OR char_length(organizer_contact_phone) <= 40),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_party  text NOT NULL,
  opened_count      integer NOT NULL DEFAULT 0,
  first_opened_at   timestamptz,
  last_opened_at    timestamptz,
  email_sent_count  integer NOT NULL DEFAULT 0,
  email_sent_at     timestamptz,
  signup_clicks     integer NOT NULL DEFAULT 0,
  whatsapp_clicks   integer NOT NULL DEFAULT 0,
  link_copies       integer NOT NULL DEFAULT 0,
  revoked_at        timestamptz,
  claimed_venue_id  text REFERENCES public.venues(id) ON DELETE SET NULL,
  claimed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at        timestamptz,
  claim_status      text CHECK (claim_status IS NULL OR claim_status IN ('pending', 'accepted', 'recorded')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);

COMMENT ON TABLE public.event_host_passes IS
  'Accès « club hôte » d''une soirée (nom visible à nommer) : une page /h/<jeton> sans compte, faite d''agrégats. RLS sans policy : tout par les RPC *_event_host_pass*.';

CREATE INDEX IF NOT EXISTS event_host_passes_event_idx ON public.event_host_passes (event_id);
-- Un club = un accès vivant par soirée.
CREATE UNIQUE INDEX IF NOT EXISTS event_host_passes_live_name_key
  ON public.event_host_passes (event_id, lower(venue_name)) WHERE revoked_at IS NULL;

ALTER TABLE public.event_host_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_host_passes FROM anon, authenticated;

-- Le jeton ne change jamais, et ne se choisit pas.
CREATE OR REPLACE FUNCTION public.event_host_passes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.token := replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.token := OLD.token;
    NEW.event_id := OLD.event_id;
    NEW.created_by_party := OLD.created_by_party;
    NEW.updated_at := now();
  END IF;
  NEW.venue_name := btrim(regexp_replace(NEW.venue_name, '\s+', ' ', 'g'));
  NEW.contact_email := nullif(lower(btrim(NEW.contact_email)), '');
  NEW.contact_phone := nullif(btrim(NEW.contact_phone), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_host_passes_guard ON public.event_host_passes;
CREATE TRIGGER trg_event_host_passes_guard
  BEFORE INSERT OR UPDATE ON public.event_host_passes
  FOR EACH ROW EXECUTE FUNCTION public.event_host_passes_guard();

-- Ouvertures (dédup par visiteur haché, comme les clics d'artistes).
CREATE TABLE IF NOT EXISTS public.event_host_pass_opens (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pass_id      uuid NOT NULL REFERENCES public.event_host_passes(id) ON DELETE CASCADE,
  visitor_hash text,
  action       text NOT NULL DEFAULT 'open' CHECK (action IN ('open', 'signup', 'whatsapp', 'copy', 'share')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_host_pass_opens_pass_idx ON public.event_host_pass_opens (pass_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_host_pass_opens_visitor_idx ON public.event_host_pass_opens (visitor_hash, created_at DESC);
ALTER TABLE public.event_host_pass_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_host_pass_opens FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Qui gère : une partie PRINCIPALE, niveau ≥ 2.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._host_pass_manager(p_event_id uuid)
RETURNS TABLE(party_key text, level integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  party_key := v_me.party_key;
  level := v_me.level;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._host_pass_manager(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Créer un accès (+ le lien du club).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_event_host_pass(
  p_event_id uuid,
  p_venue_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_language text DEFAULT 'en',
  p_show_revenue boolean DEFAULT true,
  p_organizer_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name  text := btrim(regexp_replace(coalesce(p_venue_name, ''), '\s+', ' ', 'g'));
  v_lang  text := CASE WHEN p_language IN ('en', 'fr', 'es') THEN p_language ELSE 'en' END;
  v_kind  text;
  v_id    text;
  v_money boolean;
  v_link  uuid;
  v_row   public.event_host_passes%ROWTYPE;
  v_org_email text;
  v_org_phone text;
BEGIN
  SELECT * INTO v_me FROM public._host_pass_manager(p_event_id);

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') < now() THEN
    RAISE EXCEPTION 'event_closed';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'contact_required'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 40 OR regexp_replace(v_phone, '\D', '', 'g') !~ '^\d{6,15}$') THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  -- Démo ↔ démo : une soirée démo n'écrit qu'à une adresse démo, et une vraie
  -- soirée jamais à une adresse démo.
  IF v_email IS NOT NULL
     AND (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;

  IF (SELECT count(*) FROM public.event_host_passes h WHERE h.event_id = p_event_id AND h.revoked_at IS NULL) >= 3 THEN
    RAISE EXCEPTION 'too_many_host_passes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_host_passes h
              WHERE h.event_id = p_event_id AND h.revoked_at IS NULL AND lower(h.venue_name) = lower(v_name)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  -- Montrer le CA, c'est montrer de l'argent : seul qui le voit l'ouvre.
  v_money := coalesce(p_show_revenue, true) AND v_me.level >= 3;

  v_kind := split_part(v_me.party_key, ':', 1);
  v_id := substr(v_me.party_key, length(v_kind) + 2);

  -- Le lien du club : un lien partenaire au nom de la partie qui invite.
  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium,
                                    partner_name, partner_role, partner_contact, partner_language,
                                    partner_shows_revenue)
  VALUES ('', left(v_name, 60),
          CASE WHEN v_kind = 'venue' THEN 'venue' ELSE 'organizer' END,
          CASE WHEN v_kind = 'venue' THEN v_id END,
          CASE WHEN v_kind = 'org' THEN v_id::uuid END,
          v_uid, 'event', p_event_id, 'host_venue', 'partner_link',
          left(v_name, 60), 'venue', left(coalesce(v_email, v_phone), 120), v_lang, v_money)
  RETURNING id INTO v_link;

  SELECT u.email INTO v_org_email FROM auth.users u WHERE u.id = v_uid;
  v_org_phone := nullif(btrim(coalesce(p_organizer_phone, (SELECT pr.phone FROM public.profiles pr WHERE pr.id = v_uid), '')), '');

  INSERT INTO public.event_host_passes (event_id, venue_name, contact_email, contact_phone, language, token,
                                        show_revenue, tracked_link_id, organizer_contact_email,
                                        organizer_contact_phone, created_by, created_by_party)
  VALUES (p_event_id, v_name, v_email, v_phone, v_lang, repeat('0', 32), v_money, v_link,
          left(v_org_email, 254), left(v_org_phone, 40), v_uid, v_me.party_key)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'token', v_row.token,
                            'show_revenue', v_row.show_revenue, 'language', v_row.language);
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_host_pass(uuid, text, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_host_pass(uuid, text, text, text, text, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Modifier : CA on/off, couper / rouvrir, langue, contact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_event_host_pass(
  p_pass_id uuid,
  p_show_revenue boolean DEFAULT NULL,
  p_revoked boolean DEFAULT NULL,
  p_language text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.event_host_passes%ROWTYPE;
  v_me    record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
BEGIN
  SELECT * INTO v_row FROM public.event_host_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public._host_pass_manager(v_row.event_id);

  IF p_show_revenue IS TRUE AND NOT v_row.show_revenue AND v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_language IS NOT NULL AND p_language NOT IN ('en', 'fr', 'es') THEN RAISE EXCEPTION 'invalid_language'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF v_email IS NOT NULL
     AND (v_row.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF p_revoked IS FALSE AND v_row.revoked_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_host_passes h
                  WHERE h.event_id = v_row.event_id AND h.revoked_at IS NULL AND h.id <> v_row.id
                    AND lower(h.venue_name) = lower(v_row.venue_name)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  UPDATE public.event_host_passes SET
    show_revenue  = coalesce(p_show_revenue, show_revenue),
    revoked_at    = CASE WHEN p_revoked IS TRUE THEN coalesce(revoked_at, now())
                         WHEN p_revoked IS FALSE THEN NULL ELSE revoked_at END,
    language      = coalesce(p_language, language),
    contact_email = coalesce(v_email, contact_email),
    contact_phone = coalesce(v_phone, contact_phone)
  WHERE id = p_pass_id
  RETURNING * INTO v_row;

  -- Le lien du club suit : même langue, même règle d'argent.
  UPDATE public.tracked_links
     SET partner_shows_revenue = v_row.show_revenue,
         partner_language = v_row.language
   WHERE id = v_row.tracked_link_id;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'show_revenue', v_row.show_revenue,
                            'revoked', v_row.revoked_at IS NOT NULL, 'language', v_row.language);
END;
$$;

REVOKE ALL ON FUNCTION public.update_event_host_pass(uuid, boolean, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event_host_pass(uuid, boolean, boolean, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Lister les accès d'une soirée (carte de la page Co-organisation).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_event_host_passes(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me record;
BEGIN
  SELECT * INTO v_me FROM public._host_pass_manager(p_event_id);
  RETURN jsonb_build_object(
    'ok', true,
    'can_show_revenue', v_me.level >= 3,
    'passes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'venue_name', h.venue_name, 'contact_email', h.contact_email,
               'contact_phone', h.contact_phone, 'language', h.language, 'token', h.token,
               'show_revenue', h.show_revenue, 'opened_count', h.opened_count,
               'first_opened_at', h.first_opened_at, 'last_opened_at', h.last_opened_at,
               'email_sent_count', h.email_sent_count, 'email_sent_at', h.email_sent_at,
               'signup_clicks', h.signup_clicks, 'whatsapp_clicks', h.whatsapp_clicks,
               'revoked', h.revoked_at IS NOT NULL, 'created_at', h.created_at,
               'link_code', tl.code, 'link_clicks', coalesce(tl.clicks_count, 0),
               'link_sales', (SELECT count(*) FROM public.tickets t
                               WHERE t.tracked_link_id = tl.id AND t.status IN ('paid', 'used'))
                           + (SELECT count(*) FROM public.table_reservations r
                               WHERE r.tracked_link_id = tl.id AND r.status IN ('paid', 'confirmed')),
               'claim_status', h.claim_status, 'claimed_at', h.claimed_at,
               'claimed_venue_id', h.claimed_venue_id,
               'claimed_venue_name', (SELECT v.name FROM public.venues v WHERE v.id = h.claimed_venue_id),
               'claimed_is_party', h.claimed_venue_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = 'venue:' || h.claimed_venue_id),
               'claimed_invited', h.claimed_venue_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_cohosts c
                  WHERE c.event_id = p_event_id AND c.venue_id = h.claimed_venue_id AND c.status = 'pending')
             ) ORDER BY h.revoked_at IS NOT NULL, h.created_at DESC)
        FROM public.event_host_passes h
        LEFT JOIN public.tracked_links tl ON tl.id = h.tracked_link_id
       WHERE h.event_id = p_event_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_host_passes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_event_host_passes(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Préparer l'email d'invitation (appelée par l'edge AVEC le JWT du pro).
--    Une fois par 10 minutes, 5 fois au plus ; jamais vers une adresse démo
--    (l'edge le revérifie avant tout envoi).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_event_host_pass_email(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_host_passes%ROWTYPE;
  v_ev  record;
  v_org text;
BEGIN
  SELECT * INTO v_row FROM public.event_host_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._host_pass_manager(v_row.event_id);
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_row.contact_email IS NULL THEN RAISE EXCEPTION 'no_email'; END IF;
  IF v_row.email_sent_count >= 5 THEN RAISE EXCEPTION 'too_many_emails'; END IF;
  IF v_row.email_sent_at > now() - interval '10 minutes' THEN RAISE EXCEPTION 'email_too_soon'; END IF;

  SELECT e.title, e.start_at, e.end_at, coalesce(nullif(e.timezone, ''), 'Europe/Paris') AS tz,
         coalesce(e.poster_url, e.image_url) AS poster, e.location_name, e.location_city
    INTO v_ev FROM public.events e WHERE e.id = v_row.event_id;
  SELECT p.display_name INTO v_org FROM public.event_parties(v_row.event_id) p WHERE p.party_key = v_row.created_by_party;

  UPDATE public.event_host_passes
     SET email_sent_count = email_sent_count + 1, email_sent_at = now()
   WHERE id = p_pass_id;

  RETURN jsonb_build_object(
    'ok', true, 'token', v_row.token, 'email', v_row.contact_email, 'language', v_row.language,
    'venue_name', v_row.venue_name, 'inviter_name', coalesce(v_org, 'Yuno'),
    'event_title', v_ev.title, 'event_start_at', v_ev.start_at, 'timezone', v_ev.tz,
    'poster_url', v_ev.poster, 'location_name', v_ev.location_name, 'location_city', v_ev.location_city,
    'show_revenue', v_row.show_revenue,
    'is_demo', v_row.event_id = ANY (public.demo_event_ids()) OR public.is_demo_email(v_row.contact_email)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_event_host_pass_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_event_host_pass_email(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Alerte super admin (jamais pour la démo, une fois par clé).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._host_pass_alert(p_pass public.event_host_passes, p_kind text, p_dedup text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_org   text;
BEGIN
  IF p_pass.event_id = ANY (public.demo_event_ids()) THEN RETURN; END IF;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = p_pass.event_id;
  SELECT p.display_name INTO v_org FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = p_pass.created_by_party;
  PERFORM public.emit_admin_notification(
    CASE WHEN p_kind = 'claimed' THEN 'admin_host_pass_claimed' ELSE 'admin_host_pass_lead' END,
    CASE p_kind
      WHEN 'open' THEN 'Un club hôte ouvre sa page'
      WHEN 'hot' THEN 'Club hôte : prospect chaud'
      WHEN 'signup' THEN 'Club hôte : « Ouvrir mon compte »'
      WHEN 'whatsapp' THEN 'Club hôte : « Parler à Paul »'
      WHEN 'claimed' THEN 'Club hôte : compte ouvert'
      ELSE 'Club hôte' END,
    p_pass.venue_name || ' — ' || coalesce(v_title, 'soirée')
      || coalesce(' (par ' || v_org || ')', '')
      || CASE p_kind
           WHEN 'open' THEN ' : première ouverture de la page.'
           WHEN 'hot' THEN ' : ' || p_pass.opened_count || ' ouvertures.'
           WHEN 'signup' THEN ' : a cliqué « Ouvrir mon compte club ».'
           WHEN 'whatsapp' THEN ' : veut te parler sur WhatsApp.'
           WHEN 'claimed' THEN ' : a ouvert son compte Yuno.'
           ELSE '.' END,
    CASE WHEN p_kind IN ('signup', 'whatsapp', 'claimed', 'hot') THEN 'high' ELSE 'normal' END,
    'host_pass', p_pass.id::text,
    jsonb_build_object('kind', p_kind, 'venue_name', p_pass.venue_name, 'contact_email', p_pass.contact_email,
                       'contact_phone', p_pass.contact_phone, 'opened_count', p_pass.opened_count,
                       'organizer', v_org, 'event_title', v_title),
    p_dedup, p_pass.event_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_host_pass_alert: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public._host_pass_alert(public.event_host_passes, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Ce que la page publique montre — agrégats seulement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._host_pass_payload(p_pass public.event_host_passes)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       timestamptz := now();
  e           record;
  v_tz        text;
  v_day_start timestamptz;
  v_money     boolean := p_pass.show_revenue;
  v_phase     text;
  v_org       record;
  v_result    jsonb;
  v_audience  jsonb := NULL;
  v_scope_ids uuid[];
  v_lead_kind text := split_part(p_pass.created_by_party, ':', 1);
  v_lead_id   text := substr(p_pass.created_by_party, length(split_part(p_pass.created_by_party, ':', 1)) + 2);
BEGIN
  SELECT ev.*, coalesce(nullif(ev.timezone, ''), v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = coalesce(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_pass.event_id;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_phase := CASE WHEN e.cancelled_at IS NOT NULL THEN 'cancelled'
                  WHEN v_now >= coalesce(e.end_at, e.start_at + interval '8 hours') THEN 'after'
                  WHEN v_now >= e.start_at THEN 'live'
                  ELSE 'before' END;

  SELECT p.display_name, p.avatar_url,
         (SELECT op.instagram_url FROM public.organizer_profiles op WHERE op.user_id = p.organizer_user_id) AS instagram
    INTO v_org
    FROM public.event_parties(p_pass.event_id) p
   WHERE p.party_key = p_pass.created_by_party;

  WITH
  tx AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, coalesce(t.paid_at, t.created_at) AS at_ts,
           greatest(coalesce(t.quantity, 1), 1) AS heads,
           (coalesce(t.total_price, 0) > 0) AS paid,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) AS amount,
           t.tracked_link_id, t.ticket_round_id AS line_id,
           (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used') AS scanned
      FROM public.tickets t
     WHERE t.event_id = p_pass.event_id AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', coalesce(r.paid_at, r.created_at),
           greatest(coalesce(r.guest_count, 0), 1),
           true,
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           r.tracked_link_id, r.pack_id,
           (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
      FROM public.table_reservations r
     WHERE r.event_id = p_pass.event_id AND r.status IN ('paid', 'confirmed')
  ),
  gle AS MATERIALIZED (
    SELECT g.created_at AS at_ts, g.tracked_link_id, coalesce(g.entry_scanned, false) AS scanned
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = p_pass.event_id AND g.status <> 'cancelled'
  ),
  heads AS (
    SELECT at_ts, heads, scanned FROM tx
    UNION ALL
    SELECT at_ts, 1, scanned FROM gle
  ),
  series AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (at_ts AT TIME ZONE v_tz)::date AS d, sum(heads) AS people
      FROM heads GROUP BY 1
  ),
  rounds AS (
    SELECT tr.id, tr.name, tr.price, tr.position, tr.created_at, tr.max_tickets, tr.is_active,
           tr.auto_activate, tr.manually_sold_out, tr.hidden, tr.entry_deadline, tr.includes_drink,
           tr.drink_cutoff_time,
           coalesce((SELECT sum(heads) FROM tx WHERE pillar = 'tickets' AND line_id = tr.id), 0) AS sold
      FROM public.ticket_rounds tr
     WHERE tr.event_id = p_pass.event_id
  )
  SELECT jsonb_build_object(
    'now', v_now,
    'day_start', v_day_start,
    'phase', v_phase,
    'event', jsonb_build_object(
      'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'timezone', v_tz,
      'poster_url', coalesce(e.poster_url, e.image_url),
      'location_name', e.location_name, 'location_city', e.location_city,
      'location_address', CASE WHEN coalesce(e.location_is_secret, false) THEN NULL ELSE e.location_address END,
      'organizer_name', coalesce(v_org.display_name, 'Yuno'),
      'organizer_avatar', v_org.avatar_url,
      'entry_target', e.entry_target
    ),
    'organizer_contact', jsonb_build_object(
      'email', p_pass.organizer_contact_email,
      'phone', p_pass.organizer_contact_phone,
      'instagram', v_org.instagram
    ),
    'totals', jsonb_build_object(
      'paid', jsonb_build_object(
        'n', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND paid),
        'today', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND paid AND at_ts >= v_day_start)),
      'free', jsonb_build_object(
        'n', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND NOT paid),
        'today', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tickets' AND NOT paid AND at_ts >= v_day_start)),
      'guest_list', jsonb_build_object(
        'n', (SELECT count(*) FROM gle),
        'today', (SELECT count(*) FROM gle WHERE at_ts >= v_day_start),
        'enabled', EXISTS (SELECT 1 FROM public.guest_lists gl WHERE gl.event_id = p_pass.event_id AND gl.is_active)),
      'tables', jsonb_build_object(
        'booked', (SELECT count(*) FROM tx WHERE pillar = 'tables'),
        'guests', (SELECT coalesce(sum(heads), 0) FROM tx WHERE pillar = 'tables'),
        'today', (SELECT count(*) FROM tx WHERE pillar = 'tables' AND at_ts >= v_day_start),
        'enabled', coalesce(e.tables_enabled, false)),
      'expected', (SELECT coalesce(sum(heads), 0) FROM heads),
      'expected_today', (SELECT coalesce(sum(heads), 0) FROM heads WHERE at_ts >= v_day_start),
      'expected_3d', (SELECT coalesce(sum(heads), 0) FROM heads WHERE at_ts >= v_now - interval '3 days'),
      'entered', (SELECT coalesce(sum(heads), 0) FROM heads WHERE scanned),
      'door_measured', public._crm_door_measured(
        (SELECT coalesce(sum(heads), 0) FROM heads)::bigint,
        (SELECT coalesce(sum(heads), 0) FROM heads WHERE scanned)::bigint),
      'capacity', CASE
        WHEN coalesce(e.max_tickets, 0) > 0 THEN e.max_tickets
        WHEN EXISTS (SELECT 1 FROM rounds) AND NOT EXISTS (SELECT 1 FROM rounds WHERE coalesce(max_tickets, 0) <= 0)
          THEN (SELECT sum(max_tickets) FROM rounds)
        ELSE NULL END,
      'tickets_sold_out', coalesce(e.tickets_sold_out, false),
      'revenue', CASE WHEN v_money THEN jsonb_build_object(
        'total', round((SELECT coalesce(sum(amount), 0) FROM tx)::numeric, 2),
        'today', round((SELECT coalesce(sum(amount), 0) FROM tx WHERE at_ts >= v_day_start)::numeric, 2)
      ) END
    ),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', r.name, 'price', r.price, 'sold', r.sold, 'capacity', nullif(r.max_tickets, 0),
               'entry_deadline', to_char(r.entry_deadline, 'HH24:MI'),
               'includes_drink', coalesce(r.includes_drink, false),
               'status', CASE
                 WHEN coalesce(e.tickets_sold_out, false) OR coalesce(r.manually_sold_out, false)
                   OR (coalesce(r.max_tickets, 0) > 0 AND r.sold >= r.max_tickets) THEN 'sold_out'
                 WHEN r.is_active THEN 'on_sale'
                 WHEN coalesce(r.auto_activate, false) THEN 'upcoming'
                 ELSE 'closed' END
             ) ORDER BY r.position, r.created_at)
        FROM rounds r
       WHERE NOT coalesce(r.hidden, false) OR r.sold > 0
    ), '[]'::jsonb),
    'arrivals', coalesce((
      SELECT jsonb_agg(jsonb_build_object('deadline', a.deadline, 'heads', a.heads) ORDER BY a.deadline NULLS LAST)
        FROM (SELECT to_char(r.entry_deadline, 'HH24:MI') AS deadline, sum(r.sold) AS heads
                FROM rounds r GROUP BY 1 HAVING sum(r.sold) > 0) a
    ), '[]'::jsonb),
    'drink', jsonb_build_object(
      'heads', (SELECT coalesce(sum(r.sold), 0) FROM rounds r WHERE coalesce(r.includes_drink, false)),
      'cutoff', (SELECT to_char(r.drink_cutoff_time, 'HH24:MI') FROM rounds r
                  WHERE coalesce(r.includes_drink, false) AND r.drink_cutoff_time IS NOT NULL
                  GROUP BY r.drink_cutoff_time ORDER BY sum(r.sold) DESC, r.drink_cutoff_time LIMIT 1)
    ),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('d', s.d, 'people', s.people) ORDER BY s.d DESC)
        FROM series s WHERE s.d <= 60
    ), '[]'::jsonb),
    'series_before', (SELECT coalesce(sum(s.people), 0) FROM series s WHERE s.d > 60),
    'lineup', coalesce((
      SELECT jsonb_agg(x.name ORDER BY x.ord, x.pos)
        FROM (
          SELECT coalesce(nullif(btrim(d.stage_name), ''), btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''))) AS name,
                 1 AS ord, ed.created_at::text AS pos
            FROM public.event_djs ed JOIN public.djs d ON d.id = ed.dj_id
           WHERE ed.event_id = p_pass.event_id
          UNION ALL
          SELECT ga.name, 2, lpad(coalesce(ga.position, 0)::text, 6, '0')
            FROM public.event_guest_artists ga
           WHERE ga.event_id = p_pass.event_id
        ) x
       WHERE nullif(btrim(x.name), '') IS NOT NULL
    ), '[]'::jsonb),
    'link', (
      SELECT jsonb_build_object(
               'code', tl.code,
               'active', tl.is_active,
               'clicks', coalesce(tl.clicks_count, 0),
               'sales', (SELECT count(*) FROM tx WHERE tx.tracked_link_id = tl.id),
               'people', (SELECT coalesce(sum(heads), 0) FROM tx WHERE tx.tracked_link_id = tl.id)
                       + (SELECT count(*) FROM gle WHERE gle.tracked_link_id = tl.id),
               'revenue', CASE WHEN v_money THEN round((SELECT coalesce(sum(amount), 0) FROM tx WHERE tx.tracked_link_id = tl.id)::numeric, 2) END)
        FROM public.tracked_links tl WHERE tl.id = p_pass.tracked_link_id
    )
  ) INTO v_result;

  -- Après la soirée : la part de nouveaux visages (première soirée chez
  -- l'organisateur), même règle que get_event_report. Jamais une identité.
  IF v_phase = 'after' THEN
    IF v_lead_kind = 'org' THEN
      SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x
       WHERE x.organizer_user_id = v_lead_id::uuid OR x.partner_organizer_id = v_lead_id::uuid;
    ELSE
      SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x
       WHERE x.venue_id = v_lead_id OR x.partner_venue_id = v_lead_id;
    END IF;
    WITH people AS (
      SELECT DISTINCT email FROM (
        SELECT lower(t.user_email) AS email FROM public.tickets t
         WHERE t.event_id = p_pass.event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
        UNION ALL
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = p_pass.event_id AND r.status IN ('paid', 'confirmed') AND r.user_email IS NOT NULL
        UNION ALL
        SELECT lower(nullif(btrim(g.email), '')) FROM public.guest_list_entries g
          JOIN public.guest_lists gl ON gl.id = g.guest_list_id
         WHERE gl.event_id = p_pass.event_id AND g.status <> 'cancelled'
      ) p WHERE email IS NOT NULL
    ),
    prior AS MATERIALIZED (
      SELECT x.id FROM public.events x
       WHERE x.id = ANY (v_scope_ids) AND x.id <> p_pass.event_id AND x.start_at < e.start_at
    ),
    seen AS (
      SELECT p.email FROM people p
       WHERE EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id IN (SELECT id FROM prior)
                      AND t.status IN ('paid', 'used') AND lower(t.user_email) = p.email)
          OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id IN (SELECT id FROM prior)
                      AND r.status IN ('paid', 'confirmed') AND lower(r.user_email) = p.email)
          OR EXISTS (SELECT 1 FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                      WHERE gl.event_id IN (SELECT id FROM prior) AND g.status <> 'cancelled' AND lower(g.email) = p.email)
    )
    SELECT jsonb_build_object('people', (SELECT count(*) FROM people),
                              'returning', (SELECT count(*) FROM seen),
                              'prior_events', (SELECT count(*) FROM prior))
      INTO v_audience;
  END IF;

  RETURN v_result || jsonb_build_object('audience', v_audience);
END;
$$;

REVOKE ALL ON FUNCTION public._host_pass_payload(public.event_host_passes) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. La page publique /h/<jeton> (anon). Compte l'ouverture.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_host_pass(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass  public.event_host_passes%ROWTYPE;
  v_ev    record;
  v_close timestamptz;
  v_ctx   record;
  v_team  boolean := false;
  v_count boolean := true;
  v_paul  text;
  v_claim jsonb := NULL;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO v_pass FROM public.event_host_passes WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT e.title, e.start_at, e.end_at, e.cancelled_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  v_close := coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') + interval '7 days';

  IF v_pass.revoked_at IS NOT NULL OR now() > v_close THEN
    RETURN jsonb_build_object('found', true, 'closed', true, 'revoked', v_pass.revoked_at IS NOT NULL,
                              'language', v_pass.language, 'venue_name', v_pass.venue_name,
                              'event_title', v_ev.title);
  END IF;

  -- L'équipe qui regarde sa propre page ne compte pas comme une ouverture.
  IF auth.uid() IS NOT NULL THEN
    v_team := public.is_super_admin() OR EXISTS (SELECT 1 FROM public.my_event_party(v_pass.event_id));
  END IF;

  IF NOT v_team THEN
    BEGIN
      SELECT * INTO v_ctx FROM public.links_visitor_context();
      IF EXISTS (SELECT 1 FROM public.event_host_pass_opens o
                  WHERE o.pass_id = v_pass.id AND o.action = 'open' AND o.visitor_hash = v_ctx.o_hash
                    AND o.created_at > now() - interval '30 minutes') THEN
        v_count := false;
      END IF;
      IF v_count AND (SELECT count(*) FROM public.event_host_pass_opens o
                       WHERE o.visitor_hash = v_ctx.o_hash AND o.created_at > now() - interval '1 hour') >= 60 THEN
        v_count := false;
      END IF;
      IF v_count THEN
        INSERT INTO public.event_host_pass_opens (pass_id, visitor_hash, action) VALUES (v_pass.id, v_ctx.o_hash, 'open');
        UPDATE public.event_host_passes
           SET opened_count = opened_count + 1,
               first_opened_at = coalesce(first_opened_at, now()),
               last_opened_at = now()
         WHERE id = v_pass.id
         RETURNING * INTO v_pass;
        IF v_pass.opened_count = 1 THEN
          PERFORM public._host_pass_alert(v_pass, 'open', 'host_pass_open:' || v_pass.id::text);
        ELSIF v_pass.opened_count = 5 THEN
          PERFORM public._host_pass_alert(v_pass, 'hot', 'host_pass_hot:' || v_pass.id::text);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_event_host_pass count: %', SQLERRM;
    END;
  END IF;

  SELECT nullif(regexp_replace(coalesce(c.config->>'whatsapp_number', ''), '\D', '', 'g'), '')
    INTO v_paul FROM public.links_page_config c WHERE c.id = 'default';

  IF v_pass.claimed_venue_id IS NOT NULL THEN
    v_claim := jsonb_build_object('status', v_pass.claim_status,
                                  'venue_name', (SELECT v.name FROM public.venues v WHERE v.id = v_pass.claimed_venue_id));
  END IF;

  RETURN jsonb_build_object(
    'found', true, 'closed', false, 'revoked', false,
    'cancelled', v_ev.cancelled_at IS NOT NULL,
    'language', v_pass.language,
    'venue_name', v_pass.venue_name,
    'contact_email', v_pass.contact_email,
    'show_revenue', v_pass.show_revenue,
    'closes_at', v_close,
    'paul_whatsapp', v_paul,
    'claim', v_claim,
    'is_team', v_team,
    'is_demo', v_pass.event_id = ANY (public.demo_event_ids())
  ) || public._host_pass_payload(v_pass);
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_host_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_host_pass(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Ce que le club fait sur sa page (boutons de conversion, son lien).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_event_host_pass(p_token text, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_host_passes%ROWTYPE;
  v_ctx  record;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' OR p_action NOT IN ('signup', 'whatsapp', 'copy', 'share') THEN
    RETURN;
  END IF;
  SELECT * INTO v_pass FROM public.event_host_passes WHERE token = p_token AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.my_event_party(v_pass.event_id))) THEN
    RETURN;
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.event_host_pass_opens o
       WHERE o.visitor_hash = v_ctx.o_hash AND o.created_at > now() - interval '1 hour') >= 60 THEN
    RETURN;
  END IF;
  -- Un même geste du même visiteur ne compte qu'une fois par 10 minutes.
  IF EXISTS (SELECT 1 FROM public.event_host_pass_opens o
              WHERE o.pass_id = v_pass.id AND o.action = p_action AND o.visitor_hash = v_ctx.o_hash
                AND o.created_at > now() - interval '10 minutes') THEN
    RETURN;
  END IF;
  INSERT INTO public.event_host_pass_opens (pass_id, visitor_hash, action) VALUES (v_pass.id, v_ctx.o_hash, p_action);

  UPDATE public.event_host_passes SET
    signup_clicks   = signup_clicks + CASE WHEN p_action = 'signup' THEN 1 ELSE 0 END,
    whatsapp_clicks = whatsapp_clicks + CASE WHEN p_action = 'whatsapp' THEN 1 ELSE 0 END,
    link_copies     = link_copies + CASE WHEN p_action IN ('copy', 'share') THEN 1 ELSE 0 END
  WHERE id = v_pass.id
  RETURNING * INTO v_pass;

  IF p_action IN ('signup', 'whatsapp') THEN
    PERFORM public._host_pass_alert(v_pass, p_action, 'host_pass_' || p_action || ':' || v_pass.id::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.track_event_host_pass(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event_host_pass(text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Le club ouvre son compte : il devient Partenaire de la soirée.
--     Adresse du compte = adresse de l'invitation → co-hôte `viewer`, accepté
--     d'office (il a la page, il ouvre son compte avec l'adresse invitée).
--     Sinon l'accès est rattaché, l'organisateur prévenu, et c'est lui qui
--     l'invite depuis la carte (invite_event_cohost) : jamais un club inconnu
--     n'entre seul dans la soirée d'un autre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_event_host_pass(p_token text, p_venue_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_pass   public.event_host_passes%ROWTYPE;
  v_ev     record;
  v_venue  record;
  v_email  text;
  v_cohost uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT * INTO v_pass FROM public.event_host_passes WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR v_pass.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT v.id, v.name INTO v_venue FROM public.venues v
   WHERE v.owner_id = v_uid AND v.decommissioned_at IS NULL
     AND (p_venue_id IS NULL OR v.id = p_venue_id)
   ORDER BY v.created_at LIMIT 1;
  IF v_venue.id IS NULL THEN RAISE EXCEPTION 'no_venue'; END IF;

  IF (v_pass.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM (v_venue.id = ANY (public.demo_venue_ids())) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF v_pass.claimed_venue_id IS NOT NULL AND v_pass.claimed_venue_id <> v_venue.id THEN
    RAISE EXCEPTION 'already_claimed';
  END IF;

  SELECT e.end_at, e.start_at, e.cancelled_at INTO v_ev FROM public.events e WHERE e.id = v_pass.event_id;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  IF EXISTS (SELECT 1 FROM public.event_parties(v_pass.event_id) p WHERE p.party_key = 'venue:' || v_venue.id) THEN
    v_status := 'accepted';
  ELSIF v_ev.cancelled_at IS NOT NULL OR coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') < now() THEN
    -- Soirée passée : on garde la trace du club, il ne peut plus la rejoindre.
    v_status := 'recorded';
  ELSIF v_pass.contact_email IS NOT NULL AND v_pass.contact_email = v_email
        AND (SELECT count(*) FROM public.event_cohosts c
              WHERE c.event_id = v_pass.event_id AND c.status IN ('pending', 'accepted')) < 8 THEN
    -- Une invitation en attente pour ce club (posée par l'organisateur) est reprise.
    SELECT c.id INTO v_cohost FROM public.event_cohosts c
     WHERE c.event_id = v_pass.event_id AND c.venue_id = v_venue.id AND c.status = 'pending' LIMIT 1;
    IF v_cohost IS NULL THEN
      INSERT INTO public.event_cohosts (event_id, venue_id, access, share_crm, invited_by, invited_by_party, role)
      VALUES (v_pass.event_id, v_venue.id, 'viewer', false, v_pass.created_by, v_pass.created_by_party, 'cohost')
      RETURNING id INTO v_cohost;
    END IF;
    PERFORM public.respond_event_cohost_invitation(v_cohost, true);
    v_status := 'accepted';
  ELSE
    v_status := 'pending';
    PERFORM public.notify_coorg_party(v_pass.created_by_party, v_pass.event_id, 'host_pass_claimed',
      'Un club hôte a ouvert son compte',
      v_venue.name || ' a ouvert son compte Yuno depuis ta page « ' || v_pass.venue_name
        || ' ». Ajoute-le en partenaire de la soirée depuis la page Co-organisation.',
      v_pass.id, 'host_pass_claimed:' || v_pass.id::text, '{}'::jsonb);
  END IF;

  UPDATE public.event_host_passes
     SET claimed_venue_id = v_venue.id, claimed_by = v_uid,
         claimed_at = coalesce(claimed_at, now()), claim_status = v_status
   WHERE id = v_pass.id
   RETURNING * INTO v_pass;

  PERFORM public._host_pass_alert(v_pass, 'claimed', 'host_pass_claimed:' || v_pass.id::text);

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'event_id', v_pass.event_id, 'venue_id', v_venue.id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_event_host_pass(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_event_host_pass(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.event_host_passes_guard() FROM PUBLIC, anon, authenticated;
