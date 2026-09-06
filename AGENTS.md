# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable prototype design decisions

- Keep navy (`#081326`), BriteLink blue (`#255f9f` / `#3b7dd8` accents), and Inter. Do not introduce a marketing palette.
- Parent and educator journeys must make the next honest action obvious: first incomplete lesson for guardians, priority + next operational step for staff. Never invent live order, educator presence, or ETA in the unconfigured demo.
- Metadata and status text stay at 13px or larger. Interactive controls are at least 44px tall. Mobile navigation is a wrapping 2-up grid, not 10px tabs.
- Intake is a guided three-part form (learning context, household setup, consent), not a multi-page wizard that hides fields.
- Privacy actions stay grouped as “Your plan” vs “Your data” so export, consent withdrawal, and deletion feel deliberate and safe.
- Product Design `get-context` and Mobbin were unavailable in this environment; later visual work should re-check those sources before changing tokens or layout.
