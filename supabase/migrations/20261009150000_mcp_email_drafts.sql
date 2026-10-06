-- ════════════════════════════════════════════════════════════════════════════
-- MCP Yuno : l'IA du pro dessine ses e-mails et les dépose en BROUILLON
-- (2026-10-06, plan : docs/designs/MCP_EMAIL_DESIGN_PLAN.md).
--
--   • Le serveur MCP restait en lecture seule (mcp_call, transaction READ
--     ONLY). Ça ne change pas : toute écriture passe par UNE nouvelle porte,
--     mcp_write, qui n'écrit QUE des lignes email_campaigns au statut 'draft'.
--     Rien n'envoie, ne programme, ne teste ni ne supprime.
--   • Une connexion n'écrit que si elle en a reçu le droit au consentement
--     (mcp_grants.can_draft). Les connexions déjà accordées ont dit oui à « ne
--     modifie jamais rien » : elles restent à false, se reconnecter suffit.
--   • Le droit d'écrire les campagnes de l'espace est celui de la Console :
--     CRM = crm_scope_writable (CRM actif) ; Billetterie = titulaire du club ou
--     fondateur de l'organisation (policy « Owners manage email campaigns »).
--   • Trois outils de lecture rejoignent mcp_call : get_email_design_kit
--     (marque, soirées, faits de la soirée visée, brouillons récents),
--     list_email_audiences (audiences et effectifs joignables) et
--     get_email_draft (relire un brouillon pour l'itérer).
--   • email_campaigns.language (pied de page légal et balises Yuno dans la
--     langue de l'e-mail), ai_author et mcp_grant_id (« Préparé par Claude »).
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ── Colonnes ────────────────────────────────────────────────────────────────

ALTER TABLE public.mcp_grants ADD COLUMN IF NOT EXISTS can_draft boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.mcp_grants.can_draft IS
  'La connexion peut créer et modifier des BROUILLONS d''e-mails (mcp_write). Jamais envoyer.';

ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS ai_author text;
ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS mcp_grant_id uuid;
DO $$ BEGIN
  ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_language_check
    CHECK (language IS NULL OR language IN ('fr', 'en', 'es'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_mcp_grant_fk
    FOREIGN KEY (mcp_grant_id) REFERENCES public.mcp_grants(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS email_campaigns_mcp_grant_idx ON public.email_campaigns (mcp_grant_id) WHERE mcp_grant_id IS NOT NULL;
COMMENT ON COLUMN public.email_campaigns.language IS
  'Langue de l''e-mail (fr, en, es ; NULL = fr) : pied de page légal et valeurs des balises Yuno.';
COMMENT ON COLUMN public.email_campaigns.ai_author IS
  'IA qui a préparé ce brouillon via le MCP Yuno (nom du client OAuth). Affichage seulement.';

-- ── Consentement : la connexion reçoit le droit aux brouillons ──────────────

DROP FUNCTION IF EXISTS public.mcp_approve_authorization(uuid, text[], text);
CREATE OR REPLACE FUNCTION public.mcp_approve_authorization(p_request_id uuid, p_spaces text[], p_level text, p_drafts boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  r       public.mcp_authorization_requests%ROWTYPE;
  c       public.mcp_clients%ROWTYPE;
  v_grant uuid;
  v_code  text;
  v_bad   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  -- Une IA ne se connecte jamais pendant un accès assisté : c'est au pro de
  -- décider qui lit ses chiffres, pas au support qui travaille dans son compte.
  IF public.is_support_session() THEN RETURN jsonb_build_object('ok', false, 'error', 'support_session'); END IF;
  IF p_level NOT IN ('analytics', 'customers') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_level'); END IF;
  IF p_spaces IS NULL OR cardinality(p_spaces) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_space');
  END IF;

  SELECT * INTO r FROM public.mcp_authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT x INTO v_bad FROM unnest(p_spaces) x
   WHERE NOT EXISTS (SELECT 1 FROM public._mcp_user_spaces(v_uid) s
                      WHERE s.space_key = x AND (p_level = 'analytics' OR s.customers))
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', CASE WHEN p_level = 'customers' THEN 'customers_not_allowed' ELSE 'forbidden_space' END, 'space', v_bad);
  END IF;

  SELECT * INTO c FROM public.mcp_clients WHERE id = r.client_id;

  -- Une nouvelle connexion de la MÊME IA remplace la précédente : jamais deux
  -- accès parallèles oubliés.
  UPDATE public.mcp_grants SET revoked_at = now(), revoked_by = v_uid, revoked_reason = 'replaced'
   WHERE user_id = v_uid AND client_id = r.client_id AND revoked_at IS NULL;
  UPDATE public.mcp_tokens t SET revoked_at = now()
    FROM public.mcp_grants g
   WHERE t.grant_id = g.id AND g.user_id = v_uid AND g.client_id = r.client_id
     AND g.revoked_reason = 'replaced' AND t.revoked_at IS NULL;

  -- Brouillons d'e-mails : accordés avec la connexion (l'écran de consentement
  -- le dit avant le bouton). Le droit d'écrire dans CHAQUE espace reste celui
  -- de la Console, revérifié à chaque écriture (mcp_write).
  INSERT INTO public.mcp_grants (user_id, client_id, client_name, spaces, level, can_draft)
  VALUES (v_uid, r.client_id, c.client_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_spaces) x), p_level, coalesce(p_drafts, true))
  RETURNING id INTO v_grant;

  v_code := 'yuno_mcp_ac_' || public._mcp_random(32);
  INSERT INTO public.mcp_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource)
  VALUES (public._mcp_sha256(v_code), v_grant, r.client_id, r.redirect_uri, r.code_challenge, r.resource);

  UPDATE public.mcp_authorization_requests
     SET status = 'approved', user_id = v_uid, grant_id = v_grant, decided_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant, 'redirect_uri', r.redirect_uri,
    'params', jsonb_strip_nulls(jsonb_build_object('code', v_code, 'state', r.state, 'iss', 'https://yunoapp.eu')));
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean) TO authenticated;

-- La session dit au Worker si la connexion a le droit aux brouillons (liste
-- des outils).
CREATE OR REPLACE FUNCTION public.mcp_session(p_access_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN jsonb_build_object(
    'ok', true, 'grant_id', a.grant_id, 'level', a.level, 'client_name', a.client_name,
    'drafts', coalesce((SELECT g.can_draft FROM public.mcp_grants g WHERE g.id = a.grant_id), false),
    'first_name', (SELECT nullif(btrim(first_name), '') FROM public.profiles WHERE id = a.user_id),
    'language', (SELECT preferred_language FROM public.profiles WHERE id = a.user_id),
    'spaces', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', s.space_key, 'kind', s.kind, 'name', s.name, 'product', s.product,
        'timezone', s.timezone, 'role', s.role, 'money', s.money,
        'customers', s.customers AND a.level = 'customers') ORDER BY array_position(a.spaces, s.space_key))
      FROM (SELECT DISTINCT ON (space_key) * FROM public._mcp_user_spaces(a.user_id) ORDER BY space_key, role) s
      WHERE s.space_key = ANY (a.spaces)), '[]'::jsonb));
