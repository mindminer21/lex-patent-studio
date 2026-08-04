# wepatent Production Application PRD

**Status:** Implementation source of truth
**Version:** 1.2
**Date:** August 4, 2026
**Repository:** https://github.com/mindminer21/lex-patent-studio
**Primary product in this PRD:** **wepatent**
**Related but separate product:** Lex Patent Studio

## 1. Objective

Build **wepatent** as a public, subscription-based invention-documentation and counsel-readiness application for founders, venture portfolios, R&D teams, and innovation leaders.

The product helps users:

1. Create a structured invention record.
2. Capture contributors, technical facts, alternatives, source documents, and disclosure history.
3. Generate clearly labeled automated working drafts.
4. Verify factual support and identify unresolved questions.
5. Export a counsel-ready package.
6. Optionally request a consultation with connected patent counsel.

wepatent is not a law firm, does not provide legal advice, does not create an attorney-client relationship through software use, and does not autonomously file patent documents. Patent-related drafts require review and approval by qualified patent counsel before filing, disclosure, legal reliance, fundraising/diligence use, or other consequential action.

### Success definition

A production release succeeds when an authorized user can safely create an organization and invention record, complete a structured intake, upload approved file types, generate and review a source-grounded working draft, understand the model cost before generation, export a versioned counsel package, and request counsel without any UI or backend state implying that representation already exists.

## 2. Assumptions

1. The application is a responsive web application built with Next.js App Router and TypeScript.
2. Vercel is the web/control plane, not the sole long-running compute substrate.
3. Supabase Auth, Postgres, Storage, and RLS back private application data.
4. Public patent/legal-authority retrieval uses a separate Supabase project and separate credentials.
5. Stripe handles subscriptions, customer portal access, and prepaid usage-wallet top-ups.
6. OpenAI, Anthropic, and xAI calls occur only through a server-side model gateway.
7. Long OCR, embedding, and document-generation work runs through durable asynchronous jobs.
8. Jeff/Schell IP is the initial connected-counsel option, subject to conflict review, competence/jurisdiction review, express acceptance, and a signed engagement agreement.
9. The launch market is United States-focused. International functionality is out of scope until reviewed and deliberately enabled.
10. Production customer terms, privacy policy, AI disclosure, retention policy, and counsel engagement documents require final legal review before public launch.

## 3. Product and brand separation

The repository currently contains two products for implementation convenience. Production must preserve separation.

| Product | Audience | Promise | Required boundary |
|---|---|---|---|
| **wepatent** | Founders, VCs, R&D and innovation teams | Organize invention facts and prepare counsel-ready working materials | Not a law firm; no legal advice; no representation; counsel approval required |
| **Lex Patent Studio** | Patent attorneys, agents, firms and in-house teams | Source-grounded patent workbench under practitioner supervision | Responsible practitioner controls professional judgment, advice, deadlines, signatures and filings |

Production separation requires distinct:

- Domains/deployments
- Public identity and navigation
- Onboarding and clickwrap
- Customer terms and privacy disclosures
- Support identity
- Stripe descriptors and products
- Analytics properties
- Prompt policies and output permissions
- Role and authorization policies

Shared internal packages are allowed only where they do not blur public identity, legal duties, data boundaries, or permissions.

## 4. Personas and jobs to be done

### 4.1 Founder / inventor

- Capture an invention before facts and contributor history are lost.
- Understand what information is missing.
- Prepare organized materials for a patent attorney.
- Avoid mistaking an automated draft for legal advice or a filing-ready application.

### 4.2 R&D or innovation manager

- Run repeatable invention intake across teams.
- Track contributors, disclosures, ownership questions, and source evidence.
- Maintain version history and export a review package.

### 4.3 VC platform or portfolio operator

- Give portfolio companies a consistent invention-record process.
- Identify documentation gaps before diligence or financing.
- Never receive unauthorized access to portfolio-company confidential records.

### 4.4 Connected counsel administrator

- Receive only limited conflict-intake information before conflict clearance.
- Accept or decline a request explicitly.
- Convert an accepted request into a legal matter only after a signed engagement.
- Keep legal-service fees, trust funds, official fees, and law-firm records separate from SaaS billing.

