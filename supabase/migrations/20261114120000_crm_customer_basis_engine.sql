-- Yuno CRM « Vos clients » — lot 2 : le moteur d'envoi lit la base.
-- Plan : docs/designs/CRM_CUSTOMER_BASIS_PLAN.md § 5.
--
--   1. Audience : une campagne `legal_basis = 'customer'` vise le registre de
--      consentement ET les clients éligibles de l'espace (une ligne par adresse).
--   2. Mise en file : chaque destinataire porte sa base légale ; au plus
--      `max_per_30d` e-mails « clients » par personne et par espace sur 30 jours ;
--      montée progressive (`ramp_cap` personnes « clients » par jour et par espace,
--      les plus récentes d'abord, le reste attend les jours suivants).
--   3. Réclamation : un lot ne mêle jamais deux bases légales (lot 3 : un compte
--      Resend par base), et un client n'est envoyé que si la base de l'espace est
--      ouverte ET la personne encore éligible.
--   4. Désinscription : le jeton d'un client est accepté par la page et par le
--      désabonnement en un clic ; tout « stop » (quel que soit le jeton) rend le
--      client « objected » et vaut pour les deux outils du pro.
--   5. Plainte / rebond d'un client : la personne sort, et le disjoncteur de la
--      base (plus serré que celui des campagnes) peut suspendre la base de l'espace.
--   6. La nuit : la montée double si les 48 dernières heures sont saines.
--   7. Effacement d'un billet : ses données sortent de la base clients.
--   8. Raison affichée dans le pied de page, aperçu d'audience pour la Console.
-- Sans effet tant qu'aucune base n'est ouverte (crm_customer_basis_settings.sending_ready
-- est faux) : aucune campagne `customer` ne peut partir.

SET lock_timeout = '3s';

-- Lignes « clients » d'une adresse (pression 30 j, montée, disjoncteur). Aucune
-- ligne n'y entre avant la première campagne « clients ».
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_customer
  ON public.email_campaign_recipients (lower(email), sent_at) WHERE legal_basis = 'customer';

-- ── 1. Audience ─────────────────────────────────────────────────────────────
-- Copie de _crm_campaign_audience (même filtre, mêmes exclusions) dont la source
-- devient l'union du registre (priorité) et de la base clients.
CREATE OR REPLACE FUNCTION public._crm_customer_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  c public.email_campaigns%ROWTYPE;
  a jsonb;
  v_def jsonb;
  v_preds text[] := '{}';
  v_recent integer;
  v_excl_buyers boolean;
  v_same uuid[];
  v_key text;
  v_open boolean;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR (c.venue_id IS NULL AND c.organizer_user_id IS NULL) OR c.legal_basis <> 'customer' THEN RETURN; END IF;
  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  v_open := public.crm_customer_basis_open(c.venue_id, c.organizer_user_id);

  FOR a IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.audiences_json) = 'array' THEN c.audiences_json ELSE '[]'::jsonb END) x LOOP
    CONTINUE WHEN a->>'kind' IS DISTINCT FROM 'crm';
    v_def := NULL;
    IF COALESCE(a->>'segmentId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (a->>'segmentId')::uuid
         AND ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.organizer_user_id IS NOT NULL AND s.organizer_user_id = c.organizer_user_id));
      CONTINUE WHEN v_def IS NULL;
    ELSE
      v_def := COALESCE(a->'def', '{}'::jsonb);
    END IF;
    v_preds := array_append(v_preds, '(' || public._crm_filter_sql(v_def, 'p') || ')');
  END LOOP;
  IF cardinality(v_preds) = 0 THEN RETURN; END IF;   -- audience vide ⇒ personne

  v_recent := CASE WHEN COALESCE(c.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
                   THEN (c.exclusions_json->>'recentDays')::integer END;
  v_excl_buyers := COALESCE(c.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1') AND c.event_id IS NOT NULL;
  v_same := CASE WHEN v_recent IS NULL THEN NULL ELSE public._email_scope_campaign_ids(c.venue_id, c.organizer_user_id, true) END;

  PERFORM public._crm_people_build(c.venue_id, c.organizer_user_id, NULL);

  RETURN QUERY EXECUTE format($q$
    WITH src AS (
      -- 1. le registre de consentement (comme une campagne à l'accord)
      SELECT p.email::text AS email, COALESCE(p.first_name, ns.first_name)::text AS fn,
             COALESCE(p.last_name, ns.last_name)::text AS ln, ns.user_id, ns.unsubscribe_token AS tok,
             0 AS prio, ns.created_at AS at
        FROM _cp p
        JOIN public.newsletter_subscriptions ns
          ON lower(ns.email) = p.email AND ns.opted_in
         AND ((%1$L::text IS NOT NULL AND ns.venue_id = %1$L::text)
           OR (%2$L::uuid IS NOT NULL AND ns.organizer_user_id = %2$L::uuid))
         AND ns.product = 'crm'
       WHERE p.email_ok AND (%3$s)
      UNION ALL
      -- 2. les clients éligibles (base ouverte seulement)
      SELECT p.email::text, COALESCE(p.first_name, cc.first_name)::text, COALESCE(p.last_name, cc.last_name)::text,
             NULL::uuid, cc.unsubscribe_token, 1, cc.refreshed_at
        FROM _cp p
        JOIN public.crm_customer_contacts cc
          ON cc.scope_key = %9$L AND cc.email = p.email AND cc.state = 'eligible'
       WHERE %10$L::boolean AND (%3$s)
    )
    SELECT DISTINCT ON (s.email) s.email, s.fn, s.ln, s.user_id, s.tok
      FROM src s
     WHERE (%4$L::integer IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.id <> %5$L::uuid
                AND c2.venue_id IS NOT DISTINCT FROM %1$L::text
                AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                AND c2.id = ANY (%8$L::uuid[])
                AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %4$L::integer)
                AND lower(r.email) = s.email))
       AND (NOT %6$L::boolean OR NOT EXISTS (
             SELECT 1 FROM _cp p2 WHERE p2.email = s.email AND %7$L::uuid = ANY (p2.events)))
     ORDER BY s.email, s.prio, s.at DESC
  $q$, c.venue_id, c.organizer_user_id, array_to_string(v_preds, ' OR '), v_recent, c.id, v_excl_buyers,
       c.event_id, v_same, v_key, v_open);
END;
$function$;

-- Branche dans resolve_campaign_audience, juste avant celle de la Console CRM.
DO $$
DECLARE v_def text; v_new text;
  v_anchor text := '  -- ── Console Yuno CRM ─────';
BEGIN
  v_def := pg_get_functiondef('public.resolve_campaign_audience(uuid)'::regprocedure);
  IF position('_crm_customer_campaign_audience' IN v_def) > 0 THEN RETURN; END IF;   -- déjà posée
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'resolve_campaign_audience : repère « Console Yuno CRM » introuvable';
  END IF;
  v_new := replace(v_def, v_anchor,
'  -- ── Yuno CRM « Vos clients » (20261114120000) : registre + clients éligibles ──
  IF v_prod = ''crm'' AND COALESCE(v_campaign.legal_basis, ''consent'') = ''customer'' THEN
    RETURN QUERY SELECT * FROM public._crm_customer_campaign_audience(p_campaign_id);
    RETURN;
  END IF;

' || v_anchor);
  EXECUTE v_new;
END $$;

-- ── 2. Mise en file ─────────────────────────────────────────────────────────
-- Appelée par enqueue_campaign_recipients AVANT le débit de Yunits. Ne touche
-- que les lignes de CET appel (legal_basis encore NULL) : rejouable.
CREATE OR REPLACE FUNCTION public._crm_customer_after_enqueue(p_campaign_id uuid, p_res jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  s public.crm_customer_basis_settings%ROWTYPE;
  v_key text;
  v_cap int;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_skipped int := 0;
  v_ramped int := 0;
  v_rank int := 0;
  v_room int;
  v_day int := 0;
  v_take int;
  v_left int;
BEGIN
  SELECT ec.id, ec.venue_id, ec.organizer_user_id, ec.legal_basis INTO c
    FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND OR c.legal_basis IS DISTINCT FROM 'customer' THEN RETURN p_res; END IF;
  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  SELECT * INTO s FROM public.crm_customer_basis_settings WHERE id = 1;
  SELECT COALESCE(b.ramp_cap, s.ramp_start) INTO v_cap FROM public.crm_customer_basis b WHERE b.scope_key = v_key;
  v_cap := GREATEST(1, COALESCE(v_cap, s.ramp_start));

  -- La base légale de chaque ligne : son jeton dit d'où elle vient.
  UPDATE public.email_campaign_recipients r
     SET legal_basis = CASE WHEN EXISTS (SELECT 1 FROM public.crm_customer_contacts cc
                                          WHERE cc.unsubscribe_token = r.unsubscribe_token AND cc.scope_key = v_key)
                            THEN 'customer' ELSE 'consent' END
   WHERE r.campaign_id = p_campaign_id AND r.legal_basis IS NULL;

  -- Au plus max_per_30d e-mails « clients » par personne et par espace sur 30 jours.
  WITH lim AS (
    SELECT r.id
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.legal_basis = 'customer' AND r.status = 'pending'
       AND r.claimed_at IS NULL AND r.attempts = 0
       AND (SELECT count(*) FROM public.email_campaign_recipients r2
              JOIN public.email_campaigns c2 ON c2.id = r2.campaign_id
             WHERE r2.legal_basis = 'customer' AND lower(r2.email) = lower(r.email) AND r2.campaign_id <> p_campaign_id
               AND c2.venue_id IS NOT DISTINCT FROM c.venue_id AND c2.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id
               AND r2.status IN ('sent', 'bounced', 'complained') AND r2.sent_at > now() - interval '30 days') >= s.max_per_30d
  ), upd AS (
    UPDATE public.email_campaign_recipients r SET status = 'skipped', error_message = 'policy:customer_pressure_30d'
      FROM lim WHERE r.id = lim.id RETURNING 1
  )
  SELECT count(*) INTO v_skipped FROM upd;

  -- Montée progressive : les plus récents d'abord, `v_cap` par jour et par espace,
  -- en tenant compte de ce que les autres campagnes « clients » de l'espace occupent déjà.
  SELECT count(*) INTO v_left FROM public.email_campaign_recipients r
   WHERE r.campaign_id = p_campaign_id AND r.legal_basis = 'customer' AND r.status = 'pending' AND r.next_attempt_at IS NULL AND r.attempts = 0;
  IF v_left > 0 THEN
    CREATE TEMP TABLE IF NOT EXISTS _ccq (id uuid PRIMARY KEY, rk int) ON COMMIT DROP;
    DELETE FROM _ccq;
    INSERT INTO _ccq (id, rk)
    SELECT r.id, row_number() OVER (ORDER BY cc.last_sale_at DESC NULLS LAST, r.id)::int
      FROM public.email_campaign_recipients r
      LEFT JOIN public.crm_customer_contacts cc ON cc.scope_key = v_key AND cc.unsubscribe_token = r.unsubscribe_token
     WHERE r.campaign_id = p_campaign_id AND r.legal_basis = 'customer' AND r.status = 'pending'
       AND r.next_attempt_at IS NULL AND r.attempts = 0;
    WHILE v_rank < v_left AND v_day < 400 LOOP
      SELECT v_cap - count(*) INTO v_room
        FROM public.email_campaign_recipients r2
        JOIN public.email_campaigns c2 ON c2.id = r2.campaign_id
       WHERE r2.legal_basis = 'customer' AND r2.campaign_id <> p_campaign_id
         AND c2.venue_id IS NOT DISTINCT FROM c.venue_id AND c2.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id
         AND r2.status IN ('pending', 'sending', 'sent', 'bounced', 'complained')
         AND (COALESCE(r2.sent_at, r2.next_attempt_at, now()) AT TIME ZONE 'Europe/Paris')::date = v_today + v_day;
      v_take := GREATEST(0, LEAST(v_room, v_left - v_rank));
      IF v_take > 0 AND v_day > 0 THEN
        UPDATE public.email_campaign_recipients r
           SET next_attempt_at = ((v_today + v_day) + time '10:00') AT TIME ZONE 'Europe/Paris'
          FROM _ccq q WHERE q.id = r.id AND q.rk > v_rank AND q.rk <= v_rank + v_take;
        v_ramped := v_ramped + v_take;
      END IF;
      v_rank := v_rank + v_take;
      v_day := v_day + 1;
    END LOOP;
  END IF;

  IF v_skipped > 0 THEN
    UPDATE public.email_campaigns
       SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + v_skipped,
           total_recipients = GREATEST(0, total_recipients - v_skipped)
     WHERE id = p_campaign_id;
  END IF;
  RETURN p_res || jsonb_build_object(
    'customer_pressure_skipped', v_skipped, 'customer_ramped', v_ramped,
    'queued', GREATEST(0, COALESCE((p_res->>'queued')::int, 0) - v_skipped),
    'total', GREATEST(0, COALESCE((p_res->>'total')::int, 0) - v_skipped),
    'remaining', GREATEST(0, COALESCE((p_res->>'remaining')::int, 0) - v_skipped));
END;
$$;

DO $$
DECLARE v_def text; v_new text;
  v_anchor text := '  v_queued := COALESCE((v_res->>''queued'')::integer, 0);';
BEGIN
  v_def := pg_get_functiondef('public.enqueue_campaign_recipients(uuid)'::regprocedure);
  IF position('_crm_customer_after_enqueue' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients : repère du débit introuvable ou multiple';
  END IF;
  v_new := replace(v_def, v_anchor,
'  -- « Vos clients » (20261114120000) : base légale par ligne, pression 30 j, montée progressive.
  v_res := public._crm_customer_after_enqueue(p_campaign_id, v_res);
' || v_anchor);
  EXECUTE v_new;
END $$;

-- ── 3. Réclamation ──────────────────────────────────────────────────────────
DO $$
DECLARE v_def text; v_new text;
  a1 text := '  v_crm boolean;
BEGIN';
  a2 text := '           AND (NOT v_gate OR r.ab_variant IS NOT NULL)
         ORDER BY r.id';
  a3 text := '  -- audit 18/10 : l''accord se relit au moment de l''envoi, pas seulement à la
  -- mise en file.
  IF v_marketing THEN';
BEGIN
  v_def := pg_get_functiondef('public.claim_campaign_recipients(uuid, integer)'::regprocedure);
  IF position('customer_basis_closed' IN v_def) > 0 THEN RETURN; END IF;
  IF position(a1 IN v_def) = 0 OR position(a2 IN v_def) = 0 OR position(a3 IN v_def) = 0 THEN
    RAISE EXCEPTION 'claim_campaign_recipients : un repère est introuvable';
  END IF;
  v_new := replace(v_def, a1, '  v_crm boolean;
  v_cskipped integer := 0;   -- « Vos clients »
BEGIN');
  -- Un lot ne mêle jamais deux bases légales : celle de la première ligne due décide.
  v_new := replace(v_new, a2, '           AND (NOT v_gate OR r.ab_variant IS NOT NULL)
           AND (NOT EXISTS (SELECT 1 FROM public.email_campaigns ecx
                             WHERE ecx.id = p_campaign_id AND ecx.legal_basis = ''customer'')
                OR r.legal_basis IS NOT DISTINCT FROM (
                 SELECT r0.legal_basis FROM public.email_campaign_recipients r0
                  WHERE r0.campaign_id = p_campaign_id AND r0.status = ''pending'' AND r0.batch_key IS NULL
                    AND (r0.next_attempt_at IS NULL OR r0.next_attempt_at <= now())
                    AND (NOT v_gate OR r0.ab_variant IS NOT NULL)
                  ORDER BY r0.id LIMIT 1))
         ORDER BY r.id');
  -- Un client ne part que si la base de l'espace est ouverte et qu'il est encore éligible.
  v_new := replace(v_new, a3, '  -- « Vos clients » (20261114120000) : relu à l''envoi, comme l''accord.
  IF v_ids IS NOT NULL AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                    WHERE r.id = ANY (v_ids) AND r.legal_basis = ''customer'') THEN
    WITH cbad AS (
      SELECT r.id,
             CASE WHEN NOT public.crm_customer_basis_open(c.venue_id, c.organizer_user_id)
                  THEN ''policy:customer_basis_closed'' ELSE ''policy:customer_objected'' END AS reason
        FROM public.email_campaign_recipients r
       WHERE r.id = ANY (v_ids) AND r.legal_basis = ''customer''
         AND (NOT public.crm_customer_basis_open(c.venue_id, c.organizer_user_id)
              OR NOT EXISTS (SELECT 1 FROM public.crm_customer_contacts cc
                              WHERE cc.unsubscribe_token = r.unsubscribe_token AND cc.state = ''eligible''))
    ), cupd AS (
      UPDATE public.email_campaign_recipients q
         SET status = ''skipped'', error_message = cbad.reason, claimed_at = NULL
        FROM cbad WHERE q.id = cbad.id
      RETURNING 1
    )
    SELECT count(*) INTO v_cskipped FROM cupd;
    IF v_cskipped > 0 THEN
      UPDATE public.email_campaigns
         SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + v_cskipped
       WHERE id = p_campaign_id;
      IF public.crm_scope_key(c.venue_id, c.organizer_user_id) IS NOT NULL AND v_crm THEN
        PERFORM public.crm_yunits_refund(public.crm_scope_key(c.venue_id, c.organizer_user_id), v_cskipped,
                                         ''email'', ''email_campaign'', p_campaign_id::text, c.name);
      END IF;
    END IF;
  END IF;

' || a3);
  EXECUTE v_new;
END $$;

-- ── 4. Désinscription ───────────────────────────────────────────────────────
-- Un « stop » rend le client « objected » dans l'espace, quel que soit le jeton.
CREATE OR REPLACE FUNCTION public._crm_customer_mark_objected(
  p_venue_id text, p_organizer_user_id uuid, p_email text, p_source text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.crm_customer_contacts AS c (scope_key, email, state, objected_at, objected_source, refreshed_at)
  SELECT public.crm_scope_key(p_venue_id, p_organizer_user_id), lower(btrim(p_email)), 'objected', now(), p_source, now()
   WHERE public.crm_scope_key(p_venue_id, p_organizer_user_id) IS NOT NULL AND NULLIF(btrim(p_email), '') IS NOT NULL
  ON CONFLICT (scope_key, email) DO UPDATE SET
    state = 'objected',
    objected_at = COALESCE(c.objected_at, now()),
    objected_source = COALESCE(c.objected_source, EXCLUDED.objected_source);
$$;

CREATE OR REPLACE FUNCTION public.preview_unsubscribe(p_token uuid)
RETURNS TABLE(email text, scope_name text, already_unsubscribed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT x.email, x.scope_name, x.already_unsubscribed FROM (
    SELECT ns.email,
           COALESCE(CASE WHEN ns.product = 'crm' THEN public.crm_space_display_name(ns.venue_id, ns.organizer_user_id) END,
                    v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text AS scope_name,
           NOT ns.opted_in AS already_unsubscribed, 0 AS o
      FROM public.newsletter_subscriptions ns
      LEFT JOIN public.venues v ON v.id = ns.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
     WHERE ns.unsubscribe_token = p_token
    UNION ALL
    -- « Vos clients » : le jeton d'un client.
    SELECT cc.email,
           public.crm_space_display_name(b.venue_id, b.organizer_user_id)::text,
           cc.state = 'objected', 1
      FROM public.crm_customer_contacts cc
      JOIN public.crm_customer_basis b ON b.scope_key = cc.scope_key
     WHERE cc.unsubscribe_token = p_token
  ) x ORDER BY x.o LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(p_token uuid)
RETURNS TABLE(success boolean, scope_name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_sub_id uuid;
  v_email text;
  v_scope_name text;
  v_venue_id text;
  v_org_id uuid;
BEGIN
  SELECT ns.id, ns.email,
         COALESCE(CASE WHEN ns.product = 'crm' THEN public.crm_space_display_name(ns.venue_id, ns.organizer_user_id) END,
                  v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text,
         ns.venue_id, ns.organizer_user_id
    INTO v_sub_id, v_email, v_scope_name, v_venue_id, v_org_id
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;

  -- « Vos clients » (20261114120000) : le jeton d'un client, qui n'a pas de ligne au registre.
  IF v_sub_id IS NULL THEN
    SELECT cc.email, public.crm_space_display_name(b.venue_id, b.organizer_user_id), b.venue_id, b.organizer_user_id
      INTO v_email, v_scope_name, v_venue_id, v_org_id
      FROM public.crm_customer_contacts cc
      JOIN public.crm_customer_basis b ON b.scope_key = cc.scope_key
     WHERE cc.unsubscribe_token = p_token
     LIMIT 1;
    IF v_email IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text;
      RETURN;
    END IF;
    -- Trace dans le repoussoir de l'espace (produit CRM) : ni un import ni une page ne le réinscrivent.
    INSERT INTO public.email_opt_outs (venue_id, organizer_user_id, email, reason, product)
    VALUES (v_venue_id, CASE WHEN v_venue_id IS NULL THEN v_org_id END, lower(v_email), 'unsubscribed', 'crm')
    ON CONFLICT DO NOTHING;
  END IF;

  -- EXCEPTION LÉGALE : un « stop » vaut pour TOUS les outils de ce pro (Yuno Tickets et Yuno CRM) :
  -- la ligne du lien ET celle de l'autre produit (même portée, même adresse). Jamais la portée plateforme.
  UPDATE public.newsletter_subscriptions ns
  SET opted_in = false, opted_out_at = now(), updated_at = now()
  WHERE (v_sub_id IS NOT NULL AND ns.id = v_sub_id)
     OR (ns.opted_in
         AND lower(ns.email) = lower(v_email)
         AND ns.venue_id IS NOT DISTINCT FROM v_venue_id
         AND ns.organizer_user_id IS NOT DISTINCT FROM v_org_id
         AND (v_venue_id IS NOT NULL OR v_org_id IS NOT NULL));

  -- Et le client de cet espace ne recevra plus rien par « Vos clients ».
  IF v_venue_id IS NOT NULL OR v_org_id IS NOT NULL THEN
    PERFORM public._crm_customer_mark_objected(v_venue_id, CASE WHEN v_venue_id IS NULL THEN v_org_id END, v_email, 'unsubscribe');
  END IF;

  RETURN QUERY SELECT true, v_scope_name, v_email;
END;
$function$;

-- ── 5. Plainte, rebond, disjoncteur de la base ──────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_customer_basis_breaker(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.crm_customer_basis_settings%ROWTYPE;
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_sent int; v_compl int; v_hard int;
  v_reason text;
BEGIN
  SELECT * INTO s FROM public.crm_customer_basis_settings WHERE id = 1;
  SELECT count(*),
         count(*) FILTER (WHERE r.status = 'complained'),
         count(*) FILTER (WHERE r.status = 'bounced' AND EXISTS (
           SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(r.email) AND es.reason = 'hard_bounce'))
    INTO v_sent, v_compl, v_hard
    FROM public.email_campaign_recipients r
    JOIN public.email_campaigns c ON c.id = r.campaign_id
   WHERE r.legal_basis = 'customer' AND r.status IN ('sent', 'bounced', 'complained')
     AND r.sent_at > now() - interval '7 days'
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END);
  IF v_sent < 300 THEN
    RETURN jsonb_build_object('sent', v_sent, 'complaints', v_compl, 'hard_bounces', v_hard, 'suspended', false);
  END IF;
  v_reason := CASE WHEN v_compl * 100.0 / v_sent >= s.complaint_pause_pct THEN 'complaints'
                   WHEN v_hard * 100.0 / v_sent >= s.bounce_pause_pct THEN 'bounces' END;
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('sent', v_sent, 'complaints', v_compl, 'hard_bounces', v_hard, 'suspended', false);
  END IF;

  UPDATE public.crm_customer_basis
     SET status = 'suspended', suspended_at = now(), suspended_reason = v_reason, suspended_by = NULL, updated_at = now()
   WHERE scope_key = v_key AND status = 'active';
  IF FOUND THEN
    UPDATE public.email_campaigns
       SET status = 'paused', paused_reason = 'customer_basis'
     WHERE legal_basis = 'customer' AND status IN ('sending', 'scheduled')
       AND venue_id IS NOT DISTINCT FROM p_venue_id
       AND organizer_user_id IS NOT DISTINCT FROM (CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END);
    PERFORM public.emit_admin_notification(
      'admin_crm_customer_basis_suspended',
      'Vos clients : base suspendue',
      'La base « Vos clients » de ' || v_key || ' est suspendue (' || v_reason || ') : '
        || v_compl || ' plainte(s), ' || v_hard || ' rebond(s) dur(s) sur ' || v_sent || ' envois en 7 jours.',
      'high', 'crm_account', v_key,
      jsonb_build_object('scope_key', v_key, 'reason', v_reason, 'sent', v_sent, 'complaints', v_compl, 'hard_bounces', v_hard),
      'crm_customer_basis_suspended:' || v_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
  END IF;
  RETURN jsonb_build_object('sent', v_sent, 'complaints', v_compl, 'hard_bounces', v_hard, 'suspended', true, 'reason', v_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_crm_customer_recipient_signal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT ec.venue_id, ec.organizer_user_id INTO c FROM public.email_campaigns ec WHERE ec.id = NEW.campaign_id;
  IF NEW.status = 'complained' THEN
    PERFORM public._crm_customer_mark_objected(c.venue_id, c.organizer_user_id, NEW.email, 'complaint');
  ELSIF EXISTS (SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(NEW.email)) THEN
    PERFORM public._crm_customer_mark_objected(c.venue_id, c.organizer_user_id, NEW.email, 'suppressed');
  END IF;
  PERFORM public._crm_customer_basis_breaker(c.venue_id, c.organizer_user_id);
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;   -- l'observation ne fait jamais échouer le webhook
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_customer_recipient_signal ON public.email_campaign_recipients;
CREATE TRIGGER trg_crm_customer_recipient_signal
  AFTER UPDATE OF status ON public.email_campaign_recipients
  FOR EACH ROW
  WHEN (NEW.legal_basis = 'customer' AND NEW.status IN ('complained', 'bounced') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_crm_customer_recipient_signal();

-- ── 6. La nuit : échéance, version, reconstruction, montée ──────────────────
CREATE OR REPLACE FUNCTION public.crm_customer_basis_nightly()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_done int := 0; v_failed int := 0; v_grown int := 0;
  v_version text := (SELECT declaration_version FROM public.crm_customer_basis_settings WHERE id = 1);
  v_sent int; v_compl int; v_hard int;
BEGIN
  UPDATE public.crm_customer_basis
     SET status = 'suspended', suspended_at = now(),
         suspended_reason = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'version' END, updated_at = now()
   WHERE status = 'active' AND (expires_at <= now() OR declaration_version IS DISTINCT FROM v_version);
  FOR r IN SELECT scope_key, venue_id, organizer_user_id, ramp_cap FROM public.crm_customer_basis WHERE status = 'active' LOOP
    BEGIN
      PERFORM public._crm_customer_contacts_refresh(r.venue_id, r.organizer_user_id);
      v_done := v_done + 1;
      -- Montée : ×2 si des envois « clients » ont eu lieu sur 48 h et qu'ils sont sains.
      SELECT count(*), count(*) FILTER (WHERE x.status = 'complained'),
             count(*) FILTER (WHERE x.status = 'bounced' AND EXISTS (
               SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(x.email) AND es.reason = 'hard_bounce'))
        INTO v_sent, v_compl, v_hard
        FROM public.email_campaign_recipients x
        JOIN public.email_campaigns c ON c.id = x.campaign_id
       WHERE x.legal_basis = 'customer' AND x.status IN ('sent', 'bounced', 'complained')
         AND x.sent_at > now() - interval '48 hours'
         AND c.venue_id IS NOT DISTINCT FROM r.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM r.organizer_user_id;
      IF v_sent > 0 AND v_compl * 100.0 / v_sent < 0.08 AND v_hard * 100.0 / v_sent < 2 THEN
        UPDATE public.crm_customer_basis
           SET ramp_cap = LEAST(COALESCE(ramp_cap, 1500) * 2, 1000000), ramp_day = ramp_day + 1, updated_at = now()
         WHERE scope_key = r.scope_key;
        v_grown := v_grown + 1;
      END IF;
    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('refreshed', v_done, 'grown', v_grown, 'failed', v_failed);
END;
$$;

-- ── 7. Effacement d'un billet ───────────────────────────────────────────────
-- Billet effacé par Yuno (erased_at) ou par la billetterie (adresse retirée) : la
-- personne sort de la base clients. Une opposition reste (adresse seule, sans nom).
CREATE OR REPLACE FUNCTION public.trg_crm_customer_ticket_erased()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text := public.crm_scope_key(NEW.venue_id, NEW.organizer_user_id);
BEGIN
  IF v_key IS NULL OR OLD.buyer_email IS NULL THEN RETURN NEW; END IF;
  DELETE FROM public.crm_customer_contacts
   WHERE scope_key = v_key AND email = lower(btrim(OLD.buyer_email)) AND state <> 'objected';
  UPDATE public.crm_customer_contacts SET first_name = NULL, last_name = NULL, last_event_id = NULL
   WHERE scope_key = v_key AND email = lower(btrim(OLD.buyer_email)) AND state = 'objected';
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_customer_ticket_erased ON public.external_tickets;
CREATE TRIGGER trg_crm_customer_ticket_erased
  AFTER UPDATE OF erased_at, buyer_email ON public.external_tickets
  FOR EACH ROW
  WHEN ((OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
     OR (OLD.buyer_email IS NOT NULL AND NEW.buyer_email IS NULL))
  EXECUTE FUNCTION public.trg_crm_customer_ticket_erased();

-- ── 8. Raison du pied de page, aperçu d'audience ────────────────────────────
-- Pour chaque destinataire « clients » d'un lot : la dernière soirée où il a pris
-- une place, et quand. Lu par send-campaign, jamais par le navigateur.
CREATE OR REPLACE FUNCTION public.get_recipient_customer_reasons(p_campaign_id uuid, p_emails text[])
RETURNS TABLE(email text, night text, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.email, e.title, cc.last_sale_at
    FROM public.email_campaign_recipients r
    JOIN public.crm_customer_contacts cc ON cc.unsubscribe_token = r.unsubscribe_token
    LEFT JOIN public.events e ON e.id = cc.last_event_id
   WHERE r.campaign_id = p_campaign_id AND r.legal_basis = 'customer'
     AND lower(r.email) = ANY (SELECT lower(x) FROM unnest(p_emails) x);
$$;

-- Ce que la campagne viserait : par base légale, et ce que la montée laisse partir aujourd'hui.
CREATE OR REPLACE FUNCTION public.crm_customer_audience_preview(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.email_campaigns%ROWTYPE;
  v_key text;
  v_consent int; v_customer int; v_cap int; v_today int;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR NOT public.crm_scope_allowed(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF c.legal_basis <> 'customer' THEN
    RETURN jsonb_build_object('customer_basis', false);
  END IF;
  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.crm_customer_contacts cc WHERE cc.unsubscribe_token = a.unsubscribe_token)),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.crm_customer_contacts cc WHERE cc.unsubscribe_token = a.unsubscribe_token))
    INTO v_consent, v_customer
    FROM public._crm_customer_campaign_audience(p_campaign_id) a;
  SELECT COALESCE(b.ramp_cap, s.ramp_start) INTO v_cap
    FROM public.crm_customer_basis_settings s LEFT JOIN public.crm_customer_basis b ON b.scope_key = v_key WHERE s.id = 1;
  SELECT count(*) INTO v_today
    FROM public.email_campaign_recipients r JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
   WHERE r.legal_basis = 'customer' AND c2.venue_id IS NOT DISTINCT FROM c.venue_id AND c2.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id
     AND r.status IN ('pending', 'sending', 'sent', 'bounced', 'complained')
     AND (COALESCE(r.sent_at, r.next_attempt_at, now()) AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date;
  RETURN jsonb_build_object('customer_basis', true,
    'open', public.crm_customer_basis_open(c.venue_id, c.organizer_user_id),
    'consent', v_consent, 'customer', v_customer, 'total', v_consent + v_customer,
    'ramp_cap', v_cap, 'today_room', GREATEST(0, v_cap - v_today));
END;
$$;

-- ── Droits ──────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._crm_customer_campaign_audience(uuid)',
    'public._crm_customer_after_enqueue(uuid, jsonb)',
    'public._crm_customer_mark_objected(text, uuid, text, text)',
    'public._crm_customer_basis_breaker(text, uuid)',
    'public.trg_crm_customer_recipient_signal()',
    'public.trg_crm_customer_ticket_erased()',
    'public.get_recipient_customer_reasons(uuid, text[])',
    'public.crm_customer_basis_nightly()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.crm_customer_audience_preview(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.crm_customer_audience_preview(uuid) TO authenticated, service_role;
END $$;
-- preview_unsubscribe et unsubscribe_by_token : CREATE OR REPLACE garde les droits (anon compris,
-- la page de désinscription s'ouvre sans compte).
