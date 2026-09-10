# Envoi de masse & délivrabilité

Source de vérité pour tout ce qui concerne les campagnes email à grand volume.
Dernière revue : 2026-08-29.

---

## Ce que le système garantit (et ce qu'il ne garantit pas)

**Il garantit** qu'un envoi de 5 000 emails part en entier, sans doublon, sans
bloquer une edge function, et qu'il s'arrête tout seul si la réputation dérape.

**Il ne garantit pas** qu'une liste achetée ou vieille de cinq ans arrive en
boîte de réception. Aucun système au monde ne le garantit. Le warm-up et le
disjoncteur limitent les dégâts, ils ne réparent pas une mauvaise liste.

---

## 0. Le plan Resend est le vrai plafond

| Plan | Par mois | Par jour | Domaines | Prix |
|---|---|---|---|---|
| **Free (actuel)** | 3 000 | **100** | 3 | 0 $ |
| Pro | 50 000 | illimité | 10 | 20 $/mois |
| Pro (palier haut) | 100 000 | illimité | 10 | 35 $/mois |
| Scale | 100 000 à 2,5 M | illimité | 1 000 | 90 $+/mois |

Ce quota est **partagé avec tout le transactionnel** : billets, invitations,
MFA, remboursements, alertes staff. Une campagne qui mange les 3 000 du mois
coupe les confirmations de billets jusqu'au 1er du mois suivant.

C'est pour ça que le plafond plateforme est semé à **90/jour** dans
`20260829150100`. Le gouverneur ne doit jamais laisser Yuno dépasser ce que le
fournisseur accepte : au-delà, Resend renvoie des 429 en rafale, les
destinataires épuisent leurs 3 tentatives et finissent en `failed`. Dépasser le
plan ne ralentit pas l'envoi, il **perd des gens**.

**Après un passage en Pro, cette requête est obligatoire** (sinon tout reste
bridé à 90/jour) :

```sql
UPDATE public.email_sender_state
   SET daily_cap_override = 25000, updated_at = now()
 WHERE scope_key = 'platform';
```

Ordre de grandeur : 5 000 emails = 3 jours de rampe en Pro (300 + 600 + 1 200 +
2 500 le 4e jour), contre **50 jours** en Free.

---

## 1. DNS — à faire AVANT toute campagne de masse

État constaté le 2026-08-29 sur `yunoapp.eu` :

| Élément | État | Action |
|---|---|---|
| DKIM `resend._domainkey.yunoapp.eu` | présent, valide | rien |
| **SPF** | **absent partout** | **à poser (ci-dessous)** |
| DMARC `_dmarc.yunoapp.eu` | `v=DMARC1; p=none;` | ajouter `rua=` |
| Return-path `send.yunoapp.eu` | MX Amazon SES posé, SPF manquant | **compléter** |
| MX racine | IONOS (réception) | rien |

### 1.1 Le SPF manquant (10 minutes, gratuit, à faire en premier)

Resend route les rebonds par `send.yunoapp.eu` (le MX Amazon SES est déjà là),
mais l'enregistrement SPF qui doit l'accompagner n'a jamais été posé. Sans lui,
l'alignement SPF échoue et les filtres stricts (Outlook, Hotmail, messageries
d'entreprise) montent le score de spam. Chez IONOS, zone `yunoapp.eu` :

```
Type   Nom      Valeur
TXT    send     v=spf1 include:amazonses.com ~all
```

Si des emails partent aussi depuis une boîte IONOS (`contact@yunoapp.eu`),
poser en plus un SPF à la racine qui inclut **et** SES **et** IONOS. Prendre la
valeur `include:` exacte d'IONOS dans leur panneau (elle varie selon le contrat) :

```
Type   Nom   Valeur
TXT    @     v=spf1 include:amazonses.com include:<VALEUR_IONOS> ~all
```

> Un seul enregistrement SPF par nom. Deux TXT `v=spf1` sur le même nom = SPF
> invalide, pire que pas de SPF du tout.

### 1.2 DMARC avec rapports

```
Type   Nom      Valeur
TXT    _dmarc   v=DMARC1; p=none; rua=mailto:dmarc@yunoapp.eu; fo=1;
```

