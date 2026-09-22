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
        cbba: resolve(import.meta.dirname, 'cbba/index.html'),
        behavior: resolve(import.meta.dirname, 'behavior/index.html'),
        cooperative: resolve(import.meta.dirname, 'cooperative/index.html'),
        slam: resolve(import.meta.dirname, 'slam/index.html'),
        poseGraph: resolve(import.meta.dirname, 'pose-graph/index.html'),
        ros2: resolve(import.meta.dirname, 'ros2/index.html'),
        qos: resolve(import.meta.dirname, 'qos/index.html'),
        restart: resolve(import.meta.dirname, 'restart/index.html'),
        middleware: resolve(import.meta.dirname, 'middleware/index.html'),
        sitl: resolve(import.meta.dirname, 'sitl/index.html'),
        gazebo: resolve(import.meta.dirname, 'gazebo/index.html'),
        failsafe: resolve(import.meta.dirname, 'failsafe/index.html'),
        fleet: resolve(import.meta.dirname, 'fleet/index.html'),
        recovery: resolve(import.meta.dirname, 'recovery/index.html'),
        sharedWorld: resolve(import.meta.dirname, 'shared-world/index.html'),
      },
    },
  },
});
