# Lex Patent Studio Production Application PRD

**Status:** Implementation source of truth
**Version:** 1.0
**Date:** August 1, 2026
**Repository:** https://github.com/mindminer21/lex-patent-studio
**Primary product in this PRD:** **Lex Patent Studio** (professional lane)
**Related but separate product:** wepatent (see `PRD-wepatent.md`)
**Companion documents:** `business-and-product-proposal.md`, `legal-ethics-risk-memo.md`, `DESIGN-HANDOFF.md`

## 1. Objective

Build **Lex Patent Studio** as a subscription AI patent associate for supervised patent professionals: in-house general counsel and IP teams, senior patent attorneys and agents, small IP boutiques, and R&D/innovation departments operating under legal supervision.

The product delivers the working capabilities and knowledge system of Jeff's internal patent agent ("Lex") as a multi-tenant commercial platform. Lex functions as a **junior patent associate under practitioner supervision**: it drafts, searches, analyzes, verifies, and prepares — and a responsible human practitioner reviews, decides, signs, and files.

### Positioning and the "junior associate alternative" claim

The commercial thesis is that a Professional or Team subscription delivers a meaningful share of the throughput a first-to-third-year patent associate provides — drafting, office-action analysis, search reports, IDS preparation, research memos — at a small fraction of a junior associate's fully loaded cost, without recruiting, training, or attrition risk.

Marketing rules for this claim:

1. The comparison is **economic and workflow-based** (cost per drafted section, per OA analysis, per search report; turnaround time), never a claim of attorney equivalence, licensure, or autonomous legal judgment.
2. "Your next patent associate" remains a supervised-workflow metaphor. The responsible practitioner independently reviews all work and controls legal judgment, client communications, signatures, deadlines, and filings.
3. Every throughput or quality claim must be substantiated by the evaluation harness (Section 14) and design-partner time studies before public use.
4. Prohibited claims: "AI patent lawyer," lawyer replacement, "file without review," guaranteed allowance or outcomes, human-attorney equivalence, "a clone of Grok."

### Success definition

A production release succeeds when a supervising practitioner can create an isolated matter workspace, load invention facts and sources, run guided associate workflows that produce source-grounded work product with verifiable citations and explicit review tiers, complete the review-and-approval loop, export USPTO-usable documents, and understand model cost before every run — with zero cross-tenant leakage, zero fabricated authority passing the verifier, and no code path that files, signs, or communicates externally without human authorization.

## 2. Assumptions

1. Responsive web application: Next.js App Router + TypeScript on Vercel; Supabase Auth, Postgres, Storage, RLS for private application data; a separate Supabase project for the public knowledge corpus (identical platform assumptions to `PRD-wepatent.md` §2 — the two products share infrastructure patterns, not identity).
2. Stripe handles subscriptions, customer portal, and prepaid usage-wallet top-ups; usage is billed at provider cost × 1.50 per the business proposal.
3. OpenAI, Anthropic, and xAI models are reachable only through the server-side model gateway. Model choice (including Grok models) is a user-facing feature.
4. Long-running work (drafting orchestration, OCR, corpus indexing, exports, verification passes) runs in durable asynchronous jobs.
5. The knowledge corpus ships **public and expressly licensed sources only**. Jeff's internal corpus is the architectural blueprint; each source class ports only after the license audit clears it (Section 6.4).
6. Lex Patent Studio launches U.S.-first. The corpus includes international authorities (PCT/EPO/WIPO/Hague) for research grounding, but non-U.S. filing workflows are out of scope until deliberately enabled.
7. The connected-counsel pathway ("Meet with Patent Counsel — Evaluate, Prepare & File") is shared platform capability specced in `PRD-wepatent.md` §7.6 and the business proposal §4.4; this PRD incorporates it by reference and adds only professional-lane touchpoints.
8. Production terms, privacy policy, AI disclosure, and all customer-facing legal claims require final legal review before public launch.
9. Everything in `docs/legal-ethics-risk-memo.md` applies. The professional lane is the memo's "lowest-risk credible launch" configuration; this PRD must not drift toward the direct-to-inventor configuration.

## 3. Product and brand separation

Unchanged from `PRD-wepatent.md` §3. Lex Patent Studio is the professional product; wepatent is the non-lawyer product; they share a controlled agent platform but must maintain distinct domains, identity, onboarding, terms, support, billing descriptors, analytics, prompt policies, and output permissions.

One addition specific to this PRD: **R&D and innovation departments appear in both products' audiences.** The boundary is supervision. An R&D team working inside Lex Patent Studio does so in **contributor seats inside a legal-team tenant** — invention intake, fact contribution, source upload, and status visibility — with generation, claim work, and legal-analysis workflows reserved to practitioner and reviewer roles. An R&D team without a supervising legal function belongs in wepatent. The seat/role model (FR-2) enforces this; marketing must not sell Lex to unsupervised non-practitioner teams.

