-- Yuno CRM — données Shotgun justes : pays, sources des ventes, total de clients.
--
-- Audit du premier vrai compte Shotgun (Amoris × Club Sonore, 17/10/2026,
-- docs/designs/CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md §4.1, §4.2, §4.5) :
--
-- 1. SOURCES. `_crm_ticket_source` ne reconnaissait que des MOTS
--    (`instagram`, `fb`…). Shotgun écrit aussi le DOMAINE qui a amené
--    l'acheteur (`instagram.com`, `l.instagram.com`, `m.facebook.com`,
--    `snapchat.com`) : 6 702 billets valides venus d'Instagram / Facebook
--    tombaient dans « Autres sites ». Le domaine est désormais ramené à sa
--    forme nue (schéma, chemin, `www.`, `l.`, `m.`, `lm.` retirés) puis lu mot
--    par mot. Deux familles naissent :
--      `ex` — e-mail d'un autre outil (Brevo `*.sendibm*.com`, `sp1-brevo.net`,
--             Mailchimp, MailerLite, `shotgun-email`, webmails…) ;
--      `se` — recherche et IA (Google, Bing, ChatGPT, Perplexity…).
--    Miroir EXACT : `sourceFamily` (src/crm/lib/links.ts), testé sur les mêmes
--    valeurs. L'ordre des règles compte : une adresse `mail.google.com` est un
--    webmail (`ex`), pas une recherche.
--    Les listes de familles de `_crm_cond_leaf_check`, `_crm_filter_sql` et
--    `crm_ana_traffic__core` prennent `ex` et `se` (patch de la définition EN
--    BASE, qui échoue si la liste attendue n'y est pas). Les étiquettes `ch:`
--    déjà posées sur les profils d'analyse suivent au prochain calcul de nuit.
--
-- 2. TOTAL DE CLIENTS. La carte Intégrations comptait toutes les adresses
--    (18 058, billets remboursés et annulés compris) quand l'Accueil et Clients
--    comptent 17 367 clients. `ticketing_refresh_stats.buyers` suit désormais la
--    règle de la base de clients (`contact_scope_customers` : au moins un billet
--    valide ou transféré) ; l'écart est rendu à part pour être dit une fois :
--    `buyers_inactive` (adresses dont tous les billets sont remboursés ou
--    annulés) et `no_email_tickets` (billets vendus sans e-mail, au guichet).
--
-- 3. PAYS. `countryCodeFrom` (Deno) construisait sa table depuis Intl en
--    parcourant AA…ZZ : `DD` (RDA) s'affiche « Germany » et passait avant `DE`
--    (293 billets), `CS` avant `RS` (Serbia) ; et les noms anglais d'avant les
--    renommages ISO (Turkey, Czech Republic, Republic Of Moldova) ne trouvaient
--    rien. Le connecteur est corrigé ; ce bloc rattrape les billets déjà en
--    base, connexion par connexion.

-- ── 1. Source d'une vente ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_ticket_source(p_utm jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN s = '' THEN 'of'
    WHEN s = 'yuno' OR s LIKE 'yuno-m-%' THEN 'em'
    WHEN s LIKE 'yuno-s-%' THEN 'sm'
    WHEN s LIKE 'yuno-d-%' THEN 'dm'
    WHEN s LIKE 'yuno-%' THEN COALESCE((
      SELECT CASE
               WHEN tl.utm_source = 'instagram' AND tl.utm_medium = 'story' THEN 'ys'
               WHEN tl.utm_source = 'instagram' AND tl.utm_medium = 'bio' THEN 'yb'
               WHEN tl.utm_source = 'tiktok' AND tl.utm_medium = 'bio' THEN 'yt'
             END
        FROM public.tracked_links tl WHERE lower(tl.code) = substr(s, 6) LIMIT 1), 'yl')
    WHEN s = 'shotgun' THEN 'sg'
    WHEN s = 'direct' THEN 'di'
    WHEN h = '' THEN 'au'
    WHEN h ~ '(^|\.)shotgun\.(live|app|io|fr)$' THEN 'sg'
    WHEN h = 'x'
      OR h ~ '^(x\.com|t\.co|youtu\.be|lnkd\.in|pin\.it|wa\.me|t\.me)$'
      OR h ~ '(^|[^a-z0-9])(instagram|insta|ig|facebook|fb|messenger|tiktok|snapchat|threads|twitter|linkedin|youtube|pinterest|reddit|whatsapp|telegram|discord)([^a-z0-9]|$)'
      THEN 'so'
    WHEN h ~ '(^|[^a-z0-9])(brevo|sendinblue|sendibm[0-9]*|mailchimp|list-manage|mcusercontent|mailerlite|mlsend|mailjet|klaviyo|sendgrid|substack|beehiiv|convertkit|hubspotemail|newsletters?|mailing|emailing|e?mail[0-9]*|webmail|zimbra|outlook|gmail|hotmail|roundcube)([^a-z0-9]|$)|android\.gm$'
      THEN 'ex'
    WHEN h ~ '(^|[^a-z0-9])(google|bing|duckduckgo|qwant|ecosia|yahoo|yandex|baidu|startpage|chatgpt|openai|perplexity)([^a-z0-9]|$)|(^|\.)(claude|mistral)\.ai$|(^|\.)copilot\.microsoft\.com$'
      THEN 'se'
    ELSE 'au' END
  FROM (
    SELECT x.s,
           regexp_replace(regexp_replace(regexp_replace(x.s,
             '^[a-z][a-z0-9+.-]*://', ''),
             '[/?#:].*$', ''),
             '^((www[0-9]*|l|m|lm|mobile|web|mbasic|touch)\.)+', '') AS h
      FROM (SELECT lower(btrim(COALESCE(CASE WHEN jsonb_typeof(p_utm) = 'object' THEN p_utm->>'utm_source' END, ''))) AS s) x
  ) y;
$function$;

-- Les listes de familles acceptées par les filtres, les scénarios et le trafic.
DO $patch$
DECLARE
  f text;
  def text;
  before_n int;
  want int;
BEGIN
  FOREACH f IN ARRAY ARRAY['_crm_cond_leaf_check(text,jsonb,text)', '_crm_filter_sql(jsonb,text)',
                           'crm_ana_traffic__core(text,uuid,text,uuid)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    want := CASE WHEN f LIKE 'crm_ana_traffic%' THEN 3 ELSE 1 END;
    before_n := (length(def) - length(replace(def, '''so'', ''sg'', ''au''', ''))) / length('''so'', ''sg'', ''au''');
    IF position('''ex'', ''se''' IN def) > 0 THEN
      CONTINUE;  -- déjà à jour (migration rejouée)
    END IF;
    IF before_n <> want THEN
      RAISE EXCEPTION 'liste des sources introuvable dans % (% au lieu de %)', f, before_n, want;
    END IF;
    EXECUTE replace(def, '''so'', ''sg'', ''au''', '''so'', ''sg'', ''ex'', ''se'', ''au''');
  END LOOP;
END
$patch$;

-- ── 2. Chiffres de la carte Intégrations ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ticketing_refresh_stats(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_refresh_stats: service_role only' USING ERRCODE = '42501';
  END IF;
  -- `buyers` = clients au sens de la base (au moins un billet valide ou
  -- transféré, règle de contact_scope_customers) : le même nombre que la part
  -- Shotgun de l'Accueil et de Clients. Le reste se dit à part.
  WITH t AS (
    SELECT lower(t.buyer_email) AS em, t.status, t.newsletter_optin, t.scanned_at, t.purchased_at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
  ), p AS (
    SELECT em, bool_or(status IN ('valid', 'transferred')) AS client, bool_or(newsletter_optin IS TRUE) AS optin
      FROM t WHERE em IS NOT NULL GROUP BY em
  )
  SELECT jsonb_build_object(
    'events',          (SELECT count(*) FROM public.external_events e WHERE e.connection_id = p_connection_id),
    'upcoming_events', (SELECT count(*) FROM public.external_events e
                         WHERE e.connection_id = p_connection_id AND e.cancelled_at IS NULL
                           AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()),
    'tickets',         (SELECT count(*) FROM t),
    'valid_tickets',   (SELECT count(*) FROM t WHERE status = 'valid'),
    'buyers',          (SELECT count(*) FROM p WHERE client),
    'buyers_inactive', (SELECT count(*) FROM p WHERE NOT client),
    'optin_buyers',    (SELECT count(*) FROM p WHERE optin),
    'no_email_tickets', (SELECT count(*) FROM t WHERE em IS NULL AND status IN ('valid', 'transferred')),
    'with_email_pct',  (SELECT CASE WHEN count(*) = 0 THEN NULL
                                    ELSE round(100.0 * count(*) FILTER (WHERE em IS NOT NULL) / count(*)) END FROM t),
    'scanned_tickets', (SELECT count(*) FROM t WHERE scanned_at IS NOT NULL),
    'first_purchase_at', (SELECT min(purchased_at) FROM t),
    'last_purchase_at',  (SELECT max(purchased_at) FROM t)
  ) INTO v;

  UPDATE public.ticketing_connections SET stats = v WHERE id = p_connection_id;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.ticketing_refresh_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_refresh_stats(uuid) TO service_role;

-- ── 3. Rattrapage des pays des billets déjà importés ────────────────────────
DO $backfill$
DECLARE
  c record;
  n int := 0;
  k int;
BEGIN
  FOR c IN SELECT id FROM public.ticketing_connections LOOP
    -- Codes retirés → successeur ; regroupements → aucun pays.
    UPDATE public.external_tickets t
       SET country_code = m.code
      FROM (VALUES ('AN', 'CW'), ('BU', 'MM'), ('CS', 'RS'), ('DD', 'DE'), ('DY', 'BJ'), ('FX', 'FR'),
                   ('HV', 'BF'), ('NH', 'VU'), ('RH', 'ZW'), ('SU', 'RU'), ('TP', 'TL'), ('UK', 'GB'),
                   ('VD', 'VN'), ('YD', 'YE'), ('YU', 'RS'), ('ZR', 'CD'),
                   ('EU', NULL), ('EZ', NULL), ('QU', NULL), ('UN', NULL), ('QO', NULL), ('ZZ', NULL),
                   ('XA', NULL), ('XB', NULL)) m(old, code)
     WHERE t.connection_id = c.id AND t.country_code = m.old;
    GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

    -- Noms anglais d'avant les renommages ISO, que la table Intl ne connaît pas
    -- (même liste que COUNTRY_ALIASES du connecteur).
    UPDATE public.external_tickets t
       SET country_code = m.code
      FROM (VALUES ('turkey', 'TR'), ('czechrepublic', 'CZ'), ('republicofmoldova', 'MD'),
                   ('moldovarepublicof', 'MD'), ('russianfederation', 'RU'), ('republicofkorea', 'KR'),
                   ('korearepublicof', 'KR'), ('southkorea', 'KR'), ('democraticpeoplesrepublicofkorea', 'KP'),
                   ('islamicrepublicofiran', 'IR'), ('iranislamicrepublicof', 'IR'), ('syrianarabrepublic', 'SY'),
                   ('laopeoplesdemocraticrepublic', 'LA'), ('unitedrepublicoftanzania', 'TZ'),
                   ('tanzaniaunitedrepublicof', 'TZ'), ('plurinationalstateofbolivia', 'BO'),
                   ('boliviaplurinationalstateof', 'BO'), ('bolivarianrepublicofvenezuela', 'VE'),
                   ('venezuelabolivarianrepublicof', 'VE'), ('macedonia', 'MK'), ('republicofnorthmacedonia', 'MK'),
                   ('swaziland', 'SZ'), ('holland', 'NL'), ('ivorycoast', 'CI'), ('burma', 'MM'), ('myanmar', 'MM'),
                   ('democraticrepublicofthecongo', 'CD'), ('congothedemocraticrepublicofthe', 'CD'),
                   ('republicofthecongo', 'CG'), ('congo', 'CG'), ('hongkong', 'HK'), ('macao', 'MO'), ('macau', 'MO'),
                   ('palestine', 'PS'), ('stateofpalestine', 'PS'), ('palestinestateof', 'PS'), ('capeverde', 'CV'),
                   ('caboverde', 'CV'), ('easttimor', 'TL'), ('vaticancity', 'VA'), ('holysee', 'VA'),
                   ('bruneidarussalam', 'BN'), ('bosniaandherzegovina', 'BA'), ('trinidadandtobago', 'TT'),
                   ('unitedstatesofamerica', 'US'), ('england', 'GB'), ('scotland', 'GB'), ('wales', 'GB'),
                   ('northernireland', 'GB'), ('greatbritain', 'GB')) m(name, code)
     WHERE t.connection_id = c.id AND t.country_code IS NULL
       AND jsonb_typeof(t.raw) = 'object'
       AND lower(regexp_replace(t.raw->>'contact_country', '[^A-Za-z]', '', 'g')) = m.name;
    GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  END LOOP;

  UPDATE public.external_events
     SET country_code = CASE country_code WHEN 'DD' THEN 'DE' WHEN 'CS' THEN 'RS' WHEN 'YU' THEN 'RS'
                                          WHEN 'UK' THEN 'GB' WHEN 'FX' THEN 'FR' WHEN 'SU' THEN 'RU' END
   WHERE country_code IN ('DD', 'CS', 'YU', 'UK', 'FX', 'SU');

  RAISE NOTICE 'pays rattrapés : % billets', n;
END
$backfill$;

-- Les chiffres de chaque connexion, tout de suite à la nouvelle définition.
DO $stats$
DECLARE
  c record;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR c IN SELECT id FROM public.ticketing_connections LOOP
    PERFORM public.ticketing_refresh_stats(c.id);
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
END
$stats$;
