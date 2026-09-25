-- Minimal Supabase surface, so supabase/migrations/*.sql can be applied to a plain
-- Postgres container for offline validation.
--
-- THIS FILE IS NOT A MIGRATION. It must never be applied to a real project: it creates a
-- stub auth.users and a stub storage.objects that would shadow the genuine ones. It lives
-- outside supabase/migrations/ precisely so no migration runner ever picks it up.
--
-- The migrations depend on only three pieces of Supabase that vanilla Postgres lacks
-- (verified by grepping every reference rather than guessing):
--   * the roles anon / authenticated / service_role, which grants target
--   * auth.users(id), plus email_confirmed_at, which 041 reads to require a confirmed account
--   * auth.uid() -- used 80 times, and the whole tenant-isolation model rests on it
-- storage.objects and storage.foldername() are needed only by supabase/storage-policies.sql.

create schema if not exists auth;
create schema if not exists storage;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(),
  email text,
  -- Set by GoTrue once the magic link is followed; provision_beta_household (041) requires it.
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's own definition: the caller's subject comes from the JWT claim GUC.
-- Returning NULL when unset is load-bearing -- it is what makes an unauthenticated call
-- fail closed.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists storage.buckets(
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects(
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
