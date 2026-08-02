# Lex Patent Studio — Production Progress Ledger

**Purpose:** durable, compaction-resilient record of PRD traceability, verification
evidence, and the exact next action. Update after every completed slice.
**Canonical scope contract:** `docs/PRD-lex-patent-studio.md` (incorporates
`docs/PRD-wepatent.md` shared contracts by reference).
**Branch:** `track/lex-app` (local commits only; push/deploy are approval-gated).
**Mode:** local mode only — zero credentials, synthetic data, no external calls.
Production adapters are refuse-to-boot seams per the env contract.

**Last updated:** 2026-08-02 (Round 3 start)

## Gate status (latest full check)

| Gate | Command | Result | When |
|---|---|---|---|
| Lint | `npm run lint` | 0 errors | 2026-08-02 |
| Types | `npx tsc --noEmit` | clean | 2026-08-02 |
| Unit/integration | `npx vitest run` | 258/258 pass (14 files) | 2026-08-02 |
| Build | `npm run build` | success (all routes compile) | 2026-08-02 |
| E2E | — | NOT YET PRESENT (Round 3 scope) | — |
| RLS matrix vs real Postgres | — | NOT YET PRESENT (Round 3 scope) | — |

## Requirements traceability

Statuses: `unstarted` · `partial` · `blocked` (needs Jeff / credentials) ·
`verified` (implementation + evidence). A checked PRD box without evidence is
treated as incomplete.

### §5 Capability model & §9 core flows

| Requirement | Implementation | Verification | Status | Evidence / gap |
|---|---|---|---|---|
| 5.3 Tier model, non-demotable floor (Inv. 15) | `src/lib/domain/tiers.ts` | `tiers.test.ts` | verified | `effectiveTier` clamps demotion; floor per workflow |
| 5.2 operating contract labels (draft, tier, model, cost) | orchestrator + badges + document schema | `orchestrator.test.ts`; UI renders badges | verified | Every output carries tier/reviewState/model/corpus |
| 5.4 style profiles | — | — | unstarted | Round 3 slice S4 |
| 5.4 firm playbooks (hash-chained approvals, tenant-isolated) | — | — | unstarted | Round 3 slice S4 |
| 5.5 deadline surface + disclaimer (Inv. 20) | `deadline_observations` schema literal `disclaimerRequired: true`; `/app` home | `provenance/schemas` typing; UI shows `DEADLINE_DISCLAIMER` | verified | Disclaimer is non-optional at type level and rendered |
| 9.1 tenant/seat/matter setup | matters CRUD + 9-role policy; seats/team UI | roles.test.ts; API deny matrix | partial | No /team UI yet; invites/clickwrap = production-auth seam |
| 9.2 intake→draft flagship flow | facts→approval→run→checks→review→export | orchestrator + export tests | partial | Chat/workflows pages missing; quote verifier not yet real |
| 9.2 AC: no drafting run without approved facts | `local/index.ts createRun` | `orchestrator.test.ts` | verified | Blocks section_draft/claim_tree_draft at 0 approved facts |
| 9.2 AC: draft displays model/corpus/cost/tier/verification/flags | document schema + documents page | orchestrator test + UI | verified | |
| 9.2 AC: check failures not silently dismissible | flags carried on sections + review item | orchestrator test | partial | Dismissal-with-reason flow not yet implemented |
| 9.2 AC: version-locked export manifests | `src/lib/export/manifest.ts`, `createExport` | `export.test.ts` (immutability, reuse) | verified | Re-export returns identical artifact |
| 9.3 OA response flow | oa_analysis / oa_response_draft workflows simulated | orchestrator test | partial | Rejection-matrix structured export not yet built |
| 9.4 search report / IDS | workflow keys + estimates | — | partial | SB/08 validator missing (slice S3) |
| 9.5 research memo (retrieval protocol) | — | — | unstarted | Depends on FR-5 slice S2 |
| 9.6 review queue & approvals | `/app/review-queue`, decisions, watermark rule | `review.test.ts` (28 tests) | verified | Approve unlocks watermark-free export |
| 9.7 connected counsel touchpoint | — | — | unstarted | Status surface + gated seam, slice S5 |

### §7 Invariants (each needs an automated test or CI gate)

