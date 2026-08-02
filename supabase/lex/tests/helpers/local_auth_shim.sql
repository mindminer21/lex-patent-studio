-- ---------------------------------------------------------------------------
-- Local Supabase auth shim — TEST HARNESS ONLY.
--
-- The migrations in supabase/lex/migrations/ target a real Supabase project,
-- where the `auth` schema, `auth.users`, `auth.uid()`, and the
-- anon/authenticated/service_role roles are provided by the platform.
--
-- This shim recreates just enough of that surface on a plain PostgreSQL 16
-- server so the migrations can be applied for real and the RLS allow/deny
-- matrix can execute without Docker or the Supabase local stack. It mirrors
-- Supabase behavior:
--   - auth.uid() reads the JWT `sub` claim from request.jwt.* settings.
--   - `authenticated`/`anon` get table privileges; RLS is the enforcement
--     layer (exactly like Supabase's default grants).
--   - `service_role` has BYPASSRLS (trusted server logic).
--
-- Never apply this file to a real Supabase project.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

-- Mirrors supabase/auth: uid() = JWT sub claim of the current request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
