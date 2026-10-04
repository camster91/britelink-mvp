import importlib.util
import pathlib
import unittest

here = pathlib.Path(__file__).parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, here / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
production = load('production')
backup = load('backup')


class ProductionBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.baseline = {}
        self.config = {'services': {}, 'volumes': {}, 'networks': {'backend': {'driver': 'bridge'}}}
        for role in production.ROLES:
            mounts = []
            if role in production.VOLUMES:
                mounts = [{'Type': 'volume', 'Name': production.VOLUMES[role], 'Destination': '/data', 'RW': True}]
                self.config['volumes'][role] = {'external': True, 'name': production.VOLUMES[role]}
            elif role == 'gateway':
                mounts = [{'Type': 'bind', 'Source': '/opt/britelink-production/gateway.conf', 'Destination': '/config', 'RW': False}]
            self.baseline[role] = {'Image': 'sha256:'+role, 'Config': {'Env': ['SETTING=preserved'], 'Cmd': ['run'], 'Entrypoint': ['start']}, 'Mounts': mounts}
            self.config['services'][role] = {'image': 'sha256:'+role, 'pull_policy': 'never', 'container_name': production.NAMES[role], 'networks': {'backend': {}}, 'labels': {'coolify.applicationId': '18'}, 'environment': {'SETTING': 'preserved'}, 'command': ['run'], 'entrypoint': ['start'], 'volumes': []}
            for mount in mounts:
                self.config['services'][role]['volumes'].append({'type': mount['Type'], 'source': role if mount['Type']=='volume' else mount['Source'], 'target': mount['Destination'], 'read_only': not mount['RW']})
        self.config['services']['gateway']['ports'] = [{'target': 8000, 'published': '8098', 'host_ip': '127.0.0.1'}]

    def validate(self):
        production.validate_config(self.config, self.baseline, 'a'*24, 18)

    def test_preserved_configuration(self): self.validate()

    def test_metadata_is_allowed_but_login_changes_are_rejected(self):
        self.config['services']['auth']['environment']['COOLIFY_BRANCH'] = 'main'; self.validate()
        self.config['services']['auth']['environment']['SETTING'] = 'changed'
        with self.assertRaises(RuntimeError): self.validate()

    def test_wrong_owner(self):
        self.config['services']['db']['labels']['coolify.applicationId'] = '17'
        with self.assertRaises(RuntimeError): self.validate()

    def test_candidate_volume(self):
        self.config['volumes']['db']['name'] = 'test-candidate-database'
        with self.assertRaises(RuntimeError): self.validate()

    def test_external_volume_required(self):
        self.config['volumes']['db']['external'] = False
        with self.assertRaises(RuntimeError): self.validate()

    def test_public_or_changed_port(self):
        self.config['services']['gateway']['ports'][0]['host_ip'] = '0.0.0.0'
        with self.assertRaises(RuntimeError): self.validate()

    def test_build_or_image_change(self):
        self.config['services']['db']['build'] = '.'
        with self.assertRaises(RuntimeError): self.validate()

    def test_shared_network(self):
        self.config['networks']['backend']['external'] = True
        with self.assertRaises(RuntimeError): self.validate()

    def test_added_privileges(self):
        self.config['services']['db']['privileged'] = True
        with self.assertRaises(RuntimeError): self.validate()

    def test_changed_command(self):
        self.config['services']['auth']['command'] = ['different']
        with self.assertRaises(RuntimeError): self.validate()

    def test_unexpected_service(self):
        self.config['services']['another-app'] = {}
        with self.assertRaises(RuntimeError): self.validate()

    def test_production_guard_accepts_main_only(self):
        owner = {'repository':'camster91/britelink-mvp','compose':'/docker-compose.coolify-backend-production.json','branch':'main'}
        self.assertEqual(backup.validate_owner(owner),'production')
        owner['branch']='ops/coolify-backend'
        with self.assertRaises(RuntimeError): backup.validate_owner(owner)

    def test_frontend_and_other_repository_guard_rejected(self):
        for owner in [{'repository':'camster91/britelink-mvp','compose':'/docker-compose.coolify-development.json','branch':'main'}, {'repository':'other/repo','compose':'/docker-compose.coolify-backend-production.json','branch':'main'}]:
            with self.assertRaises(RuntimeError): backup.validate_owner(owner)

    def test_fresh_backup_receipt(self):
        production.validate_receipt({'application':'approved','configDigest':'exact','verifiedAt':100},'approved','exact',101)

    def test_stale_future_wrong_owner_and_changed_config_receipts(self):
        for receipt in [
            {'application':'approved','configDigest':'exact','verifiedAt':0},
            {'application':'approved','configDigest':'exact','verifiedAt':3000},
            {'application':'candidate','configDigest':'exact','verifiedAt':1999},
            {'application':'approved','configDigest':'other','verifiedAt':1999},
        ]:
            with self.assertRaises(RuntimeError): production.validate_receipt(receipt,'approved','exact',2000)


if __name__ == '__main__': unittest.main()
