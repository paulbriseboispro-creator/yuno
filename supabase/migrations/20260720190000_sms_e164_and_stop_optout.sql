-- ============================================================
-- SMS marketing : numéros réellement E.164 + désinscription STOP
-- ============================================================
--
-- Deux défauts distincts, tous deux propres au canal SMS.
--
-- 1. `venue_sms_contacts.phone_e164` ne contenait pas de l'E.164. Le sélecteur
--    de pays émet « +33 6 44 21 66 89 » (avec espaces) et sms-consent.ts le
--    stockait tel quel. Conséquences : la contrainte UNIQUE (venue_id,
--    phone_e164) laisse passer deux fois la même personne dès que le
--    groupement diffère, et la recherche de consentement par téléphone ne peut
--    jamais correspondre (elle ne fonctionnait que via user_id).
--
-- 2. Aucune mention STOP nulle part. L'art. L34-5 al. 4 CPCE impose d'offrir
--    l'opposition « de manière expresse et dénuée d'ambiguïté [...] chaque fois
--    qu'un [message] de prospection lui est adressé ». Ce n'est PAS couvert par
--    le consentement : les deux obligations sont cumulatives (CNIL, ACCOR
--    SAN-2022-017, dont 100 k€ au titre du seul L34-5). Cette migration pose
--    la brique base ; l'ajout du texte à l'envoi et le webhook entrant vivent
--    dans les edge functions.

-- ------------------------------------------------------------
-- 1. Normalisation E.164
-- ------------------------------------------------------------
-- Garde le « + » de tête, retire tout le reste de ce qui n'est pas un chiffre
-- (espaces, points, tirets, parenthèses). IMMUTABLE pour être utilisable en
-- index et en contrainte.

