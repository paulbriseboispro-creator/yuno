# Dépendances exposées — `npm audit` du 18/10/2026

`npm audit --omit=dev --json` sur `package-lock.json` de la branche (aucune mise à
jour faite). npm compte **22 paquets vulnérables** parmi les 885 de `dependencies` :
1 critique, 14 élevés, 6 modérés, 1 faible. Mais `dependencies` contient aussi des
outils de BUILD (`vite-plugin-pwa`, `tailwindcss-animate`, qui tirent `vite`,
`postcss`, `tailwindcss`, `workbox-build`…). Chaque paquet a été remonté jusqu'à la
dépendance directe qui le tire (`package-lock.json`), puis classé selon qu'il part
dans le bundle du navigateur, dans les apps natives, ou nulle part.

## Ce qui part chez l'utilisateur

| Paquet (version) | Où | Avis | Exposition réelle chez Yuno | Correctif |
|---|---|---|---|---|
| `@capacitor/ios` 8.4.1 | **apps iOS** Yuno et Yuno Pro (binaire natif) | **critique** GHSA-rvm3-566m-v7fv (CVSS 9.3) : le chemin interne `/_capacitor_http_interceptor_` est servi à l'origine de l'app ; un lien qui y mène fait charger une page distante **à l'origine de l'app** (accès au `localStorage`, donc à la session Supabase, et aux plugins). Il suffit qu'un utilisateur touche un lien dans la WebView. | Probable : l'app affiche des liens écrits par des tiers (organisateurs, agences : descriptions, linktrees, bios) ; non rejoué sur un appareil. Désactiver `CapacitorHttp` ne protège pas. | **8.4.3** (même ligne 8.4, pas de changement majeur) ; nouveau binaire App Store pour les DEUX apps : ne part pas en OTA. En attendant : petit plugin natif `shouldOverrideLoad` qui refuse ce chemin. |
| `react-router-dom` 6.30.3 (+ `react-router`, `@remix-run/router` 1.23.2) | bundle web | modéré : GHSA-jjmj-jmhj-qwj2 (6.30.2-6.30.5, corrigé en **6.30.6**) ; GHSA-2j2x-hqr9-3h42 (`//` dans une redirection, corrigé en 6.30.4) ; GHSA-wrjc-x8rr-h8h6 (barre oblique inverse dans `<Link>` / `useNavigate`, corrigé **seulement en 7.18.0**) ; GHSA-337j (hydratation SSR : non concerné, Yuno est une SPA) | Faible : il faut que l'app passe un chemin choisi par l'attaquant à `navigate`. Les `?redirect=` sont filtrés (`Auth.tsx` refuse `//` et `/\`, `LoginPage.tsx` aussi) **sauf** `AuthHandoff.tsx:37` et `src/crm/lib/errors.ts:38`, qui ne refusent que `//` : un `redirect=/\evil.example` y passe. `/auth/handoff` exige des jetons valides dans le fragment, ce qui rend l'attaque peu pratique. | 6.30.6 (correctif de la ligne 6) + ajouter le refus de `\` dans les deux filtres. Le passage à React Router 7 est un chantier, pas une mise à jour aveugle. |
| `fflate` 0.8.2 | bundle web | modéré GHSA-px8p-9vwx-vf98 : `unzipSync` boucle sans fin sur un ZIP64 malformé | Faible : `src/crm/lib/fileImport.ts` dézippe le fichier `.xlsx` que le pro importe lui-même ; au pire, son propre onglet se fige. | **0.8.3** (correctif de ligne). |
| `d3-color` 2.0.0 (sous `d3-zoom` / `d3-transition`, tirés par `react-simple-maps`) | bundle web (`OwnerCustomerOrigins`) | élevé GHSA-36jr-mh4h-2g58 : ReDoS au décodage d'une couleur | Nulle en pratique : les couleurs de la carte viennent du code, jamais d'une saisie. | Pas de version 2.x corrigée ; disparaît avec une mise à jour de `react-simple-maps` (à évaluer, pas aveugle). |

## Ce qui ne part pas chez l'utilisateur (outils de build)

`vite` 8.0.x (serveur de dev : contournement de `server.fs.deny` sous Windows,
`launch-editor`), `postcss`, `postcss-selector-parser`, `source-map-js`,
`browserslist`, `baseline-browser-mapping`, `@babel/core`, `nanoid` 3.3.12,
`fast-uri`, `brace-expansion`, `braces`, `micromatch`, `chokidar`, `fast-glob`,
`tailwindcss` 3.x, `tailwindcss-animate`. Ils tournent sur le poste de Paul et dans
Workers Builds, sur du code du dépôt : aucune entrée d'un utilisateur ne les atteint.
Les ranger en `devDependencies` rendrait les prochains `npm audit --omit=dev` lisibles
(changement de rangement seulement, à faire avec un build de contrôle).

## À décider

1. **Capacitor 8.4.3 dans la prochaine version native des deux apps** (le seul point
   sérieux de cette liste). Ce n'est pas un correctif OTA : il faut une version App
   Store (workflow `ios-release.yml`).
2. `react-router-dom` 6.30.6 et `fflate` 0.8.3 : mises à jour de ligne, avec la suite
   de tests et un build.
3. Refuser `\` dans les filtres de `AuthHandoff.tsx` et `src/crm/lib/errors.ts`.
