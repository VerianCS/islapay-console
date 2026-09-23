/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The host is reached through the dev server rather than directly, so the
    // browser sees one origin and CORS never enters into it. In production the
    // console is served from the same origin as the API, or behind a proxy
    // that does the same thing — either way `VITE_API_BASE` stays empty and
    // every request is relative.
    proxy: {
      '/v1': {
        target: process.env.ISLAPAY_API ?? 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // The browser suite is Playwright's and needs the whole stack up. Vitest
    // picking it up would fail the unit run for a reason that has nothing to
    // do with the unit run.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
