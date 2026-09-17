"""Application schedule and admission checks; middleware behavior is recorded."""

import json
import math
import unittest

from middleware import CONFIG, decode_sample, position_at, publication_slots

ORIGIN = 1_000_000_000


def envelope(**changes):
    return json.dumps({"kind": "telemetry", "runId": "run", "agentId": "A1", "seq": 0,
                       "generatedNs": ORIGIN, "position": [3, 0, 1.5], **changes})


class MiddlewareTests(unittest.TestCase):
    def test_fixed_schedule_has_quiet_subscription_window_and_finite_tail(self):
        slots = publication_slots()
        self.assertEqual(slots, list(range(0, 1000, 100)) + list(range(4000, 5000, 100)))
        self.assertLess(slots[9], CONFIG["joinMs"])
        self.assertGreater(slots[10], CONFIG["joinMs"])
        self.assertLess(slots[-1], CONFIG["durationMs"])
        self.assertEqual(CONFIG["depth"], 5)

    def test_old_historical_samples_are_not_age_filtered(self):
        received = decode_sample(envelope(), "run", ORIGIN, ORIGIN + 2_100_000_000)
        self.assertEqual(received["generatedMs"], 0)
        self.assertEqual(received["callbackMs"], 2100)
        self.assertEqual(received["seq"], 0)

    def test_duplicates_and_out_of_order_samples_are_preserved(self):
        received = [decode_sample(envelope(seq=seq), "run", ORIGIN, ORIGIN + 2_100_000_000)
                    for seq in (9, 5, 5)]
        self.assertEqual([item["seq"] for item in received], [9, 5, 5])

    def test_foreign_malformed_nonfinite_and_future_messages_are_rejected(self):
        samples = ["[]", "null", "{", envelope(runId="other"), envelope(agentId="A2"),
                   envelope(kind="other"), envelope(seq=-1), envelope(seq=20), envelope(seq=True),
                   envelope(generatedNs=True), envelope(generatedNs=ORIGIN - 1),
                   envelope(generatedNs=ORIGIN + 1), envelope(position=[0, 1]),
                   envelope(position=[0, math.nan, 1]), envelope(position=[True, 0, 1]),
                   envelope(position=[10 ** 1000, 0, 1])]
        for raw in samples:
            self.assertIsNone(decode_sample(raw, "run", ORIGIN, ORIGIN))

    def test_received_snapshot_is_not_replaced_with_evaluator_current_position(self):
        sample = decode_sample(envelope(), "run", ORIGIN, ORIGIN + 2_000_000_000)
        self.assertEqual(sample["position"], position_at(0))
        self.assertNotEqual(sample["position"], position_at(sample["callbackMs"]))

    def test_xyz_reference_changes_altitude_and_is_finite(self):
        self.assertEqual(position_at(0), [3, 0, 1.5])
        self.assertNotEqual(position_at(0)[2], position_at(500)[2])
        self.assertTrue(all(math.isfinite(value) for value in position_at(6000)))


if __name__ == "__main__":
    unittest.main()
