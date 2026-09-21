-- 038: a guardian can add another child.
--
-- THE GAP
--   Nothing in the product created a learner except the two provisioning functions, which run
--   once at signup. So a family with a second child had no way to add them: the workspace
--   showed "No learners have been added" with the note "an administrator must complete learner
--   setup" -- and no administrator path existed either. One child was a hard ceiling.
--
-- WHAT THIS ADDS
--   One guarded function a guardian can call from their own household. It creates the learner
--   and opens the case that the workflow needs, in the same shape the signup path uses, so the
--   rest of the lifecycle works unchanged.
--
-- AUTHORISATION
--   'guardian' or 'admin' IN THIS HOUSEHOLD -- the same predicate the learners table already
--   uses for guardian writes (learners_guardian_write). The caller cannot add a child to
--   another family: has_household_role reads auth.uid().
--
-- DUPLICATES
--   A name is not a unique key for a child, so this deliberately does not block on one. It
--   does refuse an empty name and caps the length, matching the column.

create or replace function public.guardian_add_learner(
  target_household uuid,
  learner_name text,
  learner_grade text,
  learner_jurisdiction text default 'Ontario',
  start_package text default 'annual'
)
returns table(learner_id uuid, case_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public
as $function$
declare
  clean_name text := btrim(learner_name);
  clean_grade text := btrim(learner_grade);
  clean_jurisdiction text := btrim(learner_jurisdiction);
  new_learner uuid;
  new_case uuid;
begin
  if not public.has_household_role(target_household,
                                   array['guardian','admin']::public.membership_role[]) then
    raise exception 'guardian access required';
  end if;
  if clean_name = '' or char_length(clean_name) > 120 then
    raise exception 'learner name is required and must be at most 120 characters';
  end if;
  if clean_grade = '' or char_length(clean_grade) > 60 then
    raise exception 'grade or level is required and must be at most 60 characters';
  end if;
  if clean_jurisdiction = '' then
    raise exception 'jurisdiction is required';
  end if;
  if start_package not in ('essentials','complete','annual') then
    raise exception 'package code is invalid';
  end if;

  insert into public.learners (household_id, preferred_name, grade_label, jurisdiction)
  values (target_household, clean_name, clean_grade, clean_jurisdiction)
  returning id into new_learner;

  -- The case the workflow needs. Beta opens it directly, matching the signup path.
  insert into public.service_cases (household_id, learner_id, package_code, status)
  values (target_household, new_learner, start_package, 'paid')
  returning id into new_case;

  insert into public.audit_events (household_id, actor_user_id, event_type, subject_type,
                                   subject_id, metadata)
  values (target_household, auth.uid(), 'learner.added', 'learner', new_learner,
          jsonb_build_object('caseId', new_case, 'grade', clean_grade));

  return query select new_learner, new_case, now();
end $function$;

comment on function public.guardian_add_learner(uuid, text, text, text, text) is
  'Lets a guardian add another child to their own household, with the open case the workflow needs. Before this, one child per household was a hard ceiling.';

revoke all on function public.guardian_add_learner(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.guardian_add_learner(uuid, text, text, text, text)
  to authenticated;
