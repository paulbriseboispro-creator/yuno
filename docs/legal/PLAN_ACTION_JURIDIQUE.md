# Plan d'action juridique Yuno
### Ce qu'il te reste à faire toi-même — par ordre de priorité

**Contexte.** Le dispositif technique est déjà en place et déployé : clickwraps sur les 4 portes
d'entrée pro (signup, liens d'onboarding, démo, rattrapage des pros existants), Engagement de
confidentialité (`/legal/confidentialite`), DPA RGPD (`/legal/dpa`), registre des acceptations en
base (version + hash + IP + horodatage = signature électronique eIDAS), NDA signable
(`docs/legal/NDA_Yuno_FR.pdf`), registre des traitements art. 30
(`docs/legal/REGISTRE_TRAITEMENTS_RGPD.md`).

Les 5 actions ci-dessous ne peuvent être faites que par toi (compte personnel, paiement, signature).

---

## 1. Déposer la marque « Yuno » à l'INPI — 🔴 URGENT

**Pourquoi c'est la priorité n°1.** Aujourd'hui, n'importe qui peut déposer « Yuno » et t'obliger à
tout renommer (app, domaine, comptes sociaux). Le NDA protège tes infos, le droit d'auteur protège
ton code — mais **rien ne protège ton nom**.

**⚠️ Alerte antériorité détectée.** Il existe **Yuno Inc.** (y.uno), une fintech d'orchestration de
paiements fondée en 2021, avec au moins un dépôt de marque actif aux États-Unis (USPTO n° 99284614).
Comme ton app encaisse des paiements, il y a un risque de conflit sur les classes logiciel/paiement.
Ce n'est **pas bloquant** (secteurs différents : nightlife vs infrastructure B2B), mais ça impose de
faire la recherche sérieusement AVANT de payer le dépôt.

**Étapes :**

1. **Recherche d'antériorités (gratuit, ~20 min)** :
   - data.inpi.fr → Marques → chercher « yuno », « youno », « juno » (similarité phonétique compte).
   - tmdn.org/tmview (base européenne + mondiale) → chercher « yuno », filtrer classes 9, 35, 41, 42.
   - Regarde : classes visées, statut (enregistrée/expirée), produits/services couverts.
2. **Si doute → pré-diagnostic INPI (gratuit)** : l'INPI offre un « pass PI » / pré-diagnostic aux
   TPE, et un premier rendez-vous conseil. Sinon, 1 h avec un CPI (conseil en propriété industrielle,
   ~150-300 €) pour valider la stratégie — rentable vu l'enjeu.
3. **Déposer en ligne** sur procedures.inpi.fr :
   - **Classes recommandées** (libellés prêts à coller) :
     - **Classe 9** — « Logiciels ; applications mobiles téléchargeables ; logiciels de billetterie
       électronique ; billets électroniques téléchargeables ; QR codes. »
     - **Classe 35** — « Publicité ; promotion d'événements ; services de fidélisation de clientèle ;
       vente au détail de billets d'événements ; gestion commerciale pour établissements de nuit ;
       services d'affiliation et de parrainage commercial. »
     - **Classe 41** — « Services de divertissement ; organisation d'événements et de soirées ;
       services de discothèques et boîtes de nuit ; réservation de billets d'événements ;
       services de disc-jockeys. »
     - **Classe 42** — « Logiciels en tant que service (SaaS) ; plateformes informatiques en tant
       que service (PaaS) ; hébergement de plateformes de billetterie et de réservation. »
   - **Coût** : 190 € (1 classe) + 40 € par classe supplémentaire → **310 € pour 4 classes**.
   - Marque **verbale** « YUNO » (protège le nom dans toutes les polices). Tu pourras déposer le
     logo (semi-figurative) plus tard si besoin.
4. **Calendrier** : publication au BOPI ~6 semaines → fenêtre d'opposition 2 mois → enregistrement
   ~5 mois au total. La protection court à partir de la **date de dépôt**.
5. **Plus tard (quand l'Espagne devient réelle)** : marque de l'UE via l'EUIPO (850 € 1 classe,
   +50/+150 € les suivantes). Tu as 6 mois après le dépôt français pour étendre en gardant la
   priorité de date. Attention : c'est là que le conflit avec Yuno Inc. serait le plus sensible —
   à valider avec le CPI si tu passes à l'EUIPO.

---

## 2. Dépôt e-Soleau — preuve d'antériorité — 🟠 cette semaine (15 €, 15 min)

