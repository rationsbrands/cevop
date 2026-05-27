import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pwaPlugin: any = VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',
  srcDir: 'public',
  filename: 'sw.js',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
  manifest: false, // manifest.webmanifest already exists in public/
});

export default defineConfig({
  plugins: [react(), pwaPlugin],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-socket': ['socket.io-client'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if ((err as any)?.code === 'EPIPE' || (err as any)?.code === 'ECONNRESET') return;
          });
        },
      },
    },
  },
});
