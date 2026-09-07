/**
 * Playwright-opzet voor de schermen (hoofdstuk 13).
 *
 * De scenario's draaien tegen de hostmodus in een browser en niet tegen het
 * Electron-venster. Dat is met opzet: het is dezelfde renderer en dezelfde
 * kern, het draait ook op een bouwserver zonder beeldscherm, en het bewaakt
 * meteen de mobiele weergave — die loopt via precies deze weg.
 *
 * Wat hiermee níet gedekt is, en dus met de hand moet: het Electron-venster
 * zelf, het menu, het systeemvak, de opslaan-dialoog en het afdrukken naar PDF.
 */
import { defineConfig, devices } from '@playwright/test';

const poort = Number(process.env.E2E_PORT ?? 4319);
const adres = `http://127.0.0.1:${poort}`;

export default defineConfig({
  testDir: './e2e',
  // Eén tegelijk: de scenario's delen één database, en een test die een record
  // aanmaakt terwijl een andere telt, levert een raadsel op in plaats van een
  // fout.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: adres,
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /*
     * Normaal haalt Playwright zijn eigen browser op (`npx playwright install`),
     * en dat doet de bouwserver ook. Op een machine waar al een Chromium
     * klaarstaat — een afgesloten omgeving, of een bouwserver zonder
     * internettoegang — wijst PLAYWRIGHT_CHROMIUM_PATH hem daarheen.
     */
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },

  projects: [
    // Eén keer inloggen per rol; de rest van de scenario's erft die sessie.
    { name: 'aanmelden', testMatch: /aanmelden\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['aanmelden'],
      testIgnore: /mobiel\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.sessies/beheerder.json' },
    },
    // De mobiele weergave is geen aparte applicatie maar hetzelfde scherm op
    // een smal venster; dus een eigen scenario, in een ander formaat.
    {
      name: 'telefoon',
      dependencies: ['aanmelden'],
      testMatch: /mobiel\.spec\.ts/,
      use: { ...devices['Pixel 7'], storageState: 'e2e/.sessies/beheerder.json' },
    },
  ],

  webServer: {
    command: 'node e2e/kern.mjs',
    url: `${adres}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
  },
});
