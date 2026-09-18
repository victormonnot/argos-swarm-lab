#!/usr/bin/env python3
"""Record isolated ArduPilot JSON/SITL + Gazebo physics, never a hardware endpoint."""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
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
import threading
import time
import uuid
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'sitl'))
import record as sitl
from gz.transport13 import Node
from gz.msgs10.stringmsg_pb2 import StringMsg
from gz.msgs10.boolean_pb2 import Boolean

ROOT = Path(__file__).resolve().parent
BINARY = '/opt/arducopter'
PLUGIN_REVISION = '082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5'
CONFIG = dict(sitl.CONFIG, hoverDurationMs=12000, pulseDelayMs=2000,
              recoveryToleranceM=.35, recoverySpeedMps=.25, recoveryDwellMs=1000,
              truthMaxGapMs=150)


def finite_vector(value, size=3):
    return isinstance(value, list) and len(value) == size and all(isinstance(v, (int, float)) and math.isfinite(v) for v in value)


def check_truth(row):
    if not math.isfinite(row['simTimeMs']) or row['simTimeMs'] < 0:
        raise ValueError('Invalid simulator timestamp.')
    for name in ['positionEnu', 'velocityEnu', 'forceEnu', 'impulseNs']:
        if not finite_vector(row[name]):
            raise ValueError('Invalid world truth vector: ' + name)
    if not finite_vector(row['orientationXyzw'], 4) or abs(sum(v*v for v in row['orientationXyzw']) - 1) > 1e-5:
        raise ValueError('World truth quaternion is not unit length.')
    if not isinstance(row['pulseActive'], bool) or not isinstance(row['pulseAppliedSteps'], int) or row['pulseAppliedSteps'] < 0:
        raise ValueError('Invalid physical pulse evidence.')
    return row


class TruthFeed:
    def __init__(self):
        self.lock = threading.Lock()
        self.pending = []
        self.failure = None
        self.node = Node()
        if not self.node.subscribe(StringMsg, '/argos/truth', self.receive):
            raise RuntimeError('Could not subscribe to the owned Gazebo observer.')
        self.publisher = self.node.advertise('/argos/pulse', Boolean)
        if not self.publisher:
            raise RuntimeError('Could not advertise the disturbance request.')

    def receive(self, message):
        received = time.monotonic()
        try:
            row = check_truth(json.loads(message.data))
            with self.lock:
                self.pending.append((received, row))
        except Exception as error:
            with self.lock:
                self.failure = error

    def drain(self):
        with self.lock:
            if self.failure:
                raise self.failure
            pending, self.pending = self.pending, []
        return pending

    def pulse(self):
        message = Boolean()
        message.data = True
        if not self.publisher.publish(message):
            raise RuntimeError('Gazebo pulse request could not be published.')

    def close(self):
        self.node.unsubscribe('/argos/truth')


class Recorder(sitl.Recorder):
    def __init__(self, process, gazebo, feed):
        self.gazebo, self.feed = gazebo, feed
        self.truth, self.latest_truth = [], None
        super().__init__(process)

    def pump(self):
        if self.gazebo.poll() is not None:
            raise RuntimeError('Owned Gazebo process exited during collection.')
        for received, raw in self.feed.drain():
            if self.origin is not None and received >= self.origin:
                row = dict(timeMs=(received - self.origin) * 1000, **raw)
                if self.truth and row['simTimeMs'] <= self.truth[-1]['simTimeMs']:
                    raise RuntimeError('Simulator time did not advance monotonically.')
                self.truth.append(row)
                self.latest_truth = row
        return super().pump()

    def setup(self):
        origin, parameters, setup = super().setup()
        for name in ['AHRS_EKF_TYPE', 'EK3_ENABLE', 'SIM_SPEEDUP']:
            self.connection.mav.param_request_read_send(1, 1, name.encode(), -1)
            def received(message):
                if message is not None and message.get_type() == 'PARAM_VALUE' and message.param_id == name:
                    parameters[name] = float(message.param_value)
                    return True
                return False
            self.until(received, 3000, 'Missing estimator parameter ' + name)
        if parameters['AHRS_EKF_TYPE'] != 3 or parameters['EK3_ENABLE'] != 1:
            raise RuntimeError('Expected EKF3 sensor estimates, not the direct SITL truth estimator.')
        self.until(lambda _: self.latest_truth is not None, 5000, 'No independent world truth.')
        return origin, parameters, setup

    def hover(self, perturb):
        self.until(lambda _: self.latest_truth is not None and self.now() - self.latest_truth['timeMs'] < 500,
                   3000, 'World truth is stale before the observation window.')
        start_sim = self.latest_truth['simTimeMs']
        self.event('hover', 'start', simTimeMs=start_sim)
        pulse = None
        deadline = time.monotonic() + 45
        while self.latest_truth['simTimeMs'] - start_sim < CONFIG['hoverDurationMs']:
            if time.monotonic() >= deadline:
                raise TimeoutError('Gazebo hover window did not complete within 45 wall seconds.')
            if perturb and pulse is None and self.latest_truth['simTimeMs'] - start_sim >= CONFIG['pulseDelayMs']:
                pulse = dict(requestTimeMs=self.now(), forceEnu=[8, 0, 0], durationMs=1000)
                self.feed.pulse()
            self.pump()
        self.event('hover', 'complete', simTimeMs=self.latest_truth['simTimeMs'])
        if perturb:
            active = [row for row in self.truth if row['pulseActive']]
            if not active or self.latest_truth['pulseActive'] or not math.isclose(self.latest_truth['impulseNs'][0], 8, abs_tol=.009):
                raise RuntimeError('Physical pulse did not apply once and clear after one simulation second.')
        return pulse


