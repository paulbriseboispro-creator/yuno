-- La provenance d'une vente, lisible : un CANAL et un NOM, figés sur la vente.
--
-- Demande de Paul (12/11) : « pour chaque commande savoir d'où elle vient », puis
-- comprendre la clientèle (certains viennent par Instagram, d'autres par les
-- promoteurs, d'autres par les DJ…).
--
-- `attribution_source` (migration 20261001200000) dit déjà par où une vente est
-- arrivée, mais dans un vocabulaire d'analyse : un lien partenaire « DJ » y vaut
-- « link », comme un lien quelconque, et le NOM de qui a fait vendre n'est écrit
-- nulle part de lisible (ni pour la Console, ni pour la fiche client). Cette
-- migration ajoute, sur chaque billet, table et inscription guest list :
--
--   attribution_channel ∈ promoter · dj · partner · instagram · tiktok · facebook
--                         · whatsapp · social · ads · email · sms · link · qr
--                         · promo_code · yuno · search · web · door · direct
--   attribution_label   = qui ou quoi : « Jimena Albert », « Dolsson », le nom de la
--                         campagne, le code promo, « Story 3 · J-7 »… (NULL = rien
--                         de plus que le canal).
--
-- Règle unique : `sale_source_resolve` (ci-dessous). Posés par le déclencheur
-- `trg_zz_sale_source_channel` APRÈS tous les déclencheurs qui écrivent
-- l'attribution (`trg_stamp_*`, ordre alphabétique), et recalculés à chaque fois
-- que l'attribution change (restamp par la visite, conversion promoteur posée
-- après coup). Le déclencheur ne bloque jamais une vente.
--
-- Au passage : une vente attribuée par sa VISITE (`attribution_ref = 'session'`)
-- venue d'un lien suivi dont le navigateur n'avait pas gardé l'identifiant
-- (constaté sur House Of Love : les liens de Dolsson et de Paul Brisebois)
-- retrouve son lien par les UTM de la visite (soirée + utm_source + utm_medium,
-- un seul lien possible, jamais un lien de promoteur : pas de commission rétroactive).
-- Les compteurs de ces liens (Console, page /stats/ du partenaire) remontent donc
-- d'autant : c'étaient bien leurs ventes.

ALTER TABLE public.tickets            ADD COLUMN IF NOT EXISTS attribution_channel text, ADD COLUMN IF NOT EXISTS attribution_label text;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS attribution_channel text, ADD COLUMN IF NOT EXISTS attribution_label text;
ALTER TABLE public.guest_list_entries ADD COLUMN IF NOT EXISTS attribution_channel text, ADD COLUMN IF NOT EXISTS attribution_label text;

