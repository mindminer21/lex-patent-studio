# wepatent Invention Intake Studio PRD

**Status:** Implementation source of truth (feature PRD)
**Version:** 1.0
**Date:** August 2, 2026
**Parent document:** `PRD-wepatent.md` (this PRD extends §7.3 Invention intake, FR-4 Source management, FR-5 Model gateway; every parent invariant applies unchanged)
**Feature name:** Invention Intake Studio — multi-modal upload interpretation + adaptive Slusky-guided invention interview
**Entry surface:** wepatent authenticated dashboard (`/wepatent/app`)

## 1. Objective

Replace the current linear 8-stage intake with an intake studio that gets an inventor from "I have files and a head full of context" to a **counsel-ready, enablement-grade invention disclosure** with dramatically less friction. Two composable paths from one entry point:

1. **Upload anything** — documents, images, schematics, photos, 3D models, presentations, spreadsheets — and have AI interpret them into a structured starting point.
2. **Adaptive invention interview** — a Slusky-methodology question flow that moves from general to specific, adapts to prior answers, and accepts text answers with optional file attachments per answer.

Both paths feed one shared artifact: a living **Problem/Solution ledger** (problems the invention solves; solutions expressing the inventive concept) plus an AI-proposed **working title** — all fully editable by the user, with every AI-generated item clearly labeled as a proposal until the user confirms it.

**North star:** the completed record contains enough WHAT (concept) and HOW (implementation: structure, operation, alternatives, parameters) that qualified counsel could translate it into a patent specification's detailed description satisfying 35 U.S.C. § 112(a) enablement and written-description support — while the product itself never drafts claims, gives legal conclusions, or advises strategy (parent invariants; `legal-ethics-risk-memo.md`).

### Success definition

A user can start from the dashboard, drop in a disclosure memo PDF + three photos + a STEP file, receive an interpreted problem/solution breakdown and working title within minutes, refine it, answer an adaptive interview that visibly fills enablement gaps, watch the P/S ledger grow with each answer, see each solution visually associated with the components/figures that embody it, and export a counsel package — with pre-run cost shown for every AI step and every AI output labeled as an unconfirmed proposal until the user acts on it.

## 2. Naming and boundary note (decision required)

The requested button label is **"New Patent."** That label conflicts with the parent PRD's positioning rules: wepatent must never imply it produces patents or files anything (§3, §5.2; ethics memo §1 — function and user expectation matter more than disclaimers). A record in this product is an invention disclosure, not a patent.

**Recommendation:** primary button **"New invention"** with subtitle "Start a patent-ready disclosure," or **"Start invention record."** If Jeff, exercising his own professional judgment as the approving attorney, directs "New Patent" anyway, it ships behind his recorded approval (parent §17.3 treats customer-facing legal claims as approval-gated). This PRD uses "New invention" throughout; the label is a one-line change.

## 3. Additional invariants (on top of parent §5)

13. Every AI-derived artifact (problem, solution, title, extraction, association, interview summary) carries state `ai_proposed` until a human confirms, edits, or deletes it; AI can never set a confirmed state (extends parent invariant 9).
14. Interview questions gather facts about the user's invention. The engine never recommends claim scope, filing strategy, disclosure decisions, or patentability conclusions, and never answers "should I…" questions except by referring to counsel (UPL boundary; ethics memo §1).
15. Slusky methodology is embedded as internally-authored heuristics (question ordering, WHAT/HOW separation, problem-solution framing). No text from "Invention Analysis and Claiming" or any licensed work is reproduced in prompts, UI copy, or outputs (license boundary — the commercial corpus already excludes this content).
16. Uploaded files are evidence, never instructions (parent §11 prompt-injection rule applies to every interpretation pass).
17. Interpretation, distillation, and interview turns are metered AI runs: estimate → reservation → run → settlement, per parent §7.4. No hidden spend.
18. All uploads route through the FR-4 pipeline (signed upload, type validation, malware scan, quarantine) regardless of file type breadth; interpretation only touches files that cleared quarantine.
19. Technology-category screening (export-control posture) runs at record creation; flagged categories halt AI interpretation pending review, per Lex PRD §13 pattern.

