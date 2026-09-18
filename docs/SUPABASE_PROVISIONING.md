# Supabase Provisioning Checklist

This checklist documents the exact steps Cameron must complete to provision Supabase for BriteLink private beta. These steps must be completed before the authenticated workspace can operate with real family data.

> **This checklist assumes a decision that has not been made.** It describes buying hosted
> Supabase. `HOW-TO-RUN.md:26` states the intended runtime is **not** hosted Supabase, and
> self-hosting GoTrue + PostgREST + Storage on the VPS is the alternative the repository's
> stated direction points at. The two paths have different steps, costs, and operational
> burdens, so treat everything below as one branch of an open decision rather than as the plan.
>
> Nothing here may be carried out before the explicit infrastructure approval required by
> `RELEASE_READINESS.md:39` and `GOAL_COMPLETION_PLAN.md:431`. Until a project exists, the
> application runs as an unconfigured demo (`docs/STAGING_HANDOFF.md`), which is the honest
> state — do not set `VITE_SUPABASE_*` to make it look otherwise.

## Prerequisites

- [ ] Supabase account created at https://supabase.com
- [ ] Payment method configured (if using paid tier)
- [ ] Approved privacy notice language from qualified counsel
- [ ] Decision on which pricing tier to use (Free/Pro/Team)

## 1. Create Supabase Projects

You need at least two projects: **staging** (for testing) and **production** (for real families).

### Staging Project

- [ ] Create new project in Supabase dashboard
- [ ] Name: `britelink-staging`
- [ ] Region: Choose closest to your location (e.g., `us-east-1`)
- [ ] Database password: Generate strong password, store in password manager
- [ ] Wait for project to finish initializing (~2 minutes)
- [ ] Note the Project URL: `https://[project-ref].supabase.co`
- [ ] Note the `anon` public key from Settings → API

### Production Project

- [ ] Create new project in Supabase dashboard
- [ ] Name: `britelink-production`
- [ ] Region: Same as staging for consistency
- [ ] Database password: Generate separate strong password, store in password manager
- [ ] Wait for project to finish initializing
- [ ] Note the Project URL: `https://[project-ref].supabase.co`
- [ ] Note the `anon` public key from Settings → API

**CRITICAL:** Never use the `service_role` key in the browser or commit it to git.

## 2. Run Database Migrations

For each project (staging first, then production):

1. Install Supabase CLI if not already installed:
   ```bash
   npm install -g supabase
   ```

2. Link to your project:
   ```bash
   supabase link --project-ref [your-project-ref]
   # You'll be prompted for your database password
   ```

3. Run all 21 migrations in order:
   ```bash
   supabase db push
   ```

4. Verify migrations succeeded:
   - Open Supabase dashboard → Database → Tables
   - Confirm you see tables: `households`, `household_members`, `learners`, `learner_profiles`, `cases`, `plans`, `plan_weeks`, `plan_days`, `lessons`, `lesson_activities`, `lesson_resources`, `plan_reviews`, `deliveries`, `revisions`, `case_messages`, `case_attachments`, `case_message_reads`, `consent_records`, `privacy_requests`, `household_exports`, `payment_events`, `audit_events`, `quota_limits`, `operational_signals`, `educator_capacities`
   - Check Database → Policies to confirm RLS policies are in place

## 3. Configure Authentication

For each project:

### Email Authentication