La boîte `dmarc@yunoapp.eu` doit exister côté IONOS. `p=none` reste correct
pour démarrer (c'est le minimum exigé par Gmail et Yahoo depuis 2024) ; passer
à `p=quarantine` seulement après quelques semaines de rapports propres.

### 1.3 Le sous-domaine marketing (la vraie protection)

**C'est le point le plus important du document.** Aujourd'hui les campagnes et
les confirmations de billets partent du même domaine. Si un club chauffe une
liste froide et se prend des plaintes, ce sont les confirmations de billets de
**tous** les clubs qui tombent en spam.

1. Dans Resend → Domains → Add domain : `news.yunoapp.eu`.
   (Faisable dès le plan gratuit : 3 domaines inclus.)
2. Poser chez IONOS les 3 enregistrements donnés par Resend (DKIM, SPF du
   return-path, MX du return-path). **Les copier depuis le dashboard**, ne pas
   les deviner.
3. Attendre le statut « Verified » dans Resend.
4. **Seulement ensuite**, poser le secret Supabase :
   ```bash
   supabase secrets set EMAIL_MARKETING_DOMAIN=news.yunoapp.eu
   ```

Tant que ce secret n'est pas posé, les campagnes continuent de partir depuis
`yunoapp.eu` : le code retombe volontairement sur `EMAIL_DOMAIN`
(`_shared/email-sender-identity.ts`). **Poser le secret avant la vérification
Resend ferait échouer 100 % des envois** — la bascule DNS et le déploiement du
code sont décorrélés exprès.

---

## 2. Architecture de l'envoi

```
   [ Pro clique « Envoyer » ]
              │
              ▼
   send-campaign  (mode 'send')
     ├─ enqueue_campaign_recipients()   ← audience résolue, suppressions retirées
     └─ drainSlice()  ─────────────┐
                                   │  ~45 s de travail par invocation
   ┌───────────────────────────────┘
   │  boucle, par lots de 100 :
   │    1. consume_email_send_quota()   ← plafond expéditeur + plateforme
   │    2. claim_campaign_recipients()  ← FOR UPDATE SKIP LOCKED
   │    3. POST /emails/batch           ← + Idempotency-Key, retry 429/5xx
   │       (adresses non ASCII écartées AVANT ; 422 → bissection du lot)
   │    4. mark_campaign_recipients_*() ← marquage EN LOT
   │    5. campaign_circuit_breaker()   ← toutes les 3 salves
   │    6. pause 600 ms                 ← ~1,6 req/s, sous la limite Resend
   └─ deadline atteinte → auto-chaînage (mode 'drain')

   process-scheduled-campaigns (cron, 1×/min)
     └─ sweepSendingCampaigns()  ← filet : réservations mortes + relance
```

### Une adresse inexpédiable ne bloque jamais un lot (2026-09-10)

Resend refuse tout le lot (422 « non-ASCII characters ») dès qu'une adresse
contient un caractère accentué avant le `@`. Quatre adresses de ce type dans
une liste de 9 600 ont bloqué 99 envois valides à chaque lot et mis la
campagne en pause. Le worker écarte désormais ces adresses AVANT l'envoi
(échec définitif + liste de suppression `invalid` + quota rendu), convertit
un domaine IDN en punycode, et si un 422 passe quand même, coupe le lot en
deux jusqu'à isoler la fautive (`sendBatchIsolating`). Un 422 ne met plus
jamais la campagne en pause ; seuls les refus systémiques (clé, domaine)
le font encore.

### Pourquoi deux garde-fous anti-doublon

| Panne | Ce qui protège |
|---|---|
| Deux workers en parallèle (auto-chaînage + cron) | `FOR UPDATE SKIP LOCKED` — impossible de réserver la même adresse |
| Worker tué APRÈS l'appel Resend, AVANT le marquage | clé d'idempotence Resend, dérivée du contenu du lot |
| Worker tué pendant le lot | `requeue_stale_campaign_claims` (10 min) remet en file |

### Lissage — le plan d'envoi (2026-09-09)

« Lisser le débit » (écran Planification) n'est plus un plafond fixe et
invisible de 1 000/h. Le pro choisit un **cadre** et voit le plan avant
d'appuyer sur Envoyer :

| Cadre | Fenêtre | Ce que fait le worker |
|---|---|---|
| Sur une heure | 15 min | 4 vagues, `ceil(N/4)` par quart d'heure |
| Sur la journée | 60 min | une vague par heure pendant 24 h depuis le départ, `ceil(N/vagues actives)` |
| Sur plusieurs jours (2-7) | 60 min | une vague par heure pendant J × 24 h depuis le départ |

Les fenêtres sont glissantes depuis le départ, jamais calendaires. « Vagues
actives » = créneaux horaires de la fenêtre hors nuit (23 h → 9 h) quand
« Pas d'envoi la nuit » est coché : 17 h 30 sur la journée avec la nuit
coupée = 6 vagues le soir + 9 le lendemain (9 h → 17 h), fin vers 17 h.

Trois colonnes sur `email_campaigns` : `throttle_per_hour` (plafond PAR
FENÊTRE, nom conservé pour la compat), `throttle_window_minutes` (15/30/60)
et `throttle_plan` (le choix d'écran, jamais lu par le worker). Le worker
compte les `sent` de la fenêtre glissante et s'arrête (`stopped: 'throttle'`)
quand le budget est épuisé ; le cron (5 min) relance. `src/lib/email/throttlePlan.ts`
rejoue exactement cette règle, plus la nuit (23 h → 9 h si cochée) et le
plafond du jour de la rampe, pour projeter les vagues à l'écran. La projection
est honnête à la cadence du cron près : la fin affichée peut glisser de
quelques minutes, jamais l'inverse.

Recommandation (`recommendPlan`) : une heure sous 500 contacts, la journée
jusqu'à 2 500 (et sous le plafond du jour), sinon assez de jours pour rester
sous 2 500/jour ET sous le plafond de chauffe. Le pro peut remplacer le
plafond par vague (`throttle_plan.custom = true`) ; la proposition cesse alors
de suivre l'audience.

---

### Relance ciblée après clic (2026-09-10)

Option d'une campagne marketing reliée à une soirée : N heures (1-168, 24 par
défaut) après le PREMIER clic d'un contact sur un lien de la soirée (`/l/…`,
page soirée, billets, guest list ; ni Instagram, ni « Powered by Yuno », ni
désinscription), un second email part depuis un modèle choisi par le pro.