## 4. Entry point and flow architecture

### 4.1 Dashboard entry

- Primary action button on `/wepatent/app` (replaces/augments "New invention record").
- Clicking opens a **path chooser**: **(A) Upload files** · **(B) Answer questions about your invention** — presented as composable ("You can do both — most complete records use both"), not exclusive. Either path creates the invention record on first commit and lands the user in the Intake Studio for that record.

### 4.2 Intake Studio layout (`/wepatent/app/inventions/[id]/studio`)

Three-region responsive workspace:

- **Left — Sources & components:** uploaded files with interpretation status; extracted component inventory (named parts/subsystems with thumbnails or schematic crops where available).
- **Center — Active work surface:** upload dropzone / interview conversation / distillation review, depending on mode.
- **Right — Problem/Solution ledger (always visible):** running list of problem–solution pairs, each with state badge (`ai_proposed` / `user_confirmed` / `user_edited`), working title card at top, enablement coverage meter (§6.5), and per-item source links. Collapsible on mobile to a summary bar; full ledger one tap away (parent §12 responsive requirements apply).

The existing 8-stage intake remains available as "Guided form intake" for users who prefer it; both write to the same fact ledger and P/S ledger (no forked data model).

## 5. Path A — Upload and interpretation

### 5.1 Accepted files

Accept broadly; interpret by capability class:

| Class | Examples | Interpretation |
|---|---|---|
| Text documents | PDF, DOCX, TXT, MD, PPTX, XLSX | Text + structure extraction; OCR fallback for scanned PDFs |
| Images | PNG, JPEG, HEIC, TIFF, SVG | Vision-model description: components, annotations, reference numerals, schematic reading |
| 3D models | STL, STEP, OBJ, 3MF, IGES | Server-side render to multi-angle 2D views (headless renderer worker) → vision-model interpretation of geometry/assemblies; raw file retained for counsel package |
| CAD/EDA (best-effort) | DXF, DWG, Gerber, KiCad | Convert where an open parser exists; else stored + flagged "stored, not auto-interpreted" |
| A/V (Phase 2) | MP4, MOV, M4A, WAV | Transcription (audio); keyframe extraction + vision (video) |
| Anything else | ZIP (expanded, members re-validated), unknown types | Stored, flagged "stored, not auto-interpreted," user prompted to describe contents |

Rules: per-file and per-record size caps (default 100 MB / 1 GB, config); FR-4 validation pipeline for all classes (extend MIME/magic-byte allowlist to the new types); "stored, not interpreted" is an honest first-class status — never silently skip; every interpretation output records model, version, timestamp, and cost.

### 5.2 Interpretation pipeline (async jobs, parent FR-7 job runner)

Per file: `UPLOADED → SCANNED → CONVERTING (renders/OCR/transcodes) → INTERPRETING (model pass) → INTERPRETED | STORED_UNINTERPRETED | FAILED`, with per-stage checkpoints, cost caps, and UI progress per file. Outputs per file:

- `extraction_artifacts`: normalized text, per-page/region coordinates, rendered views (3D), thumbnails.
- `component_candidates`: named components/subsystems with source anchors (file + page/region/view).
- Candidate contributions to distillation (5.3).

### 5.3 Distillation (record-level model pass)

After any interpretation batch completes (and re-runnable on demand — "Re-distill with new material"):

1. Synthesize across all interpreted sources + any existing interview answers/facts.
2. Produce: **working title** (proposal), **problem list** (problems the invention solves, including subsidiary problems solved by specific features), **solution list** (inventive-concept statements, WHAT-level, each linked to its supporting sources and HOW-level component evidence), and **problem↔solution pairings** (many-to-many allowed).
3. Everything lands in the P/S ledger as `ai_proposed`, each item citing its source anchors.
4. Distillation prompt policy embeds the Slusky-derived heuristics: state solutions as concepts not embodiments; separate WHAT from HOW; frame problems from the prior situation's deficiency; flag apparent multi-invention records ("this may contain more than one independent inventive concept") as an observation, never as filing advice.

