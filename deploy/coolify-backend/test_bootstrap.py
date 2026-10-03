import copy
import base64
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).with_name('bootstrap.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
APP='b'*24
PASSWORD='a'*64
SECRET='c'*64

def token(role, secret=SECRET, expires=None):
    encode=lambda value:base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    header=encode(json.dumps({'alg':'HS256'}).encode())
    payload=encode(json.dumps({'role':role,'iss':'supabase','exp':expires if expires is not None else int(time.time())+3600}).encode())
    return header+'.'+payload+'.'+encode(hmac.new(secret.encode(),(header+'.'+payload).encode(),hashlib.sha256).digest())

def startup():
    return {'services':{
        'db':{'environment':{'POSTGRES_PASSWORD':PASSWORD}},
        'db-roles':{'environment':{'PGPASSWORD':PASSWORD},'command':['-d','restore','-v','pw='+PASSWORD]},
        'auth':{'environment':{'DATABASE_URL':f'postgres://supabase_auth_admin:{PASSWORD}@db:5432/restore','GOTRUE_JWT_SECRET':SECRET}},
        'rest':{'environment':{'PGRST_DB_URI':f'postgres://authenticator:{PASSWORD}@db:5432/restore','PGRST_JWT_SECRET':SECRET}},
        'storage':{'environment':{'DATABASE_URL':f'postgres://supabase_storage_admin:{PASSWORD}@db:5432/restore','PGRST_JWT_SECRET':SECRET,'ANON_KEY':token('anon'),'SERVICE_KEY':token('service_role')}}}}

def database():
    return {'Id':'candidate-db','Config':{'Labels':{'com.docker.compose.project':APP,'com.docker.compose.service':'db'}},
        'State':{'Running':True},'Mounts':[{'Destination':'/var/lib/postgresql/data','Type':'volume','Name':APP+'-britelink-database-v1'}],
        'HostConfig':{'PortBindings':{}},'NetworkSettings':{'Networks':{'candidate-backend':{}}}}

class BootstrapBoundaryTests(unittest.TestCase):
    def test_only_the_namespaced_internal_database_is_accepted(self):
        db=database()
        self.assertIs(module.validate_target([db],APP,{'candidate-backend':{'Internal':True}}),db)
    def test_legacy_volume_is_rejected(self):
        db=database();db['Mounts'][0]['Name']='britelink-production_db-data'
        with self.assertRaisesRegex(RuntimeError,'volume'):
            module.validate_target([db],APP,{'candidate-backend':{'Internal':True}})
    def test_another_container_sharing_the_volume_is_rejected(self):
        db=database();foreign=copy.deepcopy(db);foreign['Id']='foreign';foreign['Config']['Labels']['com.docker.compose.project']='other-project'
        with self.assertRaisesRegex(RuntimeError,'shares'):
            module.validate_target([db,foreign],APP,{'candidate-backend':{'Internal':True}})
    def test_existing_api_writer_is_rejected(self):
        db=database();api=copy.deepcopy(db);api['Id']='api';api['Config']['Labels']['com.docker.compose.service']='auth'
        with self.assertRaisesRegex(RuntimeError,'exactly one'):
            module.validate_target([db,api],APP,{'candidate-backend':{'Internal':True}})
    def test_published_database_port_is_rejected(self):
        db=database();db['HostConfig']['PortBindings']={'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'15432'}]}
        with self.assertRaisesRegex(RuntimeError,'publishes'):
            module.validate_target([db],APP,{'candidate-backend':{'Internal':True}})
    def test_external_network_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'internal-only'):
            module.validate_target([database()],APP,{'candidate-backend':{'Internal':False}})
    def test_stopped_database_is_rejected(self):
        db=database();db['State']['Running']=False
        with self.assertRaisesRegex(RuntimeError,'running'):
            module.validate_target([db],APP,{'candidate-backend':{'Internal':True}})
    def test_role_permissions_cannot_change_during_credential_rotation(self):
        expected=[{'rolname':'authenticator','rolsuper':False,'rolpassword':'old-hash'}]
        actual=copy.deepcopy(expected);actual[0]['rolpassword']='new-hash';module.compare_roles(expected,actual)
        actual[0]['rolsuper']=True
        with self.assertRaisesRegex(RuntimeError,'privileges'):
            module.compare_roles(expected,actual)
    def test_unrotated_candidate_password_is_rejected(self):
        role=[{'rolname':'supabase_admin','rolpassword':'source-hash','rolsuper':True}]
        with self.assertRaisesRegex(RuntimeError,'replaced'):
            module.compare_roles(role,role)
    def test_extra_restore_operator_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'extra operator'):
            module.compare_roles([], [{'rolname':'temporary-superuser'}])
    def test_schema_canonicalization_retains_real_sql(self):
        value=b'\\restrict nonce\nCREATE TABLE example(id integer);\n\\unrestrict nonce\n'
        self.assertEqual(module.canon(value),b'CREATE TABLE example(id integer);')

