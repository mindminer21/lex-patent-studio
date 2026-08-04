-- Lex Patent Studio — private application project
-- Migration 0007: three-pass patent drafting (Jeff's directive, 2026-08-04).
--
--   PASS_1_DRAFTING -> FIGURES_PENDING -> FIGURES_READY -> PASS_2_REVISING
--                   -> READY_FOR_REVIEW  (+ NEEDS_INPUT / PAUSED_BUDGET / FAILED)
--
-- THE SAME FLOW AS wepatent, and deliberately the same schema: the state
-- machine, the illustrations-brief shape, the numeral registry and the
-- reconciliation report are shared code (src/lib/shared/drafting/), so the
-- tables they persist into must not drift apart between the two projects.
-- The differences that DO exist are Lex's: a draft set hangs off a matter
-- rather than an invention, and carries the work tier and the review item it
-- produced, because a Lex draft is Tier B work that enters the review queue.
--
-- Additive only. Nothing existing is dropped.

create type draft_pass_state as enum (
  'pass_1_drafting',
  'figures_pending',
  'figures_ready',
  'pass_2_revising',
  'ready_for_review',
  'needs_input',
  'paused_budget',
  'failed'
);

create type draft_pass_stage as enum (
  'pass_1_drafting', 'figures_pending', 'figures_ready', 'pass_2_revising'
);

-- ---------------------------------------------------------------------------
-- draft_sets: one three-pass run over a matter.
-- ---------------------------------------------------------------------------
create table draft_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  matter_id uuid not null references matters (id) on delete cascade,

  state draft_pass_state not null default 'pass_1_drafting',
  interrupted_stage draft_pass_stage,

  -- Tier B — draft for review (PRD-lex §5.3). The three-pass flow does not
  -- change the tier: drafting is substantive work product and the
  -- responsible practitioner reviews and edits before any downstream use.
  -- The floor may be promoted, never demoted (Invariant 15).
  tier work_tier not null default 'B',

  -- Both versions stay inspectable; Pass 2 is never an in-place mutation.
  pass_1_document_version_id uuid references document_versions (id) on delete set null,
  pass_2_document_version_id uuid references document_versions (id) on delete set null,
  -- The run that produced this set, for the stage/checkpoint trail.
  run_id uuid references workflow_runs (id) on delete set null,
  -- The review item this set produced on reaching ready_for_review.
  review_item_id uuid references review_items (id) on delete set null,

  -- THE ILLUSTRATIONS BRIEF, authored in Pass 1: ordered figure list, view
  -- types, what each figure must show, parts per figure, and the reference
  -- numeral assignments. Validated against the shared zod schema before it
  -- is written.
  illustrations_brief jsonb not null default '{}'::jsonb,
  brief_version text not null default '',

  -- The two-way 37 CFR 1.84(p)(5) / MPEP 608.02(g) result. `reconciled` is
  -- the GATE on reaching ready_for_review.
  reconciliation jsonb,
  reconciled boolean not null default false,
  reconciliation_version text not null default '',

  -- Verbatim, practitioner-facing reason the run paused or failed.
  status_detail text not null default '',

  -- Human acceptance. The platform can never write these.
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,

  pass_1_charge_usd numeric(12, 2) not null default 0 check (pass_1_charge_usd >= 0),
  pass_2_charge_usd numeric(12, 2) not null default 0 check (pass_2_charge_usd >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint draft_sets_interruption_stage check (
    (state in ('needs_input', 'paused_budget') and interrupted_stage is not null)
    or (state not in ('needs_input', 'paused_budget') and interrupted_stage is null)
  ),
  constraint draft_sets_acceptance_pair check (
    (accepted_by is null and accepted_at is null)
    or (accepted_by is not null and accepted_at is not null)
  ),
  -- THE DELIVERY GATE, at the database level. Identical in substance to the
  -- wepatent constraint: ready_for_review requires a second-pass version and
  -- a passing two-way reconciliation. A Pass-1-only package can never be
  -- stored as ready in either product.
  constraint draft_sets_ready_requires_pass_2 check (
    state <> 'ready_for_review'
    or (pass_2_document_version_id is not null and reconciled)
  ),
  constraint draft_sets_accept_requires_ready check (
    accepted_by is null or state = 'ready_for_review'
  ),
  -- Tier B is the floor for drafting; promotion to C is allowed, demotion
  -- to A is not (Invariant 15).
  constraint draft_sets_tier_floor check (tier in ('B', 'C'))
);
create index on draft_sets (organization_id, matter_id);
create index on draft_sets (organization_id, state);
create unique index draft_sets_one_active_per_matter
  on draft_sets (matter_id)
  where state not in ('ready_for_review', 'failed');

comment on column draft_sets.illustrations_brief is
  'The Pass-1 illustrations brief: ordered figure list, view types, what each figure must show, parts per figure, and the reference-numeral assignments. Pass 1 authors this; the figure planner CONSUMES it rather than inventing numerals. Same shape as wepatent (shared code).';
comment on constraint draft_sets_ready_requires_pass_2 on draft_sets is
  'The client delivery gate in the schema: ready_for_review requires a second-pass document version and a passing two-way 608.02 reconciliation.';

-- ---------------------------------------------------------------------------
-- draft_set_transitions: append-only audit of every state change.
-- ---------------------------------------------------------------------------
create table draft_set_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  draft_set_id uuid not null references draft_sets (id) on delete cascade,
  from_state draft_pass_state,
  to_state draft_pass_state not null,
  actor text not null default 'system',
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index on draft_set_transitions (organization_id, draft_set_id);
create index on draft_set_transitions (draft_set_id, created_at desc);

-- ---------------------------------------------------------------------------
-- A document version records which pass produced it.
-- ---------------------------------------------------------------------------
alter table document_versions
  add column draft_pass integer check (draft_pass in (1, 2));
alter table document_versions
  add column draft_set_id uuid references draft_sets (id) on delete set null;

comment on column document_versions.draft_pass is
  '1 = first-pass draft with the illustrations brief; 2 = enablement revision against the produced figures. Null on pre-2026-08-04 single-shot versions.';

-- Exports link the accepted draft set they delivered.
alter table exports
  add column draft_set_id uuid references draft_sets (id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS: member + matter-ACL select; all writes via trusted server logic.
-- ---------------------------------------------------------------------------
alter table draft_sets enable row level security;
alter table draft_set_transitions enable row level security;

create policy draft_sets_select on draft_sets
  for select to authenticated
  using (app_is_org_member(organization_id) and app_can_view_matter(organization_id, matter_id));

create policy draft_set_transitions_select on draft_set_transitions
  for select to authenticated
  using (app_is_org_member(organization_id));

-- The transition log is evidence: append-only from application roles.
create trigger draft_set_transitions_immutable
  before update or delete on draft_set_transitions
  for each row execute function app_forbid_mutation();
