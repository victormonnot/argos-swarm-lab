"""Coordinator properties that can fail independently of a successful flight replay."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('recovery_recorder', Path(__file__).with_name('record.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class RecoveryChecks(unittest.TestCase):
    def setup_coordinator(self):
        vehicles = [module.Vehicle(spec, SimpleNamespace(pid=100+i, poll=lambda: None), [0,0,0,0])
                    for i, spec in enumerate(module.REGISTRY)]
        for v in vehicles:
            v.connection = SimpleNamespace(mav=Mock())
            v.origin = [0,0,0]
        c = module.Coordinator(vehicles, 'withdrawal')
        c.now = lambda: 2000
        c.raw_command = Mock()
        return c, vehicles

    def attempt(self, c, v, task='T4'):
        attempt = dict(id='P4',vehicleId=v.spec['id'],taskId=task,assignedTimeMs=100,commandId='task-P4',
            sentTimeMs=200,positionNed=[12,0,-4],status='active',completedTimeMs=None,cancelledTimeMs=None,releasedTimeMs=None)
        c.attempts.append(attempt);v.active_attempt=attempt;c.task_states[task]='assigned';c.mission_deadline=90000
        return attempt

    def context(self, **extra):
        return dict(inputs=dict(withdrawRequested=False,missionClosed=False,attemptId=None,**extra),
                    visited=[],actions=[],halts=[])

    def test_reactive_fallback_checks_high_priority_on_every_tick(self):
        called=[]
        def check(ctx): return module.SUCCESS if ctx['inputs']['on'] else module.FAILURE
        high=module.Node('high','sequence',[module.Node('condition','condition',callback=check),
              module.Node('act','action',callback=lambda ctx: called.append('high') or module.RUNNING)])
        low=module.Node('low','action',callback=lambda ctx: called.append('low') or module.RUNNING)
        tree=module.Node('root','fallback',[high,low])
        for value in [False,True]:
            ctx=dict(inputs=dict(on=value),visited=[])
            self.assertEqual(tree.tick(ctx),module.RUNNING)
        self.assertEqual(called,['low','high'])
        self.assertEqual([r['id'] for r in ctx['visited']],['root','high','condition','act'])

    def test_sequences_stop_at_first_running_child(self):
        calls=[]
        nodes=[module.Node(str(i),'action',callback=lambda ctx,i=i: calls.append(i) or (module.RUNNING if i==1 else module.SUCCESS)) for i in range(3)]
        self.assertEqual(module.Node('sequence','sequence',nodes).tick(dict(visited=[])),module.RUNNING)
        self.assertEqual(calls,[0,1])

    def test_withdrawal_halts_and_locks_before_land_send(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0];a=self.attempt(c,v)
        v.withdraw_requested=True;v.running_action='task'
        ctx=self.context();ctx['inputs']['withdrawRequested']=True
        c.raw_command.side_effect=lambda *_: self.assertEqual(a['status'],'cancelled')
        self.assertEqual(v.tree.tick(ctx),module.RUNNING)
        self.assertEqual(c.task_states['T4'],'locked')
        self.assertEqual(ctx['halts'][0]['id'],'task')
        self.assertEqual(v.commands[0]['id'],'land')
        self.assertLessEqual(a['cancelledTimeMs'],v.commands[0]['timeMs'])

    def test_cancelled_attempt_cannot_gain_future_task_credit(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0];a=self.attempt(c,v)
        v.withdraw_requested=True;v.running_action='task';c.halt(v,'task',self.context())
        data=dict(x=12,y=0,z=-4,vx=0,vy=0,vz=0)
        for stamp in range(2100,4100,100): c.observe(v,'LOCAL_POSITION_NED',stamp,data)
        self.assertEqual(a['status'],'cancelled');self.assertIsNone(a['completedTimeMs'])

    def test_no_release_before_grounded_disarmed_confirmation(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0];a=self.attempt(c,v)
        v.withdraw_requested=True;a['status']='cancelled';c.task_states['T4']='locked'
        c.release_retired_task();self.assertEqual(c.task_states['T4'],'locked')
        v.land_done=1999;v.airborne=True;v.commands=[dict(id='land',timeMs=1000)]
        v.latest={'HEARTBEAT':(1999,dict(base_mode=0)),'EXTENDED_SYS_STATE':(1998,dict(landed_state=1))}
        c.release_retired_task()
        self.assertEqual(c.task_states['T4'],'pending');self.assertEqual(a['releasedTimeMs'],2000)
        self.assertEqual(c.withdrawal['landedTimeMs'],1999)
        c.release_retired_task();self.assertEqual(len(c.task_events),1)

    def test_stale_landed_latch_cannot_release_task(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0];a=self.attempt(c,v)
        v.withdraw_requested=True;a['status']='cancelled';c.task_states['T4']='locked'
        v.land_done=300;v.airborne=True;v.commands=[dict(id='land',timeMs=100)]
        v.latest={'HEARTBEAT':(300,dict(base_mode=0)),'EXTENDED_SYS_STATE':(300,dict(landed_state=1))}
        c.release_retired_task();self.assertEqual(c.task_states['T4'],'locked')
        self.assertIsNone(a['releasedTimeMs'])

    def test_completed_tasks_are_never_reassigned_and_withdrawn_vehicle_is_excluded(self):
        c,vehicles=self.setup_coordinator();c.mission_start=1000
        c.task_states={task['id']:'completed' for task in module.TASKS};c.task_states['T4']='pending'
        for v in vehicles:
            v.takeoff_done=900;v.latest={'LOCAL_POSITION_NED':(1999,dict(x=0,y=0,z=-4))}
        vehicles[0].withdraw_requested=True;c.dispatch()
        pairs=c.assignments[0]['pairs']
        self.assertEqual(len(pairs),1);self.assertEqual(pairs[0]['taskId'],'T4')
        self.assertNotEqual(pairs[0]['vehicleId'],'A1')

    def test_stale_pose_cannot_enter_assignment_candidates(self):
        c,vehicles=self.setup_coordinator();c.mission_start=1000
        for v in vehicles: v.takeoff_done=900;v.latest={'LOCAL_POSITION_NED':(1499,dict(x=0,y=0,z=-4))}
        c.dispatch();self.assertEqual(c.assignments,[])

    def test_tick_repetition_does_not_resend_command(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0]
        for _ in range(3):c.action(v,'guided',self.context())
        self.assertEqual(len(v.commands),1);c.raw_command.assert_called_once()

    def test_command_acceptance_alone_is_not_action_completion(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0]
        c.action(v,'guided',self.context())
        v.acks=[dict(commandId='guided',result=0,timeMs=2001)]
        self.assertEqual(c.action(v,'guided',self.context()),module.RUNNING)
        c.observe(v,'HEARTBEAT',2002,dict(custom_mode=4,base_mode=0))
        self.assertEqual(c.action(v,'guided',self.context()),module.SUCCESS)

    def test_precommand_samples_and_gaps_cannot_complete_task(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0];a=self.attempt(c,v);a['sentTimeMs']=1500
        data=dict(x=12,y=0,z=-4,vx=0,vy=0,vz=0)
        for stamp in range(100,1500,100):c.observe(v,'LOCAL_POSITION_NED',stamp,data)
        self.assertIsNone(a['completedTimeMs'])
        for stamp in [1500,1900,2300,2700,3100]:c.observe(v,'LOCAL_POSITION_NED',stamp,data)
        self.assertIsNone(a['completedTimeMs'])
        for stamp in range(3200,4201,100):c.observe(v,'LOCAL_POSITION_NED',stamp,data)
        self.assertEqual(a['completedTimeMs'],4100)

    def test_after_deadline_sample_cannot_complete_task(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0];a=self.attempt(c,v);c.mission_deadline=1199
        data=dict(x=12,y=0,z=-4,vx=0,vy=0,vz=0)
        for stamp in range(200,1300,100):c.observe(v,'LOCAL_POSITION_NED',stamp,data)
        self.assertIsNone(a['completedTimeMs'])

    def test_completed_stage_does_not_get_spurious_halt(self):
        c,vehicles=self.setup_coordinator();v=vehicles[0]
        v.completed_stages['guided']=100;v.running_action='guided';ctx=self.context()
        c.action(v,'guided',ctx);c.action(v,'arm',ctx)
        self.assertEqual(ctx['halts'],[])


if __name__ == '__main__': unittest.main()
