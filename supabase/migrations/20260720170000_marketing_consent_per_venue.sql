-- ============================================================
-- Consentement marketing : portée par club, mémorisé, prouvable
-- ============================================================
--
-- Problème corrigé ici (deux bugs opposés qui coexistaient) :
--
--  1. TicketCheckout cherchait « a-t-il déjà accepté ? » dans `tickets`
--     SANS filtre de club. Un opt-in donné au Club A cochait d'office la
--     case ET la masquait pour le Club B, C, D... Le trigger d'achat
--     inscrivait alors la personne à la liste du Club B sans qu'aucune
--     case nommant le Club B ne lui ait jamais été montrée. C'est
--     exactement le schéma sanctionné par la CNIL (FORIOU, SAN-2024-003,
--     310 k€ ; HUBSIDE.STORE, SAN-2024-004, 525 k€) : le consentement doit
--     nommer chaque destinataire (EDPB 05/2020 §65, Ex. 7 §45).
--
--  2. TableCheckout ne mémorisait rien : le client fidèle qui réserve la
--     même soirée chaque semaine devait re-cocher à chaque fois. Or aucun
--     texte n'impose de redemander : le consentement dure jusqu'au retrait
--     (EDPB 05/2020 §110, « no specific time limit »). Seul un changement
--     de finalité, de canal ou de DESTINATAIRE le périme.
--
-- Modèle retenu : le consentement est porté par (personne, club, canal).
-- Un club = un consentement, valable pour toutes ses soirées. Un nouveau
-- club = une nouvelle case, décochée, qui le nomme.
--
-- Les tables de destination existaient déjà et étaient correctement
-- scopées (`newsletter_subscriptions` en (email, venue_id), et
-- `venue_sms_contacts` en (venue_id, phone_e164)) : ce sont la LECTURE au
-- checkout et la PREUVE qui manquaient. Cette migration ajoute les deux.
--
-- Réf. : EDPB Guidelines 05/2020 §§65, 108, 110, 114, 116 ;
--        CNIL référentiel « gestion des activités commerciales »
--        (délib. n° 2021-131 du 23/09/2021) ; CJEU C-673/17 (Planet49).

-- ------------------------------------------------------------
-- 1. Journal de preuve du consentement (append-only)
-- ------------------------------------------------------------
-- EDPB 05/2020 §108 : il faut pouvoir montrer COMMENT, QUAND, et avec
-- QUELLE information le consentement a été recueilli — « It would not be
-- sufficient to merely refer to a correct configuration of the respective
-- website. » Pointer le code source ne suffit donc pas : on stocke le
-- texte exact affiché à cette personne, ce jour-là, dans sa langue.
--
-- §106 borne l'exercice en sens inverse : la preuve « should not in itself
-- lead to excessive amounts of additional data processing ». D'où l'absence
-- volontaire d'adresse IP : pour un compte authentifié, user_id + horodatage
-- suffisent, et l'IP est une donnée personnelle (CJUE C-582/14, Breyer).