END;
$function$;

-- Réglages → Assistants IA : le droit aux brouillons se lit par connexion.
CREATE OR REPLACE FUNCTION public.mcp_my_connections()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owned text[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT coalesce(array_agg(space_key), '{}') INTO v_owned
    FROM public._mcp_user_spaces(v_uid) WHERE role IN ('owner', 'founder');
  RETURN jsonb_build_object('ok', true, 'connections', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'client_name', g.client_name, 'level', g.level, 'can_draft', g.can_draft,
      'created_at', g.created_at, 'last_used_at', g.last_used_at, 'calls_count', g.calls_count,
      'revoked_at', g.revoked_at, 'revoked_reason', g.revoked_reason,
      'mine', g.user_id = v_uid,
      'drafts_created', (SELECT count(*) FROM public.email_campaigns ec WHERE ec.mcp_grant_id = g.id),
      'person', CASE WHEN g.user_id = v_uid THEN NULL ELSE
                  (SELECT coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email)
                     FROM public.profiles p WHERE p.id = g.user_id) END,
      'spaces', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x,
                    'name', coalesce((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = x),
                                     (SELECT op.display_name FROM public.organizer_profiles op WHERE 'org:' || op.user_id = x), x))), '[]'::jsonb)
                   FROM unnest(g.spaces) x)
    ) ORDER BY g.revoked_at IS NOT NULL, coalesce(g.last_used_at, g.created_at) DESC)
    FROM public.mcp_grants g
    WHERE (g.user_id = v_uid OR g.spaces && v_owned)
      AND (g.revoked_at IS NULL OR g.revoked_at > now() - interval '30 days')), '[]'::jsonb));
END;
$function$;

-- La liste des audiences construit la base clients du CRM (tables temporaires).
CREATE OR REPLACE FUNCTION public._mcp_needs_temp(p_tool text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT p_tool IN ('count_contacts', 'list_customers', 'get_customer_profile', 'list_email_audiences') $function$;

-- ── Petits outils des brouillons ────────────────────────────────────────────

-- Soirées d'un espace pour un e-mail : soirées Yuno (hôte, partenaire,
-- co-hôte) ET soirées miroir d'une billetterie connectée, annulées exclues.
CREATE OR REPLACE FUNCTION public._mcp_email_scope_events(p_venue_id text, p_organizer_user_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(x.id), '{}') FROM public.events x
   WHERE x.cancelled_at IS NULL AND (
     (p_organizer_user_id IS NOT NULL AND (x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id
        OR x.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id))))
     OR (p_venue_id IS NOT NULL AND (x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id
        OR x.id IN (SELECT public.cohost_event_ids_venue(p_venue_id)))))
$$;

-- Produits où l'IA peut déposer un e-mail : la Billetterie de l'espace, et le
-- CRM s'il est actif (compte CRM pur, ou CRM ajouté à un compte Billetterie).
CREATE OR REPLACE FUNCTION public._mcp_email_products(p_venue_id text, p_organizer_user_id uuid, p_space_product text)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_space_product = 'crm' THEN ARRAY['crm']
    WHEN public.crm_scope_has_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id)) THEN ARRAY['suite', 'crm']
    ELSE ARRAY['suite'] END
$$;

