# Lex Patent Studio — Production Progress Ledger

**Purpose:** durable record of PRD traceability, verification evidence, and
remaining blockers. **Scope contract:** `docs/PRD-lex-patent-studio.md`
(incorporating `docs/PRD-wepatent.md` by reference).
**Branch:** `track/lex-app` (local commits only; push/deploy approval-gated).
**Mode:** local mode (zero credentials, synthetic data, no external calls) +
production adapter suite tested against real PostgreSQL 16 without credentials.

**Last updated:** 2026-08-02 (Round 3 complete — S1–S11)

## Gate status (final verification, 2026-08-02)

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | 0 errors |
| Types | `npm run typecheck` | clean |
| Unit/integration | `npm test` | 409 passed (8 PG-gated skipped by design) — 22 files |
| Production-adapter integration (real PG16) | `npm run test:production-adapter` | 9/9 passed (throwaway DB, migrations 0001–0006) |
| RLS matrix vs real PostgreSQL 16 | `npm run test:rls` | 96 pgTAP assertions passed (81 private + 7 corpus + immutability/chat additions) |
| E2E (Playwright/Chromium) | `npm run test:e2e` | 14/14 passed (~59 s) |
| Production build | `npm run build` | success — 50+ routes |
| Eval smoke suite (§14) | inside `npm test` | 11/11 questions pass; leakage zero |
| TODO/FIXME scan | grep | 0 remaining |

## Requirements traceability (final)

Statuses: **verified** (implementation + evidence) · **verified-local** (fully
working in local mode; production twin present or seam documented) ·
**seam-blocked** (requires Jeff's approval-gated action; production adapter
written and tested to the extent possible without credentials).

### §5 Capability model / §9 flows

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| 5.1 intake/fact ledger, provenance, contributor prompts | domain/provenance, adapters, /facts UI | local.test, E2E tabs | verified-local |
| 5.1 drafting from approved facts only | orchestrator deliverable sections; zero-fact block | orchestrator tests | verified-local |
| 5.1 claim checks (dependency, antecedent) | domain/checks | 40+ fixture tests | verified |
| 5.1 numeral/figure consistency, SB/08, section completeness | domain/checks (S3) | 46 checker tests + orchestrator wiring tests | verified |
| 5.1 OA analysis / response separation | oa workflows + SEC-MIXED rule | checker + orchestrator tests | verified-local |
| 5.1 research memos per §6.2 | knowledge module + research_memo workflow + chat | retrieval/verifier tests, E2E | verified-local |
| 5.1 second-model critique (differs from drafter) | pickCriticModel + orchestrator + critic_model_independent SQL check | pricing tests, orchestrator tests, pgTAP | verified |
| 5.1 quote/citation verifier blocks "verified" | knowledge/verifier + orchestrator VERIFYING | verifier tests + E2E tamper drill | verified |
| 5.2 operating contract labels | badges, exports, chat, documents | E2E + unit | verified-local |
| 5.3 tier model, non-demotable floor | domain/tiers | tiers tests | verified |
| 5.4 style profiles | domain/styles + adapters + /templates + API | styles tests, matrix, PG integration | verified-local |
| 5.4 playbooks (hash-chained, tenant-isolated, never cross-tenant) | domain/styles chain + adapters + RLS | chain tamper tests, pgTAP §5.4 assertions, PG integration | verified |
| 5.5 deadline surface + disclaimer | type-literal + UI + SQL check constraint | schema, pgTAP (cannot be false), E2E | verified |
| 9.1 tenant/seat/matter setup | matters CRUD, 9 roles, /team, clickwrap text at /signup | matrix tests; invites/email seam-blocked (§17.6) | verified-local + seam |
| 9.2 flagship intake→draft→review→export | full loop | E2E flagship test end-to-end | verified-local |
| 9.2 AC: no drafting without approved facts | createRun gate | orchestrator test | verified |
| 9.2 AC: draft displays model/corpus/cost/tier/verification | document schema + UI | E2E + unit | verified |
| 9.2 AC: check failures not silently dismissible; reason in audit | dismissal-note rule in both adapters | unit tests + audit assertion | verified |
| 9.2 AC: version-locked immutable exports | createExport reuse + exports_immutable trigger | export tests, PG integration, pgTAP | verified |
| 9.3 OA flow + rejection matrix schema | workflows + rejections/rejection_matrix_cells tables | orchestrator + RLS fixtures | verified-local (structured matrix UI export = follow-up) |
| 9.4 search report / IDS + SB/08 | workflows + checkers + ids tables | SB/08 tests, orchestrator test | verified-local |
| 9.5 research memo protocol | §6.2 implementation | retrieval tests, eval suite | verified-local |
| 9.6 review queue/approvals/watermark | /review-queue + matter /reviews + export rules | review tests (28), E2E approve→watermark-free export | verified |
| 9.7 counsel touchpoint (no shortcut) | /counsel surface + state machine doc; intake approval-gated | E2E NOT-YET-REPRESENTED check | seam-blocked (wepatent §17.7 + §21.2 entity structure) |

