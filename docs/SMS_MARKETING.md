# SMS marketing — architecture et mise en service

Dernière revue : 2026-10-08.

- **Fournisseur : Octopush.** Il remplace Twilio, jamais branché. Le choix et
  les règles françaises sont dans `docs/designs/SMS_PROVIDER_PLAN.md`.
- **Console CRM : SMS ouvert** (`CRM_SMS_DISPLAY_LIVE`, `src/crm/lib/sms.ts`).
- **Suite (Billetterie) : SMS encore verrouillé** (`SMS_MARKETING_LIVE = false`,
  `src/lib/smsMarketing.ts`). Le moteur est le même ; ouvrir la Suite est une
  décision de Paul.

## Ce que fait le système

| Brique | Où | Rôle |
|---|---|---|
| Contacts | `venue_sms_contacts` (club, organisateur ou plateforme) ; Console CRM : la base `_cp`, filtrée par `phone_ok` | Seuls les contacts qui ont donné leur accord. L'accord vient d'un paiement coché « Offres par SMS » (`_shared/sms-consent.ts`) ou d'un fichier importé avec son attestation. |
| Liste STOP | `sms_stop_list` | Mémoire globale des STOP, à l'image de la liste noire Octopush, qui vaut pour tout le compte. Jamais vidée. Un numéro qui y figure n'est plus jamais mis en file. |
| Campagnes | `sms_campaigns` | Suite : `segment_filters.type`. Console CRM : `type = 'crm'` et `audiences`. Statuts `draft → scheduled/sending → paused → sent/failed`. |
| File d'envoi | `sms_campaign_recipients` | Une ligne par numéro. `claim_sms_campaign_recipients` réserve sans doublon (SKIP LOCKED). `provider_request_id` est posé avant l'appel et `first_name` sert à `{{prénom}}`. |
| Mise en file | `enqueue_sms_campaign_recipients` | Une seule porte. Console CRM → `_enqueue_crm_sms_recipients`, avec la même règle que l'aperçu (`crm_sms_audience_preview`) : exclusions et plafond par semaine. Suite → `resolve_sms_campaign_recipients`. Les deux écartent la liste STOP. |
| Worker | `send-sms-campaign` | Modes `send`, `drain`, `resume` et `test`. Il travaille par tranches de 40 s, enchaînées seules. Le cron `process-scheduled-campaigns` sert de filet et lance les campagnes programmées. |
| Fournisseur | `_shared/sms-octopush.ts` | Un appel envoie le même texte à un lot de numéros, dans un ordre fixe. Le module classe les erreurs, lit les statuts et les webhooks. |
| Texte | `_shared/sms-text.ts`, source unique ré-exportée par le front | Nom en tête, `{{variables}}`, « STOP au 30101 » vers la France, segments, nom d'expéditeur, heures d'envoi. |
| Webhooks | `sms-inbound-webhook?k=dlr\|stop\|inbound&t=<jeton>` | Accusés → `apply_sms_delivery_status`, retrouvé par (ticket, numéro). STOP et réponse « STOP » → `sms_stop_unsubscribe`. |
| Portefeuilles | Suite : `sms_credit_balances` (packs) ; Console CRM : Yunits (`crm_yunits_debit`, 35 par SMS, `crm_sms_rate()`) ; plateforme : aucun | Débit avant l'appel. Remboursement sur refus du fournisseur (`refund_sms_log_batch`) ou sur `failed`. Jamais sur `undelivered`, qui a été facturé. |
| Identité | `get_sms_sender_readiness`, `set_sms_sender_identity` | Raison sociale + SIRET / RNA / TVA, exigées par la charte AF2M avant tout envoi, test compris. |

## Règles non négociables (serveur, jamais retirables par le pro)

- **Nom d'expéditeur** : 3 à 11 lettres ou chiffres, au moins une lettre, pas
  de mot générique (`senderIdError`). Jamais un numéro 06/07.
- **Nom de l'annonceur en tête** du message, puis **« STOP au 30101 »** pour un
  numéro français, ou le libellé de la langue ailleurs.
- **Crédits = segments réels** : GSM-7 compte 160 / 153 caractères, UCS-2 70 /
  67. Un emoji fait passer tout le message en UCS-2.
- **Heures d'envoi** :
  - rien ne part de 21 h 30 à 8 h (Paris), quels que soient les réglages ;
  - heures calmes, dimanche et jours fériés selon les réglages (Suite : 20 h →
    8 h et dimanche ; CRM : `crm_sms_settings`) ;
  - le cron reprend au créneau suivant.
- **Solde vérifié pour toute la campagne avant le premier envoi.** S'il
  s'épuise en route, la campagne passe en `paused` / `credits`, puis repart
  après rechargement.
- **Envoi de masse refusé en session d'assistance.** Le test reste possible.
- **Compte démo** : rien ne part (`demo_no_send`).

## Mise en service — ce que Paul doit faire

1. **Créer le compte Octopush** (client.octopush.com) : vérification d'identité
   de Yuno, offre **Basique** (9 € / mois, 0,045 € par SMS), puis des crédits.
   Plus de ~1 600 SMS par mois : passer à Essentiel.
2. **Récupérer la clé API** (Octopush → API) et le login (l'e-mail du compte).
3. **Poser les secrets** dans `.env.local` (pour le script) **et** dans
   Supabase :
   ```bash
   supabase secrets set OCTOPUSH_API_KEY=… OCTOPUSH_API_LOGIN=… OCTOPUSH_WEBHOOK_TOKEN=…
   ```
   Le script ci-dessous propose un jeton s'il n'y en a pas.
   `OCTOPUSH_SIMULATION=1` fait tout jouer sans rien envoyer.
4. **Brancher** :
   ```bash
   node scripts/sms/octopush-setup.mjs
   ```
   Le script lit le solde, pose les trois webhooks en JSON et fait un envoi
   simulé. À défaut, poser les webhooks à la main dans le back-office
   (Callbacks, JSON) :
   - livraisons → `…/functions/v1/sms-inbound-webhook?k=dlr&t=<jeton>`
   - numéros en liste noire → `…?k=stop&t=<jeton>`
   - réponses → `…?k=inbound&t=<jeton>`
5. **Premier vrai SMS** : Console CRM → SMS → un brouillon → « Recevoir un
   test » (gratuit, au numéro de test des Réglages). Le compte doit avoir
   renseigné son identité (SMS → Réglages → « Qui envoie ? »).

### Diagnostic rapide

| Symptôme | Cause probable |
|---|---|
| « Le service d'envoi des SMS est en cours d'activation » (`SMS_NOT_CONFIGURED`) | Secrets `OCTOPUSH_API_KEY` / `OCTOPUSH_API_LOGIN` absents. |
| Campagne `paused` / `send_error` | 113 : compte Octopush pas encore validé. 106 : nom d'expéditeur refusé. 121 : mention STOP. 104 : plus de crédit Octopush. Le motif est sur la page de résultats. |
| Statuts qui restent « envoyé » | Webhook des livraisons absent, ou jeton faux (403 dans les logs de `sms-inbound-webhook`). |
| Un STOP ne désinscrit pas | Webhook « liste noire » absent, ou jeton faux. |
| Clics à 0 | Le SMS n'a pas de soirée liée, ou le texte ne contient pas `{{lien}}`. |
