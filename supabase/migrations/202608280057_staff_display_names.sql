-- 057: staff display names (owner decision, 2026-10-04).
--
-- BriteLink stored no name for staff, so the assign list and message thread could only show a
-- user ID. Each educator or admin can now set the name other staff see. Names are visible only to
-- the person themselves and to staff (educator/admin) of a household that person belongs to;
-- guardians do not read this table.
create table if not exists public.staff_display_names(
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  updated_at timestamptz not null default now()
);
alter table public.staff_display_names enable row level security;
revoke all on public.staff_display_names from public, anon, authenticated;
grant select on public.staff_display_names to authenticated;

drop policy if exists staff_display_names_select on public.staff_display_names;
create policy staff_display_names_select on public.staff_display_names
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.user_id = staff_display_names.user_id
        and public.has_household_role(m.household_id, array['educator','admin']::public.membership_role[])
    )
  );

-- Staff set only their own name; writes go through this function, never the table.
create or replace function public.set_staff_display_name(new_name text)
returns text
language plpgsql security definer set search_path = public
as $$
declare clean text := btrim(coalesce(new_name, ''));
begin
  if auth.uid() is null or not exists (
    select 1 from public.memberships m where m.user_id = auth.uid() and m.role in ('educator', 'admin')
  ) then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 80 then
    raise exception 'name must be 1 to 80 characters' using errcode = '22023';
  end if;
  insert into public.staff_display_names(user_id, display_name, updated_at)
  values (auth.uid(), clean, now())
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = excluded.updated_at;
  return clean;
end $$;
revoke all on function public.set_staff_display_name(text) from public, anon;
grant execute on function public.set_staff_display_name(text) to authenticated;
