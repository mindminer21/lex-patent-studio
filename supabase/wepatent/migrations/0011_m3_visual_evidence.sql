-- Intake Studio M3 (feature PRD §7, §13 M3): visual associations (region
-- anchors + interview-turn evidence), derived 3D snapshot linkage, A/V
-- ingestion (transcript artifacts), and ledger polish event kinds
-- (merge/split, proposed-edit dismissal). Additive only — no existing rows
-- change; the only modified objects are two CHECK constraints extended with
-- new allowed values (house pattern from 0009/0010).

-- ---------------------------------------------------------------------------
-- Associations gain the full evidence shape of feature PRD §8:
--   solution → component | extraction artifact | file-region anchor |
--   interview turn. `region` is a normalized rectangle
--   {"page": int|null, "x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1,
--    "view": text|null} drawn on the source viewer (FR-INT-9).
-- `created_by_actor` records whether the anchor was AI-proposed (state
-- ai_proposed until a human confirms/redraws — invariant 13) or user-drawn.
-- ---------------------------------------------------------------------------
alter table public.associations
  add column source_id uuid references public.private_sources (id) on delete cascade,
  add column region jsonb,
  add column interview_turn_id uuid references public.interview_turns (id) on delete cascade,
  add column created_by_actor text not null default 'model'
    check (created_by_actor in ('user', 'model'));

-- An association must point at SOME evidence; region anchors require the
-- source they were drawn on.
alter table public.associations drop constraint associations_have_evidence;
alter table public.associations add constraint associations_have_evidence
  check (
    component_id is not null
    or extraction_artifact_id is not null
    or source_id is not null
    or interview_turn_id is not null
  );
alter table public.associations add constraint associations_region_needs_source
  check (region is null or source_id is not null);

create index on public.associations (organization_id, source_id);

-- ---------------------------------------------------------------------------
-- Derived 3D snapshot views (M3 render-to-vision): the browser captures
-- canonical views of a 3D model and uploads them as ordinary image sources
-- through the unchanged FR-4 pipeline; this column links each derived image
-- to its parent 3D source so provenance survives into the counsel package.
-- ---------------------------------------------------------------------------
alter table public.private_sources
  add column derived_from_source_id uuid
    references public.private_sources (id) on delete set null;

-- ---------------------------------------------------------------------------
-- A/V ingestion (feature PRD §5.1 Phase 2): audio transcription produces a
-- `transcript` extraction artifact (model + cost provenance recorded like
-- every interpretation output). Spoken content is EVIDENCE, never
-- instructions (invariant 16).
-- ---------------------------------------------------------------------------
alter table public.extraction_artifacts drop constraint extraction_artifacts_type_check;
alter table public.extraction_artifacts add constraint extraction_artifacts_type_check
  check (type in (
    'interpretation_summary', 'text_excerpt', 'status_note', 'geometry_summary',
    'transcript'
  ));

-- ---------------------------------------------------------------------------
-- Ledger polish (feature PRD §5.4): merge/split of P/S items and explicit
-- dismissal of AI proposed-edits are recorded in the append-only event log.
-- ---------------------------------------------------------------------------
alter table public.ps_events drop constraint ps_events_kind_check;
alter table public.ps_events add constraint ps_events_kind_check
  check (kind in (
    'proposed', 'confirmed', 'edited', 'deleted', 'ai_proposal_rejected',
    'linked', 'unlinked', 'title_proposed', 'title_edited', 'title_confirmed',
    'merged', 'split', 'proposal_dismissed'
  ));
