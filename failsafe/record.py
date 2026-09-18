#!/usr/bin/env python3
"""Observe an actual GCS-heartbeat failsafe in an isolated ArduCopter SITL."""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.metadata
import json
import os
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
SET_PARAMETERS = {'FS_GCS_ENABLE': 5, 'FS_GCS_TIMEOUT': 3, 'FS_OPTIONS': 0,
                  'MAV_GCS_SYSID': 255, 'MAV_GCS_SYSID_HI': 0}
CONFIG = {key: sitl.CONFIG[key] for key in ['takeoffAltitudeM', 'takeoffToleranceM',
    'speedToleranceMps', 'dwellMs', 'freshnessMs', 'maxSampleGapMs', 'heartbeatFreshnessMs',
    'landedFreshnessMs', 'ackTimeoutMs', 'takeoffTimeoutMs', 'landTimeoutMs']}
CONFIG.update(heartbeatIntervalMs=1000, observationDurationMs=14000, lossDelayMs=2000,
              lossDurationMs=8000, gcsTimeoutMs=3000)
HEARTBEAT = dict(type=6, autopilot=8, base_mode=0, custom_mode=0, system_status=0, mavlink_version=3)


def gcs_status(text):
    if text == 'GCS Failsafe Cleared':
        return 'complete'
    if text == 'GCS Failsafe':
        return 'start'
    return None


class Recorder(sitl.Recorder):
    def __init__(self, process):
        self.heartbeat_enabled = True
        self.heartbeat_tx = []
        self.setup_heartbeat_count = 0
        self.last_setup_heartbeat = None
        self.observe_landing = False
        self.landing_started = self.landing_completed = None
        super().__init__(process)

    def send_heartbeat(self, wall):
        if self.heartbeat_enabled and wall - self.last_heartbeat >= CONFIG['heartbeatIntervalMs'] / 1000:
            self.connection.mav.heartbeat_send(6, 8, 0, 0, 0, 3)
            sent = time.monotonic()
            self.last_heartbeat = sent
            if self.origin is None:
                self.setup_heartbeat_count += 1
                self.last_setup_heartbeat = sent
            else:
                self.heartbeat_tx.append(dict(timeMs=(sent-self.origin)*1000, message='HEARTBEAT',
                    sourceSystem=255, sourceComponent=190, data=dict(HEARTBEAT)))

    def pump(self):
        if self.process.poll() is not None:
            raise RuntimeError('Owned SITL process exited during collection.')
        self.send_heartbeat(time.monotonic())
        message = self.connection.recv_match(blocking=True, timeout=.05)
        if message is None or message.get_srcSystem() != 1 or message.get_srcComponent() != 1:
            return None
        stamp = self.now()
        kind = message.get_type()
        data = message.to_dict()
        data.pop('mavpackettype', None)
        self.latest[kind] = (stamp, data)
        if self.origin is not None:
            if kind in sitl.TELEMETRY:
                self.telemetry.append(dict(timeMs=stamp, type=kind, sourceSystem=1, sourceComponent=1, data=data))
            elif kind == 'STATUSTEXT':
                self.statuses.append(dict(timeMs=stamp, severity=message.severity, text=message.text))
                status = gcs_status(message.text)
                if status:
                    self.event('failsafe', status, stamp)
            if kind == 'EXTENDED_SYS_STATE' and message.landed_state == 2:
                self.airborne = True
            if self.observe_landing:
                if self.landing_started is None and kind == 'HEARTBEAT' and message.custom_mode == 9:
                    self.landing_started = stamp
                    self.event('landing', 'start', stamp)
                if (self.landing_started is not None and self.landing_completed is None
                        and sitl.landed_good(self.latest, stamp, self.landing_started, self.airborne)):
                    self.landing_completed = max(self.latest[name][0] for name in ['HEARTBEAT', 'EXTENDED_SYS_STATE'])
                    self.event('landing', 'complete', self.landing_completed)
        return message

    def read_parameter(self, name):
        self.connection.mav.param_request_read_send(1, 1, name.encode(), -1)
        result = []
        def received(message):
            if message is not None and message.get_type() == 'PARAM_VALUE' and message.param_id == name:
                result.append(float(message.param_value))
                return True
            return False
        self.until(received, 3000, 'Missing parameter readback: ' + name)
        return result[0]

    def setup(self):
        self.until(lambda _: 'HEARTBEAT' in self.latest, 10000, 'No vehicle heartbeat.')
        for name, expected in SET_PARAMETERS.items():
            self.connection.mav.param_set_send(1, 1, name.encode(), expected, 9)
            self.until(lambda m: m is not None and m.get_type() == 'PARAM_VALUE'
                       and m.param_id == name and m.param_value == expected,
                       3000, 'Parameter assignment was not confirmed: ' + name)
            if self.read_parameter(name) != expected:
                raise RuntimeError('Failsafe parameter differs from requested value: ' + name)
        origin, parameters, setup = super().setup()
        for name, expected in SET_PARAMETERS.items():
            parameters[name] = self.read_parameter(name)
            if parameters[name] != expected:
                raise RuntimeError('Failsafe parameter changed during setup: ' + name)
        setup['heartbeatCount'] = self.setup_heartbeat_count
        setup['lastHeartbeatBeforeOriginMs'] = (self.last_setup_heartbeat - self.origin) * 1000
        setup['configuredParameters'] = dict(SET_PARAMETERS)
        return origin, parameters, setup

    def observation(self, loss):
        start = self.now()
        self.event('observation', 'start', start)
        blackout = None
        self.observe_landing = loss
        while self.now() - start < CONFIG['observationDurationMs']:
            now = self.now()
            if loss and blackout is None and now - start >= CONFIG['lossDelayMs']:
                self.heartbeat_enabled = False
                blackout = dict(startTimeMs=now, endTimeMs=None)
                self.event('heartbeat-loss', 'start', now)
            if blackout and blackout['endTimeMs'] is None and now - blackout['startTimeMs'] >= CONFIG['lossDurationMs']:
                self.heartbeat_enabled = True
                blackout['endTimeMs'] = now
                self.event('heartbeat-loss', 'complete', now)
            self.pump()
        self.event('observation', 'complete')
        if loss and (blackout is None or blackout['endTimeMs'] is None):
            raise RuntimeError('Heartbeat restoration was not recorded inside the observation window.')
        return blackout


