import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        consensus: resolve(import.meta.dirname, 'index.html'),
        movement: resolve(import.meta.dirname, 'movement/index.html'),
        mission: resolve(import.meta.dirname, 'mission/index.html'),
        architecture: resolve(import.meta.dirname, 'architecture/index.html'),
        pathfinding: resolve(import.meta.dirname, 'pathfinding/index.html'),
        localization: resolve(import.meta.dirname, 'localization/index.html'),
        fusion: resolve(import.meta.dirname, 'fusion/index.html'),
        orca: resolve(import.meta.dirname, 'orca/index.html'),
      },
    },
  },
});
