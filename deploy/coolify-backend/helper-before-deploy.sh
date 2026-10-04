#!/usr/bin/env bash
# Run the verified guard on the owning host through Coolify's existing SSH connection.
set -euo pipefail
[[ ${1:-} =~ ^[a-z0-9]{20,40}$ ]] || exit 2
docker exec -i coolify php /dev/stdin "$1" <<'PHP'
<?php
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$uuid = $argv[1];
$resource = App\Models\Application::where('uuid', $uuid)->sole();
if ($uuid !== '38sgm88gj9urzcihoai9lqjx'
    || $resource->git_repository !== 'camster91/britelink-mvp'
    || $resource->git_branch !== 'ops/coolify-backend'
    || $resource->docker_compose_location !== '/docker-compose.coolify-backend-candidate.json'
    || $resource->settings->is_auto_deploy_enabled
    || filled($resource->fqdn)
    || !$resource->settings->is_raw_compose_deployment_enabled
    || $resource->settings->connect_to_docker_network) {
    throw new RuntimeException('Backup hook refuses an unexpected or public resource');
}
$command = 'bash /opt/britelink-backend-candidate-'.$uuid.'/deploy/coolify-backend/before-deploy.sh '.$uuid;
try {
    $output = instant_remote_process([$command], $resource->destination->server, true, false, 300);
    $proof = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
    foreach (['allRestoredTableHashesMatch', 'fullRolePrivilegesQualified',
        'databaseAndExtensionCatalogMatch', 'schemaOwnershipAndGrantsMatch',
        'fileHashesModesOwnersAndLinksMatch', 'allDockerVolumesRetained'] as $key) {
        if (($proof[$key] ?? false) !== true) throw new RuntimeException('Recovery not verified');
    }
    if (($proof['application'] ?? null) !== $uuid) throw new RuntimeException('Recovery owner differs');
    echo json_encode(['verifiedBriteLinkBackup' => true, 'application' => $uuid,
        'backupDirectory' => $proof['backupDirectory'], 'tables' => $proof['allApplicationTables']]), PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, "Candidate backup hook failed; private host diagnostics withheld\n");
    exit(1);
}
PHP