-- La personne peut-elle écrire les campagnes de cet espace, dans ce produit ?
-- Miroir des policies d'email_campaigns (« Owners manage email campaigns »,
-- « CRM team manages email campaigns »), en plus strict côté CRM (rôle
-- d'écriture). auth.uid() = la personne (claims posés par mcp_call / mcp_write).
CREATE OR REPLACE FUNCTION public._mcp_space_can_draft(p_uid uuid, p_venue_id text, p_organizer_user_id uuid, p_product text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(CASE
    WHEN p_product = 'crm' THEN
      public.crm_scope_has_crm(public.crm_scope_key(p_venue_id, p_organizer_user_id))
      AND public.crm_scope_writable(p_venue_id, p_organizer_user_id)
    ELSE
      (p_venue_id IS NOT NULL AND public.is_venue_owner(p_uid, p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = p_uid)
  END, false)
$$;

-- Une audience désignée par l'IA (id rendu par list_email_audiences) →
-- éléments d'audiences_json. NULL = id inconnu ou hors de l'espace. Les
-- libellés sont ceux de la Console (yc.cli.seg.*, yc.seg.tpl.*).
CREATE OR REPLACE FUNCTION public._mcp_email_audience(p_id text, p_product text, p_venue_id text, p_organizer_user_id uuid, p_lang text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_id   text := lower(btrim(coalesce(p_id, '')));
  v_i    integer := CASE WHEN p_lang = 'en' THEN 1 WHEN p_lang = 'es' THEN 3 ELSE 2 END;
  v_uuid uuid;
  v_name text;
  v_def  jsonb;
  v_lbl  text[];
BEGIN
  IF p_product = 'crm' THEN
    IF v_id = 'all' THEN
      RETURN (SELECT jsonb_agg(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', k), 'label', lbl[v_i]) ORDER BY o)
                FROM (VALUES (1, 'hab', ARRAY['Regulars', 'Habitués', 'Habituales']),
                             (2, 'occ', ARRAY['Occasional', 'Occasionnels', 'Ocasionales']),
                             (3, 'nou', ARRAY['New', 'Nouveaux', 'Nuevos']),
                             (4, 'end', ARRAY['Dormant', 'Endormis', 'Dormidos']),
                             (5, 'none', ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'])) x(o, k, lbl));
    END IF;
    IF v_id ~ '^lifecycle:(hab|occ|nou|end|none)$' THEN
      v_lbl := CASE split_part(v_id, ':', 2)
        WHEN 'hab' THEN ARRAY['Regulars', 'Habitués', 'Habituales']
        WHEN 'occ' THEN ARRAY['Occasional', 'Occasionnels', 'Ocasionales']
        WHEN 'nou' THEN ARRAY['New', 'Nouveaux', 'Nuevos']
        WHEN 'end' THEN ARRAY['Dormant', 'Endormis', 'Dormidos']
        ELSE ARRAY['Never came', 'Jamais venus', 'Nunca vinieron'] END;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', split_part(v_id, ':', 2)), 'label', v_lbl[v_i]));
    END IF;
    IF v_id ~ '^segment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uuid := split_part(v_id, ':', 2)::uuid;
      SELECT s.name INTO v_name FROM public.crm_segments s
       WHERE s.id = v_uuid
         AND ((p_venue_id IS NOT NULL AND s.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND s.organizer_user_id = p_organizer_user_id));
      IF NOT FOUND THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'segmentId', v_uuid, 'label', v_name));
    END IF;
    IF v_id ~ '^preset:' THEN
      SELECT d, l INTO v_def, v_lbl FROM (VALUES
        ('preset:vip', '{"seg":"all","f":{"sp":"200+"}}'::jsonb, ARRAY['Big spenders', 'Gros dépensiers', 'Grandes gastadores']),
        ('preset:loyal', '{"seg":"all","f":{"nb_min":4}}'::jsonb, ARRAY['Loyal customers (4 nights or more)', 'Fidèles (4 soirées ou plus)', 'Fieles (4 fiestas o más)']),
        ('preset:buyers', '{"seg":"all","f":{"paid_min":1}}'::jsonb, ARRAY['Ticket buyers', 'Acheteurs de billets', 'Compradores de entradas']),
        ('preset:recent', '{"seg":"all","f":{"last_lt_days":90}}'::jsonb, ARRAY['Came in the last 3 months', 'Venus ces 3 derniers mois', 'Vinieron en los últimos 3 meses']),
        ('preset:lapsed', '{"seg":"all","f":{"last_gt_days":90,"last_lt_days":365}}'::jsonb, ARRAY['To reactivate (3 to 12 months)', 'À réactiver (3 à 12 mois)', 'Por reactivar (3 a 12 meses)']),
        ('preset:has_upcoming', '{"seg":"all","f":{"up":"yes"}}'::jsonb, ARRAY['Already have their place', 'Ont déjà leur place', 'Ya tienen su entrada']),
        ('preset:no_upcoming', '{"seg":"all","f":{"up":"no"}}'::jsonb, ARRAY['No place yet for what’s next', 'Pas encore de place pour la suite', 'Sin entrada aún para lo próximo']),
        ('preset:clickers', '{"seg":"all","f":{"click_lt_days":90}}'::jsonb, ARRAY['Clicked in the last 3 months', 'Ont cliqué ces 3 derniers mois', 'Hicieron clic en los últimos 3 meses']),
        ('preset:gl_loyal', '{"seg":"all","f":{"gl":"loyal"}}'::jsonb, ARRAY['Guest list regulars', 'Habitués de la guest list', 'Habituales de la lista de invitados'])
      ) x(k, d, l) WHERE x.k = v_id;
      IF v_def IS NULL THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', v_def, 'label', v_lbl[v_i]));
    END IF;
    RETURN NULL;
  END IF;

  -- Billetterie (Suite) : audiences v2 du moteur d'envoi (resolve_campaign_audience).
  IF v_id IN ('all', 'kind:all_subscribers') THEN RETURN jsonb_build_array(jsonb_build_object('kind', 'all_subscribers')); END IF;
  IF v_id ~ '^kind:(vip|big_spenders|regulars|new_customers|dormant)$' THEN
    RETURN jsonb_build_array(jsonb_build_object('kind', split_part(v_id, ':', 2)));
  END IF;
  IF v_id ~ '^(segment|contact_segment|import):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := split_part(v_id, ':', 2)::uuid;
    IF v_id LIKE 'segment:%' THEN
      IF p_venue_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.venue_segments s WHERE s.id = v_uuid AND s.venue_id = p_venue_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'segment', 'segmentId', v_uuid));
    ELSIF v_id LIKE 'contact_segment:%' THEN
      IF NOT EXISTS (SELECT 1 FROM public.contact_segments s WHERE s.id = v_uuid
                      AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'contact_segment', 'segmentId', v_uuid));
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.email_list_imports i WHERE i.id = v_uuid AND i.superseded_at IS NULL
                      AND i.venue_id IS NOT DISTINCT FROM p_venue_id AND i.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN RETURN NULL; END IF;
      RETURN jsonb_build_array(jsonb_build_object('kind', 'import', 'importId', v_uuid));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Libellé d'une audience Billetterie, dans la langue de la personne.
CREATE OR REPLACE FUNCTION public._mcp_email_kind_label(p_kind text, p_lang text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (CASE p_kind
    WHEN 'all_subscribers' THEN ARRAY['Whole base', 'Toute la base', 'Toda la base']
    WHEN 'vip' THEN ARRAY['VIP (500 € or more)', 'VIP (500 € et plus)', 'VIP (500 € o más)']
    WHEN 'big_spenders' THEN ARRAY['Big spenders (1,000 € or more)', 'Gros dépensiers (1 000 € et plus)', 'Grandes gastadores (1.000 € o más)']
    WHEN 'regulars' THEN ARRAY['Regulars (2 to 4 visits)', 'Habitués (2 à 4 venues)', 'Habituales (2 a 4 visitas)']
    WHEN 'new_customers' THEN ARRAY['New customers', 'Nouveaux clients', 'Nuevos clientes']
    WHEN 'dormant' THEN ARRAY['Dormant (90 days)', 'Endormis (90 jours)', 'Dormidos (90 días)']
    ELSE ARRAY[p_kind, p_kind, p_kind] END)[CASE WHEN p_lang = 'en' THEN 1 WHEN p_lang = 'es' THEN 3 ELSE 2 END]
$$;

-- Ce que l'IA doit savoir d'UNE soirée pour écrire et dessiner : titre, date,
-- lieu, affiche, tarifs (complets ou non), tables, guest list, line-up, page
-- de vente. Les balises Yuno relisent ces mêmes données À L'ENVOI.
CREATE OR REPLACE FUNCTION public._mcp_email_event_facts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  e        public.events%ROWTYPE;
  v_vname  text;
  v_vcity  text;
  v_tz     text;
  v_host   text;
  v_tiers  jsonb;
  v_ext    record;
  v_lineup jsonb;
  v_gl     record;
  v_left   integer;
  v_packs  jsonb;
  v_out    jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT v.name, v.city INTO v_vname, v_vcity FROM public.venues v WHERE v.id = coalesce(e.venue_id, e.partner_venue_id);
  v_tz := coalesce(nullif(btrim(e.timezone), ''), 'Europe/Paris');

  SELECT coalesce(jsonb_agg(a ORDER BY ord), '[]'::jsonb) INTO v_lineup
    FROM public.get_event_lineup_live(ARRAY[e.id]) l,
         jsonb_array_elements(coalesce(l.artists, '[]'::jsonb)) WITH ORDINALITY AS x(a, ord);

  v_out := jsonb_build_object(
    'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'timezone', v_tz,
    'local_start', to_char(e.start_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI'),
    'weekday_iso', extract(isodow FROM e.start_at AT TIME ZONE v_tz)::integer,
    'venue', coalesce(nullif(concat_ws(' — ', coalesce(v_vname, e.location_name), coalesce(v_vcity, e.location_city)), ''), NULL),
    'poster_url', coalesce(e.poster_url, e.image_url),
    'lineup', v_lineup,
    'music_genres', to_jsonb(e.music_genres),
    'description', left(coalesce(e.description, ''), 600));

  IF e.external_source IS NOT NULL THEN
    SELECT * INTO v_ext FROM public.get_external_event_live(ARRAY[e.id]) LIMIT 1;
    RETURN v_out || jsonb_build_object(
      'sales', 'external', 'ticketing', e.external_source,
      'ticket_url', coalesce(v_ext.ticket_url, e.external_ticket_url),
      'sold_out', coalesce(v_ext.sold_out, e.tickets_sold_out, false),
      'venue', coalesce(nullif(v_ext.venue_label, ''), v_out->>'venue'),
      'tiers', coalesce((SELECT jsonb_agg(jsonb_build_object('name', d->>'name', 'price', (d->>'price')::numeric,
                                   'sold_out', coalesce((d->>'out')::boolean, false)))
                           FROM jsonb_array_elements(coalesce(v_ext.deals, '[]'::jsonb)) d), '[]'::jsonb),
      'tables', jsonb_build_object('on_sale', false),
      'guest_list', jsonb_build_object('open', false));
  END IF;

  v_host := public.event_host_slug(e.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'price', r.price, 'detail', nullif(btrim(coalesce(r.description, '')), ''),
           'open', r.is_active AND NOT (r.manually_sold_out OR (r.max_tickets IS NOT NULL AND coalesce(r.tickets_sold, 0) >= r.max_tickets)),
           'sold_out', coalesce(r.manually_sold_out, false) OR (r.max_tickets IS NOT NULL AND coalesce(r.tickets_sold, 0) >= r.max_tickets),
           'includes_drink', r.includes_drink) ORDER BY r.position, r.price), '[]'::jsonb)
    INTO v_tiers
    FROM public.ticket_rounds r
   WHERE r.event_id = e.id AND NOT coalesce(r.hidden, false) AND (r.visible_from IS NULL OR r.visible_from <= now());

  SELECT g.free_before_time, g.includes_drink, coalesce(g.manually_sold_out, false) AS closed INTO v_gl
    FROM public.guest_lists g
   WHERE g.event_id = e.id AND g.is_active AND g.visible_on_club_page
   ORDER BY (g.holder_type = 'club') DESC, g.created_at
   LIMIT 1;

  v_left := CASE WHEN e.tables_enabled IS FALSE THEN NULL ELSE public._event_tables_left(e.id) END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'price', p.base_price, 'guests', p.base_capacity,
           'bottles', p.included_bottles_quota, 'pay_on_site', p.payment_mode = 'on_site') ORDER BY coalesce(p.base_price, p.minimum_spend), p.position), '[]'::jsonb)
    INTO v_packs
    FROM public.table_packs p
   WHERE v_left IS NOT NULL AND p.is_active
     AND (p.event_id = e.id OR (p.event_id IS NULL AND coalesce(e.venue_id, e.partner_venue_id) IS NOT NULL AND p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
     AND NOT (p.id = ANY (coalesce(e.sold_out_pack_ids, '{}'::uuid[])));

  RETURN v_out || jsonb_build_object(
    'sales', 'yuno',
    'page_url', 'https://yunoapp.eu' || CASE WHEN e.slug IS NOT NULL AND v_host IS NOT NULL THEN '/events/' || v_host || '/' || e.slug ELSE '/event/' || e.id END,
    'public', e.is_active AND coalesce(e.is_discoverable, true),
    'ticketing_open', e.ticketing_enabled IS NOT FALSE AND NOT coalesce(e.tickets_sold_out, false),
    'sold_out', coalesce(e.tickets_sold_out, false) OR (jsonb_array_length(v_tiers) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tiers) t WHERE (t->>'open')::boolean)),
    'tiers', CASE WHEN e.ticketing_enabled IS FALSE THEN '[]'::jsonb ELSE v_tiers END,
    'tables', jsonb_build_object('on_sale', v_left IS NOT NULL AND v_left > 0 AND NOT coalesce(e.tables_sold_out, false),
                                 'left', CASE WHEN coalesce(e.tables_sold_out, false) THEN 0 ELSE v_left END, 'packs', v_packs),
    'guest_list', CASE WHEN v_gl IS NULL THEN jsonb_build_object('open', false)
                       ELSE jsonb_build_object('open', NOT (v_gl.closed OR coalesce(e.guest_list_sold_out, false)),
                                               'free_before', left(v_gl.free_before_time::text, 5), 'drink', coalesce(v_gl.includes_drink, false)) END);
