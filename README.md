# BriteLink

Educator-authored learning plans for homeschool families, delivered through a private, secure workspace.

**Live:** [britelink.ashbi.ca](https://britelink.ashbi.ca) (private beta)

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
- Case-scoped messaging with attachments
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
- **Locked-down web tier:** the SPA is served by nginx with a Content-Security-Policy derived from the same build setting that configures the API origin, so they cannot drift apart.
- **Traceable releases:** each build stamps `/version.json` with its commit, so the running revision can always be checked.

## Tech stack

- React 19, Vite 6 (JavaScript, no TypeScript)
- Supabase: PostgreSQL, row-level security, Auth, Storage
- Node's built-in test runner, PGlite for in-process PostgreSQL tests
- Playwright and axe-core for browser journeys and accessibility audits
- Docker and nginx for the production image
- GitHub Actions CI

## Getting started

Requires Node 22.12 or newer.

```bash
npm ci
npm run dev          # http://localhost:5173
```

That is enough to run the demo. To connect a Supabase project, copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_` variable.

The database schema is defined by the numbered, append-only migrations in `supabase/migrations/`.

## Testing

```bash
npm test                    # unit and integration tests (node:test)
npm run test:a11y           # axe WCAG 2 A/AA audit across views and viewports
npm run test:authenticated  # full parent journey in a real browser
npm run test:staff          # full educator workbench journey
npm run test:households     # multi-household role routing and data scope
npm run test:migrations     # apply every migration to a throwaway PostgreSQL (needs Docker)
```

What the tests cover:

- **Security schema:** static checks that policies, grants and revocations match intent
- **RLS by execution:** a real PostgreSQL (PGlite) where cross-household reads are attempted and denied
- **Migration chain:** every migration applied in order to a throwaway database in CI
- **Browser journeys:** the actual parent and educator flows, driven as a user would
- **Provenance guard:** CI fails if a tracked test imports a file git does not track

CI runs the build, unit tests, migration harness and browser audits on pushes to `main` and on every pull request.

## Project structure

```
src/                   React app (App.jsx is the demo, AuthenticatedApp.jsx the real workspace)
supabase/migrations/   Numbered SQL migrations, the schema's source of truth
tests/                 Domain, RLS, security schema and repository tests
scripts/               Browser audits and the migration harness
docs/                  Product research, privacy and family/educator guides
```

## Product principles

- A human educator authors and reviews every plan. The product never pretends a person is involved when they are not.
- No shame streaks, no "behind" labels and no assumed school pacing.
- Deliberately out of scope: child logins, AI-generated plans, community features, and health, diagnosis or IEP data.
- Accessibility is a requirement: WCAG 2 AA audits run in CI.

More detail: [build priorities](docs/BUILD-PRIORITIES.md), [homeschool research](docs/HOMESCHOOL-RESEARCH.md), [privacy operations](docs/PRIVACY_OPERATIONS.md).
