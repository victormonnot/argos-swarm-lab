import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateGazeboTrace } from '../src/gazebo-trace.js';

const baseImage = 'ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02';
const binaryHash = '011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482';
const pluginRevision = '082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('Usage: npm run record:gazebo -- [--output local/ardupilot-gazebo.json]');
  process.exit(2);
}
const output = resolve(root, args[1] ?? 'local/ardupilot-gazebo.json');
const imageTag = 'argos-ardupilot-gazebo:4.7.1-harmonic';
const container = `argos-gazebo-${process.pid}-${randomUUID().slice(0, 8)}`;
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
  } finally { clearTimeout(timer); }
}

try {
  console.error('Preparing ArduCopter 4.7.1 + Gazebo Harmonic 8.15.0 in Docker (Linux amd64).');
  console.error('The first build installs pinned Gazebo packages and compiles the official JSON bridge plus evaluator observer.');
  await docker(['build', '--tag', imageTag, '--file', resolve(root, 'gazebo/Dockerfile'), resolve(root, 'gazebo')], 600000);
  const image = (await docker(['image', 'inspect', imageTag, '--format', '{{.Id}}'], 10000, true)).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Docker returned no content-addressed image ID.');
  console.error('Recording two fresh Gazebo worlds: nominal hover and a measured physical force pulse; no external network.');
  const raw = await docker(['run', '--rm', '--init', '--name', container, '--network', 'none',
    '--mount', `type=bind,source=${resolve(root, 'sitl')},target=/work/sitl,readonly`,
    '--mount', `type=bind,source=${resolve(root, 'gazebo')},target=/work/gazebo,readonly`,
    image, 'python3', '/work/gazebo/record.py', '--image', image, '--base-image', baseImage], 420000, true);
  const trace = validateGazeboTrace(JSON.parse(raw));
  const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'gazebo/record.py'))).digest('hex');
  if (trace.runtime.sourceSha256 !== sourceHash || trace.runtime.image !== image || trace.runtime.baseImage !== baseImage
      || trace.runtime.binarySha256 !== binaryHash || trace.runtime.pluginGitHash !== pluginRevision
      || trace.cases.length !== 2 || !['nominal', 'pulse'].every(id => trace.cases.some(run => run.id === id))) {
    throw new Error('Unexpected Gazebo runtime identity or collection.');
  }
  for (const [name, fingerprint] of Object.entries(trace.runtime.filesSha256)) {
    if (!['record.py', 'TruthObserver.cc', 'world.sdf', 'overrides.parm', 'Dockerfile', 'CMakeLists.txt'].includes(name)
      || fingerprint !== createHash('sha256').update(await readFile(resolve(root, 'gazebo', name))).digest('hex')) {
      throw new Error(`Runtime source fingerprint mismatch: ${name}`);
    }
  }
  if (trace.runtime.sitlSourceSha256 !== createHash('sha256').update(await readFile(resolve(root, 'sitl/record.py'))).digest('hex')) {
    throw new Error('Shared MAVLink helper fingerprint mismatch.');
  }
  await mkdir(dirname(output), { recursive: true });
  if (stopped) throw new Error('Recording interrupted before saving.');
  temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(trace)}\n`);
  if (stopped) throw new Error('Recording interrupted before replacing the output.');
  await rename(temporary, output);
  temporary = undefined;
  console.error(`Recorded ${trace.cases.map(run => `${run.id}: ${run.telemetry.length} telemetry messages, ${run.truth.length} world samples, ${run.outcome.status}`).join('; ')}.`);
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
