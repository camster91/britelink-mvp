# Environment Inventory

Ownership, access, cost, and teardown/rotation for every environment BriteLink runs in.

This is the AC5 artifact for issue #1 (*"Environment ownership, access, cost, and
teardown/rotation procedure are recorded"*). It is written **before** the hosted projects
exist, so it records what is decided, what is not yet provisioned, and what still needs an
owner decision. Nothing here is a substitute for the provisioning checklist in
`docs/archive/SUPABASE_PROVISIONING.md`.

**Status as of 2026-09-18.** Backend decision: hosted Supabase, `dev` + `staging`, region
`ca-central-1`. No Supabase project exists yet. The only running environment is the
unconfigured web tier on the VPS.

---

## 1. Environments

| # | Environment | Backed by | Region | Exists? |
|---|---|---|---|---|
| E1 | **Local development** | `.env.local` → `britelink-dev` | n/a (client) | ✅ runs today, unconfigured |
| E2 | **`britelink-dev`** | Hosted Supabase project | `ca-central-1` | ❌ not provisioned |
| E3 | **`britelink-staging`** | Hosted Supabase project | `ca-central-1` | ❌ not provisioned |
| E4 | **Web tier (VPS)** | nginx container from `Dockerfile` | VPS (`vps.ashbi.ca`) | ✅ live at `britelink.ashbi.ca` |
| E5 | **Production** | — | — | ⛔ deliberately deferred |
| E6 | **Synthetic rehearsal** | throwaway `postgres:16` container | local/VPS CI | ✅ `npm run test:migrations` |

### E4 — the web tier, and why it is currently inert

`britelink.ashbi.ca` is served by an nginx container built from this repository and deployed
by `.github/workflows/deploy.yml` over SSH. It runs in **unconfigured demo mode**: no backend
is wired, so it serves synthetic device-only sample data.

This is not a misconfiguration to fix casually. **Two independent reasons the deployed site
stays unconfigured until someone decides otherwise:**

1. `src/supabase-config.js` reads `import.meta.env`, which Vite inlines at **build** time,
   and neither the `Dockerfile` nor `docker-compose.yml` passes any `VITE_*` build argument.
   Documented as an open gap in `docs/archive/SUPABASE_PROVISIONING.md` §7a.
2. Even once that plumbing exists, pointing the public site at a hosted backend is a
   deployment change gated on the same approval as provisioning.

### E6 — the synthetic rehearsal is not environment separation

`npm run test:migrations` applies all 40 migrations plus `supabase/storage-policies.sql` to a
throwaway container. It is a real PostgreSQL 16 apply and a genuine smoke test, but it is
**one** database. It cannot demonstrate that dev and staging are separated from each other,
which is what issue #1 actually asks for. Do not let a green harness run stand in for E2/E3.

---

## 2. Ownership and access

| Environment | Owner | Access granted to | Access mechanism |
|---|---|---|---|
| E2 `britelink-dev` | Cameron | Cameron | Supabase dashboard + project ref |
| E3 `britelink-staging` | Cameron | Cameron | Supabase dashboard + project ref |
| E4 web tier | Cameron | `root` on the VPS | SSH (`coolify` alias); GitHub Actions deploy key |
| E5 production | **unassigned** | — | — |

**Not yet recorded, and required before real family data:** who else may hold dashboard
access, and how that access is revoked. A one-person operation is a single point of failure
for a system holding children's education data; the recovery story must not be "Cameron
remembers the password."

**Credentials — where each kind lives:**

| Credential | Lives where | Never |
|---|---|---|
| `anon` public key | `.env.local`, and (once §7a is closed) the VPS build env | — it is public by design and ships in the bundle |
| `service_role` / `sb_secret_*` | server/CI only | the browser, git, or any `VITE_*` variable |
| Database password | password manager | git |
| `BRITELINK_MONITOR_JWT` | the monitoring host's environment | `VITE_*`, browser, git |
| `DEPLOY_SSH_KEY` | GitHub Actions secret | the VPS, any third-party action |

`src/supabase-config.js` refuses to boot on a `service_role` or `sb_secret_` key passed as
browser config. That is a backstop, not the control — do not rely on it as the only guard.

---

## 3. Cost

Verified 2026-09-18 against <https://supabase.com/pricing> and the platform billing docs.
Pricing changes; re-check before committing to a tier.

| | Free | Pro |
|---|---|---|
| Base | $0 | **$25/mo per organization** |
| Active projects | **2** | unlimited |
| Idle behaviour | **paused after 7 days without a database request** | never paused |
| Compute | — | $10/mo per project, offset by a $10/mo compute credit |
| Database | 500 MB/project | 8 GB/project |
| Backups | — | daily, 7-day retention |

**The tier question is a real decision, not a formality.** The free tier's 2-project limit
fits `dev` + `staging` **exactly** — but free projects pause after 7 consecutive days with no
database request. A staging project exists to be hit intermittently, and "we ran the
isolation checks and the project was paused" is precisely the vacuous-green failure this
repository has been bitten by before (see the nine valid-but-empty backup archives). Either
keep staging warm with a scheduled ping, or pay.

Expected cost if Pro: **~$25/mo for a single project; ~$35/mo for two**
($25 plan + 2 × $10 compute − $10 credit). Note the plan fee attaches to the **organization**
while compute attaches to **each project** — a common misreading is that Pro is $25 per
project.

Do not enable overage spend until someone has reviewed the calculator; Supabase enables spend
caps by default, and that default is protective here.

---

## 4. Teardown and rotation

**Rotation — do these on any suspected exposure, and on offboarding anyone with access:**

1. Rotate the database password (dashboard → Database settings).
2. Rotate the `anon` key only after checking it is not cached in a shipped bundle — **the key
   is compiled into any build that used it**, so rotation requires a rebuild and redeploy of
   E4, not just a settings change.
3. Rotate `BRITELINK_MONITOR_JWT` and any test JWTs. Test JWTs are short-lived by design;
   treat any long-lived one as a defect.
4. Rotate `DEPLOY_SSH_KEY` (`gh secret set`) and remove the matching public key from the VPS
   `authorized_keys`.
5. Re-run the isolation checks (128 checks: 104 D1 + 24 D2) after rotating, so the post-rotation
   state is proven rather than assumed.

**Teardown of E2/E3 (safe — synthetic data only):**

1. Confirm the project holds **no real family data**. If it does, stop: teardown is a physical
   deletion and is governed by the retention rules in `docs/RECOVERY_OPERATIONS.md`.
2. Pause, then delete the project from the dashboard.
3. Remove its ref and credentials from every local `.env.local` and any secure doc.
4. If the free tier is in use, confirm the deletion freed the project slot.

**Teardown of E4:** the container is `britelink-web` on the VPS. Do **not** remove the
`britelink-postgres` compose project as part of a web teardown — it is a separate project on
its own bridge network and holds its own password. Port `127.0.0.1:8088` is load-bearing: it
is hardcoded in the Traefik route at `/opt/traefik/dynamic/britelink.yml`.

---

## 5. Open items

- [ ] Provision E2 and E3 (blocked: Supabase account and payment method — Cameron)
- [ ] Choose the tier, with the idle-pause tradeoff in §3 in mind
- [ ] Record project refs and chosen region in a secure doc, **not in git**
- [ ] Close §7a in `docs/archive/SUPABASE_PROVISIONING.md` if the hosted staging site should be live
- [ ] Nominate a second person with dashboard access, or record explicitly that there is none
- [ ] Assign an owner for E5 before any real family data exists
- [ ] Re-check pricing before committing to a tier
