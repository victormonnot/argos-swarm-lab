#!/usr/bin/env python3
"""Run actual ROS 2 peer processes and record their application-level reports.

The collector controls timing, not averaging. Each peer owns one scalar and
subscribes only to its neighbors. Standard String messages carry a validated
JSON envelope to keep this introductory experiment free of a custom build step.
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

INITIAL = [0, 2, 4, 8, 10, 12]
ALPHA = 1 / 12
ROUND_TIMEOUT = 3.0


def finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def neighbors_for(agent, topology):
    if topology == "complete":
        return [other for other in range(6) if other != agent]
    if topology == "chain":
        return [other for other in (agent - 1, agent + 1) if 0 <= other < 6]
    raise ValueError("Unknown topology")


def decode_message(raw, run_id, kind):
    """Discard malformed, foreign-run and mistyped envelopes before use."""
    try:
        message = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(message, dict) or message.get("runId") != run_id:
        return None
    if message.get("kind") != kind:
        return None
    if type(message.get("round")) is not int or message["round"] < 0:
        return None
    if kind == "value":
        if type(message.get("sender")) is not int or not 0 <= message["sender"] < 6:
            return None
        if not finite_number(message.get("value")):
            return None
    return message


class PeerRound:
    """Pure application barrier state; it contains no evaluator mean or peers' truth."""

    def __init__(self, agent, value, neighbors, alpha=ALPHA):
        self.agent = agent
        self.value = value
        self.neighbors = sorted(neighbors)
        self.alpha = alpha
        self.round = 0
        self.started = False
        self.inputs = {}

    def begin(self, round_id):
        if type(round_id) is not int or round_id != self.round or self.started:
            return False
        self.started = True
        return True

    def receive(self, sender, round_id, value):
        if (type(sender) is not int or sender not in self.neighbors
                or type(round_id) is not int or round_id != self.round
                or sender in self.inputs or not finite_number(value)):
            return False
        self.inputs[sender] = value
        return True

    def complete(self):
        if not self.started or len(self.inputs) != len(self.neighbors):
            return None
        inputs = [{"from": peer, "value": self.inputs[peer]} for peer in self.neighbors]
        value = self.value + self.alpha * sum(item["value"] - self.value for item in inputs)
        result = {"agent": self.agent, "value": value, "inputs": inputs}
        self.value = value
        self.round += 1
        self.started = False
        self.inputs = {}
        return result


def ros_imports():
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, HistoryPolicy
    from std_msgs.msg import String

    qos = QoSProfile(depth=256, reliability=ReliabilityPolicy.RELIABLE,
                     durability=DurabilityPolicy.VOLATILE,
                     history=HistoryPolicy.KEEP_LAST)
    return rclpy, Node, String, qos


def execute_agent(args):
    rclpy, Node, String, qos = ros_imports()
    from rclpy.executors import ExternalShutdownException
    from rclpy.signals import SignalHandlerOptions
    # Stop between callbacks. Letting an asynchronous signal shut down the ROS
    # context during wait-set construction can produce spurious cleanup errors.
    rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
    stopped = False

    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    node = Node(f"agent_{args.agent}", enable_rosout=False, start_parameter_services=False)
    prefix = f"/argos_{args.run_id}"
    peers = neighbors_for(args.agent, args.topology)
    state = PeerRound(args.agent, INITIAL[args.agent], peers)
    report_pub = node.create_publisher(String, f"{prefix}/reports", qos)
    value_pub = node.create_publisher(String, f"{prefix}/agent_{args.agent}/value", qos)

    def report(kind, **fields):
        envelope = {"kind": kind, "runId": args.run_id, "agent": args.agent, **fields}
        report_pub.publish(String(data=json.dumps(envelope, allow_nan=False)))

    def update():
        round_id = state.round
        result = state.complete()
        if result is not None:
            report("update", round=round_id, value=result["value"], inputs=result["inputs"])

    def start_callback(message):
        data = decode_message(message.data, args.run_id, "start")
        if data is None or not state.begin(data["round"]):
            return
        if not (args.missing and args.agent == 2 and state.round == 2):
            envelope = {"kind": "value", "runId": args.run_id,
                        "round": state.round, "sender": args.agent, "value": state.value}
            value_pub.publish(String(data=json.dumps(envelope, allow_nan=False)))
            report("published", round=state.round, value=state.value)
        update()

    def value_callback(message, expected_sender):
        data = decode_message(message.data, args.run_id, "value")
        if data is None or data["sender"] != expected_sender:
            return
        if state.receive(data["sender"], data["round"], data["value"]):
            report("received", round=data["round"], **{"from": data["sender"], "value": data["value"]})
            update()

    control_sub = node.create_subscription(String, f"{prefix}/control", start_callback, qos)
    subscriptions = [node.create_subscription(
        String, f"{prefix}/agent_{peer}/value",
        lambda message, sender=peer: value_callback(message, sender), qos) for peer in peers]
    ready_sent = False

    def readiness():
        nonlocal ready_sent
        if ready_sent:
            return
        if (value_pub.get_subscription_count() == len(peers)
                and report_pub.get_subscription_count() == 1
                and node.count_publishers(control_sub.topic_name) == 1
                and all(node.count_publishers(sub.topic_name) == 1 for sub in subscriptions)):
            report("ready", pid=os.getpid(), node=node.get_name(), neighbors=peers)
            ready_sent = True

    timer = node.create_timer(0.05, readiness)
    try:
        while rclpy.ok() and not stopped:
            rclpy.spin_once(node, timeout_sec=0.05)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_timer(timer)
        node.destroy_node()
        rclpy.try_shutdown()


