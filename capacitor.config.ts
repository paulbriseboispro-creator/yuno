import type { CapacitorConfig } from '@capacitor/cli';

// App native iOS (App Store) — coquille Capacitor autour du build Vite.
// L'app est B2C uniquement : les routes pro sont gatées par NativeProGate.
// Origine du WebView : capacitor://localhost (allowlistée dans le CORS des
// edge functions). Stripe passe par @capacitor/browser, PAS par une
// navigation in-WebView — ne jamais ajouter server.allowNavigation ici.
const config: CapacitorConfig = {
  appId: 'eu.yunoapp.app',
  appName: 'Yuno',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#050505',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      // launchAutoHide: false — c'est le plugin Capgo qui cache le splash
      // natif (autoSplashscreen), une fois la MàJ OTA appliquée OU dès que le
      // bundle appelle notifyAppReady(). Filet de sécurité natif :
      // autoSplashscreenTimeout. Sans launchAutoHide:false, autoSplashscreen
      // est inopérant (le splash serait déjà parti).
      // Rouge de marque : le launch screen natif (LaunchScreen.storyboard) et le
      // premier pixel du WebView (index.html) sont rouges → enchaînement sans
      // couture vers le splash animé. Le fond sombre de l'app reste #050505.
      launchAutoHide: false,
      backgroundColor: '#E51D2A',
    },
    CapacitorUpdater: {
      // MàJ OTA Capgo AUTO-HÉBERGÉE sur Supabase (pas le cloud Capgo payant) :
      // le bundle web se met à jour sans review Apple. Les 3 endpoints sont des
      // edge functions (verify_jwt=false). notifyAppReady() est appelé dans
      // NativeBridge — sans lui, rollback auto. Voir docs/OTA_CAPGO.md.
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
