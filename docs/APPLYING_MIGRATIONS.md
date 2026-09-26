# Applying migrations to production

Production's API (`britelink-api.ashbi.ca`) is the self-hosted Supabase stack that
`scripts/selfhosted-staging/up.sh` bootstraps. Bootstrap applies every migration once; nothing
records which ones a database has received since. `scripts/apply-pending-migrations.sh` works that
out from the database itself, takes a backup, then applies only what is missing (039–051), in
order, one transaction per file. A file that fails is rolled back and nothing after it runs.

**Order matters for launch:** apply migrations **before** enabling the Deploy workflow. The web
build calls functions these migrations create (sign-up, calendar, learning notes, calendar feed).

## Easiest: the Migrate workflow (no SSH needed on your machine)

Actions → **Migrate** → Run workflow on `main`
(https://github.com/camster91/britelink-mvp/actions/workflows/migrate.yml).

1. Run it with **mode = check**. The log lists `have` / `MISS` for 039–051 and nothing changes.
2. Run it again with **mode = apply**. It backs up to `/root/britelink-backups/` on the VPS, then
   applies what's missing.
3. Run **check** once more. It should say "Up to date".

It uses the Deploy workflow's `production` environment (`DEPLOY_SSH_KEY`, `VPS_KNOWN_HOSTS`). It
auto-detects the single `supabase/postgres` container; if there is more than one, it lists them
and you re-run with `db_container` set.

## By hand (on the VPS, about 5 minutes)

```bash
ssh root@187.77.26.99

# 1. Find the Supabase Postgres container (the one running the supabase/postgres image).
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i postgres

# 2. Copy the script and migrations from current main. This reads from git without touching the
#    deployed checkout's working tree.
mkdir -p /root/bl-migrate
cd /docker/britelink-web && git fetch --depth=1 origin main
git archive FETCH_HEAD scripts/apply-pending-migrations.sh supabase/migrations | tar -x -C /root/bl-migrate
cd /root/bl-migrate

# 3. Report only: lists "have" and "MISS" per migration and changes nothing.
DB_CONTAINER=<container-name> bash scripts/apply-pending-migrations.sh

# 4. Back up and apply. The backup goes to /root/britelink-backups/pre-migrate-<time>.dump.
DB_CONTAINER=<container-name> bash scripts/apply-pending-migrations.sh --apply

# 5. Run step 3 again. It should say "Up to date: nothing to apply."
```

The earlier "three revoke lines" are part of migration 042, so skip them if you haven't run them.
If you have already run them, the script still applies the rest of 042 correctly.

## If something fails

- **"migration 038 is not present":** the database predates this script; bootstrap it with `up.sh`.
- **"out of order":** a later migration is present but an earlier one is missing. Stop and look;
  don't force it.
- **A file fails:** that file is rolled back. Everything before it stays applied and is safe.
- **To roll back all of it:** use the restore command the script printed, e.g.
  `docker exec -i <container> pg_restore -U postgres -d postgres --clean --if-exists < /root/britelink-backups/pre-migrate-<time>.dump`

## What was verified (2026-09-25, local Postgres 16)

- Starting from 001–040 with Supabase's default grants, it applied 041–051, and the result is
  schema- and grant-identical to a fresh 51-migration build.
- The same holds when the anon revokes were run by hand first.
- It refuses an out-of-order database and a database older than 038.
- A second run applies nothing, and the backup is a valid `pg_dump` archive.

## Ops check (anon key, Traefik access log)

Actions → **Ops check** → Run workflow on `main`.

- **check** is read-only and prints facts only, never a key or secret. It reports:
  - whether the web build's `VITE_SUPABASE_ANON_KEY` verifies under the secret PostgREST uses;
  - whether it matches the production stack's own `ANON_KEY`;
  - whether GoTrue and PostgREST share a secret;
  - whether the served bundle carries the `.env` key;
  - whether Traefik writes an access log.
- **fix-anon-key** copies the stack's own `ANON_KEY` into `/docker/britelink-web/.env`, after a
  backup. It only does this if that key verifies and is `role=anon`. Afterwards, run **Deploy** so
  the bundle is rebuilt with the new key.

- **reconcile-stack** recreates the production stack's `auth`, `rest` and `storage` containers from
  the stack's own compose files and `.env` (`docker compose up -d --no-deps`; the database is not
  touched), so all three use the `JWT_SECRET` that signed `ANON_KEY`. It refuses, changing nothing,
  unless that key verifies under that secret and is `role=anon`. Recreating GoTrue signs out every
  existing session. No web rebuild is needed when the web key already equals the stack's.

The 2026-09-25 live probe found the web key rejected (`JWSInvalidSignature`). The first Ops check
(2026-09-26) showed why: the web key *is* the stack's key, but PostgREST and GoTrue run with
different secrets, so the fix is **reconcile-stack**, not fix-anon-key. The same run showed Traefik
writes an access log (`/var/log/traefik/access.log`), so calendar feed paths are logged unless the
`/feed/` route opts out.

The second check (after #63) narrowed it further: the `.env` `ANON_KEY` does **not** verify under the
`.env` `JWT_SECRET` (it was minted 2026-09-18 15:06, with the storage container, which is the only
service not recreated on 2026-09-19), so reconcile-stack correctly refuses. `check` now also reports
which running secret signs the `.env` anon and service keys, whether `.env` defines `JWT_SECRET` more
than once, and whether the compose-rendered secrets match the running ones. The fix follows from that.