## 4. Personas and jobs to be done

### 4.1 In-house GC / head of IP

- Absorb growing invention flow without adding headcount or outside-counsel spend.
- Convert engineer interviews into structured disclosures and filing-ready drafts for outside or in-house prosecution.
- Get first-pass office-action analyses and response options before spending attorney hours.
- See portfolio-wide status, coverage gaps, and filing priorities.
- Prove to the CFO that IP spend per asset is dropping; audit trail for every AI-assisted work product.

### 4.2 Senior patent attorney / agent (firm or boutique)

- Delegate associate-tier work: section drafting, claim trees with fallbacks, rejection mapping, IDS preparation, search reports, research memos.
- Trust but verify: every proposition cited to retrievable authority with effective dates; quotes verified against source text; unsupported statements flagged.
- Keep each client matter absolutely isolated; nothing learned from one matter surfaces in another.
- Enforce personal/firm drafting style across everything Lex produces.
- Choose the reasoning engine per task and see cost before running.

### 4.3 R&D / innovation manager (supervised contributor)

- Run repeatable invention intake across engineering teams inside the legal team's workspace.
- Answer Lex's missing-fact prompts (embodiments, alternatives, dates, contributors) asynchronously.
- Track disclosure→draft→filing status without accessing legal analysis or privileged notes.

### 4.4 Patent agent / paralegal (supervised operator)

- Execute Tier-A work (Section 5.3) end to end: IDS packages, formalities, routine dependent claims, status reports.
- Prepare Tier-B drafts and route them to the responsible attorney with Lex's self-review attached.
- Never able to mark work "attorney approved" or trigger anything reserved to counsel.

### 4.5 Connected counsel administrator

- Identical to `PRD-wepatent.md` §4.4; professional-lane users may also route overflow or conflicted-out work to connected counsel.

## 5. The Lex associate capability model

This section is the productization of Jeff's internal Lex agent. Capabilities are grouped as guided workflows; each workflow ships only when it passes its evaluation gate (Section 14).

### 5.1 Capability inventory

**Intake and disclosure**

