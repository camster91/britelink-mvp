# BriteLink — the to-do list

**The single source of truth for what is left.** Last updated 2026-09-30. Earlier plans (`LAUNCH-TODO`,
`END_TO_END_SHIP_PLAN`, `ship-status`, the evaluations) are in `docs/archive/` for history only.
Each item names its GitHub issue and who can do it: **Cameron** (a decision, an account or a
person), **code** (can be built in this repo), or **both**.

## Live today (done)

- Production at https://britelink.ashbi.ca runs current `main`. Every merge to `main` deploys
  automatically through GitHub Actions (CI, then Deploy, with a `/version.json` check), per #33.
  Moving deploys to Coolify is a later choice for Cameron.
- Self-hosted Supabase (`britelink-production` stack on the VPS) has migrations 001-057 (053 review integrity and 054 privacy integrity applied 2026-10-01; 055 revision-requires-request and 056 staff-workflow integrity applied 2026-10-02; 057 staff display names applied 2026-10-05; each after a pre-migrate backup). 058 (email notifications, #99) is in the repo and waits for the owner's go; sending stays off until counsel approves the wording (docs/EMAIL_NOTIFICATIONS.md). Auth,
  database API and storage share the key-signing secret. The site's public key is accepted.
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
     as `BriteLink <noreply@ashbi.ca>`, with auto-confirm off and sign-up invite-only.
   - The sign-in link address `https://britelink-api.ashbi.ca/verify` reaches GoTrue.
   - Left: sign in once with a real invited address, from a phone and a computer. Confirm the email
     arrives (not in spam) and the link opens the household workspace.
2. **One consent under the draft notice** (Cameron + counsel).
   - Until 2026-09-30 the live build carried `2026-09-19-draft-1`, and one active consent was
     recorded under it. Production has 2 households and 4 accounts.
   - Counsel decides whether that guardian must re-consent under `2026-09-30`.
   - Ops check "consent records" shows the counts.
3. **Staff accounts and the invite path** (Cameron). Create the educator/admin accounts and decide
   who sends family invites, following `PRIVATE_BETA_EDUCATOR_ONBOARDING.md`.
4. **Educator content sign-off** (#11, Cameron). A credentialed educator reviews curriculum,
   safeguarding and resource rights before plans reach families.
5. **Support model** (#55, Cameron). Hours, who answers, and what happens when a plan is wrong.
   `SUPPORT_RUNBOOK.md` is the draft.
6. **Attachments** (#4, both). There is no malware scanner, so an upload would stay quarantined
   forever. The message forms therefore hide the file picker and say attachments are not
   available during the beta (build setting `VITE_ATTACHMENTS_ENABLED`, off unless it is exactly
   `true`). To turn them on: deploy the scanner (ClamAV behind `scripts/attachment-scanner.mjs`),
   then set `VITE_ATTACHMENTS_ENABLED=true` in the web `.env` and redeploy.

## Soon after (the beta can start without these)

- **Payments** (#5, #52, #54, Cameron then code). Choose the provider and prices first. The
  signed webhook, checkout and cancellation follow from that. The database models one-off
  package orders today, not subscriptions.
- **Off-site backup copy and point-in-time recovery** (#8, both). Nightly dumps live on the VPS
  only.
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

- Dependencies: `npm audit` is clean. Minor updates are available (supabase-js, playwright);
  Vite 6 → 8 is a major upgrade to plan separately.
- Monitor and backup workflows: watch for failure emails; `Actions → Backup` keeps 14 nightly dumps.
