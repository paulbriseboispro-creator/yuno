# SEC-07 — ce qu'un promoteur écrit dans sa fiche, au banc (2026-10-18T22:32Z)

Définitions, policies, triggers, contraintes et droits lus sur la prod le 2026-10-18T22:32Z (`node scripts/crm-bench/sec06.mjs dump`, lecture seule) ; chaque scénario tourne dans une transaction annulée, sous l'identité de l'API (`authenticator` → `authenticated` / `service_role`, claims JWT). Quatre bases neuves, mêmes données : la prod du 18/10 ; + `20261024100000_promoter_settlement_guards.sql` ; + `20261025200000_promoter_self_update_guard.sql` seule ; + les deux, dans l'ordre de la mise en ligne.

Garde de colonnes : Avant (prod) → aucun garde de colonnes ; SEC-06 seul → aucun garde de colonnes ; SEC-07 seul → guard_promoter_self_update INVOKER ; SEC-06 + SEC-07 → guard_promoter_self_update INVOKER.

**35 / 35 scénarios conformes à l'attendu dans les quatre phases.**

Smoke de répétition sur la prod (`scripts/crm-bench/smoke/sec07.sql`), joué au banc : SEC-07 seul ✓ `SMOKE_OK {"iban": "modifié, gel posé", "profil": "modifié", "gel_antidaté": "refusé", "commission_par_le_promoteur": "refusée", "commission_par_le_gestionnaire": "modifiée"}` ; SEC-06 + SEC-07 ✓ `SMOKE_OK {"iban": "modifié, gel posé", "profil": "modifié", "gel_antidaté": "refusé", "commission_par_le_promoteur": "refusée", "commission_par_le_gestionnaire": "modifiée"}`.