- Structured invention interview (interactive or from uploaded interview notes/recordings' transcripts).
- Fact-ledger extraction: problem, solution, components, steps, alternatives, advantages, contributors, dates — each fact carrying provenance and status (`user_asserted`, `source_supported`, `needs_confirmation`, `disputed`, `counsel_reviewed`).
- Missing-fact and terminology-conflict detection; targeted follow-up questions routed to contributor seats.

**Drafting (utility)**

- Full application drafting using Slusky problem-solution methodology: WHAT/HOW separation, inventive-departure identification, planned-retreat fallback hierarchy.
- Section-level drafting: background, summary, detailed description, abstract — from approved facts only.
- Claim strategy: independent/dependent claim trees, fallback positions, claim-set drafts; antecedent-basis and dependency checks run deterministically, not by model opinion.
- Written-description and enablement support checks mapping every claim term to specification support.
- Figure planning and audit: figure/callout consistency between specification, claims, and drawing sets; MPEP-compliant callout numbering.

**Drafting (design)**

- Design application text, §120 continuity analysis (including abandoned-parent posture), related-application-without-benefit language, multi-variant design family structuring.

**Prosecution**

- Office-action analysis: parse rejections by claim/statute/reference; evidence-linked rejection matrix; response-path options with tradeoff and estoppel/scope flags.
- Amendment drafting with MPEP-compliant markup (underline additions, double-bracket deletions), separated from argument drafting.
- 37 CFR 1.132 declaration preparation (unexpected results, commercial success, other objective evidence).
- IDS preparation: reference extraction from search reports, citation classification, SB/08 field validation for Patent Center autoload, size-fee awareness, attorney review packet.
- Examiner-interview preparation summaries.
- PCT international-phase paper preparation (e.g., Rule 90bis withdrawals, marked RO/101 packages) as *document preparation only* — filing remains human.

**Search and analysis**

- Patentability search orchestration across public patent data; prior-art analysis; standardized search-report generation in a configurable house style.
- Search-informed application revision: using search findings as positive differentiation support in new or locked-figure drafts.
- Claim charts: claims vs. references or products, element-by-element, with pinpoint source links.

**Research**

- Cited research memos on patent law and USPTO practice: issue decomposition, primary-authority-first retrieval, authority hierarchy, effective/as-of dating, supersession checks, explicitly labeled analysis vs. quoted authority, and refusal when the record is insufficient.

**Portfolio**

- Family maps, coverage-gap analysis, filing-priority recommendations, status dashboards across a tenant's matters.

**Quality control**

- Second-model critique: an independent model reviews work product and produces a critic report (unsupported claims, missing support, internal inconsistencies).
- Citation/quotation verifier: every quote and citation checked against retrieved source text; failures block "verified" status.
- Deterministic checks: claim dependencies, antecedent basis, reference-numeral consistency, section completeness.

### 5.2 The associate operating contract

Lex's behavioral contract, embedded in system policy for every professional-lane run:

1. Ground every legal proposition in retrievable authority or label it analysis.
2. Never invent a quotation, citation, patent number, or reference identifier.
3. Draft from the approved fact ledger only; flag gaps instead of filling them with plausible fiction.
4. Surface uncertainty affirmatively ("not confident about X — verify") rather than smoothing over it.
5. Present work as drafts for review; never mark own work approved; never imply legal advice to an end client.
6. Respect the work-tier system (5.3): label every deliverable with its tier and required review level.
7. Apply tenant style rules (5.4) to all work product.

### 5.3 Work-tier model (supervision routing)

Ported from the internal agent-manager supervision model. Every workflow output carries a tier, displayed in UI, exports, and the audit log:

| Tier | Meaning | Examples | Required human action |
|---|---|---|---|
| **A — Prepare** | Routine, verifiable, low-judgment | IDS packets, formalities, dependent-claim drafts per established strategy, status digests, formatting, docket-data extraction | Operator review (agent/paralegal seat sufficient) |
| **B — Draft for review** | Substantive work product | Application sections, independent-claim amendments, OA response drafts, §101/§112 argument outlines, search reports, research memos, 132 declarations | Responsible practitioner reviews and edits before any downstream use |
| **C — Decision support only** | Strategy and judgment | Appeal vs. RCE vs. continuation, claim-scope narrowing beyond pre-approved limits, abandonment, validity/infringement/enforcement questions, client-facing advice | Lex provides options, tradeoffs, and evidence; the practitioner decides. Lex never outputs a recommendation styled as the decision |

Tier assignments per workflow are platform policy, not user-editable below the floor (a tenant may promote work to a stricter tier, never demote below platform policy).

### 5.4 Style and playbook system

- **Tenant style profiles:** configurable drafting-style rulesets (application drafting style, search-report style, OA response conventions) applied to all generation in a tenant. Ships with a neutral professional default; tenants customize.
- **Firm playbooks:** tenants may publish internal, tenant-isolated playbook entries (approved arguments, preferred claim structures, examiner-specific notes). The platform's publication pipeline enforces reviewer identity, timestamps, and immutable content hashes — mirroring the internal attorney-playbook design.
- **No cross-tenant playbook access, ever.** Schell IP's internal playbook does not ship with the product (Approval-gated decision; default no per business proposal §9.13).

### 5.5 Deadline awareness (not docketing)

Lex extracts and tracks dates it encounters (OA mailing dates and statutory windows, priority-year dates, national-phase windows, maintenance windows) and surfaces tiered reminders (90/60/30/14/7-day) inside the workspace. Hard boundary, stated in UI and terms: **Lex Patent Studio is not a docketing system of record and does not guarantee deadline monitoring.** Every date carries a "verify against your docket" label. No deadline-based automation triggers external action.

## 6. Knowledge system

The commercial re-implementation of the internal patent knowledge infrastructure. This is the product's principal moat and its principal licensing risk; both are managed here.

### 6.1 Corpus layers (public corpus project)

| Layer | Contents | Internal blueprint |
|---|---|---|
| **Primary law** | Section-level current and historical MPEP; 35 U.S.C.; 37 C.F.R. with point-in-time version history; effective-date overlays | `patent-primary-law/` + eCFR history tooling |
| **Authority feeds** | Federal Register (USPTO), precedential/informative PTAB decisions, Federal Circuit opinions (2004–present catalog), Supreme Court patent opinions, ITC, EPO Guidelines and Boards of Appeal case law, WIPO/PCT materials, Hague System, USPTO design practice | `patent-authority-feeds/` + refresh pipeline |
| **Public patent data** | Published patents/applications, public prosecution histories via USPTO ODP/API adapters | `uspto_patent_data` tooling |
| **Prosecution-precedent engine** | Structured public prosecution outcomes (argument/amendment patterns vs. results) queryable by rejection type, statute, art unit signals | `patent-prosecution-engine/` |
| **Citation graph** | Cross-reference graph over primary and case-law materials for supersession and treatment checks | `patent-citation-graph/` |
| **Canonical practice collections** | Deduplicated, quarantine-filtered collections segmented by practice area: prosecution, drafting, litigation, PTAB, foreign/PCT, technical prior art | `patent-canonical/` + corpus builder |

Every corpus document carries: source type, jurisdiction, date/edition, license class, authority rank, supersession status, confidentiality class, provenance, and content checksum. The corpus registry is append-only with release versioning (`corpus_releases`).

### 6.2 Retrieval protocol

Platform-enforced retrieval order for legal questions (from the internal fleet protocol):

1. Primary law first. Snippets are discovery only; the engine retrieves and the workflow reads full sections before quoting.
2. Add the matching practice collection for the task domain.
3. Hybrid retrieval (vector + FTS) with authority weighting, source-diversity enforcement, deduplication, and **as-of date filtering** (jurisdiction + as-of date are required run parameters).
4. Verbatim quotations pass the quote verifier against source text before display as verified.
5. Current case law resolves to the official document; precedential status, rehearing, and subsequent history are checked via the citation graph.
6. Licensed secondary sources (if/when licensed) are labeled secondary and never substitute for primary verification.
7. Matter-private retrieval uses only that matter's index. No code path may search, cite, or learn from another matter or tenant.

Every answerable legal proposition returns: primary text and exact source, effective/publication/decision date, authority and precedential weight, supersession/subsequent history, separately labeled secondary explanation when useful, and a warning or refusal when the record is insufficient. MPEP and agency guidance are labeled as evidence of agency practice, not substitutes for statute, regulation, or controlling precedent.

### 6.3 Private retrieval (private application project)

- `tenant_private`: firm/company reusable sources and playbooks, tenant-isolated.
- `matter_private`: per-matter uploads, facts, and generated material, matter-isolated within the tenant.
- Private embeddings live in the private Supabase project; the public corpus lives in the corpus project; results merge only in the authorized orchestrator with source labels intact (no cross-database joins; separate credentials).

### 6.4 Licensing boundary (hard gate for corpus porting)

The internal corpus contains classes that MUST NOT ship without clearance:

| Internal class | Commercial disposition |
|---|---|
| Government works (MPEP, statutes, regulations, Federal Register, court/agency decisions) | Port after per-source terms check (bulk-access and API terms still apply) |
| Public patent data via official APIs | Port; respect USPTO API terms and rate agreements |
| EPO/WIPO/Hague materials | Port only per each organization's reuse terms; some require attribution or exclude redistribution |
| Practical Law / licensed commercial content | **Do not port.** Internal license only; commercial redistribution prohibited unless separately licensed |
| Recovered CLE/reference materials (treatises, seminar papers) | **Do not port** unless individually licensed |
| Schell IP playbook, client matters, agent memory | **Never.** (Invariant 7.12) |

A corpus/license audit (business proposal §10.5) is a Phase-1 exit criterion. The source registry records the license basis for every document; ingestion refuses sources without a license class.

### 6.5 Corpus operations

- Scheduled authority-refresh jobs per feed with change detection and release notes.
- Canonical builder: normalization, exact-dedup, near-duplicate aliasing, quarantine routing; quarantine is never retrieved in ordinary research.
- Corpus releases are immutable and versioned; a workflow run records the corpus release it retrieved against (reproducibility).

## 7. Non-negotiable invariants

Incorporates `PRD-wepatent.md` §5 invariants 1–12 wholesale (counsel/engagement separation, tenancy, RLS, reservation-before-run, draft labeling, no Schell IP confidential content). Additional professional-lane invariants:

13. Every legal proposition in work product is either cited to a retrievable source in the run's evidence set or labeled as analysis.
14. No fabricated quotation, citation, patent number, or reference identifier may survive the verification stage; verifier failure blocks "verified" status and flags the document.
15. Work-tier labels (5.3) cannot be removed or downgraded below platform policy by any role.
16. No workflow output is marked "approved" except by an authenticated human with the required role; model output can never set review state.
17. The platform never signs, certifies, files, communicates with the USPTO, or communicates with an end client on a user's behalf. Export and preparation only. (Connected-counsel filing runs under the separately gated counsel context per `PRD-wepatent.md`.)
18. Matter isolation is absolute: retrieval, prompts, caches, logs, and analytics never mix matters or tenants.
19. Customer content is never used to train models or improve the shared corpus; provider no-training configurations are mandatory.
20. Deadline surfaces always carry the not-a-docketing-system disclaimer; no deadline data leaves the workspace as an alert without an explicit user subscription.
21. R&D/contributor seats cannot invoke generation, claim, prosecution, or research workflows; enforcement is server-side role policy, not UI hiding.

## 8. Information architecture

### 8.1 Public routes

Per the business proposal §4.1 marketing structure: `/product/*` (invention-disclosures, application-drafting, office-actions, claim-strategy, patent-research, portfolio-analysis, prepare-and-file), `/patent-counsel/*`, `/models`, `/security`, `/pricing`, `/professionals`, `/teams`, `/resources`, `/legal/*`, `/login`, `/signup`.

### 8.2 Authenticated application routes

```text
/app
├── /home                     dashboard, review queue, deadline surface
├── /matters                  tenant-isolated matter workspaces
│   └── /[matterId]
│       ├── /chat             grounded conversational workspace
│       ├── /facts            canonical fact ledger with provenance states
│       ├── /sources          uploads, patents, authorities, extraction state
│       ├── /workflows        guided associate workflows (Section 5.1)
│       ├── /documents        generated versions, exports, manifests
│       ├── /claims           claim tree, versions, deterministic check results
│       ├── /citations        authority panel, verification states
│       ├── /reviews          tier queue, critic reports, human approvals
│       ├── /counsel          connected-counsel status (shared platform)
│       └── /activity         audit trail
├── /portfolio                cross-matter dashboards (role-gated)
├── /review-queue             practitioner's pending Tier-B/C items across matters
├── /templates                style profiles and firm playbooks
├── /knowledge                corpus browser: sources, releases, effective dates
├── /usage                    wallet, spend, estimates, invoices
├── /team                     members, seats, roles
└── /settings                 models, privacy/retention, integrations, billing
```

### 8.3 Composer contract

Per the design handoff: every run specifies task, jurisdiction + as-of date, matter/fact selection, source selection, model tier or explicit model (Fast / Advanced / Frontier, with provider-model picker including Grok, Claude, and GPT options), deliverable type, quality controls (source-required, second-model review, quote verification), and shows the estimated charge range and wallet sufficiency before execution. Three-pane response layout: facts/sources/workflow left; work product center; citations, model identity, cost, warnings, and review state right.

## 9. Core user flows

### 9.1 Tenant, seats, and matter setup

1. Practitioner signs up, creates organization, selects plan.
2. Invites seats with roles (9 roles, FR-2); contributor invitations clearly labeled as non-practitioner seats.
3. Creates a matter workspace: matter name/number, jurisdiction, technology area, style profile, optional conflict-tag metadata (client/adverse party names for the tenant's own conflict hygiene — never analyzed cross-tenant).
4. Versioned professional-lane clickwrap before first substantive use: supervision acknowledgment (user is or works under a responsible practitioner; outputs are drafts requiring professional review; no attorney-client relationship with the platform; not a docketing system; confidentiality and provider-processing disclosure).

**Acceptance criteria:** as `PRD-wepatent.md` §7.1–7.2 (auth, tenancy, idempotent invites, server-side acceptance records), plus: contributor seats verifiably cannot reach practitioner workflows via direct API calls.

### 9.2 Invention intake → application draft (flagship workflow)

1. Upload disclosure materials and/or run the structured interview.
2. Lex extracts the fact ledger; facts carry provenance states; missing-fact prompts route to assigned contributors.
3. Practitioner approves the fact baseline (approval recorded; drafting is blocked on zero approved facts).
4. Claim-concept and fallback-tree generation (Tier B); practitioner selects/edits strategy skeleton (Tier C decision recorded).
5. Section drafting from approved facts; deterministic checks (antecedent basis, dependencies, numeral consistency) run automatically; failures annotate the draft.
6. Second-model critique produces the critic report.
7. Quote/citation verifier resolves every authority reference.
8. Practitioner reviews in the three-pane workspace; edits tracked as versions; approves sections individually.
9. Export DOCX (USPTO-formatted) + review checklist + source index + manifest.

**Acceptance criteria**

- No drafting run starts without approved facts and a recorded strategy selection.
- Every draft displays: model + version, corpus release, cost estimate vs. actual, tier, verification state, unresolved flags.
- Deterministic check failures cannot be dismissed silently; dismissal requires a reason recorded in the audit log.
- Export manifests are version-locked; later edits create new versions, never mutate exported artifacts.

### 9.3 Office-action response

1. Upload OA, pending claims, specification, cited references.
2. Lex parses rejections into the evidence-linked rejection matrix (claim × statute × reference, with pinpoint cites).
3. Response-path options with tradeoff/estoppel flags (Tier C decision support).
4. Practitioner selects path; Lex drafts amendments (MPEP markup) separately from arguments (Tier B).
5. Verification pass: quotes from references and OA checked against source text.
6. Practitioner review → versioned export (response shell or outline per style profile).

**Acceptance criteria:** rejection matrix links every cell to source evidence; amendment markup is mechanically valid; no argument text asserts unverified reference content; estoppel flags appear in the export's review checklist.

### 9.4 Search report

1. Define search scope from fact ledger or manual input.
2. Lex runs public-data search orchestration; results deduplicated and ranked with per-reference relevance rationale.
3. Report generated in the tenant's search-report style; every characterization of a reference links to the reference text.
4. Optional: IDS packet preparation from the finalized report (Tier A) with SB/08 field validation.

### 9.5 Research memo

Per the retrieval protocol (6.2): issue decomposition → primary-authority retrieval → memo with authority hierarchy, as-of dating, supersession checks, labeled analysis, and explicit uncertainty/refusal behavior. Memo export includes the full source trail so a second reviewer can reproduce it.

### 9.6 Review queue and approvals

1. `/review-queue` aggregates pending Tier-B/C items across the practitioner's matters, oldest-deadline-first.
2. Each item shows the critic report, verification state, deterministic-check results, and diff vs. prior version.
3. Approve / request-changes / reject; every decision recorded with actor, timestamp, and document-version hash.
4. Approval unlocks export-as-approved; unapproved exports remain watermarked "DRAFT — NOT REVIEWED."

### 9.7 Connected counsel touchpoint

Professional-lane users can route work to connected counsel (overflow, conflicts, filing needs) through the same gated state machine defined in `PRD-wepatent.md` §7.6. No professional-lane shortcut skips conflict intake or engagement gates.

## 10. Functional requirements

### FR-1 Authentication and sessions

As `PRD-wepatent.md` FR-1, plus: SSO/SAML and SCIM for Enterprise (Phase 4); MFA required for `owner`, `practitioner_admin`, and counsel-context roles at GA.

### FR-2 Authorization and tenancy

- Roles: `owner`, `practitioner_admin`, `practitioner`, `agent_operator`, `contributor` (R&D seat), `viewer`, `counsel_intake`, `counsel_attorney`, `platform_support`.
- Workflow invocation, tier actions, approval rights, export rights, and portfolio visibility are role-gated server-side (policy table, not route checks alone).
- Matter-level ACLs within a tenant (a contributor sees only assigned matters).
- RLS on every tenant-bearing table; cross-tenant and cross-matter isolation tests in CI.

### FR-3 Matters and facts

- Matter workspaces with style profile, jurisdiction, technology tags, and lifecycle state (active/closed/purged).
- Fact ledger with provenance states, versioning, approval events, and contributor attribution.
- Immutable audit events for all material actions.

### FR-4 Source management

As `PRD-wepatent.md` FR-4 (signed uploads, validation, malware scan, quarantine, async OCR/extraction, tenant-scoped embeddings), plus: patent-document awareness (auto-detect published patents/applications and link to public-corpus records rather than duplicating them), and page/paragraph coordinate preservation for pinpoint citations.

### FR-5 Knowledge and retrieval service

- Public corpus project with the layer model of Section 6.1, registry, releases, and refresh jobs.
- Hybrid retrieval API with authority weighting, diversity, as-of filtering, and quote verification endpoints.
- Citation-graph queries for supersession/treatment checks.
- Private retrieval namespaces per Section 6.3.
- License-class enforcement at ingestion and at retrieval (a source without a commercial-clear license class is unreachable in production).

### FR-6 Model gateway

As `PRD-wepatent.md` FR-5 (provider adapters for OpenAI, Anthropic, xAI; effective-dated price registry; allowlists; caps; kill switches; structured outputs; no provider keys client-side), plus: per-workflow model routing policy with explainable "Auto" selection; side-by-side model comparison runs; second-model critique orchestration (critic model must differ from the drafting model).

### FR-7 Workflow orchestration

- Durable job state machine per run: `QUEUED → INGESTING → RETRIEVING → GENERATING → VERIFYING → RENDERING → COMPLETED | FAILED | CANCELLED`, checkpointed per stage; retries never repeat a billable call with unknown prior outcome.
- Workflow definitions are versioned platform artifacts; a run records workflow version + model + corpus release + style profile version.
- Deterministic checkers (claims, antecedent basis, numerals, SB/08 validation) run as separate stages with machine-readable results.

### FR-8 Review, approval, and export

- Tier queue, approval events, version diffing, watermark rules (9.6).
- DOCX export in USPTO-ready formatting per style profile; PDF rendering; export manifests with checksums and full provenance (model, corpus release, verification results, approvals).
- Claim charts and rejection matrices export as structured tables, not flattened prose.

### FR-9 Billing

As `PRD-wepatent.md` FR-6 (Stripe, wallet, reservation/settlement, ×1.50 markup, effective-dated rates), with professional-lane plans:

| Plan | Monthly fee | Included usage credit | Intended customer |
|---|---:|---:|---|
| Explore | $0 trial, no confidential uploads | Small one-time credit | Evaluation |
| Professional | $149 | $30 | Solo attorneys/agents |
| Team | $499 (5 seats) | $100 pooled | Boutiques, in-house teams |
| Enterprise | Custom | Negotiated | Firms, legal departments |

Plus optional per-run workflow fees (application-drafting orchestration, OA package, citation verification, multi-model second opinion) displayed before execution per the business proposal. All amounts are test-mode defaults; live pricing is approval-gated (Section 20).

### FR-10 Audit and observability

As `PRD-wepatent.md` FR-7, plus: per-matter audit export for a tenant's own compliance needs; reviewer-decision logs; no prompt bodies, matter content, or conflict metadata in analytics or error tracking.

## 11. Data model

Extends the `PRD-wepatent.md` §9 private-project schema. Renames/additions for the professional lane:

- `matters` (supersedes `inventions` semantics here), `matter_acl`, `matter_facts`, `fact_events`
- `style_profiles`, `playbook_entries` (tenant-isolated, hash-chained approvals)
- `workflow_definitions`, `workflow_runs`, `run_stages`, `deterministic_check_results`
- `claims`, `claim_versions`, `claim_tree_edges`
- `rejections`, `rejection_matrix_cells` (evidence-linked)
- `search_reports`, `search_references`, `ids_packets`, `ids_citations`
- `critic_reports`, `verification_results`, `review_items`, `review_decisions`
- `deadline_observations` (with mandatory disclaimer flag; never authoritative)
- `portfolio_views` (materialized, role-gated)

Public corpus project: `public_documents`, `public_document_versions`, `public_sections`, `public_embeddings`, `authority_effective_dates`, `license_provenance`, `corpus_releases`, `citation_edges`, `prosecution_outcomes`.

Shared tables (billing, usage, counsel, audit, retention) are common platform schema per `PRD-wepatent.md`.

## 12. API and service contracts

Extends `PRD-wepatent.md` §10 conventions (auth, authorization, Zod validation, size limits, idempotency on money/jobs, generic external errors). Professional-lane endpoints:

```text
GET|POST  /api/matters
GET|PATCH /api/matters/:id
POST      /api/matters/:id/facts          (+ /facts/:factId/approve)
POST      /api/matters/:id/uploads/sign
POST      /api/matters/:id/runs/estimate
POST      /api/matters/:id/runs           (workflowKey, model, params)
GET       /api/runs/:id                   (stage, checkpoints, cost)
POST      /api/runs/:id/cancel
GET       /api/matters/:id/documents
POST      /api/documents/:id/export
GET       /api/review-queue
POST      /api/review-items/:id/decision
GET|POST  /api/style-profiles
GET|POST  /api/playbook
GET       /api/knowledge/search           (public corpus, license-gated)
GET       /api/knowledge/verify-quote
GET       /api/portfolio/summary
```

Counsel, billing, and webhook endpoints are shared platform contracts.

## 13. Security, privacy, and professional-responsibility requirements

Incorporates `PRD-wepatent.md` §11 (trust boundaries and required controls) and the ethics memo's controls, with professional-lane emphasis:

- **Confidentiality posture:** treat all matter content as highly sensitive; provider calls use no-training/enterprise configurations, shortest feasible retention, U.S. processing at launch; documented subprocessors; DPA available for Team/Enterprise.
- **Privilege hygiene:** platform makes no privilege claims; documentation warns that platform processing is not itself privileged communication and supports customers' own Upjohn/privilege workflows by keeping legal-analysis artifacts segregated and access-controlled.
- **Export control screening:** technology-category screening at matter creation; sensitive categories (defense, nuclear, encryption per EAR/ITAR indicators) halt automated processing pending qualified human review; no foreign inference routing for flagged matters.
- **Prompt-injection defense:** uploaded and retrieved documents are evidence, never instructions; retrieval content is structurally separated from system policy; model output cannot trigger external actions (Invariant 17).
- **Marketing substantiation file:** every public performance claim maps to evaluation evidence (FTC/DoNotPay lesson from the ethics memo).

## 14. Quality and evaluation harness

The internal 400-question benchmark architecture becomes the product's release gate system.

- **Benchmark suite:** source-grounded questions across prosecution, drafting, PTAB, litigation, PCT/EPO, design, and technology domains (software, mechanical, chemical, biotech). Rubric dimensions: retrieval correctness, supersession handling, quotation fidelity, family normalization, deadline identification, claim-scope preservation, cross-matter leakage (must be zero), refusal-to-guess behavior, and concurrent reliability.
- **Attorney validation:** machine-seeded cases are labeled pending until a qualified practitioner validates questions, source keys, and rubrics. Public quality claims may only cite attorney-validated results.
- **Per-workflow release gates:** a workflow ships to production only when it meets its threshold on the validated suite plus workflow-specific metrics: unsupported-proposition rate, citation validity rate, deterministic-check pass rate, and (for drafting) reviewer-edit burden measured with design partners.
- **Regression:** every model change, prompt change, corpus release, or routing change re-runs the suite; regressions block deployment.
- **Live telemetry:** sampled human review of production outputs (with tenant consent and content-free metrics where possible): verifier failure rates, refusal rates, reviewer rejection rates per workflow.

## 15. Accessibility and UX quality

As `PRD-wepatent.md` §12 (WCAG 2.2 AA and all listed requirements), plus the design-handoff mandates: three-pane workbench density standards, visible tier/review/draft status in every state including print and export, no fake metrics, and the visual posture defined in `DESIGN-HANDOFF.md`.

## 16. Testing strategy

As `PRD-wepatent.md` §13 (unit, integration, E2E, release gates) with additions:

- Unit: deterministic checkers (claim dependency, antecedent basis, SB/08 validation) against fixture corpora of known-good and known-bad documents.
- Integration: retrieval protocol ordering, as-of filtering, license-class blocking, quote-verifier behavior on tampered fixtures, critic-model independence.
- E2E: full intake→draft→review→export flow on a synthetic matter; OA flow on a synthetic office action; contributor-seat privilege escalation attempts; cross-matter retrieval denial.
- Evaluation harness (Section 14) runs in CI on a smoke subset and full suite pre-release.

## 17. Performance and reliability targets

As `PRD-wepatent.md` §14, plus: composer estimate response ≤ 2 s p75; retrieval queries ≤ 1.5 s p75; long drafting runs stream stage progress with per-stage checkpoints; verification stage adds no more than 25% to total run wall-time at p75.

## 18. Implementation phases

Sequenced against the shared platform (wepatent phases 0–3 build most common infrastructure; Lex phases interleave):

### Phase L0 — Capability port and corpus audit

- Inventory-complete port plan from the internal agent: workflow definitions, style rules, retrieval protocol, benchmark suite (this PRD is the map).
- Corpus/license audit (6.4) with counsel; produce the commercial source registry.
- Design-partner recruitment: 10–15 patent professionals per business proposal Phase 0, targeting all three buyer personas.

### Phase L1 — Professional MVP

- Matter workspaces, fact ledger, sources, roles/seats.
- Public corpus v1: primary law + authority feeds + public patent data; retrieval + quote verifier.
- Three flagship workflows: invention disclosure→draft, OA analysis, cited research memo.
- Model gateway with OpenAI + Anthropic; DOCX export; wallet billing; audit log.
- Evaluation smoke suite gating.

### Phase L2 — Full associate surface

- Claim-tree tooling, search reports + IDS, 132 declarations, design-patent workflows, figure audit.
- Second-model critique, deterministic checkers, review queue.
- Style profiles and tenant playbooks.
- xAI/Grok models after gateway/billing validation.
- Attorney-validated benchmark gates; design-partner time studies (substantiation file).

### Phase L3 — Team and portfolio

- Team seats, matter ACLs, contributor (R&D) seats, pooled billing.
- Portfolio dashboards, prosecution-precedent engine queries, deadline surface.
- Retention/deletion controls, DPA process.

### Phase L4 — Enterprise and connected counsel

- SSO/SAML, SCIM, enterprise agreements, audit exports.
- Connected-counsel touchpoints live (shared platform Phase 4 dependency).
- SOC 2 readiness program.

### Phase L5 — General availability

As `PRD-wepatent.md` Phase 5: final legal review, security assessment, accessibility audit, provider configuration review, runbooks, launch gates — plus the public substantiation file for all performance claims.

## 19. Out of scope for initial release

Everything in `PRD-wepatent.md` §16, plus:

- Autonomous or credentialed USPTO Patent Center interaction from the professional lane (preparation and export only; supervised counsel filing lives in the counsel context).
- Docketing system of record or deadline guarantees.
- Non-U.S. filing workflows (international authorities are research-grounding only).
- Licensed secondary corpus content (Practical Law or equivalents) before a commercial license exists.
- Cross-tenant benchmarking, analytics, or "firms like you" features.
- Client-facing (end-client) portals or communications.
- Litigation drafting (briefs, contentions) — research grounding exists in the corpus, but litigation work product is a later, separately evaluated surface.

## 20. Approval-gated decisions

All eight gates from `PRD-wepatent.md` §17 apply identically. Additional professional-lane gates requiring Jeff's explicit approval:

9. The commercial source registry (which corpus classes ship) after the license audit.
10. Any use of Schell IP playbook or style content in the product (default: no).
11. Publishing any performance, throughput, or cost-comparison claim (the "junior associate alternative" economics) and the evaluation evidence behind it.
12. Per-workflow production enablement (each workflow's evaluation gate sign-off).
13. Enabling xAI/Grok models for customer traffic.
14. Final pricing, plan structure, and workflow fees.

## 21. Open items and dependencies

1. **Trademark/domain screening** for "Lex Patent Studio" (business proposal §9.3) — before public naming.
2. **Entity structure** for the SaaS vs. Jeff's law practice (proposal §9.9) — before connected-counsel touchpoints and before any revenue.
3. **Corpus refresh cadence and API agreements** (USPTO ODP terms, CourtListener/official court sources, EPO/WIPO reuse terms) — Phase L1.
4. **Internal-agent asset extraction:** porting workflow prompts, style rules, and benchmark content from the internal Hermes environment into versioned platform artifacts in this repository — with a privilege/confidentiality review pass so no client-derived examples travel with them.
5. **Design-partner agreement template** (confidentiality, synthetic-data defaults, feedback license).

## 22. Definition of done

Lex Patent Studio is production-grade only when:

- The Section 5 capability inventory is implemented as versioned, evaluation-gated workflows — not demo prompts.
- The Section 6 knowledge system serves only license-cleared sources, with the full retrieval protocol and quote verification enforced server-side.
- Every invariant in Section 7 has a corresponding automated test or CI gate.
- The review/approval loop, tier system, and export manifests operate end to end with immutable audit evidence.
- Billing reconciles: reservation → provider usage → wallet ledger → Stripe, idempotently.
- The attorney-validated evaluation suite gates every shipped workflow, and the substantiation file supports every public claim.
- All release gates pass with fresh evidence, production policies are approved, and Jeff explicitly approves public deployment, live billing, provider enablement, pricing, and each workflow's production activation.
