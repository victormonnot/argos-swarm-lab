"""Shared physics transport and evaluator isolation, alongside inherited mission tests."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('shared_world_recorder', Path(__file__).with_name('record.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class SharedWorldChecks(unittest.TestCase):
    def row(self):
        return dict(simTimeMs=1000, observerStartSimTimeMs=1, observerSteps=1000, collisionCount=31,
            vehicles=[dict(id=f'A{i}', positionEnu=[0,0,0], velocityEnu=[0,0,0], orientationXyzw=[0,0,0,1]) for i in [1,2,3]],
            contactTotals=dict(groundSteps=100, obstacleSteps=0, vehicleSteps=0, otherSteps=0))

    def test_incomplete_snapshot_cannot_imply_three_vehicle_separation(self):
        row=self.row(); row['vehicles'].pop()
        with self.assertRaisesRegex(ValueError, 'Incomplete'): module.check_truth(row)

    def test_nonfinite_positions_and_invalid_orientations_are_rejected(self):
        for field,value in [('positionEnu',[float('nan'),0,0]),('orientationXyzw',[0,0,0,0])]:
            row=self.row();row['vehicles'][0][field]=value
            with self.assertRaises(ValueError): module.check_truth(row)

    def test_contact_counts_cannot_exceed_observed_steps(self):
        row=self.row();row['contactTotals']['vehicleSteps']=1001
        with self.assertRaisesRegex(ValueError,'counter'): module.check_truth(row)

    def test_unique_json_routes_and_synchronized_estimators(self):
        with tempfile.TemporaryDirectory() as directory:
            generated=module.prepare_models(directory)
            ports=[]
            for registry in module.REGISTRY:
                tree=ET.parse(generated[registry['id']]);plugin=tree.find(".//plugin[@name='ArduPilotPlugin']")
                ports.append(int(plugin.findtext('fdm_port_in')))
                self.assertEqual(plugin.findtext('no_time_sync'),'0')
                self.assertEqual(plugin.findtext('lock_step'),'1')
                self.assertEqual(tree.findtext('.//include/uri'),'model://iris_with_standoffs')
            self.assertEqual(ports,[9002,9012,9022])

    def test_world_geometry_metadata_matches_actual_collidable_boxes(self):
        tree=ET.parse(module.ROOT/'world.sdf')
        for building in module.WORLD['buildings']:
            model=tree.find(f".//model[@name='{building['id']}']")
            self.assertEqual([float(v) for v in model.findtext('pose').split()[:3]],building['positionEnu'])
            self.assertEqual([float(v) for v in model.findtext('./link/collision/geometry/box/size').split()],building['size'])
        poses=[row.findtext('pose') for row in tree.findall('./world/include')]
        self.assertEqual(len(poses),3)
        self.assertEqual([float(value.split()[0]) for value in poses],[-6,0,6])

    def test_no_decision_methods_override_the_recorded_behavior_trees(self):
        for method in ['dispatch','observe','action','halt','tick','release_retired_task']:
            self.assertIs(getattr(module.Coordinator,method),getattr(module.recovery.Coordinator,method))

    def test_truth_collection_does_not_change_controller_local_position(self):
        process=SimpleNamespace(pid=12,poll=lambda:None)
        vehicles=[module.recovery.Vehicle(row,process,module.HOME) for row in module.REGISTRY]
        for vehicle in vehicles: vehicle.latest={'LOCAL_POSITION_NED':(10,dict(x=1,y=2,z=3))}
        before=copy.deepcopy([v.latest for v in vehicles])
        row=self.row();row['collisionNames']=['known']
        feed=SimpleNamespace(drain=lambda:[(10.1,copy.deepcopy(row))])
        coordinator=module.Coordinator(vehicles,'nominal',process,feed);coordinator.origin=10
        with patch.object(module.recovery.Coordinator,'pump',return_value=None): coordinator.pump()
        self.assertEqual([v.latest for v in vehicles],before)
        self.assertEqual(len(coordinator.truth),1)
        self.assertNotIn('collisionNames',coordinator.truth[0])
        with patch.object(module.recovery.Coordinator,'pump',return_value=None):
            with self.assertRaisesRegex(RuntimeError,'clock'): coordinator.pump()

    def test_callback_error_is_not_silently_treated_as_no_contact(self):
        feed=module.TruthFeed.__new__(module.TruthFeed)
        feed.lock=threading.Lock();feed.pending=[];feed.failure=None
        feed.receive(SimpleNamespace(data='{}'))
        with self.assertRaises(KeyError): feed.drain()

    def test_exited_world_fails_even_while_autopilots_are_alive(self):
        feed=SimpleNamespace(drain=Mock(return_value=[]))
        coordinator=module.Coordinator([], 'nominal',SimpleNamespace(poll=lambda:2),feed)
        with self.assertRaisesRegex(RuntimeError,'server exited'): coordinator.pump()
        feed.drain.assert_not_called()

    def test_only_setup_stream_requests_get_higher_simulation_time_rate(self):
        coordinator=module.Coordinator([], 'nominal',SimpleNamespace(poll=lambda:None),None)
        with patch.object(module.recovery.Coordinator,'raw_command') as inherited:
            coordinator.raw_command(None,511,[32,100000]);inherited.assert_called_with(None,511,[32,33333])
            coordinator.origin=1
            coordinator.raw_command(None,21,[]);inherited.assert_called_with(None,21,[])

    def test_longer_setup_budget_does_not_extend_flight_completion_deadlines(self):
        coordinator=module.Coordinator([], 'nominal',None,None)
        predicate=lambda:False
        with patch.object(module.recovery.Coordinator,'until') as inherited:
            coordinator.until(predicate,80000,'Both estimators did not become ready.')
            inherited.assert_called_with(predicate,200000,'Both estimators did not become ready.')
            coordinator.until(predicate,3000,'Missing parameter')
            inherited.assert_called_with(predicate,3000,'Missing parameter')


if __name__ == '__main__': unittest.main()
