import {
  recoveryEvents, recoveryFrame, recoverySummary, validateRecoveryMissionCases,
} from './recovery-trace.js';

const finite = x => typeof x === 'number' && Number.isFinite(x);
const vector = (x, size = 3) => Array.isArray(x) && x.length === size && x.every(finite);
// Generous import envelope: keep derived distances and GPU coordinates finite.
// These limits are numeric admission rules, not a physical safety envelope.
const boundedVector = (x, limit) => vector(x) && x.every(value => Math.abs(value) <= limit);
const text = (x, limit = 500) => typeof x === 'string' && x.length > 0 && x.length <= limit;
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const near = (a, b, tolerance = 1e-5) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const check = (condition, message) => { if (!condition) throw new Error(`Invalid shared-world trace: ${message}`); };
const kinds = ['ground', 'obstacle', 'vehicle', 'other'];
const pairKey = pair => [pair.collision1, pair.collision2].sort().join('|');
const delta = (a, b) => a.map((x, i) => x - b[i]);
const distance = (a, b) => Math.hypot(...delta(a, b));

/** All three positions come from the same Gazebo update, never held MAVLink samples. */
export function worldPairs(snapshot) {
  if (!snapshot) return [];
  const pairs = [];
  snapshot.vehicles.forEach((a, i) => {
    for (const b of snapshot.vehicles.slice(i + 1)) pairs.push({
      vehicleIds: [a.id, b.id], distanceM: distance(a.positionEnu, b.positionEnu),
    });
  });
  return pairs;
}

export function closestWorldApproach(run, untilMs = run.endMs) {
  let closest = null;
  for (const sample of run.truth) {
    if (sample.timeMs > untilMs) break;
    for (const pair of worldPairs(sample)) if (!closest || pair.distanceM < closest.distanceM) {
      closest = { ...pair, timeMs: sample.timeMs, simTimeMs: sample.simTimeMs };
    }
  }
  return closest;
}

export function sharedWorldEvents(run) {
  return [...recoveryEvents(run), ...run.truth.map(data => ({
    kind: 'world', timeMs: data.timeMs, data, vehicleId: null,
  }))].sort((a, b) => a.timeMs - b.timeMs);
}

const shiftToWorld = (vehicle, missionPosition) => missionPosition && vehicle.originTruthEnu
  ? missionPosition.map((x, axis) => x - vehicle.padEnu[axis] + vehicle.originTruthEnu[axis]) : null;

export function sharedWorldFrame(run, timeMs) {
  const frame = recoveryFrame(run, timeMs);
  const received = run.truth.filter(sample => sample.timeMs <= timeMs);
  const snapshot = received.at(-1) ?? null;
  const pairs = worldPairs(snapshot), closest = closestWorldApproach(run, timeMs);
  frame.vehicles = frame.vehicles.map(vehicle => {
    const raw = run.vehicles.find(v => v.id === vehicle.id);
    const observed = snapshot?.vehicles.find(v => v.id === vehicle.id) ?? null;
    // Registration is available only after both independently received baselines.
    const aligned = raw.originTruthTimeMs <= timeMs && raw.originTimeMs <= timeMs;
    const estimatePositionWorldEnu = aligned ? shiftToWorld(raw, vehicle.positionEnu) : null;
    return { ...vehicle, modelName: raw.modelName, jsonPort: raw.jsonPort,
      worldPositionEnu: observed?.positionEnu ?? null,
      worldOrientationXyzw: observed?.orientationXyzw ?? null,
      worldVelocityEnu: observed?.velocityEnu ?? null,
      worldAgeMs: snapshot ? timeMs - snapshot.timeMs : null,
      worldTrajectoryEnu: received.map(s => ({ timeMs: s.timeMs, simTimeMs: s.simTimeMs,
        positionEnu: s.vehicles.find(v => v.id === vehicle.id).positionEnu })),
      estimatePositionWorldEnu,
      estimateTrajectoryWorldEnu: aligned ? vehicle.trajectoryEnu.map(s => ({ ...s,
        positionEnu: shiftToWorld(raw, s.positionEnu) })) : [],
      taskTargetWorldEnu: aligned ? shiftToWorld(raw, vehicle.taskTargetEnu) : null,
      estimateWorldErrorM: observed && estimatePositionWorldEnu
        ? distance(estimatePositionWorldEnu, observed.positionEnu) : null,
    };
  });
  frame.tasks = frame.tasks.map(task => ({ ...task,
    positionWorldEnu: task.positionEnu.map((value, axis) => value + (axis === 2 ? run.world.spawnHeightM : 0)),
  }));
  frame.world = {
    available: Boolean(snapshot), name: run.world.name,
    receiptTimeMs: snapshot?.timeMs ?? null, simTimeMs: snapshot?.simTimeMs ?? null,
    ageMs: snapshot ? timeMs - snapshot.timeMs : null,
    pairs, minimumSeparationM: pairs.length ? Math.min(...pairs.map(p => p.distanceM)) : null,
    minimumObservedSeparationM: closest?.distanceM ?? null, closestApproach: closest,
    contacts: snapshot?.contacts ?? [], contactHistory: snapshot?.contactHistory ?? [],
    contactTotals: snapshot?.contactTotals ?? null, observerSteps: snapshot?.observerSteps ?? null,
    observerStartSimTimeMs: snapshot?.observerStartSimTimeMs ?? null,
    collisionCount: snapshot?.collisionCount ?? null,
    unexpectedContactCount: snapshot ? snapshot.contactHistory.filter(p => p.kind !== 'ground').length : null,
    receivedSamples: received.length,
  };
  return frame;
}

