# Ship handoff

> **Read `docs/AGENT_HANDOFF.md` first**, then `docs/TODO.md` (the one list of what is left) and `docs/PROJECT-STATUS.md` (what is verified). Older plans live in `docs/archive/` for history only.

## How to build apps and websites for Cameron

These are the owner's standing rules for every person and agent working in this repository.

You are building for real people with busy lives. Your job is to make things that are simple, useful, and enjoyable, so people come back.

### The main rule
Simple on the surface, powerful underneath. If a change makes the app harder to use, rethink it or cut it.

### If this app already exists (read this first)
- Before changing anything, look around. Learn how the app works, how the code is organized, and what patterns and styles it already uses.
- Follow the existing design system, naming, and code style. Match what is there. Do not introduce a new framework, library, or style unless Cameron approves it.
- Improve in small, safe steps. No big rewrites unless asked.
- Do not break what already works. Do not remove features, change data, or alter how users log in or pay without asking first.
- Protect real user data. Never delete or reshape it without a plan and Cameron's OK.
- When you spot problems outside your task (bugs, messy code, poor UX), list them. Don't fix them all at once unless asked.
- Leave the code cleaner than you found it, but only in the area you are working on.

### Before you build
- Ask: who is using this, what are they trying to get done, and what gets in their way? Build for that.
- Picture a real day: people are on their phone, distracted, in a hurry, tired, or new to this. Design for that person.
- If something is unclear, ask. Do not guess and fill gaps with generic filler.

### UI and experience
- One clear main action per screen. Make the next step obvious.
- Use plain words. Short labels. No jargon.
- Fewer clicks, fewer fields, fewer choices. Use smart defaults.
- Mobile first. Fast to load. Works with one thumb.
- Accessible by default: good contrast, readable text, keyboard friendly, labels on inputs, alt text on images.
- Every state is designed: loading, empty, error, success. Errors say what went wrong and how to fix it, in human words.
- Let people undo. Save their progress. Never lose their work.
- Consistent spacing, type, and colors. Clean and calm, not cluttered.
- Add small moments of delight: a friendly empty state, a satisfying confirmation, a helpful shortcut. Keep it light, never in the way.

### Features
- Solve the real problem first. Then add features that make it easier, faster, or more fun to keep using.
- Good features remember things for people, save them time, remind them at the right moment, or show progress.
- Every feature must earn its place. If people would not miss it, leave it out.
- Build features so they can grow later without a rewrite.

### Code
- Simple, readable code beats clever code. Name things clearly.
- Small pieces that do one job. Reuse what already exists before writing something new.
- Follow current best practices for the stack in use.
- Secure by default: validate input, protect user data, no secrets in code.
- Fast: no heavy libraries you don't need, optimize images, load only what is needed.
- Test the important paths, including anything you touched that was already working. Never fail silently.
- Leave it easy for the next person (or agent) to understand and change.

### No AI slop
- No generic templates, stock phrases, or placeholder content left in.
- No fake features, fake data, or buttons that do nothing.
- No lorem ipsum, vague marketing fluff, or random visual effects just to look modern.
- Every word, screen, and line of code should have a reason to exist.

### Before you say you are done
- Use it like a real person would, start to finish, on mobile and desktop.
- Check that existing features still work.
- Ask: Is it obvious what to do? Is it fast? Does anything break? Would a normal person enjoy using this?
- Report: what you changed, why, what you checked, and anything Cameron needs to decide.

# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Production serves the static build in `dist/client/` (Coolify, `Dockerfile`); see `docs/AGENT_HANDOFF.md` → "How production works". The old OpenAI Sites packaging was removed on 2026-10-18 by Cameron's decision.

## Durable prototype design decisions

- Keep navy (`#081326`), BriteLink blue (`#255f9f` / `#3b7dd8` accents), and Inter. Do not introduce a marketing palette.
- Parent and educator journeys must make the next honest action obvious: first incomplete lesson for guardians, priority + next operational step for staff. Never invent live order, educator presence, or ETA in the unconfigured demo.
- Metadata and status text stay at 13px or larger. Interactive controls are at least 44px tall. Mobile navigation is a wrapping 2-up grid, not 10px tabs.
- Intake is a guided three-part form (learning context, household setup, consent), not a multi-page wizard that hides fields.
- Privacy actions stay grouped as “Your plan” vs “Your data” so export, consent withdrawal, and deletion feel deliberate and safe.
- Form errors must name the affected fields, use `aria-invalid` / `aria-describedby`, announce via a live region or alert summary, and move focus to the first invalid control.
- Demo and authenticated shells keep a skip link, labelled `main`, and per-view document titles so a later VoiceOver pass can start from a predictable landmark order.
- Product Design `get-context` and Mobbin remain unavailable in this environment; re-check those sources before changing tokens or layout system.
- Unsent typing survives the idle sign-out (owner decision 2026-10-18, `src/form-drafts.js`): intake answers, lesson notes, messages and staff plan drafts are kept in this browser's localStorage for at most 24 hours, only for the same signed-in person, and removed on send/submit or when anyone presses Sign out. Consent is never kept. Use the same helper for any new long form.
- Owner decisions 2026-10-21: a family that signs itself up waits for a staff admin's approval before work on its case starts (064), deleting a family also deletes its sign-in accounts (065), sign-in emails need a Cloudflare Turnstile person check once configured (`src/human-check.js`), and web releases go through the approved Release workflow with automatic undo (`docs/RELEASES.md`).
- Staging operators follow `docs/STAGING_HANDOFF.md`; do not fake hosted Auth, counsel approval, or VoiceOver completion.
