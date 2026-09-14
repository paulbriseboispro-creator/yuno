# Yuno Marketing — de « l'email qui marche » au moteur d'acquisition

> Réflexion produit rédigée le 2026-09-14 après le test en club du week-end
> (orga Woh). Statut : **proposition, rien d'implémenté.** À passer en
> `/plan-ceo-review` avant de coder.

## 1. Le constat

Ce que les pros ont aimé : l'email marketing est **intégré** (les clients
arrivent tout seuls dans la base par les ventes et la guest list), **prêt**
(Email Studio, modèles, blocs live avec les vrais tarifs, envoi de masse), et
**quasi gratuit** (15 000 emails / mois offerts, crédits à prix coûtant).

Ce qui manque pour en faire un moteur d'acquisition et pas seulement un outil
d'envoi, en trois mots : **capturer, automatiser, mesurer.**

| Étage | Aujourd'hui | Trou |
|---|---|---|
| Capture | guest list, checkout, import de fichier, follow | aucun point de capture *hors* achat : flyer, porte, bar, Instagram, pub |
| Automatisation | win-back 90 j, anniversaire, relance après clic, rappels | rien avant / après la soirée pour un contact qui n'a pas encore acheté |
| Mesure | rapport par campagne, attribution 72 h par pilier | aucune vue « d'où viennent mes clients et combien ils me rapportent » |
| Canaux | email (live), SMS (codé, éteint), push app | pas de pub Meta, pas de WhatsApp |

L'avantage structurel de Yuno sur Mailchimp / Brevo / Klaviyo : **on sait qui
est venu, ce qu'il a acheté et quelle formule il a prise.** Toute la suite doit
exploiter ça. On ne construit pas un Mailchimp, on construit *l'outil de
marketing d'une soirée*.

## 2. Les quatre chantiers

### A. Capturer — « chaque personne qui touche la soirée entre dans la base »

1. **QR de capture (« Yuno Capture »).** Un QR par club / organisateur / soirée
   qui ouvre une page de 1 écran : email ou téléphone + consentement + une
   récompense choisie par le pro (guest list prioritaire, boisson offerte,
   prévente en avant-première). Affiché sur le flyer, l'écran du bar, un
   chevalet à la porte, la story Instagram. C'est le geste physique que les
   clubs font déjà avec un carnet ou un lien Linktree, ramené dans la base
   avec consentement horodaté.
   Techniquement : nouvelle table `capture_forms` (portée club OU orga, même
   modèle que `contact_segments`), RPC SECURITY DEFINER d'inscription qui
   écrit dans `newsletter_subscriptions` / `venue_sms_contacts` avec
   `source = 'capture:<form>'`, page publique `/c/<code>` sur la DA publique,
   lien suivi pour l'attribution. Chaque formulaire devient un **segment**
   (comme un fichier importé).

2. **Capture aux points de contact existants.** Trois cases à cocher qui
   existent déjà par pilier (accords marketing du 11/09), et deux qui
   manquent : le **scan à la porte** (le videur voit « pas dans la base » et
   propose l'inscription en un tap, ou mieux le QR d'entrée redirige vers la
   page merci avec opt-in) et la **commande de boisson au QR** (la commande
   est un moment où le client a le téléphone en main et veut sa boisson :
   une case « me prévenir des prochaines soirées », rien de plus).

3. **Parrainage client.** Un client reçoit un lien unique après achat / entrée
   guest list ; l'ami qui vient par ce lien fait gagner une récompense aux
   deux (entrée guest list, boisson, remise). S'appuie sur les liens suivis
   existants (`/l/<code>` = un canal `referral` par personne) et sur le pilier
   fidélité. Différenciant : aucun outil email ne sait *qui est venu* pour
   déclencher la récompense au scan.

4. **Meta Lead Ads → base Yuno.** Le pro branche sa page Facebook / Instagram
   une fois ; les formulaires « Lead Ads » (inscription dans l'app Instagram
   sans quitter le feed) arrivent par webhook dans `newsletter_subscriptions`
   avec la preuve de consentement, comme un import attesté. Le coût pub
   remonte avec le lead → coût par contact visible.

