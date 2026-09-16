import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQosTrace, qosSummary, qosFrame } from '../src/qos-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: npm run compare:qos -- [path/to/recording.json]');
  process.exit(2);
}
try {
  const trace = validateQosTrace(JSON.parse(readFileSync(resolve(root, args[0] ?? 'docs/results/ros2-qos.json'), 'utf8')));
  const sourceHash = createHash('sha256').update(readFileSync(resolve(root, 'ros2/freshness.py'))).digest('hex');
  const sourceHashMatches = trace.runtime.sourceSha256 === sourceHash;
  console.log(JSON.stringify({
    sourceHashMatches, runtime: trace.runtime,
    cases: trace.cases.map(run => ({
      id: run.id, publications: run.publications.length, endMs: run.endMs,
      processes: [run.publisher, run.collector, ...run.readers.map(({ id, node, pid }) => ({ id, node, pid }))],
      summaries: qosSummary(run),
      finalHeldInformation: qosFrame(run, run.endMs).readers.map(({ id, ageMs, fresh, positionError, lastAccepted }) => ({
        id, seq: lastAccepted?.seq ?? null, ageMs, fresh, positionError,
      })),
    })),
  }, null, 2));
  if (!sourceHashMatches) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
