-- ─────────────────────────────────────────────────────────────────────────────
-- Yuno CRM — l'e-mail PRATIQUE aux détenteurs d'une soirée (S11, 18/10/2026).
-- Doc : docs/designs/CRM_PRACTICAL_EMAIL.md (lecture juridique, décisions).
--
-- Un billet est un contrat d'accès à UNE soirée : ses horaires, son accès, un
-- changement de line-up ou une info de dernière minute s'écrivent à chaque
-- détenteur, sans accord marketing (CNIL : messages transactionnels, exécution
-- du contrat). Tant que l'e-mail ne vend RIEN — sinon il redevient de la
-- prospection, soumise au consentement (L34-5 CPCE). Shotgun le propose sous
-- le même nom et suspend le compte qui le détourne.
--
-- Règles posées ici, toutes côté serveur :
--   1. `email_campaigns.practical` : la campagne est un e-mail pratique de sa
--      soirée `event_id` (une soirée MIROIR de la portée). Type `informational`
--      et produit `crm` posés par le trigger ; jamais d'autre audience, de
--      segment, d'A/B, de renvoi ni de relance ; le drapeau ne se retire pas.
--   2. Audience = `_crm_practical_audience` : les acheteurs d'un billet VALIDE
--      de cette soirée (un billet `transferred` est un billet REVENDU chez
--      Shotgun : l'acheteur n'y va plus). Désabonnés du marketing compris, la
--      liste de suppression (bounce, plainte, invalide) s'applique comme
--      partout (_enqueue_campaign_recipients_core). Hors règles de pression
--      marketing (type informational, comme le prévoyait email_send_policy).
--   3. Contenu = `_crm_practical_content_issues` : texte, image sans lien,
--      line-up, carte de la soirée SANS prix (le bouton d'achat n'est jamais
--      dessiné en mode pratique), compte à rebours, réseaux, séparateurs ;
--      jamais billetterie, table, liste invités, HTML libre, autre soirée, lien
--      d'achat ou mot de promotion. Codes stables, traduits au front.
--   4. Soirée = `_crm_practical_night_state` : le compte est organisateur ou
--      co-organisateur éditeur de la soirée chez la billetterie (jamais
--      lecteur), au plus 3 e-mails pratiques par soirée, jusqu'à 24 h après sa
--      fin (`crm_practical_email_rules`).
--   5. Yunits : 1 par e-mail, comme tout e-mail (enqueue_campaign_recipients
--      inchangé) ; `crm_practical_email_rules()->'yunits'` le dit au front.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS practical boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.email_campaigns.practical IS
  'Yuno CRM : e-mail pratique aux détenteurs d''un billet valide de event_id (soirée miroir). Sans accord marketing, sans aucune promotion (garde guard_crm_practical_email).';

CREATE INDEX IF NOT EXISTS email_campaigns_practical_event_idx
  ON public.email_campaigns (event_id) WHERE practical;

-- ── Bornes (une seule définition, lue par la garde ET par le front) ─────────
CREATE OR REPLACE FUNCTION public.crm_practical_email_rules()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'max_per_night', 3,          -- e-mails pratiques au plus par soirée
    'hours_after_end', 24,       -- objets trouvés, incident : jusqu'au lendemain
    'yunits_per_email', 1,       -- comme tout e-mail CRM
    'roles', jsonb_build_array('organizer', 'editor')
  );
$$;