class StartupBoundaryTests(unittest.TestCase):
    def test_consistent_new_credentials_are_accepted(self):
        module.validate_startup_credentials(startup(),PASSWORD,'restore',{})
    def test_connector_cannot_target_original_database(self):
        config=startup();config['services']['auth']['environment']['DATABASE_URL']=f'postgres://supabase_auth_admin:{PASSWORD}@db:5432/postgres'
        with self.assertRaisesRegex(RuntimeError,'connector'):
            module.validate_startup_credentials(config,PASSWORD,'restore',{})
    def test_role_job_cannot_target_original_database(self):
        config=startup();config['services']['db-roles']['command'][1]='postgres'
        with self.assertRaisesRegex(RuntimeError,'role job'):
            module.validate_startup_credentials(config,PASSWORD,'restore',{})
    def test_startup_cannot_change_verified_password(self):
        config=startup();config['services']['db']['environment']['POSTGRES_PASSWORD']='d'*64
        with self.assertRaisesRegex(RuntimeError,'password differs'):
            module.validate_startup_credentials(config,PASSWORD,'restore',{})
    def test_jwt_must_match_all_consumers(self):
        config=startup();config['services']['rest']['environment']['PGRST_JWT_SECRET']='d'*64
        with self.assertRaisesRegex(RuntimeError,'JWT configuration'):
            module.validate_startup_credentials(config,PASSWORD,'restore',{})
    def test_source_credentials_cannot_be_reused(self):
        for value in [PASSWORD,SECRET,token('anon'),token('service_role')]:
            config=startup()
            # Use the exact generated token rather than relying on clock equality.
            if '.' in value:config['services']['storage']['environment']['ANON_KEY' if json.loads(base64.urlsafe_b64decode(value.split('.')[1]+'=='))['role']=='anon' else 'SERVICE_KEY']=value
            with self.subTest(value_type='token' if '.' in value else 'secret'):
                with self.assertRaisesRegex(RuntimeError,'source credential'):
                    module.validate_startup_credentials(config,PASSWORD,'restore',{'source':{'Config':{'Env':['VALUE='+value]}}})
    def test_invalid_or_expired_or_wrong_role_tokens_are_rejected(self):
        for value in ['broken',token('anon',secret='d'*64),token('service_role'),token('anon',expires=1)]:
            config=startup();config['services']['storage']['environment']['ANON_KEY']=value
            with self.subTest(case=value[:8]):
                with self.assertRaisesRegex(RuntimeError,'candidate role token'):
                    module.validate_startup_credentials(config,PASSWORD,'restore',{})
    def test_files_volume_absent_is_safe(self):
        with patch.object(module,'run',side_effect=[b'id',b'[ {"Mounts": []} ]',b'']):
            module.validate_files_volume(APP)
    def test_files_volume_in_use_is_rejected(self):
        records=[{'Mounts':[{'Name':APP+'-britelink-files-v1'}]}]
        with patch.object(module,'run',side_effect=[b'id',json.dumps(records).encode()]):
            with self.assertRaisesRegex(RuntimeError,'in use'):module.validate_files_volume(APP)
    def test_nonempty_files_volume_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder,'unexpected').write_text('candidate test')
            records=[{'Driver':'local','Options':None,'Mountpoint':folder}]
            with patch.object(module,'run',side_effect=[b'id',b'[{"Mounts":[]}]',(APP+'-britelink-files-v1').encode(),json.dumps(records).encode()]):
                with self.assertRaisesRegex(RuntimeError,'not empty'):module.validate_files_volume(APP)
    def test_empty_local_files_volume_is_safe(self):
        with tempfile.TemporaryDirectory() as folder:
            records=[{'Driver':'local','Options':None,'Mountpoint':folder}]
            with patch.object(module,'run',side_effect=[b'id',b'[{"Mounts":[]}]',(APP+'-britelink-files-v1').encode(),json.dumps(records).encode()]):
                module.validate_files_volume(APP)

if __name__=='__main__':unittest.main()
