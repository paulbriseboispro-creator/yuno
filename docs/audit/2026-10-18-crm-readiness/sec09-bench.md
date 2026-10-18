# SEC-09 — promoteur d'une vente et promoteurs d'agence, au banc (2026-10-18T22:34Z)

Définitions, policies, triggers, contraintes et droits lus sur la prod le 2026-10-18T22:33Z (`node scripts/crm-bench/sec09.mjs dump`, lecture seule) ; chaque scénario tourne dans une transaction annulée, sous l'identité de l'API (`authenticator` → `authenticated` / `service_role`, claims JWT). Cinq bases neuves, mêmes données : la prod du 18/10 ; + `20261026100000_promoter_conversion_scope.sql` + `20261026100100_agency_promoter_contract_policy.sql` ; + `20261025200000_promoter_self_update_guard.sql` puis SEC-09 ; SEC-09 puis le bloc 7 de `ROLLBACK.sql` (attendu : les résultats d'avant) ; SEC-09 appliquée deux fois (attendu : les résultats d'après). Les scénarios « Checkout » rejouent les requêtes des fonctions edge (prod, puis corrigée par `_shared/promoter-scope.ts`, le vrai module) : elles ne dépendent pas des migrations.

**41 / 41 scénarios conformes à l'attendu dans les cinq phases.**

Smoke de répétition sur la prod (`scripts/crm-bench/smoke/sec09.sql`), joué au banc : SEC-09 ✓ `SMOKE_OK {"agence_plafond": "modifié", "hors_perimetre": "out_of_scope, rien d'écrit", "promoteur_seul": "refusé", "dans_le_perimetre": "écrite", "agence_creation_hors_contrat": "refusée", "agence_deplacement_hors_contrat": "refusé"}` ; SEC-07 + SEC-09 ✓ `SMOKE_OK {"agence_plafond": "modifié", "hors_perimetre": "out_of_scope, rien d'écrit", "promoteur_seul": "refusé", "dans_le_perimetre": "écrite", "agence_creation_hors_contrat": "refusée", "agence_deplacement_hors_contrat": "refusé"}` ; SEC-09 appliquée deux fois ✓ `SMOKE_OK {"agence_plafond": "modifié", "hors_perimetre": "out_of_scope, rien d'écrit", "promoteur_seul": "refusé", "dans_le_perimetre": "écrite", "agence_creation_hors_contrat": "refusée", "agence_deplacement_hors_contrat": "refusé"}`.

