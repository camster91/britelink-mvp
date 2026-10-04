#!/usr/bin/env python3
"""Host-side production adoption. Run only through its bound Coolify hooks."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time

ROLES = ('db', 'auth', 'rest', 'storage', 'gateway')
NAMES = {role: 'britelink-production-' + role + '-1' for role in ROLES}
VOLUMES = {'db': 'britelink-production_db-data', 'storage': 'britelink-production_storage-data'}


def validate_receipt(receipt, application, digest, now):
    if receipt.get('application') != application or receipt.get('configDigest') != digest or not 0 <= now - receipt.get('verifiedAt', 0) <= 1800:
        raise RuntimeError('Current deployment lacks a fresh verified backup')


def validate_config(config, baseline, application, application_id):
    if set(config['services']) != set(ROLES):
        raise RuntimeError('Unexpected production services')
    if set(config['networks']) != {'backend'} or config['networks']['backend'].get('external') or config['networks']['backend'].get('internal'):
        raise RuntimeError('Production requires its own outbound-capable backend network')
    for role, service in config['services'].items():
        original = baseline[role]
        if service.get('privileged') or service.get('cap_add') or service.get('devices') or service.get('pid') or service.get('ipc') or service.get('volumes_from'):
            raise RuntimeError('Production service privileges changed')
        if service['image'] != original['Image'] or service.get('build') or service.get('pull_policy') != 'never':
            raise RuntimeError('Production image or build policy changed')
        if service.get('container_name') != NAMES[role] or set(service.get('networks', {})) != {'backend'} or service.get('network_mode'):
            raise RuntimeError('Production service identity changed')
        if str(service.get('labels', {}).get('coolify.applicationId')) != str(application_id):
            raise RuntimeError('Production application label changed')
        expected_env = dict(v.split('=', 1) for v in original['Config']['Env'] if '=' in v and not v.startswith('COOLIFY_'))
        actual_env = {k: v for k, v in service['environment'].items() if not k.startswith('COOLIFY_')}
        if actual_env != expected_env:
            raise RuntimeError('Production login/provider/runtime settings changed')
        for config_key, docker_key in [('command', 'Cmd'), ('entrypoint', 'Entrypoint')]:
            if service.get(config_key) != original['Config'].get(docker_key):
                raise RuntimeError('Production startup command changed')
        mounts = service.get('volumes', [])
        if len(mounts) != len(original['Mounts']):
            raise RuntimeError('Production mount set changed')
        for mount in original['Mounts']:
            matches = [v for v in mounts if v['target'] == mount['Destination']]
            if len(matches) != 1:
                raise RuntimeError('Production mount is ambiguous')
            proposed = matches[0]
            if proposed['type'] != mount['Type'] or bool(proposed.get('read_only')) != (not mount['RW']):
                raise RuntimeError('Production mount access changed')
            if mount['Type'] == 'volume':
                volume = config['volumes'][proposed['source']]
                if not volume.get('external') or volume.get('name') != VOLUMES[role] or mount.get('Name') != VOLUMES[role]:
                    raise RuntimeError('Production volume ownership changed')
            elif mount['Type'] != 'bind' or proposed['source'] != mount['Source']:
                raise RuntimeError('Production gateway bind changed')
        ports = service.get('ports', [])
        if role == 'gateway':
            if len(ports) != 1 or ports[0]['target'] != 8000 or str(ports[0]['published']) != '8098' or ports[0].get('host_ip') != '127.0.0.1':
                raise RuntimeError('Production API binding changed')
        elif ports:
            raise RuntimeError('Internal production service exposed')


def main():
    os.umask(0o077)
    operation, application, application_id, directory = sys.argv[1:]
    if operation not in ('backup', 'start') or not re.fullmatch('[a-z0-9]{20,40}', application) or not application_id.isdigit():
        raise RuntimeError('Invalid production hook arguments')
    folder = pathlib.Path(directory)
    if str(folder) != '/data/coolify/applications/' + application or folder.is_symlink() or folder.stat().st_uid != 0:
        raise RuntimeError('Unexpected production workdir')
    folder.chmod(0o700)
    import fcntl
    lock = open(folder / 'production-deployment.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX)
    env_file = folder / '.env'
    if env_file.is_symlink() or env_file.stat().st_uid != 0:
        raise RuntimeError('Unexpected production environment file')
    env_file.chmod(0o600)

    def run(args):
        result = subprocess.run(args, capture_output=True)
        if result.returncode:
            (folder / 'production-failure.private.log').write_bytes(result.stderr)
            raise RuntimeError('Production command failed; private diagnostics withheld')
        return result.stdout

    if run(['hostname']).decode().strip() != 'vps.ashbi.ca':
        raise RuntimeError('Unexpected production host')
    compose = ['docker', 'compose', '--env-file', str(env_file), '--project-name', application, '-f', str(folder / 'docker-compose.yaml')]
    config = json.loads(run(compose + ['config', '--format', 'json']))
    ids = run(['docker', 'ps', '-aq']).decode().split()
    records = json.loads(run(['docker', 'inspect'] + ids))
    current = {role: next((c for c in records if c['Name'].lstrip('/') == name), None) for role, name in NAMES.items()}
    baseline_file = folder / 'production-baseline.private.json'
    if baseline_file.exists():
        if baseline_file.is_symlink() or baseline_file.stat().st_uid != 0 or baseline_file.stat().st_mode & 0o077:
            raise RuntimeError('Production baseline permissions changed')
        baseline = json.loads(baseline_file.read_text())
    else:
        if operation != 'backup' or not all(current.values()):
            raise RuntimeError('Original production baseline unavailable')
        for c in current.values():
            if not c['State']['Running'] or c['Config']['Labels'].get('com.docker.compose.project') != 'britelink-production':
                raise RuntimeError('Initial baseline is not the original production stack')
        baseline = current
    validate_config(config, baseline, application, application_id)
    expected_volumes = set(VOLUMES.values())
    for c in records:
        if any(m.get('Name') in expected_volumes for m in c['Mounts']) and c['State']['Running']:
            if c not in current.values():
                raise RuntimeError('Unexpected concurrent production volume consumer')
    for role, c in current.items():
        if c:
            labels = c['Config']['Labels']
            if labels.get('com.docker.compose.project') not in ('britelink-production', application) or labels.get('com.docker.compose.service') != role:
                raise RuntimeError('Production container name collision')
            if labels.get('com.docker.compose.project') == application and str(labels.get('coolify.applicationId')) != application_id:
                raise RuntimeError('Production container owner mismatch')
            if c['Image'] != baseline[role]['Image']:
                raise RuntimeError('Production runtime image drift')
            actual_env = dict(v.split('=', 1) for v in c['Config']['Env'] if '=' in v and not v.startswith('COOLIFY_'))
            expected_env = dict(v.split('=', 1) for v in baseline[role]['Config']['Env'] if '=' in v and not v.startswith('COOLIFY_'))
            if actual_env != expected_env:
                raise RuntimeError('Production runtime settings drift')
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    receipt_file = folder / 'production-backup.private.json'
    if operation == 'backup':
        if not all(c and c['State']['Running'] for c in current.values()):
            raise RuntimeError('Production backup requires all services running')
        proof = json.loads(run(['bash', str(folder / 'deploy/coolify-backend/before-deploy.sh'), application]))
        required = ('allRestoredTableHashesMatch', 'fullRolePrivilegesQualified', 'databaseAndExtensionCatalogMatch', 'schemaOwnershipAndGrantsMatch', 'fileHashesModesOwnersAndLinksMatch', 'allDockerVolumesRetained')
        if proof.get('application') != application or not all(proof.get(k) is True for k in required):
            raise RuntimeError('Production recovery qualification incomplete')
        if not baseline_file.exists():
            baseline_file.write_text(json.dumps(baseline))
        receipt_file.write_text(json.dumps({'application': application, 'configDigest': digest, 'verifiedAt': time.time(), 'proof': proof}))
        print(json.dumps({'verifiedProductionBackup': True, 'application': application, 'backupDirectory': proof['recoveryDirectory'], 'tables': proof['allApplicationTables']}))
        return
    if receipt_file.is_symlink() or receipt_file.stat().st_uid != 0 or receipt_file.stat().st_mode & 0o077:
        raise RuntimeError('Production backup receipt permissions changed')
    receipt = json.loads(receipt_file.read_text())
    validate_receipt(receipt, application, digest, time.time())
    legacy = [c for c in current.values() if c and c['Config']['Labels'].get('com.docker.compose.project') == 'britelink-production']
    if legacy:
        if len(legacy) != len(ROLES):
            raise RuntimeError('Partial production adoption refused')
        # Exact owned containers only. Neither command removes persistent volumes.
        names = [NAMES[role] for role in ('gateway', 'auth', 'rest', 'storage', 'db')]
        run(['docker', 'stop', '--time', '60'] + names)
        run(['docker', 'rm'] + names)
    run(compose + ['up', '-d', '--no-build', '--pull', 'never'])
    print(json.dumps({'productionStarted': True, 'application': application, 'volumeNamesPreserved': True, 'apiPortPreserved': True, 'containerNamesPreserved': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Production hook failed; private diagnostics withheld', file=sys.stderr)
        sys.exit(1)
