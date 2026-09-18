#!/usr/bin/env python3
"""Run two isolated SITL vehicles with separate MAVLink routes and one coordinator."""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'sitl'))
import record as sitl

ROOT = Path(__file__).resolve().parent
CONFIG = {key: sitl.CONFIG[key] for key in ['takeoffAltitudeM', 'takeoffToleranceM',
    'speedToleranceMps', 'dwellMs', 'freshnessMs', 'maxSampleGapMs', 'heartbeatFreshnessMs',
    'landedFreshnessMs', 'ackTimeoutMs', 'takeoffTimeoutMs', 'landTimeoutMs', 'positionToleranceM']}
CONFIG.update(missionDurationMs=20000, heartbeatIntervalMs=1000, waypointTimeoutMs=20000)
TASKS = [dict(id='T1', positionEnu=[-4, 6, 4]), dict(id='T2', positionEnu=[4, 8, 4])]
REGISTRY = [dict(id='A1', systemId=1, componentId=1, instance=0, port=5760, padEnu=[-4, 0, 0]),
            dict(id='A2', systemId=2, componentId=1, instance=1, port=5770, padEnu=[4, 0, 0])]


def home_for_pad(pad):
    latitude = -35.363261
    longitude = 149.165230 + math.degrees(pad[0] / (6378137 * math.cos(math.radians(latitude))))
    return [latitude, longitude, 584, 0]


def common_enu(position, origin, pad):
    return [pad[0] + position[1] - origin[1], pad[1] + position[0] - origin[0], pad[2] - position[2] + origin[2]]


def nearest_pairs(poses, tasks):
    candidates = []
    for vehicle_id, position in poses.items():
        for task in tasks:
            cost = math.hypot(position[0] - task['positionEnu'][0], position[1] - task['positionEnu'][1])
            candidates.append((cost, vehicle_id, task['id']))
    assignments, used_vehicles, used_tasks = [], set(), set()
    for cost, vehicle_id, task_id in sorted(candidates):
        if vehicle_id in used_vehicles or task_id in used_tasks:
            continue
        assignments.append(dict(vehicleId=vehicle_id, taskId=task_id, costM=cost))
        used_vehicles.add(vehicle_id); used_tasks.add(task_id)
    return sorted(assignments, key=lambda row: row['vehicleId'])


def target_ned(origin, pad, task):
    return [origin[0] + task[1] - pad[1], origin[1] + task[0] - pad[0], origin[2] - task[2] + pad[2]]


def matches_vehicle(message, registry):
    return message.get_srcSystem() == registry['systemId'] and message.get_srcComponent() == registry['componentId']


def rss_kib(pid):
    lines = Path(f'/proc/{pid}/status').read_text().splitlines()
    return int(next(line.split()[1] for line in lines if line.startswith('VmRSS:')))


class Vehicle:
    def __init__(self, spec, process, home):
        self.spec, self.process, self.home = dict(spec), process, home
        self.connection = None
        self.latest = {}
        self.telemetry, self.commands, self.acks, self.events, self.statuses = [], [], [], [], []
        self.last_heartbeat = 0
        self.airborne = False
        self.pending = None
        self.parameters = {}
        self.startup_text_bytes = 0
        self.origin = None
        self.origin_time = None
        self.takeoff_done = None
        self.task_done = None
        self.land_done = None
        self.gate = sitl.Dwell()
        self.target = None
        self.task_id = None

    def event(self, stage, status, stamp):
        self.events.append(dict(stage=stage, status=status, timeMs=stamp))


