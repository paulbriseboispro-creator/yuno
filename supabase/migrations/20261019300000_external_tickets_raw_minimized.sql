-- Billets externes : le billet brut ne garde plus ni coordonnée ni champ extrait.
--
-- Plan CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md §5.3 (D6), session S5. Mesuré le 17/10
-- sur la prod : `external_tickets.raw` recopiait tout le billet Shotgun, e-mail,
-- téléphone, nom et date de naissance compris, à côté des colonnes déjà
-- extraites — 66 Mo de JSON sur 89 Mo de lignes vivantes, une copie inutile de
-- données personnelles. S4 (20261018200000) a sorti en colonnes ce que le CRM
-- lisait encore dans `raw` ; cette migration finit le travail :
--
-- 1. `ticketing_minimize_raw(jsonb)` : la règle « ce que le billet brut garde »,
--    miroir EXACT de `minimizeTicketRaw` (supabase/functions/_shared/
--    ticketing-shotgun.ts, testé : la liste des clés ci-dessous est relue par
--    src/lib/__tests__/ticketingShotgun.test.ts). Retirés : tout champ extrait
--    en colonne (noms documentés et noms de repli), la soirée du billet (elle
--    vit dans external_events), la valeur du QR, et toute clé qui désigne une
--    personne (préfixe contact_ / buyer_ / holder_… ou mot e-mail, téléphone,
--    nom, naissance, adresse, code postal, ville, société, IP, genre, âge),
--    sous ses deux écritures (snake_case, camelCase). Restent, sur le schéma
--    documenté : deal_sub_category, deal_vat_rate, deal_producer_cost,
--    ticket_seating, et toute clé nouvelle qui ne désigne personne. Les CLÉS
--    vues restent relevées dans ticketing_connections.schema_sample.
-- 2. Le trigger de `external_tickets` l'applique à TOUTE écriture de `raw`,
--    après avoir dérivé les colonnes typées : un ancien connecteur, un script de
--    démo ou une réimportation ne remet jamais une coordonnée dans `raw`.
-- 3. Plus aucune lecture de `raw` dans une RPC : la règle vente / guest list
--    prend la colonne `deal_channel` (`_crm_ticket_is_sale(status, deal_channel)`,
--    `_crm_ticket_gl_kind(status, price, deal_channel)`, créées par S4), et
--    `_crm_signal_coverage`, `_crm_an_load`, `crm_night_links` lisent
--    `deal_channel`, `deal_visibilities`, `seating_type`. Vérifié sur la prod le
--    18/10 avant d'écrire : colonnes et `raw` ne divergent sur aucun billet, les
--    lectures rendent donc exactement les mêmes chiffres. Les versions `jsonb`
--    sont SUPPRIMÉES : une fonction réécrite plus tard depuis une vieille copie
--    qui passerait encore `t.raw` lèverait une erreur au lieu de compter, en
--    silence, une invitation comme une vente.
--    La réécriture repart de la définition EN BASE (pg_get_functiondef) au
--    moment où la migration tourne : une autre session qui a retouché une de ces
--    fonctions entre-temps garde son travail. La migration échoue si une lecture
--    de `raw` reste.
-- 4. `_crm_erase_contacts` efface aussi les identifiants de la personne chez la
--    billetterie (provider_contact_id, provider_user_id, colonnes S4).
--
-- Sur la prod, le rattrapage des billets déjà en base (dernier UPDATE) est joué
-- PAR LOTS avant que la migration soit enregistrée ; il ne retouche alors plus
-- rien. Sur une base neuve, il réduit tout d'un coup.

