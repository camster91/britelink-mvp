# Production backend adoption

The production descriptor adopts the existing data and file volumes; it never promotes
the synthetic candidate. It pins the five installed images and preserves current login,
SMTP, startup, mounts and API binding. Runtime settings enter Coolify only through its
server-side secret storage using the `BRITELINK_PROD_<SERVICE>_<SETTING>` names. Values
must not be printed, committed or downloaded to the workstation.

## Resource and release configuration

After the owner approves the production handoff, register one application named
`britelink-backend-production`, repository `camster91/britelink-mvp`, branch `main`, raw
Compose `/docker-compose.coolify-backend-production.json`. Preserve the repository on
the owning host. Keep shared Docker-network connection and preview deployments off.
No application FQDN is needed: retain Traefik's existing route to `127.0.0.1:8098`.
The five stable container names retain compatibility with ops checks and nightly backup.

Use the newly registered UUID in these exact commands:

* Custom build: `bash deploy/coolify-backend/helper-production.sh <UUID> backup`
* Custom start: `bash deploy/coolify-backend/helper-production.sh <UUID> start`

Before the first queue, prepare the owning host workdir `.env` privately from the same
verified Coolify variables (mode 0600). Custom build runs before Coolify writes its runtime
env file; the backup hook requires this initial host file. Keep values on the server and
verify the generated configuration against the original runtime before startup.

Start with automatic deployment disabled. Enable the existing main webhook only after
the first actual production queue, public/runtime checks and rollback rehearsal pass.
The separately disabled SSH Deploy workflow stays disabled. Backend images do not build
or pull in this queue; changing the reviewed images requires separate image qualification.

## What happens before startup

The helper binds the actual Coolify resource, main branch, production descriptor and
owning workdir. It runs on that host through Coolify's existing SSH connection, avoiding
the temporary deployment helper's inaccessible host env-file path. The generated Compose
configuration must match the original production images, environment, commands and
mounts. Every database/file volume is explicitly external. The only host binding is the
existing loopback API port. Other applications, networks and persistent volumes are not
stopped, removed or repurposed.

The guard independently restores all database tables, roles, membership grantors,
database/extension owners and schema grants, and verifies file/config recovery and retained
images. A root-private baseline and receipt bind that recovery to this exact deployment
configuration. Startup rejects a stale receipt, changed runtime settings, partial ownership
or another running volume consumer. Neither its private baseline nor env file leaves the VPS.

On the first approved transfer, stop and remove only the five exact owned original
containers, retaining all volumes, then start those stable names through the new Coolify
project. Subsequent queues use normal Coolify ownership. The one-shot original role helper
is not deleted or rerun: the adopted database already contains those roles and passwords.

## Monitoring and recovery

The public Monitor continues to use public HTTPS endpoints. Read-only Ops check discovers
the actual Coolify frontend and reads its env rather than the retired web release. Native
backend keys use the production-prefixed env names. Legacy mutation modes refuse the new
backend so they cannot silently edit the wrong manager. Nightly Backup accepts a native
project only after verifying its actual Coolify production resource/repository/main binding;
the stable DB container name and existing backup destination/schedule remain unchanged.

Before transfer, preserve the existing Compose files, env, gateway config and installed
images and record their current identity. Verify a fresh restore-backed recovery and all
source volumes. Keep the source files available for rollback.

Rollback is a separate, coordinated reversal, not concurrent writers: stop/remove only
this application's new five containers without `-v`, then run the preserved original
Compose project `britelink-production` with its original two files and env, selecting
`db auth rest storage gateway`, without builds or pulls. Verify volume/image/config identity
before starting it. The API port and route remain unchanged. Suspend the new resource's
auto-deploy before rollback so it cannot reclaim the same volumes. Do not delete either
volume or restore an older dump over current data just to reverse management ownership.

Acceptance requires the actual Coolify queue, verified backup receipt, one DB writer,
preserved data/files/login settings, public HTTPS/auth/API, existing backup/monitor jobs,
and a reviewed-main automatic release. Configuration parsing and unit tests alone do not
prove production adoption, email delivery, authenticated real-user journeys or rollback.
