import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateFleetTrace } from '../src/fleet-trace.js';

const baseImage = 'python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2';
const binaryHash = '011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482';
const paramsHash = '5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('Usage: npm run record:fleet -- [--output local/ardupilot-fleet.json]');
  process.exit(2);
}
const output = resolve(root, args[1] ?? 'local/ardupilot-fleet.json');
const imageTag = 'argos-ardupilot-sitl:4.7.1';
const container = `argos-fleet-${process.pid}-${randomUUID().slice(0, 8)}`;
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
  console.error('Preparing a two-vehicle ArduCopter 4.7.1 mission inside Docker (Linux amd64).');
  console.error('The first build downloads a checksum-verified official simulator and Python packages.');
  await docker(['build', '--tag', imageTag, '--file', resolve(root, 'sitl/Dockerfile'), resolve(root, 'sitl')], 180000);
  const image = (await docker(['image', 'inspect', imageTag, '--format', '{{.Id}}'], 10000, true)).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Docker returned no content-addressed image ID.');
  console.error('Recording two concurrent vehicles per case, with separate loopback MAVLink routes and one mission deadline.');
  const raw = await docker(['run', '--rm', '--init', '--name', container, '--network', 'none',
    '--mount', `type=bind,source=${resolve(root, 'sitl')},target=/work/sitl,readonly`,
    '--mount', `type=bind,source=${resolve(root, 'fleet')},target=/work/fleet,readonly`,
    image, 'python', '/work/fleet/record.py', '--image', image, '--base-image', baseImage], 420000, true);
  const trace = validateFleetTrace(JSON.parse(raw));
  const sourceHash = createHash('sha256').update(await readFile(resolve(root, 'fleet/record.py'))).digest('hex');
  if (trace.runtime.sourceSha256 !== sourceHash || trace.runtime.image !== image || trace.runtime.baseImage !== baseImage
      || trace.runtime.binarySha256 !== binaryHash || trace.runtime.paramsSha256 !== paramsHash
      || trace.cases.length !== 2 || !['nominal', 'misaddressed'].every(id => trace.cases.some(run => run.id === id))) {
    throw new Error('Unexpected fleet runtime identity or collection.');
  }
  if (trace.runtime.sitlSourceSha256 !== createHash('sha256').update(await readFile(resolve(root, 'sitl/record.py'))).digest('hex')
      || trace.runtime.dockerfileSha256 !== createHash('sha256').update(await readFile(resolve(root, 'sitl/Dockerfile'))).digest('hex')) {
    throw new Error('Shared SITL runtime source fingerprint mismatch.');
  }
  await mkdir(dirname(output), { recursive: true });
  if (stopped) throw new Error('Recording interrupted before saving.');
  temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(trace)}\n`);
  if (stopped) throw new Error('Recording interrupted before replacing the output.');
  await rename(temporary, output);
  temporary = undefined;
  console.error(`Recorded ${trace.cases.map(run => `${run.id}: ${run.outcome.tasksCompleted}/2 tasks, ${run.outcome.landedVehicles}/2 landed, ${run.outcome.status}`).join('; ')}.`);
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
