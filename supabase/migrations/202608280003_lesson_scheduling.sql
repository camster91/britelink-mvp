-- Durable, caregiver-controlled schedule exceptions for published lessons.
alter table public.lesson_activities
  add column schedule_reason text check (schedule_reason in ('illness', 'travel', 'caregiver_schedule', 'catch_up', 'other')),
  add column scheduled_for date,
  add constraint lesson_activity_schedule_pair check (
    (schedule_reason is null and scheduled_for is null)
    or (schedule_reason is not null and scheduled_for is not null)
  );

comment on column public.lesson_activities.schedule_reason is 'Guardian-selected reason for moving a lesson; never a diagnosis or free-text health field.';
comment on column public.lesson_activities.scheduled_for is 'New household-local calendar date for the lesson; activity progress and notes remain intact.';
