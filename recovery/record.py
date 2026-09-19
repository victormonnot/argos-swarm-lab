#!/usr/bin/env python3
"""Central mission coordinator with executable reactive Behavior Trees and three SITLs."""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fleet_helper', ROOT.parent / 'fleet/record.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)
sitl = fleet.sitl
CONFIG = dict(fleet.CONFIG, missionDurationMs=90000, tickIntervalMs=100, withdrawalDelayMs=500)
CONFIG.pop('waypointTimeoutMs')
TASKS = [dict(id=f'T{i+1}', positionEnu=[east, north, 4])
         for i, (east, north) in enumerate([(x, y) for y in [6, 12] for x in [-6, 0, 6]])]
REGISTRY = [dict(id=f'A{i+1}', systemId=i+1, componentId=1, instance=i, port=5760+i*10,
                 padEnu=[east, 0, 0]) for i, east in enumerate([-6, 0, 6])]
SUCCESS, FAILURE, RUNNING = 'SUCCESS', 'FAILURE', 'RUNNING'


class Node:
    """Ordinary reactive composites: every tick restarts with the first child."""
    def __init__(self, identifier, kind, children=(), callback=None):
        self.id, self.kind, self.children, self.callback = identifier, kind, children, callback

    def tick(self, context):
        row = dict(id=self.id, status=None)
        context['visited'].append(row)
        if self.kind == 'sequence':
            status = SUCCESS
            for child in self.children:
                status = child.tick(context)
                if status != SUCCESS:
                    break
        elif self.kind == 'fallback':
            status = FAILURE
            for child in self.children:
                status = child.tick(context)
                if status != FAILURE:
                    break
        else:
            status = self.callback(context)
        row['status'] = status
        return status


def make_tree(coordinator, vehicle):
    def condition(identifier, predicate):
        return Node(identifier, 'condition', callback=lambda context: SUCCESS if predicate(context['inputs']) else FAILURE)
    def action(identifier):
        return Node(identifier, 'action', callback=lambda context: coordinator.action(vehicle, identifier, context))
    return Node('root', 'fallback', [
        Node('withdraw', 'sequence', [condition('withdrawRequested', lambda i: i['withdrawRequested']), action('withdrawLand')]),
        Node('cleanup', 'sequence', [condition('missionClosed', lambda i: i['missionClosed']), action('cleanupLand')]),
        Node('execute', 'sequence', [action('guided'), action('arm'), action('takeoff'),
            Node('work', 'fallback', [Node('assigned', 'sequence', [
                condition('hasTask', lambda i: i['attemptId'] is not None), action('task')]), action('wait')])])])


class Vehicle(fleet.Vehicle):
    def __init__(self, registry, process, home):
        super().__init__(registry, process, home)
        self.completed_stages = {}
        self.active_attempt = None
        self.running_action = None
        self.withdraw_requested = False
        self.tree = None


