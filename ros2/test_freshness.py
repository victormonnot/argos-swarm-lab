"""Application timestamp/gate checks; actual DDS history is tested by recordings."""

import json
import math
import unittest

from freshness import ReaderState, config_for, decode_telemetry, position_at


def envelope(seq=0, generated_ns=1_000_000_000, **changes):
    return json.dumps({"kind": "telemetry", "runId": "run", "seq": seq,
                       "generatedNs": generated_ns, "position": [1, 2, 3], **changes})


class FreshnessTests(unittest.TestCase):
    def test_gate_accepts_boundary_and_rejects_older_without_replacing_state(self):
        state = ReaderState("run", 1_000_000_000, 150)
        accepted = state.receive(envelope(), 1_150_000_000)
        self.assertTrue(accepted["accepted"])
        self.assertEqual(accepted["ageMs"], 150)
        rejected = state.receive(envelope(seq=1), 1_150_000_001)
        self.assertFalse(rejected["accepted"])
        self.assertEqual(rejected["reason"], "stale")
        self.assertIs(state.last_accepted, accepted)

    def test_unrestricted_reader_accepts_stale_observation(self):
        state = ReaderState("run", 1_000_000_000)
        event = state.receive(envelope(), 2_000_000_000)
        self.assertTrue(event["accepted"])
        self.assertEqual(event["ageMs"], 1000)
        self.assertEqual(event["generatedMs"], 0)
        self.assertEqual(event["callbackMs"], 1000)
        self.assertEqual(event["position"], [1, 2, 3])

    def test_foreign_invalid_and_future_data_cannot_change_reader(self):
        state = ReaderState("run", 1_000_000_000, 150)
        for raw in [envelope(runId="other"), envelope(generated_ns=999_999_999),
                    envelope(generated_ns=2_000_000_001), envelope(kind="report")]:
            self.assertIsNone(state.receive(raw, 2_000_000_000))
        self.assertEqual(state.last_seq, -1)
        self.assertIsNone(state.last_accepted)

    def test_duplicate_and_decreasing_sequences_do_not_replace_accepted_state(self):
        state = ReaderState("run", 1_000_000_000)
        accepted = state.receive(envelope(seq=4), 1_010_000_000)
        self.assertIsNone(state.receive(envelope(seq=4, position=[99, 99, 99]), 1_020_000_000))
        self.assertIsNone(state.receive(envelope(seq=3), 1_020_000_000))
        self.assertIs(state.last_accepted, accepted)
        # Sequence gaps are allowed and remain observable, not filled synthetically.
        self.assertEqual(state.receive(envelope(seq=8), 1_030_000_000)["seq"], 8)

    def test_malformed_envelopes_are_rejected(self):
        for raw in ["[]", "null", "{", '"text"', envelope(seq=True), envelope(seq=-1),
                    envelope(seq=10000), envelope(generated_ns=True), envelope(generated_ns=10 ** 30),
                    envelope(position=[0, 1]), envelope(position=[0, 1, float("nan")]),
                    envelope(position=[0, 1, True]), envelope(position=[0, 1, 10 ** 1000])]:
            self.assertIsNone(decode_telemetry(raw, "run"))

    def test_reader_age_uses_observed_timestamp_not_sequence_schedule(self):
        state = ReaderState("run", 1_000_000_000)
        event = state.receive(envelope(seq=9, generated_ns=1_017_500_000), 1_031_750_000)
        self.assertEqual(event["generatedMs"], 17.5)
        self.assertEqual(event["callbackMs"], 31.75)
        self.assertEqual(event["ageMs"], 14.25)

    def test_pose_has_actual_altitude_and_continues_after_publications_end(self):
        self.assertEqual(position_at(0), [3, 0, 1.5])
        self.assertAlmostEqual(position_at(1000)[2], 1.5 + 0.4 * math.sin(2))
        self.assertNotEqual(position_at(4000), position_at(5200))
        self.assertEqual(len(position_at(5200)), 3)

    def test_cases_change_only_pause_schedule(self):
        normal = config_for("normal")
        paused = config_for("pause")
        self.assertIsNone(normal.pop("pauseStartMs"))
        self.assertIsNone(normal.pop("pauseEndMs"))
        self.assertEqual(paused.pop("pauseStartMs"), 800)
        self.assertEqual(paused.pop("pauseEndMs"), 1800)
        self.assertEqual(normal, paused)
        with self.assertRaises(ValueError):
            config_for("radio-loss")


if __name__ == "__main__":
    unittest.main()
