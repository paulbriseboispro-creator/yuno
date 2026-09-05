import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { OFFICIAL_SPLASH_WORDMARK } from "./src/lib/brandSplash";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
    headers: {
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.mapbox.com https://resend.com; img-src 'self' data: blob: https://*.supabase.co https://*.stripe.com https://*.mapbox.com https://cdn.simpleicons.org; media-src 'self' blob: https://*.supabase.co; font-src 'self' data: https://fonts.gstatic.com; frame-src https://js.stripe.com https://hooks.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'",
    },
  },
  plugins: [
    react(),
    // Le loader inline de index.html est du JS brut : il ne peut pas importer
    // le drapeau de la chaîne de lancement. On l'y injecte, pour qu'il n'existe
    // qu'UN seul interrupteur — sinon on en flipperait un et pas l'autre, et le
    // logo sauterait entre le Launch Screen natif et le splash web.
    {
      name: 'yuno-splash-flag',
      transformIndexHtml(html: string) {
        return html.replace(/__YUNO_OFFICIAL_SPLASH_WORDMARK__/g, String(OFFICIAL_SPLASH_WORDMARK));
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      // We register the SW ourselves via `virtual:pwa-register` in main.tsx so a
      // new deploy force-reloads open tabs (returning visitors never stay stuck on
      // a stale precached bundle). Disable the bare auto-injected registerSW.js to
      // avoid a double registration.
      injectRegister: false,
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Yuno',
        short_name: 'Yuno',
        description: 'Your night, without the wait.',
        theme_color: '#050505',
        background_color: '#050505',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-1024.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // A new SW takes over immediately and claims open tabs, so the
        // `controlling` event fires and registerSW() (main.tsx) reloads them onto
        // the fresh build. vite-plugin-pwa only auto-sets these when injectRegister
        // is 'auto'/null; since we use the virtual module + injectRegister:false,
        // we set them explicitly. Without clientsClaim the auto-reload never fires.
        skipWaiting: true,
        clientsClaim: true,
        // Fold the push-notification handlers into THIS workbox SW instead of
        // registering a separate /sw-push.js. A browser allows one SW per scope,
        // so a second registration at '/' would replace workbox — killing the
        // precache + auto-reload as soon as a user enabled push. One SW, both jobs.
        importScripts: ['/sw-push-handlers.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
        // Ne PAS précacher, au premier chargement B2C :
        //  - les captures du centre d'aide owner (public/help/**, ~14 Mo) et
        //    l'icône 1024 (install only) — ressources pro / hors-parcours ;
        //  - mapbox (1,7 Mo, une seule page /map lazy) ;
        //  - les 3 fichiers de langue (fr/es/en, ~2,7 Mo) : un visiteur n'en lit
        //    qu'un ; l'actif se cache au runtime (CacheFirst /assets/ ci-dessous) ;
        //  - les chunks des dashboards pro (Owner/Admin/Agency/Org/Promoter/
        //    Affiliate/Staff/Manager/DJ/Vip/Bouncer/Cloakroom/Barman) + jspdf,
        //    html2canvas, recharts : un client B2C ne les ouvre jamais.
        // Tout ce qui est exclu ici reste servi au réseau puis mis en cache à la
        // PREMIÈRE utilisation réelle via le runtimeCaching CacheFirst sur
        // /assets/ — donc offline OK après usage, sans surcoût au boot.
        globIgnores: [
          'help/**',
          'icon-1024.png',
          'assets/mapbox-gl-*.js',
          'assets/{fr,es,en}-*.js',
          'assets/jspdf*.js',
          'assets/html2canvas-*.js',
          'assets/generateCategoricalChart-*.js',
          'assets/{Owner,Admin,Agency,Org,Promoter,Affiliate,Staff,Manager,DJ,Vip,Viph,VipHost,Bouncer,Cloakroom,Barman}*.js',
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/~oauth/],
        runtimeCaching: [
          {
            // Chunks de build hashés (JS/CSS immuables). CacheFirst : un chunk
            // exclu du précache (langue active, page pro, mapbox…) se cache dès
            // sa 1re utilisation réelle et fonctionne offline ensuite — sans
            // forcer chaque visiteur B2C à télécharger toute l'app au boot.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-assets-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
              plugins: [
                {
                  // Ceinture + bretelles avec le 404 franc du Worker : ne JAMAIS mémoriser
                  // du HTML sous une URL de chunk hashé. Si quoi que ce soit répond le shell
                  // SPA pour un /assets/* absent (déploiement en cours de propagation, index
                  // périmé), CacheFirst épinglerait ce mensonge 30 jours et la route serait
                  // morte hors ligne comme en ligne.
                  cacheWillUpdate: async ({ response }) =>
                    (response.headers.get('content-type') || '').includes('text/html')
                      ? null
                      : response,
                },
              ],
            },
          },
          {
            // Cache ONLY non-sensitive, cacheable Supabase REST (events, venues,
            // profiles, catalogs...). Auth (/auth/), Edge Functions (/functions/)
            // and transactional tables are deliberately matched by NO route, so the
            // service worker never sits in their request path. That makes it
            // impossible for a stale SW to break login or a payment checkout — the
            // silent "Failed to send a request to the Edge Function" bug where a
            // returning visitor on an old precached SW could not pay (2026-06).
            // Unmatched requests go straight to the network, exactly as if no SW
            // were installed. The negative lookahead keeps transactional tables out
            // of the cache too.
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/rest\/v1\/(?!orders|purchases|tickets|payments|stripe_sessions|security_logs|staff_pin_rate_limits)[a-z_]/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Public Storage objects (event posters, bottle images) — safe to cache
            // and a real perf win on repeat views. Never sensitive, never in front
            // of /functions.
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 604800 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // mapbox-gl 3.23+ declares "type": "module" but ships a UMD main file. Without
    // pre-bundling, the dev server serves it as raw ESM with no default export and
    // `import mapboxgl from 'mapbox-gl'` throws ("does not provide an export named
    // 'default'"), which the route ErrorBoundary catches — blanking /map. `include`
    // forces Vite's CJS→ESM interop. It's lazy-imported, so it isn't auto-discovered.
    include: ['mapbox-gl'],
  },
  // Strip noisy/PII-leaking debug logs from production bundles. console.error and
  // console.warn are kept for legitimate error visibility. Dev keeps everything
  // (no minification, so `pure` calls are not dropped).
  esbuild: {
    pure: ['console.log', 'console.info', 'console.debug', 'console.trace'],
  },
  build: {
    // The heavy, route-specific libs (mapbox-gl, recharts, jspdf/html2canvas)
    // are already isolated via dynamic import. Here we split the *shared* vendor
    // out of the main entry chunk so it caches independently across deploys and
    // downloads in parallel. react + react-dom stay together to avoid duplicate
    // React instances / init-order issues.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Rolldown : `codeSplitting` (ex-advancedChunks) remplace manualChunks. Sans regroupement,
        // chaque icône lucide et chaque petit module partagé sortaient en chunk
        // séparé : 85 fichiers JS pour peindre l'Explore (200 à 700 octets chacun),
        // autant de requêtes sur le web et de lectures/évaluations de modules en
        // natif. Les icônes, le moteur d'animation et react-query sont réunis ;
        // `minSize` fusionne les miettes restantes dans leur importeur.
        codeSplitting: {
          minSize: 12_000,
          groups: [
            { name: 'react-vendor', test: /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\// },
            { name: 'supabase-vendor', test: /node_modules\/@supabase\// },
            { name: 'radix-vendor', test: /node_modules\/@radix-ui\// },
            { name: 'date-fns-vendor', test: /node_modules\/date-fns/ },
            { name: 'icons', test: /node_modules\/lucide-react\// },
            { name: 'motion', test: /node_modules\/(framer-motion|motion-dom|motion-utils)\// },
            { name: 'query', test: /node_modules\/@tanstack\// },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