| | Scénario | Avant (prod) | SEC-09 | SEC-07 + SEC-09 | SEC-09 puis retour arrière | SEC-09 appliquée deux fois |
|---|---|---|---|---|---|---|
| K1 | Checkout billet (prod) : id du promoteur du club A envoyé sur une soirée du club B — *requête de la fonction edge, hors migration : la remise de 50 % s’applique* | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) |
| K2 | Checkout billet (corrigé) : même id, borné au périmètre de la soirée du club B | aucun | aucun | aucun | aucun | aucun |
| K3 | Checkout billet (corrigé) : id du promoteur du club A sur une soirée du club A | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) |
| K4 | Checkout billet (corrigé) : co-soirée du club B avec le club A partenaire | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) |
| K5 | Checkout billet (corrigé) : id du promoteur de l’organisateur G sur sa soirée sans club | PR2 (remise 0) | PR2 (remise 0) | PR2 (remise 0) | PR2 (remise 0) | PR2 (remise 0) |
| K6 | Checkout (prod) : code « % » sur une soirée du club A (prévente ouverte aussi) — *le plus ancien promoteur du club, sans connaître aucun code* | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) |
| K7 | Checkout (corrigé) : code « % » | aucun (code refusé) | aucun (code refusé) | aucun (code refusé) | aucun (code refusé) | aucun (code refusé) |
| K8 | Checkout (corrigé) : vrai code en minuscules | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) | PR1 (remise 50) |
| K9 | Checkout (corrigé) : code du club A sur une soirée du club B | aucun | aucun | aucun | aucun | aucun |
| R1 | Service : commission du promoteur du club A sur un billet du club B | commission 10 | out_of_scope | out_of_scope | commission 10 | out_of_scope |
| R2 | Service : commission du promoteur du club A sur un billet du club A | commission 10 | commission 10 | commission 10 | commission 10 | commission 10 |
| R3 | Service : co-soirée, promoteur du club partenaire | commission 10 | commission 10 | commission 10 | commission 10 | commission 10 |
| R4 | Service : promoteur de l’organisateur, soirée sans club | commission 10 | commission 10 | commission 10 | commission 10 | commission 10 |
| R5 | Service : promoteur d’agence au club A, soirée du club A | commission 10 | commission 10 | commission 10 | commission 10 | commission 10 |
| C1 | Promoteur : se crédite 10 000 € de billet, sans soirée ni vente | commission 10 | refusé : Not authorized to record this conversion | refusé : Not authorized to record this conversion | commission 10 | refusé : Not authorized to record this conversion |
| C2 | Promoteur : même appel répété 3 fois (aucun conflit sans billet) | commission 10 | refusé (appel 1) : Not authorized to record this conversion | refusé (appel 1) : Not authorized to record this conversion | commission 10 | refusé (appel 1) : Not authorized to record this conversion |
| C3 | Promoteur : table à 5 % de 10 000 € sur une soirée de SON club | commission 500 | refusé : Not authorized to record this conversion | refusé : Not authorized to record this conversion | commission 500 | refusé : Not authorized to record this conversion |
| C4 | Promoteur du club A : commission sur une soirée du club B | commission 10 | refusé : Not authorized to record this conversion | refusé : Not authorized to record this conversion | commission 10 | refusé : Not authorized to record this conversion |
| C5 | Owner du club B : commission d’un promoteur du club A sur sa soirée | commission 10 | refusé : Not authorized to record this conversion | refusé : Not authorized to record this conversion | commission 10 | refusé : Not authorized to record this conversion |
| C6 | Promoteur : tête de guest list d’une entrée PAS scannée | commission 10 | refusé : Not authorized to record this conversion | refusé : Not authorized to record this conversion | commission 10 | refusé : Not authorized to record this conversion |
| C7 | Porte : le club A scanne l’invité de son promoteur (trigger) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| C8 | Porte, puis l’appel en double du front (PromoterScanTab) | {"override":0,"duplicate":true,"commission":10,"reward_type":"money","conversion_id":null,"reward_config":{}} | {"override":0,"duplicate":true,"commission":10,"reward_type":"money","conversion_id":null,"reward_config":{}} | {"override":0,"duplicate":true,"commission":10,"reward_type":"money","conversion_id":null,"reward_config":{}} | {"override":0,"duplicate":true,"commission":10,"reward_type":"money","conversion_id":null,"reward_config":{}} | {"override":0,"duplicate":true,"commission":10,"reward_type":"money","conversion_id":null,"reward_config":{}} |
| C9 | Porte : co-hôte accepté, le club B scanne l’invité du promoteur de H (trigger) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A1 | Agence : crée un promoteur au club B (aucun contrat), remise 100 % | ok(1) | refusé : new row violates row-level security policy for table "promoters" | refusé : new row violates row-level security policy for table "promoters" | ok(1) | refusé : new row violates row-level security policy for table "promoters" |
| A2 | Agence : puis le checkout du club B trouve ce code (remise 100 %) | d7d75c05-2d9f-4da7-a6f9-05f240942a45 (remise 100) | refusé (appel 1) : new row violates row-level security policy for table "promoters" | refusé (appel 1) : new row violates row-level security policy for table "promoters" | 7a1ce95b-f0ea-4af3-a3a0-e6ee0735f405 (remise 100) | refusé (appel 1) : new row violates row-level security policy for table "promoters" |
| A3 | Agence : déplace son promoteur du club A vers le club B | ok(1) | refusé : new row violates row-level security policy for table "promoters" | refusé : new row violates row-level security policy for table "promoters" | ok(1) | refusé : new row violates row-level security policy for table "promoters" |
| A4 | Agence : crée un promoteur au club C (contrat en pause) | ok(1) | refusé : new row violates row-level security policy for table "promoters" | refusé : new row violates row-level security policy for table "promoters" | ok(1) | refusé : new row violates row-level security policy for table "promoters" |
| A5 | Agence : crée un promoteur au club D (contrat en brouillon, ouvert par l’agence) | ok(1) | refusé : new row violates row-level security policy for table "promoters" | refusé : new row violates row-level security policy for table "promoters" | ok(1) | refusé : new row violates row-level security policy for table "promoters" |
| A6 | Agence : crée un promoteur au club A (contrat actif) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A7 | Agence : crée un promoteur chez l’organisateur G (contrat actif) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A8 | Agence : plafond et ventes autorisées de son promoteur (contrat actif) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A9 | Agence : plafond d’un promoteur du club C (contrat en pause, périmètre inchangé) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A10 | Agence : ramène le promoteur du club C vers le club A (contrat actif) | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A11 | Agence : ses promoteurs restent visibles (contrat en pause compris) | 2 | 2 | 2 | 2 | 2 |
| A12 | Agence : la fiche d’un promoteur hors agence (RLS, témoin) | ok(0) | ok(0) | ok(0) | ok(0) | ok(0) |
| A13 | Agence : retire un de ses promoteurs | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| A14 | Agence : plusieurs fiches d’un coup (groupe), dont une en pause | ok(2) | ok(2) | ok(2) | ok(2) | ok(2) |
| A15 | Agence : 100 % de remise client sur les billets du club A (SEC-10, décision) — *non corrigé : qui fixe la remise d’un promoteur d’agence est une décision* | PRA (remise 100) | PRA (remise 100) | PRA (remise 100) | PRA (remise 100) | PRA (remise 100) |
| M1 | Service (accept-promoter-invitation) : promoteur d’agence au club B | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| M2 | Owner du club A : commission du promoteur d’agence chez lui | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |
| M3 | Super admin : promoteur d’agence au club B | ok(1) | ok(1) | ok(1) | ok(1) | ok(1) |

