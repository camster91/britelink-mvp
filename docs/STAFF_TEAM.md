# Staff team

Everyone who works for BriteLink (you, and each educator) is on the **staff team** (migrations 060,
061 and 062, issue #100). What the team gives each person depends on their role:

- **Admins** are added to every family automatically: every family already on BriteLink when you
  add them, and each new family the moment it signs up.
- **Educators** see a family only once an admin assigns them that family's case. Until then they
  appear in the admin's **assign** list for every family, but can't open any of them. (Owner
  decision, 2026-10-15: one stolen educator login should not expose every family.)
- Each educator has a case limit (default 10) in each family, which case assignment checks.

A staff member opens a family from the **Workspace** list at the top of the staff screen.

## Who can see what

- Admins can open any family's workspace. They also see the audit history, privacy requests and
  system reports, and only admins assign cases. They cannot act as the family's parent (add a
  child, change the schedule, mark lessons done, write learning notes or make a calendar link),
  and like educators they see a child's intake details only while the parent's consent is active
  (migration 062).
- An educator can open the families whose case they were assigned. An educator with no family yet
  sees "You're on the BriteLink staff team" and can set the name other staff see.

Keep the team to the people who need it, and remove people when they leave.

## Approve a new family

A family that signs itself up waits for approval (migration 064, decided 2026-10-21). In the
staff workspace it shows "waiting for approval" in the workspace list and a note at the top. An
admin checks that the family looks genuine and presses **Approve this family**. Until then:

- the family can set up and send its intake form;
- staff cannot accept the intake or assign an educator;
- the family's messages do not email staff.

A fake signup can be closed without approving it.

## Add someone

1. They go to https://britelink.ashbi.ca, enter their work email, press **Email me a sign-in
   link**, and open the link. That creates their account **and confirms their email**. They then
   see "Set up your household": they should **not** fill it in (it is for parents); they sign out.
   (This needs sign-up switched on in the sign-in service; see `TODO.md` item 3.)
2. GitHub → **Actions → Staff → Run workflow** (then approve the run: **add** and **remove**
   change production, see `APPLYING_MIGRATIONS.md` → "Approving a production change"):
   - action: `add`
   - email: their sign-in email
   - role: `educator` or `admin`
   - case limit: how many active cases an educator can hold at once (ignored for admins)
3. For an admin, the run says how many existing families were shared with them. For an educator,
   it says an admin can now assign them a family. They sign in again and see the staff workspace
   (an educator sees the waiting screen until their first assignment).

If the run says "no BriteLink account with that email yet" or "has not confirmed its email yet",
they haven't finished step 1.

## Remove someone

**Actions → Staff → Run workflow**, action `remove`, with their email. This is refused while they
still hold an open case as author or reviewer: reassign those first (an admin can record their
absence, which puts their cases on hold for reassignment). Removing someone takes away their staff
access to every family and switches off any calendar link they made in those families. Their
sign-in account itself stays; delete it by hand if needed (see `PRIVACY_OPERATIONS.md` for how
sign-ins are removed).

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
- When an admin reassigns a case, or a case closes, is cancelled or refunded, its educator leaves
  that family unless they still hold another open case there (migration 062). Recording an absence
  does not remove them, since it may be temporary.
- Anyone leaving a family (staff or a co-parent) has the calendar links they made there switched
  off, so a link never outlives its maker's access.
