-- Yuno CRM : Pages d'inscription (plan : docs/designs/CRM_SIGNUP_PAGES_PLAN.md).
--
-- Une page = un lien public `/j/<slug>` (+ `?src=` pour la provenance) où un fan
-- laisse son prénom et son e-mail AVANT d'acheter. Double confirmation : rien
-- n'entre au registre avant le clic sur le lien reçu par e-mail. À la
-- confirmation : preuve dans marketing_consent_events (texte EXACT affiché,
-- source signup_page:<id>), contact versé dans le groupe de la page
-- (imported_contacts) et dans newsletter_subscriptions, sans jamais réveiller un
-- désabonné. Une page d'une portée démo n'enregistre aucune adresse.
-- RLS sans policy : tout passe par les RPC ci-dessous.

CREATE TABLE IF NOT EXISTS public.crm_signup_pages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id           text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed')),
  occasion           text NOT NULL DEFAULT 'night' CHECK (occasion IN ('night', 'community')),
  event_id           uuid REFERENCES public.events(id) ON DELETE SET NULL,
  title              text NOT NULL DEFAULT '' CHECK (char_length(title) <= 40),
  tagline            text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 140),
  button_label       text NOT NULL DEFAULT '' CHECK (char_length(button_label) <= 30),
  thanks_message     text NOT NULL DEFAULT '' CHECK (char_length(thanks_message) <= 200),
  poster_url         text,
  theme              jsonb NOT NULL DEFAULT '{"bg":"#0A0A0A","accent":"#E3141B","font":"display"}'::jsonb,
  fields             jsonb NOT NULL DEFAULT '{"contact":"email","questions":[]}'::jsonb,
  show_count         boolean NOT NULL DEFAULT true,
  reward             jsonb,
  opens_at           timestamptz,
  sale_opens_at      timestamptz,
  closes_at          timestamptz,
  contact_import_id  uuid,
  email_import_id    uuid,
  published_at       timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS crm_signup_pages_scope_idx ON public.crm_signup_pages (venue_id, organizer_user_id);
ALTER TABLE public.crm_signup_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_signup_pages FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_signup_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid NOT NULL REFERENCES public.crm_signup_pages(id) ON DELETE CASCADE,
  first_name       text NOT NULL,
  email            text NOT NULL,
  phone            text,
  answers          jsonb NOT NULL DEFAULT '{}'::jsonb,
  src              text,
  lang             text NOT NULL DEFAULT 'fr',
  consent_text     text NOT NULL,
  visitor_hash     text,
  confirm_hash     text,
  confirm_sent_at  timestamptz,
  confirmed_at     timestamptz,
  subscribed       boolean,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_entries_email_uidx ON public.crm_signup_entries (page_id, lower(email));
CREATE INDEX IF NOT EXISTS crm_signup_entries_pending_idx ON public.crm_signup_entries (created_at) WHERE confirm_sent_at IS NULL;
ALTER TABLE public.crm_signup_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_signup_entries FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_signup_visits (
  id            bigserial PRIMARY KEY,
  page_id       uuid NOT NULL REFERENCES public.crm_signup_pages(id) ON DELETE CASCADE,
  day           date NOT NULL DEFAULT current_date,
  visitor_hash  text NOT NULL,
  src           text,
  at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, day, visitor_hash)
);
ALTER TABLE public.crm_signup_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_signup_visits FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_disposable_domains (domain text PRIMARY KEY);
ALTER TABLE public.crm_disposable_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_disposable_domains FROM anon, authenticated;
INSERT INTO public.crm_disposable_domains (domain) VALUES
('yopmail.com'),('yopmail.fr'),('yopmail.net'),('mailinator.com'),('guerrillamail.com'),('guerrillamail.net'),('sharklasers.com'),
('10minutemail.com'),('10minutemail.net'),('tempmail.com'),('temp-mail.org'),('tempmail.net'),('throwawaymail.com'),('trashmail.com'),
('trashmail.fr'),('getnada.com'),('nada.email'),('dispostable.com'),('maildrop.cc'),('mailnesia.com'),('mintemail.com'),('mohmal.com'),
('emailondeck.com'),('fakeinbox.com'),('spamgourmet.com'),('jetable.org'),('mail-temporaire.fr'),('mailcatch.com'),('moakt.com'),
('tempr.email'),('tmpmail.org'),('tmpmail.net'),('burnermail.io'),('inboxkitten.com'),('mail.tm'),('mailpoof.com'),('emailfake.com'),
('crazymailing.com'),('dropmail.me'),('spambox.us'),('cuvox.de'),('armyspy.com'),('dayrep.com'),('einrot.com'),('fleckens.hu'),
('gustr.com'),('jourrapide.com'),('rhyta.com'),('superrito.com'),('teleworm.us')
ON CONFLICT DO NOTHING;

