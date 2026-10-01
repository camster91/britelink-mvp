# Checked production frontend preparation

The saved demo and configured QA images use disposable settings. They cannot
replace the production frontend. A production candidate must use the reviewed
public API origin, anonymous-key digest, notice version and attachment flag.

`public_build_profile.py` validates a profile with exactly these fields:

```json
{
  "schema": 1,
  "repository": "camster91/britelink-mvp",
  "apiOrigin": "https://api.example.test",
  "anonKeySha256": "<64 hexadecimal characters from the reviewed public key>",
  "privacyNoticeVersion": "",
  "attachmentsEnabled": false
}
```

This example is illustrative, not an executable or approved production profile.
The digest is SHA256 of the UTF-8 canonical JSON produced by `profile_digest`:
sorted keys, compact separators, ASCII escapes. The operator reviews the actual
profile and supplies its file path and digest in `BRITELINK_PUBLIC_PROFILE_FILE`
and `BRITELINK_PUBLIC_PROFILE_SHA256`. A digest proves settings identity; it does
not itself record human approval or prove backend ownership.

Before the first build, verify the public anonymous JWT against the existing
production Auth signing secret on the VPS. Export only the public key digest,
role, expiry and match result. Never export the signing secret, service-role key
or database credentials to GitHub or a frontend build. Review the notice version
and attachment flag separately: these helpers do not approve privacy text or
activate a scanner. Empty notice versions and disabled attachments remain valid.

After that review, `build-production-image.py` accepts the public anonymous key
as `BRITELINK_PUBLIC_ANON_KEY` and a full source commit as `RELEASE_SHA`. It creates
`britelink:production-candidate` with explicit build arguments. It suppresses
child-process output on failure because Docker diagnostics can contain the
public key. It does not publish, deploy, modify credentials or change GitHub
settings. The private backend signing secret is never an input.

With `BRITELINK_CHECKED_BUILD_MODE=production-configured`, `checked-image.py`
exports/verifies/imports that saved image under a separate production import
tag. It requires the reviewed profile file/digest, exact source/run/attempt,
archive and image checksums, expected nginx startup and every public metadata
value. The receipt binds the canonical profile digest. Demo/QA receipts cannot
claim a production profile, and changing a receipt cannot promote a fixture.
Loaded configuration and filesystem must still match the saved archive.

This source change alone is not a release pipeline. The production build is not
enabled in CI, and the existing CI-to-SSH deploy owner is unchanged. Existing
transport jobs exercise the new unit and synthetic archive tests; mocked build
tests do not demonstrate that Docker built or served an actual production image.

Remaining release requirements:

- Build with the reviewed real public settings on an isolated build runner.
- Import the exact saved image on a fresh runner and verify HTTP/TLS/CSP,
  revision and authenticated journeys against a disposable backend. The test
  must prevent requests or writes to production and use separate fixture keys.
- Publish the exact accepted image and durable profile-bound receipts; verify
  registry identity and VPS access.
- Prepare the inactive Coolify frontend and guarded checked-main consumer.
  Preserve the existing Supabase backend, RLS, storage, Auth and backup owner.
- Verify fresh encrypted recovery, then obtain the exact first deployment and
  release-owner handoff approval before changing routes or the old deploy path.

The observed legacy GitHub fetch failure is not repaired by this preparation.
Do not rotate its credential, enroll SSH keys or disable its workflow as part of
the source change. Those are separate scoped operations.
