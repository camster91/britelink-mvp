import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).with_name('backup.py')
spec=importlib.util.spec_from_file_location('backup_guard',path)
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
RESOURCE='b'*24

def container(role, native=True, running=True, suffix='new-deployment'):
    return {'Name':'/'+(role+'-'+RESOURCE+'-'+suffix if native else guard.LEGACY[role]),
            'State':{'Running':running},'Config':{'Labels':{'com.docker.compose.project':RESOURCE if native else 'britelink-production','com.docker.compose.service':role}}}

class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.legacy=[container(role,False) for role in guard.REQUIRED_ROLES]
    def test_first_candidate_uses_exact_running_originals(self):
        selected=guard.select_stack(self.legacy,RESOURCE)
        self.assertTrue(all(c['Name'].lstrip('/')==guard.LEGACY[role] for role,c in selected.items()))
    def test_native_deployment_names_are_discovered_by_labels(self):
        native=[container(role) for role in guard.REQUIRED_ROLES]
        selected=guard.select_stack(self.legacy+native,RESOURCE)
        self.assertTrue(all(c in native for c in selected.values()))
    def test_partial_native_stack_never_falls_back_to_original(self):
        with self.assertRaisesRegex(RuntimeError,'legacy fallback refused'):
            guard.select_stack(self.legacy+[container('db')],RESOURCE)
    def test_stopped_native_stack_never_falls_back(self):
        native=[container(role,running=role!='auth') for role in guard.REQUIRED_ROLES]
        with self.assertRaisesRegex(RuntimeError,'legacy fallback refused'):
            guard.select_stack(self.legacy+native,RESOURCE)
    def test_duplicate_native_writers_fail_closed(self):
        native=[container(role) for role in guard.REQUIRED_ROLES]+[container('db',suffix='old-deployment')]
        with self.assertRaisesRegex(RuntimeError,'ambiguous'):
            guard.select_stack(self.legacy+native,RESOURCE)
    def test_stopped_original_blocks_first_backup(self):
        self.legacy[0]['State']['Running']=False
        with self.assertRaisesRegex(RuntimeError,'Legacy backend'):
            guard.select_stack(self.legacy,RESOURCE)
    def test_exited_one_shot_job_does_not_count_as_a_failed_consumer(self):
        native=[container(role) for role in guard.REQUIRED_ROLES]+[container('db-roles',running=False)]
        self.assertEqual(set(guard.select_stack(native,RESOURCE)),set(guard.REQUIRED_ROLES))

if __name__=='__main__':unittest.main()
