# Releasing the web app

Owner decision (2026-10-21): every web release waits for Cameron's approval, and a release that
does not come up healthy is undone automatically.

## How it works

1. A pull request is merged to `main` and CI passes.
2. The **Release** workflow (`.github/workflows/release.yml`) starts and waits on the
   `production-change` environment. GitHub emails the required reviewer, who presses **Approve**.
   Nothing changes until then.
3. It checks that the commit is on `main`, notes the commit the live site reports at
   `/version.json`, and asks Coolify to deploy the approved commit (Coolify API: pin
   `git_commit_sha`, then deploy).
4. It waits for Coolify to finish, for `https://britelink.ashbi.ca/version.json` to name the new
   commit, and for the home page to load.
5. If any of that fails, it pins the previous commit, deploys it, waits until the site names it
   again, and marks the run red with what happened. If it cannot tell what was live before, it
   says so and changes nothing more.

Separately, the web image has a Docker health check (`Dockerfile`, `/version.json`). Coolify keeps
the old container serving until the new one reports healthy, so a build that starts but cannot
serve pages never replaces a working one, even outside this workflow.

Database migrations are still separate: run Migrate (with approval) **before** releasing code that
needs them.

## Switching it on (Cameron, about 10 minutes)

Until step 5, Coolify keeps deploying every push to `main` by itself, as today.

1. In Coolify: **Settings → API**: turn the API on, and create a token with deploy permission.
2. In Coolify, open the web app (`britelink.ashbi.ca`) and copy its UUID from the address bar.
3. In GitHub, **Settings → Environments → production**:
   - secret `COOLIFY_API_TOKEN` = the token from step 1;
   - variable `COOLIFY_URL` = the Coolify dashboard address, for example `https://coolify.example.com`;
   - variable `COOLIFY_WEB_APP_UUID` = the UUID from step 2.
4. Make sure `production-change` has you as a required reviewer (TODO item 7).
5. In Coolify, turn off **Automatic deployment** for the web app (so only approved releases deploy).
6. In GitHub, **Settings → Secrets and variables → Actions → Variables**: add
   `RELEASE_VIA_WORKFLOW` = `true`.
7. Test it: **Actions → Release → Run workflow** with no SHA releases the current `main` tip.
   Approve it and watch it finish green.

To turn it off again, delete `RELEASE_VIA_WORKFLOW` and turn Coolify's automatic deployment back on.

## Going back to an older version by hand

**Actions → Release → Run workflow**, with the older commit's full SHA. It must be on `main`. It
still needs approval.

A hand-started run always deploys, even the commit that is already live, so it can also rebuild a
damaged container. If that rebuild fails there is no older commit to put back; Coolify keeps the old
container while the new one is unhealthy, and the run says so.
