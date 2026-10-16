# Modèle d'analyse d'impact (AIPD) et de mise en balance — Yuno CRM

Version 1 du 8 octobre 2026, fournie par Yuno aux clubs, organisateurs et
associations qui utilisent Yuno CRM (Conditions Yuno CRM, art. 8 ; Accord de
sous-traitance, art. 12.5). Le pro est responsable de traitement : il adapte ce
modèle, le complète (passages entre crochets), le date et le signe. Yuno a
rempli ce qui dépend de l'outil. Méthode : CNIL (PIA) et lignes directrices
WP248rev.01. À tenir à jour à chaque changement important.

## Partie A — Mise en balance de l'intérêt légitime (analyse du profilage)

**Traitement concerné** : analyse des achats et des entrées de nos clients dans
Yuno CRM (« Ce qui fait venir », « Chances de venir », « Qui cibler », groupe
témoin de 10 %).

**Étape 1 — Notre intérêt est-il légitime ?** Oui : connaître notre public,
comprendre ce qui le fait revenir, lui écrire moins souvent et plus à propos,
mesurer l'effet réel de nos messages. Intérêt commercial licite (CJUE C-621/22
KNLTB ; considérant 47 du RGPD).

**Étape 2 — Le traitement est-il nécessaire ?** Nous ne pouvons pas savoir, sans
regarder les achats passés, quelles soirées intéressent quels clients. Moyens
moins intrusifs déjà retenus par l'outil : données de nos seuls achats et
entrées (pas de suivi sur d'autres sites, pas d'achat de données) ; ni genre,
ni ouverture d'e-mails dans l'analyse ; historique de 12 mois pour le score ;
pas de pourcentage individuel ; rien dans un export. [Ajouter vos propres
limites, par exemple ne pas consulter les fiches individuelles hors de
l'équipe marketing.]

**Étape 3 — La balance penche-t-elle de notre côté ?**
- *Attentes raisonnables* : nos clients ont acheté chez nous ; recevoir des
  informations sur nos prochaines soirées, choisies selon leurs achats, est
  attendu. Nous les informons dès l'achat (politique de confidentialité affichée
  par notre billetterie) et au premier message.
- *Impact* : faible. L'estimation choisit seulement qui reçoit un message ; elle
  ne fixe aucun prix, ne réserve aucune remise, ne refuse ni entrée ni vente.
  Le groupe témoin ne reçoit rien de plus défavorable.
- *Garanties* : opposition simple et sans justification (fiche client
  « Exclure du profilage », lien de désinscription, STOP) ; statut testé de chaque
  hypothèse ; estimations recalculées chaque nuit ; effacement avec la personne
  et à l'échéance de notre durée de conservation.
- *Personnes vulnérables* : [nos soirées sont réservées aux 18 ans et plus / nous
  avons des soirées ouvertes aux mineurs : nous n'utilisons pas l'analyse pour
  leur écrire].
**Conclusion** : la balance est favorable, sous réserve du respect des
garanties ci-dessus. [Date, nom, fonction.]

## Partie B — Analyse d'impact (AIPD)

### B1. Faut-il une AIPD ?
Critères WP248 remplis : **évaluation ou notation** (score « Chances de
venir ») ; **croisement de données** (billetterie, inscriptions, réactions aux
messages). Deux critères : l'AIPD est requise dans la plupart des cas. [Ajouter :
grande échelle si votre base dépasse quelques dizaines de milliers de contacts.]

### B2. Description
- **Responsable** : [structure, adresse, contact]. **Sous-traitants** : [billetterie,
  ex. Shotgun] ; Yuno (WOMBER) et ses sous-traitants (Supabase, Cloudflare,
  Resend, Octopush, OpenAI pour l'Assistant Console).
- **Finalités** : gestion de la relation client ; envoi d'informations et
  d'offres ; analyse et estimation décrites en partie A ; mesure de l'effet des
  messages (groupe témoin).
- **Personnes** : acheteurs, invités, inscrits. [Volume : environ N contacts.]
- **Données** : identité et coordonnées ; âge, genre, ville, code postal, pays
  (si la billetterie les transmet) ; billets, tarifs, entrées ; accords et
  désinscriptions ; réactions aux messages ; données déduites (hypothèses,
  niveau de chances et raisons, distance au lieu).
- **Cycle de vie** : import en lecture seule depuis la billetterie (synchro
  régulière) et les fichiers ; calcul chaque nuit ; affichage aux rôles qui
  voient les clients ; effacement à l'opposition, avec la personne, à la
  déconnexion de la billetterie, à l'échéance de la durée de conservation.

### B3. Nécessité et proportionnalité
| Point | Réponse |
|---|---|
| Base légale | Partie A pour l'analyse ; accord ou relation client (L. 34-5 CPCE) pour les envois ; accord du destinataire pour la mesure individuelle des ouvertures et clics (recommandation CNIL n° 2026-042) |
| Minimisation | Pas de genre ni de traceur dans l'analyse ; score sur 12 mois ; aucune donnée de paiement |
| Exactitude | Estimations présentées comme telles, hypothèses testées statistiquement, recalcul chaque nuit |
| Conservation | [3 ans] après le dernier achat, la dernière venue, le dernier clic ou la dernière inscription (réglage Réglages › Données) ; liste d'exclusion conservée pour respecter les refus |
| Information | Texte publié [où : billetterie, pages d'inscription, pied des e-mails] (modèle en annexe des Conditions Yuno CRM) |
| Droits | Accès, rectification, effacement, opposition à [contact] ; opposition au profilage présentée séparément ; désinscription et STOP |
| Transferts hors UE | Resend, OpenAI, Cloudflare : clauses types de la Commission ou Data Privacy Framework |

### B4. Risques et mesures
| Risque | Gravité / vraisemblance avant mesures | Mesures | Risque résiduel |
|---|---|---|---|
| Accès non autorisé à la base | Importante / limitée | Cloisonnement par compte, rôles, double authentification du titulaire, accès assisté de Yuno seulement avec accord, journalisation | Limité |
| Estimation fausse prise pour une vérité | Limitée / importante | Niveaux et raisons, jamais de pourcentage ; statut « pas de différence nette » affiché ; usage limité au choix des messages | Négligeable |
| Déduction d'une donnée sensible (orientation, conviction) à partir du thème d'une soirée | Importante / limitée | Interdit d'usage (Conditions art. 6) ; [pas de segment sur ces soirées] ; drapeau « soirée sensible » à venir dans l'outil | Limité |
| Profilage de mineurs | Importante / [selon vos soirées] | Interdit d'usage ; [vérifier l'âge de vos soirées] ; exclusion automatique à venir dans l'outil | [à évaluer] |
| Sur-sollicitation, effet de surprise | Limitée / limitée | Règles d'envoi Yuno (fréquence, heures), groupe témoin, désinscription simple | Négligeable |
| Mesure des ouvertures sans accord | Importante / importante tant que l'accord n'est pas recueilli | Recueillir l'accord à la collecte ; sinon ne pas exploiter les ouvertures (outil en cours d'adaptation) | [à évaluer] |
| Disparition ou altération des données | Limitée / limitée | Hébergement Supabase (UE), sauvegardes, export à tout moment | Négligeable |

### B5. Validation
Avis du DPO s'il y en a un : [ ]. Avis des personnes ou de leurs représentants
(facultatif) : [ ]. Décision : [mise en œuvre / mise en œuvre sous réserve de …].
Date et signature : [ ].
