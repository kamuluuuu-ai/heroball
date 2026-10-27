import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = Number(process.env.PORT ?? 3001);

export default defineConfig({
  root: 'client',
  // GitHub Pages sirve el sitio en /<repo>/
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/api': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
} as any);
