#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} =~ ^[a-z0-9]{20,40}$ ]] || exit 2
[[ ${2:-} == backup || ${2:-} == start ]] || exit 2
docker exec -i coolify php /dev/stdin "$1" "$2" <<'PHP'
<?php
try {
    require '/var/www/html/vendor/autoload.php';
    $app = require '/var/www/html/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    [$script, $uuid, $operation] = $argv;
    $r = App\Models\Application::where('uuid', $uuid)->sole();
    if ($r->git_repository !== 'camster91/britelink-mvp'
        || $r->git_branch !== 'main'
        || $r->name !== 'britelink-backend-production'
        || $r->docker_compose_location !== '/docker-compose.coolify-backend-production.json'
        || !$r->settings->is_raw_compose_deployment_enabled
        || $r->settings->connect_to_docker_network
        || filled($r->fqdn)
        || !in_array($operation, ['backup', 'start'], true)) {
        throw new RuntimeException('Unexpected production owner');
    }
    $folder = $r->workdir();
    if ($folder !== '/data/coolify/applications/'.$uuid) {
        throw new RuntimeException('Unexpected production directory');
    }
    $command = 'python3 '.escapeshellarg($folder.'/deploy/coolify-backend/production.py')
        .' '.escapeshellarg($operation).' '.escapeshellarg($uuid)
        .' '.escapeshellarg((string) $r->id).' '.escapeshellarg($folder);
    $proof = json_decode(instant_remote_process([$command], $r->destination->server, true, false, 300), true, 512, JSON_THROW_ON_ERROR);
    $key = $operation === 'backup' ? 'verifiedProductionBackup' : 'productionStarted';
    if (($proof[$key] ?? false) !== true || ($proof['application'] ?? null) !== $uuid) {
        throw new RuntimeException('Production operation not confirmed');
    }
    echo json_encode($proof), PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, "Production hook rejected or failed; private diagnostics withheld\n");
    exit(1);
}
PHP