| | Scénario | Avant (prod) | SEC-06 seul | SEC-07 seul | SEC-06 + SEC-07 |
|---|---|---|---|---|---|
| P1 | Promoteur : sa commission de billet relevée à 99 (O2 de sec06.mjs) | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: ticket_commission_value | refusé : promoter_self_update_forbidden: ticket_commission_value |
| P2 | Promoteur : sa commission de table passée à 50 % | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: table_commission_value | refusé : promoter_self_update_forbidden: table_commission_value |
| P3 | Promoteur : remise client de 100 % sur les billets et l’acompte de table (payée par le club) | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: table_discount_value, ticket_discount_value | refusé : promoter_self_update_forbidden: table_discount_value, ticket_discount_value |
| P4 | Promoteur : s’ouvre le scan de la porte | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: can_scan_entries | refusé : promoter_self_update_forbidden: can_scan_entries |
| P5 | Promoteur désactivé par son club : se réactive | ok(1) | ok(1) | refusé (appel 2) : promoter_self_update_forbidden: is_active | refusé (appel 2) : promoter_self_update_forbidden: is_active |
| P6 | Promoteur : se rattache à un autre club | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: venue_id | refusé : promoter_self_update_forbidden: venue_id |
| P7 | Promoteur d’agence : quitte son agence (agency_id vidé) | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: agency_id | refusé : promoter_self_update_forbidden: agency_id |
| P8 | Promoteur : réécrit son dû et son payé | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: pending_amount | refusé : promoter_self_update_forbidden: pending_amount |
| P9 | Promoteur : quitte son équipe (le chef perd sa part) | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: team_id | refusé : promoter_self_update_forbidden: team_id |
| P10 | Promoteur d’organisateur : commission relevée (policy « own organizer profile ») | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: ticket_commission_value | refusé : promoter_self_update_forbidden: ticket_commission_value |
| P11 | Promoteur : glisse une commission relevée dans le formulaire de profil | ok(1) | ok(1) | refusé : promoter_self_update_forbidden: ticket_commission_value | refusé : promoter_self_update_forbidden: ticket_commission_value |
| F1 | Gel IBAN : nouvel IBAN, puis iban_changed_at antidaté | ok(1) | ok(1) | refusé (appel 2) : promoter_self_update_forbidden: iban_changed_at | refusé (appel 2) : promoter_self_update_forbidden: iban_changed_at |
| F2 | Gel IBAN : nouvel IBAN, antidaté, puis le club prépare le règlement — *SEC-06 seul : le lot part vers l’IBAN de la veille sans attendre 24 h* | refusé (appel 3) : payout_direct_write_forbidden | ok | refusé (appel 2) : promoter_self_update_forbidden: iban_changed_at | refusé (appel 2) : promoter_self_update_forbidden: iban_changed_at |
| F3 | Gel IBAN tient : nouvel IBAN, puis le club prépare le règlement | refusé (appel 2) : iban_recently_changed | refusé (appel 2) : iban_recently_changed | refusé (appel 2) : iban_recently_changed | refusé (appel 2) : iban_recently_changed |
| A1 | Promoteur : change son IBAN et son BIC (dialogue IBAN) | ok(1) | ok(1) | ok(1) | ok(1) |
| A2 | Promoteur : profil (Instagram, WhatsApp, code promo régénéré) | ok(1) | ok(1) | ok(1) | ok(1) |
| A3 | Promoteur : photo de profil | ok(1) | ok(1) | ok(1) | ok(1) |
| A4 | Promoteur : formulaire de profil sur toutes ses fiches (.eq user_id) | ok(2) | ok(2) | ok(2) | ok(2) |
| A5 | Promoteur : prénom, nom, téléphone | ok(1) | ok(1) | ok(1) | ok(1) |
| A6 | Promoteur : réécrit une colonne verrouillée à l’identique | ok(1) | ok(1) | ok(1) | ok(1) |
| A7 | Promoteur d’organisateur : change son IBAN | ok(1) | ok(1) | ok(1) | ok(1) |
| A8 | Promoteur : le code promo d’un autre reste refusé (trigger existant) | refusé : Promo code ZOEM is already taken by another promoter | refusé : Promo code ZOEM is already taken by another promoter | refusé : Promo code ZOEM is already taken by another promoter | refusé : Promo code ZOEM is already taken by another promoter |
| M1 | Owner : relève la commission de son promoteur | ok(1) | ok(1) | ok(1) | ok(1) |
| M2 | Manager « promoteurs » : remise client et commission | ok(1) | ok(1) | ok(1) | ok(1) |
| M3 | Owner : sort un promoteur de son équipe (OwnerPromoterTeams) | ok(1) | ok(1) | ok(1) | ok(1) |
| M4 | Organisateur : commission de son promoteur | ok(1) | ok(1) | ok(1) | ok(1) |
| M5 | Admin promoteurs de l’organisateur (équipe) : désactive le promoteur | ok(1) | ok(1) | ok(1) | ok(1) |
| M6 | Chef d’agence : commission et plafond de son promoteur | ok(1) | ok(1) | ok(1) | ok(1) |
| M7 | Super admin : désactive un promoteur | ok(1) | ok(1) | ok(1) | ok(1) |
| M8 | Owner qui est aussi son propre promoteur : sa commission | ok(1) | ok(1) | ok(1) | ok(1) |
| M9 | Owner de l’autre club : la fiche que P a chez lui | ok(1) | ok(1) | ok(1) | ok(1) |
| M10 | Owner d’un autre club : la fiche de son voisin (RLS, témoin) | ok(0) | ok(0) | ok(0) | ok(0) |
| S1 | Porte (service_role, comme le trigger de porte) : record_promoter_conversion met à jour le dû | ok | ok | ok | ok |
| S2 | Fonction edge en service_role : commission | ok(1) | ok(1) | ok(1) | ok(1) |
| S3 | Équipe supprimée : la cascade vide team_id du promoteur | ok(1) | ok(1) | ok(1) | ok(1) |

## État après chaque scénario (avant / SEC-06 + SEC-07)

Fiches : PR1 (P au club, équipe du club, billet 10 € fixe, table 5 %, dû 33 €, IBAN changé il y a 3 jours) ; PR1b (P dans un autre club) ; PR2 (P2, organisateur) ; PRA (PA, agence, placé au club) ; PROP (un owner, promoteur de son propre club). Une commission de 10 € en attente pour PR1.

