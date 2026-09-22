# Meta App Review — préparer le plateau, tourner, envoyer

> Pour Paul, qui n'a jamais fait ça. Ce guide suppose zéro connaissance de
> Business Manager. Il se lit dans l'ordre : on ouvre les verrous (partie 0),
> on fabrique le décor côté Facebook (partie 1) et côté Yuno (partie 2), on
> répète à blanc (partie 4), et seulement ensuite on enregistre (partie 5).
>
> **Décision de tournage (2026-09-19) : on filme sur le compte ORGANISATEUR
> AMORIS réel, connecté au Facebook et à l'Instagram d'Amoris.** Tout ce
> document est écrit pour ce scénario : les routes sont celles de
> `/organizer-app/*`, et la partie 2 bis liste ce qu'il faut surveiller quand
> on filme un compte qui porte de vraies données et une vraie carte bancaire.
> Le reviewer, lui, recevra le compte **organisateur démo**, même coquille,
> zéro donnée réelle (§2.6).
>
> La mise en service technique (app Meta, secrets, déploiement) est dans
> `docs/META_GO_LIVE_GUIDE.md`. Ce document-ci ne la refait pas : il vérifie
> qu'elle est faite, puis filme.

---

## Ce que tu fabriques, et pourquoi

Meta ne laisse pas une app toucher aux comptes publicitaires, Pages et
pixels de ses clients sur parole. Pour chacune des **neuf permissions**, un
humain chez Meta doit voir, en vidéo, trois choses dans cet ordre :

1. **où l'utilisateur se connecte** avec Facebook dans ton produit,
2. **où il accorde la permission** (la fenêtre bleue Meta, cases cochées),
3. **l'écran de ton produit qui SE SERT** de la donnée obtenue.

Le point 3 est celui qui fait rejeter les dossiers. Une vidéo qui montre Ads
Manager au lieu de Yuno est rejetée : Meta sait déjà ce que fait Ads Manager,
il veut voir ce que fait **Yuno** avec l'accès.

| Règle de format | Détail |
|---|---|
| Une vidéo **par permission** | Neuf entrées à remplir. Voir §5.0 : trois prises suffisent à les couvrir. |
| **Sans montage** à l'intérieur d'une vidéo | Une prise continue. On coupe entre les extraits, jamais dedans. |
| Chaque vidéo **contient la connexion** | Le reviewer les regarde séparément, dans le désordre. |
| **Anglais à l'écran** | L'interface Yuno en English. Si tu parles, en anglais ; sinon pas de son. |
| 1 à 3 minutes, `.mp4` ou `.mov`, < 100 Mo | 1280 × 800 minimum, barre d'adresse visible. |

---

## Partie 0 — Les sept verrous à ouvrir avant de filmer

Si l'un des sept n'est pas vert, tu ne peux pas tourner : la fenêtre Meta
refusera de s'ouvrir, ou Yuno affichera « In progress ».

### 0.1 L'app Meta existe et est réglée

Étapes 1 et 2 de `docs/META_GO_LIVE_GUIDE.md`. **Vérifier :**
developers.facebook.com/apps → l'app `Yuno` apparaît → Paramètres → Général :
ID de l'app, URL de suppression des données et domaines remplis.

### 0.2 Les trois secrets sont posés

```bash
supabase secrets list | grep META
```

`META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`. S'il en manque un,
la carte Meta ne propose que le « mode avancé » : rien à filmer.

