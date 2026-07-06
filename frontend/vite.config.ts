import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server bound to loopback only (company-laptop safety). API calls are
// proxied to the local backend so the browser talks same-origin (no CORS).
export default defineConfig({
  plugins: [react()],
  build: {
    // Split the heavy 3D stack (three + react-three) into its own long-cached
    // vendor chunk so the app shell stays small and the globe code caches across
    // deploys / loads in parallel.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
  },
});
