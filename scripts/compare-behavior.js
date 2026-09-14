import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DT, SPEED, INSPECTION_SECONDS, TIME_LIMIT, HOME, HOME_HOVER, STATION, referenceComparisons } from '../src/behavior-model.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
let revision = null, workingTreeModified = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeModified = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
} catch {
  // Exported checkouts may not include Git metadata.
}
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(), runtime: process.version, revision, workingTreeModified,
  sourceHashes: { 'src/behavior-model.js': createHash('sha256').update(readFileSync(new URL('../src/behavior-model.js', import.meta.url))).digest('hex') },
  model: {
    agents: 1, commandIntervalSeconds: DT, speedMetresPerSecond: SPEED, inspectionSeconds: INSPECTION_SECONDS, timeBudgetSeconds: TIME_LIMIT,
    coordinates: 'Cartesian metres, z is altitude; vehicle attitude is presentation only.', home: HOME, homeHover: HOME_HOVER, station: STATION,
    mission: 'Take off to home hover, fly to the inspection station, inspect for three uninterrupted seconds, return to home hover, and land. Completed actions latch Success and do not execute again.',
    timing: 'Each control tick samples current Hold and sensor inputs, traverses the controller, selects at most one Running action, then integrates one 0.25-second command interval. A completed action returns Success at the next tick, which can select the following action at that same physical boundary. A final controller-Success observation tick selects no action and advances no physical time. Thus nominal execution has 60 physical intervals and 61 control ticks, finishing at 15 seconds.',
    controllers: 'Reactive BT: root fallback reevaluates Hold sequence before mission/recovery on every tick. FSM: equivalent global Hold guard and explicit phase transitions. Memory BT: only the root fallback resumes its previously Running child; all sequences and the inner fallback are reactive. This particular root memory placement skips a newly raised higher-priority Hold condition; it is not a universal limitation of Behavior Trees or memory nodes.',
    tree: 'Root fallback: [reactive sequence(Hold requested?, Hold), reactive fallback(reactive sequence(Takeoff, Fly, Inspect, Return, Land), reactive sequence(Abort return, Abort land))]. Sequence returns the first non-Success result; fallback returns the first non-Failure result. Unticked nodes are Idle in the trace.',
    interruption: 'Hold cancels the prior Running action before the next command. Position is retained. An interrupted partial inspection is discarded and restarts from zero after Hold releases. Successful actions remain latched. Hold itself returns Running until it is no longer selected.',
    failure: 'In the sensor-failure case, the input fails at 7 seconds. An active Inspect returns Failure and discards partial inspection; the fallback/FSM selects Abort return in the same tick, then Abort land. Recovery root Success is an aborted mission, not successful inspection. A previously completed inspection is not retroactively failed by a later unavailable input.',
    schedules: 'Nominal: no disruption. Pause: Hold sample true at 7 <= t < 10 seconds. Persistent: Hold true from 7 seconds until the 30-second budget. Sensor failure: inspection sensor unavailable from 7 seconds. Inputs are perfect and instantaneous at the sampling boundary; no communication delay or detection inference is modeled.',
    agentInputs: 'Own exact 3D pose, action completion latches and service progress, fixed waypoints and current Hold/sensor samples. Controllers cannot read the evaluator schedule or future disruption times.',
    evaluator: 'Inject scheduled input values; measure travel distance, terminal mission outcome, discarded partial inspection, productive-action preemptions and command intervals in which a Hold input was ignored. Evaluator metrics are not controller inputs.',
    metrics: 'completionTime is seconds only for a successfully inspected-and-landed mission; otherwise null. terminationTime is the observed terminal time, including aborted recovery or budget timeout. holdIgnoredSeconds sums 0.25-second executed intervals with Hold true and selected action other than Hold, even if velocity is zero during inspection. discardedInspectionSeconds includes partial progress lost to Hold or inspection failure. interruptions counts productive actions preempted by Hold, excluding action failure and release of Hold. Distance is accumulated Euclidean displacement in metres.',
    stopping: 'Stop on observed controller completion or after integrating to the 30-second budget. Ignored-Hold exposure ends at terminal completion; persistent-hold memory thus records 8 seconds before it finishes at 15 seconds, not all remaining time to the budget. At timeout the final Running command remains in the trace and no further interval is executed.',
    fidelity: 'One deterministic browser executor and a true 3D point-kinematic trajectory. The drone shape and scene are visualization. No flight dynamics, acceleration limits, battery, obstacle avoidance, physics contacts, allocation, radio, middleware, commercial BT runtime or autopilot integration.',
  },
  methodSources: [
    { title: 'Colledanchise and Ogren, Behavior Trees in Robotics and AI: An Introduction', url: 'https://arxiv.org/abs/1709.00084' },
    { title: 'BehaviorTree.CPP official fallback-node semantics', url: 'https://www.behaviortree.dev/docs/nodes-library/FallbackNode/' },
    { title: 'BehaviorTree.CPP official sequence-node semantics', url: 'https://www.behaviortree.dev/docs/nodes-library/SequenceNode/' },
    { title: 'BehaviorTree.CPP asynchronous actions and halting', url: 'https://www.behaviortree.dev/docs/tutorial-basics/tutorial_04_sequence/' },
  ],
  references: referenceComparisons(),
}, null, 2));
