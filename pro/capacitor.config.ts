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
      launchAutoHide: true,
      backgroundColor: '#050505',
    },
    CapacitorUpdater: {
      // Capgo OTA auto-hébergée sur Supabase : seconde app eu.yunoapp.pro. Le
      // MÊME zip de bundle est référencé que le B2C (stockage content-addressed),
      // mais l'app_id eu.yunoapp.pro a ses propres lignes ota_bundles/canaux, donc
      // on peut promouvoir/rollback Pro indépendamment. Voir docs/OTA_CAPGO.md.
      autoUpdate: true,
      updateUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-updates',
      statsUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-stats',
      channelUrl: 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/capgo-channel',
      defaultChannel: 'production',
    },
  },
};

export default config;
