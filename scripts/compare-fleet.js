import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetSummary, validateFleetTrace } from '../src/fleet-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length > 3) throw new Error('Usage: npm run compare:fleet -- [recording.json]');
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'docs/results/ardupilot-fleet.json');
  const trace = validateFleetTrace(JSON.parse(await readFile(path, 'utf8')));
  const matches = {};
  for (const [path, expected] of [['fleet/record.py', trace.runtime.sourceSha256],
    ['sitl/record.py', trace.runtime.sitlSourceSha256], ['sitl/Dockerfile', trace.runtime.dockerfileSha256]]) {
    matches[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') === expected;
  }
  console.log(JSON.stringify({ runtime: trace.runtime, sourceHashesMatch: matches,
    cases: trace.cases.map(run => ({ id: run.id, runId: run.runId, assignments: run.assignments,
      resources: run.resources, vehiclesSetup: run.vehicles.map(vehicle => ({ id: vehicle.id,
        parameters: vehicle.parameters, homeGps: vehicle.homeGps, setup: vehicle.setup })), ...fleetSummary(run) })) }, null, 2));
  if (Object.values(matches).some(value => !value)) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
