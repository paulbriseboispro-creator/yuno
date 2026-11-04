# Ne plus jamais finir en spam : domaine du pro, règles d'envoi, coûts

Ouvert le 2026-11-03, après la chute de `news.yunoapp.eu` chez Gmail (constat et
reprise : `docs/EMAIL_GMAIL_RECOVERY.md`). Ce document compare Yuno à Shopify,
Brevo, Klaviyo et Mailchimp, puis fixe **toutes** les règles d'envoi, avec et
sans domaine du pro, et ce que ça coûte à Yuno. Rien n'est encore codé : tout ce
qui est marqué « à construire » attend le feu vert de Paul.

**État au 04/11** : l'envoi intelligent, la garde de campagne, le disjoncteur plus
strict, le plafond mensuel, la récidive, le niveau 3 du domaine commun, le bilan du
jour et la page Santé en schémas sont CONSTRUITS (migration `20261129100000`). Restent
à construire : la vérification des fichiers importés (règle 5) et le domaine relié du
pro (section 8). L'en-tête `Feedback-ID` est abandonné : Resend passe par Amazon SES,
qui pose le sien.

## 1. Ce qui a cassé, en une phrase

Tous les pros de Yuno signent leurs e-mails avec **le même domaine**
(`news.yunoapp.eu`). Gmail note la réputation **par domaine signataire** : quand
WOH a envoyé d'un coup 7 140 e-mails Gmail à un fichier jamais écrit, c'est la
réputation de ce domaine commun qui a chuté, et Gmail range depuis en spam les
e-mails de **tous** les pros, y compris les infos pratiques envoyées aux
acheteurs. SPF, DKIM et DMARC passent : ce n'est pas un problème de réglage.

## 2. Pourquoi Shopify marchait bien

Shopify Email (devenu « Shopify Messaging ») fait exactement ce qu'on veut
offrir. Ce qui le rend fiable :

| Ce que fait Shopify | Détail |
|---|---|
| **Envoi intelligent, actif par défaut** (« Smart delivery ») | Dès qu'une campagne vise plus de 1 000 abonnés, Shopify retire tout seul ceux qui n'ont pas interagi avec les derniers e-mails. Le marchand peut le couper, mais Shopify prévient que les rebonds et les plaintes vont monter |
| **Plafonds d'envoi automatiques** (« safe send limits ») | Un plafond par jour ou par semaine, propre à chaque boutique, qui **monte tout seul** quand la réputation est bonne. Un bandeau prévient à l'approche du plafond ; au-delà, l'envoi attend le lendemain ou part par lots |
| **Pause automatique** | Peu d'ouvertures ou trop de signalements : Shopify met l'envoi en pause, et peut suspendre l'accès à l'outil |
| **Nettoyage permanent, impossible à couper** | Rebonds, désabonnés, plaintes et inscriptions de robots retirés avant chaque envoi |
| **Domaine du marchand en option** | Sans domaine relié, l'adresse est réécrite en `store+123@shopifyemail.com` (domaine de Shopify, déjà authentifié), les réponses arrivent chez le marchand. Avec domaine relié : des enregistrements CNAME (SPF + DKIM) et un DMARC, au moins `p=none`. Un domaine acheté chez Shopify est configuré tout seul |
| **Chauffe conseillée** | Commencer par les plus engagés (achat récent, ou ouverture / clic sous 30 jours), puis +20 à 30 % par semaine |
| **Prix** | 10 000 e-mails offerts par mois, puis 1 $ les 1 000 |

Pourquoi ça marchait pour toi : tes contacts étaient des **acheteurs de ta
boutique** qui avaient coché la case à la commande, et Shopify filtrait d'office
ceux qui n'ouvraient plus. Le domaine `shopifyemail.com` porte des millions
d'e-mails attendus (commandes, abonnés actifs) : un marchand imprudent y pèse
peu, et il est mis en pause avant de l'abîmer.

Yuno a la même architecture que le mode « sans domaine » de Shopify (adresse
`woh@news.yunoapp.eu`). Ce qui manquait le 08/10 : l'envoi intelligent par
défaut, des plafonds par compte, et un domaine assez gros pour qu'un seul
expéditeur n'y pèse pas. Les plafonds existent depuis ce soir ; l'envoi
intelligent et le domaine du pro restent à construire.

