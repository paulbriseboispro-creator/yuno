# SMS de Yuno CRM — changer de fournisseur, refaire l'envoi

Étude du 2026-10-05. **Statut au 08/10 : Octopush choisi par Paul et branché**
(code, base, Console CRM ouverte ; reste l'abonnement Octopush et ses secrets,
voir `docs/SMS_MARKETING.md` § Mise en service). Tarif Yuno CRM : **35 Yunits
par SMS** (décision de Paul du 08/10, au lieu de 40).

Les prix ont été relevés le 05/10 sur les pages publiques ; beaucoup ne
s'affichent qu'en JavaScript. **Ils servent à trier, pas à signer : seul un devis
écrit fait foi.**

## 1. Le verdict en cinq lignes

1. **Pas de numéro par client.** Chaque club a son **nom d'expéditeur**
   (« AMORIS », 11 caractères), gratuit, posé message par message. Tous les
   clubs partagent le code court STOP du routeur (« STOP au 36xxx »).
2. **Prendre un routeur français relié en direct aux opérateurs.** Prix entre
   **0,039 et 0,045 € HT** par SMS aux volumes de Yuno, contre **0,069 à
   0,073 €** chez Twilio, soit 40 à 45 % de moins. Aucun fournisseur
   international sérieux ne fait mieux.
3. **Recommandé : Octopush**, sous réserve des réponses écrites (§ 6).
   **SMSFactor en plan B**, **smsmode** consulté pour faire jouer la concurrence.
4. **Un sous-compte par club** chez le routeur : le STOP d'un client ne coupe
   que CE club, et un club qui fait du spam ne fait pas bloquer les autres.
5. **Ce qui est déjà construit est gardé** : file d'envoi, crédits,
   consentement, heures calmes, rapport, lien suivi. On ne remplace que la
   brique qui parle au fournisseur (4 fichiers).

## 2. Chaque client doit-il avoir son numéro ? Non

**Ce que la loi et les opérateurs imposent :**

- **Les 06/07 sont interdits aux envois automatisés depuis le 1ᵉʳ janvier
  2023.** C'est la décision ARCEP n° 2022-1583. Le numéro Twilio +33 prévu dans
  l'ancienne mise en service n'était donc de toute façon pas la bonne voie, et
  Twilio lui-même impose l'expéditeur alphanumérique en France.
