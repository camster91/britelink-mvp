# BriteLink End-to-End Ship Plan

**Mission**: Get BriteLink as close to 100% parity with EduGPT/Nohkoo/AI Home Academy/GuruX while maintaining BriteLink's competitive edge: **human educator-in-the-loop + earned trust** (not unsupervised AI tutor).

**Status**: UX at world-class bar (PR #21 merged). Many P0s blocked on external dependencies (Supabase, counsel, Stripe, beta families).

**Last updated**: 2026-09-09

---

## 1. Vision & Paid Offer

### BriteLink's Unique Position

**What we are:**
- Professional homeschool curriculum planning and support service
- Human credentialed educators design personalized weekly learning plans
- Parents execute at home with clear instructions, materials, and scaffolding
- Secure messaging and revision support included
- Trust through human expertise, transparency, and real accountability

**What we are NOT:**
- An unsupervised AI tutor chatbot
- A replacement for parent involvement
- An automated content generator without human review
- A "set it and forget it" learning app

### Competitive Edge vs Pure AI Tutors

| Dimension | BriteLink | EduGPT/Nohkoo/GuruX/AI Home Academy |
|-----------|-----------|-------------------------------------|
| **Planning quality** | Credentialed human educator creates personalized 8-week curriculum | AI-generated lessons, variable quality, no human oversight |
| **Accountability** | Named educator, internal review gate, SLA commitment (5-7 business days) | No SLA, no named human, no recourse |
| **Trust & safety** | Independent author/reviewer separation, safeguarding review, governed resources | AI hallucinations, unverified links, no safety review |
| **Personalization** | Deep structured intake (12 fields), clarification requests, human judgment | Surface-level prompts, algorithmic matching |
| **Parent support** | Secure messaging, revision requests (1-4 per package), re-delivery with human review | Generic chatbot, no human escalation path |
| **Privacy & compliance** | Counsel-reviewed consent, household isolation, RLS enforcement, CCPA/PIPEDA alignment | Privacy policy may not match practices, data usage unclear |
| **Accessibility** | WCAG A/AA verified, keyboard/screen-reader tested, 200%/400% zoom support | Often fails accessibility audits |
| **Progress tracking** | Lesson-scoped activity, rescheduling without data loss, caregiver notes | Simple completion checkboxes, data loss on errors |

### Paid Packages

| Package | Price | What's Included | Best For |
|---------|-------|-----------------|----------|
| **Essentials** | $79 | 1 learner, 4 weeks personalized plan, secure messaging, 5-day SLA, 0 revisions | Trial, single-subject focus, budget-conscious families |
| **Complete** | $149 | 1 learner, 8 weeks personalized plan, secure messaging, 7-day SLA, 1 revision | Full quarter, multiple subjects, families wanting flexibility |
| **Annual** | $499 | 1 learner, 32 weeks (8 months), secure messaging, 7-day SLA, 4 revisions | Committed homeschoolers, year-round planning, maximum support |

**Revenue model**: Upfront payment via Stripe. Case begins after usable intake + active consent. Refunds/chargebacks trigger hold state.

---

## 2. Product Completion vs Live Competitors

### Honest Feature Parity Assessment

| Feature | BriteLink Status | EduGPT | Nohkoo | AI Home Academy | GuruX | Notes |
|---------|------------------|--------|--------|-----------------|-------|-------|
| **Account creation** | ⚠️ Code ready, Supabase needed | ✅ | ✅ | ✅ | ✅ | Passwordless Auth scaffold complete, needs hosted config |
| **Structured intake** | ✅ Fully implemented | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | Our 12-field intake is deeper |
| **Personalized curriculum** | ✅ Human-authored, 8 weeks | ✅ AI-generated | ✅ AI-generated | ✅ AI-generated | ✅ AI-generated | Ours requires human educator |
| **Interactive lessons** | ✅ Instructions + materials + adaptations | ✅ AI chat | ✅ Video + quiz | ✅ Adaptive exercises | ✅ AI tutor | Different paradigm: we guide parents, they guide AI learners |
| **Progress tracking** | ✅ Lesson-scoped, persistent | ✅ | ✅ | ✅ | ✅ | Ours includes rescheduling without data loss |
| **Parent dashboard** | ✅ World-class UX (PR #21) | ⚠️ Basic | ⚠️ Cluttered | ⚠️ Ad-heavy | ⚠️ Basic | Linear/Notion quality bar |
| **Messaging/support** | ✅ Secure case messaging | ⚠️ Generic chat | ⚠️ Email only | ⚠️ Community forum | ⚠️ FAQ/bot | Ours is case-scoped, audited, human-responded |
| **Revision requests** | ✅ Entitled, governed | ❌ | ❌ | ❌ | ❌ | Unique to BriteLink |
| **Accessibility** | ✅ WCAG A/AA verified | ❌ | ❌ | ❌ | ⚠️ Partial | Automated + manual keyboard, needs VoiceOver evidence |
| **Mobile responsive** | ✅ 320px-tested | ⚠️ Partial | ⚠️ Partial | ⚠️ App-only | ✅ | Web + mobile web ready |
| **Multi-learner** | ⚠️ Schema ready, UI single-learner | ✅ | ✅ | ✅ | ✅ | Blocked on pricing/UX decision |
| **Resource library** | ✅ Governed resources per lesson | ⚠️ Curated | ⚠️ Algorithmic | ⚠️ Ads + SEO | ⚠️ Generic | Ours are educator-verified, rights-checked, per-lesson |
| **Real-time collaboration** | ❌ Not planned | ✅ (AI assistant) | ❌ | ✅ (AI tutor) | ✅ (AI coach) | Different model: async human service |
| **Gamification** | ❌ Not planned | ✅ Badges | ✅ Points | ✅ Rewards | ✅ Streaks | Intentionally excluded (distraction-free) |
| **Payment processing** | ⚠️ Stripe adapter ready, webhook needs signature verification | ✅ | ✅ | ✅ | ✅ | Code complete, needs production keys + testing |
| **Admin/educator tools** | ✅ Complete workbench | ⚠️ CMS only | ⚠️ No visibility | ⚠️ No visibility | ⚠️ No visibility | Triage, authoring, review, delivery, audit |
| **Data export** | ✅ JSON manifest + integrity | ⚠️ PDF only | ❌ | ⚠️ CSV | ❌ | Schema-versioned, attachment metadata, GDPR-ready |
| **Privacy controls** | ✅ Export/correction/deletion/consent withdrawal | ⚠️ Basic | ❌ | ⚠️ Basic | ❌ | CCPA/PIPEDA-aligned, counsel review pending |
| **Household isolation** | ✅ 25-table RLS verified | ⚠️ Unclear | ⚠️ Unclear | ⚠️ Unclear | ⚠️ Unclear | Executable cross-household denial tests pass |

### Feature Completion Summary

**✅ Complete & code-verified (can ship with external dependencies):**
- Parent authenticated journey (intake → plan → activity → messaging → revision → export/deletion)
- Educator workbench (triage → assign → author → review → publish → deliver → revise)
- 25-table household isolation with executable RLS tests
- Payment state ingestion (Stripe webhook adapter ready)
- Secure attachments (quarantine, retry, uploader-owned recovery)
- WCAG A/AA automated checks + keyboard navigation
- Responsive 320px–desktop
- World-class UX (trustworthy, calm, premium)

**⚠️ Code-complete but blocked on external parties:**
- Hosted Supabase (dev + staging projects)
- Stripe production keys + webhook signature verification
- Counsel-approved privacy notice
- Credentialed educator curriculum sign-off
- Malware scanner integration (ClamAV/VirusTotal)
- External monitoring + alerting (UptimeRobot/PagerDuty)
- macOS VoiceOver evidence
- True browser 200%/400% zoom evidence

**❌ Intentionally deferred or not planned:**
- Child direct accounts (parent-mediated only for MVP)
- Real-time AI tutoring (async human service model)
- Gamification/badges (distraction-free focus)
- Video content hosting (link to governed external resources)
- Live chat (async secure messaging only)

---

## 3. Phased Roadmap: Code-Complete vs Cameron-Gated

### Phase 0: Infrastructure Provisioning (Cameron-gated)

**Blocking dependencies Cameron must approve/configure:**

1. **Supabase projects** (3–5 hours setup)
   - [ ] Development project: Apply all 40 migrations, seed synthetic households (`supabase/seed/synthetic-staging.sql`)
   - [ ] Staging project: Apply migrations, configure Auth templates/redirects
   - [ ] Verify: Cross-household denial (104 checks via `npm run verify:hosted-isolation`)
   - [ ] Verify: Multi-device save/reload, session refresh, JWT lifetime
   - **Gate:** Cameron provides project URLs + anon keys (public, safe to bundle)

2. **Stripe account** (2–3 hours setup)
   - [ ] Create products: Essentials ($79), Complete ($149), Annual ($499)
   - [ ] Generate webhook signing secret
   - [ ] Configure test mode checkout
   - [ ] Verify: Payment event ingestion, refund/chargeback handling
   - **Gate:** Cameron provides publishable key + webhook secret

3. **Privacy counsel review** (external timeline)
   - [ ] Submit privacy notice, consent flow, retention schedule to Canadian counsel
   - [ ] Incorporate feedback
   - [ ] Obtain written approval for private beta
   - **Gate:** Counsel signs off on notice version, consent language, data map

4. **Credentialed educator review** (external timeline)
   - [ ] Curriculum quality audit (sample lesson plans, resources)
   - [ ] Safeguarding review (child safety, appropriate content)
   - [ ] Accessibility scaffolding review
   - **Gate:** Credentialed educator approves sample delivery for private beta

5. **Monitoring setup** (1–2 hours)
   - [ ] UptimeRobot or similar: Configure heartbeat check to `/api/health`
   - [ ] Set up alert destinations (email/SMS/Slack)
   - [ ] Name incident contacts
   - **Gate:** Cameron configures and tests alert delivery

6. **Attachment scanner** (2–4 hours research + config)
   - [ ] Choose ClamAV self-hosted or VirusTotal API
   - [ ] Wire into Supabase Storage webhook or Edge Function
   - [ ] Test: Upload malware test file (EICAR), verify quarantine
   - **Gate:** Cameron provisions scanner + verifies clean/quarantined states

**Timeline:** 1–2 weeks (blocked on external counsel + educator, infrastructure can be done in 1–2 days)

---

### Phase 1: Private Beta Readiness (Code-complete)

**Already implemented, needs deployment + verification:**

1. **Manual accessibility evidence** (4–8 hours)
   - [ ] macOS VoiceOver journey test: Sign in → Intake → Plan → Start lesson → Message educator
   - [ ] True browser zoom: Chrome/Safari 200% and 400%, all four views
   - [ ] Document findings in `docs/MANUAL_ACCESSIBILITY_QA.md`
   - [ ] Fix any critical issues found
   - **Status:** Protocol defined, automated checks pass, manual evidence missing

2. **Hosted environment testing** (2–4 hours)
   - [ ] Deploy to Supabase staging
   - [ ] Run `npm run verify:hosted-isolation` against staging
   - [ ] Exercise: Create account → Submit intake → Send message → Export data → Delete account
   - [ ] Verify: Email templates render correctly, redirects work, sessions expire
   - **Status:** Verifier contract exists, needs live staging project

3. **Backup/restore drill** (2–4 hours)
   - [ ] Configure Supabase managed backups + PITR
   - [ ] Set up encrypted off-project object backups (S3/R2)
   - [ ] Run staging restore drill: Restore to new project, verify RLS + attachments
   - [ ] Document RTO/RPO in `docs/RECOVERY_OPERATIONS.md`
   - **Status:** Local encrypted restore passing, needs hosted PITR + staging clone

4. **Payment integration testing** (1–2 hours)
   - [ ] Stripe test mode: Purchase Essentials → Verify case creation → Verify SLA start
   - [ ] Test refund → Verify case hold + audit event
   - [ ] Test chargeback → Verify terminal state
   - **Status:** Domain logic + webhook adapter complete, needs Stripe keys

5. **Educator onboarding** (2–4 hours per educator)
   - [ ] Create staff accounts (Cameron + 1–2 credentialed educators)
   - [ ] Complete `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md` training
   - [ ] Walk through workbench: Triage → Assign → Author → Review → Publish → Deliver
   - [ ] Shadow cases and co-author first plans
   - [ ] Verify: Staff can't see other households, review gate works, delivery tracked
   - **Status:** Workbench UI complete, onboarding guide ready, needs hosted Auth + real staff accounts

**Timeline:** 1 week (can run in parallel with Phase 0 infrastructure)

---

### Phase 2: Private Beta Execution (Cameron + 5–10 families)

**Controlled rollout with named support:**

1. **Family recruitment** (Cameron-led)
   - [ ] Identify 5–10 consented families (existing network, homeschool groups)
   - [ ] Obtain explicit written consent for beta testing
   - [ ] Send `docs/PRIVATE_BETA_FAMILY_GUIDE.md` to prepare families
   - [ ] Set expectations: Human service, 5–7 day SLA, named support contact
   - **Gate:** Cameron confirms families + consent collected

   **Family guide covers:**
   - What BriteLink is (and isn't) — Human educator vs AI tutor
   - Beta expectations — What might happen, what won't
   - Getting started — Account access, intake, plan delivery, execution
   - Using the service — Messaging, revisions, rescheduling
   - Privacy rights — Export, correction, deletion
   - Troubleshooting — Common issues and support contacts
   - Providing feedback — Weekly check-ins and what to report

2. **Beta monitoring** (daily for first 2 weeks)
   - [ ] Daily check: Monitoring dashboard, error logs, case SLAs
   - [ ] Weekly: Educator capacity, message response times, revision requests
   - [ ] Track: Intake quality, clarification frequency, delivery acknowledgement rate
   - **Owner:** Cameron + designated educator

3. **Incident response** (as needed)
   - [ ] Follow `docs/INCIDENT_RESPONSE.md` runbooks
   - [ ] Document every incident: root cause, resolution, prevention
   - [ ] Update runbooks after each incident
   - **Owner:** Cameron (technical) + educator (service)

4. **Feedback collection** (weekly)
   - [ ] Parent survey: UX clarity, plan quality, messaging responsiveness
   - [ ] Educator feedback: Workbench usability, triage efficiency, resource governance friction
   - [ ] Capture: Feature requests, pain points, bugs
   - **Owner:** Cameron

5. **Quality review** (biweekly)
   - [ ] Educator audit: Review 100% of published plans for first month
   - [ ] Curriculum quality: Are plans meeting learning objectives?
   - [ ] Safety audit: Any inappropriate content, broken links, safeguarding issues?
   - **Owner:** Credentialed educator lead

**Success criteria for private beta:**
- 5+ families complete full Essentials or Complete package
- 0 data breaches, privacy violations, or safeguarding incidents
- 90%+ parent satisfaction (would recommend to another family)
- 90%+ educator confidence (plans meet quality bar)
- SLA met 95%+ of time (5–7 business days)
- 0 unresolved critical bugs after 30 days

**Timeline:** 4–8 weeks (2 weeks onboarding, 4–6 weeks execution + 1 package cycle)

---

### Phase 3: Paid Launch Readiness (Cameron-gated decisions)

**Decisions required before public launch:**

1. **Pricing validation** (Cameron decision)
   - [ ] Confirm: Essentials $79, Complete $149, Annual $499
   - [ ] Decide: Introductory discount for first 50 customers? (e.g., 20% off Annual)
   - [ ] Decide: Multi-learner pricing? (e.g., +$40/learner or separate SKUs?)
   - **Gate:** Cameron approves public pricing

2. **Educator capacity model** (Cameron + educator decision)
   - [ ] Define: Max concurrent cases per educator (recommend: 8–12 active cases)
   - [ ] Hiring plan: When to add educator #2, #3, etc.
   - [ ] Overflow handling: Wait list vs expedited hiring vs package pause
   - **Gate:** Cameron defines capacity limits + hiring triggers

3. **Marketing claims** (Cameron + counsel)
   - [ ] Review: All public website copy, package descriptions, SLA promises
   - [ ] Legal approval: Terms of service, refund policy, educational disclaimers
   - [ ] Remove: Any "beta" labels, waitlist messaging
   - **Gate:** Counsel approves all customer-facing claims

4. **Support model** (Cameron decision)
   - [ ] Define: Support hours (e.g., Mon–Fri 9am–5pm ET)
   - [ ] Response SLA: Case messages within 1 business day, urgent issues within 4 hours
   - [ ] Escalation path: Technical issues → Cameron, service issues → educator lead
   - **Gate:** Cameron documents support commitments

5. **Go-to-market strategy** (Cameron decision)
   - [ ] Launch channels: Website, homeschool forums, Facebook groups, referrals?
   - [ ] Launch goal: 10 new customers in month 1? 50 in quarter 1?
   - [ ] Referral program: 20% off for referrer + referee?
   - **Gate:** Cameron defines launch plan + growth targets

**Timeline:** 2–4 weeks (overlaps with late private beta)

---

### Phase 4: Post-Launch Iteration (Ongoing)

**Continuous improvement based on real usage:**

1. **Multi-learner support** (4–6 weeks development)
   - Sibling discount pricing model
   - Household learner management UI
   - Educator workbench: Multi-learner triage view
   - **Decision:** Cameron defines pricing + prioritizes vs other features

2. **Enhanced resource library** (2–4 weeks development)
   - Searchable/filterable resource catalog
   - Educator can favorite/reuse resources across cases
   - Parent can suggest resources for review
   - **Decision:** Prioritize after private beta feedback

3. **Advanced scheduling** (3–4 weeks development)
   - Multi-week view
   - Bulk rescheduling (e.g., vacation week)
   - Calendar export (iCal/Google Calendar)
   - **Decision:** Prioritize if scheduling friction is top parent complaint

4. **Educator collaboration** (4–6 weeks development)
   - Peer review pool (author ≠ reviewer across educators)
   - Internal notes/annotations
   - Curriculum template library
   - **Decision:** Prioritize when educator #2 hired

5. **Reporting/analytics** (2–4 weeks development)
   - Parent: Learner progress over time, completion rates, strengths/gaps
   - Educator: Case load, SLA performance, revision frequency
   - Admin: Revenue, churn, customer satisfaction trends
   - **Decision:** Prioritize for Cameron operational visibility

**Prioritization criteria:**
1. Private beta feedback (parent + educator pain points)
2. SLA risk reduction (e.g., educator efficiency tools)
3. Revenue impact (e.g., multi-learner unlocks larger families)
4. Competitive parity (e.g., if AI tutors add killer feature)

---

## 4. Competitor Parity Table (Honest Assessment)

### Where BriteLink Wins

| Dimension | Why BriteLink is Better | Why It Matters |
|-----------|-------------------------|----------------|
| **Human accountability** | Named educator, SLA, revision guarantee | Parents want recourse when AI fails |
| **Trust & transparency** | Honest demo labels, clear data handling, governed resources | Privacy-conscious families need proof |
| **Planning depth** | 12-field intake, human judgment, clarification requests | Generic AI lessons miss learning needs |
| **Parent empowerment** | Clear instructions, materials, adaptations, adult-help estimates | Parents execute; need confidence to succeed |
| **Accessibility** | WCAG A/AA, keyboard/screen-reader, 200%/400% zoom | AI tutors ignore disabled learners |
| **Service quality** | Review gate, resource governance, independent author/reviewer | AI tutors ship unverified hallucinations |

### Where BriteLink is Different (Not Better or Worse)

| Dimension | BriteLink Approach | AI Tutor Approach | Trade-offs |
|-----------|-------------------|-------------------|------------|
| **Delivery model** | Async human service (5–7 days) | Instant AI generation | We trade speed for quality + accountability |
| **Parent role** | Parent guides learner through plan | Child interacts directly with AI | We require parent involvement; not passive screen time |
| **Cost model** | Upfront package ($79–$499) | Freemium or subscription ($10–$30/month) | We're premium service; not commodity AI access |
| **Curriculum control** | Educator designs custom plan | Algorithm adapts in real-time | We're personalized but structured; they're reactive |

### Where AI Tutors Win (For Now)

| Dimension | AI Tutor Advantage | BriteLink Limitation | Mitigation Strategy |
|-----------|-------------------|----------------------|---------------------|
| **Instant answers** | Child asks question, gets immediate AI response | Parent must interpret plan or message educator (1-day response) | **Phase 4:** Add FAQ library, common resource bank for immediate parent support |
| **Infinite patience** | AI never tires of repeated questions | Human educator has finite capacity | **Phase 2 learning:** Monitor clarification request volume; if >3 per case, improve intake depth |
| **Real-time adaptation** | AI adjusts difficulty mid-lesson based on child performance | Plan is fixed once published (revision requires human approval) | **Intentional trade-off:** We provide stable, reviewed curriculum; not experimental AI |
| **Gamification** | Badges, streaks, rewards drive engagement | BriteLink is task-focused, no gamification | **Intentional exclusion:** Distraction-free learning; parent can add own incentives |
| **Multi-modal AI** | Voice, image recognition, drawing tools | Text + governed links only | **Future consideration:** Attachment uploads support images; not prioritizing AI analysis |
| **24/7 availability** | Child can access anytime | Educator responds within business hours | **Mitigation:** Clear instructions + materials enable offline execution; messaging for questions |

### Where We'll Never Compete (And That's OK)

| Feature | Why AI Tutors Have It | Why BriteLink Doesn't | Our Position |
|---------|----------------------|------------------------|--------------|
| **Free tier** | VC-subsidized user growth | Human educator costs are fixed | Premium service for families who value human expertise |
| **Unlimited usage** | Marginal AI inference cost ≈ $0 | Each case is 3–5 hours of educator time | Packages are scoped; families pay for human attention |
| **Real-time tutoring** | AI is synchronous by design | Async service model | We're curriculum planning + support, not live tutoring replacement |
| **Subject breadth** | AI trained on internet-scale data | Educator specialized in K–8 core subjects | We focus on homeschool curriculum; not AP/test prep/niche subjects |

---

## 5. Private Beta → Paid Launch Path

### Private Beta Definition

**What it is:**
- Controlled rollout to 5–10 named, consented families
- Free or heavily discounted packages (Cameron decides)
- Named incident contact + support owner
- Explicit "beta" label on all communications
- Monitoring + daily check-ins for first 2 weeks

**What it is NOT:**
- Public marketing or advertising
- Uncontrolled viral growth
- Production SLA guarantees (best-effort with transparent communication)

### Private Beta Entry Criteria (All Must Be True)

- [x] Code: Parent + educator journeys implemented and locally verified
- [x] Code: 25-table RLS isolation verified in executable tests
- [x] Code: World-class UX (trustworthy, calm, premium)
- [ ] Infrastructure: Hosted Supabase dev + staging projects provisioned
- [ ] Infrastructure: Stripe test mode configured + payment ingestion verified
- [ ] Infrastructure: External monitoring + alerting configured
- [ ] Infrastructure: Malware scanner integrated + tested
- [ ] Legal: Counsel-approved privacy notice version locked in database
- [ ] Quality: Credentialed educator sign-off on sample curriculum
- [ ] Quality: Safeguarding review passed
- [ ] Accessibility: macOS VoiceOver evidence collected
- [ ] Accessibility: True browser 200%/400% zoom evidence collected
- [ ] Operations: Incident runbooks defined + tabletop exercised
- [ ] Operations: Backup/restore drill passed on staging
- [ ] People: Cameron + 1–2 educators trained on workbench
- [ ] People: 5–10 families recruited + explicit consent obtained

### Private Beta Exit Criteria (All Must Be True)

- [ ] Usage: 5+ families completed full Essentials or Complete package
- [ ] Usage: 20+ lesson plans authored, reviewed, published, delivered, acknowledged
- [ ] Usage: 10+ case messages sent + responded to (avg <1 business day response)
- [ ] Quality: 0 data breaches, privacy violations, safeguarding incidents
- [ ] Quality: 0 unresolved critical bugs
- [ ] Quality: 90%+ parent satisfaction (would recommend)
- [ ] Quality: 90%+ educator confidence (plans meet quality bar)
- [ ] Operations: SLA met 95%+ of time (5–7 business days)
- [ ] Operations: All incidents documented + runbooks updated
- [ ] Operations: Monitoring alert tested + responders verified
- [ ] Legal: Counsel approves transition to paid launch
- [ ] People: Educator capacity model defined + documented

### Paid Launch Entry Criteria (All Must Be True)

- [ ] Private beta exit criteria met
- [ ] Pricing finalized + approved by Cameron
- [ ] Public website live (no "beta" labels)
- [ ] Terms of service + refund policy approved by counsel
- [ ] Marketing claims reviewed + approved by counsel
- [ ] Support hours + response SLA documented
- [ ] Stripe production mode enabled + tested
- [ ] Educator hiring plan documented (capacity thresholds)
- [ ] Launch channels identified (homeschool forums, groups, etc.)
- [ ] Referral program configured (if applicable)
- [ ] Cameron explicit approval: "We are ready for paid customers"

### Launch Phases

**Soft Launch (Weeks 1–4):**
- Invite private beta families to paid packages (discount or free upgrade)
- Invite extended network (friends, homeschool group)
- Goal: 10–20 paid customers
- Marketing: Word-of-mouth, referrals only
- **Gate:** Cameron monitors; pauses if SLA risk or quality issues

**Public Launch (Week 5+):**
- Public website announcement
- Post to homeschool forums, Facebook groups
- Goal: 50+ customers in 90 days
- Marketing: Organic + light paid (Cameron decision)
- **Gate:** Educator capacity limits; waitlist if >80% capacity

---

## 6. What 100% Means vs Forever-Gated

### 100% = Ready for Paid Launch (No Blockers)

**These items must be complete for paying customers:**

1. **Core product**
   - ✅ Parent authenticated journey (intake → plan → activity → messaging → export/delete)
   - ✅ Educator workbench (triage → author → review → publish → deliver → revise)
   - ✅ Payment integration (Stripe checkout → case creation → refund/chargeback handling)
   - ✅ Household isolation (cross-household denial verified)
   - ✅ World-class UX (trustworthy, calm, premium)

2. **Infrastructure**
   - ⚠️ Hosted Supabase (dev + staging + production)
   - ⚠️ Stripe production keys + webhook signature verification
   - ⚠️ Malware scanner (ClamAV or VirusTotal)
   - ⚠️ External monitoring + alerting (UptimeRobot, PagerDuty, etc.)
   - ⚠️ Managed backups + PITR
   - ⚠️ Encrypted off-project object backups

3. **Legal & compliance**
   - ⚠️ Counsel-approved privacy notice
   - ⚠️ Counsel-approved terms of service
   - ⚠️ Counsel-approved refund policy
   - ⚠️ Retention schedule + physical deletion jobs
   - ⚠️ Staging restore drill passed

4. **Quality & accessibility**
   - ⚠️ Credentialed educator curriculum sign-off
   - ⚠️ Safeguarding review passed
   - ✅ WCAG A/AA automated checks passed
   - ⚠️ macOS VoiceOver evidence collected
   - ⚠️ True browser 200%/400% zoom evidence collected

5. **Operations**
   - ⚠️ Incident runbooks defined + tabletop exercised
   - ⚠️ Named incident contacts
   - ⚠️ Support hours + response SLA documented
   - ⚠️ Educator capacity model defined
   - ⚠️ Private beta completed successfully

**Status:** ~60% code-complete, ~40% blocked on external dependencies (Supabase, counsel, educator, infrastructure)

---

### Forever-Gated Without External Parties (Intentional Limits)

**These features will NOT ship until external resources are available:**

1. **Advanced AI features** (Would require ML team or expensive API costs)
   - Real-time adaptive difficulty tuning
   - Automated essay grading
   - Voice-to-text lesson interaction
   - Image/drawing analysis
   - Predictive learning gap detection
   - **Position:** BriteLink is human-first; AI is assistive tooling for educators, not student-facing

2. **Video content hosting** (Would require video infrastructure + CDN)
   - Recorded lesson videos
   - Live educator sessions
   - Parent training videos
   - **Workaround:** Governed external links (YouTube, Vimeo, educator-approved) sufficient for MVP

3. **Mobile native apps** (Would require iOS/Android development)
   - Native iOS app
   - Native Android app
   - Offline mode
   - **Position:** Responsive web is sufficient for MVP; 95% of homeschool families use laptop/tablet browsers

4. **Advanced analytics** (Would require data science expertise)
   - Predictive churn modeling
   - Learning outcome correlation
   - A/B testing framework
   - **Position:** Basic reporting (completion rates, SLA performance) sufficient until scale justifies investment

5. **Multi-language support** (Would require translation + localization)
   - French (for Canadian bilingual families)
   - Spanish
   - Other languages
   - **Position:** English-only for MVP; expand if demand proven in private beta

6. **Third-party integrations** (Each requires partnership + API maintenance)
   - Google Classroom sync
   - Khan Academy integration
   - Curriculum marketplace (TPT, Outschool)
   - Calendar integrations (Google Calendar, iCal)
   - **Position:** Governed resource links sufficient; deep integrations deferred until post-launch

7. **Enterprise features** (Would require co-op/charter school sales motion)
   - Multi-family school accounts
   - Bulk educator assignment
   - Custom curriculum frameworks
   - LMS integration
   - **Position:** Individual family focus for MVP; enterprise is separate market

---

### What "100% vs Competitors" Actually Means

**BriteLink does not need feature parity with AI tutors to win.** Our competitive advantage is **human accountability + trust**, not feature breadth.

**100% for BriteLink = These outcomes:**

1. **Parent confidence:** "I trust BriteLink to create a safe, effective learning plan for my child"
2. **Educator confidence:** "I can deliver high-quality curriculum through this workbench"
3. **Service reliability:** "Cases are delivered on time, messages are responded to, revisions are handled fairly"
4. **Privacy assurance:** "My family's data is isolated, exportable, and deletable"
5. **Accessibility:** "All learners, including those with disabilities, can use this effectively"
6. **Operational readiness:** "We can handle incidents, backups, and scale to 50+ families without breaking"

**We achieve 100% when:**
- Private beta families would pay full price + recommend to friends
- Educators can sustain 8–12 concurrent cases without burnout
- 0 unresolved critical bugs or privacy violations after 30 days
- Monitoring + alerting catches issues before customers report them
- Counsel approves transition to paid launch

**We do NOT need:**
- Real-time AI tutoring
- Gamification
- Video hosting
- Mobile apps
- Multi-language

---

## 7. Summary: Critical Path to Paid Launch

### Immediate Actions (Cameron-led, 1–2 weeks)

1. **Provision Supabase dev project** → Apply all 40 migrations → Run `npm run verify:hosted-isolation`
2. **Provision Stripe test account** → Create products → Get webhook signing secret
3. **Submit privacy notice to counsel** → Incorporate feedback → Lock approved version in database
4. **Submit sample lesson plan to credentialed educator** → Safeguarding + curriculum review
5. **Complete macOS VoiceOver testing** → Document findings → Fix critical issues
6. **Complete true browser 200%/400% zoom testing** → Document findings → Fix critical issues
7. **Configure external monitoring** → Set up alerts → Test incident escalation

### Private Beta Gate (4–8 weeks)

1. **Recruit 5–10 families** → Obtain explicit consent → Set beta expectations
2. **Train educators** → Workbench walkthrough → Service expectations
3. **Deploy to staging** → Run full hosted verification suite
4. **Launch private beta** → Daily monitoring → Weekly feedback collection
5. **Iterate based on feedback** → Fix critical bugs → Update runbooks

### Paid Launch Gate (2–4 weeks after beta)

1. **Counsel approves** → Privacy notice + ToS + refund policy for public launch
2. **Private beta exit criteria met** → 90%+ satisfaction, 0 critical bugs, SLA 95%+
3. **Cameron decides** → Pricing, capacity model, support SLA, launch channels
4. **Stripe production mode** → Enable real payments → Test live checkout
5. **Public website live** → Remove beta labels → Launch announcement

**Total timeline:** 8–14 weeks from today to paid launch, assuming no major blockers.

**Highest risk:** Counsel + educator approval timelines (external, unpredictable).

**Mitigation:** Start counsel + educator reviews NOW, in parallel with infrastructure provisioning.

---

## Cross-References

### Implementation & Release

- **Implementation tracking:** See `docs/IMPLEMENTATION_PLAN.md` for detailed checklist
- **Release readiness:** See `docs/RELEASE_READINESS.md` for current evidence ledger
- **Goal completion:** See `docs/GOAL_COMPLETION_PLAN.md` for sequenced gate plan

### Operations & Reliability

- **Incident response:** See `docs/INCIDENT_RESPONSE.md` for operational runbooks
- **Privacy operations:** See `docs/PRIVACY_OPERATIONS.md` for GDPR/CCPA workflows
- **Monitoring:** See `docs/MONITORING_OPERATIONS.md` for observability setup
- **Recovery:** See `docs/RECOVERY_OPERATIONS.md` for backup/restore procedures

### Quality & Accessibility

- **Accessibility protocol:** See `docs/MANUAL_ACCESSIBILITY_QA.md` for VoiceOver/zoom testing
- **Pre-VoiceOver checklist:** See `docs/PRE_VOICEOVER_CHECKLIST.md` for Linux-verifiable foundations
- **Empty states audit:** See `docs/EMPTY_STATES_AUDIT.md` for UX polish verification
- **Demo robustness:** See `docs/DEMO_ROBUSTNESS_AUDIT.md` for edge case handling

### Private Beta Rehearsal

- **Family onboarding:** See `docs/PRIVATE_BETA_FAMILY_GUIDE.md` — Comprehensive guide for beta families covering what BriteLink is, how to use it, privacy rights, and how to provide feedback
- **Educator onboarding:** See `docs/PRIVATE_BETA_EDUCATOR_ONBOARDING.md` — Complete training for educators including workflows, quality standards, messaging best practices, and beta-specific guidance
- **Staging handoff:** See `docs/STAGING_HANDOFF.md` for operator setup checklist

---

**Document owner:** Cameron  
**Last reviewed:** 2026-09-09  
**Next review:** After private beta launch