### 0.3 `meta-connect` est déployée

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/oauth/callback?state=x"
```

Attendu : **302**. Un 404 = fonction pas déployée (étape 5 du guide).

### 0.4 La vérification d'entreprise de Yuno est passée

Business Manager de Yuno → Paramètres → Centre de sécurité : « Entreprise
vérifiée ». **Sans elle, Meta n'accorde aucune permission avancée** — tu peux
filmer, le dossier sera refusé sur ce seul motif. C'est le délai le plus long
(1 à 3 jours) : lance-le avant tout le reste.

### 0.5 Le compte Facebook d'Amoris est testeur de l'app

App Dashboard → **Rôles de l'app → Testeurs** → ajouter le compte. Puis,
**connecté avec ce compte**, aller sur
developers.facebook.com/settings/developer/requests/ et **accepter
l'invitation**. L'oubli de l'acceptation est l'erreur classique : on se
retrouve devant « Cette app n'est pas disponible » sans comprendre.

### 0.6 Le compte organisateur Amoris voit les pages Meta en vrai

`META_INTEGRATION_LIVE` est à `false` ; seuls le super admin, les comptes
démo et les emails de `META_BETA_EMAILS` y échappent — et cette liste est
**vide**. Il faut y mettre l'email du compte orga Amoris :

```ts
// src/lib/metaIntegration.ts
export const META_BETA_EMAILS: string[] = ['<email orga Amoris, en minuscules>'];
```

Commit + push sur `main`, attendre la fin du déploiement Workers (2-3 min).
**Vérifier :** `/organizer-app/integrations` affiche « Connect with Facebook ».
Si tu lis « In progress », l'email ne correspond pas ou le déploiement n'est
pas fini.

### 0.7 ⚠️ Le badge « Soon » de la barre latérale

Les entrées **Ads** et **Integrations** portent une pastille « Soon »
branchée sur la constante `META_INTEGRATION_LIVE`, **pas** sur le hook
`useMetaIntegrationLive()`. Elle restera donc affichée sur le compte Amoris
**et** sur celui du reviewer, alors que les pages fonctionnent. Un reviewer à
qui on dit « clique sur Ads » et qui voit « Bientôt » peut conclure que la
fonctionnalité n'existe pas : motif de rejet évitable.

Correctif propre : une dizaine de lignes (un booléen de plus dans
`buildNavGroups` — `app-shared.tsx` — et `buildOrgNavGroups` —
`org-sidebar.tsx` —, un seul appelant chacun). Traite-le comme un verrou.

---

## Partie 1 — Le côté Facebook : fabriquer Amoris (45 min)

### 1.0 La bêtise à ne pas faire

**Ne crée pas un deuxième compte Facebook personnel « Amoris ».** Meta
n'autorise qu'un compte personnel par humain et désactive les doublons, en
emportant les Pages et comptes pub rattachés.

```
TON compte Facebook personnel  (la personne, la clé)
   └── Portefeuille d'entreprise « Amoris »   (l'entreprise, le coffre)
         ├── Page Facebook « Amoris »            (l'identité publique)
         ├── Compte Instagram « Amoris »         (l'autre identité)
         ├── Compte publicitaire « Amoris Ads »  (qui paie)
         └── Deux jeux de données / pixels       (qui mesure)
```

Une Page n'est pas un compte : c'est une identité publique gérée par ton
compte personnel. Et une règle Meta qui ne concerne que nous : **l'entreprise
qui possède l'app ne peut pas se connecter à sa propre app** — le portefeuille
« Yuno » apparaît grisé, « owns the app ». D'où Amoris.

### 1.1 Le portefeuille (10 min)

business.facebook.com → **Créer un compte** → nom `Amoris`, ton nom, un email
pro accessible → confirmer par email → adresse et pays. Pas besoin de vérifier
Amoris : seule la vérification de **Yuno** compte (§0.4).

### 1.2 La Page (5 min)

Paramètres d'entreprise → Comptes → Pages → **Ajouter → Créer une nouvelle
Page**. Nom `Amoris`, catégorie Discothèque ou Organisateur d'événements,
**photo de profil** (une Page sans photo, dans l'aperçu de pub de la vidéo 5,
fait tout de suite « faux plateau »). Puis Ajouter des personnes → ton compte
→ accès complet.

### 1.3 Rattacher l'Instagram d'Amoris (10 min)

Il doit être **professionnel** et **relié à la Page**, sinon les pubs ne
peuvent pas s'afficher sous son nom et la vidéo 9 n'a rien à montrer.

1. App Instagram : Paramètres → Type de compte et outils → **Passer à un
   compte professionnel**.
2. Business Manager d'Amoris → Paramètres d'entreprise → Comptes → **Comptes
   Instagram → Ajouter**.
3. Une fois ajouté : **Connecter des actifs** → cocher la Page Amoris et le
   compte publicitaire.

**Vérifier :** Page Amoris → Paramètres → Comptes liés → Instagram affiche le
compte. Sans ce lien, Yuno ne trouve pas d'identité Instagram.

### 1.4 Le compte publicitaire (10 min)

Paramètres d'entreprise → Comptes → Comptes publicitaires → **Créer**. Nom
`Amoris Ads`, **devise EUR**, **fuseau Europe/Paris** — ces deux choix sont
**définitifs**, on ne change pas la devise d'un compte pub. Ajoute-toi en
accès complet, puis Paiements → Ajouter un moyen de paiement.

> **Ce que ça coûte.** Presque rien, mais du vrai argent sur une vraie carte.
> Tout part **en pause**, et une campagne en pause ne dépense rien. Seule la
> vidéo 3 montre « Activate » : budget au minimum **5 €/jour**, activer, trois
> secondes de plan, repauser. La pub passe d'abord en validation Meta
> (plusieurs heures) : dans les faits elle n'aura pas diffusé. Compte 0 à 1 €.
>
> **Corollaire :** la pub créée est une vraie pub, sous la vraie Page, pour une
> vraie soirée. Choisis une soirée que tu serais content de promouvoir.

### 1.5 Les pixels (5 min)

Events Manager → **Connecter des sources de données → Web** → nom
`Amoris pixel`. Quatre écrans s'enchaînent, et tu ne fais rien sur les trois
derniers :

1. **Connect your web data** — deux choix, *Set up Meta Pixel* (coché par
   défaut) et *Set up Conversions API*. **Laisse Set up Meta Pixel → Next.**
   Cet écran ne fait que créer le jeu de données et proposer une méthode
   d'installation, or tu ne veux que son existence. **Ne prends pas Set up
   Conversions API** : ce serait le chemin logique puisque Yuno envoie les
   ventes côté serveur, mais cet assistant sert à générer un jeton à coller à
   la main — le « mode avancé » de Yuno, pas le parcours qu'on filme. Dans la
   connexion en un clic, le jeton serveur vient de la fenêtre Facebook
   elle-même.
2. **Set up Meta Pixel** — trois méthodes d'installation. Le X suffit si Meta
   te laisse fermer ; s'il t'oblige à répondre, prends **Add Meta Pixel code
   to website yourself** (déjà coché) → Next. C'est la seule inoffensive :
   *Set up with a partner* chercherait un Shopify ou un WordPress qu'Amoris
   n'a pas, et *Send instructions to developer* réclame une adresse email.
3. **L'installateur en trois étapes** (Copy base code → Paste base code →
   Optimize setup) est un tutoriel pour qui a son propre site à instrumenter.
   **Ne copie rien, ferme avec le X** — ça ne supprime pas le pixel, il existe
   depuis que tu l'as nommé. Si une URL de site est demandée en route, réponds
   `https://yunoapp.eu` : ce n'est pas un pis-aller, les ventes d'Amoris s'y
   font littéralement, et ça évite le bandeau « domaine non vérifié ».
4. **Vérifier.** Paramètres d'entreprise → Sources de données → Jeux de
   données : le pixel y figure. Sa fiche affiche « Your dataset hasn't
   received any activity » et la carte « Finish setting up » reste à **0 %
   complete** — les deux sont normaux et le resteront. Le bouton **Set up
   Conversions API** en bas de la fiche : ne le touche pas. Soigne le **nom**
   (crayon à côté du titre), il sera lu par le reviewer dans la liste « Pick
   your pixel » de la vidéo 1 : pas de point final, pas de faute.

**Crée un DEUXIÈME jeu de données**, `Amoris pixel (test)`. Avec un seul
pixel, Yuno le connecte tout seul et l'écran **« Pick your pixel »** ne
s'affiche jamais — or c'est lui qui prouve `business_management` en vidéo 1.

### 1.6 Les conditions des audiences personnalisées

Un humain doit les accepter une fois par compte publicitaire, sinon la
création d'audience répond `custom_audience_tos` (subcode Meta 1870090).
**Mais ne pars pas les chercher à la main dans Ads Manager :** Yuno lit le
champ `tos_accepted.custom_audience_tos` du compte directement chez Meta
(`ads_account_status`, dans `meta-connect/index.ts`).

Une fois Meta connecté : **Marketing & CRM → Ads → Check account**.

- Pastille grise **« Audience terms accepted »** → déjà fait, rien à faire.
  C'est fréquent : un compte pub créé dans un portefeuille dont tu es admin
  hérite souvent de l'acceptation faite au niveau de l'entreprise.
- Lien orange **« Accept the audience terms at Meta »** → lien cliquable
  (`acct.tos_url`, construit serveur pour CE compte). Tu acceptes, tu
  reviens, tu recliques Check account.

Si tu essaies quand même depuis Ads Manager (Audiences → Create a custom
audience → Customer list) et que tu tombes **directement sur l'écran
d'upload**, c'est que les conditions sont déjà acceptées : Meta met cet écran
DERRIÈRE le consentement. Sors par Cancel.

⚠️ **Ne téléverse jamais un fichier de clients là.** Ce serait contourner la
porte de consentement que Yuno applique : quand c'est lui qui envoie
l'audience, il ne prend que les contacts opt-in newsletter ou SMS consenti,
hachés. Un CSV déposé à la main n'a aucun de ces filtres.

**Ce que ça bloque, exactement :** la création d'audience, rien d'autre.
Connexion, santé, Check account, Boost, campagne, leads, Instagram
fonctionnent sans. Seule la moitié « Send to Meta » de la vidéo 3 en dépend.

### 1.7 Le formulaire instantané (pour la vidéo 8)

Meta Business Suite → Tous les outils → **Formulaires instantanés** → Page
Amoris → Créer. Nom `Amoris guest list`, questions **Email** + **Nom complet**
(les deux champs que Yuno lit), politique de confidentialité
`https://yunoapp.eu/legal/confidentialite`. Enregistrer suffit.

### 1.8 Vérification du décor

- [ ] Portefeuille `Amoris`, ton compte admin
- [ ] Page `Amoris` avec photo de profil
- [ ] Instagram Amoris professionnel, relié à la Page et partagé au portefeuille
- [ ] Compte pub `Amoris Ads` en EUR, moyen de paiement valide
- [ ] **Deux** jeux de données
- [ ] Un formulaire instantané enregistré sur la Page
- [ ] Ton compte Facebook est testeur de l'app **et a accepté**

---

## Partie 2 — Le côté Yuno : le compte organisateur Amoris

Tu filmes l'app organisateur. Toutes les routes commencent par
`/organizer-app/`, et la barre de gauche porte cinq groupes qui, en anglais,
s'appellent **Overview**, **Events**, **Sales & finance**, **Marketing & CRM**,
**Settings**.

| Page du tournage | Route | Où la trouver |
|---|---|---|
| Carte Meta | `/organizer-app/integrations` | Settings → Integrations |
| Publicité | `/organizer-app/ads` | Marketing & CRM → Ads |

### 2.1 Se connecter

`https://yunoapp.eu/auth` avec le compte organisateur Amoris.

### 2.2 Passer l'interface en anglais

Sélecteur de langue en haut à droite de la barre supérieure → **English**.
Recharge : la barre de gauche doit dire Overview, Events, Sales & finance,
Marketing & CRM, Settings. Tous les libellés cités en partie 5 sont les
libellés anglais réels.

### 2.3 Renseigner le nom public de l'organisateur

Quand Yuno crée une pub, il envoie à Meta un bénéficiaire et un payeur
(obligatoire dans l'UE), pris dans `organizer_profiles.display_name`. **Si ce
champ est vide, la pub part au nom de « Yuno »** — exactement le mauvais
message sur une vidéo censée montrer un client maître de sa marque. Vérifie
dans Settings → Organization que le nom public est `Amoris`.

### 2.4 Une soirée à venir avec une affiche

Events → au moins une soirée future publiée avec affiche. Sans elle, « Boost
an event » refuse de s'ouvrir et l'aperçu de la vidéo 5 est un rectangle vide.
Comme c'est le vrai compte, choisis une soirée que tu assumes de voir à
l'écran, avec une affiche propre.

### 2.5 L'audience (contrainte de TOURNAGE, pas d'usage)

**À lire d'abord, pour ne pas se tromper sur ce que fait le produit.** Une pub
lancée depuis Yuno a deux moteurs de ciblage, et le premier ne demande aucune
base :

- **Zone + âge + genre (+ « Let Meta expand »)** : des inconnus. Sans audience
  choisie, l'écran Review affiche « Area only (no Yuno audience) », mode
  pleinement supporté. Avec l'objectif **Sales**, Meta optimise sur les achats
  réels que Yuno lui envoie par la Conversions API : il apprend à quoi
  ressemble un acheteur du club et va chercher des inconnus qui lui
  ressemblent. Zéro contact, et ça marche.
- **Les audiences Yuno**, dont deux des trois usages sont eux aussi de la
  découverte : ciblage direct (relancer ses contacts), **exclusion** (payer
  seulement pour des nouveaux — « exclude buyers of this event to pay only for
  new people »), et **lookalike** (Meta prend la base comme graine et cherche
  des inconnus similaires, minimum 100 personnes).

**Pourquoi on vérifie quand même le compteur :** pour accorder
`ads_management`, Meta veut voir les DEUX capacités en action, créer une
audience personnalisée ET créer une campagne. Cliquer « Send to Meta » devant
le reviewer avec un compteur à 0, c'est lui montrer un bouton qui n'envoie
personne.

**Comment vérifier sans rien casser :** Marketing & CRM → Ads → Audiences →
**Create an audience** → « Buyers, last 12 months » : le compteur affiche
« {n} consenting people ». Ferme **sans envoyer**.

**Si le compteur est à 0 — c'est fréquent, y compris sur le compte démo.** Le
registre de consentement (`newsletter_subscriptions`) n'est pas rempli par les
ventes elles-mêmes : il l'est par l'opt-in coché au checkout, et le seed démo
insère des billets sans passer par là.

**La parade retenue (2026-09-19) : importer une liste de test DANS Amoris,
puis la purger après le tournage.** Le portefeuille Meta est au nom d'Amoris ;
filmer un dashboard démo à côté ferait incohérent. Trois précautions, non
négociables :

1. **Des adresses qui existent vraiment.** Des alias plus-addressing d'une
   boîte que tu relèves (`toi+am001@gmail.com`). Des adresses inventées
   produiraient des hard bounces, et la liste de suppression comme la
   réputation d'envoi Resend sont **partagées par toute la plateforme** (le
   disjoncteur se déclenche à 5 % de bounces). Le risque n'est pas pour
   Amoris, il est pour les autres clubs.
2. **Éteindre les automatisations email d'Amoris avant l'import** (Marketing &
   CRM → Email marketing → Automations). `new_event`, `last_call` et `win_back`
   prennent les contacts importés : une soirée publiée dans les 72 h suffirait
   à déclencher un envoi réel.
3. **Passer par le dialogue d'import de l'interface, jamais par du SQL.** Un
   insert direct créerait des contacts sans ligne `email_list_imports`, or
   `purge_email_list` prend un `p_import_id` : pas de ligne d'import, pas de
   purge possible par le produit. Nomme la liste sans ambiguïté
   (« TEST App Review — à purger »).

**La purge, après le tournage.** Le bouton vit dans l'**Email Studio → écran
Audience → panneau des listes importées** (ouvrir un brouillon de campagne,
onglet Audience). Ce n'est pas un simple delete : `purge_email_list` verse
chaque adresse dans `email_opt_outs` (repoussoir permanent, portée Amoris)
avant de supprimer — c'est ce qui empêche de réabonner quelqu'un en
réimportant le même fichier. Ces alias seront donc définitivement
inimportables pour Amoris, sans importance pour des adresses jetables.

**Bonne nouvelle pour la vidéo :** le compteur affiché est ce que Yuno
ENVOIE, pas ce que Meta retrouve. 120 adresses affichent 120, et passent la
barre des 100 — le bouton Lookalike devient filmable.

### 2.6 Le compte du reviewer

Tu filmes sur Amoris, mais **tu ne donnes jamais Amoris au reviewer** : vrais
clients, vraies ventes, vrai compte Stripe. Le bon compte de test est
l'**organisateur démo** `organizer@womber.fr` (mot de passe dans le secret
`DEMO_LOGIN_PASSWORD` — jamais dans le repo). Même coquille, mêmes menus,
mêmes boutons que tes vidéos.

À vérifier en navigation privée avant d'envoyer le dossier :

- [ ] La connexion fonctionne
- [ ] Settings → Integrations affiche « Connect with Facebook »
- [ ] Marketing & CRM → Ads s'ouvre
- [ ] Il existe au moins une soirée à venir avec affiche, sinon le reviewer ne
      pourra pas ouvrir « Boost an event »

### 2.7 Déconnecter Meta avant chaque prise

Settings → Integrations → carte Meta → **Disconnect** → confirmer. C'est le
geste le plus important du tournage : chaque vidéo doit montrer la fenêtre
Facebook Login. Carte déjà connectée = pas de fenêtre = pas de preuve = rejet.

---

## Partie 2 bis — Filmer un compte réel : les cinq écrans à surveiller

Le montage étant interdit à l'intérieur d'une vidéo, il n'y a pas de floutage
possible en post. Il faut donc ne pas filmer ce qu'on ne veut pas montrer.

| Écran | Ce qui fuite | Ce que tu fais |
|---|---|---|
| **Overview** (après la connexion) | le chiffre d'affaires réel d'Amoris | donnée business, pas personnelle : assume ou enchaîne vite vers Settings |
| **Contact base** (Marketing & CRM) | noms et emails de vrais clients | **ne l'ouvre pas.** La vidéo 8 n'en a pas besoin |
| **Leads** (page Ads) | le lead que tu viens de créer | aucun risque, email bidon. C'est **là** que se filme la preuve |
| **Campagnes** (page Ads) | titres de soirées, budgets, dépense | inoffensif, et même crédible. Laisse |
| **Ads Manager** (onglet Meta) | solde et historique de dépense | referme les autres campagnes, reste sur la tienne |

Deux conséquences durables :

- **Connecter le vrai pixel met le tracking en route pour de vrai.** Chaque
  achat d'un client d'Amoris qui a accepté la publicité part vers le pixel
  Amoris via la Conversions API. Comportement voulu, mais ce n'est plus une
  simulation. Pour l'arrêter : **Disconnect**, le jeton est détruit.
- **La campagne créée est une vraie campagne.** Supprime-la à la fin si elle
  n'a pas vocation à tourner, ou garde-la en pause.

---

## Partie 3 — Le studio (15 min)

1. **Un navigateur propre.** Chrome → nouveau profil, rien dans les favoris,
   aucune extension.
2. **Fenêtre 1440 × 900**, zoom à 100 % (⌘0). Barre d'adresse visible : c'est
   elle qui prouve qu'on est sur `yunoapp.eu` puis sur `facebook.com`.
3. **Coupe les notifications** : Réglages macOS → Concentration → Ne pas
   déranger.
4. **Enregistreur** : ⌘⇧5 → Enregistrer la portion sélectionnée → Options →
   **Afficher les clics de souris : oui** → Enregistrer.
5. **Pas de son**, ou un commentaire en anglais.
6. **Ralentis tes clics.** Une seconde d'arrêt sur chaque écran clé.
7. Après chaque prise, **relis-la**. Refaire une prise coûte deux minutes ; un
   rejet coûte deux semaines.

---

## Partie 4 — La répétition à blanc (30 min, obligatoire)

**Ne lance pas l'enregistrement la première fois.** Fais tout le parcours sans
filmer. C'est là que tu découvriras que l'URI de redirection a un caractère de
travers, que l'invitation de testeur n'a pas été acceptée, ou que l'Instagram
n'apparaît pas dans la fenêtre Meta.

1. Settings → Integrations → **Connect with Facebook** → portefeuille Amoris,
   tout coché → retour Yuno.
2. **Pick your pixel** → `Amoris pixel` → **Confirm**.
3. Carte Meta → **Check now**.
4. Marketing & CRM → Ads → **Check account** → pastilles vertes.
5. Audiences → **Create an audience** → Buyers, last 12 months → **Send to
   Meta** → statut « ready ».
6. **Boost an event** → 5 étapes nommées → **Create paused**.
7. Ads Manager : la campagne est en PAUSED, son identité montre la Page **et**
   l'Instagram.
8. **Leads → Enable collection**.
9. Outil de test des leads → soumettre → le lead apparaît « in base ».

Répare ce qui a coincé, remets le plateau à zéro (partie 6), puis filme.

---

## Partie 5 — Le tournage

### 5.0 Trois prises, pas neuf

**Ne cherche pas à faire une seule longue prise découpée en neuf.** C'est
impossible : si tu te connectes une fois, un seul extrait contient la fenêtre
Facebook Login, et les huit autres tombent sur le motif de rejet n° 1. Le bon
découpage, c'est **trois prises continues**, chacune démarrant par une
connexion fraîche (Disconnect entre les deux, dix secondes). Le même fichier
est ensuite soumis à plusieurs permissions.

| Prise | Durée | Contenu | Permissions servies |
|---|---|---|---|
| **A** | ~2 min | connexion → écran des actifs → Pick your pixel → Confirm → section Connection → Check now | `business_management`, `pages_show_list` |
| **B** | ~4 min | connexion → Check account → audience → Boost (5 étapes) → Create paused → Ads Manager → Activate → Pause → Refresh | `ads_read`, `ads_management`, `pages_read_engagement`, `pages_manage_ads`, `instagram_basic` |
| **C** | ~2 min | connexion → Leads → Enable collection → lead de test → « in base » | `pages_manage_metadata`, `leads_retrieval` |

Huit minutes de rushes au lieu de quinze, trois remises à zéro au lieu de
neuf. Tu ne coupes **jamais à l'intérieur** d'une prise.

**Le prix à payer, honnêtement.** Une vidéo taillée pour une seule permission
reste le standard le plus sûr ; en partageant un fichier, le reviewer doit
retrouver le moment qui le concerne. La parade coûte trente secondes : dans le
texte d'usage de chaque permission, **ajoute l'horodatage** — « at 1:20, the
club picks which pixel to connect ». Ça transforme une vidéo longue en preuve
ciblée. Et si une permission se fait rejeter pour « la vidéo ne montre pas
clairement X », tu retournes **celle-là seule**, sur mesure.

### 5.1 Le plan d'ouverture, au début de chaque prise (~40 s)

| # | Geste | Ce qu'on doit voir |
|---|---|---|
| 1 | Barre d'adresse : `yunoapp.eu` | l'accueil public, 2 s |
| 2 | Se connecter (compte orga Amoris) | le dashboard, 2 s, sans insister sur les chiffres |
| 3 | Settings → Integrations | la carte « Meta (Facebook & Instagram) », état vide, 2 s |
| 4 | **Connect with Facebook** | le bouton, puis la fenêtre bleue Meta |
| 5 | Choisir le portefeuille Amoris | la liste des portefeuilles, **arrêt 2 s** |
| 6 | Écran des actifs (Pages / Instagram / comptes pub / pixels) | **arrêt 3 s, tout coché** |
| 7 | Écran des permissions, tout coché → Continuer | **arrêt 3 s** |
| 8 | Retour sur Yuno | « Connected » ou « Pick your pixel » |

---

### Vidéo 1 — `business_management` (prise A)

**Prouve :** Yuno liste les actifs de l'entreprise du client pour qu'il
choisisse lesquels connecter.

1. Plan d'ouverture. **Arrêt 4 s sur la liste des actifs** : « Amoris Ads », la
   Page « Amoris », le compte Instagram, les deux jeux de données.
2. Retour sur Yuno : **Pick your pixel**, avec « Your Meta account has several
   assets… ».
3. Déroule les trois listes **une par une**, lentement : Pixel (dataset), Ad
   account, Facebook Page.
4. `Amoris pixel` → **Confirm**.
5. La carte passe à **Connected**. Défile jusqu'à **Connection** : pixel,
   compte pub et Page retenus.

> Yuno lists the pixels, ad accounts and Pages of the business the club
> authorizes, so the club can choose which ones to connect. Nothing else is
> read from the business.

### Vidéo 2 — `ads_read` (prise B)

**Prouve :** Yuno lit l'état du compte pub et les résultats des campagnes.
**Pré-requis :** une campagne doit déjà exister, sinon il n'y a rien à
rafraîchir.

1. Carte Meta → **Connection health** → **Check now**.
2. **Arrêt 4 s** : « Checked… », **Permissions granted** avec la liste des
   scopes, **Match quality (Purchase)**.
3. Marketing & CRM → Ads → **Check account** → **arrêt 3 s** sur les pastilles.
4. Sur une campagne, **Refresh** → **arrêt 3 s** sur Spent, Impressions,
   Clicks, Yuno sales, Cost per sale.
5. Déplie la campagne → **Sales attributed by Yuno** et **Purchases counted by
   Meta** côte à côte.

> Yuno reads the ad account status and the campaign insights (spend,
> impressions, clicks, purchases) to show the club the results of the ads it
> launched from Yuno, next to the tickets those ads sold.

### Vidéo 3 — `ads_management` (prise B)

La permission la plus scrutée : montre les **deux** usages, audiences et
campagnes.

1. Ads → Audiences → **Create an audience** → **Buyers, last 12 months** →
   **arrêt 3 s** sur « {n} consenting people » et sur « Only contacts who
   accepted your emails or SMS are sent, hashed. »
2. **Send to Meta** → la ligne passe **pending** puis **ready**.
3. **Boost an event**, une seconde d'arrêt par étape (la barre du haut nomme
   les cinq étapes — laisse-la dans le cadre) :
   - **Event** : la soirée, objectif **Sales**
   - **Budget** : Per day, **5 €**, dates
   - **Targeting** : ville, âge, **l'audience de l'étape 2** dans « Yuno
     audiences », et le mode « My criteria, expanded by Meta » ; **arrêt 3 s**
     sur « Reachable people » (l'estimation Meta)
   - **Creative** : la création 1 (affiche), puis **Add a creative** → un
     carrousel ou une vidéo ; l'aperçu à droite change. **Arrêt 3 s.**
   - **Review** : **arrêt 4 s**, on lit « The campaign lands paused in your
     Meta account: nothing is spent until you activate it. »
4. **Create paused** → pastille **paused**.
5. Ads Manager, recharge : campagne en **PAUSED** avec l'affiche. **Arrêt 4 s.**
6. Retour Yuno → **Activate** → pastille **active** (souvent « in Meta
   review »). **Arrêt 3 s.**
7. **Pause** immédiatement. C'est ce plan qui prouve que le contrôle reste au
   client.

> Yuno creates custom audiences from the club's consenting contacts, and
> creates ad campaigns (campaign, ad set, creative, ad) in the club's ad
> account from an event page, always paused; the club activates, pauses and
> archives them from Yuno.

### Vidéo 4 — `pages_show_list` (prise A)

**Prouve :** Yuno liste les Pages du client pour qu'il choisisse la bonne.

1. Plan d'ouverture, **4 s sur la section Pages** de la fenêtre Meta.
2. **Pick your pixel** → dérouler **Facebook Page** : la Page Amoris. **Arrêt
   3 s.**
3. **Confirm**, puis section **Connection** : la Page retenue.

> Yuno lists the club's Facebook Pages so the club picks the Page its ads and
> lead forms belong to.

### Vidéo 5 — `pages_read_engagement` (prise B)

**Prouve :** Yuno lit le nom et l'identité de la Page pour construire la pub
sous cette Page.

1. Ads → **Boost an event** → étape **Creative**.
2. **Arrêt 6 s sur l'aperçu de la pub** : en haut s'affichent le **nom de la
   Page** et **Sponsored**. C'est le plan clé — zoome (⌘+) si besoin.
3. **Review** → le récapitulatif nomme la Page → **Create paused**.

> Yuno reads the Page's name and identity to build the ad creative under the
> club's Page.

### Vidéo 6 — `pages_manage_ads` (prises B et C)

**Prouve :** Yuno crée des pubs publiées au nom de la Page, et abonne les
formulaires de la Page.

1. **Create paused** (prise B), puis Ads Manager : ouvre la pub → **arrêt 4 s
   sur le champ Identité / Page** : c'est la Page Amoris.
2. Section **Leads** → **Enable collection** → pastille **Collection active**.

> Yuno creates ads published under the club's Page and subscribes the Page's
> lead forms so the club receives its leads in Yuno.

### Vidéo 7 — `pages_manage_metadata` (prise C)

**Prouve :** Yuno abonne la Page au webhook `leadgen`. Vidéo courte, tant
mieux.

1. Ads → **Leads**. **Arrêt 3 s** sur « Forms filled on your Instagram and
   Facebook ads, added to your contact base with proof of consent. »
2. **Enable collection** → toast → pastille **Collection active**. **Arrêt
   3 s.**
3. Facultatif : carte Meta → **Check now** → la santé mentionne l'abonnement
   webhook.

> Yuno subscribes the club's Page to the leadgen webhook so new lead form
> submissions are delivered to Yuno in real time.

### Vidéo 8 — `leads_retrieval` (prise C)

**Prouve :** Yuno lit le contenu d'un formulaire rempli et verse la personne
dans la base de contacts. **Pré-requis :** le formulaire instantané existe,
**Enable collection déjà cliqué**, et
`developers.facebook.com/tools/lead-ads-testing` ouvert dans un second onglet.

1. Ads → **Leads** → montre l'état de la collecte.
2. Onglet de l'outil de test : Page `Amoris`, Form `Amoris guest list` →
   **Create lead** (ou Preview form, avec un email et un nom **bidons**).
3. Retour sur Yuno → **recharge** → **arrêt 6 s** : le lead apparaît avec nom,
   email et la pastille **in base**.
4. **Arrêt 3 s sur la phrase sous la liste** : « Each lead becomes a contact
   subscribed to your emails (source "Meta form"), never if they had
   unsubscribed. »

Les points 3 et 4 **suffisent** : la pastille « in base » est la preuve que le
lead a été versé dans la base. **N'ouvre pas la page Contact base** — compte
réel, vrais clients.

> Si le lead n'arrive pas : presque toujours « Enable collection » non cliqué,
> ou un formulaire appartenant à une autre Page. Si tu n'arrives pas à produire
> ce plan, **retire `leads_retrieval` du dossier** : une permission sans usage
> filmé fait rejeter tout le lot.

> Yuno retrieves the content of lead forms submitted on the club's ads and
> adds the person to the club's contact base with proof of consent, so the
> club can follow up by email.

### Vidéo 9 — `instagram_basic` (prise B)

1. Plan d'ouverture, **3 s sur la ligne « Instagram accounts »** de la fenêtre
   Meta, compte Amoris coché.
2. **Boost an event** → **Creative** → **arrêt 3 s sur l'interrupteur
   Instagram, activé**.
3. **Review** → la ligne **Placements** affiche « Instagram + Facebook ».
   **Arrêt 3 s.**
4. **Create paused**.
5. Ads Manager → la pub → **Identité** : le compte Instagram d'Amoris comme
   identité de diffusion. **Arrêt 4 s.** C'est le plan clé.

> Yuno reads the Instagram business account linked to the Page so the club's
> ads run under its Instagram name instead of its Facebook Page only.

### Marketing API Access Tier (Full Access)

**Pas de vidéo** depuis mai 2026, seulement un texte :

> Yuno is a nightlife ticketing platform. Clubs and organizers connect their
> Meta business to Yuno (Facebook Login for Business) and, from an event page,
> create paused campaigns in their own ad account, sync consenting customer
> audiences, and read insights. Yuno never spends on their behalf: activation
> is an explicit click.

Ce palier s'obtient après 500 appels API sur 15 jours avec moins de 15 %
d'erreurs. Le tournage lui-même y contribue.

---

## Partie 6 — Remise à zéro

**Entre deux prises :**

1. Settings → Integrations → carte Meta → **Disconnect** → confirmer.
2. Campagne inutile : Ads → chevron → supprimer (archivée chez Meta).
   **Garde-en une** pour la vidéo 2.
3. Audience en double : supprime-la.
4. Recharge (⌘R).

**À la toute fin du tournage, puisque c'est un compte réel :**

- Ads Manager : **aucune campagne active**, dépense proche de zéro.
- **Purge la liste de test** (Email Studio → Audience → listes importées).
- Rallume les automatisations email que tu avais éteintes (§2.5).
- Décide si tu laisses la connexion Meta branchée (les vraies ventes partent
  vers le pixel Amoris, comportement voulu) ou si tu fais **Disconnect**.

---

## Partie 7 — Nommer, vérifier, téléverser

```
01-business_management.mov    (prise A)
02-ads_read.mov               (prise B)
03-ads_management.mov         (prise B)
04-pages_show_list.mov        (prise A)
05-pages_read_engagement.mov  (prise B)
06-pages_manage_ads.mov       (prise B ou C)
07-pages_manage_metadata.mov  (prise C)
08-leads_retrieval.mov        (prise C)
09-instagram_basic.mov        (prise B)
```

La grille avant de téléverser :

- [ ] La fenêtre **Facebook Login** est visible
- [ ] L'écran des **permissions** apparaît, cases cochées
- [ ] Un écran **de Yuno** utilise la donnée
- [ ] Interface **en anglais**, barre d'adresse lisible
- [ ] Aucune donnée personnelle de vrai client à l'image
- [ ] 1 à 3 minutes, sous 100 Mo, **aucune coupe** à l'intérieur
- [ ] Le texte d'usage porte l'**horodatage** du moment qui concerne la
      permission

Puis : App Dashboard → Révision de l'app → Permissions et fonctionnalités →
pour chaque permission, **Demander l'accès avancé** → Ajouter des détails →
texte d'usage + vidéo → instructions de test (partie 8) → **Soumettre**.

---

## Partie 8 — Instructions de test pour le reviewer

```
Test account (Yuno organizer dashboard): https://yunoapp.eu/auth
  email: organizer@womber.fr   password: <mot de passe demo>
This is a demo organizer account with the exact same screens as the videos
(the recordings were made on a live customer account, which we cannot share
because it holds real customer data). Steps:
1. Log in, open Settings then Integrations, click Connect with Facebook.
2. Authorize with a Facebook account that admins a Business portfolio owning
   a Page, an ad account and a dataset (pixel). Keep every asset and
   permission checked.
3. Back on Yuno, pick the pixel/ad account/Page if asked, then click
   Check now (ads_read, business_management).
4. Open Marketing and CRM then Ads. Check account reads the ad account.
   Create an audience with Buyers, last 12 months, then Send to Meta
   (ads_management, custom audiences). Boost an event, 5 steps, then
   Create paused: a PAUSED campaign appears in your Ads Manager
   (ads_management, pages_read_engagement, instagram_basic).
5. In the Leads section click Enable collection (pages_manage_metadata,
   pages_manage_ads). Submit a test lead with the Lead Ads testing tool on
   the connected Page: it appears in the Leads list within a minute
   (leads_retrieval).
Nothing is ever spent on the reviewer behalf: every campaign is created
PAUSED and activation is an explicit click.
Data deletion callback: https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/data-deletion
Privacy policy: https://yunoapp.eu/legal/confidentialite
```

Le mot de passe du compte démo vit dans le secret Supabase
`DEMO_LOGIN_PASSWORD`. **Ne le mets nulle part dans le repo.**

---

## Partie 9 — Les erreurs qui font rejeter

| Erreur | Pourquoi c'est fatal | Le bon geste |
|---|---|---|
| Pas de fenêtre Facebook Login | rien ne prouve d'où vient l'accès | Disconnect avant chaque prise (§2.7) |
| La vidéo montre Ads Manager, pas Yuno | Meta connaît déjà Ads Manager | terminer sur un écran de Yuno |
| Texte d'usage générique | ne dit ni quoi, ni pour qui, ni pourquoi | reprendre les textes des vidéos |
| Le reviewer ne peut pas reproduire | compte cassé, pas de soirée à venir, page « In progress » | tout tester en navigation privée (§2.6) |
| Pastille **Soon** dans le menu | le reviewer conclut que ça n'existe pas | §0.7 |
| Interface en français | le reviewer ne lit pas le français | §2.2 |
| Données personnelles réelles à l'image | rejet **et** problème RGPD | partie 2 bis |
| Une permission sans usage filmé | fait tomber **tout le lot** | la retirer et la redemander plus tard |
| URL de suppression des données absente | motif classique | déjà posée, la tester |

---

## Partie 10 — Après l'envoi

- **5 à 20 jours ouvrés** par cycle.
- Meta demande un complément : **réponds sous 48 h**, sinon le dossier expire.
- Un refus ne vise souvent qu'**une** permission : tu ne retournes que celle-là.
- Tout accordé : App Dashboard → Paramètres → Général → **Mode de l'app :
  Live**, puis étape 8 du guide de mise en service
  (`META_INTEGRATION_LIVE = true`) — et **retire l'email d'Amoris de
  `META_BETA_EMAILS`**.

---

## Chronologie conseillée

| Quand | Quoi | Durée |
|---|---|---|
| J-4 | Vérification d'entreprise de Yuno (§0.4) | 15 min + 1 à 3 j |
| J-2 | Badge « Soon » (§0.7) et `META_BETA_EMAILS` (§0.6) | 30 min + déploiement |
| J-1 | Décor Amoris, Instagram compris (partie 1) | 50 min |
| J-1 | Compte organisateur + compte reviewer (partie 2) | 35 min |
| J-1 | Studio (partie 3) | 15 min |
| J | Répétition à blanc (partie 4) | 30 min |
| J | Tournage : trois prises | 45 min |
| J | Découpe, grille, téléversement | 45 min |
