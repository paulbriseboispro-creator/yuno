# Yuno CRM — analyse client : dossier de conformité (v1, 8 octobre 2026)

Version 1 des textes, écrite pour mettre l'analyse client en ligne et
l'améliorer ensuite. Elle remplace la proposition du 7 octobre. **Ce n'est pas
une consultation d'avocat** : les textes sont fondés sur les sources ci-dessous,
lues le 8 octobre, et restent à faire relire (partie 8).

## 1. Ce qui est publié (branche `legal/crm-analysis`)

| Texte | Adresse | Contenu |
|---|---|---|
| Conditions Yuno CRM (nouveau, FR/EN/ES) | `/legal/cgv-crm` | Contrat du CRM : service, essai, abonnement, Yunits, connexion à la billetterie, analyses et interdits d'usage (art. 6), envois et traceurs (art. 7), données des clients du pro (art. 8), statistiques anonymes (art. 9), responsabilité, fin et sort des données ; annexe = modèle d'information pour les clients du pro |
| Accord de sous-traitance (DPA) | `/legal/dpa` | Version datée ; art. 5 et 10 : Octopush et OpenAI ajoutés ; nouveau **chapitre 12 « Yuno CRM »** : traitements, données (dont données déduites), instructions, profilage et engagements de Yuno (12.4), obligations du pro (12.5), **statistiques anonymes = réutilisation autorisée par écrit, Yuno responsable** (12.6), sous-traitants (12.7), violation sous 48 h, fin (12.8) |
| Politique de confidentialité de Yuno | `/legal/privacy` | Nouvelle section 14 : Yuno CRM vu par le client final (Yuno sous-traitant, analyse, droits, statistiques anonymes) |
| Registre des traitements | `docs/legal/REGISTRE_TRAITEMENTS_RGPD.md` | A9 (statistiques anonymes, Yuno responsable), B7 à B9 (CRM), sous-traitants |
| Modèle d'AIPD + mise en balance | `docs/legal/CRM_AIPD_MODELE.md` | Ce que l'article 8 des Conditions promet de fournir au pro |

Acceptation : fenêtre `CrmLegalGate` dans la Console CRM, pour le **titulaire**
seul, une fois par version ; preuve dans `legal_acceptances` (types `terms_crm`
et `dpa`, migration `20261015100000`, version + empreinte SHA-256 du texte + IP +
user-agent + espace). Jamais en aperçu démo, en accès assisté ni sur un compte
`@womber.fr`. Réglages › Données › « Vos documents » donne les quatre liens ; la
FAQ `yc.faq.legal` dit au pro quoi dire à ses clients. Sur la landing CRM
(dépôt `yuno-landing-crm`, branche `legal/crm-terms`), la case d'inscription et
le pied de page pointent vers ces textes.

**Ordre de mise en ligne obligatoire** : migration `20261015100000` d'abord,
puis le front. Sans la migration, l'enregistrement est refusé
(`invalid_doc_type`) et la fenêtre revient à chaque visite.