def prepare_model(work):
    destination = Path(work) / 'models' / 'argos_iris'
    destination.mkdir(parents=True)
    original = Path('/opt/ardupilot_gazebo/models/iris_with_ardupilot/model.sdf')
    tree = ET.parse(original)
    plugin = tree.find(".//plugin[@name='ArduPilotPlugin']")
    plugin.find('no_time_sync').text = '0'
    plugin.find('lock_step').text = '1'
    tree.write(destination / 'model.sdf', encoding='utf-8', xml_declaration=True)
    (destination / 'model.config').write_text('<model><name>argos_iris</name><version>1</version><sdf version="1.9">model.sdf</sdf></model>')
    return destination / 'model.sdf'


def stop_process(process):
    if process is None or process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def record_case(identifier):
    print(f'Recording {identifier}: fresh isolated Gazebo + ArduCopter JSON processes.', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix='argos-gazebo-') as work:
        model = prepare_model(work)
        env = dict(os.environ, GZ_SIM_RESOURCE_PATH=f'{work}/models:/opt/ardupilot_gazebo/models',
                   GZ_PARTITION=os.environ.setdefault('GZ_PARTITION', 'argos-' + str(uuid.uuid4())))
        # Transport discovers only the owned process pair within this isolated container.
        os.environ['GZ_PARTITION'] = env['GZ_PARTITION']
        feed = TruthFeed()
        with open(Path(work) / 'gazebo.log', 'w+') as gzlog, open(Path(work) / 'sitl.log', 'w+') as aplog:
            gazebo = process = recorder = None
            try:
                gazebo = subprocess.Popen(['gz', 'sim', '-s', '-r', '-v', '2', str(ROOT / 'world.sdf')], cwd=work,
                    env=env, stdout=gzlog, stderr=subprocess.STDOUT, start_new_session=True)
                process = subprocess.Popen([BINARY, '--model', 'JSON', '--speedup', '1', '--home', '-35.363261,149.165230,584,0',
                    '--defaults', '/opt/copter.parm,/opt/gazebo-iris.parm,' + str(ROOT / 'overrides.parm'),
                    '--wipe', '--serial0', 'tcp:0:5760', '--sysid', '1'], cwd=work,
                    env=env, stdout=aplog, stderr=subprocess.STDOUT, start_new_session=True)
                recorder = Recorder(process, gazebo, feed)
                origin, parameters, setup = recorder.setup()
                setup['modelSha256'] = sitl.sha256(model)
                print(f'{identifier}: EKF3 ready after {setup["durationMs"] / 1000:.1f} s; world truth arriving.', file=sys.stderr, flush=True)
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
                recorder.dwell('takeoff', CONFIG['takeoffTimeoutMs'], lambda now, _: sitl.takeoff_good(recorder.latest, now, after=sent))
                pulse = recorder.hover(identifier == 'pulse')
                recorder.require_command('land', 21, [])
                sent = recorder.commands[-1]['timeMs']
                recorder.until(lambda _: sitl.landed_good(recorder.latest, recorder.now(), sent, recorder.airborne),
                               CONFIG['landTimeoutMs'], 'Landing and disarming were not observed.')
                recorder.event('land', 'complete', max(recorder.latest[k][0] for k in ['HEARTBEAT', 'EXTENDED_SYS_STATE']))
                recorder.collect(1000)
                initial_estimate = next(row for row in recorder.telemetry if row['type'] == 'LOCAL_POSITION_NED')
                return dict(id=identifier, label='Nominal hover' if identifier == 'nominal' else 'Lateral force pulse',
                    runId=str(uuid.uuid4()), vehicle=dict(systemId=1, componentId=1), controller=dict(systemId=255, componentId=190),
                    config=CONFIG, originNed=[initial_estimate['data'][k] for k in ['x', 'y', 'z']], originTruthEnu=recorder.truth[0]['positionEnu'],
                    originSampleTimes=dict(estimateTimeMs=initial_estimate['timeMs'], truthTimeMs=recorder.truth[0]['timeMs']),
                    parameters=parameters, setup=setup, commands=recorder.commands, acks=recorder.acks,
                    telemetry=recorder.telemetry, truth=recorder.truth, pulse=pulse, events=recorder.events,
                    statuses=recorder.statuses, endMs=recorder.now(), outcome=dict(status='completed',
                    reason='Estimated takeoff settled, the fixed simulator-time hover window completed, then the vehicle reported landing and disarming.'))
            except Exception:
                for label, log in [('GAZEBO', gzlog), ('ARDUPILOT', aplog)]:
                    log.flush(); log.seek(0); print(label + '\n' + log.read()[-14000:], file=sys.stderr)
                raise
            finally:
                if recorder and recorder.connection:
                    recorder.connection.close()
                stop_process(process)
                stop_process(gazebo)
                feed.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--base-image', required=True)
    args = parser.parse_args()
    if sitl.sha256(BINARY) != sitl.BINARY_HASH:
        raise RuntimeError('Unexpected ArduPilot binary.')
    with redirect_stdout(sys.stderr):
        cases = [record_case(name) for name in ['nominal', 'pulse']]
    for run in cases:
        version = run['setup']['autopilotVersion']['flight_sw_version']
        actual = '.'.join(str((version >> shift) & 255) for shift in [24, 16, 8])
        if actual != '4.7.1':
            raise RuntimeError('Unexpected AUTOPILOT_VERSION: ' + actual)
    files = ['record.py', 'TruthObserver.cc', 'world.sdf', 'overrides.parm', 'Dockerfile', 'CMakeLists.txt']
    runtime = dict(recordedAt=datetime.now(timezone.utc).isoformat(), ardupilotVersion='4.7.1',
        binaryUrl=sitl.BINARY_URL, binarySha256=sitl.BINARY_HASH, firmwareGitHash=sitl.FIRMWARE_HASH,
        pluginGitHash=PLUGIN_REVISION, image=args.image, baseImage=args.base_image, platform='linux-amd64',
        gazeboVersion=subprocess.check_output(['gz', 'sim', '--versions'], text=True).strip(),
        python=platform.python_version(), pymavlink=importlib.metadata.version('pymavlink'),
        sourceSha256=sitl.sha256(__file__), sitlSourceSha256=sitl.sha256(sitl.__file__),
        observerSha256=sitl.sha256(ROOT / 'TruthObserver.cc'), worldSha256=sitl.sha256(ROOT / 'world.sdf'),
        overridesSha256=sitl.sha256(ROOT / 'overrides.parm'),
        filesSha256={name: sitl.sha256(ROOT / name) for name in files},
        paramsSha256={name: sitl.sha256('/opt/' + name) for name in ['copter.parm', 'gazebo-iris.parm']},
        packages=subprocess.check_output(['dpkg-query', '-W', '-f=${Package}=${Version}\n', 'libgz-sim8', 'libgz-physics7', 'libgz-transport13', 'python3-gz-transport13', 'python3-gz-msgs10'], text=True).strip().splitlines(),
        model='Iris', modelArgument='JSON', physics='DART', maxStepSizeMs=1, realTimeFactorTarget=1,
        lockStep=True, noTimeSync=False, clock='recorder-monotonic-receipt', truthClock='gazebo-simulation',
        truthLink='iris::iris_with_standoffs::imu_link', forceLink='iris::iris_with_standoffs::base_link',
        transport='tcp-loopback', mavlinkVersion=2)
    print(json.dumps(dict(schemaVersion=1, kind='argos-ardupilot-gazebo', runtime=runtime, cases=cases), allow_nan=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