Mécanique : `collect_campaign_followups()` (cron 5 min, service_role) écrit
le registre `email_campaign_followups` — une ligne par (campagne mère,
email), raison d'exclusion posée AU MOMENT OÙ LA RELANCE EST DUE (`bought`,
`guest_list`, `unsubscribed`, `suppressed`, `event_over`, `already_event`),
index unique (soirée, email) sur les lignes en file : une relance par
personne et par soirée, toutes campagnes confondues. Les contacts dus
entrent dans la file d'une campagne ENFANT (`parent_campaign_id`, créée au
premier contact dû depuis le modèle, `event_id` de la mère, `quiet_hours`
de la mère, statut `sending`) que `sweepSendingCampaigns` reprend dans le
même tick. L'enfant se vide et se remplit à chaque vague : le worker ne
notifie pas l'owner pour un enfant, et la RPC le repasse en `sending` à
chaque enqueue. Rapport : `get_campaign_followup_stats` (mère → bilan +
lien enfant ; enfant → lien mère). Ne jamais purger le registre : c'est lui
qui empêche la double relance.

## 3. Warm-up — la rampe

Un expéditeur neuf ne part pas à 5 000. `email_sender_daily_cap()` :

| Jour depuis le 1er envoi | Plafond/jour |
|---|---|
| J0 | 300 |
| J1 | 600 |
| J2 | 1 200 |
| J3 | 2 500 |
| J4 | 5 000 |
| J5 | 10 000 |
| J6+ | 25 000 |

Plus un **plafond plateforme** de 25 000/jour tous expéditeurs confondus, qui
protège `yunoapp.eu` d'un club qui déraperait.

Quand le plafond du jour est atteint, la campagne ne échoue pas : elle s'arrête
et **reprend automatiquement le lendemain** via le cron. C'est le comportement
voulu — la rampe donne le temps aux bounces et aux plaintes de remonter entre
deux tranches, ce qui rend le disjoncteur utile.

**Relever un plafond** (club de confiance, base connue propre) :

```sql
UPDATE email_sender_state
   SET trust_level = 'trusted'          -- 50 000/jour
 WHERE scope_key = 'venue:<id>';

-- ou un plafond sur mesure :
UPDATE email_sender_state SET daily_cap_override = 8000 WHERE scope_key = 'org:<uuid>';

-- couper un expéditeur :
UPDATE email_sender_state
   SET trust_level = 'restricted', restricted_reason = '...' WHERE scope_key = '…';
```

---

## 4. Disjoncteur

`campaign_circuit_breaker()` met la campagne en pause toute seule si, sur un
échantillon d'au moins **200 envois** :

| Signal | Seuil | Pourquoi |
|---|---|---|
| Taux de plaintes | > 0,20 % | Gmail coupe à 0,30 % — on s'arrête avant |
| Taux de bounces durs | > 5 % | Au-delà, la réputation se dégrade à chaque envoi |

Il est appelé à deux endroits : dans la boucle d'envoi (toutes les 3 salves) et
dans `resend-webhook` à chaque bounce/plainte — c'est là qu'il compte vraiment,
puisque les signaux arrivent en différé.

Un lot refusé de façon **non transitoire** (domaine non vérifié, clé invalide,
payload refusé) met aussi la campagne en pause avec `paused_reason='send_error'`
et le message de Resend en clair : inutile d'insister, chaque lot suivant
échouerait pareil.

---

## 5. Liste de suppression

