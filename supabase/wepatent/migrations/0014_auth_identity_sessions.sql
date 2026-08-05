-- Real authentication: identity linkage and opaque server-side sessions.
--
-- ADDITIVE ONLY. Existing identities are linked idempotently; provider
-- tokens remain server-side and browser cookies carry only a signed session
-- id. Writes are reserved for trusted server logic.

create table if not exists public.auth_identity_links (
  app_user_id uuid primary key references public.users_profile (id) on delete cascade,
  auth_user_id uuid not null unique,
  email text not null,
  link_method text not null check (
    link_method in ('self_match', 'existing_identity', 'created_identity')
  ),
  linked_at timestamptz not null default now()
);

create index if not exists auth_identity_links_email_idx
  on public.auth_identity_links (lower(email));

comment on table public.auth_identity_links is
  'Application user to verified Supabase Auth identity bridge. Trusted server writes only.';

alter table public.auth_identity_links enable row level security;
create policy auth_identity_links_self_select on public.auth_identity_links
  for select using (app_user_id = (select auth.uid()));

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.users_profile (id) on delete cascade,
  auth_user_id uuid not null,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip_hash text,
  user_agent_hash text
);

create index if not exists auth_sessions_active_user_idx
  on public.auth_sessions (app_user_id)
  where revoked_at is null;
create index if not exists auth_sessions_expiry_idx
  on public.auth_sessions (access_expires_at);

comment on table public.auth_sessions is
  'Server-side auth sessions. Browser cookies carry only an opaque signed id. Trusted server writes only.';

alter table public.auth_sessions enable row level security;
create policy auth_sessions_self_select on public.auth_sessions
  for select using (app_user_id = (select auth.uid()));

insert into public.auth_identity_links (app_user_id, auth_user_id, email, link_method)
select p.id, u.id, lower(u.email), 'self_match'
  from public.users_profile p
  join auth.users u on u.id = p.id
 where u.email is not null
on conflict (app_user_id) do nothing;