def record_case(identifier):
    print(f'Recording {identifier}: fresh owned SITL, GCS LAND failsafe enabled.', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix='argos-failsafe-') as work:
        with open(Path(work) / 'sitl.log', 'w+') as log:
            process = subprocess.Popen([sitl.BINARY, '--model', '+', '--speedup', '1',
                '--home', '-35.363261,149.165230,584,0', '--defaults', sitl.DEFAULTS,
                '--wipe', '--serial0', 'tcp:0:5760', '--sysid', '1'],
                cwd=work, stdout=log, stderr=subprocess.STDOUT)
            recorder = None
            try:
                recorder = Recorder(process)
                origin, parameters, setup = recorder.setup()
                print(f'{identifier}: estimator ready after {setup["durationMs"]/1000:.1f}s.', file=sys.stderr, flush=True)
                recorder.require_command('guided', 176, [1, 4])
                recorder.until(lambda m: m is not None and m.get_type() == 'HEARTBEAT' and m.custom_mode == 4,
                               3000, 'Guided mode not observed.')
                recorder.event('guided', 'complete', recorder.latest['HEARTBEAT'][0])
                recorder.require_command('arm', 400, [1, 0])
                recorder.until(lambda m: m is not None and m.get_type() == 'HEARTBEAT' and bool(m.base_mode & 128),
                               3000, 'Armed heartbeat not observed.')
                recorder.event('arm', 'complete', recorder.latest['HEARTBEAT'][0])
                recorder.require_command('takeoff', 22, [0, 0, 0, 0, 0, 0, CONFIG['takeoffAltitudeM']])
                sent = recorder.commands[-1]['timeMs']
                recorder.dwell('takeoff', CONFIG['takeoffTimeoutMs'],
                               lambda now, _: sitl.takeoff_good(recorder.latest, now, after=sent))
                blackout = recorder.observation(identifier == 'loss')
                if identifier == 'nominal':
                    recorder.require_command('land', 21, [])
                    sent = recorder.commands[-1]['timeMs']
                    recorder.until(lambda _: sitl.landed_good(recorder.latest, recorder.now(), sent, recorder.airborne),
                                   CONFIG['landTimeoutMs'], 'Nominal landing and disarming not observed.')
                    recorder.event('land', 'complete', max(recorder.latest[k][0] for k in ['HEARTBEAT', 'EXTENDED_SYS_STATE']))
                else:
                    recorder.until(lambda _: recorder.landing_completed is not None,
                                   CONFIG['landTimeoutMs'], 'Autonomous landing and disarming not observed.')
                    if not all(any(e['stage'] == 'failsafe' and e['status'] == status for e in recorder.events)
                               for status in ['start', 'complete']):
                        raise RuntimeError('Missing actual GCS failsafe onset or clear status.')
                recorder.collect(1000)
                initial = next(row for row in recorder.telemetry if row['type'] == 'LOCAL_POSITION_NED')
                return dict(id=identifier, label='Continuous GCS heartbeat' if identifier == 'nominal' else 'Eight-second heartbeat interruption',
                    runId=str(uuid.uuid4()), vehicle=dict(systemId=1, componentId=1), controller=dict(systemId=255, componentId=190),
                    config=CONFIG, originNed=[initial['data'][k] for k in ['x', 'y', 'z']], originTimeMs=initial['timeMs'],
                    parameters=parameters, setup=setup, commands=recorder.commands, acks=recorder.acks,
                    heartbeatTx=recorder.heartbeat_tx, blackout=blackout, telemetry=recorder.telemetry,
                    events=recorder.events, statuses=recorder.statuses, endMs=recorder.now(),
                    outcome=dict(status='completed', reason='Measured takeoff settled; the matched observation window completed, then landing and disarming were reported.'))
            except Exception:
                log.flush(); log.seek(0); print(log.read()[-12000:], file=sys.stderr)
                if recorder:
                    print('Observed statuses: ' + repr(recorder.statuses), file=sys.stderr)
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
    if sitl.sha256(sitl.BINARY) != sitl.BINARY_HASH or sitl.sha256(sitl.DEFAULTS) != sitl.PARAMS_HASH:
        raise RuntimeError('Unexpected runtime binary or default parameters.')
    with redirect_stdout(sys.stderr):
        cases = [record_case(name) for name in ['nominal', 'loss']]
    for run in cases:
        version = run['setup']['autopilotVersion']['flight_sw_version']
        if '.'.join(str((version >> shift) & 255) for shift in [24, 16, 8]) != '4.7.1':
            raise RuntimeError('Unexpected autopilot version.')
    runtime = dict(recordedAt=datetime.now(timezone.utc).isoformat(), ardupilotVersion='4.7.1',
        binaryUrl=sitl.BINARY_URL, binarySha256=sitl.BINARY_HASH, firmwareGitHash=sitl.FIRMWARE_HASH,
        pymavlink=importlib.metadata.version('pymavlink'), python=platform.python_version(),
        image=args.image, baseImage=args.base_image, sourceSha256=sitl.sha256(__file__),
        sitlSourceSha256=sitl.sha256(sitl.__file__), filesSha256={'record.py': sitl.sha256(__file__)},
        dockerfileSha256=sitl.sha256(ROOT.parent / 'sitl/Dockerfile'), paramsSha256=sitl.PARAMS_HASH,
        upstreamParamsUrl=sitl.PARAMS_URL, upstreamParamsSha256=sitl.PARAMS_HASH,
        dependencies={name: importlib.metadata.version(name) for name in ['pymavlink', 'lxml', 'fastcrc']},
        platform='linux-amd64', model='quad', modelArgument='+', speedup=1,
        clock='recorder-monotonic-receipt', heartbeatClock='recorder-monotonic-send',
        transport='tcp-loopback', mavlinkVersion=2)
    print(json.dumps(dict(schemaVersion=1, kind='argos-ardupilot-failsafe', runtime=runtime, cases=cases), allow_nan=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
