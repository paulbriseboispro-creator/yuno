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
      launchAutoHide: true,
      // Rouge de marque : le launch screen natif (LaunchScreen.storyboard) et le
      // premier pixel du WebView (index.html) sont rouges → enchaînement sans
      // couture vers le splash animé. Le fond sombre de l'app reste #050505.
      backgroundColor: '#E51D2A',
    },
    CapacitorUpdater: {
      // MàJ OTA Capgo AUTO-HÉBERGÉE sur Supabase (pas le cloud Capgo payant) :
      // le bundle web se met à jour sans review Apple. Les 3 endpoints sont des
      // edge functions (verify_jwt=false). notifyAppReady() est appelé dans
      // NativeBridge — sans lui, rollback auto. Voir docs/OTA_CAPGO.md.
      autoUpdate: true,
      updateUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-updates',
      statsUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-stats',
      channelUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-channel',
      defaultChannel: 'production',
    },
  },
};

export default config;