- **P1** avant : PR1{ticket_commission_value=99} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P2** avant : PR1{table_commission_value=50} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P3** avant : PR1{table_discount_value=100, ticket_discount_value=100} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P4** avant : PR1{can_scan_entries=true} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P5** avant : aucune fiche modifiée · aucun lot — après : aucune fiche modifiée · aucun lot
- **P6** avant : PR1{venue_id=bench-own} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P7** avant : PRA{agency_id=null} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P8** avant : PR1{pending_amount=1000} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P9** avant : PR1{team_id=null} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P10** avant : PR2{ticket_commission_value=99} · aucun lot — après : aucune fiche modifiée · aucun lot
- **P11** avant : PR1{instagram_url=https://instagram.com/paulb, ticket_commission_value=99} · aucun lot — après : aucune fiche modifiée · aucun lot
- **F1** avant : PR1{iban=FR7611111000012222233333444, gel IBAN levé} · aucun lot — après : aucune fiche modifiée · aucun lot
- **F2** avant : aucune fiche modifiée · aucun lot — après : aucune fiche modifiée · aucun lot
- **F3** avant : aucune fiche modifiée · aucun lot — après : aucune fiche modifiée · aucun lot
- **A1** avant : PR1{bic=BNPAFRPP, iban=FR7611111000012222233333444, gel IBAN actif} · aucun lot — après : PR1{bic=BNPAFRPP, iban=FR7611111000012222233333444, gel IBAN actif} · aucun lot
- **A2** avant : PR1{instagram_url=https://instagram.com/paulb, promo_code=PAULB2, whatsapp_number=+33 6 12 34 56 78} · aucun lot — après : PR1{instagram_url=https://instagram.com/paulb, promo_code=PAULB2, whatsapp_number=+33 6 12 34 56 78} · aucun lot
- **A3** avant : PR1{profile_image_url=https://bench.test/p.jpg} · aucun lot — après : PR1{profile_image_url=https://bench.test/p.jpg} · aucun lot
- **A4** avant : PR1{instagram_url=https://instagram.com/paulb} PR1b{instagram_url=https://instagram.com/paulb} · aucun lot — après : PR1{instagram_url=https://instagram.com/paulb} PR1b{instagram_url=https://instagram.com/paulb} · aucun lot
- **A5** avant : PR1{first_name=Paul, last_name=B., phone=+33 6 00 00 00 00} · aucun lot — après : PR1{first_name=Paul, last_name=B., phone=+33 6 00 00 00 00} · aucun lot
- **A6** avant : aucune fiche modifiée · aucun lot — après : aucune fiche modifiée · aucun lot
- **A7** avant : PR2{iban=FR7611111000012222233333444, gel IBAN actif} · aucun lot — après : PR2{iban=FR7611111000012222233333444, gel IBAN actif} · aucun lot
- **A8** avant : aucune fiche modifiée · aucun lot — après : aucune fiche modifiée · aucun lot
- **M1** avant : PR1{ticket_commission_value=12} · aucun lot — après : PR1{ticket_commission_value=12} · aucun lot
- **M2** avant : PR1{ticket_commission_value=11, ticket_discount_value=10} · aucun lot — après : PR1{ticket_commission_value=11, ticket_discount_value=10} · aucun lot
- **M3** avant : PR1{team_id=null} · aucun lot — après : PR1{team_id=null} · aucun lot
- **M4** avant : PR2{ticket_commission_value=15} · aucun lot — après : PR2{ticket_commission_value=15} · aucun lot
- **M5** avant : PR2{is_active=false} · aucun lot — après : PR2{is_active=false} · aucun lot
- **M6** avant : PRA{agency_ticket_cap=5, ticket_commission_value=7} · aucun lot — après : PRA{agency_ticket_cap=5, ticket_commission_value=7} · aucun lot
- **M7** avant : PR1{is_active=false} · aucun lot — après : PR1{is_active=false} · aucun lot
- **M8** avant : PROP{ticket_commission_value=20} · aucun lot — après : PROP{ticket_commission_value=20} · aucun lot
- **M9** avant : PR1b{ticket_commission_value=9} · aucun lot — après : PR1b{ticket_commission_value=9} · aucun lot
- **M10** avant : aucune fiche modifiée · aucun lot — après : aucune fiche modifiée · aucun lot
- **S1** avant : PR1{pending_amount=43} · aucun lot — après : PR1{pending_amount=43} · aucun lot
- **S2** avant : PR1{ticket_commission_value=3} · aucun lot — après : PR1{ticket_commission_value=3} · aucun lot
- **S3** avant : PR1{team_id=null} · aucun lot — après : PR1{team_id=null} · aucun lot

Pièces de la prod que le banc n'a pas posées : contrainte promoters.promoters_agency_rule_template_id_fkey (relation "agency_rule_templates" does not exist).
