import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: '/src',
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