## 3. Ce que font Brevo, Klaviyo, Mailchimp (pour comparer)

| | Brevo | Klaviyo | Mailchimp |
|---|---|---|---|
| Domaine qui signe | Domaine du client **obligatoire** depuis le 01/02/2024 ; une adresse Gmail ou Orange est remplacée par une adresse Brevo | Domaine partagé par défaut, domaine du client fortement recommandé, gratuit | Domaine du client authentifié ; une adresse gratuite est réécrite |
| Contacts nouveaux | Envoi d'abord à un **échantillon au hasard** ; mauvais signaux en 1 à 3 h ⇒ campagne et compte suspendus | Envoi conseillé aux engagés | **Omnivore** note chaque import et bloque les fichiers risqués |
| Sanction | Suspension immédiate, revue | Pause, revue | Suspension, revue ; on demande d'annuler le dernier import |
| IP dédiée | Dès 3 campagnes / semaine à 3 000 contacts | Au-delà d'environ 1 000 000 e-mails / mois | Groupes d'IP selon la qualité |

## 4. Ce que ça coûte à Yuno

Tarifs relevés sur resend.com/pricing le 03/11. Yuno est en **Resend Pro
(20 $/mois, 50 000 e-mails, 10 domaines)**.

| Poste | Coût |
|---|---|
| Les 8 premiers domaines de pros | **0 €** : l'offre Pro en compte 10, dont 2 déjà pris (`yunoapp.eu`, `news.yunoapp.eu`) |
| Du 9e au 108e pro | **+20 $/mois** (extension « 100 domaines » de Resend, valable sur Pro). Total Resend : 40 $/mois |
| Les e-mails eux-mêmes | **0 € de plus** : un e-mail signé par le domaine du pro coûte pareil, il est déjà compté |
| Passage en Scale (90 $/mois) | **Pas nécessaire** pour les domaines. Seulement au-delà de 100 000 e-mails par mois |
| Vérification DNS, suivi | 0 € (lecture DNS publique, Resend vérifie lui-même) |
| Vérification des adresses d'un fichier importé (section 6) | Environ **5 à 10 $ pour 1 000 adresses** chez les services du marché (NeverBounce, ZeroBounce, Kickbox ; prix des comparatifs, à confirmer). Le fichier WOH de 11 458 adresses : environ 60 à 115 $, une fois |
| Temps de support | Le vrai coût : aider les pros qui n'ont jamais touché à leur DNS. Réduit par le pas à pas par hébergeur et le bouton « envoyer les instructions à mon webmaster » |
| Construction | 1 à 2 jours avec Claude Code (1 à 2 semaines pour une équipe classique) |

**En résumé : 0 € jusqu'à 8 pros reliés, puis environ 20 $ (≈ 18 €) par mois
jusqu'à 108 pros.** Seule la vérification d'adresses varie avec les imports.

## 5. Les deux façons d'envoyer

| | **Sans domaine** (par défaut, comme Shopify) | **Avec domaine relié** |
|---|---|---|
| Adresse d'envoi | `woh@news.yunoapp.eu`, nom affiché « WOH » | `woh@news.woh.fr` (ou `@woh.fr`) |
| Qui porte la réputation | Le domaine commun de Yuno, partagé avec tous les pros | Le domaine du pro, seul |
| Ce que le pro doit faire | Rien | Ajouter 4 enregistrements DNS, une fois |
| Jusqu'où il peut monter | Niveau 3 au plus | Niveau 4, puis 5 sur demande |

Le domaine relié n'est **pas obligatoire** pour utiliser Yuno. Il devient
nécessaire pour écrire à beaucoup d'adresses jamais contactées, ou pour envoyer
plus de 1 500 e-mails par jour.

## 6. Les règles communes, avec ou sans domaine

Rien de ceci ne se désactive, quel que soit le compte. Les points marqués
**(à construire)** sont nouveaux ; le reste est déjà en ligne.

1. **Consentement** : seuls les contacts du registre de consentement reçoivent
   du marketing. Désabonnement en un clic. Un désabonné, un rebond dur ou une
   plainte n'est plus jamais écrit, par aucun pro (liste de suppression commune).
2. **Pression par personne** : 3 e-mails marketing par 24 h et 8 par 7 jours au
   plus, tous pros confondus ; une adresse qui a reçu 8 e-mails en 90 jours sans
   rien ouvrir est mise de côté.
