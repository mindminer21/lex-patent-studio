-- Lex Patent Studio — private application project
-- Migration 0002: matters, facts, sources, workflows, claims, prosecution,
-- review/approval, documents/exports, deadlines (PRD §11).
--
-- Every table carries organization_id (tenant isolation, Invariant 18) and
-- has RLS enabled. Members read their tenant; matter-scoped tables further
-- respect matter ACLs for contributor seats. All writes are service-only.

-- ---------------------------------------------------------------------------
-- Matters and ACLs (FR-3, FR-2 matter-level ACLs)
-- ---------------------------------------------------------------------------

create table matters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_number text not null check (char_length(matter_number) between 1 and 64),
  title text not null check (char_length(title) between 1 and 300),
  jurisdiction text not null default 'US',
  technology_area text not null,
  style_profile_id uuid,
  lifecycle matter_lifecycle not null default 'active',
  conflict_tags text[] not null default '{}',
  export_control_flag boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, matter_number)
);

create index matters_org_idx on matters (organization_id);

create table matter_acl (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  matter_id uuid not null references matters (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid not null,
  created_at timestamptz not null default now(),
  unique (matter_id, user_id)
);

create index matter_acl_org_idx on matter_acl (organization_id);
create index matter_acl_user_idx on matter_acl (user_id);

-- A member may see a matter when they hold a practitioner-class role, or
-- when the matter is explicitly shared with them (contributor/viewer seats).
create or replace function app_can_view_matter(org uuid, matter uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_org_role(org) in ('owner', 'practitioner_admin', 'practitioner', 'agent_operator')
    or exists (
      select 1 from matter_acl a
      where a.matter_id = matter and a.user_id = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- Fact ledger (FR-3)
-- ---------------------------------------------------------------------------

create table matter_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  category text not null check (category in (
    'problem','solution','component','step','alternative',
    'advantage','contributor','date'
  )),
  text text not null check (char_length(text) between 1 and 4000),
  provenance fact_provenance not null default 'user_asserted',
  source_ids uuid[] not null default '{}',
  contributed_by uuid not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index matter_facts_org_matter_idx on matter_facts (organization_id, matter_id);

create table fact_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  fact_id uuid not null references matter_facts (id) on delete cascade,
  event_type text not null check (event_type in (
    'created','edited','provenance_changed','approved','reopened'
  )),
  from_provenance fact_provenance,
  to_provenance fact_provenance,
  actor_user_id uuid not null,
  actor_role org_role,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index fact_events_fact_idx on fact_events (fact_id);
create index fact_events_org_idx on fact_events (organization_id);

-- ---------------------------------------------------------------------------
-- Private sources (FR-4)
-- ---------------------------------------------------------------------------

create table private_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  kind text not null check (kind in (
    'disclosure_upload','interview_transcript','prior_art_patent',
    'office_action','reference_document','search_result'
  )),
  title text not null check (char_length(title) between 1 and 300),
  storage_path text,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  content_sha256 text,
  extraction_state extraction_state not null default 'uploaded',
  page_count integer check (page_count >= 0),
  -- Patent-document awareness: link to public corpus instead of duplicating.
  public_corpus_document_id uuid,
  uploaded_by uuid not null,
  created_at timestamptz not null default now()
);

create index private_sources_org_matter_idx
  on private_sources (organization_id, matter_id);

create table source_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  source_id uuid not null references private_sources (id) on delete cascade,
  state extraction_state not null,
  -- Page/paragraph coordinates preserved for pinpoint citations (FR-4).
  extracted_layout jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index source_extractions_source_idx on source_extractions (source_id);

-- ---------------------------------------------------------------------------
-- Style profiles and playbooks (§5.4)
-- ---------------------------------------------------------------------------

create table style_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  version integer not null default 1 check (version > 0),
  rules jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name, version)
);

create index style_profiles_org_idx on style_profiles (organization_id);

-- Tenant-isolated playbooks with reviewer identity and immutable hashes
-- (§5.4). Cross-tenant access is impossible under RLS by construction.
create table playbook_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  body text not null,
  content_sha256 text not null,
  reviewed_by uuid not null,
  reviewer_role org_role not null,
  previous_entry_id uuid references playbook_entries (id),
  published_at timestamptz not null default now()
);