END;
$$;

-- ── Les outils de lecture des e-mails (appelés par mcp_call) ────────────────
-- Tournent DANS mcp_call : claims de la personne posés, auth.uid() = elle.

CREATE OR REPLACE FUNCTION public._mcp_email_tool(
  p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_uid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_product);
  v_product  text;
  gate       record;
  v_ids      uuid[];
  v_event    uuid;
  v          jsonb;
  v_aud      jsonb := '[]'::jsonb;
  v_n        integer;
  v_all      integer := 0;
  r          record;
  v_lang     text;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_product = 'crm' THEN 'crm' ELSE 'suite' END);
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  SELECT CASE WHEN preferred_language IN ('fr', 'en', 'es') THEN preferred_language ELSE 'fr' END INTO v_lang FROM public.profiles WHERE id = p_uid;
  v_lang := coalesce(v_lang, 'fr');

  CASE p_tool
  -- ── Kit de design ─────────────────────────────────────────────────────────
  WHEN 'get_email_design_kit' THEN
    v_ids := public._mcp_email_scope_events(v_venue, v_org);
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NOT NULL THEN
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'product', v_product,
      'products_available', to_jsonb(v_products),
      'can_create_drafts', public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product),
      'language_hint', v_lang,
      'brand', CASE WHEN v_venue IS NOT NULL THEN (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', vv.name, 'logo_url', vv.logo_url, 'city', vv.city,
                   'cover_url', vv.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
                                                'facebook', vv.facebook_url, 'x', vv.twitter_url))))
            FROM public.venues vv WHERE vv.id = v_venue)
        ELSE (
          SELECT jsonb_strip_nulls(jsonb_build_object('name', op.display_name, 'logo_url', op.avatar_url, 'city', op.city,
                   'cover_url', op.cover_url,
                   'social', jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))))
            FROM public.organizer_profiles op WHERE op.user_id = v_org) END,
      'sender', (SELECT jsonb_strip_nulls(jsonb_build_object('name', cs.sender_name, 'postal_address', cs.postal_address,
                          'quiet_hours', cs.quiet_hours))
                   FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org)),
      'recent_email_themes', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('campaign', x.name, 'status', x.status,
                   'background', x.theme_json->>'bg', 'card', x.theme_json->>'card', 'text', x.theme_json->>'text',
                   'accent', x.theme_json->>'accent', 'dark', x.theme_json->'dark', 'radius', x.theme_json->'radius')))
            FROM (SELECT ec.name, ec.status, ec.theme_json FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.blocks_version >= 2 AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                     AND jsonb_typeof(ec.theme_json) = 'object'
                   ORDER BY ec.updated_at DESC LIMIT 3) x), '[]'::jsonb),
      'upcoming_events', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
                   'sales', CASE WHEN x.external_source IS NOT NULL THEN 'external' ELSE 'yuno' END,
                   'has_poster', coalesce(x.poster_url, x.image_url) IS NOT NULL) ORDER BY x.start_at)
            FROM (SELECT e.* FROM public.events e
                   WHERE e.id = ANY (v_ids)
                     AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
                     AND (v_product = 'crm' OR e.external_source IS NULL)
                     AND (e.is_active OR e.external_source IS NOT NULL)
                   ORDER BY e.start_at LIMIT 12) x), '[]'::jsonb),
      'event', CASE WHEN v_event IS NOT NULL THEN public._mcp_email_event_facts(v_event) END,
      'recent_drafts', coalesce((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('draft_id', x.id, 'name', x.name, 'subject', nullif(x.subject, '—'),
                   'product', coalesce(x.product, 'suite'), 'prepared_by', x.ai_author, 'edited', to_char(x.updated_at, 'YYYY-MM-DD HH24:MI'))))
            FROM (SELECT ec.* FROM public.email_campaigns ec
                   WHERE ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
                     AND ec.status = 'draft' AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
                   ORDER BY ec.updated_at DESC LIMIT 8) x), '[]'::jsonb));

  -- ── Audiences ─────────────────────────────────────────────────────────────
  WHEN 'list_email_audiences' THEN
    IF v_product = 'crm' THEN
      v := public.crm_email_send_options(v_venue, v_org);   -- construit _cso (joignables)
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'auto', '[]'::jsonb)) x LOOP
        v_all := v_all + coalesce((r.x->>'reach')::integer, 0);
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'lifecycle:' || (r.x->>'key'),
          'label', (public._mcp_email_audience('lifecycle:' || (r.x->>'key'), 'crm', v_venue, v_org, v_lang)->0->>'label'),
          'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', CASE r.x->>'key'
            WHEN 'hab' THEN 'Regulars: came to several nights recently (the account''s regular rule).'
            WHEN 'occ' THEN 'Occasional: came, but not often enough to be a regular.'
            WHEN 'nou' THEN 'New: first night recently, or a ticket for an upcoming night and no night yet.'
            WHEN 'end' THEN 'Dormant: used to come, has not come back for several months.'
            ELSE 'Known contacts who never came to a night (imports, signups).' END)));
      END LOOP;
      v_aud := jsonb_build_array(jsonb_build_object('id', 'all',
                 'label', CASE v_lang WHEN 'en' THEN 'Whole base' WHEN 'es' THEN 'Toda la base' ELSE 'Toute la base' END,
                 'reachable', v_all, 'rule', 'Every contact who accepted your emails (all lifecycle groups). Use it for a global announcement.'))
               || v_aud;
      FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v->'saved', '[]'::jsonb)) x LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', 'segment:' || (r.x->>'id'), 'label', r.x->>'name', 'reachable', coalesce((r.x->>'reach')::integer, 0),
          'open_rate_pct', r.x->'open_pct', 'click_rate_pct', r.x->'click_pct',
          'rule', coalesce(nullif(r.x->>'description', ''), 'Saved segment of the account.'))));
      END LOOP;
      FOR r IN SELECT * FROM (VALUES
          ('preset:vip', 'Spent 200 € or more in total.'),
          ('preset:loyal', 'Came to 4 nights or more.'),
          ('preset:buyers', 'Bought at least one paid ticket.'),
          ('preset:recent', 'Came in the last 3 months.'),
          ('preset:lapsed', 'Last night 3 to 12 months ago.'),
          ('preset:has_upcoming', 'Already have a ticket or an invitation for an upcoming night.'),
          ('preset:no_upcoming', 'No ticket yet for an upcoming night.'),
          ('preset:clickers', 'Clicked an email link in the last 3 months.'),
          ('preset:gl_loyal', 'Came on the guest list 3 nights or more, never paid.')) p(k, rule)
      LOOP
        BEGIN
          EXECUTE format('SELECT count(*)::integer FROM _cso p WHERE (%s)',
                         public._crm_filter_sql(public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->'def', 'p'))
            INTO v_n;
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', r.k, 'label', public._mcp_email_audience(r.k, 'crm', v_venue, v_org, v_lang)->0->>'label',
          'reachable', v_n, 'rule', r.rule, 'kind', 'yuno_preset')));
      END LOOP;
      RETURN jsonb_build_object('ok', true, 'product', 'crm', 'audiences', v_aud,
        'reachable_means', 'Contacts with an email who accepted your emails (newsletter opt-in) and are not suppressed. Yuno sending rules may still protect some at send time.',
        'exclusions', jsonb_build_object(
          'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night (recommended for a last call, not for a first announcement).',
          'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));
    END IF;

    -- Billetterie
    IF v_venue IS NOT NULL THEN
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', r.kind, NULL, NULL);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', v_n, 'rule', r.rule)));
      END LOOP;
      FOR r IN SELECT s.id, s.name FROM public.venue_segments s WHERE s.venue_id = v_venue ORDER BY s.created_at DESC LIMIT 20 LOOP
        BEGIN
          v_n := public.count_campaign_recipients(v_venue, 'promotional', 'custom_segment', NULL, r.id);
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'segment:' || r.id, 'label', r.name, 'reachable', v_n, 'rule', 'Saved customer segment.')));
      END LOOP;
    ELSE
      BEGIN
        v := public.count_organizer_audience_kinds(v_org, NULL);
      EXCEPTION WHEN others THEN v := '{}'::jsonb;
      END;
      FOR r IN SELECT * FROM (VALUES
          ('all_subscribers', 'Every contact who accepted your emails.'),
          ('vip', 'Customers who spent 500 € or more.'),
          ('big_spenders', 'Customers who spent 1,000 € or more.'),
          ('regulars', 'Customers who came 2 to 4 times.'),
          ('new_customers', 'Customers who came once or never.'),
          ('dormant', 'Customers with no purchase for 90 days.')) k(kind, rule)
      LOOP
        v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'id', CASE WHEN r.kind = 'all_subscribers' THEN 'all' ELSE 'kind:' || r.kind END,
          'label', public._mcp_email_kind_label(r.kind, v_lang), 'reachable', (v->>r.kind)::integer, 'rule', r.rule)));
      END LOOP;
    END IF;
    FOR r IN SELECT s.id, s.name, s.description FROM public.contact_segments s
              WHERE s.venue_id IS NOT DISTINCT FROM v_venue AND s.organizer_user_id IS NOT DISTINCT FROM v_org
              ORDER BY s.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'contact_segment:' || r.id, 'label', r.name,
                 'rule', coalesce(nullif(r.description, ''), 'Segment of the contact base (imports and Yuno customers).'))));
    END LOOP;
    FOR r IN SELECT i.id, coalesce(nullif(i.list_name, ''), i.filename) AS name, i.inserted_count FROM public.email_list_imports i
              WHERE i.venue_id IS NOT DISTINCT FROM v_venue AND i.organizer_user_id IS NOT DISTINCT FROM v_org AND i.superseded_at IS NULL
              ORDER BY i.created_at DESC LIMIT 20 LOOP
      v_aud := v_aud || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'import:' || r.id, 'label', r.name,
                 'imported', r.inserted_count, 'rule', 'Imported contact list (only its opted-in contacts receive).')));
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'product', 'suite', 'audiences', v_aud,
      'reachable_means', 'Contacts who accepted your emails (newsletter opt-in) and are not suppressed.',
      'exclusions', jsonb_build_object(
        'exclude_event_buyers', 'Skip people who already bought a ticket for the linked night.',
        'exclude_recent_days', 'Skip people who received an email from this account in the last N days (default 3).'));

  -- ── Relire un brouillon ou une campagne ───────────────────────────────────
  WHEN 'get_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT jsonb_build_object(
        'ok', true, 'draft_id', ec.id, 'name', ec.name, 'status', ec.status,
        'product', coalesce(ec.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(ec.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END),
        'subject', nullif(ec.subject, '—'), 'subject_b', ec.subject_b, 'ab_test', ec.ab_enabled, 'preheader', ec.preheader,
        'language', coalesce(ec.language, 'fr'), 'prepared_by', ec.ai_author,
        'event', CASE WHEN ec.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = ec.event_id) END,
        'audience', ec.audiences_json, 'exclusions', ec.exclusions_json,
        'theme', ec.theme_json, 'social_links', ec.social_links_json,
        'blocks_version', ec.blocks_version, 'sections', ec.blocks_json,
        'sent_at', ec.sent_at, 'recipients', CASE WHEN ec.status IN ('sent', 'sending') THEN ec.recipients_count END,
        'venue_id', ec.venue_id, 'organizer_user_id', ec.organizer_user_id)
      INTO v
      FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    RETURN v;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$$;