3. **Envoi intelligent (à construire, sur le modèle de Shopify)** : sur toute
   campagne marketing de plus de 1 000 personnes, Yuno retire d'office les
   contacts qui ont reçu au moins 3 e-mails de ce pro en 180 jours sans en
   ouvrir ni cliquer un seul. Le rapport les compte (« mis de côté par l'envoi
   intelligent »). Sans domaine : toujours actif. Avec domaine : le pro peut le
   couper à partir du niveau 3, avec un avertissement.
4. **Adresses jamais écrites = vagues** : 100, puis 200, 400, 800, 1 600 au
   plus, chaque vague jugée 3 h après la précédente ; arrêt automatique et
   Yunits rendus si une vague tourne mal.
5. **Vérification des fichiers importés (à construire)** : tout fichier de plus
   de 200 adresses passe par un service de vérification. Adresses inexistantes
   et pièges à spam connus retirés d'office ; plus de 5 % d'invalides ⇒ le
   fichier est importé mais **pas envoyable** tant que le pro n'a pas vu le
   rapport et confirmé.
6. **Envoi réparti** : une campagne de 300 personnes ou plus ne part jamais
   d'un coup (rythme selon le niveau).
7. **Disjoncteur par campagne** : plus de 0,2 % de plaintes ou 5 % de rebonds ⇒
   la campagne s'arrête.
8. **Heures calmes, identité de l'expéditeur, adresse postale** : inchangées.
9. **Hors de ces règles** : billets, reçus, e-mails pratiques aux détenteurs
   d'une soirée. Ils partent toujours de `yunoapp.eu`.

## 7. Règles SANS domaine (le domaine commun de Yuno)

Le domaine commun ne doit porter **que des envois attendus**. Un pro sans
domaine ne peut pas l'abîmer pour les autres.

| Règle | Valeur |
|---|---|
| Niveaux possibles | 1 à 3, **jamais 4 ni 5** |
| Niveau 1 (départ) | 300 e-mails / jour, 150 / heure, 200 adresses jamais écrites / jour, 0 Gmail jamais écrite |
| Niveau 2 | 800 / jour, 250 / heure, 500 nouvelles, 100 Gmail nouvelles |
| Niveau 3 (maximum) | 1 500 / jour, 400 / heure, 1 000 nouvelles, 200 Gmail nouvelles |
| Montée | Un niveau au plus tous les 7 jours, si les 7 derniers jours ont au moins 200 envois, moins de 2 % de rebonds, au plus 0,5 ‰ de plaintes, Gmail ouvre au moins aux 3/4 des autres messageries, aucune vague arrêtée |
| Adresses jamais écrites (à construire) | En plus du plafond du jour : **3 000 au plus par mois et par compte** |
| Fichier importé | Envoyable seulement par vagues, dans ces plafonds. Un fichier de 11 000 adresses demande donc un domaine relié |
| Envoi intelligent | Toujours actif |
| Arrêt d'une vague (à construire, plus strict qu'aujourd'hui) | Dès 2 % de rebonds ou 0,5 ‰ de plaintes (contre 3 % et 1 ‰ avec domaine) |
| Récidive (à construire) | **Deux vagues arrêtées en 60 jours** ⇒ plus aucune adresse jamais écrite depuis le domaine commun ; le pro continue d'écrire à ses contacts engagés et doit relier un domaine pour rouvrir |
| Reprise Gmail | S'applique tant qu'elle est allumée (mesure de toute la plateforme) |
| « Tout d'un coup » | Jamais |
| Adresse de réponse | Celle du pro. Avertissement si c'est une adresse `@gmail.com` (à construire) |

## 8. Règles AVEC domaine relié

### Pour relier un domaine

1. Le pro saisit un domaine qu'il possède. Yuno propose un **sous-domaine**
   (`news.woh.fr`) : si ses envois tournent mal, sa boîte `@woh.fr`, celle où il
   reçoit ses réservations, reste intacte. La racine (`woh.fr`) reste possible,
   avec un avertissement.
2. Refusé : un domaine de messagerie gratuite (gmail.com, orange.fr…), un
   domaine déjà relié par un autre compte, un domaine sur une liste noire
   publique.
