# Cameron-Gated Items for Private Beta Launch

**Purpose:** Clear list of items only Cameron can complete (money, legal, Supabase account, Stripe live keys, counsel, credentialed educator approval).

**Last updated:** 2026-09-09  
**Status after PR #25:** All code-complete work is done. Only external dependencies remain.

---

## ✅ Code-Complete (Ready to Ship with External Dependencies)

### Product Features
- ✅ Parent authenticated journey (intake → plan → activity → messaging → revision → export/deletion)
- ✅ Educator workbench (triage → assign → author → review → publish → deliver → revise)
- ✅ 25-table household isolation with executable RLS tests
- ✅ Payment state ingestion adapter (signature verification ready, needs webhook secret)
- ✅ Secure attachments (quarantine, retry, uploader recovery)
- ✅ World-class UX (trustworthy, calm, premium)
- ✅ WCAG A/AA automated checks + keyboard navigation
- ✅ Responsive 320px–desktop

### Documentation & Rehearsal
- ✅ Private beta family guide (comprehensive onboarding)
- ✅ Private beta educator onboarding (complete training manual)
- ✅ Pre-VoiceOver accessibility checklist (Linux-verifiable foundations)
- ✅ Empty states audit (world-class polish verified)
- ✅ Demo robustness audit (edge cases handled gracefully)
- ✅ Operational runbooks (incident response, monitoring, privacy, recovery)

---

## 🔒 Cameron-Gated Prerequisites

### 1. Supabase Projects (3–5 hours setup)

**What Cameron must do:**
1. Create Supabase account (if not already)
2. Provision **development project**
   - Apply all 23 migrations from `supabase/migrations/`
   - Seed synthetic households for testing
   - Configure invited-only Auth (no public signup)
   - Verify cross-household denial with `npm run verify:hosted-isolation`
3. Provision **staging project**
   - Apply the same 23 migrations
   - Configure Auth email templates and redirect allowlist
   - Set up managed backups + PITR
   - Verify multi-device save/reload, session refresh, JWT lifetime

**What Cameron provides to codebase:**
- `VITE_SUPABASE_URL` (public, safe to bundle)
- `VITE_SUPABASE_ANON_KEY` (public, safe to bundle)
- For monitoring: `BRITELINK_MONITOR_JWT` (short-lived admin token)

**Documentation:** `docs/SUPABASE_PROVISIONING.md` (step-by-step checklist)

**Priority:** **CRITICAL** — Nothing works without this

---

### 2. Stripe Account (2–3 hours setup)

**What Cameron must do:**
1. Create Stripe account (test mode first)
2. Create products:
   - **Essentials:** $79 (4 weeks, 1 learner, 0 revisions)
   - **Complete:** $149 (8 weeks, 1 learner, 1 revision)
   - **Annual:** $499 (32 weeks, 1 learner, 4 revisions)
3. Configure webhook endpoint pointing to hosted BriteLink API
4. Generate webhook signing secret
5. Test payment flow: checkout → webhook → case creation
6. Test refund and chargeback handling

**What Cameron provides to codebase:**
- `VITE_STRIPE_PUBLISHABLE_KEY` (public, safe to bundle)
- `STRIPE_WEBHOOK_SIGNING_SECRET` (secret, server-only)

**Documentation:** `docs/PAYMENT_OPERATIONS.md` (webhook adapter ready, needs keys)

**Priority:** **HIGH** — Required for paid beta (can use test mode initially)

---

### 3. Privacy Counsel Review (External timeline)

**What Cameron must do:**
1. Submit to qualified Canadian privacy counsel:
   - Privacy notice text (version in `supabase/seed-operational.sql`)
   - Consent flow screenshots
   - Data retention schedule
   - CCPA/PIPEDA data map
2. Incorporate counsel feedback
3. Obtain written approval for private beta

**What Cameron provides to codebase:**
- `VITE_PRIVACY_NOTICE_VERSION` (date string, e.g., "2026-09-15")
- Approved notice text locked in database

**Documentation:** `docs/PRIVACY_OPERATIONS.md` (operations ready, needs approval)

**Priority:** **CRITICAL** — Cannot collect real family data without this

**Timeline:** **Unpredictable** (external counsel, likely 1-4 weeks)

---

### 4. Credentialed Educator Review (External timeline)

**What Cameron must do:**
1. Hire or engage credentialed educator(s)
2. Submit for review:
   - Sample lesson plans (from staging or synthetic)
   - Governed resource library
   - Accessibility scaffolding examples
   - Safeguarding review checklist