-- ── mcp_call : les lectures e-mail rejoignent les autres ────────────────────
-- Seul changement : les trois outils e-mail passent par _mcp_email_tool.
CREATE OR REPLACE FUNCTION public.mcp_call(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a        record;
  s        record;
  v_args   jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space  text;
  v_call   bigint;
  v_res    jsonb;
  v_min    integer;
  v_day    integer;
  v_cust   integer;
  v_has_space boolean;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;

  IF p_tool IS NULL OR p_tool !~ '^[a-z_]{3,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Espace : celui demandé, sinon celui où la personne a le plus de droits
  -- (propriétaire / fondateur, puis admin, puis manager), Yuno Suite avant
  -- Yuno CRM, club avant organisation, puis par nom. `a.spaces` est trié par
  -- clé : son premier élément n'avait aucun sens pour la personne.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  -- Une IA passe parfois le NOM de l'espace (« Organisateur Démo ») au lieu de
  -- sa clé : on le reconnaît plutôt que de répondre « espace hors connexion ».
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space)
     LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Débits : 60 appels / minute, 3 000 / jour, 100 lectures de fiches / jour.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE public._mcp_customer_tool(tool) AND status = 'ok')
    INTO v_min, v_day, v_cust
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';

  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed',
      'spaces', to_jsonb(a.spaces));
  END IF;

  IF v_min >= 60 OR v_day >= 3000 OR (public._mcp_customer_tool(p_tool) AND v_cust >= 100) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  IF public._mcp_customer_tool(p_tool) AND NOT (a.level = 'customers' AND s.customers) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'customers_level_required');
    RETURN jsonb_build_object('ok', false, 'error', 'customers_level_required');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space,
          CASE WHEN length((v_args - 'space')::text) <= 2000 THEN v_args - 'space' ELSE jsonb_build_object('truncated', true) END)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    -- La personne, et elle seule : auth.uid(), auth.role(), auth.jwt() la
    -- désignent pour toutes les RPC appelées ensuite. Les deux formes de claims
    -- sont posées (la forme « claim.x » est lue en priorité par auth.uid()).
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    IF NOT public._mcp_needs_temp(p_tool) THEN
      PERFORM set_config('transaction_read_only', 'on', true);
    END IF;

    IF p_tool IN ('get_email_design_kit', 'list_email_audiences', 'get_email_draft') THEN
      v_res := public._mcp_email_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
    ELSE
      v_res := public._mcp_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.level);
    END IF;
    v_res := public._mcp_redact(v_res, NOT public._mcp_customer_tool(p_tool));
  EXCEPTION WHEN others THEN
    -- Sous-transaction annulée : claims et lecture seule tombent avec elle, on
    -- peut noter l'échec.
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error', 'internal', 'call_id', v_call,
      'message', CASE WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid argument' ELSE 'query failed' END);
  END;

  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, true), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;

