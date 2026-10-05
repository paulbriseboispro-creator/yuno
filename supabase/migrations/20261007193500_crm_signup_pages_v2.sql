-- ============================================================================
-- Yuno CRM — Pages d'inscription v2 : le système du design Claude Design
-- « Pages inscription » à l'identique, branché sur les vraies données.
--
-- Ce qui change par rapport à 20261005253000 :
--  1. Quatre TYPES de page (`kind`) : prévente, confirmation de venue, liste
--     d'attente, communauté. `occasion` (night | community) reste, déduite.
--  2. Le STYLE (`design`) : dix gabarits × palettes, couleurs personnalisées,
--     police des titres. `theme` n'est plus lu (gardé pour l'historique).
--  3. Les CHAMPS : contact au choix du fan / e-mail / téléphone / les deux,
--     nom, date de naissance, pseudo Instagram, ville (obligatoire ou non),
--     deux questions au plus (dont « Tu viens à combien ? », `party`).
--  4. La RÉCOMPENSE : prédéfinie (entrée prioritaire, boisson, prévente) ou
--     créée par le pro (texte, comment la récupérer, icône).
--  5. Les DATES : ouverture (tout de suite ou à une date), ouverture de la
--     vente + compte à rebours, fermeture (`closes_mode` : à l'ouverture de la
--     vente, la veille à 18:00, quand le pro ouvre les places, jamais, à une
--     date). La fermeture EFFECTIVE se lit par `_crm_signup_close_at`.
--  6. La RELANCE (`relance`) : trois messages au plus (« C'est ouvert » /
--     rappel / bienvenue, relance sans achat, dernier rappel), e-mail et SMS.
--     Le collecteur `crm_signup_relance_collect` (cron 5 min) remplit des
--     campagnes ENFANTS (`child_kind = 'signup'`, une par page et par étape,
--     `parent_campaign_id` = elle-même : cachée des listes, pas d'accusé
--     « campagne envoyée ») que `send-campaign` draine comme les autres ; les
--     Yunits partent par le déclencheur des campagnes enfants. Le registre
--     `crm_signup_sends` interdit tout doublon. Le SMS est noté mais ne part
--     pas tant que le moteur SMS du CRM n'est pas ouvert (`crm_sms_not_open`).
--  7. Une inscription peut ne porter qu'un TÉLÉPHONE (aucun lien de
--     confirmation possible) : la preuve de consentement est écrite tout de
--     suite (`marketing_consent_events`, canal sms), le numéro rejoint le
--     groupe de la page mais pas le registre SMS (fermé côté CRM).
--  8. Les CHIFFRES : nouveaux dans la base (figé à l'inscription,
--     `was_known`), devenus acheteurs (billets de la billetterie connectée
--     achetés APRÈS l'inscription, `_crm_tickets`), personnes attendues
--     (confirmation de venue), provenance par lien, inscriptions par jour.
-- RLS sans policy partout : tout passe par les fonctions ci-dessous.
-- ============================================================================

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────

ALTER TABLE public.crm_signup_pages
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'prevente',
  ADD COLUMN IF NOT EXISTS design      jsonb NOT NULL DEFAULT '{"tpl":"soiree","pal":"red","bg":"","acc":"","font":""}'::jsonb,
  ADD COLUMN IF NOT EXISTS countdown   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS closes_mode text NOT NULL DEFAULT 'date',
  ADD COLUMN IF NOT EXISTS relance     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS lang        text NOT NULL DEFAULT 'fr';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_pages_kind_chk') THEN
    ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_kind_chk CHECK (kind IN ('prevente', 'venue', 'attente', 'communaute'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_pages_closes_mode_chk') THEN
    ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_closes_mode_chk CHECK (closes_mode IN ('sale', 'eve', 'manual', 'never', 'date'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_pages_lang_chk') THEN
    ALTER TABLE public.crm_signup_pages ADD CONSTRAINT crm_signup_pages_lang_chk CHECK (lang IN ('en', 'fr', 'es'));
  END IF;
END $$;

-- Les pages d'avant (une seule en base au 05/10, un brouillon) prennent le nouveau modèle.
UPDATE public.crm_signup_pages SET
  kind = CASE WHEN occasion = 'community' THEN 'communaute' ELSE 'prevente' END,
  design = jsonb_build_object('tpl', 'soiree', 'pal', 'custom',
             'bg', COALESCE(NULLIF(theme->>'bg', ''), '#120C0E'), 'acc', COALESCE(NULLIF(theme->>'accent', ''), '#E3141B'),
             'font', CASE theme->>'font' WHEN 'serif' THEN 'serif' WHEN 'mono' THEN 'mono' ELSE '' END),
  closes_mode = CASE WHEN closes_at IS NULL THEN 'never' ELSE 'date' END,
  fields = jsonb_build_object('contact', CASE WHEN fields->>'contact' = 'email_phone' THEN 'all' ELSE 'email' END,
             'extra', '{}'::jsonb, 'questions', COALESCE(fields->'questions', '[]'::jsonb)),
  reward = CASE WHEN reward IS NULL THEN NULL ELSE jsonb_build_object('on', true, 'preset', 'custom',
             'label', COALESCE(reward->>'label', ''), 'how', COALESCE(reward->>'how', ''), 'icon', 'gift') END
 WHERE NOT (design ? 'migrated') AND created_at < '2026-10-07';

ALTER TABLE public.crm_signup_pages ALTER COLUMN fields SET DEFAULT '{"contact":"both","extra":{},"questions":[]}'::jsonb;

ALTER TABLE public.crm_signup_entries
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS birthdate  date,
  ADD COLUMN IF NOT EXISTS instagram  text,
  ADD COLUMN IF NOT EXISTS city       text,
  ADD COLUMN IF NOT EXISTS was_known  boolean,
  ADD COLUMN IF NOT EXISTS party_size smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_signup_entries_contact_chk') THEN
    ALTER TABLE public.crm_signup_entries ADD CONSTRAINT crm_signup_entries_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL);
  END IF;
END $$;
-- Une inscription par téléphone seul : un numéro par page.
CREATE UNIQUE INDEX IF NOT EXISTS crm_signup_entries_phone_uidx ON public.crm_signup_entries (page_id, phone) WHERE email IS NULL;
CREATE INDEX IF NOT EXISTS crm_signup_entries_page_idx ON public.crm_signup_entries (page_id, created_at DESC);

-- Registre des messages de relance : un message par inscription, par étape et par canal.
CREATE TABLE IF NOT EXISTS public.crm_signup_sends (
  id          bigserial PRIMARY KEY,
  page_id     uuid NOT NULL REFERENCES public.crm_signup_pages(id) ON DELETE CASCADE,
  entry_id    uuid NOT NULL REFERENCES public.crm_signup_entries(id) ON DELETE CASCADE,
  step        text NOT NULL CHECK (step IN ('open', 'nudge', 'last')),
  channel     text NOT NULL CHECK (channel IN ('email', 'sms')),
  campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, step, channel)
);
CREATE INDEX IF NOT EXISTS crm_signup_sends_page_idx ON public.crm_signup_sends (page_id, step);
ALTER TABLE public.crm_signup_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_signup_sends FROM anon, authenticated;

-- La campagne enfant de chaque (page, étape), remplie au fil des passages.
CREATE TABLE IF NOT EXISTS public.crm_signup_relance_campaigns (
  page_id     uuid NOT NULL REFERENCES public.crm_signup_pages(id) ON DELETE CASCADE,
  step        text NOT NULL CHECK (step IN ('open', 'nudge', 'last')),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, step)
);
ALTER TABLE public.crm_signup_relance_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_signup_relance_campaigns FROM anon, authenticated;

-- Les campagnes enfants des Pages d'inscription.
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_child_kind_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_child_kind_check
  CHECK (child_kind IS NULL OR child_kind IN ('followup', 'resend', 'automation', 'signup'));

-- ── 2. Aides ────────────────────────────────────────────────────────────────

-- La soirée d'une page : titre, dates, fuseau, lien des billets, affiche, lieu.
CREATE OR REPLACE FUNCTION public._crm_signup_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at,
           'end_at', COALESCE(e.end_at, e.start_at + interval '6 hours'),
           'tz', COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'),
           'ticket_url', COALESCE(e.external_ticket_url, CASE WHEN e.external_source IS NULL THEN 'https://yunoapp.eu/event/' || e.id END),
           'cover_url', COALESCE(e.poster_url, e.image_url, x.cover_url),
           'venue', COALESCE(NULLIF(e.location_name, ''), (SELECT v.name FROM public.venues v WHERE v.id = e.venue_id)),
           'city', COALESCE(x.city, e.location_city),
           'street', COALESCE(x.street, e.location_address),
           'country', x.country_code,
           'sold_out', COALESCE(e.tickets_sold_out, false) OR COALESCE(x.left_tickets = 0, false),
           'night_date', ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')::date)
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE e.id = p_event_id;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_event(uuid) TO service_role;

-- Un instant local d'une soirée : la date de sa nuit − N jours, à HH:MM (fuseau de la soirée).
CREATE OR REPLACE FUNCTION public._crm_signup_night_at(p_event_id uuid, p_days_before integer, p_time time)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ((((e.start_at AT TIME ZONE z.tz) - interval '8 hours')::date - p_days_before) + p_time) AT TIME ZONE z.tz
    FROM public.events e
   CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz) z
   WHERE e.id = p_event_id;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_night_at(uuid, integer, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_night_at(uuid, integer, time) TO service_role;

-- La fermeture EFFECTIVE d'une page (NULL = jamais d'elle-même).
CREATE OR REPLACE FUNCTION public._crm_signup_close_at(p public.crm_signup_pages)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p.closes_mode
    WHEN 'date' THEN p.closes_at
    WHEN 'sale' THEN p.sale_opens_at
    WHEN 'eve' THEN CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_night_at(p.event_id, 1, time '18:00') END
    WHEN 'manual' THEN CASE WHEN p.notified_at IS NOT NULL THEN p.notified_at END
    ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_close_at(public.crm_signup_pages) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_close_at(public.crm_signup_pages) TO service_role;

-- La page est-elle ouverte aux inscriptions maintenant ?
CREATE OR REPLACE FUNCTION public._crm_signup_open(p public.crm_signup_pages)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.status = 'live' AND (p.opens_at IS NULL OR p.opens_at <= now())
     AND (public._crm_signup_close_at(p) IS NULL OR public._crm_signup_close_at(p) > now());
$$;
REVOKE ALL ON FUNCTION public._crm_signup_open(public.crm_signup_pages) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_open(public.crm_signup_pages) TO service_role;

-- draft | scheduled | open | closed (le statut que la Console affiche).
CREATE OR REPLACE FUNCTION public._crm_signup_state(p public.crm_signup_pages)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.status = 'draft' THEN 'draft'
    WHEN p.status = 'closed' THEN 'closed'
    WHEN public._crm_signup_close_at(p) IS NOT NULL AND public._crm_signup_close_at(p) <= now() THEN 'closed'
    WHEN p.opens_at IS NOT NULL AND p.opens_at > now() THEN 'scheduled'
    ELSE 'open' END;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_state(public.crm_signup_pages) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_state(public.crm_signup_pages) TO service_role;

-- Une vente existe-t-elle (acheteurs mesurables) ? Prévente : une fois la
-- vente ouverte ; liste d'attente et communauté : toujours ; venue : jamais.
CREATE OR REPLACE FUNCTION public._crm_signup_sale_open(p public.crm_signup_pages)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE p.kind
    WHEN 'prevente' THEN p.sale_opens_at IS NOT NULL AND p.sale_opens_at <= now()
    WHEN 'venue' THEN false
    ELSE true END;
$$;

-- Les inscriptions devenues acheteuses : un billet de la billetterie connectée
-- (la soirée de la page ; toute soirée de la portée pour la communauté),
-- acheté APRÈS l'inscription, par la même adresse.
CREATE OR REPLACE FUNCTION public._crm_signup_buyer_ids(p_page_id uuid)
RETURNS TABLE(entry_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT e.id
    FROM public.crm_signup_pages p
    JOIN public.crm_signup_entries e ON e.page_id = p.id AND e.email IS NOT NULL
    JOIN public.external_tickets t
      ON t.buyer_email = lower(e.email)
     AND ((p.venue_id IS NOT NULL AND t.venue_id = p.venue_id) OR (p.organizer_user_id IS NOT NULL AND t.organizer_user_id = p.organizer_user_id))
     AND public._crm_ticket_is_sale(t.status, t.raw)
     AND COALESCE(t.purchased_at, t.first_seen_at) >= e.created_at
     AND (p.event_id IS NULL OR t.event_id = p.event_id)
   WHERE p.id = p_page_id;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_buyer_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_buyer_ids(uuid) TO service_role;

-- Le fan était-il déjà connu de la portée (acheteur, contact, abonné, inscrit d'une autre page) ?
CREATE OR REPLACE FUNCTION public._crm_signup_known(p public.crm_signup_pages, p_email text, p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (p_email IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.external_tickets t
                     WHERE t.buyer_email = p_email AND public._crm_ticket_is_sale(t.status, t.raw)
                       AND ((p.venue_id IS NOT NULL AND t.venue_id = p.venue_id) OR (p.organizer_user_id IS NOT NULL AND t.organizer_user_id = p.organizer_user_id)))
         OR EXISTS (SELECT 1 FROM public.imported_contacts c
                     WHERE c.email = p_email AND c.venue_id IS NOT DISTINCT FROM p.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
         OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions n
                     WHERE lower(n.email) = p_email AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
         OR EXISTS (SELECT 1 FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
                     WHERE lower(x.email) = p_email AND pp.id <> p.id
                       AND pp.venue_id IS NOT DISTINCT FROM p.venue_id AND pp.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)))
      OR (p_phone IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.imported_contacts c
                     WHERE c.phone_e164 = p_phone AND c.venue_id IS NOT DISTINCT FROM p.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
         OR EXISTS (SELECT 1 FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
                     WHERE x.phone = p_phone AND pp.id <> p.id
                       AND pp.venue_id IS NOT DISTINCT FROM p.venue_id AND pp.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)));
$$;
REVOKE ALL ON FUNCTION public._crm_signup_known(public.crm_signup_pages, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_known(public.crm_signup_pages, text, text) TO service_role;

-- Le groupe de contacts de la page (créé à la 1re publication), ou NULL.
CREATE OR REPLACE FUNCTION public._crm_signup_ensure_group(p_id uuid, p_actor uuid)
RETURNS uuid
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
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p.contact_import_id IS NOT NULL THEN RETURN p.contact_import_id; END IF;
  v_name := left('Page · ' || p.title, 60);
  INSERT INTO public.email_list_imports (venue_id, organizer_user_id, filename, consent_source, consent_details, attested_by, list_name)
  VALUES (p.venue_id, p.organizer_user_id, 'signup_page:' || p.id, 'website_form',
          'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée et adresse confirmée par lien', p_actor, v_name)
  RETURNING id INTO v_email;
  INSERT INTO public.contact_list_imports (venue_id, organizer_user_id, email_import_id, list_name, filename, consent_source, consent_details, channels, attested_by)
  VALUES (p.venue_id, p.organizer_user_id, v_email, v_name, 'signup_page:' || p.id, 'website_form',
          'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée (adresse confirmée par lien, téléphone saisi par le fan)', '{"sms": false, "email": true}'::jsonb, p_actor)
  RETURNING id INTO v_list;
  UPDATE public.crm_signup_pages SET contact_import_id = v_list, email_import_id = v_email WHERE id = p.id;
  RETURN v_list;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_signup_ensure_group(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_signup_ensure_group(uuid, uuid) TO service_role;

-- ── 3. Console : liste ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_signup_pages_list(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'at', now(),
    'can_publish', public._crm_signup_owner(p_venue_id, p_organizer_user_id),
    'balance', public.crm_yunits_balance(public.crm_scope_key(p_venue_id, p_organizer_user_id)),
    'pages', COALESCE((SELECT jsonb_agg(
        (to_jsonb(p) - 'created_by' - 'contact_import_id' - 'email_import_id' - 'venue_id' - 'organizer_user_id' - 'relance')
        || jsonb_build_object(
          -- La relance sans le contenu des e-mails (recomposé par la Console à chaque enregistrement).
          'relance', COALESCE((SELECT jsonb_object_agg(j.k, j.v - 'email_blocks' - 'email_theme' - 'email_logo') FROM jsonb_each(p.relance) AS j(k, v)), '{}'::jsonb),
          'state', public._crm_signup_state(p),
          'open', public._crm_signup_open(p),
          'close_at', public._crm_signup_close_at(p),
          'sale_open', public._crm_signup_sale_open(p),
          'visits', COALESCE(v.visits, 0), 'today_v', COALESCE(v.today_v, 0),
          'n', COALESCE(s.n, 0), 'today_n', COALESCE(s.today_n, 0), 'fresh', COALESCE(s.fresh, 0),
          'confirmed', COALESCE(s.confirmed, 0), 'email_n', COALESCE(s.email_n, 0), 'sms_n', COALESCE(s.sms_n, 0),
          'persons', CASE WHEN p.kind = 'venue' THEN COALESCE(s.persons, 0) END,
          'buyers', CASE WHEN public._crm_signup_sale_open(p) THEN (SELECT count(*) FROM public._crm_signup_buyer_ids(p.id)) END,
          'event', public._crm_signup_event(p.event_id))
        ORDER BY p.created_at DESC)
      FROM public.crm_signup_pages p
      LEFT JOIN LATERAL (
        SELECT count(*) AS visits, count(*) FILTER (WHERE x.day = v_today) AS today_v
          FROM public.crm_signup_visits x WHERE x.page_id = p.id) v ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS n,
               count(*) FILTER (WHERE (e.created_at AT TIME ZONE 'Europe/Paris')::date = v_today) AS today_n,
               count(*) FILTER (WHERE e.was_known IS FALSE) AS fresh,
               count(*) FILTER (WHERE e.confirmed_at IS NOT NULL) AS confirmed,
               count(*) FILTER (WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)) AS email_n,
               count(*) FILTER (WHERE e.phone IS NOT NULL) AS sms_n,
               sum(COALESCE(e.party_size, 1)) AS persons
          FROM public.crm_signup_entries e WHERE e.page_id = p.id) s ON true
     WHERE p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_pages_list(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_pages_list(text, uuid) TO authenticated, service_role;

-- ── 4. Console : enregistrement ─────────────────────────────────────────────

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
  v_o text;
  v_f jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_rel jsonb := '{}'::jsonb;
  v_step jsonb;
  v_kind text;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('kind', 'event_id', 'title', 'tagline', 'button_label', 'thanks_message', 'poster_url', 'design', 'fields', 'show_count',
                 'reward', 'opens_at', 'sale_opens_at', 'closes_mode', 'closes_at', 'countdown', 'relance', 'lang',
                 'occasion', 'theme') THEN
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_patch ? 'kind' AND p_patch->>'kind' NOT IN ('prevente', 'venue', 'attente', 'communaute') THEN RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'closes_mode' AND p_patch->>'closes_mode' NOT IN ('sale', 'eve', 'manual', 'never', 'date') THEN RAISE EXCEPTION 'bad_dates' USING ERRCODE = '22023'; END IF;

  -- Champs : contact, champs en plus (obligatoires ou non), deux questions au plus (2 à 6 réponses).
  IF p_patch ? 'fields' THEN
    v_f := p_patch->'fields';
    IF jsonb_typeof(v_f) <> 'object' OR COALESCE(v_f->>'contact', 'both') NOT IN ('both', 'email', 'phone', 'all') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(COALESCE(v_f->'extra', '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(COALESCE(v_f->'extra', '{}'::jsonb)) LOOP
      IF k NOT IN ('nom', 'naissance', 'insta', 'ville') THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
      IF COALESCE((v_f->'extra'->k->>'on')::boolean, false) THEN
        v_extra := v_extra || jsonb_build_object(k, jsonb_build_object('on', true, 'req', COALESCE((v_f->'extra'->k->>'req')::boolean, false)));
      END IF;
    END LOOP;
    IF jsonb_typeof(COALESCE(v_f->'questions', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(v_f->'questions', '[]'::jsonb)) > 2 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(v_f->'questions', '[]'::jsonb)) LOOP
      IF length(trim(COALESCE(v_q->>'label', ''))) = 0 OR length(v_q->>'label') > 60 OR jsonb_typeof(v_q->'options') <> 'array'
         OR jsonb_array_length(v_q->'options') < 2 OR jsonb_array_length(v_q->'options') > 6 THEN
        RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023';
      END IF;
      FOR v_o IN SELECT jsonb_array_elements_text(v_q->'options') LOOP
        IF length(trim(v_o)) = 0 OR length(v_o) > 40 THEN RAISE EXCEPTION 'bad_fields' USING ERRCODE = '22023'; END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF p_patch ? 'event_id' AND NULLIF(p_patch->>'event_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = (p_patch->>'event_id')::uuid
          AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
    RAISE EXCEPTION 'bad_event' USING ERRCODE = '22023';
  END IF;

  -- Relance : trois étapes au plus, le contenu de l'e-mail composé par la Console.
  IF p_patch ? 'relance' THEN
    IF jsonb_typeof(p_patch->'relance') <> 'object' THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(p_patch->'relance') LOOP
      IF k NOT IN ('open', 'nudge', 'last') THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
      v_step := p_patch->'relance'->k;
      IF jsonb_typeof(v_step) <> 'object' THEN RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023'; END IF;
      IF length(COALESCE(v_step->>'msg', '')) > 480 OR length(COALESCE(v_step->>'subject', '')) > 150
         OR (v_step ? 'email_blocks' AND (jsonb_typeof(v_step->'email_blocks') <> 'array' OR length((v_step->'email_blocks')::text) > 40000))
         OR (v_step ? 'delay' AND COALESCE(v_step->>'delay', '') NOT IN ('', '24h', '48h', '3d', '2d', '1d', '0d'))
         OR (NULLIF(v_step->>'cta_url', '') IS NOT NULL AND v_step->>'cta_url' !~ '^https?://' ) THEN
        RAISE EXCEPTION 'bad_relance' USING ERRCODE = '22023';
      END IF;
      v_rel := v_rel || jsonb_build_object(k, jsonb_build_object(
        'on', COALESCE((v_step->>'on')::boolean, false), 'email', COALESCE((v_step->>'email')::boolean, false),
        'sms', COALESCE((v_step->>'sms')::boolean, false), 'delay', COALESCE(v_step->>'delay', ''),
        'msg', COALESCE(v_step->>'msg', ''), 'subject', left(COALESCE(v_step->>'subject', ''), 150),
        'preheader', left(COALESCE(v_step->>'preheader', ''), 200),
        'email_blocks', COALESCE(v_step->'email_blocks', '[]'::jsonb), 'email_theme', COALESCE(v_step->'email_theme', '{}'::jsonb),
        'email_logo', NULLIF(left(COALESCE(v_step->>'email_logo', ''), 600), ''), 'cta_url', NULLIF(left(COALESCE(v_step->>'cta_url', ''), 600), '')));
    END LOOP;
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
    INSERT INTO public.crm_signup_pages (venue_id, organizer_user_id, slug, created_by, design)
    VALUES (p_venue_id, p_organizer_user_id, v_slug, auth.uid(), '{"tpl":"soiree","pal":"red","bg":"","acc":"","font":"","migrated":true}'::jsonb)
    RETURNING id INTO v_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.crm_signup_pages WHERE id = v_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_signup_pages SET
    kind = CASE WHEN p_patch ? 'kind' THEN p_patch->>'kind'
                WHEN p_patch ? 'occasion' AND p_patch->>'occasion' = 'community' THEN 'communaute' ELSE kind END,
    event_id = CASE WHEN p_patch ? 'event_id' THEN NULLIF(p_patch->>'event_id', '')::uuid ELSE event_id END,
    title = CASE WHEN p_patch ? 'title' THEN left(trim(p_patch->>'title'), 40) ELSE title END,
    tagline = CASE WHEN p_patch ? 'tagline' THEN left(trim(p_patch->>'tagline'), 140) ELSE tagline END,
    button_label = CASE WHEN p_patch ? 'button_label' THEN left(trim(p_patch->>'button_label'), 30) ELSE button_label END,
    thanks_message = CASE WHEN p_patch ? 'thanks_message' THEN left(trim(p_patch->>'thanks_message'), 200) ELSE thanks_message END,
    poster_url = CASE WHEN p_patch ? 'poster_url' THEN CASE WHEN COALESCE(p_patch->>'poster_url', '') ~ '^https://' THEN left(p_patch->>'poster_url', 600) END ELSE poster_url END,
    design = CASE WHEN p_patch ? 'design' AND jsonb_typeof(p_patch->'design') = 'object' THEN jsonb_build_object(
              'tpl', CASE WHEN p_patch->'design'->>'tpl' IN ('soiree', 'affiche', 'brutal', 'edito', 'ticket', 'affichage', 'verre', 'epure', 'flyer', 'terminal') THEN p_patch->'design'->>'tpl' ELSE 'soiree' END,
              'pal', CASE WHEN COALESCE(p_patch->'design'->>'pal', '') ~ '^(custom|red|lime|ice|rose|bone|p[0-4])$' THEN p_patch->'design'->>'pal' ELSE 'red' END,
              'bg', CASE WHEN COALESCE(p_patch->'design'->>'bg', '') ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'design'->>'bg' ELSE '' END,
              'acc', CASE WHEN COALESCE(p_patch->'design'->>'acc', '') ~ '^#[0-9A-Fa-f]{6}$' THEN p_patch->'design'->>'acc' ELSE '' END,
              'font', CASE WHEN p_patch->'design'->>'font' IN ('brico', 'anton', 'serif', 'space', 'black', 'mono') THEN p_patch->'design'->>'font' ELSE '' END,
              'migrated', true) ELSE design END,
    fields = CASE WHEN p_patch ? 'fields' THEN jsonb_build_object(
              'contact', COALESCE(p_patch->'fields'->>'contact', 'both'),
              'extra', v_extra,
              'questions', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'label', left(trim(q->>'label'), 60),
                   'multi', COALESCE((q->>'multi')::boolean, false),
                   'party', CASE WHEN COALESCE((q->>'party')::boolean, false) THEN true END,
                   'options', (SELECT jsonb_agg(left(trim(o), 40)) FROM jsonb_array_elements_text(q->'options') o))))
                 FROM jsonb_array_elements(COALESCE(p_patch->'fields'->'questions', '[]'::jsonb)) q), '[]'::jsonb)) ELSE fields END,
    show_count = CASE WHEN p_patch ? 'show_count' THEN COALESCE((p_patch->>'show_count')::boolean, false) ELSE show_count END,
    reward = CASE WHEN p_patch ? 'reward' THEN CASE WHEN jsonb_typeof(p_patch->'reward') = 'object' THEN jsonb_build_object(
                'on', COALESCE((p_patch->'reward'->>'on')::boolean, false),
                'preset', CASE WHEN p_patch->'reward'->>'preset' IN ('prio', 'drink', 'pre', 'custom') THEN p_patch->'reward'->>'preset' ELSE 'drink' END,
                'label', left(trim(COALESCE(p_patch->'reward'->>'label', '')), 40),
                'how', left(trim(COALESCE(p_patch->'reward'->>'how', '')), 70),
                'icon', CASE WHEN p_patch->'reward'->>'icon' IN ('gift', 'ticket', 'bolt', 'users', 'clock') THEN p_patch->'reward'->>'icon' ELSE 'gift' END) END ELSE reward END,
    opens_at = CASE WHEN p_patch ? 'opens_at' THEN NULLIF(p_patch->>'opens_at', '')::timestamptz ELSE opens_at END,
    sale_opens_at = CASE WHEN p_patch ? 'sale_opens_at' THEN NULLIF(p_patch->>'sale_opens_at', '')::timestamptz ELSE sale_opens_at END,
    closes_mode = CASE WHEN p_patch ? 'closes_mode' THEN p_patch->>'closes_mode' ELSE closes_mode END,
    closes_at = CASE WHEN p_patch ? 'closes_at' THEN NULLIF(p_patch->>'closes_at', '')::timestamptz ELSE closes_at END,
    countdown = CASE WHEN p_patch ? 'countdown' THEN COALESCE((p_patch->>'countdown')::boolean, true) ELSE countdown END,
    relance = CASE WHEN p_patch ? 'relance' THEN v_rel ELSE relance END,
    lang = CASE WHEN p_patch->>'lang' IN ('en', 'fr', 'es') THEN p_patch->>'lang' ELSE lang END,
    updated_at = now()
   WHERE id = v_id
   RETURNING kind INTO v_kind;
  UPDATE public.crm_signup_pages SET occasion = CASE WHEN v_kind = 'communaute' THEN 'community' ELSE 'night' END WHERE id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_save(text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_save(text, uuid, uuid, jsonb) TO authenticated, service_role;

-- ── 5. Console : publier, fermer, rouvrir, ouvrir maintenant ────────────────
-- Geste du TITULAIRE seul, jamais en accès assisté. `live` sur une page déjà
-- fermée par ses dates la rouvre pour de bon (fermeture « jamais ») ; `open`
-- ouvre maintenant une page programmée.
CREATE OR REPLACE FUNCTION public.crm_signup_page_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_close timestamptz;
BEGIN
  IF p_status NOT IN ('live', 'closed', 'draft', 'open') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  IF NOT public._crm_signup_owner(p_venue_id, p_organizer_user_id) THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_status IN ('live', 'open') THEN
    IF length(trim(p.title)) = 0 OR length(trim(p.button_label)) = 0 THEN RAISE EXCEPTION 'incomplete' USING ERRCODE = '22023'; END IF;
    v_close := public._crm_signup_close_at(p);
    IF p.status = 'draft' AND v_close IS NOT NULL AND v_close <= now() THEN RAISE EXCEPTION 'closes_in_past' USING ERRCODE = '22023'; END IF;
    PERFORM public._crm_signup_ensure_group(p.id, auth.uid());
    UPDATE public.crm_signup_pages SET
      status = 'live',
      published_at = COALESCE(published_at, now()),
      opens_at = CASE WHEN p_status = 'open' OR (p.status = 'closed' AND opens_at > now()) THEN now() ELSE opens_at END,
      -- Rouvrir une page fermée par ses dates : elle reste ouverte jusqu'à ce qu'on la ferme.
      closes_mode = CASE WHEN p.status <> 'draft' AND v_close IS NOT NULL AND v_close <= now() THEN 'never' ELSE closes_mode END,
      updated_at = now()
     WHERE id = p.id;
    RETURN 'live';
  END IF;
  UPDATE public.crm_signup_pages SET status = p_status, updated_at = now() WHERE id = p.id;
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_set_status(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_set_status(text, uuid, uuid, text) TO authenticated, service_role;

-- ── 6. Console : la fiche d'une page (Résultats, Inscrits, Relance) ─────────

CREATE OR REPLACE FUNCTION public.crm_signup_page_detail(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_from date;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  -- Inscriptions par jour : depuis l'ouverture, quatorze jours au plus.
  v_from := GREATEST((COALESCE(p.published_at, p.created_at) AT TIME ZONE 'Europe/Paris')::date, v_today - 13);

  RETURN jsonb_build_object(
    'series', CASE WHEN p.status = 'draft' THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object('d', d::date, 'n',
                 (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id AND (e.created_at AT TIME ZONE 'Europe/Paris')::date = d::date)) ORDER BY d)
          FROM generate_series(v_from, v_today, interval '1 day') d), '[]'::jsonb) END,
    'sources', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('src', z.src, 'v', z.v, 'n', z.n) ORDER BY z.n DESC)
          FROM (SELECT CASE WHEN x.src IN ('story', 'dm', 'flyer', 'bar', 'door', 'share') THEN x.src ELSE 'direct' END AS src,
                       sum(x.v)::int AS v, sum(x.n)::int AS n
                  FROM (SELECT src, 1 AS v, 0 AS n FROM public.crm_signup_visits WHERE page_id = p.id
                        UNION ALL SELECT src, 0, 1 FROM public.crm_signup_entries WHERE page_id = p.id) x
                 GROUP BY 1) z), '[]'::jsonb),
    'ig_auto', (SELECT count(*) FROM public.crm_instagram_events ie JOIN public.crm_instagram_rules r ON r.id = ie.rule_id
                 WHERE r.signup_page_id = p.id AND ie.kind = 'signup' AND ie.at >= now() - interval '30 days'),
    'people', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'first_name', e.first_name, 'last_name', e.last_name, 'email', e.email, 'phone', e.phone,
                 'answers', e.answers, 'party', e.party_size, 'src', e.src, 'at', e.created_at,
                 'confirmed', e.confirmed_at IS NOT NULL OR e.email IS NULL,
                 'status', CASE WHEN b.entry_id IS NOT NULL THEN 'bought' WHEN e.was_known THEN 'client' ELSE 'new' END)
               ORDER BY e.created_at DESC)
          FROM (SELECT * FROM public.crm_signup_entries WHERE page_id = p.id ORDER BY created_at DESC LIMIT 9) e
          LEFT JOIN public._crm_signup_buyer_ids(p.id) b ON b.entry_id = e.id), '[]'::jsonb),
    'reach', jsonb_build_object(
        'all_email', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id AND e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)),
        'all_sms', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id AND e.phone IS NOT NULL),
        'nobuy_email', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id AND e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)
                          AND e.id NOT IN (SELECT entry_id FROM public._crm_signup_buyer_ids(p.id))),
        'nobuy_sms', (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id AND e.phone IS NOT NULL
                        AND e.id NOT IN (SELECT entry_id FROM public._crm_signup_buyer_ids(p.id)))),
    'sent', (SELECT jsonb_object_agg(z.step, z.k) FROM (SELECT step, count(*) AS k FROM public.crm_signup_sends WHERE page_id = p.id GROUP BY step) z),
    'group_list_id', p.contact_import_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_detail(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_detail(text, uuid, uuid) TO authenticated, service_role;

-- Les adresses joignables d'une page (« Écrire à ce groupe ») : confirmées et abonnées.
CREATE OR REPLACE FUNCTION public.crm_signup_page_emails(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(DISTINCT lower(e.email))
      FROM public.crm_signup_entries e JOIN public.crm_signup_pages p ON p.id = e.page_id
     WHERE p.id = p_id AND p.venue_id IS NOT DISTINCT FROM p_venue_id AND p.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_emails(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_emails(text, uuid, uuid) TO authenticated, service_role;

-- « Prévenir » (liste d'attente) : le message « C'est ouvert » part à tous les
-- inscrits au prochain passage du collecteur ; une page fermée « quand j'ouvre
-- les places » se ferme. Une fois.
CREATE OR REPLACE FUNCTION public.crm_signup_page_notify_now(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.crm_signup_pages WHERE id = p_id AND venue_id IS NOT DISTINCT FROM p_venue_id AND organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF p.kind <> 'attente' THEN RAISE EXCEPTION 'not_attente' USING ERRCODE = '22023'; END IF;
  IF p.notified_at IS NOT NULL THEN RAISE EXCEPTION 'already_notified' USING ERRCODE = '22023'; END IF;
  IF p.status = 'draft' THEN RAISE EXCEPTION 'incomplete' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_signup_pages SET notified_at = now(), updated_at = now() WHERE id = p.id;
  RETURN now();
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_page_notify_now(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_signup_page_notify_now(text, uuid, uuid) TO authenticated, service_role;

-- ── 7. Public : la page du fan ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_crm_signup_page(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_state text;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug) AND status IN ('live', 'closed');
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_state := public._crm_signup_state(p);
  RETURN jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'occasion', p.occasion, 'theme', p.theme, 'title', p.title, 'tagline', p.tagline, 'button_label', p.button_label,
    'thanks_message', p.thanks_message, 'poster_url', p.poster_url, 'design', p.design, 'fields', p.fields, 'reward', p.reward,
    'opens_at', p.opens_at, 'sale_opens_at', p.sale_opens_at, 'countdown', p.countdown, 'close_at', public._crm_signup_close_at(p),
    'state', CASE v_state WHEN 'scheduled' THEN 'soon' WHEN 'closed' THEN 'closed' ELSE 'open' END,
    'count', CASE WHEN p.show_count THEN (SELECT count(*) FROM public.crm_signup_entries e WHERE e.page_id = p.id) END,
    'demo', public._crm_signup_is_demo(p),
    'host', COALESCE((SELECT v.name FROM public.venues v WHERE v.id = p.venue_id),
                     (SELECT COALESCE(NULLIF(o.display_name, ''), 'Yuno') FROM public.organizer_profiles o WHERE o.user_id = p.organizer_user_id)),
    'event', public._crm_signup_event(p.event_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_signup_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_signup_page(text) TO anon, authenticated, service_role;

-- S'inscrire. Statuts : ok | already | closed | demo | invalid_email |
-- invalid_phone | disposable | rate_limited | consent_required | invalid.
DROP FUNCTION IF EXISTS public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text);
CREATE OR REPLACE FUNCTION public.submit_crm_signup(
  p_slug text, p_first_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_answers jsonb DEFAULT '{}'::jsonb,
  p_consent boolean DEFAULT false, p_consent_text text DEFAULT NULL, p_lang text DEFAULT 'fr', p_src text DEFAULT NULL,
  p_last_name text DEFAULT NULL, p_birthdate text DEFAULT NULL, p_instagram text DEFAULT NULL, p_city text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_ctx record;
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_contact text;
  v_domain text;
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' AND length(p_answers::text) <= 2000 THEN p_answers ELSE '{}'::jsonb END;
  v_party smallint;
  v_birth date;
  v_party_q text;
  v_id uuid;
  x text;
  v_lang text := CASE WHEN p_lang IN ('fr', 'en', 'es') THEN p_lang ELSE 'fr' END;
BEGIN
  SELECT * INTO p FROM public.crm_signup_pages WHERE slug = lower(p_slug);
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF NOT public._crm_signup_open(p) THEN RETURN 'closed'; END IF;
  IF public._crm_signup_is_demo(p) THEN RETURN 'demo'; END IF;
  IF NOT COALESCE(p_consent, false) OR length(trim(COALESCE(p_consent_text, ''))) < 10 THEN RETURN 'consent_required'; END IF;
  IF length(trim(COALESCE(p_first_name, ''))) = 0 THEN RETURN 'invalid'; END IF;

  -- Le contact demandé par la page.
  v_contact := COALESCE(p.fields->>'contact', 'both');
  IF v_contact = 'email' THEN v_phone := NULL; END IF;
  IF v_contact = 'phone' THEN v_email := NULL; END IF;
  IF v_contact IN ('email', 'all') AND v_email IS NULL THEN RETURN 'invalid_email'; END IF;
  IF v_contact IN ('phone', 'all') AND v_phone IS NULL THEN RETURN 'invalid_phone'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RETURN 'invalid'; END IF;
  IF v_email IS NOT NULL THEN
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN RETURN 'invalid_email'; END IF;
    v_domain := split_part(v_email, '@', 2);
    IF EXISTS (SELECT 1 FROM public.crm_disposable_domains WHERE domain = v_domain) THEN RETURN 'disposable'; END IF;
    IF public.is_demo_email(v_email) THEN RETURN 'demo'; END IF;
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RETURN 'invalid_phone'; END IF;

  -- Champs obligatoires de la page.
  FOR x IN SELECT k FROM jsonb_each(COALESCE(p.fields->'extra', '{}'::jsonb)) AS j(k, v) WHERE COALESCE((v->>'req')::boolean, false) LOOP
    IF (x = 'nom' AND length(trim(COALESCE(p_last_name, ''))) = 0) OR (x = 'naissance' AND length(trim(COALESCE(p_birthdate, ''))) = 0)
       OR (x = 'insta' AND length(trim(COALESCE(p_instagram, ''))) = 0) OR (x = 'ville' AND length(trim(COALESCE(p_city, ''))) = 0) THEN
      RETURN 'invalid';
    END IF;
  END LOOP;
  BEGIN
    v_birth := NULLIF(trim(COALESCE(p_birthdate, '')), '')::date;
    IF v_birth IS NOT NULL AND (v_birth < date '1900-01-01' OR v_birth > current_date) THEN v_birth := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN v_birth := NULL;
  END;
  -- « Tu viens à combien ? » : la taille du groupe (« 4+ » → 4).
  SELECT q->>'label' INTO v_party_q FROM jsonb_array_elements(COALESCE(p.fields->'questions', '[]'::jsonb)) q WHERE COALESCE((q->>'party')::boolean, false) LIMIT 1;
  IF v_party_q IS NOT NULL AND v_answers ? v_party_q THEN
    v_party := LEAST(20, GREATEST(1, NULLIF(substring(v_answers->>v_party_q FROM '^\s*(\d{1,2})'), '')::int))::smallint;
  END IF;

  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.crm_signup_entries WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.crm_signup_entries WHERE page_id = p.id AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN 'rate_limited';
  END IF;

  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND lower(email) = v_email) THEN
    -- Déjà inscrit sans avoir confirmé : un nouveau lien repart (au plus toutes les 10 minutes).
    UPDATE public.crm_signup_entries SET confirm_sent_at = NULL, confirm_hash = NULL, created_at = GREATEST(created_at, now() - interval '2 days')
     WHERE page_id = p.id AND lower(email) = v_email AND confirmed_at IS NULL
       AND (confirm_sent_at IS NULL OR confirm_sent_at < now() - interval '10 minutes');
    RETURN 'already';
  END IF;
  IF v_email IS NULL AND EXISTS (SELECT 1 FROM public.crm_signup_entries WHERE page_id = p.id AND email IS NULL AND phone = v_phone) THEN
    RETURN 'already';
  END IF;

  INSERT INTO public.crm_signup_entries (page_id, first_name, last_name, email, phone, birthdate, instagram, city, answers, party_size,
                                         src, lang, consent_text, visitor_hash, was_known, confirmed_at, subscribed)
  VALUES (p.id, left(trim(p_first_name), 60), NULLIF(left(trim(COALESCE(p_last_name, '')), 60), ''), v_email, v_phone, v_birth,
          NULLIF(left(regexp_replace(trim(COALESCE(p_instagram, '')), '^@+', ''), 40), ''), NULLIF(left(trim(COALESCE(p_city, '')), 60), ''),
          v_answers, v_party,
          CASE WHEN lower(p_src) ~ '^[a-z0-9_-]{1,30}$' THEN lower(p_src) END, v_lang,
          left(trim(p_consent_text), 600), v_ctx.o_hash, public._crm_signup_known(p, v_email, v_phone),
          -- Sans e-mail, aucun lien de confirmation possible : la case cochée fait foi.
          CASE WHEN v_email IS NULL THEN now() END, CASE WHEN v_email IS NULL THEN false END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND v_email IS NULL THEN
    -- Preuve du consentement (téléphone) et place dans le groupe de la page. Le
    -- registre SMS reste fermé côté CRM : le numéro n'y entre pas.
    INSERT INTO public.marketing_consent_events (phone_e164, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
    VALUES (v_phone, 'sms', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', left(trim(p_consent_text), 600), v_lang, 'signup_page:' || p.id);
    IF p.contact_import_id IS NOT NULL THEN
      INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, phone_e164, first_name, last_name, city, newsletter_opt_in, added_at, extra)
      VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, v_phone, left(trim(p_first_name), 60), NULLIF(left(trim(COALESCE(p_last_name, '')), 60), ''),
              NULLIF(left(trim(COALESCE(p_city, '')), 60), ''), false, now(),
              jsonb_build_object('signup_page', p.id, 'src', lower(p_src), 'answers', v_answers))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_crm_signup(text, text, text, text, jsonb, boolean, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- La file des e-mails de confirmation : seulement les inscriptions avec e-mail.
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
     WHERE e.email IS NOT NULL AND e.confirm_sent_at IS NULL AND e.confirmed_at IS NULL AND e.created_at > now() - interval '3 days'
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

-- Confirmer par le lien : preuve (e-mail, et téléphone s'il a été laissé),
-- groupe de la page, registre (sans réveiller un désabonné).
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
  IF e.phone IS NOT NULL THEN
    INSERT INTO public.marketing_consent_events (email, phone_e164, channel, venue_id, organizer_user_id, action, wording_key, wording_text, locale, source)
    VALUES (e.email, e.phone, 'sms', p.venue_id, p.organizer_user_id, 'granted', 'crm_signup_page', e.consent_text, e.lang, 'signup_page:' || p.id);
  END IF;

  IF p.contact_import_id IS NOT NULL THEN
    INSERT INTO public.imported_contacts (list_import_id, venue_id, organizer_user_id, email, phone_e164, first_name, last_name, city, newsletter_opt_in, added_at, extra)
    VALUES (p.contact_import_id, p.venue_id, p.organizer_user_id, e.email,
            CASE WHEN e.phone ~ '^\+[0-9]{8,15}$' THEN e.phone END, e.first_name, e.last_name, e.city, true, now(),
            jsonb_build_object('signup_page', p.id, 'src', e.src, 'answers', e.answers, 'instagram', e.instagram, 'birthdate', e.birthdate))
    ON CONFLICT DO NOTHING;
  END IF;

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

-- ── 8. Relance : le collecteur ──────────────────────────────────────────────
-- Pour chaque page en ligne (ou fermée) et chaque étape allumée, au moment dû :
--   open   prévente : à l'ouverture de la vente · venue : la veille à 18:00 ·
--          liste d'attente : au clic « Prévenir » · communauté : à l'inscription
--          (confirmée depuis moins de 2 jours) ;
--   nudge  open + délai (24 h, 48 h, 3 j), aux inscrits sans achat ;
--   last   la date de la nuit − N jours à 12:00, aux inscrits sans achat.
-- Chaque étape expire (2 jours après son heure, ou au début de la soirée) :
-- rien ne part en retard. Destinataires e-mail : inscription confirmée,
-- abonnée, adresse non supprimée, politique d'envoi Yuno respectée (sinon
-- reporté au passage suivant, jamais perdu avant l'expiration). Démo jamais.
CREATE OR REPLACE FUNCTION public.crm_signup_relance_collect()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.crm_signup_pages;
  v_step text;
  s jsonb;
  v_due timestamptz;
  v_exp timestamptz;
  v_open_due timestamptz;
  v_ev jsonb;
  v_start timestamptz;
  v_camp uuid;
  v_new integer;
  v_total integer := 0;
  v_pages integer := 0;
  v_kind_policy text;
BEGIN
  FOR p IN
    SELECT * FROM public.crm_signup_pages
     WHERE status IN ('live', 'closed') AND relance <> '{}'::jsonb
       AND NOT public.is_demo_marketing_scope(venue_id, organizer_user_id)
  LOOP
    v_ev := public._crm_signup_event(p.event_id);
    v_start := NULLIF(v_ev->>'start_at', '')::timestamptz;
    v_open_due := CASE p.kind
      WHEN 'prevente' THEN p.sale_opens_at
      WHEN 'venue' THEN CASE WHEN p.event_id IS NOT NULL THEN public._crm_signup_night_at(p.event_id, 1, time '18:00') END
      WHEN 'attente' THEN p.notified_at
      ELSE NULL END;

    FOREACH v_step IN ARRAY ARRAY['open', 'nudge', 'last'] LOOP
      s := p.relance->v_step;
      CONTINUE WHEN s IS NULL OR NOT COALESCE((s->>'on')::boolean, false) OR NOT COALESCE((s->>'email')::boolean, false);
      CONTINUE WHEN jsonb_typeof(s->'email_blocks') <> 'array' OR jsonb_array_length(s->'email_blocks') = 0;
      CONTINUE WHEN v_step <> 'open' AND p.kind NOT IN ('prevente', 'attente');

      IF v_step = 'open' AND p.kind = 'communaute' THEN
        v_due := now() - interval '2 days'; v_exp := now() + interval '1 minute';   -- par inscription, plus bas
      ELSIF v_step = 'open' THEN
        v_due := v_open_due; v_exp := LEAST(v_open_due + interval '2 days', COALESCE(v_start, 'infinity'::timestamptz));
      ELSIF v_step = 'nudge' THEN
        v_due := v_open_due + CASE s->>'delay' WHEN '24h' THEN interval '24 hours' WHEN '3d' THEN interval '3 days' ELSE interval '48 hours' END;
        v_exp := LEAST(v_due + interval '2 days', COALESCE(v_start, 'infinity'::timestamptz));
      ELSE
        CONTINUE WHEN p.event_id IS NULL;
        v_due := public._crm_signup_night_at(p.event_id, CASE s->>'delay' WHEN '1d' THEN 1 WHEN '0d' THEN 0 ELSE 2 END, time '12:00');
        v_exp := COALESCE(v_start, v_due + interval '1 day');
      END IF;
      CONTINUE WHEN v_due IS NULL OR now() < v_due OR now() > v_exp;
      v_kind_policy := CASE WHEN v_step = 'open' AND p.kind <> 'communaute' THEN 'tier_closing' ELSE 'automation' END;

      -- Les destinataires de ce passage (heures calmes : la campagne les respecte,
      -- sauf « C'est ouvert », attendu à l'heure dite).
      CREATE TEMP TABLE IF NOT EXISTS _sr (entry_id uuid, email text, first_name text, last_name text, token uuid) ON COMMIT DROP;
      TRUNCATE _sr;
      INSERT INTO _sr (entry_id, email, first_name, last_name, token)
      SELECT e.id, lower(e.email), e.first_name, e.last_name, ns.unsubscribe_token
        FROM public.crm_signup_entries e
        JOIN LATERAL (
          SELECT n.unsubscribe_token FROM public.newsletter_subscriptions n
           WHERE lower(n.email) = lower(e.email) AND n.opted_in AND n.opted_out_at IS NULL
             AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
           LIMIT 1) ns ON true
       WHERE e.page_id = p.id AND e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND COALESCE(e.subscribed, false)
         AND NOT public.is_demo_email(e.email)
         AND NOT EXISTS (SELECT 1 FROM public.crm_signup_sends x WHERE x.entry_id = e.id AND x.step = v_step AND x.channel = 'email')
         AND (v_step <> 'open' OR p.kind <> 'communaute' OR e.confirmed_at > now() - interval '2 days')
         AND (v_step = 'open' OR e.id NOT IN (SELECT entry_id FROM public._crm_signup_buyer_ids(p.id)))
         AND public.email_send_policy(lower(e.email), v_kind_policy) IS NULL;
      SELECT count(*) INTO v_new FROM _sr;
      CONTINUE WHEN v_new = 0;

      -- La campagne enfant de (page, étape), créée au premier envoi, remplie ensuite.
      SELECT campaign_id INTO v_camp FROM public.crm_signup_relance_campaigns WHERE page_id = p.id AND step = v_step;
      IF v_camp IS NULL THEN
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version, theme_json, social_links_json,
           logo_url, event_id, status, audiences_json, exclusions_json, quiet_hours, child_kind, total_recipients, product)
        VALUES
          (p.venue_id, p.organizer_user_id, left('Page d’inscription · ' || p.title || ' · ' || v_step, 200), 'promotional',
           COALESCE(NULLIF(s->>'subject', ''), p.title), COALESCE(s->>'preheader', ''), s->'email_blocks', 2,
           COALESCE(s->'email_theme', '{}'::jsonb), '{}'::jsonb, NULLIF(s->>'email_logo', ''), p.event_id, 'sending',
           '[]'::jsonb, '{}'::jsonb, NOT (v_step = 'open' AND p.kind <> 'communaute'), 'signup', 0, 'crm')
        RETURNING id INTO v_camp;
        -- Elle est sa propre mère : hors des listes, sans accusé « campagne envoyée ».
        UPDATE public.email_campaigns SET parent_campaign_id = v_camp WHERE id = v_camp;
        INSERT INTO public.crm_signup_relance_campaigns (page_id, step, campaign_id) VALUES (p.id, v_step, v_camp);
      ELSE
        -- Le contenu suit la dernière version enregistrée par le pro.
        UPDATE public.email_campaigns SET subject = COALESCE(NULLIF(s->>'subject', ''), subject), preheader = COALESCE(s->>'preheader', preheader),
               blocks_json = s->'email_blocks', theme_json = COALESCE(s->'email_theme', theme_json), logo_url = COALESCE(NULLIF(s->>'email_logo', ''), logo_url)
         WHERE id = v_camp;
      END IF;

      INSERT INTO public.email_campaign_recipients (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_camp, r.email, r.first_name, r.last_name, r.token, 'pending' FROM _sr r
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING;
      INSERT INTO public.crm_signup_sends (page_id, entry_id, step, channel, campaign_id)
      SELECT p.id, r.entry_id, v_step, 'email', v_camp FROM _sr r
      ON CONFLICT (entry_id, step, channel) DO NOTHING;
      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_camp AND status IN ('sent', 'sending', 'draft');
      v_total := v_total + v_new;
      v_pages := v_pages + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('enqueued', v_total, 'steps', v_pages);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_signup_relance_collect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_signup_relance_collect() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('crm-signup-relance'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('crm-signup-relance', '*/5 * * * *', $$SELECT public.crm_signup_relance_collect();$$);
