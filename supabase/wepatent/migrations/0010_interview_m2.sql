-- Intake Studio M2 (feature PRD §6, §13 M2): adaptive interview engine
-- columns + 3D hardening artifact type. Additive only — no existing rows
-- or policies change; the interview_sessions/interview_turns tables and
-- their RLS landed in 0009.

-- ---------------------------------------------------------------------------
-- Interview sessions: running settled spend for the session cap (FR-INT-10).
-- Maintained by trusted server logic only (no client write path exists).
-- ---------------------------------------------------------------------------
alter table public.interview_sessions
  add column spent_cents integer not null default 0 check (spent_cents >= 0);

-- Default cap: $5.00 (feature PRD §15.3 default; env-configurable in-app).
alter table public.interview_sessions
  alter column session_spend_cap_cents set default 500;

-- ---------------------------------------------------------------------------
-- Interview turns: engine stage, answer kind, grouped follow-ups (§6.1/6.2).
-- answer_kind is null while the question is pending; 'advice_referral'
-- records a turn answered by the FIXED counsel-referral template (§6.4).
-- ---------------------------------------------------------------------------
alter table public.interview_turns
  add column stage text not null default 'context_field',
  add column answer_kind text
    check (answer_kind in ('answer', 'skip', 'unknown', 'advice_referral')),
  add column followups jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 3D hardening (M2): a clean pure-code STL parse produces a deterministic
-- geometry summary artifact — a first-class NON-MODEL interpretation.
-- ---------------------------------------------------------------------------
alter table public.extraction_artifacts drop constraint extraction_artifacts_type_check;
alter table public.extraction_artifacts add constraint extraction_artifacts_type_check
  check (type in ('interpretation_summary', 'text_excerpt', 'status_note', 'geometry_summary'));