class Coordinator(fleet.Fleet):
    def __init__(self, vehicles, identifier):
        super().__init__(vehicles)
        self.identifier = identifier
        self.assignments, self.attempts, self.task_events, self.bt_ticks = [], [], [], []
        self.task_states = {task['id']: 'pending' for task in TASKS}
        self.mission_start = self.mission_completed = self.mission_closed = None
        self.withdrawal = dict(vehicleId='A1', afterAttempt=2, delayMs=CONFIG['withdrawalDelayMs'],
                               triggerTimeMs=None, requestedTimeMs=None, landedTimeMs=None, releasedTimeMs=None)
        for vehicle in vehicles:
            vehicle.tree = make_tree(self, vehicle)

    def resource_sample(self):
        self.resources.append(dict(timeMs=self.now(), allRunning=all(v.process.poll() is None for v in self.vehicles),
            vehicles=[dict(id=v.spec['id'], pid=v.process.pid, rssKiB=fleet.rss_kib(v.process.pid)) for v in self.vehicles]))

    def complete_stage(self, vehicle, stage, stamp):
        if stage not in vehicle.completed_stages:
            vehicle.completed_stages[stage] = stamp
            vehicle.event(stage, 'complete', stamp)
            if stage == 'takeoff': vehicle.takeoff_done = stamp
            if stage == 'land': vehicle.land_done = stamp

    def observe(self, vehicle, kind, stamp, data):
        if kind == 'COMMAND_ACK' and vehicle.pending and data['command'] == vehicle.pending['command']:
            if data['target_system'] == 255 and data['target_component'] == 190:
                if data['result'] != 0:
                    raise RuntimeError(f'{vehicle.spec["id"]} command rejected: {data}')
        for stage in ['guided', 'arm', 'takeoff', 'land']:
            command = next((c for c in vehicle.commands if c['id'] == stage), None)
            admitted = command and any(a['commandId'] == stage and a['result'] == 0 and a['timeMs'] <= stamp for a in vehicle.acks)
            if not admitted or stage in vehicle.completed_stages or stamp < command['timeMs']:
                continue
            if kind == 'HEARTBEAT' and stage in ['guided', 'arm']:
                good = data['custom_mode'] == 4 if stage == 'guided' else bool(data['base_mode'] & 128)
                if good: self.complete_stage(vehicle, stage, stamp)
            elif kind == 'LOCAL_POSITION_NED' and stage == 'takeoff':
                if vehicle.gate.update(stamp, sitl.takeoff_good(vehicle.latest, stamp, CONFIG, after=command['timeMs'])):
                    self.complete_stage(vehicle, stage, stamp)
            elif stage == 'land' and sitl.landed_good(vehicle.latest, stamp, command['timeMs'], vehicle.airborne, CONFIG):
                at = max(vehicle.latest[k][0] for k in ['HEARTBEAT', 'EXTENDED_SYS_STATE'])
                self.complete_stage(vehicle, stage, at)
        attempt = vehicle.active_attempt
        if (kind == 'LOCAL_POSITION_NED' and attempt and attempt['status'] == 'active'
                and attempt['sentTimeMs'] is not None and stamp >= attempt['sentTimeMs']
                and self.mission_deadline is not None and stamp <= self.mission_deadline
                and not vehicle.withdraw_requested):
            if vehicle.gate.update(stamp, sitl.waypoint_good(data, attempt['positionNed'], CONFIG)):
                attempt.update(status='completed', completedTimeMs=stamp)
                self.task_states[attempt['taskId']] = 'completed'
                vehicle.event(attempt['commandId'], 'complete', stamp)
                self.task_event('completed', attempt, stamp)

    def task_event(self, kind, attempt, stamp):
        self.task_events.append(dict(timeMs=stamp, type=kind, taskId=attempt['taskId'],
                                     vehicleId=attempt['vehicleId'], attemptId=attempt['id']))

    def send_command(self, vehicle, identifier, number, params, context):
        if any(command['id'] == identifier for command in vehicle.commands):
            return
        stamp = self.now()
        params = params + [0] * (7-len(params))
        command = dict(id=identifier, kind='command', timeMs=stamp, message='COMMAND_LONG', command=number,
            params=params, targetSystem=vehicle.spec['systemId'], targetComponent=1, routeSystem=vehicle.spec['systemId'])
        vehicle.commands.append(command)
        vehicle.event(identifier, 'start', stamp)
        vehicle.pending = dict(id=identifier, command=number, timeMs=stamp)
        self.raw_command(vehicle, number, params)
        context['actions'].append(dict(type='command', commandId=identifier, timeMs=stamp))
        if identifier == 'takeoff': vehicle.gate = sitl.Dwell()

    def halt(self, vehicle, identifier, context):
        row = dict(id=identifier, timeMs=self.now())
        if identifier == 'task' and vehicle.active_attempt:
            attempt = vehicle.active_attempt
            row['attemptId'] = attempt['id']
            if attempt['status'] == 'active':
                stamp = self.now()
                attempt.update(status='cancelled' if vehicle.withdraw_requested else 'timeout', cancelledTimeMs=stamp)
                self.task_states[attempt['taskId']] = 'locked' if vehicle.withdraw_requested else 'unfinished'
                vehicle.event(attempt['commandId'], 'cancelled' if vehicle.withdraw_requested else 'timeout', stamp)
                self.task_event('locked' if vehicle.withdraw_requested else 'timeout', attempt, stamp)
                vehicle.gate = sitl.Dwell()
        context['halts'].append(row)
        vehicle.running_action = None

    def action(self, vehicle, identifier, context):
        stage = 'land' if identifier in ['withdrawLand', 'cleanupLand'] else identifier
        if stage in vehicle.completed_stages:
            if vehicle.running_action == identifier: vehicle.running_action = None
            return SUCCESS
        if vehicle.running_action is not None and vehicle.running_action != identifier:
            self.halt(vehicle, vehicle.running_action, context)
        status = RUNNING
        if identifier == 'guided': self.send_command(vehicle, 'guided', 176, [1, 4], context)
        elif identifier == 'arm': self.send_command(vehicle, 'arm', 400, [1, 0], context)
        elif identifier == 'takeoff': self.send_command(vehicle, 'takeoff', 22, [0, 0, 0, 0, 0, 0, 4], context)
        elif stage == 'land': self.send_command(vehicle, 'land', 21, [], context)
        elif identifier == 'task':
            attempt = vehicle.active_attempt
            if attempt['status'] == 'completed':
                context['actions'].append(dict(type='task-success', attemptId=attempt['id'], timeMs=self.now()))
                vehicle.active_attempt = None
                status = SUCCESS
            elif attempt['sentTimeMs'] is None:
                stamp = self.now(); attempt['sentTimeMs'] = stamp
                command = dict(id=attempt['commandId'], kind='setpoint', timeMs=stamp,
                    message='SET_POSITION_TARGET_LOCAL_NED', command=None, positionNed=attempt['positionNed'],
                    frame=1, mask=3576, targetSystem=vehicle.spec['systemId'], targetComponent=1,
                    routeSystem=vehicle.spec['systemId'], taskId=attempt['taskId'], attemptId=attempt['id'])
                vehicle.commands.append(command); vehicle.event(command['id'], 'start', stamp)
                vehicle.connection.mav.set_position_target_local_ned_send(0, vehicle.spec['systemId'], 1, 1, 3576,
                    *attempt['positionNed'], 0, 0, 0, 0, 0, 0, 0, 0)
                vehicle.gate = sitl.Dwell()
                context['actions'].append(dict(type='setpoint', commandId=command['id'], attemptId=attempt['id'], timeMs=stamp))
                if self.identifier == 'withdrawal' and vehicle.spec['id'] == 'A1':
                    sent = [a for a in self.attempts if a['vehicleId'] == 'A1' and a['sentTimeMs'] is not None]
                    if len(sent) == self.withdrawal['afterAttempt']:
                        self.withdrawal['triggerTimeMs'] = stamp + self.withdrawal['delayMs']
        vehicle.running_action = identifier if status == RUNNING else None
        return status

    def check_deadlines(self):
        stamp = self.now()
        for vehicle in self.vehicles:
            for command in vehicle.commands:
                if command['kind'] != 'command' or command['id'] in vehicle.completed_stages:
                    continue
                acked = any(a['commandId'] == command['id'] and a['result'] == 0 for a in vehicle.acks)
                if not acked and stamp-command['timeMs'] > CONFIG['ackTimeoutMs']:
                    raise TimeoutError('Missing ACK: ' + vehicle.spec['id'] + '/' + command['id'])
                budget = CONFIG['landTimeoutMs'] if command['id'] == 'land' else CONFIG['takeoffTimeoutMs']
                if stamp-command['timeMs'] > budget:
                    raise TimeoutError('Action completion deadline: ' + vehicle.spec['id'] + '/' + command['id'])

    def release_retired_task(self):
        vehicle = self.vehicles[0]
        if not vehicle.withdraw_requested or vehicle.land_done is None or self.withdrawal['landedTimeMs'] is not None:
            return
        command = next((c for c in vehicle.commands if c['id'] == 'land'), None)
        if command is None or not sitl.landed_good(vehicle.latest, self.now(), command['timeMs'], vehicle.airborne, CONFIG):
            return
        self.withdrawal['landedTimeMs'] = vehicle.land_done
        attempt = vehicle.active_attempt
        if attempt and attempt['status'] == 'cancelled':
            stamp = self.now()
            attempt['releasedTimeMs'] = stamp
            self.task_states[attempt['taskId']] = 'pending'
            self.task_event('released', attempt, stamp)
            self.withdrawal['releasedTimeMs'] = stamp
            vehicle.active_attempt = None

    def dispatch(self):
        if self.mission_start is None or self.mission_closed is not None:
            return
        pending = [task for task in TASKS if self.task_states[task['id']] == 'pending']
        if not pending:
            return
        stamp = self.now(); eligible = []
        for vehicle in self.vehicles:
            if vehicle.takeoff_done is None or vehicle.withdraw_requested or vehicle.active_attempt is not None or vehicle.land_done is not None:
                continue
            row = vehicle.latest.get('LOCAL_POSITION_NED')
            if row is None or stamp-row[0] > CONFIG['freshnessMs']:
                continue
            eligible.append(dict(vehicleId=vehicle.spec['id'], poseSampleTimeMs=row[0],
                positionEnu=fleet.common_enu([row[1][k] for k in ['x', 'y', 'z']], vehicle.origin, vehicle.spec['padEnu'])))
        if not eligible:
            return
        pairs = fleet.nearest_pairs({r['vehicleId']: r['positionEnu'] for r in eligible}, pending)
        decision = dict(id=f'D{len(self.assignments)+1}', timeMs=stamp,
                        availableTaskIds=[task['id'] for task in pending], eligible=eligible, pairs=pairs)
        self.assignments.append(decision)
        for pair in pairs:
            vehicle = next(v for v in self.vehicles if v.spec['id'] == pair['vehicleId'])
            task = next(t for t in TASKS if t['id'] == pair['taskId'])
            attempt_id = f'P{len(self.attempts)+1}'
            pair['attemptId'] = attempt_id
            attempt = dict(id=attempt_id, vehicleId=pair['vehicleId'], taskId=pair['taskId'], assignedTimeMs=stamp,
                commandId='task-'+attempt_id, sentTimeMs=None,
                positionNed=fleet.target_ned(vehicle.origin, vehicle.spec['padEnu'], task['positionEnu']),
                status='active', completedTimeMs=None, cancelledTimeMs=None, releasedTimeMs=None)
            self.attempts.append(attempt); vehicle.active_attempt = attempt
            self.task_states[task['id']] = 'assigned'
            self.task_event('assigned', attempt, stamp)

    def tick(self):
        stamp = self.now()
        trigger = self.withdrawal['triggerTimeMs']
        if trigger is not None and stamp >= trigger and self.withdrawal['requestedTimeMs'] is None:
            self.withdrawal['requestedTimeMs'] = stamp
            self.vehicles[0].withdraw_requested = True
            self.events.append(dict(timeMs=stamp, stage='withdrawal', status='requested', vehicleId='A1'))
        if self.mission_start is None and all(v.takeoff_done is not None for v in self.vehicles):
            self.mission_start = stamp; self.mission_deadline = stamp + CONFIG['missionDurationMs']
            self.events.append(dict(timeMs=stamp, stage='mission', status='start'))
        if self.mission_start is not None and self.mission_closed is None:
            complete = all(state == 'completed' for state in self.task_states.values())
            if complete or stamp >= self.mission_deadline:
                self.mission_closed = stamp
                if complete: self.mission_completed = max(a['completedTimeMs'] for a in self.attempts if a['status'] == 'completed')
                self.events.append(dict(timeMs=stamp, stage='mission', status='complete' if complete else 'timeout'))
        tick = dict(index=len(self.bt_ticks), startedTimeMs=stamp, timeMs=None, vehicles=[])
        for vehicle in self.vehicles:
            attempt = vehicle.active_attempt
            inputs = dict(withdrawRequested=vehicle.withdraw_requested, missionClosed=self.mission_closed is not None,
                attemptId=attempt['id'] if attempt else None, attemptStatus=attempt['status'] if attempt else None, taskDone=bool(attempt and attempt['status'] == 'completed'),
                guidedDone='guided' in vehicle.completed_stages, armedDone='arm' in vehicle.completed_stages,
                takeoffDone=vehicle.takeoff_done is not None, ready=vehicle.takeoff_done is not None,
                landed=vehicle.land_done is not None,
                telemetry={kind: vehicle.latest.get(kind, (None,))[0] for kind in sorted(sitl.TELEMETRY)})
            context = dict(vehicleId=vehicle.spec['id'], inputs=inputs, visited=[], actions=[], halts=[])
            context['status'] = vehicle.tree.tick(context)
            tick['vehicles'].append(context)
        tick['timeMs'] = self.now()
        self.bt_ticks.append(tick)
        self.release_retired_task()
        self.dispatch()
        self.check_deadlines()

    def run(self):
        next_tick = self.now()
        last_resource = -5000
        while not all(v.land_done is not None for v in self.vehicles):
            self.pump()
            stamp = self.now()
            if stamp >= next_tick:
                self.tick()
                # A slow host does not generate invented catch-up traversals.
                next_tick = self.now() + CONFIG['tickIntervalMs']
            if stamp-last_resource >= 5000:
                self.resource_sample(); last_resource = stamp
        # Record the terminal success traversal before the final telemetry tail.
        self.tick()
        end = time.monotonic()+1
        while time.monotonic() < end: self.pump()
        self.resource_sample()