create index playbook_entries_org_idx on playbook_entries (organization_id);

create trigger playbook_entries_immutable
  before update or delete on playbook_entries
  for each row execute function app_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Workflow orchestration (FR-7)
-- ---------------------------------------------------------------------------

-- Platform artifacts: versioned workflow definitions (no organization_id —
-- these are platform policy, including the tier floor; Invariant 15).
create table workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  version text not null,
  tier_floor work_tier not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique (workflow_key, version)
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  workflow_definition_id uuid not null references workflow_definitions (id),
  workflow_key text not null,
  workflow_version text not null,
  tier work_tier not null,
  state run_state not null default 'QUEUED',
  jurisdiction text not null default 'US',
  as_of_date date not null,
  model_id text not null,
  model_tier text not null check (model_tier in ('fast','advanced','frontier')),
  corpus_release text not null,
  style_profile_id uuid references style_profiles (id),
  style_profile_version integer,
  deliverable_type text not null,
  quality_controls jsonb not null default '{}'::jsonb,
  estimated_charge_low_usd numeric(12,2) not null check (estimated_charge_low_usd >= 0),
  estimated_charge_high_usd numeric(12,2) not null check (estimated_charge_high_usd >= 0),
  actual_charge_usd numeric(12,2) check (actual_charge_usd >= 0),
  usage_reservation_id uuid,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflow_runs_org_matter_idx
  on workflow_runs (organization_id, matter_id);
create index workflow_runs_state_idx on workflow_runs (state);

-- Per-stage checkpoints: retries never repeat a billable call with unknown
-- prior outcome (FR-7).
create table run_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  run_id uuid not null references workflow_runs (id) on delete cascade,
  stage run_state not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checkpoint jsonb,
  provider_call_fingerprint text,
  error text,
  unique (run_id, stage)
);

create index run_stages_run_idx on run_stages (run_id);

create table deterministic_check_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  run_id uuid not null references workflow_runs (id) on delete cascade,
  check_kind text not null check (check_kind in (
    'claim_dependency','antecedent_basis','numeral_consistency',
    'section_completeness','sb08_validation'
  )),
  passed boolean not null,
  results jsonb not null default '{}'::jsonb,
  -- Failures cannot be dismissed silently (§9.2): a dismissal requires a
  -- recorded reason and actor.
  dismissed_by uuid,
  dismissal_reason text check (
    dismissed_by is null or char_length(dismissal_reason) between 1 and 2000
  ),
  created_at timestamptz not null default now()
);

create index deterministic_check_results_run_idx
  on deterministic_check_results (run_id);

-- ---------------------------------------------------------------------------
-- Claims (§5.1 drafting)
-- ---------------------------------------------------------------------------

create table claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  claim_number integer not null check (claim_number > 0),
  claim_type text not null check (claim_type in ('independent','dependent')),
  created_at timestamptz not null default now(),
  unique (matter_id, claim_number)
);

create index claims_org_matter_idx on claims (organization_id, matter_id);

create table claim_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  claim_id uuid not null references claims (id) on delete cascade,
  version integer not null check (version > 0),
  text text not null,
  content_sha256 text not null,
  created_by_run_id uuid references workflow_runs (id),
  created_at timestamptz not null default now(),
  unique (claim_id, version)
);

create table claim_tree_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  parent_claim_id uuid not null references claims (id) on delete cascade,
  child_claim_id uuid not null references claims (id) on delete cascade,
  edge_kind text not null default 'depends_on',
  unique (parent_claim_id, child_claim_id)
);

create index claim_tree_edges_matter_idx on claim_tree_edges (matter_id);

-- ---------------------------------------------------------------------------
-- Prosecution: rejections, matrices, search, IDS (§5.1)
-- ---------------------------------------------------------------------------

create table rejections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  office_action_source_id uuid references private_sources (id),
  statute text not null,
  rejection_type text not null,
  claim_numbers integer[] not null default '{}',
  created_at timestamptz not null default now()
);

