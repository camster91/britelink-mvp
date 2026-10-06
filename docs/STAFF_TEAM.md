# Staff team

Everyone who works for BriteLink (you, and each educator) is on the **staff team**. Everyone on
the team is added to every family automatically (migration 060, issue #100):

- When a family signs up, the whole team is added to that family's household at once.
- When you add someone to the team, every family already on BriteLink is shared with them.
- Each educator also gets a case limit (default 10) in each family, which case assignment checks.

A staff member opens a family from the **Workspace** list at the top of the staff screen.

## Who can see what

Anyone on the team can open any family's workspace. Admins also see the audit history, privacy
requests and system reports, and only admins assign cases. Keep the team to the people who need
it, and remove people when they leave.

## Add someone

1. They need a BriteLink sign-in account first. Sign-up on the live site is invite-only
   (`GOTRUE_DISABLE_SIGNUP=true`), so the account is created the same way as a family's: an
   invitation from the sign-in service. There is no invite button or workflow in this repository
   yet; that is an open decision (issue #100). Once invited, they sign in once.
2. GitHub → **Actions → Staff → Run workflow**:
   - action: `add`
   - email: their sign-in email
   - role: `educator` or `admin`
   - case limit: how many active cases an educator can hold at once (ignored for admins)
3. The run says how many existing families were shared with them. They sign in again and see the
   staff workspace.

If the run says "no BriteLink account with that email yet", do step 1 first.

## Remove someone

**Actions → Staff → Run workflow**, action `remove`, with their email. This is refused while they
still hold an open case as author or reviewer: reassign those first (an admin can record their
absence, which puts their cases on hold for reassignment). Removing someone takes away their staff
access to every family. Their sign-in account itself stays; delete it by hand if needed (see
`PRIVACY_OPERATIONS.md` for how sign-ins are removed).

To change someone's role, remove them and add them again.

## See the team

**Actions → Staff → Run workflow**, action `list`. It shows each person's role, case limit and how
many families they're in.

## Notes

- The repository is public, so workflow logs are too. The Staff workflow hides the email you enter
  and only ever prints masked addresses (`j***@example.com`).
- A staff member who also signs up as a parent gets their own separate family; staff access never
  turns another family into "theirs".
- A guardian's message goes to the assigned educator, or to every admin while no educator is
  assigned (migration 058), so put at least one admin on the team.
- Case limits are counted per family, as they always were. With one case per family, that limit
  rarely bites; a limit across all families would be a later change.
