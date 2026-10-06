# MCP Yuno — l'IA du pro dessine ses e-mails (2026-10-06)

Demande de Paul : un pro (Billetterie ou CRM) demande à SON IA (Claude,
ChatGPT…), via le MCP Yuno, de dessiner l'e-mail de sa soirée — d'après une
inspiration, une description ou un design system — optimisé pour l'ouverture
et la vente, et l'IA crée les brouillons dans son compte. Exemple réel :

> « Crée-moi un design e-mail pour ma base, dans ma DA et pour la vente. Pas de
> segmentation, une annonce globale. Fais aussi une variation axée VIP pour mes
> clients VIP. Voici l'affiche, la soirée est en ligne sur Yuno Tickets.
> J'aime le design de l'e-mail rouge/rose que je t'envoie : crée une version
> nightlife pour Amoris. Écris en français. »

Le problème : les blocs Yuno sont **intelligents** (tarifs relus à l'envoi,
« complet », line-up et photos, compte à rebours, liens suivis, attribution
des ventes) mais leur **dessin est imposé**. L'IA doit pouvoir dessiner ce
qu'elle veut ET garder cette intelligence.

## La réponse : des sections sur mesure, branchées sur les données Yuno

1. **L'IA écrit des sections HTML** (bloc `html` du modèle v2, déjà connu des
   deux moteurs de rendu). Liberté totale de dessin : tables, couleurs, typo,
   images, boutons.
2. **Les balises Yuno** donnent à ces sections la même intelligence que les
   blocs Yuno, résolue À L'ENVOI : `{{event.title}}`, `{{event.date}}`,
   `{{event.price_from}}`, `{{event.tickets_url}}`, `{{#each tickets}}…`,
   `{{#each lineup}}…{{photo}}…`, `{{#if event.sold_out}}…{{else}}…{{/if}}`,
   `{{countdown.days}}`, `{{#if tables.available}}`, `{{first_name}}`…
   Syntaxe Handlebars (que les IA connaissent), les formes Mustache
   `{{#x}}` / `{{^x}}` sont comprises aussi. Toute valeur est échappée ; il n'y
   a pas de `{{{brut}}}`.
3. **Les liens restent les nôtres** : `{{event.url}}` / `tickets_url` /
   `tables_url` / `guestlist_url` partent sur le lien suivi du canal
   newsletter (`/l/<code>`, `yc=`), ou chez la billetterie connectée avec
   `utm_source=yuno-m-<campagne>` (Shotgun). Un lien yunoapp.eu écrit en dur
   reçoit `yc=` au rendu. Attribution, résultats et automatisations voient ces
   e-mails comme les autres.
4. **Ce qu'aucune section ne retire** : pied de page légal (expéditeur, raison
   de réception, désinscription, « Powered by Yuno »), règles de visibilité par
   bloc (`vip_table`, `buyers`…), politique d'envoi, consentement, quotas,
   Yunits. Le rendu NETTOIE chaque section (script, style, iframe, formulaire,
   svg, attributs `on*`, URL `javascript:`… jamais rendus).

Le moteur est UN module pur : `supabase/functions/_shared/email-smart.ts`
(analyse, rendu des balises, nettoyage, besoins en données, contrôle qualité),
importé tel quel par le front (`src/lib/email/smart.ts`), par le Worker MCP et
par le port Deno du rendu (`_shared/email-studio-html.ts`). Une seule
implémentation : l'aperçu, le contrôle du MCP et l'envoi disent la même chose.

## Ce que fait l'IA (outils MCP)