- **Charte AF2M « Business Messaging », en vigueur depuis le 1ᵉʳ mars 2026.**
  Les opérateurs l'imposent par contrat à toute la chaîne. Ce qu'elle exige :
  - **Le nom d'expéditeur** : 11 caractères au plus, lettres A-Z et chiffres
    seulement, sans accent ni espace, jamais tout en chiffres. Il doit
    identifier l'annonceur. Les mots génériques (« INFO », « ALERT ») sont
    refusés. Les marques protégées exigent une autorisation écrite.
  - **Une vérification d'identité à chaque maillon** : Yuno doit vérifier
    l'identité de chaque club (raison sociale, SIRET, preuve de la marque).
  - **Le nom commercial du club en tête du message.** C'est déjà fait par le
    préfixe « Nom : » de `composeSmsBody`.
  - **Une opposition gratuite et immédiate**, et elle vaut **par annonceur**
    (« ne plus recevoir de Messages A2P de l'Editeur »). Le format courant est
    « STOP au 36xxx », avec le code court du routeur.
  - **Les horaires des messages promotionnels : 8 h → 21 h 30.** Le dimanche et
    les jours fériés sont tolérés mais déconseillés. C'est une règle
    contractuelle, pas une loi, et certains routeurs sont plus stricts (20 h).
- **Un expéditeur alphanumérique ne peut pas recevoir de réponse.** Le « STOP »
  part donc au 36xxx partagé du routeur, qui le renvoie à Yuno par webhook.

**Les trois options pour un club :**

| Option | Coût | Délai | Utile pour |
|---|---|---|---|
| **Nom d'expéditeur (OADC)**, recommandé | 0 € | validation du routeur, de quelques heures à 3 jours | toutes les campagnes |
| Numéro 09 37-39 dédié (SMS conversationnel) | ~10 € HT / mois / club (OVH Time2Chat), SMS facturé double | quelques jours ; **un numéro par club obligatoire**, jamais partagé | répondre au club (conciergerie VIP) ; option payante plus tard |
| Code court 36xxx dédié | ~3 800 € de mise en place + location | 8 à 14 semaines | rien, à l'échelle de Yuno |

Un numéro affiché à la place du nom du club fait aussi moins vendre : le client
reconnaît « AMORIS », pas un 09.

## 3. Le marché au 05/10

Les prix sont en € HT par segment de 160 caractères, sur la route « premium »
(expéditeur personnalisé, accusés de réception).

**Routeurs français :**

| Fournisseur | ~10 k / mois | ~100 k | ~1 M | Modèle | Sous-comptes | Note |
|---|---|---|---|---|---|---|
| **Octopush** | 0,041 (offre 39 € / mois) | 0,039 (offre 159 € / mois) | 0,035 (devis) | abonnement + consommation | oui, **plafonnés** (10 / 50, +9 € les 5) | meilleure API (idempotence, mode simulation), STOP rempli seul |
| **SMSFactor** | 0,056 (pack) | 0,043 (pack) | 0,040 (500 k), dès 0,035 | packs prépayés **qui expirent à 1 an** ; mensuel dès 3 k / mois | oui (créer, verrouiller, transférer) | le webhook STOP porte l'id du compte ; avis sur des campagnes bloquées en secteur sensible |
| **smsmode** | 0,061 (pack 1 k) | 0,045 (pack) | « dès 0,031 », devis | abonnement 9 à 499 € + consommation | oui | ISO 27001 / 27701, hébergement santé (HDS), API JSON moderne |
| Spot-Hit | 0,054 | 0,049 | 0,039 | crédits sans expiration | oui | API ancienne |
| OVHcloud | 0,054 | 0,050 | 0,048 | packs | « users » API | chaque expéditeur validé sur pièces (~72 h) |
| Allmysms | 0,045 | 0,045 | devis | prépayé ou 250 € / mois minimum | ? | |
| Esendex / SMSEnvoi | 0,061 | 0,050 | devis | | oui | |
| SMSBox | 0,060 | 0,052 | — | | ? | |
| CM.com | 0,057 | 0,057 | devis | à l'usage | oui | |
| Brevo | ~0,045 | — | — | crédits | non adapté | fait pour un seul expéditeur |

**Fournisseurs internationaux** (1 $ = 0,86 €) :

| Fournisseur | ~50 k / mois | Remarque |
|---|---|---|
| Twilio (actuel) | 0,069 (0,0798 $) | remise seulement sur engagement annuel |
| AWS End User Messaging | 0,064 | une liste d'opposition par client possible |
| Sinch | 0,063 | |
| Plivo | 0,062 à 0,068 | |
| Bird | 0,055 | le moins cher des grands fournisseurs |
| ClickSend | 0,047 à 0,069 selon la recharge | |
| GatewayAPI (DK) | 0,044 premium / 0,040 standard | grille datée de 2021 |
| BulkGate | 0,036 | même prix sur tous les réseaux : **signe possible d'une route grise**, à écarter sans test |
| seven.io | 0,075 | |

**Lecture :** sous ~0,035 €, le soupçon de route grise (nom du club réécrit,
accusés de réception inventés, STOP perdu) l'emporte. Dans la nuit, un SMS qui
arrive signé d'un numéro inconnu est un SMS perdu.

**Commun à tous :**

- **Facturation au segment SOUMIS, pas au segment livré.** La règle actuelle
  reste juste : on rembourse un refus avant envoi, jamais un message non livré.
- **Un emoji fait passer tout le message en Unicode** (70 / 67 caractères) :
  coût doublé ou triplé. L'éditeur le montre déjà.
- **La route « low cost »** est sans nom d'expéditeur et sans accusé de
  réception : inutilisable pour Yuno.
- **RCS** (cartes avec affiche et boutons) : en ligne sur les quatre opérateurs
  depuis 2025, 83 % des téléphones. Octopush le facture 0,045 à 0,075 €. Il
  exige un « agent » vérifié par club : **canal pour une V2**, avec le SMS en
  repli.

## 4. Coût réel aux volumes de Yuno

Volumes de la plateforme entière, abonnement du routeur compris (estimations
sur prix publics) :

| Volume / mois | Twilio | Octopush | SMSFactor | smsmode |
|---|---|---|---|---|
| 5 000 | 345 € (0,069) | ~244 € (0,049) | 280 € en pack 10 k (0,056) | ~290 € (0,058) |
| 20 000 | 1 380 € | ~860 € (0,043) | 860 € avec un pack 100 k payé d'avance (4 300 €) | ~970 € |
| 100 000 | 6 900 € | ~4 060 € (0,041) | 4 300 € (0,043) | ~4 600 € (0,046) |
| 500 000 | 34 500 € | ~17 600 € (0,035) | 20 000 € (0,040) | devis (≤ 0,031 ?) |

Un profil C de `YUNO_CRM_PRICING.md` (1 000 SMS par mois) coûte à Yuno
environ **41 € chez Octopush contre 69 € chez Twilio**.

**Ce que ça donne sur le prix public des crédits** (40 crédits par SMS
France) :

- Au tarif de base, un SMS est vendu 0,080 €.
- Avec le plus gros pack, il est vendu 0,070 €.
- Au coût de 0,041 €, la marge est de **41 à 49 %** avant frais Stripe. C'est
  l'hypothèse du document de prix : **garder 40.**

## 5. Pourquoi Octopush en premier

Le prix départage peu : 0,039 à 0,043 € chez les trois premiers. Ce qui
départage, c'est ce que le logiciel de Yuno doit garantir.

1. **Le paiement au mois, à la consommation, sans crédit qui expire.**
   SMSFactor ne descend sous 0,05 € que contre un pack payé d'avance qui meurt à
   un an. Pour un fondateur seul au démarrage, 4 300 € immobilisés sur un canal
   qui démarre, c'est un vrai coût.
2. **Une clé d'idempotence par message (`request_id`).** C'est la deuxième
   ceinture anti-doublon que l'email a déjà avec Resend : un worker tué entre
   l'appel et le marquage ne renvoie jamais le même SMS. Chez Twilio, le code
   actuel ne l'a pas.
3. **Un mode simulation.** Il permet de jouer une campagne de bout en bout sans
   envoyer un seul SMS, pour le compte démo et pour les tests. Leçon de Meta :
   on ne sonde pas un fournisseur avec un compte réel.
4. **Le STOP rempli par le routeur, des webhooks par sous-compte, et une
   option qui remplace les caractères spéciaux pour rester en GSM-7.**

**Ce qui peut le faire tomber :**

- **Le plafond de sous-comptes.** Il est de 10 sur l'offre Business. Il faut
  négocier un nombre illimité, ou un prix par sous-compte ; au tarif affiché,
  100 clubs coûtent environ 160 € par mois de plus.
- **Un STOP enregistré pour tout le compte**, et non par sous-compte.
- **Un refus des campagnes « nuit / alcool ».**

Si l'un de ces trois points tombe, **SMSFactor** passe devant. Il est le moins
cher à fort volume, ses sous-comptes sont complets et son webhook STOP porte
déjà l'id du compte. Son défaut est l'API, plus ancienne. **smsmode** sert de
référence de prix et de solution « conformité » si un club exige
ISO 27001 / 27701.

## 6. Les questions à poser par écrit, avant de signer

Le même email part aux trois. Remplacer `<…>` :

> Bonjour,
>
> Je suis le fondateur de Yuno (yunoapp.eu), un logiciel pour les clubs et
> organisateurs de soirées. Chaque client envoie ses campagnes SMS marketing à
> ses propres clients, qui ont donné leur accord. Ce sont des numéros
> français, en multi-clients, avec un sous-compte et un nom d'expéditeur par
> client. Volume prévu : 20 000 SMS par mois au lancement, 100 000 à 12 mois.
>
> 1. Votre prix HT par SMS France (route avec nom d'expéditeur personnalisé), à
>    20 k, 100 k et 500 k par mois, en paiement mensuel à la consommation.
>    Les crédits expirent-ils ?
> 2. Combien de sous-comptes, et à quel prix ? Il nous en faut un par client :
>    plusieurs centaines à terme.
> 3. Quand un destinataire répond STOP au code court, l'opposition vaut-elle
>    pour le sous-compte (ou pour le nom d'expéditeur) qui a envoyé, ou pour
>    tout le compte ? Comment nous est-elle remontée (webhook, champs : numéro,
>    sous-compte, expéditeur, id du message) ?
> 4. Comment se fait la validation d'un nom d'expéditeur (pièces, délai) et la
>    vérification d'identité de nos clients selon la charte AF2M
>    du 1ᵉʳ mars 2026 ? Pouvons-nous la faire nous-mêmes en tant que revendeur ?
> 5. Nos clients sont des clubs et des organisateurs de soirées. Des campagnes
>    annonçant une soirée sont-elles acceptées sans modération manuelle ? Et
>    une offre de table avec bouteille (loi Évin) ?
> 6. Facturez-vous les SMS non livrés ? Les SMS refusés avant envoi ?
> 7. Les plages horaires que vous appliquez (8 h à 20 h ou 21 h 30, dimanche,
>    jours fériés) : bloquez-vous, ou mettez-vous en file ?
> 8. L'API offre-t-elle une clé d'idempotence, un mode test sans envoi, des
>    accusés de réception par webhook signé ?
> 9. Où sont hébergées les données ? Un DPA (accord de traitement RGPD) est-il
>    disponible ?
>
> Merci,
> Paul Brisebois

## 7. Ce qui change dans le code (une fois le fournisseur signé)

Avec un adaptateur, changer de fournisseur plus tard redeviendra un fichier, pas
un chantier.

1. **`_shared/sms-provider.ts`**, la porte unique. Elle porte :
   - l'envoi (`to`, expéditeur, texte, clé d'idempotence = id de la ligne de
     file) ;
   - le tri des erreurs : refus définitif pour toute la campagne, ou pour ce
     seul numéro ;
   - la lecture des accusés de réception et des STOP ;
   - la vérification de signature des webhooks.

   `send-sms-campaign` ne connaît plus que cette porte.
2. **Migration.** `twilio_sid` devient `provider_message_id`, et une colonne
   `provider` s'ajoute (`sms_logs`, `sms_campaign_recipients`,
   `apply_sms_delivery_status`). Une nouvelle table **`sms_senders`** par
   portée stocke le nom d'expéditeur, son statut (en attente / validé /
   refusé), le sous-compte du routeur et la pièce d'identité vérifiée. **Aucun
   envoi sans expéditeur validé.**