def record_case(identifier):
    print('Recording ' + identifier + ': three concurrent SITL processes and reactive BTs.', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix='argos-recovery-') as directory:
        logs, vehicles = [], []
        try:
            for registry in REGISTRY:
                work = Path(directory)/registry['id']; work.mkdir()
                log = open(work/'sitl.log', 'w+'); logs.append(log)
                home = fleet.home_for_pad(registry['padEnu'])
                process = subprocess.Popen([sitl.BINARY, '--model', '+', '--speedup', '1',
                    '--instance', str(registry['instance']), '--home', ','.join(str(v) for v in home),
                    '--defaults', sitl.DEFAULTS, '--wipe', '--serial0', 'tcp:0', '--sysid', str(registry['systemId'])],
                    cwd=work, stdout=log, stderr=subprocess.STDOUT)
                vehicles.append(Vehicle(registry, process, home))
            coordinator = Coordinator(vehicles, identifier); coordinator.setup()
            print(f'{identifier}: three estimators ready after {vehicles[0].setup["durationMs"]/1000:.1f}s.', file=sys.stderr, flush=True)
            coordinator.run()
            results = [dict(**v.spec, pid=v.process.pid, homeGps=v.home, originNed=v.origin, originTimeMs=v.origin_time,
                parameters=v.parameters, setup=v.setup, commands=v.commands, acks=v.acks, telemetry=v.telemetry,
                events=v.events, statuses=v.statuses) for v in vehicles]
            complete = sum(state == 'completed' for state in coordinator.task_states.values())
            run = dict(id=identifier, label='Three-vehicle baseline' if identifier == 'nominal' else 'A1 withdraws; A2 and A3 finish',
                runId=str(uuid.uuid4()), config=CONFIG, controller=dict(systemId=255, componentId=190), tasks=TASKS,
                vehicles=results, assignments=coordinator.assignments, attempts=coordinator.attempts,
                taskEvents=coordinator.task_events, withdrawal=coordinator.withdrawal, btTicks=coordinator.bt_ticks,
                missionStartMs=coordinator.mission_start, missionDeadlineMs=coordinator.mission_deadline,
                missionCompletedMs=coordinator.mission_completed, missionClosedMs=coordinator.mission_closed,
                events=coordinator.events, resources=coordinator.resources, endMs=coordinator.now(),
                outcome=dict(status='completed' if complete == 6 else 'partial', tasksCompleted=complete,
                    landedVehicles=sum(v.land_done is not None for v in vehicles),
                    missionElapsedMs=(coordinator.mission_completed-coordinator.mission_start) if complete == 6 else None))
            print(f'{identifier}: {complete}/6 tasks; mission elapsed {run["outcome"]["missionElapsedMs"]} ms.', file=sys.stderr, flush=True)
            return run
        except Exception:
            for vehicle, log in zip(vehicles, logs):
                log.flush(); log.seek(0)
                print(vehicle.spec['id']+'\n'+log.read()[-8000:], file=sys.stderr)
                print('Statuses: '+repr(vehicle.statuses), file=sys.stderr)
            raise
        finally:
            for vehicle in vehicles:
                if vehicle.connection: vehicle.connection.close()
                fleet.stop(vehicle.process)
            for log in logs: log.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--image', required=True); parser.add_argument('--base-image', required=True)
    args = parser.parse_args()
    if sitl.sha256(sitl.BINARY) != sitl.BINARY_HASH or sitl.sha256(sitl.DEFAULTS) != sitl.PARAMS_HASH:
        raise RuntimeError('Unexpected simulator or defaults.')
    with redirect_stdout(sys.stderr): cases = [record_case(name) for name in ['nominal', 'withdrawal']]
    for run in cases:
        for vehicle in run['vehicles']:
            version = vehicle['setup']['autopilotVersion']['flight_sw_version']
            if '.'.join(str((version >> shift)&255) for shift in [24,16,8]) != '4.7.1':
                raise RuntimeError('Unexpected autopilot version.')
    runtime = dict(recordedAt=datetime.now(timezone.utc).isoformat(), ardupilotVersion='4.7.1',
        binaryUrl=sitl.BINARY_URL, binarySha256=sitl.BINARY_HASH, firmwareGitHash=sitl.FIRMWARE_HASH,
        pymavlink=importlib.metadata.version('pymavlink'), python=platform.python_version(), image=args.image,
        baseImage=args.base_image, sourceSha256=sitl.sha256(__file__), sitlSourceSha256=sitl.sha256(sitl.__file__),
        fleetSourceSha256=sitl.sha256(fleet.__file__), dockerfileSha256=sitl.sha256(ROOT.parent/'sitl/Dockerfile'),
        paramsSha256=sitl.PARAMS_HASH, platform='linux-amd64', model='quad', modelArgument='+', speedup=1, vehicleCount=3,
        clock='recorder-monotonic-receipt', transport='tcp-loopback', mavlinkVersion=2, physics='independent-SITL-worlds',
        assignment='central-online-nearest-pair-greedy', behaviorTree='reactive-fallback-sequence',
        positionFrame='supplied-ENU-layout-from-independent-local-NED', memoryMetric='process-VmRSS-KiB-snapshots')
    print(json.dumps(dict(schemaVersion=1, kind='argos-ardupilot-recovery', runtime=runtime, cases=cases), allow_nan=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