### 5.4 P/S ledger interactions

- Add, edit, delete, merge, and split problems and solutions; re-pair freely. Every mutation is a fact-ledger event with actor + timestamp (parent FR-3 provenance model; new provenance states in §8).
- Confirming an `ai_proposed` item flips it to `user_confirmed`; editing to `user_edited`. Deleting an AI proposal records a rejection event (signal for question adaptation).
- Working title is editable text with proposal history.
- Each solution shows its **evidence chips**: linked components, file regions, interview answers. Clicking a chip opens the source at the anchor (page, image region, 3D render view).

## 6. Path B — Adaptive invention interview

### 6.1 Interaction model

Chat-style, one primary question at a time (with optional skippable follow-ups grouped beneath). Each turn accepts: **text**, **text + file attachment(s)** (attachments run the 5.1–5.2 pipeline and their interpretations join the record), or **"skip / not applicable / I don't know"** (recorded — unknowns are enablement signals, not failures). Users can pause/resume anytime (session state persists); a progress indicator shows interview stage and coverage, not a fake percent.

### 6.2 Question engine (Slusky-guided, general → specific)

Staged plan, adapted by what is already known (from uploads, prior answers, and existing facts — the engine never re-asks what a confirmed fact already answers):

1. **Context & field** — what area, who uses it, what exists today.
2. **The problem** — what deficiency prompted the work; consequences; who suffers it; prior attempts and why inadequate.
3. **The solution as concept (WHAT)** — the core insight, phrased as concept; the "problem of X is solved by Y" articulation; what departs from the prior approaches.
4. **Implementation (HOW)** — structure/components, operation/steps, interconnections; parameters, materials, ranges; the preferred embodiment walked end-to-end ("could a colleague build this from your answers?").
5. **Alternatives & breadth** — other ways to implement each solution element; substitutable components; the far-fetched-alternative probe to expose concept breadth; what is optional vs. essential.
6. **Subsidiary problems** — problems each notable feature solves (planned-retreat evidence, gathered as facts).
7. **Boundaries & completeness** — failure modes, operating limits, results/measurements available, terminology the inventor uses consistently.

Adaptation policy (deterministic layer around the model): every candidate question is generated with a machine-readable target (`ps_pair_id` or enablement dimension per §6.5); the engine picks the highest-value unfilled target, most-general-first within a stage; stage advance requires that stage's minimum coverage or explicit user skip; a per-turn model pass drafts the natural-language question and immediate follow-ups, but stage sequence, no-repeat, no-advice, and coverage accounting are code, not model discretion. Rejected AI proposals steer questioning away from rejected framings.

### 6.3 Live extraction into the ledger

After each answer: an extraction pass (Fast tier) updates the P/S ledger and fact ledger — new problems/solutions as `ai_proposed`, refinements as proposed edits (never silent mutation of confirmed items), new components into the component inventory, and enablement coverage updates. The ledger animates updates in the right panel so the user watches the disclosure assemble as they talk.

### 6.4 Interview compliance rails

Fixed header disclaimer on the interview surface ("wepatent collects facts about your invention; it does not give legal advice"). The engine's refusal behavior for advice-seeking user turns ("should I file?", "is this patentable?") is a fixed template pointing at counsel and, where relevant, the Meet-Counsel pathway — never a model-generated opinion. All parent clickwrap gates precede the first turn.

### 6.5 Enablement coverage model

A deterministic checklist derived from § 112(a) support needs, computed per solution: problem articulated · concept (WHAT) stated · at least one complete embodiment (HOW): structure + operation · alternatives captured · parameters/ranges where the field needs them · how-to-use captured · terminology consistent. Displayed as the ledger's coverage meter with per-solution gap chips ("No operating parameters captured for Solution 2 — the interview will ask"). Labeled as **coverage of the record**, never as a legal sufficiency opinion; export includes the coverage report with the same caveat.

## 7. Solution ↔ component visual association

