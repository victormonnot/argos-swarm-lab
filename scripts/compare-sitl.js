import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSitlTrace, sitlSummary } from '../src/sitl-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length > 3) throw new Error('Usage: npm run compare:sitl -- [recording.json]');
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'docs/results/ardupilot-sitl.json');
  const trace = validateSitlTrace(JSON.parse(await readFile(path, 'utf8')));
  const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'sitl/record.py'))).digest('hex');
  console.log(JSON.stringify({ runtime: trace.runtime, sourceHashMatches: trace.runtime.sourceSha256 === sourceHash,
    cases: trace.cases.map(run => ({ id: run.id, runId: run.runId, parameters: run.parameters,
      originNed: run.originNed, commands: run.commands, acks: run.acks, events: run.events,
      endMs: run.endMs, ...sitlSummary(run) })) }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
