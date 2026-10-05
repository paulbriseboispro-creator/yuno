# Yuno CRM — Pages d'inscription (v2, 05/10)

Design (projet Claude Design « Yuno CRM ») : `Pages inscription.dc.html`
(liste, assistant, page publiée, fiche), `FanPage.dc.html` (la page publique,
dix mises en page), `InscriptionPhone.dc.html` (aperçu téléphone : page, « C'est
noté », jour J, e-mail, SMS), `assets/yuno-pages.js` (modèle : types, gabarits,
palettes, polices, `tokens()`). La Console les reproduit à l'identique et les
branche sur la vraie base. Une page = un lien et un QR où un fan laisse son
contact AVANT d'acheter ; il rejoint les Clients du pro.

## Code

- `src/crm/signup/model.ts` : port pur de `yuno-pages.js` (types, `KIND_META`,
  10 gabarits `TPL`, palettes, `FONTS`, `tokens()`, récompenses, champs,
  provenances, utilitaires `dt`, `venueOf`, `partySize`…). Testé
  (`src/crm/lib/__tests__/signupPages.test.ts`).
- `src/crm/signup/FanPage.tsx` : la page publique, partagée par la page réelle
  (`mode="live"`), les aperçus (`preview`) et les vignettes de gabarit
  (`frozen`). `InscriptionPhone.tsx` : le téléphone de l'aperçu (page, e-mail,
  SMS). `SignupPagePublic.tsx` : `/j/<slug>` et `/j/<slug>/ok?t=`.
- `src/crm/pages/signup/` : liste (`SignupPagesPage`), assistant en 4 étapes
  (`SignupWizardPage`), « C'est en ligne ! » (`SignupDonePage`, + l'aperçu plein
  écran `SignupPreview`), fiche (`SignupDetailPage` : Résultats, Partager,
  `SignupWho`, `SignupRelance`), QR réel (`SignupQr`), logique pure
  (`signupLogic.ts`), primitives (`signupUi.tsx`). Textes : `yc.sp.*`
  (`src/i18n/locales/crm/modules/signupPages.ts`).
- Routes : `/crm/signup-pages`, `/new?type=`, `/:id`, `/:id/edit`,
  `/:id/published` ; la fiche a ses onglets dans `?tab=res|share|who|rel`.

## Les quatre types (`crm_signup_pages.kind`)

| Type | Soirée | Ferme | Relances |
|---|---|---|---|
| `prevente` | obligatoire | à l'ouverture de la vente, ou à une date | C'est ouvert · rappel · dernier appel |
| `venue` (« Je viens ») | obligatoire | la veille de la soirée, ou à une date | rappel la veille à 18 h |
| `attente` | soirée complète ou « prochaine date pas annoncée » | à la main, ou à une date | C'est ouvert (au clic « Prévenir ») · rappel · dernier appel |
| `communaute` | aucune | jamais, ou à une date | bienvenue à l'inscription |

État lu en base (`_crm_signup_state`) : `draft` / `scheduled` / `open` /
`closed`. Rouvrir une page fermée par sa date la passe en « jamais ».

## Données (migration `20261007193500_crm_signup_pages_v2.sql`)

- `crm_signup_pages` : `kind`, `design` (`{tpl, pal, bg, acc, font}`),
  `countdown`, `closes_mode`, `relance` (par étape : on, canaux, délai, texte,
  et l'e-mail composé par la Console en blocs de l'Email Studio), `notified_at`,
  `lang`, `fields` (`{contact: both|email|phone|all, extra: {nom, naissance,
  insta, ville}, questions[≤2]}`), récompense, dates, affiche (bucket
  `email-assets`, `<portée>/signup/…`), groupes de contacts créés à la 1re
  publication.
- `crm_signup_entries` : e-mail FACULTATIF (inscription par téléphone seul
  possible, contrainte « e-mail ou téléphone »), nom, date de naissance,
  Instagram, ville, `was_known` (déjà client), `party_size`, réponses,
  provenance, empreinte du jour, jeton de confirmation haché.
- `crm_signup_sends` (une ligne par inscrit × étape × canal : jamais deux fois
  le même message) et `crm_signup_relance_campaigns` (la campagne enfant d'une
  étape). RLS sans policy partout : tout passe par les RPC.

## Inscription et RGPD

- `submit_crm_signup` (anon) : page ouverte, anti-abus (empreinte salée du jour,
  10 / h / visiteur, 300 / h / page), e-mail valide et non jetable, numéro
  E.164, case d'accord obligatoire avec son texte exact conservé. Démo : la page
  répond « démonstration » et n'enregistre rien.
- Par e-mail : double confirmation (file `crm_signup_confirm_queue`, envoyée par
  `process-scheduled-campaigns`), puis preuve `marketing_consent_events`
  (`source = signup_page:<id>`), groupe de la page (`imported_contacts`),
  registre `newsletter_subscriptions` sans jamais réveiller un désabonné.
- Par téléphone seul : pas de lien à cliquer ; l'accord coché est la preuve
  (SMS), le contact entre au groupe. Le SMS ne part pas encore
  (`CRM_SMS_ENGINE_READY`).
- Provenance d'un client : « page » quand sa première inscription confirmée
  précède son premier achat (`_crm_people_build`, migration
  `20261007194500`) → filtre Clients « Arrivé par : Pages d'inscription » et
  modèle de segment « Inscrits via vos pages ».

## Relances (`crm_signup_relance_collect`, cron `crm-signup-relance`, 5 min)

- `open` : prévente = à l'ouverture de la vente ; venue = la veille à 18:00 ;
  attente = au clic « Prévenir les inscrits maintenant »
  (`crm_signup_page_notify_now`, une fois) ; communauté = à l'inscription.
- `nudge` : open + 24 h / 48 h / 3 j, aux inscrits SANS achat (billet Shotgun
  vu sur la soirée). `last` : J-2 / J-1 / le jour même à 12:00, sans achat.
- Chaque étape expire (2 jours après son heure ou au début de la soirée) : rien
  ne part en retard. Destinataires : inscription confirmée, abonné, politique
  d'envoi Yuno respectée (sinon reporté au passage suivant). Une campagne
  enfant par (page, étape), `child_kind = 'signup'`, sa propre mère (hors des
  listes), drainée par `send-campaign` ; Yunits débités à la mise en file
  (`_crm_yunits_debit_child_recipients`). Démo jamais.

## Hors périmètre

Envoi SMS (moteur à brancher), choix d'un post Instagram déjà publié comme
visuel, export CSV dédié (la liste Clients filtrée par provenance s'exporte).
