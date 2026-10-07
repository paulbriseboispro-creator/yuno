# Yuno CRM — analyse client : textes à relire (PROPOSITION, rien n'est publié)

Dossier préparé le 7 octobre 2026 pour Paul et le juriste. Aucun de ces textes
n'est en ligne : les pages `/legal/*` du site n'ont pas changé. L'apprentissage
commun (partie C) est éteint en production (`crm_learning_settings.enabled =
false`) et ne s'allumera qu'après validation de ce dossier.

## 0. Ce que fait la fonctionnalité, en clair

Un organisateur (club, association, collectif) relie Yuno CRM à sa billetterie
Shotgun. Yuno importe ses soirées et ses billets (acheteur, détenteur, date
d'achat, prix, scan à la porte, code postal et pays si Shotgun les transmet,
source de l'achat).

À partir de ces données, Yuno teste des **hypothèses** sur ce qui fait revenir
ses clients : « les clients qui reviennent choisissent-ils plus souvent qu'au
hasard une soirée avec un artiste déjà vu ? », « quelqu'un qui achète tôt
le refait-il la fois suivante ? », « les nouveaux venus arrivés par une
invitation reviennent-ils plus ou moins que les autres ? ». Chaque hypothèse
reçoit un statut (confirmée sur le compte, pas confirmée, à tester), calculé
sur les propres soirées de l'organisateur.

Ce qui en sort :

- **en agrégé** : quelles hypothèses tiennent sur ce compte (écran « Ce qui
  fait venir ») ;
- **par personne** : sur la fiche d'un client, les hypothèses qui le
  concernent, avec leur statut et leur preuve (« 6 soirées sur 10 étaient
  Techno ») — visibles par les rôles qui voient déjà les clients nommés,
  jamais dans un export ;
- **des segments** (« clients pour qui l'hypothèse line-up s'applique ») que
  l'organisateur peut utiliser pour ses campagnes e-mail / SMS, à ses
  contacts qui y ont consenti.

Aucune donnée sensible (art. 9) n'est lue ou déduite. Pas de décision
automatisée produisant des effets juridiques (art. 22) : l'organisateur
choisit à qui il écrit. Un droit d'opposition existe déjà sur la fiche
client (« Exclure du profilage » : le profil est effacé et n'est plus
calculé).

**Apprentissage commun (éteint)** : chaque compte peut contribuer, par
défaut et avec refus possible dans ses Réglages, à des **comptages anonymes**
(par famille d'hypothèse : nombre de retours testés, nombre de choix
conformes, nombre attendu au hasard). Ces comptages servent à proposer de
meilleurs seuils à tous les comptes, après validation de Paul. Garde-fous
techniques : aucun comptage sous 10 personnes, clé aléatoire par compte
(détruite avec lui), un résultat commun seulement à partir de 5 comptes
contributeurs et si aucun compte ne pèse plus de la moitié du total, aucune
donnée de personne, aucun titre de soirée, nom d'artiste ou ville.

## 1. Rôles (à confirmer)

- **Organisateur = responsable de traitement** pour les données de ses
  clients (achat, présence, profil et hypothèses).
- **Yuno = sous-traitant** (art. 28) pour l'import, le calcul des hypothèses,
  l'affichage et les envois.
- **Shotgun** : la billetterie de l'organisateur, qui met les données à
  disposition par son API à la demande de l'organisateur (jeton collé par
  l'organisateur lui-même). Shotgun n'est ni sous-traitant de Yuno ni
  destinataire.
- **Apprentissage commun** : Yuno produit des statistiques anonymes à partir
  de données traitées pour le compte du client. Question ouverte (point 5.1).

## 2. Textes proposés

### A. Accord de sous-traitance (DPA, `/legal/dpa`) — article 2, à compléter

Aujourd'hui l'article 2 ne parle ni de Yuno CRM ni de l'import d'une
billetterie tierce. Proposition (ajouts en gras) :

> **2. Traitements concernés**
> • Nature et finalités : vente et contrôle de billets, gestion de guest
> lists, réservations de tables VIP, commandes de boissons, **import des
> soirées et billets depuis une billetterie connectée par le Partenaire,
> analyse du comportement d'achat et de présence de ses clients (hypothèses
> statistiques sur ce qui les fait revenir, affichées en agrégé et sur la
> fiche de chaque client)**, campagnes de communication du Partenaire,
> statistiques d'audience.
> • Catégories de données : identité, coordonnées, données de commande et
> de présence, **code postal et pays de résidence lorsque la billetterie les
> transmet, distance estimée au lieu de la soirée,** données démographiques
> déclaratives.