-- ── Un lien : permis, ou le code de ce qui le rend promotionnel ─────────────
-- Permis : la page de CETTE soirée (le billet s'y retrouve), un plan, le site
-- du lieu, un réseau social, mailto:, tel:. Refusé : un lien de vente Yuno
-- (/go/, /l/, /j/, pages soirée, linktree…), une autre page Shotgun, une autre
-- billetterie, un lien qui porte un code promo.
CREATE OR REPLACE FUNCTION public._crm_practical_link_issue(p_url text, p_event_url text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
DECLARE
  v_url text := lower(btrim(COALESCE(p_url, '')));
  v_host text;
  v_path text;
  v_ev text := lower(btrim(COALESCE(p_event_url, '')));
BEGIN
  IF v_url = '' OR v_url LIKE 'mailto:%' OR v_url LIKE 'tel:%' OR v_url LIKE '#%' THEN
    RETURN NULL;
  END IF;
  -- Variables du Studio ({{…}}) : seule {{event.tickets_url}} mènerait à la
  -- vente, et elle n'existe que dans le HTML libre, refusé à part.
  IF v_url LIKE '%{{%' THEN RETURN 'link_variable'; END IF;
  IF v_url !~ '^https?://' THEN v_url := 'https://' || v_url; END IF;
  v_host := regexp_replace(substring(v_url FROM '^https?://([^/?#]+)'), '^www\.', '');
  v_path := COALESCE(substring(v_url FROM '^https?://[^/?#]+(/[^?#]*)'), '/');

  IF v_url ~ '[?&](promo|coupon|discount|code|codigo|voucher)[a-z_]*=' THEN
    RETURN 'link_promo';
  END IF;

  IF v_host IN ('yunoapp.eu', 'crm.yunoapp.eu', 'landing.yunoapp.eu') THEN
    RETURN 'link_sales';
  END IF;

  IF v_host LIKE '%shotgun.live' THEN
    IF v_ev <> '' AND split_part(split_part(regexp_replace(v_url, '^https?://(www\.)?', ''), '?', 1), '#', 1)
                     = split_part(split_part(regexp_replace(v_ev, '^https?://(www\.)?', ''), '?', 1), '#', 1) THEN
      RETURN NULL;
    END IF;
    RETURN 'link_other_event';
  END IF;

  IF v_host ~ '(^|\.)(dice\.fm|fourvenues\.com|whan\.es|eventbrite\.[a-z.]+|weezevent\.com|billetweb\.fr|ticketmaster\.[a-z.]+|fnacspectacles\.com|ra\.co|residentadvisor\.net|xceed\.me|seetickets\.com|helloasso\.com|yurplan\.com|tickettailor\.com|festicket\.com|universe\.com|fever\.?up\.com|feverup\.com|digitick\.com|eventim\.[a-z.]+)$' THEN
    RETURN 'link_ticketing';
  END IF;
  RETURN NULL;
END;
$$;

-- ── Un texte : NULL, ou le mot qui en fait une promotion ────────────────────
-- Liste courte et sûre (FR / EN / ES) : ce qui vend une place, une table, une
-- remise ou une autre date. « Boisson offerte » reste permis : c'est un
-- attribut du billet que la personne tient déjà.
CREATE OR REPLACE FUNCTION public._crm_practical_text_issue(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $$
  SELECT (regexp_match(
    ' ' || lower(extensions.unaccent(COALESCE(p_text, ''))) || ' ',
    '(code promo|promo code|codigo promocional|code de reduction|code reduc|'
    || 'reduction|remise|discount|descuento|rebaja|'
    || '[-−–][[:space:]]?[0-9]{1,2}[[:space:]]?%|[0-9]{1,2}[[:space:]]?% (off|de reduction|de descuento)|'
    || 'prevente|pre-vente|presale|pre-sale|preventa|early bird|'
    || 'billets? en vente|tickets? on sale|entradas a la venta|'
    || 'derniers? billets|dernieres places|last tickets|ultimas entradas|'
    || 'prends ta place|prenez vos places|get your tickets?|consigue tu entrada|compra tu entrada|'
    || 'reserve ta table|reservez votre table|book (a|your) table|reserva tu mesa|'
    || 'prochaine soiree|prochaines soirees|next party|next event|proxima fiesta|proximo evento)'
  ))[1];
$$;

-- ── Le contenu d'un e-mail pratique : la liste de ce qui le rend promotionnel ─
-- [{code, block?, type?, term?}] ; tableau vide = contenu permis.
CREATE OR REPLACE FUNCTION public._crm_practical_content_issues(
  p_blocks jsonb, p_subject text, p_preheader text, p_event_id uuid, p_event_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  b jsonb;
  v_type text;
  v_id text;
  v_issue text;
  v_txt text;
  v_url text;
BEGIN
  v_issue := public._crm_practical_text_issue(p_subject);
  IF v_issue IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('code', 'promo_words', 'field', 'subject', 'term', v_issue);
  END IF;
  v_issue := public._crm_practical_text_issue(p_preheader);
  IF v_issue IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('code', 'promo_words', 'field', 'preheader', 'term', v_issue);
  END IF;

  IF jsonb_typeof(p_blocks) <> 'array' THEN RETURN v_out; END IF;

  FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
    v_type := b->>'type';
    v_id := b->>'id';

    IF v_type IS NULL OR v_type NOT IN ('header', 'text', 'image', 'cta', 'columns', 'event', 'countdown',
                                        'lineup', 'social', 'divider', 'spacer') THEN
      v_out := v_out || jsonb_build_object('code', 'block_not_allowed', 'block', v_id, 'type', v_type);
      CONTINUE;
    END IF;

    -- Bloc Yuno : la soirée de l'e-mail, jamais une autre.
    IF v_type IN ('event', 'countdown', 'lineup')
       AND NULLIF(b->>'eventId', '') IS NOT NULL
       AND (p_event_id IS NULL OR b->>'eventId' <> p_event_id::text) THEN
      v_out := v_out || jsonb_build_object('code', 'other_event', 'block', v_id, 'type', v_type);
    END IF;
    IF v_type = 'countdown' AND NULLIF(b->>'eventId', '') IS NULL AND NULLIF(b->>'targetAt', '') IS NOT NULL THEN
      -- Un compte à rebours vers une autre date annonce autre chose que la soirée.
      v_out := v_out || jsonb_build_object('code', 'other_event', 'block', v_id, 'type', v_type);
    END IF;
    IF v_type = 'event' AND COALESCE((b->>'price')::boolean, false) THEN
      v_out := v_out || jsonb_build_object('code', 'price_shown', 'block', v_id, 'type', v_type);
    END IF;

    -- Les liens du bloc.
    FOR v_url IN
      SELECT u FROM (
        SELECT b->>'url' AS u WHERE v_type = 'cta'
        UNION ALL SELECT b->>'linkUrl' WHERE v_type = 'image'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b->>'body', ''), '\[url=([^\]]+)\]', 'gi') m WHERE v_type = 'text'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b->>'body', ''), 'href\s*=\s*["'']([^"'']+)["'']', 'gi') m WHERE v_type = 'text'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b#>>'{left,body}', '') || ' ' || COALESCE(b#>>'{right,body}', ''), '\[url=([^\]]+)\]', 'gi') m WHERE v_type = 'columns'
      ) x WHERE NULLIF(btrim(u), '') IS NOT NULL
    LOOP
      v_issue := public._crm_practical_link_issue(v_url, p_event_url);
      IF v_issue IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('code', v_issue, 'block', v_id, 'type', v_type, 'url', left(v_url, 200));
      END IF;
    END LOOP;

    -- Les mots du bloc.
    v_txt := concat_ws(' ',
      b->>'body', b->>'label', b->>'title', b->>'kicker', b->>'sub', b->>'note',
      b#>>'{left,title}', b#>>'{left,body}', b#>>'{right,title}', b#>>'{right,body}',
      CASE WHEN jsonb_typeof(b->'perks') = 'array'
           THEN (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(b->'perks')) END);
    v_issue := public._crm_practical_text_issue(v_txt);
    IF v_issue IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('code', 'promo_words', 'block', v_id, 'type', v_type, 'term', v_issue);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- ── La soirée : peut-on écrire à ses détenteurs, et combien sont-ils ? ──────
