# wepatent progress ledger

**Purpose:** durable, session-resumable record of PRD (`docs/PRD-wepatent.md`) completion state:
requirements traceability, verification evidence, and the exact next action.
**Branch:** `track/wepatent-app` (local commits only — pushing/deploying is not authorized).
**Environment constraints:** no Docker daemon (`supabase start` impossible — the RLS suite runs
against a throwaway PostgreSQL 16 via `./scripts/test-rls.sh`; this container has postgresql-16 +
pgtap + pg_prove installed and the suite passes); Playwright Chromium pinned at `/opt/pw-browsers`
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`); no network beyond package registries; synthetic data only.

## Verification commands and latest results (2026-08-02, round 3 complete)

| Command | Result |
|---|---|
| `npm run lint` | 0 errors |
| `npm run typecheck` | 0 errors |
| `npm test` | 20 files, 162/162 passed |
| `npm run build` | success — 48 routes |
| `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e` | 32/32 passed (incl. axe a11y, console, responsive 320–1440, headers) |
| `./scripts/test-rls.sh` | 4 pgTAP files, 105 assertions, PASS (migrations 0001–0008) |
| `npm run audit:prod` / `npm audit` | 0 vulnerabilities (postcss/sharp overrides) |
| `npm run scan:secrets` | clean |

## Status legend

**verified** = implemented + passing automated check. **seam-complete** = production adapter
fully implemented and tested with injected transports; only credentials/activation remain and
those are approval-gated (PRD §17) — counts as satisfied for the §19 gate per the working
agreement. **blocked** = requires Jeff / external party.

## Requirements traceability

| # | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| §5.1–5.5 | Representation/filing invariants | counsel state machine + role guards; no filing-submission state exists | `tests/counsel-request.test.ts`, `tests/counsel-lane.test.ts`, e2e counsel specs | verified |
| §5.6 | Tenant/role from session only | `src/lib/server/session.ts`, `api.ts` | `tests/services-flow.test.ts`, e2e cross-tenant | verified |
| §5.7 | RLS + isolation tests everywhere | migrations 0001–0008; `supabase/tests/01–04` | `./scripts/test-rls.sh` (105 asserts) | verified |
| §5.8 | Separate private/corpus projects | env fail-fast on identical URLs; separate corpus adapter + credentials | `loadEnv` guard; `tests/corpus.test.ts` | verified (schema+seam) |
| §5.9 | Model output untrusted | text-only output, fixed `working_draft` label, model-actor guard | `tests/facts.test.ts`, `tests/model-gateway.test.ts` (untrusted delimiters) | verified |
| §5.10 | Reserve→cap→reconcile | `usage.ts`, `generation.ts`, gateway pre-flight cap | `tests/usage.test.ts`, `tests/jobs.test.ts`, `tests/model-gateway.test.ts` | verified |
| §5.11 | Output labels | draft versions + export renderer + UI | `tests/export-render.test.ts`, e2e | verified |
| §5.12 | No confidential content in repo | synthetic-only seeds | `npm run scan:secrets` | verified |
| §6.1–6.3 | All routes + redirects + counsel lane | `src/app/**` | build route table; e2e public/workspace/counsel | verified |
| §7.1 | Org/membership/invitations | `orgs.ts`, `invitations.ts` + `/api/organizations`, `/api/invitations` | `tests/invitations.test.ts`, `e2e/api-contract.spec.ts` | verified |
| §7.2 | 4-ack versioned clickwrap | domain + `/app/terms` + `/api/terms/accept`; RLS immutability | `tests/clickwrap.test.ts`, e2e keyboard flow, pgTAP | verified |
| §7.3 | 8-stage intake | `intake.ts` + `/app/inventions/new` | `tests/intake.test.ts`, e2e save/resume | verified |
| §7.4 | Estimate→reserve→generate→reconcile; corpus context; citation linkage | `generation.ts` + jobs + CorpusPort + draft_citations | `tests/jobs.test.ts`, `tests/corpus.test.ts`, e2e generation | verified |
| §7.5 | Version-locked exports, DOCX/PDF, checksums, short-lived downloads | exports services + `/api/inventions/:id/exports` | `tests/export-render.test.ts`, e2e export, api-contract | verified |
| §7.6 | Counsel request lane | counsel services/UI; no legal-fee ledger kind | unit + e2e | verified |
| FR-1 | Auth, MFA (counsel), rate limiting | rate limiter (2-layer sign-in); `mfaEnrolled` enforcement in `requireCounsel`; Supabase Auth identity creation already in SupabaseDataAdapter | `tests/rate-limit.test.ts`; migration 0008 | verified (local) / seam-complete (hosted auth flows) |
| FR-2 | Roles, authz, break-glass | `roles.ts` (7 roles), service guards, `break-glass.ts` (disabled by default, fully audited) | `tests/roles.test.ts`, `tests/retention.test.ts` | verified |
| FR-3 | Provenance, versions, soft delete + retention purge | facts domain; `retention.ts`; settings UI; invention soft-delete UI | `tests/facts.test.ts`, `tests/retention.test.ts` | verified |
| FR-4 | Upload pipeline + storage | `upload-pipeline.ts`; `SupabaseStorageAdapter` (private bucket REST) | `tests/uploads.test.ts`, `tests/supabase-storage.test.ts` | verified (local) / seam-complete (bucket + real AV scanner) |
| FR-5 | Provider gateway | `ProviderModelGateway`: OpenAI/Anthropic/xAI, effective-dated registry, caps, timeout, retry, kill switch, breaker; no key/error leak | `tests/model-gateway.test.ts` (19 tests) | seam-complete (live keys §17.4) |
| FR-6 | Billing | wallet/ledger/reservations; `StripeBillingAdapter`; verified idempotent webhooks via `stripe_events` PK + `billing_outbox` + `stripeReference` guard; ×1.50 markup w/ rate versions; simulated local checkout drives the real pipeline | `tests/usage.test.ts`, `tests/stripe-billing.test.ts` (17), `e2e/billing.spec.ts` (4) | seam-complete (live Stripe §17.4) |
| FR-7 | Observability | `observability.ts`: correlation IDs (job id across web→job→provider→billing), redacted structured logs, metrics counters/timings; wired into runner, API helper, webhooks, sign-in | `tests/observability.test.ts` | verified (vendor export is activation-time) |
| §9 | Data model | 8 migrations, all 34 private tables + 6 corpus tables | `./scripts/test-rls.sh` | verified |
| §10 | 14 endpoints + mutation rules | all present under `src/app/api/**` | route usage in e2e + api-contract spec | verified |
| §11 | Security controls | headers, CSRF-safe mutations, Zod, rate limits, no CORS config (same-origin only), secret mgmt via env contract, tenant tests, prompt-injection posture, deletion workflows | `docs/threat-model.md` maps each control to its test | verified |
| §12 | WCAG 2.2 AA + responsive + states | semantic layouts; fixes from gate run (pricing list semantics, contrast, minmax(0,1fr)); reduced-motion CSS; empty/loading/error/denied/degraded states | `e2e/quality-gates.spec.ts`: axe serious/critical = 0, console = 0, no overflow 320–1440 | verified (automated; formal audit is a §15.5 external) |
| §13 | Testing strategy + gates | 162 unit/integration; 105 pgTAP; 32 E2E covering all ten §13 journeys; gate tooling (`audit:prod`, `scan:secrets`, axe, console, headers) | this table | verified |
| §14 | Async jobs, idempotent retries, states | job runner + executors + `/api/jobs/:id` | `tests/jobs.test.ts` | verified (LCP/availability measured post-deploy) |
| §15 P0–P4 | Phases | see `tasks/implementation-plan.md` | gates | done to activation seams |
| §15 P5 | GA externals | legal review, security assessment, formal a11y audit, DPAs | — | blocked (external parties + Jeff) |
| §16 | Out-of-scope exclusions | no filing/docketing/marketplace/training code paths | code inspection; no submit state | verified |
| §17 | Approval gates | seams + fail-fast env + this ledger | §Blockers below | blocked by design |
| §18 | Commands + structure | all commands exist incl. `audit:prod`; `tasks/`, threat model, runbooks present | package.json; repo tree | verified |
| §19 | Definition of done | everything above | this ledger | complete except §17-gated externals |

## Blockers requiring Jeff (PRD §17) — exact enabling actions

1. **Supabase** (§17.1): create private + corpus projects; set the five `SUPABASE_*`/`CORPUS_*`
   vars; apply `supabase/migrations/*` and `supabase/corpus/migrations/*`; create private bucket
   `wepatent-private`; run `npx supabase test db` live. (`docs/runbooks.md` §2.)
2. **Stripe** (§17.4): create account + products/prices for the FR-6 plan table; set
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`; point a webhook at `/api/webhooks/stripe`;
   supply `subscriptionPriceIds` to `StripeBillingAdapter`.
3. **Model providers** (§17.4): OpenAI/Anthropic/xAI accounts under no-training terms; set the
   three API-key vars; confirm `PROVIDER_PRICE_REGISTRY` rates.
4. **Legal/publishing** (§17.3): final review of terms/privacy/AI disclosure before publishing.
5. **Deploy/domain** (§17.5), **email sending** (§17.6 — invitation emails are intentionally
   not sent; accept links are surfaced once to the inviter), **counsel activation** (§17.7),
   **Patent Center anything** (§17.8 — permanently out of scope for the software).
6. **Real data** (§17.2): no real client/confidential invention data until approved.

## Round 3 work log (2026-08-02)

1. `f142edc` ledger + traceability baseline (verified prior rounds' claims first).
2. `3a6b4c3` FR-5 production ProviderModelGateway (19 tests).
3. `d330b81` FR-6 Stripe vertical: adapter, webhook signature/idempotency/outbox, endpoints,
   billing UI, simulated local checkout driving the real pipeline (17 unit + 4 E2E).
4. FR-4 SupabaseStorageAdapter (5 tests).
5. §10 completion: `/api/organizations`, `/api/invitations`, `/api/inventions/:id/exports`
   (+4 E2E).
6. FR-7 observability (5 tests).
7. FR-1 rate limiting (two-layer) + counsel-MFA seam; migration 0008; RLS suite re-run green.
8. FR-3 retention purge + soft-delete UI; FR-2 break-glass (11 tests).
9. §13 gate tooling: `audit:prod` (0 findings via postcss/sharp overrides), secret scan,
   axe/console/responsive/header E2E — which found and fixed 3 real §12 defects.
10. §7.4 corpus seam + draft citations (5 tests).
11. Docs: threat model, runbooks, tasks plan, README refresh, this ledger.

## Next action

None in-repo. All remaining work is behind the §17 approval gates listed above. On resume
after activation: follow `docs/runbooks.md` §2, then re-run every gate against the live stack
and update this table's seam-complete rows to verified-live.

## Reconciliation (2026-08-02)

The `track/wepatent-app` branch was merged with `track/lex-app` on
`track/wepatent-app-reconciled`. The PRDs require the two products to remain separable
(distinct deployments/identities); wepatent relocated under its own namespaces so Lex could
keep `/app/**`, the root marketing pages, `src/lib/env`, and `src/lib/domain`. This is a
relocation, not a redesign — wepatent behavior, invariants (draft labels, clickwrap gates,
counsel lane, tier/plan rules), and data model are unchanged.

Relocations (old → new):
- Authenticated app: `/app/**` → `/wepatent/app/**` (every link, redirect, server action,
  Stripe return URL, and E2E expectation updated; `src/proxy.ts` guard matcher now
  `/wepatent/app/:path*`). Public `/wepatent/**` and admin `/counsel/**` routes unchanged
  (Lex has no top-level `/counsel`). API routes unchanged at `/api/**` except the artifact
  download's dynamic segment folder was renamed `[id]` → `[exportId]` to coexist with Lex's
  `/api/exports/[exportId]` (URL shape identical).
- Libraries: `src/lib/env` → `src/lib/wepatent/env`; `src/lib/domain/*` →
  `src/lib/wepatent/domain/*` (clickwrap, counsel-request, facts, intake, jobs, roles,
  uploads, usage). All imports updated. `src/lib/server/**`, `src/lib/config/redirects.ts`,
  and `src/components/wepatent/**` did not collide and did not move.
- Migrations/pgTAP: `supabase/{migrations,corpus/migrations,tests,config.toml}` →
  `supabase/wepatent/...`; `scripts/test-rls.sh` → `scripts/test-rls-wepatent.sh`
  (package script `test:rls:wepatent`).
- Tests: unit suite unchanged in `tests/**`, run via `vitest.wepatent.config.ts`
  (`test:wepatent`); E2E specs → `e2e/wepatent/`, run via `playwright.wepatent.config.ts`
  (`test:e2e:wepatent`, port 3300).
- `next.config.ts` is shared: wepatent's `/venture` + `/self-service-terms` 308 redirects
  kept; headers are the union of both products' policies (wepatent's `font-src … data:`
  kept; Lex's `object-src 'none'` and `usb=()` added — strictly tighter).
- Env contract unchanged (`APP_MODE`, `SUPABASE_*`, `STRIPE_*`, …) and disjoint from the
  `LEX_*` set; local mode still boots with zero credentials.

Verification after reconciliation (2026-08-02, this container): `npm run lint` (0 errors),
`npx tsc --noEmit` (clean), `npm run test:wepatent` (162 passed),
`npm run test:rls:wepatent` (105 pgTAP), `npm run test:e2e:wepatent` (32 passed, Chromium
pinned at /opt/pw-browsers), `npm run build` (success), legacy 308s verified via
`next start`. See the merge commit on `track/wepatent-app-reconciled` for the evidence run.
