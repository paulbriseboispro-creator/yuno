-- ============================================================================
-- Meta — phases 3 et 4 : audiences synchronisées, campagnes lancées depuis
-- Yuno, résultats, Lead Ads. Design : docs/designs/META_ADS_INTEGRATION_PLAN.md.
--
-- Principe : Yuno pilote, Meta diffuse et facture. Tout ce qui est créé chez
-- Meta (audience, campagne, créa) garde son id ici ; tout ce qui est lu chez
-- Meta (dépense, impressions) est copié ici une fois par heure ; et les VENTES
-- attribuées à une campagne viennent de NOS lignes (lien suivi `meta_ads`
-- porté par les billets, tables, commandes, guest list), jamais des chiffres
-- Meta. Ads Manager compte des conversions ; Yuno compte des billets.
--
-- Consentement : une audience ne contient que des contacts consentants (opt-in
-- newsletter non supprimé ∪ consentement SMS vivant), comme
-- export_venue_ad_audience — jamais un acheteur invité sans opt-in.
-- RLS activée partout, aucune policy : RPC gardées + edge service_role.
-- ============================================================================

-- ── 1. Audiences ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_audiences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid NOT NULL REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  -- builtin : all_consenting | buyers_12m | vip_tables | guest_list | regulars_3
  -- venue_segment / contact_segment : ref = id du segment
  -- lookalike : ref = id meta_audiences de l'audience source
  kind              text NOT NULL CHECK (kind IN ('builtin', 'venue_segment', 'contact_segment', 'lookalike')),
  ref               text NOT NULL,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  meta_audience_id  text,
  lookalike_ratio   numeric,
  lookalike_country text,
  size_uploaded     integer,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'ready', 'error')),
  last_sync_at      timestamptz,
  last_error        text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_audiences_source_uq
  ON public.meta_audiences (connection_id, kind, ref) WHERE kind <> 'lookalike';
CREATE INDEX IF NOT EXISTS meta_audiences_conn_idx ON public.meta_audiences (connection_id);
ALTER TABLE public.meta_audiences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_audiences FROM anon, authenticated;

