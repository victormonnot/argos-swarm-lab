#!/usr/bin/env python3
"""Record one simulated Copter through loopback MAVLink; never accepts an endpoint."""
import argparse
from contextlib import redirect_stdout
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

os.environ['MAVLINK20'] = '1'
from pymavlink import mavutil

BINARY = '/opt/sitl/arducopter'
DEFAULTS = '/opt/sitl/copter.parm'
BINARY_URL = 'https://firmware.ardupilot.org/Copter/stable-4.7.1/SITL_x86_64_linux_gnu/arducopter'
BINARY_HASH = '011627d41dd95640c3aca02d45283474be48721c8b1bb7a4b234d38b69063482'
FIRMWARE_HASH = 'dbe792162d06cab66c3475fd5556bf7a120f119e'
PARAMS_URL = f'https://raw.githubusercontent.com/ArduPilot/ardupilot/{FIRMWARE_HASH}/Tools/autotest/default_params/copter.parm'
PARAMS_HASH = '5e01345b45d1c6190b28bece5638bbdd4cf1cce35e05bbbf480ab24d2b51aa0e'
CONFIG = dict(takeoffAltitudeM=4, waypointOffsetNed=[8, 5, -4], takeoffToleranceM=.35,
              positionToleranceM=.5, speedToleranceMps=.4, dwellMs=1000,
              freshnessMs=500, maxSampleGapMs=300, heartbeatFreshnessMs=1500,
              landedFreshnessMs=1500, ackTimeoutMs=3000, takeoffTimeoutMs=30000,
              waypointTimeoutMs=40000, landTimeoutMs=45000, rejectionObserveMs=5000)
TELEMETRY = {'LOCAL_POSITION_NED', 'ATTITUDE', 'GLOBAL_POSITION_INT', 'HEARTBEAT', 'EXTENDED_SYS_STATE'}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def speed(data):
    return math.sqrt(sum(data[k] ** 2 for k in ['vx', 'vy', 'vz']))


def ack_matches(message, command, sent_at, received_at):
    return (message.get_type() == 'COMMAND_ACK' and message.get_srcSystem() == 1
            and message.get_srcComponent() == 1 and message.command == command
            and message.target_system == 255 and message.target_component == 190
            and received_at >= sent_at)


class Dwell:
    """Only a new good sample extends a dwell; stale gaps reset it."""
    def __init__(self, duration=1000, max_gap=300):
        self.duration, self.max_gap = duration, max_gap
        self.first = self.previous = None

    def update(self, stamp, good):
        if self.previous is not None and stamp <= self.previous:
            return False
        gap = self.previous is not None and stamp - self.previous > self.max_gap
        self.previous = stamp
        if not good:
            self.first = None
            return False
        if self.first is None or gap:
            self.first = stamp
        return stamp - self.first >= self.duration


def fresh(latest, name, now, budget):
    return name in latest and 0 <= now - latest[name][0] <= budget


def takeoff_good(latest, now, config=CONFIG, after=0):
    if (not fresh(latest, 'GLOBAL_POSITION_INT', now, config['freshnessMs'])
            or latest['GLOBAL_POSITION_INT'][0] < after):
        return False
    position = latest['LOCAL_POSITION_NED'][1]
    altitude = latest['GLOBAL_POSITION_INT'][1]['relative_alt'] / 1000
    return abs(altitude - config['takeoffAltitudeM']) <= config['takeoffToleranceM'] and speed(position) <= config['speedToleranceMps']


def waypoint_good(data, target, config=CONFIG):
    distance = math.sqrt(sum((data[k] - value) ** 2 for k, value in zip(['x', 'y', 'z'], target)))
    return distance <= config['positionToleranceM'] and speed(data) <= config['speedToleranceMps']


def landed_good(latest, now, land_sent, airborne, config=CONFIG):
    return (airborne and fresh(latest, 'HEARTBEAT', now, config['heartbeatFreshnessMs'])
            and fresh(latest, 'EXTENDED_SYS_STATE', now, config['landedFreshnessMs'])
            and latest['HEARTBEAT'][0] >= land_sent and latest['EXTENDED_SYS_STATE'][0] >= land_sent
            and not latest['HEARTBEAT'][1]['base_mode'] & 128
            and latest['EXTENDED_SYS_STATE'][1]['landed_state'] == 1)


