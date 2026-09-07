# SMS marketing — architecture et mise en service

Dernière revue : 2026-09-07. Système livré côté code, base et edge functions ;
**verrouillé « Bientôt disponible » côté interface** tant que le numéro
d'envoi n'est pas en place (`SMS_MARKETING_LIVE` dans `src/lib/smsMarketing.ts`).

## Ce que fait le système

Une seule implémentation pour le **club** (`/owner/sms`, `/owner/sms-campaigns`)
et l'**organisateur sans club** (`/organizer-app/sms`) : composant partagé
`src/components/sms/SmsCampaignsPanel.tsx`, portée injectée
(`{kind:'venue'}` / `{kind:'organizer'}`).

| Brique | Où | Rôle |
|---|---|---|
| Contacts | `venue_sms_contacts` (venue_id **ou** organizer_user_id) | Liste consentante, alimentée par `_shared/sms-consent.ts` à chaque paiement coché « Offres par SMS ». Jamais d'import. |
| Campagnes | `sms_campaigns` | Statuts `draft → scheduled/sending → paused → sent/failed/cancelled`. Colonnes de stats (`sent/delivered/undelivered/failed_count`, crédits, `tracked_link_id`). |
| File d'envoi | `sms_campaign_recipients` | Une ligne par numéro. `claim_sms_campaign_recipients` (FOR UPDATE SKIP LOCKED), marquage en lot, reprise des claims morts. |
| Worker | `send-sms-campaign` | Modes `send` / `drain` / `resume` / `test`. Tranches de 40 s auto-chaînées ; cron `process-scheduled-campaigns` (5 min) = filet + campagnes planifiées. |
| Livraison | `sms-twilio-status-webhook` → RPC `apply_sms_delivery_status` | Log + file + compteurs + remboursement du crédit, atomique et idempotent. |
| STOP | `sms-inbound-webhook` → `sms_stop_unsubscribe` | Retire le numéro de **toutes** les listes (clubs et organisateurs). |
| Crédits | `sms_packs`, `sms_credit_balances`, `sms-purchase-checkout` (+ `return_path`), `sms-purchase-verify` | 1 crédit = 1 segment SMS. Achat depuis n'importe quelle page via `SmsCreditsDialog`. |
| Rapport | RPC `get_sms_campaign_report` | Livraison, clics sur le lien suivi `sms` (`ensure_sms_tracked_link`), billets/tables attribués, crédits nets, timeline par heure. |

### Règles non négociables (côté serveur, jamais retirables par le pro)

- **Nom d'expéditeur en tête + mention STOP en pied** de chaque message
  (`_shared/sms-text.ts` ⇄ miroir `src/lib/smsMarketing.ts`, **à modifier
  ensemble** : l'éditeur annonce le coût que le worker débite).
- **Crédits = segments réels** : GSM-7 160/153, UCS-2 70/67. Un emoji fait
  basculer tout le message en UCS-2 ; l'éditeur le montre en direct.
- **Solde vérifié pour toute la campagne avant le premier envoi**. Solde
  épuisé en route (deux campagnes en parallèle) ⇒ `paused` / `credits`, reprise
  après rechargement là où ça s'était arrêté.
- **Heures calmes par défaut** : rien ne part 20 h → 8 h Europe/Paris ni le
  dimanche (déontologie AFMM du SMS commercial). Opt-out par campagne
  (`quiet_hours`), le cron reprend au créneau suivant.
- **Audience résolue à l'envoi** : consentement < 36 mois, non désinscrit,
  numéro E.164. Segment `not_event` = contacts sans billet ni table pour la
  soirée (jamais ceux qui ont payé).
- Envoi de masse **refusé en session d'assistance** (`isSupportSessionToken`) ;
  le test à son propre téléphone reste ouvert.

## Mise en service — ce que Paul doit faire

1. **Acheter le numéro d'envoi** dans Twilio (Phone Numbers → Buy). Pour la
   France, préférer un numéro **long français (+33) avec SMS activé**, ou mieux
   un **Messaging Service** (pool de numéros + expéditeur alphanumérique
   « YUNO » là où c'est permis). Un STOP en réponse n'est possible qu'avec un
   numéro (pas avec un alphanumérique seul) : garder au moins un numéro.
2. **Secrets Supabase** (Dashboard → Edge Functions → Secrets, ou CLI) :
   - `TWILIO_PHONE_NUMBER` = le numéro au format E.164 (`+33…`) — **ou**
     `TWILIO_MESSAGING_SERVICE_SID` (`MG…`) si Messaging Service (prioritaire).
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` existent déjà : vérifier que
     c'est le compte payant (pas le trial : erreur 21608 « unverified number »).
   - Optionnel : `TWILIO_STATUS_CALLBACK_URL` si Twilio est configuré pour
     appeler une autre URL que celle par défaut (validation de signature).
3. **Webhooks Twilio** sur le numéro (ou le Messaging Service) :
   - « A MESSAGE COMES IN » → `POST https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/sms-inbound-webhook`
   - Le status callback est passé **par message** par le worker
     (`…/functions/v1/sms-twilio-status-webhook`), rien à saisir.
4. **Geo-permissions Twilio** : autoriser FR, ES, BE, CH, et les pays des
   clients (Messaging → Settings → Geo permissions), sinon erreur 21408.
5. **Test réel** : `/organizer-app/sms` (ou `/owner/sms-campaigns`) →
   Nouvelle campagne → « M'envoyer un test » (consomme des crédits réels ; le
   compte démo `@womber.fr` obtient les crédits gratuitement via
   `sms-purchase-checkout`).
6. **Ouvrir** : passer `SMS_MARKETING_LIVE` à `true` dans
   `src/lib/smsMarketing.ts`, build, push (Cloudflare) puis `npm run ota:beta`
   → `ota:promote` pour l'app Pro. Mettre à jour les textes « bientôt » de
   l'aide si besoin (`ohelp.pg.sms.*`, `ohelp.org.sms.*` ne mentionnent déjà
   plus « bientôt »).

### Diagnostic rapide

| Symptôme | Cause probable |
|---|---|
| `SMS_NOT_CONFIGURED` (503) à l'envoi | Aucun de `TWILIO_PHONE_NUMBER` / `TWILIO_MESSAGING_SERVICE_SID` posé. |
| Campagne `paused` / `send_error` avec code 21608 / 21606 / 20003 | Compte trial, `From` invalide, identifiants faux. Corriger le secret puis « Reprendre ». |
| Livraisons qui restent « Remis à l'opérateur » | Le status callback n'arrive pas : signature refusée (`TWILIO_STATUS_CALLBACK_URL`) ou URL non joignable. Voir les logs de `sms-twilio-status-webhook`. |
| Un STOP ne désinscrit pas | Webhook entrant non configuré sur le numéro, ou signature refusée. |
| Clics à 0 | La campagne n'a pas de soirée liée, ou le message ne contient pas `{lien}`. |
