# Outillage démo

Prise de contrôle des comptes de démonstration Yuno (club `womber` + organisateurs)
depuis l'agent : données, sessions, et pilotage du vrai front.

```bash
node scripts/demo/audit.mjs                                  # état + verdict
node scripts/demo/drive.mjs --as owner --go /owner/dashboard --shot /tmp/o.png
node scripts/demo/drive.mjs --as organizer --go /organizer-app --headed --keep
node scripts/demo/drive.mjs --as bouncer --device iphone --shot /tmp/porte.png
node scripts/demo/drive.mjs --help
```

## La charte

**Le périmètre démo est la seule chose que cet outillage a le droit d'écrire.**
La prod héberge des clubs réels (Amoris, WOH) dans la MÊME base. Périmètre =
club `womber` + les comptes `@womber.fr` + les soirées qui appartiennent à l'un
ou à l'autre. C'est le périmètre de `is_demo_email()` / `demo_venue_ids()` /
`demo_event_ids()`, la porte que le super admin utilise déjà.

`lib.mjs` l'applique par une garde : `rest.post` / `rest.patch` / `rest.del`
refusent toute requête qui n'est pas épinglée au périmètre par un prédicat
explicite. La lecture, elle, est libre. En cas de doute, la garde refuse — une
garde qui laisse passer ne sert à rien.

Ce qui ne se fait jamais, garde ou pas :

- **Aucun rôle `admin` sur un compte `@womber.fr`.** `demo-login` est publique
  (`verify_jwt = false`) : un compte privilégié derrière elle rouvrirait une
  escalade totale. Corrigé le 2026-08-25, ne pas rejouer.
- **Aucune donnée réelle importée sur un compte démo.** Le mot de passe démo a
  été livré en clair dans des bundles publiés ; tout ce qui vit là est
  consultable par qui l'a lu.
- **Aucun envoi réel** (campagne email, SMS, push) depuis un compte démo vers
  des adresses réelles. Les 12 315 contacts de `organizer@womber.fr` sont là
  pour le RENDU des écrans, jamais pour un envoi. Décision de Paul, 2026-09-21.
- **Pas de rotation du mot de passe démo** (`scripts/rotate-demo-password.mjs`) :
  les bundles déjà publiés le portent en dur.

## Ce que l'outillage sait faire

| Levier | Comment |
|---|---|
| Lire / écrire les données démo | `rest.get/post/patch/del` (`lib.mjs`), service_role + garde de périmètre |
| Ouvrir une session pour n'importe quel rôle | `mintSession(email)` — lien magique signé côté serveur, **sans mot de passe** |
| Appeler une edge function comme un pro démo | `callEdge(nom, corps, accessToken)` (pose l'`Origin` attendue par le CORS-lock) |
| Piloter le vrai front connecté | `drive.mjs` — Chrome via CDP, `click` / `mouse` / `fill` / `type` / `key` / `waitFor` / `shot` |
| Rejouer le décompte à barème sans rien écrire | `supabase db query --linked -f scripts/demo/smoke-night-closing.sql` (DO annulé) |
| Acheter de bout en bout | checkout **simulé** : un acheteur `@womber.fr` ne touche jamais Stripe |

## Pièges déjà payés

- **`verify` veut `token_hash`, pas `token`.** Avec `token`, GoTrue attend l'OTP
  à 6 chiffres et répond `otp_expired` sur un jeton haché — message trompeur.
- **`OnboardingGate` teste la chaîne exacte `'true'`.** Poser `'1'` (ou
  `JSON.stringify(true)`, qui donne `'"true"'`) laisse le quiz de goûts
  recouvrir tout l'écran, y compris un dashboard pro.
- **`#root` reçoit un enfant dès la première frame.** S'arrêter là donne une
  capture noire. `waitForBoot` attend du texte, puis la disparition des
  `.animate-pulse` — sinon on capture une page de rectangles gris.
- **Le semis passe par `Page.addScriptToEvaluateOnNewDocument`**, pas par un
  `setItem` après navigation : il survit ainsi aux rechargements de la SPA.
- **La langue ne suit pas `localStorage.language`.** `LanguageContext`
  resynchronise depuis `profiles.preferred_language` au montage ; chaque compte
  démo a la sienne (le videur répond en anglais). Pour changer vraiment de
  langue, écrire en base.
- **Ni Playwright ni Puppeteer sur cette machine**, et le binaire `browse` de
  gstack sort en 137. CDP en direct avec le `WebSocket` natif de Node 22.

## Piloter le front : `click` ou `mouse` ?

- `page.click('text=…')` fait un `el.click()` : parfait pour un bouton ordinaire.
- `page.mouse('text=…' | '[role="combobox"]' | 'any=Texte')` envoie de VRAIS
  événements souris (`Input.dispatchMouseEvent`) : indispensable pour tout ce
  qui ouvre sur `pointerdown` — Select / DropdownMenu / Popover Radix ne
  s'ouvrent jamais sur `el.click()`. `any=` vise n'importe quel élément visible
  (une ligne de liste), `index` choisit le n-ième. Si l'élément reste hors du
  viewport après défilement (les dashboards pro défilent dans un conteneur
  interne), `mouse` retombe sur `el.click()` : un clic souris hors champ ne
  touche rien, et c'est exactement comme ça que le bouton « Déclarer et
  envoyer » a été « cliqué » trois fois sans effet.
- `page.type(texte)` frappe dans l'élément qui a le focus ; `page.fill(sel, v)`
  passe par le setter natif + `input` (React suit) et convient à tous les
  champs contrôlés, y compris `type="number"`.
- Un checkout ou une RPC met 2 à 6 s : attendre le changement d'URL ou un
  toast (`[data-sonner-toast]`), jamais un `sleep` fixe.

## Parcours collab joué le 2026-09-21

Soirée « Goya Thursday » (club `womber` × `organizer@womber.fr`, barème Goya
`flat`) : proposition depuis `/owner/collaborations` (conditions financières
dans le dialogue), signature depuis `/organizer-app/collaborations` → « Examiner »
→ « Lire et signer le contrat », achats clients (`apple-review@`, `apple-demo2@`,
`promo.lea@`), porte `/bouncer` (onglet List, un tap = un scan), puis dates
poussées dans le passé pour le décompte : club déclare, organisateur accepte
(IBAN posé dans `/organizer-app/payments`), club « J'ai effectué le virement »,
organisateur « Oui, bien reçu ». Les scripts de séance vivaient dans le
scratchpad ; la mécanique réutilisable est ci-dessus.

