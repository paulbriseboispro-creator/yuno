-- La base de 12 328 contacts de la démo orga, MASQUÉE À LA SOURCE (2026-09-27).
--
-- Décision de Paul : les prospects doivent voir la vraie puissance de la base
-- (volume, villes, âges, dépenses, fréquence, segmentation intelligente,
-- engagement) sans qu'aucune donnée privée ne soit lisible. Le masquage n'est
-- PAS un filtre d'affichage : le compte démo est lisible par l'API avec le
-- jeton d'un prospect, donc les valeurs réelles n'y entrent jamais.
--
-- Depuis la liste d'origine (fichier « audience(1) (1).csv », 12 328 lignes),
-- on copie tout ce qui fait la valeur d'analyse, et on remplace ce qui
-- identifie une personne :
--   • email    : 2 premières lettres + ••• + 6 caractères d'empreinte (unicité)
--                @ 1re lettre du domaine ••• . extension — « ju•••a3f9c1@g•••.com ».
--                Empreinte = md5(email + sel ALÉATOIRE jamais stocké) :
--                irréversible, même en connaissant l'adresse.
--   • prénom   : 2 premières lettres + •••   · nom : 1re lettre + •••
--   • téléphone: numéro de la tranche ARCEP réservée à la fiction
--                (06 39 98 xx xx puis 09 77 42 xx xx) — non attribuable ;
--                l'app l'affiche masqué en aperçu.
--   • `extra` (colonnes libres du fichier) : jeté.
-- Gardés tels quels : pays, région, ville, code postal, zone, âge, genre,
-- opt-in, dates d'ajout / de dernier achat, dépense totale, nombre de soirées.
--
-- Passe par la VRAIE RPC d'import (import_contact_list) jouée comme
-- organizer@womber.fr : liste, attestation, abonnés email, contacts SMS.
-- Tout envoi est de toute façon refusé sur le périmètre démo (demo_no_send).
--
-- Rejouable : retire d'abord les listes « Démo · … » de la démo orga.
-- Ensuite : seed-demo-engagement.sql (historique d'ouvertures / clics).

BEGIN;

CREATE TEMP TABLE _org ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE email = 'organizer@womber.fr';

-- ─── 1. Retirer les listes démo existantes (fictives ou masquées) ───────────
DELETE FROM public.email_campaign_events ev
 USING public.email_campaigns c
 WHERE ev.campaign_id = c.id AND c.organizer_user_id IN (SELECT id FROM _org)
   AND (ev.recipient_email LIKE '%@example.%' OR ev.recipient_email LIKE '%•%');
DELETE FROM public.email_campaign_recipients r
 USING public.email_campaigns c
 WHERE r.campaign_id = c.id AND c.organizer_user_id IN (SELECT id FROM _org)
   AND (r.email LIKE '%@example.%' OR r.email LIKE '%•%');
DELETE FROM public.newsletter_subscriptions
 WHERE organizer_user_id IN (SELECT id FROM _org)
   AND import_id IN (SELECT id FROM public.email_list_imports
                      WHERE organizer_user_id IN (SELECT id FROM _org) AND list_name LIKE 'Démo · %');
DELETE FROM public.venue_sms_contacts
 WHERE organizer_user_id IN (SELECT id FROM _org)
   AND import_id IN (SELECT id FROM public.sms_list_imports
                      WHERE organizer_user_id IN (SELECT id FROM _org) AND list_name LIKE 'Démo · %');
DELETE FROM public.imported_contacts
 WHERE list_import_id IN (SELECT id FROM public.contact_list_imports
                           WHERE organizer_user_id IN (SELECT id FROM _org) AND list_name LIKE 'Démo · %');
DELETE FROM public.email_list_imports WHERE organizer_user_id IN (SELECT id FROM _org) AND list_name LIKE 'Démo · %';
DELETE FROM public.sms_list_imports   WHERE organizer_user_id IN (SELECT id FROM _org) AND list_name LIKE 'Démo · %';
DELETE FROM public.contact_list_imports WHERE organizer_user_id IN (SELECT id FROM _org) AND list_name LIKE 'Démo · %';
DELETE FROM public.contact_engagement WHERE organizer_user_id IN (SELECT id FROM _org);

-- ─── 2. Import masqué, par lots de 2 000 (plafond de la RPC) ────────────────
DO $$
DECLARE
  v_org  uuid := (SELECT id FROM _org);
  v_src  uuid := '77f4b5c9-cf3e-4d3a-82ea-0d0a97d80cee'; -- liste d'origine (audience(1) (1).csv)
  v_salt text := encode(extensions.gen_random_bytes(16), 'hex'); -- jamais stocké
  v_total int;
  v_list uuid := NULL;
  v_off  int := 0;
  v_rows jsonb;
  v_res  jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'organizer@womber.fr introuvable'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'role', 'authenticated', 'email', 'organizer@womber.fr')::text, true);

  SELECT count(*) INTO v_total FROM public.imported_contacts WHERE list_import_id = v_src;
  IF v_total = 0 THEN RAISE EXCEPTION 'liste source vide ou introuvable'; END IF;

  WHILE v_off < v_total LOOP
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'email', CASE WHEN s.email IS NOT NULL THEN
                 left(split_part(lower(s.email), '@', 1), 2) || '•••'
                 || substr(md5(v_salt || lower(s.email)), 1, 6) || '@'
                 || left(split_part(lower(s.email), '@', 2), 1) || '•••.'
                 || regexp_replace(split_part(lower(s.email), '@', 2), '^.*\.', '') END,
             'phone', CASE WHEN s.phone_e164 IS NOT NULL THEN
                 CASE WHEN s.n <= 10000 THEN '+3363998' || lpad((s.n - 1)::text, 4, '0')
                      ELSE '+3397742' || lpad((s.n - 10001)::text, 4, '0') END END,
             'first_name', CASE WHEN s.first_name IS NOT NULL THEN left(initcap(s.first_name), 2) || '•••' END,
             'last_name',  CASE WHEN s.last_name  IS NOT NULL THEN left(upper(s.last_name), 1) || '•••' END,
             'country_code', s.country_code, 'country', s.country, 'region', s.region,
             'city', s.city, 'postal_code', s.postal_code, 'zone', s.zone,
             'age', s.age::text, 'gender', s.gender,
             'newsletter_opt_in', s.newsletter_opt_in::text,
             'added_at', s.added_at::text, 'last_purchase_at', s.last_purchase_at::text,
             'total_spent', s.total_spent::text, 'event_count', s.event_count::text)))
      INTO v_rows
      FROM (SELECT ic.*, row_number() OVER (ORDER BY ic.created_at, ic.id) AS n
              FROM public.imported_contacts ic WHERE ic.list_import_id = v_src) s
     WHERE s.n > v_off AND s.n <= v_off + 2000;

    v_res := public.import_contact_list(
      p_rows => v_rows,
      p_consent_source => 'ticketing',
      p_organizer_user_id => v_org,
      p_filename => 'audience(1) (1).csv',
      p_consent_details => 'Copie MASQUÉE pour la démo (lettres initiales, empreinte, numéros de fiction ARCEP) — aucun envoi possible depuis un compte démo.',
      p_list_import_id => v_list,
      p_list_name => 'Démo · Base clients (masquée)',
      p_default_country => 'FR',
      p_channels => '{"email": true, "sms": true}'::jsonb,
      p_mode => 'append',
      p_final => (v_off + 2000 >= v_total));
    v_list := (v_res ->> 'list_import_id')::uuid;
    v_off := v_off + 2000;
  END LOOP;
END $$;

COMMIT;
