import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMiddlewareTrace, middlewareSummary } from '../src/middleware-trace.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length > 3) throw new Error('Usage: npm run compare:middleware -- [recording.json]');
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'docs/results/ros2-middleware.json');
  const trace = validateMiddlewareTrace(JSON.parse(await readFile(path, 'utf8')));
  const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'ros2/middleware.py'))).digest('hex');
  console.log(JSON.stringify({
    runtime: trace.runtime, sourceHashMatches: trace.runtime.sourceSha256 === sourceHash,
    cases: trace.cases.map(run => ({ id: run.id, label: run.label, runId: run.runId,
      publisher: run.publisher, reader: run.reader, router: run.router,
      processEvents: run.processEvents, endMs: run.endMs, ...middlewareSummary(run) })),
  }, null, 2));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
