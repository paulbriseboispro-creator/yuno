# Marketing plateforme — Yuno écrit à sa propre base

Livré le 2026-09-08. Écran : **`/admin/marketing`** (super admin) + `/admin/marketing/sms`.

Jusqu'ici, le seul canal que Yuno possédait vers ses propres utilisateurs était
le push. Les clubs et les organisateurs avaient un studio email complet, une
file d'envoi, un gouverneur de quota, une liste de suppression, des imports
attestés, des campagnes SMS. La plateforme, elle, n'avait rien : pour annoncer
le lancement à sa liste d'attente ou relancer un club prospecté, il fallait
sortir de l'outil.

Ce n'est pas un second système. C'est une **troisième portée** du moteur
existant.

## La portée

| Portée | `venue_id` | `organizer_user_id` | Qui y accède |
|---|---|---|---|
| Club | renseigné | NULL | owner du club |
| Organisateur | NULL | renseigné | l'organisateur |
| **Plateforme** | **NULL** | **NULL** | **super admin seul** |

Le créneau « les deux à NULL » était déjà autorisé par
`email_campaigns_owner_check` et `newsletter_subscriptions_owner_check`, et les
policies RLS de ces tables portaient déjà `OR is_super_admin()`. La migration
`20260908210000_platform_marketing_scope.sql` a fait le reste : relâcher les
contraintes XOR côté SMS, imports et segments, poser les index d'unicité du
créneau plateforme, et ajouter les deux policies SMS manquantes.

**Invariant de sécurité.** Deux colonnes à NULL ne satisfont ni la branche club
ni la branche organisateur d'aucune policy : seul `is_super_admin()` (ou
`service_role`) passe. Ne jamais écrire une policy qui accorderait la portée
plateforme sur un autre critère.

### La porte unique de comparaison de portée

Une dizaine de fonctions répétaient à la main :

```sql
(p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = p_organizer_user_id)
```

— prédicat **faux** quand les deux paramètres sont NULL, donc muet sur toute la
portée plateforme, sans jamais lever d'erreur. La règle vit désormais dans
`marketing_scope_match(row_venue, row_org, p_venue_id, p_organizer_user_id)`
(SQL + IMMUTABLE, inlinée par le planificateur). Toute nouvelle fonction de
portée passe par elle.

Les gardes `IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE`
sont devenues « au plus une portée » : `IF p_venue_id IS NOT NULL AND
p_organizer_user_id IS NOT NULL THEN RAISE`.

## Le registre de consentement

**`newsletter_subscriptions` en portée plateforme est la seule source d'une
campagne email.** Rien n'est lu en direct dans `profiles`, `launch_waitlist` ou
`links_pro_leads` au moment de l'envoi.

La raison est le **jeton de désinscription** : il n'existe que sur une ligne
`newsletter_subscriptions`, et un email marketing sans porte de sortie ne doit
jamais partir. C'est vérifiable — une résolution d'audience plateforme rend zéro
destinataire sans `unsubscribe_token`.

`sync_platform_marketing_contacts(p_sources)` est le seul pont. Bouton
« Actualiser la base ». Il verse :

| Source | Table | `newsletter_subscriptions.source` |
|---|---|---|
| `clients` | `profiles` sans rôle pro | `platform:clients` |
| `pros` | `profiles` avec rôle owner / organizer / promoter / agency / affiliate / dj / manager | `platform:pros` |
| `waitlist` | `launch_waitlist` | `platform:waitlist` |
| `leads` | `links_pro_leads` | `platform:leads` |
| import | `ContactImportDialog` → `import_contact_list` | `platform:import` |

Ce que la synchro ne fait **jamais** :

- réveiller un désabonné explicite (`opted_out_at` posé) — même règle que l'import ;
- écrire une adresse figurant sur la liste de suppression (rebond dur, plainte) ;
- compter la démo (`is_demo_email`), les profils orphelins (`auth.users`
  absente, voir `docs/ORPHAN_PROFILES.md`) ni les comptes suspendus ;
- retaguer quelqu'un qui est déjà là : la première origine reste la pièce du
  dossier de consentement.

Côté SMS, même modèle sur `venue_sms_contacts` (deux colonnes de portée à NULL).
Un numéro qui a répondu STOP **où que ce soit** n'est jamais réinscrit : le
numéro d'envoi est partagé, un STOP vaut partout.

## Les audiences

Portée plateforme, `audiences_json` (cumulables) :

| `kind` | Qui |
|---|---|
| `all_subscribers` | tout le registre opt-in |
| `clients` | `source = platform:clients` |
| `pros` | `source = platform:pros` |
| `waitlist` | `source = platform:waitlist` |
| `leads` | `source = platform:leads` |
| `app_users` | rattaché à un compte (`user_id` non nul) |
| `no_account` | prospects sans compte |
| `buyers` | au moins un billet payé sur la plateforme |
| `import` | un fichier importé (`importId`) |
| `contact_segment` | un segment intelligent de portée plateforme |