| Outil | Nature | Rôle |
|---|---|---|
| `get_email_design_kit` | lecture | Marque du compte (nom, logo, réseaux, couleurs des derniers e-mails, expéditeur), soirées à venir, données de la soirée visée telles que les balises les rendront, référence des balises, règles HTML e-mail, méthode de design nightlife, brouillons récents. |
| `list_email_audiences` | lecture | Audiences possibles avec leurs effectifs joignables (CRM : toute la base, cycles de vie, segments enregistrés, modèles du catalogue ; Billetterie : abonnés, VIP, gros dépensiers, habitués, segments). |
| `create_email_draft` | **écriture** | Crée un BROUILLON (jamais d'envoi) : nom, objet (+ objet B), pré-en-tête, langue, soirée, audience, thème, sections. Rend le lien Console, l'audience nette et le contrôle qualité. |
| `update_email_draft` | **écriture** | Modifie un brouillon, section par section, par IDENTIFIANT (réécrire, options d'un bloc Yuno, insérer au-dessus / en dessous, déplacer, supprimer), et l'objet, l'audience… Prend la `version` lue : si le pro a retouché entre-temps, rien n'est écrit. Rend ce qui a changé. Refusé dès qu'il n'est plus un brouillon. |
| `get_email_draft` | lecture | Relit un brouillon pour l'itérer : chaque section avec son id, son TEXTE visible (pour retrouver « ça » sur une capture d'écran) et son contenu, plus la `version`. |
| `add_email_image` | **écriture** | Range une image sur Yuno pour un e-mail : le fichier joint à la conversation (ChatGPT le passe à l'outil), une image d'un lien (recopiée), ou rien → un lien de dépôt à usage unique où le pro COLLE l'image (`/ai/image/<code>`). |
| `list_email_images` | lecture | Images ajoutées (30 j) avec leur URL et leurs dimensions, et liens de dépôt en attente. |

**Aucun outil n'envoie, ne programme, ne teste ni ne supprime.** L'envoi reste
un clic du pro dans la Console, après relecture (même règle que Meta : créé en
pause, jamais activé).

## Accord et garde-fous

- **Écriture = une seule porte, `mcp_write`** (le serveur MCP gardait toutes
  ses lectures dans `mcp_call`, transaction en lecture seule : ça ne change
  pas). `mcp_write` revérifie le jeton, l'espace, la permission de la
  connexion (`mcp_grants.can_draft`), le droit d'écrire les campagnes de
  l'espace (CRM : `crm_scope_writable` + CRM actif ; Billetterie : titulaire
  du club / fondateur, comme la policy RLS), et n'écrit que des lignes
  `email_campaigns` au statut `draft`.
- **Consentement** : l'écran `/connect-ai` garde UNE décision ; il dit
  désormais que l'IA « prépare des brouillons d'e-mails que tu relis et
  envoies toi-même ». Les connexions déjà accordées n'ont PAS ce droit
  (`can_draft = false`) : elles ont dit oui à « ne modifie jamais rien ». Se
  reconnecter suffit.
- **Débits** : 30 brouillons créés et 200 modifications par jour et par
  connexion, dans la limite générale de 60 appels / minute. Sections ≤ 60 Ko
  chacune, e-mail ≤ 90 Ko (Gmail coupe à 102 Ko, et coupe le pied de page).
- **Traçabilité** : `email_campaigns.ai_author` (« Claude ») et
  `mcp_grant_id` ; le Studio affiche « Préparé par Claude ». Journal
  `mcp_tool_calls` (résumé, jamais le HTML entier).
- Annotations MCP : `readOnlyHint: false` sur les deux outils d'écriture,
  `destructiveHint: true` sur la modification (elle remplace un contenu).

## Rendu et Studio

- Bloc `html` : `eventId` (soirée de la section, sinon celle de la campagne)
  et `label` (nom dans l'onglet Structure). Données live relues si une section
  utilise des balises de soirée, de line-up ou de tables (`smartNeeds`).
- Thème : `radius` (coins du conteneur, 0-40, défaut 12).
- Campagne : `language` (`fr` | `en` | `es`, défaut `fr`) : pied de page,
  `lang` du document et valeurs des balises (dates, « À partir de », « Plus que
  2 tables »…). Les blocs Yuno natifs gardent leurs libellés français
  (limite connue).
- Studio (CRM et Billetterie) : la section se DESSINE dans le canevas (iframe
  sans script, hauteur mesurée), avec les données live ; l'inspecteur garde le
  code, liste les balises disponibles et signale les problèmes.

## Ce qui reste hors de cette version

- Envoi d'un e-mail de test par l'IA (au pro lui-même).
- Image collée dans une conversation Claude transmise directement à l'outil :
  Claude ne passe pas les fichiers joints aux connecteurs (ChatGPT, si). L'IA
  donne alors le lien de dépôt, où le pro colle l'image en une seconde. Une
  zone de dépôt DANS la conversation (MCP Apps) reste possible plus tard.
- Édition « texte seul » d'une section sans toucher au code.
- Libellés par défaut posés par le Studio CRM (`decorateBlock`, langue de
  l'interface du pro) : ils restent tels quels quand la langue de l'e-mail
  change ; les défauts des blocs Yuno, eux, suivent la langue.
