# wepatent progress ledger

**Purpose:** durable, session-resumable record of PRD (`docs/PRD-wepatent.md`) completion state:
requirements traceability, verification evidence, and the exact next action.
**Branch:** `track/wepatent-app` (local commits only — pushing/deploying is not authorized).
**Environment constraints:** no Docker daemon (`supabase start` impossible — RLS suite runs against a
throwaway PostgreSQL 16 via `./scripts/test-rls.sh`); Playwright Chromium pinned at
`/opt/pw-browsers`; no network beyond package registries; synthetic data only.

## Verification commands (release gates, PRD §13)

```bash
npm run lint          # 0 errors
npm run typecheck     # 0 errors
npm test              # vitest unit/integration
npm run test:e2e      # Playwright (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers)
npm run build         # production build
npm run audit:prod    # production dependency audit
npm run scan:secrets  # secret scan
./scripts/test-rls.sh # RLS pgTAP allow/deny matrix (needs local PostgreSQL 16 + pgtap)
```

## Status legend

- **verified** — implemented and covered by an automated check that currently passes.
- **partial** — some of the requirement works; the gap is listed.
- **blocked** — cannot proceed without Jeff's approval / external credentials (PRD §17); the seam
  is built and the enabling action is documented in §Blockers.
- **unstarted** — no meaningful implementation yet.

## Requirements traceability