## État après chaque scénario (avant / SEC-07 + SEC-09)

Données : club A (owner O), club B (owner X), clubs C et D (contrats d’agence en pause et en brouillon) ; PR1 promoteur du club A (billet 10 € fixe, table 5 %, remise 50 %), PR2 de l’organisateur G, PRH de l’organisateur H (co-hôte accepté de EH, soirée du club B), PRA et PRC promoteurs de l’agence (clubs A et C). Soirées EA (club A), EB (club B), EG (G, sans club), ECO (club B, club A partenaire), EH (club B, co-hôte H).

- **K1** avant : rien — après : rien
- **K2** avant : rien — après : rien
- **K3** avant : rien — après : rien
- **K4** avant : rien — après : rien
- **K5** avant : rien — après : rien
- **K6** avant : rien — après : rien
- **K7** avant : rien — après : rien
- **K8** avant : rien — après : rien
- **K9** avant : rien — après : rien
- **R1** avant : +ticket:PR1/10@EB PR1 dû 0→10 — après : rien
- **R2** avant : +ticket:PR1/10@EA PR1 dû 0→10 — après : +ticket:PR1/10@EA PR1 dû 0→10
- **R3** avant : +ticket:PR1/10@ECO PR1 dû 0→10 — après : +ticket:PR1/10@ECO PR1 dû 0→10
- **R4** avant : +ticket:PR2/10@EG PR2 dû 0→10 — après : +ticket:PR2/10@EG PR2 dû 0→10
- **R5** avant : +ticket:PRA/10@EA PRA dû 0→10 — après : +ticket:PRA/10@EA PRA dû 0→10
- **C1** avant : +ticket:PR1/10 PR1 dû 0→10 — après : rien
- **C2** avant : +ticket:PR1/10 +ticket:PR1/10 +ticket:PR1/10 PR1 dû 0→30 — après : rien
- **C3** avant : +table:PR1/500@EA PR1 dû 0→500 — après : rien
- **C4** avant : +ticket:PR1/10@EB PR1 dû 0→10 — après : rien
- **C5** avant : +ticket:PR1/10@EB PR1 dû 0→10 — après : rien
- **C6** avant : +guestlist:PR1/10@EA PR1 dû 0→10 — après : rien
- **C7** avant : +guestlist:PR1/10@EA PR1 dû 0→10 — après : +guestlist:PR1/10@EA PR1 dû 0→10
- **C8** avant : +guestlist:PR1/10@EA PR1 dû 0→10 — après : +guestlist:PR1/10@EA PR1 dû 0→10
- **C9** avant : +guestlist:PRH/10@EH PRH dû 0→10 — après : +guestlist:PRH/10@EH PRH dû 0→10
- **A1** avant : +promoteur@B — après : rien
- **A2** avant : +promoteur@B — après : rien
- **A3** avant : PRA→B — après : rien
- **A4** avant : +promoteur@C — après : rien
- **A5** avant : +promoteur@D — après : rien
- **A6** avant : +promoteur@A — après : +promoteur@A
- **A7** avant : +promoteur@orga — après : +promoteur@orga
- **A8** avant : rien — après : rien
- **A9** avant : rien — après : rien
- **A10** avant : PRC→A — après : PRC→A
- **A11** avant : rien — après : rien
- **A12** avant : rien — après : rien
- **A13** avant : PRC supprimé — après : PRC supprimé
- **A14** avant : rien — après : rien
- **A15** avant : rien — après : rien
- **M1** avant : +promoteur@B — après : +promoteur@B
- **M2** avant : rien — après : rien
- **M3** avant : +promoteur@B — après : +promoteur@B

Pièces de la prod que le banc n'a pas posées : contrainte promoters.promoters_agency_rule_template_id_fkey (relation "agency_rule_templates" does not exist).