- [ ] Go to Authentication → Providers
- [ ] Disable all providers except **Email**
- [ ] Enable Email provider
- [ ] Disable "Confirm email" (we're using magic links)
- [ ] Set "Secure email change" to enabled

### Magic Link Settings

- [ ] Go to Authentication → URL Configuration
- [ ] Add Site URL: `https://your-production-domain.com` (or `http://localhost:5173` for staging)
- [ ] Add Redirect URLs:
  - `http://localhost:5173/**` (for local development)
  - `https://your-staging-domain.com/**` (if using staging domain)
  - `https://your-production-domain.com/**` (production only)

### Email Templates

- [ ] Go to Authentication → Email Templates
- [ ] Customize "Magic Link" template:
  ```html
  <h2>Sign in to BriteLink</h2>
  <p>Click the link below to sign in to your secure BriteLink workspace:</p>
  <p><a href="{{ .ConfirmationURL }}">Sign in to BriteLink</a></p>
  <p>If you didn't request this, you can safely ignore this email.</p>
  <p><strong>Do not forward this email or share this link.</strong></p>
  ```

### JWT Settings

- [ ] Go to Settings → API → JWT Settings
- [ ] Set JWT expiry to 3600 seconds (1 hour)
- [ ] Note: Inactivity timeout (15 minutes) is handled by application code

## 4. Configure Storage (for attachments)

For each project:

- [ ] Go to Storage → Buckets
- [ ] Create new bucket: `case-attachments`
- [ ] Set to **Private**
- [ ] Enable RLS policies on the bucket

### Apply Storage Policies

Run this SQL in the SQL Editor:

```sql
-- Apply the storage policies from supabase/storage-policies.sql
-- (Copy the contents of that file and run it here)
```

- [ ] Verify policies were created in Storage → Policies

## 5. Configure Realtime (Optional)

BriteLink doesn't require Realtime for MVP, but if you want live updates:

- [ ] Go to Database → Replication
- [ ] Enable replication on tables: `case_messages`, `lesson_activities`
- [ ] Note: This increases database load and costs

## 6. Set Up Database Backups

For production project only:

- [ ] Go to Settings → Backups
- [ ] Verify daily backups are enabled (default on Pro tier)
- [ ] Enable Point-in-Time Recovery (PITR) if on Pro/Team tier
- [ ] Document recovery procedures in `/docs/RECOVERY_OPERATIONS.md`

## 7. Configure Environment Variables

### For Local Development

Create `.env.local` (never commit this file):

```bash
VITE_SUPABASE_URL=https://[staging-project-ref].supabase.co
VITE_SUPABASE_ANON_KEY=[staging-anon-key]
VITE_PRIVACY_NOTICE_VERSION=2026-09-09
```

### For Production Deployment

Set these environment variables in your hosting platform (Vercel, Netlify, Cloudflare Pages, etc.):

```bash
VITE_SUPABASE_URL=https://[production-project-ref].supabase.co
VITE_SUPABASE_ANON_KEY=[production-anon-key]
VITE_PRIVACY_NOTICE_VERSION=2026-09-09
```

**IMPORTANT:** Only set `VITE_PRIVACY_NOTICE_VERSION` after counsel approves the exact privacy notice language.

## 8. Test Staging Environment

Before touching production:

1. [ ] Run the hosted isolation check:
   ```bash
   # Create two test admin users in Supabase Auth dashboard
   # Get their short-lived JWTs from the dashboard
   export BRITELINK_TEST_ENVIRONMENT=staging
   export BRITELINK_TEST_HOUSEHOLD_A_ID=[household-a-uuid]
   export BRITELINK_TEST_HOUSEHOLD_B_ID=[household-b-uuid]
   export BRITELINK_TEST_ADMIN_A_JWT=[short-lived-jwt-a]
   export BRITELINK_TEST_ADMIN_B_JWT=[short-lived-jwt-b]
   npm run verify:hosted-isolation
   ```

2. [ ] Verify all 104 isolation checks pass

3. [ ] Test the complete user journey:
   - Sign in with magic link
   - Create a learner
   - Submit intake
   - Send a secure message
   - Export household data
   - Request deletion

4. [ ] Verify all RLS policies work correctly (no cross-household data leaks)

## 9. Security Hardening

For production project only:

- [ ] Go to Settings → API → API Settings
- [ ] Review and restrict CORS origins to your production domain
- [ ] Set rate limits on Authentication endpoints (if available on your tier)
- [ ] Enable email rate limiting to prevent abuse

- [ ] Go to Settings → Billing
- [ ] Set up budget alerts to prevent surprise costs
- [ ] Review pricing calculator for expected usage

## 10. Monitoring Setup

For production project:

- [ ] Enable database logs (Settings → Logs)
- [ ] Set up external monitoring (Sentry, LogRocket, or similar)
- [ ] Configure alerts for:
  - Database connection errors
  - Failed authentication attempts
  - RLS policy violations
  - Storage quota approaching limit
- [ ] Document monitoring procedures in `/docs/MONITORING_OPERATIONS.md`

## 11. Operational Health Checks

- [ ] Verify the health check endpoint works:
   ```bash
   export BRITELINK_SUPABASE_URL=https://[production-project-ref].supabase.co
   export BRITELINK_SUPABASE_ANON_KEY=[production-anon-key]
   export BRITELINK_MONITOR_JWT=[admin-jwt-for-health-check]
   export BRITELINK_MONITOR_HOUSEHOLD_ID=[test-household-uuid]
   npm run health:hosted
   ```

- [ ] Verify the health check returns HTTP 200 with expected signals
- [ ] Set up external monitoring to call this endpoint every 5 minutes
- [ ] Configure alerts if health check fails 3 times in a row

## 12. Create Initial Admin User

For production project:

- [ ] Go to Authentication → Users
- [ ] Add user manually:
  - Email: Your admin email
  - Password: Not used (magic link only)
  - Confirm email: Yes
- [ ] Note the user UUID

- [ ] Run this SQL to create the admin household and membership:
  ```sql
  -- Insert admin household
  INSERT INTO households (id, display_name, created_at)
  VALUES (
    'admin-household-uuid',  -- Generate a UUID
    'BriteLink Operations',
    NOW()
  );

  -- Grant admin membership
  INSERT INTO household_members (household_id, user_id, role)
  VALUES (
    'admin-household-uuid',
    '[your-user-uuid]',
    'admin'
  );
  ```

- [ ] Test signing in as admin
- [ ] Verify you can see the admin workspace

## 13. Backup and Disaster Recovery

- [ ] Document the exact Supabase project IDs and regions in a secure location
- [ ] Store database passwords in a password manager (1Password, LastPass, etc.)
- [ ] Document who has access to the Supabase dashboard
- [ ] Test the database restore procedure in staging:
  1. Take a manual backup
  2. Create a new project
  3. Restore the backup
  4. Verify data integrity

## 14. Pre-Launch Checklist

Before allowing real families to use the system:

- [ ] All 21 migrations applied successfully
- [ ] RLS policies verified with hosted isolation check (104 checks passed)
- [ ] Email templates customized and tested
- [ ] Backup strategy documented and tested
- [ ] Monitoring and alerts configured
- [ ] Disaster recovery plan documented
- [ ] Admin access confirmed
- [ ] Privacy notice approved by counsel
- [ ] Counsel-approved `VITE_PRIVACY_NOTICE_VERSION` set
- [ ] Private beta families recruited (5-10)
- [ ] Support procedures documented

## Common Issues and Solutions

### Issue: "Invalid API key"
**Solution:** Verify you're using the `anon` key, not the `service_role` key. The anon key is safe for browser use.

### Issue: "Permission denied for table"
**Solution:** RLS policies may not be set up correctly. Re-run migrations and verify policies in Database → Policies.

### Issue: "JWT expired"
**Solution:** JWT tokens expire after 1 hour. Users need to sign in again. This is by design.

### Issue: "Redirect URL not allowed"
**Solution:** Add the redirect URL to Authentication → URL Configuration → Redirect URLs.

### Issue: Attachments not uploading
**Solution:** Verify the `case-attachments` bucket exists and has the correct RLS policies from `supabase/storage-policies.sql`.

### Issue: Cross-household data leak in testing
**Solution:** STOP. Do not proceed to production. Review RLS policies and re-run the isolation check until all 104 checks pass.

## Post-Provisioning

After Supabase is provisioned:

- [ ] Update this checklist with actual project IDs (in secure docs, not in git)
- [ ] Share access with Cameron and any other administrators
- [ ] Schedule the first private beta family onboarding
- [ ] Monitor the system daily during the first week
- [ ] Review Supabase billing after the first month

## Support

If you encounter issues during provisioning:

1. Check the Supabase docs: https://supabase.com/docs
2. Check the BriteLink implementation plan: `/docs/IMPLEMENTATION_PLAN.md`
3. Review the RLS verification: `/docs/HOSTED_STAGING_VERIFICATION.md`
4. Check GitHub issues: https://github.com/camster91/britelink-mvp/issues

## Next Steps After Provisioning

Once Supabase is provisioned and tested:

1. Run the full test suite: `npm test`
2. Deploy to staging
3. Run manual accessibility testing (VoiceOver, 200%/400% zoom)
4. Recruit 5-10 private beta families
5. Train educators on the staff workbench
6. Begin private beta with daily monitoring

---

**Last Updated:** 2026-09-09  
**Owner:** Cameron  
**Status:** Awaiting provisioning