### §7 Invariants → automated tests

| Invariant | Test/gate |
|---|---|
| 13 cite-or-label-analysis | orchestrator + chat tests (analysis entries); eval suite |
| 14 verifier failure blocks verified | verifier tests; orchestrator tamper test; E2E drill |
| 15 tier non-demotable | tiers tests |
| 16 humans only set review state | review tests (model/system actors rejected); PG integration |
| 17 no filing/signing/external comms | no such code path (grep-audited); gateway isLive()=false; E2E scan |
| 18 absolute matter/tenant isolation | 96 pgTAP assertions on real PG; adapter tests; eval leakage dimension; E2E |
| 19 no training on customer content | posture in code comments/settings; provider config seam documented (no provider calls exist) |
| 20 deadline disclaimer everywhere | SQL check constraint (pgTAP), type literal, UI render (E2E) |
| 21 contributor seats blocked server-side | roles tests + 24-endpoint × 9-role deny matrix + RLS role tests |
| wepatent 1–12 | counsel≠engagement surfaces; RLS; reservation-before-run (orchestrator tests); draft labels; no Schell content (synthetic-only corpus/seeds) |

### §8 Information architecture — all routes live

- §8.1 public (17 routes incl. product×7, patent-counsel, professionals,
  teams, resources, login/signup seams, legal×4, models/security/pricing):
  build ✅, E2E prohibited-claims scan ✅.
- §8.2 app: home, matters, matter×11 tabs (workspace/chat/facts/sources/
  workflows/documents/claims/citations/reviews/counsel/activity),
  review-queue, portfolio, knowledge, templates, usage, team, settings —
  all rendering with real data paths (E2E).
- §8.3 composer contract fields verified by E2E.

### §10 FR / §12 API

| FR | Status | Evidence / seam |
|---|---|---|
| FR-1 auth | seam-blocked | SupabaseAuthAdapter written (cookie parse unit-tested; /auth/v1/user verification); needs LEX_SUPABASE_* (§17.1). SSO/SCIM = Phase 4 per PRD |
| FR-2 roles/ACL/RLS | verified | policy table + matrix + matter_acl pgTAP tests |
| FR-3 matters/facts/audit | verified | unit + PG integration |
| FR-4 uploads | seam-blocked | validation schemas + quarantine schema + simulated targets tested; storage bucket approval-gated |
| FR-5 knowledge/retrieval/verifier | verified-local | license gate, as-of, supersession, diversity, refusal, verifier — 27 tests + corpus-project SQL license view (pgTAP) |
| FR-6 gateway | verified-local + seam | catalog/estimates/critic-independence tested; provider execution approval-gated (isLive false until keys AND recorded approval) |
| FR-7 run machine | verified-local | state machine + checkpoints + billable-retry rule tests; production run execution = durable-job seam |
| FR-8 review/export DOCX+PDF+manifests | verified | export tests, qpdf/pdftotext validation, PG integration, E2E |
| FR-9 billing ×1.50 reservation→settlement | verified-local + seam | pricing/orchestrator tests; ledger schema immutability pgTAP; Stripe activation approval-gated |
| FR-10 audit | verified | append-only trigger pgTAP + adapter tests |
| §12 endpoints (22 implemented incl. knowledge, style-profiles, playbook, portfolio) | verified | 24-case × 9-role deny matrix; idempotency tests |

