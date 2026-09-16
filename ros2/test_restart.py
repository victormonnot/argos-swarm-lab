"""Acceptance/incarnation/watchdog properties; DDS behavior uses real recordings."""

import json
import math
import unittest

from restart import ObserverState, config_for, decode_heartbeat, position_at

ORIGIN = 1_000_000_000


def envelope(seq=0, epoch=1, generated_ns=ORIGIN, **changes):
    return json.dumps({"kind": "heartbeat", "runId": "run", "agentId": "A1", "epoch": epoch,
                       "seq": seq, "generatedNs": generated_ns, "position": [1, 2, 3], **changes})


class RestartTests(unittest.TestCase):
    def test_watchdog_has_inclusive_boundary_and_does_not_erase_snapshot(self):
        state = ObserverState("run", ORIGIN)
        accepted, _ = state.receive(envelope(), ORIGIN + 10_000_000)
        self.assertEqual(state.advance(ORIGIN + 409_999_999), [])
        transitions = state.advance(ORIGIN + 410_000_000)
        self.assertEqual([item["status"] for item in transitions], ["suspect", "suspect"])
        self.assertIs(state.policies["incarnation"]["last"], accepted)
        self.assertEqual(state.advance(ORIGIN + 800_000_000), [])

    def test_no_first_message_stays_awaiting_without_a_startup_timeout(self):
        state = ObserverState("run", ORIGIN)
        self.assertEqual(state.advance(ORIGIN + 399_999_999), [])
        self.assertEqual(state.advance(ORIGIN + 4_000_000_000), [])
        self.assertIsNone(state.policies["sequence"]["last"])
        _, transitions = state.receive(envelope(generated_ns=ORIGIN + 4_000_000_000), ORIGIN + 4_010_000_000)
        self.assertTrue(all(item["reason"] == "first-message" for item in transitions))

    def test_silence_resumes_same_incarnation_and_sequence_stream(self):
        state = ObserverState("run", ORIGIN)
        state.receive(envelope(seq=14), ORIGIN + 1_400_000_000)
        state.advance(ORIGIN + 2_000_000_000)
        event, transitions = state.receive(envelope(seq=15, generated_ns=ORIGIN + 3_000_000_000), ORIGIN + 3_001_000_000)
        self.assertTrue(all(value["accepted"] for value in event["decisions"].values()))
        self.assertTrue(all(item["reason"] == "accepted-after-suspicion" for item in transitions))

    def test_new_incarnation_resets_sequence_only_for_incarnation_policy(self):
        state = ObserverState("run", ORIGIN)
        first, _ = state.receive(envelope(seq=14), ORIGIN + 1_400_000_000)
        state.advance(ORIGIN + 2_000_000_000)
        event, transitions = state.receive(envelope(seq=0, epoch=2, generated_ns=ORIGIN + 3_000_000_000), ORIGIN + 3_001_000_000)
        self.assertEqual(event["decisions"]["sequence"], {"accepted": False, "reason": "duplicate-or-old-sequence"})
        self.assertEqual(event["decisions"]["incarnation"], {"accepted": True, "reason": "new-epoch"})
        self.assertIs(state.policies["sequence"]["last"], first)
        self.assertEqual([item["policy"] for item in transitions], ["incarnation"])
        later, transitions = state.receive(envelope(seq=15, epoch=2, generated_ns=ORIGIN + 4_500_000_000), ORIGIN + 4_501_000_000)
        self.assertTrue(later["decisions"]["sequence"]["accepted"])
        self.assertEqual([item["policy"] for item in transitions], ["sequence"])

    def test_older_epoch_cannot_roll_back_incarnation_even_with_higher_sequence(self):
        state = ObserverState("run", ORIGIN)
        current, _ = state.receive(envelope(seq=2, epoch=2), ORIGIN + 10_000_000)
        old, _ = state.receive(envelope(seq=99, epoch=1), ORIGIN + 20_000_000)
        self.assertEqual(old["decisions"]["incarnation"], {"accepted": False, "reason": "old-epoch"})
        self.assertTrue(old["decisions"]["sequence"]["accepted"])
        self.assertIs(state.policies["incarnation"]["last"], current)

    def test_rejected_duplicates_do_not_refresh_watchdog(self):
        state = ObserverState("run", ORIGIN)
        state.receive(envelope(seq=4), ORIGIN)
        for seq in (4, 3):
            event, transitions = state.receive(envelope(seq=seq), ORIGIN + 399_000_000)
            self.assertTrue(all(not decision["accepted"] for decision in event["decisions"].values()))
            self.assertEqual(transitions, [])
        self.assertEqual(len(state.advance(ORIGIN + 400_000_000)), 2)

    def test_receipt_age_not_generation_age_drives_watchdog(self):
        state = ObserverState("run", ORIGIN)
        state.receive(envelope(), ORIGIN + 1_000_000_000)
        self.assertEqual(state.advance(ORIGIN + 1_399_000_000), [])
        self.assertEqual(len(state.advance(ORIGIN + 1_400_000_000)), 2)

    def test_malformed_foreign_or_future_envelopes_do_not_mutate_state(self):
        state = ObserverState("run", ORIGIN)
        malformed = ["[]", "null", "{", envelope(runId="foreign"), envelope(agentId="A2"),
                     envelope(epoch=True), envelope(epoch=0), envelope(seq=-1), envelope(seq=True),
                     envelope(generated_ns=True), envelope(position=[0, 1]),
                     envelope(position=[0, 1, math.nan]), envelope(position=[0, 1, True]),
                     envelope(position=[0, 1, 10 ** 1000])]
        for raw in malformed:
            self.assertIsNone(decode_heartbeat(raw, "run"))
        for raw in malformed + [envelope(generated_ns=ORIGIN - 1), envelope(generated_ns=ORIGIN + 1)]:
            self.assertEqual(state.receive(raw, ORIGIN), (None, []))
        self.assertTrue(all(item["last"] is None for item in state.policies.values()))

    def test_case_timing_and_reference_do_not_depend_on_incarnation(self):
        self.assertIsNone(config_for("normal")["interruptMs"])
        self.assertEqual(config_for("silence"), config_for("restart"))
        self.assertEqual(config_for("restart")["watchdogPeriodMs"], 20)
        with self.assertRaises(ValueError):
            config_for("network-partition")
        self.assertEqual(position_at(0), [3, 0, 1.5])
        self.assertNotEqual(position_at(1500), position_at(3000))


if __name__ == "__main__":
    unittest.main()
