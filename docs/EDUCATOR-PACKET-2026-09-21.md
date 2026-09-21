# Educator quality packet — BriteLink private beta

**Prepared:** 2026-09-21
**Status:** DRAFT for review. Not sent. Engaging a credentialed educator is Cameron's action.
**Purpose:** give a credentialed educator everything needed to sign off curriculum, safeguarding, accessibility, and resource rights for the plans beta families will receive.

## Why this packet exists

BriteLink's claim is human-reviewed planning. That claim is only as good as the human who reviews it. Software already enforces that the author of a plan cannot approve their own work; only a credentialed educator can close that gate.

This packet is what that educator needs. It is deliberately honest about what is not ready.

## 1. What is being asked

A credentialed educator reviews a small set of sample plans and signs off on four things:

1. **Curriculum** — is the content appropriate and coherent for the stated grade and goals?
2. **Safeguarding** — is it age-appropriate, and does it avoid harmful or unsuitable material?
3. **Accessibility** — are instructions clear, are adaptations present, are time estimates reasonable?
4. **Resource rights** — is every external resource correctly attributed, licensed or free to use, and appropriate for a family at home?

The sign-off is a written approval covering the plans that beta families will receive. If the educator rejects the corpus, the plans are fixed and re-reviewed before any family sees them.

## 2. The service model the plans must fit

BriteLink plans are **written for the parent to run with the child**, not for independent child study. This is the single most important design constraint, and the most common way an experienced educator's instinct will need adjusting.

- Instructions address the caregiver: "Read the story aloud together. Pause after each page to ask your child to predict what happens next."
- Not: "Read this story and answer the questions at the end."
- Every lesson carries an *adult help required* estimate.
- Every lesson carries adaptations for different learning styles.
- Materials must be things a family plausibly has or can get free or cheaply.

## 3. What the software enforces, and what it cannot

The educator should know exactly which standards are already mechanical, so review effort goes where judgement is actually needed.

**Enforced in the database, not by convention:**

- Author ≠ reviewer. A plan's author cannot approve it. Checked in the database, not in the UI.
- A plan cannot be published unless all four checks are true: `curriculum_checked`, `safeguarding_checked`, `accessibility_checked`, `resource_rights_checked`.
- Publication is a distinct state from authoring and from review.
- Every review records the reviewer, the timestamp, and notes.

**Cannot be enforced, and is therefore the educator's actual job:**

- Whether the content is *good* — age-appropriate, coherent, worth a child's time.
- Whether a resource is genuinely right for a family at home.
- Whether an adaptation would actually help.
- Whether an estimate of "30 minutes" is honest.

These four flags are a checklist, not a substitute for judgement. An educator who ticks all four without reading the plan defeats the gate entirely.

## 4. Sample corpus for review

The review set is drawn from **fictional or staging-synthetic plans only** — no real family data, per the privacy boundary.

| # | Plan | Package shape | Purpose of including it |
|---|---|---|---|
| 1 | Essentials-style, 4 weeks | Entry tier | The most common beta shape; smallest plan |
| 2 | Complete-style, 8 weeks | Mid tier | Tests multi-week coherence and pacing |
| 3 | Revision example with change summary | Any tier | Tests whether a revision is legible to a family |

Each plan is delivered with:

- The full lesson list, with instructions, materials, adaptations, and adult-help estimates
- The resource list: cost, rights, attribution, region availability, and suggested substitutes
- The safeguarding and accessibility checklist the reviewer is asked to apply

**Note for the reviewer:** at the time of writing the corpus is built from synthetic data so the review can proceed before any family is involved. If the corpus is thin in an area the educator considers essential, saying so is a valid outcome and a useful one.

## 5. What a rejection looks like

A rejection is not a failure of the process; it is the process working. The educator should reject the corpus if:

- Any plan would be inappropriate for its stated age or context
- Instructions are pitched at the child when they should be pitched at the parent
- An adaptation is decorative rather than useful
- A resource is paywalled, unlicensed, misattributed, or unsuitable
- Time estimates are unrealistic for a family doing this at home
- The plan assumes school-style pacing or a school-like environment

## 6. What happens after sign-off

- Approval closes the Quality gate in `docs/RELEASE_READINESS.md`.
- The approved corpus defines the standard against which later plans are authored.
- Every future published plan still requires an independent reviewer, but the approved corpus sets the bar.

## 7. Context the educator may find useful

- `docs/HOMESCHOOL-RESEARCH.md` — the Ontario-first research base, including why the product deliberately avoids compliance theatre and school-style red/green judgement.
- `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md` — the full educator training manual.
- `docs/BUILD-PRIORITIES.md` — the product direction, including the design rule "never use anxiety as retention."

## 8. Decisions requested

1. **Accept or reject the sample corpus**, with reasons.
2. **Confirm or amend the four review criteria** as applied in the reviewer checklist.
3. **State what the corpus must include to represent the beta faithfully**, if something essential is missing.
4. **Give a written quality sign-off** covering curriculum, safeguarding, accessibility, and resource rights.

## Open drafting notes — for Cameron, remove before sending

- The corpus in section 4 does not exist yet as a packaged artifact. Either build it from staging-synthetic plans (Workstream D4 must run first), or send this packet as the *protocol* and build the corpus before the educator reviews. Do not send section 4 as if the plans are ready when they are not.
- Section 3's closing warning is deliberately blunt. An educator who feels lectured will review less carefully; consider softening the tone while keeping the substance.
- Confirm the engagement terms (paid or volunteer, time expected, who owns the review notes) are settled before this goes out.
- The reviewer needs a staging account to see plans in the product, or the plans must be exported to a readable format. Decide which; a PDF export does not yet exist.
