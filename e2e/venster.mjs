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
  } else if (!(await inlog.isVisible().catch(() => false))) {
    afsluiten(1, 'Noch het inlogscherm noch een storing kwam in beeld.');
  } else {
    /*
     * En dan echt inloggen.
     *
     * Alleen kijken of het inlogscherm verschijnt was niet genoeg: het
     * verscheen, maar erdoorheen komen lukte niet. De schermen draaiden op
     * `file://` en de kern op `http://127.0.0.1:<poort>` — een andere site, dus
     * de sessiecookie werd niet bewaard. Inloggen gaf netjes 200, de vraag
     * erna weer 401, en de gebruiker stond zonder melding terug op het
     * inlogscherm.
     *
     * Een verse gegevensmap betekent een verse installatie, dus het account
     * heeft nog het beginwachtwoord en hoort meteen naar het scherm te gaan
     * waar een eigen wachtwoord gekozen wordt.
     */
    await venster.getByLabel(/e-mailadres/i).fill('patrick@showroom.local');
    await venster.getByLabel(/wachtwoord/i).fill('Showroom2026!');
    await venster.getByRole('button', { name: /inloggen/i }).click();

    const verder = venster.getByText(/kies eerst een eigen wachtwoord/i);
    const melding = venster.getByRole('alert');

    await Promise.race([
      verder.waitFor({ state: 'visible', timeout: 45_000 }),
      melding.waitFor({ state: 'visible', timeout: 45_000 }),
    ]).catch(() => undefined);

    if (await verder.isVisible().catch(() => false)) {
      await doorNaarDeApplicatie(venster);
      await maakEnVerwijderEenKlant(venster);
      await schakelNaarHostmodus(venster);
      afsluiten(
        0,
        'Het venster opent, inloggen lukt, aanmaken en verwijderen werkt, en de hostmodus laadt.',
      );
    } else if (await melding.isVisible().catch(() => false)) {
      afsluiten(1, `Inloggen werd geweigerd: ${await melding.innerText()}`);
    } else {
      const tekst = await venster.locator('body').innerText();
      afsluiten(
        1,
        'Na het inloggen gebeurde er niets: geen volgend scherm en geen melding.\n' +
          `In beeld staat nog:\n${tekst.slice(0, 500)}`,
      );
    }
  }
} catch (fout) {
  afsluiten(1, `Het venster kwam niet op: ${fout instanceof Error ? fout.message : String(fout)}`);
}

/**
 * Door het verplichte wachtwoordscherm heen, de applicatie in.
 *
 * Het wijzigen maakt alle sessies ongeldig — met opzet — dus daarna moet er
 * opnieuw ingelogd worden.
 */
