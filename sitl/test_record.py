"""Execution gates are conservative about message identity, age and observation."""
import copy
import unittest
from record import CONFIG, Dwell, ack_matches, landed_good, takeoff_good, waypoint_good


class Ack:
    command = 22
    target_system = 255
    target_component = 190
    system = 1
    component = 1
    def get_type(self): return 'COMMAND_ACK'
    def get_srcSystem(self): return self.system
    def get_srcComponent(self): return self.component


class RuntimeTests(unittest.TestCase):
    def test_dwell_requires_elapsed_good_samples(self):
        gate = Dwell()
        self.assertFalse(gate.update(0, True))
        for stamp in range(100, 1000, 100): self.assertFalse(gate.update(stamp, True))
        self.assertTrue(gate.update(1000, True))

    def test_dwell_gap_and_bad_measurement_reset(self):
        gate = Dwell()
        for stamp in [0, 200, 400, 600, 800]: gate.update(stamp, True)
        self.assertFalse(gate.update(1200, True))
        self.assertFalse(gate.update(1400, False))
        self.assertFalse(gate.update(1600, True))
        self.assertEqual(gate.first, 1600)

    def test_repeated_or_reordered_sample_cannot_extend_dwell(self):
        gate = Dwell()
        gate.update(1000, True)
        self.assertFalse(gate.update(1000, True))
        self.assertFalse(gate.update(900, True))
        self.assertEqual(gate.previous, 1000)

    def test_ack_matches_sender_recipient_command_and_order(self):
        message = Ack()
        self.assertTrue(ack_matches(message, 22, 100, 101))
        self.assertFalse(ack_matches(message, 21, 100, 101))
        self.assertFalse(ack_matches(message, 22, 100, 99))
        for name, wrong in [('system', 2), ('component', 2), ('target_system', 254), ('target_component', 1)]:
            other = copy.copy(message); setattr(other, name, wrong)
            self.assertFalse(ack_matches(other, 22, 100, 101))

    def test_takeoff_uses_fresh_global_altitude_and_full_speed(self):
        latest = {'LOCAL_POSITION_NED': (1000, dict(vx=0, vy=0, vz=.1)),
                  'GLOBAL_POSITION_INT': (900, dict(relative_alt=4000))}
        self.assertTrue(takeoff_good(latest, 1000))
        self.assertFalse(takeoff_good(latest, 1501))
        latest['LOCAL_POSITION_NED'][1]['vx'] = .5
        self.assertFalse(takeoff_good(latest, 1000))
        latest['LOCAL_POSITION_NED'][1]['vx'] = 0
        latest['GLOBAL_POSITION_INT'][1]['relative_alt'] = 3500
        self.assertFalse(takeoff_good(latest, 1000))

    def test_takeoff_altitude_must_be_post_request(self):
        latest = {'LOCAL_POSITION_NED': (1000, dict(vx=0, vy=0, vz=0)),
                  'GLOBAL_POSITION_INT': (900, dict(relative_alt=4000))}
        self.assertFalse(takeoff_good(latest, 1000, after=950))
        self.assertTrue(takeoff_good(latest, 1000, after=850))

    def test_waypoint_requires_3d_distance_and_settled_velocity(self):
        data = dict(x=8, y=5, z=-4, vx=0, vy=0, vz=0)
        self.assertTrue(waypoint_good(data, [8, 5, -4]))
        data['z'] = -3
        self.assertFalse(waypoint_good(data, [8, 5, -4]))
        data['z'] = -4; data['vy'] = 1
        self.assertFalse(waypoint_good(data, [8, 5, -4]))

    def test_landing_needs_prior_flight_and_post_command_evidence(self):
        latest = {'HEARTBEAT': (1100, {'base_mode': 0}), 'EXTENDED_SYS_STATE': (1200, {'landed_state': 1})}
        self.assertTrue(landed_good(latest, 1200, 1000, True))
        self.assertFalse(landed_good(latest, 1200, 1000, False))
        self.assertFalse(landed_good(latest, 1200, 1150, True))
        self.assertFalse(landed_good(latest, 2701, 1000, True))
        latest['HEARTBEAT'][1]['base_mode'] = 128
        self.assertFalse(landed_good(latest, 1200, 1000, True))
        latest['HEARTBEAT'][1]['base_mode'] = 0
        latest['EXTENDED_SYS_STATE'][1]['landed_state'] = 2
        self.assertFalse(landed_good(latest, 1200, 1000, True))

    def test_position_only_ned_gate_preserves_down_sign(self):
        self.assertEqual(CONFIG['waypointOffsetNed'], [8, 5, -4])
        self.assertFalse(waypoint_good(dict(x=8, y=5, z=4, vx=0, vy=0, vz=0), [8, 5, -4]))


if __name__ == '__main__': unittest.main()