3. **Le texte.**
   - Le nom d'expéditeur suit les règles AF2M (11 caractères, A-Z et 0-9,
     ≥ 1 lettre, liste de mots génériques refusés), dans
     `_shared/sms-text.ts` ⇄ `src/lib/smsMarketing.ts`.
   - Le préfixe « Nom : » est gardé : c'est l'obligation B.1.1.
   - Le suffixe devient **« STOP au 36xxx »** (code du routeur, en
     configuration) et entre dans le compte des segments.
   - Aujourd'hui, « STOP pour ne plus recevoir » n'est **pas conforme** à un
     expéditeur alphanumérique.
4. **Le STOP par club.**
   - Le webhook du routeur fait correspondre le sous-compte à la portée, puis
     désinscrit de CE club.
   - `sms_stop_unsubscribe` désinscrit aujourd'hui de TOUS les clubs. Ce
     n'était un choix que parce que le numéro était partagé. La charte dit
     « de l'Editeur ».
   - La portée plateforme (Yuno à sa base) a son propre sous-compte
     « YUNO ».
5. **Les heures.**
   - Ajouter les jours fériés français.
   - Passer la fin de 20 h à **21 h 30** seulement si le routeur le confirme
     par écrit. Pour une soirée, le SMS de 20 h 30 « ce soir » est celui qui
     vend le plus.