-- ── 1. La règle ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._ticketing_raw_key_dropped(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT p_key = ANY (ARRAY[
-- RAW_EXTRACTED_KEYS:début
    'ticket_id', 'id', 'ticketId', 'uuid', 'order_id', 'orderId', 'order_uuid', 'purchase_id',
    'booking_id', 'event_id', 'eventId', 'deal_id', 'dealId', 'product_id', 'productId',
    'ticket_type_id', 'deal_title', 'deal_name', 'dealName', 'dealTitle', 'product_name',
    'ticket_type', 'ticket_title', 'ticket_status', 'status', 'state', 'ticketStatus',
    'ticket_price', 'price', 'unit_price', 'price_paid', 'amount', 'user_fees', 'service_fee',
    'service_fees', 'buyer_fees', 'booking_fee', 'fees', 'currency', 'currency_code',
    'currencyCode', 'quantity', 'qty', 'contact_email', 'buyer_email', 'purchaser_email',
    'customer_email', 'email', 'contact_first_name', 'buyer_first_name', 'customer_first_name',
    'first_name', 'firstname', 'firstName', 'contact_last_name', 'buyer_last_name',
    'customer_last_name', 'last_name', 'lastname', 'lastName', 'contact_phone', 'buyer_phone',
    'customer_phone', 'phone', 'phone_number', 'phoneNumber', 'contact_id', 'buyer_id', 'user_id',
    'userId', 'customer_id', 'holder_email', 'attendee_email', 'ticket_holder_email',
    'beneficiary_email', 'holder_first_name', 'attendee_first_name', 'ticket_holder_first_name',
    'holder_last_name', 'attendee_last_name', 'ticket_holder_last_name',
    'contact_newsletter_optin', 'newsletter_optin', 'newsletterOptin', 'newsletter_opt_in',
    'marketing_optin', 'optin', 'opt_in', 'subscribed_to_newsletter', 'age', 'buyer_age',
    'contact_birthday', 'birthdate', 'birthday', 'birth_date', 'date_of_birth', 'contact_gender',
    'gender', 'buyer_gender', 'sex', 'contact_locality', 'city', 'buyer_city', 'contact_city',
    'contact_postal_code', 'zip_code', 'zipcode', 'zipCode', 'postal_code', 'zip',
    'contact_country', 'country_code', 'countryCode', 'country', 'ordered_at', 'order_date',
    'orderedAt', 'purchased_at', 'purchasedAt', 'paid_at', 'purchase_date', 'created_at',
    'createdAt', 'ticket_scanned_at', 'scanned_at', 'scannedAt', 'scan_date', 'checked_in_at',
    'checkedInAt', 'used_at', 'last_scan_at', 'ticket_canceled_at', 'refunded_at', 'refundedAt',
    'refund_date', 'cancelled_at', 'canceled_at', 'cancelledAt', 'canceledAt', 'ticket_updated_at',
    'updated_at', 'updatedAt', 'last_updated_at', 'modified_at', 'modifiedAt', 'deal_price',
    'deal_user_service_fee', 'ticket_scan_code', 'scan_code', 'scanCode', 'ticketScanCode',
    'qr_code', 'qrCode', 'barcode', 'deal_channel', 'deal_visibilities', 'payment_method',
    'deal_service_fee', 'refunded', 'is_refunded', 'isRefunded', 'cancelled', 'canceled',
    'is_cancelled', 'is_canceled', 'event_name', 'event_start_time', 'event_end_time',
    'event_created_at', 'event_published_at', 'event_launched_at', 'event_canceled_at'
-- RAW_EXTRACTED_KEYS:fin
  ]::text[])
  OR lower(regexp_replace(p_key, '([a-z0-9])([A-Z])', '\1_\2', 'g')) ~ '^(contact|buyer|holder|attendee|customer|purchaser|beneficiary|owner|user|address|utm|utms|tracking)(_|$)'
  OR lower(regexp_replace(p_key, '([a-z0-9])([A-Z])', '\1_\2', 'g')) ~ '(^|_)(e_?mail|mail|phone(_number)?|tel|telephone|mobile|first_?name|last_?name|full_?name|sur_?name|given_?name|family_?name|birth(_?(day|date))?|date_of_birth|dob|address|street|postal(_?code)?|post_?code|zip(_?code)?|city|locality|company(_name)?|ip(_address)?|gender|sex|age)($|_)';
$function$;

COMMENT ON FUNCTION public._ticketing_raw_key_dropped(text) IS
  'Vrai si la clé d''un billet brut de billetterie ne se garde pas dans external_tickets.raw (champ extrait, soirée, QR, coordonnée). Miroir exact de rawKeyDropped (_shared/ticketing-shotgun.ts).';

CREATE OR REPLACE FUNCTION public.ticketing_minimize_raw(p_raw jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_raw) IS DISTINCT FROM 'object' THEN p_raw
    ELSE COALESCE((SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(p_raw) e
                    WHERE NOT public._ticketing_raw_key_dropped(e.key)), '{}'::jsonb)
  END;
$function$;

COMMENT ON FUNCTION public.ticketing_minimize_raw(jsonb) IS
  'Billet brut sans champ extrait ni coordonnée (miroir de minimizeTicketRaw). Appliqué par le trigger de external_tickets à toute écriture de raw.';

REVOKE ALL ON FUNCTION public._ticketing_raw_key_dropped(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ticketing_minimize_raw(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ticketing_raw_key_dropped(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ticketing_minimize_raw(jsonb) TO service_role;

-- ── 2. Le trigger : colonnes typées d'abord, puis le billet brut réduit ──────

CREATE OR REPLACE FUNCTION public.external_tickets_typed_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(NEW.raw) = 'object' THEN
    IF NEW.raw ? 'deal_channel' THEN
      NEW.deal_channel := NEW.raw->>'deal_channel';
    END IF;
    IF NEW.raw ? 'deal_visibilities' THEN
      NEW.deal_visibilities := CASE WHEN jsonb_typeof(NEW.raw->'deal_visibilities') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(NEW.raw->'deal_visibilities')) END;
    END IF;
    IF NEW.raw ? 'ticket_seating' THEN
      NEW.seating_type := CASE WHEN jsonb_typeof(NEW.raw->'ticket_seating') = 'object'
        THEN NEW.raw->'ticket_seating'->>'type' END;
    END IF;
    IF NEW.raw ? 'payment_method' THEN
      NEW.payment_method := NEW.raw->>'payment_method';
    END IF;
    IF NEW.raw ? 'deal_service_fee' THEN
      NEW.org_fee := CASE WHEN jsonb_typeof(NEW.raw->'deal_service_fee') = 'number'
        THEN (NEW.raw->>'deal_service_fee')::numeric / 100 END;
    END IF;
    IF NEW.raw ? 'contact_id' THEN
      NEW.provider_contact_id := NEW.raw->>'contact_id';
    END IF;
    IF NEW.raw ? 'user_id' THEN
      NEW.provider_user_id := NEW.raw->>'user_id';
    END IF;
    -- Minimisation (20261019300000) : ni coordonnée ni champ extrait dans raw.
    NEW.raw := public.ticketing_minimize_raw(NEW.raw);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.external_tickets_typed_fields() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.external_tickets.raw IS
  'Ce que la billetterie rend et que Yuno ne range nulle part ailleurs, sans aucune coordonnée (ticketing_minimize_raw, appliqué par trigger). Ne se lit dans aucune RPC : tout ce que le CRM lit est en colonne.';

-- ── 3. Plus aucune lecture de raw dans une RPC ──────────────────────────────

DO $patch$
DECLARE
  f record;
  v_new text;
  v_n integer := 0;
  v_bad text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~ '\mraw\M'
  LOOP
    v_new := f.def;
    IF f.proname = 'crm_night_links' THEN
      v_new := replace(v_new, 't.price, t.status, t.raw,', 't.price, t.status, t.deal_channel,');
      v_new := replace(v_new, 'public._crm_ticket_is_sale(status, raw)', 'public._crm_ticket_is_sale(status, deal_channel)');
    ELSIF f.proname = '_crm_signal_coverage' THEN
      v_new := replace(v_new, 't.status, t.raw, t.utm,', 't.status, t.deal_channel, t.deal_visibilities, t.seating_type, t.utm,');
      v_new := regexp_replace(v_new,
        'jsonb_typeof\(raw->''deal_visibilities''\) = ''array''\s+AND raw->''deal_visibilities'' \? ''promoters''',
        '''promoters'' = ANY (deal_visibilities)');
      v_new := replace(v_new, 'raw->''ticket_seating''->>''type'' IN', 'seating_type IN');
      v_new := replace(v_new, 'NULLIF(raw->>''deal_channel'', '''')', 'NULLIF(deal_channel, '''')');
    ELSIF f.proname = '_crm_an_load' THEN
      v_new := replace(v_new, 'CASE WHEN jsonb_typeof(t.raw) = ''object'' THEN t.raw->>''deal_channel'' END AS ch',
                              't.deal_channel AS ch');
      v_new := replace(v_new, 'CASE WHEN jsonb_typeof(t.raw) = ''object'' THEN t.raw->''ticket_seating''->>''type'' END AS seat',
                              't.seating_type AS seat');
    ELSIF f.proname = '_crm_erase_contacts' AND v_new !~ 'provider_contact_id' THEN
      v_new := regexp_replace(v_new, 'holder_last_name = NULL,(\s+)raw = ''\{\}''::jsonb',
        'holder_last_name = NULL, provider_contact_id = NULL, provider_user_id = NULL,\1raw = ''{}''::jsonb');
    END IF;
    -- La règle vente / guest list lit la colonne (mêmes résultats, 20261018200000).
    v_new := regexp_replace(v_new, '_crm_ticket_is_sale\((\w+)\.status, \1\.raw\)',
                            '_crm_ticket_is_sale(\1.status, \1.deal_channel)', 'g');
    v_new := regexp_replace(v_new, '_crm_ticket_gl_kind\((\w+)\.status, \1\.price, \1\.raw\)',
                            '_crm_ticket_gl_kind(\1.status, \1.price, \1.deal_channel)', 'g');
    IF v_new IS DISTINCT FROM f.def THEN
      EXECUTE v_new;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'raw → colonnes : % fonction(s) réécrite(s)', v_n;

  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND (pg_get_functiondef(p.oid) ~ '_crm_ticket_(is_sale|gl_kind)\([^()]*\mraw\M'
       OR (pg_get_functiondef(p.oid) ~ '\mraw\s*(->|#>|\?)'
           AND p.proname NOT IN ('external_tickets_typed_fields')));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'lecture de external_tickets.raw restante : %', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = '_crm_erase_contacts'
                AND pg_get_functiondef(p.oid) !~ 'provider_user_id = NULL') THEN
    RAISE EXCEPTION '_crm_erase_contacts : identifiants de la billetterie non effacés';
  END IF;
END
$patch$;

DROP FUNCTION IF EXISTS public._crm_ticket_is_sale(text, jsonb);
DROP FUNCTION IF EXISTS public._crm_ticket_gl_kind(text, numeric, jsonb);

-- ── 4. Rattrapage (prod : déjà joué par lots, ne retouche rien) ─────────────
-- RATTRAPAGE:début
UPDATE public.external_tickets t
   SET raw = public.ticketing_minimize_raw(t.raw)
 WHERE jsonb_typeof(t.raw) = 'object'
   AND t.raw IS DISTINCT FROM public.ticketing_minimize_raw(t.raw);
-- RATTRAPAGE:fin