5. **Liste d'attente par intention** : « prévenez-moi » sur une soirée
   complète, un genre, un club sans date à venir. La base grossit sur ce que
   le client *veut*, pas seulement sur ce qu'il a acheté.

### B. Automatiser — des parcours, pas des envois

6. **Parcours prêts à l'emploi (pas de builder visuel).** Cinq recettes,
   chacune un interrupteur + un délai, rendues avec les modèles du pro :
   - *Bienvenue* : J0 après capture, avec la récompense promise.
   - *Avant la soirée* : J-7 annonce à la base ciblée, J-2 « il reste X
     tables / le palier passe à… » (données live), J0 matin dernier appel.
   - *Après la soirée* : J+1 « merci d'être venu » + photos + prochaine date,
     réservé à ceux qui sont VENUS (scan), et « on t'a manqué » à ceux qui
     avaient un billet ou une place et ne sont pas venus.
   - *Panier / résa abandonnée* : checkout Stripe ouvert non payé, à 1 h.
   - *Win-back / anniversaire* (existent).
   Mécanique : même dispatcher que `customer-automations.ts`, ledger
   `venue_automation_sends`, mêmes garde-fous anti-spam. Chaque parcours a
   une case « je rédige moi-même » (Email Studio) ou « laisse Yuno écrire ».

7. **Recap photo de la soirée.** Le pro dépose ses photos (déjà des affiches
   et vidéos dans le Storage), Yuno envoie le lendemain « tes photos de
   samedi » aux présents. C'est le mail le plus ouvert de la nightlife, et le
   plus partagé sur Instagram : acquisition gratuite par les clients.

8. **IA qui rédige depuis la donnée.** L'owner-assistant existe déjà ; lui
   donner un tool `draft_campaign(event_id, audience)` qui produit objet +
   blocs à partir du line-up, des tarifs, du taux de remplissage. Objectif :
   une campagne complète en 30 secondes, jamais une page blanche.

9. **WhatsApp Business** (Cloud API, modèles approuvés, opt-in explicite).
   En France et en Espagne c'est le canal qui convertit le mieux pour la
   nuit. Même moteur que le SMS (file, crédits, STOP), un canal de plus dans
   `SmsCampaignsPanel`. À faire APRÈS l'allumage du SMS Twilio, pas avant.

### C. Mesurer — « d'où viennent mes clients et combien ils rapportent »

10. **Cockpit marketing** (une page, club ET orga) : croissance de la base par
    semaine, **source de chaque contact** (checkout, guest list, capture QR,
    import, pub, parrainage), revenu attribué par canal et par campagne,
    coût par contact et par client quand un coût existe (pub, SMS, crédits),
    valeur à 90 jours par source d'acquisition. Une RPC agrégée démo-safe,
    comme les RPC du dashboard super admin ; tout le formatage par les
    helpers existants.

11. **Attribution unifiée.** Aujourd'hui email (72 h), push et promoteurs ont
    chacun leur RPC. Une table `attribution_touches` (contact, canal, campagne
    ou lien, horodatage) alimentée par les liens suivis, les `yc=` et les
    `?an=` / `?pc=` existants, et une seule règle (dernier clic 7 j,
    lisible) qui sert tous les rapports. Le multi-touch viendra après.

12. **Repères Yuno.** « Ton taux d'ouverture est de 41 %, la médiane des
    clubs Yuno de ta ville est 33 %. » L'infrastructure de benchmarks
    anonymes existe côté Audience ; l'étendre aux campagnes est presque
    gratuit et c'est un moat : Mailchimp ne connaît pas la nuit.

### D. Pub Meta — le chantier « à partir de zéro » qui différencie

> Recherche complète et plan d'implémentation détaillé :
> `docs/designs/META_ADS_INTEGRATION_PLAN.md` (2026-09-14).

13. **Pixel + Conversions API par pro.** Le pro colle son identifiant de
    pixel ; Yuno pose le pixel côté page publique (consentement CMP web) ET
    envoie les conversions côté serveur depuis le webhook Stripe (billet,
    table, boisson) avec le montant. Résultat : Meta optimise sur les *vrais*
    achats et le pro voit son ROAS dans Ads Manager. C'est ce que DICE et
    Shotgun offrent ; sans ça un club qui fait de la pub ne peut pas rester
    sur Yuno.