def execute_case(case_id, topology, planned_rounds, label):
    rclpy, Node, String, qos = ros_imports()
    run_id = uuid.uuid4().hex
    prefix = f"/argos_{run_id}"
    node = Node("round_collector", enable_rosout=False, start_parameter_services=False)
    control_pub = node.create_publisher(String, f"{prefix}/control", qos)
    ready = {}
    current = None
    seen = set()

    def collect(message):
        nonlocal current
        try:
            data = json.loads(message.data)
        except (TypeError, ValueError):
            return
        if not isinstance(data, dict) or data.get("runId") != run_id:
            return
        agent = data.get("agent")
        if type(agent) is not int or not 0 <= agent < 6:
            return
        kind = data.get("kind")
        if kind == "ready":
            if (type(data.get("pid")) is int and data["pid"] > 0
                    and data.get("node") == f"agent_{agent}"
                    and data.get("neighbors") == neighbors_for(agent, topology)):
                ready[agent] = {"id": agent, "node": data["node"],
                                "pid": data["pid"], "neighbors": data["neighbors"]}
            return
        if (current is None or type(data.get("round")) is not int
                or data["round"] != current["round"] or not finite_number(data.get("value"))):
            return
        if kind not in ("published", "received", "update"):
            return
        sender = data.get("from") if kind == "received" else None
        if kind == "received" and (type(sender) is not int or sender not in neighbors_for(agent, topology)):
            return
        if kind == "update":
            inputs = data.get("inputs")
            if (not isinstance(inputs, list) or len(inputs) != len(neighbors_for(agent, topology))
                    or any(not isinstance(item, dict) or not finite_number(item.get("value"))
                           or type(item.get("from")) is not int for item in inputs)
                    or [item["from"] for item in inputs] != neighbors_for(agent, topology)):
                return
        key = (kind, agent, sender)
        if key in seen:
            return
        seen.add(key)
        event = {"agent": agent, "value": data["value"], "runId": data["runId"], "round": data["round"]}
        if kind == "received":
            event["from"] = sender
        if kind == "update":
            event["inputs"] = data["inputs"]
        current[{"update": "updates", "received": "received", "published": "published"}[kind]].append(event)

    report_sub = node.create_subscription(String, f"{prefix}/reports", collect, qos)
    processes = []

    def wait_until(predicate, seconds):
        deadline = time.monotonic() + seconds
        while not predicate() and time.monotonic() < deadline:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError("An agent process exited before experiment completion")
            rclpy.spin_once(node, timeout_sec=0.01)
        return predicate()

    try:
        for agent in range(6):
            command = [sys.executable, str(Path(__file__).resolve()), "--agent", str(agent),
                       "--run-id", run_id, "--topology", topology]
            if case_id == "missing":
                command.append("--missing")
            processes.append(subprocess.Popen(command, stdout=subprocess.DEVNULL))
        if not wait_until(lambda: len(ready) == 6 and control_pub.get_subscription_count() == 6
                          and node.count_publishers(report_sub.topic_name) == 6, 20):
            raise RuntimeError("ROS graph did not become ready within 20 seconds")
        if len({entry["pid"] for entry in ready.values()}) != 6:
            raise RuntimeError("Expected six distinct agent processes")
        result = {"id": case_id, "label": label, "runId": run_id, "topology": topology,
                  "initialValues": INITIAL[:], "alpha": ALPHA, "plannedRounds": planned_rounds,
                  "agents": [ready[agent] for agent in range(6)],
                  "collector": {"node": node.get_name(), "pid": os.getpid()},
                  "states": [{"round": 0, "values": INITIAL[:]}], "rounds": []}
        if case_id == "missing":
            result["omittedPublication"] = {"agent": 2, "round": 2}
        for round_id in range(planned_rounds):
            current = {"round": round_id, "published": [], "received": [], "updates": [],
                       "status": "complete", "missing": []}
            seen = set()
            started = time.monotonic()
            control_pub.publish(String(data=json.dumps({"kind": "start", "runId": run_id, "round": round_id})))
            complete = wait_until(lambda: len(current["updates"]) == 6, ROUND_TIMEOUT)
            current["durationMs"] = (time.monotonic() - started) * 1000
            current["published"].sort(key=lambda item: item["agent"])
            current["received"].sort(key=lambda item: (item["agent"], item["from"]))
            current["updates"].sort(key=lambda item: item["agent"])
            if not complete:
                current["status"] = "timeout"
                received = {(item["agent"], item["from"]) for item in current["received"]}
                current["missing"] = [{"agent": agent, "from": peer} for agent in range(6)
                                      for peer in neighbors_for(agent, topology)
                                      if (agent, peer) not in received]
            result["rounds"].append(current)
            if not complete:
                result["outcome"] = {"status": "timeout", "completedRounds": round_id,
                                     "reason": "The 3 s application round deadline expired; no next round was started."}
                break
            result["states"].append({"round": round_id + 1,
                                     "values": [item["value"] for item in current["updates"]]})
        else:
            result["outcome"] = {"status": "completed", "completedRounds": planned_rounds,
                                 "reason": "Every planned round collected six updates; convergence is evaluated separately."}
        return result
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
        cases = [execute_case("complete", "complete", 20, "Complete graph"),
                 execute_case("chain", "chain", 350, "Neighbor chain"),
                 execute_case("missing", "complete", 20, "A3 omits publication at round 2")]
        from rclpy.utilities import get_rmw_implementation_identifier
        package_names = [f"ros-{os.environ['ROS_DISTRO']}-{name}"
                         for name in ("rclpy", "rmw-fastrtps-cpp", "fastrtps", "std-msgs")]
        package_lines = subprocess.check_output(
            ["dpkg-query", "-W", "-f", "${Package} ${Version}\n", *package_names], text=True)
        packages = dict(line.split(" ", 1) for line in package_lines.strip().splitlines())
        data = {"schemaVersion": 1, "kind": "argos-ros2-consensus",
                "runtime": {"rosDistro": os.environ.get("ROS_DISTRO", "unknown"),
                            "rmw": get_rmw_implementation_identifier(),
                            "python": sys.version.split()[0], "image": args.image,
                            "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                            "recordedAt": datetime.now(timezone.utc).isoformat(),
                            "wireType": "std_msgs/msg/String", "domainId": os.environ.get("ROS_DOMAIN_ID"),
                            "qos": {"reliability": "reliable", "durability": "volatile",
                                    "history": "keep_last", "depth": 256},
                            "roundTimeoutSeconds": ROUND_TIMEOUT}, "cases": cases}
        data["runtime"]["packages"] = packages
        json.dump(data, sys.stdout, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
    finally:
        rclpy.try_shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", type=int, choices=range(6))
    parser.add_argument("--run-id")
    parser.add_argument("--topology", choices=("complete", "chain"), default="complete")
    parser.add_argument("--missing", action="store_true")
    parser.add_argument("--image", default="native ROS installation")
    arguments = parser.parse_args()
    if arguments.agent is not None:
        if arguments.run_id is None:
            parser.error("--agent requires --run-id")
        execute_agent(arguments)
    else:
        execute_collection(arguments)
