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
// L'ASSET NATIF ET CE DRAPEAU SE CHANGENT DANS LE MÊME COMMIT. L'imageset du
// repo porte encore l'ancien dessin, exprès : un binaire dont le Launch Screen
// serait officiel et le splash web en Poppins montrerait le saut qu'on cherche
// justement à éviter — y compris sur un simple build TestFlight.
//
// Recette du jour où on l'embarque (après la mise en ligne de la 1.0.2, qui est
// déjà approuvée et porte l'ancien dessin) — UN SEUL commit :
//   1. bump MARKETING_VERSION dans les deux projets iOS (client + Pro) ;
//   2. `python3 scripts/gen-splash-wordmark.py` (régénère l'imageset) ;
//   3. passer ce drapeau à true ;
//   4. push → Xcode Cloud, puis soumission.
// Les anciens binaires sont protégés par Capgo, mais PAS automatiquement : la
// table `NATIVE_FAMILY` (identique dans `supabase/functions/capgo-updates` et
// `scripts/ota-publish.mjs`) range aujourd'hui 1.0, 1.0.1 et 1.0.2 dans la MÊME
// famille « 1.0 » — un bundle publié atteint donc les trois. Pour que la 1.0.3
// forme sa propre famille et que les binaires à l'ancien Launch Screen ne
// reçoivent jamais un bundle à `true`, il faut justement NE PAS l'ajouter à
// cette table. Voir docs/OTA_CAPGO.md.
export const OFFICIAL_SPLASH_WORDMARK = false;

/** Géométrie du mot dans la chaîne de boot, en px CSS.
 *
 *  Le storyboard contraint l'imageView à 805 pt pour un PNG de 2732 px, soit
 *  3,3938 px/pt sur TOUS les iPhone — c'est ce qui rend le raccord calculable.
 *  Dans le PNG, la boîte du mot fait 880 px de large et son haut tombe 155 px
 *  sous le pied du verre : à l'écran, 259 px de large et 45,7 px sous le verre.
 *
 *  `marginTop` compense le fond de boîte vide du SVG (265 px de haut pour
 *  215,4 px d'encre). `marginBottom` est NÉGATIF et n'est pas cosmétique : la
 *  colonne est centrée verticalement, donc sa hauteur totale décide de la
 *  position du lockup entier. L'ancien texte Poppins occupait une boîte de
 *  106 px pour une encre bien plus courte ; une image, elle, EST son encre. Sans
 *  ce rattrapage, tout le lockup remontait de 3 px par rapport au Launch Screen
 *  — un saut visible au passage du natif au web.
 *
 *  Vérifié en calque « différence » contre le PNG natif : écarts ≤ 1 px sur les
 *  quatre bords, et le résidu disparaît à la première érosion (c'est un liseré
 *  d'anticrénelage, pas un décalage). Même qualité de raccord que l'actuel.
 */
export const SPLASH_WORDMARK = { width: 259, height: 88, marginTop: -4, marginBottom: -6 } as const;
