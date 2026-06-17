import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

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
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.mapbox.com https://resend.com; img-src 'self' data: blob: https://*.supabase.co https://*.stripe.com https://*.mapbox.com; font-src 'self' data: https://fonts.gstatic.com; frame-src https://js.stripe.com https://hooks.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'",
    },
  },
  plugins: [
    react(),
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
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/~oauth/],
        runtimeCaching: [
          {
            // Never cache auth — critical for iOS PWA session persistence
            urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Never cache Edge Functions (payments, orders, checkout, webhooks)
            urlPattern: /^https:\/\/.*\.supabase\.co\/functions\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Never cache transactional tables (orders, purchases, tickets, payments)
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/(orders|purchases|tickets|payments|stripe_sessions|security_logs|staff_pin_rate_limits)/i,
            handler: 'NetworkOnly',
          },
          {
            // NetworkFirst for other Supabase REST/Storage (events, profiles, venues)
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 3600 },
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
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router') || id.includes('scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('@supabase')) return 'supabase-vendor';
          if (id.includes('@radix-ui')) return 'radix-vendor';
          if (id.includes('date-fns')) return 'date-fns-vendor';
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
