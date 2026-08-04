-- Automatic MPEP-compliant patent figures (spec §4).
--
-- Additive only. Nothing existing is dropped; the only modified objects are
-- CHECK constraints extended with new allowed values (house pattern from
-- 0009/0010/0011) and the usage_events markup check, which becomes
-- multiplier-aware so image generation can bill at 2.0x while every existing
-- row (all 1.50x) continues to satisfy it byte-identically.
--
-- Every table carries organization_id + RLS, member-select and
-- service-role-write, with append-only evidence tables guarded by the
-- existing app.reject_mutation() trigger.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.figure_set_state as enum (
  'planning', 'generating', 'composing', 'validating', 'ready',
  'needs_input', 'paused_budget', 'failed'
);

create type public.figure_state as enum (
  'planned', 'generated', 'composed', 'ready', 'needs_input',
  'needs_human_review', 'failed'
);

create type public.figure_view_type as enum (
  'perspective', 'plan', 'elevation', 'section', 'partial', 'detail',
  'exploded', 'block_diagram', 'flowchart', 'waveform', 'formula',
  'design_orthographic'
);

create type public.figure_source_kind as enum (
  'generated_line_art', 'deterministic_diagram', 'from_uploaded_model',
  'from_uploaded_image'
);

-- AI-derived artifacts are ai_proposed until a human acts (invariant 1).
-- There is deliberately no value the platform can set to mean "approved".
create type public.figure_ai_state as enum (
  'ai_proposed', 'user_confirmed', 'user_edited'
);

create type public.figure_validation_status as enum (
  'pass', 'fail', 'not_applicable', 'needs_human_review'
);

-- ---------------------------------------------------------------------------
-- figure_sets: one per draft version.
-- ---------------------------------------------------------------------------
create table public.figure_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  draft_version_id uuid references public.draft_versions (id) on delete cascade,
  state public.figure_set_state not null default 'planning',
  sheet_size text not null default 'a4' check (sheet_size in ('a4', 'letter')),
  orientation_policy text not null default 'portrait_preferred'
    check (orientation_policy in ('portrait_preferred', 'landscape_allowed')),
  -- Provenance: which rule set, planner, composer, and model produced this.
  rules_version text not null,
  planner_version text not null default '',
  composer_version text not null default '',
  model_id text,
  prompt_template_version text,
  -- Content hash of every planner input. Regenerating an unchanged draft is
  -- a no-op: the pipeline compares this before spending anything.
  input_hash text not null default '',
  -- Customer-charge cents for the whole run (already marked up).
  total_cost_cents integer not null default 0 check (total_cost_cents >= 0),
  -- Provider cost before markup, for the cost-model audit trail.
  total_provider_cost_cents integer not null default 0
    check (total_provider_cost_cents >= 0),
  ai_state public.figure_ai_state not null default 'ai_proposed',
  -- Honest failure/pause reason surfaced to the user verbatim.
  status_detail text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.figure_sets (organization_id, invention_id);
create index on public.figure_sets (organization_id, draft_version_id);

-- ---------------------------------------------------------------------------
-- figures: one per view.
-- ---------------------------------------------------------------------------
create table public.figures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  figure_set_id uuid not null references public.figure_sets (id) on delete cascade,
  figure_number integer not null check (figure_number >= 1),
  -- 37 CFR 1.84(u)(2): partial views share a number plus a capital letter.
  partial_suffix text check (partial_suffix ~ '^[A-Z]$'),
  view_type public.figure_view_type not null,
  title text not null default '',
  is_prior_art boolean not null default false,
  -- Provenance back to the component / ps_pair / method step depicted.
  subject_ref text not null default '',
  source_kind public.figure_source_kind not null,
  -- The exact Layer-1 prompt used, when one was.
  generation_prompt text,
  brief_description text not null default '',
  -- Which view this is a section of (37 CFR 1.84(h)(2)).
  section_of integer,
  state public.figure_state not null default 'planned',
  -- Populated when state = needs_input: the targeted question we ask
  -- instead of inventing geometry (spec §8).
  needs_input_question text,
  needs_input_missing text,
  ai_state public.figure_ai_state not null default 'ai_proposed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (figure_set_id, figure_number, partial_suffix)
);
create index on public.figures (organization_id, figure_set_id);

-- ---------------------------------------------------------------------------
-- figure_reference_numerals: THE registry.
--
-- This table is the single source of truth that makes 37 CFR 1.84(p)(4)
-- cross-view consistency mechanical: unique on (set, numeral) means one
-- numeral can never designate two parts, and unique on (set, part_label)
-- means one part can never carry two numerals. Views store only the numeral,
-- so renaming a part updates every view at once.
-- ---------------------------------------------------------------------------
create table public.figure_reference_numerals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  figure_set_id uuid not null references public.figure_sets (id) on delete cascade,
  -- Arabic numeral with an optional single capital suffix: 10, 12, 16A.
  -- Never bracketed, circled, or primed (37 CFR 1.84(p)(1)).
  numeral text not null check (numeral ~ '^[1-9][0-9]*[A-Z]?$'),
  part_label text not null check (length(btrim(part_label)) > 0),
  component_id uuid references public.components (id) on delete set null,
  first_assigned_figure_id uuid references public.figures (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (figure_set_id, numeral),
  unique (figure_set_id, part_label)
);
create index on public.figure_reference_numerals (organization_id, figure_set_id);