3. Obtain educator sign-off for private beta curriculum quality

**What Cameron provides to codebase:**
- Nothing (approval is operational, not code)

**Documentation:** `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md` (training ready)

**Priority:** **CRITICAL** — Cannot deliver plans without educator approval

**Timeline:** **Unpredictable** (external educator, likely 1-2 weeks)

---

### 5. External Monitoring + Alerting (1–2 hours)

**What Cameron must do:**
1. Choose monitoring service (UptimeRobot, PagerDuty, Pingdom, etc.)
2. Configure heartbeat check to `/api/health` (or run `npm run health:hosted`)
3. Set up alert destinations (email/SMS/Slack)
4. Name incident contacts (primary + backup)
5. Test alert delivery (simulate downtime)

**What Cameron provides to codebase:**
- Nothing (external service configuration)

**Documentation:** `docs/MONITORING_OPERATIONS.md` (probe contract ready)

**Priority:** **HIGH** — Required before private beta (operational safety)

---

### 6. Malware Scanner (2–4 hours)

**What Cameron must do:**
1. Choose scanner:
   - **Self-hosted ClamAV** (free, requires server)
   - **VirusTotal API** (paid, easier integration)
2. Integrate with Supabase Storage:
   - Edge Function or webhook on file upload
   - Update `attachment.scan_status` based on result
3. Test with EICAR test file (standard malware test file)
4. Verify quarantine and clean states

**What Cameron provides to codebase:**
- Scanner integration (may be Edge Function or webhook)

**Documentation:** `docs/ATTACHMENT_OPERATIONS.md` (quarantine model ready)

**Priority:** **MEDIUM** — Beta can launch with upload disabled or staff-only

---

### 7. Manual Accessibility Testing (4–8 hours)

**What Cameron must do:**
1. Run `docs/PRE_VOICEOVER_CHECKLIST.md` on Linux (verify foundations)
2. Schedule macOS VoiceOver tester
3. Tester follows `docs/MANUAL_ACCESSIBILITY_QA.md` protocol:
   - Demo parent journey (Overview, Learning plan, Learner profile, Educator demo)
   - Authenticated parent harness journey
   - Educator harness journey
4. Tester performs true browser zoom (Chrome 200% and 400%)
5. Document findings in `qa/accessibility/manual-report.md`
6. Fix critical issues, document medium/minor issues

**What Cameron provides to codebase:**
- `qa/accessibility/manual-report.md` (evidence)
- Sanitized artifacts in `qa/accessibility/manual/`

**Documentation:** `docs/MANUAL_ACCESSIBILITY_QA.md` + `docs/PRE_VOICEOVER_CHECKLIST.md`

**Priority:** **HIGH** — Required for private beta (accessibility gate)

**Timeline:** 1-2 days (dependent on tester availability)

---

### 8. Beta Family Recruitment (Cameron-led)

**What Cameron must do:**
1. Identify 5–10 families from network or homeschool groups
2. Obtain explicit written consent for beta testing
3. Send `docs/PRIVATE_BETA_FAMILY_GUIDE.md` to prepare families
4. Collect contact information (email for account invitations)
5. Set expectations: beta roughness, 5-7 day SLA, named support

**What Cameron provides to codebase:**
- Email addresses for Supabase Auth invitations

**Documentation:** `docs/PRIVATE_BETA_FAMILY_GUIDE.md` (ready to send)

**Priority:** **CRITICAL** — Private beta requires families

**Timeline:** 1-2 weeks (recruitment + consent collection)

---

### 9. Educator Hiring + Training (Cameron-led)

**What Cameron must do:**
1. Hire 1-2 credentialed educators (or engage as contractors)
2. Create staff accounts in Supabase Auth
3. Onboard using `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md`
4. Shadow and co-author first cases
5. Define capacity model (8-12 active cases per educator)

**What Cameron provides to codebase:**
- Staff account invitations in Supabase Auth

**Documentation:** `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md` (ready to use)

**Priority:** **CRITICAL** — Cannot deliver plans without educators

**Timeline:** 1-2 weeks (hiring + training)

---

### 10. Support Contact Details (Cameron decision)

**What Cameron must do:**
1. Decide support channels (email, phone, SMS, Slack, etc.)
2. Define business hours (e.g., Mon–Fri 9am–5pm ET)
3. Set response SLA (e.g., 1 business day for messages, 4 hours for urgent)
4. Name support contacts (primary + backup)

**What Cameron provides:**
- Update `docs/PRIVATE_BETA_FAMILY_GUIDE.md` with actual contact info
- Update `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md` with escalation contacts

