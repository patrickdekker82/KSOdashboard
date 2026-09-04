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
