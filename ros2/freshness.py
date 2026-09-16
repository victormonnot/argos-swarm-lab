#!/usr/bin/env python3
"""Record real ROS 2 history-depth behavior under a controlled executor pause.

One synthetic telemetry publisher and three reader processes share the host's
monotonic clock. No DDS receive timestamp, radio model or flight dynamics is
inferred. The collector controls start time and records application observations.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

READERS = [
    {"id": "history20", "label": "Keep last 20", "depth": 20, "ageLimitMs": None},
    {"id": "latest1", "label": "Keep last 1", "depth": 1, "ageLimitMs": None},
    {"id": "gated20", "label": "Keep last 20 + age gate", "depth": 20, "ageLimitMs": 150},
]
WORKERS = ["publisher", *[reader["id"] for reader in READERS]]
BASE_CONFIG = {"publishPeriodMs": 50, "publishDurationMs": 4000,
               "readerPeriodMs": 50, "readerPhaseMs": 25,
               "drainDurationMs": 1200, "ageLimitMs": 150}


def config_for(case_id):
    if case_id not in ("normal", "pause"):
        raise ValueError("Unknown recording case")
    return {**BASE_CONFIG, "pauseStartMs": 800 if case_id == "pause" else None,
            "pauseEndMs": 1800 if case_id == "pause" else None}


def position_at(time_ms):
    """Publisher/evaluator trajectory only; readers never call this function."""
    seconds = time_ms / 1000
    return [3 * math.cos(seconds), 2 * math.sin(seconds), 1.5 + 0.4 * math.sin(2 * seconds)]


def finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def decode_telemetry(raw, run_id):
    try:
        message = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(message, dict) or message.get("kind") != "telemetry" or message.get("runId") != run_id:
        return None
    if type(message.get("seq")) is not int or not 0 <= message["seq"] < 10000:
        return None
    if type(message.get("generatedNs")) is not int or not 0 <= message["generatedNs"] < 10 ** 20:
        return None
    position = message.get("position")
    if not isinstance(position, list) or len(position) != 3 or not all(finite_number(x) for x in position):
        return None
    return message


class ReaderState:
    """Uses only received telemetry and a local clock; never evaluator truth."""

    def __init__(self, run_id, origin_ns, age_limit_ms=None):
        self.run_id = run_id
        self.origin_ns = origin_ns
        self.age_limit_ms = age_limit_ms
        self.last_seq = -1
        self.last_accepted = None

    def receive(self, raw, callback_ns):
        data = decode_telemetry(raw, self.run_id)
        if (data is None or type(callback_ns) is not int
                or not self.origin_ns <= data["generatedNs"] <= callback_ns
                or data["seq"] <= self.last_seq):
            return None
        self.last_seq = data["seq"]
        age_ms = (callback_ns - data["generatedNs"]) / 1_000_000
        accepted = self.age_limit_ms is None or age_ms <= self.age_limit_ms
        event = {"runId": data["runId"], "seq": data["seq"],
                 "generatedMs": (data["generatedNs"] - self.origin_ns) / 1_000_000,
                 "callbackMs": (callback_ns - self.origin_ns) / 1_000_000,
                 "ageMs": age_ms, "position": data["position"][:],
                 "accepted": accepted, "reason": "accepted" if accepted else "stale"}
        if accepted:
            self.last_accepted = event
        return event


def ros_imports():
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, HistoryPolicy
    from std_msgs.msg import String

    def qos(depth):
        return QoSProfile(depth=depth, reliability=ReliabilityPolicy.RELIABLE,
                          durability=DurabilityPolicy.VOLATILE, history=HistoryPolicy.KEEP_LAST)

    return rclpy, Node, String, qos


def execute_worker(args):
    rclpy, Node, String, qos = ros_imports()
    from rclpy.executors import SingleThreadedExecutor
    from rclpy.signals import SignalHandlerOptions
    rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
    stopped = False

    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    config = config_for(args.case)
    node_name = "telemetry_publisher" if args.worker == "publisher" else f"reader_{args.worker}"
    node = Node(node_name, enable_rosout=False, start_parameter_services=False)
    executor = SingleThreadedExecutor()
    executor.add_node(node)
    prefix = f"/argos_qos_{args.run_id}"
    reports = node.create_publisher(String, f"{prefix}/reports", qos(256))
    origin_ns = None
    state = None
    callback_count = 0
    reader = next((item for item in READERS if item["id"] == args.worker), None)

    def report(kind, **fields):
        reports.publish(String(data=json.dumps(
            {"kind": kind, "worker": args.worker, "runId": args.run_id, **fields}, allow_nan=False)))

    def receive(message):
        nonlocal callback_count
        callback_count += 1
        if state is None:
            return
        event = state.receive(message.data, time.monotonic_ns())
        if event is not None:
            report("callback", **event)

    if args.worker == "publisher":
        telemetry = node.create_publisher(String, f"{prefix}/telemetry", qos(20))
    else:
        telemetry = node.create_subscription(String, f"{prefix}/telemetry", receive, qos(reader["depth"]))

    def start(message):
        nonlocal origin_ns, state
        try:
            data = json.loads(message.data)
        except (TypeError, ValueError):
            return
        if (not isinstance(data, dict) or data.get("kind") != "start"
                or data.get("runId") != args.run_id or origin_ns is not None
                or type(data.get("originNs")) is not int
                or data["originNs"] <= time.monotonic_ns()):
            return
        origin_ns = data["originNs"]
        if reader:
            state = ReaderState(args.run_id, origin_ns, reader["ageLimitMs"])
        report("armed")

    control = node.create_subscription(String, f"{prefix}/control", start, qos(256))
    ready_sent = False

    def ready():
        nonlocal ready_sent
        data_ready = (telemetry.get_subscription_count() == 3 if reader is None
                      else node.count_publishers(telemetry.topic_name) == 1)
        if (not ready_sent and data_ready and reports.get_subscription_count() == 1
                and node.count_publishers(control.topic_name) == 1):
            report("ready", pid=os.getpid(), node=node_name)
            ready_sent = True

    readiness = node.create_timer(0.05, ready)

    def sleep_until(target_ns):
        while not stopped:
            remaining = (target_ns - time.monotonic_ns()) / 1_000_000_000
            if remaining <= 0:
                return
            time.sleep(min(remaining, 0.05))

    try:
        while not stopped and origin_ns is None:
            executor.spin_once(timeout_sec=0.05)
        if stopped:
            return
        node.destroy_timer(readiness)
        readiness = None
        node.destroy_subscription(control)
        # The reader now has only one executable entity: its telemetry callback.
        end_ns = origin_ns + int((config["publishDurationMs"] + config["drainDurationMs"]) * 1_000_000)
        if reader is None:
            count = config["publishDurationMs"] // config["publishPeriodMs"]
            for seq in range(count):
                scheduled_ns = origin_ns + seq * config["publishPeriodMs"] * 1_000_000
                sleep_until(scheduled_ns)
                if stopped:
                    return
                generated_ns = time.monotonic_ns()
                # Fail instead of silently creating a synthetic catch-up burst.
                if generated_ns - scheduled_ns >= config["publishPeriodMs"] * 1_000_000:
                    raise RuntimeError("Publisher missed an entire scheduled period; retry recording on an idle host")
                generated_ms = (generated_ns - origin_ns) / 1_000_000
                envelope = {"kind": "telemetry", "runId": args.run_id, "seq": seq,
                            "generatedNs": generated_ns, "position": position_at(generated_ms)}
                telemetry.publish(String(data=json.dumps(envelope, allow_nan=False)))
                report("publication", seq=seq, generatedMs=generated_ms, position=envelope["position"])
            sleep_until(end_ns)
        else:
            tick_ns = origin_ns + config["readerPhaseMs"] * 1_000_000
            period_ns = config["readerPeriodMs"] * 1_000_000
            pause_start_ns = (origin_ns + config["pauseStartMs"] * 1_000_000
                              if config["pauseStartMs"] is not None else None)
            pause_end_ns = (origin_ns + config["pauseEndMs"] * 1_000_000
                            if config["pauseEndMs"] is not None else None)
            paused_once = False
            while not stopped and tick_ns < end_ns:
                if pause_start_ns is not None and not paused_once and tick_ns >= pause_start_ns:
                    sleep_until(pause_start_ns)
                    if stopped:
                        return
                    report("pause-start", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000)
                    # No executor calls here. DDS threads are still running.
                    sleep_until(pause_end_ns)
                    if stopped:
                        return
                    report("pause-end", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000)
                    paused_once = True
                    while tick_ns < pause_end_ns:
                        tick_ns += period_ns
                sleep_until(tick_ns)
                if stopped:
                    return
                previous_count = callback_count
                # spin_once can finish a previous wait-set generator without
                # executing a callback. Allow bounded nonblocking housekeeping,
                # but stop as soon as one actual telemetry callback has run.
                for _ in range(8):
                    executor.spin_once(timeout_sec=0)
                    if callback_count != previous_count:
                        break
                tick_ns += period_ns
                now_ns = time.monotonic_ns()
                # Do not repay missed callback opportunities with a drain burst.
                while tick_ns < now_ns:
                    tick_ns += period_ns
            sleep_until(end_ns)
        if not stopped:
            report("done", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000)
            # Preserve DDS endpoints until the collector has every final report.
            while not stopped:
                time.sleep(0.05)
    finally:
        if readiness is not None:
            node.destroy_timer(readiness)
        executor.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()


def execute_case(case_id):
    rclpy, Node, String, qos = ros_imports()
    config = config_for(case_id)
    run_id = uuid.uuid4().hex
    prefix = f"/argos_qos_{run_id}"
    node = Node("freshness_collector", enable_rosout=False, start_parameter_services=False)
    control = node.create_publisher(String, f"{prefix}/control", qos(256))
    ready = {}
    armed = set()
    done = {}
    publications = []
    callbacks = {item["id"]: [] for item in READERS}
    pauses = {item["id"]: [] for item in READERS}

    def collect(message):
        try:
            data = json.loads(message.data)
        except (TypeError, ValueError):
            return
        if not isinstance(data, dict) or data.get("runId") != run_id or data.get("worker") not in WORKERS:
            return
        worker = data["worker"]
        kind = data.get("kind")
        if kind == "ready":
            expected_node = "telemetry_publisher" if worker == "publisher" else f"reader_{worker}"
            if type(data.get("pid")) is int and data["pid"] > 0 and data.get("node") == expected_node:
                ready[worker] = {"node": data["node"], "pid": data["pid"]}
        elif kind == "armed":
            armed.add(worker)
        elif kind == "publication" and worker == "publisher":
            publications.append({key: data[key] for key in ("runId", "seq", "generatedMs", "position")})
        elif kind == "callback" and worker in callbacks:
            callbacks[worker].append({key: data[key] for key in
                                     ("runId", "seq", "generatedMs", "callbackMs", "ageMs", "position", "accepted", "reason")})
        elif kind == "pause-start" and worker in pauses:
            pauses[worker].append({"startMs": data["timeMs"], "endMs": None})
        elif kind == "pause-end" and worker in pauses and pauses[worker]:
            pauses[worker][-1]["endMs"] = data["timeMs"]
        elif kind == "done":
            done[worker] = data["timeMs"]

    report_subscription = node.create_subscription(String, f"{prefix}/reports", collect, qos(256))
    processes = []

    def wait_until(predicate, seconds):
        deadline = time.monotonic() + seconds
        while not predicate() and time.monotonic() < deadline:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError("A ROS worker exited before recording completion")
            rclpy.spin_once(node, timeout_sec=0.01)
        return predicate()

    try:
        for worker in WORKERS:
            processes.append(subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "--worker", worker,
                 "--case", case_id, "--run-id", run_id], stdout=subprocess.DEVNULL))
        if not wait_until(lambda: len(ready) == 4 and control.get_subscription_count() == 4
                          and node.count_publishers(report_subscription.topic_name) == 4, 20):
            raise RuntimeError("ROS graph did not become ready within 20 seconds")
        if len({entry["pid"] for entry in ready.values()} | {os.getpid()}) != 5:
            raise RuntimeError("Expected four distinct workers and one collector process")
        origin_ns = time.monotonic_ns() + 500_000_000
        control.publish(String(data=json.dumps({"kind": "start", "runId": run_id, "originNs": origin_ns})))
        if not wait_until(lambda: len(armed) == 4, 0.45):
            raise RuntimeError("Not every worker acknowledged the scheduled start")
        if not wait_until(lambda: len(done) == 4, 10):
            raise RuntimeError("ROS workers did not complete the bounded observation window")
        return {"id": case_id, "label": "Normal callbacks" if case_id == "normal" else "Reader executors paused for 1 s",
                "runId": run_id, "config": config, "publisher": ready["publisher"],
                "collector": {"node": node.get_name(), "pid": os.getpid()},
                "readers": [{**reader, **ready[reader["id"]], "pauses": pauses[reader["id"]],
                             "callbacks": callbacks[reader["id"]]} for reader in READERS],
                "publications": publications, "endMs": max(done.values()),
                "outcome": {"status": "completed"}}
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        node.destroy_node()


def execute_collection(args):
    rclpy, _, _, _ = ros_imports()
    rclpy.init(args=[])
    try:
        cases = [execute_case(case_id) for case_id in ("normal", "pause")]
        from rclpy.utilities import get_rmw_implementation_identifier
        names = [f"ros-{os.environ['ROS_DISTRO']}-{name}"
                 for name in ("rclpy", "rmw-fastrtps-cpp", "fastrtps", "std-msgs")]
        lines = subprocess.check_output(["dpkg-query", "-W", "-f", "${Package} ${Version}\n", *names], text=True)
        runtime = {"rosDistro": os.environ.get("ROS_DISTRO", "unknown"),
                   "rmw": get_rmw_implementation_identifier(), "python": sys.version.split()[0],
                   "image": args.image, "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   "recordedAt": datetime.now(timezone.utc).isoformat(), "wireType": "std_msgs/msg/String",
                   "domainId": os.environ.get("ROS_DOMAIN_ID"), "clock": "shared-host-monotonic",
                   "publisherQos": {"reliability": "reliable", "durability": "volatile", "history": "keep_last", "depth": 20},
                   "packages": dict(line.split(" ", 1) for line in lines.strip().splitlines())}
        json.dump({"schemaVersion": 1, "kind": "argos-ros2-qos", "runtime": runtime, "cases": cases},
                  sys.stdout, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
    finally:
        rclpy.try_shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", choices=WORKERS)
    parser.add_argument("--run-id")
    parser.add_argument("--case", choices=("normal", "pause"), default="normal")
    parser.add_argument("--image", default="native ROS installation")
    arguments = parser.parse_args()
    if arguments.worker:
        if not arguments.run_id:
            parser.error("--worker requires --run-id")
        execute_worker(arguments)
    else:
        execute_collection(arguments)
