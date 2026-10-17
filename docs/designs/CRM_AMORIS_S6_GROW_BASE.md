# S6 — Faire grandir la base d'Amoris pour le 29/10 (WOH / Club Sonore)

> Session du 17/10/2026, soir. Plan : `CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md` §8 et §11 S6.
> Espace **Amoris** (`06ce47f8-…`), connexion Shotgun de WOH (`55566e29-…`, jamais
> touchée). Soirée : « CLUB SONORE X EXCLUSIVE X WOH & FRIENDS X NONSENSE PARIS »,
> jeudi 29/10, 19:00 → 5:00, Nonsense, 3 rue du Mont-Cenis (Montmartre), miroir
> `01eccd74-…`. **Rien n'est publié, rien n'est envoyé.**

---

## 1. Ce qui est prêt (brouillons)

| Quoi | Où | État |
|---|---|---|
| Page d'inscription « La liste Club Sonore & Friends » (Communauté, FR, prénom + e-mail, affiche, encart « Prochaine soirée », après inscription un bouton « Prendre mon entrée » vers Shotgun) | [Console](https://crm.yunoapp.eu/crm/signup-pages/7b09175a-e458-4592-96b3-1e882211b481/edit) — adresse publique une fois publiée : `crm.yunoapp.eu/j/la-liste-club-sonore-friends` | brouillon, à publier une fois Réglages › Envoi rempli |
| E-mail « Annonce » (J-7, jeudi 22/10) | [Studio](https://crm.yunoapp.eu/crm/emails/studio/d14f24cc-382f-402c-85a6-899303d32d06) | brouillon, 299 destinataires aujourd'hui |
| E-mail « Dernier appel » (J-2, mardi 27/10, sans ceux qui ont déjà leur entrée) | [Studio](https://crm.yunoapp.eu/crm/emails/studio/819f3e24-eff9-47ce-809a-f42e3fe05552) | brouillon, 297 destinataires aujourd'hui |
| Liens `/go/` de la soirée | Soirée › onglet « Liens de partage » | créés, inertes tant qu'ils ne sont pas postés |

**Liens à poser** (chacun ouvre la page Shotgun avec sa source Yuno) :

| Où le coller | Lien |
|---|---|
| Sticker lien d'une story Instagram | `yunoapp.eu/go/k36ji7zx` (« Story 1 » ; une story de plus = un lien de plus, bouton « Nouvelle story ») |
| Lien en bio Instagram | `yunoapp.eu/go/gsq55idg` |
| Lien en bio TikTok | `yunoapp.eu/go/jfmeirzg` |
| Bouton de la page d'inscription (déjà posé dans le brouillon) | `yunoapp.eu/go/d4z36e21` |

Toujours `yunoapp.eu/go/…`, jamais `crm.yunoapp.eu/go/…` (ce dernier part en 301 vers la landing, qui rend 404).

Les deux e-mails : en-tête aux couleurs de l'affiche (bordeaux, crème), affiche en
JPEG (le WebP de Shotgun ne s'affiche pas dans Outlook), puis les blocs Yuno **en
direct** : line-up avec photos (MaisonBlanche, Felmann), tarifs relus sur Shotgun
au moment de l'envoi (gratuit avant minuit, dîner, 10 € avant 1 h, 15 € toute la
nuit), compte à rebours dans le dernier appel. Audience « Toute la base » = une
règle relue à l'envoi : les contacts importés depuis Brevo y entreront seuls. Le
dernier appel n'exclut PAS « a reçu un e-mail il y a moins de 3 jours » (sinon une
annonce envoyée tard le viderait) ; la politique d'envoi Yuno protège toujours de
l'excès. Envoyer vers 18 h (rien ne part entre 23 h et 9 h).

---

## 2. Pas à pas : la liste Brevo de WOH → Yuno CRM

### A. Dans Brevo (5 minutes)

1. **Contacts**, puis la liste de WOH (ou « Tous les contacts »).
2. **Ne garder que les abonnés** : filtre sur le statut d'abonnement aux e-mails
   (abonné, pas « blocklisté » / désinscrit). Après la mise en ligne de cette
   branche, Yuno écarte aussi seul les désabonnés si la colonne est dans le
   fichier ; **avant, ce filtre est obligatoire.**
3. Cocher la case de la colonne **Contact** (tout sélectionner), puis
   **Plus d'actions › Exporter**.
4. Attributs : **E-mail, Prénom, Nom**, et le **statut d'abonnement / blocklist**
   s'il est proposé. Ne PAS cocher SMS / téléphone, sauf si WOH a l'accord SMS de
   ces personnes (voir B3).
5. Séparateur : point-virgule ou virgule, les deux passent.
6. Le fichier arrive par e-mail (lien de téléchargement) ou dans la cloche des
   notifications de Brevo : télécharger le CSV.

Les libellés exacts de Brevo n'ont pas pu être relus (leur aide refuse les
robots) : si un mot diffère, le geste reste le même.

