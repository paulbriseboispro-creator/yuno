// Mot-symbole de la CHAÎNE DE LANCEMENT — source de vérité UNIQUE.
//
// Trois surfaces doivent montrer EXACTEMENT le même dessin, sinon le logo
// saute pendant le démarrage de l'app native :
//
//   1. le Launch Screen natif (ios/App/App/Assets.xcassets/Splash.imageset/) —
//      compilé dans le binaire, il ne part JAMAIS en OTA ;
//   2. le loader inline de index.html (premier pixel de la WebView) ;
//   3. SplashScreen.tsx (« Frame B », le splash animé qui prend le relais).
//
// Le PNG natif porte désormais le wordmark officiel, mais il n'atteint les
// téléphones qu'avec un build approuvé par Apple. Les surfaces 2 et 3, elles,
// partent en OTA sur des binaires DÉJÀ installés : les basculer maintenant
// ferait enchaîner l'ancien Launch Screen sur le nouveau splash. Elles restent
// donc sur l'ancien dessin tant que ce drapeau est false.
//
// ⬅️ Passer à true LE JOUR où le build qui embarque le nouveau Launch Screen
//    est approuvé par Apple — et pas avant. C'est le seul changement à faire :
//    index.html le lit via le plugin `yuno-splash-flag` de vite.config.ts.
export const OFFICIAL_SPLASH_WORDMARK = false;

/** Géométrie du mot dans la chaîne de boot, en px CSS.
 *
 *  Dérivée du Launch Screen natif : le verre y mesure 672 px de haut et la
 *  boîte du mot 880 px de large, pour un écart de 155 px entre le pied du verre
 *  et le haut du mot. Le SVG du loader rend ce même verre sur 197,6 px d'encre,
 *  soit un facteur 0,294 — d'où les valeurs ci-dessous. Le `marginTop` négatif
 *  compense le fond de boîte vide du SVG (265 px de haut pour 215,4 px d'encre).
 */
export const SPLASH_WORDMARK = { width: 259, height: 88, marginTop: -4 } as const;
