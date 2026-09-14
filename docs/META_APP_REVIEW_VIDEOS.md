# Meta App Review — plan de tournage des vidéos

> Pour Paul. Une vidéo par permission (Meta rejette une vidéo commune),
> chacune de 1 à 3 minutes, sans montage, en anglais à l'écran. Le reviewer
> doit voir : où l'utilisateur se connecte avec Facebook, où il accorde la
> permission, et l'écran de Yuno qui UTILISE la donnée obtenue. Tout ce qui
> est décrit ici existe dans le produit.

---

## 0. Préparer le plateau (une fois, 45 min)

1. **Un portefeuille Meta qui n'est pas Yuno.** L'entreprise propriétaire de
   l'app ne peut pas s'y connecter : crée un portefeuille « Yuno Demo Club »
   (business.facebook.com → Créer un compte), avec :
   - une Page Facebook « Womber Club » (ou un nom neutre),
   - un compte publicitaire avec un moyen de paiement (une carte, aucune
     dépense ne partira : tout reste en pause),
   - un jeu de données / pixel « Womber Club pixel » (Events Manager →
     Connecter des sources de données → Web),
   - si possible un compte Instagram professionnel relié à la Page (sinon,
     la vidéo `instagram_basic` montrera simplement l'actif proposé).
   Le compte Facebook qui administre ce portefeuille doit être **testeur**
   (ou admin) de l'app Meta (Rôles → Testeurs).
2. **Yuno côté pro** : connecte-toi sur https://yunoapp.eu au club démo
   (compte `@womber.fr`, DemoSwitcher `?demo=1`). Les comptes démo et le
   super admin voient les vraies pages Meta même si elles sont « En
   construction » pour les autres. Langue de l'interface : **English**
   (Profil → langue), le reviewer ne lit pas le français.
3. **Une soirée à venir** publiée sur le club démo, avec affiche.
4. **Enregistreur d'écran** : QuickTime (Fichier → Nouvel enregistrement de
   l'écran) ou Cmd+Shift+5. Fenêtre du navigateur seule, barre d'adresse
   visible, 1280×800 minimum. Pas de son nécessaire ; si tu parles, en
   anglais. Format .mp4 ou .mov, moins de 100 Mo.
5. **Déconnecte Meta** dans Réglages → Intégrations avant chaque vidéo qui
   doit montrer la connexion (les cinq premières) : le reviewer veut voir la
   fenêtre Facebook Login for Business à chaque fois.

Astuce : enregistre UNE longue prise propre du parcours complet (connexion →
choix des actifs → santé → audience → campagne → leads), puis découpe-la en
extraits par permission, chacun commençant par la connexion. Sans montage à
l'intérieur d'un extrait.

---

## 1. Ce que chaque vidéo doit montrer

Structure commune (30 s) : page d'accueil yunoapp.eu → connexion au compte
pro → Settings → Integrations → clic **Connect with Facebook** → fenêtre
Meta : choix du portefeuille « Yuno Demo Club », des actifs, écran des
permissions (laisser tout coché) → retour sur Yuno « Meta connected ».

| # | Permission | Après la connexion, montrer | Phrase pour le champ « comment vous l'utilisez » |
|---|---|---|---|
| 1 | `business_management` | La fenêtre Meta liste les actifs du portefeuille ; au retour, si plusieurs pixels, l'écran « Pick your pixel » (pixel, compte pub, Page) puis Confirm. | Yuno lists the pixels, ad accounts and Pages of the business the club authorizes, so the club can choose which ones to connect. Nothing else is read from the business. |
| 2 | `ads_read` | Carte Meta → **Check now** : validité, permissions accordées, qualité de correspondance. Puis Marketing & CRM → **Ads** → **Check account** (devise, moyen de paiement) et, sur une campagne existante, **Refresh** : dépense, impressions, clics. | Yuno reads the ad account status and the campaign insights (spend, impressions, clicks, purchases) to show the club the results of the ads it launched from Yuno, next to the tickets those ads sold. |
| 3 | `ads_management` | Ads → Audiences → **Create an audience** → « Buyers, last 12 months » → **Send to Meta** (statut ready). Puis **Boost an event** → les cinq écrans → **Create paused** → la campagne apparaît en pause ; ouvrir Ads Manager dans un autre onglet pour montrer la campagne créée en PAUSED. Puis **Activate** / **Pause**. | Yuno creates custom audiences from the club's consenting contacts, and creates ad campaigns (campaign, ad set, creative, ad) in the club's ad account from an event page, always paused; the club activates, pauses and archives them from Yuno. |
| 4 | `pages_show_list` | Dans la fenêtre Meta, la liste des Pages ; au retour, l'écran « Pick your pixel » montre la Page choisie ; Integrations → carte Meta → section Connection. | Yuno lists the club's Facebook Pages so the club picks the Page its ads and lead forms belong to. |
| 5 | `pages_read_engagement` | Idem 4, puis Ads → **Boost an event** → écran Creative : l'aperçu montre la Page comme identité de la pub (« Your Page · Sponsored »). | Yuno reads the Page's name and identity to build the ad creative under the club's Page. |
| 6 | `pages_manage_ads` | Ads → **Boost an event** → **Create paused** : la pub est créée au nom de la Page. Puis section Leads → **Enable collection**. | Yuno creates ads published under the club's Page and subscribes the Page's lead forms so the club receives its leads in Yuno. |
| 7 | `pages_manage_metadata` | Ads → section Leads → **Enable collection** → badge « Collection active ». (C'est l'abonnement de la Page au webhook `leadgen`.) | Yuno subscribes the club's Page to the leadgen webhook so new lead form submissions are delivered to Yuno in real time. |
| 8 | `leads_retrieval` | Dans Ads Manager (autre onglet), créer une pub « Formulaire instantané » de test sur la Page, ou utiliser l'outil de test des leads (developers.facebook.com/tools/lead-ads-testing) → soumettre un lead → revenir sur Yuno → section Leads : le lead apparaît (nom, email, « in base »). Puis Marketing & CRM → Customers ou Email campaigns : le contact est dans la base. | Yuno retrieves the content of lead forms submitted on the club's ads and adds the person to the club's contact base with proof of consent, so the club can follow up by email. |
| 9 | `instagram_basic` | Dans la fenêtre Meta, l'actif « Instagram accounts » ; au retour, Ads → **Boost an event** → Creative : placement Instagram activé et pub créée sous l'identité Instagram du club (visible dans Ads Manager → Identité). | Yuno reads the Instagram business account linked to the Page so the club's ads run under its Instagram name instead of its Facebook Page only. |

Pour **Marketing API Access Tier (Full Access)** : pas de vidéo depuis mai
2026. Le formulaire demande un texte : « Yuno is a nightlife ticketing
platform. Clubs and organizers connect their Meta business to Yuno (Facebook
Login for Business) and, from an event page, create paused campaigns in
their own ad account, sync consenting customer audiences, and read insights.
Yuno never spends on their behalf: activation is an explicit click. »

---

## 2. Instructions de test à fournir au reviewer (champ « Notes »)

À coller telles quelles, en remplaçant les identifiants :

```
Test account (Yuno pro dashboard): https://yunoapp.eu
  email: <compte @womber.fr>   password: <mot de passe démo>
This is a demo club. Steps:
1. Log in, open Settings → Integrations, click "Connect with Facebook".
2. Authorize with a Facebook account that admins a Business portfolio owning
   a Page, an ad account and a dataset (pixel). Keep every asset and
   permission checked. If you have no business, use our test business
   "Yuno Demo Club" (request access: <email>).
3. Back on Yuno, pick the pixel/ad account/Page if asked, then click
   "Check now" (ads_read, business_management).
4. Open Marketing & CRM → Ads. "Check account" reads the ad account.
   "Create an audience" → "Buyers, last 12 months" → "Send to Meta"
   (ads_management, custom audiences). "Boost an event" → 5 steps →
   "Create paused": a PAUSED campaign appears in your Ads Manager
   (ads_management, pages_read_engagement, instagram_basic).
5. In the Leads section click "Enable collection" (pages_manage_metadata,
   pages_manage_ads). Submit a test lead with the Lead Ads testing tool on
   the connected Page: it appears in the Leads list within a minute
   (leads_retrieval).
Data deletion callback: https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/meta-connect/data-deletion
Privacy policy: https://yunoapp.eu/legal/confidentialite
```

Le mot de passe du club démo vit dans le secret Supabase `DEMO_LOGIN_PASSWORD`
(`supabase secrets list` ne l'affiche pas en clair ; il est dans ton gestionnaire
de mots de passe / le dashboard Supabase). Ne le mets nulle part dans le repo.

---

## 3. Erreurs qui font rejeter

- Une seule vidéo pour plusieurs permissions, ou une vidéo sans la fenêtre
  de connexion Facebook.
- Une vidéo qui montre Ads Manager plutôt que Yuno utilisant la donnée.
- Texte d'usage générique (« pour gérer les pubs ») : reprends les phrases du
  tableau, elles disent QUOI, POUR QUI et POURQUOI.
- Le reviewer ne peut pas reproduire : compte de test qui ne marche pas,
  app en mode Live sans accès accordé, ou page « En construction » (les
  comptes démo la voient live, vérifie avant d'envoyer).
- URL de suppression des données absente ou qui ne répond pas (la nôtre
  répond ; teste-la depuis App Dashboard → Paramètres → « Tester »).
- Une permission demandée sans usage visible : si tu n'as pas pu filmer
  `leads_retrieval` faute de lead de test, retire-la du dossier et redemande
  plus tard, plutôt que d'essuyer un rejet global.

---

## 4. Ordre conseillé de tournage (1 h 30)

1. Prise longue : connexion → choix des actifs → Check now (vidéos 1, 2, 4).
2. Check account → audience → Boost → Create paused → Ads Manager → Activate/Pause (vidéos 3, 5, 6, 9).
3. Enable collection → lead de test → Leads → contact dans la base (vidéos 7, 8).
4. Découpe, nomme chaque fichier par sa permission, téléverse dans App
   Review → chaque permission → « Ajouter une vidéo » + le texte du tableau.
5. Soumets. Compte 5 à 20 jours ouvrés ; réponds sous 48 h à toute demande
   de complément, sinon le dossier expire.
