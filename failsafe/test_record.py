"""Heartbeat interruption must affect transmission, never fabricate vehicle feedback."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('failsafe_recorder', Path(__file__).with_name('record.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RecorderChecks(unittest.TestCase):
    def recorder(self):
        record = module.Recorder.__new__(module.Recorder)
        record.origin = 100
        record.last_heartbeat = 100
        record.heartbeat_enabled = True
        record.heartbeat_tx = []
        record.setup_heartbeat_count = 0
        record.last_setup_heartbeat = None
        record.connection = SimpleNamespace(mav=SimpleNamespace(heartbeat_send=Mock()), recv_match=Mock(return_value=None))
        record.process = SimpleNamespace(poll=lambda: None)
        record.latest = {}
        record.telemetry, record.acks, record.events, record.statuses = [], [], [], []
        record.airborne = record.observe_landing = False
        return record

    def test_disabled_heartbeat_does_not_send_or_advance_clock(self):
        record = self.recorder(); record.heartbeat_enabled = False
        record.send_heartbeat(109)
        record.connection.mav.heartbeat_send.assert_not_called()
        self.assertEqual(record.last_heartbeat, 100)
        self.assertEqual(record.heartbeat_tx, [])

    def test_transmission_uses_successful_send_time_and_exact_envelope(self):
        record = self.recorder()
        with patch.object(module.time, 'monotonic', return_value=101.004):
            record.send_heartbeat(101)
        record.connection.mav.heartbeat_send.assert_called_once_with(6, 8, 0, 0, 0, 3)
        self.assertAlmostEqual(record.heartbeat_tx[0]['timeMs'], 1004)
        self.assertEqual(record.heartbeat_tx[0]['sourceSystem'], 255)
        self.assertEqual(record.acks, [])

    def test_one_hz_schedule_does_not_send_early(self):
        record = self.recorder(); record.send_heartbeat(100.999)
        record.connection.mav.heartbeat_send.assert_not_called()

    def test_restoration_sends_immediately_without_catchup_burst(self):
        record = self.recorder(); record.heartbeat_enabled = False
        record.send_heartbeat(105)
        record.heartbeat_enabled = True
        with patch.object(module.time, 'monotonic', return_value=108):
            record.send_heartbeat(108)
            record.send_heartbeat(108)
        self.assertEqual(record.connection.mav.heartbeat_send.call_count, 1)

    def test_send_failure_is_not_recorded_as_transmission(self):
        record = self.recorder(); record.connection.mav.heartbeat_send.side_effect = OSError('closed')
        with self.assertRaises(OSError): record.send_heartbeat(101)
        self.assertEqual(record.heartbeat_tx, [])
        self.assertEqual(record.last_heartbeat, 100)

    def test_suppression_keeps_incoming_receiver_active(self):
        record = self.recorder(); record.heartbeat_enabled = False
        with patch.object(module.time, 'monotonic', return_value=108): record.pump()
        record.connection.recv_match.assert_called_once_with(blocking=True, timeout=.05)
        record.connection.mav.heartbeat_send.assert_not_called()

    def test_setup_heartbeats_stay_separate_from_replay_clock(self):
        record = self.recorder(); record.origin = None
        with patch.object(module.time, 'monotonic', return_value=101.1): record.send_heartbeat(101)
        self.assertEqual(record.setup_heartbeat_count, 1)
        self.assertEqual(record.last_setup_heartbeat, 101.1)
        self.assertEqual(record.heartbeat_tx, [])

    def test_only_specific_gcs_text_classifies_failsafe(self):
        self.assertEqual(module.gcs_status('GCS Failsafe'), 'start')
        self.assertEqual(module.gcs_status('GCS Failsafe Cleared'), 'complete')
        for message in ['Radio Failsafe', 'Battery Failsafe', 'GCS Failsafe Continuing Landing', 'CRITICAL']:
            self.assertIsNone(module.gcs_status(message))

    def test_land_mode_arrival_can_precede_cause_status(self):
        record = self.recorder(); record.heartbeat_enabled = False
        record.observe_landing = record.airborne = True
        record.landing_started = record.landing_completed = None
        record.latest['EXTENDED_SYS_STATE'] = (9999, {'landed_state': 2})
        heartbeat = SimpleNamespace(get_srcSystem=lambda: 1, get_srcComponent=lambda: 1,
            get_type=lambda: 'HEARTBEAT', custom_mode=9,
            to_dict=lambda: {'custom_mode': 9, 'base_mode': 217, 'system_status': 5})
        cause = SimpleNamespace(get_srcSystem=lambda: 1, get_srcComponent=lambda: 1,
            get_type=lambda: 'STATUSTEXT', severity=4, text='GCS Failsafe',
            to_dict=lambda: {'severity': 4, 'text': 'GCS Failsafe'})
        record.connection.recv_match.side_effect = [heartbeat, cause]
        with patch.object(module.time, 'monotonic', return_value=110): record.pump()
        with patch.object(module.time, 'monotonic', return_value=110.001): record.pump()
        self.assertEqual([event['stage'] for event in record.events], ['landing', 'failsafe'])
        self.assertLess(record.events[0]['timeMs'], record.events[1]['timeMs'])

    def test_unrelated_source_does_not_create_vehicle_evidence(self):
        record = self.recorder(); record.heartbeat_enabled = False
        record.connection.recv_match.return_value = SimpleNamespace(get_srcSystem=lambda: 2, get_srcComponent=lambda: 1)
        with patch.object(module.time, 'monotonic', return_value=108): self.assertIsNone(record.pump())
        self.assertEqual(record.telemetry, [])


if __name__ == '__main__': unittest.main()