## 5. Non-negotiable invariants

1. `counsel_request !== engagement`.
2. Account creation, upload, payment, AI generation, scheduling, or consultation request does not create representation.
3. Representation requires conflict review, attorney acceptance, jurisdiction/competence review, and a signed engagement agreement with the identified law firm.
4. Filing authorization cannot be inferred from draft approval, software payment, or engagement.
5. Patent Center credentials, MFA, signatures, certifications, official-fee authorization, and authenticated submission remain under attorney control.
6. Server authorization derives tenant and role from the authenticated session, never from a client-supplied tenant ID alone.
7. Every tenant-owned table has RLS and cross-tenant isolation tests.
8. Public-corpus and private-customer data use separate Supabase projects and service credentials.
9. Model output is untrusted data; it cannot directly execute SQL, shell commands, external actions, or filing operations.
10. AI usage is reserved and capped before a run and reconciled from provider-reported usage after a run.
11. All patent outputs carry draft status, source status, model identity, generation time, and required-review labels.
12. No confidential Schell IP client matter, privileged work product, private agent memory, or unlicensed proprietary source may enter the public repository or shared corpus.

## 6. Information architecture

### 6.1 Public wepatent routes

- `/wepatent` — product landing page
- `/wepatent/pricing` — subscription and usage explanation
- `/wepatent/security` — data-handling and security overview
- `/wepatent/terms` — approved self-service terms
- `/wepatent/privacy` — privacy policy
- `/wepatent/ai-disclosure` — provider and automated-system disclosure
- `/wepatent/sign-in` — authentication entry

Legacy `/venture` and `/self-service-terms` permanently redirect to the corresponding wepatent routes.

### 6.2 Authenticated application routes

- `/app` — organization dashboard
- `/app/inventions/new` — staged invention intake
- `/app/inventions/[id]` — invention overview
- `/app/inventions/[id]/facts` — canonical fact record
- `/app/inventions/[id]/contributors` — contributors and inventorship fact collection
- `/app/inventions/[id]/timeline` — disclosure and diligence timeline
- `/app/inventions/[id]/sources` — uploads, source status, and extraction state
- `/app/inventions/[id]/drafts` — working drafts and versions
- `/app/inventions/[id]/review` — unresolved facts, support checks, and approval state
- `/app/inventions/[id]/export` — counsel package generation
- `/app/counsel` — counsel-request status
- `/app/billing` — plan, wallet, usage, invoices, and portal
- `/app/settings` — organization, members, retention, deletion, and security

### 6.3 Connected-counsel administration routes

These routes use a separate role and audit policy:

- `/counsel/requests`
- `/counsel/requests/[id]`
- `/counsel/engagements/[id]`
- `/counsel/matters/[id]`
- `/counsel/matters/[id]/filing-package`

## 7. Core user flows

### 7.1 Account and organization

1. User signs in through Supabase Auth.
2. User creates or joins an organization.
3. Server creates organization membership and default retention settings in one transaction.
4. Dashboard shows an empty state with a single primary action: create an invention record.

**Acceptance criteria**

- Unauthenticated users cannot access `/app/**`.
- A user cannot read or mutate another organization by changing a URL or request body.
- Invitation acceptance is idempotent and expires.
- Security events are logged without logging secrets or substantive invention content.

### 7.2 Versioned clickwrap

1. Before substantive intake, user sees the current terms version and four required acknowledgements.
2. Each acknowledgement requires an explicit action.
3. Server records user, organization, terms version, acknowledgement set, timestamp, IP hash or privacy-reviewed equivalent, and user-agent category.
4. Changed material terms require re-acceptance.

**Acceptance criteria**

- The Continue button remains disabled until all acknowledgements are selected.
- Acceptance is recorded server-side; client state alone is not sufficient.
- The audit record is immutable from normal application roles.

### 7.3 Invention intake

Stages:

1. Identity and business context
2. Problem and technical solution
3. Components, steps, alternatives, and advantages
4. Contributors and contribution facts
5. Disclosure and commercialization timeline
6. Ownership/assignment fact collection
7. Source upload and extraction
8. Review and submission to the invention record

