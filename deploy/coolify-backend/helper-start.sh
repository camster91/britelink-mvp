#!/usr/bin/env bash
# Coolify's helper cannot see the preserved host workdir; start through its SSH connection.
set -euo pipefail
[[ ${1:-} =~ ^[a-z0-9]{20,40}$ ]] || exit 2
docker exec -i coolify php /dev/stdin "$1" <<'PHP'
<?php
try {
    require '/var/www/html/vendor/autoload.php';
    $app = require '/var/www/html/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $uuid = $argv[1];
    $resource = App\Models\Application::where('uuid', $uuid)->sole();
    if ($uuid !== '38sgm88gj9urzcihoai9lqjx'
        || $resource->git_repository !== 'camster91/britelink-mvp'
        || $resource->git_branch !== 'ops/coolify-backend'
        || $resource->docker_compose_location !== '/docker-compose.coolify-backend-candidate.json'
        || $resource->settings->is_auto_deploy_enabled || filled($resource->fqdn)
        || !$resource->settings->is_raw_compose_deployment_enabled
        || $resource->settings->connect_to_docker_network) {
        throw new RuntimeException('Start hook refuses an unexpected or public resource');
    }
    $folder = $resource->workdir();
    if ($folder !== '/data/coolify/applications/'.$uuid) throw new RuntimeException('Unexpected workdir');
    $python = <<<'PYTHON'
import json,os,pathlib,subprocess,sys
folder=pathlib.Path(sys.argv[1]);uuid=sys.argv[2]
if subprocess.check_output(['hostname']).decode().strip()!='vps.ashbi.ca':raise SystemExit(1)
os.umask(0o077)
env=folder/'.env'
if env.is_symlink() or env.stat().st_uid!=0:raise SystemExit(1)
os.chmod(folder,0o700);os.chmod(env,0o600)
compose=['docker','compose','--project-name',uuid,'--project-directory',str(folder),'-f',str(folder/'docker-compose.yaml'),'--env-file',str(env),'--profile','api']
def run(args):
 p=subprocess.run(args,capture_output=True)
 if p.returncode:
  (folder/'startup-failure.private.json').write_text(json.dumps({'exitCode':p.returncode,'stderr':p.stderr.decode(errors='replace')}))
  raise SystemExit(1)
 return p.stdout
config=json.loads(run(compose+['config','--format','json']))
if set(config['services'])!={'db','db-roles','auth','rest','storage','gateway'}:raise SystemExit(1)
if any(not n.get('internal') for n in config['networks'].values()):raise SystemExit(1)
reviewed=json.loads((folder/'deploy/coolify-backend/reviewed-images.json').read_text())
for name,s in config['services'].items():
 if s.get('ports') or s.get('build') or s.get('network_mode') or s.get('pull_policy')!='never':raise SystemExit(1)
 if set(s.get('networks',{}))!={'backend'}:raise SystemExit(1)
 expected=reviewed['db' if name=='db-roles' else name]['candidateImage']
 if s['image']!=expected:raise SystemExit(1)
 if not s.get('labels',{}).get('coolify.applicationId'):raise SystemExit(1)
if config['volumes']['database']['name']!=uuid+'-britelink-database-v1':raise SystemExit(1)
if config['volumes']['files']['name']!=uuid+'-britelink-files-v1':raise SystemExit(1)
run(compose+['up','-d','--no-build','--pull','never'])
print(json.dumps({'candidateStartedThroughCoolifyHost':True,'application':uuid,'noPublishedPorts':True,'internalOnly':True,'volumesPreserved':True}))
PYTHON;
    $command = 'python3 -c '.escapeshellarg($python).' '.escapeshellarg($folder).' '.escapeshellarg($uuid);
    $output = instant_remote_process([$command], $resource->destination->server, true, false, 180);
    $proof = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
    if (($proof['candidateStartedThroughCoolifyHost'] ?? false) !== true || $proof['application'] !== $uuid) {
        throw new RuntimeException('Candidate startup was not verified');
    }
    echo json_encode($proof), PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, "Candidate startup hook failed; private host diagnostics withheld\n");
    exit(1);
}
PHP
