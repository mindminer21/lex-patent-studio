-- Lex Patent Studio — private application project
-- Migration 0001: core tenancy, identity, terms, audit.
--
-- Written per PRD-lex-patent-studio §11 and PRD-wepatent §9/Invariants 6–8.
-- NOT applied to any remote project in Round 1. Every tenant-owned table
-- carries organization_id, populated by trusted server logic and protected
-- by RLS. Client roles get read access through membership; ALL writes flow
-- through the service role (server BFF) — no client-write policies exist,
-- so model output or browser code can never mutate state directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated types (mirror src/lib/domain)
-- ---------------------------------------------------------------------------

create type org_role as enum (
  'owner',
  'practitioner_admin',
  'practitioner',
  'agent_operator',
  'contributor',
  'viewer',
  'counsel_intake',
  'counsel_attorney',
  'platform_support'
);

create type work_tier as enum ('A', 'B', 'C');

create type run_state as enum (
  'QUEUED', 'INGESTING', 'RETRIEVING', 'GENERATING',
  'VERIFYING', 'RENDERING', 'COMPLETED', 'FAILED', 'CANCELLED'
);

create type fact_provenance as enum (
  'user_asserted', 'source_supported', 'needs_confirmation',
  'disputed', 'counsel_reviewed'
);

create type review_state as enum (
  'pending_review', 'changes_requested', 'approved', 'rejected'
);

create type review_decision_kind as enum ('approve', 'request_changes', 'reject');

create type verification_state as enum ('unverified', 'verified', 'failed');

create type matter_lifecycle as enum ('active', 'closed', 'purged');

create type extraction_state as enum (
  'uploaded', 'scanning', 'quarantined', 'extracting', 'extracted', 'failed'
);

-- ---------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  plan text not null default 'explore',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role org_role not null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_memberships_user_idx
  on organization_memberships (user_id);
create index organization_memberships_org_idx
  on organization_memberships (organization_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role org_role not null,
  invited_by uuid not null references auth.users (id),
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Idempotent invites: one live invitation per (org, email).
  unique (organization_id, email)
);

create index invitations_org_idx on invitations (organization_id);

-- ---------------------------------------------------------------------------
-- Terms (versioned professional-lane clickwrap, PRD §9.1)
-- ---------------------------------------------------------------------------

create table terms_versions (
  id uuid primary key default gen_random_uuid(),
  lane text not null default 'professional',
  version text not null,
  content_sha256 text not null,
  published_at timestamptz not null default now(),
  unique (lane, version)
);

create table terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  terms_version_id uuid not null references terms_versions (id),
  accepted_at timestamptz not null default now(),
  ip_hash text,
  unique (organization_id, user_id, terms_version_id)
);

create index terms_acceptances_org_idx on terms_acceptances (organization_id);

-- ---------------------------------------------------------------------------
-- Immutable audit log (FR-10)
-- ---------------------------------------------------------------------------

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid,
  actor_user_id uuid,
  actor_role org_role,
  action text not null check (char_length(action) between 1 and 200),
  subject_type text not null check (char_length(subject_type) between 1 and 80),
  subject_id text not null,
  detail text check (char_length(detail) <= 4000),
  correlation_id uuid,
  created_at timestamptz not null default now()
);

create index audit_events_org_created_idx
  on audit_events (organization_id, created_at desc);
create index audit_events_matter_idx
  on audit_events (matter_id) where matter_id is not null;

-- Append-only: no update/delete even for privileged app paths.
create or replace function app_forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_immutable
  before update or delete on audit_events
  for each row execute function app_forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------

-- True when the calling authenticated user is a member of the organization.
create or replace function app_is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_memberships m
    where m.organization_id = org
      and m.user_id = auth.uid()
  );
$$;

-- The calling user's role within the organization (null when not a member).
create or replace function app_org_role(org uuid)
returns org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from organization_memberships m
  where m.organization_id = org
    and m.user_id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS: enable everywhere; members read their tenant; writes are service-only
-- (service_role bypasses RLS; the absence of write policies denies clients).
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table users_profile enable row level security;
alter table organization_memberships enable row level security;
alter table invitations enable row level security;
alter table terms_versions enable row level security;
alter table terms_acceptances enable row level security;
alter table audit_events enable row level security;

create policy organizations_member_select on organizations
  for select to authenticated
  using (app_is_org_member(id));

create policy users_profile_self_select on users_profile
  for select to authenticated
  using (user_id = auth.uid());

create policy memberships_member_select on organization_memberships
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy invitations_admin_select on invitations
  for select to authenticated
  using (app_org_role(organization_id) in ('owner', 'practitioner_admin'));

create policy terms_versions_public_select on terms_versions
  for select to authenticated
  using (true);

create policy terms_acceptances_member_select on terms_acceptances
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy audit_events_member_select on audit_events
  for select to authenticated
  using (app_is_org_member(organization_id));