### B. DPA — nouvel article « Statistiques anonymes » (après l'article 3)

> **3 bis. Statistiques anonymes.** Le Partenaire autorise Yuno à produire,
> à partir des données traitées pour son compte, des statistiques agrégées et
> anonymes (comptages par famille d'analyse, tels que « nombre de retours
> testés », « nombre de choix conformes », « nombre attendu au hasard »),
> destinées exclusivement à améliorer les règles d'analyse du service pour
> l'ensemble de ses utilisateurs. Ces statistiques ne contiennent aucune
> donnée à caractère personnel, ni identifiant direct ou indirect (adresse
> électronique ou empreinte de celle-ci, nom, identifiant de personne), ni
> information commerciale du Partenaire (titre de soirée, nom d'artiste,
> ville) ; tout comptage portant sur moins de dix personnes est supprimé à
> la source. Elles sont rattachées à une clé aléatoire propre au compte,
> détruite avec lui. Un résultat commun n'est publié qu'à partir de cinq
> comptes contributeurs et lorsqu'aucun compte ne représente plus de la
> moitié du total. Le Partenaire peut s'opposer à tout moment à cette
> contribution depuis les réglages de son compte ; ses contributions passées
> sont alors supprimées. Yuno ne croise jamais les données de deux comptes au
> niveau d'une personne, n'entraîne aucun modèle sur des données de
> personnes et ne transmet aucune donnée personnelle à un tiers pour cette
> finalité.

(Le DPA dit « le Partenaire » partout ; la version du plan disait « le
Client » : harmonisé.)

### C. DPA — article 5, sous-traitants ultérieurs : Octopush manque

Les SMS des organisateurs partent par Octopush depuis le 8 octobre. Octopush
figure dans la politique de confidentialité client, mais **pas** dans la
liste du DPA. Proposition :

> … Resend (envoi d'emails), **Octopush (envoi de SMS, société française,
> données hébergées en France),** Mapbox (cartographie), …

À vérifier au passage : OpenAI. L'Assistant Console lit des chiffres du
Partenaire (et, sur demande, des fiches clients) pour répondre ; s'il en
reçoit des données de clients finaux, il est sous-traitant ultérieur et doit
être listé (transfert hors UE compris, article 10).

### D. Modèle de mention pour la politique de confidentialité de l'organisateur

L'organisateur, responsable de traitement, doit informer ses clients (art.
13/14 ; données obtenues via Shotgun = art. 14). Texte que Yuno peut lui
fournir (centre d'aide ou mail d'accueil) :