**Acceptance criteria**

- Users can save and resume each stage.
- Inputs are schema-validated server-side with size limits.
- Legal conclusions are not auto-populated; the system collects facts and labels unresolved issues.
- Unsupported file types and oversized uploads are rejected before processing.

### 7.4 Draft generation

1. User selects an allowed workflow and model tier.
2. UI shows an estimated cost range and wallet sufficiency.
3. Server creates an idempotent usage reservation.
4. Worker builds a tenant-scoped context from approved private sources plus allowlisted public corpus material.
5. Model gateway runs with token, timeout, and retry caps.
6. Output is validated, stored as a versioned working draft, and linked to source/fact references.
7. Actual provider usage reconciles the reservation.

**Acceptance criteria**

- No generation begins when reservation fails or budget cap is exceeded.
- A retry cannot double-charge or produce an untracked duplicate.
- Output displays model, timestamp, estimated and actual cost, source status, unresolved facts, and “working draft—counsel review required.”
- Model output cannot mutate facts or mark itself approved.

### 7.5 Counsel-ready export

1. User selects approved record sections and a draft version.
2. System creates a version-locked package manifest.
3. Worker produces DOCX/PDF/ZIP artifacts.
4. Export includes source index, fact/unresolved-question list, contributor/timeline summary, draft labels, and checksum/manifest.

**Acceptance criteria**

- Export references immutable version IDs.
- Later record changes do not silently alter an existing export.
- Download URLs are short-lived and tenant-scoped.

### 7.6 Connected-counsel request

State machine:

`draft → submitted → conflict_review → declined | consultation_offered → consultation_scheduled → engagement_offered → engagement_signed → converted_to_matter`

The following are distinct and cannot be skipped by ordinary user actions:

- Limited conflict intake
- Conflict review
- Attorney accept/decline
- Consultation
- Engagement offer
- Signed engagement
- Full matter transfer

**Acceptance criteria**

- A submitted request has conspicuous “not yet represented” status.
- Only authorized counsel administrators can move conflict and attorney-acceptance states.
- No substantive private invention package is disclosed to counsel before the privacy/consent and conflict-intake rules permit it.
- SaaS billing never records legal fees as platform subscription or AI usage revenue.

## 8. Functional requirements

### FR-1 Authentication and sessions

- Supabase Auth with secure, HTTP-only cookies through server-side helpers.
- Email verification and password-reset flow.
- Optional MFA before general availability; required for counsel administrators.
- Rate limiting on auth and recovery endpoints.

### FR-2 Authorization and tenancy

- Organizations, memberships, and role assignments.
- Roles: `owner`, `admin`, `member`, `viewer`, `counsel_intake`, `counsel_attorney`, `platform_support`.
- Explicit resource authorization at API/service boundary in addition to RLS.
- Break-glass support access disabled by default and fully audited.

### FR-3 Invention records

- Canonical facts separated from generated prose.
- Fact provenance and status: `user_asserted`, `source_supported`, `needs_confirmation`, `disputed`, `counsel_reviewed`.
- Version history and immutable audit events.
- Soft deletion plus retention-aware purge workflow.

### FR-4 Source management

- Direct signed upload to private Supabase Storage.
- Allowlisted MIME types, extension checks, magic-byte validation, size caps, malware scan, and quarantine.
- OCR/extraction as asynchronous jobs.
- Tenant-scoped embedding namespace.
- Source classification and redistribution restrictions.

### FR-4a Three-pass patent drafting (the canonical drafting process)

**Jeff's directive, 2026-08-04.** Every patent application draft is produced by a three-pass flow. This is not an option or a mode: it is *the* drafting process, and it is the same process in wepatent and Lex Patent Studio.

```
PASS_1_DRAFTING → FIGURES_PENDING → FIGURES_READY → PASS_2_REVISING → READY_FOR_REVIEW
                (+ NEEDS_INPUT · PAUSED_BUDGET · FAILED)
```

