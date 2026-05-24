import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pwaPlugin: any = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
  manifest: {
    name: 'Cevop Order',
    short_name: 'Cevop',
    description: 'Order food from your table',
    theme_color: '#0A0A0A',
    background_color: '#0A0A0A',
    display: 'standalone',
    orientation: 'portrait',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
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
});

const plugins: any = [react(), pwaPlugin];

const config = {
  plugins,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-socket': ['socket.io-client'],
          'vendor-db': ['dexie'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        ws: true,
        configure: (proxy: any) => {
          proxy.on('error', (err: any) => {
            if ((err as any)?.code === 'EPIPE' || (err as any)?.code === 'ECONNRESET') return;
          });
        },
      },
    },
  },
} as any;

export default defineConfig(config);
