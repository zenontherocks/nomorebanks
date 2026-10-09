import { defineConfig } from "@playwright/test";

// End-to-end tests run against `wrangler dev` with a throwaway local database.
// Set CHROMIUM_PATH to use an already-installed Chromium instead of `npx playwright install`.
const PORT = 8788;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command:
      `node -e "require('fs').rmSync('.wrangler/e2e', { recursive: true, force: true })" && ` +
      `wrangler dev --port ${PORT} --persist-to .wrangler/e2e --var ADMIN_PASSWORD:e2e-password`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
