# Agent handoff — BriteLink (`camster91/britelink-mvp`)

**Product:** BriteLink, homeschool curriculum planning with a human educator in the loop. It is not an
unsupervised AI tutor.
**Owner:** Cameron (camster91)
**Last updated:** 2026-10-16

## Read first

1. `docs/TODO.md`: the one list of what is left, with owners.
2. `docs/PROJECT-STATUS.md`: what is verified in production, with evidence.
3. `docs/APPLYING_MIGRATIONS.md`: how the production database and ops workflows are run.
4. Open GitHub issues. Epic #32 is the launch plan.

## How production works

This section is the one place that says where production runs. Other docs link here.

- **Web:** `britelink.ashbi.ca`, deployed by **Coolify** on the VPS since 2026-10-01 (#86,
  `docker-compose.coolify-development.json`), behind Traefik. The `Dockerfile` nginx image serves
  the built app; `/version.json` names the deployed commit.
  - The GitHub Actions **Deploy** workflow (SSH to `/docker/britelink-web`) was switched off by
    hand on 2026-10-01 and stays off (`deploy/coolify-backend/PRODUCTION.md`). Do not turn it back
    on alongside Coolify: two release owners would race on every merge.
  - Database migrations are **not** applied by a deploy. Run the Migrate workflow, with Cameron's
    go, before merging code that needs a new migration.
- **Backend:** the self-hosted Supabase stack on the same VPS (`britelink-production`), served at
  `britelink-api.ashbi.ca`. Its compose file notes that the live stack is managed in Coolify
  (`britelink-backend-production`, see `deploy/coolify-backend/PRODUCTION.md`). The repo copies in
  `supabase/selfhosted/` are the reference: a change there (for example `gateway.conf`) reaches
  production only when it is copied to the backend and redeployed. Ops check shows the differences.
- **Workflows.** Every mode that changes production waits for a required reviewer on the
  `production-change` environment; read-only modes never wait (`APPLYING_MIGRATIONS.md`).
  - **Migrate** (check/apply);
  - **Ops check** (read-only diagnostics, plus explicit fix modes);
  - **Staff** (add, remove and list staff, `STAFF_TEAM.md`);
  - **Monitor** (hourly);
  - **Backup** (nightly, restore-verified, with an encrypted Google Drive copy once its secrets exist);
  - **Notifications** (every 10 minutes; sends nothing until `NOTIFICATIONS_ENABLED` is set);
  - **Staging** (rebuild/verify the synthetic staging stack).

## Rules

- Do not fake hosted Auth, counsel approval, educator sign-off or VoiceOver completion. Record
  what is proven, with links.
- Production changes, such as applying migrations, changing `.env` or wiping staging, need
  Cameron's explicit go. Read-only checks do not.
- Never print a key, secret, token or family data. The ops scripts print yes/no facts and counts.
- Design: navy `#081326`, BriteLink blue, and Inter. Text is 13px or larger; controls are 44px or
  taller. Form errors are accessible. No streaks, shame or "behind" labels.
