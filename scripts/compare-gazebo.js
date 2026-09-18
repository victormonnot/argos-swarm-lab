import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGazeboTrace, gazeboSummary } from '../src/gazebo-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length > 3) throw new Error('Usage: npm run compare:gazebo -- [recording.json]');
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'docs/results/ardupilot-gazebo.json');
  const trace = validateGazeboTrace(JSON.parse(await readFile(path, 'utf8')));
  const matches = {};
  for (const [path, expected] of Object.entries(trace.runtime.filesSha256)) {
    if (!['record.py', 'TruthObserver.cc', 'world.sdf', 'overrides.parm', 'Dockerfile', 'CMakeLists.txt'].includes(path)) throw new Error('Unknown runtime source fingerprint.');
    matches[path] = createHash('sha256').update(await readFile(resolve(root, 'gazebo', path))).digest('hex') === expected;
  }
  matches['sitl/record.py'] = createHash('sha256').update(await readFile(resolve(root, 'sitl/record.py'))).digest('hex') === trace.runtime.sitlSourceSha256;
  console.log(JSON.stringify({ runtime: trace.runtime, sourceHashesMatch: matches,
    cases: trace.cases.map(run => ({ id: run.id, runId: run.runId, parameters: run.parameters,
      originNed: run.originNed, originTruthEnu: run.originTruthEnu, originSampleTimes: run.originSampleTimes,
      pulse: run.pulse, events: run.events, endMs: run.endMs, ...gazeboSummary(run) })) }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