-- ── 2. Campagnes ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid NOT NULL REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  venue_id          text,
  organizer_user_id uuid,
  event_id          uuid REFERENCES public.events(id) ON DELETE SET NULL,
  tracked_link_id   uuid REFERENCES public.tracked_links(id) ON DELETE SET NULL,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  objective         text NOT NULL DEFAULT 'OUTCOME_SALES' CHECK (objective IN ('OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_LEADS')),
  -- draft : jamais envoyé à Meta ; creating : en cours ; paused / active :
  -- vivant chez Meta ; ended : terminé ; error : la création a échoué ;
  -- archived : archivé chez Meta.
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'creating', 'paused', 'active', 'ended', 'error', 'archived')),
  meta_campaign_id  text,
  meta_adset_id     text,
  meta_ad_id        text,
  meta_creative_id  text,
  meta_image_hash   text,
  budget_type       text NOT NULL DEFAULT 'lifetime' CHECK (budget_type IN ('daily', 'lifetime')),
  budget_cents      integer NOT NULL CHECK (budget_cents >= 100),
  currency          text NOT NULL DEFAULT 'EUR',
  start_at          timestamptz NOT NULL,
  end_at            timestamptz,
  -- {"countries":["FR"],"cities":[{"key":"…","name":"Paris","radius_km":25}],
  --  "age_min":18,"age_max":35,"genders":[],"audience_ids":[uuid],
  --  "exclude_audience_ids":[uuid],"advantage":true}
  targeting         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"image_url":"…","headline":"…","body":"…","cta":"BUY_TICKETS","link":"https://yunoapp.eu/l/…"}
  creative          jsonb NOT NULL DEFAULT '{}'::jsonb,
  placements        jsonb NOT NULL DEFAULT '{"instagram":true,"facebook":true}'::jsonb,
  effective_status  text,
  review_feedback   text,
  last_error        text,
  last_synced_at    timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_campaigns_scope_chk CHECK (venue_id IS NULL OR organizer_user_id IS NULL),
  CONSTRAINT meta_campaigns_dates_chk CHECK (end_at IS NULL OR end_at > start_at)
);
CREATE INDEX IF NOT EXISTS meta_campaigns_conn_idx ON public.meta_campaigns (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meta_campaigns_event_idx ON public.meta_campaigns (event_id);
ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_campaigns FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.meta_ads_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_meta_campaigns_touch ON public.meta_campaigns;
CREATE TRIGGER trg_meta_campaigns_touch BEFORE UPDATE ON public.meta_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_touch();
DROP TRIGGER IF EXISTS trg_meta_audiences_touch ON public.meta_audiences;
CREATE TRIGGER trg_meta_audiences_touch BEFORE UPDATE ON public.meta_audiences
  FOR EACH ROW EXECUTE FUNCTION public.meta_ads_touch();

-- Argent (budget pub) : jamais depuis une session d'assistance.
DROP TRIGGER IF EXISTS trg_support_block_meta_campaigns ON public.meta_campaigns;
CREATE TRIGGER trg_support_block_meta_campaigns
  BEFORE INSERT OR UPDATE OR DELETE ON public.meta_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- ── 3. Résultats journaliers (copie des insights Meta) ───────────────────────

CREATE TABLE IF NOT EXISTS public.meta_insights_daily (
  campaign_id          uuid NOT NULL REFERENCES public.meta_campaigns(id) ON DELETE CASCADE,
  day                  date NOT NULL,
  spend_cents          integer NOT NULL DEFAULT 0,
  impressions          integer NOT NULL DEFAULT 0,
  reach                integer NOT NULL DEFAULT 0,
  clicks               integer NOT NULL DEFAULT 0,
  link_clicks          integer NOT NULL DEFAULT 0,
  purchases            integer NOT NULL DEFAULT 0,
  purchase_value_cents integer NOT NULL DEFAULT 0,
  leads                integer NOT NULL DEFAULT 0,
  raw                  jsonb,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, day)
);
ALTER TABLE public.meta_insights_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_insights_daily FROM anon, authenticated;