14. **Audiences synchronisées.** Les segments Yuno (venus 3 fois, table VIP,
    abonnés d'un genre…) poussés en Custom Audiences Meta (contacts
    consentants, hachés côté serveur) ; Meta fabrique les lookalikes. Le
    pro cible des gens qui ressemblent à ses meilleurs clients au lieu de
    « 18-30 ans Paris ».

15. **« Booster la soirée »** : depuis la fiche soirée, un bouton crée la
    campagne Meta (visuel = affiche, lien = lien suivi, audience = lookalike
    des acheteurs, budget saisi) et rapporte billets / tables vendus par la
    pub dans le cockpit. Yuno peut prendre une marge sur le budget géré ou
    le réserver au palier Pro. C'est le vrai produit « acquisition » ; les
    étapes 13 et 14 sont ses prérequis.

Contraintes à connaître avant de vendre l'idée : l'app Meta doit passer la
**vérification business et l'App Review** pour `ads_management`,
`leads_retrieval`, `pages_manage_ads` (plusieurs semaines, à lancer tôt) ;
les Custom Audiences exigent un consentement explicite et le respect des
conditions Meta ; le pixel web tombe sous le CMP existant (natif = pas de
pixel, la CAPI serveur suffit).

## 3. Ordre proposé

| Phase | Contenu | Pourquoi d'abord | Humain / CC+gstack |
|---|---|---|---|
| 1 | QR de capture + capture porte/bar + segments par formulaire (A1, A2) | zéro dépendance externe, visible dès la prochaine soirée | 2 sem / 2 j |
| 2 | Parcours avant / après soirée + recap photo + IA rédactrice (B6, B7, B8) | transforme la base capturée en ventes, tout le moteur existe | 3 sem / 3 j |
| 3 | Cockpit marketing + attribution unifiée (C10, C11) | rend le ROI lisible avant d'introduire des coûts pub | 2 sem / 2 j |
| 4 | Parrainage + liste d'attente (A3, A5) | viralité, s'appuie sur la fidélité et les liens suivis | 2 sem / 2 j |
| 5 | Meta : pixel + CAPI, puis audiences, puis Lead Ads, puis « Booster » (D13→A4→D15) | dépend de l'App Review Meta : **déposer la demande dès la phase 1** | 4 sem / 5 j + délai Meta |
| 6 | SMS allumé, puis WhatsApp (B9) | dépend du numéro Twilio et des modèles WhatsApp | 2 sem / 2 j |

## 4. Ce qui différencie vraiment (à mettre en avant)

- **La base se remplit toute seule** : ventes, guest list, porte, bar, QR,
  pub. Aucun outil généraliste n'a la porte du club.
- **On sait qui est VENU** : recap photo aux présents, relance aux absents,
  parrainage récompensé au scan. Personne d'autre ne peut déclencher ça.
- **Le mail vend avec les vrais chiffres** : formules live, paliers, tables
  restantes. Déjà là, à raconter.
- **La pub optimise sur de vrais achats** et le club voit ce que chaque euro
  rapporte, par pilier.
- **Prix coûtant sur l'envoi, valeur sur la croissance** : cohérent avec
  la stratégie pricing (le moteur de croissance est ce qu'on monétise, jamais
  le droit de vendre).

## 5. Ce qu'on ne fait pas

- Pas de builder de parcours visuel (drag and drop) : des recettes.
- Pas de rich-text : l'Email Studio reste la seule surface de composition.
- Pas de pixel dans l'app native ; la CAPI serveur couvre le natif.
- Pas de « boost » Meta avant que le pixel + CAPI aient prouvé l'attribution.
- Aucun contact n'entre dans une campagne sans passer par le registre de
  consentement : les sources nouvelles (QR, Lead Ads, parrainage) sont
  **versées** dans `newsletter_subscriptions` / `venue_sms_contacts`, jamais
  lues à l'envoi.
