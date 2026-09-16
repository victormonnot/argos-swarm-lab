"""Protocol checks runnable with standard Python; actual ROS runs are separate."""

import json
import unittest

from consensus import ALPHA, INITIAL, PeerRound, decode_message, neighbors_for


class ProtocolTests(unittest.TestCase):
    def test_first_complete_round_matches_known_consensus(self):
        results = []
        for agent, value in enumerate(INITIAL):
            state = PeerRound(agent, value, neighbors_for(agent, "complete"))
            self.assertTrue(state.begin(0))
            for peer in reversed(state.neighbors):
                self.assertTrue(state.receive(peer, 0, INITIAL[peer]))
            results.append(state.complete()["value"])
        self.assertEqual(results, [3, 4, 5, 7, 8, 9])
        self.assertEqual(sum(results), sum(INITIAL))

    def test_no_update_until_start_and_all_neighbors(self):
        state = PeerRound(1, 2, [0, 2])
        state.receive(0, 0, 0)
        state.receive(2, 0, 4)
        self.assertIsNone(state.complete())
        state.begin(0)
        self.assertIsNotNone(state.complete())
        self.assertEqual(state.round, 1)

    def test_missing_input_does_not_fall_back_to_stale_value(self):
        state = PeerRound(1, 2, [0, 2])
        state.begin(0)
        state.receive(0, 0, 0)
        state.receive(2, 0, 4)
        state.complete()
        state.begin(1)
        self.assertFalse(state.receive(2, 0, 4))
        state.receive(0, 1, 1)
        self.assertIsNone(state.complete())
        self.assertEqual(state.round, 1)
        self.assertEqual(state.value, 2)

    def test_duplicate_start_and_value_cannot_apply_twice(self):
        state = PeerRound(0, 0, [1])
        self.assertTrue(state.begin(0))
        self.assertFalse(state.begin(0))
        self.assertTrue(state.receive(1, 0, 2))
        self.assertFalse(state.receive(1, 0, 999))
        self.assertEqual(state.complete()["value"], 2 * ALPHA)
        self.assertIsNone(state.complete())
        self.assertFalse(state.begin(0))
        self.assertFalse(state.receive(1, 0, 2))

    def test_future_round_foreign_neighbor_and_nonfinite_values_rejected(self):
        state = PeerRound(0, 0, [1])
        for sender, round_id, value in [(1, 1, 2), (2, 0, 4), (True, 0, 2),
                                         (1, True, 2), (1, 0, True),
                                         (1, 0, float("inf")), (1, 0, float("nan")),
                                         (1, 0, 10 ** 1000)]:
            self.assertFalse(state.receive(sender, round_id, value))
        self.assertEqual(state.inputs, {})

    def test_envelopes_reject_wrong_run_kind_and_types(self):
        good = {"kind": "value", "runId": "run", "round": 0, "sender": 1, "value": 2}
        self.assertEqual(decode_message(json.dumps(good), "run", "value"), good)
        for change in ({"runId": "old"}, {"kind": "start"}, {"round": "0"},
                       {"round": False}, {"round": -1}, {"sender": 6},
                       {"sender": True}, {"value": None}, {"value": float("nan")}):
            self.assertIsNone(decode_message(json.dumps({**good, **change}), "run", "value"))
        for raw in ("[]", "null", "false", "{", '"text"'):
            self.assertIsNone(decode_message(raw, "run", "value"))

    def test_neighbor_summation_does_not_depend_on_delivery_order(self):
        first = PeerRound(0, 0, [1, 2, 3, 4, 5])
        second = PeerRound(0, 0, [5, 4, 3, 2, 1])
        for state, order in ((first, [1, 2, 3, 4, 5]), (second, [5, 3, 2, 4, 1])):
            state.begin(0)
            for peer in order:
                state.receive(peer, 0, INITIAL[peer])
        self.assertEqual(first.complete(), second.complete())

    def test_chain_protocol_preserves_mean_across_full_rounds(self):
        peers = [PeerRound(agent, value, neighbors_for(agent, "chain"))
                 for agent, value in enumerate(INITIAL)]
        for round_id in range(350):
            values = [peer.value for peer in peers]
            for peer in peers:
                peer.begin(round_id)
                for neighbor in peer.neighbors:
                    peer.receive(neighbor, round_id, values[neighbor])
                self.assertIsNotNone(peer.complete())
            self.assertAlmostEqual(sum(peer.value for peer in peers), 36, places=11)
        self.assertLess(max(peer.value for peer in peers) - min(peer.value for peer in peers), 0.01)


if __name__ == "__main__":
    unittest.main()
