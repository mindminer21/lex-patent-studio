-- Three-pass patent drafting (Jeff's directive, 2026-08-04).
--
--   PASS_1_DRAFTING -> FIGURES_PENDING -> FIGURES_READY -> PASS_2_REVISING
--                   -> READY_FOR_REVIEW   (+ NEEDS_INPUT / PAUSED_BUDGET / FAILED)
--
-- Pass 1 authors the application draft AND the illustrations brief, which
-- carries the reference-numeral assignments. The figures stage then runs off
-- that brief. Pass 2 re-drafts against the composed figures and their
-- validation report, and cannot complete unless the two-way 608.02
-- reconciliation passes. Nothing is delivered until the set is
-- ready_for_review AND a human accepts.
--
-- ADDITIVE ONLY. Nothing existing is dropped. The only modified object is
-- the app_jobs kind CHECK constraint, extended with the two new pass kinds
-- (house pattern from 0012), and figure_sets gains two nullable columns.
--
-- Every table carries organization_id + RLS with member-select and
-- service-role-write; the transition log is append-only via the existing
-- app.reject_mutation() trigger.

-- ---------------------------------------------------------------------------
-- The orchestration state
-- ---------------------------------------------------------------------------
create type public.draft_pass_state as enum (
  'pass_1_drafting',
  'figures_pending',
  'figures_ready',
  'pass_2_revising',
  'ready_for_review',
  'needs_input',
  'paused_budget',
  'failed'
);

-- The stage an interruption paused, so a resume returns to it rather than
-- restarting the set and re-charging for work already paid for.
create type public.draft_pass_stage as enum (
  'pass_1_drafting', 'figures_pending', 'figures_ready', 'pass_2_revising'
);

-- ---------------------------------------------------------------------------
-- draft_sets: one three-pass run over an invention.
-- ---------------------------------------------------------------------------
create table public.draft_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,

  state public.draft_pass_state not null default 'pass_1_drafting',
  -- Non-null exactly when state is an interruption; enforced below.
  interrupted_stage public.draft_pass_stage,

  -- The two versions. Pass 2 NEVER mutates pass 1 in place: both remain
  -- inspectable and diffable.
  pass_1_version_id uuid references public.draft_versions (id) on delete set null,
  pass_2_version_id uuid references public.draft_versions (id) on delete set null,
  figure_set_id uuid references public.figure_sets (id) on delete set null,

  -- THE ILLUSTRATIONS BRIEF, authored in Pass 1. Validated against the
  -- shared zod schema (src/lib/shared/drafting/illustrations-brief.ts)
  -- before it is written; stored whole so the exact instruction the figure
  -- stage worked from is recoverable.
  illustrations_brief jsonb not null default '{}'::jsonb,
  brief_version text not null default '',

  -- The two-way 37 CFR 1.84(p)(5) / MPEP 608.02(g) result. Null until Pass 2
  -- runs. `reconciled` is the GATE on reaching ready_for_review.
  reconciliation jsonb,
  reconciled boolean not null default false,
  reconciliation_version text not null default '',

  -- Verbatim, customer-facing reason the run paused or failed. Never a
  -- generic "not ready".
  status_detail text not null default '',

  -- Human acceptance. The platform can never write these: an AI-proposed
  -- set stays AI-proposed until a person acts (invariant 1). Enforced by the
  -- pairing constraint plus the append-only audit trail.
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,

  -- Metering, per pass. Retry never double-charges: each pass records the
  -- reservation it settled against.
  pass_1_reservation_id uuid,
  pass_2_reservation_id uuid,
  pass_1_charge_cents integer not null default 0 check (pass_1_charge_cents >= 0),
  pass_2_charge_cents integer not null default 0 check (pass_2_charge_cents >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An interruption must say which stage it interrupted, and a non-
  -- interruption must not claim one.
  constraint draft_sets_interruption_stage check (
    (state in ('needs_input', 'paused_budget') and interrupted_stage is not null)
    or (state not in ('needs_input', 'paused_budget') and interrupted_stage is null)
  ),
  -- Acceptance is recorded whole or not at all.
  constraint draft_sets_acceptance_pair check (
    (accepted_by is null and accepted_at is null)
    or (accepted_by is not null and accepted_at is not null)
  ),
  -- THE DELIVERY GATE, at the database level: a set cannot be marked ready
  -- for review without a second-pass version, a figure set, and a passing
  -- reconciliation. This is the same rule the shared delivery gate applies
  -- in application code; having it here too means no code path — including
  -- a future one — can write a deliverable-looking row that is not one.
  constraint draft_sets_ready_requires_pass_2 check (
    state <> 'ready_for_review'
    or (pass_2_version_id is not null and figure_set_id is not null and reconciled)
  ),
  -- Acceptance is only meaningful on a set that reached ready_for_review.
  constraint draft_sets_accept_requires_ready check (
    accepted_by is null or state = 'ready_for_review'
  )
);
create index on public.draft_sets (organization_id, invention_id);
create index on public.draft_sets (organization_id, state);
create unique index draft_sets_one_active_per_invention
  on public.draft_sets (invention_id)
  where state not in ('ready_for_review', 'failed');

comment on column public.draft_sets.illustrations_brief is
  'The Pass-1 illustrations brief: ordered figure list, view types, what each figure must show, parts per figure, and the reference-numeral assignments. Pass 1 authors this; the figure planner CONSUMES it rather than inventing numerals.';
comment on constraint draft_sets_ready_requires_pass_2 on public.draft_sets is
  'The client delivery gate in the schema: ready_for_review requires a second-pass version, a figure set, and a passing two-way 608.02 reconciliation. A Pass-1-only package can never be stored as ready.';

-- ---------------------------------------------------------------------------
-- draft_set_transitions: append-only audit of every state change.
-- ---------------------------------------------------------------------------
create table public.draft_set_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  draft_set_id uuid not null references public.draft_sets (id) on delete cascade,
  from_state public.draft_pass_state,
  to_state public.draft_pass_state not null,
  -- 'system' for an automatic chain step, or the acting user's id.
  actor text not null default 'system',
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index on public.draft_set_transitions (organization_id, draft_set_id);
create index on public.draft_set_transitions (draft_set_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The figure set now knows which draft set and brief it was built from.
-- ---------------------------------------------------------------------------
alter table public.figure_sets
  add column draft_set_id uuid references public.draft_sets (id) on delete set null;
alter table public.figure_sets
  add column built_from_brief boolean not null default false;
create index on public.figure_sets (organization_id, draft_set_id);

comment on column public.figure_sets.built_from_brief is
  'True when this set was planned from a Pass-1 illustrations brief rather than from ad-hoc planning. The planner consumes brief numerals; it never invents them for a brief-driven set.';

-- ---------------------------------------------------------------------------
-- Draft versions record which pass produced them.
-- ---------------------------------------------------------------------------
alter table public.draft_versions
  add column draft_pass integer check (draft_pass in (1, 2));
alter table public.draft_versions
  add column draft_set_id uuid references public.draft_sets (id) on delete set null;
create index on public.draft_versions (organization_id, draft_set_id);

comment on column public.draft_versions.draft_pass is
  '1 = first-pass draft with the illustrations brief; 2 = enablement revision against the produced figures. Null on pre-2026-08-04 single-shot versions.';

-- ---------------------------------------------------------------------------
-- Job kinds for the two passes (reusing app_jobs, house pattern from 0012).
-- ---------------------------------------------------------------------------
alter table public.app_jobs drop constraint app_jobs_kind_check;
alter table public.app_jobs add constraint app_jobs_kind_check
  check (kind in (
    'generation', 'source_scan', 'source_extraction', 'export_render',
    'source_interpretation', 'distillation',
    'figure_plan', 'figure_generate', 'figure_compose', 'figure_validate',
    'draft_pass_1', 'draft_pass_2'
  ));

-- ---------------------------------------------------------------------------
-- Exports may only reference a delivered (accepted) draft set.
-- ---------------------------------------------------------------------------
alter table public.exports
  add column draft_set_id uuid references public.draft_sets (id) on delete set null;
create index on public.exports (organization_id, draft_set_id);

-- ---------------------------------------------------------------------------
-- RLS: member-select; all writes via trusted server logic (service role).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['draft_sets', 'draft_set_transitions']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select using (organization_id in (select app.user_org_ids()));',
      t || '_member_select', t
    );
  end loop;
end $$;

-- The transition log is evidence: append-only from application roles.
create trigger draft_set_transitions_immutable
  before update or delete on public.draft_set_transitions
  for each row execute function app.reject_mutation();
