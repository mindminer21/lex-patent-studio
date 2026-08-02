-- Invention Intake Studio M1 (feature PRD docs/PRD-wepatent-intake-studio.md §8):
-- Problem/Solution ledger, working titles, components, associations,
-- extraction artifacts, enablement coverage, and the M2 interview schema
-- (sessions/turns land now; the engine is M2). Additive only.
--
-- Trust model matches the house pattern: every tenant row carries
-- organization_id; members read via RLS; writes happen only through trusted
-- server logic (service role). Append-only logs get immutability triggers.

-- ---------------------------------------------------------------------------
-- Enumerated types (invariant 13: ai_proposed until a human acts)
-- ---------------------------------------------------------------------------
create type public.ps_state as enum ('ai_proposed', 'user_confirmed', 'user_edited');
create type public.ps_pair_kind as enum ('problem', 'solution');
create type public.ps_origin as enum ('upload_distillation', 'interview', 'manual');

-- ---------------------------------------------------------------------------
-- Upload interpretation outcome (feature PRD §5.2): honest first-class
-- status; null on legacy rows means "not interpreted yet".
-- ---------------------------------------------------------------------------
alter table public.private_sources
  add column interpretation_status text
    check (interpretation_status in ('not_interpreted', 'interpreted', 'stored_uninterpreted'));

-- Fact provenance origin refs (feature PRD §8): facts can trace to uploads
-- or interview turns. Nullable, additive.
alter table public.invention_facts
  add column origin_ref text;

-- New durable-job kinds for the studio pipeline (FR-INT-3/FR-INT-4).
alter table public.app_jobs drop constraint app_jobs_kind_check;
alter table public.app_jobs add constraint app_jobs_kind_check
  check (kind in (
    'generation', 'source_scan', 'source_extraction',
    'source_interpretation', 'distillation', 'export_render'
  ));

-- ---------------------------------------------------------------------------
-- Problem/Solution ledger (FR-INT-5)
-- ---------------------------------------------------------------------------
create table public.ps_pairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  kind public.ps_pair_kind not null,
  statement text not null,
  state public.ps_state not null default 'ai_proposed',
  origin public.ps_origin not null,
  created_by_actor text not null check (created_by_actor in ('user', 'model')),
  source_anchors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- Invariant 13 (AI writes arrive only as ai_proposed; only human action
  -- upgrades state) is enforced by the domain guard in
  -- src/lib/wepatent/domain/ps-ledger.ts — the only write path is trusted
  -- server logic, and it routes every mutation through that guard.
);
create index on public.ps_pairs (organization_id, invention_id);

alter table public.ps_pairs enable row level security;
create policy ps_pairs_member_select on public.ps_pairs
  for select using (organization_id in (select app.user_org_ids()));
-- Writes: trusted server logic (service role) only.

create table public.ps_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  problem_id uuid not null references public.ps_pairs (id) on delete cascade,
  solution_id uuid not null references public.ps_pairs (id) on delete cascade,
  state public.ps_state not null default 'ai_proposed',
  created_at timestamptz not null default now(),
  unique (problem_id, solution_id)
);
create index on public.ps_links (organization_id, invention_id);

alter table public.ps_links enable row level security;
create policy ps_links_member_select on public.ps_links
  for select using (organization_id in (select app.user_org_ids()));

-- Append-only mutation log, including AI-proposal rejections (§5.4).
create table public.ps_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  pair_id uuid references public.ps_pairs (id) on delete set null,
  kind text not null check (kind in (
    'proposed', 'confirmed', 'edited', 'deleted', 'ai_proposal_rejected',
    'linked', 'unlinked', 'title_proposed', 'title_edited', 'title_confirmed'
  )),
  actor text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index on public.ps_events (organization_id, invention_id, created_at);

alter table public.ps_events enable row level security;
create policy ps_events_member_select on public.ps_events
  for select using (organization_id in (select app.user_org_ids()));
create trigger ps_events_immutable
  before update or delete on public.ps_events
  for each row execute function app.reject_mutation();

-- Working-title proposal history: append-only; newest row is current.
create table public.working_titles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  text text not null,
  state public.ps_state not null default 'ai_proposed',
  created_by_actor text not null check (created_by_actor in ('user', 'model')),
  created_at timestamptz not null default now()
);
create index on public.working_titles (organization_id, invention_id, created_at);