**Pass 1 — draft plus the illustrations brief.** Produces the application draft (background, summary, detailed description) **and, as a required first-class structured artifact, the illustrations brief**: the ordered figure list, each figure's view type, what each figure must show, the parts appearing in each, and **the reference-numeral assignments**.

- The brief is authored in Pass 1 so that the numerals in the prose and the numerals in the drawings come from **one source**. Pass 1 is the author of the reference-numeral registry (`figure_reference_numerals`).
- The brief is a projection of rows that already exist — components, associations, method steps literally present in the record. Where the record cannot support a figure, the brief carries an **open question** rather than an invented figure.
- The brief is schema-validated and consistency-checked (one numeral ↔ one part, both directions; consecutive figure numbering; every cited numeral assigned; every assigned numeral used) **before any figure is drawn**.
- The draft prose must use the brief's numerals.

**Figures stage.** The existing figure pipeline runs **off the illustrations brief**, not off ad-hoc planning. The planner **consumes** the brief's numerals and may not mint new ones; a part the brief did not number produces a targeted question, never a silently invented numeral. Zero user steps: the stage chains automatically from Pass 1 completion.

**Pass 2 — enablement revision against the actual figures.** Re-drafts with the composed figures and their validation report as input. It must:

- **Reconcile prose ↔ drawings both ways** — every numeral in the description appears in the drawings, and every numeral in the drawings appears in the description (37 CFR 1.84(p)(5), MPEP 608.02(g)). This is a **gate on Pass 2 completion**, not merely a report.
- **Rewrite the "Brief Description of the Drawings"** to match the figures actually produced.
- **Strengthen written-description/enablement coverage** for every depicted element, using the §112(a) coverage model already in the codebase.
- **Flag — never silently fix** — any place where a figure and the record disagree.
- Emit a **new draft version**. Pass 2 never mutates Pass 1 in place; both versions remain inspectable and diffable.

**Client delivery gate.** Nothing is exported or delivered as a counsel/client package until the set reaches `READY_FOR_REVIEW` **and a human accepts**. If Pass 2 cannot complete — missing figures, unresolved numerals, a budget pause — the product states **exactly what is blocking and what it needs**. It must never emit a Pass-1-only package silently. The gate is enforced in three places: the shared evaluation in application code, a CHECK constraint in the schema, and the export path itself.

**Preserved invariants.** AI output is `ai_proposed` until a human acts; every version carries the working-draft label; no legal advice; metering is **per pass** with the estimate shown before each; caps are honoured and pause between passes without losing the pass already paid for; a retry of either pass resolves to the same reservation and never double-charges.

**Shared implementation.** The state machine, the illustrations-brief schema and authoring, the numeral registry rules, the reconciliation checks, and the pass-orchestration jobs live in **shared code** (`src/lib/shared/drafting/`, `src/lib/server/services/draft-passes.ts`) with per-product configuration only (prompt policy, tier rules, output document shape, review UX). The logic is not forked.

### FR-5 Model gateway

