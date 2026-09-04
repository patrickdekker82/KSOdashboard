/**
 * Runs the core outside Electron, for development and for the API tests.
 *
 *   node --experimental-strip-types packages/core/src/standalone.ts --demo
 */
import { startCore } from './bootstrap.ts';

const args = new Set(process.argv.slice(2));
const dataDirectory =
  process.env.SHOWROOM_DATA_DIR ?? new URL('../../../.data', import.meta.url).pathname;

const core = await startCore({
  dataDirectory,
  mode: args.has('--host') ? 'host' : 'standalone',
  demo: args.has('--demo'),
  logger: true,
});

process.stdout.write(
  [
    `Showroom Suite kern draait op ${core.address}`,
    `Schemaversie: ${core.schemaVersion}`,
    `Gegevens: ${dataDirectory}`,
    `Sessietoken: ${core.appToken}`,
    '',
  ].join('\n'),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void core.stop().then(() => process.exit(0));
  });
}