class Fleet:
    def __init__(self, vehicles):
        self.vehicles = vehicles
        self.started = time.monotonic()
        self.origin = None
        self.events, self.resources = [], []
        self.track_tasks = False
        self.track_takeoff = False
        self.mission_deadline = None
        self.track_landing = False

    def now(self):
        return (time.monotonic() - (self.origin or self.started)) * 1000

    def connect(self):
        deadline = time.monotonic() + 10
        while any(v.connection is None for v in self.vehicles) and time.monotonic() < deadline:
            for vehicle in self.vehicles:
                if vehicle.connection is None:
                    try:
                        vehicle.connection = sitl.mavutil.mavlink_connection(
                            'tcp:127.0.0.1:' + str(vehicle.spec['port']), source_system=255,
                            source_component=190, dialect='ardupilotmega')
                    except OSError:
                        pass
            time.sleep(.05)
        if any(v.connection is None for v in self.vehicles):
            raise RuntimeError('An owned SITL TCP route did not start.')

    def pump(self):
        received_any = False
        for vehicle in self.vehicles:
            if vehicle.process.poll() is not None:
                raise RuntimeError('Owned SITL exited: ' + vehicle.spec['id'])
            wall = time.monotonic()
            if wall - vehicle.last_heartbeat >= 1:
                vehicle.connection.mav.heartbeat_send(6, 8, 0, 0, 0)
                vehicle.last_heartbeat = wall
            for _ in range(100):
                message = vehicle.connection.recv_match(blocking=False)
                if message is None:
                    break
                received_any = True
                if message.get_type() == 'BAD_DATA':
                    if self.origin is not None:
                        raise RuntimeError('Malformed MAVLink data during recording.')
                    vehicle.startup_text_bytes += len(message.data)
                    continue
                if not matches_vehicle(message, vehicle.spec):
                    raise RuntimeError(f'Unexpected source on {vehicle.spec["id"]}: {message.get_type()} system={message.get_srcSystem()} component={message.get_srcComponent()} data={message}')
                stamp = self.now()
                kind = message.get_type()
                data = message.to_dict(); data.pop('mavpackettype', None)
                vehicle.latest[kind] = (stamp, data)
                if self.origin is None:
                    continue
                if kind == 'COMMAND_ACK' and vehicle.pending:
                    pending = vehicle.pending
                    if (stamp >= pending['timeMs'] and message.command == pending['command']
                            and message.target_system == 255 and message.target_component == 190):
                        vehicle.acks.append(dict(timeMs=stamp, commandId=pending['id'], command=message.command,
                            result=message.result, sourceSystem=vehicle.spec['systemId'], sourceComponent=1,
                            targetSystem=255, targetComponent=190, routeSystem=vehicle.spec['systemId']))
                if kind in sitl.TELEMETRY:
                    vehicle.telemetry.append(dict(timeMs=stamp, type=kind, sourceSystem=message.get_srcSystem(),
                                                  sourceComponent=message.get_srcComponent(), data=data))
                    if kind == 'EXTENDED_SYS_STATE' and message.landed_state == 2:
                        vehicle.airborne = True
                elif kind == 'STATUSTEXT':
                    vehicle.statuses.append(dict(timeMs=stamp, severity=message.severity, text=message.text))
                self.observe(vehicle, kind, stamp, data)
        if not received_any:
            time.sleep(.002)

    def observe(self, vehicle, kind, stamp, data):
        # Evaluate each sample before later channel arrivals can overwrite its inputs.
        if kind == 'HEARTBEAT':
            for stage in ['guided', 'arm']:
                command = next((c for c in vehicle.commands if c['id'] == stage), None)
                admitted = any(a['commandId'] == stage and a['result'] == 0 and a['timeMs'] <= stamp for a in vehicle.acks)
                complete = any(e['stage'] == stage and e['status'] == 'complete' for e in vehicle.events)
                good = data['custom_mode'] == 4 if stage == 'guided' else bool(data['base_mode'] & 128)
                if command and admitted and not complete and stamp >= command['timeMs'] and good:
                    vehicle.event(stage, 'complete', stamp)
        if kind == 'LOCAL_POSITION_NED' and self.track_takeoff and vehicle.takeoff_done is None:
            command = next((c for c in vehicle.commands if c['id'] == 'takeoff'), None)
            admitted = any(a['commandId'] == 'takeoff' and a['result'] == 0 and a['timeMs'] <= stamp for a in vehicle.acks)
            if command and admitted and stamp >= command['timeMs']:
                good = sitl.takeoff_good(vehicle.latest, stamp, CONFIG, after=command['timeMs'])
                if vehicle.gate.update(stamp, good):
                    vehicle.takeoff_done = stamp
                    vehicle.event('takeoff', 'complete', stamp)
        if (kind == 'LOCAL_POSITION_NED' and self.track_tasks and stamp <= self.mission_deadline
                and vehicle.target is not None and vehicle.task_done is None):
            if vehicle.gate.update(stamp, sitl.waypoint_good(data, vehicle.target, CONFIG)):
                vehicle.task_done = stamp
                vehicle.event('waypoint', 'complete', stamp)
        if self.track_landing and vehicle.land_done is None:
            command = next((c for c in vehicle.commands if c['id'] == 'land'), None)
            admitted = any(a['commandId'] == 'land' and a['result'] == 0 for a in vehicle.acks)
            if command and admitted and sitl.landed_good(vehicle.latest, stamp, command['timeMs'], vehicle.airborne, CONFIG):
                vehicle.land_done = max(vehicle.latest[k][0] for k in ['HEARTBEAT', 'EXTENDED_SYS_STATE'])
                vehicle.event('land', 'complete', vehicle.land_done)

    def until(self, predicate, timeout_ms, reason):
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            self.pump()
            if predicate():
                return
        raise TimeoutError(reason)

    def raw_command(self, vehicle, command, params):
        sent = self.now()
        vehicle.connection.mav.command_long_send(vehicle.spec['systemId'], 1, command, 0,
                                                *(params + [0] * (7-len(params))))
        return sent

    def wait_ack(self, vehicle, command, sent):
        def received():
            row = vehicle.latest.get('COMMAND_ACK')
            return (row is not None and row[0] >= sent and row[1]['command'] == command
                    and row[1]['target_system'] == 255 and row[1]['target_component'] == 190)
        self.until(received, CONFIG['ackTimeoutMs'], f'No matched ACK from {vehicle.spec["id"]}: {command}')
        return vehicle.latest['COMMAND_ACK']

    def command(self, vehicle, identifier, command, params):
        params = params + [0] * (7-len(params))
        stamp = self.now()
        vehicle.event(identifier, 'start', stamp)
        vehicle.commands.append(dict(id=identifier, kind='command', timeMs=stamp, message='COMMAND_LONG',
            command=command, params=params, targetSystem=vehicle.spec['systemId'], targetComponent=1,
            routeSystem=vehicle.spec['systemId']))
        vehicle.pending = dict(id=identifier, command=command, timeMs=stamp)
        self.raw_command(vehicle, command, params)
        at, ack = self.wait_ack(vehicle, command, stamp)
        vehicle.pending = None
        if ack['result'] != 0:
            raise RuntimeError(f'{vehicle.spec["id"]} {identifier} rejected: {ack["result"]}')

    def read_parameter(self, vehicle, name):
        sent = self.now()
        vehicle.connection.mav.param_request_read_send(vehicle.spec['systemId'], 1, name.encode(), -1)
        def received():
            row = vehicle.latest.get('PARAM_VALUE')
            return row is not None and row[0] >= sent and row[1]['param_id'] == name
        self.until(received, 3000, 'Missing parameter: ' + name)
        return float(vehicle.latest['PARAM_VALUE'][1]['param_value'])

    def setup(self):
        self.connect()
        self.until(lambda: all('HEARTBEAT' in v.latest for v in self.vehicles), 10000, 'Missing vehicle heartbeat.')
        for vehicle in self.vehicles:
            for message_id, interval in [(0, 1000000), (32, 100000), (30, 100000), (33, 100000),
                                         (245, 200000), (193, 500000), (24, 500000), (1, 500000)]:
                sent = self.raw_command(vehicle, 511, [message_id, interval])
                if self.wait_ack(vehicle, 511, sent)[1]['result'] != 0:
                    raise RuntimeError('Telemetry interval request rejected.')
            sent = self.raw_command(vehicle, 512, [148]); self.wait_ack(vehicle, 512, sent)
        required = 1 | 2 | 4 | 16 | 32
        def ready():
            return all(all(sitl.fresh(v.latest, name, self.now(), 1500) for name in sitl.TELEMETRY)
                and v.latest.get('GPS_RAW_INT', (0, {}))[1].get('fix_type', 0) >= 3
                and v.latest.get('EKF_STATUS_REPORT', (0, {}))[1].get('flags', 0) & required == required
                and 'AUTOPILOT_VERSION' in v.latest for v in self.vehicles)
        self.until(ready, 80000, 'Both estimators did not become ready.')
        for vehicle in self.vehicles:
            for name in ['ARMING_SKIPCHK', 'FRAME_CLASS', 'FRAME_TYPE', 'FS_GCS_ENABLE', 'FS_THR_ENABLE', 'SIM_WIND_SPD', 'MAV_SYSID']:
                vehicle.parameters[name] = self.read_parameter(vehicle, name)
            if vehicle.parameters['ARMING_SKIPCHK'] != 0 or vehicle.parameters['MAV_SYSID'] != vehicle.spec['systemId']:
                raise RuntimeError('Unexpected arming checks or system identity.')
            vehicle.setup = dict(autopilotVersion=vehicle.latest['AUTOPILOT_VERSION'][1], startupTextBytes=vehicle.startup_text_bytes)
        self.origin = time.monotonic()
        for vehicle in self.vehicles:
            vehicle.latest = {}
            vehicle.setup['durationMs'] = (self.origin-self.started)*1000
        self.until(lambda: all(all(name in v.latest for name in sitl.TELEMETRY) for v in self.vehicles),
                   3000, 'Initial telemetry incomplete.')
        for vehicle in self.vehicles:
            initial = next(row for row in vehicle.telemetry if row['type'] == 'LOCAL_POSITION_NED')
            vehicle.origin = [initial['data'][k] for k in ['x', 'y', 'z']]
            vehicle.origin_time = initial['timeMs']
        self.resource_sample()

    def resource_sample(self):
        stamp = self.now()
        self.resources.append(dict(timeMs=stamp, bothRunning=all(v.process.poll() is None for v in self.vehicles),
            vehicles=[dict(id=v.spec['id'], pid=v.process.pid, rssKiB=rss_kib(v.process.pid)) for v in self.vehicles]))

    def launch(self):
        for stage, number, params in [('guided', 176, [1, 4]), ('arm', 400, [1, 0])]:
            for vehicle in self.vehicles:
                self.command(vehicle, stage, number, params)
            self.until(lambda: all(any(e['stage'] == stage and e['status'] == 'complete' for e in v.events)
                                  for v in self.vehicles), 3000, stage + ' not observed on both vehicles.')
        self.track_takeoff = True
        for vehicle in self.vehicles:
            vehicle.gate = sitl.Dwell()
            self.command(vehicle, 'takeoff', 22, [0, 0, 0, 0, 0, 0, CONFIG['takeoffAltitudeM']])
        self.until(lambda: all(v.takeoff_done is not None for v in self.vehicles),
                   CONFIG['takeoffTimeoutMs'], 'Both takeoffs did not settle.')
        self.track_takeoff = False

    def dispatch(self, bad_route):
        assignment_time = self.now()
        poses, pose_rows = {}, {}
        for vehicle in self.vehicles:
            stamp, data = vehicle.latest['LOCAL_POSITION_NED']
            if assignment_time - stamp > CONFIG['freshnessMs']:
                raise RuntimeError('Assignment pose is stale.')
            poses[vehicle.spec['id']] = common_enu([data[k] for k in ['x', 'y', 'z']], vehicle.origin, vehicle.spec['padEnu'])
            pose_rows[vehicle.spec['id']] = stamp
        assignments = nearest_pairs(poses, TASKS)
        self.track_tasks = True
        start = self.now()
        self.mission_deadline = start + CONFIG['missionDurationMs']
        self.events.append(dict(timeMs=start, stage='mission', status='start'))
        for row in assignments:
            vehicle = next(v for v in self.vehicles if v.spec['id'] == row['vehicleId'])
            task = next(t for t in TASKS if t['id'] == row['taskId'])
            row.update(poseSampleTimeMs=pose_rows[row['vehicleId']], positionEnu=poses[row['vehicleId']])
            vehicle.target = target_ned(vehicle.origin, vehicle.spec['padEnu'], task['positionEnu'])
            vehicle.task_id = task['id']; vehicle.gate = sitl.Dwell()
            target_system = 2 if bad_route and vehicle.spec['id'] == 'A1' else vehicle.spec['systemId']
            stamp = self.now()
            vehicle.event('waypoint', 'start', stamp)
            vehicle.commands.append(dict(id='waypoint', kind='setpoint', timeMs=stamp,
                message='SET_POSITION_TARGET_LOCAL_NED', command=None, positionNed=vehicle.target,
                frame=1, mask=3576, targetSystem=target_system, targetComponent=1,
                routeSystem=vehicle.spec['systemId'], taskId=vehicle.task_id))
            vehicle.connection.mav.set_position_target_local_ned_send(0, target_system, 1, 1, 3576,
                *vehicle.target, 0, 0, 0, 0, 0, 0, 0, 0)
        sampled = False
        while self.now() < self.mission_deadline:
            self.pump()
            if not sampled and self.now() - start >= 5000:
                self.resource_sample(); sampled = True
        end = self.now()
        self.events.append(dict(timeMs=end, stage='mission', status='complete'))
        self.track_tasks = False
        for vehicle in self.vehicles:
            if vehicle.task_done is None:
                vehicle.event('waypoint', 'timeout', end)
        return assignment_time, assignments

    def land(self):
        self.track_landing = True
        for vehicle in self.vehicles:
            self.command(vehicle, 'land', 21, [])
        self.until(lambda: all(v.land_done is not None for v in self.vehicles), CONFIG['landTimeoutMs'],
                   'Both vehicles did not land and disarm.')
        end = time.monotonic() + 1
        while time.monotonic() < end:
            self.pump()
        self.resource_sample()


