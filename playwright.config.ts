import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const PORT = 4173;
// Some build machines ship a browser at this path; elsewhere Playwright's own download is used.
const systemChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    launchOptions: existsSync(systemChromium) ? { executablePath: systemChromium } : {},
  },
  webServer: {
    command: "tsx server/main.ts",
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 60_000,
    // A fresh in-memory database with the sample people, serving the built screens.
    env: { PLATFORM: "local", PORT: String(PORT), DATABASE_MEMORY: "1", SEED_ON_START: "1", CLIENT_DIR: "dist/client", FILES_DIR: ".data/e2e-files" },
  },
});