export function sharedWorldSummary(run) {
  const first = run.truth[0], last = run.truth.at(-1), closestApproach = closestWorldApproach(run);
  const gaps = run.truth.slice(1).map((row, i) => ({ hostMs: row.timeMs - run.truth[i].timeMs,
    simMs: row.simTimeMs - run.truth[i].simTimeMs }));
  return { ...recoverySummary(run), closestApproach,
    minimumSeparationM: closestApproach?.distanceM ?? null,
    truthSamples: run.truth.length, firstTruthMs: first?.timeMs ?? null, lastTruthMs: last?.timeMs ?? null,
    simStartMs: first?.simTimeMs ?? null, simEndMs: last?.simTimeMs ?? null,
    simDurationMs: last && first ? last.simTimeMs - first.simTimeMs : null,
    observedRealtimeFactor: last && first && last.timeMs > first.timeMs
      ? (last.simTimeMs - first.simTimeMs) / (last.timeMs - first.timeMs) : null,
    maximumReceiptGapMs: gaps.length ? Math.max(...gaps.map(g => g.hostMs)) : null,
    maximumSimGapMs: gaps.length ? Math.max(...gaps.map(g => g.simMs)) : null,
    contactTotals: last?.contactTotals ?? null, contactHistory: last?.contactHistory ?? [],
    observerSteps: last?.observerSteps ?? null,
    observerStartSimTimeMs: last?.observerStartSimTimeMs ?? null,
    collisionCount: last?.collisionCount ?? null,
    unexpectedContactCount: last ? last.contactHistory.filter(p => p.kind !== 'ground').length : null,
  };
}

