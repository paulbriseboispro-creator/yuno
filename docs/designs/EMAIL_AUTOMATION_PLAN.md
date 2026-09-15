# Email automations — de l'outil d'envoi au moteur de sold out

> Analyse et plan rédigés le 2026-09-15, puis **implémentés le même jour**
> (migration `20260915120000_email_automations.sql`, module
> `_shared/email-automations.ts`, page Automatisations club + organisateur).
> Statut : livré. Ce document reste la référence du POURQUOI.

## 1. Ce que le marché fait (et ce qui marche vraiment)

Trois familles d'outils servent les pros de la nuit aujourd'hui.

**Les outils email généralistes** — Klaviyo, Mailchimp, Brevo, ActiveCampaign.
Leur valeur est dans les *flows* : bienvenue, panier abandonné, post-achat,
win-back, anniversaire, chacun un interrupteur et un délai. Klaviyo publie
depuis des années le même constat : les flows automatiques font 30 à 40 % du
revenu email avec moins de 5 % du volume envoyé, parce qu'ils partent AU BON
MOMENT pour UNE personne, là où une campagne part au même moment pour tout le
monde. Le panier abandonné est, de loin, le flow au meilleur revenu par email.
Ce qui marche aussi et coûte zéro : le **renvoi aux non-ouvreurs** (même
email, objet différent, 24 à 72 h après) qui ajoute 20 à 30 % d'ouvertures à
une campagne ; et l'**heure d'envoi** choisie sur l'historique d'ouvertures de
la base plutôt qu'au hasard. Ce qui ne marche pas pour un club : le builder de
parcours en drag-and-drop (personne ne le configure), les scores prédictifs
opaques, et surtout le fait que ces outils **ne savent pas qui est venu** —
ils voient un achat, jamais un scan à la porte.

**Les CRM d'événementiel** — Hive.co, Audience Republic. Ils branchent la
billetterie (Eventbrite, DICE, Tixr) pour segmenter par soirées passées et par
genre, et vendent exactement les recettes ci-dessus adaptées à l'événement :
« annonce → dernières places → merci d'être venu → on t'a manqué », liste
d'attente, préventes en avant-première, parrainage. Ils coûtent 200 à 1 000 $
par mois et vivent d'une intégration : la donnée arrive avec retard, sans les
tables, sans la guest list, sans le bar.

**Les billetteries avec marketing intégré** — DICE, Shotgun, Weezevent,
Eventbrite. Rappels automatiques, liste d'attente sur complet, « fans qui
te suivent ». Mais l'email y reste un canal de rappel du billet, pas un outil
de vente : pas de design du pro, pas de segmentation fine, pas d'attribution.

**La leçon pour Yuno.** L'avantage structurel est déjà là : la base se remplit
toute seule (ventes, guest list, imports attestés), l'email vend avec les
vrais chiffres (blocs Yuno live), l'attribution par pilier existe, et Yuno est
LE SEUL à savoir qui a scanné son QR à la porte. Ce qui manquait, c'est que
tout partait à la main. Un pro qui gère trois soirées par semaine n'écrit pas
trois relances par semaine : la conversion se joue sur des envois qu'il ne
fera jamais s'ils ne partent pas seuls.

## 2. Ce qu'on construit (et ce qu'on ne construit pas)

