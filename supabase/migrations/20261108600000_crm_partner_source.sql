-- Yuno CRM : la source « Partenaires » (`pa`) et le détail partenaire par partenaire.
--
-- Demande de Paul du 22/10/2026, sur le premier import de 3AM : 71 billets
-- venus des liens de suivi Shotgun de l'organisateur (« assas », « dj-masza »,
-- « luka »…) tombaient dans « Autres sites ». Shotgun écrit dans `utm_source`
-- le NOM du lien de suivi : un nom sans point, qui n'est ni un réseau, ni un
-- outil d'e-mail, ni une recherche, ni une plateforme connue, est un partenaire.
-- (L'ancienne famille `pa`, retirée le 06/10, lisait `utm_medium`, que Shotgun
-- écrase : celle-ci lit `utm_source`, que l'API rend.)
--
-- * _crm_ticket_source : règle `pa`, miroir exact de sourceFamily (links.ts,
--   jeu de cas partagé dans links.test.ts).
-- * _crm_cond_leaf_check, _crm_filter_sql : `pa` accepté par la clé `arr`.
-- * crm_ana_traffic__core : `pa` dans les séries et les sources, et un tableau
--   `partners` : une ligne par lien de suivi Shotgun (ventes seulement : l'API
--   ne rend aucun clic) et par lien Yuno « partenaire » (clics et visiteurs
--   mesurés par Yuno, ventes par sa source `yuno-<code>`).
-- Définitions reprises de la prod (pg_get_functiondef) le 22/10.

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
    -- Partenaire : un NOM sans point (« assas », « dj-masza ») = un lien de suivi
    -- Shotgun que l'organisateur a donné à un promoteur, un DJ, une asso ; sauf
    -- les plateformes et les mots génériques qui arrivent aussi sans domaine.
    -- Miroir : RE_PARTNER_NAME / RE_NOT_PARTNER de src/crm/lib/links.ts.
    WHEN h ~ '^[a-z0-9][a-z0-9_-]{1,59}$'
     AND h !~ '^(localhost|internal|test|null|undefined|none|unknown|other|organic|referral|website|web|site|app|ads?|paid|bandsintown|songkick|spotify|deezer|soundcloud|applemusic|apple-music|residentadvisor|ra|dice|eventbrite|fever|feverup|partiful|linktree|linktr|beacons|linkinbio|bio|qr|qrcode|qr-code|flyer|affiche|poster)$'
      THEN 'pa'
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

CREATE OR REPLACE FUNCTION public._crm_cond_leaf_check(p_k text, p_v jsonb, p_ctx text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  t text := COALESCE(jsonb_typeof(p_v), 'null');
  s text := CASE WHEN jsonb_typeof(p_v) = 'string' THEN p_v #>> '{}' END;
  n text := CASE WHEN jsonb_typeof(p_v) = 'number' THEN p_v::text END;
  ok boolean;
  fam text[] := ARRAY['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series',
                      'early', 'launch', 'last_minute', 'door', 'group', 'table',
                      'discovery', 'passing', 'invited', 'group_first', 'brought', 'channel'];
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  lists text[] := ARRAY['src', 'rc', 'buy', 'arr', 'hyp', 'sc_chance', 'area', 'tags', 'genre', 'fmt',
                        'series', 'country', 'artist', 'ev', 'glev'];
  scalars text[] := ARRAY['gender', 'pass', 'seg', 'last', 'nb', 'sp', 'up', 'grp', 'msg', 'gl', 'ch',
                          'sc_family', 'country_not', 'age_min', 'age_max', 'dist_min', 'dist_max',
                          'last_gt_days', 'last_lt_days', 'nb_min', 'nb_max', 'paid_min', 'click_lt_days',
                          'sp_min', 'basket_min', 'sc_bought', 'sc_entered', 'segment', 'sc_opened',
                          'sc_clicked', 'sc_sms_delivered', 'ntgt'];
BEGIN
  IF p_k IS NULL THEN RETURN 'unknown_key'; END IF;
  -- Le lien court d'un SMS est partagé par soirée : aucun clic par personne.
  IF p_k = 'sc_sms_clicked' THEN RETURN 'soon'; END IF;
  IF NOT (p_k = ANY (lists) OR p_k = ANY (scalars)) THEN RETURN 'unknown_key'; END IF;
  -- Le filtre d'ENTRÉE ne connaît pas encore l'inscription.
  IF p_ctx = 'entry' AND p_k IN ('sc_bought', 'sc_entered', 'sc_opened', 'sc_clicked', 'sc_sms_delivered') THEN
    RETURN 'not_in_entry';
  END IF;

  IF p_k = ANY (lists) THEN
    -- Listes : non vides, et CHAQUE élément lisible (plus strict que le
    -- filtre, qui ignore un élément illisible).
    IF t <> 'array' THEN RETURN 'bad_value'; END IF;
    IF jsonb_array_length(p_v) = 0 THEN RETURN 'bad_value'; END IF;
    ok := NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_v) x
       WHERE NOT COALESCE(CASE WHEN jsonb_typeof(x) <> 'string' THEN false ELSE CASE p_k
         WHEN 'src' THEN x #>> '{}' IN ('shotgun', 'utm', 'import', 'page', 'other')
         WHEN 'rc' THEN x #>> '{}' IN ('mail', 'sms', 'none')
         WHEN 'buy' THEN x #>> '{}' IN ('early', 'launch', 'last_minute', 'door')
         WHEN 'arr' THEN x #>> '{}' IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'pa', 'au', 'di', 'of', 'gl')
         WHEN 'hyp' THEN x #>> '{}' = ANY (fam)
         WHEN 'sc_chance' THEN x #>> '{}' IN ('high', 'medium', 'low')
         WHEN 'area' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 80
         WHEN 'tags' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 60
         WHEN 'genre' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 60
         WHEN 'fmt' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 40
         WHEN 'series' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 300
         WHEN 'country' THEN btrim(x #>> '{}') ~* '^[a-z]{2}$'
         -- Comme _crm_filter_sql : l'artiste n'est pas « nettoyé ».
         WHEN 'artist' THEN (x #>> '{}') ~ '^(id|slug|name):.{1,160}$'
         -- Soirées : id en minuscules (comme _crm_filter_sql), « T » (ce soir), « $event ».
         WHEN 'ev' THEN (x #>> '{}') ~ uuid_re OR x #>> '{}' IN ('T', '$event')
         WHEN 'glev' THEN (x #>> '{}') ~ uuid_re OR x #>> '{}' IN ('T', '$event')
       END END, false));
    RETURN CASE WHEN ok THEN NULL ELSE 'bad_value' END;
  END IF;

  ok := COALESCE(CASE p_k
    WHEN 'gender' THEN s IN ('female', 'male', 'other')
    WHEN 'pass' THEN s IN ('yes', 'no')
    WHEN 'seg' THEN s IN ('hab', 'occ', 'nou', 'end', 'none')
    WHEN 'last' THEN s IN ('0-30', '30-90', '90-180', '180+')
    WHEN 'nb' THEN s IN ('0', '1', '2', '3-5', '6+')
    WHEN 'sp' THEN s IN ('<50', '50-200', '200+')
    WHEN 'up' THEN s IN ('yes', 'no')
    WHEN 'grp' THEN s IN ('group', 'solo', 'brought')
    WHEN 'msg' THEN s IN ('never_clicked', 'clicked_no_buy', 'never_sent')
    WHEN 'gl' THEN s IN ('any', 'only', 'loyal', 'conv', 'noshow')
    WHEN 'ch' THEN s IN ('both', 'email_only', 'sms_only')
    WHEN 'sc_family' THEN s = ANY (fam)
    WHEN 'country_not' THEN btrim(s) ~* '^[a-z]{2}$'
    -- Entiers positifs, lus dans le texte JSON comme _crm_filter_sql les lira.
    WHEN 'age_min' THEN n ~ '^[0-9]{1,3}$'
    WHEN 'age_max' THEN n ~ '^[0-9]{1,3}$'
    WHEN 'dist_min' THEN n ~ '^[0-9]{1,5}$'
    WHEN 'dist_max' THEN n ~ '^[0-9]{1,5}$'
    WHEN 'last_gt_days' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'last_lt_days' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'nb_min' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'nb_max' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'paid_min' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'click_lt_days' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'sp_min' THEN n ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
    WHEN 'basket_min' THEN n ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
    WHEN 'sc_bought' THEN t = 'boolean'
    WHEN 'sc_entered' THEN t = 'boolean'
    WHEN 'segment' THEN s ~* uuid_re
    WHEN 'sc_opened' THEN s ~* '^[a-z0-9_-]{1,32}$'
    WHEN 'sc_clicked' THEN s ~* '^[a-z0-9_-]{1,32}$'
    WHEN 'sc_sms_delivered' THEN s ~* '^[a-z0-9_-]{1,32}$'
    WHEN 'ntgt' THEN CASE WHEN t <> 'object' THEN false ELSE
          (SELECT count(*) FROM jsonb_object_keys(p_v)) = 2
          AND COALESCE(jsonb_typeof(p_v->'e'), '') = 'string' AND COALESCE(jsonb_typeof(p_v->'a'), '') = 'string'
          AND ((p_v->>'e') ~* uuid_re OR p_v->>'e' = '$event')
          AND p_v->>'a' IN ('concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local', 'likely') END
  END, false);
  RETURN CASE WHEN ok THEN NULL ELSE 'bad_value' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text DEFAULT 'p'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  a text := quote_ident(COALESCE(p_alias, 'p'));
  parts text[] := '{}';
  d jsonb := COALESCE(p_def, '{}'::jsonb);
  f jsonb := COALESCE(p_def->'f', '{}'::jsonb);
  v text;
  lst text;
  ors text[];
  q text;
  dig text;
  -- MAIL-09 : toutes les clés de `f` que ce compilateur lit, par type de valeur.
  v_lists text[] := ARRAY['ev', 'rc', 'src', 'tags', 'emails', 'glev', 'area', 'country',
                          'hyp', 'artist', 'genre', 'fmt', 'series', 'buy', 'arr'];
  v_scalars text[] := ARRAY['last', 'last_gt_days', 'nb', 'sp', 'msg', 'gl', 'nb_min', 'nb_max',
                            'last_lt_days', 'sp_min', 'basket_min', 'paid_min', 'age_min', 'age_max',
                            'gender', 'country_not', 'up', 'click_lt_days', 'ch', 'grp',
                            'dist_min', 'dist_max', 'pass'];
  v_objects text[] := ARRAY['ntgt'];
  k text;
  t text;
BEGIN
  -- MAIL-09 : une clé inconnue, ou une valeur d'un type illisible, ne garde
  -- personne. JSON null = filtre vide, comme un NULL SQL.
  IF jsonb_typeof(d) = 'null' THEN d := '{}'::jsonb; f := '{}'::jsonb; END IF;
  IF jsonb_typeof(d) <> 'object' THEN RETURN 'false'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(d) tk WHERE tk NOT IN ('seg', 'f', 'q')) THEN RETURN 'false'; END IF;
  IF COALESCE(jsonb_typeof(d->'seg'), 'null') NOT IN ('string', 'null')
     OR COALESCE(jsonb_typeof(d->'q'), 'null') NOT IN ('string', 'null')
     OR COALESCE(jsonb_typeof(d->'f'), 'null') NOT IN ('object', 'null') THEN
    RETURN 'false';
  END IF;
  IF jsonb_typeof(f) <> 'object' THEN f := '{}'::jsonb; END IF;
  FOR k, t IN SELECT e.key, jsonb_typeof(e.value) FROM jsonb_each(f) e LOOP
    CONTINUE WHEN t = 'null';
    IF k = ANY (v_lists) THEN
      IF t <> 'array' THEN RETURN 'false'; END IF;
    ELSIF k = ANY (v_scalars) THEN
      IF t NOT IN ('string', 'number') THEN RETURN 'false'; END IF;
    ELSIF k = ANY (v_objects) THEN
      IF t <> 'object' THEN RETURN 'false'; END IF;
    ELSE
      RETURN 'false';
    END IF;
  END LOOP;

  v := d->>'seg';
  IF v IS NOT NULL AND v <> 'all' THEN
    IF v IN ('hab', 'occ', 'nou', 'end', 'none') THEN parts := array_append(parts, format('%s.lifecycle = %L', a, v));
    ELSE parts := array_append(parts, 'false'); END IF;
  END IF;

  IF jsonb_typeof(f->'ev') = 'array' AND jsonb_array_length(f->'ev') > 0 THEN
    ors := '{}';
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'ev') x WHERE x ~ '^[0-9a-f-]{36}$';
    IF lst IS NOT NULL THEN ors := array_append(ors, format('%s.events && ARRAY[%s]::uuid[]', a, lst)); END IF;
    IF f->'ev' ? 'T' THEN ors := array_append(ors, format('%s.tonight', a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  v := f->>'last';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0-30' THEN format('%s.last_night >= now() - interval ''30 days''', a)
      WHEN '30-90' THEN format('(%s.last_night < now() - interval ''30 days'' AND %s.last_night >= now() - interval ''90 days'')', a, a)
      WHEN '90-180' THEN format('(%s.last_night < now() - interval ''90 days'' AND %s.last_night >= now() - interval ''180 days'')', a, a)
      WHEN '180+' THEN format('%s.last_night < now() - interval ''180 days''', a)
      ELSE 'false' END);
  END IF;

  -- Un nombre illisible ne retire plus la condition (le segment devenait
  -- « tout le monde ») : il ne garde personne.
  v := f->>'last_gt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night < now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;

  v := f->>'nb';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0' THEN format('%s.nights = 0', a)
      WHEN '1' THEN format('%s.nights = 1', a)
      WHEN '2' THEN format('%s.nights = 2', a)
      WHEN '3-5' THEN format('%s.nights BETWEEN 3 AND 5', a)
      WHEN '6+' THEN format('%s.nights >= 6', a)
      ELSE 'false' END);
  END IF;

  v := f->>'sp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '<50' THEN format('%s.spent < 50', a)
      WHEN '50-200' THEN format('%s.spent BETWEEN 50 AND 200', a)
      WHEN '200+' THEN format('%s.spent > 200', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'rc') = 'array' AND jsonb_array_length(f->'rc') > 0 THEN
    ors := '{}';
    IF f->'rc' ? 'mail' THEN ors := array_append(ors, format('%s.email_ok', a)); END IF;
    IF f->'rc' ? 'sms' THEN ors := array_append(ors, format('%s.phone_ok', a)); END IF;
    IF f->'rc' ? 'none' THEN ors := array_append(ors, format('(NOT %s.email_ok AND NOT %s.phone_ok)', a, a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  IF jsonb_typeof(f->'src') = 'array' AND jsonb_array_length(f->'src') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'src') x WHERE x IN ('shotgun', 'utm', 'import', 'page', 'other');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.source IN (%s)', a, lst) END);
  END IF;

  IF jsonb_typeof(f->'tags') = 'array' AND jsonb_array_length(f->'tags') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst FROM jsonb_array_elements_text(f->'tags') x;
    parts := array_append(parts, format('COALESCE(%s.tags, ''{}'') && ARRAY[%s]::text[]', a, lst));
  END IF;

  v := f->>'msg';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'never_clicked' THEN format('(%s.msg_n >= 3 AND %s.click_n = 0)', a, a)
      WHEN 'clicked_no_buy' THEN format('%s.click_nobuy', a)
      WHEN 'never_sent' THEN format('%s.msg_n = 0', a)
      ELSE 'false' END);
  END IF;

  -- Guest list (20261008100000). Valeur inconnue ⇒ personne.
  v := f->>'gl';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'any' THEN format('%s.gl_n > 0', a)
      WHEN 'only' THEN format('(%s.gl_n > 0 AND %s.paid_n = 0)', a, a)
      WHEN 'loyal' THEN format('(%s.gl_n >= 3 AND %s.paid_n = 0)', a, a)
      WHEN 'conv' THEN format('%s.gl_conv', a)
      WHEN 'noshow' THEN format('%s.gl_noshow >= 2', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'glev') = 'array' AND jsonb_array_length(f->'glev') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'glev') x WHERE x ~ '^[0-9a-f-]{36}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.gl_events && ARRAY[%s]::uuid[]', a, lst) END);
  END IF;

  -- ── Catalogue de segments (20261008200000). Valeur illisible ⇒ personne. ──
  v := f->>'nb_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'nb_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights <= %s', a, v) ELSE 'false' END);
  END IF;
  -- Venu il y a moins de N jours.
  v := f->>'last_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  v := f->>'sp_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.spent >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Dépense par soirée payée (personne sans billet payant : aucune valeur, jamais retenue).
  v := f->>'basket_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.basket >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'paid_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.paid_n >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Âge et genre : une personne dont on ne connaît pas l'âge n'entre dans aucune tranche.
  v := f->>'age_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'age_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'gender';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('female', 'male', 'other') THEN format('%s.gender = %L', a, v) ELSE 'false' END);
  END IF;
  -- Ville (clé de _crm_area_key) et pays (ISO 2).
  IF jsonb_typeof(f->'area') = 'array' AND jsonb_array_length(f->'area') > 0 THEN
    SELECT string_agg(format('%L', public._crm_area_key(x)), ',') INTO lst
      FROM jsonb_array_elements_text(f->'area') x WHERE public._crm_area_key(x) IS NOT NULL;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.area_key IN (%s)', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'country') = 'array' AND jsonb_array_length(f->'country') > 0 THEN
    SELECT string_agg(format('%L', upper(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'country') x WHERE btrim(x) ~* '^[a-z]{2}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.country IN (%s)', a, lst) END);
  END IF;
  v := f->>'country_not';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN btrim(v) ~* '^[a-z]{2}$'
      THEN format('(%s.country IS NOT NULL AND %s.country <> %L)', a, a, upper(btrim(v))) ELSE 'false' END);
  END IF;
  -- Place (billet ou invitation) pour une soirée qui n'a pas encore commencé.
  v := f->>'up';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('%s.upcoming', a)
      WHEN 'no' THEN format('NOT %s.upcoming', a)
      ELSE 'false' END);
  END IF;
  -- A cliqué sur un lien d'un e-mail il y a moins de N jours.
  v := f->>'click_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_click >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  -- Canaux joignables ensemble ou seuls.
  v := f->>'ch';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'both' THEN format('(%s.email_ok AND %s.phone_ok)', a, a)
      WHEN 'email_only' THEN format('(%s.email_ok AND NOT %s.phone_ok)', a, a)
      WHEN 'sms_only' THEN format('(%s.phone_ok AND NOT %s.email_ok)', a, a)
      ELSE 'false' END);
  END IF;

  -- ── Analyse client (20261010110000) : clés pré-calculées (crm_person_profile.tags).
  --    Valeur illisible ⇒ personne. Un contact sans profil (fichier seul) n'a
  --    aucune clé : il n'entre dans aucun de ces filtres.
  IF jsonb_typeof(f->'hyp') = 'array' AND jsonb_array_length(f->'hyp') > 0 THEN
    SELECT string_agg(format('%L', 'h:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'hyp') x WHERE x ~ '^[a-z_]{2,24}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'artist') = 'array' AND jsonb_array_length(f->'artist') > 0 THEN
    SELECT string_agg(format('%L', 'a:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'artist') x WHERE x ~ '^(id|slug|name):.{1,160}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'genre') = 'array' AND jsonb_array_length(f->'genre') > 0 THEN
    SELECT string_agg(format('%L', 'g:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'genre') x WHERE length(btrim(x)) BETWEEN 1 AND 60;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'fmt') = 'array' AND jsonb_array_length(f->'fmt') > 0 THEN
    SELECT string_agg(format('%L', 'fmt:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'fmt') x WHERE length(btrim(x)) BETWEEN 1 AND 40;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'series') = 'array' AND jsonb_array_length(f->'series') > 0 THEN
    SELECT string_agg(format('%L', 's:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'series') x WHERE length(btrim(x)) BETWEEN 1 AND 300;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'buy') = 'array' AND jsonb_array_length(f->'buy') > 0 THEN
    SELECT string_agg(format('%L', 'b:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'buy') x WHERE x IN ('early', 'launch', 'last_minute', 'door');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'grp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('group', 'solo', 'brought')
      THEN format('%L = ANY (%s.an_tags)', 'grp:' || v, a) ELSE 'false' END);
  END IF;
  IF jsonb_typeof(f->'arr') = 'array' AND jsonb_array_length(f->'arr') > 0 THEN
    SELECT string_agg(format('%L', 'ch:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'arr') x
     WHERE x IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'pa', 'au', 'di', 'of', 'gl');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'dist_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'dist_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'pass';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('''pass'' = ANY (%s.an_tags)', a)
      WHEN 'no' THEN format('''loc'' = ANY (%s.an_tags)', a)
      ELSE 'false' END);
  END IF;

  -- « Qui cibler » (20261011110000) : une audience d'une soirée à venir, lue par
  -- la même porte que la RPC crm_night_targets. La portée vient de
  -- _crm_people_build ; une soirée hors de la portée rend personne.
  IF jsonb_typeof(f->'ntgt') = 'object' THEN
    parts := array_append(parts, CASE
      WHEN f->'ntgt'->>'e' ~* '^[0-9a-f-]{36}$'
       AND f->'ntgt'->>'a' IN ('concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local', 'likely')
      THEN format('%s.email IN (SELECT tg.email FROM public._crm_night_target_set(current_setting(''yuno.crm_scope'', true), %L::uuid, %L) tg)',
                  a, f->'ntgt'->>'e', f->'ntgt'->>'a')
      ELSE 'false' END);
  END IF;

  -- Liste fixe (une sélection enregistrée en segment) : 5 000 adresses au plus.
  IF jsonb_typeof(f->'emails') = 'array' AND jsonb_array_length(f->'emails') > 0 THEN
    SELECT string_agg(format('%L', lower(btrim(x))), ',') INTO lst
      FROM (SELECT x FROM jsonb_array_elements_text(f->'emails') x LIMIT 5000) z WHERE x ~ '@';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.email = ANY (ARRAY[%s]::text[])', a, lst) END);
  END IF;

  q := btrim(COALESCE(d->>'q', ''));
  IF q <> '' THEN
    dig := regexp_replace(q, '\D', '', 'g');
    parts := array_append(parts, format(
      '(lower(public.unaccent_safe(COALESCE(%s.first_name, '''') || '' '' || COALESCE(%s.last_name, '''') || '' '' || %s.email)) LIKE %L%s)',
      a, a, a, '%' || replace(replace(lower(public.unaccent_safe(q)), '%', ''), '_', '') || '%',
      CASE WHEN length(dig) >= 3 THEN format(' OR regexp_replace(COALESCE(%s.phone, ''''), ''\D'', '''', ''g'') LIKE %L', a, '%' || dig || '%') ELSE '' END));
  END IF;

  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_series jsonb; v_sources jsonb; v_clicks jsonb; v_new jsonb; v_events jsonb; v_first jsonb; v_gained jsonb;
  v_partners jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Premier achat de chaque client dans l'espace (toutes époques).
  DROP TABLE IF EXISTS _afirst;
  CREATE TEMP TABLE _afirst ON COMMIT DROP AS
  SELECT DISTINCT ON (a.email) a.email, a.id, a.bought_at, a.src, a.ci, a.pi
    FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL
   ORDER BY a.email, a.bought_at, a.id;

  -- Clics sur les messages Yuno (un clic = une personne et une campagne).
  DROP TABLE IF EXISTS _aclk;
  CREATE TEMP TABLE _aclk ON COMMIT DROP AS
  SELECT k.campaign_id, k.email, k.at, k.event_id,
         public._crm_ana_bucket(m, k.at) AS ci,
         CASE m->>'mode'
           WHEN 'hour' THEN CASE WHEN k.at >= (m->>'start')::timestamptz - make_interval(hours => v_n) AND k.at < (m->>'start')::timestamptz THEN 0 END
           WHEN 'day' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                     BETWEEN (m->>'start')::date - v_n AND (m->>'start')::date - 1 THEN 0 END
           WHEN 'month' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                       >= ((m->>'start')::date - interval '12 months')::date
                                   AND public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int) < (m->>'start')::date THEN 0 END
           ELSE NULL END AS pi
    FROM (
      SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS at, c.event_id
        FROM public.email_campaign_events ev
        JOIN public.email_campaigns c ON c.id = ev.campaign_id
       WHERE ev.event_type = 'clicked'
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND ev.created_at > now() - interval '25 months'
         AND public.crm_campaign_is_crm(c.id)
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  -- Agrégé UNE fois par (case, source), puis lu par case : avant, chaque
  -- case × source relisait tous les billets (20261016210000).
  DROP TABLE IF EXISTS _aser;
  CREATE TEMP TABLE _aser ON COMMIT DROP AS
  SELECT a.ci, a.src, round(sum(a.amount), 2) AS rev, sum(a.qty) AS tk
    FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci, a.src;
  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.rev FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.tk FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE(ck.n, 0),
           'new_buyers', COALESCE(nb.n, 0)
         ) ORDER BY g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g
    LEFT JOIN (SELECT c.ci, count(*) AS n FROM _aclk c WHERE c.ci IS NOT NULL GROUP BY c.ci) ck ON ck.ci = g
    LEFT JOIN (SELECT f.ci, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.ci) nb ON nb.ci = g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  WITH cur AS (
    SELECT a.src, count(DISTINCT a.ord) AS orders, sum(a.qty) AS tk, count(DISTINCT a.email) AS buyers,
           round(sum(a.amount), 2) AS rev
      FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.src
  ), prv AS (
    SELECT a.src, sum(a.qty) AS tk FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.src
  ), nf AS (
    SELECT f.src, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.src
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', COALESCE(cur.orders, 0),
           'tickets', COALESCE(cur.tk, 0),
           'buyers', COALESCE(cur.buyers, 0),
           'new_buyers', COALESCE(nf.n, 0),
           'revenue', COALESCE(cur.rev, 0),
           'prev_tickets', COALESCE(prv.tk, 0)
         ) ORDER BY s.o), '[]'::jsonb)
    INTO v_sources
    FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) WITH ORDINALITY s(k, o)
    LEFT JOIN cur ON cur.src = s.k
    LEFT JOIN prv ON prv.src = s.k
    LEFT JOIN nf ON nf.src = s.k;

  -- Partenaires, un par un (20261108600000). Deux sortes :
  -- * `shotgun` : un lien de suivi Shotgun (source `pa`, par nom). Shotgun ne
  --   rapporte ni ses visites ni ses clics : `clicks` / `visitors` restent NULL,
  --   l'écran dit « Bientôt », jamais un chiffre inventé.
  -- * `yuno` : un lien Yuno /go/ de type « partenaire » sur une soirée de la
  --   portée : clics et visiteurs mesurés par Yuno (tracked_link_clicks), ventes
  --   par sa source `yuno-<code>`, même règle que crm_night_links.
  -- Mêmes ventes, même fenêtre et même « nouveau client » que la table des sources.
  DROP TABLE IF EXISTS _apt;
  CREATE TEMP TABLE _apt ON COMMIT DROP AS
  SELECT a.id, a.email, a.qty, a.amount, a.price, a.ord, a.event_id, a.ci, a.pi, a.src,
         lower(btrim(t.utm->>'utm_source')) AS sk
    FROM _atk_all a JOIN public.external_tickets t ON t.id = a.id
   WHERE a.ok AND (a.src = 'pa' OR a.src IN ('ys', 'yb', 'yt', 'yl'));

  DROP TABLE IF EXISTS _aptl;
  CREATE TEMP TABLE _aptl ON COMMIT DROP AS
  SELECT tl.id, tl.code, public.crm_link_source(tl.code) AS sk, tl.event_id,
         COALESCE(NULLIF(btrim(tl.partner_name), ''), NULLIF(btrim(tl.label), ''), tl.code) AS name
    FROM public.tracked_links tl
   WHERE tl.utm_medium = 'partner'
     AND tl.event_id IN (SELECT e.id FROM _aev e)
     AND (m->>'mode' <> 'event' OR tl.event_id = (m->'event'->>'id')::uuid);

  WITH rows AS (
    SELECT 'shotgun'::text AS via, p.sk AS key, p.sk AS name, NULL::uuid AS link_id, NULL::text AS code, NULL::uuid AS event_id
      FROM _apt p WHERE p.src = 'pa' AND p.sk <> '' GROUP BY p.sk
    UNION ALL
    SELECT 'yuno', l.sk, l.name, l.id, l.code, l.event_id FROM _aptl l
  ), sales AS (
    SELECT r.via, r.key,
           sum(p.qty) FILTER (WHERE p.ci IS NOT NULL) AS tk,
           sum(p.qty) FILTER (WHERE p.ci IS NOT NULL AND p.price > 0) AS paid,
           sum(p.qty) FILTER (WHERE p.ci IS NOT NULL AND p.price = 0) AS free,
           count(DISTINCT p.ord) FILTER (WHERE p.ci IS NOT NULL) AS orders,
           count(DISTINCT p.email) FILTER (WHERE p.ci IS NOT NULL) AS buyers,
           round(sum(p.amount) FILTER (WHERE p.ci IS NOT NULL), 2) AS rev,
           count(DISTINCT p.event_id) FILTER (WHERE p.ci IS NOT NULL) AS nights,
           sum(p.qty) FILTER (WHERE p.pi IS NOT NULL) AS prev_tk,
           count(*) FILTER (WHERE p.ci IS NOT NULL AND EXISTS (SELECT 1 FROM _afirst f WHERE f.id = p.id)) AS new_buyers,
           min(p.ci) AS first_ci
      FROM rows r JOIN _apt p ON p.sk = r.key AND (r.via = 'yuno' OR p.src = 'pa')
     GROUP BY r.via, r.key
  ), clk AS (
    SELECT c.tracked_link_id AS link_id, count(*) AS clicks, count(DISTINCT c.visitor_id) AS visitors
      FROM public.tracked_link_clicks c JOIN _aptl l ON l.id = c.tracked_link_id
     WHERE public._crm_ana_bucket(m, c.clicked_at) IS NOT NULL
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'via', r.via, 'name', r.name, 'code', r.code, 'event_id', r.event_id,
           'tickets', COALESCE(s.tk, 0), 'paid', COALESCE(s.paid, 0), 'free', COALESCE(s.free, 0),
           'orders', COALESCE(s.orders, 0), 'buyers', COALESCE(s.buyers, 0), 'new_buyers', COALESCE(s.new_buyers, 0),
           'revenue', COALESCE(s.rev, 0), 'nights', COALESCE(s.nights, 0), 'prev_tickets', COALESCE(s.prev_tk, 0),
           'clicks', CASE WHEN r.via = 'yuno' THEN COALESCE(k.clicks, 0) END,
           'visitors', CASE WHEN r.via = 'yuno' THEN COALESCE(k.visitors, 0) END
         ) ORDER BY COALESCE(s.tk, 0) DESC, COALESCE(k.clicks, 0) DESC, r.name), '[]'::jsonb)
    INTO v_partners
    FROM rows r
    LEFT JOIN sales s ON s.via = r.via AND s.key = r.key
    LEFT JOIN clk k ON k.link_id = r.link_id
   WHERE r.via = 'yuno' OR COALESCE(s.tk, 0) > 0 OR COALESCE(s.prev_tk, 0) > 0;

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE ci IS NOT NULL),
           'prev', count(*) FILTER (WHERE pi IS NOT NULL))
    INTO v_clicks FROM _aclk;

  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND ci IS NOT NULL),
           'new', (SELECT count(*) FROM _afirst WHERE ci IS NOT NULL),
           'prev_buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND pi IS NOT NULL),
           'prev_new', (SELECT count(*) FROM _afirst WHERE pi IS NOT NULL))
    INTO v_new;

  -- Contacts gagnés : entrés dans la base pendant la fenêtre (premier achat,
  -- import, inscription), quelle que soit la porte.
  -- La case de chaque contact se calcule UNE fois (avant : une fois par case
  -- de la série, soit 31 × la base).
  WITH j AS (
    SELECT public._crm_ana_bucket(m, LEAST(f.bought_at, COALESCE(c.added_at, c.created_at))) AS b
      FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
     WHERE c.email IS NOT NULL
  ), jb AS (
    SELECT j.b, count(*) AS n FROM j WHERE j.b IS NOT NULL GROUP BY j.b
  )
  SELECT jsonb_build_object(
           'total', COALESCE((SELECT sum(jb.n) FROM jb), 0),
           'series', (SELECT jsonb_agg(COALESCE(jb.n, 0) ORDER BY g)
                        FROM generate_series(0, v_n - 1) g LEFT JOIN jb ON jb.b = g))
    INTO v_gained;

  -- Soirées : acheteurs, part de nouveaux, clics de vos messages vers elles.
  WITH per AS (
    SELECT a.event_id, count(DISTINCT a.email) AS buyers,
           count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers
      FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
       AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
           'state', CASE WHEN e.night = (m->>'today')::date THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
           'buyers', p.buyers, 'new_buyers', p.new_buyers,
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id)
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'partners', COALESCE(v_partners, '[]'::jsonb),
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;