**Pourquoi.** Horodatage officiel INPI prouvant que TU avais conçu tout ça à cette date. Si un
concurrent (ou un club passé par ta démo) sort une copie, c'est ta preuve d'antériorité de création.

**Étapes :**
1. Prépare un ZIP (≤ 10 Mo, jusqu'à 100 Mo en payant plus) contenant :
   - captures d'écran des dashboards clés (owner, orga, DJ, VIP, démo Womber) ;
   - `docs/PRD.md`, les deux design systems, la stratégie pricing ;
   - un schéma d'architecture + l'arborescence des fonctionnalités ;
   - le NDA et l'Engagement de confidentialité.
2. procedures.inpi.fr → e-Soleau → dépose le ZIP (15 € pour 10 Mo, conservation 5 ans renouvelable).
3. Garde le récépissé horodaté précieusement.

**Bonus gratuit déjà acquis :** ton historique git horodaté vaut aussi commencement de preuve.

---

## 3. Assurance RC Pro (+ cyber) — 🟠 ce mois-ci

**Pourquoi.** Un bug de surbooking un soir de réveillon, une fuite de données, un billet non honoré :
c'est l'assurance qui paie, pas un contrat. Billetterie + alcool + nightlife = exposition réelle.

**Ce qu'il faut demander (comparer 2-3 devis) :**
- **RC professionnelle** éditeur de logiciel / plateforme SaaS (faute, bug, conseil) ;
- **RC exploitation** (dommages tiers) ;
- **Cyber** : violation de données, frais de notification CNIL, gestion de crise — vu que tu
  traites les données clients des clubs, c'est le vrai risque n°1 ;
- **Protection juridique** (litiges clubs/clients) en option.
- Assureurs en ligne adaptés aux solos tech : Orus, Stello, Coover, Hiscox, AXA pro.
- **Budget attendu** : ~300-600 €/an en auto-entrepreneur SaaS ; la cyber peut doubler ça.
- Déclare bien l'activité réelle : « édition d'une plateforme SaaS de billetterie, réservation et
  commande pour établissements de nuit » — pas juste « développeur ».

---

## 4. Relecture avocat — 🟡 avant le premier gros club payant

**Quoi faire relire (une passe, tout d'un coup)** :
- CGV Pro + Engagement de confidentialité + DPA (`yunoapp.eu/legal/...`) ;
- le NDA (`docs/legal/NDA_Yuno_FR.pdf`) ;
- point spécifique à poser : la vente d'alcool en ligne avec retrait sur place (licence du club,
  déclaration de majorité — le dispositif technique existe déjà, faire valider le montage).
- **Où** : avocat IT/IP à Toulouse ; consultations gratuites de l'Ordre pour un premier contact ;
  budget relecture complète ~500-1 500 €.
- **Quand** : pas bloquant pour vendre aujourd'hui — indispensable avant de signer un club à fort
  volume ou de lever des fonds.

---

## 5. Passage en société (SASU) — 🟢 moyen terme, à garder en tête

Pas urgent, mais le jour où le CA décolle ou qu'un gros contrat arrive :
- responsabilité limitée au capital (l'EI 2022 protège ton patrimoine perso, mais la SASU est
  plus propre vis-à-vis des partenaires et investisseurs) ;
- la **marque et les contrats seront à transférer** à la société — dépose quand même la marque
  maintenant en ton nom propre (l'apport/cession à la société est simple) ;
- crédibilité commerciale face aux gros clubs et aux chaînes.

---

## Récapitulatif

| # | Action | Coût | Délai | Statut |
|---|--------|------|-------|--------|
| 1 | Recherche antériorités + dépôt marque INPI (4 classes) | ~310 € (+CPI ~200 € si doute) | Cette semaine | ⬜ À faire |
| 2 | Dépôt e-Soleau (ZIP preuves) | 15 € | Cette semaine | ⬜ À faire |
| 3 | RC Pro + cyber (2-3 devis) | ~300-600 €/an | Ce mois-ci | ⬜ À faire |
| 4 | Relecture avocat (CGV/NDA/DPA/alcool) | ~500-1 500 € | Avant 1er gros club | ⬜ À faire |
| 5 | SASU | ~500 € création | Quand le CA décolle | ⬜ Plus tard |
| — | Clickwraps + NDA + DPA + registres | fait | — | ✅ Déployé |
| — | Durées de conservation à valider (3 points, fin du registre art. 30) | 15 min | Quand tu veux | ⬜ À faire |

*Document préparé le 4 juillet 2026. Ce plan est un guide pratique, pas un avis juridique.*
