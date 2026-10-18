# SEC-06 — gardes du règlement promoteur, au banc (2026-10-18T13:06Z)

Définitions, policies, triggers, contraintes et droits lus sur la prod le 2026-10-18T12:53Z (`node scripts/crm-bench/sec06.mjs dump`, lecture seule) ; chaque scénario tourne dans une transaction annulée, sous l'identité de l'API (`authenticator` → `authenticated` / `service_role`, claims JWT). « Avant » = la prod du 18/10 ; « Après » = la même base + `20261024100000_promoter_settlement_guards.sql`.

Gardes avant : guard_promoter_payout_write DEFINER (pas de garde sur promoter_conversions). Après : guard_promoter_conversion_settlement INVOKER, guard_promoter_payout_write INVOKER.

**30 / 30 scénarios conformes à l'attendu, avant ET après.**

Smoke de répétition sur la prod (`scripts/crm-bench/smoke/sec06.sql`), joué au banc sur la base « après » : ✓ `SMOKE_OK {"cycle": "préparé, déclaré, confirmé", "montant": 6, "réglé_par": "agence", "patch_direct": "refusé", "commissions_soldées": 1}`.

| | Scénario | Avant (prod) | Après (migration) |
|---|---|---|---|
| D1 | Owner : commission passée en « payée » par un PATCH direct | ok(1) | refusé : conversion_direct_write_forbidden |
| D2 | Owner : commission mise à 0 par un PATCH direct | ok(1) | refusé : conversion_direct_write_forbidden |
| D3 | Owner : commission déplacée vers un autre promoteur du club | ok(1) | refusé : conversion_direct_write_forbidden |
| D4 | Manager « promoteurs » : commission passée en « payée » | ok(1) | refusé : conversion_direct_write_forbidden |
| D5 | Organisateur : commission de son promoteur passée en « payée » | ok(1) | refusé : conversion_direct_write_forbidden |
| D6 | Super admin depuis le client : commission annulée | ok(1) | refusé : conversion_direct_write_forbidden |
| D7 | Super admin depuis le client : commission supprimée | ok(1) | refusé : conversion_direct_write_forbidden |
| D8 | Owner : mise à jour qui ne change rien (témoin) | ok(1) | ok(1) |
| D9 | Owner d'un autre club : PATCH (RLS, témoin) | ok(0) | ok(0) |
| D10 | Promoteur : se payer lui-même (RLS, témoin) | ok(0) | ok(0) |
| D11 | Owner : lot de règlement passé en « payé » par un PATCH direct | refusé : payout_direct_write_forbidden | refusé : payout_direct_write_forbidden |
| D12 | Owner : lot supprimé par un DELETE direct | refusé : payout_direct_write_forbidden | refusé : payout_direct_write_forbidden |
| D13 | Owner : note du lot corrigée (libellé, hors cycle) | ok(1) | ok(1) |
| R1 | Cycle club : préparer → déclarer le virement → le promoteur confirme | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R2 | Cycle organisateur : préparer → déclarer → confirmer | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R2b | Cycle agence : le chef d’agence prépare et déclare, le promoteur confirme | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R3 | Litige : contester → le club redéclare → le promoteur confirme | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R4 | Litige : contester → le club annule le lot (commissions de nouveau dues) | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R5 | Annuler un lot préparé, avant le virement | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R6 | Veille quotidienne (cron) : pas d’accusé à temps → litige | refusé (appel 1) : payout_direct_write_forbidden | ok |
| R7 | Remboursement d’un billet (fonction edge, service_role) : commission annulée | ok(1) | ok(1) |
| R8 | Remboursement déclenché par un client (trigger SECURITY DEFINER) | ok(1) | ok(1) |
| R9 | Fonction edge en service_role : écriture directe | ok(1) | ok(1) |
| R11 | Porte : commission enregistrée, puis part du chef d’équipe prélevée (UPDATE dans la RPC) | ok | ok |
| R12 | Lot déjà préparé (PRB) : le club déclare le virement | refusé : payout_direct_write_forbidden | ok |
| R13 | Lot déjà préparé (PRB) : le club l’annule | refusé : payout_direct_write_forbidden | ok |
| R14 | Lot déclaré (posé en service_role) : le promoteur confirme la réception | refusé (appel 2) : payout_direct_write_forbidden | ok |
| R10 | L’ancien règlement en un clic reste fermé | refusé : use_two_step_flow | refusé : use_two_step_flow |
| O1 | Owner supprime un promoteur qui a un lot ouvert (cascade) — *à décider : voir BACKLOG 16g* | refusé : payout_direct_write_forbidden | ok(1) |
| O2 | Promoteur : sa propre commission de billet relevée à 99 (SEC-07, hors migration) — *non corrigé ici* | ok(1) | ok(1) |

## État après chaque scénario (version « après »)

Commissions : C1 10 €, C2 15 €, C4 8 € (billet T1) en attente pour PR1, C5 3 € déjà payée ; C3 8 € pour PR2 (organisateur) ; C6 7 € pour PRB, rattachée au lot ouvert PRB ; C7 6 € pour PRA (agence).

- **D1** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D2** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D3** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D4** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D5** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D6** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D7** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D8** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D9** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D10** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D11** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D12** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **D13** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R1** C1=paid C2=paid C3=pending C4=paid C5=paid C6=pending C7=pending · lot PR1 paid 33 · lot PRB pending · PR1 dû 0 payé 33, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R2** C1=pending C2=pending C3=paid C4=pending C5=paid C6=pending C7=pending · lot PR2 paid 8 · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 0 payé 8, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R2b** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=paid · lot PRA paid 6 · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 0 payé 6
- **R3** C1=paid C2=paid C3=pending C4=paid C5=paid C6=pending C7=pending · lot PR1 paid 33 · lot PRB pending · PR1 dû 0 payé 33, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R4** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R5** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R6** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · lot PR1 disputed 33 · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R7** C1=pending C2=pending C3=pending C4=cancelled C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 25 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R8** C1=pending C2=pending C3=pending C4=cancelled C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 25 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R9** C1=cancelled C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R11** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending +override:PRB/2 +ticket:PR1/8 · aucun nouveau lot · lot PRB pending · PR1 dû 41 payé 0, PR2 dû 8 payé 0, PRB dû 9 payé 0, PRA dû 6 payé 0
- **R12** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB approved · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R13** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB supprimé · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **R14** C1=pending C2=pending C3=pending C4=pending C5=paid C6=paid C7=pending · aucun nouveau lot · lot PRB paid · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 0 payé 7, PRA dû 6 payé 0
- **R10** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0
- **O1** C1=pending C2=pending C3=pending C4=pending C5=paid C7=pending · aucun nouveau lot · lot PRB supprimé · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRA dû 6 payé 0
- **O2** C1=pending C2=pending C3=pending C4=pending C5=paid C6=pending C7=pending · aucun nouveau lot · lot PRB pending · PR1 dû 33 payé 0, PR2 dû 8 payé 0, PRB dû 7 payé 0, PRA dû 6 payé 0

Pièces de la prod que le banc n'a pas posées : contrainte promoters.promoters_agency_rule_template_id_fkey (relation "agency_rule_templates" does not exist).
