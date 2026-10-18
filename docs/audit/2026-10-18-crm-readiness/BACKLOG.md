# Backlog après l'audit du 18/10/2026

Effort : équipe humaine / Claude Code (table de CLAUDE.md). Les identifiants
renvoient au [rapport](REPORT.md).

## Avant le premier client (bloquant)

| # | Quoi | Qui | Effort |
|---|---|---|---|
| 1 | Fusionner `crm/s11-practical-email`, puis rebaser et fusionner `crm/readiness-audit` (OPS-05) | Paul (« go ») | — |
| 2 | Appliquer les 3 migrations (répétition annulée, application, `db lint`) : SEC-01 en premier | Paul (« go ») | 1 h / 15 min |
| 3 | Déployer les 6 fonctions edge depuis main à jour, puis le front | Paul (« go ») | 30 min / 10 min |
| 4 | Contrôles après mise en ligne (RUNBOOK §5) | session suivante | 30 min / 10 min |
| 5 | DATA-02 : décider si une entrée gratuite non scannée compte comme une soirée faite sur une porte mesurée ; puis migration + banc | Paul, puis session | 1 j / 45 min |
| 6 | Rapprochement affiché ↔ Smartboard sur 2-3 soirées avec le client (RUNBOOK §1.8) | Paul + client | 30 min |

## Juste après (P2)

| # | Quoi | Effort |
|---|---|---|
| 7 | UI-04 : `CrmLoadError` sur Soirées, E-mails, Campagnes, tiroir client, liste Clients (passer `error`), étape Audience | 1 j / 30 min |
| 8 | MAIL-03 : clé d'idempotence stable par lot (gardée sur les lignes à la réclamation), réessai de l'écriture « envoyé » ; test d'injection d'échec | 2 j / 1 h |
| 9 | MAIL-09 : clé de filtre inconnue = faux dans `_crm_filter_sql` (inventaire des clés, banc sur les segments existants) | 1 j / 45 min |
| 10 | MAIL-08 : limiter les e-mails de test (20 / jour / espace, adresses de l'équipe) | ½ j / 20 min |
| 11 | SMS-01 : « Bientôt » sur le SMS tant qu'Octopush n'est pas branché | 2 h / 10 min |
| 12 | DATA-03 : dépense de `contact_scope_customers` sur `_crm_ticket_is_sale` ; FAQ `yc.faq.sales.a` | ½ j / 20 min |
| 13 | DATA-05 : allumer « co-organisées » remet le curseur à zéro ; l'éteindre retire ce qui en venait | 1 j / 30 min |
| 14 | DATA-01 : effacement pour conservation non défait par un réimport (décision : repoussoir ou marque par billet) | ½ j / 30 min |
| 15 | OPS-02 : restauration d'essai dans un projet isolé, chronométrée ; décider du PITR | ½ j |
| 16 | OPS-03 / OPS-04 : rejeu des migrations sur un projet de branche ; migration de référence des fonctions réécrites par bloc `DO` | 1 j / 45 min |
| 17 | MAIL-04 : test automatique de la course « déprogrammée pendant le passage du cron » (aujourd'hui relecture seulement) | ½ j / 20 min |
| 18 | Étendre `isolation.mjs` à un couple d'espaces CLUB (les fonctions de club n'ont été jouées qu'avec un espace organisateur) | ½ j / 20 min |

## Plus tard (P3)

- SYNC-03 : ignorer une version plus ancienne d'un billet (trigger) ; `ticketing_connect` respecte un verrou vivant.
- SEC-04 : révoquer les fonctions d'aide que le front n'appelle pas (`crm_org_role`, `crm_user_in_scope` direct, plafonds).
- SEC-05 : neutraliser `= + - @` en tête de cellule dans les exports CSV.
- MAIL-07 : `email_campaigns.product` écrit par le serveur seulement.
- MAIL-10 : webhook Resend refusé sans secret ; comparaison en temps constant.
- MAIL-11 : distinguer « acceptés » et « délivrés » dans les rapports.
- MAIL-12 : `isDemoMarketingScope` fermé sur erreur.
- MAIL-13 : quotas journaliers à minuit Paris.
- MAIL-14 : vérifier qu'un `eventId` de bloc d'e-mail appartient à l'espace (aperçu et envoi).
- MAIL-15 : adresse d'expédition qui ne dépend pas que du nom du compte.
- DATA-04 : devise non EUR refusée ou marquée.
- DATA-06 : « détenteurs » plutôt qu'« acheteurs » dans l'aide.
- DATA-07 : une adresse mal formée renvoyée par Shotgun ne doit pas valoir effacement.
- UI-05 : porte légale (échec d'enregistrement, focus), puce « Testez-le » d'Imports qui ajoute un faux contact, clés de cache après suppression, Yunits réservés dans le contrôle d'envoi, erreurs de facturation.
- Connexion : mauvais ID organisateur avec un jeton valide → « ID inconnu » plutôt que « jeton non reconnu ».
- `npm audit` ciblé sur les dépendances exposées au navigateur, sans mise à jour majeure aveugle.
