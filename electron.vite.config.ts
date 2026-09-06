import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = resolve(__dirname, 'packages/shared/src');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@showroom/shared': shared } },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // @node-rs/argon2 draagt een voorgecompileerde .node-binary. Die hoort
        // naast de bundel te staan en uitgepakt te worden uit de asar, niet
        // erin gebakken.
        external: ['@node-rs/argon2'],
        input: {
          index: resolve(__dirname, 'packages/main/src/index.ts'),
          // De kern draait in een eigen utility process en wordt apart gebouwd.
          'core/host': resolve(__dirname, 'packages/core/src/host.ts'),
        },
        /*
         * CommonJS, met de extensie .cjs.
         *
         * De root-package.json staat op `type: module`, dus een .js-bestand is
         * daar ESM. Dat gaat mis zodra de bundel een pakket van buiten laadt:
         * ajv is CommonJS zonder exports-map, en `import 'ajv/dist/jtd'` lost
         * onder ESM niet op omdat er geen extensie bij staat. Fastify laadt
         * bovendien delen van ajv met `require()` op naam.
         *
         * Dit is geen smaakkwestie: met ESM start de ingepakte applicatie niet.
         * De .cjs-extensie houdt de rest van het project wel ESM.
         */
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name].cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { preload: resolve(__dirname, 'packages/main/src/preload.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'packages/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@showroom/shared': shared,
        '@renderer': resolve(__dirname, 'packages/renderer/src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'packages/renderer/index.html') },
    },
  },
});