### §13–§17

- §13 security: CSP/HSTS/frame-deny/nosniff/referrer/permissions headers on
  every route (E2E-verified); no secrets in repo; generic external errors;
  export-control posture documented in /settings (screening at matter
  creation is schema-supported via export_control_flag — automation of the
  halt is listed as follow-up).
- §14 eval harness: smoke suite in CI (11 questions, real systems), release
  gates for all 16 workflows default-OFF with §20.12 sign-off in the gate
  logic, substantiation rule (zero validated → zero claims) asserted.
- §15 accessibility: landmarks, single h1 (E2E-asserted), labels
  (getByLabel), 44px targets, keyboard nav (E2E), 320px overflow checks
  (E2E, two real defects found and fixed), status roles on async forms.
- §16 testing: unit (409) + pgTAP (96) + PG integration (9) + E2E (14) as
  itemized above.
- §17 perf: local mode trivially meets targets; production measurement
  requires deployed infra (seam).

### §20 approval gates — exact enabling actions for Jeff

1. **Supabase private project**: create; apply `supabase/migrations/`
   (0001–0006); set LEX_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY +
   LEX_DATABASE_URL; set LEX_APP_MODE=production.
2. **Corpus project**: create (separate credentials); apply
   `supabase/corpus-migrations/`; approve the commercial source registry
   after the license audit (§20.9) before ingesting real sources.
3. **Stripe**: create account; set LEX_STRIPE_*; approve final pricing
   (§20.14) and live billing (§17.4).
4. **Providers**: provision OpenAI/Anthropic keys under no-training terms;
   set LEX_PROVIDER_SPEND_APPROVED=true alongside the recorded approval;
   xAI additionally requires §20.13. Deploy the durable job runner to
   enable production runs.
5. **Storage bucket** for uploads/export artifacts (FR-4/FR-8 paths).
6. **Connected counsel** (§17.7 + entity structure §21.2) before enabling
   intake.
7. **Per-workflow enablement** (§20.12): attorney-validate the benchmark
   suite, then flip each workflow's release gate with recorded sign-off.
8. **Public claims** (§20.11): only after attorney-validated evidence.
9. Deploy/domain/invitations (§17.5/§17.6) — nothing is pushed or sent from
   this environment.

## Round 3 commit log (all on track/lex-app)

808a1aa ledger · e36b8e3 FR-5 knowledge system · (S3) checkers ·
5cd9f1b styles/playbooks · 193362f matter sub-routes · b58831f top-level
workspace + headers · c9f947c PDF export · 7b83f97 RLS matrix ·
f48ecf1 E2E suite · b6241f3 §8.1 routes · 2a1c2c1 eval harness ·
09d83bd production adapters · (S11) dismissal rule + audit close-out.

## Non-blocking follow-ups (documented, not placeholders)

- Rejection-matrix / claim-chart STRUCTURED table export (FR-8 sentence 3):
  matrices exist as schema + document sections; a dedicated table-export
  renderer is a production-phase artifact alongside real OA parsing.
- Export-control screening automation (halt pipeline on flagged categories):
  schema flag exists (`matters.export_control_flag`); wire to run creation
  when real processing exists (no automated processing occurs in local mode).
- Production idempotency persistence for API replays (schema keys exist on
  money tables; HTTP replay store is in-memory local seam).
- MFA enrollment surface (FR-1 GA requirement) arrives with Supabase Auth.
- npm audit: 3 high findings are transitive inside next@16.2.12
  (postcss/sharp); not reachable at runtime here (no next/image, no
  user-supplied CSS compiled at runtime); remediation = future Next upgrade.
- design-patent workflows, figure-audit UI, PCT paper prep (Phase L2+ per
  §18) are represented by workflow keys/tier floors and release gates, not
  by full local simulations.

## Resume instructions (if another session continues)

Everything above is committed. Re-verify with:
`npm run lint && npm run typecheck && npm test && npm run build`,
`npm run test:rls`, `npm run test:production-adapter`, `npm run test:e2e`
(build first; Chromium pinned at /opt/pw-browsers/chromium-1194). The only
open items are the §20 approval-gated actions listed above and the
non-blocking follow-ups.