-- ── Un lien suivi → canal + nom ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sale_channel_from_link(p_link_id uuid)
RETURNS TABLE (channel text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE
      WHEN tl.promoter_id IS NOT NULL THEN 'promoter'
      WHEN tl.dj_id IS NOT NULL OR lm = 'dj_link' THEN 'dj'
      WHEN tl.partner_name IS NOT NULL THEN CASE tl.partner_role
        WHEN 'promoter' THEN 'promoter' WHEN 'dj' THEN 'dj' WHEN 'artist' THEN 'dj' ELSE 'partner' END
      WHEN lm IN ('party_link', 'coorg', 'partner') OR ls = 'coorg' THEN 'partner'
      WHEN ls IN ('meta', 'meta_ads', 'facebook_ads') OR lm = 'paid_social' THEN 'ads'
      WHEN ls IN ('newsletter', 'email', 'mail') OR lm IN ('email', 'newsletter') THEN 'email'
      WHEN ls = 'sms' OR lm = 'sms_campaign' THEN 'sms'
      WHEN ls IN ('instagram', 'ig') THEN 'instagram'
      WHEN ls IN ('tiktok', 'tt') THEN 'tiktok'
      WHEN ls IN ('facebook', 'fb') THEN 'facebook'
      WHEN ls IN ('whatsapp', 'wa') THEN 'whatsapp'
      WHEN ls IN ('snapchat', 'threads', 'x', 'twitter', 'youtube') THEN 'social'
      WHEN lm = 'qr' OR ls IN ('flyer', 'qr', 'poster') THEN 'qr'
      ELSE 'link' END,
    CASE
      WHEN tl.promoter_id IS NOT NULL THEN
        (SELECT NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')
           FROM public.promoters p WHERE p.id = tl.promoter_id)
      WHEN tl.partner_name IS NOT NULL THEN tl.partner_name
      WHEN tl.dj_id IS NOT NULL THEN
        COALESCE((SELECT NULLIF(btrim(d.stage_name), '') FROM public.djs d WHERE d.id = tl.dj_id), NULLIF(btrim(tl.label), ''))
      WHEN lm IN ('party_link', 'coorg') OR ls = 'coorg' THEN
        COALESCE((SELECT NULLIF(btrim(v.name), '') FROM public.venues v WHERE v.id = tl.venue_id),
                 (SELECT NULLIF(btrim(op.display_name), '') FROM public.organizer_profiles op WHERE op.user_id = tl.organizer_user_id))
      -- Un lien de canal nommé du seul nom du réseau (« instagram ») n'apprend rien de plus.
      WHEN lower(btrim(COALESCE(tl.label, ''))) IN ('', ls, lm, 'instagram', 'tiktok', 'facebook', 'whatsapp', 'newsletter', 'sms', 'meta_ads', 'coorg') THEN NULL
      ELSE btrim(tl.label) END
  FROM public.tracked_links tl
  CROSS JOIN LATERAL (SELECT lower(btrim(COALESCE(tl.utm_source, ''))) AS ls, lower(btrim(COALESCE(tl.utm_medium, ''))) AS lm) x
  WHERE tl.id = p_link_id
$$;
REVOKE ALL ON FUNCTION public.sale_channel_from_link(uuid) FROM PUBLIC, anon, authenticated;

-- ── Une visite (référent + UTM) → canal ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sale_channel_from_visit(p_utm_source text, p_utm_medium text, p_ref_category text, p_ref_domain text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN lm = 'paid_social' OR ls IN ('meta', 'meta_ads', 'facebook_ads') OR rc = 'paid_social' THEN 'ads'
    WHEN lm IN ('partner_link', 'party_link', 'coorg', 'partner') THEN 'partner'
    WHEN lm = 'dj_link' THEN 'dj'
    WHEN lm IN ('affiliate', 'promoter') THEN 'promoter'
    WHEN ls IN ('newsletter', 'email', 'mail') OR lm IN ('email', 'newsletter') OR rc = 'email' THEN 'email'
    WHEN ls = 'sms' THEN 'sms'
    WHEN lm = 'qr' THEN 'qr'
    WHEN ls IN ('instagram', 'ig') OR rd LIKE '%instagram%' THEN 'instagram'
    WHEN ls IN ('tiktok', 'tt') OR rd LIKE '%tiktok%' THEN 'tiktok'
    WHEN ls IN ('facebook', 'fb') OR rd LIKE '%facebook%' OR rd LIKE 'fb.%' THEN 'facebook'
    WHEN ls IN ('whatsapp', 'wa') OR rd LIKE '%whatsapp%' THEN 'whatsapp'
    WHEN rc = 'social' OR ls IN ('snapchat', 'threads', 'x', 'twitter', 'youtube', 'social') THEN 'social'
    WHEN ls <> '' THEN 'link'
    WHEN rc = 'internal' THEN 'yuno'
    WHEN rc = 'search' THEN 'search'
    WHEN rc = 'referral' THEN 'web'
    ELSE 'direct' END
  FROM (SELECT lower(btrim(COALESCE(p_utm_source, ''))) AS ls, lower(btrim(COALESCE(p_utm_medium, ''))) AS lm,
               lower(btrim(COALESCE(p_ref_category, ''))) AS rc, lower(btrim(COALESCE(p_ref_domain, ''))) AS rd) x
$$;

-- ── Le lien suivi d'une visite, quand la vente ne l'a pas gardé ─────────────
-- Un seul lien de la soirée porte ces UTM ; jamais un lien de promoteur.
CREATE OR REPLACE FUNCTION public.sale_link_from_visit(p_event_id uuid, p_visit_sid text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH v AS (
    SELECT lower(btrim(s.utm_source)) AS us, lower(btrim(s.utm_medium)) AS um
      FROM public.visitor_sessions s
     WHERE s.session_id = p_visit_sid AND NULLIF(btrim(s.utm_source), '') IS NOT NULL
     ORDER BY s.visited_at DESC LIMIT 1
  ), c AS (
    SELECT tl.id FROM public.tracked_links tl, v
     WHERE p_event_id IS NOT NULL AND tl.event_id = p_event_id AND tl.promoter_id IS NULL
       AND lower(btrim(COALESCE(tl.utm_source, ''))) = v.us
       AND lower(btrim(COALESCE(tl.utm_medium, ''))) = COALESCE(v.um, '')
  )
  SELECT CASE WHEN (SELECT count(*) FROM c) = 1 THEN (SELECT id FROM c) END
$$;
REVOKE ALL ON FUNCTION public.sale_link_from_visit(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── La règle unique : une vente → canal + nom ───────────────────────────────
CREATE OR REPLACE FUNCTION public.sale_source_resolve(
  p_attr text, p_ref text, p_link_id uuid, p_purchase_source text, p_promo_code_id uuid,
  p_visit_sid text, p_guest_list_id uuid, p_promoter_id uuid)
RETURNS TABLE (channel text, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a text := lower(btrim(COALESCE(p_attr, '')));
  ps text := lower(btrim(COALESCE(p_purchase_source, '')));
  v_ref uuid;
  v_ch text; v_lb text;
  v_gl record;
  v_sess record;
BEGIN
  IF p_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_ref := p_ref::uuid; END IF;

  -- 0. Ajoutée à la main, à la porte : pas une provenance marketing.
  IF ps IN ('manual', 'walk_in', 'walkin', 'door', 'staff') THEN
    RETURN QUERY SELECT 'door'::text, NULL::text; RETURN;
  END IF;

  -- 1. Un promoteur (conversion, inscription d'un promoteur).
  IF a = 'promoter' OR p_promoter_id IS NOT NULL THEN
    RETURN QUERY SELECT 'promoter'::text,
      (SELECT NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')
         FROM public.promoters p WHERE p.id = COALESCE(p_promoter_id, v_ref));
    RETURN;
  END IF;

  -- 2. Un lien suivi.
  IF p_link_id IS NOT NULL THEN
    SELECT l.channel, l.label INTO v_ch, v_lb FROM public.sale_channel_from_link(p_link_id) l;
    IF v_ch IS NOT NULL THEN RETURN QUERY SELECT v_ch, v_lb; RETURN; END IF;
  END IF;

  -- 3. Une guest list tenue par quelqu'un (DJ, promoteur, invité de la soirée, agence).
  IF p_guest_list_id IS NOT NULL THEN
    SELECT gl.dj_id, gl.promoter_id, gl.guest_pass_id, gl.agency_id, NULLIF(btrim(gl.holder_label), '') AS hl
      INTO v_gl FROM public.guest_lists gl WHERE gl.id = p_guest_list_id;
    IF v_gl.dj_id IS NOT NULL THEN
      RETURN QUERY SELECT 'dj'::text, COALESCE((SELECT NULLIF(btrim(d.stage_name), '') FROM public.djs d WHERE d.id = v_gl.dj_id), v_gl.hl); RETURN;
    ELSIF v_gl.promoter_id IS NOT NULL THEN
      RETURN QUERY SELECT 'promoter'::text, COALESCE(
        (SELECT NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')
           FROM public.promoters p WHERE p.id = v_gl.promoter_id), v_gl.hl); RETURN;
    ELSIF v_gl.agency_id IS NOT NULL THEN
      RETURN QUERY SELECT 'promoter'::text, COALESCE(v_gl.hl, (SELECT NULLIF(btrim(ag.name), '') FROM public.agencies ag WHERE ag.id = v_gl.agency_id)); RETURN;
    ELSIF v_gl.guest_pass_id IS NOT NULL THEN
      RETURN QUERY SELECT 'partner'::text, v_gl.hl; RETURN;
    END IF;
  END IF;

  -- 4. Une campagne e-mail, un code promo.
  IF a = 'email' THEN
    RETURN QUERY SELECT 'email'::text, (SELECT NULLIF(btrim(c.name), '') FROM public.email_campaigns c WHERE c.id = v_ref); RETURN;
  END IF;
  IF a = 'promo_code' OR (p_promo_code_id IS NOT NULL AND a IN ('', 'direct')) THEN
    RETURN QUERY SELECT 'promo_code'::text, (SELECT upper(pc.code) FROM public.promo_codes pc WHERE pc.id = COALESCE(p_promo_code_id, v_ref)); RETURN;
  END IF;

  -- 5. Une visite qui a donné la source (sans lien retrouvé) : on relit la visite.
  IF p_ref = 'session' AND p_visit_sid IS NOT NULL THEN
    SELECT s.utm_source, s.utm_medium, s.referrer_category, s.referrer_domain INTO v_sess
      FROM public.visitor_sessions s WHERE s.session_id = p_visit_sid ORDER BY s.visited_at DESC LIMIT 1;
    IF FOUND THEN
      v_ch := public.sale_channel_from_visit(v_sess.utm_source, v_sess.utm_medium, v_sess.referrer_category, v_sess.referrer_domain);
      IF v_ch <> 'direct' THEN RETURN QUERY SELECT v_ch, NULL::text; RETURN; END IF;
    END IF;
  END IF;

  -- 6. Le vocabulaire d'attribution.
  RETURN QUERY SELECT
    CASE a
      WHEN 'instagram' THEN 'instagram' WHEN 'tiktok' THEN 'tiktok' WHEN 'facebook' THEN 'facebook' WHEN 'whatsapp' THEN 'whatsapp'
      WHEN 'social' THEN 'social' WHEN 'meta_ads' THEN 'ads' WHEN 'partner' THEN 'partner'
      WHEN 'marketplace' THEN CASE WHEN ps = 'dj_profile' THEN 'dj' ELSE 'yuno' END
      WHEN 'search' THEN 'search' WHEN 'referral' THEN 'web' WHEN 'link' THEN 'link'
      ELSE 'direct' END,
    CASE WHEN a = 'marketplace' AND ps IN ('explore', 'venue_profile', 'organizer_profile', 'dj_profile') THEN ps END;
END;
$$;
REVOKE ALL ON FUNCTION public.sale_source_resolve(text, text, uuid, text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Le déclencheur : figer canal + nom ──────────────────────────────────────
-- Les trois tables n'ont pas les mêmes colonnes : on lit la ligne en jsonb.
CREATE OR REPLACE FUNCTION public.stamp_sale_source_channel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j jsonb;
  v_event uuid;
  v_gl uuid;
  v_link uuid;
  r record;
BEGIN
  IF NEW.attribution_source IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.attribution_channel IS NOT NULL
     AND NEW.attribution_source IS NOT DISTINCT FROM OLD.attribution_source
     AND NEW.attribution_ref IS NOT DISTINCT FROM OLD.attribution_ref
     AND NEW.tracked_link_id IS NOT DISTINCT FROM OLD.tracked_link_id THEN
    RETURN NEW;
  END IF;

  j := to_jsonb(NEW);
  IF TG_ARGV[0] = 'guest_list' THEN
    v_gl := NEW.guest_list_id;
    SELECT gl.event_id INTO v_event FROM public.guest_lists gl WHERE gl.id = v_gl;
  ELSE
    v_event := (j->>'event_id')::uuid;
  END IF;

  -- Une vente attribuée par sa visite retrouve son lien suivi (voir l'en-tête).
  IF NEW.tracked_link_id IS NULL AND NEW.attribution_ref = 'session' AND NEW.tracking_visit_sid IS NOT NULL THEN
    v_link := public.sale_link_from_visit(v_event, NEW.tracking_visit_sid);
    IF v_link IS NOT NULL THEN NEW.tracked_link_id := v_link; END IF;
  END IF;

  SELECT s.channel, s.label INTO r
    FROM public.sale_source_resolve(NEW.attribution_source, NEW.attribution_ref, NEW.tracked_link_id,
                                    j->>'purchase_source', (j->>'promo_code_id')::uuid, NEW.tracking_visit_sid,
                                    v_gl, (j->>'promoter_id')::uuid) s;
  NEW.attribution_channel := COALESCE(r.channel, 'direct');
  NEW.attribution_label := r.label;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- la provenance n'empêche jamais une vente
END; $$;

DROP TRIGGER IF EXISTS trg_zz_sale_source_channel ON public.tickets;
CREATE TRIGGER trg_zz_sale_source_channel BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_source_channel('ticket');
DROP TRIGGER IF EXISTS trg_zz_sale_source_channel ON public.table_reservations;
CREATE TRIGGER trg_zz_sale_source_channel BEFORE INSERT OR UPDATE ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_source_channel('table');
DROP TRIGGER IF EXISTS trg_zz_sale_source_channel ON public.guest_list_entries;
CREATE TRIGGER trg_zz_sale_source_channel BEFORE INSERT OR UPDATE ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_source_channel('guest_list');

-- ── Rattrapage : sans réveiller les autres déclencheurs ─────────────────────
-- (support, porte, consentement… n'ont rien à voir avec ces deux colonnes).
SET LOCAL session_replication_role = replica;

UPDATE public.tickets t
   SET tracked_link_id = public.sale_link_from_visit(t.event_id, t.tracking_visit_sid)
 WHERE t.tracked_link_id IS NULL AND t.attribution_ref = 'session' AND t.tracking_visit_sid IS NOT NULL
   AND public.sale_link_from_visit(t.event_id, t.tracking_visit_sid) IS NOT NULL;
UPDATE public.table_reservations t
   SET tracked_link_id = public.sale_link_from_visit(t.event_id, t.tracking_visit_sid)
 WHERE t.tracked_link_id IS NULL AND t.attribution_ref = 'session' AND t.tracking_visit_sid IS NOT NULL
   AND public.sale_link_from_visit(t.event_id, t.tracking_visit_sid) IS NOT NULL;
UPDATE public.guest_list_entries g
   SET tracked_link_id = public.sale_link_from_visit(gl.event_id, g.tracking_visit_sid)
  FROM public.guest_lists gl
 WHERE gl.id = g.guest_list_id AND g.tracked_link_id IS NULL AND g.attribution_ref = 'session' AND g.tracking_visit_sid IS NOT NULL
   AND public.sale_link_from_visit(gl.event_id, g.tracking_visit_sid) IS NOT NULL;

UPDATE public.tickets t SET (attribution_channel, attribution_label) = (
         SELECT COALESCE(r.channel, 'direct'), r.label
           FROM public.sale_source_resolve(t.attribution_source, t.attribution_ref, t.tracked_link_id, t.purchase_source,
                                           t.promo_code_id, t.tracking_visit_sid, NULL, NULL) r)
 WHERE t.attribution_source IS NOT NULL;
UPDATE public.table_reservations t SET (attribution_channel, attribution_label) = (
         SELECT COALESCE(r.channel, 'direct'), r.label
           FROM public.sale_source_resolve(t.attribution_source, t.attribution_ref, t.tracked_link_id, t.purchase_source,
                                           t.promo_code_id, t.tracking_visit_sid, NULL, NULL) r)
 WHERE t.attribution_source IS NOT NULL;
UPDATE public.guest_list_entries g SET (attribution_channel, attribution_label) = (
         SELECT COALESCE(r.channel, 'direct'), r.label
           FROM public.sale_source_resolve(g.attribution_source, g.attribution_ref, g.tracked_link_id, NULL,
                                           NULL, g.tracking_visit_sid, g.guest_list_id, g.promoter_id) r)
 WHERE g.attribution_source IS NOT NULL;

SET LOCAL session_replication_role = origin;

-- ── Lectures de la Console : la clientèle par provenance ────────────────────
-- Les ventes d'une portée (billets payés, tables payées, inscriptions guest list
-- valables), avec leur provenance. Même périmètre de soirées que les Analyses.
CREATE OR REPLACE FUNCTION public._tix_sale_sources(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE (email text, pillar text, channel text, label text, at timestamptz, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS MATERIALIZED (SELECT s.id FROM public._tix_scope_events(p_venue_id, p_organizer_user_id) s)
  SELECT lower(NULLIF(btrim(t.user_email), '')), 'tickets', COALESCE(t.attribution_channel, 'direct'), t.attribution_label,
         COALESCE(t.paid_at, t.created_at), t.event_id
    FROM public.tickets t JOIN ev ON ev.id = t.event_id
   WHERE t.status IN ('paid', 'used')
  UNION ALL
  SELECT lower(NULLIF(btrim(r.user_email), '')), 'tables', COALESCE(r.attribution_channel, 'direct'), r.attribution_label,
         COALESCE(r.paid_at, r.created_at), r.event_id
    FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
   WHERE r.status IN ('paid', 'confirmed')
  UNION ALL
  SELECT lower(NULLIF(btrim(g.email), '')), 'guestlist', COALESCE(g.attribution_channel, 'direct'), g.attribution_label,
         g.created_at, gl.event_id
    FROM public.guest_list_entries g
    JOIN public.guest_lists gl ON gl.id = g.guest_list_id
    JOIN ev ON ev.id = gl.event_id
   WHERE g.status NOT IN ('cancelled', 'rejected', 'refused', 'declined');
$$;
REVOKE ALL ON FUNCTION public._tix_sale_sources(text, uuid) FROM PUBLIC, anon, authenticated;

-- Canal « connu » : tout sauf direct (on ne sait pas) et porte (ajout à la main).
CREATE OR REPLACE FUNCTION public._sale_channel_known(p_channel text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(p_channel, 'direct') NOT IN ('direct', 'door') $$;

-- Fiche client : comment cette personne arrive, commande après commande.
CREATE OR REPLACE FUNCTION public.tix_client_sources(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_em = '' THEN RETURN NULL; END IF;

  WITH s AS (
    SELECT * FROM public._tix_sale_sources(p_venue_id, p_organizer_user_id) x WHERE x.email = v_em
  ), ch AS (
    SELECT s.channel, count(*)::int AS n, max(s.at) AS last_at,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', q.label, 'n', q.n) ORDER BY q.n DESC, q.label), '[]'::jsonb)
              FROM (SELECT (array_agg(s2.label ORDER BY s2.label COLLATE "C"))[1] AS label, count(*)::int AS n FROM s s2
                     WHERE s2.channel = s.channel AND s2.label IS NOT NULL GROUP BY lower(btrim(s2.label))) q) AS names
      FROM s GROUP BY s.channel
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM s),
           'known', (SELECT count(*) FROM s WHERE public._sale_channel_known(s.channel)),
           'first', (SELECT jsonb_build_object('channel', s.channel, 'label', s.label, 'at', s.at) FROM s ORDER BY s.at, s.channel LIMIT 1),
           'channels', COALESCE((SELECT jsonb_agg(jsonb_build_object('channel', ch.channel, 'n', ch.n, 'last_at', ch.last_at, 'names', ch.names)
                                                  ORDER BY public._sale_channel_known(ch.channel) DESC, ch.n DESC, ch.last_at DESC) FROM ch), '[]'::jsonb))
    INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.tix_client_sources(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tix_client_sources(text, uuid, text) TO authenticated;

-- Vue d'ensemble : la clientèle rangée par son canal PRINCIPAL (celui de ses
-- commandes le plus fréquent, sans compter « direct » ni la porte dès qu'un canal
-- connu existe ; à égalité, le plus récent). `p_days` borne aux ventes récentes.
CREATE OR REPLACE FUNCTION public.tix_clients_source_mix(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT * FROM public._tix_sale_sources(p_venue_id, p_organizer_user_id) x
     WHERE x.email IS NOT NULL
       AND (p_days IS NULL OR x.at >= now() - make_interval(days => GREATEST(p_days, 1)))
  ), pc AS (
    SELECT s.email, s.channel, count(*) AS n, max(s.at) AS last_at, public._sale_channel_known(s.channel) AS known
      FROM s GROUP BY s.email, s.channel
  ), main AS (
    SELECT DISTINCT ON (pc.email) pc.email, pc.channel,
           count(*) FILTER (WHERE pc.known) OVER (PARTITION BY pc.email) AS known_channels
      FROM pc ORDER BY pc.email, pc.known DESC, pc.n DESC, pc.last_at DESC
  ), names AS (
    -- Un même nom écrit avec ou sans majuscules (« louis monnier ») = une personne.
    SELECT s.channel, (array_agg(s.label ORDER BY s.label COLLATE "C"))[1] AS label, count(*)::int AS orders, count(DISTINCT s.email)::int AS clients
      FROM s WHERE s.label IS NOT NULL GROUP BY s.channel, lower(btrim(s.label))
  ), per AS (
    SELECT c.channel,
           (SELECT count(*) FROM main m WHERE m.channel = c.channel)::int AS clients,
           (SELECT count(*) FROM s WHERE s.channel = c.channel)::int AS orders,
           (SELECT count(DISTINCT s.email) FROM s WHERE s.channel = c.channel)::int AS reached,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', q.label, 'orders', q.orders, 'clients', q.clients) ORDER BY q.orders DESC, q.label), '[]'::jsonb)
              FROM (SELECT * FROM names nm WHERE nm.channel = c.channel ORDER BY nm.orders DESC, nm.label LIMIT 6) q) AS top
      FROM (SELECT DISTINCT s.channel FROM s) c
  )
  SELECT jsonb_build_object(
           'clients', (SELECT count(*) FROM main),
           'orders', (SELECT count(*) FROM s),
           'known_clients', (SELECT count(*) FROM main WHERE public._sale_channel_known(main.channel)),
           'multi_channel', (SELECT count(*) FROM main WHERE main.known_channels >= 2),
           'days', p_days,
           'channels', COALESCE((SELECT jsonb_agg(to_jsonb(per) ORDER BY public._sale_channel_known(per.channel) DESC, per.clients DESC, per.orders DESC) FROM per), '[]'::jsonb))
    INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.tix_clients_source_mix(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tix_clients_source_mix(text, uuid, integer) TO authenticated;
