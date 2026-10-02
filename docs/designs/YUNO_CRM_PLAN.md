# Yuno CRM — le CRM de la nuit branché sur la billetterie existante

> Plan rédigé le 2026-10-02. **Statut : proposition, rien d'implémenté.**
> Sources : l'étude « Devenir le CRM de la nuit — concept, intégration Shotgun et
> analyse des concurrents » (02/10/2026, 13 acteurs, 70 sources), l'audit du code
> Yuno (trois explorations du 02/10) et les deux pages publiques de l'API Shotgun,
> relues le 02/10 (section 5.2).

---

## 0. En une page

**Le constat.** Les pros aiment la technologie Yuno (base vivante, segments,
Email Studio, automatisations, bilans de soirée), mais peu acceptent de quitter
leur billetterie : changer de prestataire leur fait peur. Nevent a fait le même
constat en Espagne. Il est passé de la billetterie à une couche marketing branchée
sur les billetteries existantes (étude, chapitre 2).

**Le pari.** Deux produits dans un même code :

- **Yuno Billetterie** (la Suite d'aujourd'hui) vend les billets, les tables et la
  guest list, et inclut le CRM.
- **Yuno CRM** vend seulement le CRM. Il se branche sur la billetterie du pro
  (Shotgun d'abord, des fichiers pour les autres) et ne touche jamais au paiement.

**La bonne nouvelle.** Environ deux tiers du « socle indispensable » décrit par
l'étude existent déjà dans Yuno et tournent en production (15 fonctions sur 34
entièrement, 15 en partie, 4 absentes) : consentements par canal, base
vivante dédoublonnée, segments dynamiques et RFM, Email Studio, neuf recettes
d'automatisation, politique de pression multi-expéditeurs, délivrabilité, rapport
de soirée J-N, attribution, export, équipe à rôles, Meta et SMS (codés, pas encore
allumés). Le détail est en section 3.

**Ce qui manque.** Trois chantiers, aucun ne part de zéro :

1. **Les données d'une billetterie tierce.** Il faut un connecteur Shotgun et un
   modèle « vente externe ». Aujourd'hui, tout le CRM lit les tables de vente de
   Yuno (`tickets`, `table_reservations`, `guest_list_entries`, `orders`).
2. **La coquille d'un produit à part.** Il faut un drapeau produit sur le compte,
   une navigation filtrée, un parcours de démarrage CRM, une page d'accueil CRM,
   une landing et une inscription dédiées.
3. **Le prix.** Il faut une grille, la facturation Stripe Billing et des quotas
   par offre. Grille en place : Gratuit, Essentiel 49 €, Pro 129 €, Business
   249 € HT par mois (section 6). Un modèle « socle bas + crédits à l'usage »
   est à l'étude (`YUNO_CRM_PRICING.md`, étude du 02/10 à 16 h).

**Le MVP vendable** correspond aux lots 1 à 5 de la section 7 : connecter
Shotgun, voir sa base unifiée et ses segments Yuno, lire le bilan de ses soirées,
lancer les recettes, payer son abonnement. La collecte (pages de prévente, RSVP)
vient juste après, au lot 6.

---

## 1. Ce que l'étude apprend (l'essentiel pour construire)

- **Le périmètre.** Le CRM de la nuit gère la relation entre un organisateur et
  son public. Il acquiert des contacts, comprend leurs habitudes, communique au
  bon moment, mesure les ventes et fait revenir le public. La vente reste chez la
  billetterie partenaire. La production (contrats artistes, logistique, staff,
  accréditations, paie, terrain de Heeds) est un **autre métier** : on ne la
  promet pas.
- **La leçon Nevent.** L'unification des données (connecteurs, normalisation,
  dédoublonnage, traçabilité) fait partie du produit. Ce n'est pas un simple
  bouton d'import.
- **Shotgun fait déjà une partie du CRM** : segments dynamiques et statiques,
  newsletters, préventes ciblées, aide IA. L'outil externe se justifie par ce
  qu'il permet **en plus**, et il faut le dire noir sur blanc (section 4.3).
- **Le vrai concurrent** est souvent la pile « Smartboard + un outil email +
  des fichiers ». Il faut mesurer les ressaisies, le temps perdu et les décisions
  impossibles.
- **Une entrée limitée et un premier résultat visible.** Laylo entre par la page
  de lancement, Pims par le pointage des ventes, Gigz par une offre gratuite.
- **Les prix publics relevés le 02/10** (hors taxes, périmètres différents) :

| Acteur | Repère public | Remarque |
|---|---|---|
| Nevent | Marketing 90 / 250 €, Experience 50 / 150 €, Revenue 350 € par mois | modules cumulables |
| Delight | 400 / 700 / 1 300 € par mois | setup dès 2 700 €, formation dès 1 800 € |
| Gigz | gratuit, 149 € ou 649 € par mois | 20 000 ou 150 000 emails |
| Cymbal | dès 20 $ ou 165 $ par mois pour 500 abonnés | 10 % des dépenses pub au-delà de 500 $ |
| Audience Republic, Arenametrix, Heeds, Pims, Fourvenues | sur devis | — |

- **Ne pas empiler les fonctions.** La différence possible est une combinaison :
  des usages propres à la nuit, des données fiables, un premier résultat rapide,
  un prix compris et la réutilisation d'une soirée à l'autre.

---

## 2. Les deux Yuno