create index rejections_org_matter_idx on rejections (organization_id, matter_id);

-- Evidence-linked cells: every cell links to source evidence (§9.3).
create table rejection_matrix_cells (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  rejection_id uuid not null references rejections (id) on delete cascade,
  claim_number integer not null,
  reference_source_id uuid references private_sources (id),
  pinpoint_citation text not null,
  evidence_excerpt text,
  verification verification_state not null default 'unverified',
  created_at timestamptz not null default now()
);

create index rejection_matrix_cells_rejection_idx
  on rejection_matrix_cells (rejection_id);

create table search_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  run_id uuid references workflow_runs (id),
  scope text not null,
  style_profile_id uuid references style_profiles (id),
  created_at timestamptz not null default now()
);

create index search_reports_org_matter_idx
  on search_reports (organization_id, matter_id);

create table search_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  search_report_id uuid not null references search_reports (id) on delete cascade,
  reference_identifier text not null,
  relevance_rationale text not null,
  rank integer not null check (rank > 0),
  public_corpus_document_id uuid,
  created_at timestamptz not null default now()
);

create index search_references_report_idx
  on search_references (search_report_id);

create table ids_packets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  run_id uuid references workflow_runs (id),
  search_report_id uuid references search_reports (id),
  sb08_valid boolean not null default false,
  size_fee_flag boolean not null default false,
  created_at timestamptz not null default now()
);

create index ids_packets_org_matter_idx on ids_packets (organization_id, matter_id);

create table ids_citations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  ids_packet_id uuid not null references ids_packets (id) on delete cascade,
  citation_class text not null check (citation_class in (
    'us_patent','us_publication','foreign','npl'
  )),
  fields jsonb not null,
  sb08_field_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index ids_citations_packet_idx on ids_citations (ids_packet_id);

-- ---------------------------------------------------------------------------
-- Quality control and review (§9.6, FR-8, Invariants 14–16)
-- ---------------------------------------------------------------------------

create table critic_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  run_id uuid not null references workflow_runs (id) on delete cascade,
  critic_model_id text not null,
  drafting_model_id text not null,
  -- Critic model must differ from the drafting model (FR-6).
  constraint critic_model_independent check (critic_model_id <> drafting_model_id),
  summary text not null,
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index critic_reports_run_idx on critic_reports (run_id);

create table verification_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  run_id uuid not null references workflow_runs (id) on delete cascade,
  target_kind text not null check (target_kind in ('quote','citation','reference_id')),
  target_text text not null,
  source_locator text,
  state verification_state not null,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index verification_results_run_idx on verification_results (run_id);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  run_id uuid references workflow_runs (id),
  document_title text not null,
  document_version_hash text not null,
  tier work_tier not null,
  state review_state not null default 'pending_review',
  verification verification_state not null default 'unverified',
  critic_report_id uuid references critic_reports (id),
  unresolved_flags text[] not null default '{}',
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_items_org_state_idx
  on review_items (organization_id, state, due_date);

-- Invariant 16: decisions are recorded rows created by trusted server logic
-- for an authenticated human actor. No client write path exists under RLS,
-- and the server refuses non-human actors before insert.
create table review_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  review_item_id uuid not null references review_items (id) on delete cascade,
  decision review_decision_kind not null,
  note text check (char_length(note) <= 4000),
  actor_user_id uuid not null,
  actor_role org_role not null,
  document_version_hash text not null,
  decided_at timestamptz not null default now()
);

create index review_decisions_item_idx on review_decisions (review_item_id);

create trigger review_decisions_immutable
  before update or delete on review_decisions
  for each row execute function app_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Documents and exports (FR-8)
-- ---------------------------------------------------------------------------

create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  run_id uuid references workflow_runs (id),
  title text not null,
  deliverable_type text not null,
  tier work_tier not null,
  review_state review_state not null default 'pending_review',
  verification verification_state not null default 'unverified',
  model_id text not null,
  corpus_release text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_org_matter_idx on documents (organization_id, matter_id);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  document_id uuid not null references documents (id) on delete cascade,
  version integer not null check (version > 0),
  content jsonb not null,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

