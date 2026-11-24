# BriteLink

Educator-authored learning plans for homeschool families, delivered through a private, secure workspace.

**Site:** [britelink.ashbi.ca](https://britelink.ashbi.ca)

## Status

The app, database schema and tests are built. It is a beta in preparation: [the to-do list](docs/TODO.md) records what must be finished before real families are invited, including proving sign-in email, educator content sign-off and the support model.

- **Hosting is being moved.** The earlier deployment, backup, migration and monitoring workflows were removed on 2026-11-19. The repository now holds a Cloudflare Pages build configuration. Parts of `docs/`, including `PROJECT-STATUS.md`, `AGENT_HANDOFF.md`, `RELEASES.md` and `TODO.md`, still describe the earlier hosting.
- **Attachments** are hidden unless `VITE_ATTACHMENTS_ENABLED` is `true`, which needs a running malware scanner.
- **Payments and notification emails** are not switched on in the last status record: the payment provider is still to be chosen, and notification wording awaits approval.
- **Migrations 060 to 065** are in the repository; that record lists them as not yet applied to production.

## What it does

Parents get a personalised learning plan written by a real educator, plus a calm place to run it day to day. Educators get a case workbench with an independent review gate. Nothing is AI-generated: every plan is authored and reviewed by a person, and the software enforces that separation.

With no backend configured, the app runs an interactive demo with fictional family data, kept in the browser only and clearly labelled as a demo.

## Features

**For families**
- Planning intake that captures structured context (never diagnosis, health, school or address data)
- A multi-week plan with lessons, materials, adaptations and honest adult-help estimates
- Daily lesson flow: start, pause, complete, skip, reschedule and add notes, plus a simple learner view
- A family day view across learners, shared family activities and paused subjects
- Learning captures for work done outside the plan, including CSV import
- Weekly summaries with educator notes, and a learning report you can export as CSV
- A private calendar feed (ICS) of the plan
- Case-scoped messaging (attachments are off by default, see Status)
- Export, correction and deletion requests handled through a reviewed path

**For educators and administrators**
- A priority-ordered case queue with SLA awareness
- Case lifecycle: intake, triage, assign, author, review, publish, deliver, revise
- Plan authoring with governed resources and saved drafts
- An independent review gate: **the author of a plan cannot approve it**, enforced in the database
- Delivery tracking, revision re-delivery and exception handling

## Architecture

A React single-page app on top of Supabase (PostgreSQL, Auth and private storage). There is no custom application server in the main path: the browser talks to PostgreSQL through row-level security.

```
Browser (React 19 / Vite)
   |  public anon key only, never a service key
   v
Supabase  --  PostgreSQL with row-level security on every private table
          --  Auth (passwordless magic link)
          --  Private storage bucket (attachments quarantined on upload)
```

- **Authorization lives in the database, not the UI.** Every private row carries a household id and PostgreSQL row-level security decides visibility. Sensitive writes go through `SECURITY DEFINER` functions rather than direct table access.
- **Build-time guard:** `src/supabase-config.js` decodes the configured key and fails the build if a service-role key ever ends up in a `VITE_` variable.
- **Locked-down web tier (Docker image):** nginx serves the SPA with a Content-Security-Policy derived from the same build setting that configures the API origin, so they cannot drift apart. The calendar-feed route is also part of `nginx.conf.template`, which does not apply to a Cloudflare Pages build.
- **Traceable releases:** each build stamps `/version.json` with its commit, so the running revision can always be checked.

## Tech stack

- React 19, Vite 6 (JavaScript, no TypeScript)
- Supabase: PostgreSQL, row-level security, Auth, Storage
- Node's built-in test runner, PGlite for in-process PostgreSQL tests
- Playwright and axe-core for browser journeys and accessibility audits
- Docker and nginx for a self-hosted image; Cloudflare Pages configuration in `wrangler.jsonc`
- GitHub Actions CI

## Getting started

Requires Node 22.12 or newer.

```bash
npm ci
npm run dev          # http://localhost:5173
```

That is enough to run the demo. To connect a Supabase project, copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_` variable.

Other optional browser settings:

| Variable | Purpose |
|---|---|
| `VITE_PRIVACY_NOTICE_VERSION` | Approved privacy notice version; guardian intake stays locked without it |
| `VITE_ATTACHMENTS_ENABLED` | `true` shows attachment upload; leave empty without a scanner |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile check before sign-in emails; empty means no check |

`.env.example` lists the server-only, monitoring and staging variables. See [HOW-TO-RUN.md](HOW-TO-RUN.md) for more.

The database schema is defined by the numbered, append-only migrations in `supabase/migrations/`.

## Testing

```bash
npm test                    # unit and integration tests (node:test)
npm run test:a11y           # axe WCAG 2 A/AA audit across views and viewports
npm run test:authenticated  # full parent journey in a real browser
npm run test:staff          # full educator workbench journey
npm run test:households     # multi-household role routing and data scope
npm run test:staff-attachments  # staff attachment recovery
npm run test:beta-signup    # beta sign-up
npm run test:migrations     # apply every migration to a throwaway PostgreSQL (needs Docker)
```

What the tests cover:

- **Security schema:** static checks that policies, grants and revocations match intent
- **RLS by execution:** a real PostgreSQL (PGlite) where cross-household reads are attempted and denied
- **Migration chain:** every migration applied in order to a throwaway database in CI
- **Browser journeys:** the actual parent and educator flows, driven as a user would
- **Provenance guard:** CI fails if a tracked test imports a file git does not track

CI (`.github/workflows/ci.yml`) runs the build, unit tests, migration harness, browser audits and checks of the built Docker images on pushes to `main` and on every pull request.

## Deployment

- **Cloudflare Pages:** `wrangler.jsonc` sets the output directory to `dist/client` (from `npm run build`) and `public/_redirects` provides the single-page fallback. Built without Supabase settings, it is the demo.
- **Docker:** `docker compose up --build -d` builds the nginx image and serves it on `127.0.0.1:8088`.
- **Database:** migrations are never applied by a web build. No workflow in this repository deploys the app or applies migrations to a hosted database.

## Project structure

```
src/                   React app (App.jsx is the demo, AuthenticatedApp.jsx the real workspace)
supabase/migrations/   Numbered SQL migrations, the schema's source of truth
supabase/selfhosted/   Reference copy of the self-hosted Supabase stack (compose, gateway)
tests/                 Domain, RLS, security schema and repository tests
scripts/               Browser audits, the migration harness and the ops scripts
qa/                    Browser-audit harnesses; audit screenshots and reports are written here
deploy/                Coolify backend hooks and their tests (earlier hosting)
.github/               CI and its image-check scripts
docs/                  TODO, status, runbooks, product research and family/educator guides
```

## Product principles

- A human educator authors and reviews every plan. The product never pretends a person is involved when they are not.
- No shame streaks, no "behind" labels and no assumed school pacing.
- Deliberately out of scope: child logins, AI-generated plans, community features, and health, diagnosis or IEP data.
- Accessibility is a requirement: WCAG 2 AA audits run in CI.

More detail: [build priorities](docs/BUILD-PRIORITIES.md), [homeschool research](docs/HOMESCHOOL-RESEARCH.md), [privacy operations](docs/PRIVACY_OPERATIONS.md).

## Licence

This repository has no licence file.