/** This is consistency checking of an imported recording, not producer authentication. */
export function validateSharedWorldTrace(trace) {
  check(trace?.kind === 'argos-ardupilot-shared-world' && trace.schemaVersion === 1, 'unsupported format');
  const rt = trace.runtime;
  check(rt && ['recordedAt', 'ardupilotVersion', 'firmwareGitHash', 'image', 'baseImage', 'python', 'pymavlink',
    'binaryUrl', 'gazeboVersion', 'pluginGitHash'].every(key => text(rt[key]))
    && Number.isFinite(Date.parse(rt.recordedAt)), 'runtime metadata');
  check(['sourceSha256', 'sitlSourceSha256', 'fleetSourceSha256', 'recoverySourceSha256',
    'dockerfileSha256', 'binarySha256', 'paramsSha256'].every(key => hash(rt[key])), 'source fingerprints');
  const sourceFiles = ['record.py', 'SharedWorldObserver.cc', 'world.sdf', 'overrides.parm', 'Dockerfile', 'CMakeLists.txt'];
  const gazeboFiles = ['Dockerfile', 'CMakeLists.txt', 'TruthObserver.cc'];
  for (const [files, expected] of [[rt.filesSha256, sourceFiles], [rt.gazeboFilesSha256, gazeboFiles]]) {
    check(files && Object.keys(files).length === expected.length && expected.every(name => hash(files[name])), 'exact source file registry');
  }
  check(rt.filesSha256['record.py'] === rt.sourceSha256 && rt.filesSha256.Dockerfile === rt.dockerfileSha256
    && hash(rt.gazeboParamsSha256) && /^sha256:[a-f0-9]{64}$/.test(rt.gazeboImage), 'consistent runtime fingerprints');
  check(rt.model === 'iris' && rt.modelArgument === 'JSON' && rt.speedup === 1 && rt.mavlinkVersion === 2
    && rt.transport === 'tcp-loopback' && rt.clock === 'recorder-monotonic-receipt' && rt.platform === 'linux-amd64', 'runtime contract');
  check(rt.vehicleCount === 3 && rt.physics === 'shared-Gazebo-world'
    && rt.assignment === 'central-online-nearest-pair-greedy' && rt.behaviorTree === 'reactive-fallback-sequence'
    && rt.memoryMetric === 'process-VmRSS-KiB-snapshots', 'shared physics and coordinator contract');
  check(rt.positionFrame === 'supplied-ENU-layout-from-shared-world-local-NED'
    && rt.maxStepSizeMs === 1 && rt.realTimeFactorTarget === 1 && rt.lockStep === true && rt.noTimeSync === false
    && rt.truthClock === 'gazebo-simulation' && rt.truthReference === 'imu-link-ENU-FLU'
    && rt.snapshotSensors === 'three-world-poses-one-physics-step'
    && rt.contactsScope === 'all-31-colliders-every-observed-physics-step'
    && rt.contactHistoryScope === 'since-observer-readiness', 'physics, clock and observer configuration');
  validateRecoveryMissionCases(trace.cases, rt, 'gazebo-shared');
  for (const run of trace.cases) validateWorld(run);
  return trace;
}

function contactKind(run, pair) {
  const vehicle = name => run.vehicles.find(v => name.startsWith(`${v.modelName}::`));
  const a = vehicle(pair.collision1), b = vehicle(pair.collision2);
  if (a && b && a.id !== b.id) return 'vehicle';
  if (a || b) {
    const other = a ? pair.collision2 : pair.collision1;
    if (other === 'ground::ground::surface') return 'ground';
    if (run.world.buildings.some(building => other.startsWith(`${building.id}::`))) return 'obstacle';
  }
  return 'other';
}

