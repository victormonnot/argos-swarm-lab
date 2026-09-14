import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  DT, MAX_STEPS, RADIUS, SAFETY_PADDING, MAX_SPEED, GOAL_RADIUS,
  ATTRACTION_GAIN, PEER_RANGE, SEPARATION_GAIN, SCENARIOS, createRun, referenceComparisons,
} from '../src/orca-model.js';

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
  sourceHashes: { 'src/orca-model.js': createHash('sha256').update(readFileSync(new URL('../src/orca-model.js', import.meta.url))).digest('hex') },
  model: {
    lengthUnit: 'm', timeUnit: 's', velocityUnit: 'm/s', dt: DT, budget: MAX_STEPS,
    radius: RADIUS, orcaSafetyPaddingPerDisk: SAFETY_PADDING, maxSpeed: MAX_SPEED,
    goalRadius: GOAL_RADIUS, attractionGain: ATTRACTION_GAIN, apfPeerRange: PEER_RANGE,
    apfSeparationGain: SEPARATION_GAIN, horizonRange: [0.25, 5], referenceHorizon: 2,
    initialConditions: Object.fromEntries(Object.keys(SCENARIOS).map((scenario) => [scenario,
      createRun({ scenario }).agents.map(({ id, position, velocity, goal }) => ({ id, position, velocity, goal }))])),
    sensing: 'Exact synchronous observations of every other disk position, current velocity and radius. Peer goals, preferred velocities and future commands are not observed. The blind scenario supplies empty peer lists to every agent with unchanged crossing geometry.',
    communication: 'No explicit inter-agent messages, delayed packets or radio model. Each modeled agent computes its own command from permitted observations.',
    preference: 'Goal displacement times 0.6 per second, capped at 1 m/s; preferred velocity is zero inside the 0.15 m goal disk. Arrived agents remain observable and may move again if avoidance requires it.',
    orca: 'Finite-horizon disk velocity obstacle; closest point on near circular cap or tangent rays; point = vCurrent + u / 2, outward normal n; feasible dot(v - point, n) >= 0. Constraint radii are physical radius plus 0.01 m per disk.',
    solver: 'Euclidean nearest preferred velocity in the speed disk intersected with all half-planes. Enumerate disk projection, orthogonal line projections, line-line intersections and line-circle intersections; numerical feasibility tolerance 1e-10.',
    infeasibility: 'An empty intersection gives an explicitly flagged zero command, which is not guaranteed safe. infeasibleSteps counts completed ticks with at least one infeasible agent; it does not count agent-ticks.',
    apf: 'The earlier surface-clearance law: sum 0.02 * (1 / d - 1 / 0.7) / d^2 times the outward unit vector for 0 < d < 0.7 m. Add to goal attraction before the 1 m/s cap. Physical 0.3 m radius, no ORCA padding.',
    direct: 'Capped preferred velocity with no peer avoidance.',
    eventOrder: ['Observe the old synchronous snapshot', 'Compute all commands independently', 'Apply constant velocities for one 0.05 s interval', 'Evaluate swept physical disk clearance and simultaneous arrival', 'Stop on contact, then arrival, then 40 s timeout'],
    inspection: 'At initialization the display contains the prepared time 0 decision; after a tick it contains the last applied pre-step decision (decisionTime, decisionPosition, decisionVelocity, preferred, command and constraints). Views do not advance the experiment.',
    metrics: 'Minimum physical surface clearance over simultaneous relative straight-line motion in every completed interval, including the terminal one. Arrival count uses current Euclidean goal distance <= 0.15 m; arrival requires all agents in their goal disks at one boundary.',
    stopping: 'Swept physical clearance <= 0 takes priority over arrival and the 800-step budget. A detected contact stops further intervals; the displayed positions are the end of the interval in which contact was detected, not an interpolated contact event.',
    limitations: 'Deterministic holonomic disk kinematics in an unbounded plane. No static obstacles, route planner, acceleration or turn limits, uncertain sensing, reciprocity-breaking controller, physical dynamics, middleware or unconditional safety/liveness guarantee.',
  },
  references: referenceComparisons(),
}, null, 2));
