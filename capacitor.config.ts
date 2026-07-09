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
      // MàJ OTA Capgo : le bundle web se met à jour sans review Apple.
      // notifyAppReady() est appelé dans NativeBridge — sans lui, rollback auto.
      autoUpdate: true,
    },
  },
};

export default config;
