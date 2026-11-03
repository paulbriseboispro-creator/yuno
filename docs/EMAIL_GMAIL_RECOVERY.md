# Reprise de la délivrabilité Gmail (ouvert le 2026-11-03)

## Le constat

Le test 3AM Act III est arrivé en spam dans les deux boîtes Gmail de Jules. Ce
n'est pas cet e-mail : Gmail range en spam **tout** ce qui part de
`news.yunoapp.eu`, quelle que soit la marque (WOH, Amoris, 3AM…).

| Jour d'envoi (envois réels) | Ouvertures Gmail | Ouvertures autres messageries |
|---|---|---|
| 17/09 | 32,7 % | 30 % |
| 08/10 — WOH « Soirée Osmoz », fichier importé de 11 458 adresses (7 140 Gmail), 106 rebonds | 14 % | 20 % |
| 26/10 — infos pratiques HoM aux **acheteurs** | 1,4 % | 36 % |
| 29/10 — merci Amoris | 1,3 % | 25 % |

Ce qui est en règle (vérifié dans les en-têtes reçus le 03/11) : SPF, DKIM
(`news.yunoapp.eu`) et DMARC passent, désabonnement en un clic (RFC 8058),
TLS, aucun domaine du message signalé par Google Safe Browsing.

Ce qui a cassé : le 08/10, un domaine qui n'avait envoyé qu'une centaine
d'e-mails a envoyé d'un coup 7 140 e-mails à des adresses Gmail froides (un
fichier importé, jamais écrit par Yuno). Google demande l'inverse : « monter
le volume lentement, ne jamais le doubler d'un coup, n'écrire qu'à des
personnes qui l'ont demandé ». Peu d'ouvertures + signalements « spam » (que
Gmail ne nous transmet pas un par un) ont fait chuter la réputation du
domaine. Depuis, même les e-mails attendus (infos pratiques à des acheteurs)
partent en spam, et chaque nouvel envoi froid l'enfonce encore.

## Ce que Yuno fait automatiquement (mode reprise Gmail)

Migration `20261127100000_email_gmail_recovery.sql`, réglage dans
Admin › Santé technique › « Reprise Gmail ».

- Tout e-mail **marketing** vers une adresse `@gmail.com` / `@googlemail.com`
  ne part que si la personne a **ouvert ou cliqué un e-mail Yuno dans les 120
  derniers jours**, ou **vient de s'inscrire elle-même** (accord de moins de
  30 jours : page d'inscription, achat, guest list, liste d'attente ; jamais un
  fichier importé ni un accord recopié de Shotgun).
- Les autres sont « protégés » (motif `gmail_cold`) : ils comptent dans
  « protégés par les règles Yuno » du rapport, ne coûtent pas de Yunits, et
  rien n'est perdu. Ils seront réintégrés par étapes.
- La règle vit dans la politique d'envoi commune : campagnes, renvois,
  automatisations, scénarios, relances de pages, e-mails du cycle de vie.
  Les e-mails pratiques et transactionnels (billets) n'y passent pas.
- Sur la base WOH : 5 386 adresses Gmail froides retenues, ~1 756 Gmail
  engagées et toutes les autres messageries gardées.
- La carte « Reprise Gmail » montre, jour par jour, le taux d'ouverture Gmail
  contre les autres : c'est l'indicateur de sortie du spam.

## Les règles permanentes : l'envoi progressif (migration `20261127110000`)

La reprise Gmail est temporaire. Ce qui suit reste, pour que le 08/10 ne se
reproduise jamais, sans empêcher un pro d'écrire à toute sa base.

- **Chaleur de chaque adresse**, à la mise en file d'une campagne marketing :
  *chaude* (a ouvert ou cliqué un e-mail Yuno sous 180 jours, ou vient de
  s'inscrire elle-même), *connue* (a déjà reçu un e-mail Yuno sous 365 jours),
  *froide* (rien de tout ça : fichier importé, base recopiée de Shotgun,
  « Vos clients » jamais écrits).
- **Chaudes et connues partent tout de suite.** Les froides partent par
  **vagues de test** : 100, puis 200, 400, 800, 1 600 au plus. La première
  part tout de suite ; chaque suivante n'ouvre que si, 3 h après la dernière,
  le froid déjà parti a moins de 3 % de rebonds, moins de 1 ‰ de plaintes, au
  moins 4 % d'ouvertures (dès 100 envois), et chez Gmail au moins 2 %
  d'ouvertures ET au moins la moitié du taux des autres messageries (dès 50
  envois de chaque côté). Une base froide de 50 adresses ou moins part en une
  fois. Pourquoi une règle relative pour Gmail : Gmail ne transmet aucune
  plainte, et le 08/10, 6 % des Gmail avaient déjà ouvert en 2 h ; seul l'écart
  avec les autres messageries trahit le classement en spam.
