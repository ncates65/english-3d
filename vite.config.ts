import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Configured for Hostinger Business subdirectory deployment at https://english-3D.com/study/
export default defineConfig({
  base: '/study/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/study/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/study\/api/, '/api'),
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'esnext',
  },
});