| Invariant | Enforcement | Test | Status |
|---|---|---|---|
| 13 citations-or-labeled-analysis | — | — | unstarted (slice S2: retrieval + citation labels) |
| 14 verifier failure blocks "verified" | — | — | partial (schema state exists; real verifier in S2) |
| 15 tier labels non-demotable | `tiers.ts` | tiers.test.ts | verified |
| 16 only authenticated humans set review state | `review.ts` actor gate rejects model/system | review.test.ts | verified |
| 17 no filing/signing/external comms code paths | no such code exists; gateway isLive()=false | grep audit + local.test.ts | verified (re-audit each round) |
| 18 absolute matter isolation | org+matter scoping in adapters; RLS SQL | adapter tests; RLS runtime matrix pending | partial (RLS vs real PG in S8) |
| 19 no training on customer content | posture documented; no provider calls exist | n/a in local mode | verified-for-local (production adapter must set no-training headers — documented seam) |
| 20 deadline disclaimer | type-literal + UI | schema type + page render | verified |
| 21 contributor seats blocked server-side | `roles.ts` policy + endpoint checks | roles.test.ts + authorization.test.ts deny matrix | verified |
| wepatent 1–12 (incorporated) | counsel≠engagement etc. | roles/api tests partially cover | partial (counsel lane surface in S5) |

### §8 Information architecture

| Route | Status | Evidence / gap |
|---|---|---|
| §8.1 public: `/product` (+drafting, office-actions), `/models`, `/security`, `/pricing`, `/legal/*` | verified | Built in DESIGN-HANDOFF posture; build passes |
| §8.1 public: `/product/invention-disclosures`, `/claim-strategy`, `/patent-research`, `/portfolio-analysis`, `/prepare-and-file`, `/patent-counsel`, `/professionals`, `/teams`, `/resources`, `/login`, `/signup` | unstarted | slice S6b |
| `/app`, `/app/matters`, `[matterId]` 3-pane, `/facts /sources /documents /claims /activity`, `/app/review-queue` | verified | Build + manual smoke (Round 2) |
| `[matterId]/chat` | unstarted | S5 |
| `[matterId]/workflows` | unstarted | S5 |
| `[matterId]/citations` | unstarted | S2 |
| `[matterId]/reviews` | unstarted | S5 |
| `[matterId]/counsel` | unstarted | S5 |
| `/portfolio` | unstarted | S6 |
| `/templates` | unstarted | S4 |
| `/knowledge` | unstarted | S2 |
| `/usage` | unstarted | S6 |
| `/team` | unstarted | S6 |
| `/settings` | unstarted | S6 |
| §8.3 composer contract | verified | Composer.tsx: task/jurisdiction/as-of/model/deliverable/QC/estimate before run |

### §10/§12 Functional requirements & API

| Requirement | Implementation | Test | Status | Gap |
|---|---|---|---|---|
| FR-1 auth/sessions | local synthetic session; Supabase seam refuses boot | env.test.ts | blocked-seam | Production Supabase Auth needs credentials (PRD §20.1) |
| FR-2 roles/policy/matter ACL | roles.ts 9 roles, deny-by-default | roles.test.ts (exhaustive) | verified | Matter-level ACL within tenant is schema-only |
| FR-3 matters/facts/audit | adapters + fact_events + audit | local.test.ts | verified | |
| FR-4 uploads (sign→scan→quarantine seam) | uploadTarget simulated; migration has states | local.test.ts | verified-for-local | Real storage/malware scan = credentialed seam |
| FR-5 knowledge/retrieval + quote verifier | — | — | unstarted | Slice S2 (local synthetic corpus + license gating) |
| FR-6 model gateway (registry, allowlist, critic independence) | pricing.ts catalog; isLive()=false | pricing.test.ts | partial | Critic-model-differs rule to enforce in S2 |
| FR-7 run machine + checkpoints + billable-retry rule | run-state.ts + orchestrator | run-state + orchestrator tests | verified | |
| FR-8 review/approval/export DOCX+manifest | export/docx.ts + manifest.ts | export.test.ts | partial | PDF rendering missing (S7); claim-chart/matrix structured export missing |
| FR-9 billing (reservation→settlement ×1.50) | pricing + orchestrator settle | pricing/orchestrator tests | verified-for-local | Stripe adapter = refuse-to-boot seam (PRD §20.4) |
| FR-10 audit/observability | append-only audit events; no content in logs | local.test.ts | verified-for-local | |
| §12 endpoints: matters/facts/uploads/runs/estimate/cancel/documents/export/review-queue/decision | 16 route handlers | authorization + idempotency tests | verified | |
| §12: `GET|POST /api/style-profiles` | — | — | unstarted | S4 |
| §12: `GET|POST /api/playbook` | — | — | unstarted | S4 |
| §12: `GET /api/knowledge/search` | — | — | unstarted | S2 |
| §12: `GET /api/knowledge/verify-quote` | — | — | unstarted | S2 |
| §12: `GET /api/portfolio/summary` | — | — | unstarted | S6 |