- **Si une vague tourne mal** : le reste du froid ne part pas (Yunits rendus),
  le compte est **tenu à l'écart des nouvelles adresses 21 jours** (ses
  clients chauds continuent de recevoir), alerte super admin
  `admin_email_cold_halted`.
- **Plafond** : 1 000 adresses froides par jour et par compte, dont 200 Gmail
  au plus, toutes campagnes confondues ; le reste part le lendemain. Plus aucune vague dans les 3 h avant
  la soirée de la campagne.
- **Surveillance toutes les heures** (cron `email-deliverability-tick`) : un
  compte qui dépasse 3 % de rebonds ou 1 ‰ de plaintes sur 7 jours est mis à
  l'écart (`admin_email_sender_probation`) ; une chute des ouvertures Gmail sur
  toute la plateforme (moins de 5 % contre 15 % ailleurs) **rallume seule la
  reprise Gmail** et alerte (`admin_email_gmail_drop`).
- **Le pro le voit** : bandeau « Règles d'envoi Yuno » sur le rapport de la
  campagne (Billetterie et Console CRM), avec la vague en cours, l'heure du
  prochain contrôle, et ce qui a été gardé de côté par motif.
- **Le super admin le pilote** : Admin › Santé technique › « Reprise Gmail »
  (courbe Gmail contre les autres, comptes à l'écart, envois progressifs).
  Tous les seuils sont des réglages de `email_deliverability_settings`.

Simulation sur les vraies campagnes du 03/11 (transaction annulée) :
WOH × REVIVAL = 4 028 Gmail froides retenues, 2 742 envois immédiats, 789
froides en 4 vagues (100, 200, 400, 89) ; 3AM Act III = 1 587 Gmail froides
retenues, 75 envois immédiats, 614 froides en 3 vagues (100, 200, 314).

## Envoi réparti obligatoire et page « Santé de vos e-mails »

- **Par défaut, aucune campagne marketing de 300 personnes ou plus ne part
  d'un coup** : sans répartition choisie, Yuno impose 600 e-mails par heure ;
  une répartition choisie est ramenée à 1 000 par heure au plus
  (`_email_enforce_spread`, à la mise en file). Les écrans de planification
  (Console CRM et Billetterie) le montrent et calculent la vraie heure de fin
  (`spreadMinutes`, miroir testé).
- **« Tout d'un coup » se débloque compte par compte** par le super admin
  (Admin › Santé technique › Comptes expéditeurs, motif obligatoire, journal) :
  à réserver aux comptes dont les envois restent sains plusieurs semaines.
- **Chaque client a sa page « Santé de vos e-mails »** : Console CRM ›
  E-mails › Santé (`/crm/emails/health`), Billetterie › E-mail › Santé des
  envois (`/owner/campaigns/health`, `/organizer-app/campaigns/health`). Une
  lecture, `email_sender_health_report` (migration `20261127120000`), mise en
  phrases par `buildHealthView` (`src/lib/email/senderHealth.ts`, textes
  `senderHealthWords.ts`, testés) : verdict (bonne / à surveiller / livraison
  dégradée / nouvelles adresses en pause / pas encore assez d'envois) et ses
  raisons chiffrées, la reprise Gmail présentée comme une mesure de toute la
  plateforme, chaque règle appliquée au compte avec son pourquoi et ce qui la
  lève, les chiffres face aux seuils réels, la base joignable (engagés, déjà
  écrits, jamais contactés, Gmail), ce qui a été gardé de côté, les dernières
  campagnes (marketing et pratiques) et la façon de calculer.

## L'envoi intelligent, comme Shopify (migration `20261129100000`)

Shopify tient sur un domaine commun parce qu'il trie avant d'envoyer. Yuno fait
pareil, en plus strict (notre domaine est petit) :

- **À la mise en file** : adresses impossibles écartées (noreply@, boîtes jetables),
  et dès 300 personnes, quiconque a reçu 3 e-mails de ce compte en 180 jours sans en
  ouvrir un. Rien n'est débité.
- **Pendant l'envoi** : 2 h après le départ, moins de 5 % d'ouvertures ⇒ la campagne
  ne part plus qu'aux contacts engagés ; Gmail sous le tiers des autres ⇒ seuls les
  Gmail engagés continuent.
- **Disjoncteur** : plaintes > 0,1 % (au moins 2) ou rebonds > 3 % ⇒ pause.
- **Domaine commun** : niveau 3 au plus, 3 000 adresses jamais écrites par mois, arrêt
  des vagues dès 2 % de rebonds ou 0,5 ‰ de plaintes.
- **Récidive** : deux incidents en 60 jours ⇒ nouvelles adresses fermées jusqu'à
  décision de Yuno (bouton « lever » dans Admin › Santé technique).
- **Bilan du jour à 8 h** : alerte « Bilan e-mail du jour » dans le centre d'alertes,
  photo quotidienne dans `email_deliverability_snapshots`.
- **La page Santé du pro** est en schémas : feu, niveau, plafonds du jour, courbe des
  30 jours, trois signaux, base joignable, ce qui a été mis de côté.

## Message aux pros (à envoyer par Paul)

Version courte (WhatsApp) :

> Petite info importante sur les e-mails Yuno.
> Depuis quelques semaines, Gmail classe une partie de nos e-mails en
> indésirables. La cause est identifiée : de grosses listes de contacts qui
> n'avaient jamais reçu d'e-mail ont été envoyées d'un coup. Gmail sanctionne
> ça pour tout le monde.
> On a mis en place une reprise : pendant quelques semaines, chez Gmail, vos
> campagnes partent d'abord aux personnes qui ouvrent vos e-mails. Et à
> partir de maintenant, tout nouveau contact reçoit vos e-mails par petites
> vagues contrôlées : si une vague se passe mal, Yuno s'arrête tout seul et ne
> vous débite rien.
> Vous pouvez toujours écrire à toute votre base. Les campagnes partent un
> peu plus progressivement, et c'est ce qui les fera arriver en boîte de
> réception.
> Un petit service : si un e-mail de votre soirée est arrivé dans vos
> indésirables, ouvrez-le et cliquez « Non spam ». Ça nous aide vraiment.

Version e-mail (plus complète) :

> **Objet : vos e-mails Yuno et Gmail, ce qu'on change**
>
> Bonjour {prénom},
>
> On préfère vous le dire franchement : depuis début octobre, Gmail range une
> partie des e-mails envoyés depuis Yuno dans les indésirables. Nos réglages
> techniques sont en ordre (Google le confirme), le problème vient du volume :
> plusieurs grosses listes de contacts jamais écrits ont été envoyées d'un seul
> coup, et Gmail l'a fait payer à tous les expéditeurs de Yuno.
>
> Ce qu'on a mis en place dès aujourd'hui :
> - **une reprise Gmail** : pendant quelques semaines, chez Gmail, vos campagnes
>   partent d'abord aux personnes qui ouvrent vos e-mails. Les autres sont
>   gardées de côté, sans frais, et seront réintégrées par étapes ;
> - **l'envoi progressif, pour de bon** : un contact qui n'a jamais reçu
>   d'e-mail de votre part le reçoit par petites vagues contrôlées. Si une vague
>   reçoit trop d'adresses invalides ou de signalements, Yuno arrête tout seul
>   et ne vous débite rien ;
> - **une surveillance permanente** de la livraison chez Gmail.
>
> Vous gardez la main : vous pouvez toujours écrire à toute votre base. Le
> rapport de chaque campagne vous dit désormais ce qui est parti, ce qui part
> par vagues et pourquoi.
>
> Un petit geste qui aide tout de suite : si un e-mail d'une soirée est arrivé
> dans vos indésirables (ou celles de votre équipe), ouvrez-le et cliquez
> « Signaler comme non-spam ».
>
> On revient vers vous quand Gmail est revenu à la normale. Merci pour votre
> confiance,
> Paul

## Ce que Paul doit faire (Yuno ne peut pas le faire à sa place)

1. **Brancher Google Postmaster Tools** (gratuit, 10 min) :
   postmaster.google.com avec le compte Google de Yuno → ajouter
   `yunoapp.eu` → Google donne un enregistrement TXT → l'ajouter dans
   Cloudflare (DNS de yunoapp.eu) → vérifier. Puis ajouter `news.yunoapp.eu`.
   C'est le seul endroit qui montre la réputation du domaine telle que Gmail la
   note (Élevée / Moyenne / Faible / Mauvaise) et le **taux de spam** (à garder
   sous 0,1 %, jamais 0,3 %). Les données arrivent avec 1 à 2 jours de retard.
2. **Ne pas envoyer de grosse campagne « froide » pendant la reprise**, même
   avec la règle : pas de nouvel import envoyé d'un coup, pas de base
   « Vos clients » complète. La campagne WOH × REVIVAL (04/11, 10 h) et la
   campagne 3AM Act III partiront limitées aux Gmail engagés si la migration est
   en ligne ; sinon, les déprogrammer.
3. **Demander aux vrais destinataires proches** (Jules, l'équipe 3AM, Kevin,
   l'équipe WOH) d'ouvrir le dossier Spam, cliquer « Signaler comme non-spam »
   et ajouter l'adresse d'envoi à leurs contacts. Google dit que ce geste aide.
   Uniquement des gens qui veulent ces e-mails : pas de faux comptes.
4. **Contenu des prochaines campagnes** : objet sans « gratuit » / « entrée
   gratuite » répété (l'e-mail 3AM l'écrit 9 fois), une adresse de réponse au
   nom de la marque plutôt qu'un `@gmail.com`, un texte qui ressemble à un
   message d'une personne.
5. **Vérifier que `dmarc@yunoapp.eu` reçoit les rapports DMARC** (boîte IONOS).
   Passer DMARC en `p=quarantine` plus tard, quand les rapports montrent que
   tout ce qui part au nom de yunoapp.eu est bien signé.
6. **Ne pas changer de domaine d'envoi pour « repartir de zéro ».** Google le
   traite comme du contournement, la réputation du domaine parent (yunoapp.eu)
   compte aussi, et un domaine neuf qui reçoit les mêmes listes froides tombe
   pareil en quelques jours.

## Le retour à un état stable (prudent, étape par étape)

On ne passe à l'étape suivante que si **toutes** ses conditions tiennent depuis
7 jours. Au moindre recul, on revient d'une étape. Les chiffres se lisent dans
Admin › Santé technique › « Reprise Gmail » et dans Postmaster Tools.

| Étape | Ce qui part chez Gmail | Pour passer à la suivante (7 jours de suite) |
|---|---|---|
| 0. Arrêt des envois froids (aujourd'hui) | Engagés 120 j + inscrits < 30 j seulement | Postmaster : spam < 0,1 % ; ouvertures Gmail ≥ 15 % sur au moins 2 campagnes |
| 1. Reprise engagée | Idem | Ouvertures Gmail ≥ 60 % de celles des autres messageries ; aucun arrêt de vague |
| 2. Fenêtre élargie | Engagés 180 j (réglage `gmail_engaged_days`) | Mêmes conditions |
| 3. Fin de la reprise Gmail | Toute la base, les froides par vagues (plafond Gmail 200 / jour / compte) | Aucune alerte « Gmail range en spam » ; spam Postmaster < 0,1 % |
| 4. Régime normal | Vagues et plafonds permanents ; la surveillance rallume la reprise toute seule si Gmail rechute | — |

Le plafond Gmail froid (200 / jour / compte) ne se relève qu'après 4 semaines
en étape 4, par paliers de +100. Les sources du métier donnent 2 à 4 semaines
depuis une réputation « Faible », 4 à 8 depuis « Mauvaise ». Google ne donne
aucun délai.

## Ce qu'il faudra construire ensuite

- **Un domaine d'envoi au nom du pro** (`news.woh.fr`…) : aujourd'hui une liste
  froide d'un pro grille tous les autres. Option reportée le 05/10, à reprendre.
- Version texte propre de chaque e-mail (aujourd'hui générée par Resend, qui
  recopie les caractères invisibles du pré-en-tête).

## Sources

- Google, Email sender guidelines : https://support.google.com/a/answer/81126
- Google, Sender guidelines FAQ et mitigation : https://support.google.com/a/answer/14229414
- Google Postmaster Tools : https://postmaster.google.com
- Resend, Warming up : https://resend.com/docs/knowledge-base/warming-up