alter table public.working_titles enable row level security;
create policy working_titles_member_select on public.working_titles
  for select using (organization_id in (select app.user_org_ids()));
create trigger working_titles_immutable
  before update or delete on public.working_titles
  for each row execute function app.reject_mutation();

-- ---------------------------------------------------------------------------
-- Component inventory + solution↔evidence associations (feature PRD §7)
-- ---------------------------------------------------------------------------
create table public.components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  name text not null,
  description text not null default '',
  state public.ps_state not null default 'ai_proposed',
  source_anchors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.components (organization_id, invention_id);

alter table public.components enable row level security;
create policy components_member_select on public.components
  for select using (organization_id in (select app.user_org_ids()));

-- Per-source interpretation artifacts with model + cost provenance
-- (feature PRD §5.2: "every interpretation output records model, version,
-- timestamp, and cost").
create table public.extraction_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  source_id uuid not null references public.private_sources (id) on delete cascade,
  type text not null check (type in ('interpretation_summary', 'text_excerpt', 'status_note')),
  content text not null,
  model_id text,
  cost_reservation_id uuid references public.usage_reservations (id),
  created_at timestamptz not null default now()
);
create index on public.extraction_artifacts (organization_id, invention_id);
create index on public.extraction_artifacts (organization_id, source_id);

alter table public.extraction_artifacts enable row level security;
create policy extraction_artifacts_member_select on public.extraction_artifacts
  for select using (organization_id in (select app.user_org_ids()));
create trigger extraction_artifacts_immutable
  before update or delete on public.extraction_artifacts
  for each row execute function app.reject_mutation();

create table public.associations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  solution_id uuid not null references public.ps_pairs (id) on delete cascade,
  component_id uuid references public.components (id) on delete cascade,
  extraction_artifact_id uuid references public.extraction_artifacts (id) on delete cascade,
  state public.ps_state not null default 'ai_proposed',
  created_at timestamptz not null default now(),
  constraint associations_have_evidence
    check (component_id is not null or extraction_artifact_id is not null)
);
create index on public.associations (organization_id, invention_id);

alter table public.associations enable row level security;
create policy associations_member_select on public.associations
  for select using (organization_id in (select app.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Enablement coverage snapshots (FR-INT-8): DETERMINISTIC code output only;
-- append-only history, newest row per (solution, dimension) is current.
-- ---------------------------------------------------------------------------
create table public.enablement_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  solution_id uuid not null references public.ps_pairs (id) on delete cascade,
  dimension text not null check (dimension in (
    'problem_articulated', 'concept_stated', 'structure_captured',
    'operation_captured', 'alternatives_captured', 'parameters_captured',
    'how_to_use_captured'
  )),
  status text not null check (status in ('satisfied', 'gap')),
  evidence text,
  coverage_version text not null,
  computed_at timestamptz not null default now()
);
create index on public.enablement_coverage (organization_id, invention_id, computed_at);

alter table public.enablement_coverage enable row level security;
create policy enablement_coverage_member_select on public.enablement_coverage
  for select using (organization_id in (select app.user_org_ids()));
create trigger enablement_coverage_immutable
  before update or delete on public.enablement_coverage
  for each row execute function app.reject_mutation();

-- ---------------------------------------------------------------------------
-- Adaptive interview schema (feature PRD §6, §8). The ENGINE is M2; the
-- schema lands now so M2 is purely additive application code.
-- ---------------------------------------------------------------------------
create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage text not null default 'context_field',
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  session_spend_cap_cents integer check (session_spend_cap_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.interview_sessions (organization_id, invention_id);

alter table public.interview_sessions enable row level security;
create policy interview_sessions_member_select on public.interview_sessions
  for select using (organization_id in (select app.user_org_ids()));

create table public.interview_turns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  turn_index integer not null check (turn_index >= 0),
  question text not null,
  -- Machine-readable question target: a ps_pair id or coverage dimension.
  target_ref text,
  answer_text text,
  skipped boolean not null default false,
  attachment_source_ids jsonb not null default '[]'::jsonb,
  extraction_job_id uuid references public.app_jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);
create index on public.interview_turns (organization_id, session_id);

alter table public.interview_turns enable row level security;
create policy interview_turns_member_select on public.interview_turns
  for select using (organization_id in (select app.user_org_ids()));