CREATE TABLE IF NOT EXISTS public.marketing_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  email text,
  phone_e164 text,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  -- Instantané §108 : la clé i18n ET le texte rendu. Les clés sont
  -- réécrites au fil du temps ; seul le texte fait foi.
  wording_key text,
  wording_text text NOT NULL,
  locale text,
  source text NOT NULL DEFAULT 'checkout',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- Une portée et une seule : club OU organisateur (même invariant que
  -- newsletter_subscriptions).
  CONSTRAINT marketing_consent_events_scope_xor CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  ),
  -- Sans identifiant, la preuve ne se rattache à personne.
  CONSTRAINT marketing_consent_events_subject_present CHECK (
    user_id IS NOT NULL OR email IS NOT NULL OR phone_e164 IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_mkt_consent_events_user
  ON public.marketing_consent_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_consent_events_venue
  ON public.marketing_consent_events(venue_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_consent_events_email
  ON public.marketing_consent_events(lower(email));

ALTER TABLE public.marketing_consent_events ENABLE ROW LEVEL SECURITY;

-- Lecture : la personne concernée, le club concerné, le super admin.
-- Aucune policy INSERT/UPDATE/DELETE : les écritures passent
-- exclusivement par les RPC SECURITY DEFINER ci-dessous.
CREATE POLICY "Users view own consent events"
  ON public.marketing_consent_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Venue owners view own venue consent events"
  ON public.marketing_consent_events FOR SELECT
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

-- Un journal de preuve qui peut être réécrit ne prouve rien. On verrouille
-- au niveau du moteur, pas seulement par RLS : même un rôle privilégié qui
-- passerait outre les policies se heurte au trigger.
CREATE OR REPLACE FUNCTION public.block_marketing_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'marketing_consent_events est un journal append-only (tentative de %)',
    TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_consent_events_immutable
  ON public.marketing_consent_events;
CREATE TRIGGER trg_marketing_consent_events_immutable
  BEFORE UPDATE OR DELETE ON public.marketing_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.block_marketing_consent_mutation();

-- ------------------------------------------------------------
-- 2. Lecture du consentement en cours, pour CE club
-- ------------------------------------------------------------
-- Appelé par le checkout pour décider : case à cocher (rien en cours) ou
-- ligne de statut avec retrait en un clic (consentement actif).
--
-- SECURITY DEFINER volontairement basé sur auth.uid() et JAMAIS sur un
-- email passé en paramètre : sinon la fonction devient un oracle
-- d'énumération (« cette adresse est-elle cliente du Club X ? »). Un
-- invité non connecté voit donc toujours une case vierge — ce qui est
-- correct : re-cocher est un acte positif, toujours valide.
--
-- Fenêtre de 36 mois : la CNIL (référentiel n° 2021-131, §7) plafonne la
-- conservation à « trois ans à compter [...] du dernier contact émanant du
-- prospect ». Un achat est un tel contact et remet le compteur à zéro (cf.
-- le touch de updated_at au point 4), donc un habitué ne franchit jamais ce
-- seuil. La borne ne se déclenche que pour un revenant après 3 ans, à qui
-- l'on redemande — ce qui est aussi la bonne pratique EDPB §111.

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

  SELECT lower(u.email), p.phone INTO v_email, v_phone
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
        AND (sc.user_id = v_uid OR (v_phone IS NOT NULL AND sc.phone_e164 = v_phone))
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
        AND (sc.user_id = v_uid OR (v_phone IS NOT NULL AND sc.phone_e164 = v_phone))
      ORDER BY sc.sms_consent_at DESC
      LIMIT 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_marketing_consent(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_marketing_consent(text, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. Retrait en un clic, depuis l'interface où il a été donné
-- ------------------------------------------------------------
-- EDPB 05/2020 §114 : « a data subject must be able to withdraw consent via
-- the same electronic interface » — un lien de désinscription en pied
-- d'email ne suffit pas à lui seul. §116 : si le retrait n'est pas conforme,
-- c'est TOUT le mécanisme de consentement qui devient non conforme, donc la
-- liste entière. L'Exemple 22 des lignes directrices décrit précisément une
-- billetterie d'événement en ligne comme cas d'école du retrait trop
-- difficile : d'où le bouton inline, sans navigation.

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

  SELECT lower(u.email), p.phone INTO v_email, v_phone
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
      AND (sc.user_id = v_uid OR (v_phone IS NOT NULL AND sc.phone_e164 = v_phone));
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
-- 4. Enregistrement de la preuve lors d'un octroi
-- ------------------------------------------------------------
-- Ouvert à `anon` : c'est justement pour l'invité non connecté que la
-- preuve compte le plus, puisqu'aucune ligne `profiles` ne la porte. La
-- fonction n'écrit que dans le journal et ne relit rien — pas de fuite.

CREATE OR REPLACE FUNCTION public.record_marketing_consent_grant(
  p_channel text,
  p_wording_text text,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone_e164 text DEFAULT NULL,
  p_wording_key text DEFAULT NULL,
  p_locale text DEFAULT NULL,
  p_source text DEFAULT 'checkout'
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
BEGIN
  IF p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'canal invalide: %', p_channel;
  END IF;
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'portée requise (club ou organisateur)';
  END IF;
  IF COALESCE(trim(p_wording_text), '') = '' THEN
    RAISE EXCEPTION 'le texte affiché est requis comme preuve (EDPB 05/2020 §108)';
  END IF;

  IF v_uid IS NOT NULL AND v_email IS NULL THEN
    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  END IF;

  INSERT INTO public.marketing_consent_events (
    user_id, email, phone_e164, channel, venue_id, organizer_user_id,
    action, wording_key, wording_text, locale, source
  ) VALUES (
    v_uid, v_email, NULLIF(trim(COALESCE(p_phone_e164, '')), ''), p_channel,
    p_venue_id, p_organizer_user_id, 'granted', p_wording_key,
    trim(p_wording_text), p_locale, p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_marketing_consent_grant(text, text, text, uuid, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_marketing_consent_grant(text, text, text, uuid, text, text, text, text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Le compteur des 36 mois repart à chaque achat
-- ------------------------------------------------------------
-- La version précédente du trigger ne faisait un DO UPDATE que
-- `WHERE opted_in = false`, donc `updated_at` restait figé à la date du
-- tout premier opt-in. Un habitué de dix ans aurait fini par être traité
-- comme un contact périmé alors qu'il achète chaque semaine.
--
-- Le DO UPDATE devient donc inconditionnel sur updated_at, MAIS la
-- résurrection d'un désabonné (false -> true) reste conditionnée à un
-- opt-in réellement transmis. C'est sûr parce que le checkout ne transmet
-- plus `true` par défaut : quand la personne s'est désabonnée, la lecture
-- du point 2 renvoie false, la case réapparaît décochée, et seul un clic
-- volontaire la re-coche (CJUE C-673/17, Planet49 : seul un acte positif
-- vaut consentement).

CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text;
  v_user_id uuid;
  v_optin boolean;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT venue_id, organizer_user_id INTO v_venue_id, v_organizer_user_id
      FROM public.events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT tz.venue_id INTO v_venue_id
      FROM public.table_zones tz WHERE tz.id = NEW.zone_id;
  END IF;

  IF NOT v_optin OR v_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Les index d'unicité sont PARTIELS (uniq_newsletter_subs_email_venue
  -- ... WHERE venue_id IS NOT NULL). Postgres ne sait inférer un arbitre
  -- partiel que si le ON CONFLICT répète le prédicat : sans le WHERE, la
  -- commande échoue à l'exécution avec « no unique or exclusion constraint
  -- matching the ON CONFLICT specification ».
  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
    VALUES (v_user_id, v_venue_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (email, venue_id) WHERE venue_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now();
  END IF;

  IF v_organizer_user_id IS NOT NULL AND v_venue_id IS NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source)
    VALUES (v_user_id, v_organizer_user_id, LOWER(v_email), true, 'ticket_purchase')
    ON CONFLICT (email, organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
      SET opted_in = true, opted_out_at = NULL,
          user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 6. Tableau de bord client : tous les clubs suivis, révocables un à un
-- ------------------------------------------------------------
-- Art. 7(3) + Art. 21(2) RGPD : le droit d'opposition à la prospection est
-- absolu, et le retrait doit être aussi simple que l'octroi. Le checkout
-- couvre le club en cours ; cette RPC alimente l'écran « mes abonnements »
-- pour tous les autres.

CREATE OR REPLACE FUNCTION public.get_my_marketing_subscriptions()
RETURNS TABLE (
  scope_type text,
  venue_id text,
  organizer_user_id uuid,
  scope_name text,
  email_opted_in boolean,
  sms_opted_in boolean,
  since timestamptz
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(u.email), p.phone INTO v_email, v_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  RETURN QUERY
  WITH email_subs AS (
    SELECT ns.venue_id, ns.organizer_user_id, ns.opted_in, ns.created_at
    FROM public.newsletter_subscriptions ns
    WHERE (ns.user_id = v_uid OR lower(ns.email) = v_email)
      AND ns.opted_in
  ),
  sms_subs AS (
    SELECT sc.venue_id, sc.sms_consent_at
    FROM public.venue_sms_contacts sc
    WHERE NOT sc.unsubscribed
      AND (sc.user_id = v_uid OR (v_phone IS NOT NULL AND sc.phone_e164 = v_phone))
  ),
  scopes AS (
    SELECT e.venue_id, e.organizer_user_id FROM email_subs e
    UNION
    SELECT s.venue_id, NULL::uuid FROM sms_subs s
  )
  SELECT
    CASE WHEN sc.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    sc.venue_id,
    sc.organizer_user_id,
    COALESCE(v.name, pr.organization_name, 'Organisateur'),
    EXISTS (
      SELECT 1 FROM email_subs e
      WHERE e.venue_id IS NOT DISTINCT FROM sc.venue_id
        AND e.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id
    ),
    EXISTS (SELECT 1 FROM sms_subs s WHERE s.venue_id IS NOT DISTINCT FROM sc.venue_id),
    LEAST(
      (SELECT min(e.created_at) FROM email_subs e
        WHERE e.venue_id IS NOT DISTINCT FROM sc.venue_id
          AND e.organizer_user_id IS NOT DISTINCT FROM sc.organizer_user_id),
      (SELECT min(s.sms_consent_at) FROM sms_subs s
        WHERE s.venue_id IS NOT DISTINCT FROM sc.venue_id)
    )
  FROM scopes sc
  LEFT JOIN public.venues v ON v.id = sc.venue_id
  LEFT JOIN public.profiles pr ON pr.id = sc.organizer_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_marketing_subscriptions() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_marketing_subscriptions() TO authenticated;

COMMENT ON TABLE public.marketing_consent_events IS
  'Journal append-only de preuve du consentement marketing (RGPD art. 7(1), EDPB 05/2020 §108). Écriture via RPC uniquement ; UPDATE/DELETE bloqués par trigger.';
