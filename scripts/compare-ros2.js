import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTrace, compareTrace, traceMetrics } from '../src/ros2-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: npm run compare:ros2 -- [path/to/recording.json]');
  process.exit(2);
}
try {
  const recording = validateTrace(JSON.parse(readFileSync(resolve(root, args[0] ?? 'docs/results/ros2-consensus.json'), 'utf8')));
  const sourceHash = createHash('sha256').update(readFileSync(resolve(root, 'ros2/consensus.py'))).digest('hex');
  const cases = recording.cases.map(item => ({
    id: item.id, ...compareTrace(item), outcome: item.outcome,
    ...traceMetrics(item.states.at(-1).values),
    publications: item.rounds.reduce((total, round) => total + round.published.length, 0),
    neighborReceipts: item.rounds.reduce((total, round) => total + round.received.length, 0),
    distinctAgentProcesses: new Set(item.agents.map(agent => agent.pid)).size,
    missingAtStop: item.rounds.at(-1)?.missing ?? [],
  }));
  console.log(JSON.stringify({
    tolerance: 1e-10,
    sourceHashMatches: sourceHash === recording.runtime.sourceSha256,
    runtime: recording.runtime, cases,
  }, null, 2));
  if (!cases.every(item => item.matches) || sourceHash !== recording.runtime.sourceSha256) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
