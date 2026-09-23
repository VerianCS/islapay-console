import { defineConfig } from '@playwright/test';

/**
 * The console in a real browser, against a real backend.
 *
 * Not part of `npm test`, and not something CI should discover by failing: it
 * needs Postgres, Keycloak, RabbitMQ, the host and this dev server all up, and
 * an account holding `treasury-admin`. What it buys is the only check that the
 * sign-in redirect, the token, the generated client and the server agree —
 * every one of which the unit tests stub, and every one of which has been
 * where a real bug lived.
 *
 *     npm run e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.CONSOLE_URL ?? 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 900 },
    // The browser the image already has. Downloading one would fail on a
    // machine with no network and take four minutes on one with.
    launchOptions: {
      executablePath:
        process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
  },
});