-- reason : NULL (oui) | not_mirror | role | window | limit
CREATE OR REPLACE FUNCTION public._crm_practical_night_state(
  p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_campaign_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_rules jsonb := public.crm_practical_email_rules();
  e record;
  v_role text;
  v_sent integer;
  v_window timestamptz;
  v_reason text;
BEGIN
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.external_source, ev.external_ticket_url
    INTO e
    FROM public.events ev
   WHERE ev.id = p_event_id
     AND ev.external_source IS NOT NULL
     AND public.marketing_scope_match(ev.venue_id, ev.organizer_user_id, p_venue_id, p_organizer_user_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_mirror');
  END IF;

  SELECT xe.external_role INTO v_role
    FROM public.external_events xe
   WHERE xe.event_id = p_event_id
   ORDER BY (xe.external_role = 'organizer') DESC, (xe.external_role = 'editor') DESC
   LIMIT 1;

  SELECT count(*) INTO v_sent
    FROM public.email_campaigns c
   WHERE c.practical AND c.event_id = p_event_id
     AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND c.status IN ('scheduled', 'sending', 'paused', 'sent')
     AND (p_campaign_id IS NULL OR c.id <> p_campaign_id);

  v_window := COALESCE(e.end_at, e.start_at + interval '8 hours')
              + make_interval(hours => (v_rules->>'hours_after_end')::integer);

  v_reason := CASE
    WHEN v_role IS NULL OR NOT (v_rules->'roles') ? v_role THEN 'role'
    WHEN now() > v_window THEN 'window'
    WHEN v_sent >= (v_rules->>'max_per_night')::integer THEN 'limit'
  END;

  RETURN jsonb_build_object(
    'eligible', v_reason IS NULL,
    'reason', v_reason,
    'role', v_role,
    'title', e.title,
    'start_at', e.start_at,
    'end_at', e.end_at,
    'ticket_url', e.external_ticket_url,
    'window_end', v_window,
    'sent', v_sent,
    'max', (v_rules->>'max_per_night')::integer
  );
END;
$$;

-- ── L'audience : les acheteurs d'un billet valide de la soirée ──────────────
CREATE OR REPLACE FUNCTION public._crm_practical_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (lower(xt.buyer_email))
         lower(btrim(xt.buyer_email))::text,
         NULLIF(btrim(xt.buyer_first_name), '')::text,
         NULLIF(btrim(xt.buyer_last_name), '')::text,
         NULL::uuid,
         -- Pas de jeton : un e-mail pratique n'a ni lien ni en-tête de
         -- désinscription (rien à quitter, c'est l'information d'un achat).
         NULL::uuid
    FROM public.email_campaigns c
    JOIN public.events ev
      ON ev.id = c.event_id AND ev.external_source IS NOT NULL
     AND public.marketing_scope_match(ev.venue_id, ev.organizer_user_id, c.venue_id, c.organizer_user_id)
    JOIN public.external_tickets xt
      ON xt.event_id = c.event_id
     AND xt.status = 'valid'
     AND public.marketing_scope_match(xt.venue_id, xt.organizer_user_id, c.venue_id, c.organizer_user_id)
   WHERE c.id = p_campaign_id AND c.practical
     AND xt.buyer_email IS NOT NULL
     AND btrim(xt.buyer_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   ORDER BY lower(xt.buyer_email), xt.purchased_at DESC NULLS LAST;
$$;

-- ── Lecture pour le tiroir de la soirée et l'éditeur ─────────────────────────
CREATE OR REPLACE FUNCTION public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_state jsonb;
  v_holders integer := 0;
  v_reach integer := 0;
  v_optin integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_state := public._crm_practical_night_state(p_venue_id, p_organizer_user_id, p_event_id, NULL);
  IF v_state->>'reason' = 'not_mirror' THEN RETURN v_state; END IF;

  WITH h AS (
    SELECT DISTINCT lower(btrim(xt.buyer_email)) AS addr
      FROM public.external_tickets xt
     WHERE xt.event_id = p_event_id AND xt.status = 'valid'
       AND public.marketing_scope_match(xt.venue_id, xt.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND xt.buyer_email IS NOT NULL
       AND btrim(xt.buyer_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
  SELECT count(*),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = h.addr)),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
              AND lower(ns.email) = h.addr AND ns.opted_in))
    INTO v_holders, v_reach, v_optin
    FROM h;

  RETURN v_state || jsonb_build_object(
    'holders', v_holders, 'reachable', v_reach, 'marketing_optin', v_optin,
    'yunits_per_email', (public.crm_practical_email_rules()->>'yunits_per_email')::integer
  );
END;
$$;

-- ── Vérification complète d'une campagne (Studio, send-campaign, garde) ─────
CREATE OR REPLACE FUNCTION public.crm_practical_email_check(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  c record;
  v_state jsonb;
  v_issues jsonb;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR NOT c.practical THEN
    RETURN jsonb_build_object('practical', false, 'ok', true, 'issues', '[]'::jsonb);
  END IF;
  IF NOT public.crm_scope_allowed(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_state := public._crm_practical_night_state(c.venue_id, c.organizer_user_id, c.event_id, c.id);
  v_issues := public._crm_practical_content_issues(c.blocks_json, c.subject, c.preheader, c.event_id,
                                                   v_state->>'ticket_url');
  RETURN jsonb_build_object(
    'practical', true,
    'ok', jsonb_array_length(v_issues) = 0 AND COALESCE((v_state->>'eligible')::boolean, false),
    'issues', v_issues,
    'night', v_state
  );
END;
$$;

-- ── La garde ────────────────────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE, nommée `trg_b_…` pour passer AVANT
-- trg_guard_crm_sender_identity (ordre alphabétique) : elle pose product =
-- 'crm', que la garde de l'identité lit.
CREATE OR REPLACE FUNCTION public.guard_crm_practical_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_state jsonb;
  v_issues jsonb;
  v_going boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.practical AND NOT NEW.practical THEN
    RAISE EXCEPTION 'crm_practical_locked' USING ERRCODE = 'P0001',
      HINT = 'Un e-mail pratique le reste : en créer un autre pour une campagne marketing.';
  END IF;
  IF NOT NEW.practical THEN
    -- Une campagne CRM « informative » qui n'est pas un e-mail pratique
    -- échapperait aux règles de pression sans rien gagner : le CRM n'a que
    -- deux types, marketing (registre de consentement) ou pratique.
    IF NEW.product = 'crm' AND NEW.type = 'informational'
       AND (TG_OP = 'INSERT' OR OLD.type IS DISTINCT FROM NEW.type OR OLD.product IS DISTINCT FROM NEW.product) THEN
      RAISE EXCEPTION 'crm_informational_requires_practical' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.venue_id IS NULL AND NEW.organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'crm_practical_scope' USING ERRCODE = 'P0001';
  END IF;

  NEW.type := 'informational';
  NEW.product := 'crm';
  NEW.exclusions_json := '{}'::jsonb;

  -- Jamais combinable : ni autre audience, ni segment, ni A/B, ni renvoi,
  -- ni relance, ni enfant d'automatisation.
  IF (jsonb_typeof(NEW.audiences_json) = 'array' AND jsonb_array_length(NEW.audiences_json) > 0)
     OR NEW.segment_id IS NOT NULL THEN
    RAISE EXCEPTION 'crm_practical_audience' USING ERRCODE = 'P0001',
      HINT = 'Un e-mail pratique part aux détenteurs de la soirée, seuls.';
  END IF;
  NEW.audiences_json := '[]'::jsonb;
  IF COALESCE(NEW.ab_enabled, false) OR COALESCE(NEW.resend_enabled, false) OR COALESCE(NEW.followup_enabled, false)
     OR NEW.automation_id IS NOT NULL OR NEW.child_kind IS NOT NULL OR NEW.parent_campaign_id IS NOT NULL THEN
    RAISE EXCEPTION 'crm_practical_feature' USING ERRCODE = 'P0001',
      HINT = 'Ni A/B, ni renvoi, ni relance sur un e-mail pratique.';
  END IF;
  IF NEW.event_id IS NULL THEN
    RAISE EXCEPTION 'crm_practical_event' USING ERRCODE = 'P0001';
  END IF;

  -- Le contenu et la soirée se jugent quand l'e-mail part (envoi, programmé)
  -- et à chaque retouche des blocs pendant qu'il part. Les mises à jour des
  -- compteurs (webhook, tranches) ne relisent rien.
  v_going := NEW.status IN ('sending', 'scheduled')
         AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
              OR OLD.blocks_json IS DISTINCT FROM NEW.blocks_json
              OR OLD.subject IS DISTINCT FROM NEW.subject
              OR OLD.preheader IS DISTINCT FROM NEW.preheader
              OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at);
  IF NOT v_going AND TG_OP = 'UPDATE' AND OLD.event_id IS NOT DISTINCT FROM NEW.event_id THEN
    RETURN NEW;
  END IF;

  v_state := public._crm_practical_night_state(NEW.venue_id, NEW.organizer_user_id, NEW.event_id, NEW.id);
  IF v_state->>'reason' = 'not_mirror' THEN
    RAISE EXCEPTION 'crm_practical_event' USING ERRCODE = 'P0001',
      HINT = 'Un e-mail pratique vise une soirée de la billetterie connectée de cet espace.';
  END IF;
  IF NOT v_going THEN RETURN NEW; END IF;

  v_issues := public._crm_practical_content_issues(NEW.blocks_json, NEW.subject, NEW.preheader, NEW.event_id,
                                                   v_state->>'ticket_url');
  IF jsonb_array_length(v_issues) > 0 THEN
    RAISE EXCEPTION 'crm_practical_content' USING ERRCODE = 'P0001',
      DETAIL = v_issues::text,
      HINT = 'Un e-mail pratique ne vend rien : ni tarif, ni table, ni autre soirée, ni code promo.';
  END IF;

  -- Une campagne déjà partie (tranche suivante, reprise) ne se rejuge pas sur
  -- la fenêtre ou le plafond : elle a été jugée au départ.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('sending', 'paused') AND NEW.status = 'sending' THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE((v_state->>'eligible')::boolean, false) THEN
    RAISE EXCEPTION '%', 'crm_practical_' || (v_state->>'reason') USING ERRCODE = 'P0001',
      DETAIL = v_state::text;
  END IF;
  IF NEW.status = 'scheduled' AND NEW.scheduled_at IS NOT NULL
     AND NEW.scheduled_at > (v_state->>'window_end')::timestamptz THEN
    RAISE EXCEPTION 'crm_practical_window' USING ERRCODE = 'P0001', DETAIL = v_state::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b_crm_practical_email ON public.email_campaigns;
CREATE TRIGGER trg_b_crm_practical_email
  BEFORE INSERT OR UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_practical_email();

-- ── resolve_campaign_audience : la branche pratique passe en premier ────────
-- Corps repris de la prod (pg_get_functiondef, 18/10) ; seule la branche
-- `practical` est ajoutée, juste après l'autorisation.
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
  -- Mode de combinaison des audiences cochées : 'any' (réunir, défaut) ou
  -- 'all' (croiser : le contact doit être dans CHAQUE audience cochée).
  v_match_all boolean := false;
  v_aud_n integer := 0;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := COALESCE((v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin(), false);
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  -- E-mail pratique (Yuno CRM) : l'équipe de l'espace le compose aussi.
  IF v_campaign.practical AND NOT v_is_authorized THEN
    v_is_authorized := public.crm_scope_allowed(v_campaign.venue_id, v_campaign.organizer_user_id);
  END IF;
  IF NOT COALESCE(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── E-mail pratique (Yuno CRM, 20261019150000) ───────────────────────────
  -- Les détenteurs d'un billet valide de la soirée, seuls, sans accord
  -- marketing : l'information d'un achat, jamais une audience combinable.
  IF v_campaign.practical THEN
    RETURN QUERY SELECT * FROM public._crm_practical_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Console Yuno CRM ─────────────────────────────────────────────────────
  -- Audiences {kind:'crm', segmentId?, def} : la base clients du CRM, filtrée
  -- par la même définition que l'écran Clients (_crm_filter_sql), et toujours
  -- passée par le registre de consentement de la portée (_crm_campaign_audience).
  IF jsonb_typeof(v_campaign.audiences_json) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.audiences_json) x WHERE x->>'kind' = 'crm') THEN
    RETURN QUERY SELECT * FROM public._crm_campaign_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Portée plateforme ────────────────────────────────────────────────────
  -- Yuno écrit à SA base, jamais à celle d'un club. Une seule source : le
  -- registre plateforme (`newsletter_subscriptions` avec les deux colonnes de
  -- portée à NULL), alimenté par `sync_platform_marketing_contacts` et par les
  -- imports attestés. C'est lui qui porte le jeton de désinscription : aucune
  -- adresse ne peut entrer dans une campagne sans porte de sortie.
  IF v_campaign.venue_id IS NULL AND v_campaign.organizer_user_id IS NULL THEN
    v_audiences := COALESCE(v_campaign.audiences_json, '[]'::jsonb);
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    IF jsonb_typeof(v_audiences) <> 'array' OR jsonb_array_length(v_audiences) = 0 THEN
      RETURN;                       -- audience vide ⇒ personne, jamais « tout le monde »
    END IF;

    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    RETURN QUERY
    WITH cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a
          WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.venue_id IS NULL AND c2.organizer_user_id IS NULL
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    -- Les acheteurs d'une soirée ne sont joignables en informatif QUE par ses
    -- parties PRINCIPALES : un co-hôte n'a que les contacts qui l'ont nommé
    -- (case du checkout), jamais toute la liste des acheteurs.
    IF NOT public.campaign_scope_is_event_principal(v_campaign.venue_id, v_campaign.organizer_user_id, v_campaign.event_id) THEN
      RETURN;
    END IF;
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr, vs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), cseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
      ), vseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM seg_emails GROUP BY addr
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(ch.n, 0)::integer AS seg_hits, COALESCE(vh.n, 0)::integer AS vseg_hits,
               COALESCE(p.first_name, vc.first_name, ns.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name, ns.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               ns.import_id AS imp,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
          LEFT JOIN vseg_hits vh ON vh.addr = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE (
           SELECT count(*) FROM jsonb_array_elements(v_audiences) a
            WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN false  -- compté via vseg_hits
              WHEN 'contact_segment' THEN false  -- compté via seg_hits
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      -- Un client est quelqu'un qui est VENU : billets, tables ET guest list
      -- (contact_scope_customers, la même source que la base de contacts).
      -- Avant, seuls les billets comptaient : un organisateur qui ne vend que
      -- des tables n'avait ni VIP, ni habitué, ni dormant.
      SELECT c.email AS addr,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name AS fname0,
             c.last_name AS lname0
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name, a.fname0) AS fname,
             COALESCE(p.last_name, ns.last_name, a.lname0) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a2
          WHERE a2->>'kind' NOT IN ('contact_segment','segment') AND CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR (
             NOT EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                            AND LOWER(t.user_email) = m.addr)
             AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                          WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                            AND LOWER(tr.user_email) = m.addr)));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT c.email,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name, c.last_name
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    )
    SELECT a.email::text,
           a.first_name::text,
           a.last_name::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$function$;

-- ── Droits ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.crm_practical_email_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_practical_email_rules() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._crm_practical_link_issue(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_practical_link_issue(text, text) TO service_role;
REVOKE ALL ON FUNCTION public._crm_practical_text_issue(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_practical_text_issue(text) TO service_role;
REVOKE ALL ON FUNCTION public._crm_practical_content_issues(jsonb, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_practical_content_issues(jsonb, text, text, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._crm_practical_night_state(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_practical_night_state(text, uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public._crm_practical_audience(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_practical_audience(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.crm_practical_night(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_practical_night(text, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_practical_email_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_practical_email_check(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_crm_practical_email() FROM PUBLIC, anon, authenticated;
