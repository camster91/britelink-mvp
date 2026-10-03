#!/usr/bin/env python3
"""Host-side verified BriteLink backup guard. Never print credentials or records."""
import json

REQUIRED_ROLES = ('db', 'auth', 'rest', 'storage', 'gateway')
LEGACY = {role: 'britelink-production-' + role + '-1' for role in REQUIRED_ROLES}

def select_stack(containers, application):
    candidates = [c for c in containers if (c['Config'].get('Labels') or {}).get('com.docker.compose.project') == application]
    if candidates:
        records = {}
        for role in REQUIRED_ROLES:
            matches = [c for c in candidates if (c['Config'].get('Labels') or {}).get('com.docker.compose.service') == role]
            if len(matches) != 1 or not matches[0]['State']['Running']:
                raise RuntimeError('Native backend is incomplete, stopped or ambiguous; legacy fallback refused')
            records[role] = matches[0]
        return records
    records = {}
    for role, name in LEGACY.items():
        matches = [c for c in containers if c['Name'].lstrip('/') == name]
        if len(matches) != 1 or not matches[0]['State']['Running']:
            raise RuntimeError('Legacy backend is missing, stopped or ambiguous')
        records[role] = matches[0]
    return records

def main():
    import datetime,hashlib,json,os,pathlib,re,secrets,subprocess,time,sys,traceback,tarfile,urllib.parse
    os.umask(0o077)
    folder=None
    def run(args,data=None):
        p=subprocess.run(args,input=data,capture_output=True)
        if p.returncode:
            if folder is not None:
                (folder/'failed-command.private.json').write_text(json.dumps({'command':args,'exitCode':p.returncode,'stderr':p.stderr.decode(errors='replace')}))
            raise RuntimeError('BriteLink PostgreSQL recovery command failed: '+args[0]+(' '+args[1] if len(args)>1 else '')+'; private diagnostics withheld')
        return p.stdout
    assert run(['hostname']).decode().strip()=='vps.ashbi.ca'
    application=sys.argv[1]
    assert re.fullmatch(r'[a-z0-9]{20,40}',application),'Invalid Coolify resource identity'
    php="require '/var/www/html/vendor/autoload.php'; $app=require '/var/www/html/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $r=App\\Models\\Application::where('uuid',$argv[1])->sole(); echo json_encode(['repository'=>$r->git_repository,'compose'=>$r->docker_compose_location]);"
    owner=json.loads(run(['docker','exec','coolify','php','-r',php,application]))
    assert owner=={'repository':'camster91/britelink-mvp','compose':'/docker-compose.coolify-backend-candidate.json'},'Resource is not the reviewed BriteLink backend candidate'
    ids=run(['docker','ps','-aq']).decode().split()
    containers=json.loads(run(['docker','inspect']+ids))
    records=select_stack(containers,application)
    db=records['db'];source=db['Id']
    assert any(m['Destination']=='/var/lib/postgresql/data' for m in db['Mounts'])
    settings=dict(s.split('=',1) for s in db['Config']['Env'] if '=' in s)
    user=settings.get('POSTGRES_USER','supabase_admin')
    connections=[]
    for role,key in [('auth','DATABASE_URL'),('rest','PGRST_DB_URI'),('storage','DATABASE_URL')]:
        values=dict(v.split('=',1) for v in records[role]['Config']['Env'] if '=' in v)
        url=urllib.parse.urlsplit(values[key])
        assert url.scheme in ('postgres','postgresql') and url.hostname=='db','Unexpected backend database target'
        assert set(records[role]['NetworkSettings']['Networks'])&set(db['NetworkSettings']['Networks']),'Database and consumer do not share a network'
        connections.append(url.path.lstrip('/'))
    assert len(set(connections))==1,'Backend services use different databases'
    database=connections[0]
    assert re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',user) and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',database)
    volume_names=set(run(['docker','volume','ls','-q']).decode().splitlines())
    running_ids=[records[r]['Id'] for r in REQUIRED_ROLES]
    before={r['Id']:{'image':r['Image'],'startedAt':r['State']['StartedAt']} for r in json.loads(run(['docker','inspect']+running_ids))}
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder=pathlib.Path('/opt/retired-deployments')/('britelink-backend-predeploy-'+application+'-'+stamp)
    folder.mkdir(mode=0o700)
    sys.excepthook=lambda kind,value,tb:(folder/'failure-trace.private.log').write_text(''.join(traceback.format_exception(kind,value,tb)))
    (folder/'source-inspect.private.json').write_text(json.dumps(db))
    (folder/'global-roles.private.sql').write_bytes(run(['docker','exec',source,'sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dumpall -U "$1" --globals-only','sh',user]))
    sourcePrefix=['docker','exec','-i',source,'sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','sh']
    client=sourcePrefix+['psql','-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1']
    broker=subprocess.Popen(client,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    fixture='britelink-pg-restore-'+secrets.token_hex(6)
    started=False
    baseline={}
    try:
        broker.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');broker.stdin.flush()
        snapshot=broker.stdout.readline().decode().strip()
        assert re.fullmatch(r'[0-9A-Fa-f-]+',snapshot),'Snapshot export failed'
        def snapshot_sql(sql):
            return run(client,('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT \''+snapshot+'\'; '+sql+'; COMMIT;').encode())
        tables=snapshot_sql("SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename").decode().splitlines()
        assert tables and all(re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*',t) for t in tables)
        dump=run(sourcePrefix+['pg_dump','-U',user,'-d',database,'--format=custom','--snapshot='+snapshot])
        (folder/'database.private.dump').write_bytes(dump)
        run(['docker','exec','-i',source,'pg_restore','--list'],dump)
        for table in tables:
            sql='COPY (SELECT row_to_json(x)::text FROM "'+table.replace('.', '"."')+'" x ORDER BY row_to_json(x)::text) TO STDOUT'
            rows=snapshot_sql(sql)
            baseline[table]={'sha256':hashlib.sha256(rows).hexdigest(),'rows':len(rows.splitlines())}
        def canon(data):
            return b'\n'.join(line for line in data.splitlines() if not line.startswith((b'\\restrict ',b'\\unrestrict ')))
        sourceSchema=canon(run(sourcePrefix+['pg_dump','-U',user,'-d',database,'--schema-only','--snapshot='+snapshot]))
        rolesQuery="SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY rolname) FROM pg_authid r"
        membersQuery="SELECT coalesce(jsonb_agg(jsonb_build_object('role',a.rolname,'member',b.rolname,'grantor',g.rolname,'admin',m.admin_option) ORDER BY a.rolname,b.rolname,g.rolname),'[]'::jsonb) FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor"
        sourceRoles=json.loads(run(client+['-c',rolesQuery]))
        sourceMembers=json.loads(run(client+['-c',membersQuery]))
        assert int(run(client+['-c',"SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')"]).strip())==0
        roleNames=[r['rolname'] for r in sourceRoles]
        operator='ashbi_restore_operator'
        assert operator not in roleNames
        (folder/'roles-and-memberships.private.json').write_text(json.dumps({'roles':sourceRoles,'memberships':sourceMembers}))
        image=json.loads(run(['docker','image','inspect',db['Image']]))[0]
        fixturePassword=secrets.token_hex(24)
        restoreUser='supabase_admin'
        restoreDB='britelink_restore'
        run(['docker','run','-d','--pull=never','--name',fixture,'--network','none','--memory','1g','--cpus','2','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-e','POSTGRES_USER='+restoreUser,'-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD='+fixturePassword,image['Id']]);started=True
        for _ in range(45):
            ready=subprocess.run(['docker','exec',fixture,'pg_isready','-U',restoreUser,'-d','postgres'],capture_output=True).returncode==0
            logs=subprocess.run(['docker','logs',fixture],capture_output=True)
            final=b'PostgreSQL init process complete' in logs.stdout+logs.stderr
            if ready and final:break
            time.sleep(1)
        else:raise RuntimeError('Isolated PostgreSQL restore did not become ready')
        initial=['docker','exec','-i','-e','PGPASSWORD='+fixturePassword,fixture,'psql','-U',restoreUser,'-d','postgres','-v','ON_ERROR_STOP=1']
        run(initial,('CREATE ROLE '+operator+" LOGIN SUPERUSER PASSWORD '"+fixturePassword+"';").encode())
        fixturePrefix=['docker','exec','-i','-e','PGPASSWORD='+fixturePassword,fixture]
        fclient=fixturePrefix+['psql','-h','127.0.0.1','-U',operator,'-d','postgres','-qAt','-v','ON_ERROR_STOP=1']
        existing=set(run(fclient+['-c','SELECT rolname FROM pg_roles']).decode().splitlines())
        fixtureMembers=json.loads(run(fclient+['-c',membersQuery]))
        quote=lambda name:'"'+name.replace('"','""')+'"'
        revokes=['REVOKE '+quote(m['role'])+' FROM '+quote(m['member'])+';' for m in fixtureMembers if m['role'] in roleNames and m['member'] in roleNames]
        if revokes:run(fclient,'\n'.join(revokes).encode())
        globalsSQL=(folder/'global-roles.private.sql').read_text()
        lines=[]
        for line in globalsSQL.splitlines():
            match=re.fullmatch(r'CREATE ROLE (.+);',line)
            if match:
                role=match.group(1)
                plain=role[1:-1].replace('""','"') if role.startswith('"') else role
                if plain in existing:continue
            lines.append(line)
        run(fclient,'\n'.join(lines).encode())
        restoredRoles=json.loads(run(fclient+['-c',rolesQuery]))
        restoredRoles=[r for r in restoredRoles if r['rolname'] in roleNames]
        restoredMembers=json.loads(run(fclient+['-c',membersQuery]))
        restoredMembers=[m for m in restoredMembers if m['role'] in roleNames and m['member'] in roleNames]
        assert restoredRoles==sourceRoles,'Role attributes or password hashes differ'
        if restoredMembers!=sourceMembers:
            # pg_dumpall replays membership as the executing operator. Preserve original grantors
            # through the public SQL authorization mechanism; no catalog writes or weakened checks.
            sourceRoleMap={r['rolname']:r for r in sourceRoles}
            temporaryGrantors=sorted({m['grantor'] for m in sourceMembers if not sourceRoleMap[m['grantor']]['rolsuper']})
            replay=['ALTER ROLE '+quote(role)+' SUPERUSER;' for role in temporaryGrantors]
            for member in sourceMembers:
                replay.extend([
                    'REVOKE '+quote(member['role'])+' FROM '+quote(member['member'])+';',
                    'SET SESSION AUTHORIZATION '+quote(member['grantor'])+';',
                    'GRANT '+quote(member['role'])+' TO '+quote(member['member'])+(' WITH ADMIN OPTION' if member['admin'] else '')+';',
                    'RESET SESSION AUTHORIZATION;'
                ])
            replay.extend('ALTER ROLE '+quote(role)+' NOSUPERUSER;' for role in temporaryGrantors)
            run(fclient,'\n'.join(replay).encode())
            restoredMembers=json.loads(run(fclient+['-c',membersQuery]))
            restoredMembers=[m for m in restoredMembers if m['role'] in roleNames and m['member'] in roleNames]
        assert restoredMembers==sourceMembers,'Role membership/grantor attributes differ'
        restoredRoles=[r for r in json.loads(run(fclient+['-c',rolesQuery])) if r['rolname'] in roleNames]
        assert restoredRoles==sourceRoles,'Role attributes after grantor replay differ'
        run(fixturePrefix+['createdb','-h','127.0.0.1','-U',operator,'--template=template0',restoreDB])
        eventOwners=snapshot_sql('SELECT DISTINCT r.rolname FROM pg_event_trigger e JOIN pg_roles r ON r.oid=e.evtowner WHERE NOT r.rolsuper ORDER BY r.rolname').decode().splitlines()
        assert all(role in roleNames for role in eventOwners)
        if eventOwners:run(fclient,'\n'.join('ALTER ROLE '+quote(role)+' SUPERUSER;' for role in eventOwners).encode())
        restoreCommand=fixturePrefix+['pg_restore','-h','127.0.0.1','-U',operator,'-d',restoreDB,'--exit-on-error']
        toc=run(fixturePrefix+['pg_restore','--list'],dump).splitlines()
        deferred=[line for line in toc if not line.startswith(b';') and b' ACL ' in line and b'graphql_public' in line and b'graphql(' in line]
        assert len(deferred)==1,'Unexpected GraphQL ACL archive entries'
        filtered=b'\n'.join(b';'+line if line in deferred else line for line in toc)
        onlyGraphqlACL=b'\n'.join(line if line in deferred or line.startswith(b';') else b';'+line for line in toc)
        run(fixturePrefix+['sh','-c','umask 077; cat > /tmp/restore-filtered.list'],filtered)
        run(fixturePrefix+['sh','-c','umask 077; cat > /tmp/restore-graphql-acl.list'],onlyGraphqlACL)
        restoreCommand+=['--use-list=/tmp/restore-filtered.list']
        run(restoreCommand+['--section=pre-data'],dump)
        restoreClient=fixturePrefix+['psql','-h','127.0.0.1','-U',operator,'-d',restoreDB,'-qAt','-v','ON_ERROR_STOP=1']
        graphqlMissing=run(restoreClient+['-c',"SELECT to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NULL"]).strip()==b't'
        if graphqlMissing:
            q="SELECT json_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'extension',x.extname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner JOIN pg_depend d ON d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e' JOIN pg_extension x ON x.oid=d.refobjid WHERE n.nspname='graphql_public' AND p.proname='graphql' AND p.oid='graphql_public.graphql(text,text,jsonb,jsonb)'::regprocedure"
            function=json.loads(snapshot_sql(q))
            assert function['extension']=='pg_graphql' and function['owner']=='supabase_admin'
            definition=function['definition']
            (folder/'graphql-extension-function.private.sql').write_text(definition)
            run(restoreClient,(definition+';\nALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO '+quote(function['owner'])+';\nALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);').encode())
        run(restoreCommand+['--section=data'],dump)
        run(restoreCommand+['--section=post-data'],dump)
        run(fixturePrefix+['pg_restore','-h','127.0.0.1','-U',operator,'-d',restoreDB,'--exit-on-error','--use-list=/tmp/restore-graphql-acl.list'],dump)
        if eventOwners:run(fclient,'\n'.join('ALTER ROLE '+quote(role)+' NOSUPERUSER;' for role in eventOwners).encode())
        restoredRoles=[r for r in json.loads(run(fclient+['-c',rolesQuery])) if r['rolname'] in roleNames]
        assert restoredRoles==sourceRoles,'Role attributes after full schema restore differ'
        restoredSchema=canon(run(fixturePrefix+['pg_dump','-h','127.0.0.1','-U',operator,'-d',restoreDB,'--schema-only']))
        rawSchemaHashesMatch=restoredSchema==sourceSchema
        normalizedCheckCount=0
        if not rawSchemaHashesMatch:
            (folder/'source-schema.private.sql').write_bytes(sourceSchema)
            (folder/'restored-schema.private.sql').write_bytes(restoredSchema)
            q="SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'table',t.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid,false),'validated',c.convalidated,'noinherit',c.connoinherit) ORDER BY n.nspname,t.relname,c.conname),'[]'::json) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='c' AND n.nspname NOT IN ('pg_catalog','information_schema')"
            sourceChecks=json.loads(snapshot_sql(q))
            restoredChecks=json.loads(run(restoreClient+['-c',q]))
            key=lambda c:(c['schema'],c['table'],c['name'])
            sourceCheckMap={key(c):c for c in sourceChecks}
            restoredCheckMap={key(c):c for c in restoredChecks}
            assert sourceCheckMap.keys()==restoredCheckMap.keys(),'Check constraint identities differ'
            normalized=sourceSchema
            for identity,original in sourceCheckMap.items():
                restored=restoredCheckMap[identity]
                if original==restored:continue
                assert {k:v for k,v in original.items() if k!='definition'}=={k:v for k,v in restored.items() if k!='definition'},'Check constraint validation or inheritance differs'
                assert original['definition'].startswith('CHECK ') and restored['definition'].startswith('CHECK ')
                probe='ashbi_restore_check_'+secrets.token_hex(5)
                table=quote(original['schema'])+'.'+quote(original['table'])
                run(restoreClient,('ALTER TABLE '+table+' ADD CONSTRAINT '+quote(probe)+' '+original['definition']+';').encode())
                comparison="SELECT json_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid,false),'tree',regexp_replace(c.conbin::text,':location -?[0-9]+',':location -1','g')) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='"+original['schema']+"' AND t.relname='"+original['table']+"' AND c.conname IN ('"+original['name']+"','"+probe+"') ORDER BY c.conname"
                compared=[json.loads(line) for line in run(restoreClient+['-c',comparison]).decode().splitlines()]
                assert len(compared)==2 and compared[0]['tree']==compared[1]['tree'] and compared[0]['definition']==compared[1]['definition'],'Reparsed CHECK expression semantics differ'
                run(restoreClient,('ALTER TABLE '+table+' DROP CONSTRAINT '+quote(probe)+';').encode())
                assert original['definition'].encode() in normalized
                normalized=normalized.replace(original['definition'].encode(),restored['definition'].encode())
                normalizedCheckCount+=1
            assert normalizedCheckCount>0 and normalized==restoredSchema,'Schema differences extend beyond the two parser-qualified CHECK normalizations'
            (folder/'check-normalization-proof.private.json').write_text(json.dumps({'checksCompared':len(sourceChecks),'normalizedChecks':normalizedCheckCount,'originalDefinitionsReparsedInRestoreDB':True,'ExpressionTreesMatchAfterLocationNormalization':True,'allOtherSchemaBytesMatch':True}))
        assert json.loads(run(client+['-c',rolesQuery]))==sourceRoles and json.loads(run(client+['-c',membersQuery]))==sourceMembers,'Live roles changed during qualification'
        for table,expected in baseline.items():
            sql='COPY (SELECT row_to_json(x)::text FROM "'+table.replace('.', '"."')+'" x ORDER BY row_to_json(x)::text) TO STDOUT;'
            rows=run(['docker','exec','-i','-e','PGPASSWORD='+fixturePassword,fixture,'psql','-h','127.0.0.1','-U',operator,'-d',restoreDB,'-qAt','-v','ON_ERROR_STOP=1'],sql.encode())
            assert hashlib.sha256(rows).hexdigest()==expected['sha256'],'Restored table hash mismatch'
    finally:
        if broker.poll() is None:
            broker.stdin.write(b'ROLLBACK;\n');broker.stdin.close();broker.wait(timeout=15)
        if started:run(['docker','rm','-f',fixture])
    assert subprocess.run(['docker','inspect',fixture],capture_output=True).returncode!=0
    retained=[]
    for role in REQUIRED_ROLES:
        record=records[role]
        original=json.loads(run(['docker','image','inspect',record['Image']]))[0]
        base='ashbi-recovery/britelink-backend-'+role+'-source:'+stamp.lower()
        tag='ashbi-recovery/britelink-backend-'+role+':'+stamp.lower()
        run(['docker','tag',record['Image'],base])
        run(['docker','build','--pull=false','--network=none','-t',tag,'-'],('FROM '+base+'\nLABEL coolify.managed="true" ashbi.recovery="britelink-backend"\n').encode())
        protected=json.loads(run(['docker','image','inspect',tag]))[0]
        assert protected['RootFS']['Layers']==original['RootFS']['Layers']
        retained.append({'role':role,'sourceImage':record['Image'],'protectedImage':protected['Id'],'protectedTag':tag,'rootFSLayersMatch':True})
        if role=='db':databaseProtected=protected;databaseTag=tag
    # Preserve all non-database mounts/configuration privately. Verify files/modes/links and
    # source stability around archiving; this is not a coordinated single-writer cutover.
    archivePath=folder/'files-config.private.tar'
    def manifest(root):
        result={}
        paths=[root]+(list(root.rglob('*')) if root.is_dir() and not root.is_symlink() else [])
        for p in paths:
            relative='.' if p==root else str(p.relative_to(root))
            info=p.lstat()
            if p.is_symlink():result[relative]={'kind':'link','target':os.readlink(p),'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}
            elif p.is_file():result[relative]={'kind':'file','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}
            elif p.is_dir():result[relative]={'kind':'directory','mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}
            else:raise RuntimeError('Unsupported backup mount member')
        return result
    mounts=[];seen=set()
    for role in REQUIRED_ROLES:
        if role=='db':continue
        for mount in records[role]['Mounts']:
            path=pathlib.Path(mount['Source'])
            if path in seen:continue
            seen.add(path);mounts.append((path,manifest(path)))
    with tarfile.open(archivePath,'w') as archive:
        for index,(path,_) in enumerate(mounts):archive.add(path,arcname='mount-'+str(index),recursive=True)
    with tarfile.open(archivePath,'r') as archive:
        expectedCount=sum(len(m) for _,m in mounts)
        assert len(archive.getmembers())==expectedCount,'Unexpected archive member count'
        for index,(path,expected) in enumerate(mounts):
            assert manifest(path)==expected,'Source file changed during backup'
            for relative,info in expected.items():
                name='mount-'+str(index)+('' if relative=='.' else '/'+relative)
                member=archive.getmember(name)
                assert member.mode==info['mode'] and member.uid==info['uid'] and member.gid==info['gid']
                if info['kind']=='file':assert member.isfile() and hashlib.sha256(archive.extractfile(member).read()).hexdigest()==info['sha256']
                elif info['kind']=='link':assert member.issym() and member.linkname==info['target']
                else:assert member.isdir()
    protected=databaseProtected;tag=databaseTag
    (folder/'stack-inspect.private.json').write_text(json.dumps(records))
    assert volume_names==set(run(['docker','volume','ls','-q']).decode().splitlines())
    after={r['Id']:r for r in json.loads(run(['docker','inspect']+running_ids))}
    assert all(after[k]['State']['Running'] and after[k]['Image']==v['image'] and after[k]['State']['StartedAt']==v['startedAt'] for k,v in before.items())
    (folder/'table-hashes.private.json').write_text(json.dumps(baseline,indent=2))
    proof={'backupDirectory':str(folder),'sourceImage':db['Image'],'protectedImage':protected['Id'],'protectedTag':tag,'rootFSLayersMatch':True,'consistentExportedSnapshot':True,'applicationSchemas':['auth','public','storage','vault'],'roleNamesPreparedForRestore':True,'fullRolePrivilegesQualified':True,'roleAttributesAndPasswordHashesMatch':True,'roleMembershipsAndGrantorsMatch':True,'schemaOwnershipAndGrantsMatch':True,'sourceRoleCount':len(sourceRoles),'sourceMembershipCount':len(sourceMembers),'fullSchemaSHA256':hashlib.sha256(sourceSchema).hexdigest(),'restoredSchemaSHA256':hashlib.sha256(restoredSchema).hexdigest(),'rawSchemaHashesMatch':rawSchemaHashesMatch,'parserQualifiedCheckNormalizations':normalizedCheckCount,'allOtherSchemaBytesMatch':True,'sourceRoleAttributesUnchanged':True,'graphqlExtensionOwnedFunctionRecreated':graphqlMissing,'temporaryFixtureOnlyGrantorElevationRemoved':True,'temporaryFixtureOnlyEventOwnerElevationRemoved':True,'allApplicationTables':len(baseline),'totalSnapshotRows':sum(v['rows'] for v in baseline.values()),'allRestoredTableHashesMatch':True,'dumpBytes':len(dump),'dumpSHA256':hashlib.sha256(dump).hexdigest(),'globalRolesSavedPrivately':True,'databaseVolumeRetained':True,'allDockerVolumesRetained':True,'volumeCount':len(volume_names),'productionBackendContainerStatesUnchanged':True,'fixtureRemoved':True,'liveDatabaseStopped':False,'liveDatabaseOrConsumerConfigurationChanged':False,'candidateProvisioned':False,'application':application,'retainedStackImages':retained,'filesConfigArchiveSHA256':hashlib.sha256(archivePath.read_bytes()).hexdigest(),'fileHashesModesOwnersAndLinksMatch':True,'nonDatabaseMountsArchived':len(mounts),'sourceBuildPerformed':False}
    (folder/'recovery-proof.json').write_text(json.dumps(proof,indent=2))
    assert folder.stat().st_mode&0o077==0 and all(p.stat().st_mode&0o077==0 for p in folder.iterdir())
    print(json.dumps(proof))

if __name__ == '__main__':
    main()