-- ── Aides ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_signup_owner(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE(CASE WHEN p_venue_id IS NOT NULL
    THEN EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = auth.uid())
    ELSE p_organizer_user_id = auth.uid() END, false);
$$;
REVOKE ALL ON FUNCTION public._crm_signup_owner(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_owner(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_signup_is_demo(p_page public.crm_signup_pages)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_demo_marketing_scope(p_page.venue_id, p_page.organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public._crm_signup_is_demo(public.crm_signup_pages) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_is_demo(public.crm_signup_pages) TO service_role;

-- La page est-elle ouverte aux inscriptions maintenant ?
CREATE OR REPLACE FUNCTION public._crm_signup_open(p public.crm_signup_pages)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.status = 'live' AND (p.opens_at IS NULL OR p.opens_at <= now()) AND (p.closes_at IS NULL OR p.closes_at > now());
$$;

-- ── Console : liste, enregistrement, statut, chiffres, export ───────────────
CREATE OR REPLACE FUNCTION public.crm_signup_pages_list(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('at', now(), 'can_publish', public._crm_signup_owner(p_venue_id, p_organizer_user_id),
    'pages', COALESCE((SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'open', public._crm_signup_open(p),
        'visits', (SELECT count(*) FROM public.crm_signup_visits v WHERE v.page_id = p.id),
        'entries', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id),
        'confirmed', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id AND e.confirmed_at IS NOT NULL),
        'event', (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'ticket_url', e.external_ticket_url) FROM public.events e WHERE e.id = p.event_id))
      ORDER BY p.created_at DESC)
      FROM public.crm_signup_pages p
     WHERE p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_pages_list(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_pages_list(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_signup_page_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_patch jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_base text;
  v_slug text;
  k text;
  v_q jsonb;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('occasion', 'event_id', 'title', 'tagline', 'button_label', 'thanks_message', 'poster_url', 'theme', 'fields', 'show_count', 'reward', 'opens_at', 'sale_opens_at', 'closes_at') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- Champs : e-mail obligatoire (le SMS est hors périmètre), deux questions au plus, deux réponses au moins.
  IF p_patch ? 'fields' THEN
    IF COALESCE(p_patch->'fields'->>'contact', 'email') NOT IN ('email', 'email_phone') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) > 2 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) LOOP
      IF length(trim(COALESCE(v_q->>'label', ''))) = 0 OR jsonb_typeof(v_q->'options') <> 'array' OR jsonb_array_length(v_q->'options') < 2 OR jsonb_array_length(v_q->'options') > 8 THEN
        RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = (p_patch->>'event_id')::uuid
          AND (e.venue_id IS NOT DISTINCT FROM p_venue_id AND p_venue_id IS NOT NULL OR e.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id AND p_organizer_user_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'bad_event' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    v_base := COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(translate(COALESCE(p_patch->>'title', ''),
                'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', '-', 'g')), ''), 'page');
    v_base := left(v_base, 40);
    IF length(v_base) < 3 THEN v_base := v_base || '-page'; END IF;
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE slug = v_slug) LOOP
      v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
    END LOOP;
    INSERT INTO public.crm_signup_pages (venue_id, organizer_user_id, slug, created_by) VALUES (p_venue_id, p_organizer_user_id, v_slug, auth.uid()) RETURNING id INTO v_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE id = v_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_signup_pages SET
    occasion = CASE WHEN p_patch ? 'occasion' AND p_patch->>'occasion' IN ('night', 'community') THEN p_patch->>'occasion' ELSE occasion END,
    event_id = CASE WHEN p_patch ? 'event_id' THEN NULLIF(p_patch->>'event_id', '')::uuid ELSE event_id END,
    title = CASE WHEN p_patch ? 'title' THEN left(trim(p_patch->>'title'), 40) ELSE title END,
    tagline = CASE WHEN p_patch ? 'tagline' THEN left(trim(p_patch->>'tagline'), 140) ELSE tagline END,
    button_label = CASE WHEN p_patch ? 'button_label' THEN left(trim(p_patch->>'button_label'), 30) ELSE button_label END,
    thanks_message = CASE WHEN p_patch ? 'thanks_message' THEN left(trim(p_patch->>'thanks_message'), 200) ELSE thanks_message END,
    poster_url = CASE WHEN p_patch ? 'poster_url' THEN NULLIF(left(p_patch->>'poster_url', 600), '') ELSE poster_url END,
    theme = CASE WHEN p_patch ? 'theme' AND jsonb_typeof(p_patch->'theme') = 'object' THEN jsonb_build_object(
              'bg', CASE WHEN p_patch->'theme'->>'bg' ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'theme'->>'bg' ELSE '#0A0A0A' END,
              'accent', CASE WHEN p_patch->'theme'->>'accent' ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'theme'->>'accent' ELSE '#E3141B' END,
              'font', CASE WHEN p_patch->'theme'->>'font' IN ('display', 'serif', 'mono') THEN p_patch->'theme'->>'font' ELSE 'display' END) ELSE theme END,
    fields = CASE WHEN p_patch ? 'fields' THEN jsonb_build_object('contact', COALESCE(p_patch->'fields'->>'contact', 'email'),
              'questions', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', left(trim(q->>'label'), 60), 'multi', COALESCE((q->>'multi')::boolean, false),
                 'options', (SELECT jsonb_agg(left(trim(o), 40)) FROM jsonb_array_elements_text(q->'options') o)))
                 FROM jsonb_array_elements(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) q), '[]'::jsonb)) ELSE fields END,
    show_count = CASE WHEN p_patch ? 'show_count' THEN COALESCE((p_patch->>'show_count')::boolean, true) ELSE show_count END,
    reward = CASE WHEN p_patch ? 'reward' THEN CASE WHEN jsonb_typeof(p_patch->'reward') = 'object' AND length(trim(COALESCE(p_patch->'reward'->>'label', ''))) > 0
                THEN jsonb_build_object('label', left(trim(p_patch->'reward'->>'label'), 40), 'how', left(trim(COALESCE(p_patch->'reward'->>'how', '')), 140)) END ELSE reward END,
    opens_at = CASE WHEN p_patch ? 'opens_at' THEN NULLIF(p_patch->>'opens_at', '')::timestamptz ELSE opens_at END,
    sale_opens_at = CASE WHEN p_patch ? 'sale_opens_at' THEN NULLIF(p_patch->>'sale_opens_at', '')::timestamptz ELSE sale_opens_at END,
    closes_at = CASE WHEN p_patch ? 'closes_at' THEN NULLIF(p_patch->>'closes_at', '')::timestamptz ELSE closes_at END,
    updated_at = now()
   WHERE id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_save(text, uuid, uuid, jsonb) TO authenticated, service_role;