6. **Les fonctions edge, dont le quota est atteint** (402).
   - Les accusés de réception et les STOP arrivent sur **une seule** fonction
     (`sms-inbound-webhook`, avec un paramètre de type).
   - `sms-twilio-status-webhook` est supprimée, ce qui rend un emplacement.
7. **Un disjoncteur par club**, comme le disjoncteur email : un taux de STOP
   anormal met SA campagne en pause. Un club ne doit jamais faire bloquer le
   compte Yuno, ni le domaine des liens.
8. **Les liens.**
   - Ils restent les liens suivis `yunoapp.eu/l/…` : jamais de raccourcisseur
     public.
   - Le domaine est à déclarer au routeur.
9. **Super admin.** Il faut un écran de validation des noms d'expéditeur.
   `AdminMarketingSms` passe sur le sous-compte « YUNO ».
10. **Ce qui va avec le reste du code.**
    - Un jeu de tests vitest sur l'adaptateur (réponses simulées) et sur les
      règles de nom.
    - La mise à jour de `docs/SMS_MARKETING.md`, de l'aide (`ohelp.pg.sms.*`,
      `ohelp.org.sms.*`), de `owner-assistant` et de la politique de
      confidentialité (sous-traitant : Twilio est remplacé).

**Ordre de mise en ligne** : migration → fonctions → front, puis
`SMS_MARKETING_LIVE = true`.

## 8. Ce que Paul doit faire

1. Envoyer l'email du § 6 à Octopush, SMSFactor et smsmode.
2. Choisir sur les réponses. Points éliminatoires :
   - un STOP qui vaut pour tout le compte ;
   - des sous-comptes plafonnés sans issue ;
   - les soirées modérées à la main.
3. Ouvrir le compte : vérification d'identité de Yuno comme revendeur, DPA
   signé.
4. Poser les secrets du routeur dans Supabase. Le reste est du code (§ 7).

## 9. Hors sujet mais à savoir

- **Loi Évin.** Une offre « table + bouteille » par SMS est une zone grise :
  la publicité pour l'alcool en ligne est permise si elle n'est « ni intrusive
  ni interstitielle », et un SMS est intrusif par nature. Annoncer une soirée
  ou une table sans mettre l'alcool en avant ne pose pas de problème. Une
  vérification par un avocat est à faire avant d'en faire un argument
  commercial.
- **SMS « fonctionnels »** (infos pratiques d'une soirée achetée : horaires,
  pièce d'identité) : ni mention STOP ni plage horaire. C'est un futur produit
  possible, hors CRM marketing.
- **Sources principales** :
  - la charte AF2M (af2m.org/charte-business-messaging) ;
  - l'ARCEP, décision 2022-1583 ;
  - la CNIL (prospection par SMS, sanction Solocal 900 k€ du 15/05/2025) ;
  - les pages de prix de chaque fournisseur, relevées le 05/10/2026.
