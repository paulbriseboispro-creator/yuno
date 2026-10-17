# Yuno CRM — l'e-mail pratique aux détenteurs d'une soirée (S11, 18/10/2026)

Plan parent : `CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md` §8 point 5, D5, S11.

## Le besoin

Sur le compte de test (Amoris × Shotgun de WOH), 299 personnes sur 18 058
acceptent les e-mails marketing. Mais chaque personne qui TIENT un billet d'une
soirée peut recevoir les informations pratiques de CETTE soirée (horaires,
accès, changement de line-up, info de dernière minute). Shotgun le propose sous
le nom « e-mails pratiques », réservés aux détenteurs, et prévient qu'un usage
marketing peut suspendre le compte.

## Lecture juridique (courte, ce n'est pas un avis d'avocat)

Sources : CNIL, « Communications par voie électronique aux prospects et
clients : quelles règles respecter ? » ; CNIL, « La prospection commerciale par
courrier électronique » ; article L34-5 du CPCE ; aide pro de Shotgun
(« Envoyer une newsletter »).

**Ce qui est permis sans accord marketing.**
1. L34-5 CPCE n'exige le consentement que pour la **prospection directe**. Un
   message qui sert à exécuter le contrat n'en est pas : la CNIL dit que les
   messages transactionnels ou relationnels « ne reposent généralement pas sur
   le consentement préalable », mais sur l'exécution du contrat (art. 6.1.b
   RGPD) ou l'intérêt légitime.
2. Un billet est un contrat d'accès à UNE soirée. Les horaires, l'adresse,
   l'accès, le dress code, l'âge minimum, ce qu'il faut apporter, un
   changement d'horaire, de lieu ou de line-up, une annulation, un report, une
   consigne de sécurité ou une info de dernière minute servent à l'exécuter.
3. Ces messages vont aussi aux personnes qui ont refusé ou retiré leur accord
   marketing : se désabonner de la prospection ne coupe pas l'information sur
   un achat. Aucun lien de désinscription n'est exigé (il l'est « lorsque cela
   est requis », c'est-à-dire pour la prospection).

**Ce qui ne l'est pas.**
1. La qualification « dépend avant tout de l'objectif du message » (CNIL), et
   un message pratique ne doit « pas être utilisé pour dissimuler un contenu
   promotionnel ». Une part commerciale significative le requalifie en
   prospection, donc soumise au consentement : un tarif, un code promo, une
   autre soirée, une table VIP, une prévente, un lien d'achat.
2. L'exception « client » (produits analogues du même vendeur) ne sert pas ici :
   le compte n'a pas posé l'opposition à la collecte comme l'exige L34-5, et
   Shotgun interdit cet usage. Yuno ne s'en sert pas.
3. Le droit commercial n'est pas la seule règle : Shotgun réserve ses « e-mails
   pratiques » à la logistique de la soirée et peut suspendre un compte qui les
   détourne. Yuno applique la même règle, plus stricte côté serveur.

**Ce qui reste à vérifier (Paul).**
- **WOH n'est que co-organisateur (rôle `editor`) de la soirée du 29/10 chez
  Shotgun**, pas l'organisateur. L'aide de Shotgun dit qu'un co-organisateur
  reçoit les acheteurs dans ses contacts ; elle ne dit pas qui leur écrit
  l'info pratique. Recommandation : prévenir l'organisateur principal (Club
  Sonore) avant d'envoyer, pour qu'il n'y ait pas deux messages contradictoires.
  Yuno refuse l'e-mail pratique quand le compte n'est que `viewer`.
- Les CGU de Shotgun pour l'API organisateur : rien trouvé qui interdise à un
  organisateur d'écrire à ses propres acheteurs depuis un autre outil (il est
  responsable de traitement de leurs données), mais le texte exact n'a pas été lu.

## Décisions (recommandation en premier, à valider par Paul)

| # | Question | Recommandation |
|---|---|---|
| P1 | Ouvrir la fonction ? | Oui, avec la garde serveur ci-dessous. |
| P2 | Coût en Yunits | 1 Yunit par e-mail, comme tout e-mail : aucun intérêt à déguiser du marketing en pratique pour économiser. |
| P3 | Bornes | 3 e-mails pratiques au plus par soirée, jusqu'à 24 h après la fin (objets trouvés, incident). |
| P4 | Qui reçoit | Les acheteurs d'un billet **valide** de la soirée. Pas les billets « transférés » : chez Shotgun c'est un billet **revendu**, l'acheteur n'y va plus (le nouvel acheteur a son propre billet valide). Désabonnés du marketing compris ; adresses sur la liste de suppression (bounce, plainte, invalide) exclues. |
| P5 | Qui envoie | Organisateur ou co-organisateur éditeur de la soirée chez Shotgun ; jamais un simple lecteur. |