`email_suppressions` est **globale à la plateforme**. Un hard bounce ou une
plainte y entre via `resend-webhook`, même sans tag `campaign_id` (donc y
compris depuis un email transactionnel), et `suppress_email()` coupe en même
temps `newsletter_subscriptions.opted_in`.

**Elle n'est consultée qu'à la constitution d'une audience marketing.** Une
confirmation de billet part toujours, même vers une adresse supprimée : c'est
du courrier de relation, pas de la prospection.

Un bounce **soft** (boîte pleine, panne temporaire) ne supprime rien.

---

### Purge d'une liste importée (2026-09-09)

Un désabonné ou une adresse morte reste exclu de tout envoi sans rien faire.
La purge sert à garder un FICHIER propre : `purge_email_list(import)` verse
chaque adresse désabonnée ou supprimée dans le repoussoir `email_opt_outs`
(par portée, RLS sans policy), supprime la ligne `newsletter_subscriptions`,
efface l'email dans `imported_contacts` (la ligne ne survit que si elle porte
un téléphone). `import_email_contacts` consulte le repoussoir : réimporter le
même fichier ne réabonne personne. **Ne jamais vider `email_opt_outs`** : c'est
lui qui rend la purge légale. `export_email_list(import)` ne rend que les
actifs ; `get_email_lists_health(portée)` ventile chaque liste (total, actifs,
désabonnés, injoignables, purgés). Les deux RPC destructives / personnelles
refusent la session support.

## 6. Import d'une base existante

RPC `import_email_contacts` (bloquée en session support). Trois règles :

1. **Pas d'import sans attestation** : origine du consentement + date de
   collecte, horodatées avec l'auteur, dans `email_list_imports`. C'est la pièce
   qu'on produit si un destinataire conteste (RGPD art. 7.1).
2. **Un désabonné explicite n'est jamais réactivé** — le `ON CONFLICT DO UPDATE`
   porte un `WHERE opted_out_at IS NULL`.
3. **Les adresses supprimées sont écartées à l'entrée.**

Le parseur front (`src/lib/emailImport.ts`) avale CSV virgule / point-virgule /
tabulation, exports Mailchimp, `Nom <email>`, `Nom, Prénom`, listes brutes.

> ⚠️ `ON CONFLICT` sur `newsletter_subscriptions` doit TOUJOURS cibler
> `(lower(email), venue_id) WHERE venue_id IS NOT NULL` (et l'équivalent
> organisateur). Les index prod sont des index d'EXPRESSION partiels ; un
> arbitre sur la colonne brute lève 42P10. Cf. migration `20260808140000`.

---

## 7. Runbook

**« La campagne est bloquée en Envoi en cours »**
Elle ne l'est pas : le cron la reprend chaque minute. Vérifier :
```sql
SELECT status, paused_reason, total_recipients, recipients_count, last_slice_at
  FROM email_campaigns WHERE id = '<uuid>';
SELECT status, count(*) FROM email_campaign_recipients
 WHERE campaign_id = '<uuid>' GROUP BY status;
```
`last_slice_at` qui n'avance pas + des lignes `pending` → regarder les logs de
`send-campaign`. `pending` à 0 et `sending` non nul → attendre 10 min, le
balayage les libère.

**« Mise en pause automatique »**
Lire `paused_reason`. `complaint_rate` ou `bounce_rate` : **ne pas relancer tel
quel**. Nettoyer la liste ou recibler les contacts récents.

**« Aucun destinataire pour cette audience »**
Audience promotionnelle sans opt-in. Vérifier :
```sql
SELECT count(*) FROM newsletter_subscriptions
 WHERE venue_id = '<id>' AND opted_in = true;
```

**Rejouer une campagne partiellement partie** : la relancer depuis l'app. La
file est idempotente (`ON CONFLICT DO NOTHING`), les déjà-envoyés sont sautés.

---

## 8. Ce qu'on n'a délibérément PAS fait

- **Pas de double opt-in forcé sur les listes importées.** Sous RGPD, un
  consentement déjà valide n'a pas à être redemandé, et le re-permissionning
  coûte 60 % d'une liste. On a préféré l'attestation + le warm-up + le
  disjoncteur, qui protègent la réputation sans sacrifier la liste. Un pro qui
  doute de sa base peut envoyer une campagne de reconfirmation lui-même.
- **Pas de domaine d'envoi par pro.** C'est la meilleure isolation possible
  (chacun sa réputation), mais elle exige que le pro pose des DNS sur SON
  domaine. `email-sender-identity.ts` est le point d'extension prévu.
- **Pas de plafond d'envoi lié au plan d'abonnement.** `SUBSCRIPTIONS_ENABLED`
  est encore à false.
