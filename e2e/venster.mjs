/**
 * Het Electron-venster zelf (hoofdstuk 13).
 *
 * Waarom dit bestaat: de schermen praten in de applicatie via `window.showroom`
 * met de kern, en in de hostmodus rechtstreeks met dezelfde oorsprong. Alle
 * bestaande scenario's liepen langs die tweede weg. De eerste — die iedereen op
 * zijn bureaublad gebruikt — was nooit getest, en daar zat een wedloop: het
 * venster vroeg de kern om zijn poort voordat de kern er was, kreeg 0 terug, en
 * toonde "De kern is niet bereikbaar / Failed to fetch".
 *
 * Deze controle start de ingepakte applicatie en kijkt of het inlogscherm
 * verschijnt in plaats van een storingsmelding.
 */
import { _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uitvoer = {
  linux: 'release/linux-unpacked/showroom-suite',
  win32: 'release/win-unpacked/Showroom Suite.exe',
  darwin: 'release/mac/Showroom Suite.app/Contents/MacOS/Showroom Suite',
}[process.platform];

if (!uitvoer || !existsSync(uitvoer)) {
  process.stderr.write(`De ingepakte applicatie ontbreekt op ${uitvoer ?? process.platform}.\n`);
  process.exit(1);
}

const gegevensmap = mkdtempSync(join(tmpdir(), 'showroom-venster-'));
let app;

function afsluiten(code, bericht) {
  if (code === 0) process.stdout.write(`${bericht}\n`);
  else process.stderr.write(`${bericht}\n`);
  void app
    ?.close()
    .catch(() => undefined)
    .finally(() => {
      try {
        rmSync(gegevensmap, { recursive: true, force: true });
      } catch {
        /* mag mislukken */
      }
      process.exit(code);
    });
  if (!app) process.exit(code);
}

try {
  app = await electron.launch({
    executablePath: uitvoer,
    args: ['--no-sandbox', `--user-data-dir=${gegevensmap}`],
    timeout: 60_000,
  });

  const venster = await app.firstWindow({ timeout: 60_000 });

  // Wachten tot óf het inlogscherm óf een storing in beeld staat: allebei
  // afwachten is beter dan alleen op de goede afloop wachten, want dan zegt een
  // mislukking alleen "time-out" en niet wát er stukging.
  const inlog = venster.getByRole('button', { name: /inloggen/i });
  // `.first()`: de storingspagina zet de kop en de reden onder elkaar, dus er
  // matchen er twee. Welke van de twee het eerst verschijnt maakt niet uit.
  const storing = venster
    .getByText(/kern is niet bereikbaar|kern kon niet starten|failed to fetch/i)
    .first();

  await Promise.race([
    inlog.waitFor({ state: 'visible', timeout: 60_000 }),
    storing.waitFor({ state: 'visible', timeout: 60_000 }),
  ]);

  if (await storing.isVisible().catch(() => false)) {
    const tekst = await venster.locator('body').innerText();
    afsluiten(
      1,
      `Het venster toont een storing in plaats van het inlogscherm:\n${tekst.slice(0, 800)}`,
    );
  } else if (await inlog.isVisible().catch(() => false)) {
    afsluiten(0, 'Het venster opent en het inlogscherm verschijnt: de schermen bereiken de kern.');
  } else {
    afsluiten(1, 'Noch het inlogscherm noch een storing kwam in beeld.');
  }
} catch (fout) {
  afsluiten(1, `Het venster kwam niet op: ${fout instanceof Error ? fout.message : String(fout)}`);
}
