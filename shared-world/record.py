#!/usr/bin/env python3
"""Three real JSON/SITL autopilots, one Gazebo world, existing mission coordinator."""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.metadata
import importlib.util
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

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery_helper', ROOT.parent / 'recovery/record.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
fleet, sitl = recovery.fleet, recovery.sitl
from gz.transport13 import Node
from gz.msgs10.stringmsg_pb2 import StringMsg

PLUGIN_REVISION = '082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5'
BINARY = '/opt/arducopter'
DEFAULTS = '/opt/copter.parm'
HOME = [-35.363261, 149.165230, 584, 0]
TELEMETRY_INTERVALS_US = {0:333333, 32:33333, 30:33333, 33:33333, 245:66666, 193:166666, 24:166666, 1:166666}
REGISTRY = [dict(row, jsonPort=9002+10*row['instance'], modelName=row['id']) for row in recovery.REGISTRY]
WORLD = dict(name='argos_shared_yard', groundSizeM=[50, 50], spawnHeightM=.195,
             observationLink='iris_with_standoffs::imu_link', physicsStepMs=1, truthFrequencyHz=20,
             buildings=[dict(id='west_store', positionEnu=[-11, 8, 2.5], size=[4, 10, 5]),
                        dict(id='east_store', positionEnu=[11, 8, 3], size=[4, 10, 6]),
                        dict(id='north_store', positionEnu=[0, 18, 2], size=[10, 4, 4])])


def finite_vector(value, size=3):
    return isinstance(value, list) and len(value) == size and all(type(v) in [int, float] and math.isfinite(v) for v in value)


def check_truth(row):
    if not math.isfinite(row['simTimeMs']) or row['simTimeMs'] < 0:
        raise ValueError('Invalid simulator timestamp.')
    if [v['id'] for v in row['vehicles']] != ['A1', 'A2', 'A3']:
        raise ValueError('Incomplete shared-world vehicle snapshot.')
    for vehicle in row['vehicles']:
        if not all(finite_vector(vehicle[name]) for name in ['positionEnu', 'velocityEnu']):
            raise ValueError('Invalid world position or velocity.')
        q = vehicle['orientationXyzw']
        if not finite_vector(q, 4) or abs(sum(v*v for v in q)-1) > 1e-5:
            raise ValueError('World quaternion must be unit length.')
    for name in ['observerSteps', 'collisionCount']:
        if type(row[name]) is not int or row[name] <= 0:
            raise ValueError('Invalid observer coverage.')
    for name in ['groundSteps', 'obstacleSteps', 'vehicleSteps', 'otherSteps']:
        if type(row['contactTotals'][name]) is not int or not 0 <= row['contactTotals'][name] <= row['observerSteps']:
            raise ValueError('Invalid cumulative contact counter.')
    return row


class TruthFeed:
    def __init__(self):
        self.lock = threading.Lock()
        self.pending, self.failure = [], None
        self.node = Node()
        if not self.node.subscribe(StringMsg, '/argos/shared-world', self.receive):
            raise RuntimeError('Could not subscribe to the shared-world observer.')

    def receive(self, message):
        received = time.monotonic()
        try:
            row = check_truth(json.loads(message.data))
            with self.lock: self.pending.append((received, row))
        except Exception as error:
            with self.lock: self.failure = error

    def drain(self):
        with self.lock:
            if self.failure: raise self.failure
            pending, self.pending = self.pending, []
        return pending

    def close(self):
        self.node.unsubscribe('/argos/shared-world')