class Recorder:
    def __init__(self, process):
        self.process = process
        self.origin = None
        self.started = time.monotonic()
        self.latest = {}
        self.telemetry, self.acks, self.commands, self.events, self.statuses = [], [], [], [], []
        self.last_heartbeat = 0
        self.pending = None
        self.airborne = False
        self.connection = None
        until = time.monotonic() + 8
        while time.monotonic() < until:
            try:
                self.connection = mavutil.mavlink_connection('tcp:127.0.0.1:5760', source_system=255,
                                                            source_component=190, dialect='ardupilotmega')
                break
            except OSError:
                time.sleep(.1)
        if self.connection is None:
            raise RuntimeError('Owned SITL TCP endpoint did not start.')

    def now(self):
        return (time.monotonic() - (self.origin or self.started)) * 1000

    def pump(self):
        if self.process.poll() is not None:
            raise RuntimeError('Owned SITL process exited during collection.')
        wall = time.monotonic()
        if wall - self.last_heartbeat >= 1:
            self.connection.mav.heartbeat_send(6, 8, 0, 0, 0)
            self.last_heartbeat = wall
        message = self.connection.recv_match(blocking=True, timeout=.05)
        if message is None or message.get_srcSystem() != 1 or message.get_srcComponent() != 1:
            return None
        stamp = self.now()
        kind = message.get_type()
        data = message.to_dict()
        data.pop('mavpackettype', None)
        self.latest[kind] = (stamp, data)
        if self.origin is not None:
            if kind in TELEMETRY:
                self.telemetry.append(dict(timeMs=stamp, type=kind, sourceSystem=1, sourceComponent=1, data=data))
            elif kind == 'STATUSTEXT':
                self.statuses.append(dict(timeMs=stamp, severity=message.severity, text=message.text))
            if kind == 'EXTENDED_SYS_STATE' and message.landed_state == 2:
                self.airborne = True
        return message

    def until(self, condition, timeout, description):
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            message = self.pump()
            if condition(message):
                return
        raise TimeoutError(description)

    def raw_command(self, command, params):
        sent = self.now()
        self.connection.mav.command_long_send(1, 1, command, 0, *(params + [0] * (7 - len(params))))
        return sent

    def wait_ack(self, command, sent, timeout=3000):
        found = []
        def match(message):
            if message is not None and ack_matches(message, command, sent, self.now()):
                found.append(message)
                return True
            return False
        self.until(match, timeout, f'No matching COMMAND_ACK for {command}.')
        return found[0]

    def setup(self):
        self.until(lambda _: 'HEARTBEAT' in self.latest, 10000, 'No vehicle heartbeat.')
        for message_id, interval in [(0, 1000000), (32, 100000), (30, 100000), (33, 100000),
                                     (245, 200000), (193, 500000), (24, 500000), (1, 500000)]:
            sent = self.raw_command(511, [message_id, interval])
            if self.wait_ack(511, sent).result != 0:
                raise RuntimeError(f'Message interval request rejected: {message_id}.')
        sent = self.raw_command(512, [148])
        self.wait_ack(512, sent)
        self.until(lambda _: 'AUTOPILOT_VERSION' in self.latest, 3000, 'Missing AUTOPILOT_VERSION.')
        # EKF attitude, horizontal/vertical velocity, absolute horizontal/vertical position.
        required = 1 | 2 | 4 | 16 | 32
        def ready(_):
            now = self.now()
            return (all(fresh(self.latest, key, now, 1500) for key in TELEMETRY)
                    and self.latest.get('GPS_RAW_INT', (0, {}))[1].get('fix_type', 0) >= 3
                    and self.latest.get('EKF_STATUS_REPORT', (0, {}))[1].get('flags', 0) & required == required)
        self.until(ready, 80000, 'Estimator readiness deadline exceeded.')
        parameters = {}
        for name in ['ARMING_SKIPCHK', 'FRAME_CLASS', 'FRAME_TYPE', 'FS_GCS_ENABLE', 'FS_THR_ENABLE', 'SIM_WIND_SPD']:
            self.connection.mav.param_request_read_send(1, 1, name.encode(), -1)
            def received(message):
                if message is not None and message.get_type() == 'PARAM_VALUE' and message.param_id == name:
                    parameters[name] = float(message.param_value)
                    return True
                return False
            self.until(received, 3000, f'Parameter {name} was not reported.')
        if parameters['ARMING_SKIPCHK'] != 0:
            raise RuntimeError('Expected all arming checks enabled in upstream defaults.')
        version = self.latest['AUTOPILOT_VERSION'][1]
        self.origin = time.monotonic()
        self.latest = {}
        self.until(lambda _: all(key in self.latest for key in TELEMETRY), 3000, 'Initial telemetry incomplete.')
        initial = self.latest['LOCAL_POSITION_NED'][1]
        origin_ned = [initial[k] for k in ['x', 'y', 'z']]
        return origin_ned, parameters, dict(durationMs=(self.origin - self.started) * 1000, autopilotVersion=version)

    def event(self, stage, status, stamp=None, **extra):
        self.events.append(dict(timeMs=self.now() if stamp is None else stamp, stage=stage, status=status, **extra))

    def command(self, identifier, command, params):
        stamp = self.now()
        self.event(identifier, 'start', stamp)
        params = params + [0] * (7 - len(params))
        self.commands.append(dict(id=identifier, kind='command', timeMs=stamp, message='COMMAND_LONG',
                                  command=command, params=params, targetSystem=1, targetComponent=1))
        self.raw_command(command, params)
        message = self.wait_ack(command, stamp)
        self.acks.append(dict(timeMs=self.latest['COMMAND_ACK'][0], commandId=identifier, command=command, result=message.result,
                              sourceSystem=message.get_srcSystem(), sourceComponent=message.get_srcComponent(),
                              targetSystem=message.target_system, targetComponent=message.target_component))
        return message.result

    def require_command(self, identifier, command, params):
        result = self.command(identifier, command, params)
        if result != 0:
            self.event(identifier, 'rejected', self.acks[-1]['timeMs'], result=result)
            raise RuntimeError(f'{identifier} rejected with MAV_RESULT {result}.')

    def dwell(self, stage, timeout, predicate):
        gate = Dwell()
        def condition(message):
            if message is None or message.get_type() != 'LOCAL_POSITION_NED':
                return False
            stamp, data = self.latest['LOCAL_POSITION_NED']
            return gate.update(stamp, predicate(stamp, data))
        self.until(condition, timeout, f'{stage} telemetry completion deadline exceeded.')
        self.event(stage, 'complete', self.latest['LOCAL_POSITION_NED'][0])

    def collect(self, duration):
        deadline = time.monotonic() + duration / 1000
        while time.monotonic() < deadline:
            self.pump()


