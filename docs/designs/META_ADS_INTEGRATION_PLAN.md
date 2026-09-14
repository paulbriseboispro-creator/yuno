# Yuno × Meta — tracking publicitaire, audiences, leads : recherche et plan d'implémentation

> Rédigé le 2026-09-14. Recherche faite sur la documentation officielle Meta
> (developers.facebook.com), les termes légaux Meta, la CNIL et les pages
> d'aide des plateformes concurrentes. Statut : **phase 1 livrée le
> 2026-09-14** (migration, `_shared/meta-capi.ts`, `meta-connect`, CMP v2,
> pixel, page Intégrations) ; phases 2-4 en attente des dossiers Meta.
> Compléte `docs/designs/MARKETING_GROWTH_PLAN.md` (chantier D).

---

## 0. En une page

**Le problème.** Un club ou un organisateur qui fait de la pub Instagram pour
une soirée vendue sur Yuno ne peut pas dire à Meta « cette pub a vendu 12
billets ». Meta optimise donc sur des clics, pas sur des achats, le pro ne
voit aucun retour sur investissement dans son Ads Manager, et à la première
campagne sérieuse il migre vers Shotgun ou Weezevent, qui offrent tous deux
Pixel + Conversions API depuis 2025.

**Ce qu'on construit, en quatre étages :**

