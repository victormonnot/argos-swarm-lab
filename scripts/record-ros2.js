import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateTrace, compareTrace } from '../src/ros2-trace.js';

// Official ROS Jazzy image index, pinned on 2026-09-16 (amd64 and arm64).
const image = 'ros:jazzy-ros-base@sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('Usage: npm run record:ros2 -- [--output local/ros2-consensus.json]');
  process.exit(2);
}
const output = resolve(root, args[1] ?? 'local/ros2-consensus.json');
const container = `argos-ros2-${process.pid}-${randomUUID().slice(0, 8)}`;
let child;
let stopped = false;
const stopContainer = () => {
  if (stopped) return;
  stopped = true;
  spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore', timeout: 10000 });
  if (child?.exitCode === null) child.kill('SIGTERM');
};
const interrupt = () => {
  stopContainer();
  process.exitCode = 130;
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
  console.error('Starting six ROS 2 agents and one round collector in a disposable container.');
  console.error('Docker downloads the pinned image on first use. No host ROS installation is needed.');
  child = spawn('docker', [
    'run', '--rm', '--init', '--name', container, '--network', 'none',
    '--env', 'ROS_DOMAIN_ID=42', '--env', 'ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST',
    '--env', 'RMW_IMPLEMENTATION=rmw_fastrtps_cpp', '--env', 'PYTHONDONTWRITEBYTECODE=1',
    '--env', 'ROS_LOG_DIR=/tmp/ros-logs',
    '--mount', `type=bind,source=${resolve(root, 'ros2')},target=/work/ros2,readonly`,
    image, 'python3', '/work/ros2/consensus.py', '--image', image,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  let raw = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stopContainer(); }, 180000);
  try {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { raw += chunk; });
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    if (code !== 0 || stopped) throw new Error(timedOut ? 'ROS recording exceeded the 180 s limit.' : `ROS recorder exited with status ${code}.`);
    const trace = validateTrace(JSON.parse(raw));
    const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'ros2/consensus.py'))).digest('hex');
    if (trace.cases.length !== 3 || trace.runtime.sourceSha256 !== sourceHash
        || !trace.cases.every(recording => compareTrace(recording).matches)) {
      throw new Error('ROS recorder returned an unexpected trace.');
    }
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(trace)}\n`);
    await rename(temporary, output);
    console.error(`Recorded ${trace.cases.map(item => `${item.id}: ${item.outcome.completedRounds} rounds, ${item.outcome.status}`).join('; ')}.`);
    console.error(`Saved ${output}`);
  } finally {
    clearTimeout(timer);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = process.exitCode || 1;
} finally {
  stopContainer();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