### B. Dans Yuno CRM (crm.yunoapp.eu, espace Amoris)

1. **Clients › Imports**, déposer le fichier.
2. **« Reliez vos colonnes »** : E-mail → E-mail, Prénom, Nom. La colonne de
   désinscription doit dire **« Désabonné / statut d'abonnement »**. Une date de
   modification (« Last Changed », « Dernière modification ») doit dire « Ne pas
   importer » ; la date de création peut rester « Première venue / ajout ».
3. **Téléphone / SMS : « Ne pas importer »**, sauf accord SMS. La réponse
   « Ils ont accepté » vaut pour l'e-mail ET le SMS.
4. **« Ces personnes vous ont-elles donné leur accord ? »** → « Ils ont accepté de
   recevoir mes messages » seulement si ce sont des abonnés à la newsletter de WOH.
   La réponse est horodatée au nom du titulaire : c'est la preuve.
5. **« Vérifier les doublons »**, lire les rangées : Nouveaux, Déjà dans votre base
   (les acheteurs Shotgun déjà connus), En double, À corriger, Désabonnés dans le
   fichier.
6. Pour les déjà présents : **« Compléter leur fiche »**.
7. **« Ajouter N contacts »**. L'import s'annule en entier depuis l'historique des
   imports.
8. **Attendre 5 minutes** : la base d'Amoris (17 000 contacts) se recalcule toutes
   les 5 minutes ; le compteur des deux brouillons monte ensuite tout seul.

**Testé le 17/10** sur 2 adresses à toi (`paul.brisebois.pro+s6a@…`, `+s6b@…`),
en tant que le titulaire, dans des transactions annulées : liste créée et attestée,
accords posés (`opted_in`), annulation propre, contact compté dans l'audience après
recalcul (299 → 300, recalcul 1,6 s). Rien n'est resté en base.

---

## 3. Vérifié

- `yunoapp.eu/go/<code>` → 302 vers Shotgun avec `utm_source=yuno-<code>`,
  `utm_medium` = emplacement ; `?t=1` redirige sans compter.
- Onglet « Liens de partage » : « en attente » avant la première vente
  (`confirmed: false`) ; une vente simulée portant `yuno-k36ji7zx` (transaction
  annulée) le fait passer à `confirmed: true`, 1 billet et 15 € sur « Story 1 ».
- Aucune automatisation ni scénario allumé sur Amoris : un import ne déclenche
  aucun envoi.
- Les 16 billets actuels de la soirée sont tous des entrées gratuites (0 €).
- Après la fin de l'essai (19/10 10:14), l'import et les inscriptions marchent
  encore ; seuls les envois (campagnes, relances de la page) sont refusés →
  « Offrir Yuno CRM » à Amoris avant lundi (S0).

---

## 4. Décisions avant de publier la page ou d'envoyer

1. **Le nom — réglé le 17/10 (choix de Paul).** La page `/j/` (case d'accord,
   pied de page, e-mail de confirmation, relances) et le kit MCP prennent le **nom
   d'expéditeur** de Réglages › Envoi quand il est rempli (migration
   `20261019120000`, en prod ; Console : `useSignupHost`). Le pied des e-mails est
   signé par la **raison sociale** (S3, `footerSigner`). Il reste à Paul de
   remplir Réglages › Envoi d'Amoris : nom d'expéditeur (« WOH » ou « Club
   Sonore », ce que Shotgun leur a montré), raison sociale et adresse postale de
   WOH. Tant que ce n'est pas fait, la page dit encore « Amoris » et S3 bloque
   l'envoi. Le logo, la ville et l'Instagram de la page restent ceux d'Amoris (la
   page sur mesure du 29/10 ne les affiche pas).
2. **« FESTIV DINNER : Gratuit »** apparaît dans les tarifs des deux e-mails
   (tarif à 0 € chez Shotgun). Si le dîner se paie sur place, le décrocher dans le
   bloc Billetterie du Studio, sinon on promet un dîner gratuit.