def stop(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill(); process.wait(timeout=5)


def record_case(identifier):
    print('Recording ' + identifier + ': two concurrent isolated SITL vehicles.', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix='argos-fleet-') as directory:
        logs, vehicles = [], []
        try:
            for spec in REGISTRY:
                work = Path(directory) / spec['id']; work.mkdir()
                log = open(work / 'sitl.log', 'w+'); logs.append(log)
                home = home_for_pad(spec['padEnu'])
                process = subprocess.Popen([sitl.BINARY, '--model', '+', '--speedup', '1',
                    '--instance', str(spec['instance']), '--home', ','.join(str(v) for v in home),
                    '--defaults', sitl.DEFAULTS, '--wipe', '--serial0', 'tcp:0', '--sysid', str(spec['systemId'])],
                    cwd=work, stdout=log, stderr=subprocess.STDOUT)
                vehicles.append(Vehicle(spec, process, home))
            fleet = Fleet(vehicles); fleet.setup()
            print(f'{identifier}: both estimators ready after {vehicles[0].setup["durationMs"]/1000:.1f}s.', file=sys.stderr, flush=True)
            fleet.launch()
            assignment_time, assignments = fleet.dispatch(identifier == 'misaddressed')
            fleet.land()
            results = []
            for vehicle in vehicles:
                results.append(dict(**vehicle.spec, pid=vehicle.process.pid, homeGps=vehicle.home,
                    originNed=vehicle.origin, originTimeMs=vehicle.origin_time, parameters=vehicle.parameters,
                    setup=vehicle.setup, commands=vehicle.commands, acks=vehicle.acks, telemetry=vehicle.telemetry,
                    events=vehicle.events, statuses=vehicle.statuses,
                    taskResult=dict(taskId=vehicle.task_id, status='reached' if vehicle.task_done is not None else 'not-reached',
                                    completedTimeMs=vehicle.task_done)))
            complete = sum(v.task_done is not None for v in vehicles)
            return dict(id=identifier, label='Correct per-vehicle targets' if identifier == 'nominal' else 'A1 route with the wrong target system',
                runId=str(uuid.uuid4()), config=CONFIG, controller=dict(systemId=255, componentId=190),
                tasks=TASKS, assignmentTimeMs=assignment_time, assignments=assignments, missionDeadlineMs=fleet.mission_deadline,
                vehicles=results, events=fleet.events, resources=fleet.resources, endMs=fleet.now(),
                outcome=dict(status='completed' if complete == 2 else 'partial', tasksCompleted=complete, landedVehicles=2,
                    reason='Task completion is evaluated during the observation window; both vehicles subsequently landed and disarmed.'))
        except Exception:
            for vehicle, log in zip(vehicles, logs):
                log.flush(); log.seek(0)
                print(vehicle.spec['id'] + '\n' + log.read()[-10000:], file=sys.stderr)
                print('Statuses: ' + repr(vehicle.statuses), file=sys.stderr)
            raise
        finally:
            for vehicle in vehicles:
                if vehicle.connection: vehicle.connection.close()
                stop(vehicle.process)
            for log in logs: log.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--image', required=True); parser.add_argument('--base-image', required=True)
    args = parser.parse_args()
    if sitl.sha256(sitl.BINARY) != sitl.BINARY_HASH or sitl.sha256(sitl.DEFAULTS) != sitl.PARAMS_HASH:
        raise RuntimeError('Unexpected simulator or upstream defaults.')
    with redirect_stdout(sys.stderr):
        cases = [record_case(name) for name in ['nominal', 'misaddressed']]
    for run in cases:
        for vehicle in run['vehicles']:
            version = vehicle['setup']['autopilotVersion']['flight_sw_version']
            if '.'.join(str((version >> shift)&255) for shift in [24,16,8]) != '4.7.1':
                raise RuntimeError('Unexpected autopilot version.')
    runtime = dict(recordedAt=datetime.now(timezone.utc).isoformat(), ardupilotVersion='4.7.1',
        binaryUrl=sitl.BINARY_URL, binarySha256=sitl.BINARY_HASH, firmwareGitHash=sitl.FIRMWARE_HASH,
        pymavlink=importlib.metadata.version('pymavlink'), python=platform.python_version(), image=args.image,
        baseImage=args.base_image, sourceSha256=sitl.sha256(__file__), sitlSourceSha256=sitl.sha256(sitl.__file__),
        dockerfileSha256=sitl.sha256(ROOT.parent / 'sitl/Dockerfile'), paramsSha256=sitl.PARAMS_HASH,
        platform='linux-amd64', model='quad', modelArgument='+', speedup=1, vehicleCount=2,
        clock='recorder-monotonic-receipt', transport='tcp-loopback', mavlinkVersion=2,
        physics='independent-SITL-worlds', assignment='central-nearest-pair-greedy',
        positionFrame='supplied-ENU-layout-from-independent-local-NED', memoryMetric='process-VmRSS-KiB-snapshots')
    print(json.dumps(dict(schemaVersion=1, kind='argos-ardupilot-fleet', runtime=runtime, cases=cases), allow_nan=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
