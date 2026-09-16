-- ============================================================================
-- La base de contacts VIVANTE (2026-09-15)
--
-- Une campagne email est aussi une mesure : qui ouvre, qui clique, qui se
-- désabonne, qui n'existe plus. Jusqu'ici cette mesure restait dans le rapport
-- de la campagne et ne redescendait jamais dans la base importée ni dans la
-- segmentation. La campagne WOH du 10/09 (7 228 envoyés, 1 644 ouvertures,
-- 145 cliqueurs, 45 désabonnés, 350 injoignables) n'avait rien appris à la
-- liste de Kevin. Et la segmentation ne lisait que le fichier importé : les
-- personnes venues PAR Yuno (guest list, billets, tables) n'y étaient pas, et
-- une personne présente des deux côtés n'était jamais reconnue comme telle.
--
-- Ce que cette migration pose, dans l'ordre :
--
--   1. `contact_engagement` : une ligne par (portée, email) avec ce que les
--      campagnes ont appris — envois, ouvertures, clics, dernier signe de vie,
--      bounce, plainte, désabonnement — et un STATUT lisible (engagé, passif,
--      silencieux, jamais sollicité, injoignable, désabonné). Rafraîchie par
--      `refresh_contact_engagement` : à la fin de chaque envoi, par le cron
--      toutes les 10 minutes tant que des signaux arrivent, et à l'ouverture
--      de la base si la dernière lecture date de plus de 15 minutes.
--
--   2. `contact_rows` devient LA base unifiée de la portée : le fichier
--      importé (consolidé) ∪ les clients arrivés par Yuno, joints par email.
--      Pour une personne des deux côtés, l'identité Yuno gagne (prénom, nom,
--      téléphone, compte), les montants et les soirées S'ADDITIONNENT (le
--      fichier est le passé, Yuno le présent), la date de dernier achat est
--      la plus récente. Origine tracée : import / yuno / both. Tous les
--      segments (email ET SMS) lisent cette base : rien à changer côté envoi.
--
--   3. Vocabulaire de segment étendu : engagement, origine, emails reçus,
--      ouvertures, clics, dernier clic/ouverture, guest lists, compte Yuno.
--      L'analyse propose deux familles de plus : engagement (engagés,
--      cliqueurs, lecteurs, silencieux, jamais sollicités) et source (clients
--      Yuno, venus par Yuno seulement, présents des deux côtés).
--
--   4. Bilan par campagne (`email_campaign_list_impact`) : une photo de la
--      base et des segments à la fin de l'envoi (baseline), une photo
--      courante recalculée avec l'engagement, et ce que la campagne a fait
--      aux destinataires (nouveaux engagés, réactivés, où ils en sont).
--      « +3 dans Meilleurs clients », « 145 sont passés Engagés ».
--
--   5. Une liste paginée (`list_contact_base`) et un export complet
--      (`export_contact_base`) : le fichier importé mis à jour + les clients
--      Yuno + l'engagement + les segments, en une seule table.
--
-- Règles :
--   • `imported_contacts` n'est JAMAIS modifiée par l'engagement : c'est la
--     pièce du dossier de consentement. L'engagement vit à côté.
--   • L'identité Yuno d'un abonné (`newsletter_subscriptions.user_id`) est
--     reliée au compte VIVANT (auth.users, deleted_at NULL) — jamais à un
--     profil orphelin.
--   • Un statut d'engagement ne rend jamais une adresse joignable : le
--     consentement reste `email_ok` / `phone_ok` (opt-in, non supprimé).
--   • Rien ici ne lève vers un envoi : le sweep et la baseline sont
--     enveloppés, une panne d'observabilité ne coûte pas une campagne.
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contact_engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text,
  organizer_user_id uuid,
  scope_key text GENERATED ALWAYS AS (COALESCE('v:' || venue_id, 'o:' || organizer_user_id::text, 'p')) STORED,
  email text NOT NULL,
  user_id uuid,
  origin text NOT NULL DEFAULT 'import' CHECK (origin IN ('import','yuno','both','campaign')),
  emails_sent integer NOT NULL DEFAULT 0,
  emails_delivered integer NOT NULL DEFAULT 0,
  opens integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  click_events integer NOT NULL DEFAULT 0,
  opens_90d integer NOT NULL DEFAULT 0,
  clicks_90d integer NOT NULL DEFAULT 0,
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  last_opened_at timestamptz,
  last_clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  unsubscribed_at timestamptz,
  suppressed boolean NOT NULL DEFAULT false,
  subscribed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('active','passive','silent','new','unreachable','unsubscribed')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_engagement_scope_at_most_one CHECK (NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_engagement_scope_email ON public.contact_engagement (scope_key, email);
CREATE INDEX IF NOT EXISTS idx_contact_engagement_scope_status ON public.contact_engagement (scope_key, status);

ALTER TABLE public.contact_engagement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_engagement_scope_read ON public.contact_engagement;
CREATE POLICY contact_engagement_scope_read ON public.contact_engagement FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id));
-- Aucune policy d'écriture : seule refresh_contact_engagement écrit.

COMMENT ON TABLE public.contact_engagement IS
  'Ce que les campagnes email ont appris de chaque contact d''une portée (envois, ouvertures, clics, bounce, désabonnement) et son statut lisible. Recalculée par refresh_contact_engagement ; ne jamais écrire à la main.';

-- Dernier rafraîchissement par portée (et son résumé).
CREATE TABLE IF NOT EXISTS public.contact_engagement_state (
  scope_key text PRIMARY KEY,
  venue_id text,
  organizer_user_id uuid,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT contact_engagement_state_scope_at_most_one CHECK (NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL))
);
ALTER TABLE public.contact_engagement_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_engagement_state_scope_read ON public.contact_engagement_state;
CREATE POLICY contact_engagement_state_scope_read ON public.contact_engagement_state FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id));