class Coordinator(recovery.Coordinator):
    """Only evaluator collection/setup differs; inherited BT/greedy sees MAVLink only."""
    def __init__(self, vehicles, identifier, gazebo, feed):
        self.gazebo, self.feed = gazebo, feed
        self.truth = []
        self.collision_names = None
        self.last_setup_report = time.monotonic()
        super().__init__(vehicles, identifier)

    def pump(self):
        if self.gazebo.poll() is not None:
            raise RuntimeError('Owned shared Gazebo server exited.')
        for received, raw in self.feed.drain():
            names = raw.pop('collisionNames')
            if self.collision_names is None: self.collision_names = names
            elif names != self.collision_names: raise RuntimeError('World collider registry changed during collection.')
            if self.origin is not None and received >= self.origin:
                row = dict(timeMs=(received-self.origin)*1000, **raw)
                if self.truth and row['simTimeMs'] <= self.truth[-1]['simTimeMs']:
                    raise RuntimeError('Shared world clock stopped or reversed.')
                self.truth.append(row)
        result = super().pump()
        if self.origin is None and time.monotonic()-self.last_setup_report > 20:
            self.last_setup_report = time.monotonic()
            print('Estimator setup: ' + repr({v.spec['id']:dict(
                gpsFix=v.latest.get('GPS_RAW_INT',(None,{}))[1].get('fix_type'),
                ekfFlags=v.latest.get('EKF_STATUS_REPORT',(None,{}))[1].get('flags'),
                bootMs=v.latest.get('ATTITUDE',(None,{}))[1].get('time_boot_ms')) for v in self.vehicles}),file=sys.stderr,flush=True)
        return result

    def setup(self):
        super().setup()
        for vehicle in self.vehicles:
            vehicle.setup.update(readinessTimeoutMs=200000, telemetryIntervalsUs=TELEMETRY_INTERVALS_US)
            for name in ['AHRS_EKF_TYPE', 'EK3_ENABLE', 'SIM_SPEEDUP']:
                vehicle.parameters[name] = self.read_parameter(vehicle, name)
            if any(vehicle.parameters[name] != expected for name, expected in
                   [('FRAME_CLASS', 1), ('FRAME_TYPE', 1), ('AHRS_EKF_TYPE', 3), ('EK3_ENABLE', 1), ('SIM_SPEEDUP', 1)]):
                raise RuntimeError('Expected Iris X with EKF3 and synchronized JSON physics.')
        self.until(lambda: bool(self.truth), 5000, 'No shared-world observations.')
        # Read-only evaluator baseline; never assigned to the mission state.
        for vehicle in self.vehicles:
            row = self.truth[0]
            vehicle.origin_truth = next(v['positionEnu'] for v in row['vehicles'] if v['id'] == vehicle.spec['id'])
            vehicle.origin_truth_time = row['timeMs']

    def until(self, predicate, timeout_ms, reason):
        if reason == 'Both estimators did not become ready.':
            timeout_ms = 200000
        return super().until(predicate, timeout_ms, reason)

    def raw_command(self, vehicle, command, params):
        # Stream periods use autopilot simulation time; retain receipt-time freshness
        # gates on slower shared physics by requesting a declared higher source rate.
        if self.origin is None and command == 511:
            params = [params[0], TELEMETRY_INTERVALS_US[params[0]]]
        return super().raw_command(vehicle, command, params)

    def resource_sample(self):
        super().resource_sample()
        self.resources[-1]['gazebo'] = dict(pid=self.gazebo.pid, running=self.gazebo.poll() is None,
                                           rssKiB=fleet.rss_kib(self.gazebo.pid))


def prepare_models(work, source=Path('/opt/ardupilot_gazebo/models/iris_with_ardupilot/model.sdf')):
    """Distinct bridge ports; all retain upstream geometry and sensor conventions."""
    result = {}
    for registry in REGISTRY:
        name = 'argos_iris_' + registry['id']
        destination = Path(work) / 'models' / name
        destination.mkdir(parents=True)
        tree = ET.parse(source)
        plugin = tree.find(".//plugin[@name='ArduPilotPlugin']")
        plugin.find('no_time_sync').text = '0'
        plugin.find('lock_step').text = '1'
        plugin.find('fdm_port_in').text = str(registry['jsonPort'])
        tree.write(destination / 'model.sdf', encoding='utf-8', xml_declaration=True)
        (destination / 'model.config').write_text(f'<model><name>{name}</name><version>1</version><sdf version="1.9">model.sdf</sdf></model>')
        result[registry['id']] = destination / 'model.sdf'
    return result


