# CI runner: how to unblock CI and Deploy (#33)

**Status:** the code side is done. Choosing a host and registering the runner are Cameron's decisions.

## What is true now

- **Resolved 2026-09-30:** jobs run on GitHub-hosted `ubuntu-24.04`, and every merge to `main` runs CI and then Deploy automatically (#33). History: hosted runners stopped being assigned on 2026-09-18 (`docs/archive/ship-status.md`).
- Every job in `.github/workflows/ci.yml` and `deploy.yml` now reads its runner from the repository variable **`CI_RUNS_ON`**:
  - unset: `ubuntu-24.04`, which is today's behaviour;
  - set to a JSON array such as `["self-hosted","linux","britelink-ci"]`: that self-hosted runner.
- Switching is a variable change; deleting the variable switches back. No code change and no PR.
- On a self-hosted runner, the Deploy job removes the SSH deploy key from the runner's home directory afterwards (`if: always()`).

## The decision

Self-hosted runners are free for private repositories, so the only real question is **which host**.

| Option | Verdict |
| --- | --- |
| The production VPS (`ashbi-vps-family-planner` runner) | **No.** CI runs on `pull_request`, so unmerged code would execute beside production data, and `migration-harness` needs Docker. |
| A small separate VM (any provider) or an always-on home machine | **Recommended.** Isolated from production and cheap. |
| `cam-desktop-w1` (Windows, currently offline) | Only with WSL2 and Docker; it must be online for CI to run. |

## Setting up a runner (about 30 minutes)

1. Use a Linux host that is **not** the production VPS: Ubuntu 24.04, 2 vCPU, 4 GB RAM, 20 GB disk.
2. Install Docker (used by `migration-harness`), then provision Playwright's OS libraries once with `sudo npx playwright install-deps chromium`. CI skips `--with-deps` on self-hosted runners so the runner user doesn't need sudo.
3. Install nginx (`sudo apt-get install -y nginx-core`), so `tests/nginx-calendar-feed.test.mjs` runs its functional checks instead of skipping.
4. Register the runner in the repository under Settings → Actions → Runners → New self-hosted runner. Give it the extra label `britelink-ci` and run it as a service, as an unprivileged user.
5. Under Settings → Secrets and variables → Actions → Variables, add `CI_RUNS_ON` = `["self-hosted","linux","britelink-ci"]`.
6. Push any commit to a PR branch. `build-test`, `migration-harness` and `browser-audits` should start within a minute.
7. After merging to `main`, confirm Deploy runs and that its `/version.json` step names the merged commit. Record the run link in `docs/PROJECT-STATUS.md` (this closes #33's acceptance criteria).

## Also check before the first automated deploy

- The `DEPLOY_SSH_KEY` secret and the `VPS_KNOWN_HOSTS` variable exist in the `production` environment.
- The deploy key is dedicated to this purpose and was rotated after the hand deploys.