async function doorNaarDeApplicatie(venster) {
  await venster.getByLabel(/huidig wachtwoord/i).fill('Showroom2026!');
  await venster.getByLabel(/^nieuw wachtwoord$/i).fill('Sleutelbos2026x');
  await venster.getByLabel(/nogmaals/i).fill('Sleutelbos2026x');
  await venster.getByRole('button', { name: /wachtwoord wijzigen/i }).click();

  const inlog = venster.getByRole('button', { name: /inloggen/i });
  await inlog.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  if (await inlog.isVisible().catch(() => false)) {
    await venster.getByLabel(/e-mailadres/i).fill('patrick@showroom.local');
    await venster.getByLabel(/^wachtwoord$/i).fill('Sleutelbos2026x');
    await inlog.click();
  }
  await venster
    .getByRole('navigation', { name: /hoofdnavigatie/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Een klant aanmaken, openen en weer verwijderen.
 *
 * De lijst toonde alleen wat er al was: geen knop om iets toe te voegen, geen
 * manier om iets weg te halen. De kern kon het allang. Dit scenario loopt de
 * hele weg, want daar bleek ook nog een tweede fout in te zitten: een DELETE
 * zonder body die zich wél als JSON aankondigde, en die Fastify weigerde.
 */
async function maakEnVerwijderEenKlant(venster) {
  await venster.getByRole('link', { name: 'Klanten', exact: true }).click();

  const nieuw = venster.getByRole('button', { name: /\+ nieuw/i });
  await nieuw.waitFor({ state: 'visible', timeout: 20_000 });
  await nieuw.click();

  const dialoog = venster.getByRole('dialog');
  await dialoog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialoog.locator('input').first().fill('Proefklant uit de opstartcontrole');
  await venster.getByRole('button', { name: /^aanmaken$/i }).click();

  // Na het aanmaken hoort de detailpagina open te staan.
  await venster.getByRole('button', { name: /^bewerken$/i }).waitFor({ timeout: 20_000 });

  await venster.getByRole('button', { name: /verwijderen…/i }).click();
  await venster.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 });
  await venster
    .getByRole('dialog')
    .getByRole('button', { name: /^verwijderen$/i })
    .click();

  // Terug in de lijst, en de melding over een lege body mag nergens staan.
  await nieuw.waitFor({ state: 'visible', timeout: 20_000 });
  const tekst = await venster.locator('main').innerText();
  if (/body cannot be empty|content-type/i.test(tekst)) {
    throw new Error(`Verwijderen gaf een fout in beeld:\n${tekst.slice(0, 300)}`);
  }
}

/**
 * De hostmodus aanzetten, de applicatie herstarten, en kijken of de schermen
 * dan nog laden.
 *
 * Waarom hij herstart: het scherm zegt zelf "sluit de applicatie en start hem
 * opnieuw" — de kern draait pas in de nieuwe stand na een herstart. Zonder die
 * herstart test je niets.
 *
 * Waarom deze controle bestaat: de kern luistert in de hostmodus op 0.0.0.0 en
 * gaf dat ook terug als adres. Dat is geen bestemming — je kunt er niet naartoe
 * verbinden — dus het venster laadde van http://0.0.0.0:4317 en bleef leeg. De
 * applicatie draaide gewoon door; alleen zag je niets meer.
 */
async function schakelNaarHostmodus(venster) {
  await venster.getByRole('link', { name: 'Instellingen', exact: true }).click();
  await venster
    .getByText(/Netwerk/)
    .first()
    .click();

  const stand = venster.getByLabel(/^stand$/i);
  await stand.waitFor({ state: 'visible', timeout: 20_000 });
  await stand.selectOption('host');
  await venster
    .getByRole('button', { name: /^opslaan$/i })
    .first()
    .click();
  await venster
    .getByText(/opgeslagen/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });

  // Herstarten met dezelfde gegevensmap, zodat config.json blijft staan.
  await app.close();
  app = await electron.launch({
    executablePath: uitvoer,
    args: ['--no-sandbox', `--user-data-dir=${gegevensmap}`],
    timeout: 60_000,
  });
  const opnieuw = await app.firstWindow({ timeout: 60_000 });
  await opnieuw.waitForLoadState('domcontentloaded').catch(() => undefined);

  // Eerst het adres, dan pas wachten op inhoud. Andersom levert een
  // nietszeggende time-out op terwijl de oorzaak in de adresbalk staat.
  const url = opnieuw.url();
  if (url.includes('0.0.0.0')) {
    throw new Error(
      `In de hostmodus laadt het venster van ${url}. Dat is het adres waaróp de kern ` +
        'luistert, niet een adres waar je naartoe kunt verbinden — het scherm blijft leeg.',
    );
  }

  await opnieuw
    .getByRole('button', { name: /inloggen/i })
    .or(opnieuw.getByRole('navigation', { name: /hoofdnavigatie/i }))
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {
      // Blijft hij op het wachtscherm hangen, dan is de kern wel opgekomen
      // maar lukte het laden niet. Dat is precies hoe deze fout zich in de
      // praktijk voordoet: de applicatie draait, er is alleen niets te zien.
      const waar = url.startsWith('data:')
        ? 'het venster bleef op het wachtscherm "Verbinden met de kern…" staan'
        : `het venster staat op ${url}`;
      throw new Error(`Na het omzetten naar de hostmodus komt er geen scherm: ${waar}.`);
    });
}
