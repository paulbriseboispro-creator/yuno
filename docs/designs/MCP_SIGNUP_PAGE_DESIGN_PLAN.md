# MCP Yuno — l'IA du pro dessine ses pages d'inscription (2026-10-06)

Demande de Paul : ouvrir au design des **pages d'inscription** (Yuno CRM,
`/crm/signup-pages`, page publique `/j/<slug>`) ce que le MCP sait déjà faire
pour les e-mails (`MCP_EMAIL_DESIGN_PLAN.md`). Le pro demande à SON IA
(Claude, ChatGPT…) de dessiner sa page : de zéro en la décrivant, d'après un
design system (charte), ou d'après une inspiration collée dans le chat ; puis il
la fait retoucher dans la conversation. Un outil de design complet.

## Scénarios

1. **De zéro, d'après l'affiche.** « Crée une page de prévente pour Halloween,
   dans l'univers de l'affiche » → `get_signup_page_kit(event)` → l'IA dessine →
   `create_signup_page` → une page en **brouillon** dans la Console, lien
   d'aperçu et de relecture. Le pro relit et publie.
2. **D'après une inspiration.** Capture d'une page aimée → l'IA la lit
   elle-même (rien ne passe au connecteur) et reconstruit la structure, avec le
   vrai formulaire Yuno.
3. **D'après une charte.** « Noir et or #C9A227, Playfair Display, voici mon
   logo » → `add_email_image` (le logo, lien de dépôt chez Claude) →
   `create_signup_page` / `update_signup_page` avec ce thème.
4. **Retouches.** « Le titre est trop gros, enlève le bloc avec les étoiles »
   (+ capture) → `get_signup_page` (sections avec id et texte visible, version)
   → `update_signup_page` (section_updates par id, `page_version`). L'assistant
   de la Console ouvert adopte la version de l'IA.
5. **Page en ligne.** « Passe ma page communauté en rouge » →
   `update_signup_page` sur une page publiée = **proposition** : la page en
   ligne ne bouge pas, la fiche de la page affiche « Claude propose des
   changements » avec Aperçu / Appliquer / Ignorer.

## Décisions de Paul (06/10)

| Question | Décision |
|---|---|
| Page déjà en ligne | **Proposition à appliquer** : rien ne change pour les fans sans un clic du pro |
| Liberté de dessin | **Sections libres (HTML/CSS) + formulaire Yuno**, comme les sections sur mesure des e-mails |
| Périmètre | **Toute la page sauf publier** : type, soirée, textes, champs et questions, récompense, compteur, compte à rebours, dates, design. Publication et relances restent dans la Console |
| Libellé | **« Design sur mesure »** (+ « Préparé par Claude ») |

## Le modèle : un design sur mesure à côté des dix gabarits

`crm_signup_pages.custom_design` (jsonb, NULL = gabarit Yuno comme avant) :

```
{ v: 1,
  theme: { bg, bg_css?, text, accent, accent2?, accent_text?,
           font_heading, font_body, heading_weight, heading_case, heading_tracking,
           card_bg ('#hex' | transparent | glass), card_border, card_radius, card_shadow,
           input_style (box | underline | pill), input_bg?, radius,
           button_style (solid | gradient | outline), button_radius, button_shadow,
           button_case, button_arrow, button_height, button_font,
           label_style (normal | uppercase | mono), extra_fonts?, css? },
  sections: [ { id, type: 'html', html, css?, label?, show_on? }
            | { id, type: 'yuno', block: 'form' | 'countdown' | 'reward' | 'count', label?, show_on?, tagline? } ] }
```

- **Sections HTML** : dessin libre (hero, line-up, infos, FAQ, animations),
  avec des **balises Yuno** résolues au rendu : `{{page.title}}`,
  `{{page.tagline}}`, `{{page.poster}}`, `{{page.count}}`, `{{host.name}}`,
  `{{host.logo}}`, `{{event.title}}`, `{{event.date}}`, `{{event.day}}`,
  `{{event.venue}}`, `{{event.tickets_url}}`, `{{reward.label}}`,
  `{{#if scene.noted}}`… Même moteur Handlebars que les e-mails
  (`parseSmart` / `renderSmartTemplate` de `_shared/email-smart.ts`),
  valeurs échappées, jamais de `{{{brut}}}`.
