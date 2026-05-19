import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'logo.png'],
      manifest: {
        name: 'Cevop Order',
        short_name: 'Cevop',
        description: 'Order food from your table',
        theme_color: '#0A0A0A',
        background_color: '#0A0A0A',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\/menu\/public\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'menu-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\/api\/tables\/public\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'table-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ] as any,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
