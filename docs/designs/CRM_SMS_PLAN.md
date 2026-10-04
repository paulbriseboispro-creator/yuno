# Yuno CRM — SMS : ce qui est prêt, ce qui reste avant d'ouvrir l'envoi

État au 2026-10-04. La suite SMS de la Console CRM (`/crm/sms/*`) est
construite et branchée sur les tables SMS réelles : on y compose, on choisit
l'audience, on prépare la date, on lit les résultats et l'analyse des SMS
partis. **L'envoi n'est pas ouvert** : `SMS_MARKETING_LIVE = false`
(`src/lib/smsMarketing.ts`) et, côté serveur,
`enqueue_sms_campaign_recipients` refuse tout SMS d'un compte CRM
(`crm_sms_not_open`, migration `20261005120000_crm_sms.sql`). Un brouillon CRM
porte `segment_filters.type = 'crm'`, que l'ancien moteur lirait comme « tous
les contacts » : ce refus est la garantie, pas un confort.

## Ce qui est en place

- **Réglages d'envoi** : `crm_sms_settings` (une ligne par portée), lus et
  écrits par `crm_sms_settings_get` / `crm_sms_settings_set` : nom
  d'expéditeur (3 à 11 lettres ou chiffres), heures calmes (début, fin),
  dimanche, plafond de SMS par semaine (1 à 3), numéro de test.
- **Brouillons** : `crm_sms_save` (crée ou modifie, la date choisie reste sur
  un brouillon : le statut ne passe jamais à « programmé »), `crm_sms_delete`
  (brouillons seulement), `crm_sms_duplicate`.
- **Audience** : `crm_sms_send_options` (groupes automatiques et segments du
  compte, joignables par SMS = numéro + accord SMS de moins de 36 mois, sans
  STOP) et `crm_sms_audience_preview` (moins ceux qui ont déjà leur place, ceux
  qui ont reçu un e-mail ou un SMS récemment, et le plafond de la semaine).
- **Chiffres d'un SMS parti** (`_crm_sms_stats`, une seule définition) :
  envoyés, remis, clics (visiteurs distincts du lien suivi), achats (billets
  achetés dans les 7 jours après le SMS par une personne qui l'a reçu), STOP
  (désinscription dans les 7 jours). Lus par `crm_sms_overview`,
  `crm_sms_campaigns`, `crm_sms_result`, `crm_sms_analysis`, tous derrière la
  porte argent.

## Ce qu'il faut faire avant d'ouvrir l'envoi (avec le nouveau fournisseur)

1. **Yunits** : un SMS CRM coûte 40 Yunits par segment (`rates.sms`). Le
   moteur actuel débite les crédits SMS de la Suite. Il faut, pour une portée
   CRM, débiter les Yunits à la mise en file (même modèle que l'e-mail :
   `crm_yunits_debit`, refus `crm_yunits_insufficient`) et rembourser un échec
   (`mark_sms_campaign_recipients_failed`, `apply_sms_delivery_status` pour
   `failed`).
2. **Audience CRM** : une mise en file propre aux portées CRM qui lit
   `segment_filters.audiences` (`_crm_audience_pred` sur `_cp`, `phone_ok`),
   applique les exclusions enregistrées (`exclude_buyers`, `recent_days`) et le
   plafond hebdomadaire de `crm_sms_settings` — la même règle que
   `crm_sms_audience_preview`.
3. **Personnalisation** : le composeur insère `{{prénom}}`, `{{nom_club}}`,
   `{{soirée}}` et `{{lien}}`. Le moteur (`_shared/sms-text.ts`, miroir
   `src/lib/smsMarketing.ts`) ne remplace aujourd'hui que `{lien}`. Il faut
   résoudre ces variables par destinataire (le débit est déjà calculé SMS par
   SMS, `send-sms-campaign`).
4. **Réglages appliqués** : heures calmes et dimanche sont écrits en dur
   (20 h → 8 h, tout le dimanche) dans `send-sms-campaign` ; ils doivent venir
   de `crm_sms_settings`. Le nom d'expéditeur devient l'identifiant
   alphanumérique du fournisseur (aujourd'hui un préfixe « NOM : » du texte).
5. **Test gratuit** : « Recevoir un test » envoie au numéro des réglages, sans
   Yunits (comme l'e-mail).
6. **Mesure par personne (optionnel)** : le lien suivi est partagé par
   soirée, un clic ne dit pas qui a cliqué. Un jeton par destinataire dans le
   lien permettrait des clics par personne (et des achats « après un clic »,
   comme l'e-mail). Tant qu'il n'existe pas, l'écran dit « achats dans les
   7 jours après le SMS ».
7. **STOP rattaché** : `sms_stop_unsubscribe` ne garde pas la campagne
   d'origine ; le rattachement au dernier SMS reçu (fenêtre 7 jours) suffit
   tant que les envois d'un même contact sont espacés.

Puis : allumer `SMS_MARKETING_LIVE`, retirer la garde `crm_sms_not_open` et
rouvrir « Programmer » et « Recevoir un test » dans le parcours d'envoi.

## Démo

`scripts/demo/seed-crm-sms.sql` (rejouable, après `seed-crm-demo.sql`) pose
des numéros de fiction (+33 6 39 98 xx xx) sur les billets semés, un accord SMS
pour la plupart, six SMS partis avec leurs clics et quelques STOP, et trois
brouillons. Aucun Yunit n'est débité pour ces SMS (le moteur ne le fait pas
encore).