- **Blocs Yuno** : `form` (OBLIGATOIRE, un seul : champs, questions, case
  d'accord au texte exact, erreurs, puis « C'est noté » / « C'est ouvert » /
  fermée / bientôt), `countdown`, `reward`, `count`. Un bloc non posé s'affiche
  à sa place par défaut dans le formulaire (si la page l'active). Le bouton
  collé en bas (s'inscrire, calendrier, partager, billets) et les mentions
  légales restent ceux de Yuno, au thème de la page.
- **Thème** → les MÊMES jetons que les gabarits (`Tokens` de `model.ts`) : le
  formulaire, la case d'accord, le bouton, « C'est noté » sont le code
  existant de `FanPage`, recoloré. Polices = Google Fonts (familles validées,
  chargées par la page).

## Sécurité du dessin libre (page publique sur yunoapp.eu)

- **Isolement** : chaque section se rend dans un **Shadow DOM** (son CSS ne
  sort pas, celui de la page n'entre pas), conteneur `contain: paint` (rien ne
  peut recouvrir le formulaire ni le bouton, même `position: fixed`).
- **Nettoyage deux fois** : par le Worker avant d'écrire (le module pur
  `src/crm/signup/custom.ts`, partagé avec le front : script, style, iframe,
  formulaire, champ, bouton, objet, `on*`, `javascript:`, `<use>`, animation
  SVG, `@import`, `@font-face`, `expression()`… retirés et signalés à l'IA), puis
  par **DOMPurify** à CHAQUE rendu (page publique et aperçus de la Console),
  liens forcés en `target=_blank rel=noopener`. Une ligne écrite autrement que
  par le MCP est donc nettoyée quand même.
- **Images** : la CSP de yunoapp.eu n'autorise que le stockage Yuno
  (`*.supabase.co`) : une image d'un autre site ne se charge pas. L'IA passe
  par `add_email_image` (lien recopié, fichier joint, ou page de dépôt), dont
  l'URL est sur Yuno. Aucun traqueur tiers possible dans une page.
- **Consentement intouchable** : la case d'accord, son texte, la double
  confirmation et `submit_crm_signup` ne changent pas. Une section ne peut pas
  écrire dans le formulaire (Shadow DOM) ni le masquer (contain).

## MCP

| Outil | Nature | Rôle |
|---|---|---|
| `get_signup_page_kit` | lecture | Marque (nom, logo, ville, réseaux, couleurs des derniers e-mails), soirées à venir, faits d'une soirée, pages existantes, les 4 types et leurs règles, les 10 gabarits, le modèle du design sur mesure, les balises et leur aperçu, règles web, méthode de design, exemple. |
| `get_signup_page` | lecture | Une page : réglages, design (gabarit ou sur mesure : sections avec id, texte visible, html, css), proposition en attente, `version`, liens. |
| `create_signup_page` | **écriture** | Crée une page en BROUILLON (jamais publiée). Rend le lien de la Console, l'adresse publique (active une fois publiée) et les contrôles. |
| `update_signup_page` | **écriture** | Modifie une page : brouillon = écrit ; page publiée = proposition à appliquer. Sections par id (edit, remove, insert_before / after, move), thème, textes, champs, dates. `page_version` vérifiée. |
| `add_email_image` / `list_email_images` | écriture / lecture | Déjà là : servent aussi aux pages (description élargie). |

- **Écriture = `mcp_write`**, permission **`mcp_grants.can_pages`** (défaut
  false ; `/connect-ai` l'annonce et passe `p_pages = true`). Les connexions
  existantes ne l'ont pas : se reconnecter suffit.
- **Droits** = ceux de la Console : `crm_signup_page_save` est APPELÉE telle
  quelle sous l'identité de la personne (`crm_scope_writable`, CRM actif) ; la
  publication (`_crm_signup_owner`) n'est jamais appelée.
- **Débits** : 20 pages créées et 200 modifications par jour et par connexion
  (60 appels / min, 3 000 / jour en tout). Section ≤ 30 Ko de HTML + 15 Ko de
  CSS, design ≤ 150 Ko.
- **Journal** `mcp_tool_calls` : résumé (page, type, titre, nombre de
  sections, poids), jamais le HTML.
- **Itération sans écraser** : `page_version` = `updated_at` en µs
  (`_mcp_draft_version`) ; `ai_updated_at` posé à chaque écriture ;
  l'assistant de la Console adopte la version de l'IA (« Revenir à ma
  version ») et `crm_signup_page_save` refuse `ai_changed` quand l'écran
  enregistre par-dessus une version de l'IA qu'il n'a pas vue (`_seen_ai_at`).
- **Proposition** (`ai_proposal` : patch + design + auteur + date + liste des
  changements) ; `crm_signup_page_ai_proposal(…, 'apply' | 'discard')` côté
  Console (mêmes droits que modifier la page). L'aperçu montre la page en
  ligne + la proposition : ce qu'on voit est ce qu'on applique.
- **Annotations** : `create_signup_page` `readOnlyHint: false`,
  `destructiveHint: false` ; `update_signup_page` `destructiveHint: true`.

## Console

- `FanPage` : mise en page `custom` (sections + blocs Yuno), mêmes scènes ;
  aperçus, vignettes, téléphone et page publique en héritent.
- Assistant : carte « Design sur mesure · Préparé par Claude » en tête des
  gabarits (choisir un gabarit le remplace, après confirmation) ; adoption de
  la version de l'IA.
- Fiche : badge « Préparé par Claude », bandeau de proposition, « Publier »
  d'une page de l'IA jamais relue → l'assistant (relances composées au
  passage).
- `/connect-ai`, Réglages → Assistants IA (droit « pages », nombre de pages),
  `/ai`, aide `ohelp.ai`, assistant de la Console, textes FR / EN / ES.

## Hors périmètre

Publication par l'IA, messages de relance (composés par la Console), vidéo
dans une section, police hors Google Fonts, édition à la main du HTML d'une
section dans la Console (le pro demande à son IA ou revient à un gabarit).