-- Bilan d'une campagne sur la base : photo à la fin de l'envoi, photo courante.
CREATE TABLE IF NOT EXISTS public.email_campaign_list_impact (
  campaign_id uuid PRIMARY KEY REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  venue_id text,
  organizer_user_id uuid,
  baseline jsonb,
  baseline_at timestamptz,
  current jsonb,
  computed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_campaign_list_impact_scope_at_most_one CHECK (NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_email_campaign_list_impact_scope
  ON public.email_campaign_list_impact (COALESCE('v:' || venue_id, 'o:' || organizer_user_id::text, 'p'), baseline_at DESC);
ALTER TABLE public.email_campaign_list_impact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_campaign_list_impact_scope_read ON public.email_campaign_list_impact;
CREATE POLICY email_campaign_list_impact_scope_read ON public.email_campaign_list_impact FOR SELECT TO authenticated
  USING (public.contact_scope_allowed(venue_id, organizer_user_id));

-- ── 2. Les clients arrivés par Yuno, par portée ─────────────────────────────
-- Même définition d'activité que le CRM (get_venue_customer_segments /
-- get_organizer_customer_segments) : billets et tables payés, commandes de
-- boissons (club), inscriptions guest list non annulées — plus les abonnés
-- newsletter entrés par une surface Yuno (achat, guest list, formulaire),
-- jamais par un fichier. Identité : profil vivant > dernière valeur non nulle
-- de l'activité.
CREATE OR REPLACE FUNCTION public.contact_scope_customers(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(
  email text, user_id uuid, first_name text, last_name text, phone text,
  spent numeric, event_count integer, paid_count integer, ticket_count integer, table_count integer,
  order_count integer, guest_list_count integer, first_at timestamptz, last_at timestamptz, last_paid_at timestamptz,
  city text, age integer, gender text, subscribed boolean, sub_source text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.id
      FROM public.events e
     WHERE (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
        OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
  ), act AS (
    SELECT lower(btrim(t.user_email)) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind, t.user_id,
           COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS fn,
           COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS ln,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS ph
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND btrim(t.user_email) <> '' AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(btrim(tr.user_email)),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id, 'table', tr.user_id,
           COALESCE(tr.guest_first_name, NULLIF(split_part(btrim(COALESCE(tr.full_name, '')), ' ', 1), '')),
           COALESCE(tr.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(tr.full_name, ''), '^\S+\s*', '')), '')),
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
      FROM public.table_reservations tr JOIN ev ON ev.id = tr.event_id
     WHERE tr.user_email IS NOT NULL AND btrim(tr.user_email) <> ''
       AND (tr.paid_at IS NOT NULL OR tr.status IN ('paid', 'confirmed'))
    UNION ALL
    SELECT lower(btrim(o.user_email)),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id, 'order', o.user_id,
           o.guest_first_name, o.guest_last_name,
           NULLIF(btrim(COALESCE(o.guest_phone, '')), '')
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.user_email IS NOT NULL AND btrim(o.user_email) <> '' AND o.status = 'paid'
    UNION ALL
    SELECT lower(btrim(gle.email)),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist', gle.user_id,
           NULLIF(split_part(btrim(COALESCE(gle.full_name, '')), ' ', 1), ''),
           NULLIF(btrim(regexp_replace(COALESCE(gle.full_name, ''), '^\S+\s*', '')), ''),
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
      JOIN ev ON ev.id = gl.event_id
     WHERE gle.email IS NOT NULL AND btrim(gle.email) <> '' AND gle.status <> 'cancelled'
  ), agg AS (
    SELECT a.em,
           COALESCE(sum(a.amount), 0) AS spent,
           count(DISTINCT a.event_id) AS event_count,
           count(*) FILTER (WHERE a.kind <> 'guestlist') AS paid_count,
           count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
           count(*) FILTER (WHERE a.kind = 'table') AS table_count,
           count(*) FILTER (WHERE a.kind = 'order') AS order_count,
           count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           max(a.created_at) FILTER (WHERE a.kind <> 'guestlist') AS last_paid_at,
           (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS uid,
           (array_agg(a.fn ORDER BY a.created_at DESC) FILTER (WHERE a.fn IS NOT NULL))[1] AS fn,
           (array_agg(a.ln ORDER BY a.created_at DESC) FILTER (WHERE a.ln IS NOT NULL))[1] AS ln,
           (array_agg(a.ph ORDER BY a.created_at DESC) FILTER (WHERE a.ph IS NOT NULL))[1] AS ph
      FROM act a
     GROUP BY a.em
  ), subs AS (
    -- Abonnés entrés par une surface Yuno (jamais par un fichier importé).
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           max(ns.source) AS src,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           max(ns.first_name) AS fn, max(ns.last_name) AS ln
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.import_id IS NULL
       AND COALESCE(ns.source, '') NOT LIKE '%import%'
     GROUP BY lower(ns.email)
  ), merged AS (
    SELECT COALESCE(a.em, s.em) AS em,
           COALESCE(a.uid, s.uid) AS uid,
           a.spent, a.event_count, a.paid_count, a.ticket_count, a.table_count, a.order_count, a.guest_list_count,
           a.first_at, a.last_at, a.last_paid_at,
           COALESCE(a.fn, s.fn) AS fn, COALESCE(a.ln, s.ln) AS ln, a.ph,
           COALESCE(s.subscribed, false) AS subscribed, s.src
      FROM agg a
      FULL OUTER JOIN subs s ON s.em = a.em
  )
  SELECT m.em::text AS email,
         COALESCE(m.uid, p.id) AS user_id,
         COALESCE(p.first_name, m.fn)::text AS first_name,
         COALESCE(p.last_name, m.ln)::text AS last_name,
         COALESCE(m.ph, p.phone)::text AS phone,
         m.spent, m.event_count::int, m.paid_count::int, m.ticket_count::int, m.table_count::int,
         m.order_count::int, m.guest_list_count::int, m.first_at, m.last_at, m.last_paid_at,
         NULLIF(btrim(COALESCE(p.city, '')), '')::text AS city,
         CASE WHEN p.birth_date IS NOT NULL THEN date_part('year', age(p.birth_date))::int END AS age,
         CASE
           WHEN lower(COALESCE(p.gender, '')) IN ('female', 'f', 'femme', 'woman', 'mujer') THEN 'female'
           WHEN lower(COALESCE(p.gender, '')) IN ('male', 'm', 'homme', 'man', 'hombre') THEN 'male'
           WHEN lower(COALESCE(p.gender, '')) IN ('other', 'autre', 'otro', 'non-binary', 'nb') THEN 'other'
         END::text AS gender,
         m.subscribed, m.src::text AS sub_source
    FROM merged m
    LEFT JOIN public.profiles p ON p.id = m.uid AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.uid AND u.deleted_at IS NULL)
   WHERE m.em IS NOT NULL AND position('@' in m.em) > 1;
