# Agent handoff — BriteLink (`camster91/britelink-mvp`)

**Product:** BriteLink, homeschool curriculum planning with a human educator in the loop. It is not an
unsupervised AI tutor.
**Owner:** Cameron (camster91)
**Last updated:** 2026-09-30

## Read first

1. `docs/TODO.md`: the one list of what is left, with owners.
2. `docs/PROJECT-STATUS.md`: what is verified in production, with evidence.
3. `docs/APPLYING_MIGRATIONS.md`: how the production database and ops workflows are run.
4. Open GitHub issues. Epic #32 is the launch plan.

## How production works

- **Web:** `britelink.ashbi.ca`. The `Dockerfile` nginx image is built on the VPS in
  `/docker/britelink-web`, behind Traefik. A merge to `main` → CI → Deploy (GitHub Actions over SSH)
  → a `/version.json` check.
- **Backend:** a self-hosted Supabase stack on the same VPS (`britelink-production`, files in
  `/opt/britelink-production/supabase/selfhosted`), served at `britelink-api.ashbi.ca`.
- **Workflows:**
  - **Migrate** (check/apply);
  - **Ops check** (read-only diagnostics, plus explicit fix modes);
  - **Monitor** (hourly);
  - **Backup** (nightly, restore-verified);
  - **Staging** (rebuild/verify the synthetic staging stack).

## Rules

- Do not fake hosted Auth, counsel approval, educator sign-off or VoiceOver completion. Record
  what is proven, with links.
- Production changes, such as applying migrations, changing `.env` or wiping staging, need
  Cameron's explicit go. Read-only checks do not.
- Never print a key, secret, token or family data. The ops scripts print yes/no facts and counts.
- Design: navy `#081326`, BriteLink blue, and Inter. Text is 13px or larger; controls are 44px or
  taller. Form errors are accessible. No streaks, shame or "behind" labels.
