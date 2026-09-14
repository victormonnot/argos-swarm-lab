import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        consensus: resolve(import.meta.dirname, 'index.html'),
        movement: resolve(import.meta.dirname, 'movement/index.html'),
      },
    },
  },
});