### §11 Data model / §13 security / §14–§17 quality

| Requirement | Status | Evidence / gap |
|---|---|---|
| §11 private schema (~45 tables, RLS, append-only) | partial | 3 migrations exist; style_profiles/playbook_entries/search_reports/ids tables + corpus tables to add with S2–S4; RLS runtime proof in S8 |
| §13 security headers / CSP | unstarted | next.config.ts headers, S6 |
| §14 eval harness (benchmark suite, gates) | unstarted | S10 scaffolding: schema, smoke subset in CI, attorney-validation pending labels |
| §15 accessibility WCAG 2.2 AA | partial | Semantics/landmarks/44px targets in built pages; axe-style audit with E2E in S9 |
| §16 unit tests for checkers | partial | claim-dependency + antecedent-basis done; SB/08, numerals, section completeness in S3 |
| §16 E2E flows | unstarted | S9 Playwright |
| §16 RLS matrix vs real Postgres | unstarted | S8 (adapt wepatent throwaway-PG pattern; PG16+pgTAP+pg_prove confirmed available on this machine) |
| §17 perf targets | partial | Local mode trivially fast; no measurement harness (non-blocking; production-only meaningful) |

### §20 Approval-gated items (build to the seam; Jeff must act)

| Gate | Seam status | Exact enabling action needed from Jeff |
|---|---|---|
| Accounts (Supabase/Vercel/Stripe/providers) | env contract + refuse-to-boot adapters | Create accounts; set `LEX_*` env vars; set `LEX_APP_MODE=production` |
| Live billing / provider spend | reservation→settlement logic complete locally | Stripe keys + provider keys + explicit go-live approval |
| Public deploy / domains | build passes | Vercel project + domain + approval |
| xAI/Grok customer traffic (20.13) | catalog entry marked approval-gated | Explicit enablement |
| Pricing/plans (20.14) | test-mode defaults per PRD tables | Approve final pricing |
| Corpus source registry (20.9) | license-class enforcement in S2 | Approve commercial source registry after license audit |
| Schell IP playbook content (20.10) | default no; nothing imported | n/a (default stands) |
| Performance claims (20.11), per-workflow enablement (20.12) | eval harness scaffolding S10 | Attorney validation + sign-off |

## Round 3 slice plan (priority order)

- S1 ✅ this ledger.
- S2 FR-5 knowledge/retrieval service: synthetic license-tagged corpus slice, retrieval with authority weighting + as-of filtering + license gating, quote verifier; `/api/knowledge/search`, `/api/knowledge/verify-quote`; orchestrator VERIFYING uses real verifier (Inv. 13/14); critic model independence (FR-6); `/app/knowledge` + `[matterId]/citations`.
- S3 Deterministic checkers: reference-numeral consistency, SB/08 validation, section completeness; wire to workflows.
- S4 Style profiles + playbooks (domain, adapters, API, `/app/templates`, hash-chained approvals).
- S5 Matter sub-routes: `/workflows`, `/reviews`, `/chat`, `/counsel`.
- S6 Top-level: `/portfolio` + summary API, `/usage`, `/team`, `/settings`; security headers; S6b remaining §8.1 marketing routes.
- S7 PDF export alongside DOCX.
- S8 RLS matrix vs throwaway Postgres 16 (pgTAP), new tables included.
- S9 Playwright E2E for critical journeys + accessibility checks.
- S10 Eval-harness scaffolding (§14) with CI smoke subset.
- S11 Final invariant audit, TODO/placeholder scan, diff review, ledger close-out.

## Decisions log

- 2026-08-02: Confirmed baseline (lint 0, tsc clean, 258/258, build ✅) before Round 3 work.
- Corpus content in local mode is SYNTHETIC-labeled paraphrase snippets with realistic metadata (license classes, effective dates) — no scraped text, satisfying the synthetic-data-only rule while exercising the license gate for real.

## Next action

Execute slice S2 (FR-5). Failing tests first for: license-gated retrieval, as-of filtering, quote-verifier pass/tamper/fabricated-citation cases, verifier-failure-blocks-verified, critic-model independence.