- Association objects link a solution to: component(s), file region anchors (page/bbox for docs and images, view+region for 3D renders), and/or interview answers. AI proposes associations during distillation/extraction (`ai_proposed`); users confirm, redraw (drag-select region on the source viewer), add, or delete.
- Solution detail view renders its evidence gallery: schematic crops, photo regions, 3D views, quoted text snippets — the visual map from inventive concept to embodying structure.
- Associations flow into the counsel-ready export (parent §7.5): each solution section lists its evidence with anchors; the export manifest locks the artifact versions.

## 8. Data model additions (private project; all rows carry `organization_id`, RLS per parent)

- `ps_pairs` (id, invention_id, kind `problem|solution`, statement, state `ai_proposed|user_confirmed|user_edited`, origin `upload_distillation|interview|manual`, created_by_actor, timestamps)
- `ps_links` (problem_id ↔ solution_id, state)
- `ps_events` (append-only mutation log incl. AI-proposal rejections)
- `working_titles` (invention_id, text, state, proposal history)
- `components` (invention_id, name, description, source anchors)
- `associations` (solution_id → component_id | extraction_anchor | interview_turn_id, state)
- `extraction_artifacts` (source_id, type, content ref, page/region/view coordinates, model, cost ref)
- `interview_sessions` / `interview_turns` (session state, stage, question, target ref, answer text, attachment refs, extraction job ref)
- `enablement_coverage` (solution_id, dimension, status, evidence ref) — recomputed, history kept
- Fact provenance gains origin refs so facts trace to uploads/turns (extends parent FR-3 states; no removals)

## 9. Functional requirements

- **FR-INT-1 Entry & record creation:** path chooser; record created on first commit; guided-form intake remains available; both write to the same ledgers.
- **FR-INT-2 Upload breadth:** §5.1 classes through the FR-4 pipeline; honest `STORED_UNINTERPRETED`; ZIP expansion re-validates members.
- **FR-INT-3 Interpretation jobs:** per-file pipeline with checkpoints, retries that never double-bill (parent FR-6 reservation semantics), per-class converters (OCR, 3D renderer, transcription Phase 2), cost recorded per file.
- **FR-INT-4 Distillation:** record-level pass producing title/problems/solutions/pairings as proposals with source anchors; re-runnable; shows estimate before run.
- **FR-INT-5 P/S ledger:** full CRUD + merge/split + pairing; event-sourced; AI can only propose.
- **FR-INT-6 Question engine:** staged Slusky-derived plan; deterministic adaptation/coverage layer; model drafts question text; no repetition of known facts; skip/unknown handling; resume.
- **FR-INT-7 Live extraction:** post-answer Fast-tier pass; proposals only; visible ledger updates.
- **FR-INT-8 Coverage meter:** deterministic §6.5 checklist; per-solution gaps; drives question targeting; exports with caveat.
- **FR-INT-9 Associations:** AI-proposed + user-drawn region anchors; evidence gallery; export integration.
- **FR-INT-10 Cost transparency:** every model-touching step shows estimate + wallet check before run; interview shows a per-session running spend and a configurable session cap.
- **FR-INT-11 Compliance rails:** invariants 13–19; advice-refusal template; export-control screen at creation.

## 10. Model usage (parent FR-5 gateway; OpenAI-only at launch per current provider approval)

| Step | Tier | Notes |
|---|---|---|
| Text extraction/normalization | Fast | high volume, low judgment |
| Image/schematic/3D-view interpretation | Vision-capable model | server-side only |
| Distillation & pairing | Advanced | the quality-critical pass |
| Interview question drafting | Advanced | one turn at a time; cheap per-call |
| Post-answer extraction | Fast | every turn, so cost-optimized |

All calls through the server-side gateway with per-workflow allowlists, caps, and the ×1.50 retail rule. Vision/3D interpretation limits (max renders per model, max pages per doc per pass) are config with disclosed defaults.

## 11. API additions (parent §10 conventions: auth, Zod, size limits, idempotency on money/jobs)

