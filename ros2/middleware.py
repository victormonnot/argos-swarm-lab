#!/usr/bin/env python3
"""Record a fixed late-subscription workload through two actual ROS 2 RMWs.

Only the telemetry crosses ROS. The harness controls worker start and collects
JSON records over private stdio pipes. It never republishes historical samples.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import selectors
import signal
import socket
import subprocess
import sys
import time
import uuid

CONFIG = {"periodMs": 100, "depth": 5, "joinMs": 2000, "resumeMs": 4000,
          "publishEndMs": 5000, "durationMs": 6000,
          "reliability": "reliable", "history": "keep_last"}
RMWS = {"fastdds": "rmw_fastrtps_cpp", "zenoh": "rmw_zenoh_cpp"}
DURABILITIES = ("volatile", "transient_local")
INITIAL_GUARD_MS = 1000


def publication_slots():
    return list(range(0, 1000, CONFIG["periodMs"])) + list(
        range(CONFIG["resumeMs"], CONFIG["publishEndMs"], CONFIG["periodMs"]))


def position_at(time_ms):
    seconds = time_ms / 1000
    return [3 * math.cos(seconds), 2 * math.sin(seconds), 1.5 + 0.4 * math.sin(2 * seconds)]


def finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def decode_sample(raw, run_id, origin_ns, callback_ns):
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if (not isinstance(data, dict) or data.get("kind") != "telemetry"
            or data.get("runId") != run_id or data.get("agentId") != "A1"
            or type(data.get("seq")) is not int or not 0 <= data["seq"] < 20
            or type(data.get("generatedNs")) is not int
            or not origin_ns <= data["generatedNs"] <= callback_ns):
        return None
    position = data.get("position")
    if not isinstance(position, list) or len(position) != 3 or not all(finite_number(x) for x in position):
        return None
    return {"runId": run_id, "agentId": "A1", "seq": data["seq"],
            "generatedMs": (data["generatedNs"] - origin_ns) / 1_000_000,
            "position": position[:], "callbackMs": (callback_ns - origin_ns) / 1_000_000}


def report(kind, **fields):
    print(json.dumps({"kind": kind, **fields}, allow_nan=False), flush=True)


def execute_worker(args):
    import rclpy
    from rclpy.executors import SingleThreadedExecutor
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, HistoryPolicy
    from rclpy.signals import SignalHandlerOptions
    from rclpy.utilities import get_rmw_implementation_identifier
    from std_msgs.msg import String

    rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
    stopped = False

    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    node = Node(f"middleware_{args.worker}", enable_rosout=False, start_parameter_services=False)
    executor = SingleThreadedExecutor()
    executor.add_node(node)
    qos = QoSProfile(depth=CONFIG["depth"], reliability=ReliabilityPolicy.RELIABLE,
                     durability=(DurabilityPolicy.VOLATILE if args.durability == "volatile"
                                 else DurabilityPolicy.TRANSIENT_LOCAL), history=HistoryPolicy.KEEP_LAST)
    topic = f"/argos_middleware_{args.run_id}/telemetry"
    endpoint = node.create_publisher(String, topic, qos) if args.worker == "publisher" else None
    if get_rmw_implementation_identifier() != args.rmw:
        raise RuntimeError("The loaded RMW does not match the requested implementation")

    def endpoint_qos():
        # Jazzy rclpy stores requested QoS on the Python endpoint object. Read
        # the RMW's advertised endpoint profile through ROS graph introspection.
        getter = (node.get_publishers_info_by_topic if args.worker == "publisher"
                  else node.get_subscriptions_info_by_topic)
        matches = [info for info in getter(topic) if info.node_name == node.get_name()]
        if len(matches) != 1:
            raise RuntimeError("Expected exactly one own endpoint in the ROS graph")
        actual = matches[0].qos_profile
        if actual.reliability != qos.reliability or actual.durability != qos.durability:
            raise RuntimeError("Graph-reported reliability/durability differs from the requested contract")
        return {"reliability": actual.reliability.name.lower(), "durability": actual.durability.name.lower(),
                "history": actual.history.name.lower(), "depth": actual.depth}

    def sleep_until(target_ns):
        while not stopped:
            remaining = (target_ns - time.monotonic_ns()) / 1_000_000_000
            if remaining <= 0:
                return
            time.sleep(min(remaining, 0.01))

    try:
        report("ready", node=node.get_name(), pid=os.getpid(), rmw=get_rmw_implementation_identifier())
        command = json.loads(sys.stdin.readline())
        origin_ns = command["originNs"]
        if type(origin_ns) is not int or origin_ns <= time.monotonic_ns():
            raise RuntimeError("Worker did not receive a future shared origin")
        report("armed")
        end_ns = origin_ns + CONFIG["durationMs"] * 1_000_000
        if args.worker == "publisher":
            for seq, slot_ms in enumerate(publication_slots()):
                target_ns = origin_ns + slot_ms * 1_000_000
                sleep_until(target_ns)
                if stopped:
                    return
                generated_ns = time.monotonic_ns()
                if generated_ns - target_ns >= CONFIG["periodMs"] * 1_000_000:
                    raise RuntimeError("Publisher missed a complete slot; retry on an idle host")
                generated_ms = (generated_ns - origin_ns) / 1_000_000
                data = {"kind": "telemetry", "runId": args.run_id, "agentId": "A1", "seq": seq,
                        "generatedNs": generated_ns, "position": position_at(generated_ms)}
                endpoint.publish(String(data=json.dumps(data, allow_nan=False)))
                report("publication", runId=args.run_id, agentId="A1", seq=seq,
                       generatedMs=generated_ms, position=data["position"])
            sleep_until(end_ns)
        else:
            sleep_until(origin_ns + CONFIG["joinMs"] * 1_000_000)
            if stopped:
                return
            report("subscription-create-start", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000,
                   pid=os.getpid())

            def receive(message):
                now_ns = time.monotonic_ns()
                if now_ns >= end_ns:
                    return
                sample = decode_sample(message.data, args.run_id, origin_ns, now_ns)
                if sample is not None:
                    report("callback", **sample)

            endpoint = node.create_subscription(String, topic, receive, qos)
            report("subscription-created", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000,
                   pid=os.getpid())
            while not stopped and time.monotonic_ns() < end_ns:
                executor.spin_once(timeout_sec=0.005)
        if not stopped:
            report("done", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000,
                   qos={"reliability": "reliable", "durability": args.durability,
                        "history": "keep_last", "depth": CONFIG["depth"]}, qosSource="requested",
                   graphQos=endpoint_qos(), graphQosSource="ros-graph")
            while not stopped:
                time.sleep(0.01)
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()


def stop_process(process):
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def execute_case(stack, durability):
    rmw = RMWS[stack]
    run_id = uuid.uuid4().hex
    env = {**os.environ, "RMW_IMPLEMENTATION": rmw, "RCUTILS_LOGGING_USE_STDOUT": "0"}
    selector = selectors.DefaultSelector()
    workers, ready, done = {}, {}, {}
    armed = set()
    publications, callbacks, events = [], [], []
    router = None
    buffers = {}

    def accept_report(worker, raw):
        data = json.loads(raw)
        kind = data.pop("kind")
        if kind == "ready":
            ready[worker] = data
        elif kind == "armed":
            armed.add(worker)
        elif kind == "publication" and worker == "publisher":
            publications.append(data)
        elif kind == "callback" and worker == "reader":
            callbacks.append(data)
        elif kind in ("subscription-create-start", "subscription-created") and worker == "reader":
            events.append({"kind": kind, **data})
        elif kind == "done":
            done[worker] = data.pop("timeMs")
            ready[worker].update(data)

    def collect(timeout=0.01):
        for key, _ in selector.select(timeout):
            chunk = os.read(key.fileobj.fileno(), 65536)
            if not chunk:
                raise RuntimeError(f"Worker {key.data} closed its report pipe")
            buffers[key.data] += chunk
            lines = buffers[key.data].split(b"\n")
            buffers[key.data] = lines.pop()
            for line in lines:
                accept_report(key.data, line)
        if any(process.poll() is not None for process in workers.values()):
            raise RuntimeError("A ROS worker exited before collection completed")
        if router is not None and router.poll() is not None:
            raise RuntimeError("The owned Zenoh router exited during collection")

    def await_condition(predicate, seconds):
        deadline = time.monotonic() + seconds
        while not predicate() and time.monotonic() < deadline:
            collect(min(0.01, max(0, deadline - time.monotonic())))
        if not predicate():
            raise RuntimeError("Timed out waiting for owned workers")

    try:
        if stack == "zenoh":
            router = subprocess.Popen(["/opt/ros/jazzy/lib/rmw_zenoh_cpp/rmw_zenohd"],
                                      env=env, stdout=subprocess.DEVNULL)
            deadline = time.monotonic() + 5
            while True:
                if router.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Owned Zenoh router did not start within five seconds")
                try:
                    with socket.create_connection(("127.0.0.1", 7447), timeout=0.05):
                        break
                except OSError:
                    time.sleep(0.01)
        for worker in ("publisher", "reader"):
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", worker,
                                       "--rmw", rmw, "--durability", durability, "--run-id", run_id],
                                       env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0)
            workers[worker] = process
            buffers[worker] = b""
            selector.register(process.stdout, selectors.EVENT_READ, worker)
        await_condition(lambda: len(ready) == 2, 20)
        if (len({item["pid"] for item in ready.values()}) != 2
                or any(ready[worker]["pid"] != process.pid for worker, process in workers.items())):
            raise RuntimeError("Expected two distinct owned ROS processes")
        origin_ns = time.monotonic_ns() + INITIAL_GUARD_MS * 1_000_000
        for process in workers.values():
            process.stdin.write((json.dumps({"originNs": origin_ns}) + "\n").encode())
            process.stdin.flush()
        await_condition(lambda: len(armed) == 2, 0.8)
        await_condition(lambda: len(done) == 2, 8)
        if len(publications) != 20 or len(events) != 2 or events[1]["timeMs"] >= CONFIG["resumeMs"]:
            raise RuntimeError("The fixed publication/subscription schedule did not complete")
        return {"id": f"{stack}-{durability}",
                "label": f"{'Fast DDS' if stack == 'fastdds' else 'Zenoh'} / {durability.replace('_', ' ')}",
                "runId": run_id, "rmw": rmw, "durability": durability, "config": CONFIG.copy(),
                "publisher": ready["publisher"], "reader": ready["reader"],
                "router": None if router is None else {"pid": router.pid, "sessionMode": "peer", "role": "discovery"},
                "processEvents": events, "publications": publications, "callbacks": callbacks,
                "endMs": max(done.values()), "outcome": {"status": "completed"}}
    finally:
        for process in workers.values():
            stop_process(process)
            process.stdin.close()
            process.stdout.close()
        if router is not None:
            stop_process(router)
        selector.close()


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def execute_collection(args):
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, interrupt)
    signal.signal(signal.SIGTERM, interrupt)
    package_names = ["ros-jazzy-rmw-fastrtps-cpp", "ros-jazzy-fastrtps", "ros-jazzy-rmw-zenoh-cpp",
                     "ros-jazzy-zenoh-cpp-vendor", "ros-jazzy-rclpy", "ros-jazzy-std-msgs"]
    package_lines = subprocess.check_output(["dpkg-query", "-W", "-f=${Package}\t${Version}\n",
                                            *package_names], text=True)
    config_dir = Path("/opt/ros/jazzy/share/rmw_zenoh_cpp/config")
    runtime = {"rosDistro": os.environ.get("ROS_DISTRO", "unknown"),
               "python": sys.version.split()[0], "image": args.image, "baseImage": args.base_image,
               "recordedAt": datetime.now(timezone.utc).isoformat(), "sourceSha256": sha256_file(__file__),
               "clock": "shared-host-monotonic", "wireType": "std_msgs/msg/String", "domainId": 45,
               "packages": dict(line.split("\t") for line in package_lines.strip().splitlines()),
               "configFiles": {"zenohSessionSha256": sha256_file(config_dir / "DEFAULT_RMW_ZENOH_SESSION_CONFIG.json5"),
                               "zenohRouterSha256": sha256_file(config_dir / "DEFAULT_RMW_ZENOH_ROUTER_CONFIG.json5")},
               "harness": "stdio-pipes", "initialGuardMs": INITIAL_GUARD_MS}
    cases = []
    for stack in RMWS:
        for durability in DURABILITIES:
            print(f"Recording {stack} / {durability}", file=sys.stderr, flush=True)
            cases.append(execute_case(stack, durability))
    print(json.dumps({"schemaVersion": 1, "kind": "argos-ros2-middleware", "runtime": runtime,
                      "cases": cases}, allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", choices=("publisher", "reader"))
    parser.add_argument("--rmw", choices=tuple(RMWS.values()))
    parser.add_argument("--durability", choices=DURABILITIES)
    parser.add_argument("--run-id")
    parser.add_argument("--image")
    parser.add_argument("--base-image")
    arguments = parser.parse_args()
    try:
        execute_worker(arguments) if arguments.worker else execute_collection(arguments)
    except KeyboardInterrupt:
        sys.exit(130)
