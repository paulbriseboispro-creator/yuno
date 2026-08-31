# Email Studio — plan d'implémentation (2026-08-31)

Remplace la couche design + composition + flow des campagnes email par le
« Email Studio » (prototype claude.ai/design `Email Studio Yuno.dc.html`).
La logique d'envoi existante (file SKIP LOCKED, idempotence Resend, warm-up,
disjoncteur, suppression list) est CONSERVÉE et étendue — jamais réécrite.

> Prototype non accessible depuis cette session (auth claude.ai bloquée par le
> dialogue Keychain). Implémentation faite depuis la spec écrite (tokens,
> dimensions, interactions au pixel). Une passe de fidélité visuelle contre le
> prototype reste à faire quand il sera exportable.

## Étapes

1. **Modèle + rendu** — `src/lib/email/` : types v2 (13 blocs), 4 thèmes,
   `makeBlock`, variables (`{{prénom}} {{ville}} {{dernier_event}}
   {{points_fidélité}} {{nom_club}}`), `renderEmailHtml(blocks, theme, ctx)`
   (tables imbriquées, MSO/VML, preheader caché, dark-mode meta, media
   queries), checklist pré-envoi, migration v1→v2.
2. **SQL** — migration `email_studio_v2` : colonnes `blocks_version`,
   `subject_b/ab_*`, `audiences_json/exclusions_json`, `throttle_per_hour`,
   `quiet_hours`, `ab_variant` sur recipients ; `resolve_campaign_audience`
   v2 (multi-segments + exclusions), `count_campaign_audience` (net réel),
   claim A/B-aware, `resolve_campaign_ab_winner`.
3. **Edge** — `_shared/email-studio-html.ts` (port Deno du renderer + fetch
   des données live des blocs Yuno) ; `send-campaign` : chemin v2, sujet A/B
   par destinataire, gates quiet-hours + throttling (mêmes patrons que le
   gate quota), phase de test A/B puis gagnant à l'ouverture.
4. **UI** — `src/components/email-studio/` : StudioShell (5 écrans, barre de
   progression), store zustand (undo/redo 40, autosave), palette drag+click,
   canvas fidèle avec chrome d'édition, Inspector/Theme/Data, Audience
   multi-segments + net réel, Planification (throttle, quiet hours), Récap +
   checklist, Envoi en cours (progress RPC). i18n `studio.*` en 3 langues.
5. **Bascule** — migration à l'ouverture des brouillons v1, routes owner +
   organizer vers le Studio, liste des campagnes enrichie (revenu attribué),
   suppression de `campaigns/CampaignBuilder.tsx` + `ThemeEditor.tsx`
   (`email-editor/*` et `lib/emailCampaign.ts` RESTENT : utilisés par
   `AdminEmailTemplates`).

## Contrats intouchables respectés

- Consentement : audiences promotionnelles TOUJOURS jointes à
  `newsletter_subscriptions.opted_in` ; une condition inconnue ⇒ FAUX.
- Suppression list consultée à l'enqueue, jamais contournée.
- Marquage en lot, claim SKIP LOCKED, disjoncteur dans la boucle : inchangés.
- Le front ne décide pas du statut d'une campagne.
