import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateMiddlewareTrace } from '../src/middleware-trace.js';

const baseImage = 'ros:jazzy-ros-base@sha256:c3706ef0a0aa45413c07803cf433602f543b22e45b4855f6fca955c2d8ecc4e8';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('Usage: npm run record:middleware -- [--output local/ros2-middleware.json]');
  process.exit(2);
}
const output = resolve(root, args[1] ?? 'local/ros2-middleware.json');
const imageTag = 'argos-ros2-middleware:jazzy-0.2.10';
const container = `argos-middleware-${process.pid}-${randomUUID().slice(0, 8)}`;
let child;
let stopped = false;
let temporary;
const stop = () => {
  if (stopped) return;
  stopped = true;
  spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore', timeout: 10000 });
  if (child?.exitCode === null) child.kill('SIGTERM');
};
const interrupt = () => { stop(); process.exitCode = 130; };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

async function docker(args, timeoutMs, capture = false) {
  if (stopped) throw new Error('Recording interrupted.');
  child = spawn('docker', args, { stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
  let raw = '';
  let timedOut = false;
  if (capture) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { raw += chunk; });
  }
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    if (code !== 0 || stopped) throw new Error(timedOut
      ? `Docker operation exceeded ${timeoutMs / 1000} s.` : `Docker operation exited with status ${code}.`);
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

try {
  console.error('Preparing a cached image with the same pinned ROS base and both RMW implementations.');
  console.error('The first build downloads two pinned Zenoh packages into Docker; the host ROS setup is unchanged.');
  await docker(['build', '--tag', imageTag, '--file', resolve(root, 'ros2/middleware.Dockerfile'),
    resolve(root, 'ros2')], 180000);
  const image = (await docker(['image', 'inspect', imageTag, '--format', '{{.Id}}'], 10000, true)).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Docker did not return a content-addressed image ID.');
  console.error('Recording four six-second late-subscription cases through actual Fast DDS and Zenoh.');
  const raw = await docker([
    'run', '--rm', '--init', '--name', container, '--network', 'none',
    '--env', 'ROS_DOMAIN_ID=45', '--env', 'ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST',
    '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'ROS_LOG_DIR=/tmp/ros-logs',
    '--mount', `type=bind,source=${resolve(root, 'ros2')},target=/work/ros2,readonly`,
    image, 'python3', '/work/ros2/middleware.py', '--image', image, '--base-image', baseImage,
  ], 120000, true);
  const trace = validateMiddlewareTrace(JSON.parse(raw));
  const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'ros2/middleware.py'))).digest('hex');
  const expected = ['fastdds-volatile', 'fastdds-transient_local', 'zenoh-volatile', 'zenoh-transient_local'];
  if (trace.cases.length !== 4 || trace.runtime.sourceSha256 !== sourceHash || trace.runtime.image !== image
      || trace.runtime.baseImage !== baseImage || !expected.every(id => trace.cases.some(item => item.id === id))) {
    throw new Error('Middleware recorder returned an unexpected collection or runtime identity.');
  }
  await mkdir(dirname(output), { recursive: true });
  if (stopped) throw new Error('Recording interrupted before saving.');
  temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(trace)}\n`);
  if (stopped) throw new Error('Recording interrupted before replacing the output.');
  await rename(temporary, output);
  temporary = undefined;
  console.error(`Recorded ${trace.cases.map(item => `${item.id}: ${item.publications.length} publications, ${item.callbacks.length} callbacks`).join('; ')}.`);
  console.error(`Saved ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = process.exitCode || 1;
} finally {
  stop();
  if (temporary) await unlink(temporary).catch(() => {});
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
