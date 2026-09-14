import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALPHA, BUDGET, THRESHOLD } from '../src/model.js';
import { compareScenarios } from '../src/comparisons.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null;
let workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // Exported copies can run without Git; do not invent revision metadata.
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  revision,
  workingTreeModified,
  sourceHashes: Object.fromEntries(['src/model.js', 'src/comparisons.js'].map((path) => [
    path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex'),
  ])),
  model: { agents: 6, alpha: ALPHA, budget: BUDGET, threshold: THRESHOLD, exchangeUnit: 'one directed scalar value per active edge endpoint per update' },
  results: compareScenarios(),
}, null, 2));