CREATE OR REPLACE FUNCTION public.normalize_phone_e164(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _phone IS NULL OR btrim(_phone) = '' THEN NULL
    WHEN btrim(_phone) LIKE '+%'
      THEN '+' || regexp_replace(btrim(_phone), '[^0-9]', '', 'g')
    ELSE regexp_replace(btrim(_phone), '[^0-9]', '', 'g')
  END;
$$;

-- ------------------------------------------------------------
-- 2. Fusion des doublons créés par l'ancien format
-- ------------------------------------------------------------
-- Après normalisation, plusieurs lignes d'un même club peuvent viser le même
-- numéro. On les fusionne AVANT de réécrire la colonne, sinon l'UPDATE viole
-- la contrainte d'unicité.
--
-- Règles de fusion, toutes orientées « ne jamais élargir un consentement » :
--   · unsubscribed : bool_or — si UNE ligne dit désabonné, le résultat est
--     désabonné. Un opt-out ne doit jamais être perdu dans une fusion.
--   · sms_consent_at : min — on garde la PLUS ANCIENNE date de consentement.
--     Prendre la plus récente rajeunirait artificiellement le contact et
--     repousserait la purge des 36 mois.
--   · is_vip : bool_or, user_id / email / nom : première valeur non nulle.

DO $$
DECLARE
  v_merged integer := 0;
BEGIN
  WITH normalized AS (
    SELECT
      id,
      venue_id,
      public.normalize_phone_e164(phone_e164) AS norm,
      unsubscribed, unsubscribed_at, sms_consent_at, is_vip,
      user_id, email, full_name, consent_source, source_event_id, created_at
    FROM public.venue_sms_contacts
    WHERE public.normalize_phone_e164(phone_e164) IS NOT NULL
  ),
  grouped AS (
    SELECT
      venue_id,
      norm,
      min(id::text)::uuid                        AS keep_id,
      bool_or(unsubscribed)                      AS any_unsub,
      min(unsubscribed_at)                       AS first_unsub_at,
      min(sms_consent_at)                        AS first_consent_at,
      bool_or(is_vip)                            AS any_vip,
      (array_agg(user_id)    FILTER (WHERE user_id IS NOT NULL))[1]   AS keep_user,
      (array_agg(email)      FILTER (WHERE email IS NOT NULL))[1]     AS keep_email,
      (array_agg(full_name)  FILTER (WHERE full_name <> ''))[1]       AS keep_name,
      count(*)                                   AS n
    FROM normalized
    GROUP BY venue_id, norm
  )
  UPDATE public.venue_sms_contacts c
  SET unsubscribed    = g.any_unsub,
      unsubscribed_at = CASE WHEN g.any_unsub THEN COALESCE(c.unsubscribed_at, g.first_unsub_at, now()) END,
      sms_consent_at  = g.first_consent_at,
      is_vip          = g.any_vip,
      user_id         = COALESCE(c.user_id, g.keep_user),
      email           = COALESCE(c.email, g.keep_email),
      full_name        = COALESCE(NULLIF(c.full_name, ''), g.keep_name, '')
  FROM grouped g
  WHERE c.id = g.keep_id AND g.n > 1;

  -- Les perdants de la fusion disparaissent ; leur contenu utile vient d'être
  -- reporté sur la ligne conservée.
  WITH normalized AS (
    SELECT id, venue_id, public.normalize_phone_e164(phone_e164) AS norm
    FROM public.venue_sms_contacts
    WHERE public.normalize_phone_e164(phone_e164) IS NOT NULL
  ),
  losers AS (
    SELECT n.id
    FROM normalized n
    JOIN (
      SELECT venue_id, norm, min(id::text)::uuid AS keep_id
      FROM normalized GROUP BY venue_id, norm HAVING count(*) > 1
    ) k ON k.venue_id = n.venue_id AND k.norm = n.norm
    WHERE n.id <> k.keep_id
  )
  DELETE FROM public.venue_sms_contacts c USING losers l WHERE c.id = l.id;

  GET DIAGNOSTICS v_merged = ROW_COUNT;
  RAISE NOTICE 'venue_sms_contacts : % doublon(s) fusionné(s)', v_merged;
END;
$$;

-- Réécriture effective de la colonne, maintenant que l'unicité tient.
UPDATE public.venue_sms_contacts
SET phone_e164 = public.normalize_phone_e164(phone_e164)
WHERE phone_e164 IS DISTINCT FROM public.normalize_phone_e164(phone_e164);

-- ------------------------------------------------------------
-- 3. Le format ne peut plus se dégrader
-- ------------------------------------------------------------
-- Trigger plutôt que contrainte : un CHECK ferait échouer un paiement déjà
-- encaissé pour un numéro mal formé. Ici on corrige en silence à l'écriture,
-- ce qui rend la normalisation applicative de sms-consent.ts redondante mais
-- non contradictoire (ceinture et bretelles : le jour où un autre chemin
-- écrit dans cette table, il est couvert sans le savoir).

CREATE OR REPLACE FUNCTION public.normalize_sms_contact_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_e164 := public.normalize_phone_e164(NEW.phone_e164);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venue_sms_contacts_normalize ON public.venue_sms_contacts;
CREATE TRIGGER trg_venue_sms_contacts_normalize
  BEFORE INSERT OR UPDATE OF phone_e164 ON public.venue_sms_contacts
  FOR EACH ROW EXECUTE FUNCTION public.normalize_sms_contact_phone();

-- ------------------------------------------------------------
-- 4. La lecture du consentement compare des formes normalisées
-- ------------------------------------------------------------
-- `profiles.phone` reste stocké tel que saisi (il sert à l'affichage et le
-- sélecteur de pays le re-formate). On normalise donc des DEUX côtés de la
-- comparaison plutôt que de réécrire les profils : le repli par téléphone
-- fonctionne enfin, y compris pour quelqu'un qui avait consenti en invité et
-- s'est créé un compte ensuite.

CREATE OR REPLACE FUNCTION public.get_my_marketing_consent(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  email_opted_in boolean,
  sms_opted_in boolean,
  email_since timestamptz,
  sms_since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_stale timestamptz := now() - interval '36 months';
BEGIN
  IF v_uid IS NULL OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RETURN QUERY SELECT false, false, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT ns.opted_in AND ns.updated_at > v_stale
      FROM public.newsletter_subscriptions ns
      WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
        AND (
          (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
        )
      ORDER BY ns.updated_at DESC
      LIMIT 1
    ), false),
    COALESCE((
      SELECT NOT sc.unsubscribed AND sc.sms_consent_at > v_stale
      FROM public.venue_sms_contacts sc
      WHERE p_venue_id IS NOT NULL
        AND sc.venue_id = p_venue_id
        AND (sc.user_id = v_uid
             OR (v_phone IS NOT NULL
                 AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    ), false),
    (
      SELECT ns.created_at
      FROM public.newsletter_subscriptions ns
      WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
        AND (
          (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
        )
      ORDER BY ns.updated_at DESC
      LIMIT 1
    ),
    (
      SELECT sc.sms_consent_at
      FROM public.venue_sms_contacts sc
      WHERE p_venue_id IS NOT NULL
        AND sc.venue_id = p_venue_id
        AND (sc.user_id = v_uid
             OR (v_phone IS NOT NULL
                 AND public.normalize_phone_e164(sc.phone_e164) = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_marketing_consent(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_marketing_consent(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_my_marketing_consent(
  p_channel text,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_wording_text text DEFAULT '',
  p_locale text DEFAULT NULL,
  p_source text DEFAULT 'checkout'
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentification requise';
  END IF;
  IF p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'canal invalide: %', p_channel;
  END IF;
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'portée requise (club ou organisateur)';
  END IF;

  SELECT lower(u.email), public.normalize_phone_e164(p.phone)
    INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  IF p_channel = 'email' THEN
    UPDATE public.newsletter_subscriptions ns
    SET opted_in = false, opted_out_at = now(), updated_at = now()
    WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
      AND (
        (p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id)
      );
  ELSE
    UPDATE public.venue_sms_contacts sc
    SET unsubscribed = true, unsubscribed_at = now()
    WHERE p_venue_id IS NOT NULL
      AND sc.venue_id = p_venue_id
      AND (sc.user_id = v_uid
           OR (v_phone IS NOT NULL
               AND public.normalize_phone_e164(sc.phone_e164) = v_phone));
  END IF;

  INSERT INTO public.marketing_consent_events (
    user_id, email, phone_e164, channel, venue_id, organizer_user_id,
    action, wording_text, locale, source
  ) VALUES (
    v_uid, v_email, v_phone, p_channel, p_venue_id, p_organizer_user_id,
    'withdrawn', COALESCE(NULLIF(p_wording_text, ''), 'withdrawal'), p_locale, p_source
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_my_marketing_consent(text, text, uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.withdraw_my_marketing_consent(text, text, uuid, text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 5. Désinscription par SMS entrant (« STOP »)
-- ------------------------------------------------------------
-- Appelée par le webhook Twilio entrant. Le numéro d'envoi Twilio est PARTAGÉ
-- par tous les clubs : la personne qui répond STOP ne peut pas désigner un
-- club en particulier, et n'a aucun moyen de savoir qu'elle le pourrait. On
-- la retire donc de TOUS les clubs.
--
-- C'est l'interprétation la plus sûre et la seule honnête : sur-honorer une
-- opposition n'a jamais constitué un manquement, la sous-honorer si. Elle
-- rejoint la « liste repoussoir » recommandée par la CNIL, dont la demande
-- doit être prise en compte « durablement ».
--
-- Le drapeau plateforme profiles.phone_sms_opt_in est également abaissé :
-- laisser à true un numéro qui vient d'émettre un STOP n'aurait aucun sens,
-- même s'il n'alimente que la segmentation admin.

CREATE OR REPLACE FUNCTION public.sms_stop_unsubscribe(_phone text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := public.normalize_phone_e164(_phone);
  v_count integer := 0;
BEGIN
  IF v_norm IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.venue_sms_contacts sc
  SET unsubscribed = true, unsubscribed_at = now()
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND NOT sc.unsubscribed;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.profiles p
  SET phone_sms_opt_in = false
  WHERE public.normalize_phone_e164(p.phone) = v_norm
    AND p.phone_sms_opt_in;

  -- Trace de preuve, une ligne par club quitté (art. 7(1) RGPD).
  INSERT INTO public.marketing_consent_events (
    user_id, phone_e164, channel, venue_id, action, wording_text, source
  )
  SELECT DISTINCT sc.user_id, v_norm, 'sms', sc.venue_id, 'withdrawn',
         'STOP par SMS entrant', 'sms_stop'
  FROM public.venue_sms_contacts sc
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND sc.venue_id IS NOT NULL;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sms_stop_unsubscribe(text) FROM public;
-- Réservée au service_role : seul le webhook Twilio (vérifié par signature)
-- l'appelle. Aucun client n'a à pouvoir désinscrire un numéro arbitraire.
GRANT EXECUTE ON FUNCTION public.sms_stop_unsubscribe(text) TO service_role;

COMMENT ON FUNCTION public.normalize_phone_e164(text) IS
  'Ramène un numéro à de l''E.164 strict (+ suivi de chiffres). Utilisée à l''écriture ET des deux côtés des comparaisons de consentement.';
