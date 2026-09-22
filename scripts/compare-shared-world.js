import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedWorldSummary, validateSharedWorldTrace } from '../src/shared-world-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length > 3) throw new Error('Usage: npm run compare:shared-world -- [recording.json]');
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'docs/results/ardupilot-shared-world.json');
  const trace = validateSharedWorldTrace(JSON.parse(await readFile(path, 'utf8')));
  const matches = {};
  const fingerprints = [
    ['shared-world/record.py', trace.runtime.sourceSha256],
    ['shared-world/Dockerfile', trace.runtime.dockerfileSha256],
    ['sitl/record.py', trace.runtime.sitlSourceSha256],
    ['fleet/record.py', trace.runtime.fleetSourceSha256],
    ['recovery/record.py', trace.runtime.recoverySourceSha256],
    ...Object.entries(trace.runtime.filesSha256).map(([name, hash]) => [`shared-world/${name}`, hash]),
    ...Object.entries(trace.runtime.gazeboFilesSha256).map(([name, hash]) => [`gazebo/${name}`, hash]),
  ];
  for (const [name, expected] of fingerprints) {
    matches[name] = createHash('sha256').update(await readFile(resolve(root, name))).digest('hex') === expected;
  }
  console.log(JSON.stringify({ runtime: trace.runtime, sourceHashesMatch: matches,
    cases: trace.cases.map(run => ({ id: run.id, runId: run.runId, world: run.world,
      vehicles: run.vehicles.map(v => ({ id: v.id, systemId: v.systemId, modelName: v.modelName,
        jsonPort: v.jsonPort, homeGps: v.homeGps, parameters: v.parameters,
        originNed: v.originNed, originTruthEnu: v.originTruthEnu })),
      assignments: run.assignments, withdrawal: run.withdrawal, ...sharedWorldSummary(run) })) }, null, 2));
  if (Object.values(matches).some(value => !value)) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
