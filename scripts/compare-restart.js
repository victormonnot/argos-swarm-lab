import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRestartTrace, restartSummary, restartFrame } from '../src/restart-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: npm run compare:restart -- [path/to/recording.json]');
  process.exit(2);
}
try {
  const trace = validateRestartTrace(JSON.parse(readFileSync(resolve(root, args[0] ?? 'docs/results/ros2-restart.json'), 'utf8')));
  const sourceHash = createHash('sha256').update(readFileSync(resolve(root, 'ros2/restart.py'))).digest('hex');
  const sourceHashMatches = trace.runtime.sourceSha256 === sourceHash;
  console.log(JSON.stringify({ sourceHashMatches, runtime: trace.runtime,
    cases: trace.cases.map(run => ({
      id: run.id, publications: run.publications.length, callbacks: run.callbacks.length,
      endMs: run.endMs, agents: run.agents, observer: run.observer, collector: run.collector,
      processEvents: run.processEvents, transitions: run.transitions,
      summaries: restartSummary(run),
      finalHeldInformation: restartFrame(run, run.endMs).policies.map(({ id, status, epoch, seq, receiptAgeMs, generationAgeMs, positionError }) => ({
        id, status, epoch, seq, receiptAgeMs, generationAgeMs, positionError,
      })),
    })),
  }, null, 2));
  if (!sourceHashMatches) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
