-- Invention records: canonical facts separated from generated prose (FR-3),
-- contributors, disclosure timeline, private sources, drafts, review
-- findings, and version-locked exports (PRD §9).

create table public.inventions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  summary text not null,
  business_context text not null default '',
  problem text not null default '',
  solution text not null default '',
  synthetic boolean not null default false,
  status text not null default 'active' check (status in ('active', 'soft_deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.inventions (organization_id);

create table public.invention_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  category public.fact_category not null,
  statement text not null check (char_length(statement) between 3 and 8000),
  provenance public.fact_provenance not null default 'user_asserted',
  -- Model output can never author facts (PRD §5.9): 'model' is not allowed.
  created_by_actor text not null default 'user'
    check (created_by_actor in ('user', 'counsel', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.invention_facts (organization_id, invention_id);

create table public.contributors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  name text not null,
  email text,
  created_at timestamptz not null default now()
);
create index on public.contributors (organization_id, invention_id);

create table public.contribution_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contributor_id uuid not null references public.contributors (id) on delete cascade,
  description text not null,
  created_at timestamptz not null default now()
);
create index on public.contribution_facts (organization_id, contributor_id);

create table public.disclosure_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  event_date date not null,
  kind text not null,
  description text not null,
  under_nda boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.disclosure_events (organization_id, invention_id, event_date);

create table public.private_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  name text not null,
  kind text not null,
  note text not null default '',
  storage_path text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  status public.source_status not null default 'registered',
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.private_sources (organization_id, invention_id);

create table public.source_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid not null references public.private_sources (id) on delete cascade,
  status public.generation_job_status not null default 'queued',
  extracted_text_path text,
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.source_extractions (organization_id, source_id);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  workflow text not null,
  title text not null,
  created_at timestamptz not null default now()
);
create index on public.drafts (organization_id, invention_id);

create table public.draft_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  draft_id uuid not null references public.drafts (id) on delete cascade,
  version integer not null,
  content text not null,
  model_id text not null,
  rate_version text not null,
  estimate_customer_high_cents integer not null,
  actual_provider_cost_cents integer not null,
  actual_customer_charge_cents integer not null,
  unresolved_fact_count integer not null default 0,
  source_status_summary text not null default '',
  -- The platform can never mark a draft approved; the only label is
  -- 'working_draft' (PRD §7.4). Counsel approval lives in the counsel lane.
  label text not null default 'working_draft' check (label = 'working_draft'),
  created_at timestamptz not null default now(),
  unique (draft_id, version)
);
create index on public.draft_versions (organization_id, draft_id);

create table public.draft_citations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  draft_version_id uuid not null references public.draft_versions (id) on delete cascade,
  source_id uuid references public.private_sources (id) on delete set null,
  fact_id uuid references public.invention_facts (id) on delete set null,
  locator text not null default '',
  created_at timestamptz not null default now()
);
create index on public.draft_citations (organization_id, draft_version_id);

create table public.review_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  kind text not null,
  detail text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.review_findings (organization_id, invention_id);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  draft_version_id uuid references public.draft_versions (id),
  checksum text not null,
  created_at timestamptz not null default now()
);
create index on public.exports (organization_id, invention_id);

create table public.export_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  export_id uuid not null unique references public.exports (id) on delete cascade,
  manifest jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: standard tenant policies. Editing roles: owner/admin/member.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'inventions', 'invention_facts', 'contributors', 'contribution_facts',
    'disclosure_events', 'private_sources', 'source_extractions', 'drafts',
    'draft_versions', 'draft_citations', 'review_findings', 'exports',
    'export_manifests'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select using (organization_id in (select app.user_org_ids()))',
      t || '_member_select', t
    );
  end loop;
end
$$;

-- Write policies: user-editable record tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'inventions', 'invention_facts', 'contributors', 'contribution_facts',
    'disclosure_events', 'private_sources', 'review_findings'
  ] loop
    execute format(
      'create policy %I on public.%I for insert with check (app.has_org_role(organization_id, array[''owner'',''admin'',''member'']))',
      t || '_editor_insert', t
    );
    execute format(
      'create policy %I on public.%I for update using (app.has_org_role(organization_id, array[''owner'',''admin'',''member''])) with check (app.has_org_role(organization_id, array[''owner'',''admin'',''member'']))',
      t || '_editor_update', t
    );
  end loop;
end
$$;

-- Facts: counsel_reviewed can only be set by trusted counsel-lane server
-- logic (service role); application roles cannot write that provenance.
create policy invention_facts_no_counsel_reviewed_insert on public.invention_facts
  as restrictive for insert
  with check (provenance <> 'counsel_reviewed');
create policy invention_facts_no_counsel_reviewed_update on public.invention_facts
  as restrictive for update
  with check (provenance <> 'counsel_reviewed');

-- Drafts, draft_versions, exports, export_manifests, source_extractions are
-- written only by trusted server logic (service role bypasses RLS); no
-- insert/update/delete policies for application roles.

-- Draft versions and export records are immutable once written.
create trigger draft_versions_immutable
  before update or delete on public.draft_versions
  for each row execute function app.reject_mutation();
create trigger exports_immutable
  before update or delete on public.exports
  for each row execute function app.reject_mutation();
create trigger export_manifests_immutable
  before update or delete on public.export_manifests
  for each row execute function app.reject_mutation();
