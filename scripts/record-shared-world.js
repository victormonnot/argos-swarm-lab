import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const baseImage = 'ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02';
const binaryHash = '011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482';
const paramsHash = '5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  console.error('Usage: npm run record:shared-world -- [--output local/ardupilot-shared-world.json]');
  process.exit(2);
}
const output = resolve(root, args[1] ?? 'local/ardupilot-shared-world.json');
const parentTag = 'argos-ardupilot-gazebo:4.7.1-harmonic';
const imageTag = 'argos-ardupilot-shared-world:4.7.1-harmonic';
const container = `argos-shared-world-${process.pid}-${randomUUID().slice(0, 8)}`;
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
  console.error('Preparing three ArduCopter 4.7.1 JSON processes and one Gazebo Harmonic 8.15.0 world.');
  await docker(['build', '--tag', parentTag, '--file', resolve(root, 'gazebo/Dockerfile'), resolve(root, 'gazebo')], 600000);
  const gazeboImage = (await docker(['image', 'inspect', parentTag, '--format', '{{.Id}}'], 10000, true)).trim();
  await docker(['build', '--tag', imageTag, '--build-arg', `GAZEBO_IMAGE=${parentTag}`,
    '--file', resolve(root, 'shared-world/Dockerfile'), resolve(root, 'shared-world')], 180000);
  const image = (await docker(['image', 'inspect', imageTag, '--format', '{{.Id}}'], 10000, true)).trim();
  const parentAfter = (await docker(['image', 'inspect', parentTag, '--format', '{{.Id}}'], 10000, true)).trim();
  if (![image, gazeboImage].every(value => /^sha256:[a-f0-9]{64}$/.test(value)) || parentAfter !== gazeboImage) {
    throw new Error('Docker image identity changed or was not content-addressed.');
  }
  console.error('Recording nominal and controlled withdrawal, each with one shared collidable world and three autopilots.');
  const mounts = ['sitl', 'fleet', 'recovery', 'gazebo', 'shared-world'].flatMap(name =>
    ['--mount', `type=bind,source=${resolve(root, name)},target=/work/${name},readonly`]);
  const raw = await docker(['run', '--rm', '--init', '--name', container, '--network', 'none', ...mounts,
    image, 'python3', '/work/shared-world/record.py', '--image', image, '--base-image', baseImage,
    '--gazebo-image', gazeboImage], 600000, true);
  const { validateSharedWorldTrace } = await import('../src/shared-world-trace.js');
  const trace = validateSharedWorldTrace(JSON.parse(raw));
  const fingerprint = async file => createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
  if (trace.runtime.sourceSha256 !== await fingerprint('shared-world/record.py') || trace.runtime.image !== image
      || trace.runtime.gazeboImage !== gazeboImage || trace.runtime.baseImage !== baseImage
      || trace.runtime.binarySha256 !== binaryHash || trace.runtime.paramsSha256 !== paramsHash
      || trace.cases.length !== 2 || !['nominal', 'withdrawal'].every(id => trace.cases.some(run => run.id === id))) {
    throw new Error('Unexpected shared-world runtime identity or collection.');
  }
  for (const [key, file] of Object.entries({ sitlSourceSha256: 'sitl/record.py', fleetSourceSha256: 'fleet/record.py',
    recoverySourceSha256: 'recovery/record.py', dockerfileSha256: 'shared-world/Dockerfile' })) {
    if (trace.runtime[key] !== await fingerprint(file)) throw new Error(`Shared helper fingerprint mismatch: ${file}`);
  }
  for (const [prefix, files] of [['shared-world', trace.runtime.filesSha256], ['gazebo', trace.runtime.gazeboFilesSha256]]) {
    const expected = prefix === 'shared-world'
      ? ['record.py', 'SharedWorldObserver.cc', 'world.sdf', 'overrides.parm', 'Dockerfile', 'CMakeLists.txt']
      : ['Dockerfile', 'CMakeLists.txt', 'TruthObserver.cc'];
    if (Object.keys(files).sort().join() !== expected.sort().join()) throw new Error('Incomplete runtime source manifest.');
    for (const [name, hash] of Object.entries(files)) {
      if (hash !== await fingerprint(`${prefix}/${name}`)) throw new Error(`Source fingerprint mismatch: ${prefix}/${name}`);
    }
  }
  await mkdir(dirname(output), { recursive: true });
  if (stopped) throw new Error('Recording interrupted before saving.');
  temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(trace)}\n`);
  if (stopped) throw new Error('Recording interrupted before replacing the output.');
  await rename(temporary, output);
  temporary = undefined;
  console.error(`Recorded ${trace.cases.map(run => `${run.id}: ${run.outcome.tasksCompleted}/6 tasks, ${run.outcome.landedVehicles}/3 landed, ${run.outcome.status}`).join('; ')}.`);
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
