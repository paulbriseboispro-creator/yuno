import type { CapacitorConfig } from '@capacitor/cli';

// App « Yuno Pro » — staff en club (barman, videur, vestiaire, hôte VIP) et
// promoteurs. MÊME bundle web que l'app B2C (webDir ../dist) : la seule
// différence est cette coquille native. `appendUserAgent: 'YunoPro'` permet à
// isProApp() (src/lib/native.ts) de détecter l'app de façon synchrone —
// ProAppGate inverse alors le routing (routes staff autorisées, B2C redirigé).
const config: CapacitorConfig = {
  appId: 'eu.yunoapp.pro',
  appName: 'Yuno Pro',
  webDir: '../dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#050505',
  },
  appendUserAgent: 'YunoPro',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      // Voir capacitor.config.ts (client) : le splash natif est tenu par Capgo
      // le temps d'appliquer la MàJ OTA au premier lancement post-installation.
      launchAutoHide: false,
      backgroundColor: '#050505',
    },
    CapacitorUpdater: {
      // Capgo OTA auto-hébergée sur Supabase : seconde app eu.yunoapp.pro. Le
      // MÊME zip de bundle est référencé que le B2C (stockage content-addressed),
      // mais l'app_id eu.yunoapp.pro a ses propres lignes ota_bundles/canaux, donc
      // on peut promouvoir/rollback Pro indépendamment. Voir docs/OTA_CAPGO.md.
      // `atInstall` : au TOUT PREMIER lancement après une installation depuis
      // l'App Store (ou une MàJ native), le bundle OTA est téléchargé ET
      // appliqué AVANT que l'utilisateur voie l'app — plus besoin de fermer et
      // rouvrir. Ensuite, comportement normal (`atBackground`) : téléchargement
      // au premier plan, application au passage en arrière-plan, donc aucun
      // délai sur les lancements quotidiens.
      autoUpdate: 'atInstall',
      // Le splash natif couvre ce téléchargement (17-18 Mo) au lieu de laisser
      // flasher l'ancien bundle embarqué puis recharger.
      autoSplashscreen: true,
      autoSplashscreenLoader: true,
      // Réseau lent : au-delà de 12 s on rend la main, le téléchargement finit
      // en arrière-plan et s'applique au prochain démarrage (= comportement
      // d'avant). Jamais de splash bloqué.
      autoSplashscreenTimeout: 12000,
      updateUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-updates',
      statsUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-stats',
      channelUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-channel',
      defaultChannel: 'production',
    },
  },
};

export default config;
