/**
 * Entry point for the Electron utility process (hoofdstuk 2.2).
 *
 * The core runs in its own process so a crash in the business logic never
 * takes the window down: main restarts this process and shows a notice.
 * Port and session token go back to main over the message port, which passes
 * them to the renderer through preload.
 */
import { startCore, type RunningCore } from './bootstrap.ts';

type StartMessage = {
  type: 'start';
  dataDirectory: string;
  mode?: 'standalone' | 'host' | 'client';
  port?: number;
  demo?: boolean;
  mappedDrives?: string[];
};

let core: RunningCore | null = null;

process.parentPort?.on('message', (event) => {
  const message = event.data as StartMessage | { type: 'stop' };

  if (message.type === 'start') {
    startCore({
      dataDirectory: message.dataDirectory,
      mode: message.mode ?? 'standalone',
      port: message.port,
      demo: message.demo,
      mappedDrives: message.mappedDrives,
    })
      .then((running) => {
        core = running;
        process.parentPort?.postMessage({
          type: 'gestart',
          port: running.port,
          appToken: running.appToken,
          schemaVersion: running.schemaVersion,
          address: running.address,
        });
      })
      .catch((error: unknown) => {
        process.parentPort?.postMessage({
          type: 'fout',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return;
  }

  if (message.type === 'stop') {
    void (core?.stop() ?? Promise.resolve()).then(() => process.exit(0));
  }
});
