-- Round 2 additions: durable job records, upload/quarantine metadata,
-- counsel-lane assignments, export artifacts, and robust generation
-- idempotency (PRD FR-4, §7.4, §6.3, §14).

-- ---------------------------------------------------------------------------
-- Durable jobs (generalized beyond generation_jobs): every long-running
-- work item is queued/running/succeeded/failed/cancelled with an
-- organization-scoped idempotency key (PRD §14, §7.4).
-- ---------------------------------------------------------------------------
create table public.app_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('generation', 'source_scan', 'source_extraction', 'export_render')),
  status public.generation_job_status not null default 'queued',
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_summary text,
  attempts integer not null default 0 check (attempts >= 0),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- A retried submission with the same key attaches to the same job row.
  unique (organization_id, kind, idempotency_key)
);
create index on public.app_jobs (organization_id, status);
create index on public.app_jobs (status, created_at);

alter table public.app_jobs enable row level security;
create policy app_jobs_member_select on public.app_jobs
  for select using (organization_id in (select app.user_org_ids()));
-- Writes happen only through trusted server logic (service role).

-- ---------------------------------------------------------------------------
-- Upload pipeline metadata (FR-4): validation and quarantine evidence.
-- ---------------------------------------------------------------------------
alter table public.private_sources
  add column quarantine_reason text,
  add column checksum_sha256 text,
  add column original_filename text;

-- ---------------------------------------------------------------------------
-- Robust generation idempotency: a draft version records the reservation it
-- settled against, so a retry with the same idempotency key returns the
-- prior version instead of re-charging (PRD §7.4).
-- ---------------------------------------------------------------------------
alter table public.draft_versions
  add column reservation_id uuid references public.usage_reservations (id);
create index on public.draft_versions (reservation_id);

-- ---------------------------------------------------------------------------
-- Export artifacts: rendered DOCX/PDF/manifest files with per-artifact
-- SHA-256 checksums. Kept in a separate append-only table because export
-- rows themselves are immutable; the export row's checksum remains the
-- manifest checksum (PRD §7.5).
-- ---------------------------------------------------------------------------
create table public.export_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  export_id uuid not null references public.exports (id) on delete cascade,
  name text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (export_id, name)
);
create index on public.export_artifacts (organization_id, export_id);

alter table public.export_artifacts enable row level security;
create policy export_artifacts_member_select on public.export_artifacts
  for select using (organization_id in (select app.user_org_ids()));
create trigger export_artifacts_immutable
  before update or delete on public.export_artifacts
  for each row execute function app.reject_mutation();

-- ---------------------------------------------------------------------------
-- Invitation lifecycle metadata for idempotent, expiring acceptance
-- (PRD §7.1): who accepted, and explicit revocation.
-- ---------------------------------------------------------------------------
alter table public.invitations
  add column accepted_by uuid references auth.users (id),
  add column revoked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Staged-intake save/resume sessions (PRD §7.3). The intake state is a
-- server-validated JSON document; one open session per user per org.
-- ---------------------------------------------------------------------------
create table public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  submitted_invention_id uuid references public.inventions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.intake_sessions (organization_id, user_id);

alter table public.intake_sessions enable row level security;
create policy intake_sessions_self_select on public.intake_sessions
  for select using (
    organization_id in (select app.user_org_ids()) and user_id = (select auth.uid())
  );
create policy intake_sessions_self_write on public.intake_sessions
  for insert with check (
    app.has_org_role(organization_id, array['owner','admin','member'])
    and user_id = (select auth.uid())
  );
create policy intake_sessions_self_update on public.intake_sessions
  for update using (user_id = (select auth.uid()))
  with check (
    app.has_org_role(organization_id, array['owner','admin','member'])
    and user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Connected-counsel lane assignments (PRD §6.3, FR-2): counsel roles are
-- NEVER granted through organization membership or invitations. They are a
-- separate assignment table written only by trusted operator process
-- (service role), and they carry a separate audit policy.
-- ---------------------------------------------------------------------------
create table public.counsel_assignments (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.org_role not null check (role in ('counsel_intake', 'counsel_attorney')),
  law_firm_name text not null default 'Schell IP (connected counsel)',
  created_at timestamptz not null default now()
);

alter table public.counsel_assignments enable row level security;
create policy counsel_assignments_self_select on public.counsel_assignments
  for select using (user_id = (select auth.uid()));
-- No insert/update/delete policies: service-role only.

-- Counsel-lane audit trail is separate from tenant audit_events (PRD §6.3):
-- it records counsel-side actions and is append-only.
create table public.counsel_audit_events (
  id uuid primary key default gen_random_uuid(),
  counsel_user_id uuid not null references auth.users (id),
  organization_id uuid references public.organizations (id) on delete set null,
  request_id uuid references public.counsel_requests (id) on delete set null,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.counsel_audit_events (counsel_user_id, created_at desc);

alter table public.counsel_audit_events enable row level security;
create policy counsel_audit_events_counsel_select on public.counsel_audit_events
  for select using (
    exists (
      select 1 from public.counsel_assignments ca
      where ca.user_id = (select auth.uid())
    )
  );
create trigger counsel_audit_events_immutable
  before update or delete on public.counsel_audit_events
  for each row execute function app.reject_mutation();
