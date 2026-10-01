import base64,copy,hashlib,hmac,importlib.util,io,json,os,pathlib,tarfile,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('checked_image',pathlib.Path(__file__).parent/'checked-image.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
REVISION='a'*40
class CheckedImage(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.directory=pathlib.Path(self.temp.name);self.env=patch.dict(os.environ,{'RELEASE_SHA':REVISION,'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1'},clear=True);self.env.start();module.KIND='runtime'
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def fixture(self,kind='runtime',user=None,command=None,tag=None,environment=None):
  module.KIND=kind;settings={'User':user or 'root','Labels':{'org.opencontainers.image.revision':REVISION},'Env':['RELEASE_SHA='+REVISION,'BRITELINK_API_ORIGIN=','BRITELINK_API_ANON_KEY='],'Cmd':['nginx','-g','daemon off;'],'Entrypoint':['/docker-entrypoint.sh']}
  if command is not None:settings['Cmd']=command
  if environment is not None:settings['Env']=environment
  config={'config':settings,'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+hashlib.sha256(b'layer').hexdigest()]}};raw=json.dumps(config).encode();image='sha256:'+hashlib.sha256(raw).hexdigest()
  with tarfile.open(self.directory/'runtime-image.tar','w') as bundle:
   for name,data in [('manifest.json',json.dumps([{'Config':'config.json','RepoTags':[tag or module.import_tag(REVISION)],'Layers':['layer.tar']}]).encode()),('config.json',raw),('layer.tar',b'layer')]:
    entry=tarfile.TarInfo(name);entry.size=len(data);bundle.addfile(entry,io.BytesIO(data))
  receipt={'schema':1,'repository':module.REPOSITORY,'revision':REVISION,'kind':kind,'build_mode':module.expected_mode(),'image_id':image,'archive_sha256':module.digest(self.directory/'runtime-image.tar'),'workflow_run_id':'42','workflow_run_attempt':'1'}
  if module.expected_mode()=='production-configured':receipt['public_profile_sha256']=module.profile_digest(module.load_profile())
  self.write(receipt);return receipt,config
 def production_environment(self):
  from test_public_build_profile import public_token
  key=public_token();profile={'schema':1,'repository':module.REPOSITORY,'apiOrigin':'https://api.example.test','anonKeySha256':hashlib.sha256(key.encode()).hexdigest(),'privacyNoticeVersion':'reviewed-1','attachmentsEnabled':False}
  path=self.directory/'profile.json';path.write_text(json.dumps(profile),encoding='utf-8')
  os.environ.update(BRITELINK_CHECKED_BUILD_MODE='production-configured',BRITELINK_PUBLIC_PROFILE_FILE=str(path),BRITELINK_PUBLIC_PROFILE_SHA256=module.profile_digest(profile))
  return ['RELEASE_SHA='+REVISION,'BRITELINK_API_ORIGIN='+profile['apiOrigin'],'BRITELINK_API_ANON_KEY='+key,'BRITELINK_PRIVACY_NOTICE_VERSION=reviewed-1','BRITELINK_ATTACHMENTS_ENABLED=','BRITELINK_PUBLIC_CONFIG_SHA256='+module.profile_digest(profile)]
 def test_production_archive_binds_profile_receipt_and_loaded_configuration(self):
  environment=self.production_environment();receipt,config=self.fixture(environment=environment)
  self.assertEqual(module.verify(self.directory),receipt)
  loaded={'Config':config['config'],'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):module.verify_loaded(self.directory,receipt)
  receipt['public_profile_sha256']='f'*64;self.write(receipt);self.assertRaises(ValueError,module.verify,self.directory)
  for index,value in [(1,'BRITELINK_API_ORIGIN=http://127.0.0.1:8099'),(2,'BRITELINK_API_ANON_KEY=wrong'),(3,'BRITELINK_PRIVACY_NOTICE_VERSION=changed'),(4,'BRITELINK_ATTACHMENTS_ENABLED=true'),(5,'BRITELINK_PUBLIC_CONFIG_SHA256='+'f'*64)]:
   changed=environment.copy();changed[index]=value;self.fixture(environment=changed);self.assertRaises(ValueError,module.verify,self.directory)
 def test_fixture_archive_cannot_be_relabelled_as_production(self):
  self.production_environment();os.environ['BRITELINK_CHECKED_BUILD_MODE']='qa-configured';receipt,_=self.fixture(environment=self.configured_environment())
  receipt.update(build_mode='production-configured',public_profile_sha256=os.environ['BRITELINK_PUBLIC_PROFILE_SHA256']);self.write(receipt)
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='production-configured';self.assertRaises(ValueError,module.verify,self.directory)
 def test_production_mode_refuses_unbound_profile_and_fixture_receipt_claim(self):
  env=self.production_environment();self.fixture(environment=env);del os.environ['BRITELINK_PUBLIC_PROFILE_SHA256'];self.assertRaises(ValueError,module.verify,self.directory)
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='unconfigured-demo';receipt,_=self.fixture();receipt['public_profile_sha256']='f'*64;self.write(receipt);self.assertRaises(ValueError,module.verify,self.directory)
 def configured_environment(self,role='anon',run='42',origin='http://127.0.0.1:8099'):
  encode=lambda value:base64.urlsafe_b64encode(value).decode().rstrip('=')
  unsigned=encode(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())+'.'+encode(json.dumps({'role':role,'iss':'supabase-staging','iat':1700000000,'exp':2700000000},separators=(',',':')).encode())
  secret=hashlib.sha256(('britelink-ci-only-signing:'+REVISION+':'+run+':1').encode()).hexdigest()
  token=unsigned+'.'+encode(hmac.digest(secret.encode(),unsigned.encode(),'sha256'))
  return ['RELEASE_SHA='+REVISION,'BRITELINK_API_ORIGIN='+origin,'BRITELINK_API_ANON_KEY='+token]
 def test_configured_fixture_accepts_only_this_run_anon_key(self):
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='qa-configured'
  receipt,_=self.fixture(environment=self.configured_environment());self.assertEqual(module.verify(self.directory),receipt)
  for change in [{'role':'service_role'},{'run':'43'},{'origin':'https://britelink-api.ashbi.ca'}]:
   self.fixture(environment=self.configured_environment(**change));self.assertRaises(ValueError,module.verify,self.directory)
  environment=self.configured_environment();environment[-1]=environment[-1][:-1]+'!'
  self.fixture(environment=environment);self.assertRaises(ValueError,module.verify,self.directory)
 def test_configured_fixture_cannot_pass_demo_gate_or_become_production(self):
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='qa-configured';self.fixture(environment=self.configured_environment())
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='unconfigured-demo';self.assertRaises(ValueError,module.verify,self.directory)
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='production';self.assertRaises(ValueError,module.verify,self.directory)
 def test_configured_fixture_refuses_missing_workflow_identity(self):
  os.environ['BRITELINK_CHECKED_BUILD_MODE']='qa-configured';self.fixture(environment=self.configured_environment())
  del os.environ['GITHUB_RUN_ID'];self.assertRaises(ValueError,module.verify,self.directory)
 def write(self,receipt):(self.directory/'receipt.json').write_text(json.dumps(receipt))
 def test_accepts_checked_runtime(self):
  receipt,_=self.fixture();self.assertEqual(module.verify(self.directory),receipt)
 def test_rejects_tampered_archive_before_import(self):
  self.fixture();(self.directory/'runtime-image.tar').write_bytes(b'changed');self.assertRaises(ValueError,module.verify,self.directory)
 def test_rejects_wrong_repository_revision_kind_and_run(self):
  for field,value in [('repository','foreign/repo'),('revision','b'*40),('kind','role-init'),('build_mode','production'),('workflow_run_id','99'),('workflow_run_attempt','2')]:
   receipt,_=self.fixture();receipt[field]=value;self.write(receipt);self.assertRaises(ValueError,module.verify,self.directory)
 def test_rejects_privileged_user_command_and_wrong_import_tag(self):
  for args in [{'user':'unexpected-user'},{'command':['sh']},{'tag':'foreign:latest'}]:
   self.fixture(**args);self.assertRaises(ValueError,module.verify,self.directory)
 def test_rejects_forged_configuration_identity(self):
  receipt,_=self.fixture();receipt['image_id']='sha256:'+'f'*64;self.write(receipt);self.assertRaises(ValueError,module.verify,self.directory)
 def test_loaded_identity_allows_engine_manifest_ids_but_checks_contents(self):
  receipt,config=self.fixture();loaded={'Id':'sha256:'+'b'*64,'Config':config['config'],'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):self.assertEqual(module.verify_loaded(self.directory,receipt),loaded)
  loaded['RootFS']['Layers']=['sha256:'+'c'*64]
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):self.assertRaises(ValueError,module.verify_loaded,self.directory,receipt)
 def test_loaded_legacy_inspect_defaults_are_equivalent_to_absent_fields(self):
  receipt,config=self.fixture();loaded={'Id':'sha256:'+'b'*64,'Config':dict(config['config'],Hostname='',Domainname='',Image='',AttachStdin=False,AttachStdout=False,AttachStderr=False,Tty=False,OpenStdin=False,StdinOnce=False),'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  with patch.object(module.subprocess,'check_output',return_value=json.dumps([loaded])):self.assertEqual(module.verify_loaded(self.directory,receipt),loaded)
  for field,value in [('Hostname','changed'),('AttachStdin',True),('AttachStdin',0),('Image',None)]:
   changed=copy.deepcopy(loaded);changed['Config'][field]=value
   with patch.object(module.subprocess,'check_output',return_value=json.dumps([changed])):self.assertRaises(ValueError,module.verify_loaded,self.directory,receipt)
 def test_loaded_runtime_configuration_changes_remain_rejected(self):
  receipt,config=self.fixture();loaded={'Config':config['config'],'RootFS':{'Layers':config['rootfs']['diff_ids']},'Architecture':'amd64','Os':'linux'}
  for field,value in [('User','unexpected-user'),('Env',['RELEASE_SHA='+REVISION,'EVIL=1']),('Cmd',['sh']),('Entrypoint',['sh']),('Labels',{}),('Volumes',{'/app':{}}),('Healthcheck',{'Test':['NONE']})]:
   changed=copy.deepcopy(loaded);changed['Config'][field]=value
   with patch.object(module.subprocess,'check_output',return_value=json.dumps([changed])):self.assertRaises(ValueError,module.verify_loaded,self.directory,receipt)
 def test_documented_empty_or_nil_fields_match_absent_but_nonempty_remain(self):
  settings={'Volumes':None,'OnBuild':None,'Cmd':[],'Labels':{},'WorkingDir':''}
  self.assertEqual(module.comparable_configuration(settings),{})
  self.assertEqual(module.comparable_configuration({'Volumes':{'/data':{}},'OnBuild':['RUN evil'],'Cmd':['sh']}),{'Volumes':{'/data':{}},'OnBuild':['RUN evil'],'Cmd':['sh']})
if __name__=='__main__':unittest.main()