-- Publier / fermer / rouvrir : geste du TITULAIRE seul, jamais en accès assisté.
-- La première publication crée le groupe de contacts de la page (source
-- website_form, attesté par le titulaire) : ses inscrits confirmés y entrent.
CREATE OR REPLACE FUNCTION public.crm_signup_page_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_list uuid;
  v_email uuid;
  v_name text;
BEGIN
  IF p_status NOT IN ('live', 'closed', 'draft') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  IF NOT public._crm_signup_owner(p_venue_id, p_organizer_user_id) THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_status = 'live' THEN
    IF length(trim(p.title)) = 0 OR length(trim(p.button_label)) = 0 THEN RAISE EXCEPTION 'incomplete' USING ERRCODE = '22023'; END IF;
    IF p.closes_at IS NOT NULL AND p.closes_at <= now() THEN RAISE EXCEPTION 'closes_in_past' USING ERRCODE = '22023'; END IF;
    IF p.contact_import_id IS NULL THEN
      v_name := left('Page · ' || p.title, 60);
      INSERT INTO public.email_list_imports (venue_id, organizer_user_id, filename, consent_source, consent_details, attested_by, list_name)
      VALUES (p_venue_id, p_organizer_user_id, 'signup_page:' || p.id, 'website_form', 'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée et adresse confirmée par lien', auth.uid(), v_name)
      RETURNING id INTO v_email;
      INSERT INTO public.contact_list_imports (venue_id, organizer_user_id, email_import_id, list_name, filename, consent_source, consent_details, channels, attested_by)
      VALUES (p_venue_id, p_organizer_user_id, v_email, v_name, 'signup_page:' || p.id, 'website_form',
              'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée et adresse confirmée par lien', '{"sms": false, "email": true}'::jsonb, auth.uid())
      RETURNING id INTO v_list;
      UPDATE public.crm_signup_pages SET contact_import_id = v_list, email_import_id = v_email WHERE id = p.id;
    END IF;
  END IF;
  UPDATE public.crm_signup_pages SET status = p_status, updated_at = now(),
         published_at = CASE WHEN p_status = 'live' THEN COALESCE(published_at, now()) ELSE published_at END
   WHERE id = p.id;
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_set_status(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_set_status(text, uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_signup_page_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  -- Seul un brouillon sans inscrit se supprime : une page publiée garde ses preuves.
  DELETE FROM public.crm_signup_pages p WHERE p.id = p_id AND p.status = 'draft' AND p.published_at IS NULL
     AND p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND NOT EXISTS (SELECT 1 FROM public.crm_signup_entries e WHERE e.page_id = p.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_deletable' USING ERRCODE = '22023'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_delete(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_delete(text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_signup_page_stats(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'visits', (SELECT count(*) FROM public.crm_signup_visits WHERE page_id = p_id),
    'entries', (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p_id),
    'confirmed', (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p_id AND confirmed_at IS NOT NULL),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('src', s.src, 'visits', s.v, 'entries', s.e, 'confirmed', s.c) ORDER BY s.v DESC) FROM (
        SELECT COALESCE(x.src, 'direct') AS src, sum(x.v) AS v, sum(x.e) AS e, sum(x.c) AS c FROM (
          SELECT src, 1 AS v, 0 AS e, 0 AS c FROM public.crm_signup_visits WHERE page_id = p_id
          UNION ALL SELECT src, 0, 1, CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END FROM public.crm_signup_entries WHERE page_id = p_id) x
        GROUP BY COALESCE(x.src, 'direct')) s), '[]'::jsonb),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('d', d, 'n', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p_id AND e.created_at::date = d::date)) ORDER BY d)
               FROM generate_series((now() - interval '29 days')::date, now()::date, interval '1 day') d), '[]'::jsonb),
    'answers', COALESCE((SELECT jsonb_object_agg(k, v) FROM (
        SELECT q.key AS k, jsonb_object_agg(q.val, q.n) AS v FROM (
          SELECT a.key, x.val, count(*) AS n FROM public.crm_signup_entries e, jsonb_each(e.answers) a,
                 LATERAL (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.value) = 'array' THEN a.value ELSE jsonb_build_array(a.value) END) AS val) x
           WHERE e.page_id = p_id GROUP BY a.key, x.val) q GROUP BY q.key) z), '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_stats(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_stats(text, uuid, uuid) TO authenticated, service_role;

