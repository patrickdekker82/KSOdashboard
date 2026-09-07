/**
 * Start de ingepakte applicatie echt op (hoofdstuk 13).
 *
 * Waarom dit bestaat: de kern werd gestart vanaf `out/core/host.cjs` terwijl
 * hij op `out/main/core/host.cjs` staat. Eén maplaag ernaast. De unit-tests
 * merkten daar niets van, de scenario's ook niet — die draaien de kern
 * rechtstreeks met Node en slaan Electron over — en de controle in CI keek
 * alleen of het bestand ín de asar zat, niet of de applicatie het vond. De
 * geïnstalleerde applicatie startte daardoor nooit op.
 *
 * Deze controle doet wat een gebruiker doet: de applicatie starten en kijken
 * of de kern opkomt.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WACHT_MS = 90_000;

const uitvoer = {
  linux: 'release/linux-unpacked/showroom-suite',
  win32: 'release/win-unpacked/Showroom Suite.exe',
  darwin: 'release/mac/Showroom Suite.app/Contents/MacOS/Showroom Suite',
}[process.platform];

if (!uitvoer || !existsSync(uitvoer)) {
  console.error(`De ingepakte applicatie ontbreekt op ${uitvoer ?? process.platform}.`);
  console.error('Draai eerst: npm run build && npx electron-builder --dir');
  process.exit(1);
}

const gegevensmap = mkdtempSync(join(tmpdir(), 'showroom-opstart-'));
const logboek = join(gegevensmap, 'logs', 'schil.log');

// Onder Linux is er geen beeldscherm op een bouwserver; xvfb-run levert er een.
const viaXvfb = process.platform === 'linux' && process.env.DISPLAY === undefined;
const opdracht = viaXvfb ? 'xvfb-run' : uitvoer;
const argumenten = viaXvfb
  ? ['-a', uitvoer, '--no-sandbox', `--user-data-dir=${gegevensmap}`]
  : ['--no-sandbox', `--user-data-dir=${gegevensmap}`];

const kind = spawn(opdracht, argumenten, { stdio: ['ignore', 'pipe', 'pipe'] });
let uitvoerTekst = '';
kind.stdout.on('data', (blok) => (uitvoerTekst += blok));
kind.stderr.on('data', (blok) => (uitvoerTekst += blok));

function stop(code, bericht) {
  // Geslaagd naar stdout, mislukt naar stderr — zoals een script hoort te doen.
  if (code === 0) process.stdout.write(`${bericht}\n`);
  else process.stderr.write(`${bericht}\n`);
  try {
    kind.kill('SIGKILL');
  } catch {
    /* al weg */
  }
  try {
    rmSync(gegevensmap, { recursive: true, force: true });
  } catch {
    /* mag mislukken */
  }
  process.exit(code);
}

const begin = Date.now();
const tik = setInterval(() => {
  if (existsSync(logboek)) {
    const inhoud = readFileSync(logboek, 'utf8');

    if (/kern gestart op poort (\d+)/.test(inhoud)) {
      clearInterval(tik);
      const poort = /kern gestart op poort (\d+)/.exec(inhoud)[1];
      // De database hoort er dan ook te staan; anders kwam de kern wel op maar
      // deed hij niets.
      if (!existsSync(join(gegevensmap, 'showroom.db'))) {
        stop(1, 'De kern meldde zich, maar showroom.db is niet aangemaakt.');
      }
      stop(0, `De ingepakte applicatie start en de kern luistert op poort ${poort}.`);
    }

    if (/FATAAL|herstart \d+\//.test(inhoud)) {
      clearInterval(tik);
      stop(1, `De kern kwam niet op:\n${inhoud}`);
    }
  }

  if (Date.now() - begin > WACHT_MS) {
    clearInterval(tik);
    stop(
      1,
      'De kern heeft zich binnen de wachttijd niet gemeld.\n' +
        `Logboek ${existsSync(logboek) ? readFileSync(logboek, 'utf8') : 'is niet eens aangemaakt'}\n` +
        `Uitvoer:\n${uitvoerTekst.slice(-2000)}`,
    );
  }
}, 500);

kind.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    clearInterval(tik);
    stop(
      1,
      `De applicatie stopte meteen met code ${code}.\nUitvoer:\n${uitvoerTekst.slice(-2000)}`,
    );
  }
});
