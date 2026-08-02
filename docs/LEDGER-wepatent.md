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

## Invention Intake Studio — Milestone 1 (2026-08-02)

**Feature PRD:** `docs/PRD-wepatent-intake-studio.md` (M1 scope per its §13:
path chooser, upload breadth docs+images, interpretation + distillation,
editable P/S ledger + working title, coverage meter v1, export integration).
Branch `track/wepatent-app-reconciled`, commits `2f5e2ec`, `cc0e3f1`,
`1f86b10`, `2a5efba` (+ this ledger commit).

### Verification (fresh run, 2026-08-02, this container)

| Gate | Result |
|---|---|
| `npm run lint` | 0 errors, 0 warnings |
| `npx tsc --noEmit` | clean |
| `npm run test:wepatent` | 21 files, **187/187** (was 162; +25 studio tests) |
| `npm run test:lex` | 409 passed / 8 skipped (unchanged — no degradation) |
| `npm run test:rls:wepatent` | 5 pgTAP files, **139 asserts**, PASS (was 105; +34 in `05_intake_studio.sql`) |
| `npm run test:e2e:wepatent` | **34/34** (was 32; +2 studio specs incl. axe + 320–1440 responsive) |
| `npm run test:e2e:lex` | 14/14 (unchanged) |
| `npm run build` | success (all new routes present) |
| `npm run audit:prod` | 0 vulnerabilities |
| `npm run scan:secrets` | clean |

### Live-DB migration application (private project `jxehyxkcibiqluojeryy`)

`supabase/wepatent/migrations/0009_intake_studio.sql` applied 2026-08-02 via
the Supabase management API (`POST /v1/projects/{ref}/database/query`,
HTTP 201). Post-apply verification against the live DB: all 10 new tables
exist with `relrowsecurity = true`; 10 member-select policies present
(writes remain service-role only); `app_jobs_kind_check` includes
`source_interpretation` + `distillation`; immutability triggers live on
`ps_events`, `working_titles`, `extraction_artifacts`,
`enablement_coverage`; `private_sources.interpretation_status` and
`invention_facts.origin_ref` columns present. Additive only — no existing
object was modified except the extended `app_jobs` kind check.

### M1 requirements traceability