Des **recettes**, pas un builder : chaque recette est un interrupteur, un
délai, un modèle Email Studio (créé d'un clic, retouchable) et un rapport.
Tout passe par le moteur d'envoi existant — file, quota, rodage, liste de
suppression, nuit, liens suivis, attribution par pilier. Une recette ne
contourne jamais le registre de consentement.

| Recette | Déclencheur | Ce que ça change pour le pro |
|---|---|---|
| **Renvoi aux non-ouvreurs** (option de campagne) | N h après la fin de l'envoi, à ceux qui n'ont pas ouvert, avec un objet différent | +20-30 % de lecture sur chaque campagne, sans rien réécrire |
| **Panier abandonné** | Billet ou table lancés au checkout, non payés après N h, avec accord marketing coché | Le flow au meilleur revenu par email de tout le marché |
| **Dernier appel** | N h avant le début, à la base qui n'a ni billet, ni table, ni place en liste invités | La relance de remplissage que personne ne prend le temps d'écrire |
| **Merci d'être venu** | N h après la fin, à ceux qui ont SCANNÉ leur QR, avec la prochaine date | L'email le plus ouvert de la nuit — personne d'autre ne peut le déclencher |
| **On t'a manqué** | N h après la fin, à ceux qui avaient une place et n'ont pas scanné | Ne pas perdre un client qui a payé et n'est pas venu |
| **Bienvenue** | N h après une nouvelle inscription (hors imports et achats) | La première impression, avec la prochaine soirée en carte |
| **Reconquête** | N jours sans venue, une fois par semestre | Le client dormant relancé avant qu'il soit perdu |

Deux compléments hors recettes :
- **La meilleure heure de ta base** (écran Planification) : les ouvertures des
  120 derniers jours par heure et par jour, en heure de Paris. Le pro voit à
  quelle heure SA base lit, au lieu d'envoyer à midi parce que c'est midi.
- **L'assistant IA** liste et active les recettes (outil `set_email_automation`),
  et le mode d'emploi club + organisateur documente tout.

**Ce qu'on ne fait pas** : pas de parcours visuel, pas de score prédictif, pas
d'heure d'envoi par contact (l'historique par personne n'existe pas encore),
pas de WhatsApp (dépend du SMS Twilio, cf. `docs/SMS_MARKETING.md`).

## 3. Garde-fous (ce qui rend la chose vendable à un club)

- **Une recette n'écrit qu'aux contacts du registre de consentement**
  (`newsletter_subscriptions` opt-in de la portée, non supprimés). Le panier
  abandonné verse d'abord dans le registre l'accord coché au checkout, puis
  lit le registre comme tout le monde.
- **Un contact reçoit au plus UNE automatisation par 48 h** par club ou
  organisateur (le panier abandonné, urgent, fait exception). Le dernier appel
  d'un club à trois soirées par semaine ne devient pas trois emails.
- **Exclusions évaluées au moment de l'envoi**, jamais au déclenchement :
  quelqu'un qui a acheté entre-temps n'est jamais relancé. Chaque exclusion est
  écrite avec sa raison dans `email_automation_sends` — le rapport l'explique.
- **Jamais la nuit** : les campagnes enfants portent `quiet_hours = true`.
- **« Merci » et « On t'a manqué » exigent le scan** : sans aucun scan sur la
  soirée, rien ne part — on ne dit pas « on t'a manqué » à quelqu'un qui
  était là.
- **Un bloc Yuno ne part jamais avec des chiffres inventés** : sans soirée à
  relier (bienvenue ou reconquête sans date à venir), les blocs live sont
  retirés de l'email enfant.
- **Le renvoi aux non-ouvreurs** ne repart pas à un acheteur, ni après le
  début de la soirée, ni à un désabonné.

## 4. Architecture (une page)

```
email_automations            une ligne par (portée, recette) : enabled, delay_hours, template_id, subject
email_automation_sends       registre : (automation, trigger_key, email) unique, status queued|skipped + raison
email_campaigns.automation_id / child_kind ('followup' | 'resend' | 'automation')
email_campaigns.resend_*     option de renvoi aux non-ouvreurs, campagne enfant `resend`

collect_email_automations()  cron 5 min (service_role) : candidats par recette → jugement → registre
                             → campagne enfant par (automation, soirée) → file de destinataires
collect_campaign_resends()   cron 5 min : campagnes envoyées depuis N h → enfant « Renvoi » aux non-ouvreurs
get_email_automation_stats() page Automatisations : file, exclus, envoyés, ouvertures, clics, ids des enfants
get_email_send_time_insights() ouvertures par heure / jour (Paris), 120 j
get_campaign_resend_stats()  bilan du renvoi dans le rapport de la campagne mère
```

Le worker `send-campaign` ne change pas : les enfants sont des campagnes
ordinaires en `sending`, remplies contact par contact, drainées par le balayage
du cron, avec les mêmes liens suivis (`yc=`, canal `newsletter`), donc la même
attribution par pilier que n'importe quelle campagne.