| # | Requirement / acceptance criterion | Implementation | Verification | Status | Evidence / remaining gap |
|---|---|---|---|---|---|
| §5.1–5.5 | counsel_request ≠ engagement; representation gates; no filing inference; attorney controls filing | `src/lib/domain/counsel-request.ts` state machine; `src/lib/server/services/counsel-lane.ts`; no "submitted" filing status (`FilingPackageStatus`) | `tests/counsel-request.test.ts`, `tests/counsel-lane.test.ts`, e2e `workspace.spec.ts` (not-represented status) | verified | State adjacency + role guards enforced server-side; filing packages have no submit path |
| §5.6 | Tenant/role derived from session, never client tenant ID | `src/lib/server/session.ts`, `src/lib/server/api.ts` | `tests/services-flow.test.ts`, e2e cross-tenant test | verified | All services take org from session context |
| §5.7 | RLS + cross-tenant isolation tests on every tenant table | `supabase/migrations/0001–0006`; `supabase/tests/01–04` | `./scripts/test-rls.sh` (pgTAP, 105 assertions) | verified | Requires local PostgreSQL 16 + pgtap; re-run before release |
| §5.8 | Separate private vs public-corpus Supabase projects | `src/lib/env/index.ts` (fails fast if URLs equal); `supabase/corpus/migrations/0001_public_corpus.sql` | `loadEnv` guard; env contract | verified (schema) / blocked (live) | Live projects are approval-gated (§17.1) |
| §5.9 | Model output is untrusted; cannot execute actions | `src/lib/server/jobs/executors.ts`, `src/lib/domain/facts.ts` (model actor guard) | `tests/facts.test.ts` (model cannot set provenance) | verified | Output stored as text only; label fixed `working_draft` |
| §5.10 | AI usage reserved+capped before run, reconciled after | `src/lib/domain/usage.ts`, `src/lib/server/services/generation.ts` | `tests/usage.test.ts`, `tests/jobs.test.ts` | verified | Reservation→settle/release; double-charge impossible via idempotency key→reservation→version chain |
| §5.11 | Outputs carry draft status, model, time, review labels | `DraftVersionRecord`, drafts UI, export renderer | `tests/export-render.test.ts`, e2e draft review test | verified | |
| §5.12 | No confidential/privileged content in repo | Synthetic seed only (`src/lib/server/adapters/local/seed.ts`) | secret scan (pending script) | partial | Add `scan:secrets` script + run |
| §6.1 | Public routes + legacy 308 redirects | `src/app/wepatent/**`, `src/lib/config/redirects.ts`, `src/proxy.ts` | e2e `public.spec.ts`, `tests/redirects.test.ts` | verified | |
| §6.2 | All 13 authenticated app routes | `src/app/app/**` | build route table; e2e workspace suite | verified | |
| §6.3 | Counsel admin routes with separate role/audit | `src/app/counsel/**`, `counsel_assignments`, `counsel_audit_events` | e2e `counsel-lane.spec.ts`, `tests/counsel-lane.test.ts` | verified | |
| §7.1 | Org creation, membership+retention in one transaction; unauth denied; no cross-tenant; idempotent expiring invitations; security-event logging w/o content | `src/lib/server/services/orgs.ts`, `invitations.ts`; audit events | `tests/invitations.test.ts`, `tests/services-flow.test.ts`, e2e | verified | |
| §7.2 | Versioned 4-ack clickwrap, server-recorded, immutable, re-acceptance | `src/lib/domain/clickwrap.ts`, `src/app/app/terms/**`, `/api/terms/accept` | `tests/clickwrap.test.ts`, e2e keyboard clickwrap | verified | Immutability also enforced in RLS (`03_immutability.sql`) |
| §7.3 | 8-stage intake; save/resume; server Zod validation+size limits; no auto legal conclusions; upload rejection pre-processing | `src/lib/domain/intake.ts`, `src/app/app/inventions/new/**`, `src/lib/domain/uploads.ts` | `tests/intake.test.ts`, `tests/uploads.test.ts`, e2e save/resume | verified | |
| §7.4 | Estimate→reserve→generate→reconcile; no double charge; required labels; model cannot mutate facts | `generation.ts`, `jobs/runner.ts`, `jobs/executors.ts`, estimate+generation routes | `tests/jobs.test.ts`, `tests/usage.test.ts`, e2e generation test | verified | |
| §7.5 | Version-locked export manifest; DOCX/PDF artifacts; checksums; short-lived tenant-scoped downloads | `services/exports.ts`, `export-render.ts`, `export-download.ts` | `tests/export-render.test.ts`, e2e export test | verified | |
| §7.6 | Counsel request state machine + conspicuous not-represented + counsel-only transitions + no fee mixing | counsel services + UI; `LedgerEntryKind` has no legal-fee kind | unit + e2e counsel tests | verified | |
| FR-1 | Supabase Auth, email verification, password reset, MFA (counsel required), rate limiting | Local-mode HMAC cookie session (`session.ts`); Supabase Auth is the production seam | — | partial/blocked | Rate limiting NOT implemented; MFA-for-counsel enforcement seam missing; Supabase Auth wiring approval-gated (§17.1) |
| FR-2 | Roles, explicit service-boundary authz + RLS, break-glass disabled+audited | `src/lib/domain/roles.ts` (7 roles; platform_support = no grants), service guards | `tests/roles.test.ts` | partial | Break-glass *enable+audit* workflow not implemented (only disabled-by-default) |
| FR-3 | Facts vs prose; provenance; versions; immutable audit; soft delete + retention purge | facts domain, draft versions, audit events, `softDeleteInvention` | `tests/facts.test.ts` | partial | Retention-aware purge workflow not implemented; settings shows retention but no purge job |
| FR-4 | Signed upload, allowlist, magic-byte, size caps, scan, quarantine, async OCR/extraction, tenant embedding namespace, classification | `services/upload-pipeline.ts`, `uploads.ts` domain, `/api/uploads/[token]`, scan/extract executors | `tests/uploads.test.ts`, e2e sources flow | verified (local) | Real malware scanning + embeddings are production/provider seams (documented) |
| FR-5 | OpenAI/Anthropic/xAI adapters; effective-dated price registry; allowlists; caps; timeout/retry/kill switch/circuit breaker; structured output; no key/raw error to browser | `model-registry.ts` (local tiers + allowlist); `ProviderModelGateway` is a THROW STUB | `tests/usage.test.ts` (rates) | partial/blocked | **Gap: production provider gateway must be written** (testable with injected fetch); live calls approval-gated (§17.4) |
| FR-6 | Stripe checkout/portal; immutable wallet ledger; reservation lifecycle; verified idempotent webhooks via outbox; ×1.50 markup; effective-dated rates | Wallet/ledger/reservations implemented + migrations (`0004`); `StripeBillingAdapter` is a THROW STUB; no `/api/stripe/*` routes | `tests/usage.test.ts`, billing e2e | partial/blocked | **Gap: Stripe adapter + checkout/portal/webhook endpoints + outbox processing must be written**; live billing approval-gated (§17.4) |
| FR-7 | Correlation IDs; structured redacted logs; error monitoring; metrics | Audit events only | — | unstarted | **Gap: observability module + wiring** |
| §9 | 34 private tables + 6 corpus tables, org_id + RLS | `supabase/migrations/0001–0006`, `supabase/corpus/migrations/0001` | `./scripts/test-rls.sh` | verified | All §9 table names present |
| §10 | 14 required endpoints + mutation rules | 10 of 14 exist under `src/app/api/**` | route tests + e2e | partial | **Missing: POST /api/organizations, POST /api/invitations, POST /api/inventions/:id/exports, POST /api/stripe/{checkout,portal}, POST /api/webhooks/stripe** (org/invite/export exist as server actions only) |
| §11 | Security headers, CSRF-safe mutations, validation, rate limits, no broad CORS, secret mgmt, tenant tests, prompt-injection resistance | `next.config.ts` headers; server actions + same-site cookies; Zod; RLS suite; extraction treats doc text as data | e2e header checks; RLS suite | partial | Rate limits missing (see FR-1); secret scan script missing |
| §12 | WCAG 2.2 AA: landmarks, one h1, keyboard, labels, no color-only state, 320–1440 responsive, reduced motion, all states | Semantic layouts, focus styles, labeled forms | e2e keyboard clickwrap | partial | **No automated a11y scan; no responsive/reduced-motion verification; needs axe integration** |
| §13 unit/integration | Schemas, guards, cost math, reservations, permissions, labels/manifests; route authz; RLS matrix; webhook signature/idempotency; adapter error handling; upload policy; job retry | 13 vitest files, 100 tests; 105 pgTAP assertions | `npm test`, `./scripts/test-rls.sh` | partial | Webhook signature/idempotency + model adapter error-handling tests missing (blocked on FR-5/FR-6 slices) |
| §13 E2E | 10 journeys | 19 Playwright tests | `npm run test:e2e` | partial | Billing portal handoff in test mode missing (blocked on FR-6 slice); console-error assertions missing |
| §13 gates | lint/type/test/build + dependency audit + secret scan + a11y scan + console + headers + RLS | verify script | this ledger | partial | `audit:prod`, `scan:secrets`, a11y scan, console checks missing |
| §14 | Async long work; job states; idempotent retries | job runner + executors | `tests/jobs.test.ts` | verified (code level) | LCP/availability targets are deploy-time measurements — blocked on §17.5 |
| §15 P0–P2 | Foundation, MVP record, generation/exports | see rows above | gates | verified (local mode) | |
| §15 P3 | Billing + observability + retention/deletion | partial | — | partial | This round's focus |
| §15 P4 | Connected counsel | counsel lane implemented up to activation seam | e2e counsel-lane | verified (seam) | Activation approval-gated (§17.7) |
| §15 P5 | GA: legal review, security assessment, a11y audit, DPAs, runbooks | — | — | blocked | Requires Jeff + external parties (§17.3/17.5) |
| §16 | Out-of-scope exclusions hold | No filing/DIY-legal-advice/docketing code paths | code inspection; no "submitted" filing status | verified | |
| §17 | 8 approval-gated decisions | Seams + `NOT_CONFIGURED` guards | this ledger §Blockers | blocked (by design) | Exact asks listed below |
| §18 | Commands + repo structure | package.json scripts; structure matches | — | partial | `audit:prod` script missing; `tasks/` directory missing |
| §19 | Definition of done | — | all rows above | partial | Remaining: rows marked partial/unstarted |

