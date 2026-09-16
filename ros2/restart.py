#!/usr/bin/env python3
"""Record actual ROS 2 heartbeat silence, process death and new incarnations.

A persistent observer applies two acceptance policies to the same callback. The
harness owns only its spawned workers and assigns ordered incarnation numbers.
Neither observer policy receives process events, PIDs or evaluator positions.
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

POLICIES = ("sequence", "incarnation")
BASE_CONFIG = {"heartbeatPeriodMs": 100, "timeoutMs": 400, "watchdogPeriodMs": 20,
               "durationMs": 8000, "restartGuardMs": 1000}


def config_for(case_id):
    if case_id not in ("normal", "silence", "restart"):
        raise ValueError("Unknown recording case")
    return {**BASE_CONFIG, "interruptMs": None if case_id == "normal" else 1500,
            "resumeMs": None if case_id == "normal" else 3000}


def position_at(time_ms):
    """Synthetic publisher/evaluator reference; never called by the observer."""
    seconds = time_ms / 1000
    return [3 * math.cos(seconds), 2 * math.sin(seconds), 1.5 + 0.4 * math.sin(2 * seconds)]


def finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def decode_heartbeat(raw, run_id):
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if (not isinstance(data, dict) or data.get("kind") != "heartbeat"
            or data.get("runId") != run_id or data.get("agentId") != "A1"):
        return None
    for key, minimum, maximum in (("epoch", 1, 10000), ("seq", 0, 10000),
                                  ("generatedNs", 0, 10 ** 20)):
        if type(data.get(key)) is not int or not minimum <= data[key] < maximum:
            return None
    position = data.get("position")
    if not isinstance(position, list) or len(position) != 3 or not all(finite_number(x) for x in position):
        return None
    return data


class ObserverState:
    """Acceptance and watchdog state derived only from received data/local time."""

    def __init__(self, run_id, origin_ns, timeout_ms=400):
        self.run_id = run_id
        self.origin_ns = origin_ns
        self.timeout_ns = int(timeout_ms * 1_000_000)
        self.policies = {name: {"last": None, "receiptNs": None, "status": "awaiting"}
                         for name in POLICIES}

    def receive(self, raw, callback_ns):
        data = decode_heartbeat(raw, self.run_id)
        if (data is None or type(callback_ns) is not int
                or not self.origin_ns <= data["generatedNs"] <= callback_ns):
            return None, []
        event = {key: data[key] for key in ("runId", "agentId", "epoch", "seq")}
        event.update({"generatedMs": (data["generatedNs"] - self.origin_ns) / 1_000_000,
                      "callbackMs": (callback_ns - self.origin_ns) / 1_000_000,
                      "position": data["position"][:], "decisions": {}})
        transitions = []
        for name, state in self.policies.items():
            last = state["last"]
            if last is None:
                accepted, reason = True, "first-message"
            elif name == "incarnation" and data["epoch"] < last["epoch"]:
                accepted, reason = False, "old-epoch"
            elif name == "incarnation" and data["epoch"] > last["epoch"]:
                accepted, reason = True, "new-epoch"
            elif data["seq"] > last["seq"]:
                accepted, reason = True, "new-sequence"
            else:
                accepted, reason = False, "duplicate-or-old-sequence"
            event["decisions"][name] = {"accepted": accepted, "reason": reason}
            if accepted:
                if state["status"] != "live":
                    transitions.append({"policy": name, "timeMs": event["callbackMs"], "status": "live",
                                        "reason": "first-message" if state["status"] == "awaiting"
                                        else "accepted-after-suspicion"})
                state.update({"last": event, "receiptNs": callback_ns, "status": "live"})
        return event, transitions

    def advance(self, now_ns):
        transitions = []
        for name, state in self.policies.items():
            reference_ns = state["receiptNs"]
            if reference_ns is not None and state["status"] != "suspect" and now_ns - reference_ns >= self.timeout_ns:
                state["status"] = "suspect"
                transitions.append({"policy": name, "timeMs": (now_ns - self.origin_ns) / 1_000_000,
                                    "status": "suspect", "reason": "timeout"})
        return transitions


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
    observer = args.worker == "observer"
    worker_id = "observer" if observer else f"agent-{args.epoch}"
    node_name = "heartbeat_observer" if observer else "heartbeat_agent"
    config = config_for(args.case)
    node = Node(node_name, enable_rosout=False, start_parameter_services=False)
    executor = SingleThreadedExecutor()
    executor.add_node(node)
    prefix = f"/argos_restart_{args.run_id}"
    reports = node.create_publisher(String, f"{prefix}/reports", qos(256))
    origin_ns = None
    first_ns = None
    state = None
    ready_ns = None
    watchdog = None

    def report(kind, **fields):
        reports.publish(String(data=json.dumps({"kind": kind, "worker": worker_id,
                                               "runId": args.run_id, **fields}, allow_nan=False)))

    def receive(message):
        if state is None:
            return
        now_ns = time.monotonic_ns()
        if now_ns >= origin_ns + config["durationMs"] * 1_000_000:
            return
        event, transitions = state.receive(message.data, now_ns)
        if event is not None:
            report("callback", **event)
            for transition in transitions:
                report("transition", **transition)

    heartbeat = (node.create_subscription(String, f"{prefix}/heartbeat", receive, qos(20))
                 if observer else node.create_publisher(String, f"{prefix}/heartbeat", qos(20)))

    def start(message):
        nonlocal origin_ns, first_ns, state
        try:
            data = json.loads(message.data)
        except (TypeError, ValueError):
            return
        if (not isinstance(data, dict) or data.get("kind") != "start"
                or data.get("runId") != args.run_id or data.get("target") != worker_id
                or origin_ns is not None or type(data.get("originNs")) is not int
                or type(data.get("firstNs")) is not int or data["firstNs"] <= time.monotonic_ns()
                or data["originNs"] > data["firstNs"]):
            return
        origin_ns, first_ns = data["originNs"], data["firstNs"]
        if observer:
            state = ObserverState(args.run_id, origin_ns, config["timeoutMs"])
        report("armed")

    control = node.create_subscription(String, f"{prefix}/control", start, qos(256))

    def ready():
        nonlocal ready_ns
        data_ready = (node.count_publishers(heartbeat.topic_name) >= 1 if observer
                      else heartbeat.get_subscription_count() == 1)
        if (data_ready and reports.get_subscription_count() == 1
                and node.count_publishers(control.topic_name) == 1):
            # Announce until armed; endpoint matching is asynchronous.
            if ready_ns is None:
                ready_ns = time.monotonic_ns()
            report("ready", pid=os.getpid(), node=node_name, readyNs=ready_ns)

    readiness = node.create_timer(0.05, ready)

    def sleep_until(target_ns):
        while not stopped:
            remaining = (target_ns - time.monotonic_ns()) / 1_000_000_000
            if remaining <= 0:
                return
            time.sleep(min(remaining, 0.025))

    try:
        while not stopped and origin_ns is None:
            executor.spin_once(timeout_sec=0.025)
        if stopped:
            return
        node.destroy_timer(readiness)
        readiness = None
        node.destroy_subscription(control)
        end_ns = origin_ns + config["durationMs"] * 1_000_000
        sleep_until(first_ns)
        if observer:
            def check_timeout():
                now_ns = time.monotonic_ns()
                if now_ns < end_ns:
                    for transition in state.advance(now_ns):
                        report("transition", **transition)

            watchdog = node.create_timer(config["watchdogPeriodMs"] / 1000, check_timeout)
            while not stopped and time.monotonic_ns() < end_ns:
                executor.spin_once(timeout_sec=0.005)
        else:
            seq = 0
            target_ns = first_ns
            silence_done = False
            while not stopped and target_ns < end_ns:
                if args.case == "silence" and not silence_done and target_ns >= origin_ns + config["interruptMs"] * 1_000_000:
                    sleep_until(origin_ns + config["interruptMs"] * 1_000_000)
                    report("silence-start", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000,
                           epoch=args.epoch, pid=os.getpid())
                    sleep_until(origin_ns + config["resumeMs"] * 1_000_000)
                    if stopped:
                        return
                    report("silence-end", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000,
                           epoch=args.epoch, pid=os.getpid())
                    target_ns = origin_ns + config["resumeMs"] * 1_000_000
                    silence_done = True
                sleep_until(target_ns)
                if stopped:
                    return
                generated_ns = time.monotonic_ns()
                if generated_ns - target_ns >= config["heartbeatPeriodMs"] * 1_000_000:
                    raise RuntimeError("Heartbeat publisher missed a full period; retry on an idle host")
                generated_ms = (generated_ns - origin_ns) / 1_000_000
                envelope = {"kind": "heartbeat", "runId": args.run_id, "agentId": "A1", "epoch": args.epoch,
                            "seq": seq, "generatedNs": generated_ns, "position": position_at(generated_ms)}
                heartbeat.publish(String(data=json.dumps(envelope, allow_nan=False)))
                report("publication", agentId="A1", epoch=args.epoch, seq=seq,
                       generatedMs=generated_ms, position=envelope["position"])
                seq += 1
                target_ns += config["heartbeatPeriodMs"] * 1_000_000
            sleep_until(end_ns)
        if not stopped:
            report("done", timeMs=(time.monotonic_ns() - origin_ns) / 1_000_000)
            while not stopped:
                time.sleep(0.025)
    finally:
        if watchdog is not None:
            node.destroy_timer(watchdog)
        if readiness is not None:
            node.destroy_timer(readiness)
        executor.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()


def execute_case(case_id):
    rclpy, Node, String, qos = ros_imports()
    config = config_for(case_id)
    run_id = uuid.uuid4().hex
    prefix = f"/argos_restart_{run_id}"
    node = Node("restart_collector", enable_rosout=False, start_parameter_services=False)
    control = node.create_publisher(String, f"{prefix}/control", qos(256))
    ready, done, processes = {}, {}, {}
    armed = set()
    expected_exit = set()
    publications, callbacks, transitions, process_events = [], [], [], []
    origin_ns = None

    def collect(message):
        try:
            data = json.loads(message.data)
        except (TypeError, ValueError):
            return
        if (not isinstance(data, dict) or data.get("runId") != run_id
                or data.get("worker") not in ("observer", "agent-1", "agent-2")):
            return
        worker, kind = data["worker"], data.get("kind")
        if kind == "ready" and worker not in ready:
            ready[worker] = {key: data[key] for key in ("node", "pid", "readyNs")}
            if worker == "agent-2":
                process_events.append({"kind": "ready", "timeMs": (data["readyNs"] - origin_ns) / 1_000_000,
                                       "epoch": 2, "pid": data["pid"]})
        elif kind == "armed":
            armed.add(worker)
        elif kind == "publication" and worker.startswith("agent-"):
            publications.append({key: data[key] for key in ("runId", "agentId", "epoch", "seq", "generatedMs", "position")})
        elif kind == "callback" and worker == "observer":
            callbacks.append({key: data[key] for key in
                              ("runId", "agentId", "epoch", "seq", "generatedMs", "position", "callbackMs", "decisions")})
        elif kind == "transition" and worker == "observer":
            transitions.append({key: data[key] for key in ("policy", "timeMs", "status", "reason")})
        elif kind in ("silence-start", "silence-end") and worker == "agent-1":
            process_events.append({key: data[key] for key in ("kind", "timeMs", "epoch", "pid")})
        elif kind == "done":
            done[worker] = data["timeMs"]

    node.create_subscription(String, f"{prefix}/reports", collect, qos(256))

    def spawn_worker(worker, epoch=1):
        key = "observer" if worker == "observer" else f"agent-{epoch}"
        processes[key] = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", worker,
                                           "--epoch", str(epoch), "--case", case_id, "--run-id", run_id],
                                          stdout=subprocess.DEVNULL)
        return processes[key]

    def wait_until(predicate, seconds):
        deadline = time.monotonic() + seconds
        while not predicate() and time.monotonic() < deadline:
            for key, process in processes.items():
                if key not in expected_exit and process.poll() is not None:
                    raise RuntimeError(f"ROS worker {key} exited unexpectedly")
            rclpy.spin_once(node, timeout_sec=0.005)
        return predicate()

    def arm(worker, first_ns):
        control.publish(String(data=json.dumps({"kind": "start", "runId": run_id, "target": worker,
                                                "originNs": origin_ns, "firstNs": first_ns})))

    try:
        spawn_worker("observer")
        spawn_worker("agent")
        if not wait_until(lambda: len(ready) == 2 and control.get_subscription_count() == 2, 20):
            raise RuntimeError("Initial ROS graph did not become ready within 20 seconds")
        if len({ready[key]["pid"] for key in ready} | {os.getpid()}) != 3:
            raise RuntimeError("Expected distinct collector, observer and agent processes")
        origin_ns = time.monotonic_ns() + 500_000_000
        arm("observer", origin_ns)
        arm("agent-1", origin_ns)
        if not wait_until(lambda: len(armed) == 2, 0.45):
            raise RuntimeError("Workers did not acknowledge the future origin")
        if case_id == "restart":
            wait_until(lambda: time.monotonic_ns() >= origin_ns + config["interruptMs"] * 1_000_000, 3)
            old = processes["agent-1"]
            expected_exit.add("agent-1")
            process_events.append({"kind": "kill-requested", "timeMs": (time.monotonic_ns() - origin_ns) / 1_000_000,
                                   "epoch": 1, "pid": old.pid})
            old.kill()
            if not wait_until(lambda: old.poll() is not None, 1):
                raise RuntimeError("Owned heartbeat process did not exit after SIGKILL")
            process_events.append({"kind": "exited", "timeMs": (time.monotonic_ns() - origin_ns) / 1_000_000,
                                   "epoch": 1, "pid": old.pid, "exitCode": old.returncode})
            if old.returncode != -signal.SIGKILL:
                raise RuntimeError("Expected SIGKILL exit status for the interrupted agent")
            wait_until(lambda: time.monotonic_ns() >= origin_ns + config["resumeMs"] * 1_000_000, 3)
            new = spawn_worker("agent", 2)
            process_events.append({"kind": "spawned", "timeMs": (time.monotonic_ns() - origin_ns) / 1_000_000,
                                   "epoch": 2, "pid": new.pid})
            if not wait_until(lambda: "agent-2" in ready and control.get_subscription_count() == 1, 2.5):
                raise RuntimeError(f"Restart discovery exceeded 2.5 s (ready={list(ready)}, control readers={control.get_subscription_count()})")
            if ready["agent-2"]["pid"] != new.pid or new.pid in (old.pid, ready["observer"]["pid"], os.getpid()):
                raise RuntimeError("Restart did not establish a distinct owned process")
            period_ns = config["heartbeatPeriodMs"] * 1_000_000
            first_ns = origin_ns + ((time.monotonic_ns() - origin_ns
                                      + config["restartGuardMs"] * 1_000_000) // period_ns + 1) * period_ns
            if first_ns >= origin_ns + config["durationMs"] * 1_000_000:
                raise RuntimeError("Restart discovery left no publication window; retry on an idle host")
            # Resend the same future-start command until its acknowledgement.
            # Duplicate commands cannot reset an already armed worker.
            acknowledgement_deadline = first_ns - 10_000_000
            while "agent-2" not in armed and time.monotonic_ns() < acknowledgement_deadline:
                arm("agent-2", first_ns)
                wait_until(lambda: "agent-2" in armed, min(0.05,
                           (acknowledgement_deadline - time.monotonic_ns()) / 1_000_000_000))
            if "agent-2" not in armed:
                raise RuntimeError("Restarted process did not acknowledge its first publication slot")
        final_agent = "agent-2" if case_id == "restart" else "agent-1"
        if not wait_until(lambda: "observer" in done and final_agent in done, 9):
            raise RuntimeError("Workers did not finish the eight-second observation")
        # Reports from different DDS writers can arrive in different orders.
        # Keep endpoints alive briefly to collect already-published final reports.
        wait_until(lambda: False, 0.15)
        return {"id": case_id, "label": {"normal": "Continuous heartbeat", "silence": "Same process, silent publisher",
                                          "restart": "Killed process, new incarnation"}[case_id],
                "runId": run_id, "config": config,
                "observer": {key: ready["observer"][key] for key in ("node", "pid")},
                "collector": {"node": node.get_name(), "pid": os.getpid()},
                "agents": [{"epoch": epoch, **{key: ready[f"agent-{epoch}"][key] for key in ("node", "pid")}}
                           for epoch in ([1, 2] if case_id == "restart" else [1])],
                "processEvents": sorted(process_events, key=lambda item: item["timeMs"]),
                "publications": sorted(publications, key=lambda item: item["generatedMs"]),
                "callbacks": callbacks, "transitions": transitions,
                "endMs": max(done.values()), "outcome": {"status": "completed"}}
    finally:
        for process in processes.values():
            if process.poll() is None:
                process.terminate()
        for process in processes.values():
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        node.destroy_node()


def execute_collection(args):
    rclpy, _, _, _ = ros_imports()
    from rclpy.signals import SignalHandlerOptions
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, interrupt)
    signal.signal(signal.SIGTERM, interrupt)
    try:
        cases = []
        # Each independent case owns a fresh DDS participant/ROS context.
        for case_id in ("normal", "silence", "restart"):
            rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
            try:
                cases.append(execute_case(case_id))
            finally:
                rclpy.try_shutdown()
        from rclpy.utilities import get_rmw_implementation_identifier
        names = [f"ros-{os.environ['ROS_DISTRO']}-{name}"
                 for name in ("rclpy", "rmw-fastrtps-cpp", "fastrtps", "std-msgs")]
        lines = subprocess.check_output(["dpkg-query", "-W", "-f", "${Package} ${Version}\n", *names], text=True)
        runtime = {"rosDistro": os.environ.get("ROS_DISTRO", "unknown"), "rmw": get_rmw_implementation_identifier(),
                   "python": sys.version.split()[0], "image": args.image,
                   "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   "recordedAt": datetime.now(timezone.utc).isoformat(), "wireType": "std_msgs/msg/String",
                   "domainId": os.environ.get("ROS_DOMAIN_ID"), "clock": "shared-host-monotonic",
                   "heartbeatQos": {"reliability": "reliable", "durability": "volatile", "history": "keep_last", "depth": 20},
                   "packages": dict(line.split(" ", 1) for line in lines.strip().splitlines())}
        json.dump({"schemaVersion": 1, "kind": "argos-ros2-restart", "runtime": runtime, "cases": cases},
                  sys.stdout, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
    finally:
        rclpy.try_shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", choices=("observer", "agent"))
    parser.add_argument("--epoch", type=int, choices=(1, 2), default=1)
    parser.add_argument("--run-id")
    parser.add_argument("--case", choices=("normal", "silence", "restart"), default="normal")
    parser.add_argument("--image", default="native ROS installation")
    arguments = parser.parse_args()
    if arguments.worker:
        if not arguments.run_id:
            parser.error("--worker requires --run-id")
        execute_worker(arguments)
    else:
        execute_collection(arguments)