-- Exported artifacts are version-locked and never mutated (§9.2).
create table exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  document_version_id uuid not null references document_versions (id),
  format text not null check (format in ('docx','pdf')),
  -- Watermark rule: anything unapproved exports as DRAFT — NOT REVIEWED.
  watermark text,
  approved boolean not null default false,
  storage_path text,
  exported_by uuid not null,
  created_at timestamptz not null default now()
);

create index exports_org_matter_idx on exports (organization_id, matter_id);

create table export_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  export_id uuid not null references exports (id) on delete cascade,
  manifest jsonb not null, -- model, corpus release, verification, approvals
  manifest_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (export_id)
);

create trigger export_manifests_immutable
  before update or delete on export_manifests
  for each row execute function app_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Deadline observations (§5.5, Invariant 20) — never authoritative
-- ---------------------------------------------------------------------------

create table deadline_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  matter_id uuid not null references matters (id) on delete cascade,
  label text not null,
  observed_date date not null,
  window_kind text not null,
  -- Mandatory disclaimer flag: enforced true at the schema level.
  disclaimer_required boolean not null default true check (disclaimer_required),
  created_at timestamptz not null default now()
);

create index deadline_observations_org_idx
  on deadline_observations (organization_id, observed_date);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table matters enable row level security;
alter table matter_acl enable row level security;
alter table matter_facts enable row level security;
alter table fact_events enable row level security;
alter table private_sources enable row level security;
alter table source_extractions enable row level security;
alter table style_profiles enable row level security;
alter table playbook_entries enable row level security;
alter table workflow_definitions enable row level security;
alter table workflow_runs enable row level security;
alter table run_stages enable row level security;
alter table deterministic_check_results enable row level security;
alter table claims enable row level security;
alter table claim_versions enable row level security;
alter table claim_tree_edges enable row level security;
alter table rejections enable row level security;
alter table rejection_matrix_cells enable row level security;
alter table search_reports enable row level security;
alter table search_references enable row level security;
alter table ids_packets enable row level security;
alter table ids_citations enable row level security;
alter table critic_reports enable row level security;
alter table verification_results enable row level security;
alter table review_items enable row level security;
alter table review_decisions enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table exports enable row level security;
alter table export_manifests enable row level security;
alter table deadline_observations enable row level security;

-- Matter table respects matter ACLs for contributor/viewer seats.
create policy matters_member_select on matters
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, id));

create policy matter_acl_member_select on matter_acl
  for select to authenticated
  using (app_is_org_member(organization_id));

-- Matter-scoped tables: tenant membership + matter visibility.
create policy matter_facts_select on matter_facts
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy fact_events_select on fact_events
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy private_sources_select on private_sources
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy source_extractions_select on source_extractions
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy style_profiles_select on style_profiles
  for select to authenticated
  using (app_is_org_member(organization_id));

-- Playbooks: practitioner-class roles only (contributors never see legal
-- analysis or playbook content).
create policy playbook_entries_select on playbook_entries
  for select to authenticated
  using (app_org_role(organization_id) in
    ('owner','practitioner_admin','practitioner','agent_operator'));

-- Platform workflow definitions are readable by any authenticated user.
create policy workflow_definitions_select on workflow_definitions
  for select to authenticated
  using (true);

create policy workflow_runs_select on workflow_runs
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy run_stages_select on run_stages
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy deterministic_check_results_select on deterministic_check_results
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy claims_select on claims
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy claim_versions_select on claim_versions
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy claim_tree_edges_select on claim_tree_edges
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy rejections_select on rejections
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy rejection_matrix_cells_select on rejection_matrix_cells
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy search_reports_select on search_reports
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy search_references_select on search_references
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy ids_packets_select on ids_packets
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy ids_citations_select on ids_citations
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy critic_reports_select on critic_reports
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy verification_results_select on verification_results
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy review_items_select on review_items
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy review_decisions_select on review_decisions
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy documents_select on documents
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy document_versions_select on document_versions
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy exports_select on exports
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy export_manifests_select on export_manifests
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy deadline_observations_select on deadline_observations
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));