3. **4 enregistrements DNS**, comme chez Shopify :

| Rôle | Type | Nom | Valeur |
|---|---|---|---|
| Signature DKIM | TXT | `resend._domainkey.news.woh.fr` | clé rendue par Resend |
| Adresse de retour (rebonds) | MX | `send.news.woh.fr` | rendue par Resend |
| SPF | TXT | `send.news.woh.fr` | rendue par Resend |
| DMARC (exigé par Gmail) | TXT | `_dmarc.news.woh.fr` | `v=DMARC1; p=none;` si `woh.fr` n'en a pas déjà un |

4. Yuno détecte l'hébergeur du DNS et montre son pas à pas (OVH, IONOS,
   Cloudflare, GoDaddy, Wix, Squarespace), avec un bouton « Copier » par ligne et
   « Envoyer ces instructions à la personne qui gère mon site ».
5. Le domaine est actif quand les 4 lignes passent. Tant qu'il ne l'est pas, le
   pro envoie comme avant depuis le domaine commun.

### Ce qui change une fois le domaine actif

| Règle | Valeur |
|---|---|
| Départ | **Niveau 1 sur le nouveau domaine**, même si le pro était niveau 3 avant : Gmail ne connaît pas encore ce domaine |
| Première semaine | **Contacts engagés seulement** (ouverture ou clic sous 30 jours, achat sous 90 jours, inscription sous 30 jours), comme le conseille Shopify. Les adresses jamais écrites ouvrent la deuxième semaine |
| Niveaux possibles | 1 à 4 automatiquement (même échelle et mêmes conditions de montée que ci-dessus) ; niveau 4 = 5 000 / jour, 800 / heure, 2 000 nouvelles, 500 Gmail nouvelles |
| Niveau 5 (« tout d'un coup ») | Sur demande, accordé par le super admin après **4 semaines saines au niveau 4**. Pas automatique, parce que tous les domaines partagent le même compte Resend (voir plus bas) |
| Plafond mensuel d'adresses jamais écrites | Aucun au-delà des plafonds du niveau |
| Envoi intelligent | Actif par défaut, le pro peut le couper à partir du niveau 3 |
| Arrêt d'une vague | 3 % de rebonds ou 1 ‰ de plaintes (règle actuelle) |
| Sanction | Elle ne touche **que son domaine**. Mise à l'écart des nouvelles adresses 21 jours, comme aujourd'hui |
| Retour au domaine commun | **Interdit pour contourner** : un pro dont le domaine est mis à l'écart ne peut pas écrire à des adresses jamais contactées depuis le domaine commun pendant ce temps |
| Changer de domaine | **Une fois par 90 jours au plus**, et le nouveau domaine repart au niveau 1. C'est ce qui empêche d'user des domaines les uns après les autres |
| Reprise Gmail | La reprise de la plateforme ne s'applique pas à son domaine. Si Gmail ouvre moins de la moitié des autres messageries **sur son domaine** (au moins 200 Gmail), son domaine passe seul en reprise Gmail |
| Adresse de réponse | `contact@woh.fr` par défaut (son domaine racine) |
| Départ de Yuno | Domaine retiré de Resend 30 jours après la fin de l'abonnement |

### Le risque qui reste, même avec un domaine par pro

Tous les domaines vivent dans **le même compte Resend**, et Resend juge aussi le
compte entier : au-delà d'environ 0,08 % de plaintes ou 4 % de rebonds sur
l'ensemble, il peut suspendre le compte, billets compris. C'est pour ça que les
règles communes (vérification des fichiers, vagues, disjoncteur) restent
obligatoires même avec un domaine, et que le niveau 5 reste une décision
humaine.

## 9. Ce qu'il faut construire

| Chantier | Effort (Claude Code) |
|---|---|
| Domaine relié : table, actions Resend (dans `send-campaign`, quota de fonctions atteint), écran Réglages › Envoi, envoi signé par le bon domaine, niveaux et vagues par domaine | 1 à 2 jours |
| Envoi intelligent par défaut (règle 3) | une demi-journée |
| Règles du domaine commun : plafond mensuel, arrêts plus stricts, récidive, niveau 3 maximum | une demi-journée |
| Vérification des fichiers importés (règle 5) | 1 jour |
| ~~En-tête `Feedback-ID`~~ **Impossible chez Resend (testé le 04/11)** : un e-mail envoyé avec `Feedback-ID: fbltest1:yuno:test:yuno` est arrivé avec le seul Feedback-ID d'Amazon SES (le même sur tous nos e-mails), signé par `amazonses.com` ; notre en-tête est retiré et la signature `news.yunoapp.eu` ne couvre jamais ce champ. La boucle de rétroaction de Postmaster reste vide tant qu'on envoie par Resend : la vue par client passe par les sous-domaines | — |
| Version texte propre de chaque e-mail, alerte sur les mots de promotion répétés | quelques heures |

La lecture quotidienne de Google Postmaster est déjà en cours de construction
(migration `20261127160000_gmail_postmaster.sql`). Limite : Google ne publie des
chiffres qu'au-delà d'environ 5 000 e-mails Gmail par jour sur un domaine ; pour
un petit pro, la surveillance repose sur l'écart d'ouvertures Gmail / autres
messageries, que Yuno mesure déjà.

### Ce qu'on ne fait pas

- **Envoyer depuis la boîte Gmail ou Outlook du pro** : environ 500 e-mails par
  jour pour Gmail, 2 000 pour Google Workspace, pas de désabonnement conforme, et
  le pro risquerait la boîte où il reçoit ses réservations. Le domaine relié
  donne le même résultat (« ça vient de moi ») sans ce risque.
- **IP dédiée** : utile seulement pour des envois réguliers et importants ; avec
  des pics avant les soirées, elle ferait pire que l'IP partagée de Resend.
- **Un nouveau domaine commun pour repartir de zéro**, ou des domaines en
  rotation : Google le traite comme du contournement.
- **Acheter un domaine pour le pro** : décision de Paul du 03/11, non.

## 10. Décisions à valider par Paul

1. Domaine relié **inclus** dans l'offre (recommandé : il coûte 0 à 20 $ par
   mois à Yuno et protège tout le monde).