def record_case(identifier):
    print(f'Recording {identifier}: fresh owned ArduCopter process, speedup 1.', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix='argos-sitl-') as work:
        with open(Path(work) / 'sitl.log', 'w+') as log:
            command = [BINARY, '--model', '+', '--speedup', '1', '--home', '-35.363261,149.165230,584,0',
                       '--defaults', DEFAULTS, '--wipe', '--serial0', 'tcp:0:5760', '--sysid', '1']
            process = subprocess.Popen(command, cwd=work, stdout=log, stderr=subprocess.STDOUT)
            recorder = None
            try:
                recorder = Recorder(process)
                origin, parameters, setup = recorder.setup()
                print(f'{identifier}: estimator ready after {setup["durationMs"] / 1000:.1f} s.', file=sys.stderr, flush=True)
                recorder.require_command('guided', 176, [1, 4])
                recorder.until(lambda message: message is not None and message.get_type() == 'HEARTBEAT'
                               and message.custom_mode == 4, 3000, 'GUIDED mode not observed.')
                recorder.event('guided', 'complete', recorder.latest['HEARTBEAT'][0])
                if identifier == 'disarmed':
                    if recorder.latest['HEARTBEAT'][1]['base_mode'] & 128:
                        raise RuntimeError('Disarmed case unexpectedly armed.')
                    result = recorder.command('takeoff', 22, [0, 0, 0, 0, 0, 0, CONFIG['takeoffAltitudeM']])
                    if result == 0:
                        raise RuntimeError('Disarmed takeoff unexpectedly accepted; review actual behavior.')
                    recorder.event('takeoff', 'rejected', recorder.acks[-1]['timeMs'], result=result)
                    recorder.event('observation', 'start')
                    recorder.collect(CONFIG['rejectionObserveMs'])
                    recorder.event('observation', 'complete')
                    if recorder.airborne or any(item['data']['base_mode'] & 128 for item in recorder.telemetry if item['type'] == 'HEARTBEAT'):
                        raise RuntimeError('Rejected case unexpectedly armed or reported flight.')
                    outcome = dict(status='rejected', reason=f'Takeoff returned MAV_RESULT {result}; the disarmed vehicle remained on the ground during the observation window.')
                else:
                    recorder.require_command('arm', 400, [1, 0])
                    recorder.until(lambda message: message is not None and message.get_type() == 'HEARTBEAT'
                                   and bool(message.base_mode & 128), 3000, 'Armed heartbeat not observed.')
                    recorder.event('arm', 'complete', recorder.latest['HEARTBEAT'][0])
                    recorder.require_command('takeoff', 22, [0, 0, 0, 0, 0, 0, CONFIG['takeoffAltitudeM']])
                    takeoff_sent = recorder.commands[-1]['timeMs']
                    recorder.dwell('takeoff', CONFIG['takeoffTimeoutMs'],
                                   lambda now, _: takeoff_good(recorder.latest, now, after=takeoff_sent))
                    target = [a + b for a, b in zip(origin, CONFIG['waypointOffsetNed'])]
                    stamp = recorder.now()
                    recorder.event('waypoint', 'start', stamp)
                    recorder.commands.append(dict(id='waypoint', kind='setpoint', timeMs=stamp,
                        message='SET_POSITION_TARGET_LOCAL_NED', command=None, positionNed=target, frame=1,
                        mask=3576, targetSystem=1, targetComponent=1))
                    recorder.connection.mav.set_position_target_local_ned_send(0, 1, 1, 1, 3576, *target, 0, 0, 0, 0, 0, 0, 0, 0)
                    recorder.dwell('waypoint', CONFIG['waypointTimeoutMs'], lambda _, data: waypoint_good(data, target))
                    recorder.require_command('land', 21, [])
                    land_sent = recorder.commands[-1]['timeMs']
                    recorder.until(lambda _: landed_good(recorder.latest, recorder.now(), land_sent, recorder.airborne),
                                   CONFIG['landTimeoutMs'], 'Landing and disarming were not observed.')
                    recorder.event('land', 'complete', max(recorder.latest[name][0] for name in ['HEARTBEAT', 'EXTENDED_SYS_STATE']))
                    recorder.collect(1000)
                    outcome = dict(status='completed', reason='Takeoff and waypoint telemetry met the tolerance, speed and dwell criteria; landing and disarming were subsequently reported.')
                return dict(id=identifier, label='Arm, take off, move, land' if identifier == 'nominal' else 'Takeoff requested while disarmed',
                    runId=str(uuid.uuid4()), vehicle=dict(systemId=1, componentId=1), controller=dict(systemId=255, componentId=190),
                    config=CONFIG, originNed=origin, parameters=parameters, setup=setup, commands=recorder.commands,
                    acks=recorder.acks, telemetry=recorder.telemetry, events=recorder.events, statuses=recorder.statuses,
                    endMs=recorder.now(), outcome=outcome)
            except Exception:
                log.flush(); log.seek(0)
                print(log.read()[-10000:], file=sys.stderr)
                raise
            finally:
                if recorder and recorder.connection:
                    recorder.connection.close()
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--base-image', required=True)
    args = parser.parse_args()
    if sha256(BINARY) != BINARY_HASH or sha256(DEFAULTS) != PARAMS_HASH:
        raise RuntimeError('Runtime binary/defaults hash differs from the pinned distribution.')
    # pymavlink can print startup diagnostics; JSON is the only stdout product.
    with redirect_stdout(sys.stderr):
        cases = [record_case(identifier) for identifier in ['nominal', 'disarmed']]
    version = cases[0]['setup']['autopilotVersion']['flight_sw_version']
    version_string = '.'.join(str((version >> shift) & 255) for shift in [24, 16, 8])
    if version_string != '4.7.1':
        raise RuntimeError(f'Unexpected autopilot telemetry version {version_string}.')
    runtime = dict(recordedAt=datetime.now(timezone.utc).isoformat(), ardupilotVersion=version_string,
        binaryUrl=BINARY_URL, binarySha256=BINARY_HASH, firmwareGitHash=FIRMWARE_HASH,
        pymavlink=importlib.metadata.version('pymavlink'), python=platform.python_version(), image=args.image,
        baseImage=args.base_image, sourceSha256=sha256(__file__), paramsSha256=PARAMS_HASH,
        upstreamParamsUrl=PARAMS_URL, upstreamParamsSha256=PARAMS_HASH,
        dependencies={name: importlib.metadata.version(name) for name in ['pymavlink', 'lxml', 'fastcrc']},
        platform='linux-amd64', model='quad', modelArgument='+', speedup=1,
        clock='recorder-monotonic-receipt', transport='tcp-loopback', mavlinkVersion=2)
    print(json.dumps(dict(schemaVersion=1, kind='argos-ardupilot-sitl', runtime=runtime, cases=cases), allow_nan=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
