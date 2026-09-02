-- Prevent direct-write rows from linking a household to foreign tenant entities.

alter table public.learners add constraint learners_household_id_id_key unique(household_id,id);
alter table public.lessons add constraint lessons_household_id_id_key unique(household_id,id);
alter table public.case_messages add constraint case_messages_household_id_id_key unique(household_id,id);

alter table public.lesson_activities
  add constraint lesson_activities_household_learner_fk foreign key(household_id,learner_id) references public.learners(household_id,id) on delete cascade,
  add constraint lesson_activities_household_lesson_fk foreign key(household_id,lesson_id) references public.lessons(household_id,id) on delete cascade;

alter table public.case_message_reads
  add constraint case_message_reads_household_message_fk foreign key(household_id,message_id) references public.case_messages(household_id,id) on delete cascade;
