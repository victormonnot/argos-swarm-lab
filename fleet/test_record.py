"""Bounded coordinator properties: independent identities, assignment and receipt gates."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('fleet_recorder', Path(__file__).with_name('record.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FleetChecks(unittest.TestCase):
    def vehicle(self):
        vehicle = module.Vehicle(module.REGISTRY[0], SimpleNamespace(pid=100, poll=lambda: None), [0,0,0,0])
        vehicle.target = [6,0,-4]
        return vehicle

    def test_registered_positions_and_targets_are_inverse(self):
        origin=[.03,-.08,.2];pad=[-4,0,0];task=[-4,6,4]
        target=module.target_ned(origin,pad,task)
        self.assertEqual(module.common_enu(target,origin,pad),task)
        self.assertEqual(module.common_enu(origin,origin,pad),pad)

    def test_home_coordinates_preserve_declared_east_order(self):
        a=module.home_for_pad([-4,0,0]);b=module.home_for_pad([4,0,0])
        self.assertEqual(a[0],b[0]);self.assertEqual(a[2:],b[2:]);self.assertLess(a[1],b[1])

    def test_nearest_pair_owns_each_task_and_vehicle_once(self):
        rows=module.nearest_pairs({'A1':[-4,0,4],'A2':[4,0,4]},module.TASKS)
        self.assertEqual([(r['vehicleId'],r['taskId']) for r in rows],[('A1','T1'),('A2','T2')])
        self.assertEqual([r['costM'] for r in rows],[6,8])

    def test_greedy_ties_use_vehicle_then_task_identity(self):
        tasks=[dict(id='T2',positionEnu=[0,0,1]),dict(id='T1',positionEnu=[0,0,1])]
        rows=module.nearest_pairs({'A2':[0,0,2],'A1':[0,0,3]},tasks)
        self.assertEqual([(r['vehicleId'],r['taskId']) for r in rows],[('A1','T1'),('A2','T2')])

    def test_serialization_order_is_vehicle_order_not_cost_order(self):
        rows=module.nearest_pairs({'A1':[0,0,0],'A2':[10,0,0]},[
            dict(id='T1',positionEnu=[2,0,0]),dict(id='T2',positionEnu=[10,0,0])])
        self.assertEqual([r['vehicleId'] for r in rows],['A1','A2'])
        self.assertEqual([r['costM'] for r in rows],[2,0])

    def test_vehicle_identity_checks_system_and_component(self):
        for system,component,expected in [(1,1,True),(2,1,False),(1,2,False)]:
            message=SimpleNamespace(get_srcSystem=lambda:system,get_srcComponent=lambda:component)
            self.assertEqual(module.matches_vehicle(message,module.REGISTRY[0]),expected)

    def test_samples_after_deadline_cannot_finish_a_task(self):
        vehicle=self.vehicle();fleet=module.Fleet([vehicle]);fleet.track_tasks=True;fleet.mission_deadline=2000
        data=dict(x=6,y=0,z=-4,vx=0,vy=0,vz=0)
        for stamp in range(1000,2000,100):fleet.observe(vehicle,'LOCAL_POSITION_NED',stamp,data)
        fleet.observe(vehicle,'LOCAL_POSITION_NED',2000.001,data)
        self.assertIsNone(vehicle.task_done)
        fleet.observe(vehicle,'LOCAL_POSITION_NED',2000,data)
        self.assertEqual(vehicle.task_done,2000)

    def test_sparse_good_samples_do_not_fake_continuous_dwell(self):
        vehicle=self.vehicle();fleet=module.Fleet([vehicle]);fleet.track_tasks=True;fleet.mission_deadline=5000
        data=dict(x=6,y=0,z=-4,vx=0,vy=0,vz=0)
        for stamp in [1000,1301,1602,1903,2204]:fleet.observe(vehicle,'LOCAL_POSITION_NED',stamp,data)
        self.assertIsNone(vehicle.task_done)

    def test_high_speed_at_target_does_not_finish_task(self):
        vehicle=self.vehicle();fleet=module.Fleet([vehicle]);fleet.track_tasks=True;fleet.mission_deadline=5000
        data=dict(x=6,y=0,z=-4,vx=.41,vy=0,vz=0)
        for stamp in range(1000,2300,100):fleet.observe(vehicle,'LOCAL_POSITION_NED',stamp,data)
        self.assertIsNone(vehicle.task_done)

    def test_heartbeat_does_not_complete_mode_before_ack(self):
        vehicle=self.vehicle();fleet=module.Fleet([vehicle])
        vehicle.commands=[dict(id='guided',timeMs=100)]
        fleet.observe(vehicle,'HEARTBEAT',110,dict(custom_mode=4,base_mode=0))
        self.assertEqual(vehicle.events,[])
        vehicle.acks=[dict(commandId='guided',result=0,timeMs=120)]
        fleet.observe(vehicle,'HEARTBEAT',115,dict(custom_mode=4,base_mode=0))
        self.assertEqual(vehicle.events,[])
        fleet.observe(vehicle,'HEARTBEAT',130,dict(custom_mode=4,base_mode=0))
        self.assertEqual(vehicle.events,[dict(stage='guided',status='complete',timeMs=130)])

    def test_takeoff_uses_global_altitude_available_at_local_receipt(self):
        vehicle=self.vehicle();fleet=module.Fleet([vehicle]);fleet.track_takeoff=True
        vehicle.commands=[dict(id='takeoff',timeMs=100)]
        vehicle.acks=[dict(commandId='takeoff',result=0,timeMs=110)]
        data=dict(x=0,y=0,z=-4,vx=0,vy=0,vz=0)
        for stamp in range(200,1300,100):
            vehicle.latest={'GLOBAL_POSITION_INT':(stamp-1,dict(relative_alt=4000)), 'LOCAL_POSITION_NED':(stamp,data)}
            fleet.observe(vehicle,'LOCAL_POSITION_NED',stamp,data)
        self.assertEqual(vehicle.takeoff_done,1200)


if __name__ == '__main__':unittest.main()
