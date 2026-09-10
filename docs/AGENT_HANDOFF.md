# Agent Handoff — BriteLink (`camster91/britelink-mvp`)

**Product:** BriteLink — homeschool curriculum planning with **human educator-in-the-loop** (not unsupervised AI tutor).
**Deploy:** Prefer Ashbi VPS / self-host where possible; staging handoff in `docs/STAGING_HANDOFF.md`. **Ship gate = real staging/VPS verify**, not GitHub Actions alone.
**Owner:** Cameron (camster91)
**Last updated:** 2026-09-10

## Status

- Parent + educator UX largely ready for **private beta**.
- Most remaining work is **Cameron-gated** (Supabase, counsel, Stripe, beta families, VoiceOver sign-off).
- Keep-shipping **paused** until Cameron asks to resume (Cursor usage / billing).

## Read first

1. `docs/END_TO_END_SHIP_PLAN.md`
2. `docs/ship-status.md`
3. `docs/STAGING_HANDOFF.md`
4. This file
5. Open issues #1–#14 (beta readiness roadmap)

## Next agent track (when Cameron resumes)

Only ship **agent-safe** code if something unblocked remains. Otherwise prepare PRs that are ready *after* Cameron unblocks infra:

1. Check open issues for anything not needing Supabase/counsel/Stripe
2. Do **not** fake hosted Auth, counsel approval, or VoiceOver completion
3. Prefer hardening tests/docs over inventing staging credentials

## Do NOT do without Cameron

- Provision Supabase / Auth secrets
- Legal / privacy counsel approval
- Stripe live webhook / checkout keys
- 5–10 beta families / educator curriculum sign-off
- Named incident/privacy contacts
- Claiming staging is live when it is not

## Rules

- Navy + BriteLink blue + Inter; no random marketing palette
- Honest demo: never invent live educator presence / ETA
- Touch targets ≥44px; a11y patterns already started — don’t regress
- World-class bar