2. Domaine commun limité au **niveau 3** et à **3 000 adresses jamais écrites
   par mois**.
3. **Récidive** : deux vagues arrêtées en 60 jours ⇒ nouvelles adresses fermées
   sur le domaine commun.
4. **Vérification des fichiers** : Yuno la paie (environ 5 à 10 $ les 1 000
   adresses), ou elle est débitée en Yunits.
5. **Envoi intelligent** actif par défaut, coupable seulement avec un domaine
   relié et au niveau 3.

## Sources

- Shopify, Smart delivery et protections de liste : https://help.shopify.com/en/manual/promoting-marketing/create-marketing/shopify-messaging/delivery
- Shopify, délivrabilité (plafonds automatiques, chauffe, plaintes) : https://help.shopify.com/en/manual/promoting-marketing/create-marketing/shopify-messaging/email/deliverability
- Shopify, régularité du volume (+20 à 30 % par semaine) : https://help.shopify.com/en/manual/promoting-marketing/create-marketing/shopify-messaging/email/volume-consistency
- Shopify, adresse d'envoi et authentification : https://help.shopify.com/en/manual/promoting-marketing/create-marketing/shopify-messaging/email/setup
- Shopify, réécriture en `store+123@shopifyemail.com` : https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/email-rewrites
- Shopify, prix : https://help.shopify.com/manual/promoting-marketing/create-marketing/shopify-email/shopify-email-cost
- Brevo, IP partagée et dédiée : https://help.brevo.com/hc/en-us/articles/209466865
- Brevo, authentifier son domaine : https://help.brevo.com/hc/en-us/articles/12163873383186
- Brevo, politique anti-spam : https://help.brevo.com/hc/en-us/articles/209405205
- Klaviyo, domaine partagé ou dédié : https://help.klaviyo.com/hc/en-us/articles/7674941873947
- Mailchimp, Omnivore : https://quickbooks.intuit.com/learn-support/en-us/help-article/email-campaign/omnivore/L088rqLs4_US_en_US
- Resend, tarifs : https://resend.com/pricing
- Resend, envoi multi-clients : https://resend.com/docs/knowledge-base/setting-up-resend-for-multi-tenants
- Google, Feedback Loop : https://support.google.com/mail/answer/6254652
- Comparatifs de prix de vérification d'adresses : https://www.activepieces.com/blog/neverbounce-pricing-in-2026-credits-plans-costs.md
