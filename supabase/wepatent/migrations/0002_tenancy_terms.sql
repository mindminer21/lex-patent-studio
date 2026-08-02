-- Tenancy, memberships, invitations, and versioned clickwrap records.
-- Every tenant-owned table carries organization_id, populated by trusted
-- server logic and protected by RLS (PRD §9).

create table public.users_profile (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  retention_days integer not null default 365 check (retention_days between 30 and 3650),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on public.organization_memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.org_role not null default 'member',
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Counsel roles are never granted through organization invitations (FR-2).
  constraint invitations_no_counsel_roles
    check (role in ('owner', 'admin', 'member', 'viewer'))
);
create index on public.invitations (organization_id);

create table public.terms_versions (
  version text primary key,
  summary text not null,
  material_change boolean not null default true,
  published_at timestamptz not null default now()
);

create table public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  terms_version text not null references public.terms_versions (version),
  acknowledged_keys text[] not null,
  ip_hash text not null,
  user_agent_category text not null check (user_agent_category in ('desktop','mobile','bot','unknown')),
  accepted_at timestamptz not null default now(),
  -- All four acknowledgements are required (PRD §7.2).
  constraint terms_acceptances_all_acks check (
    acknowledged_keys @> array['not_law_firm','working_drafts','counsel_review_required','no_deadlines_or_outcomes']
  )
);
create index on public.terms_acceptances (organization_id, user_id, accepted_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.users_profile enable row level security;
create policy users_profile_self_select on public.users_profile
  for select using (id = (select auth.uid()));
create policy users_profile_self_update on public.users_profile
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy users_profile_self_insert on public.users_profile
  for insert with check (id = (select auth.uid()));

alter table public.organizations enable row level security;
create policy organizations_member_select on public.organizations
  for select using (id in (select app.user_org_ids()));
create policy organizations_owner_update on public.organizations
  for update using (app.has_org_role(id, array['owner']))
  with check (app.has_org_role(id, array['owner']));
-- Organization creation happens through trusted server logic (service role)
-- inside one transaction with the owner membership (PRD §7.1); no direct
-- client insert policy.

alter table public.organization_memberships enable row level security;
create policy memberships_member_select on public.organization_memberships
  for select using (organization_id in (select app.user_org_ids()));
create policy memberships_admin_insert on public.organization_memberships
  for insert with check (
    app.has_org_role(organization_id, array['owner','admin'])
    and role in ('admin','member','viewer')
  );
create policy memberships_admin_delete on public.organization_memberships
  for delete using (app.has_org_role(organization_id, array['owner','admin']));

alter table public.invitations enable row level security;
create policy invitations_admin_all on public.invitations
  for all using (app.has_org_role(organization_id, array['owner','admin']))
  with check (app.has_org_role(organization_id, array['owner','admin']));

alter table public.terms_versions enable row level security;
create policy terms_versions_read_all on public.terms_versions
  for select using (true);

alter table public.terms_acceptances enable row level security;
create policy terms_acceptances_member_select on public.terms_acceptances
  for select using (organization_id in (select app.user_org_ids()));
create policy terms_acceptances_self_insert on public.terms_acceptances
  for insert with check (
    user_id = (select auth.uid())
    and organization_id in (select app.user_org_ids())
  );
-- Immutable from normal application roles (PRD §7.2).
create trigger terms_acceptances_immutable
  before update or delete on public.terms_acceptances
  for each row execute function app.reject_mutation();