-- ── 4. Leads (formulaires Instagram / Facebook) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_leads (
  leadgen_id       text PRIMARY KEY,
  connection_id    uuid REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  page_id          text,
  form_id          text,
  ad_id            text,
  meta_campaign_id text,
  campaign_id      uuid REFERENCES public.meta_campaigns(id) ON DELETE SET NULL,
  raw              jsonb,
  field_data       jsonb,
  contact_email    text,
  contact_phone    text,
  contact_name     text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  error            text
);
CREATE INDEX IF NOT EXISTS meta_leads_pending_idx ON public.meta_leads (received_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS meta_leads_conn_idx ON public.meta_leads (connection_id, received_at DESC);
ALTER TABLE public.meta_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_leads FROM anon, authenticated;

-- ── 5. Résolution d'une audience ─────────────────────────────────────────────
-- Rend les contacts CONSENTANTS de la portée de la connexion, filtrés par
-- l'activité demandée. Hachage côté edge (normalisation Meta), jamais ici.
-- `_resolve_meta_audience_rows` est interne (aucun GRANT) ; `resolve_meta_audience`
-- (service_role, lit les lignes) et `count_meta_audience` (pro, ne rend qu'un
-- nombre) l'enveloppent.
CREATE OR REPLACE FUNCTION public._resolve_meta_audience_rows(p_connection_id uuid, p_kind text, p_ref text)
RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue text;
  v_org   uuid;
BEGIN
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org
    FROM public.meta_connections mc WHERE mc.id = p_connection_id;
  IF NOT FOUND OR (v_venue IS NULL AND v_org IS NULL) THEN RETURN; END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE ((v_venue IS NOT NULL AND vsc.venue_id = v_venue) OR (v_org IS NOT NULL AND vsc.organizer_user_id = v_org))
       AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL
       AND vsc.sms_consent_at >= now() - interval '36 months'
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE ((v_venue IS NOT NULL AND ns.venue_id = v_venue) OR (v_org IS NOT NULL AND ns.organizer_user_id = v_org))
       AND ns.opted_in = true
       AND NOT public.is_email_suppressed(ns.email)
  ),
  consenting AS (
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           COALESCE(n.first_name, pr.first_name) AS fn,
           COALESCE(n.last_name, pr.last_name) AS ln
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    SELECT s.em, s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  ),
  scope_events AS (
    SELECT e.id FROM public.events e
     WHERE (v_venue IS NOT NULL AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue))
        OR (v_org IS NOT NULL AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
  ),
  activity AS (
    SELECT lower(t.user_email) AS em, t.event_id, 'ticket'::text AS kind, t.created_at
      FROM public.tickets t WHERE t.paid_at IS NOT NULL AND t.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(tr.user_email), tr.event_id, 'table', tr.created_at
      FROM public.table_reservations tr WHERE tr.paid_at IS NOT NULL AND tr.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(o.user_email), o.event_id, 'order', o.created_at
      FROM public.orders o WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND ((v_venue IS NOT NULL AND o.venue_id = v_venue) OR o.event_id IN (SELECT id FROM scope_events))
    UNION ALL
    SELECT lower(gle.email), g.event_id, 'guest_list', gle.created_at
      FROM public.guest_list_entries gle JOIN public.guest_lists g ON g.id = gle.guest_list_id
     WHERE gle.status <> 'cancelled' AND g.event_id IN (SELECT id FROM scope_events)
  ),
  selected AS (
    SELECT c.* FROM consenting c
     WHERE CASE p_kind
       WHEN 'builtin' THEN
         CASE p_ref
           WHEN 'all_consenting' THEN true
           WHEN 'buyers_12m'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind IN ('ticket','table','order') AND a.created_at >= now() - interval '12 months')
           WHEN 'vip_tables'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'table')
           WHEN 'guest_list'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'guest_list')
           WHEN 'regulars_3'    THEN (SELECT count(DISTINCT a.event_id) FROM activity a WHERE a.em = c.em) >= 3
           ELSE false
         END
       WHEN 'venue_segment' THEN
         v_venue IS NOT NULL AND c.em IN (
           SELECT lower(r.email) FROM public.venue_segments vs
             CROSS JOIN LATERAL public.resolve_venue_segment(v_venue, vs.definition) r
            WHERE vs.id::text = p_ref AND vs.venue_id = v_venue)
       WHEN 'contact_segment' THEN
         c.em IN (
           SELECT lower(r.email) FROM public.contact_segments cs
             CROSS JOIN LATERAL public.resolve_contact_segment_def(v_venue, v_org, cs.definition) r
            WHERE cs.id::text = p_ref
              AND cs.venue_id IS NOT DISTINCT FROM v_venue AND cs.organizer_user_id IS NOT DISTINCT FROM v_org
              AND r.email IS NOT NULL)
       ELSE false END
  )
  SELECT NULLIF(s.em, '')::text, s.phone_e164::text, s.fn::text, s.ln::text,
         (CASE
            WHEN s.phone_e164 LIKE '+33%' THEN 'FR' WHEN s.phone_e164 LIKE '+34%' THEN 'ES'
            WHEN s.phone_e164 LIKE '+44%' THEN 'GB' WHEN s.phone_e164 LIKE '+49%' THEN 'DE'
            WHEN s.phone_e164 LIKE '+39%' THEN 'IT' WHEN s.phone_e164 LIKE '+32%' THEN 'BE'
            WHEN s.phone_e164 LIKE '+41%' THEN 'CH' WHEN s.phone_e164 LIKE '+351%' THEN 'PT'
            WHEN s.phone_e164 LIKE '+31%' THEN 'NL' ELSE '' END)::text
    FROM selected s
   WHERE NULLIF(s.em, '') IS NOT NULL OR s.phone_e164 IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._resolve_meta_audience_rows(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_meta_audience(p_connection_id uuid, p_kind text, p_ref text)
RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_meta_audience: service_role only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._resolve_meta_audience_rows(p_connection_id, p_kind, p_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_meta_audience(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_meta_audience(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.count_meta_audience(p_connection_id uuid, p_kind text, p_ref text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue text; v_org uuid; v_n integer;
BEGIN
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org FROM public.meta_connections mc WHERE mc.id = p_connection_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT public.meta_scope_allowed(v_venue, v_org) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public._resolve_meta_audience_rows(p_connection_id, p_kind, p_ref);
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.count_meta_audience(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_meta_audience(uuid, text, text) TO authenticated;

-- ── 6. Lien suivi d'une campagne (service_role) ──────────────────────────────
-- Une campagne = un lien `/l/<code>` (label meta_ads, utm_campaign = id de la
-- campagne) : c'est lui qui attribue les billets, tables, commandes et
-- inscriptions à CETTE pub, indépendamment des chiffres Meta.
CREATE OR REPLACE FUNCTION public.meta_ads_ensure_tracked_link(p_campaign_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.meta_campaigns%ROWTYPE;
  v_code text;
  v_link uuid;
  v_created_by uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'meta_ads_ensure_tracked_link: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.meta_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR c.event_id IS NULL THEN RETURN NULL; END IF;
  IF c.tracked_link_id IS NOT NULL THEN
    SELECT tl.code INTO v_code FROM public.tracked_links tl WHERE tl.id = c.tracked_link_id;
    IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  END IF;
  IF c.venue_id IS NOT NULL THEN
    SELECT owner_id INTO v_created_by FROM public.venues WHERE id = c.venue_id;
  END IF;
  v_created_by := COALESCE(v_created_by, c.organizer_user_id, c.created_by);
  INSERT INTO public.tracked_links
    (code, label, owner_kind, venue_id, organizer_user_id, created_by, target_kind, event_id, utm_source, utm_medium, utm_campaign)
  VALUES
    (public.gen_tracked_link_code(), 'meta_ads', CASE WHEN c.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
     c.venue_id, c.organizer_user_id, v_created_by, 'event', c.event_id, 'meta', 'paid_social', c.id::text)
  RETURNING id, code INTO v_link, v_code;
  UPDATE public.meta_campaigns SET tracked_link_id = v_link WHERE id = p_campaign_id;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_ads_ensure_tracked_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_ensure_tracked_link(uuid) TO service_role;

-- ── 7. Leads en attente (service_role) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_meta_leads(p_limit integer DEFAULT 50)
RETURNS SETOF public.meta_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_meta_leads: service_role only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT l.leadgen_id FROM public.meta_leads l
     WHERE l.processed_at IS NULL AND l.attempts < 5
     ORDER BY l.received_at
     LIMIT GREATEST(1, LEAST(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.meta_leads l SET attempts = l.attempts + 1
    FROM picked WHERE l.leadgen_id = picked.leadgen_id
  RETURNING l.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_meta_leads(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_leads(integer) TO service_role;

-- Verse un lead dans le registre de consentement de la portée. Le formulaire
-- Meta EST l'acte positif (consent_source 'social') ; jamais de réactivation
-- d'un désabonné, jamais d'adresse supprimée ou repoussée.
CREATE OR REPLACE FUNCTION public.meta_lead_to_contact(p_leadgen_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l public.meta_leads%ROWTYPE;
  v_venue text; v_org uuid;
  v_email text; v_first text; v_last text;
  v_sub uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'meta_lead_to_contact: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.meta_leads WHERE leadgen_id = p_leadgen_id;
  IF NOT FOUND OR l.connection_id IS NULL THEN RETURN NULL; END IF;
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org FROM public.meta_connections mc WHERE mc.id = l.connection_id;
  v_email := lower(btrim(l.contact_email));
  IF v_email IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RETURN NULL; END IF;
  IF public.is_email_suppressed(v_email) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.email_opt_outs eo WHERE lower(eo.email) = v_email
               AND eo.venue_id IS NOT DISTINCT FROM v_venue AND eo.organizer_user_id IS NOT DISTINCT FROM v_org) THEN
    RETURN NULL;
  END IF;
  v_first := NULLIF(split_part(COALESCE(l.contact_name, ''), ' ', 1), '');
  v_last  := NULLIF(regexp_replace(COALESCE(l.contact_name, ''), '^\S+\s*', ''), '');

  SELECT ns.id INTO v_sub FROM public.newsletter_subscriptions ns
   WHERE lower(ns.email) = v_email
     AND ns.venue_id IS NOT DISTINCT FROM v_venue AND ns.organizer_user_id IS NOT DISTINCT FROM v_org
   LIMIT 1;
  IF v_sub IS NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (venue_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    VALUES (v_venue, v_org, v_email, true, 'meta_lead_ads', 'social', COALESCE(l.received_at, now()), v_first, v_last)
    RETURNING id INTO v_sub;
  ELSE
    -- Déjà présent : on complète le nom, on ne réabonne JAMAIS un désabonné.
    UPDATE public.newsletter_subscriptions
       SET first_name = COALESCE(first_name, v_first), last_name = COALESCE(last_name, v_last), updated_at = now()
     WHERE id = v_sub;
  END IF;

  IF l.contact_phone IS NOT NULL AND l.contact_phone ~ '^\+[0-9]{8,15}$' THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.venue_sms_contacts v WHERE v.phone_e164 = l.contact_phone
                       AND v.venue_id IS NOT DISTINCT FROM v_venue AND v.organizer_user_id IS NOT DISTINCT FROM v_org) THEN
        INSERT INTO public.venue_sms_contacts (venue_id, organizer_user_id, phone_e164, full_name, email, sms_consent_at, consent_source)
        VALUES (v_venue, v_org, l.contact_phone, l.contact_name, v_email, COALESCE(l.received_at, now()), 'meta_lead_ads');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- le SMS est un bonus : un refus (contrainte, STOP) ne perd pas l'email
    END;
  END IF;

  UPDATE public.meta_leads SET processed_at = now(), error = NULL WHERE leadgen_id = p_leadgen_id;
  RETURN v_sub;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_lead_to_contact(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_lead_to_contact(text) TO service_role;

-- ── 8. Lecture pro : la page Publicité en un appel ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_meta_ads(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn public.meta_connections%ROWTYPE;
  v_out  jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_my_meta_ads: at most one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.meta_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conn FROM public.meta_connections mc
   WHERE mc.venue_id IS NOT DISTINCT FROM p_venue_id AND mc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   LIMIT 1;

  v_out := jsonb_build_object(
    'connection', CASE WHEN v_conn.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conn.id, 'mode', v_conn.mode, 'status', v_conn.status, 'pixel_id', v_conn.pixel_id,
      'ad_account_id', v_conn.ad_account_id, 'page_id', v_conn.page_id, 'ig_user_id', v_conn.ig_user_id,
      'token_kind', v_conn.token_kind, 'assets', v_conn.assets, 'last_health', v_conn.last_health,
      'ads_ready', (v_conn.mode = 'oauth' AND v_conn.status = 'active' AND v_conn.ad_account_id IS NOT NULL AND v_conn.page_id IS NOT NULL)
    ) END,
    'audiences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'ref', a.ref, 'name', a.name, 'meta_audience_id', a.meta_audience_id,
        'lookalike_ratio', a.lookalike_ratio, 'lookalike_country', a.lookalike_country,
        'size_uploaded', a.size_uploaded, 'status', a.status, 'last_sync_at', a.last_sync_at, 'last_error', a.last_error,
        'created_at', a.created_at) ORDER BY a.created_at)
        FROM public.meta_audiences a WHERE a.connection_id = v_conn.id), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'status', c.status, 'effective_status', c.effective_status, 'objective', c.objective,
        'event_id', c.event_id, 'event_title', e.title, 'event_start_at', e.start_at, 'event_poster_url', e.poster_url,
        'budget_type', c.budget_type, 'budget_cents', c.budget_cents, 'currency', c.currency,
        'start_at', c.start_at, 'end_at', c.end_at, 'targeting', c.targeting, 'creative', c.creative, 'placements', c.placements,
        'meta_campaign_id', c.meta_campaign_id, 'meta_ad_id', c.meta_ad_id, 'review_feedback', c.review_feedback,
        'last_error', c.last_error, 'last_synced_at', c.last_synced_at, 'created_at', c.created_at,
        'tracked_code', tl.code,
        'insights', (SELECT jsonb_build_object(
            'spend_cents', COALESCE(sum(i.spend_cents), 0), 'impressions', COALESCE(sum(i.impressions), 0),
            'reach', COALESCE(max(i.reach), 0), 'clicks', COALESCE(sum(i.clicks), 0), 'link_clicks', COALESCE(sum(i.link_clicks), 0),
            'purchases', COALESCE(sum(i.purchases), 0), 'purchase_value_cents', COALESCE(sum(i.purchase_value_cents), 0),
            'leads', COALESCE(sum(i.leads), 0),
            'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'spend_cents', d.spend_cents, 'clicks', d.link_clicks, 'purchases', d.purchases) ORDER BY d.day)
                               FROM public.meta_insights_daily d WHERE d.campaign_id = c.id), '[]'::jsonb))
          FROM public.meta_insights_daily i WHERE i.campaign_id = c.id),
        'attributed', jsonb_build_object(
          'tickets', (SELECT count(*) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tickets_revenue_cents', (SELECT COALESCE(round(sum(t.total_price) * 100), 0) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tables', (SELECT count(*) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'tables_revenue_cents', (SELECT COALESCE(round(sum(tr.total_price) * 100), 0) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'orders', (SELECT count(*) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'orders_revenue_cents', (SELECT COALESCE(round(sum(o.total) * 100), 0) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'guest_list', (SELECT count(*) FROM public.guest_list_entries g WHERE g.tracked_link_id = c.tracked_link_id AND g.status <> 'cancelled'),
          'clicks', COALESCE(tl.clicks_count, 0)
        )) ORDER BY c.created_at DESC)
        FROM public.meta_campaigns c
        LEFT JOIN public.events e ON e.id = c.event_id
        LEFT JOIN public.tracked_links tl ON tl.id = c.tracked_link_id
       WHERE c.connection_id = v_conn.id), '[]'::jsonb),
    'leads', jsonb_build_object(
      'total', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id),
      'last_30d', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.received_at >= now() - interval '30 days'),
      'pending', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.processed_at IS NULL),
      'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.leadgen_id, 'name', r.contact_name, 'email', r.contact_email, 'received_at', r.received_at, 'processed', r.processed_at IS NOT NULL, 'error', r.error) ORDER BY r.received_at DESC)
                            FROM (SELECT * FROM public.meta_leads l WHERE l.connection_id = v_conn.id ORDER BY l.received_at DESC LIMIT 20) r), '[]'::jsonb)
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'poster_url', e.poster_url, 'city', e.location_city) ORDER BY e.start_at)
        FROM public.events e
       WHERE e.end_at >= now()
         AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
           OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)))), '[]'::jsonb),
    'segments', jsonb_build_object(
      'venue', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vs.id, 'name', vs.name) ORDER BY vs.name) FROM public.venue_segments vs WHERE p_venue_id IS NOT NULL AND vs.venue_id = p_venue_id), '[]'::jsonb),
      'contact', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name) ORDER BY cs.name) FROM public.contact_segments cs WHERE cs.venue_id IS NOT DISTINCT FROM p_venue_id AND cs.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb)
    ),
    'home', jsonb_build_object(
      'city', COALESCE((SELECT v.city FROM public.venues v WHERE v.id = p_venue_id), (SELECT op.city FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id)),
      'latitude', (SELECT v.latitude FROM public.venues v WHERE v.id = p_venue_id),
      'longitude', (SELECT v.longitude FROM public.venues v WHERE v.id = p_venue_id)
    )
  );
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_meta_ads(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_meta_ads(text, uuid) TO authenticated;