## Blockers requiring Jeff (PRD §17) — exact enabling actions

1. **Supabase (private + corpus projects)** — create two separate projects; set `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORPUS_SUPABASE_URL`,
   `CORPUS_SUPABASE_SERVICE_ROLE_KEY`; run `supabase db push` for `supabase/migrations` and
   `supabase/corpus/migrations`; run `npx supabase test db` against the live stack.
2. **Stripe (test then live)** — create products/prices for the §FR-6 plan table; set
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; point a webhook at `/api/webhooks/stripe`.
3. **Model providers** — create OpenAI/Anthropic/xAI accounts; set `OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY`, `XAI_API_KEY`; confirm no-training/retention terms per the risk memo.
4. **Terms/privacy/AI-disclosure final legal review** before publishing (§17.3).
5. **Production deploy + domain** (§17.5), **email/invitation sending** (§17.6),
   **connected-counsel activation** (§17.7), **any Patent Center interaction** (§17.8 — out of scope).

## Round 3 work log (this session)

- 2026-08-02: Verified prior state: lint 0, tsc 0, vitest 100/100, build 41 routes, e2e 19/19.
  Created this ledger. Next slice: FR-5 production provider gateway.

## Next action

Slice 1: FR-5 `ProviderModelGateway` — real OpenAI/Anthropic/xAI HTTP adapters with injected
fetch, effective-dated provider price registry, token/cost caps, timeout, bounded retry, kill
switch, circuit breaker; unit tests with fake fetch (success, provider error without leak,
timeout, retry, breaker-open, kill switch, usage-derived cost).