```text
POST   /api/inventions/:id/studio/uploads/sign
POST   /api/inventions/:id/studio/interpret          (batch or per-file; idempotent)
POST   /api/inventions/:id/studio/distill
GET    /api/inventions/:id/ps-ledger
POST   /api/inventions/:id/ps-pairs | PATCH/DELETE /api/ps-pairs/:id
POST   /api/ps-pairs/:id/confirm | /links | /associations
POST   /api/inventions/:id/interview/sessions
GET    /api/interview/sessions/:id
POST   /api/interview/sessions/:id/turns             (answer; returns next question)
POST   /api/interview/sessions/:id/skip
GET    /api/inventions/:id/coverage
```

## 12. Acceptance criteria (verification per parent §13 gates)

1. Upload of {PDF memo, JPEG photo, STL model} yields interpreted artifacts for all three, a distilled ledger with ≥1 problem and ≥1 solution each carrying source anchors, and a working title — all `ai_proposed`, all editable, with cost shown before and after.
2. Unknown file type lands as `STORED_UNINTERPRETED`, visibly, with a user prompt to describe it — never a silent drop or a fake interpretation.
3. Interview never repeats a confirmed fact's question; stage order holds; advice-seeking turns get the fixed referral template (tested with adversarial fixtures).
4. Each answered turn updates the ledger within one job cycle; user edits of confirmed items are never overwritten by later AI passes.
5. Coverage meter changes only via the deterministic checklist; a record with a solution lacking any HOW evidence shows that gap and the engine targets it next.
6. Solution evidence gallery opens each anchor type (page, image region, 3D view) at the right location.
7. A retried interpretation or interview turn cannot double-charge (idempotency tests).
8. Every screen carries the working-draft/counsel-review labeling; a11y per parent §12 including keyboard-only interview completion.
9. Prompt-injection fixture (upload containing adversarial instructions) does not alter engine behavior, ledger state, or system prompts.
10. E2E: dashboard → upload path → distill → edit ledger → interview 5+ turns with one attachment → coverage improves → export contains P/S ledger, associations, coverage report, and manifests.

## 13. Phasing

- **M1 — Upload + distill + ledger:** path chooser, upload breadth for docs/images, interpretation + distillation, editable P/S ledger + working title, coverage meter v1, export integration. (3D via basic STL/STEP rendering if the renderer lands cleanly; else M2.)
- **M2 — Adaptive interview:** question engine, live extraction, attachments-in-answers, session resume, 3D pipeline hardening.
- **M3 — Visual associations + polish:** region drawing, evidence galleries, A/V ingestion, re-distillation UX, guided-form retirement decision.

Each milestone ships behind the parent release gates (lint/type/tests/E2E/a11y/security review) with evaluation fixtures for distillation and question-engine quality before customer exposure.

## 14. Out of scope

Claim drafting or claim-shaped output in wepatent; patentability/novelty opinions; prior-art searching; automatic filing anything; cross-tenant learning from uploads; reproduction of licensed Slusky text; deadline advice.

## 15. Approval-gated decisions (adds to parent §17)

1. Button label ("New invention" recommended vs. requested "New Patent") — §2.
2. Vision/3D model selection and per-run interpretation cost defaults.
3. Interview session spend cap default.
4. A/V ingestion enablement (M3).
5. Any change to the advice-refusal template language (counsel-reviewed copy).

### Design rule: minimal human input (Jeff, 2026-08-04, app-wide)

**Minimize human steps and inputs throughout the app.** Where an input can
save itself, it must (no Save buttons for plain fields — the working title
is the canonical example: an inline auto-saving field; blurring an
untouched AI-proposed title accepts it, with provenance recorded). Where a
step can be inferred or defaulted, prefer that. The rule explicitly does
NOT remove: clickwrap acknowledgements, `ai_proposed` confirmations for
substantive ledger content, cost-estimate consent before model spend,
counsel gates, or destructive-action confirmations — those exist for
UPL/ethics and safety reasons. The step-by-step inventory and the open
removal candidates live in `docs/FRICTION-AUDIT.md`.