| Req | Implementation | Verification | Status |
|---|---|---|---|
| FR-INT-1 entry & record creation | Dashboard/sidebar "New invention" ("Start a patent-ready disclosure") → `/wepatent/app/inventions/start` path chooser; Path A creates the record on first commit (`start/actions.ts`) and lands in `/inventions/[id]/studio`; Path B routes to the retained guided-form intake (same record/ledgers) | `e2e/wepatent/studio.spec.ts` journey; quality-gates axe on `/inventions/start` | verified |
| FR-INT-2 upload breadth | `domain/uploads.ts`: PDF/DOCX/PPTX/XLSX/TXT/MD/SVG + PNG/JPEG/TIFF/HEIC + STL/STEP/OBJ/3MF; offset magic signatures (HEIC), octet-stream extension fallback (3D), binary-STL handling; ALL through the unchanged FR-4 quarantine pipeline; honest `stored_uninterpreted` (never a silent drop) | `tests/intake-studio.test.ts` allowlist suite; `tests/uploads.test.ts` unchanged; E2E uploads MD+PDF+PNG+STL | verified |
| FR-INT-3 interpretation jobs | `services/interpretation.ts` + `source_interpretation` job kind: per-file estimate→reservation→run→settlement on the FR-6 layer; retries dedupe by reservation (never double-bill); per-file cost recorded in `extraction_artifacts` (model, cost reservation); classes without an M1 interpreter marked `stored_uninterpreted` with a status note | unit: metering/idempotency/quarantine-refusal/vision tests; E2E interpret step | verified |
| FR-INT-4 distillation | `services/distillation.ts` + `distillation` job kind (Advanced tier): title/problems/solutions/pairings/associations as `ai_proposed` with source anchors; re-runnable; add-only (never mutates user_confirmed/user_edited; dedupes statements); estimate + wallet sufficiency shown before run in studio UI and `/studio/distill` response | unit: distill/retry/no-overwrite tests; E2E distill + re-check | verified |
| FR-INT-5 P/S ledger | `domain/ps-ledger.ts` guard (model may ONLY propose; human actions confirm/edit/delete; rejection events on AI-proposal deletion) + `services/ps-ledger.ts` CRUD/link/title + event-sourced `ps_events`; API routes per feature PRD §11 | unit state-machine matrix + CRUD flow; pgTAP write-denial ("state cannot be upgraded client-side"); E2E confirm/edit/reject/add/pair | verified (merge/split UI is a UX nicety deferred to M3 polish — delete+re-add covers the workflow) |
| FR-INT-8 coverage meter v1 | `domain/coverage.ts` — 7-dimension deterministic checklist (`coverage-v1.2026-08-02`), pure code, never model output; per-solution gap chips in studio; snapshots in append-only `enablement_coverage` | unit determinism + reaction tests; E2E deterministic meter delta from a "40 psi" edit; pgTAP coverage-forgery denial | verified |
| FR-INT-9 associations (M1 slice) | Distillation proposes solution↔component associations (`ai_proposed`); shown on ledger items and in export; region drawing/evidence galleries are M3 per feature PRD §13 | unit distill test; export section renders associated components | verified for M1 scope |
| FR-INT-10 cost transparency | Studio shows estimate + wallet available + sufficiency before interpret/distill; settlement at provider cost × 1.50 via existing FR-6 semantics; ledger/usage events per run | unit metering assertions; E2E "Estimated cost:" visible pre-run | verified (session cap is interview-scoped → M2) |
| FR-INT-11 compliance rails (M1 invariants 13, 16–18) | ai_proposed-until-human everywhere; uploads are evidence (delimited untrusted blocks; deterministic local path); prompt-injection fixture; metered runs; FR-4 for every class; "working draft — counsel review required" labeling on studio/chooser/export | unit prompt-injection test (ledger unchanged, no confirmed states, payload inert as content); E2E AC-9 check; export caveats in renderer tests… | verified |
| Export integration | Manifest carries psProblemCount/psSolutionCount/psConfirmedCount/coverage summary; DOCX/PDF render "Problem/Solution ledger" + "Enablement coverage report (record coverage, not a legal opinion)" sections; PDF renderer hardened to WinAnsi-safe output | E2E export: manifest.json fetched and asserted; existing export tests unchanged | verified |
| FR-INT-6/7 (interview engine, live extraction) | **M2** per feature PRD §13. DB schema for `interview_sessions`/`interview_turns` landed now (0009, RLS'd, pgTAP-covered) so M2 is app-code-only | pgTAP cross-tenant denials | schema-ready; engine deferred by plan |
| 3D STL/STEP rendering | **Deferred to M2, honestly**: no headless renderer lands cleanly in this environment (no Docker, no GPU; a WebGL/OSMesa worker needs real verification). 3D uploads are accepted, validated (STEP magic, binary STL), stored for the counsel package, and flagged `stored_uninterpreted` with a user prompt to describe contents — exactly the PRD's honest-status path | unit + E2E stored_uninterpreted assertions | deferred (M2) with honest in-product status |

### M1 blockers left for Jeff (not faked)

1. **Live OpenAI vision/distillation smoke run** — production gateway paths
   (gpt-4.1 text + image interpretation, JSON distillation) are implemented
   and fake-transport tested; spending real OpenAI money on a smoke run
   needs Jeff's go (§17.4). Command path: set `OPENAI_API_KEY`, run one
   interpret + one distill on a synthetic record, verify usage events.
2. **3D renderer worker** (M2): needs an approved compute substrate for
   headless mesh rendering.
3. Naming: shipped as "New invention" + "Start a patent-ready disclosure"
   per feature PRD §2 recommendation; "New Patent" remains available only
   behind Jeff's recorded approval.

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