-- ── L'unique porte d'écriture : des brouillons d'e-mails ────────────────────

CREATE OR REPLACE FUNCTION public._mcp_email_write(
  p_tool text, p_kind text, p_space_id text, p_space_product text, p_args jsonb, p_uid uuid, p_grant uuid, p_client text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venue    text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org      uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_products text[] := public._mcp_email_products(v_venue, v_org, p_space_product);
  v_product  text;
  v_lang     text;
  v_ids      uuid[];
  v_event    uuid;
  v_has_ev   boolean := p_args ? 'event';
  v_aud      jsonb;
  v_one      jsonb;
  v_id       text;
  v_blocks   jsonb;
  v_theme    jsonb;
  v_social   jsonb;
  v_logo     text;
  v_excl     jsonb;
  v_quiet    boolean := true;
  v_waves    boolean := false;
  v_audtype  text;
  v_segid    uuid;
  c          public.email_campaigns%ROWTYPE;
  v_new      uuid;
  v_net      integer;
  v_prev     jsonb;
BEGIN
  -- ── Le brouillon visé (modification) ou le produit choisi (création) ──
  IF p_tool = 'update_email_draft' THEN
    IF coalesce(p_args->>'draft_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found');
    END IF;
    SELECT * INTO c FROM public.email_campaigns ec
     WHERE ec.id = (p_args->>'draft_id')::uuid
       AND ec.venue_id IS NOT DISTINCT FROM v_venue AND ec.organizer_user_id IS NOT DISTINCT FROM v_org
       AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
    IF c.status <> 'draft' THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_editable', 'status', c.status); END IF;
    v_product := coalesce(c.product, CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(c.audiences_json) a WHERE a->>'kind' = 'crm') THEN 'crm' ELSE 'suite' END);
  ELSIF p_tool = 'create_email_draft' THEN
    v_product := coalesce(nullif(p_args->>'product', ''), CASE WHEN p_space_product = 'crm' THEN 'crm' ELSE 'suite' END);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;
  IF NOT (v_product = ANY (v_products)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_available', 'products', to_jsonb(v_products));
  END IF;
  IF NOT public._mcp_space_can_draft(p_uid, v_venue, v_org, v_product) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden', 'product', v_product);
  END IF;

  v_lang := CASE WHEN p_args->>'language' IN ('fr', 'en', 'es') THEN p_args->>'language' END;

  -- ── Soirée ──
  IF v_has_ev THEN
    IF nullif(btrim(coalesce(p_args->>'event', '')), '') IS NULL OR lower(p_args->>'event') IN ('none', 'null') THEN
      v_event := NULL;
    ELSE
      v_ids := public._mcp_email_scope_events(v_venue, v_org);
      IF v_product = 'suite' THEN
        SELECT coalesce(array_agg(x), '{}') INTO v_ids FROM unnest(v_ids) x
         WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.id = x AND e.external_source IS NULL);
      END IF;
      v_event := public._mcp_resolve_event(p_args->>'event', v_ids);
      IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    END IF;
  END IF;

  -- ── Audience ──
  IF p_args ? 'audience' THEN
    v_aud := '[]'::jsonb;
    FOR v_id IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_args->'audience') = 'array' THEN p_args->'audience' ELSE '[]'::jsonb END) LOOP
      v_one := public._mcp_email_audience(v_id, v_product, v_venue, v_org, coalesce(v_lang, 'fr'));
      IF v_one IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'audience_not_found', 'audience', v_id); END IF;
      v_aud := v_aud || v_one;
    END LOOP;
    -- Un nom posé par l'IA remplace le libellé d'une audience CRM définie par règle.
    IF v_product = 'crm' AND nullif(btrim(coalesce(p_args->>'audience_label', '')), '') IS NOT NULL
       AND jsonb_array_length(v_aud) = 1 AND NOT (v_aud->0 ? 'segmentId') THEN
      v_aud := jsonb_build_array((v_aud->0) || jsonb_build_object('label', left(btrim(p_args->>'audience_label'), 80)));
    END IF;
    IF v_product = 'crm' THEN
      v_audtype := CASE WHEN jsonb_array_length(v_aud) > 0 THEN 'imported_list' END;
    ELSIF jsonb_array_length(v_aud) = 1 THEN
      v_audtype := CASE v_aud->0->>'kind'
        WHEN 'segment' THEN 'custom_segment'
        WHEN 'import' THEN 'imported_list'
        WHEN 'contact_segment' THEN 'imported_list'
        ELSE v_aud->0->>'kind' END;
      v_segid := CASE WHEN v_aud->0->>'kind' = 'segment' AND v_venue IS NOT NULL THEN (v_aud->0->>'segmentId')::uuid END;
    ELSE
      v_audtype := CASE WHEN jsonb_array_length(v_aud) > 0 THEN 'all_subscribers' END;
    END IF;
  END IF;

  -- ── Contenu (déjà nettoyé et contrôlé par le Worker ; revérifié ici) ──
  IF p_args ? 'blocks' THEN
    v_blocks := p_args->'blocks';
    IF jsonb_typeof(v_blocks) <> 'array' OR jsonb_array_length(v_blocks) NOT BETWEEN 1 AND 40
       OR length(v_blocks::text) > 300000
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_blocks) b
                   WHERE jsonb_typeof(b) <> 'object'
                      OR coalesce(b->>'type', '') NOT IN ('html', 'header', 'image', 'text', 'cta', 'divider', 'spacer', 'social',
                                                          'event', 'tickets', 'guestlist', 'table', 'countdown', 'lineup')
                      OR coalesce(b->>'id', '') = '') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;
  IF p_args ? 'theme' THEN
    v_theme := p_args->'theme';
    IF jsonb_typeof(v_theme) <> 'object' OR length(v_theme::text) > 4000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
    END IF;
  END IF;
  IF p_args ? 'exclusions' AND jsonb_typeof(p_args->'exclusions') = 'object' THEN
    v_excl := jsonb_strip_nulls(jsonb_build_object(
      'recentDays', CASE WHEN (p_args->'exclusions'->>'recentDays') ~ '^[0-9]{1,2}$' AND (p_args->'exclusions'->>'recentDays')::integer BETWEEN 1 AND 30
                         THEN (p_args->'exclusions'->>'recentDays')::integer END,
      'excludeEventBuyers', CASE WHEN (p_args->'exclusions'->>'excludeEventBuyers') IN ('true', 'false') THEN (p_args->'exclusions'->>'excludeEventBuyers')::boolean END));
  END IF;

  -- ── Création ──
  IF p_tool = 'create_email_draft' THEN
    IF v_blocks IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_content'); END IF;
    IF v_venue IS NOT NULL THEN
      SELECT vv.logo_url, jsonb_strip_nulls(jsonb_build_object('instagram', vv.instagram_url, 'tiktok', vv.tiktok_url,
               'facebook', vv.facebook_url, 'x', vv.twitter_url))
        INTO v_logo, v_social FROM public.venues vv WHERE vv.id = v_venue;
    ELSE
      SELECT op.avatar_url, jsonb_strip_nulls(jsonb_build_object('instagram', op.instagram_url, 'website', op.website_url))
        INTO v_logo, v_social FROM public.organizer_profiles op WHERE op.user_id = v_org;
    END IF;
    SELECT coalesce(cs.quiet_hours, true), coalesce(cs.waves, false) INTO v_quiet, v_waves
      FROM public.crm_email_settings cs WHERE cs.scope_key = public.crm_scope_key(v_venue, v_org);
    v_quiet := coalesce(v_quiet, true);
    v_waves := coalesce(v_waves, false) AND v_product = 'crm';

    INSERT INTO public.email_campaigns (
      name, type, subject, subject_b, ab_enabled, preheader, blocks_json, blocks_version, theme_json, social_links_json,
      logo_url, event_id, audiences_json, audience_type, segment_id, exclusions_json, quiet_hours,
      throttle_per_hour, throttle_window_minutes, throttle_plan,
      status, venue_id, organizer_user_id, created_by, product, language, ai_author, mcp_grant_id)
    VALUES (
      left(coalesce(nullif(btrim(p_args->>'name'), ''), 'E-mail'), 200), 'promotional',
      left(coalesce(nullif(btrim(p_args->>'subject'), ''), '—'), 250),
      nullif(left(btrim(coalesce(p_args->>'subject_b', '')), 250), ''),
      nullif(btrim(coalesce(p_args->>'subject_b', '')), '') IS NOT NULL,
      left(coalesce(p_args->>'preheader', ''), 300),
      v_blocks, 2, coalesce(v_theme, '{}'::jsonb), coalesce(v_social, '{}'::jsonb),
      v_logo, v_event, coalesce(v_aud, '[]'::jsonb), v_audtype, v_segid,
      coalesce(v_excl, jsonb_build_object('recentDays', 3)), v_quiet,
      CASE WHEN v_waves THEN 500 END, 60, CASE WHEN v_waves THEN jsonb_build_object('mode', 'hour', 'days', 2, 'custom', true) END,
      'draft', v_venue, v_org, p_uid, v_product, v_lang, left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60), p_grant)
    RETURNING * INTO c;
  ELSE
    UPDATE public.email_campaigns ec SET
      name = CASE WHEN nullif(btrim(coalesce(p_args->>'name', '')), '') IS NOT NULL THEN left(btrim(p_args->>'name'), 200) ELSE ec.name END,
      subject = CASE WHEN nullif(btrim(coalesce(p_args->>'subject', '')), '') IS NOT NULL THEN left(btrim(p_args->>'subject'), 250) ELSE ec.subject END,
      subject_b = CASE WHEN p_args ? 'subject_b' THEN nullif(left(btrim(coalesce(p_args->>'subject_b', '')), 250), '') ELSE ec.subject_b END,
      ab_enabled = CASE WHEN p_args ? 'subject_b' THEN nullif(btrim(coalesce(p_args->>'subject_b', '')), '') IS NOT NULL ELSE ec.ab_enabled END,
      preheader = CASE WHEN p_args ? 'preheader' THEN left(coalesce(p_args->>'preheader', ''), 300) ELSE ec.preheader END,
      language = CASE WHEN p_args ? 'language' THEN v_lang ELSE ec.language END,
      event_id = CASE WHEN v_has_ev THEN v_event ELSE ec.event_id END,
      audiences_json = coalesce(v_aud, ec.audiences_json),
      audience_type = CASE WHEN v_aud IS NOT NULL THEN v_audtype ELSE ec.audience_type END,
      segment_id = CASE WHEN v_aud IS NOT NULL THEN v_segid ELSE ec.segment_id END,
      exclusions_json = coalesce(v_excl, ec.exclusions_json),
      theme_json = coalesce(v_theme, ec.theme_json),
      blocks_json = coalesce(v_blocks, ec.blocks_json),
      blocks_version = 2,
      ai_author = coalesce(ec.ai_author, left(coalesce(nullif(btrim(p_client), ''), 'AI'), 60)),
      mcp_grant_id = coalesce(ec.mcp_grant_id, p_grant)
     WHERE ec.id = c.id AND ec.status = 'draft'
    RETURNING * INTO c;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_editable'); END IF;
  END IF;

  -- ── Effectif net de l'audience (ne fait jamais échouer l'écriture) ──
  IF jsonb_array_length(coalesce(c.audiences_json, '[]'::jsonb)) > 0 THEN
    BEGIN
      IF v_product = 'crm' THEN
        v_prev := public.crm_email_audience_preview(v_venue, v_org, c.audiences_json, c.event_id,
                    CASE WHEN (c.exclusions_json->>'recentDays') ~ '^[0-9]+$' THEN (c.exclusions_json->>'recentDays')::integer END,
                    coalesce((c.exclusions_json->>'excludeEventBuyers')::boolean, false), c.id);
        v_net := (v_prev->>'net')::integer;
      ELSE
        v_net := (public.count_campaign_audience(c.id)->>'net')::integer;
      END IF;
    EXCEPTION WHEN others THEN v_net := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'draft_id', c.id, 'created', p_tool = 'create_email_draft', 'name', c.name, 'status', c.status,
    'product', v_product, 'language', coalesce(c.language, 'fr'),
    'subject', nullif(c.subject, '—'), 'ab_test', c.ab_enabled,
    'event', CASE WHEN c.event_id IS NOT NULL THEN (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) FROM public.events e WHERE e.id = c.event_id) END,
    'audience', jsonb_build_object(
      'groups', (SELECT coalesce(jsonb_agg(coalesce(a->>'label', a->>'kind')), '[]'::jsonb) FROM jsonb_array_elements(coalesce(c.audiences_json, '[]'::jsonb)) a),
      'recipients_now', v_net,
      'exclusions', c.exclusions_json),
    'sections', jsonb_array_length(c.blocks_json),
    'venue_id', c.venue_id, 'organizer_user_id', c.organizer_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_write(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          record;
  s          record;
  v_args     jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space    text;
  v_call     bigint;
  v_res      jsonb;
  v_min      integer;
  v_day      integer;
  v_creates  integer;
  v_updates  integer;
  v_can      boolean;
  v_has_space boolean;
  v_summary  jsonb;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_tool NOT IN ('create_email_draft', 'update_email_draft') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Même choix d'espace que mcp_call.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space) LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Journal : un résumé, jamais le HTML entier.
  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'draft_id', v_args->>'draft_id', 'product', v_args->>'product', 'event', left(v_args->>'event', 120),
    'name', left(v_args->>'name', 120), 'subject', left(v_args->>'subject', 160),
    'audience', CASE WHEN jsonb_typeof(v_args->'audience') = 'array' THEN v_args->'audience' END,
    'sections', CASE WHEN jsonb_typeof(v_args->'blocks') = 'array' THEN jsonb_array_length(v_args->'blocks') END,
    'bytes', CASE WHEN v_args ? 'blocks' THEN length((v_args->'blocks')::text) END,
    'language', v_args->>'language'));

  SELECT g.can_draft INTO v_can FROM public.mcp_grants g WHERE g.id = a.grant_id;
  IF NOT coalesce(v_can, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'drafts_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'drafts_not_allowed');
  END IF;
  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed', 'spaces', to_jsonb(a.spaces));
  END IF;

  -- Débits : 60 appels / minute et 3 000 / jour (comme mcp_call), 30
  -- brouillons créés et 200 modifications par jour et par connexion.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE tool = 'create_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_email_draft' AND status = 'ok')
    INTO v_min, v_day, v_creates, v_updates
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';
  IF v_min >= 60 OR v_day >= 3000
     OR (p_tool = 'create_email_draft' AND v_creates >= 30)
     OR (p_tool = 'update_email_draft' AND v_updates >= 200) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    v_res := public._mcp_email_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name);
  EXCEPTION WHEN others THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error',
      CASE WHEN SQLERRM LIKE '%crm_plan_ab_resend%' THEN 'ab_not_in_plan'
           WHEN SQLERRM LIKE '%crm_send_frozen%' OR SQLERRM LIKE '%sending_frozen%' THEN 'sending_frozen'
           WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid_args'
           ELSE 'internal' END,
      'call_id', v_call);
  END;

  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(coalesce(v_res->>'error', 'error'), 300) WHERE id = v_call;
  END IF;
  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, false), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;

-- ── Droits : le Worker seul (clé serveur), jamais un client ─────────────────

REVOKE ALL ON FUNCTION public._mcp_email_scope_events(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_email_products(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_space_can_draft(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_email_audience(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_email_event_facts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_email_kind_label(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_email_tool(text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_email_write(text, text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_call(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_call(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_write(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_write(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_session(text) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_my_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_my_connections() TO authenticated;
REVOKE ALL ON FUNCTION public._mcp_needs_temp(text) FROM PUBLIC, anon, authenticated;
