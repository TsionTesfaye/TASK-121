import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: [
      'tests/unit_tests/**/*.test.js',
      'tests/API_tests/**/*.test.js',
      'tests/browser_tests/**/*.test.js',
      'tests/e2e_tests/**/*.test.js',
    ],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/main.js', 'src/**/*.svelte'],
    },
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
  },
  resolve: {
    alias: {
      $lib: '/src',
    },
  },
});
