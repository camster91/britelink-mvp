# BriteLink — the to-do list

**The single source of truth for what is left.** Last updated 2026-10-16. Earlier plans (`LAUNCH-TODO`,
`END_TO_END_SHIP_PLAN`, `ship-status`, the evaluations) are in `docs/archive/` for history only.
Each item names its GitHub issue and who can do it: **Cameron** (a decision, an account or a
person), **code** (can be built in this repo), or **both**.

## Live today (done)

- Production at https://britelink.ashbi.ca. The web app is deployed by Coolify (since
  2026-10-01). The older GitHub Actions SSH **Deploy** workflow was switched off then and stays
  off; see `AGENT_HANDOFF.md` → "How production works".
- The self-hosted Supabase backend (`britelink-production`, served at `britelink-api.ashbi.ca`)
  has migrations 001–059. 060 to 065 wait for the owner's go (item 3 below). Each was applied
  with the Migrate workflow after a pre-migrate backup; the run links are in `PROJECT-STATUS.md`.
  Notification sending stays off until counsel approves the wording and `NOTIFICATIONS_ENABLED`
  is set (`EMAIL_NOTIFICATIONS.md`, #99). Auth, database API and storage share the key-signing
  secret, and the site's public key is accepted.
- The approved privacy notice `2026-09-30` is live, so guardian intake is open.
- Features shipped: flexible week, day-aware next action, calm lesson completion with undo,
  weekly story and educator notes, learning captures, shared multi-learner activities, calendar
  export and a live calendar feed (with no access-log exposure), student check-off view, learning
  report, links/imports, and in-app help.
- Hourly external monitor and nightly restore-verified backups (#7 and #8, partly). A failed run
  emails the owner.

## Before inviting the first real families (blocking)

1. **Prove sign-in email end to end** (#2, Cameron).
   - Already configured (Ops check, 2026-09-30): GoTrue sends through Mailgun (`smtp.mailgun.org:587`)
     as `BriteLink <noreply@ashbi.ca>`, with auto-confirm off. Sign-up was invite-only then; opening it
     is item 3.
   - The sign-in link address `https://britelink-api.ashbi.ca/verify` reaches GoTrue.
   - Left: sign in once with a real invited address, from a phone and a computer. Confirm the email
     arrives (not in spam) and the link opens the household workspace.
2. **One consent under the draft notice** (Cameron + counsel).
   - Until 2026-09-30 the live build carried `2026-09-19-draft-1`, and one active consent was
     recorded under it. Production has 2 households and 4 accounts.
   - Counsel decides whether that guardian must re-consent under `2026-09-30`.
   - Ops check "consent records" shows the counts.
3. **Staff team and the invite path** (both). Migration 060 adds a staff team, so staff can see
   new families (before it, nobody on staff could). Migration 061 tightens it: only an account with
   a confirmed email can be added, admins see every family, educators see a family only once an
   admin assigns them its case, and a calendar link stops working when its maker leaves the
   family. Migration 062 takes an educator out of a family when its case is reassigned, and stops
   admins acting as a family's parent; 063 closes smaller database gaps from the review. 064
   makes staff approve each family that signs itself up before work on its case starts (decided
   2026-10-21), and 065 deletes a family's sign-in accounts along with its data (decided
   2026-10-21). 060 to 065 are in the repo and wait for the owner's go; apply them together with
   the Migrate workflow **before** merging any later web change (the app reads 064's
   `approved_at`), then add each person with the Staff workflow (`STAFF_TEAM.md`).
   Before opening sign-up, check that `GOTRUE_MAILER_AUTOCONFIRM` is `false` on the auth service
   (Ops check prints "email confirmation: required (safe)"), and copy the updated
   `supabase/selfhosted/gateway.conf` to the backend so sign-in emails are rate-limited per visitor.
   **Person check before sign-in emails** (decided 2026-10-21, built): create a free Cloudflare
   Turnstile widget for `britelink.ashbi.ca`; put its site key in the web app's Coolify build
   variable `VITE_TURNSTILE_SITE_KEY` and redeploy the web app **first**; then on the backend auth
   service set `CAPTCHA_ENABLED=true`, `CAPTCHA_SECRET=<Turnstile secret key>` and
   `GOTRUE_RATE_LIMIT_EMAIL_SENT=200`, and redeploy it. Ops check then prints "person check before
   sign-in email: on". In the other order, nobody can get a sign-in link. Decided 2026-10-06: open free beta, anyone can join. The app's "Join the
   free beta" form already creates accounts; the sign-in service still refuses new emails
   (`GOTRUE_DISABLE_SIGNUP=true`). After 060 is live, set it to `false` on the backend's auth
   service in Coolify and redeploy it. Staff then join the same way and are added with the Staff
   workflow.
4. **Educator content sign-off** (#11, Cameron). A credentialed educator reviews curriculum,
   safeguarding and resource rights before plans reach families.
5. **Support model** (#55, Cameron). Hours, who answers, and what happens when a plan is wrong.
   `SUPPORT_RUNBOOK.md` is the draft.
6. **Attachments** (#4, both). There is no malware scanner, so an upload would stay quarantined
   forever. The message forms therefore hide the file picker and say attachments are not
   available during the beta (build setting `VITE_ATTACHMENTS_ENABLED`, off unless it is exactly
   `true`). To turn them on: deploy the scanner (ClamAV behind `scripts/attachment-scanner.mjs`),
   then set `VITE_ATTACHMENTS_ENABLED=true` in the web `.env` and redeploy.

7. **Approval for production changes** (Cameron, one minute). Add yourself as a required
   reviewer under Settings → Environments → `production-change`. Until then, Migrate **apply**,
   Ops check fix modes and Staff **add**/**remove** stop at their approve step and change nothing
   (`APPLYING_MIGRATIONS.md` → "Approving a production change"). Do this before applying 060
   to 065. The same approval gates web releases once the Release workflow is on (item 8).

8. **Approved releases with automatic undo** (decided 2026-10-21, built; Cameron to switch on).
   The Release workflow waits for your approval, has Coolify deploy that exact commit, checks the
   live site, and puts the previous version back by itself if the new one fails. The web image
   also has a health check, so Coolify never swaps in a container that cannot serve the app. To
   switch it on, follow `RELEASES.md` → "Switching it on".

## Soon after (the beta can start without these)

- **Payments** (#5, #52, #54, Cameron then code). Choose the provider and prices first. The
  signed webhook, checkout and cancellation follow from that. The database models one-off
  package orders today, not subscriptions.
- **Off-site backup copy** (#8, Cameron). Built: each verified nightly dump is copied, encrypted,
  to your Google Drive. Until you add the two secrets the nightly Backup run fails and emails you
  (decided 2026-10-21). It switches on once you add them in
  `RECOVERY_OPERATIONS.md` → "Off-site copy in Google Drive". Point-in-time recovery is still open.
- **Named alert owner and a test alert** (#7, Cameron).
- **Staging rebuild and deployed proof** (#38, #39, #3, #37). `Staging` workflow → rebuild-and-verify.
  It wipes staging's synthetic data, then runs the isolation matrix (D1/D2) and the parent and
  educator journeys.
- **Reminders and weekly digest email** (#47). Needs the email service from item 1.
- **Privacy exercises in a deployed stack** (#12) and **retention/deletion execution** (#6).
  Needs counsel's retention schedule.
- **VoiceOver and true 200%/400% zoom** (#9, Cameron). A human test.
- **Public launch site** (#56). Needs pricing and approved copy.
- **Beta with 5–10 families and the go/no-go** (#13, #57, Cameron).

## Maintenance

- Dependencies: `npm audit --omit=dev` (what ships to families) is clean. A full `npm audit`
  reports one high finding in `source-map-js`, a build-time tool under Vite, which never reaches
  the browser. Minor updates are available (supabase-js, playwright); Vite 6 → 8 is a major
  upgrade to plan separately.
- Monitor and backup workflows: watch for failure emails; `Actions → Backup` keeps 14 nightly dumps.