-- ---------------------------------------------------------------------------
-- figure_annotations: per-figure placements of a reference character.
-- ---------------------------------------------------------------------------
create table public.figure_annotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  figure_id uuid not null references public.figures (id) on delete cascade,
  numeral text not null check (numeral ~ '^[1-9][0-9]*[A-Z]?$'),
  -- Normalized 0..1 coordinates within the figure's art box.
  anchor_x numeric not null check (anchor_x >= 0 and anchor_x <= 1),
  anchor_y numeric not null check (anchor_y >= 0 and anchor_y <= 1),
  label_x numeric not null check (label_x >= 0 and label_x <= 1),
  label_y numeric not null check (label_y >= 0 and label_y <= 1),
  -- Polyline from the character to (but not touching) the feature.
  lead_line_path jsonb not null default '[]'::jsonb,
  -- 37 CFR 1.84(q): a character on the surface it designates is underlined
  -- instead of carrying a lead line.
  underlined boolean not null default false,
  placed_by text not null default 'auto' check (placed_by in ('auto', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (figure_id, numeral)
);
create index on public.figure_annotations (organization_id, figure_id);

-- ---------------------------------------------------------------------------
-- figure_sheets: composed drawing sheets.
-- ---------------------------------------------------------------------------
create table public.figure_sheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  figure_set_id uuid not null references public.figure_sets (id) on delete cascade,
  sheet_number integer not null check (sheet_number >= 1),
  total_sheets integer not null check (total_sheets >= 1),
  orientation text not null default 'portrait'
    check (orientation in ('portrait', 'landscape')),
  content_type text not null default 'image/svg+xml',
  storage_path text not null,
  checksum_sha256 text not null,
  byte_size bigint not null default 0 check (byte_size >= 0),
  created_at timestamptz not null default now(),
  unique (figure_set_id, sheet_number),
  constraint figure_sheets_number_within_total check (sheet_number <= total_sheets)
);
create index on public.figure_sheets (organization_id, figure_set_id);

-- ---------------------------------------------------------------------------
-- figure_validations: append-only evidence of every rule run.
--
-- Append-only on purpose: a validation result is evidence about a specific
-- composed output at a specific rules version. Amending one would destroy
-- the record of what we actually told the customer.
-- ---------------------------------------------------------------------------
create table public.figure_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  figure_set_id uuid not null references public.figure_sets (id) on delete cascade,
  figure_id uuid references public.figures (id) on delete cascade,
  rule_id text not null,
  status public.figure_validation_status not null,
  detail text not null default '',
  rules_version text not null,
  created_at timestamptz not null default now()
);
create index on public.figure_validations (organization_id, figure_set_id);
create index on public.figure_validations (figure_set_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Job kinds for the four pipeline stages (reusing app_jobs, per spec §4).
-- ---------------------------------------------------------------------------
alter table public.app_jobs drop constraint app_jobs_kind_check;
alter table public.app_jobs add constraint app_jobs_kind_check
  check (kind in (
    'generation', 'source_scan', 'source_extraction', 'export_render',
    'source_interpretation', 'distillation',
    'figure_plan', 'figure_generate', 'figure_compose', 'figure_validate'
  ));

-- ---------------------------------------------------------------------------
-- Exports carry the drawing sheets along with the manifest/checksum
-- semantics that already exist (spec §4).
-- ---------------------------------------------------------------------------
alter table public.exports
  add column figure_set_id uuid references public.figure_sets (id) on delete set null;
create index on public.exports (organization_id, figure_set_id);

-- ---------------------------------------------------------------------------
-- Per-entry retail markup (FR-6, Jeff's directive 2026-08-04).
--
-- usage_events previously hard-coded ceil(provider_cost * 1.5). Image
-- generation bills at 2.0, so the multiplier becomes a recorded column in
-- BASIS POINTS (15000 = 1.50, 20000 = 2.00) and the check is rewritten
-- against it. The default backfills every existing row at 15000, which
-- makes the new check identical to the old one for all historical data.
-- ---------------------------------------------------------------------------
alter table public.usage_events
  add column markup_multiplier_bp integer not null default 15000
    check (markup_multiplier_bp > 0);

comment on column public.usage_events.markup_multiplier_bp is
  'Retail multiplier applied to provider cost, in basis points. 15000 = 1.50x (text, transcription); 20000 = 2.00x (image generation). Recorded per event so a settled charge can always be re-derived.';

alter table public.usage_events drop constraint usage_events_markup;
alter table public.usage_events add constraint usage_events_markup check (
  customer_charge_cents
    = ceil(provider_cost_cents * markup_multiplier_bp / 10000.0)::integer
);

-- Reservations record the multiplier they were priced at, so settlement
-- cannot silently apply a different one than the estimate showed.
alter table public.usage_reservations
  add column markup_multiplier_bp integer not null default 15000
    check (markup_multiplier_bp > 0);

-- ---------------------------------------------------------------------------
-- RLS: member-select; all writes via trusted server logic (service role).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'figure_sets', 'figures', 'figure_reference_numerals',
    'figure_annotations', 'figure_sheets', 'figure_validations'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select using (organization_id in (select app.user_org_ids()));',
      t || '_member_select', t
    );
  end loop;
end $$;

-- Validation results are evidence: append-only from application roles.
create trigger figure_validations_immutable
  before update or delete on public.figure_validations
  for each row execute function app.reject_mutation();

-- Composed sheets are content-addressed artifacts: append-only, like
-- export_artifacts. Replacing a sheet writes a new figure set.
create trigger figure_sheets_immutable
  before update or delete on public.figure_sheets
  for each row execute function app.reject_mutation();