function validateWorld(run) {
  const w = run.world;
  check(w && w.name === 'argos_shared_yard' && vector(w.groundSizeM, 2) && w.groundSizeM.every(x => x === 50)
    && near(w.spawnHeightM, .195) && w.observationLink === 'iris_with_standoffs::imu_link'
    && w.physicsStepMs === 1 && w.truthFrequencyHz === 20
    && Array.isArray(w.buildings) && w.buildings.length === 3, 'declared site and world observer');
  const buildings = [
    { id: 'west_store', positionEnu: [-11, 8, 2.5], size: [4, 10, 5] },
    { id: 'east_store', positionEnu: [11, 8, 3], size: [4, 10, 6] },
    { id: 'north_store', positionEnu: [0, 18, 2], size: [10, 4, 4] },
  ];
  check(w.buildings.every((b, i) => b && b.id === buildings[i].id && vector(b.positionEnu) && vector(b.size)
    && b.positionEnu.every((x, a) => near(x, buildings[i].positionEnu[a]))
    && b.size.every((x, a) => near(x, buildings[i].size[a]))), 'site geometry matches the fixed world');
  const names = new Set();
  for (const [i, v] of run.vehicles.entries()) {
    const intervals = { 0: 333333, 32: 33333, 30: 33333, 33: 33333, 245: 66666, 193: 166666, 24: 166666, 1: 166666 };
    check(v.setup.readinessTimeoutMs === 200000 && v.setup.telemetryIntervalsUs
      && Object.keys(v.setup.telemetryIntervalsUs).length === Object.keys(intervals).length
      && Object.entries(intervals).every(([id, interval]) => v.setup.telemetryIntervalsUs[id] === interval),
    'declared preparation deadline and simulation-time telemetry intervals');
    check(v.modelName === `A${i + 1}` && !names.has(v.modelName) && v.jsonPort === 9002 + 10 * i,
      'distinct JSON bridges and world models');
    names.add(v.modelName);
    check(boundedVector(v.originTruthEnu, 1e6) && finite(v.originTruthTimeMs) && v.originTruthTimeMs >= 0
      && v.originTruthTimeMs <= run.endMs, 'world alignment baseline');
    check(v.telemetry.filter(sample => sample.type === 'LOCAL_POSITION_NED').every(sample =>
      boundedVector([sample.data.x, sample.data.y, sample.data.z], 1e6)
      && boundedVector([sample.data.vx, sample.data.vy, sample.data.vz], 1e4)),
    'local position and velocity remain within the numeric import envelope');
  }
  const vehicleCollisions = ['base_link::base_collision', 'base_link::front_left_leg_collision',
    'base_link::front_right_leg_collision', 'base_link::rear_left_leg_collision', 'base_link::rear_right_leg_collision',
    'rotor_0::collision', 'rotor_1::collision', 'rotor_2::collision', 'rotor_3::collision'];
  const expectedCollisions = [...run.vehicles.flatMap(v => vehicleCollisions.map(name => `${v.modelName}::iris_with_standoffs::${name}`)),
    'ground::ground::surface', ...buildings.map(b => `${b.id}::body::shell`)].sort();
  check(Array.isArray(w.collisionNames) && w.collisionNames.length === expectedCollisions.length
    && w.collisionNames.every((name, i) => name === expectedCollisions[i]), 'all 31 fixed collision shapes are monitored');
  const collisionNames = new Set(w.collisionNames);
  const validPair = pair => pair && collisionNames.has(pair.collision1) && collisionNames.has(pair.collision2)
    && pair.collision1 < pair.collision2 && pair.kind === contactKind(run, pair);
  check(Number.isSafeInteger(run.gazeboPid) && run.gazeboPid > 0
    && run.vehicles.every(v => v.pid !== run.gazeboPid)
    && run.resources.every(row => row.gazebo?.pid === run.gazeboPid && row.gazebo.running === true
      && Number.isSafeInteger(row.gazebo.rssKiB) && row.gazebo.rssKiB > 0), 'one observed live Gazebo process overlaps the three autopilots');
  check(Array.isArray(run.truth) && run.truth.length >= 2 && run.truth.length <= 20000, 'bounded world observations');
  let previous = null;
  for (const row of run.truth) {
    check(row && finite(row.timeMs) && row.timeMs >= 0 && row.timeMs <= run.endMs && finite(row.simTimeMs) && row.simTimeMs >= 0
      && (!previous || row.timeMs >= previous.timeMs && row.simTimeMs > previous.simTimeMs), 'world receipt and simulation clocks');
    check(row.collisionCount === expectedCollisions.length && finite(row.observerStartSimTimeMs)
      && row.observerStartSimTimeMs >= 0 && row.observerStartSimTimeMs <= row.simTimeMs
      && Number.isSafeInteger(row.observerSteps) && row.observerSteps > 0
      && near(row.observerSteps, (row.simTimeMs - row.observerStartSimTimeMs) / w.physicsStepMs + 1)
      && (!previous || row.observerSteps > previous.observerSteps
        && near(row.observerStartSimTimeMs, previous.observerStartSimTimeMs)), 'continuous physics-step observer coverage');
    check(Array.isArray(row.vehicles) && row.vehicles.length === 3 && row.vehicles.every((v, i) => v && v.id === run.vehicles[i].id
      && boundedVector(v.positionEnu, 1e6) && boundedVector(v.velocityEnu, 1e4) && vector(v.orientationXyzw, 4)
      && near(v.orientationXyzw.reduce((sum, x) => sum + x * x, 0), 1, 1e-5)), 'three simultaneous finite poses and unit quaternions');
    check(Array.isArray(row.contacts) && row.contacts.length <= 465
      && Array.isArray(row.contactHistory) && row.contactHistory.length <= 465, 'bounded contact evidence');
    const history = new Map();
    for (const pair of row.contactHistory) {
      check(validPair(pair) && !history.has(pairKey(pair))
        && Number.isSafeInteger(pair.steps) && pair.steps > 0 && pair.steps <= row.observerSteps
        && finite(pair.firstSimTimeMs) && pair.firstSimTimeMs >= row.observerStartSimTimeMs && finite(pair.lastSimTimeMs)
        && pair.firstSimTimeMs <= pair.lastSimTimeMs && pair.lastSimTimeMs <= row.simTimeMs
        && pair.steps <= (pair.lastSimTimeMs - pair.firstSimTimeMs) / w.physicsStepMs + 1 + 1e-5,
      'cumulative physical collision pair evidence');
      history.set(pairKey(pair), pair);
    }
    const active = new Set();
    for (const pair of row.contacts) {
      check(validPair(pair) && !active.has(pairKey(pair)) && history.has(pairKey(pair))
        && near(history.get(pairKey(pair)).lastSimTimeMs, row.simTimeMs),
      'active contacts are classified and retained at the current physics step');
      active.add(pairKey(pair));
    }
    check(row.contactHistory.every(pair => !near(pair.lastSimTimeMs, row.simTimeMs)
      || active.has(pairKey(pair))), 'current-step contact history agrees with active pairs');
    check(row.contactTotals && kinds.every(kind => {
      const count = row.contactTotals[`${kind}Steps`], pairs = row.contactHistory.filter(p => p.kind === kind);
      return Number.isSafeInteger(count) && count >= 0 && count <= row.observerSteps
        && count >= Math.max(0, ...pairs.map(p => p.steps)) && count <= pairs.reduce((sum, p) => sum + p.steps, 0);
    }), 'contact category steps agree with pair coverage');
    if (previous) {
      const advanced = row.observerSteps - previous.observerSteps;
      const previousHistory = new Map(previous.contactHistory.map(pair => [pairKey(pair), pair]));
      check(kinds.every(kind => {
        const value = row.contactTotals[`${kind}Steps`] - previous.contactTotals[`${kind}Steps`];
        const pairIncrements = row.contactHistory.filter(pair => pair.kind === kind)
          .map(pair => pair.steps - (previousHistory.get(pairKey(pair))?.steps ?? 0));
        return value >= 0 && value <= advanced && value >= Math.max(0, ...pairIncrements)
          && value <= pairIncrements.reduce((sum, n) => sum + n, 0);
      }), 'contact counters advance only with observed physics steps');
      for (const old of previous.contactHistory) {
        const next = history.get(pairKey(old));
        check(next && next.kind === old.kind && near(next.firstSimTimeMs, old.firstSimTimeMs)
          && next.lastSimTimeMs >= old.lastSimTimeMs && next.steps >= old.steps && next.steps - old.steps <= advanced
          && (next.steps === old.steps ? near(next.lastSimTimeMs, old.lastSimTimeMs) : next.lastSimTimeMs > previous.simTimeMs),
        'past contacts cannot disappear or change their origin');
      }
      check(row.contactHistory.every(pair => previousHistory.has(pairKey(pair))
        || pair.firstSimTimeMs > previous.simTimeMs && pair.steps <= advanced),
      'newly observed collision pairs cannot claim unreported earlier contact');
    }
    previous = row;
  }
  const first = run.truth[0], last = run.truth.at(-1);
  check(first.timeMs <= run.missionStartMs && last.timeMs >= recoverySummary(run).landedMs, 'world evidence covers mission and final landing');
  for (const v of run.vehicles) {
    const origin = first.vehicles.find(p => p.id === v.id);
    check(near(v.originTruthTimeMs, first.timeMs) && v.originTruthEnu.every((x, i) => near(x, origin.positionEnu[i])),
      'alignment uses the first received shared snapshot');
    check(last.contactHistory.some(pair => pair.kind === 'ground'
      && [pair.collision1, pair.collision2].some(name => name.startsWith(`${v.modelName}::`))),
    'physical ground contact collection is demonstrated for every vehicle');
  }
}