- Provider adapters for OpenAI, Anthropic, and xAI, plus Google Gemini for patent-figure line art.
- Effective-dated model-price registry.
- **Image-model default (Jeff's directive, 2026-08-04):** the default image model is **Nano Banana 2 (Gemini 3 Pro Image)**. Selection is registry-level and env-overridable (`FIGURES_IMAGE_MODEL`) so an alternative Gemini image model can be chosen without a code change; each selectable model carries its own effective-dated price entry and the same 2.0 generation multiplier, and all go through the same Layer-1 hygiene gate (no colour, no solid black, **no text**). We have **no evidence** that either model produces better patent line art; the default stands on the prompt contract having been written and tested against it. See `docs/PATENT-FIGURES.md` §7.2a for how to compare them.
- Per-workflow model allowlist and token/cost caps.
- Provider timeout, retry, kill switch, and circuit breaker.
- Structured-output schemas where feasible.
- No provider API key or raw provider error returned to the browser.

### FR-6 Billing

- Stripe Checkout for subscriptions and wallet top-ups.
- Stripe Customer Portal.
- Immutable wallet ledger.
- Usage reservation, settlement, release, refund, and adjustment entries.
- Verified, idempotent webhook processing through a billing outbox.
- Customer charge formula: actual provider cost × a **task-type retail multiplier**, with disclosed estimate variance. The multiplier is decided by what the model call PRODUCES, not by which provider served it and not by whether the output was tokens or pixels (Jeff's directive, 2026-08-04).
  - **2.00 — generation.** Any model call whose output is newly authored work product delivered to the customer: patent application drafting (**every pass**), figure/image generation, illustration-brief authoring, draft revision, export-bound prose, and deterministic-diagram planning that authors text.
  - **1.50 — analysis.** Extraction, parsing, classification, transcription, retrieval/grounding, verification/critique, coverage scoring, interview question drafting (a conversational step, not a deliverable), and routing. **Unchanged**: every charge that billed at 1.50 before 2026-08-04 still bills at 1.50, byte-identically.
  - The **exhaustive** workflow/job-kind → category table is `src/lib/shared/billing/task-category.ts`. Every workflow key, job kind, and gateway task kind in either product appears there exactly once; the table is a `Record` over a closed union, so adding a kind without a category fails `tsc` and therefore fails the build. Runtime enumeration tests back the same guarantee.
  - The multiplier catalog is public (`src/lib/shared/billing/markup.ts`); provider *rates* remain server-side. Every customer-facing statement of the rate in **both** products is derived from that catalog, so published copy and billing cannot drift apart.
  - Every settled usage event records the provider cost, the **multiplier applied**, the rate version, and the customer charge. A mixed run (an analysis component at 1.5 alongside generated images at 2.0) marks each component up at its own rate before summing.
  - An **uncategorised** charge resolves to analysis (1.50), never the higher rate. Under-charging is a business problem; over-charging without a stated basis is a substantiation problem.
  - Published rate sentence: *provider cost × 2.0 for generation tasks, × 1.5 for analysis tasks*.

**Borderline classifications recorded for the owner's review** (see the final report table): `counsel_question_list` → generation (a deliverable in the export, unlike an in-session interview question); `gap_analysis` → analysis (it scores the record, it does not author the application); Lex `status_digest` → analysis; Lex `response_path_options`, `claim_scope_strategy`, `filing_strategy_options` → generation (Tier-C briefs are authored deliverables even though their subject matter is analysis).

Initial subscription hypotheses:

| Plan | Monthly fee | Included AI usage credit | Intended customer |
|---|---:|---:|---|
| Explore | $0 limited trial | Small promotional credit | Evaluation |
| Solo | $49 | $10 | Individual founder or inventor |
| Professional | $149 | $30 | Startup or active invention team |
| Team | $499 | $100 pooled | R&D group, accelerator, or portfolio program |
| Enterprise | Custom | Contracted | Larger organizations |

These amounts are implementation defaults for test-mode Stripe products, not permanent public promises. Changing live pricing, credits, markup, or wallet policy requires Jeff’s explicit approval. Provider rates are never hard-coded in frontend source; every settled usage event retains the effective rate version, provider cost, markup, and customer charge.

### FR-7 Audit and observability

- Correlation IDs across web, job, provider, and billing events.
- Structured logs that exclude prompts, document contents, secrets, and unnecessary PII.
- Error monitoring with redaction.
- Metrics for latency, job age, failure rate, provider errors, reservation drift, and cross-tenant authorization denials.

## 9. Data model

Private application project tables:

- `users_profile`
- `organizations`
- `organization_memberships`
- `invitations`
- `terms_versions`
- `terms_acceptances`
- `inventions`
- `invention_facts`
- `contributors`
- `contribution_facts`
- `disclosure_events`
- `private_sources`
- `source_extractions`
- `drafts`
- `draft_versions`
- `draft_citations`
- `review_findings`
- `exports`
- `export_manifests`
- `counsel_requests`
- `counsel_request_events`
- `engagements`
- `legal_matters`
- `filing_packages`
- `model_registry`
- `model_prices`
- `generation_jobs`
- `usage_reservations`
- `usage_events`
- `wallet_accounts`
- `wallet_ledger_entries`
- `stripe_events`
- `billing_outbox`
- `audit_events`
- `retention_policies`

Public corpus project tables:

- `public_documents`
- `public_document_versions`
- `public_sections`
- `public_embeddings`
- `authority_effective_dates`
- `license_provenance`

Every private tenant-owned record includes `organization_id`; it is populated by trusted server logic and protected by RLS.

## 10. API and service contracts

Use Route Handlers for BFF endpoints and typed service functions for business logic.

Required endpoints include:

- `POST /api/organizations`
- `POST /api/invitations`
- `POST /api/terms/accept`
- `GET|POST /api/inventions`
- `GET|PATCH|DELETE /api/inventions/:id`
- `POST /api/inventions/:id/uploads/sign`
- `POST /api/inventions/:id/generations/estimate`
- `POST /api/inventions/:id/generations`
- `GET /api/jobs/:id`
- `POST /api/inventions/:id/exports`
- `POST /api/counsel-requests`
- `POST /api/stripe/checkout`
- `POST /api/stripe/portal`
- `POST /api/webhooks/stripe`

All mutation endpoints require:

- Authentication
- Explicit authorization
- Zod validation
- Request-size limits
- Idempotency key where money or long-running jobs are involved
- Generic external errors and structured internal logging

## 11. Security and privacy requirements

### Trust boundaries

- Browser ↔ Next.js BFF
- BFF ↔ private Supabase
- BFF/worker ↔ public corpus
- Worker ↔ model providers
- Stripe ↔ webhook endpoint
- Upload client ↔ private storage/quarantine
- Self-service app ↔ connected-counsel administration

### Required controls

- CSP, HSTS, frame denial, MIME sniffing protection, referrer policy, and permissions policy.
- Secure cookie settings and CSRF-safe mutation patterns.
- Input validation and output encoding.
- Rate limits per user/IP/workflow with privacy-reviewed identifiers.
- No broad CORS.
- Secret management through Vercel/Supabase/provider secret stores, never source control.
- Key rotation and separate development/staging/production credentials.
- Encryption in transit and provider-supported encryption at rest.
- Data deletion and retention workflows with audit evidence.
- Tenant-isolation tests in CI.
- Prompt-injection-resistant architecture: instructions in uploaded documents are treated as untrusted content, not authority.
- No autonomous external actions based solely on model output.

## 12. Accessibility and UX quality

Target WCAG 2.2 AA.

- Semantic landmarks and one logical `h1` per page.
- Full keyboard access and visible focus.
- Labels, instructions, and programmatic error associations for forms.
- No color-only state indicators.
- Responsive behavior verified at 320, 768, 1024, and 1440 px.
- Reduced-motion support.
- Empty, loading, error, permission-denied, and degraded-provider states.
- Draft/legal status labels remain visible in print and exports.

## 13. Testing strategy

### Unit tests

- Schemas and input normalization
- State-machine transition guards
- Cost estimation and markup math
- Reservation/settlement logic
- Permission predicates
- Output-label and export-manifest builders

### Integration tests

- Route authentication and authorization
- RLS allow/deny matrix
- Stripe webhook signature/idempotency behavior
- Model adapter structured-output/error handling
- Direct-upload policy and quarantine transitions
- Durable job retry and idempotency

### End-to-end tests

- Public landing and legacy redirects
- Clickwrap keyboard flow
- Sign-in and organization creation
- New invention staged intake
- Save/resume
- Cost estimate → generation → draft review
- Export creation
- Counsel request with “not represented” status
- Cross-tenant access denial
- Billing portal handoff in test mode

### Release gates

- Lint: zero errors
- Type check: zero errors
- Unit/integration/E2E: zero failures
- Production build: success
- Dependency audit: no unmitigated reachable critical/high findings
- Secret scan: clean
- Accessibility scan: no serious/critical findings
- Browser console: no application errors
- Security headers verified
- RLS cross-tenant suite: all denials pass

## 14. Performance and reliability targets

- Public pages: LCP ≤ 2.5 s at p75 on representative mobile conditions.
- Authenticated navigation: p75 server response ≤ 500 ms excluding long jobs.
- Long work is asynchronous; request handlers do not wait for OCR/model/document completion.
- 99.9% monthly web/control-plane availability target after beta.
- Idempotent recovery from webhook retries and worker retries.
- Generation jobs expose queued/running/succeeded/failed/cancelled state and safe retry behavior.

## 15. Implementation phases

### Phase 0 — Production foundation

- Complete brand/routes migration to wepatent.
- Add PRD, threat model, environment contract, security headers, test framework, CI, secret scan, and dependency remediation/triage.
- Build credential-independent workspace UI and typed domain/state-machine primitives.

### Phase 1 — Authenticated invention record MVP

- Supabase Auth and organization tenancy.
- Versioned clickwrap.
- Invention intake, facts, contributors, timeline, and private uploads.
- RLS policies and tests.

### Phase 2 — Grounded generation and exports

- Public corpus project.
- Durable jobs.
- Model gateway, price registry, reservations, source-grounded drafts, and exports.

### Phase 3 — Billing and private beta

- Stripe subscriptions, top-ups, portal, webhooks, wallet ledger, and reconciliation.
- Admin controls, observability, retention/deletion.
- 3–5 synthetic or expressly authorized beta matters.

### Phase 4 — Connected counsel

- Limited conflict intake.
- Attorney accept/decline.
- Engagement state and signed agreement integration.
- Controlled matter transfer and counsel-guided preparation.
- Supervised filing-package workflow; no autonomous Patent Center submission.

### Phase 5 — General availability

- Final legal review.
- Security assessment and incident-response readiness.
- Accessibility audit.
- Data processing agreements and provider configuration review.
- Runbooks, support, backup/restore test, and launch gates.

## 16. Out of scope for initial release

- Autonomous filing or Patent Center credential automation
- Legal advice or legal opinions from the self-service product
- Deadline docketing as a substitute for a professional docket system
- International filing workflows
- Open counsel marketplace or fee sharing
- Percentage-based legal-fee revenue
- Training foundation models on customer content
- Cross-tenant retrieval
- Import of Schell IP client matters or confidential agent memory
- Unsupported claims of SOC 2, HIPAA, ISO certification, USPTO approval, guaranteed patentability, or guaranteed outcomes

## 17. Approval-gated decisions

The following require Jeff’s explicit approval before production execution:

1. Creating or changing paid Supabase, Vercel, Stripe, model-provider, monitoring, email, or worker accounts.
2. Storing any real client, prospective-client, privileged, export-controlled, or confidential invention data.
3. Publishing customer-facing terms, privacy policy, AI disclosure, or legal-service claims.
4. Activating live billing, charging a card, or buying model usage.
5. Deploying to a public production domain.
6. Sending invitations, emails, or outreach.
7. Enabling connected-counsel intake or transferring a request into a legal matter.
8. Any Patent Center interaction, filing, signature, certification, official fee, or docket mutation.

## 18. Commands and repository structure

Expected commands:

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run audit:prod
npm run verify
```

Expected structure:

```text
src/app/                 Next.js routes and layouts
src/components/          Shared presentation and interactive components
src/lib/domain/          State machines, permissions, and schemas
src/lib/server/          Server-only adapters and services
src/lib/env/             Validated environment contracts
supabase/migrations/     Schema, RLS, functions, and immutable migrations
supabase/tests/          Tenant-isolation and policy tests
tests/                   Unit and integration tests
e2e/                     Playwright end-to-end tests
docs/                    PRD, threat model, architecture, runbooks
tasks/                   Implementation plan and executable task list
```

## 19. Definition of done

wepatent is production-grade only when:

- The requirements above are implemented rather than represented by static mockups.
- Every protected resource is authenticated and authorized server-side.
- RLS and cross-tenant tests pass against the production-equivalent schema.
- Billing and AI jobs are idempotent and cost-capped.
- Customer data and public corpus remain physically and logically separated.
- Draft and counsel boundaries are visible in UI, API state, exports, and audit logs.
- All release gates pass with fresh evidence.
- Production policies are approved.
- Jeff explicitly approves public deployment, live billing/provider use, and connected-counsel activation.