| | **Yuno Billetterie** (Suite actuelle) | **Yuno CRM** (nouveau) |
|---|---|---|
| Vente | billets, tables VIP, guest list, Stripe Connect | **aucune** : reste chez Shotgun, Dice, Weezevent… |
| Données clients | ventes Yuno + imports | billetterie connectée + fichiers + collecte Yuno |
| Porte | app Yuno Pro, scan, liste | non (la billetterie scanne), sauf guest list Yuno en option |
| Marketing | Email, SMS, push, Meta, automatisations | les mêmes, hors push (pas d'audience app) |
| Analyse | ventes, trafic, communauté, en direct | ventes **importées**, communauté, campagnes ; pas d'« en direct » |
| Modèle | sans abonnement, frais de service payés par le client | **abonnement mensuel** (section 6) |
| Interface | la Console (Club / Organisateur) | la même Console, en mode CRM |

**La passerelle.** Un compte CRM qui ouvre la vente sur Yuno bascule en Suite sans
rien perdre : mêmes contacts, mêmes segments, mêmes modèles. L'argument
commercial : « vends ta prochaine soirée avec Yuno, le CRM devient gratuit ».
C'est la grille de la section 6 qui le rend vrai.

**Le vocabulaire.** « Yuno CRM » est le nom de l'**offre**. L'interface reste
« la Console » (règle de nommage du 23/09) : on ne parle jamais d'« app CRM ».

---

## 3. Ce qu'on a déjà, confronté au socle de l'étude

Légende : ✅ en production · 🟡 partiel ou à adapter · ❌ absent.
Entre parenthèses, la pièce de code qui porte la fonction.

### 3.1 Socle données et CRM (étude, chapitre 22)

| Fonction de base | État | Ce qui existe / ce qui manque |
|---|---|---|
| Connexion par organisateur | ❌ | Rien pour une billetterie. Patrons réutilisables : `meta_connections` (jeton dans le Vault, `token_hint`, statut, alerte) et `affiliate_ticket_sources` (Whan). |
| Import historique | 🟡 | Import de fichier unifié (`import_contact_list`). Il reconnaît déjà l'export Shotgun à 18 colonnes (`contactImport.ts`), mais ne garde que des **totaux par personne**, pas le détail par billet. |
| Mises à jour | ❌ | Un fichier est une photo figée. Pas de curseur, pas de synchro. |
| Identité et doublons | 🟡 | `contact_rows` donne une ligne par email ; l'empreinte de fichier évite les doublons d'import. Il manque la table des identifiants source (id Shotgun ↔ email). |
| Acheteur et participant | ❌ | À modéliser avec le connecteur. |
| Profil et historique | ✅ | Fiche client (`CustomerTimelineSheet`), base vivante, engagement. |
| Consentements par canal | ✅ | `newsletter_subscriptions`, `venue_sms_contacts`, `email_suppressions`, `email_opt_outs`, attestation d'import horodatée, journal de consentement Meta. |
| Segments dynamiques | ✅ | `contact_segments`, quatre préréglages Yuno, seuil de panier dynamique, RFM. |
| Segments et tags simples | 🟡 | Segments ✅. Les étiquettes manuelles n'existent que pour le super admin (`crm_customers`). |
| Soirée comme objet | 🟡 | Rapport de soirée complet, mais seulement pour les soirées vendues par Yuno (`events`). |
| Traçabilité et fraîcheur | 🟡 | Le kit d'analyse a `UpdatedAt` et `CoverageNote`, mais rien sur la fraîcheur d'une source externe. |
| Accès et portabilité | ✅ | Équipe à rôles (`org_members`), `export_contact_base`, accès assisté. |

### 3.2 Socle campagnes et automatisations (chapitre 23)

| Fonction | État | Où |
|---|---|---|
| Collecte de contacts | 🟡 | Guest list, suivi, liste d'attente (qui exige un compte Yuno), Meta Lead Ads. **Il n'y a pas de page de collecte ou de prévente autonome**. Elle était proposée dans `MARKETING_GROWTH_PLAN.md` mais jamais construite. |
| Email | ✅ | Email Studio, blocs Yuno en direct, modèles, A/B d'objet. |
| Destinataires | ✅ | Audiences v2, exclusions, comptage net, porte opt-in. |
| Programmation | ✅ | Programmation, heures calmes, envoi par file. |
| SMS | 🟡 | Codé de bout en bout, verrouillé (`SMS_MARKETING_LIVE=false`) en attendant le numéro Twilio. |
| Parcours simples | ✅ | Neuf recettes (`collect_email_automations`) + « l'habitué décroche » (migration du 02/10). |
| Conditions et délais | 🟡 | Délais et seuils par recette, relance après clic, renvoi aux non-ouvreurs. **Pas d'éditeur de parcours à branches.** |
| Journal d'exécution | ✅ | `email_automation_sends`, avec la raison écrite de chaque exclusion. |
| Pression globale | ✅ | `email_send_policy`, tous expéditeurs confondus. **Ne voit pas** les newsletters envoyées depuis Smartboard. |
| Délivrabilité | ✅ | Disjoncteur plaintes / bounces, warm-up, suppression, domaine marketing séparé. |
| Résultats | 🟡 | Attribution clic → achat sous 72 h, **mais seulement sur les ventes Yuno**. |
| Réutilisation | ✅ | Modèles sans soirée figée, départs rapides. |

### 3.3 Socle pilotage (chapitre 24)

| Fonction | État | Où |
|---|---|---|
| Ventes fiables | 🟡 | Formules de `fees.ts`, statuts, remboursements, mais sur les ventes Yuno seulement. |
| Rythme J-N comparé | 🟡 | `get_event_report` (courbe par jours calendaires, soirée précédente comparée), ventes Yuno seulement. |
| Publics | ✅ | Communauté › Vue d'ensemble, nouveaux / habitués, villes. |
| Rétention et valeur | 🟡 | RFM et habitués, mais pas de cohortes de retour entre éditions. |
| Campagnes | ✅ | Rapports email, push et liens suivis. |
| Calendrier marketing | ❌ | — |
| Bilan de soirée | ✅ | Verdict, « À retenir », bilan du lendemain dans la cloche. |
| Rapports partageables | 🟡 | Exports PDF et Excel, mais pas de rapport « partenaire » par rôle. |
| Coûts et budgets | 🟡 | Cachets DJ comme dépense, dépenses Meta. |
| Suggestion d'action | 🟡 | Constats « À retenir » et suggestions de recettes, règles explicables, sans IA. |

### 3.4 Ce que Yuno a en plus des concurrents étudiés

- **Pubs Meta pilotées depuis l'outil, 0 % sur le budget** (Cymbal prend 10 %
  au-delà de 500 $). C'est construit, et allumé dès que l'App Review Meta passe.
- **La pression marketing partagée entre tous les expéditeurs** : une même
  adresse n'est pas sur-sollicitée par le club, l'organisateur et Yuno.
- **La nuit comme vocabulaire** : tables VIP, guest list, line-up, habitué qui
  décroche, comparaison à J-N.
- **L'assistant IA branché sur les écrans d'analyse** (Nevent l'annonce en accès
  anticipé).
- **Emails et SMS à prix coûtant**, ce qui est dit dans l'interface.

---

## 4. Ce qu'on n'a pas

### 4.1 Les trous bloquants pour le MVP

1. **Connecteur Shotgun** : connexion, import historique avec progression,
   synchronisation incrémentale, journal, déconnexion.
2. **Modèle de vente externe** : billets par personne, soirée, tarif, montant,
   statut, remboursement, scan. Branché dans **toutes** les fonctions qui lisent
   les ventes, soit environ 16 fonctions SQL (section 5.4).
3. **Soirées importées** : une soirée Shotgun doit être un objet Yuno pour les
   segments, les recettes, le Studio et le rapport, **sans jamais apparaître**
   dans la découverte publique, les annonces push ou le référencement.
4. **Drapeau produit et coquille CRM** : navigation, routes, démarrage, accueil,
   page Clients branchée sur la base vivante au lieu de `venue_customers`.
5. **Facturation d'abonnement** pour les deux portées. Aujourd'hui,
   `venue_subscriptions` ne connaît que les clubs, et `SUBSCRIPTIONS_ENABLED=false`.
6. **Landing, page de prix, inscription CRM, compte démo CRM.**

### 4.2 Les trous de différenciation (après le MVP)

Pages de collecte et prévente, enquêtes, étiquettes, calendrier marketing,
rapports partenaires, parcours à branches, autres connecteurs. Liste complète et
priorisée en section 8.

### 4.3 Ce que Yuno CRM apporte à un client Shotgun (la promesse mesurable)