**Audience vide ⇒ personne.** Le miroir v1 (`audience_type`) n'a aucun chemin
plateforme : une campagne plateforme sans `audiences_json` ne part à personne,
jamais « à toute la base ».

Le type « informationnel » (écrire aux acheteurs d'une soirée) n'existe pas en
plateforme : c'est le métier du pro. L'interface masque le sélecteur.

Les effectifs par case viennent de `count_platform_audience_kinds()` — une seule
RPC pour les huit, pas huit allers-retours.

## L'expéditeur

`Yuno <yuno@news.yunoapp.eu>` (sous-domaine marketing, `EMAIL_MARKETING_DOMAIN`),
reply-to = `PLATFORM_REPLY_TO` sinon l'email du super admin. Le pied
« Powered by Yuno » saute : une campagne Yuno ne se signe pas elle-même.

**Clé de quota : `yuno`, jamais `platform`.** `platform` est déjà l'étage 1 de
`consume_email_send_quota` — le pool global de toute la plateforme. Réutiliser
cette clé pour l'expéditeur ferait consommer **deux fois** le même compteur dans
le même appel (étage 1 puis étage 2 sur la même ligne).

L'expéditeur `yuno` chauffe comme n'importe quel autre (300 le premier jour,
25 000 au bout de six) : c'est une identité d'expédition neuve. Son forfait
mensuel est aligné sur le pool marketing (40 000) plutôt que sur les 15 000
offerts à un compte pro — Yuno ne s'achète pas de crédits à lui-même.

## SMS : pas de crédits

Le SMS de la plateforme part sur le compte Twilio de Yuno. Il n'y a donc ni
solde, ni débit, ni pause « crédits épuisés » : `balanceIdFor` rend `null` en
portée plateforme et `consumeCredits` / `refundCredits` deviennent des no-op. Le
coût reste lisible : `sms_campaign_recipients.credits` porte les segments
facturés de chaque envoi.

Les segments SMS propres à la plateforme sont `pros` et `clients` — l'origine se
lit dans le registre email plateforme, seul endroit qui la porte. Les segments
liés à une soirée (`event`, `not_event`, `vip`) n'y sont pas proposés.

Tant que `SMS_MARKETING_LIVE` est à `false` (`src/lib/smsMarketing.ts`), tout se
prépare mais rien ne part — mêmes verrous que pour les pros.

## Fin d'envoi

Une campagne plateforme terminée n'a pas de club à notifier : l'accusé part dans
le flux d'alertes super admin via `emit_admin_notification`, type
`admin_platform_campaign_sent`, et pointe sur le **rapport** de la campagne.

## Fichiers

| Quoi | Où |
|---|---|
| Portée, contraintes, index, RLS, quota | `supabase/migrations/20260908210000_platform_marketing_scope.sql` |
| Registre, synchro, imports, contacts | `…210100_platform_marketing_contacts.sql` |
| Résolution d'audience email + SMS | `…210200_platform_marketing_audiences.sql` |
| Rebase sur les fonctions rapides | `…230000_platform_scope_on_fast_contacts.sql` |
| Effectifs par segment | `…230100_platform_audience_counts.sql` |
| Droits (retrait d'`anon`) | `…233000_platform_marketing_grants.sql` |
| Expéditeur, branding, accusé | `supabase/functions/send-campaign/index.ts` |
| Crédits no-op, portée | `supabase/functions/send-sms-campaign/index.ts` |
| Clé de quota `yuno` | `supabase/functions/_shared/email-sender-identity.ts` |
| Hub, éditeur, rapport | `src/pages/admin/AdminMarketing.tsx` |
| SMS | `src/pages/admin/AdminMarketingSms.tsx` |
| Portées front | `src/components/email-studio/hooks.ts`, `src/lib/smsMarketing.ts` |

## Piège vécu

`20260908210100` avait ouvert la portée plateforme sur les fonctions de contact
telles qu'elles existaient alors. `20260908220000` (contact_intelligence_fast,
l'analyse ensembliste à 0,4 s au lieu de 37 s) les a réécrites juste après, avec
la garde stricte : la vitesse a gagné, la portée plateforme est retombée.
`20260908230000` reprend les corps **rapides** et n'y change que la portée.

**Toute future réécriture de ces fonctions repart de l'état live, jamais de
`210100`.** Le réflexe qui marche : `pg_get_functiondef` sur la base liée, puis
réécriture mécanique du prédicat de portée.