**Documentation:** Placeholder contacts exist, Cameron fills in real values

**Priority:** **HIGH** — Required before beta invitations

---

## Sequencing (What Order to Do This In)

### Phase 1: Infrastructure (Can Start Immediately)

**Parallel track A:**
1. Supabase development project (3–5 hours)
2. Stripe test mode (2–3 hours)

**Parallel track B:**
1. Submit to privacy counsel (external, 1-4 weeks)
2. Hire/engage credentialed educator (1-2 weeks)

**Parallel track C:**
1. Run pre-VoiceOver checklist (1 hour)
2. Schedule macOS VoiceOver tester (when ready)

---

### Phase 2: Verification (After Phase 1 Complete)

1. Deploy to Supabase staging
2. Run `npm run verify:hosted-isolation` (2–4 hours)
3. Exercise full authenticated journey
4. Verify Stripe webhook (test mode)
5. VoiceOver + true zoom testing (4–8 hours)

---

### Phase 3: Beta Prep (After Phase 2 Complete)

1. Counsel approves privacy notice → Set `VITE_PRIVACY_NOTICE_VERSION`
2. Educator approves curriculum → Sign-off documented
3. External monitoring + alerts configured → Test delivery
4. Malware scanner integrated → Test with EICAR file
5. Support contacts finalized → Update family and educator guides

---

### Phase 4: Private Beta Launch (After Phase 3 Complete)

1. Recruit 5–10 families → Obtain consent
2. Train educators → Complete onboarding guide
3. Send family guide → Set expectations
4. Invite families to staging → First cases begin
5. Daily monitoring for 2 weeks → Weekly check-ins

---

## What Cameron Does NOT Need to Do

### Already Complete (Code-Complete)

- ✅ All product features (parent + educator journeys)
- ✅ World-class UX (trustworthy, calm, premium)
- ✅ Household isolation (25-table RLS, executable tests)
- ✅ Payment adapter (webhook signature verification ready)
- ✅ Secure attachments (quarantine model implemented)
- ✅ Accessibility foundations (automated tests passing)
- ✅ Operational runbooks (incident response, monitoring, privacy, recovery)
- ✅ Beta rehearsal docs (family guide, educator onboarding, quality audits)

### Intentionally Deferred (Not Required for Beta)

- ❌ Multi-learner support (single-learner MVP)
- ❌ Real-time AI tutoring (async human service model)
- ❌ Gamification (intentionally excluded)
- ❌ Video content hosting (governed external links sufficient)
- ❌ Mobile native apps (responsive web works)
- ❌ Multi-language support (English-only MVP)
- ❌ Advanced analytics (basic reporting sufficient)

---

## Summary: Cameron's Critical Path

**Immediate actions (1-2 weeks):**
1. ✅ Provision Supabase dev + staging projects (3–5 hours)
2. ✅ Configure Stripe test mode (2–3 hours)
3. ✅ Submit to privacy counsel (external, 1-4 weeks)
4. ✅ Hire/engage credentialed educator (1-2 weeks)
5. ✅ Run pre-VoiceOver checklist (1 hour)
6. ✅ Configure external monitoring (1–2 hours)

**After infrastructure ready (1 week):**
1. ✅ Deploy to staging and verify (2–4 hours)
2. ✅ Schedule and complete VoiceOver testing (4–8 hours)
3. ✅ Integrate malware scanner (2–4 hours)
4. ✅ Finalize support contacts (1 hour)

**After approvals + verification (2-4 weeks):**
1. ✅ Recruit 5–10 beta families (1-2 weeks)
2. ✅ Train educators with onboarding guide (1 week)
3. ✅ Send family guide and invite to staging
4. ✅ Launch private beta with daily monitoring

**Total timeline to beta:** 8–14 weeks (assuming no major blockers)

**Highest risk:** External counsel + educator approval timelines (unpredictable)

---

## How to Use This Document

**For Cameron:**
- Use this as your private beta launch checklist
- Work through Phase 1 (infrastructure) immediately
- Phase 2 (verification) can start as soon as Phase 1 is done
- Phase 3 (beta prep) requires counsel + educator approvals
- Phase 4 (launch) is the final gate

**For collaborators:**
- If someone asks "what's left?", point them here
- This is the complete list of Cameron-only dependencies
- Everything else is code-complete and ready to ship

---

**Document owner:** Cameron  
**Next review:** After each phase completion  
**Status:** Phase 0 (pre-infrastructure) — All code-complete work done