-- Export des inscrits CONFIRMÉS (jamais en accès assisté).
CREATE OR REPLACE FUNCTION public.crm_signup_page_export(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('first_name', e.first_name, 'email', e.email, 'phone', e.phone, 'answers', e.answers,
            'src', e.src, 'created_at', e.created_at, 'confirmed_at', e.confirmed_at) ORDER BY e.created_at)
      FROM public.crm_signup_entries e JOIN public.crm_signup_pages p ON p.id = e.page_id
     WHERE p.id = p_id AND p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND e.confirmed_at IS NOT NULL), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_export(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_export(text, uuid, uuid) TO authenticated, service_role;

-- ── Public ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_crm_signup_page(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.crm_signup_pages;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug) AND status IN ('live', 'closed');
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'occasion', p.occasion, 'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label,
    'thanks_message', p.thanks_message, 'poster_url', p.poster_url, 'theme', p.theme, 'fields', p.fields, 'reward', p.reward,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'closes_at', p.closes_at,
    'state', CASE WHEN p.status = 'closed' OR (p.closes_at IS NOT NULL AND p.closes_at <= now()) THEN 'closed'
                  WHEN p.opens_at IS NOT NULL AND p.opens_at > now() THEN 'soon' ELSE 'open' END,
    'count', CASE WHEN p.show_count THEN (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id) END,
    'demo', public._crm_signup_is_demo(p),
    'host', COALESCE((SELECT v.name FROM public.venues v WHERE v.id = p.venue_id),
                     (SELECT COALESCE(NULLIF(o.display_name, ''), 'Yuno') FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id)),
    'event', (SELECT jsonb_build_object('title', e.title, 'start_at', e.start_at, 'image_url', e.image_url,
                'ticket_url', COALESCE(e.external_ticket_url, CASE WHEN e.external_source IS NULL THEN 'https://yunoapp.eu/event/' || e.id END),
                'place', (SELECT v.name || COALESCE(' · ' || v.city, '') FROM public.venues v WHERE v.id = e.venue_id))
              FROM public.events e WHERE e.id = p.event_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_signup_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_signup_page(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.track_crm_signup_visit(p_slug text, p_src text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ctx record; v_id uuid;
BEGIN
  BEGIN
    SELECT id INTO v_id FROM public.crm_signup_pages WHERE slug = lower(p_slug) AND status = 'live';
    IF v_id IS NULL THEN RETURN; END IF;
    SELECT * INTO v_ctx FROM public.links_visitor_context();
    INSERT INTO public.crm_signup_visits (page_id, visitor_hash, src)
    VALUES (v_id, v_ctx.o_hash, CASE WHEN lower(p_src) ~ '^[a-z0-9_-]{1,30}$' THEN lower(p_src) END)
    ON CONFLICT (page_id, day, visitor_hash) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RETURN;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.track_crm_signup_visit(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_crm_signup_visit(text, text) TO anon, authenticated, service_role;

-- S'inscrire. Statuts : ok | already | closed | demo | invalid_email | disposable |
-- rate_limited | consent_required | invalid.
CREATE OR REPLACE FUNCTION public.submit_crm_signup(
  p_slug text, p_first_name text, p_email text, p_phone text DEFAULT NULL, p_answers jsonb DEFAULT '{}'::jsonb,
  p_consent boolean DEFAULT false, p_consent_text text DEFAULT NULL, p_lang text DEFAULT 'fr', p_src text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_ctx record;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_domain text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug);
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF NOT public._crm_signup_open(p) THEN RETURN 'closed'; END IF;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;
  IF NOT COALESCE(p_consent, false) OR length(trim(COALESCE(p_consent_text, ''))) < 10 THEN RETURN 'consent_required'; END IF;
  IF length(trim(COALESCE(p_first_name, ''))) = 0 THEN RETURN 'invalid'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN RETURN 'invalid_email'; END IF;
  v_domain := split_part(v_email, '@', 2);
  IF EXISTS (SELECT 1 FROM public.crm_disposable_domains WHERE domain = v_domain) THEN RETURN 'disposable'; END IF;
  IF public.is_demo_email(v_email) THEN RETURN 'demo'; END IF;
  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.crm_signup_entries WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p.id AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN 'rate_limited';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND lower(email) = v_email) THEN RETURN 'already'; END IF;
  INSERT INTO public.crm_signup_entries (page_id, first_name, email, phone, answers, src, lang, consent_text, visitor_hash)
  VALUES (p.id, left(trim(p_first_name), 60), v_email,
          CASE WHEN p.fields->>'contact' = 'email_phone' THEN NULLIF(left(regexp_replace(COALESCE(p_phone, ''), '[^0-9+ ]', '', 'g'), 24), '') END,
          CASE WHEN jsonb_typeof(p_answers) = 'object' AND length(p_answers::text) <= 2000 THEN p_answers ELSE '{}'::jsonb END,
          CASE WHEN lower(p_src) ~ '^[a-z0-9_-]{1,30}$' THEN lower(p_src) END,
          CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END,
          left(trim(p_consent_text), 600), v_ctx.o_hash)
  ON CONFLICT (page_id, lower(email)) DO NOTHING;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text) TO anon, authenticated, service_role;

-- La file des e-mails de confirmation : un jeton NEUF par envoi (seul son haché
-- est gardé), rendu en clair à l'edge qui l'envoie. Démo jamais servie.
CREATE OR REPLACE FUNCTION public.crm_signup_confirm_queue(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_tok text; v_out jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT e.id, e.email, e.first_name, e.lang, p.slug, p.title, p.thanks_message,
           COALESCE((SELECT v.name FROM public.venues v WHERE v.id = p.venue_id), (SELECT o.display_name FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id)) AS host
      FROM public.crm_signup_entries e JOIN public.crm_signup_pages p ON p.id = e.page_id
     WHERE e.confirm_sent_at IS NULL AND e.confirmed_at IS NULL AND e.created_at > now() - interval '3 days'
       AND NOT public._crm_signup_is_demo(p) AND NOT public.is_demo_email(e.email)
     ORDER BY e.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
     FOR UPDATE OF e SKIP LOCKED
  LOOP
    v_tok := encode(extensions.gen_random_bytes(24), 'hex');
    UPDATE public.crm_signup_entries SET confirm_hash = encode(sha256(convert_to(v_tok, 'UTF8')), 'hex'), confirm_sent_at = now() WHERE id = r.id;
    v_out := v_out || jsonb_build_object('id', r.id, 'email', r.email, 'first_name', r.first_name, 'lang', r.lang, 'slug', r.slug, 'title', r.title, 'host', r.host, 'token', v_tok);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_confirm_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_signup_confirm_queue(integer) TO service_role;

-- Un envoi raté rend la ligne à la file (nouveau jeton au prochain passage).
CREATE OR REPLACE FUNCTION public.crm_signup_confirm_failed(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.crm_signup_entries SET confirm_sent_at = NULL, confirm_hash = NULL WHERE id = p_id AND confirmed_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_confirm_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_signup_confirm_failed(uuid) TO service_role;

-- Confirmer par le lien : preuve, groupe de la page, registre (sans réveiller un désabonné).
CREATE OR REPLACE FUNCTION public.crm_signup_confirm(p_slug text, p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.crm_signup_entries;
  p public.crm_signup_pages;
  v_blocked boolean;
  v_sub boolean := false;
BEGIN
  IF length(COALESCE(p_token, '')) < 20 THEN RETURN 'invalid'; END IF;
  SELECT x.* INTO e FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
   WHERE pp.slug = lower(p_slug) AND x.confirm_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE OF x;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF e.confirmed_at IS NOT NULL THEN RETURN 'already'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = e.page_id;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;

  INSERT INTO public.marketing_consent_events (email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
  VALUES (e.email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', e.consent_text, e.lang, 'signup_page:' || p.id);

  IF p.contact_import_id IS NOT NULL THEN
    INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, email, phone_e164, first_name, newsletter_opt_in, added_at, extra)
    VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, e.email,
            CASE WHEN e.phone ~ '^\+[0-9]{8,15}$' THEN e.phone END, e.first_name, true, now(),
            jsonb_build_object('signup_page', p.id, 'src', e.src, 'answers', e.answers));
  END IF;

  -- Jamais réveiller un désabonné : désinscription explicite, liste repoussoir, adresse supprimée.
  v_blocked := public.is_email_suppressed(e.email)
    OR EXISTS (SELECT 1 FROM public.email_opt_outs o WHERE lower(o.email) = lower(e.email)
                AND o.venue_id IS NOT DISTINCT FROM p.venue_id AND o.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
    OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions n WHERE lower(n.email) = lower(e.email) AND NOT n.opted_in
                AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id);
  IF NOT v_blocked THEN
    IF p.venue_id IS NOT NULL THEN
      INSERT INTO public.newsletter_subscriptions (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name)
      VALUES (p.venue_id, e.email, true, 'signup_page', p.email_import_id, 'website_form', now(), e.first_name)
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO NOTHING;
    ELSE
      INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name)
      VALUES (p.organizer_user_id, e.email, true, 'signup_page', p.email_import_id, 'website_form', now(), e.first_name)
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    END IF;
    v_sub := true;
  END IF;
  UPDATE public.crm_signup_entries SET confirmed_at = now(), subscribed = v_sub WHERE id = e.id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_confirm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_signup_confirm(text, text) TO anon, authenticated, service_role;
