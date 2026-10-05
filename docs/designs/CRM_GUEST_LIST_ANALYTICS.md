# Yuno CRM — la guest list Shotgun dans l'analyse

Livré le 2026-10-06. Migrations `20261008100000_crm_guest_list.sql`,
`20261008110000_crm_guest_list_who_partition.sql`,
`20261008111000_crm_guest_list_min_sample.sql`. Semis démo
`scripts/demo/seed-crm-guestlist.sql` (joué par `refresh-crm-demo.sh`).

## Le problème

Un club qui vend sur Shotgun fait entrer une bonne partie de sa salle par la
guest list : invitations des promoteurs, des artistes, de la presse, et un tarif
« Guest list gratuite avant 1 h ». La Console CRM ne le montrait nulle part. Les
invitations n'étaient même pas des ventes (`_crm_ticket_is_sale` les écarte),
donc un invité venu trois fois restait « Jamais venu » dans Clients. Or c'est la
question qu'un pro se pose chaque semaine : qui est sur la liste, qui vient
vraiment, quelle liste remplit la salle, et qui finit par payer un billet.

## Ce que Shotgun rapporte, et rien d'autre

D'après `docs/designs/SHOTGUN_API_REFERENCE.md` :

| Ce que le pro appelle « guest list » | Dans l'API Tickets | Dans Yuno |
|---|---|---|
| Invitation envoyée par l'orga | billet `deal_channel = 'invitation'` | `inv` |
| Tarif gratuit en libre-service | billet valide, `deal_price = 0` | `free` |
| Liste de noms cochée dans Shotgun Scan | **rien** (aucun billet) | « Bientôt » (`ShotgunSoonCard`, item `scanlist`) |
| Duplicata d'un billet existant | `deal_channel = 'duplicata'` | jamais une entrée |

**Porte unique : `_crm_ticket_gl_kind(status, price, raw)`** → `'inv'` | `'free'`
| `NULL`. Miroir front exact : `glKindOf` (`src/crm/lib/guestlist.ts`, testé).
Une demande en attente de validation sur Shotgun (`raw_status =
'pending_approval'`) n'est pas une entrée : elle se compte à part (« À valider »).

## Règles de lecture

1. **« Venu » = billet scanné, et seulement si la porte a scanné.** Une soirée
   passée a un taux de venue quand au moins la moitié de ses billets valides a
   été scannée (`_crm_event_scan_known`, même règle que « On t'a manqué »).
   Sinon : « non mesuré », jamais 0 %. Shotgun laisse le scan vide quand un autre
   prestataire tient la porte.
2. **Aucun pourcentage sous 10** (taux de venue d'une soirée, d'une liste, d'une
   période, de la soirée d'avant, des payants ; part des entrées gratuites ;
   répartitions). Les nombres bruts s'affichent à la place (« 6 / 7 »). Le seuil
   est posé dans le SQL, l'écran ne recalcule rien.
3. **Registre des personnes (`_crm_people_build`)** : une invitation SCANNÉE vaut
   une soirée faite ; un billet à 0 € compte comme tout billet valide (règle
   d'avant, inchangée). Colonnes ajoutées à `_cp` : `paid_n`, `gl_n`,
   `gl_came`, `gl_first`, `gl_events`, `gl_noshow`, `gl_conv`. **Toute
   réécriture de `_crm_people_build` repart de la base liée
   (`pg_get_functiondef`) et garde ces colonnes** : les filtres Clients, les
   segments et les audiences de campagne les lisent.
4. **« Qui sont vos invités ? » est une partition exacte** : première fois (aucune
   place pour une soirée d'avant, aucun billet payant acheté avant), déjà invités
   (une place avant, jamais payé), clients payants (un billet payant acheté
   avant, même pour une soirée plus tardive). Les trois parts additionnées
   donnent le nombre d'invités, et la pastille de la liste nom par nom dit la
   même chose que le carton.
5. **« Devenus clients »** = invités sans billet payant avant leur première soirée
   en guest list, qui en ont acheté un depuis. Montant = valeur faciale des
   billets achetés depuis, `null` pour un rôle sans accès à l'argent
   (`_crm_money_gate`). Moins de 14 jours après la soirée et personne converti :
   « trop tôt pour le dire », pas « 0 % ».

## Où ça s'affiche

| Écran | Lecture | Ce qu'il dit |
|---|---|---|
| Soirées : ligne `gl` de chaque soirée | `crm_nights` | « Guest list · 50 » dans le héros, colonne GL dans les soirées passées |
| Tiroir d'une soirée, onglet « Guest list » (`?v=gl`) | `crm_night_guestlist` | avant : inscrits, du jour, écart avec la fois d'avant au même moment, à valider, courbe ; pendant : déjà entrés ; après : venus, entrées gratuites, quelle liste marche (+ conseil de quota), heures d'arrivée, qui sont-ils, et après ont-ils payé, la liste nom par nom |
| Analyses › Guest list (`/crm/analytics/guestlist`) | `crm_ana_guestlist` | invités soirée par soirée, quatre tuiles comparées à la période d'avant, tableau des listes, arrivées, profil, quatre actions (habitués qui ne paient jamais, absents répétés, devenus clients, prochaine soirée). `?e=<soirée>` ouvre le même écran que le tiroir, en pleine largeur |
| Clients | `crm_clients_list` | filtre « Guest list » (`?gl=any|only|loyal|conv|noshow`) et « Invités de » une soirée (`?glev=<id>`), badge « GL ×n » |
| Fiche client | `crm_client` | bandeau guest list, parcours d'invité (onglet « Guest list »), conseil « prévente rien que pour cette personne » |

Les filtres `gl` / `glev` valent partout où `_crm_filter_sql` est lu : « Écrire
à », segments sauvegardés, audience d'une campagne.

## Fichiers

- SQL : la migration du 06/10 (porte, registre, filtres, cinq lectures), puis
  `…110000` (partition) et `…111000` (seuil de 10).
- Front : `src/crm/data/guestlist.ts` (types + hooks), `src/crm/lib/guestlist.ts`
  (règles pures, testées), `src/crm/pages/nights/NightGuestList.tsx` (onglet du
  tiroir, réutilisé par Analyses), `src/crm/pages/analytics/GuestListTab.tsx`,
  textes `src/i18n/locales/crm/modules/guestlist.ts` (clés `yc.gl.*`).
- Aide : FAQ `yc.faq.guestlist.*` (Compte › Aide), article `crm-guest-list` de
  `_shared/console-help-articles.ts` (assistant et serveur MCP).

## Démo

`seed-crm-guestlist.sql` sème, sur les soirées du compte `crm@womber.fr`, quatre
listes (« Guest list gratuite (avant 1h) » à 0 €, « Invitations promoteurs »,
« Artistes & équipe », « Presse & partenaires »), des habitués de la liste qui ne
paient jamais, des visages neufs, des acheteurs invités, des demandes en attente
et des scans d'arrivée plus tôt que les payants. Rejouable, borné au périmètre
démo, il se joue après `seed-crm-nights.sql`.

## Ce qui reste « Bientôt »

Les listes de noms de Shotgun Scan : aucune donnée dans l'API publique. Elles
arriveront avec l'intégration partenaire, comme les visites de la page Shotgun.