**L'apprentissage commun reste éteint** (`crm_learning_settings.enabled =
false`). Il ne produit rien avant 5 vrais comptes contributeurs ; voir la
partie 5 avant de l'allumer.

## 2. Ce que le code garantit déjà (et que les textes affirment)

| Affirmation des textes | Où c'est tenu |
|---|---|
| Calcul par compte, jamais de rapprochement entre comptes | portée `scope_key` partout ; `_crm_people_build` pose `yuno.crm_scope` |
| Score = modèle propre au compte, 12 derniers mois | `_crm_logit_fit`, `_crm_score_build` (4 dernières soirées tenues à l'écart) |
| Ni genre, ni ouvertures, ni clics dans l'analyse et le score | facteurs `_crm_score_features()` (13, aucun e-mail, aucun genre) ; familles d'hypothèses sans genre ; la famille « canal » lit la source UTM du billet rapportée par la billetterie, pas un traceur |
| Jamais de pourcentage, des raisons | `crm_person_night_score.label` + `_crm_score_reason_key` ; écrans |
| Jamais dans un export | lectures `crm_client_analysis` seulement |
| Opposition par personne : profil, scores, journal effacés, exclusion durable | `crm_profile_optout` + trigger `_crm_score_on_optout` (scores, `crm_prediction_people`) |
| Purge avec la personne, la connexion, le compte, la durée choisie | `_crm_erase_contacts`, trigger de connexion, clés étrangères, `crm_retention_sweep` |
| Statistiques : n ≥ 10, clé opaque, 5 comptes, aucun > 50 %, validation humaine, refus du titulaire | `_crm_an_contribute`, `crm_learning_keys`, `crm_learning_publish`, `crm_admin_rules_approve`, `crm_learning_contrib_set` |
| Personnes exclues du profilage hors statistiques | le moteur retire `crm_profile_optouts` avant tout test |
| Accès assisté seulement avec l'accord du titulaire, journalisé | `admin_support_grants`, `admin_support_audit` |
| Clé de billetterie dans un coffre, jamais réaffichée | Vault (`ticketing_connections`) |

## 3. Sources lues (vérifiées le 8 octobre 2026)

Vérifiées directement : **CNIL, recommandation pixels** (délib. n° 2026-042 du
12 mars 2026, publiée le 14 avril 2026,
[page](https://www.cnil.fr/fr/recommandation-pixel-suivi-courriels)) et sa
[FAQ](https://www.cnil.fr/fr/faq-recommandation-pixels-courriers-electroniques) ;
**CNIL, réutilisation par un sous-traitant** (11 janvier 2022,
[fiche](https://www.cnil.fr/fr/sous-traitants-la-reutilisation-de-donnees-confiees-par-un-responsable-de-traitement)) ;
**politique de confidentialité de Shotgun** (Europe, en vigueur mai 2026,
§ 3.2.1 : Shotgun est **sous-traitant de l'organisateur** pour les données
d'achat et de contact).

Lues par les deux recherches (rapports complets dans la session du 08/10) :
RGPD art. 4(4), 5, 6(1)(f) et 6(4), 9, 12-14, 21, 22, 25, 26, 28, 30, 32, 35,
considérants 26, 38, 47, 50, 60, 71 ; WP251rev.01 (profilage), WP248rev.01
(AIPD), WP216 (anonymisation) ; EDPB 07/2020 (rôles), 1/2024 (intérêt légitime,
version de consultation) ; CJUE C-634/21 SCHUFA, C-203/22 Dun & Bradstreet,
C-252/21 Meta, C-184/20 OT, C-21/23 Lindenapotheke, C-446/21 Schrems, C-621/22
KNLTB, C-394/23 Mousse, C-683/21, C-604/22 IAB Europe, C-413/23 P CEPD c. CRU,
C-654/23 Inteligo Media ; CNIL : référentiel « gestion des activités
commerciales » (délib. 2021-131), listes AIPD (2018-327 et 2019-118), fiche
anonymisation (2020), guide du sous-traitant (2017) ; CPCE L. 34-5 ; loi
Informatique et Libertés art. 47 et 82 ; AI Act (annexe III, art. 5 et 50).
Non vérifiés à la source : texte consolidé de L. 34-5 sur Légifrance, charte
AF2M 2026, version finale des lignes directrices EDPB 1/2024 et 01/2025,
conditions d'API de Shotgun (« Special Terms » non publics).

## 4. Qualification et bases légales retenues

- **Rôles.** Le pro est responsable ; Shotgun est son sous-traitant (vérifié) ;
  Yuno est un autre sous-traitant qu'il désigne en connectant le CRM. Les données
  d'achat sont donc collectées auprès de la personne par le prestataire du pro :
  l'information relève de l'**article 13** (au moment de la collecte, sur la page
  de soirée de la billetterie) et, pour ce que Yuno ajoute (ouvertures, analyse),
  au plus tard au premier message (art. 14(3)(b) et 21(4)). D'où la consigne de
  l'annexe : publier le texte comme politique de confidentialité de la billetterie.
- **Profilage** (« Ce qui fait venir », « Chances de venir », « Qui cibler »,
  groupe témoin) : art. 4(4). Base : **intérêt légitime du pro** (art. 6(1)(f),
  considérant 47, KNLTB). Défendable parce que : données de première partie,
  achats chez le pro lui-même, pas de suivi multi-sites, pas de genre ni de
  traceur, fenêtre de 12 mois pour le score, opposition simple, aucun effet sur
  le prix ou l'accès. Le pro doit écrire sa mise en balance (modèle fourni).
- **Article 22** : ne s'applique pas tant que le score ne sert qu'à choisir les
  destinataires de messages commerciaux (WP251 p. 22). D'où l'interdit
  contractuel (Conditions art. 6, DPA 12.5) : jamais de prix, de remise réservée,
  de prévente ou de refus d'entrée piloté par le score. Si un jour le produit le
  propose, l'analyse change (SCHUFA).
- **Envoi** : L. 34-5. Le soft opt-in est fragile pour des acheteurs Shotgun
  (case d'adhésion à la collecte, pas une opposition) ; Yuno n'écrit déjà qu'aux
  contacts dont Shotgun remonte l'accord, ou qui ont consenti sur une page Yuno.
- **Traceurs d'e-mails** : art. 82 + recommandation 2026-042. Voir la partie 6,
  point 1 : c'est le premier chantier.
- **Statistiques anonymes** : réutilisation par le sous-traitant pour son propre
  compte. Conditions CNIL (vérifiées) : autorisation **écrite**, **spécifique**
  (« une autorisation préalable et générale […] n'est pas légale »), test de
  compatibilité, information par le responsable ; le sous-traitant devient
  **responsable** de ce traitement. Le DPA 12.6 les reprend : finalité unique et
  décrite, conditions chiffrées, Yuno responsable, retrait possible.

## 5. Statistiques anonymes : test de compatibilité et évaluation de l'anonymat

**Compatibilité (art. 6(4)).** Lien entre les finalités : régler les seuils de
l'analyse dont le pro se sert lui-même. Contexte : prestataire choisi par le pro
pour analyser ses données. Nature : achats et présence, aucune donnée sensible
recherchée. Conséquences pour les personnes : aucune (aucune décision, aucun
message, aucune donnée nominative en sortie). Garanties : celles du DPA 12.6.
Conclusion : compatible.

**Anonymat (critères CNIL / WP216).**
- *Individualisation* : impossible, chaque ligne est un comptage d'au moins 10
  personnes, sans identifiant, sous une clé de compte aléatoire.
- *Corrélation* : aucune donnée commune avec une autre source (ni e-mail, ni
  empreinte, ni titre, ni ville) ; le lien clé ↔ compte n'existe que dans
  `crm_learning_keys`, effacé avec le compte.
- *Inférence* : une leçon commune exige 5 comptes et aucun > 50 %, donc on ne
  peut pas lire un compte à travers elle.
- *Attaque par différence* (comparer deux calculs qui diffèrent d'une personne) :
  le grain est le **trimestre** et la famille ; les comptages du compte ne sont
  jamais exposés à un autre compte, seulement agrégés. **À compléter avant
  activation** : arrondir les comptages publiés (par exemple au multiple de 5) ou
  ne publier une leçon qu'à chaque changement de trimestre.
- Réserve : les données brutes restent dans chaque compte (WP216 p. 9) ; c'est
  pourquoi le calcul en amont reste un traitement de données personnelles, que
  le pro autorise.

**Avant d'allumer** `crm_learning_settings.enabled` : (1) Conditions et DPA
acceptés par les comptes contributeurs ; (2) arrondi ou rythme trimestriel
ci-dessus ; (3) décision de Paul sur l'option par défaut (partie 7, point 1).

## 6. Risques trouvés et corrections produit (par priorité)

Aucune de ces corrections n'est faite dans cette branche ; les textes ne
prétendent pas qu'elles le sont.

1. **Pixels et liens de clic par destinataire (tout le moteur e-mail, Billetterie
   comprise).** Depuis le 14 juillet 2026, mesurer les ouvertures pour la
   performance, les segments d'engagement, le renvoi aux non-ouvreurs, le gagnant
   A/B ou l'attribution exige le **consentement** du destinataire. Seule
   exemption : la date de dernière ouverture, au jour, pour réduire les envois aux
   inactifs, et seulement dans un e-mail demandé (newsletter consentie), jamais
   en soft opt-in. Aujourd'hui Resend mesure ouvertures et clics pour tous.
   Chantier : registre de consentement aux traceurs (case à la collecte : pages
   d'inscription, imports), e-mail de demande **sans pixel**, mode « délivrabilité
   exemptée » pour les autres, statut d'engagement et rapports sur les seuls
   consentis, lien de retrait dans le pied. Les textes mettent l'accord à la
   charge du pro (Conditions art. 7, DPA 12.5) ; sans l'outil, il ne peut pas le
   tenir. **Le score et les hypothèses n'en dépendent pas.**
2. **Mineurs.** L'âge est connu ; rien ne les exclut. Exclure de l'analyse, du
   score, de « Qui cibler » et des statistiques toute personne de moins de 18 ans
   (considérants 38 et 71, WP251 p. 28-29, EDPB 1/2024 § 91-95).
3. **Soirées « sensibles ».** Une affinité pour une série queer ou confessionnelle
   peut révéler l'orientation ou une conviction (C-184/20, C-252/21 § 68-69,
   C-21/23). Ajouter un drapeau « soirée sensible » (posé par le pro, proposé par
   mots-clés) qui retire la soirée des hypothèses individuelles, du score, des
   segments et des statistiques. En attendant : interdit contractuel.
4. **Opposition à la prospection = fin du profilage marketing** (art. 21(3)).
   Une personne désinscrite de tout (e-mail et STOP) devrait sortir du score et de
   « Qui cibler ». Décision de Paul (partie 7, point 2).
5. **Conservation.** Défaut « Jamais » et activité qui compte une **ouverture**
   d'e-mail ; la CNIL compte un achat, une venue, un clic, une inscription, pas
   une ouverture (référentiel 2021-131 et Q&R). Proposer 3 ans par défaut aux
   nouveaux comptes, ne plus compter l'ouverture.
6. **Suppressions faites chez Shotgun** : elles ne se propagent pas à la copie de
   Yuno. Les relire à la synchro, ou appliquer la règle des 3 ans.
7. **Genre dans les segments** (`gender_female` / `gender_male` du catalogue) :
   C-394/23 Mousse demande la sobriété. Ne plus les recommander, au minimum.
8. **Clôture automatique après 12 mois de pause** et suppression sous 30 jours
   (90 pour les sauvegardes) : promise par les Conditions (art. 13) et le DPA
   (12.8), **procédure manuelle aujourd'hui**. À automatiser, ou à faire à la main
   avec l'avertissement à J-30.
9. **Information au premier message sans effort pour le pro** : une page
   « Vos données chez [structure] » hébergée par Yuno pour chaque compte, et son
   lien ajouté d'office au pied des e-mails CRM et aux pages d'inscription. Règle
   la question « où publier ? » pour les organisateurs sans site.

## 7. Décisions pour Paul

1. **Statistiques anonymes : par défaut ou sur adhésion ?** Ta décision du 07/10
   est « par défaut, refus possible » ; les textes l'appliquent (autorisation
   écrite et spécifique donnée en acceptant le DPA, rappelée dans la fenêtre
   d'acceptation, retirable). La recherche juge l'adhésion active plus sûre (la
   CNIL refuse les autorisations « générales »). Rien ne sort tant que le drapeau
   global est éteint : la question se pose seulement le jour où on l'allume.
2. Désinscrit de tout = sorti du score et de « Qui cibler » ? (Recommandé : oui.)
3. Durée de conservation par défaut à 3 ans pour les nouveaux comptes ?
4. Ordre des chantiers de la partie 6 (proposé : 1, 2, 9, 3, 4, 5, 8, 6, 7).

## 8. Engagements pris dans les textes, à tenir

| Engagement | Texte | État |
|---|---|---|
| Violation notifiée au pro sous 48 h | DPA 12.8 | registre `crm_incidents` existe (échéance CNIL 72 h) ; ajouter l'alerte à 48 h côté pro |
| Suppression à la clôture sous 30 jours, sauvegardes 90 jours | Conditions 13, DPA 12.8 | manuel |
| Clôture après 12 mois de pause, avertissement à J-30 | Conditions 13, DPA 12.8 | manuel |
| Prix d'un abonnement en cours : préavis 30 jours, résiliation possible | Conditions 3 | conforme à `crm_price_tier` (le fondateur garde le lancement) |
| Retrait d'une fonction essentielle : préavis 30 jours et remboursement prorata | Conditions 10 | manuel |
| Arrêt de Yuno CRM : Yunits achetés remboursés | Conditions 4 | manuel |
| Modèle d'AIPD et de mise en balance fourni sur demande | Conditions 8, DPA 12.5 | `docs/legal/CRM_AIPD_MODELE.md` |
| Évaluation d'anonymat documentée | DPA 12.6 | partie 5, à compléter avant activation |

## 9. À faire relire par un avocat

La rédaction complète des Conditions Yuno CRM (clauses de responsabilité,
compétence, Yunits) ; le chapitre 12 du DPA ; le choix « par défaut » de la
partie 7 ; la portée de la recommandation pixels sur les liens de clic ; les
conditions d'API de Shotgun (à demander dans la discussion partenaire).