3. **Le texte « Prochaine : jeudi 29 octobre »** de la page Communauté est écrit
   en dur (une page Communauté n'a pas de soirée) : à retirer ou changer après
   le 29.

---

## 5. Frictions

### Corrigées dans la branche `crm/s6-grow-base` (à fusionner, puis Cloudflare se déploie seul ; redéployer `owner-assistant`)

| Commit | Problème | Effet avant |
|---|---|---|
| `80103c2d` | La CSP de yunoapp.eu / crm.yunoapp.eu bloquait `assets.shotgun.live` | les 281 affiches de la vraie connexion invisibles dans la Console (Soirées, Studio) et sur une page `/j/` ; la démo, hébergée chez nous, ne le montrait pas |
| `7e4a96bd` | Import d'un export Brevo : « Last Changed » devenait le NOM, « Dernière modification » le DERNIER ACHAT ; la colonne de désinscription était ignorée | noms remplacés par des dates, cycle de vie faussé, désabonnés de Brevo importés comme consentants |
| `39f465c6` | Aide CRM et assistant | la règle est dite (FAQ ×3, article `crm-segments`) |
| `ed31995d` | Page `/j/`, confirmation, relances, kit MCP : le nom d'expéditeur des Réglages d'envoi, plus « Amoris » (migration `20261019120000`, appliquée) | les fans lisaient « prévenu(e) par Amoris » |
| `8f63c587` | Page Communauté sans récompense : `rewardFanText` ignorait l'interrupteur | message de bienvenue promettant « une boisson offerte à la porte », confirmation « Ta récompense t'attend » |

### Pour Paul (pas petit, ou décision)

1. Une seule attestation pour e-mail ET SMS à l'import : un pro qui a l'accord
   e-mail de sa liste Brevo atteste aussi le SMS s'il garde la colonne téléphone.
   À séparer (deux cases).
2. L'import ne demande pas d'où vient l'accord (formulaire, achat, Brevo) :
   `consent_source = 'other'` pour tout import CRM, preuve plus faible que celle
   de l'import de la Billetterie.
3. Après un import, « Voir mes clients » est proposé tout de suite, mais un compte
   de plus de 3 000 contacts ne voit les nouveaux qu'après le recalcul (≤ 5 min).
   Le dire à l'écran, ou recalculer à la fin de l'import (1,6 s sur Amoris). À
   voir avec S4, qui réécrit `contact_base_cache_refresh` : un import doit rester
   recalculé.
4. Prix d'appel : `priceFromLabel` dit « À partir de 10 € » quand une entrée
   gratuite est ouverte (le plus petit prix PAYANT gagne). Même règle que les
   pages publiques ; sur ce compte (79 % de billets gratuits) c'est trompeur. Les
   deux brouillons ne s'en servent pas.
5. Une soirée Shotgun n'a pas de nom de lieu (`event.venue` = l'adresse) : il a
   fallu écrire « Nonsense » à la main.
6. Types de page : « Je viens » dit « Soirée sur liste, confirme ta venue pour être
   sur la liste » et son accord ne couvre que « cette soirée » ; il ne convient
   pas à une soirée dont l'entrée se prend sur Shotgun. Il manque un type « pour
   une soirée Shotgun » (accord pour les prochaines soirées + lien vers la
   billetterie), d'où la page Communauté avec une section sur mesure.
7. `crm.yunoapp.eu/go/…` part en 301 vers `landing.yunoapp.eu/go/…`, qui rend 404 : ajouter
   `/go` aux chemins relayés de la landing (dépôt Yuno-landing) si quelqu'un
   recopie l'adresse depuis le domaine CRM.
8. Kit MCP : `language_hint` vaut « en » pour Amoris alors que la soirée est à
   Paris ; et le kit e-mail rend le poster en WebP (Outlook ne l'affiche pas).

---

## 6. Écrit en prod pendant la session

- 4 liens `tracked_links` sur la soirée miroir (codes ci-dessus), créés par
  `crm_link_create` en tant que le titulaire.
- 1 page `crm_signup_pages` en brouillon (`7b09175a-…`).
- 2 campagnes `email_campaigns` en brouillon (`d14f24cc-…`, `819f3e24-…`).
- 2 images dans `email-assets/mcp/` (affiche WebP pour la page, JPEG pour les e-mails).
- Une migration : `20261019120000_crm_signup_host_sender_name` (après celles
  de S1, S3 et S4), répétée dans une transaction annulée puis appliquée.
  Tests d'import, d'audience et d'attribution : transactions annulées.