def stop_process(process):
    if process is None or process.poll() is not None: return
    os.killpg(process.pid, signal.SIGTERM)
    try: process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def record_case(identifier):
    print(f'Recording {identifier}: three JSON autopilots in one collidable Gazebo world.', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(prefix='argos-shared-world-') as directory:
        models = prepare_models(directory)
        env = dict(os.environ, GZ_SIM_RESOURCE_PATH=f'{directory}/models:/opt/ardupilot_gazebo/models',
                   GZ_PARTITION=os.environ.setdefault('GZ_PARTITION', 'argos-shared-' + str(uuid.uuid4())))
        os.environ['GZ_PARTITION'] = env['GZ_PARTITION']
        feed = TruthFeed()
        logs, vehicles = [], []
        gazebo = coordinator = None
        try:
            gzlog = open(Path(directory)/'gazebo.log', 'w+'); logs.append(('GAZEBO', gzlog))
            gazebo = subprocess.Popen(['gz', 'sim', '-s', '-r', '-v', '2', str(ROOT/'world.sdf')], cwd=directory,
                env=env, stdout=gzlog, stderr=subprocess.STDOUT, start_new_session=True)
            for registry in REGISTRY:
                work = Path(directory)/registry['id']; work.mkdir()
                log = open(work/'sitl.log', 'w+'); logs.append((registry['id'], log))
                process = subprocess.Popen([BINARY, '--model', 'JSON', '--speedup', '1',
                    '--instance', str(registry['instance']), '--home', ','.join(str(v) for v in HOME),
                    '--defaults', '/opt/copter.parm,/opt/gazebo-iris.parm,' + str(ROOT/'overrides.parm'),
                    '--wipe', '--serial0', 'tcp:0', '--sysid', str(registry['systemId'])],
                    cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                vehicles.append(recovery.Vehicle(registry, process, HOME))
            coordinator = Coordinator(vehicles, identifier, gazebo, feed); coordinator.setup()
            print(f'{identifier}: all three EKF3 estimators ready after {vehicles[0].setup["durationMs"]/1000:.1f}s.', file=sys.stderr, flush=True)
            coordinator.run()
            results = []
            for v in vehicles:
                v.setup['modelSha256'] = sitl.sha256(models[v.spec['id']])
                results.append(dict(**v.spec, pid=v.process.pid, homeGps=v.home, originNed=v.origin, originTimeMs=v.origin_time,
                    originTruthEnu=v.origin_truth, originTruthTimeMs=v.origin_truth_time,
                    parameters=v.parameters, setup=v.setup, commands=v.commands, acks=v.acks, telemetry=v.telemetry,
                    events=v.events, statuses=v.statuses))
            complete = sum(state == 'completed' for state in coordinator.task_states.values())
            if not coordinator.truth or coordinator.now()-coordinator.truth[-1]['timeMs'] > 500:
                raise RuntimeError('World observations missing or stale at recording end.')
            final = coordinator.truth[-1]
            if final['collisionCount'] != 31:
                raise RuntimeError('Expected all 31 colliders to be monitored.')
            for registry in REGISTRY:
                if not any(row['kind'] == 'ground' and any(row[key].startswith(registry['id']+'::') for key in ['collision1','collision2'])
                           for row in final['contactHistory']):
                    raise RuntimeError('Ground contact collection not demonstrated for ' + registry['id'])
            run = dict(id=identifier, label='Three drones share one world' if identifier == 'nominal' else 'A1 withdraws in the shared world',
                runId=str(uuid.uuid4()), config=recovery.CONFIG, controller=dict(systemId=255, componentId=190), tasks=recovery.TASKS,
                vehicles=results, assignments=coordinator.assignments, attempts=coordinator.attempts,
                taskEvents=coordinator.task_events, withdrawal=coordinator.withdrawal, btTicks=coordinator.bt_ticks,
                missionStartMs=coordinator.mission_start, missionDeadlineMs=coordinator.mission_deadline,
                missionCompletedMs=coordinator.mission_completed, missionClosedMs=coordinator.mission_closed,
                events=coordinator.events, resources=coordinator.resources, endMs=coordinator.now(),
                world=dict(WORLD, collisionNames=coordinator.collision_names), truth=coordinator.truth, gazeboPid=gazebo.pid,
                outcome=dict(status='completed' if complete == 6 else 'partial', tasksCompleted=complete,
                    landedVehicles=sum(v.land_done is not None for v in vehicles),
                    missionElapsedMs=(coordinator.mission_completed-coordinator.mission_start) if complete == 6 else None))
            print(f'{identifier}: {complete}/6 tasks; mission {run["outcome"]["missionElapsedMs"]}ms; contacts {final["contactTotals"]}.', file=sys.stderr, flush=True)
            return run
        except Exception:
            for label, log in logs:
                log.flush(); log.seek(0); print(label+'\n'+log.read()[-12000:], file=sys.stderr)
            for vehicle in vehicles: print(vehicle.spec['id']+' statuses: '+repr(vehicle.statuses), file=sys.stderr)
            raise
        finally:
            for vehicle in vehicles:
                if vehicle.connection: vehicle.connection.close()
                stop_process(vehicle.process)
            stop_process(gazebo)
            feed.close()
            for _, log in logs: log.close()


def main():
    parser = argparse.ArgumentParser()
    for arg in ['image', 'base-image', 'gazebo-image']: parser.add_argument('--'+arg, required=True)
    args = parser.parse_args()
    if sitl.sha256(BINARY) != sitl.BINARY_HASH or sitl.sha256(DEFAULTS) != sitl.PARAMS_HASH:
        raise RuntimeError('Unexpected simulator or defaults.')
    with redirect_stdout(sys.stderr): cases = [record_case(name) for name in ['nominal', 'withdrawal']]
    for run in cases:
        for vehicle in run['vehicles']:
            version = vehicle['setup']['autopilotVersion']['flight_sw_version']
            if '.'.join(str((version >> shift)&255) for shift in [24,16,8]) != '4.7.1':
                raise RuntimeError('Unexpected autopilot version.')
    files = ['record.py', 'SharedWorldObserver.cc', 'world.sdf', 'overrides.parm', 'Dockerfile', 'CMakeLists.txt']
    runtime = dict(recordedAt=datetime.now(timezone.utc).isoformat(), ardupilotVersion='4.7.1',
        binaryUrl=sitl.BINARY_URL, binarySha256=sitl.BINARY_HASH, firmwareGitHash=sitl.FIRMWARE_HASH,
        pymavlink=importlib.metadata.version('pymavlink'), python=platform.python_version(), image=args.image,
        baseImage=args.base_image, gazeboImage=args.gazebo_image, sourceSha256=sitl.sha256(__file__),
        sitlSourceSha256=sitl.sha256(sitl.__file__), fleetSourceSha256=sitl.sha256(fleet.__file__),
        recoverySourceSha256=sitl.sha256(recovery.__file__), dockerfileSha256=sitl.sha256(ROOT/'Dockerfile'),
        filesSha256={name:sitl.sha256(ROOT/name) for name in files},
        gazeboFilesSha256={name:sitl.sha256(ROOT.parent/'gazebo'/name) for name in ['Dockerfile','CMakeLists.txt','TruthObserver.cc']},
        paramsSha256=sitl.PARAMS_HASH, gazeboParamsSha256=sitl.sha256('/opt/gazebo-iris.parm'),
        platform='linux-amd64', model='iris', modelArgument='JSON', speedup=1, vehicleCount=3,
        clock='recorder-monotonic-receipt', transport='tcp-loopback', mavlinkVersion=2, physics='shared-Gazebo-world',
        assignment='central-online-nearest-pair-greedy', behaviorTree='reactive-fallback-sequence',
        positionFrame='supplied-ENU-layout-from-shared-world-local-NED', memoryMetric='process-VmRSS-KiB-snapshots',
        pluginGitHash=PLUGIN_REVISION, gazeboVersion=subprocess.check_output(['gz','sim','--versions'],text=True).strip(),
        packages=subprocess.check_output(['dpkg-query','-W','-f=${Package}=${Version}\n','libgz-sim8','libgz-physics7','libgz-transport13','python3-gz-transport13','python3-gz-msgs10'],text=True).strip().splitlines(),
        maxStepSizeMs=1, realTimeFactorTarget=1, lockStep=True, noTimeSync=False, truthClock='gazebo-simulation',
        truthReference='imu-link-ENU-FLU', snapshotSensors='three-world-poses-one-physics-step',
        contactsScope='all-31-colliders-every-observed-physics-step', contactHistoryScope='since-observer-readiness')
    print(json.dumps(dict(schemaVersion=1, kind='argos-ardupilot-shared-world', runtime=runtime, cases=cases), allow_nan=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
