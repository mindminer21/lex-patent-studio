-- Connected-counsel requests, engagements, matters, filing packages, audit
-- events, and retention policies (PRD §7.6, §9, FR-7).
--
-- Invariants encoded here:
-- - counsel_request !== engagement: the request row can never itself grant
--   representation; representation state advances only through the adjacent
--   transitions enforced by trigger below, and engagement_signed requires an
--   engagement row with a signed reference.
-- - State transitions are adjacency-checked in the database as defense in
--   depth behind the application state machine.

create table public.counsel_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  invention_id uuid references public.inventions (id) on delete set null,
  state public.counsel_request_state not null default 'draft',
  -- Limited conflict-intake fields only; no substantive invention content.
  request_summary text not null check (char_length(request_summary) between 10 and 2000),
  adverse_parties text not null default '',
  jurisdiction text not null,
  contact_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.counsel_requests (organization_id);

create table public.counsel_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid not null references public.counsel_requests (id) on delete cascade,
  from_state public.counsel_request_state not null,
  to_state public.counsel_request_state not null,
  action text not null,
  actor_role public.org_role not null,
  evidence_ref text,
  created_at timestamptz not null default now()
);
create index on public.counsel_request_events (organization_id, request_id);

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid not null unique references public.counsel_requests (id),
  law_firm_name text not null,
  scope_summary text not null,
  signed_document_ref text,
  offered_at timestamptz not null default now(),
  signed_at timestamptz,
  -- A signed engagement must reference the signed agreement document.
  constraint engagements_signed_requires_ref
    check (signed_at is null or signed_document_ref is not null)
);

create table public.legal_matters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  engagement_id uuid not null unique references public.engagements (id),
  matter_reference text not null,
  opened_at timestamptz not null default now()
);

create table public.filing_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  matter_id uuid not null references public.legal_matters (id) on delete cascade,
  description text not null,
  status text not null default 'in_preparation'
    check (status in ('in_preparation', 'counsel_review', 'counsel_approved')),
  -- No submission status exists: authenticated filing remains under attorney
  -- control outside this system (PRD §5.5); wepatent never files.
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor text not null,
  action text not null,
  target text not null default '',
  correlation_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_events (organization_id, created_at desc);

create table public.retention_policies (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  content_retention_days integer not null default 365 check (content_retention_days between 30 and 3650),
  purge_backups boolean not null default true,
  legal_hold boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Counsel-request transition guard: adjacency-only, in-database.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_counsel_request_transition()
returns trigger
language plpgsql
as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if not (
    (old.state = 'draft' and new.state = 'submitted') or
    (old.state = 'submitted' and new.state = 'conflict_review') or
    (old.state = 'conflict_review' and new.state in ('declined', 'consultation_offered')) or
    (old.state = 'consultation_offered' and new.state = 'consultation_scheduled') or
    (old.state = 'consultation_scheduled' and new.state = 'engagement_offered') or
    (old.state = 'engagement_offered' and new.state = 'engagement_signed') or
    (old.state = 'engagement_signed' and new.state = 'converted_to_matter')
  ) then
    raise exception 'invalid counsel request transition: % -> %', old.state, new.state;
  end if;
  -- engagement_signed requires a signed engagement record (PRD §5.3).
  if new.state = 'engagement_signed' and not exists (
    select 1 from public.engagements e
    where e.request_id = new.id and e.signed_document_ref is not null
  ) then
    raise exception 'engagement_signed requires a signed engagement record';
  end if;
  return new;
end;
$$;

create trigger counsel_requests_transition_guard
  before update of state on public.counsel_requests
  for each row execute function app.enforce_counsel_request_transition();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.counsel_requests enable row level security;
create policy counsel_requests_member_select on public.counsel_requests
  for select using (organization_id in (select app.user_org_ids()));
create policy counsel_requests_member_insert on public.counsel_requests
  for insert with check (
    app.has_org_role(organization_id, array['owner','admin','member'])
    and created_by = (select auth.uid())
    and state = 'draft'
  );
-- Requester-side state moves (submit, schedule) and all counsel-side moves
-- run through trusted server logic that applies the application state
-- machine plus this table's trigger; no direct update policy for members.

alter table public.counsel_request_events enable row level security;
create policy counsel_request_events_member_select on public.counsel_request_events
  for select using (organization_id in (select app.user_org_ids()));
create trigger counsel_request_events_immutable
  before update or delete on public.counsel_request_events
  for each row execute function app.reject_mutation();

alter table public.engagements enable row level security;
create policy engagements_member_select on public.engagements
  for select using (organization_id in (select app.user_org_ids()));

alter table public.legal_matters enable row level security;
create policy legal_matters_member_select on public.legal_matters
  for select using (organization_id in (select app.user_org_ids()));

alter table public.filing_packages enable row level security;
create policy filing_packages_member_select on public.filing_packages
  for select using (organization_id in (select app.user_org_ids()));

alter table public.audit_events enable row level security;
create policy audit_events_member_select on public.audit_events
  for select using (organization_id in (select app.user_org_ids()));
create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function app.reject_mutation();

alter table public.retention_policies enable row level security;
create policy retention_policies_member_select on public.retention_policies
  for select using (organization_id in (select app.user_org_ids()));
create policy retention_policies_owner_update on public.retention_policies
  for update using (app.has_org_role(organization_id, array['owner','admin']))
  with check (app.has_org_role(organization_id, array['owner','admin']));
