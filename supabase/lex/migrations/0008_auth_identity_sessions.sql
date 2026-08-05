-- Lex Patent Studio real authentication. This mirrors the consumer lane's
-- identity-link and opaque server-session design without changing Lex's
-- role, matter-ACL, or work-tier semantics.

create table if not exists auth_identity_links (
  app_user_id uuid primary key references users_profile (user_id) on delete cascade,
  auth_user_id uuid not null unique,
  email text not null,
  link_method text not null check (
    link_method in ('self_match', 'existing_identity', 'created_identity')
  ),
  linked_at timestamptz not null default now()
);

create index if not exists auth_identity_links_email_idx
  on auth_identity_links (lower(email));

comment on table auth_identity_links is
  'Application user to verified Supabase Auth identity bridge. Trusted server writes only.';

alter table auth_identity_links enable row level security;
create policy auth_identity_links_self_select on auth_identity_links
  for select to authenticated
  using (app_user_id = auth.uid());

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references users_profile (user_id) on delete cascade,
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
  on auth_sessions (app_user_id)
  where revoked_at is null;
create index if not exists auth_sessions_expiry_idx
  on auth_sessions (access_expires_at);

comment on table auth_sessions is
  'Server-side auth sessions. Browser cookies carry only an opaque signed id. Trusted server writes only.';

alter table auth_sessions enable row level security;
create policy auth_sessions_self_select on auth_sessions
  for select to authenticated
  using (app_user_id = auth.uid());

insert into auth_identity_links (app_user_id, auth_user_id, email, link_method)
select p.user_id, u.id, lower(u.email), 'self_match'
  from users_profile p
  join auth.users u on u.id = p.user_id
 where u.email is not null
on conflict (app_user_id) do nothing;