> **Analyse de la fréquentation.** Nous analysons l'historique de vos achats
> de billets et de votre présence à nos soirées (dates, soirées choisies,
> moment de l'achat, achat à plusieurs, code postal) pour comprendre ce qui
> fait revenir notre public et vous proposer des soirées qui vous
> correspondent. Cette analyse repose sur notre intérêt légitime à connaître
> notre public ; elle ne produit aucun effet juridique à votre égard. Vous
> pouvez vous y opposer à tout moment en écrivant à [contact] : votre profil
> d'analyse est alors effacé et n'est plus calculé. Prestataire : Yuno
> (WOMBER, France), qui traite ces données pour notre compte.

### E. Registre des traitements de Yuno (`docs/legal/REGISTRE_TRAITEMENTS_RGPD.md`)

À ajouter côté sous-traitant (art. 30.2) : « Yuno CRM — import billetterie
connectée et analyse client », pour le compte des organisateurs, catégories
ci-dessus, durée = celle de l'abonnement, purge à la déconnexion de la
billetterie (déjà codée). Côté responsable distinct : « statistiques
anonymes d'amélioration du service » si le juriste conclut qu'elles relèvent
de Yuno (point 5.1).

## 3. Ce que le code garantit déjà (pour appuyer les textes)

| Engagement | Où c'est tenu |
|---|---|
| Opposition par personne, profil effacé | `crm_profile_optout`, table `crm_profile_optouts` |
| Purge à la déconnexion de la billetterie | trigger `trg_crm_analysis_connection_purge` |
| Effacement d'un contact = effacement de son profil | `_crm_erase_contacts` |
| Hypothèses jamais dans un export | lectures `crm_client_analysis` seulement, pas d'export |
| Aucun comptage commun sous 10 personnes | `_crm_an_contribute` (n ≥ 10) |
| Commun publié à 5 comptes, aucun > 50 % | `crm_learning_publish` |
| Refus de contribution, passé supprimé | `crm_learning_contrib_set` (titulaire seul, jamais en accès assisté) |
| Apprentissage commun éteint | `crm_learning_settings.enabled = false` |
| Changement de seuils = décision humaine tracée | `crm_admin_rules_approve` → `admin_audit_log` |

## 4. Ce qui n'est pas encore lu

**Conditions de l'API Shotgun.** Le 7 octobre, `shotgun.live/privacy.html`
répondait 429 et l'article du centre d'aide pro 403 ; la documentation de
l'API ne contient pas de conditions d'usage. À demander à Shotgun dans la
discussion partenaire : (a) usage des données de billets par un outil tiers
mandaté par l'organisateur ; (b) production de statistiques agrégées et
anonymes entre organisateurs.

## 5. Questions pour le juriste

1. **Anonymisation par le sous-traitant.** Produire des statistiques
   anonymes à partir de données traitées pour le client est-il un traitement
   que le client doit autoriser (d'où l'article 3 bis), ou une finalité
   propre de Yuno (responsable distinct, base intérêt légitime) ? Cela
   change le registre et la rédaction.
2. **Contribution « par défaut, refus possible »** : acceptable sous forme
   d'autorisation contractuelle avec opposition dans les réglages, ou faut-il
   un accord actif ?
3. **Profilage par l'organisateur** : la base intérêt légitime tient-elle
   pour l'affichage d'hypothèses sur la fiche d'un client et leur usage pour
   cibler des e-mails (aux seuls contacts qui ont accepté la newsletter) ?
   Faut-il une analyse d'impact (critère « évaluation / scoring ») ?
4. **Information des clients finaux** : le modèle de la partie D suffit-il,
   et Yuno doit-il exiger contractuellement qu'il soit publié par
   l'organisateur ?
5. **Données obtenues via Shotgun** : la base juridique de l'organisateur
   pour réutiliser ses propres données de billetterie dans un CRM tiers est-elle
   couverte par ses CGV / sa politique sur Shotgun ?
6. **OpenAI** comme sous-traitant ultérieur (partie C).
7. **« Chances de venir »** (score de prédiction, en ligne après validation) :
   pour chaque client déjà venu, une estimation de sa chance d'acheter pour
   une soirée à venir, montrée à l'organisateur en étiquette (élevées /
   moyennes / faibles) avec ses raisons, jamais en pourcentage, jamais
   exportée, jamais utilisée pour une décision automatique. C'est une
   évaluation au sens de la CNIL : l'analyse d'impact devient-elle
   obligatoire, et la mention du modèle de la partie D (« analyse de la
   fréquentation ») suffit-elle, ou faut-il nommer l'estimation ?