| Étage | Ce que le pro obtient | Dépendance Meta | Effort CC+gstack |
|---|---|---|---|
| 1. Pixel + Conversions API | Meta voit les vrais achats (billets, tables, boissons, guest list) et optimise dessus ; ROAS lisible dans Ads Manager | **aucune** (le pro colle son Pixel ID et un jeton généré dans Events Manager) | 2 j |
| 2. « Connecter Meta » en un clic | Plus rien à coller : Facebook Login for Business donne à Yuno un jeton durable sur le compte pub, la Page et le pixel du pro | App Review Meta (5 à 20 jours ouvrés par cycle) | 2 j + délai Meta |
| 3. Audiences synchronisées | Les segments Yuno (venus 3 fois, table VIP, abonnés d'un genre) poussés en Custom Audiences ; lookalikes | étage 2 | 2 j |
| 4. Lead Ads + campagnes depuis Yuno | Les formulaires Instagram tombent dans la base ; un bouton « Booster la soirée » crée la campagne, la dépense et les ventes remontent dans le cockpit | étage 2 + accès Marketing API « Full » | 4 j |

**La décision structurante :** l'étage 1 se livre **sans App Review**, avec le
même mécanisme que Shotgun, Weezevent, Eventbrite, Universe et Resident
Advisor (un champ Pixel ID + un champ jeton). On l'expédie en premier. En
parallèle, on **dépose dès maintenant** les dossiers Meta (vérification
d'entreprise, vérification d'accès « tech provider », App Review) qui
conditionnent les étages 2 à 4, parce que leur délai est le vrai chemin
critique.

**Ce qui nous différencie une fois les quatre étages posés :** aucun
concurrent ne montre au pro la qualité de son tracking (score de
correspondance), la preuve de consentement par commande, ni des audiences
bâties sur « qui est VENU » plutôt que sur « qui a acheté ».

---

## 1. Comprendre Meta — le glossaire pour décider

Tout ce qui suit est de la documentation officielle Meta, condensée.

**Business Manager / portefeuille d'entreprise.** Le conteneur Meta d'une
entreprise : il possède les Pages, comptes Instagram, comptes publicitaires,
pixels. Beaucoup de petits clubs n'en ont pas et font leur pub depuis un
compte perso. Ça compte pour l'étage 2 (voir les pièges).

**Compte publicitaire (`act_<id>`).** Là où vivent campagnes, budget et
facturation. Un pro peut en avoir plusieurs.

**Pixel / jeu de données (dataset).** L'identifiant vers lequel on envoie les
événements de conversion. Un pixel = un ID numérique. Le « Pixel » désigne
aussi le script navigateur (`fbq`) qui envoie PageView, ViewContent,
InitiateCheckout, Purchase… depuis la page web.

**Conversions API (CAPI).** Le même flux d'événements, mais envoyé **depuis
notre serveur** : `POST https://graph.facebook.com/v26.0/{pixel_id}/events`.
Avantages : insensible aux bloqueurs de pub et à Safari, et surtout on
l'émet depuis la vérité (le webhook Stripe), donc un achat est un achat.
Meta recommande Pixel **et** CAPI ensemble, dédupliqués par un `event_id`
commun : si le navigateur et le serveur envoient le même `Purchase` avec le
même identifiant sous 48 h, Meta n'en garde qu'un.

**Événements standard utiles pour la nuit** : `ViewContent` (page soirée),
`InitiateCheckout` (ouverture du tunnel), `AddPaymentInfo` (redirection
Stripe), `Purchase` (payé, avec `value`, `currency`, `content_ids`,
`order_id`), `Lead` (inscription guest list gratuite, résa à régler sur
place), `CompleteRegistration` (création de compte).

**Event Match Quality (EMQ).** Note 0 à 10 par événement : à quel point Meta
a pu rattacher l'événement à une personne. Ce qui la monte : email et
téléphone hachés, prénom/nom, ville/pays, `external_id`, les cookies `_fbp`
(identifiant navigateur) et `_fbc` (identifiant de clic, dérivé du
paramètre `fbclid` posé par Meta sur tout lien de pub), l'IP et le
user-agent. Tout ce qui est donnée personnelle est haché en SHA-256 après
normalisation ; IP, user-agent, `_fbp`, `_fbc` ne se hachent pas.

**Custom Audiences.** Une liste de personnes (emails/téléphones hachés)
envoyée dans le compte pub du pro, pour la cibler ou l'exclure. **Lookalike
audience** : Meta fabrique des « jumeaux » à partir d'une audience source
(minimum 100 personnes dans le pays visé). C'est ça qui remplace « 18-30 ans
Paris » par « des gens qui ressemblent à mes clients VIP ».

**Lead Ads.** Des pubs Instagram/Facebook avec un formulaire intégré (sans
quitter l'app). Chaque formulaire rempli déclenche un webhook `leadgen`
vers nous ; on va chercher le contenu avec la permission `leads_retrieval`.
Les leads sont effacés côté Meta après 90 jours.

**Marketing API.** Créer campagnes, ensembles de pubs, créations, lire les
statistiques (dépense, impressions, achats attribués, ROAS). Accès à
paliers : « Limited » (auto, pour développer) puis « Full » (App Review,
nécessite au moins 500 appels API sur 15 jours avec moins de 15 % d'erreur).

**Facebook Login for Business (FLB).** Le bouton « Se connecter avec
Facebook » version entreprise : le pro autorise Yuno une fois, et Yuno
reçoit un **jeton de système « Business Integration » qui n'expire pas**,
rattaché au portefeuille du pro. C'est l'outil que Meta désigne comme
« préféré pour les tech providers » ; c'est ce qu'utilisent les plateformes.

**App Review / Business Verification / Access Verification.** Trois portes
successives pour qu'une app Meta agisse au nom d'autres entreprises :
(1) vérifier l'entreprise Yuno (Kbis, domaine), (2) la vérification d'accès
« tech provider » (~5 jours), (3) l'App Review par permission avec vidéo
de démonstration (5 à 20 jours ouvrés par cycle, souvent 2 cycles).

**Meta Business Extension (MBE).** L'onboarding « Shopify » en une popup.
Nécessite la permission privée `manage_business_extension`, accordée sur
liste blanche par un partner manager Meta. **Hors de portée** pour un
fondateur solo sans contact Meta ; FLB fait le même travail sans ça.

**Conversions API Gateway / Signals Gateway.** Un relais auto-hébergé
(AWS/GCP) qui reçoit le pixel sur notre domaine et le renvoie à Meta. Conçu
pour des entreprises sans développeurs. **Inutile pour Yuno** : il ne voit
pas le webhook Stripe, et il reste soumis au consentement.

---

## 2. Ce que font les concurrents

| Plateforme | Pixel ID | CAPI | Positionnement |
|---|---|---|---|
| Shotgun | oui, Réglages › Intégrations ; PageView, AddToCart, InitiateCheckout, Purchase avec `shotgun_event_id` | oui, jeton collé | un pixel par organisateur ; pixel chargé seulement après consentement Cookiebot |
| Weezevent | oui | **oui depuis nov. 2025** | vendu comme « insensible aux bloqueurs » |
| Eventbrite | oui, par événement ou global | oui, bascule « server-side » | **pixels désactivés sur le checkout embarqué en Europe** pour raisons légales ; produit payant « Eventbrite Ads » à part |
| Universe (Ticketmaster) | oui | oui | mêmes événements navigateur et serveur |
| Resident Advisor | oui | oui, jeton Events Manager + code de test | le pair nightlife à copier |
| Tixr | oui | oui | signal-loss / bloqueurs |
| DICE | aucun champ organisateur | CAPI interne uniquement | vend « Fan Insights », pas d'auto-service |
| Billetweb, Fever, Xceed | pixel ou rien | non documenté | — |

Le standard du marché : **deux champs (Pixel ID, jeton CAPI), quatre
événements, une propriété par soirée pour les conversions personnalisées.**
Personne ne montre l'EMQ, la preuve de consentement, ni des audiences
issues de la présence réelle. C'est notre terrain.

---

## 3. Cadre juridique — ce qu'on ne négocie pas

- **Consentement préalable, pour le Pixel ET pour la CAPI.** La CNIL classe
  tout traceur publicitaire hors exemption : consentement avant le premier
  appel. Le tracking serveur ne l'exonère pas : les données envoyées
  (email haché, IP, `_fbc`) identifient la personne. Cour d'appel de Dresde,
  3 février 2026 : Pixel sans consentement valable = violation RGPD,
  1 500 € par personne. Les termes « Business Tools » de Meta imposent
  d'obtenir « de manière vérifiable » les consentements dans l'UE.
- **Responsabilité conjointe (art. 26 RGPD)** entre le pro et Meta Ireland.
  Yuno est sous-traitant technique du pro. Conséquence produit : on
  **journalise le consentement par commande** (horodatage, version du CMP)
  pour que le pro puisse le prouver. Aucun concurrent ne le fait.
- **Limited Data Use (`data_processing_options`) ne sert qu'aux États-Unis.**
  Il n'existe aucun « consent mode » Meta pour l'UE : ou on envoie, ou on
  n'envoie pas.
- **Custom Audiences = opt-in marketing explicite uniquement.** Les CGU Meta
  exigent une base légale ; les autorités européennes exigent le
  consentement, hachage ou pas. Chez nous ça veut dire : uniquement
  `newsletter_subscriptions.opted_in = true` non supprimé et
  `venue_sms_contacts` consenti < 36 mois — exactement ce que renvoie déjà
  `export_venue_ad_audience`. Jamais un acheteur invité sans opt-in.
- **Jamais de donnée en clair** (`em`, `ph`) : Meta la refuse et ses termes
  l'interdisent. Jamais de mineur de moins de 13 ans (Yuno est 18+, réglé).
- **App native** : le CMP est web-only et le natif considère le consentement
  analytics acquis. Ce raccourci ne vaut **pas** pour la publicité. Décision
  proposée : **rien n'est envoyé à Meta depuis une session native en V1** ;
  une V2 ajoutera un interrupteur « Publicité personnalisée » dans les
  réglages de l'app client, mémorisé sur le profil, avant d'ouvrir la CAPI
  aux achats natifs.
- **Domaine.** `event_source_url` doit être un domaine vérifié dans le
  Business Manager du pro. Sur `yunoapp.eu` ils ne peuvent pas : attendre
  des avertissements « domaine non vérifié » dans Events Manager, sans
  blocage des événements. À documenter dans le mode d'emploi.

---

## 4. Architecture cible dans Yuno

### 4.1 Les trois portées, comme partout ailleurs

Une connexion Meta appartient à un club (`venue_id`), à un organisateur
(`organizer_user_id`) ou à la plateforme (les deux NULL = **le pixel de Yuno
lui-même**, réglé par le super admin, pour notre propre acquisition). Même
patron que `venue_sms_contacts` et le marketing plateforme : garde « au plus
une portée », `marketing_scope_match()` pour comparer.

Le bénéficiaire d'un événement d'achat suit **le bénéficiaire de la vente**
(`split_primary_venue_id` / `split_primary_organizer_id` déjà présents dans
les métadonnées du PaymentIntent) : la soirée d'un orga dans un club
partenaire envoie l'achat aux DEUX pixels s'ils existent, plus au pixel Yuno.
Un `Purchase` = N requêtes CAPI, une par connexion active.

### 4.2 Données

```
meta_connections
  id uuid pk
  venue_id text null  ·  organizer_user_id uuid null   (au plus une portée)
  mode text  'manual' | 'oauth'
  pixel_id text not null
  capi_token_enc bytea            -- chiffré (même recette vault que MFA, 20260512100001)
  test_event_code text null       -- vidé automatiquement après 7 jours
  business_id, ad_account_id, page_id, ig_user_id text null   (mode oauth)
  granted_scopes text[] null
  status text  'active' | 'token_invalid' | 'disconnected'
  events_enabled jsonb            -- {view_content, initiate_checkout, purchase, lead} par défaut tous vrais
  send_native boolean default false   -- V2, interrupteur natif
  last_ok_at, last_error_at timestamptz, last_error text
  created_by uuid, created_at, updated_at
  RLS : AUCUNE policy client. Lecture par RPC get_my_meta_connection (jeton jamais renvoyé, seulement « ••••1234 »),
        écriture par l'edge meta-connect (service_role). Trigger block_support_session_write (surface identité).

meta_capi_outbox                  -- file de sortie, une ligne par (connexion, événement)
  id uuid pk, connection_id fk, event_name text, event_id text,
  payload jsonb (déjà haché, sans jeton), status 'queued'|'sent'|'failed'|'dropped',
  attempts int, next_attempt_at, response jsonb, created_at
  unique (connection_id, event_name, event_id)   -- idempotence : retry Stripe = même event_id

meta_consent_log                  -- preuve de consentement par commande
  id, order_kind 'ticket'|'table'|'order'|'guest_list', order_id text, consent_version int,
  consent_marketing boolean, source 'web'|'native', fbp, fbc, user_agent_hash, ip_hash, recorded_at
  (RLS totale, service_role seul ; export sur demande du pro)

meta_audiences                    -- étage 3
  id, connection_id, segment_kind 'venue_segment'|'contact_segment'|'builtin', segment_ref text,
  meta_audience_id text, lookalike_of uuid null, size_uploaded int, last_sync_at, status, last_error

meta_leads                        -- étage 4
  leadgen_id text pk, connection_id, page_id, form_id, ad_id, raw jsonb, received_at,
  processed_at, subscription_id uuid null (→ newsletter_subscriptions), error text

meta_insights_daily               -- étage 4
  connection_id, day date, campaign_id text, spend_cents, impressions, clicks,
  purchases int, purchase_value_cents, raw jsonb   pk (connection_id, day, campaign_id)
```

Toutes ces tables : RLS activée, **aucune policy anon ni authenticated** ;
lecture par RPC `SECURITY DEFINER` gardées par `is_venue_owner` /
organisateur propriétaire / `is_super_admin`, comme `admin_*`. Un manager ne
voit pas la connexion Meta (c'est une surface argent, comme Stripe).

### 4.3 Fonctions edge (le cap des fonctions est de retour : trois, pas dix)

| Fonction | Rôle | `verify_jwt` |
|---|---|---|
| `meta-connect` (routeur) | `POST /manual` (enregistrer Pixel ID + jeton, appeler `/{pixel}/events` avec `test_event_code` pour valider), `GET /oauth/start`, `GET /oauth/callback` (échange du code côté serveur, `GET /me?fields=client_business_id`, listing des actifs, jetons granulaires), `POST /select-assets`, `POST /disconnect`, `GET /health` (`/debug_token`, Dataset Quality API) | true sauf `/oauth/callback` |
| `meta-webhook` | handshake `hub.challenge`, vérification `X-Hub-Signature-256` sur le **corps brut** (`await req.text()` avant tout parse), insertion `meta_leads`, réponse 200 immédiate | false |
| `meta-sync` (routeur) | `/audiences` (résolution → hachage → upload par session de 10 000), `/leads` (récupération des leads en attente), `/insights` (lecture quotidienne) — appelé par le cron | true (cron-auth) |

Module partagé `_shared/meta-capi.ts` : `normalizeAndHash()`, `buildPurchaseEvent()`,
`enqueueCapiEvent()` (écrit l'outbox), `drainCapiOutbox()` (envoie, un
événement par requête, backoff, marque `token_invalid` sur code 190). Le
drainer est chaîné dans `process-scheduled-campaigns` comme les autres
dispatchers, ET appelé en fire-and-forget à la fin des `verify-*` pour que
l'événement parte en secondes (Meta dégrade l'attribution au-delà d'une à
deux heures). Il ne lève jamais : une panne Meta ne coûte pas une vente
(même règle que `logAiUsage`).

### 4.4 Où les événements naissent

**Côté serveur (la vérité) :**

| Événement | Point d'émission | `event_id` |
|---|---|---|
| `Purchase` billet | `verify-ticket-payment` après `didTransition` (transition `pending→paid` atomique, une seule fois même si le webhook Stripe et la page succès se croisent) | `ticket:<ticket_id>` |
| `Purchase` table | `verify-table-payment`, même garde (à confirmer : la fonction ne suit pas exactement le motif `.eq('status','pending')`, vérifier avant de brancher) | `table:<reservation_id>` |
| `Purchase` boisson | `verify-payment` après `didTransition` | `order:<order_id>` |
| `Lead` table à régler sur place | `create-table-checkout` branche `on_site` (pas de Stripe) | `table:<reservation_id>` |
| `Lead` guest list | `create-guest-list-entry` | `gl:<entry_id>` |
| `CompleteRegistration` | trigger existant de création de profil → outbox (pixel Yuno seulement) | `user:<id>` |

Données disponibles sans requête supplémentaire : `item_type`, `event_id`,
`venue_id`, `organizer_id`, montant brut et devise dans les métadonnées du
PaymentIntent ; email dans `session.customer_email` ou sur la ligne
(`tickets.user_email`, `guest_phone`, prénom/nom invité).

**À ajouter aux métadonnées de session Stripe à la création du checkout** (3
fonctions `create-*`) : `meta_consent` ('1'/'0'), `meta_fbp`, `meta_fbc`,
`meta_ua`, `meta_ip` (côté serveur depuis la requête), `meta_src`
('web'/'native'). Stripe autorise 50 clés de 500 caractères : on est loin.
Le front lit `_fbp`/`_fbc` avant la redirection ; si `_fbc` est absent mais
qu'un `fbclid` a été vu, on le fabrique : `fb.1.<ms de première vue>.<fbclid>`
(documenté par Meta).

**Côté navigateur (doublon volontaire, dédupliqué) :**

- `src/lib/metaPixel.ts` : chargeur unique. Ne charge `connect.facebook.net`
  **qu'après** consentement `marketing`, appelle `fbq('consent','revoke')`
  avant `init` puis `grant`. Sait initialiser plusieurs pixels (club + orga
  + Yuno) et utilise `trackSingle` pour cibler le bon. Désactivé en natif
  (`isNative()`), en app Pro, et sur les surfaces pro (`SKIP_PREFIXES` de
  `platformTraffic`).
- Les quatre fonctions de `useVisitorTracking` (`trackEvent`,
  `trackAddToCart`, `trackCheckout`, `trackOrderComplete`) deviennent le
  point de fan-out : `ViewContent` sur la page soirée (avec `content_ids =
  [event_id]`, `value` = billet le moins cher), `InitiateCheckout` à
  l'ouverture du tunnel, `AddPaymentInfo` avant la redirection Stripe,
  `Purchase` sur les pages `Verify*Payment` avec le **même `event_id`** que
  le serveur.
- Le pixel du club ou de l'orga à charger est lu par une RPC publique
  `get_public_meta_pixels(event_id)` qui ne renvoie que les `pixel_id` (jamais
  un jeton). La page soirée connaît déjà `venueIdForTracking` et
  `organizerIdForTracking`.

### 4.5 Consentement — le CMP change

- `ConsentCategory = 'analytics' | 'marketing'`, `CONSENT_VERSION = 2` (les
  choix v1 sont redemandés une fois). Le bandeau gagne un troisième
  interrupteur « Publicité personnalisée (Meta) ». `ANALYTICS_STORAGE_KEYS`
  gagne la purge des cookies `_fbp` / `_fbc` au refus.
- `legalContent.ts` gagne le paragraphe traceurs publicitaires, la mention
  de responsabilité conjointe avec Meta, et la liste des données envoyées.
- Le mode d'emploi pro explique clairement : « vos événements ne comptent
  que les visiteurs qui ont accepté la publicité ; Yuno conserve la preuve ».

### 4.6 Front pro

- Nouvelle page `/owner/integrations` (groupe Réglages, à côté de
  `/owner/billing`) et `/organizer-app/integrations` (groupe Réglages).
  Design system **pro**. Une carte « Meta (Facebook & Instagram) » :
  - état : non connecté / connecté (mode, pixel, dernier événement reçu,
    erreurs) ;
  - **V1** : deux champs (Pixel ID, jeton Conversions API) + bouton
    « Envoyer un événement de test » (utilise `test_event_code`, le pro le
    voit apparaître dans Events Manager en direct : c'est le moment « ça
    marche ») ;
  - **V2** : bouton « Connecter avec Facebook » qui remplace les champs ;
    choix du compte pub / de la Page / du pixel si plusieurs ; lien vers
    l'acceptation des CGU Custom Audiences (obligatoire, par un humain, par
    compte pub : l'API ne peut pas l'accepter à sa place) ;
  - interrupteurs par événement, interrupteur natif (V2), bouton
    « Déconnecter » (révoque et vide le jeton).
- Carte « Santé du tracking » : événements envoyés / échoués sur 7 jours,
  taux de dédoublonnage, et en mode oauth l'EMQ lu par la Dataset Quality
  API. **Aucun concurrent ne l'affiche.**
- Super admin : `/admin/system` gagne la même carte pour le pixel Yuno, et
  `/admin/alerts` reçoit `meta_token_invalid` via `emit_admin_notification`
  (avec `dedup_key`).
- i18n ×3, `ohelp.*` dans les locales, article dans `ownerHelpContent.ts`
  (catégorie Réglages) et l'équivalent orga, `HELP_ARTICLES` de
  l'owner-assistant, `CLIENT_KNOWLEDGE_BASE` inchangé (invisible côté client
  hors bandeau cookies).

### 4.7 CSP

`public/_headers` et `vite.config.ts` : `script-src += https://connect.facebook.net`,
`img-src += https://www.facebook.com`, `connect-src += https://www.facebook.com
https://connect.facebook.net`. Rien d'autre ne change.

---

## 5. Plan d'implémentation

### Phase 0 — dossiers Meta (Paul, à lancer le jour 1, en parallèle de tout)

Ce sont des démarches administratives, pas du code, et elles gouvernent les
phases 2 à 4. Ordre :

1. Créer l'app Meta de type **Business** dans le Business Manager de Yuno
   (vérifié : Kbis + domaine `yunoapp.eu`). Renseigner politique de
   confidentialité, URL de suppression des données (un endpoint qui purge
   `meta_connections` du business demandeur : c'est un motif de rejet
   classique quand il manque), icône, catégorie.
2. **Business Verification** puis **Access Verification** (« tech
   provider » : décrire que Yuno traite les données d'autres entreprises,
   ~5 jours).
3. Créer la **configuration Facebook Login for Business** en jeton système
   « Business Integration », actifs : comptes pub, Pages, pixels/datasets,
   comptes Instagram. En faire une seconde, minimale (« CAPI seulement » :
   `ads_read` + `business_management` + `pages_read_engagement`) pour les
   clubs qui ne veulent que le tracking.
4. **App Review** avec une vidéo **par permission** et un compte de test
   utilisable par le reviewer (le club démo `womber` avec un Business Manager
   démo, un compte pub, une Page et un pixel de test). Permissions à
   demander en accès avancé : `ads_management`, `ads_read`,
   `business_management`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`,
   `instagram_basic`. Motifs de rejet fréquents : texte générique, une
   vidéo pour plusieurs permissions, URL de suppression absente, reviewer
   qui ne peut pas reproduire.
5. **Marketing API « Full Access »** : demande possible seulement après 500
   appels sur 15 jours (< 15 % d'erreur). On les génère en faisant tourner
   la lecture des insights sur notre propre compte pub de test dès la phase
   2. Depuis le 4 mai 2026 plus de vidéo exigée pour cette feature.
6. Ne PAS demander MBE (`manage_business_extension`) : liste blanche par
   partner manager, hors de portée.

### Phase 1 — Pixel + Conversions API en mode manuel (livrable en premier)

Humain : 2 semaines. CC+gstack : 2 jours.

1. Migration `meta_connections` + `meta_capi_outbox` + `meta_consent_log`,
   chiffrement du jeton (recette vault MFA), RPC `get_my_meta_connection`,
   `get_public_meta_pixels(event_id)`, trigger de garde session support.
2. `_shared/meta-capi.ts` (normalisation, hachage, outbox, drainer).
   Tests unitaires Deno sur la normalisation (email, E.164 sans `+`, noms
   sans ponctuation, pays alpha-2 minuscule) : une faute ici et l'EMQ tombe
   sans un mot.
3. Métadonnées Stripe `meta_*` dans les trois `create-*` ; consentement lu
   par le front, IP/UA posés serveur.
4. Émission serveur dans `verify-ticket-payment`, `verify-table-payment`,
   `verify-payment`, branche `on_site` de `create-table-checkout`,
   `create-guest-list-entry`. Drainer chaîné dans
   `process-scheduled-campaigns`.
5. `meta-connect` : route `/manual` (valide le couple pixel + jeton en
   envoyant un événement de test) et `/disconnect`.
6. CMP : catégorie `marketing`, version 2, purge `_fbp`/`_fbc`, textes
   légaux ×3.
7. `src/lib/metaPixel.ts` + fan-out dans `useVisitorTracking` + `Purchase`
   navigateur sur les pages `Verify*Payment` + CSP.
8. Page `/owner/integrations` et `/organizer-app/integrations`, carte Meta
   V1, carte santé (compteurs outbox), i18n ×3, mode d'emploi, article
   assistant owner.
9. Pixel Yuno (portée plateforme) réglé dans `/admin/system`.
10. Recette sur `yunoapp.eu` (le CORS-lock interdit le checkout en local) :
    un vrai pixel de test, `test_event_code`, vérifier dans Events Manager
    la réception, la déduplication (un seul `Purchase`), l'EMQ ≥ 6 avec
    email + `_fbp` + `_fbc` + IP + UA. Redéployer les fonctions par paire
    quand `_shared` change.

**Critère de sortie :** un club colle son pixel, achète un billet de test
avec un lien `?fbclid=…`, voit un `Purchase` dédupliqué avec sa valeur dans
Events Manager, et Yuno a une ligne de consentement pour cette commande.

### Phase 2 — « Connecter Meta » (Facebook Login for Business)

Humain : 2 semaines. CC+gstack : 2 jours, **après** l'App Review.

1. `meta-connect` : `/oauth/start` (`config_id`, `state` signé portant la
   portée + nonce), `/oauth/callback` (échange serveur du `code`,
   `appsecret_proof` sur chaque appel, `GET /me?fields=client_business_id`,
   listing `owned_pixels` / `client_pixels` / `owned_ad_accounts` /
   `owned_pages`), `/select-assets`, jetons granulaires par capacité via
   `/{client_business_id}/system_user_access_tokens`.
2. Repli **jeton utilisateur longue durée (60 jours)** pour les pros sans
   Business Manager, avec rappel de reconnexion à J-7 par
   `staff_notifications` / `organizer_notifications`. Beaucoup de petits
   clubs sont dans ce cas.
3. Santé : `/debug_token` quotidien dans `meta-sync`, statut
   `token_invalid` sur code 190, alerte super admin, bannière pro.
4. EMQ et couverture via la Dataset Quality API dans la carte santé.
5. Le mode manuel reste disponible à côté (un pro qui refuse de connecter
   son compte garde le tracking).

### Phase 3 — Audiences synchronisées et lookalikes

Humain : 2 semaines. CC+gstack : 2 jours.

1. Étendre `export_venue_ad_audience` en `export_ad_audience(venue, org)`
   sur les deux portées, mêmes portes de consentement, hachage en base
   (motif de `20260908233000_audience_match_hashed`) ; jamais d'export
   brut.
2. `meta-sync /audiences` : pour chaque `meta_audiences` actif, résoudre
   (`resolve_venue_segment` / `resolve_contact_segment_def` / audiences
   intégrées « acheteurs 12 mois », « venus ≥ 3 fois », « tables VIP »,
   « guest list venus »), hacher, `usersreplace` par session de 10 000,
   `customer_file_source = USER_PROVIDED_ONLY` (club) ou
   `BOTH_USER_AND_PARTNER_PROVIDED` (liste d'orga sur un compte club).
   Synchronisation nocturne (Meta traite en ≤ 24 h).
3. Vérifier `tos_accepted` du compte pub ; si faux, afficher le lien
   d'acceptation (`business.facebook.com/ads/manage/customaudiences/tos/?act=…`)
   et ne rien envoyer.
4. Lookalike en un clic (ratio 1 à 5 %, pays FR/ES), refusé sous 100
   personnes dans le pays.
5. UI : dans la page segments existante (club et orga), un bouton « Envoyer
   à Meta » par segment, avec taille envoyée et dernière synchro. Texte de
   consentement du bandeau et de la newsletter mis à jour pour nommer les
   audiences Meta.

### Phase 4 — Lead Ads, puis « Booster la soirée »

Humain : 4 semaines. CC+gstack : 4 jours.

1. `meta-webhook` (`verify_jwt = false`, signature sur le corps brut,
   dédup sur `leadgen_id`, 200 immédiat). Abonnement de la Page
   (`POST /{page_id}/subscribed_apps?subscribed_fields=leadgen`) à la
   connexion.
2. `meta-sync /leads` : `GET /{leadgen_id}`, mapping des champs (email,
   téléphone, prénom, nom), versement via `import_email_contacts` /
   `import_sms_contacts` avec `consent_source = 'social'`, attestation
   automatique (formulaire Meta, `ad_id`, `form_id`, horodatage), chaque
   formulaire = un segment `import`. Bienvenue automatique branchée sur le
   parcours du chantier B du plan marketing.
3. Marketing API (après Full Access) : bouton « Booster » sur la fiche
   soirée → campagne `OUTCOME_SALES`, `special_ad_categories = []`
   (obligatoire même vide), ensemble de pubs `promoted_object = {pixel_id,
   custom_event_type: 'PURCHASE'}`, `dsa_beneficiary` / `dsa_payor`
   (obligatoires en UE), `targeting_automation.advantage_audience` explicite,
   audience = lookalike des acheteurs, création = affiche + lien suivi
   Yuno (`/l/<code>` canal `meta_ads`) ; tout créé en `PAUSED`, aperçu, puis
   activation par le pro dans Yuno.
4. `meta-sync /insights` quotidien (`use_unified_attribution_setting=true`,
   fenêtres 7d_click / 1d_view) dans `meta_insights_daily` ; le cockpit
   marketing affiche dépense, achats attribués par Meta, achats attribués
   par le lien suivi Yuno (les deux chiffres, honnêtement), coût par
   billet.

---

## 6. Décisions à prendre (Paul)

1. **Natif en V1 = rien vers Meta.** Confirmer. L'alternative (envoyer la
   CAPI depuis le natif sans consentement recueilli) est la faute la plus
   sanctionnée.
2. **Pixel Yuno plateforme dès la phase 1.** Je le recommande : c'est notre
   propre levier d'acquisition, gratuit à ajouter, et il fait tourner les
   500 appels nécessaires au Full Access.
3. **Gating tarifaire.** Cohérent avec `docs/PRICING_STRATEGY.md` : Pixel +
   CAPI dans **Essential** (« premières armes marketing »), audiences et
   Booster dans **Pro**. Tant que `SUBSCRIPTIONS_ENABLED=false`, tout est
   ouvert.
4. **Managers.** Proposé : la connexion Meta est réservée à l'owner (comme
   Stripe et comme `export_venue_ad_audience`).
5. **Marge sur le budget pub géré** (phase 4) : à trancher plus tard, rien
   ne l'exige techniquement.

---

## 7. Pièges relevés pendant la recherche (à garder sous les yeux en codant)

- `event_time` en **secondes**, `_fbc` en **millisecondes**. Un événement de
  plus de 7 jours fait échouer toute la requête : ne jamais rejouer de
  vieilles commandes.
- Une seule requête CAPI par événement depuis le webhook : un lot de 1 000
  est rejeté en entier si un événement est invalide (`client_user_agent`
  manquant sur un événement `website`, par exemple).
- Dédoublonnage : même `event_name` avec la même casse (`Purchase`), même
  `event_id`, sous 48 h.
- Le jeton ne va **jamais** au navigateur ; seul le `pixel_id` est public.
- WebView native : aucun cookie `_fbp` ne survit à `capacitor://localhost`.
  Même quand la V2 ouvrira le natif, la correspondance se fera sur email,
  téléphone, `external_id` : EMQ plus basse, c'est normal.
- Jeton BISU = le pro doit avoir un portefeuille d'entreprise. Repli jeton
  utilisateur 60 jours obligatoire.
- CGU Custom Audiences : par compte pub, par un humain, impossible par API.
- `promoted_object.pixel_id` sans `custom_event_type` échoue, et l'objet est
  immuable ensuite. `advantage_audience` explicite depuis la v23.
- Webhook leads : HMAC sur les octets bruts, jamais après `req.json()`.
  Leads effacés à 90 jours ; `leads_retrieval` est en accès avancé
  seulement, donc intestable avec un vrai client avant l'App Review (outil
  de test Meta sur notre propre Page).
- Les noms de paliers Marketing API ont changé le 4 mai 2026 (Limited /
  Full, seuil 500 appels) ; la plupart des blogs et certaines pages Meta
  citent encore Standard / Advanced et 1 500.
- `split_mode = 'direct'` crée la session Stripe **sur le compte connecté** :
  la lecture de session dans `verify-*` passe déjà `stripeAccount`, les
  métadonnées `meta_*` doivent être posées dans les deux modes.
- Sources principales : Pixel reference, Conversions API (using-the-api,
  parameters, deduplicate), Data Processing Options, Business Tools Terms,
  Facebook Login for Business + CAPI integration template, permissions
  reference, Access Verification, Custom Audiences guide + terms, Lookalike
  guide, Lead Ads webhooks + retrieving, Marketing API campaign/adset/
  promoted-object/insights, Webhooks getting-started, CNIL « solutions pour
  les outils de mesure d'audience », OLG Dresden 3.2.2026.
