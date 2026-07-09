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
      // Capgo : seconde app eu.yunoapp.pro, même bundle uploadé que le B2C.
      autoUpdate: true,
    },
  },
};

export default config;