$$;
REVOKE ALL ON FUNCTION public.contact_scope_customers(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_scope_customers(text, uuid) TO service_role;

-- ── 3. La base unifiée : fichier importé ∪ clients Yuno, joints par email ───
-- DROP puis CREATE : le type de retour change (SETOF imported_contacts → TABLE).
-- Les appelants (contact_build_rows, resolve_contact_segment_def) lisent par
-- nom de colonne, rien d'autre ne dépend de l'ancienne forme.
DROP FUNCTION IF EXISTS public.contact_rows(text, uuid);
CREATE FUNCTION public.contact_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(
  id uuid, list_import_id uuid, venue_id text, organizer_user_id uuid, email text, phone_e164 text,
  first_name text, last_name text, country_code text, country text, region text, city text, postal_code text, zone text,
  age integer, gender text, newsletter_opt_in boolean, added_at timestamptz, last_purchase_at timestamptz,
  total_spent numeric, event_count integer, extra jsonb, created_at timestamptz,
  origin text, user_id uuid, imported_spent numeric, imported_events integer,
  yuno_spent numeric, yuno_events integer, yuno_first_at timestamptz, yuno_last_at timestamptz,
  ticket_count integer, table_count integer, order_count integer, guest_list_count integer, last_seen_at timestamptz,
  eng_status text, emails_sent integer, opens integer, clicks integer, last_opened_at timestamptz, last_clicked_at timestamptz,
  unsubscribed_at timestamptz, bounced boolean, subscribed boolean, has_account boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH imp AS (
    SELECT DISTINCT ON (COALESCE(c.email, c.phone_e164)) c.*
      FROM public.imported_contacts c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY COALESCE(c.email, c.phone_e164),
              c.created_at DESC,
              ((c.phone_e164 IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.event_count IS NOT NULL)::int
               + (c.last_purchase_at IS NOT NULL)::int + (c.zone IS NOT NULL)::int + (c.city IS NOT NULL)::int
               + (c.country_code IS NOT NULL)::int + (c.age IS NOT NULL)::int + (c.gender IS NOT NULL)::int) DESC,
              c.id
  ), yc AS (
    SELECT * FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id)
  ), eng AS (
    SELECT ce.* FROM public.contact_engagement ce
     WHERE public.marketing_scope_match(ce.venue_id, ce.organizer_user_id, p_venue_id, p_organizer_user_id)
  )
  SELECT
    COALESCE(i.id, md5('yuno:' || y.email)::uuid) AS id,
    i.list_import_id,
    COALESCE(i.venue_id, p_venue_id) AS venue_id,
    COALESCE(i.organizer_user_id, p_organizer_user_id) AS organizer_user_id,
    COALESCE(i.email, y.email) AS email,
    COALESCE(i.phone_e164, CASE WHEN y.phone ~ '^\+[1-9][0-9]{6,14}$' THEN y.phone END) AS phone_e164,
    COALESCE(y.first_name, i.first_name) AS first_name,
    COALESCE(y.last_name, i.last_name) AS last_name,
    i.country_code, i.country, i.region,
    COALESCE(i.city, y.city) AS city,
    i.postal_code, i.zone,
    COALESCE(i.age, y.age) AS age,
    COALESCE(i.gender, y.gender) AS gender,
    COALESCE(i.newsletter_opt_in, CASE WHEN y.subscribed THEN true END) AS newsletter_opt_in,
    LEAST(i.added_at, y.first_at) AS added_at,
    GREATEST(i.last_purchase_at, y.last_paid_at) AS last_purchase_at,
    CASE WHEN i.total_spent IS NULL AND y.spent IS NULL THEN NULL
         ELSE COALESCE(i.total_spent, 0) + COALESCE(y.spent, 0) END AS total_spent,
    CASE WHEN i.event_count IS NULL AND y.event_count IS NULL THEN NULL
         ELSE COALESCE(i.event_count, 0) + COALESCE(y.event_count, 0) END AS event_count,
    i.extra,
    COALESCE(i.created_at, y.first_at, now()) AS created_at,
    CASE WHEN i.id IS NOT NULL AND y.email IS NOT NULL THEN 'both'
         WHEN i.id IS NOT NULL THEN 'import'
         ELSE 'yuno' END AS origin,
    COALESCE(y.user_id, e.user_id) AS user_id,
    i.total_spent AS imported_spent,
    i.event_count AS imported_events,
    y.spent AS yuno_spent,
    y.event_count AS yuno_events,
    y.first_at AS yuno_first_at,
    y.last_at AS yuno_last_at,
    COALESCE(y.ticket_count, 0) AS ticket_count,
    COALESCE(y.table_count, 0) AS table_count,
    COALESCE(y.order_count, 0) AS order_count,
    COALESCE(y.guest_list_count, 0) AS guest_list_count,
    GREATEST(i.last_purchase_at, y.last_at, e.last_clicked_at, e.last_opened_at) AS last_seen_at,
    COALESCE(e.status, 'new') AS eng_status,
    COALESCE(e.emails_sent, 0) AS emails_sent,
    COALESCE(e.opens, 0) AS opens,
    COALESCE(e.clicks, 0) AS clicks,
    e.last_opened_at, e.last_clicked_at, e.unsubscribed_at,
    (e.bounced_at IS NOT NULL) AS bounced,
    COALESCE(e.subscribed, y.subscribed, false) AS subscribed,
    (COALESCE(y.user_id, e.user_id) IS NOT NULL) AS has_account
  FROM imp i
  FULL OUTER JOIN yc y ON y.email = i.email
  LEFT JOIN eng e ON e.email = COALESCE(i.email, y.email);
$$;
REVOKE ALL ON FUNCTION public.contact_rows(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_rows(text, uuid) TO service_role;

-- contact_build_rows : corps LIVE inchangé (SELECT b.* lit les nouvelles colonnes).
CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DROP TABLE IF EXISTS _cr;
  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT * FROM public.contact_rows(p_venue_id, p_organizer_user_id)
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
  )
  SELECT b.*,
         (b.email IS NOT NULL AND oe.e IS NOT NULL AND s.e IS NULL) AS email_ok,
         (b.phone_e164 IS NOT NULL AND op.p IS NOT NULL) AS phone_ok
    FROM base b
    LEFT JOIN ok_e oe ON oe.e = b.email
    LEFT JOIN sup s ON s.e = b.email
    LEFT JOIN ok_p op ON op.p = b.phone_e164;
  SELECT count(*) INTO v_n FROM _cr;
  RETURN v_n;
END;
$$;

-- ── 4. Vocabulaire de segment v2 ────────────────────────────────────────────
-- Ajouts : engagement {in[]} · origin {in[]} · emails_received {op,value} ·
-- opens {op,value} · clicks {op,value} · last_open_days {op,value} ·
-- last_click_days {op,value} · guest_lists {op,value} · yuno_customer {value} ·
-- has_account {value}. Même contrat : condition inconnue ⇒ FAUX, valeurs par %L.
CREATE OR REPLACE FUNCTION public.contact_definition_predicate(p_definition jsonb, p_alias text DEFAULT 'c')
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  c jsonb;
  parts text[] := '{}';
  a text := quote_ident(COALESCE(p_alias, 'c'));
  t text; op text; sqlop text; v text; lst text; vmin text; vmax text;
BEGIN
  IF p_definition IS NULL OR jsonb_typeof(p_definition->'conditions') <> 'array' THEN
    RETURN 'false';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_definition->'conditions') LOOP
    t := c->>'type';
    op := c->>'op';
    sqlop := CASE op WHEN 'gte' THEN '>=' WHEN 'gt' THEN '>' WHEN 'lte' THEN '<=' WHEN 'lt' THEN '<' WHEN 'eq' THEN '=' ELSE NULL END;
    v := c->>'value';
    IF t IN ('country','country_not','zone','city','region','gender','list','engagement','origin') THEN
      SELECT string_agg(format('%L', CASE
                 WHEN t IN ('country','country_not') THEN upper(btrim(x))
                 WHEN t IN ('zone','city','region') THEN lower(btrim(x))
                 ELSE x END), ',')
        INTO lst
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'in') = 'array' THEN c->'in' ELSE '[]'::jsonb END) x;
      IF lst IS NULL THEN parts := parts || 'false'; CONTINUE; END IF;
    END IF;

    CASE t
      WHEN 'country' THEN
        parts := parts || format('(upper(COALESCE(%s.country_code, '''')) IN (%s))', a, lst);
      WHEN 'country_not' THEN
        parts := parts || format('(%s.country_code IS NOT NULL AND upper(%s.country_code) NOT IN (%s))', a, a, lst);
      WHEN 'zone' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.zone, ''''))) IN (%s))', a, lst);
      WHEN 'city' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.city, ''''))) IN (%s))', a, lst);
      WHEN 'region' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.region, ''''))) IN (%s))', a, lst);
      WHEN 'gender' THEN
        parts := parts || format('(COALESCE(%s.gender, '''') IN (%s))', a, lst);
      WHEN 'list' THEN
        parts := parts || format('(%s.list_import_id::text IN (%s))', a, lst);
      WHEN 'engagement' THEN
        parts := parts || format('(COALESCE(%s.eng_status, ''new'') IN (%s))', a, lst);
      WHEN 'origin' THEN
        parts := parts || format('(COALESCE(%s.origin, '''') IN (%s))', a, lst);
      WHEN 'spent' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.total_spent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'spent_per_event' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((%s.total_spent / NULLIF(%s.event_count, 0)) %s %s::numeric, false)', a, a, sqlop, v); END IF;
      WHEN 'events' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.event_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'guest_lists' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.guest_list_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'emails_received' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.emails_sent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'opens' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.opens %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'clicks' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.clicks %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_purchase_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_purchase_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_open_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_opened_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_click_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_clicked_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'added_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.added_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'age' THEN
        vmin := COALESCE(c->>'min', '0'); vmax := COALESCE(c->>'max', '200');
        IF vmin !~ '^[0-9]{1,3}$' OR vmax !~ '^[0-9]{1,3}$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.age BETWEEN %s AND %s, false)', a, vmin, vmax); END IF;
      WHEN 'newsletter_opt_in' THEN
        parts := parts || format('COALESCE(%s.newsletter_opt_in = %L::boolean, false)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_email' THEN
        parts := parts || format('((%s.email IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_phone' THEN
        parts := parts || format('((%s.phone_e164 IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'yuno_customer' THEN
        parts := parts || format('((COALESCE(%s.origin, '''') IN (''yuno'',''both'')) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_account' THEN
        parts := parts || format('(COALESCE(%s.has_account, false) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      ELSE
        parts := parts || 'false';
    END CASE;
  END LOOP;
  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$$;

-- ── 5. Le rafraîchissement de l'engagement ──────────────────────────────────
-- Statuts (évalués ici et nulle part ailleurs) :
--   unsubscribed : désabonné de cette portée et pas réabonné
--   unreachable  : sur la liste de suppression, bounce dur ou plainte
--   active       : a cliqué depuis 90 j, ou ouvert ≥ 2 campagnes en 90 j
--   passive      : a ouvert au moins une campagne depuis 180 j
--   silent       : ≥ 2 emails reçus, aucune ouverture depuis 180 j
--   new          : moins de 2 emails reçus et aucun signal (jamais sollicité,
--                  ou trop tôt pour dire)
CREATE OR REPLACE FUNCTION public.refresh_contact_engagement(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
  v_n integer := 0;
  v_changed integer := 0;
  v_linked integer := 0;
  v_summary jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'refresh_contact_engagement: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 0. Identité Yuno : un abonné dont l'email porte un compte VIVANT est relié
  --    à ce compte (jamais à un profil orphelin). C'est ce qui fait gagner le
  --    prénom du profil, le ciblage « avec l'app » et la fiche client.
  UPDATE public.newsletter_subscriptions ns
     SET user_id = u.id
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
   WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND ns.user_id IS NULL
     AND u.deleted_at IS NULL
     AND u.email IS NOT NULL
     AND lower(u.email) = lower(ns.email);
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- 1. Tout ce que les campagnes de la portée ont mesuré, par adresse.
  DROP TABLE IF EXISTS _eng;
  CREATE TEMP TABLE _eng ON COMMIT DROP AS
  WITH camp AS (
    SELECT c.id FROM public.email_campaigns c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
  ), rec AS (
    SELECT lower(r.email) AS em,
           count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained')) AS sent_n,
           min(r.sent_at) AS first_sent,
           max(r.sent_at) AS last_sent
      FROM public.email_campaign_recipients r
      JOIN camp ON camp.id = r.campaign_id
     GROUP BY lower(r.email)
  ), evt AS (
    SELECT lower(e.recipient_email) AS em,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'delivered') AS delivered_n,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'opened') AS opens_n,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'clicked') AS clicks_n,
           count(*) FILTER (WHERE e.event_type = 'clicked') AS click_events,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'opened' AND e.created_at > now() - interval '90 days') AS opens_90,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'clicked' AND e.created_at > now() - interval '90 days') AS clicks_90,
           max(e.created_at) FILTER (WHERE e.event_type = 'opened') AS last_open,
           max(e.created_at) FILTER (WHERE e.event_type = 'clicked') AS last_click,
           max(e.created_at) FILTER (WHERE e.event_type = 'bounced'
                                       AND lower(COALESCE(e.metadata->'bounce'->>'type', '') || ' ' || COALESCE(e.metadata->'bounce'->>'subType', '')) !~ '(soft|transient)') AS bounced_e,
           max(e.created_at) FILTER (WHERE e.event_type = 'complained') AS complained_e
      FROM public.email_campaign_events e
      JOIN camp ON camp.id = e.campaign_id
     WHERE EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                    WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))
     GROUP BY lower(e.recipient_email)
  ), subs AS (
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           bool_or(NOT ns.opted_in OR ns.opted_out_at IS NOT NULL) AS unsub,
           max(COALESCE(ns.opted_out_at, ns.updated_at)) FILTER (WHERE NOT ns.opted_in OR ns.opted_out_at IS NOT NULL) AS unsub_at,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           bool_or(ns.import_id IS NOT NULL OR COALESCE(ns.source, '') LIKE '%import%') AS from_import,
           bool_or(ns.import_id IS NULL AND COALESCE(ns.source, '') NOT LIKE '%import%') AS from_yuno
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
     GROUP BY lower(ns.email)
  ), imp AS (
    SELECT DISTINCT ic.email AS em
      FROM public.imported_contacts ic
     WHERE public.marketing_scope_match(ic.venue_id, ic.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ic.email IS NOT NULL
  ), yc AS (
    SELECT y.email AS em, y.user_id AS uid
      FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id) y
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS em FROM public.email_suppressions s
  ), universe AS (
    SELECT em FROM imp
    UNION SELECT em FROM yc
    UNION SELECT em FROM subs
    UNION SELECT em FROM rec
  )
  SELECT u.em,
         COALESCE(y.uid, s.uid) AS uid,
         CASE WHEN i.em IS NOT NULL AND (y.em IS NOT NULL OR COALESCE(s.from_yuno, false)) THEN 'both'
              WHEN i.em IS NOT NULL THEN 'import'
              WHEN y.em IS NOT NULL OR COALESCE(s.from_yuno, false) THEN 'yuno'
              ELSE 'campaign' END AS origin,
         COALESCE(r.sent_n, 0)::int AS emails_sent,
         COALESCE(v.delivered_n, 0)::int AS emails_delivered,
         COALESCE(v.opens_n, 0)::int AS opens,
         COALESCE(v.clicks_n, 0)::int AS clicks,
         COALESCE(v.click_events, 0)::int AS click_events,
         COALESCE(v.opens_90, 0)::int AS opens_90d,
         COALESCE(v.clicks_90, 0)::int AS clicks_90d,
         r.first_sent AS first_sent_at,
         r.last_sent AS last_sent_at,
         v.last_open AS last_opened_at,
         v.last_click AS last_clicked_at,
         v.bounced_e AS bounced_at,
         v.complained_e AS complained_at,
         CASE WHEN COALESCE(s.unsub, false) AND NOT COALESCE(s.subscribed, false) THEN s.unsub_at END AS unsubscribed_at,
         (sp.em IS NOT NULL) AS suppressed,
         COALESCE(s.subscribed, false) AS subscribed,
         CASE
           WHEN COALESCE(s.unsub, false) AND NOT COALESCE(s.subscribed, false) THEN 'unsubscribed'
           WHEN sp.em IS NOT NULL OR v.bounced_e IS NOT NULL OR v.complained_e IS NOT NULL THEN 'unreachable'
           WHEN v.last_click > now() - interval '90 days' OR COALESCE(v.opens_90, 0) >= 2 THEN 'active'
           WHEN v.last_open > now() - interval '180 days' THEN 'passive'
           WHEN COALESCE(r.sent_n, 0) >= 2 THEN 'silent'
           ELSE 'new'
         END AS status
    FROM universe u
    LEFT JOIN imp i ON i.em = u.em
    LEFT JOIN yc y ON y.em = u.em
    LEFT JOIN subs s ON s.em = u.em
    LEFT JOIN rec r ON r.em = u.em
    LEFT JOIN evt v ON v.em = u.em
    LEFT JOIN sup sp ON sp.em = u.em
   WHERE u.em IS NOT NULL AND position('@' in u.em) > 1;

  SELECT count(*) INTO v_changed
    FROM _eng n JOIN public.contact_engagement o ON o.scope_key = v_key AND o.email = n.em
   WHERE o.status <> n.status;

  -- 2. Écriture : une ligne par adresse, statut daté quand il change.
  INSERT INTO public.contact_engagement AS ce
    (venue_id, organizer_user_id, email, user_id, origin, emails_sent, emails_delivered, opens, clicks, click_events,
     opens_90d, clicks_90d, first_sent_at, last_sent_at, last_opened_at, last_clicked_at, bounced_at, complained_at,
     unsubscribed_at, suppressed, subscribed, status, status_changed_at, updated_at)
  SELECT p_venue_id, p_organizer_user_id, n.em, n.uid, n.origin, n.emails_sent, n.emails_delivered, n.opens, n.clicks, n.click_events,
         n.opens_90d, n.clicks_90d, n.first_sent_at, n.last_sent_at, n.last_opened_at, n.last_clicked_at, n.bounced_at, n.complained_at,
         n.unsubscribed_at, n.suppressed, n.subscribed, n.status, now(), now()
    FROM _eng n
  ON CONFLICT (scope_key, email) DO UPDATE
    SET user_id = COALESCE(EXCLUDED.user_id, ce.user_id),
        origin = EXCLUDED.origin,
        emails_sent = EXCLUDED.emails_sent, emails_delivered = EXCLUDED.emails_delivered,
        opens = EXCLUDED.opens, clicks = EXCLUDED.clicks, click_events = EXCLUDED.click_events,
        opens_90d = EXCLUDED.opens_90d, clicks_90d = EXCLUDED.clicks_90d,
        first_sent_at = EXCLUDED.first_sent_at, last_sent_at = EXCLUDED.last_sent_at,
        last_opened_at = EXCLUDED.last_opened_at, last_clicked_at = EXCLUDED.last_clicked_at,
        bounced_at = EXCLUDED.bounced_at, complained_at = EXCLUDED.complained_at,
        unsubscribed_at = EXCLUDED.unsubscribed_at, suppressed = EXCLUDED.suppressed, subscribed = EXCLUDED.subscribed,
        status = EXCLUDED.status,
        status_changed_at = CASE WHEN ce.status = EXCLUDED.status THEN ce.status_changed_at ELSE now() END,
        updated_at = now();

  -- Une adresse sortie de l'univers (liste purgée) sort de l'engagement.
  DELETE FROM public.contact_engagement ce
   WHERE ce.scope_key = v_key
     AND NOT EXISTS (SELECT 1 FROM _eng n WHERE n.em = ce.email);

  SELECT count(*),
         jsonb_build_object(
           'contacts', count(*),
           'by_status', jsonb_build_object(
             'active', count(*) FILTER (WHERE status = 'active'),
             'passive', count(*) FILTER (WHERE status = 'passive'),
             'silent', count(*) FILTER (WHERE status = 'silent'),
             'new', count(*) FILTER (WHERE status = 'new'),
             'unreachable', count(*) FILTER (WHERE status = 'unreachable'),
             'unsubscribed', count(*) FILTER (WHERE status = 'unsubscribed')),
           'by_origin', jsonb_build_object(
             'import', count(*) FILTER (WHERE origin = 'import'),
             'yuno', count(*) FILTER (WHERE origin = 'yuno'),
             'both', count(*) FILTER (WHERE origin = 'both'),
             'campaign', count(*) FILTER (WHERE origin = 'campaign')),
           'with_account', count(*) FILTER (WHERE uid IS NOT NULL),
           'status_changed', v_changed,
           'accounts_linked', v_linked)
    INTO v_n, v_summary
    FROM _eng;
  DROP TABLE IF EXISTS _eng;

  INSERT INTO public.contact_engagement_state (scope_key, venue_id, organizer_user_id, refreshed_at, duration_ms, summary)
  VALUES (v_key, p_venue_id, p_organizer_user_id, now(),
          (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int, COALESCE(v_summary, '{}'::jsonb))
  ON CONFLICT (scope_key) DO UPDATE
    SET refreshed_at = EXCLUDED.refreshed_at, duration_ms = EXCLUDED.duration_ms, summary = EXCLUDED.summary;

  RETURN COALESCE(v_summary, '{}'::jsonb) || jsonb_build_object('refreshed_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_contact_engagement(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_contact_engagement(text, uuid) TO authenticated, service_role;

-- ── 6. Photo de la base et des segments (pour les bilans) ───────────────────
-- Construit _cr, compte chaque segment, rend une photo compacte. Autonome :
-- appelée depuis la baseline d'une campagne et depuis le recalcul des bilans.
CREATE OR REPLACE FUNCTION public.contact_base_snapshot(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer;
  v_segs jsonb := '[]'::jsonb;
  v_status jsonb;
  v_origin jsonb;
  v_reach integer;
  r record;
  c_n integer; c_e integer; c_p integer;
BEGIN
  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);
  FOR r IN
    SELECT cs.id, cs.name, cs.definition FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.definition, 'c'))
      INTO c_n, c_e, c_p;
    v_segs := v_segs || jsonb_build_object('id', r.id, 'name', r.name,
                'contacts', COALESCE(c_n, 0), 'emails', COALESCE(c_e, 0), 'phones', COALESCE(c_p, 0));
  END LOOP;
  SELECT jsonb_build_object(
           'active', count(*) FILTER (WHERE eng_status = 'active'),
           'passive', count(*) FILTER (WHERE eng_status = 'passive'),
           'silent', count(*) FILTER (WHERE eng_status = 'silent'),
           'new', count(*) FILTER (WHERE eng_status = 'new'),
           'unreachable', count(*) FILTER (WHERE eng_status = 'unreachable'),
           'unsubscribed', count(*) FILTER (WHERE eng_status = 'unsubscribed')),
         jsonb_build_object(
           'import', count(*) FILTER (WHERE origin = 'import'),
           'yuno', count(*) FILTER (WHERE origin = 'yuno'),
           'both', count(*) FILTER (WHERE origin = 'both')),
         count(*) FILTER (WHERE email_ok)
    INTO v_status, v_origin, v_reach
    FROM _cr;
  DROP TABLE IF EXISTS _cr;
  RETURN jsonb_build_object('at', now(), 'contacts', v_n, 'reachable_emails', v_reach,
                            'status', v_status, 'origin', v_origin, 'segments', v_segs);
END;
$$;
REVOKE ALL ON FUNCTION public.contact_base_snapshot(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_base_snapshot(text, uuid) TO service_role;

-- La photo « avant » : prise à la fin de l'envoi, une seule fois.
CREATE OR REPLACE FUNCTION public.record_campaign_list_baseline(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c record; v_snap jsonb;
BEGIN
  SELECT id, venue_id, organizer_user_id INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.contact_scope_allowed(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_campaign_list_impact i WHERE i.campaign_id = p_campaign_id AND i.baseline IS NOT NULL) THEN
    RETURN false;
  END IF;
  v_snap := public.contact_base_snapshot(c.venue_id, c.organizer_user_id);
  INSERT INTO public.email_campaign_list_impact (campaign_id, venue_id, organizer_user_id, baseline, baseline_at)
  VALUES (p_campaign_id, c.venue_id, c.organizer_user_id, v_snap, now())
  ON CONFLICT (campaign_id) DO UPDATE SET baseline = EXCLUDED.baseline, baseline_at = EXCLUDED.baseline_at
   WHERE public.email_campaign_list_impact.baseline IS NULL;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_campaign_list_baseline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_campaign_list_baseline(uuid) TO authenticated, service_role;

-- La photo « maintenant » + ce que chaque campagne a fait à ses destinataires,
-- pour toutes les campagnes envoyées depuis 30 jours dans la portée.
CREATE OR REPLACE FUNCTION public.refresh_campaign_list_impacts(p_venue_id text, p_organizer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_snap jsonb;
  v_n integer := 0;
  c record;
  v_now jsonb;
  v_rec_status jsonb;
  v_new_engaged integer;
  v_reactivated integer;
  v_engaged integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_campaigns c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND c.status = 'sent' AND c.sent_at > now() - interval '30 days') THEN
    RETURN 0;
  END IF;

  v_snap := public.contact_base_snapshot(p_venue_id, p_organizer_user_id);

  FOR c IN
    SELECT ec.id, ec.sent_at, COALESCE(ec.send_started_at, ec.sent_at) AS started_at
      FROM public.email_campaigns ec
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ec.status = 'sent' AND ec.sent_at > now() - interval '30 days'
  LOOP
    -- Où en sont AUJOURD'HUI les personnes qui ont reçu cette campagne.
    SELECT jsonb_build_object(
             'active', count(*) FILTER (WHERE ce.status = 'active'),
             'passive', count(*) FILTER (WHERE ce.status = 'passive'),
             'silent', count(*) FILTER (WHERE ce.status = 'silent'),
             'new', count(*) FILTER (WHERE ce.status = 'new'),
             'unreachable', count(*) FILTER (WHERE ce.status = 'unreachable'),
             'unsubscribed', count(*) FILTER (WHERE ce.status = 'unsubscribed'),
             'total', count(*))
      INTO v_rec_status
      FROM public.email_campaign_recipients r
      LEFT JOIN public.contact_engagement ce
        ON ce.email = lower(r.email)
       AND ce.scope_key = COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p')
     WHERE r.campaign_id = c.id AND r.status IN ('sent', 'bounced', 'complained');

    -- Nouveaux engagés : ont ouvert ou cliqué CETTE campagne sans jamais avoir
    -- réagi à une campagne précédente de la portée. Réactivés : avaient réagi,
    -- mais plus depuis 180 jours au moment de l'envoi.
    SELECT count(*),
           count(*) FILTER (WHERE p.em IS NULL),
           count(*) FILTER (WHERE p.em IS NOT NULL AND p.last_prior < c.started_at - interval '180 days')
      INTO v_engaged, v_new_engaged, v_reactivated
      FROM (
        SELECT DISTINCT lower(e.recipient_email) AS em
          FROM public.email_campaign_events e
         WHERE e.campaign_id = c.id AND e.event_type IN ('opened', 'clicked')
           AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                        WHERE r.campaign_id = c.id AND lower(r.email) = lower(e.recipient_email))
      ) g
      LEFT JOIN (
        SELECT lower(e.recipient_email) AS em, max(e.created_at) AS last_prior
          FROM public.email_campaign_events e
          JOIN public.email_campaigns c2 ON c2.id = e.campaign_id
         WHERE public.marketing_scope_match(c2.venue_id, c2.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND c2.id <> c.id AND e.event_type IN ('opened', 'clicked')
           AND e.created_at < c.started_at
         GROUP BY lower(e.recipient_email)
      ) p ON p.em = g.em;

    v_now := v_snap || jsonb_build_object(
      'recipients', v_rec_status,
      'engaged', COALESCE(v_engaged, 0),
      'newly_engaged', COALESCE(v_new_engaged, 0),
      'reactivated', COALESCE(v_reactivated, 0));

    INSERT INTO public.email_campaign_list_impact (campaign_id, venue_id, organizer_user_id, current, computed_at)
    VALUES (c.id, p_venue_id, p_organizer_user_id, v_now, now())
    ON CONFLICT (campaign_id) DO UPDATE SET current = EXCLUDED.current, computed_at = EXCLUDED.computed_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_campaign_list_impacts(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_list_impacts(text, uuid) TO authenticated, service_role;

-- Lecture d'un bilan (rapport de campagne). Recalcule si la photo courante
-- manque ou date de plus de 10 minutes : le pro voit toujours du frais.
CREATE OR REPLACE FUNCTION public.get_campaign_list_impact(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c record; i record; v_deltas jsonb; v_has boolean := false;
BEGIN
  SELECT id, name, subject, venue_id, organizer_user_id, sent_at, status, recipients_count, opens_count, clickers_count,
         unsubscribes_count, bounced_count, complained_count
    INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.contact_scope_allowed(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'sent' THEN RETURN NULL; END IF;

  SELECT * INTO i FROM public.email_campaign_list_impact WHERE campaign_id = p_campaign_id;
  v_has := FOUND;
  IF NOT v_has OR i.current IS NULL OR i.computed_at < now() - interval '10 minutes' THEN
    IF NOT EXISTS (SELECT 1 FROM public.contact_engagement_state s
                    WHERE s.scope_key = COALESCE('v:' || c.venue_id, 'o:' || c.organizer_user_id::text, 'p')
                      AND s.refreshed_at > now() - interval '10 minutes') THEN
      PERFORM public.refresh_contact_engagement(c.venue_id, c.organizer_user_id);
    END IF;
    PERFORM public.refresh_campaign_list_impacts(c.venue_id, c.organizer_user_id);
    SELECT * INTO i FROM public.email_campaign_list_impact WHERE campaign_id = p_campaign_id;
    v_has := FOUND;
  END IF;
  IF NOT v_has THEN RETURN NULL; END IF;

  -- Écart par segment entre la photo « avant » et la photo « maintenant ».
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cur->>'id', 'name', cur->>'name',
           'before', (b->>'contacts')::int, 'after', (cur->>'contacts')::int,
           'delta', (cur->>'contacts')::int - (b->>'contacts')::int,
           'emails_before', (b->>'emails')::int, 'emails_after', (cur->>'emails')::int)
           ORDER BY abs((cur->>'contacts')::int - (b->>'contacts')::int) DESC, cur->>'name'), '[]'::jsonb)
    INTO v_deltas
    FROM jsonb_array_elements(COALESCE(i.current->'segments', '[]'::jsonb)) cur
    JOIN jsonb_array_elements(COALESCE(i.baseline->'segments', '[]'::jsonb)) b ON b->>'id' = cur->>'id';

  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'subject', c.subject, 'sent_at', c.sent_at,
                  'recipients', c.recipients_count, 'opens', c.opens_count, 'clickers', c.clickers_count,
                  'unsubscribes', c.unsubscribes_count, 'bounced', c.bounced_count, 'complained', c.complained_count),
    'baseline', i.baseline, 'baseline_at', i.baseline_at,
    'current', i.current, 'computed_at', i.computed_at,
    'deltas', v_deltas);
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_list_impact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_list_impact(uuid) TO authenticated, service_role;

-- ── 7. Le balayage automatique (cron 10 min) ────────────────────────────────
-- Portées vivantes : une campagne envoyée depuis 30 jours, ou des événements
-- reçus depuis 20 minutes, ou une base jamais rafraîchie depuis 24 h. Chaque
-- portée est enveloppée : une erreur sur l'une ne bloque pas les autres.
CREATE OR REPLACE FUNCTION public.contact_engagement_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_done integer := 0;
  v_err integer := 0;
BEGIN
  FOR r IN
    WITH live AS (
      SELECT c.venue_id, c.organizer_user_id
        FROM public.email_campaigns c
       WHERE c.status IN ('sent', 'sending', 'paused')
         AND (c.sent_at > now() - interval '30 days' OR c.last_slice_at > now() - interval '1 day')
      UNION
      SELECT c.venue_id, c.organizer_user_id
        FROM public.email_campaign_events e
        JOIN public.email_campaigns c ON c.id = e.campaign_id
       WHERE e.created_at > now() - interval '20 minutes'
      UNION
      SELECT li.venue_id, li.organizer_user_id
        FROM public.contact_list_imports li
       WHERE NOT EXISTS (SELECT 1 FROM public.contact_engagement_state s
                          WHERE s.scope_key = COALESCE('v:' || li.venue_id, 'o:' || li.organizer_user_id::text, 'p')
                            AND s.refreshed_at > now() - interval '24 hours')
    )
    SELECT DISTINCT venue_id, organizer_user_id FROM live LIMIT 25
  LOOP
    BEGIN
      PERFORM public.refresh_contact_engagement(r.venue_id, r.organizer_user_id);
      PERFORM public.refresh_campaign_list_impacts(r.venue_id, r.organizer_user_id);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      RAISE WARNING 'contact_engagement_sweep(%, %): %', r.venue_id, r.organizer_user_id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('scopes', v_done, 'errors', v_err);
END;
$$;
REVOKE ALL ON FUNCTION public.contact_engagement_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_engagement_sweep() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'contact-engagement-sweep';
    PERFORM cron.schedule('contact-engagement-sweep', '*/10 * * * *', 'SELECT public.contact_engagement_sweep();');
  END IF;
END $$;

-- ── 8. L'analyse : deux familles de plus (engagement, source) ───────────────
CREATE OR REPLACE FUNCTION public.analyze_contact_lists(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_min integer;
  v_lists integer := 0;
  v_cov jsonb;
  v_facts jsonb;
  v_sugs jsonb := '[]'::jsonb;
  v_home_country text;
  v_home_n integer := 0;
  v_zone_field text := 'zone';
  v_spend_top numeric;
  v_spend_median numeric;
  v_cnt_country integer; v_cnt_zone integer; v_cnt_city integer; v_cnt_spent integer;
  v_cnt_events integer; v_cnt_last integer; v_cnt_age integer; v_cnt_gender integer; v_cnt_news integer;
  v_emails integer; v_phones integer; v_both integer; v_email_ok integer; v_phone_ok integer;
  v_cnt_sent integer; v_cnt_yuno integer; v_campaigns integer;
  r record;
  v_c integer; v_ce integer; v_cp integer;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'analyze_contact_lists: une seule portée à la fois (club OU organisateur OU plateforme)';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);
  SELECT count(*) INTO v_lists FROM public.contact_list_imports li
   WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id);
  SELECT count(*) INTO v_campaigns FROM public.email_campaigns ec
   WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND ec.status = 'sent';

  IF v_n = 0 THEN
    DROP TABLE IF EXISTS _cr;
    RETURN jsonb_build_object('generated_at', now(), 'contacts', 0, 'lists', v_lists, 'campaigns', v_campaigns, 'suggestions', '[]'::jsonb);
  END IF;

  v_min := GREATEST(10, round(v_n * 0.01));

  SELECT count(*) FILTER (WHERE country_code IS NOT NULL),
         count(*) FILTER (WHERE zone IS NOT NULL),
         count(*) FILTER (WHERE city IS NOT NULL),
         count(*) FILTER (WHERE total_spent IS NOT NULL),
         count(*) FILTER (WHERE event_count IS NOT NULL),
         count(*) FILTER (WHERE last_purchase_at IS NOT NULL),
         count(*) FILTER (WHERE age IS NOT NULL),
         count(*) FILTER (WHERE gender IN ('female','male')),
         count(*) FILTER (WHERE newsletter_opt_in IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok),
         count(*) FILTER (WHERE emails_sent > 0),
         count(*) FILTER (WHERE origin IN ('yuno', 'both'))
    INTO v_cnt_country, v_cnt_zone, v_cnt_city, v_cnt_spent, v_cnt_events, v_cnt_last,
         v_cnt_age, v_cnt_gender, v_cnt_news, v_emails, v_phones, v_both, v_email_ok, v_phone_ok,
         v_cnt_sent, v_cnt_yuno
    FROM _cr;

  v_cov := jsonb_build_object(
    'country', v_cnt_country, 'zone', v_cnt_zone, 'city', v_cnt_city, 'spent', v_cnt_spent,
    'events', v_cnt_events, 'last_purchase', v_cnt_last, 'age', v_cnt_age, 'gender', v_cnt_gender,
    'newsletter', v_cnt_news, 'engagement', v_cnt_sent, 'yuno', v_cnt_yuno);

  SELECT country_code, count(*) INTO v_home_country, v_home_n
    FROM _cr WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count(*) DESC LIMIT 1;
  IF v_cnt_zone < GREATEST(v_cnt_city, 1) * 0.6 THEN v_zone_field := 'city'; END IF;

  SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_spent),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total_spent)
    INTO v_spend_top, v_spend_median
    FROM _cr WHERE total_spent > 0;

  v_facts := jsonb_build_object(
    'top_countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'n', n) ORDER BY n DESC)
                       FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
                             GROUP BY country_code ORDER BY n DESC LIMIT 8) t), '[]'::jsonb),
    'zone_field', v_zone_field,
    'top_zones', COALESCE((SELECT jsonb_agg(jsonb_build_object('value', v, 'n', n) ORDER BY n DESC)
                   FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
                           FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
                          GROUP BY 1 ORDER BY n DESC LIMIT 10) t), '[]'::jsonb),
    'spend', jsonb_build_object(
      'zero', (SELECT count(*) FROM _cr WHERE total_spent = 0),
      'paid', (SELECT count(*) FROM _cr WHERE total_spent > 0),
      'median_paid', round(COALESCE(v_spend_median, 0), 2),
      'top_threshold', round(COALESCE(v_spend_top, 0), 2),
      'total', (SELECT round(COALESCE(sum(total_spent), 0), 2) FROM _cr),
      'tables', (SELECT count(*) FROM _cr WHERE total_spent / NULLIF(event_count, 0) >= 60)),
    'events', jsonb_build_object(
      'one', (SELECT count(*) FROM _cr WHERE event_count = 1),
      'two_three', (SELECT count(*) FROM _cr WHERE event_count BETWEEN 2 AND 3),
      'four_plus', (SELECT count(*) FROM _cr WHERE event_count >= 4)),
    'recency', jsonb_build_object(
      'd90', (SELECT count(*) FROM _cr WHERE last_purchase_at > now() - interval '90 days'),
      'd365', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '90 days' AND last_purchase_at > now() - interval '365 days'),
      'older', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '365 days')),
    'age', jsonb_build_object(
      'avg', (SELECT round(avg(age), 1) FROM _cr WHERE age IS NOT NULL),
      'b18_21', (SELECT count(*) FROM _cr WHERE age BETWEEN 18 AND 21),
      'b22_25', (SELECT count(*) FROM _cr WHERE age BETWEEN 22 AND 25),
      'b26_30', (SELECT count(*) FROM _cr WHERE age BETWEEN 26 AND 30),
      'b31', (SELECT count(*) FROM _cr WHERE age >= 31)),
    'gender', jsonb_build_object(
      'female', (SELECT count(*) FROM _cr WHERE gender = 'female'),
      'male', (SELECT count(*) FROM _cr WHERE gender = 'male')),
    'newsletter_yes', (SELECT count(*) FROM _cr WHERE newsletter_opt_in = true),
    'channels', jsonb_build_object('emails', v_emails, 'phones', v_phones, 'both', v_both,
                                   'emails_reachable', v_email_ok, 'phones_reachable', v_phone_ok),
    'engagement', jsonb_build_object(
      'campaigns', v_campaigns,
      'sent_any', v_cnt_sent,
      'active', (SELECT count(*) FROM _cr WHERE eng_status = 'active'),
      'passive', (SELECT count(*) FROM _cr WHERE eng_status = 'passive'),
      'silent', (SELECT count(*) FROM _cr WHERE eng_status = 'silent'),
      'new', (SELECT count(*) FROM _cr WHERE eng_status = 'new'),
      'unreachable', (SELECT count(*) FROM _cr WHERE eng_status = 'unreachable'),
      'unsubscribed', (SELECT count(*) FROM _cr WHERE eng_status = 'unsubscribed')),
    'origin', jsonb_build_object(
      'import', (SELECT count(*) FROM _cr WHERE origin = 'import'),
      'yuno', (SELECT count(*) FROM _cr WHERE origin = 'yuno'),
      'both', (SELECT count(*) FROM _cr WHERE origin = 'both'),
      'with_account', (SELECT count(*) FROM _cr WHERE has_account))
  );

  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand (ord serial, key text, grp text, def jsonb, params jsonb, min_n integer) ON COMMIT DROP;

  IF v_cnt_country >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_country:' || code, 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country', 'in', jsonb_build_array(code)))),
           jsonb_build_object('code', code)
      FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
             GROUP BY country_code HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 6) t;
    IF v_home_country IS NOT NULL THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('geo_abroad', 'geo',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country_not', 'in', jsonb_build_array(v_home_country)))),
         jsonb_build_object('home', v_home_country));
    END IF;
  END IF;
  IF GREATEST(v_cnt_zone, v_cnt_city) >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_zone:' || lower(v), 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', v_zone_field, 'in', jsonb_build_array(v)))),
           jsonb_build_object('zone', v, 'field', v_zone_field)
      FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
              FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
             GROUP BY 1 HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 8) t;
  END IF;

  IF v_cnt_spent >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('spend_free', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'eq', 'value', 0))),
       '{}'::jsonb),
      ('spend_tickets', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'spent', 'op', 'gt', 'value', 0),
         jsonb_build_object('type', 'spent_per_event', 'op', 'lt', 'value', 60))),
       jsonb_build_object('median', round(COALESCE(v_spend_median, 0)))),
      ('spend_tables', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent_per_event', 'op', 'gte', 'value', 60))),
       jsonb_build_object('threshold', 60));
    IF COALESCE(v_spend_top, 0) > 0 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('spend_top', 'spend',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'gte', 'value', round(v_spend_top)))),
         jsonb_build_object('threshold', round(v_spend_top)));
    END IF;
  END IF;

  IF v_cnt_events >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('freq_once', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1))), '{}'::jsonb),
      ('freq_regular', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'events', 'op', 'lte', 'value', 3))), '{}'::jsonb),
      ('freq_loyal', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'gte', 'value', 4))), '{}'::jsonb);
  END IF;

  IF v_cnt_last >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('recent_active', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 90))), '{}'::jsonb),
      ('recent_lapsed', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 90), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 365))), '{}'::jsonb),
      ('recent_dormant', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 365))), '{}'::jsonb);
    IF v_cnt_events >= v_n * 0.3 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('winback_regulars', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 120))), '{}'::jsonb),
        ('new_recent', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 60))), '{}'::jsonb);
    END IF;
  END IF;

  IF v_cnt_age >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('age_18_21', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 18, 'max', 21))), '{}'::jsonb),
      ('age_22_25', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 22, 'max', 25))), '{}'::jsonb),
      ('age_26_30', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 26, 'max', 30))), '{}'::jsonb),
      ('age_31_plus', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 31, 'max', 120))), '{}'::jsonb);
  END IF;
  IF v_cnt_gender >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('gender_female', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('female')))), '{}'::jsonb),
      ('gender_male', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('male')))), '{}'::jsonb);
  END IF;

  IF v_cnt_news >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('newsletter_yes', 'consent', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'newsletter_opt_in', 'value', true))), '{}'::jsonb);
  END IF;

  IF v_phones > 0 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('channel_both', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', true), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb),
      ('channel_sms_only', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', false), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb);
  END IF;

  -- Engagement : dès qu'une campagne est partie. Ce que les emails ont appris.
  IF v_campaigns > 0 AND v_cnt_sent > 0 THEN
    INSERT INTO _cand (key, grp, def, params, min_n) VALUES
      ('eng_active', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'engagement', 'in', jsonb_build_array('active')))), '{}'::jsonb, 5),
      ('eng_clickers', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'last_click_days', 'op', 'lte', 'value', 90))), '{}'::jsonb, 5),
      ('eng_passive', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'engagement', 'in', jsonb_build_array('passive')))), '{}'::jsonb, 5),
      ('eng_silent', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'engagement', 'in', jsonb_build_array('silent')))), '{}'::jsonb, v_min),
      ('eng_never_sent', 'engagement', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'emails_received', 'op', 'eq', 'value', 0))), '{}'::jsonb, v_min);
  END IF;

  -- Source : la base a deux origines dès qu'un client est venu par Yuno.
  IF v_cnt_yuno > 0 THEN
    INSERT INTO _cand (key, grp, def, params, min_n) VALUES
      ('src_yuno', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'origin', 'in', jsonb_build_array('yuno', 'both')))), '{}'::jsonb, 3),
      ('src_yuno_only', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'origin', 'in', jsonb_build_array('yuno')))), '{}'::jsonb, 3),
      ('src_both', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'origin', 'in', jsonb_build_array('both')))), '{}'::jsonb, 3),
      ('src_guest_list', 'source', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'guest_lists', 'op', 'gte', 'value', 1))), '{}'::jsonb, 3);
  END IF;

  FOR r IN SELECT * FROM _cand ORDER BY ord LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.def, 'c'))
      INTO v_c, v_ce, v_cp;
    IF v_c >= COALESCE(r.min_n, v_min) THEN
      v_sugs := v_sugs || jsonb_build_object(
        'key', r.key, 'group', r.grp, 'definition', r.def, 'params', r.params,
        'contacts', v_c, 'emails', v_ce, 'phones', v_cp,
        'share', round(v_c::numeric / v_n, 4),
        'existing_id', (SELECT cs.id FROM public.contact_segments cs
                         WHERE cs.suggestion_key = r.key
                           AND (public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id))
                         LIMIT 1));
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _cand;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'contacts', v_n,
    'lists', v_lists,
    'campaigns', v_campaigns,
    'min_size', v_min,
    'home_country', v_home_country,
    'coverage', v_cov,
    'facts', v_facts,
    'suggestions', v_sugs
  );
END;
$$;

-- ── 9. La vue d'ensemble : engagement, origines, bilans, fraîcheur ──────────
CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_segs jsonb := '[]'::jsonb;
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
  v_refreshed timestamptz;
  v_eng jsonb; v_orig jsonb; v_reach integer; v_reach_sms integer;
  r record;
  c_n integer; c_e integer; c_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Fraîcheur : une lecture de plus de 15 minutes se rafraîchit d'abord.
  SELECT s.refreshed_at INTO v_refreshed FROM public.contact_engagement_state s WHERE s.scope_key = v_key;
  IF v_refreshed IS NULL OR v_refreshed < now() - interval '15 minutes' THEN
    BEGIN
      PERFORM public.refresh_contact_engagement(p_venue_id, p_organizer_user_id);
      PERFORM public.refresh_campaign_list_impacts(p_venue_id, p_organizer_user_id);
      SELECT s.refreshed_at INTO v_refreshed FROM public.contact_engagement_state s WHERE s.scope_key = v_key;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_contact_intelligence_overview refresh: %', SQLERRM;
    END;
  END IF;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  FOR r IN
    SELECT cs.* FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at DESC
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.definition, 'c'))
      INTO c_n, c_e, c_p;
    v_segs := v_segs || jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'definition', r.definition,
      'origin', r.origin, 'suggestion_key', r.suggestion_key, 'created_at', r.created_at,
      'counts', jsonb_build_object('contacts', COALESCE(c_n,0), 'emails', COALESCE(c_e,0), 'phones', COALESCE(c_p,0)));
  END LOOP;

  SELECT jsonb_build_object(
           'active', count(*) FILTER (WHERE eng_status = 'active'),
           'passive', count(*) FILTER (WHERE eng_status = 'passive'),
           'silent', count(*) FILTER (WHERE eng_status = 'silent'),
           'new', count(*) FILTER (WHERE eng_status = 'new'),
           'unreachable', count(*) FILTER (WHERE eng_status = 'unreachable'),
           'unsubscribed', count(*) FILTER (WHERE eng_status = 'unsubscribed'),
           'sent_any', count(*) FILTER (WHERE emails_sent > 0)),
         jsonb_build_object(
           'import', count(*) FILTER (WHERE origin = 'import'),
           'yuno', count(*) FILTER (WHERE origin = 'yuno'),
           'both', count(*) FILTER (WHERE origin = 'both'),
           'with_account', count(*) FILTER (WHERE has_account)),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok)
    INTO v_eng, v_orig, v_reach, v_reach_sms
    FROM _cr;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)), '[]'::jsonb),
    'segments', v_segs,
    'contacts', v_n,
    'reachable_emails', COALESCE(v_reach, 0),
    'reachable_phones', COALESCE(v_reach_sms, 0),
    'engagement', v_eng,
    'origin', v_orig,
    'refreshed_at', v_refreshed,
    'impacts', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.sent_at DESC) FROM (
        SELECT ec.sent_at, jsonb_build_object(
                 'campaign_id', i.campaign_id, 'name', ec.name, 'subject', ec.subject, 'sent_at', ec.sent_at,
                 'recipients', ec.recipients_count, 'opens', ec.opens_count, 'clickers', ec.clickers_count,
                 'unsubscribes', ec.unsubscribes_count, 'bounced', ec.bounced_count, 'complained', ec.complained_count,
                 'baseline', i.baseline, 'baseline_at', i.baseline_at, 'current', i.current, 'computed_at', i.computed_at) AS obj
          FROM public.email_campaign_list_impact i
          JOIN public.email_campaigns ec ON ec.id = i.campaign_id
         WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND ec.status = 'sent' AND ec.sent_at > now() - interval '60 days'
         ORDER BY ec.sent_at DESC LIMIT 6) x), '[]'::jsonb),
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND (public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  );
END;
$$;

-- ── 10. La liste paginée de la base ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_contact_base(
  p_venue_id text, p_organizer_user_id uuid,
  p_search text DEFAULT NULL, p_segment_id uuid DEFAULT NULL, p_status text DEFAULT NULL,
  p_origin text DEFAULT NULL, p_list_import_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'recent', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_where text := 'true';
  v_order text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_def jsonb;
  v_q text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'list_contact_base: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  IF p_segment_id IS NOT NULL THEN
    SELECT cs.definition INTO v_def FROM public.contact_segments cs
     WHERE cs.id = p_segment_id
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id);
    v_where := v_where || ' AND ' || COALESCE(public.contact_definition_predicate(v_def, 'c'), 'false');
  END IF;
  IF p_status IS NOT NULL AND p_status IN ('active','passive','silent','new','unreachable','unsubscribed') THEN
    v_where := v_where || format(' AND c.eng_status = %L', p_status);
  END IF;
  IF p_origin IS NOT NULL AND p_origin IN ('import','yuno','both') THEN
    v_where := v_where || format(' AND c.origin = %L', p_origin);
  END IF;
  IF p_list_import_id IS NOT NULL THEN
    v_where := v_where || format(' AND c.list_import_id = %L::uuid', p_list_import_id);
  END IF;
  IF NULLIF(btrim(COALESCE(p_search, '')), '') IS NOT NULL THEN
    v_q := '%' || replace(replace(replace(lower(btrim(p_search)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_where := v_where || format(' AND (c.email ILIKE %L OR lower(COALESCE(c.first_name, '''') || '' '' || COALESCE(c.last_name, '''')) LIKE %L OR COALESCE(c.phone_e164, '''') LIKE %L OR lower(COALESCE(c.city, '''')) LIKE %L)', v_q, v_q, v_q, v_q);
  END IF;

  v_order := CASE COALESCE(p_sort, 'recent')
    WHEN 'spent' THEN 'c.total_spent DESC NULLS LAST, c.email'
    WHEN 'engaged' THEN 'c.last_clicked_at DESC NULLS LAST, c.last_opened_at DESC NULLS LAST, c.email'
    WHEN 'name' THEN 'lower(COALESCE(c.last_name, '''')), lower(COALESCE(c.first_name, '''')), c.email'
    WHEN 'events' THEN 'c.event_count DESC NULLS LAST, c.email'
    ELSE 'c.last_seen_at DESC NULLS LAST, c.created_at DESC, c.email'
  END;

  EXECUTE format('SELECT count(*) FROM _cr c WHERE %s', v_where) INTO v_total;
  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
      SELECT c.id, c.email, c.phone_e164, c.first_name, c.last_name, c.origin, c.eng_status AS status,
             c.emails_sent, c.opens, c.clicks, c.last_opened_at, c.last_clicked_at, c.unsubscribed_at, c.bounced,
             c.total_spent, c.event_count, c.last_purchase_at, c.yuno_spent, c.yuno_events, c.imported_spent, c.imported_events,
             c.ticket_count, c.table_count, c.order_count, c.guest_list_count, c.last_seen_at,
             c.city, c.zone, c.country_code, c.age, c.gender, c.added_at,
             c.email_ok, c.phone_ok, c.has_account, c.list_import_id
        FROM _cr c WHERE %s ORDER BY %s LIMIT %s OFFSET %s) t
  $q$, v_where, v_order, GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)), GREATEST(0, COALESCE(p_offset, 0)))
    INTO v_rows;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.list_contact_base(text, uuid, text, uuid, text, text, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_contact_base(text, uuid, text, uuid, text, text, uuid, text, integer, integer) TO authenticated, service_role;

-- ── 11. L'export unifié ─────────────────────────────────────────────────────
-- Le fichier importé mis à jour + les clients venus par Yuno + l'engagement +
-- les listes et segments de chaque personne. Refusé en session support (une
-- base clients ne sort que par le pro lui-même).
CREATE OR REPLACE FUNCTION public.export_contact_base(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_out jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'export_contact_base: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Export indisponible en session support';
  END IF;

  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);
  ALTER TABLE _cr ADD COLUMN segs text[] DEFAULT '{}';
  FOR r IN
    SELECT cs.id, cs.name, cs.definition FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at
  LOOP
    EXECUTE format('UPDATE _cr c SET segs = c.segs || %L::text WHERE %s',
                   r.name, public.contact_definition_predicate(r.definition, 'c'));
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', c.email,
           'phone', c.phone_e164,
           'first_name', c.first_name,
           'last_name', c.last_name,
           'origin', c.origin,
           'has_account', c.has_account,
           'email_ok', c.email_ok,
           'phone_ok', c.phone_ok,
           'status', c.eng_status,
           'emails_sent', c.emails_sent,
           'opens', c.opens,
           'clicks', c.clicks,
           'last_opened_at', c.last_opened_at,
           'last_clicked_at', c.last_clicked_at,
           'unsubscribed_at', c.unsubscribed_at,
           'bounced', c.bounced,
           'total_spent', c.total_spent,
           'event_count', c.event_count,
           'last_purchase_at', c.last_purchase_at,
           'imported_spent', c.imported_spent,
           'imported_events', c.imported_events,
           'yuno_spent', c.yuno_spent,
           'yuno_events', c.yuno_events,
           'ticket_count', c.ticket_count,
           'table_count', c.table_count,
           'order_count', c.order_count,
           'guest_list_count', c.guest_list_count,
           'first_seen_at', COALESCE(c.added_at, c.yuno_first_at),
           'last_seen_at', c.last_seen_at,
           'country_code', c.country_code,
           'region', c.region,
           'city', c.city,
           'postal_code', c.postal_code,
           'zone', c.zone,
           'age', c.age,
           'gender', c.gender,
           'list', li.list_name,
           'segments', array_to_string(c.segs, ' ; ')
         ) ORDER BY c.last_seen_at DESC NULLS LAST, c.email), '[]'::jsonb)
    INTO v_out
    FROM _cr c
    LEFT JOIN public.contact_list_imports li ON li.id = c.list_import_id;
  DROP TABLE IF EXISTS _cr;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.export_contact_base(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_contact_base(text, uuid) TO authenticated, service_role;

-- ── 12. Premier remplissage : toutes les portées qui ont une base ───────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT venue_id, organizer_user_id FROM (
      SELECT li.venue_id, li.organizer_user_id FROM public.contact_list_imports li
      UNION
      SELECT c.venue_id, c.organizer_user_id FROM public.email_campaigns c WHERE c.status = 'sent'
    ) s
  LOOP
    BEGIN
      PERFORM public.refresh_contact_engagement(r.venue_id, r.organizer_user_id);
      PERFORM public.refresh_campaign_list_impacts(r.venue_id, r.organizer_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact engagement backfill (%, %): %', r.venue_id, r.organizer_user_id, SQLERRM;
    END;
  END LOOP;
END $$;
