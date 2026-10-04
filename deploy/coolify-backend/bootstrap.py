#!/usr/bin/env python3
"""Candidate-only import verification and first API startup. No production cutover."""
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse

PASSWORD_ROLES = {'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'authenticator'}
ROLES_QUERY = "SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY rolname) FROM pg_authid r"
MEMBERS_QUERY = "SELECT coalesce(jsonb_agg(jsonb_build_object('role',a.rolname,'member',b.rolname,'grantor',g.rolname,'admin',m.admin_option) ORDER BY a.rolname,b.rolname,g.rolname),'[]'::jsonb) FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor"
CATALOG_QUERY = "SELECT json_build_object('databaseOwner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),'extensions',(SELECT json_agg(json_build_object('name',extname,'owner',pg_get_userbyid(extowner),'schema',n.nspname,'version',extversion) ORDER BY extname) FROM pg_extension x JOIN pg_namespace n ON n.oid=x.extnamespace))"

def validate_startup_credentials(config, password, database, source_records):
    """Check credentials without returning or printing their values."""
    services = config['services']
    env = {name: service.get('environment', {}) for name, service in services.items()}
    if env['db'].get('POSTGRES_PASSWORD') != password or env['db-roles'].get('PGPASSWORD') != password:
        raise RuntimeError('Startup database password differs from the verified candidate')
    expected_urls = {'auth': ('DATABASE_URL', 'supabase_auth_admin'),
                     'rest': ('PGRST_DB_URI', 'authenticator'),
                     'storage': ('DATABASE_URL', 'supabase_storage_admin')}
    for name, (key, role) in expected_urls.items():
        if env[name].get(key) != f'postgres://{role}:{password}@db:5432/{database}':
            raise RuntimeError('Startup connector differs from the verified database')
    command = services['db-roles'].get('command', [])
    if '-d' not in command or command[command.index('-d')+1] != database or 'pw='+password not in command:
        raise RuntimeError('Startup role job targets a different database or password')
    secret = env['auth'].get('GOTRUE_JWT_SECRET', '')
    if not re.fullmatch(r'[0-9a-f]{48,128}', secret) or any(
            env[name].get('PGRST_JWT_SECRET') != secret for name in ('rest', 'storage')):
        raise RuntimeError('Startup JWT configuration is inconsistent or not generated')
    source_values = {value.split('=', 1)[1] for record in source_records.values()
                     for value in record['Config'].get('Env', []) if '=' in value}
    tokens = [env['storage'].get('ANON_KEY', ''), env['storage'].get('SERVICE_KEY', '')]
    if any(value in source_values for value in [password, secret]+tokens):
        raise RuntimeError('Startup reuses a source credential')
    for token, role in zip(tokens, ('anon', 'service_role')):
        try:
            header, payload, signature = token.split('.')
            decode = lambda value: base64.urlsafe_b64decode(value+'='*((-len(value))%4))
            claims = json.loads(decode(payload))
            expected = hmac.new(secret.encode(), (header+'.'+payload).encode(), hashlib.sha256).digest()
            valid = (json.loads(decode(header)).get('alg') == 'HS256'
                     and hmac.compare_digest(decode(signature), expected)
                     and claims.get('role') == role and claims.get('iss') == 'supabase'
                     and isinstance(claims.get('exp'), int) and claims['exp'] > time.time())
        except Exception:
            valid = False
        if not valid:
            raise RuntimeError('Startup API key is not a valid candidate role token')

def validate_files_volume(application):
    """Only absent or empty local volumes are safe for this empty-storage importer."""
    name = application+'-britelink-files-v1'
    containers = json.loads(run(['docker','inspect']+run(['docker','ps','-aq']).decode().splitlines()))
    if any(any(m.get('Name') == name for m in c['Mounts']) for c in containers):
        raise RuntimeError('Candidate files volume is already in use')
    names = run(['docker','volume','ls','-q']).decode().splitlines()
    if name not in names:
        return
    volume = json.loads(run(['docker','volume','inspect',name]))[0]
    if volume['Driver'] != 'local' or volume.get('Options'):
        raise RuntimeError('Candidate files volume has an unsupported driver or options')
    path = Path(volume['Mountpoint'])
    if path.is_symlink() or not path.is_dir() or any(path.iterdir()):
        raise RuntimeError('Candidate files volume is not empty')

def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError('Candidate check failed: ' + args[0] + '; command output withheld')
    return result.stdout

def private_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise RuntimeError('Recovery file is not root-private')
    return path

def validate_target(containers, application, networks):
    selected = [c for c in containers if (c['Config'].get('Labels') or {}).get('com.docker.compose.project') == application]
    if len(selected) != 1:
        raise RuntimeError('Bootstrap requires exactly one native database and no API/role jobs')
    db = selected[0]
    if (db['Config'].get('Labels') or {}).get('com.docker.compose.service') != 'db' or not db['State']['Running']:
        raise RuntimeError('Bootstrap database is not the sole running native service')
    mounts = [m for m in db['Mounts'] if m['Destination'] == '/var/lib/postgresql/data']
    expected = application + '-britelink-database-v1'
    if len(mounts) != 1 or mounts[0]['Type'] != 'volume' or mounts[0].get('Name') != expected:
        raise RuntimeError('Bootstrap database volume does not belong to this resource')
    if any(c['Id'] != db['Id'] and any(m.get('Name') == expected for m in c['Mounts']) for c in containers):
        raise RuntimeError('Another container shares the candidate database volume')
    if db['HostConfig'].get('PortBindings'):
        raise RuntimeError('Candidate database publishes a host port')
    attached = set(db['NetworkSettings']['Networks'])
    if not attached or any(not networks.get(n, {}).get('Internal') for n in attached):
        raise RuntimeError('Candidate database is not on internal-only networks')
    return db

def candidate(application):
    if not re.fullmatch(r'[a-z0-9]{20,40}', application):
        raise RuntimeError('Invalid resource identity')
    php = "require '/var/www/html/vendor/autoload.php'; $app=require '/var/www/html/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $r=App\\Models\\Application::where('uuid',$argv[1])->sole(); echo json_encode(['repository'=>$r->git_repository,'compose'=>$r->docker_compose_location,'branch'=>$r->git_branch,'auto'=>$r->settings->is_auto_deploy_enabled,'fqdn'=>$r->fqdn]);"
    owner = json.loads(run(['docker', 'exec', 'coolify', 'php', '-r', php, application]))
    if owner['repository'] != 'camster91/britelink-mvp' or owner['compose'] != '/docker-compose.coolify-backend-candidate.json' or owner['branch'] != 'ops/coolify-backend' or owner['auto'] or owner['fqdn']:
        raise RuntimeError('Resource is not the approved inactive private backend candidate')
    ids = run(['docker', 'ps', '-aq']).decode().split()
    containers = json.loads(run(['docker', 'inspect', *ids]))
    network_names = {n for c in containers if (c['Config'].get('Labels') or {}).get('com.docker.compose.project') == application for n in c['NetworkSettings']['Networks']}
    records = json.loads(run(['docker', 'network', 'inspect', *network_names])) if network_names else []
    return validate_target(containers, application, {n['Name']: n for n in records})

def canon(schema):
    return b'\n'.join(line for line in schema.splitlines() if not line.startswith((b'\\restrict ', b'\\unrestrict ')))

def compare_roles(expected, actual):
    if {r['rolname'] for r in expected} != {r['rolname'] for r in actual}:
        raise RuntimeError('Imported role set differs or an extra operator remains')
    actual_by_name = {r['rolname']: r for r in actual}
    for role in expected:
        current = actual_by_name[role['rolname']]
        skip = {'rolpassword'} if role['rolname'] in PASSWORD_ROLES else set()
        if {k:v for k,v in role.items() if k not in skip} != {k:v for k,v in current.items() if k not in skip}:
            raise RuntimeError('Imported role privileges/attributes differ')
        if skip and (not current.get('rolpassword') or current['rolpassword'] == role.get('rolpassword')):
            raise RuntimeError('Candidate connector credential was not replaced')

def verify(application, directory, database):
    db = candidate(application)
    if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', database) or database == 'postgres':
        raise RuntimeError('Candidate must use a separately restored database')
    directory = Path(directory).resolve()
    parent = Path('/opt/retired-deployments').resolve()
    if directory.parent != parent or not directory.name.startswith('britelink-backend-predeploy-' + application + '-') or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o077:
        raise RuntimeError('Wrong resource recovery directory')
    proof = json.loads(private_file(directory/'recovery-proof.json').read_text())
    required = ['allRestoredTableHashesMatch','fullRolePrivilegesQualified','databaseAndExtensionCatalogMatch','noExtraRestoreOperatorRoleCreated','schemaOwnershipAndGrantsMatch','fileHashesModesOwnersAndLinksMatch','sourceStorageEmpty']
    if proof.get('application') != application or not all(proof.get(k) for k in required) or proof['sourceImage'] != db['Image']:
        raise RuntimeError('Recovery receipt is not fully qualified for this target')
    dump = private_file(directory/'database.private.dump')
    if hashlib.sha256(dump.read_bytes()).hexdigest() != proof['dumpSHA256']:
        raise RuntimeError('Recovery dump checksum differs')
    settings = dict(v.split('=',1) for v in db['Config']['Env'] if '=' in v)
    password = settings.get('POSTGRES_PASSWORD','')
    if not re.fullmatch(r'[0-9a-f]{48,128}', password):
        raise RuntimeError('Candidate password is not a generated candidate credential')
    client = ['docker','exec','-i','-e','PGPASSWORD='+password,db['Id'],'psql','-h','127.0.0.1','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1']
    def sql(query): return run(client + ['-c',query])
    if int(sql("SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()").strip()):
        raise RuntimeError('Candidate has active writers before API startup')
    expected_roles = json.loads(private_file(directory/'roles-and-memberships.private.json').read_text())
    compare_roles(expected_roles['roles'],json.loads(sql(ROLES_QUERY)))
    if json.loads(sql(MEMBERS_QUERY)) != expected_roles['memberships']:
        raise RuntimeError('Imported memberships or grantors differ')
    catalog = json.loads(private_file(directory/'database-catalog.private.json').read_text())
    if json.loads(sql(CATALOG_QUERY)) != catalog:
        raise RuntimeError('Imported database/extension catalog differs')
    schema = canon(run(['docker','exec','-e','PGPASSWORD='+password,db['Id'],'pg_dump','-h','127.0.0.1','-U','supabase_admin','-d',database,'--schema-only']))
    if hashlib.sha256(schema).hexdigest() != proof['restoredSchemaSHA256']:
        raise RuntimeError('Imported schema/owners/grants differ from the parser-qualified restore')
    hashes = json.loads(private_file(directory/'table-hashes.private.json').read_text())
    tables = sql("SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename").decode().splitlines()
    if set(tables) != set(hashes):
        raise RuntimeError('Imported table identities differ')
    for table in tables:
        if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*',table):
            raise RuntimeError('Unsupported table identity')
        query='COPY (SELECT row_to_json(x)::text FROM "'+table.replace('.', '"."')+'" x ORDER BY row_to_json(x)::text) TO STDOUT;'
        rows=sql(query)
        if hashlib.sha256(rows).hexdigest()!=hashes[table]['sha256']:
            raise RuntimeError('Imported table hash differs')
    network=next(iter(db['NetworkSettings']['Networks']))
    for role in sorted(PASSWORD_ROLES):
        run(['docker','run','--rm','--pull=never','--network',network,'--entrypoint','psql','-e','PGPASSWORD='+password,db['Image'],'-h','db','-U',role,'-d',database,'-qAt','-v','ON_ERROR_STOP=1','-c','SELECT 1'])
    return {'application':application,'database':database,'databaseContainer':db['Id'],'volume':application+'-britelink-database-v1','tablesVerified':len(tables),'catalogRolesMembershipsAndSchemaMatch':True,'crossContainerCandidatePasswordsVerified':True,'sourceRecoveryDirectory':str(directory),'sourceDumpSHA256':proof['dumpSHA256'],'verifiedBeforeAPIStart':True}

def restore_candidate(application, directory, database):
    # No database is dropped or overwritten. Partial failures leave the candidate preserved.
    db=candidate(application)
    if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',database) or database=='postgres':
        raise RuntimeError('Import needs a new separate database name')
    directory=Path(directory).resolve()
    if directory.parent!=Path('/opt/retired-deployments') or not directory.name.startswith('britelink-backend-predeploy-'+application+'-') or directory.stat().st_uid!=0 or directory.stat().st_mode&0o077:
        raise RuntimeError('Import recovery directory does not belong to this resource')
    proof=json.loads(private_file(directory/'recovery-proof.json').read_text())
    checks=['allRestoredTableHashesMatch','fullRolePrivilegesQualified','databaseAndExtensionCatalogMatch','noExtraRestoreOperatorRoleCreated','schemaOwnershipAndGrantsMatch','fileHashesModesOwnersAndLinksMatch','sourceStorageEmpty']
    if proof.get('application')!=application or not all(proof.get(k) for k in checks) or proof['sourceImage']!=db['Image']:
        raise RuntimeError('Import source is not fully qualified')
    restore_archive(db,directory,database)
    return verify(application,directory,database)


def restore_archive(db, directory, database):
    """Shared SQL engine; the CLI always verifies native resource binding first.

    Called independently only by the isolated tmpfs qualification harness. This
    function does not create a resource or authorize startup/cutover.
    """
    if not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',database) or database=='postgres':
        raise RuntimeError('Import needs a new separate database name')
    directory=Path(directory)
    proof=json.loads(private_file(directory/'recovery-proof.json').read_text())
    if proof['sourceImage']!=db['Image']:
        raise RuntimeError('Import image differs from the qualified source')
    dump=private_file(directory/'database.private.dump').read_bytes()
    if hashlib.sha256(dump).hexdigest()!=proof['dumpSHA256']:
        raise RuntimeError('Import archive checksum differs')
    values=dict(v.split('=',1) for v in db['Config']['Env'] if '=' in v)
    password=values.get('POSTGRES_PASSWORD','')
    if not re.fullmatch(r'[0-9a-f]{48,128}',password):
        raise RuntimeError('Import needs generated candidate-only credentials')
    roles=json.loads(private_file(directory/'roles-and-memberships.private.json').read_text())
    rolemap={r['rolname']:r for r in roles['roles']}
    catalog=json.loads(private_file(directory/'database-catalog.private.json').read_text())
    if not rolemap['supabase_admin']['rolsuper'] or any(e['owner']!='supabase_admin' for e in catalog['extensions']):
        raise RuntimeError('This import requires the qualified single extension-owner topology')
    quote=lambda value:'"'+value.replace('"','""')+'"'
    prefix=['docker','exec','-i','-e','PGPASSWORD='+password,db['Id']]
    control=prefix+['psql','-h','127.0.0.1','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1']
    databases=run(control+['-c','SELECT datname FROM pg_database']).decode().splitlines()
    if database in databases:
        raise RuntimeError('Import destination already exists; refusing overwrite')
    if int(run(control+['-c',"SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()"]).strip()):
        raise RuntimeError('Import destination has another active database client')
    existing=set(run(control+['-c','SELECT rolname FROM pg_roles']).decode().splitlines())
    lines=[]
    for line in private_file(directory/'global-roles.private.sql').read_text().splitlines():
        match=re.fullmatch(r'CREATE ROLE (.+);',line)
        if match:
            name=match.group(1)
            plain=name[1:-1].replace('""','"') if name.startswith('"') else name
            if plain in existing:continue
        lines.append(line)
    run(control,'\n'.join(lines).encode())
    actual_members=json.loads(run(control+['-c',MEMBERS_QUERY]))
    revokes=['REVOKE '+quote(m['role'])+' FROM '+quote(m['member'])+';' for m in actual_members]
    temporary=sorted({m['grantor'] for m in roles['memberships'] if not rolemap[m['grantor']]['rolsuper']})
    statements=['ALTER ROLE '+quote(name)+' SUPERUSER;' for name in temporary]+revokes
    for member in roles['memberships']:
        statements.extend(['SET SESSION AUTHORIZATION '+quote(member['grantor'])+';',
            'GRANT '+quote(member['role'])+' TO '+quote(member['member'])+(' WITH ADMIN OPTION' if member['admin'] else '')+';',
            'RESET SESSION AUTHORIZATION;'])
    statements.extend('ALTER ROLE '+quote(name)+' NOSUPERUSER;' for name in temporary)
    run(control,'\n'.join(statements).encode())
    if json.loads(run(control+['-c',ROLES_QUERY]))!=roles['roles'] or json.loads(run(control+['-c',MEMBERS_QUERY]))!=roles['memberships']:
        raise RuntimeError('Imported source role attributes/memberships differ')
    run(prefix+['createdb','-h','127.0.0.1','-U','supabase_admin','--template=template0','--owner='+catalog['databaseOwner'],database])
    client=prefix+['psql','-h','127.0.0.1','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1']
    source_schema=private_file(directory/'source-schema.private.sql').read_text()
    eventowners=[]
    for owner in re.findall(r'^ALTER EVENT TRIGGER .+ OWNER TO (.+);$',source_schema,re.M):
        name=owner[1:-1].replace('""','"') if owner.startswith('"') else owner
        if name not in rolemap:raise RuntimeError('Unknown event-trigger owner')
        if not rolemap[name]['rolsuper']:eventowners.append(name)
    eventowners=sorted(set(eventowners))
    if eventowners:run(control,'\n'.join('ALTER ROLE '+quote(name)+' SUPERUSER;' for name in eventowners).encode())
    toc=run(prefix+['pg_restore','--list'],dump).splitlines()
    deferred=[line for line in toc if not line.startswith(b';') and b' ACL ' in line and b'graphql_public' in line and b'graphql(' in line]
    if len(deferred)!=1:raise RuntimeError('Unexpected GraphQL ACL layout')
    filtered=b'\n'.join(b';'+line if line in deferred else line for line in toc)
    acl=b'\n'.join(line if line in deferred or line.startswith(b';') else b';'+line for line in toc)
    run(prefix+['sh','-c','umask 077; cat > /tmp/britelink-import-filtered.list'],filtered)
    run(prefix+['sh','-c','umask 077; cat > /tmp/britelink-import-graphql.list'],acl)
    restore=prefix+['pg_restore','-h','127.0.0.1','-U','supabase_admin','-d',database,'--exit-on-error','--use-list=/tmp/britelink-import-filtered.list']
    run(restore+['--section=pre-data'],dump)
    missing=run(client+['-c',"SELECT to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NULL"]).strip()==b't'
    if missing:
        function=private_file(directory/'graphql-extension-function.private.sql').read_text()
        run(client,(function+';\nALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO supabase_admin;\nALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);').encode())
    run(restore+['--section=data'],dump);run(restore+['--section=post-data'],dump)
    run(prefix+['pg_restore','-h','127.0.0.1','-U','supabase_admin','-d',database,'--exit-on-error','--use-list=/tmp/britelink-import-graphql.list'],dump)
    if eventowners:run(control,'\n'.join('ALTER ROLE '+quote(name)+' NOSUPERUSER;' for name in eventowners).encode())
    if json.loads(run(control+['-c',ROLES_QUERY]))!=roles['roles'] or json.loads(run(control+['-c',MEMBERS_QUERY]))!=roles['memberships']:
        raise RuntimeError('Import changed role ownership or grants')
    # The shared candidate password is used by the role job AND all three API connectors.
    run(control,'\n'.join('ALTER ROLE '+quote(role)+" PASSWORD '"+password+"';" for role in sorted(PASSWORD_ROLES)).encode())

def main():
    os.umask(0o077)
    if os.geteuid()!=0 or run(['hostname']).decode().strip()!='vps.ashbi.ca':
        raise RuntimeError('Candidate bootstrap requires the selected VPS root context')
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['import','verify','start'])
    parser.add_argument('application');parser.add_argument('backup_directory');parser.add_argument('database')
    args=parser.parse_args()
    receipt=restore_candidate(args.application,args.backup_directory,args.database) if args.mode=='import' else verify(args.application,args.backup_directory,args.database)
    if args.mode=='start':
        manifest=Path('docker-compose.coolify-backend-candidate.json').resolve()
        config=json.loads(run(['docker','compose','--project-name',args.application,'--project-directory',str(manifest.parent),'-f',str(manifest),'--env-file',str(private_file(manifest.parent/'.env')),'--profile','api','config','--format','json']))
        if set(config['services'])!={'db','db-roles','auth','rest','storage','gateway'} or not all(n.get('internal') for n in config['networks'].values()):
            raise RuntimeError('Startup topology is not the private six-service candidate')
        if any(s.get('ports') or s.get('build') or s.get('pull_policy')!='never' or s.get('network_mode') or set(s.get('networks',{}))!={'backend'} for s in config['services'].values()):
            raise RuntimeError('Candidate startup would publish ports, pull or build')
        if config['services']['auth']['environment'].get('GOTRUE_DISABLE_SIGNUP')!='true' or config['services']['auth']['environment'].get('GOTRUE_SITE_URL')!='http://gateway:8000':
            raise RuntimeError('Startup is not the synthetic private candidate configuration')
        if any(k.startswith('GOTRUE_SMTP') for k in config['services']['auth']['environment']):
            raise RuntimeError('Candidate startup includes SMTP settings')
        if config['volumes']['database']['name']!=receipt['volume'] or config['volumes']['files']['name']!=args.application+'-britelink-files-v1':
            raise RuntimeError('Startup would use a different volume')
        reviewed=json.loads(Path(__file__).with_name('reviewed-images.json').read_text())
        for role in ['db','auth','rest','storage','gateway']:
            if config['services'][role]['image']!=reviewed[role]['candidateImage']:
                raise RuntimeError('Startup image differs from the runtime-qualified original')
        db=candidate(args.application)
        password=dict(value.split('=',1) for value in db['Config']['Env'] if '=' in value)['POSTGRES_PASSWORD']
        source_records=json.loads(private_file(Path(args.backup_directory)/'stack-inspect.private.json').read_text())
        validate_startup_credentials(config,password,args.database,source_records)
        validate_files_volume(args.application)
        run(['docker','compose','--project-name',args.application,'--project-directory',str(manifest.parent),'-f',str(manifest),'--env-file',str(manifest.parent/'.env'),'--profile','api','up','--detach','--no-build','--pull','never'])
        receipt['apiStartupRequested']=True
    print(json.dumps(receipt))

if __name__=='__main__':
    try: main()
    except Exception:
        print('Candidate import verification/startup failed; no production cutover is authorized',file=sys.stderr)
        sys.exit(1)
