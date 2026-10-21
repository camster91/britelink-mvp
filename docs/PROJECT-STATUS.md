# PROJECT STATUS — BriteLink

**Last updated:** 2026-10-16

What is verified in production, with evidence. What is still to do lives in `docs/TODO.md`.
Where production runs is in `docs/AGENT_HANDOFF.md` → "How production works". The September 2026
completion-pass status is archived in `docs/archive/PROJECT-STATUS-2026-09-21.md`.

## Production

- **Deploys.** The web app is deployed by Coolify since 2026-10-01 (#86). The GitHub Actions SSH
  Deploy workflow (#33) was switched off by hand that day; its runs up to then are in Actions →
  Deploy (for example run 8 for `9b3a651`:
  https://github.com/camster91/britelink-mvp/actions/runs/36679036677). `/version.json` names the
  deployed commit, and the site serves HSTS, CSP and nosniff.
- **Privacy notice.** The approved notice `2026-09-30` is live, so guardian intake is open.
- **Database.** Migrations 001–059 are applied, each with the Migrate workflow after a
  pre-migrate backup. 060 (staff team), 061 (staff safeguards), 062 (staff access follows the
  work) and 063 (review database follow-ups) are in the repo and wait for the owner's go.
  - 001–052 by 2026-09-30.
  - 053 (review integrity, [run](https://github.com/camster91/britelink-mvp/actions/runs/36908951781))
    and 054 (privacy integrity, [run](https://github.com/camster91/britelink-mvp/actions/runs/36920564561))
    on 2026-10-01.
  - 055 (revision requires a request, [run](https://github.com/camster91/britelink-mvp/actions/runs/37036465471))
    and 056 (staff workflow integrity, [run](https://github.com/camster91/britelink-mvp/actions/runs/37051085621))
    on 2026-10-02.
  - 057 (staff display names) and 058 (email notifications,
    [run](https://github.com/camster91/britelink-mvp/actions/runs/37355887020)) on 2026-10-05.
  - 059 (review follow-ups, #101,
    [run](https://github.com/camster91/britelink-mvp/actions/runs/37488481690)) on 2026-10-06.
  - GoTrue, PostgREST and storage share the key-signing secret (`restore-secret`, #65). The public
    anon key is accepted.
- **Calendar feed route live.** A dummy token answers 404. The earlier 502 was nginx's default
  verify depth against a cross-signed Let's Encrypt chain (#71). Feed paths are excluded from
  Traefik's access log (#67).
- **Hourly external monitor (#7):** `monitor.yml`, green on every run checked on 2026-10-15.
- **Nightly verified backup (#8):** `backup.yml`. Each dump is restored into a throwaway container
  and its row counts compared before it is kept. The encrypted Google Drive copy switches on once
  its two secrets exist (`RECOVERY_OPERATIONS.md`).
- **Email notifications (#99):** built and scheduled, but send nothing until counsel approves the
  wording and `NOTIFICATIONS_ENABLED` is set.

## Repository checks (2026-10-15)

- `npm test`: 351 pass, 0 fail (2026-10-18). It no longer needs a build first.
- CI on `main` runs the build and tests, the migration harness on real PostgreSQL, all browser
  audits, and the saved-image runtime checks.
- A full-repo review on 2026-10-15 found no way for one family to read or write another family's
  data. Its security and app findings were fixed in #114. The rest are in `docs/TODO.md`.

## Still needs a person

These cannot be closed from the repository. Each is an item in `docs/TODO.md`:

- Sign-in email proven end to end with a real invited address (#2).
- Counsel's answer on the one consent recorded under the draft notice.
- Educator content sign-off (#11) and the support model (#55).
- VoiceOver and true 200%/400% zoom (#9).
