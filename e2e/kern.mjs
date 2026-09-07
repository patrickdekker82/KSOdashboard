/**
 * Start de gebouwde kern in de hostmodus voor de e2e-scenario's.
 *
 * Bewust de gebouwde kern (`out/main/core/host.cjs`) en niet de bron: alleen
 * die staat naast `out/renderer`, en het serveren van de schermen is precies
 * een van de dingen die deze tests moeten bewaken. Draait de test tegen de
 * bron, dan bewijst hij niets over wat er straks geïnstalleerd wordt.
 *
 * De kern verwacht een utility process van Electron; hier wordt dat berichtluik
 * nagebootst, net zoals bij de controle van de ingepakte applicatie.
 */
import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const vereis = createRequire(import.meta.url);
const hier = dirname(fileURLToPath(import.meta.url));
const gegevensmap = mkdtempSync(join(tmpdir(), 'showroom-e2e-'));

/*
 * De migraties neerzetten waar de kern ze zoekt.
 *
 * In een geïnstalleerde applicatie levert electron-builder ze als
 * extraResources onder `resources/db`, en vindt de kern ze via
 * `process.resourcesPath`. Hier bootsen we die map na, zodat de kern precies
 * dezelfde weg loopt als straks op een werkplek.
 */
const resources = join(gegevensmap, 'resources');
mkdirSync(join(resources, 'db'), { recursive: true });
cpSync(join(hier, '../packages/core/src/db/migrations'), join(resources, 'db', 'migrations'), {
  recursive: true,
});
cpSync(join(hier, '../packages/core/src/db/views.sql'), join(resources, 'db', 'views.sql'));
process.resourcesPath = resources;

const luik = new EventEmitter();
luik.postMessage = (bericht) => {
  if (bericht.type === 'gestart') {
    // De scenario's lezen dit uit de uitvoer.
    process.stdout.write(`KERN ${bericht.port} ${gegevensmap}\n`);
  }
  if (bericht.type === 'fout') {
    process.stderr.write(`kern kon niet starten: ${bericht.message}\n`);
    process.exit(1);
  }
};
process.parentPort = luik;

if (process.env.E2E_DEBUG) {
  const { existsSync } = vereis('node:fs');
  process.stdout.write(
    `resourcesPath=${process.resourcesPath} bestaat=${existsSync(join(resources, 'db', 'migrations'))}\n`,
  );
}

vereis('../out/main/core/host.cjs');

luik.emit('message', {
  data: {
    type: 'start',
    dataDirectory: gegevensmap,
    mode: 'host',
    port: Number(process.env.E2E_PORT ?? 4319),
    // Demo-gegevens: dan is er iets te zien, en hoeft niemand eerst een
    // wachtwoord te wijzigen.
    demo: true,
  },
});

const opruimen = () => {
  rmSync(gegevensmap, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', opruimen);
process.on('SIGINT', opruimen);