| Usage | Smartboard (d'après l'étude) | Yuno CRM |
|---|---|---|
| Segments | dynamiques et statiques, achats, dépense, récence, genres | idem, plus RFM expliqué, « habitué qui décroche », « prend des tables », panier élevé |
| Newsletter | oui | Email Studio, blocs de soirée en direct, modèles réutilisables |
| Automatisations | non documentées dans l'étude | dix recettes de la nuit, avec journal des envois et des exclusions |
| Sources | Shotgun seul | Shotgun + fichiers (Dice, Weezevent…) + collecte Yuno + guest list |
| Pression | — | règle commune à toutes les recettes et campagnes |
| Bilan de soirée | analyses par soirée | verdict, rythme J-N comparé, « ce qui a fait vendre », bilan du lendemain |
| Pub | pixel et reciblage | audiences et campagnes Meta pilotées, 0 % de frais |
| SMS | — | oui (à l'allumage) |
| Assistant | aide à la rédaction | questions sur ses propres chiffres |

« Non documenté » ne veut pas dire « absent ». Il faut le vérifier en démo
Smartboard avant tout argumentaire comparatif (règle des plaquettes : on ne
compare qu'avec des faits relevés et datés).

---

## 5. Architecture

### 5.1 Un code, une base, un drapeau produit

**On ne crée pas de deuxième dépôt ni de deuxième projet Supabase.** Trois raisons :

- Toutes les fonctions CRM et marketing (contacts, segments, automatisations,
  attribution) vivent dans la base actuelle.
- Le quota de fonctions edge est atteint.
- La passerelle CRM → Suite doit être un simple changement de drapeau.

- **Le drapeau est sur le compte, pas dans le build.** On ajoute
  `venues.product` et `organizer_profiles.product` (`'suite' | 'crm'`, défaut
  `suite`). Le build ne peut pas porter ce drapeau : un drapeau de build comme
  `DRINKS_PILLAR_LIVE` ne sert qu'une offre par déploiement. Le nom d'hôte ne
  donne jamais un droit, il ne règle que la marque.
- **Une porte unique côté front** : `src/lib/productMode.ts` (`useProductMode()`).
- **Navigation** : une liste blanche `PRODUCT_PATHS` superposée au filtre par
  chemin qui existe déjà (`PATH_CAPABILITY` + `filterNavGroups`,
  `org-sidebar.tsx`), et son miroir club dans `buildNavGroups`
  (`app-shared.tsx`). Le même garde protège les routes (`OwnerRoute` et
  `OrgAppRoute` dans `App.tsx`). Une page de la Suite tapée à la main dans
  l'URL d'un compte CRM renvoie à l'accueil.
- **Règle à ajouter au CLAUDE.md quand le lot 3 sera livré** : toute nouvelle
  page de la Console se classe CRM ou Suite dans `PRODUCT_PATHS`, comme elle se
  classe déjà dans `PATH_CAPABILITY`.

Classement des entrées de la Console (exploration du 02/10) :

| Reste en mode CRM | Disparaît en mode CRM | À adapter |
|---|---|---|
| Analytics › Communauté, Trafic (liens suivis) ; Marketing & CRM : Clients, Email (campagnes, automatisations, base), SMS, Pubs ; Intégrations, Organisation, Profil public, Équipe (rôles non-porte), Aide, Accès assisté | Billetterie, Codes promo, Tables VIP, Service VIP, Bar, Porte / check-in, Vestiaire, Commandes, Remboursements, Facturation, Paiements Stripe, Promoteurs et commissions, Collaborations argent, En direct, Fidélité à points | Accueil (version CRM), Soirées (importées + créées à la main), Analytics › Ventes (lit les ventes importées), Guest list (option gratuite), Push (pas d'audience app), DJ |

**Domaine.** Recommandation pour la v1 :

- La Console reste sur `yunoapp.eu`, en mode CRM. La landing CRM a sa propre
  adresse, par exemple `crm.yunoapp.eu` ou une page dédiée de `landing.yunoapp.eu`.
- Servir la **Console** sur un autre hôte coûte cher : `ALLOWED_ORIGINS` dans
  `_shared/cors.ts`, les retours Stripe bornés à `yunoapp.eu`, les URL de
  redirection Supabase Auth, et environ 70 URL `https://yunoapp.eu` en dur dans
  les fonctions edge. On ne le fera que si la marque l'exige.

**2FA.** Aujourd'hui, `RequireMFA` impose la double authentification aux owners
pour protéger l'argent. Un compte CRM n'a pas de pages d'argent, mais il détient
des milliers de données personnelles. On garde la 2FA avec le report de 7 jours
déjà en place pour les inscriptions libres. À confirmer (section 9).

### 5.2 Le connecteur Shotgun

**L'API telle qu'elle est documentée** (pages Notion publiques de Shotgun, relues
dans le navigateur le 02/10) :

| | Tickets | Events |
|---|---|---|
| URL | `GET https://api.shotgun.live/tickets` | `GET https://smartboard-api.shotgun.live/api/shotgun/organizers/{ORGANIZER_ID}/events` |
| Auth organisateur | jeton en `Authorization: Bearer` ou `?token=` | `?key=` (le paramètre `token` y est marqué déprécié) |
| Auth partenaire | `?key=`, après que l'organisateur a activé l'intégration dans Smartboard › Settings › Integrations | non décrit |
| Filtres | `organizer_id` (obligatoire), `event_id`, `include_cohosted_events`, `after` (date ISO ou couple `date_idBillet`) | `updated_after`, `past_events=true`, `name` |
| Ordre et pages | tri par date de mise à jour puis id croissant ; 100 par page ; `pagination.next` ; pas de total | à venir par défaut ; passé : `page` / `limit` (20 par défaut) |
| Quota | 100 requêtes par minute **et par IP** | non précisé |
| Champs | **la page ne documente pas la réponse** | `id, name, startTime, endTime, slug, timezone, artists[], genres[], leftTicketsCount, description, coverUrl, trailerUrl, url, addressVisibility, geolocation{street, latitude, longitude, city, zipCode, country, countryIsoCode}, publishedAt, launchedAt, cancelledAt, organizer{name, slug}, role, deals[]{name, product_id, quantity, target, subcategory, visibility, sales_channel, price, organizer_fees, user_fees}, typeOfPlace` |

D'après l'étude, les billets portent prix, frais, devise, statut, contacts
facultatifs, certaines dates de scan, UTM et dates de mise à jour. **C'est à
vérifier sur une vraie réponse** avant d'écrire le modèle (lot 0).
`newsletter_optin` ne prouve pas à lui seul un consentement par canal. Aucune
écriture n'est possible : pas de création, de remboursement, de scan ni de segment.

**Ce que ces champs rendent possible** (et que l'étude ne pointait pas) :

- `launchedAt` permet une recette « ouverture des ventes ».
- `publishedAt` permet l'annonce d'une nouvelle soirée.
- `cancelledAt` coupe toute recette sur une soirée annulée.
- `leftTicketsCount` et `deals[].quantity` donnent les signaux « dernières
  places ».
- `genres[]` alimente les goûts sans quiz.
- `artists[]` se range dans les artistes invités (`event_guest_artists`). C'est
  exactement le modèle « artiste sans compte Yuno ».
- `include_cohosted_events` retrouve les co-organisations.

**Les briques** (patrons Yuno réutilisés, exploration du 02/10) :

- **`ticketing_connections`** : portée `venue_id` XOR `organizer_user_id`,
  `provider`, `external_org_id`, `vault_secret_id`, `token_hint`, `status`
  (`active` | `syncing` | `token_invalid` | `paused`), `sync_cursor`,
  `next_sync_at`, `last_ok_at`, `last_error*`. C'est un clone de
  `meta_connections` : RLS sans policy d'écriture, triggers anti-accès-assisté,
  secret supprimé avec la ligne.
- **`store_ticketing_token` / `get_ticketing_token`** (Vault, service_role seul).
  Le jeton ne ressort jamais ; le front ne voit que les 4 derniers caractères.
- **`ticketing_sync_runs`** : journal des synchronisations (pages, requêtes,
  lignes écrites, erreurs), sur le modèle de `affiliate_ticket_sync_runs`.
- **`consume_ticketing_rate(key, n)`** : **limiteur global à construire**.
  Toutes les fonctions edge sortent par des IP partagées, donc le quota de
  100 requêtes par minute et par IP vaut pour **l'ensemble des clients**. Il
  faut une fenêtre glissante en base, avec de la marge (par exemple 80 / min).
- **`claim_ticketing_connections(limit)`** : `FOR UPDATE SKIP LOCKED` sur
  `next_sync_at`, même patron que les files email, SMS et Meta.
- **Hôte du worker** : les actions vivent dans **`affiliate-ticket-sync`**
  (`shotgun_connect`, `shotgun_health`, `shotgun_sync_now`, `shotgun_disconnect`,
  `shotgun_drain`), parce que le quota de fonctions est atteint. Elle fait déjà
  de la synchro de billetterie, avec ses deux portes d'authentification (cron et
  JWT). L'autre voie est de relever le plafond de dépenses Supabase (le 402
  signifie « paiement requis »). On évite `meta-connect` (1 128 lignes) et
  `process-scheduled-campaigns` (déjà chargée).
- **Le drain** traite les connexions dues. Pour chacune : on consomme le quota,
  on lit 100 billets depuis le curseur, on écrit par une seule RPC, et on
  sauvegarde le curseur **après chaque page**. Le drain s'arrête au bout de
  ~45 s et se relance seul (`waitUntil`). Un cron dédié tourne toutes les
  10 minutes, avec la fréquence de chaque compte bornée par son offre
  (section 6).
- **Import initial** : on garde la même file, avec une progression visible. Un
  gros organisateur à 100 000 billets représente 1 000 pages, soit au moins
  10 minutes à lui seul. Il faut l'annoncer à l'écran (« import en cours, 40 % »).
- **Erreur 401** : statut `token_invalid`, alerte `admin_shotgun_token_invalid`
  (avec `dedup_key`) et notification au pro. C'est le patron Meta.
- **Carte « Shotgun »** dans `IntegrationsSettings` (`/owner/integrations`,
  `/organizer-app/integrations`), à côté de la carte Meta : coller l'ID et le
  jeton, tester, statut, dernière synchro, erreurs, « Synchroniser maintenant »,
  déconnecter.

### 5.3 Le modèle de données externe

1. **Les soirées importées vont dans `events`, pas dans une table parallèle.**
   Studio, recettes, segments, sélecteurs de soirée et rapport sont tous indexés
   sur `events.id`. Une table à part (comme `affiliate_events`) les laisserait
   aveugles. On ajoute `ticketing_provider`, `external_event_ref`
   (`shotgun:<id>`), `external_ticket_url`, `external_synced_at`, plus le prix
   d'appel et le statut externes, avec `ticketing_enabled = false`.
   **Une porte unique `event_is_external(e)`** les exclut de tout ce qui est
   public ou poussé : Explore, `is_discoverable`, `get_new_events_to_announce`,
   moteur de push, sitemap et worker SEO, pages publiques, annonces d'abonnés,
   « Pour toi ». Avant d'écrire la première ligne, il faut faire l'**audit de
   tous les lecteurs publics d'`events`**. C'est la condition de sûreté du lot 2.
2. **`external_tickets`** : une ligne par billet externe. Colonnes :
   `connection_id`, `provider`, `external_id` (unique avec la connexion),
   `event_id`, acheteur et détenteur (email minuscule, nom, téléphone),
   `deal` / tarif, montant net et frais séparés, devise, `status`,
   `refunded_at`, `scanned_at`, UTM, `purchased_at`, `updated_at_source`, `raw`
   jsonb. On garde le détail **par billet** : c'est ce qu'un import de fichier
   perd.
3. **`contact_identities`** : (portée, source, id source) ↔ email / téléphone.
   On ne fusionne qu'avec prudence et on garde les identifiants source. Une
   mauvaise fusion abîme le profil, le consentement et l'analyse (étude,
   chapitre 22).
4. **Consentement.**
   - Un acheteur Shotgun entre dans la base pour l'analyse.
   - Il n'entre dans `newsletter_subscriptions` **que** si Shotgun rapporte un
     accord marketing (`source = 'connector:shotgun'`, `consent_source =
     'ticketing'`).
   - Sinon il est visible, compté, segmentable, mais **non joignable**. C'est
     aussi l'unité de prix (section 6).
   - Ne jamais reprendre la voie de l'import de fichier : `import_email_contacts`
     passe tout le monde en `opted_in` sur la foi de l'attestation du pro.
   - Yuno est **sous-traitant** : il faut un DPA ajusté (source tierce, durée,
     suppression à la déconnexion).
5. **Ce qu'on garde** : l'import de fichier reste la voie de Dice, Weezevent,
   Xceed, Fever et Eventbrite. On ajoutera plus tard un **import de fichier au
   billet** qui alimente `external_tickets` (une ligne par billet), pour que ces
   pros aient aussi rythme et bilan.

### 5.4 Brancher le CRM sur les ventes externes

Il faut une seule fonction commune, **`_scope_activity(venue, org)`** : une
ligne par vente ou par venue, qu'elle vienne de Yuno ou d'une billetterie
externe, avec montant (formules de `fees.ts` pour Yuno, montant net hors frais
pour l'externe), date, soirée, nature (`ticket` | `table` | `guest_list` |
`order` | `external`) et présence. Puis on y fait pointer les lecteurs :

| Fonction | Pourquoi |
|---|---|
| `contact_scope_customers` (5ᵉ branche `external`) | base vivante, segments, export, engagement, audiences intégrées d'un organisateur, seuil de panier : tout en découle |
| `_venue_customer_rfm`, `get_organizer_customer_segments` | RFM (dupliqué mot pour mot : à factoriser au passage) |
| `collect_email_automations` **étape 5b**, `_email_event_holder` | **critique** : sans elle, un acheteur Shotgun reçoit « dernier appel » pour une soirée qu'il a déjà payée |
| `_regular_lapse_candidates`, branches `win_back` / `post_event_*`, `_email_engagement_rank` | dernière venue, présence |
| porte « soirée qui vend » de `last_call`, `new_event`, `regular_lapse` | accepter `external_ticket_url IS NOT NULL` |
| `preview_email_automation`, `_email_automation_suggestions` | miroirs de l'aperçu et des suggestions |
| `get_email_campaign_attribution`, `email_automation_weekly_digest`, `audience_weekly_recap_data`, `get_sales_period_drivers` | attribution clic → achat Shotgun par email sous 72 h, règle publiée |
| `resolve_campaign_audience`, `resolve_venue_segment`, `get_recipient_block_conds` | audiences club bâties sur `venue_customers`, condition « a acheté » |
| `fetchStudioLiveData` (+ `email-studio/hooks.ts`) | bouton vers l'URL Shotgun, prix d'appel et tarifs depuis `deals` |
| `get_event_report`, `get_events_sales_summary`, `get_sales_overview` | rythme J-N et bilan sur ventes importées |

Ce qu'on laisse : `abandoned_checkout` (aucun signal de panier),
`get_push_campaigns` (les acheteurs externes n'ont pas l'app). `tier_closing`
ne marche qu'au niveau de la soirée (`leftTicketsCount`), pas par tarif, sauf si
les billets portent l'id du `deal`.

**Test obligatoire** : un smoke SQL rejouable, annulé par `RAISE EXCEPTION
'SMOKE_OK'` (méthode déjà en usage), qui pose une connexion démo, des billets
externes, et vérifie RFM, exclusion 5b, attribution et rapport.

### 5.5 Les recettes en mode CRM

| Recette (étude, chap. 23) | Yuno | Avec Shotgun |
|---|---|---|
| Bienvenue après inscription | `welcome` | ✅ si la source est la collecte Yuno ou un opt-in Shotgun (choisir la valeur de `source`) |
| Annonce d'une soirée | `new_event` | ✅ `publishedAt` |
| Ouverture des ventes | — | **nouvelle**, sur `launchedAt` |
| Dernier appel / dernières places | `last_call` | ✅ avec exclusion des acheteurs Shotgun |
| Merci / on t'a manqué | `post_event_*` | ✅ **si** Shotgun fournit la date de scan ; sinon muet |
| Prochaine édition, habitué qui décroche | `regular_lapse` | ✅ |
| Reconquête | `win_back` | ✅ |
| Rappel aux inscrits sans achat | — | **lot 6** (collecte + achats externes) |
| Questionnaire après soirée | — | **lot 7** (enquêtes) |
| Panier abandonné, tarif qui monte | `abandoned_checkout`, `tier_closing` | ❌ (pas de signal) |
| Passe en table VIP | `table_upsell` | seulement si le club ouvre des tables Yuno « règlement sur place » (passerelle) |

### 5.6 Sécurité et démo

- Jeton dans le Vault, jamais renvoyé ; connexion refusée en accès assisté et
  sur le périmètre démo (`demoAccountGuard`) ; synchro jamais lancée pour un
  compte `@womber.fr` contre un vrai Shotgun.
- **Compte démo CRM** (`crm@womber.fr`) avec une fausse synchro semée par SQL
  (soirées et billets « shotgun » fictifs). Jamais un vrai jeton sur la démo.
- Déconnexion = suppression du jeton ; « Supprimer les données importées » est
  une action explicite et séparée.
- **Pas de sondage de l'API avec un compte réel sans l'accord écrit de
  l'organisateur**, et jamais en rafale. C'est la leçon Meta du 22/09 : une
  rafale de sondes a bloqué l'accès API. Ici le quota est par IP, donc partagé
  avec tous les clients.

---

## 6. Pricing Yuno CRM

> **Mise à jour du 02/10 (soir).** La grille ci-dessous est dépassée.
> Six modèles ont été comparés, puis l'analyse a été révisée après un relevé
> des prix du marché : `docs/designs/YUNO_CRM_PRICING.md`, section
> « Révision ». La grille retenue (pas encore validée) est en paliers emboîtés :
>
> | Gratuit | Essentiel | Pro | Business | Réseau |
> |---|---|---|---|---|
> | 0 € | 49 € | 129 € (prix fondateur 89 €) | 249 € | sur devis |
>
> Chaque palier contient des crédits email et SMS, rechargeables (pack
> ponctuel, option mensuelle, recharge automatique). Les modules par besoin
> sont écartés : aucun concurrent ne vend par canal. Les automatisations
> marquent la frontière vers Pro.

### 6.1 Principes

1. **Lisible avant d'être bas** (étude, chapitre 19) : un prix d'entrée, ce qui
   est inclus, ce qui se consomme en plus, et comment on part.
2. **On paie les contacts qu'on a le droit de contacter.** L'unité est le
   nombre de **contacts joignables**, c'est-à-dire avec un accord email. La base
   complète, les acheteurs sans accord compris, reste visible et analysable
   gratuitement. C'est l'unité de Cymbal (« contacts abonnés »), et c'est la
   seule qui ne pousse pas à importer sans consentement.
3. **Pas de frais de mise en route, pas d'engagement.** Delight facture dès
   2 700 € de setup et 1 800 € de formation. Un pro sort quand il veut, avec son
   export.
4. **Les consommations à prix coûtant**, comme aujourd'hui : emails 10 € les
   10 000, packs SMS 9,90 € à 390 €. C'est dit dans l'interface.
5. **0 % sur le budget pub Meta** (Cymbal prend 10 % au-delà de 500 $).
6. **Une seule grille Yuno** : mêmes paliers que la grille clubs dormante
   (`planFeatures.ts` : 49, 99 et 199 €, l'annuel = 10 mois).

### 6.2 La grille

| | **Gratuit** | **Essentiel** | **Pro** | **Réseau** |
|---|---|---|---|---|
| Prix | 0 € | **49 € / mois** · 490 € / an | **99 € / mois** · 990 € / an | **dès 199 € / mois** |
| Pour qui | tester sur ses vraies données | l'organisateur qui envoie chaque mois | la soirée hebdo, le club | agences, groupes multi-lieux |
| Contacts joignables | 1 000 | 5 000 | 25 000 | au-delà, sur mesure |
| Emails inclus / mois | 2 000 | 15 000 | 40 000 | sur mesure |
| Sources | 1 (Shotgun **ou** un fichier) | 1 billetterie + fichiers | plusieurs billetteries + fichiers | toutes |
| Fraîcheur de la synchro | 1 fois par jour | toutes les heures | toutes les 15 min | toutes les 15 min |
| Base, segments Yuno, RFM, bilans de soirée | ✅ | ✅ | ✅ | ✅ |
| Automatisations | Bienvenue + Merci | toutes les recettes | toutes + A/B | toutes |
| Pages de collecte (lot 6) | 1 | 3 actives | illimitées | illimitées |
| SMS (packs) | — | ✅ | ✅ | ✅ |
| Meta : audiences + pubs | — | — | ✅ | ✅ |
| Assistant IA | — | — | ✅ | ✅ |
| Rapports partenaires, export | export | ✅ | ✅ | ✅ |
| Membres d'équipe | 1 | 3 | illimités | illimités |
| Mention « Envoyé avec Yuno » | oui | non | non | non |
| Accompagnement | aide en ligne | aide + IA | import fait avec toi | interlocuteur dédié |

**Au-delà du forfait :**

- **Emails** : 10 € les 10 000, packs existants, à prix coûtant.
- **SMS** : la grille actuelle (`sms_packs`).
- **Contacts joignables** : jamais de coupure brute. Un bandeau propose l'offre
  supérieure, et au bout de 30 jours les **nouvelles** campagnes sont plafonnées
  à la taille de l'offre.

La fréquence de synchronisation par offre n'est pas qu'un levier commercial. Le
quota Shotgun de 100 requêtes par minute est **partagé par tous les clients**.
Une offre gratuite synchronisée toutes les 15 minutes ferait payer aux clients
payants la file des comptes gratuits.

**Essai et lancement** (constantes existantes de `planFeatures.ts`) : Pro
offert 14 jours **sans carte** à la connexion de la première source, puis retour
à Gratuit. Les 15 premiers comptes choisis à la main (`EARLY_ADOPTER_LIMIT`) ont
**3 mois de Pro offerts**, et leur prix de lancement est garanti.

**La passerelle Suite.** Tant qu'un compte vend avec Yuno Billetterie, le CRM
Pro est inclus sans abonnement : les frais de service sont payés par le client,
et Yuno ne prend pas de commission sur la billetterie. La phrase commerciale :
« passe ta prochaine soirée sur Yuno, ton CRM devient gratuit ».

**Associations** (à décider) : Essentiel à 19 €. Les associations étudiantes
sont un gros segment de Shotgun, et la Suite leur fait déjà un tarif propre.

### 6.3 Coût annuel complet sur trois cas réels

Prix publics hors taxes relevés par l'étude le 02/10, **à revérifier avant
toute plaquette**. Les périmètres diffèrent : on compare un coût, pas des
fonctions.

| Cas | Yuno CRM | Gigz | Nevent | Delight (1ʳᵉ année) |
|---|---|---|---|---|
| **Petite orga saisonnière** : 1 500 joignables, 6 soirées / an, ~6 000 emails / mois | Essentiel annuel **490 €** | Essentielle 1 788 € (ou le gratuit, selon ses limites) | Marketing Basic 1 080 € | Or 4 800 € + setup 2 700 € + formation 1 800 € = **9 300 €** |
| **Orga récurrente type WOH** : 11 000 joignables, une soirée par semaine, ~45 000 emails / mois | Pro annuel 990 € + un pack de 10 000 emails / mois (120 €) = **1 110 €** | Premium 7 788 € (l'Essentielle à 20 000 emails ne suffit pas) | Marketing Pro 3 000 € | Platine 8 400 € + 4 500 € = **12 900 €** |
| **Groupe multi-lieux** : 3 clubs, 40 000 joignables | Réseau, **dès 1 990 €** | Premium 7 788 € | Marketing Pro + Revenue 7 200 € | Diamant 15 600 € + 4 500 € = **20 100 €** |

Cymbal (dès 20 $ pour 500 abonnés) ne publie pas ses paliers au-delà. On ne le
chiffre pas.

### 6.4 Ce que ça coûte à Yuno (ordre de grandeur)

- **Email** : coût marginal ~0,09 centime (palier Resend supérieur). Un
  Essentiel qui envoie tout son forfait coûte ~13,50 €, un Pro ~36 €. Restent
  Stripe (~1,5 %), l'IA (centimes, déjà tracée dans `/admin/ai`) et Supabase.
  Marge brute d'environ 30 € sur un Essentiel plein et 55 à 60 € sur un Pro
  plein. La plupart n'utiliseront pas tout leur forfait.
- **À prévoir avant le 3ᵉ client payant** : le plan Resend actuel (50 000 /
  mois, dont 40 000 de pool marketing partagé) ne tient pas. Le déclencheur de
  passage au palier supérieur existe déjà (pool > 35 000 deux mois de suite).
  Le quota offert par compte (`email_sender_monthly_free`) doit être fixé par
  l'offre au lieu du forfait unique de 15 000.

### 6.5 Ce qu'il faut tester avant de figer

- Demander à chaque prospect **ce qu'il paie aujourd'hui** pour son outil email
  et ses fichiers. C'est la donnée qui manque depuis le 01/09.
- 49 € est-il trop bas pour être pris au sérieux ? On teste sur les 15 premiers
  comptes avec un prix garanti, puis on ajuste les nouveaux entrants.
- Les contacts joignables sont-ils la bonne unité ? Si Shotgun rapporte peu
  d'opt-in, la plupart des comptes resteront en Gratuit. On le mesure sur les
  premières connexions réelles.

---

## 7. Le plan par lots

Taille : S ≈ 1 à 2 jours de travail agent, M ≈ 3 à 5, L ≈ 6 à 10. Chaque lot se
termine **joué en vrai sur la démo**. C'est la règle tirée du 25/09 : « rien
n'avait été joué contre la vraie base ».

### Avancement (branche `crm/socle`)

| Lot | État au 02/10 | Ce qui reste |
|---|---|---|
| 0 | ⏳ Paul | vraie réponse `/tickets` avec un jeton consentant (le schéma d'un billet est encore lu de façon tolérante), appel Shotgun, entretiens |
| 1 Connecteur | ✅ migrations `20261002150000`, edge `affiliate-ticket-sync` (actions `ticketing_*`, déployée), carte Intégrations | `CRM_CONNECTORS_LIVE` à false (super admin, démo, bêta) |
| 2 Données dans le CRM | ✅ `20261002160000` → `180000` : soirées miroir, billets dans `contact_scope_customers`, automatisations, attribution, tarifs live dans l'email (`send-campaign` déployée) | — |
| 3 Coquille produit | ✅ `20261002190000` : `product` du compte, Console CRM (accueil, soirées, bilan, audience), Clients et Audience aux mots du CRM, centre d'aide CRM, assistant ; démo `crm@womber.fr` | `owner-assistant` à redéployer à la fusion ; Console Manager d'un club CRM non adaptée |
| 4 Prix et facturation | ✅ `20261002200000` + `201000` : `crm_subscriptions`, offre effective, quotas (emails, synchro, membres, automatisations, A/B), essai 14 j, page Abonnement, `crm_checkout` / `crm_portal`, branche webhook, revenu CRM dans `/admin/revenue` | **Paul** : créer les prix Stripe (`scripts/stripe/create-crm-prices.mjs --apply`), puis déployer `club-subscription` + `stripe-webhook` ; pool email plateforme (40 000 / mois) à relever avant un Pro à 50 000 |
| 5 Landing, inscription, démo | en cours | |

Rien n'est sur `main` : la fusion et le déploiement du front attendent Paul.

### Lot 0 — Valider avant de coder (Paul, 1 à 2 semaines, sans code)

- **Appel Shotgun**, avec les questions de la section 11 : mode partenaire,
  champs des billets, consentements, webhooks, quota, référencement au catalogue.
- **Une vraie réponse `/tickets`** lue avec le jeton d'un organisateur consentant
  (WOH ?), une seule fois, pour figer le schéma de `external_tickets`.
- **5 entretiens d'organisateurs Shotgun** (questions de l'étude, chapitre 20) :
  ce qu'ils font chaque semaine, ce qu'ils n'arrivent pas à faire dans
  Smartboard, ce qu'ils paient, qui utiliserait l'outil.
- Décisions de la section 9 : nom, domaine, prix.

### Lot 1 — Connecteur Shotgun (L)

- Tables `ticketing_connections`, `ticketing_sync_runs`, fenêtre de quota.
- RPC Vault, `claim_*`, `consume_ticketing_rate`, et une seule RPC d'écriture.
- Actions dans `affiliate-ticket-sync`, cron dédié toutes les 10 minutes.
- Carte Shotgun dans Intégrations, avec la progression de l'import.
- Alertes super admin et notification au pro en cas de jeton invalide.
- **Critère de fin** : une connexion démo importe un historique semé, reprend
  après coupure, et une déconnexion efface le jeton.

### Lot 2 — Les ventes externes dans le CRM (L)

- Audit des lecteurs publics d'`events`, puis colonnes externes et porte
  `event_is_external`.
- `external_tickets`, `contact_identities`, correspondance des consentements.
- `_scope_activity`, puis les fonctions de la section 5.4, **étape 5b
  d'abord**. RFM factorisé.
- Studio : bouton et tarifs Shotgun. Rapport de soirée et rythme J-N sur ventes
  importées.
- Smoke SQL rejouable.
- **Critère de fin** : sur la démo CRM, un acheteur Shotgun est rangé en
  « habitué », n'est pas relancé pour une soirée qu'il a payée, et un clic sur un
  email suivi d'un achat Shotgun s'affiche en vente attribuée.

### Lot 3 — La coquille CRM (M)

- `product` sur le compte, `useProductMode`, `PRODUCT_PATHS`, garde de routes.
- Inscription : `complete_pro_signup` avec une branche `product = 'crm'`, sans
  piliers ni Stripe ni « mise en ligne ».
- `/get-started` CRM : connecter Shotgun ou importer un fichier → voir sa base →
  premier segment → première campagne.
- Accueil CRM : base joignable, prochaines soirées importées, dernière synchro,
  deux actions conseillées.
- Page Clients sur la base vivante, Analytics › Ventes sur les ventes importées.
- Mode d'emploi (`ohelp.*`, trois langues) et connaissance des assistants
  (`HELP_ARTICLES`), dans le même lot. C'est la règle du projet.

### Lot 4 — Prix et facturation (M)

- Abonnements par clé de portée (`venue:` / `org:`, comme `push_credit_accounts`).
- Produits Stripe Billing CRM, branche du webhook, `PlanGuard` côté organisateur.
- Quotas pilotés par l'offre : contacts joignables, emails par mois, fréquence
  de synchro, membres, fonctions.
- Essai de 14 jours, 15 comptes de lancement.
- Revenu récurrent dans `/admin/revenue`.

### Lot 5 — Landing, inscription, démo, plaquette (M)

- Page CRM et page de prix dans `Yuno-landing`. **Le clone local est périmé :
  le mettre à jour d'abord.** Il vit dans `~/Downloads/Yuno Launchpad`, sur la
  branche `i18n-bilingual-en-fr`, dernier commit du 16/09.
- `/start?product=crm`.
- Compte démo `crm@womber.fr`, avec une synchro semée et un lien d'aperçu.
- Plaquette CRM FR/EN : règles des plaquettes, prix concurrents datés,
  « ta prochaine soirée avec Yuno CRM ».

**→ MVP vendable (lots 1 à 5).**

### Lot 6 — Collecte, le premier résultat visible (M)

- Pages de collecte, prévente, RSVP et liste d'attente **sans compte Yuno**
  (`/c/<code>`, DA publique). Ouverture et fermeture programmées, champs
  propres, consentement horodaté, QR, bouton vers Shotgun. Chaque page devient
  un segment.
- Recette « inscrits sans achat observé ».
- Guest list Yuno gratuite sur une soirée Shotgun, en option.

### Lot 7 — Relation et pilotage (M)

- Enquêtes après soirée reliées au profil.
- Étiquettes manuelles côté pro.
- Calendrier marketing par soirée (tâches, responsable, état).
- Rapport partenaire partageable par rôle.
- Mesure par étape des recettes.
- Contrôle qualité de la base avant envoi.

### Lot 8 — Les distinctifs (au cas par cas)

Meta en ligne (App Review), SMS en ligne (Twilio), parcours à branches, import
de fichier au billet, autres connecteurs, espaces multiples pour les agences,
parrainage et collecte gamifiée, agent de vente IA. Voir la section 8.

---

## 8. Toutes les fonctions de l'étude, classées

P1 = MVP · P2 = juste après · P3 = distinctif, à justifier par un client ·
Hors = pas maintenant.

| # | Fonction | Inspiration | État Yuno | Prio | Lot |
|---|---|---|---|---|---|
| 1 | Connexion par organisateur, import historique, synchro incrémentale, journal | Nevent, Gigz, socle | ❌ | P1 | 1 |
| 2 | Fraîcheur et données manquantes affichées partout | Pims, Arenametrix | 🟡 kit `UpdatedAt` / `CoverageNote` | P1 | 1-2 |
| 3 | Identité multi-sources, identifiants source gardés | Arenametrix, Delight | 🟡 | P1 | 2 |
| 4 | Acheteur vs participant | socle | ❌ | P1 | 2 |
| 5 | Soirée importée comme objet CRM | Audience Republic | 🟡 | P1 | 2 |
| 6 | Pointage, rythme J-N et bilan sur ventes importées | Pims | 🟡 (ventes Yuno) | P1 | 2 |
| 7 | Recettes de la nuit avec exclusion des acheteurs externes | Cymbal | 🟡 | P1 | 2 |
| 8 | Attribution email → achat externe, règle publiée | Audience Republic, Nevent | 🟡 | P1 | 2 |
| 9 | RFM et segments métier | Nevent, Shotgun | ✅ | P1 | 2 |
| 10 | Recette « ouverture des ventes » (`launchedAt`) | Cymbal | ❌ | P1 | 2 |
| 11 | Pages de collecte, prévente, RSVP, liste d'attente programmées | Laylo Drops, Cymbal Pages, Audience Republic | ❌ | P2 | 6 |
| 12 | Relance « inscrits sans achat observé » | socle | ❌ | P2 | 6 |
| 13 | Étiquettes manuelles | Mailchimp | 🟡 (super admin) | P2 | 7 |
| 14 | Enquêtes après soirée reliées au profil | Delight | ❌ | P2 | 7 |
| 15 | Calendrier marketing par soirée | Audience Republic | ❌ | P2 | 7 |
| 16 | Rapport partenaire partageable | Pims | 🟡 | P2 | 7 |
| 17 | Chronologie des actions sur la courbe | Pims | ✅ (repères J-N) | P2 | 2 |
| 18 | Mesure par étape d'un parcours | Cymbal | 🟡 | P2 | 7 |
| 19 | Qualité avant envoi (doublons, invalides, anomalies) | Delight, Arenametrix | 🟡 | P2 | 7 |
| 20 | Import de fichier au billet (Dice, Weezevent…) | Gigz multi-billetteries | ❌ | P2 | 8 |
| 21 | Audiences et pubs Meta | Gigz, Cymbal, Nevent | 🟡 (construit, éteint) | P2 | 8 |
| 22 | SMS | Cymbal, Gigz | 🟡 (construit, éteint) | P2 | 8 |
| 23 | Parcours visuels à branches | Audience Republic, Cymbal, Mailchimp | ❌ (recettes) | P3 | 8 |
| 24 | Assistant analytique sourcé | Nevent AI | 🟡 (Assistant Console) | P3 | 3 / 8 |
| 25 | Goûts musicaux tirés des genres de soirée | Laylo, Shotgun | 🟡 (quiz app) | P3 | 2 |
| 26 | Heatmap jour × heure | Arenametrix | ✅ (ventes Yuno) | P3 | 2 |
| 27 | Espaces multiples pour agences | Gigz, distribution | 🟡 (Console Agence) | P3 | 8 |
| 28 | Autres connecteurs API (Weezevent, Eventbrite, Dice, Xceed, Fever, Whan) | Nevent, Gigz | ❌ (Whan côté affiliés) | P3 | 8 |
| 29 | Parrainage, collecte gamifiée | Audience Republic, `MARKETING_GROWTH_PLAN` | ❌ | P3 | 8 |
| 30 | Agent IA orienté vente | Laylo | ❌ | P3 | 8 |
| 31 | WhatsApp | Nevent, Gigz | ❌ | P3 | 8 |
| 32 | Instagram DM → inscription | Cymbal, Laylo | ❌ (exige une nouvelle App Review Meta ; la première a promis « jamais de messagerie ») | P3 | 8 |
| 33 | Chatbot participant par soirée | Nevent | 🟡 (assistant client générique) | Hors | — |
| 34 | Codes de prévente individuels | Laylo Real Fan | ❌ (aucune écriture Shotgun) | Hors | — |
| 35 | Panier abandonné Shotgun | Laylo | ❌ (aucun signal de panier) | Hors | — |
| 36 | Écriture dans Shotgun (segments, préventes) | — | impossible aujourd'hui | Hors | — |
| 37 | UGC avec permission | Laylo | ❌ | Hors | — |
| 38 | Cashless et consommation | Nevent, Arenametrix, Fourvenues | ❌ (pas de source) | Hors | — |
| 39 | Production : contrats, logistique, staff, accréditations, paie | Heeds | 🟡 côté Suite (cachets DJ, briefing staff) | Hors | — |
| 40 | Mécénat et CRM B2B | Arenametrix, Delight | ❌ | Hors | — |

---

## 9. Décisions à prendre par Paul

| # | Décision | Recommandation |
|---|---|---|
| 1 | Nom de l'offre | « Yuno CRM » : clair, et l'interface reste « la Console » |
| 2 | Domaine | Console sur `yunoapp.eu` en mode CRM, landing CRM à part |
| 3 | Grille de prix | Révision de `YUNO_CRM_PRICING.md` : paliers emboîtés. Gratuit, Essentiel 49 €, **Pro 129 €** (prix fondateur 89 €), Business 249 €, Réseau sur devis. Crédits email et SMS inclus et rechargeables |
| 4 | Suite = CRM Pro inclus | Oui : c'est l'argument de passage à la billetterie Yuno |
| 5 | Tarif association | Essentiel à 19 €, à tester |
| 6 | Soirées Shotgun visibles sur Yuno Explore ? | Non par défaut. Option « vitrine » plus tard, si les conditions Shotgun le permettent |
| 7 | 2FA pour un compte CRM | Gardée, avec un report de 7 jours |
| 8 | Ordre après le MVP | Collecte (lot 6) avant relation (lot 7) |

---

## 10. Risques

- **Dépendance à Shotgun.** L'API peut changer, et un partenariat n'est pas
  acquis. Parade : l'import de fichier reste la voie universelle, et on vise un
  deuxième connecteur avant la fin de l'année.
- **Schéma des billets non vérifié.** La page `/tickets` ne documente pas la
  réponse. Le lot 0 le règle avant le moindre code.
- **Consentement.** `newsletter_optin` n'est peut-être qu'un accord à la
  newsletter de Shotgun ou de l'organisateur. Il faut le faire préciser par
  Shotgun, puis ajuster le DPA et la politique de confidentialité.
- **Quota partagé (100 requêtes par minute et par IP).** Parade : limiteur
  global, file, fréquence de synchro par offre. Une centaine de comptes en
  synchro toutes les 15 minutes reste sous le quota.
- **Double envoi.** Un pro qui envoie aussi depuis Smartboard échappe à la
  politique de pression de Yuno. Il faut le dire et conseiller une seule source
  d'envoi.
- **Dilution du code.** Chaque nouveauté de la Suite doit être classée CRM ou
  non (`PRODUCT_PATHS`, règle au CLAUDE.md).
- **Capacité email.** Passage au palier Resend supérieur, quota par offre.
- **Fuite publique.** Une soirée importée dans un écran public ou une annonce
  push. Parade : la porte `event_is_external` et l'audit du lot 2.
- **La promesse.** Shotgun fait déjà segments et newsletters. Sans le tableau
  de la section 4.3 vérifié en démo, l'argumentaire ne tient pas.

---

## 11. Questions à poser à Shotgun

1. Mode partenaire (`key`) : comment l'obtenir, couvre-t-il Events **et**
   Tickets, comment se fait la révocation, qui assure le support ?
2. Schéma complet d'un billet : acheteur et détenteur, email, téléphone, id
   utilisateur, `newsletter_optin` (à qui il donne accord), id du tarif (`deal`
   / `product_id`), prix, frais, devise, statut, remboursement, date de scan, UTM.
3. Contacts **sans billet** (followers, inscrits aux préventes) : y a-t-il un
   accès ?
4. Événements passés : tout l'historique est-il couvert ? La pagination
   `page` / `limit` va-t-elle au-delà de 20 ?
5. Webhooks prévus ? Sinon, quelle fréquence de collecte est acceptable ?
6. Quota : les 100 requêtes par minute et par IP s'appliquent-elles aussi au
   mode partenaire ? Y a-t-il un quota contractuel ?
7. Conditions d'usage des données côté organisateur (sous-traitant), et
   affichage d'une soirée sur une vitrine tierce.
8. Référencement de Yuno au catalogue d'intégrations du Smartboard : conditions.
