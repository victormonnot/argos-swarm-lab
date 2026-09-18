"""Focused checks of observer admission, clock boundaries and isolation lifecycle."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('gazebo_recorder', Path(__file__).with_name('record.py'))
recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorder)


class TruthChecks(unittest.TestCase):
    def setUp(self):
        self.row = dict(simTimeMs=1050, positionEnu=[1, 2, 3], velocityEnu=[0, 0, 0],
            forceEnu=[8, 0, 0], impulseNs=[.4, 0, 0], orientationXyzw=[0, 0, 0, 1],
            pulseActive=True, pulseAppliedSteps=50)

    def test_finite_truth_is_retained(self):
        self.assertEqual(recorder.check_truth(self.row), self.row)

    def test_nan_truth_is_rejected(self):
        for key in ['positionEnu', 'velocityEnu', 'forceEnu', 'impulseNs']:
            row = copy.deepcopy(self.row); row[key][0] = float('nan')
            with self.assertRaises(ValueError): recorder.check_truth(row)

    def test_nonunit_orientation_is_rejected(self):
        self.row['orientationXyzw'] = [0, 0, 0, 2]
        with self.assertRaises(ValueError): recorder.check_truth(self.row)

    def test_negative_simulation_clock_is_rejected(self):
        self.row['simTimeMs'] = -1
        with self.assertRaises(ValueError): recorder.check_truth(self.row)

    def test_pulse_evidence_requires_step_count(self):
        self.row['pulseAppliedSteps'] = -.5
        with self.assertRaises(ValueError): recorder.check_truth(self.row)

    def test_observer_callback_captures_receipt_without_changing_simulation_time(self):
        import json, threading
        from types import SimpleNamespace
        feed = recorder.TruthFeed.__new__(recorder.TruthFeed)
        feed.lock = threading.Lock(); feed.pending = []; feed.failure = None
        with patch.object(recorder.time, 'monotonic', return_value=42.25):
            feed.receive(SimpleNamespace(data=json.dumps(self.row)))
        received, row = feed.drain()[0]
        self.assertEqual(received, 42.25); self.assertEqual(row['simTimeMs'], 1050)
        self.assertEqual(feed.drain(), [])

    def test_callback_errors_are_propagated_on_main_thread(self):
        import threading
        from types import SimpleNamespace
        feed = recorder.TruthFeed.__new__(recorder.TruthFeed)
        feed.lock = threading.Lock(); feed.pending = []; feed.failure = None
        feed.receive(SimpleNamespace(data='invalid'))
        with self.assertRaises(ValueError): feed.drain()

    def test_pulse_request_failure_is_not_completion(self):
        from types import SimpleNamespace
        feed = recorder.TruthFeed.__new__(recorder.TruthFeed)
        feed.publisher = SimpleNamespace(publish=lambda _: False)
        with self.assertRaises(RuntimeError): feed.pulse()

    def test_model_explicitly_enables_clock_sync_and_lockstep(self):
        with tempfile.TemporaryDirectory() as work:
            target = recorder.prepare_model(work)
            plugin = ET.parse(target).find(".//plugin[@name='ArduPilotPlugin']")
            self.assertEqual(plugin.find('no_time_sync').text, '0')
            self.assertEqual(plugin.find('lock_step').text, '1')

    def test_external_physics_uses_ekf_and_normal_arming(self):
        text = (recorder.ROOT / 'overrides.parm').read_text()
        self.assertIn('AHRS_EKF_TYPE 3', text)
        self.assertIn('ARMING_SKIPCHK 0', text)


if __name__ == '__main__': unittest.main()
