# Lex Patent Studio
## Proposed Business Model, Product Structure, and Vercel/Supabase Architecture

**Status:** Concept proposal for founder review
**Working name:** Lex Patent Studio
**Product category:** Subscription + metered-usage AI workspace for patent drafting, prosecution analysis, portfolio strategy, and research
**Important positioning:** Two separately branded products on one controlled agent platform: Lex Patent Studio for supervised patent professionals and wepatent for non-lawyer invention documentation and counsel readiness. Neither is a public “clone of Grok,” and the non-lawyer lane is not a law firm, legal advice, or a substitute for counsel.

---

# 1. Executive recommendation

Build **Lex Patent Studio** as a multi-model, source-grounded patent workbench with four revenue layers:

1. **Monthly platform subscription** for access, secure workspaces, public patent-law retrieval, document templates, project history, exports, and collaboration.
2. **Metered model usage** billed at the provider’s actual token cost plus **50% markup**.
3. **Optional premium workflow fees** for high-value jobs whose cost is not captured well by tokens alone—large prior-art reviews, document assembly, citation verification, portfolio maps, and human attorney review.
4. **Connected patent counsel services** through a prominent “Meet with Patent Counsel to Evaluate, Prepare & File” pathway. The initial connected lawyer is Jeff; later, the platform can add vetted patent attorneys under separate engagement, conflicts, professional-responsibility, and fee arrangements.

The best first market is **patent professionals**. Launch the professional product as **Lex Patent Studio**, marketed to law-firm leaders and in-house counsel as **“Your next patent associate”**: a supervised, source-grounded drafting and analysis system that augments—not replaces—the responsible practitioner.

Launch the non-lawyer experience as **wepatent** under a **different public brand, domain, visual identity, onboarding flow, terms, analytics property, and customer communications**. It is positioned as an invention-documentation and counsel-readiness workspace for VCs, early-stage companies, R&D departments, and founders—not as a lawyer or law firm. Its generated materials remain drafts, and users must affirmatively agree that (1) outputs are not legal advice and (2) patent-related draft documents must be reviewed and approved by qualified patent counsel before filing, reliance, disclosure, transaction use, or other legal action.

The products may share an underlying agent platform, model gateway, source corpus, evaluation harness, and document engine. They must not share confusing public positioning or bypass lane-specific permissions, prompts, output controls, acceptance records, or legal boundaries.

## 1.1 Two-brand architecture

| Product | Audience | Public promise | Hard boundary |
|---|---|---|---|
| **Lex Patent Studio** | Law-firm leaders, patent attorneys/agents, and in-house counsel | **Your next patent associate.** Source-grounded drafting, prosecution analysis, and portfolio work under practitioner supervision. | The responsible practitioner independently reviews all work and controls legal judgment, client communications, signatures, deadlines, and filings. |
| **wepatent** | VCs, founders, early-stage companies, R&D departments, and innovation teams | Organize invention facts, create counsel-ready working drafts, and prepare better patent conversations. | Not a law firm; no legal advice or representation; drafts are not filing-ready; qualified patent counsel review and approval are required before legal reliance or use. |

Do not market the non-lawyer product as “your patent associate,” “AI patent lawyer,” “lawyer-quality,” “file without counsel,” or a substitute for an attorney. Do not let a shared login, shared billing page, or shared customer-support identity blur which entity and terms govern the user’s session.

## Core differentiation

- Patent-specific workflows rather than a generic chatbot.
- Choice of top OpenAI, Anthropic, and xAI models within one workspace.
- Public patent-law and patent-data retrieval with exact citations and effective dates.
- Structured matter/project memory that is isolated by tenant.
- Deliverables in attorney-usable DOCX/PDF formats.
- Transparent model cost and quality options.
- Side-by-side model comparison and “second-model review.”
- Reliability controls: claim charts, source panels, confidence flags, missing-fact prompts, and attorney approval checkpoints.

---

# 2. Business model

## 2.1 Target customer sequence

### Beachhead: patent professionals

1. Solo patent attorneys and agents.
2. Small IP boutiques.
3. In-house patent teams and corporate legal departments.
4. Patent search, licensing, and diligence professionals.

These users understand the limits of generated work, can verify legal outputs, and attach meaningful economic value to time saved.

### Later segments

- Inventors preparing invention disclosures before engaging counsel.
- Universities and technology-transfer offices.
- Investors conducting patent diligence.
- Engineering teams building patent portfolios.
- Larger law firms requiring SSO, audit logs, retention controls, and negotiated data terms.

## 2.2 Jobs to be done

| Job | Primary user | Output |
|---|---|---|
| Convert an invention interview into a structured disclosure | Inventor / attorney | Invention disclosure DOCX |
| Draft application sections | Patent professional | Background, summary, detailed description, abstract |
| Develop claim strategy | Attorney / agent | Claim tree, fallback positions, claim set draft |
| Analyze an office action | Patent professional | Rejection map, cited-reference matrix, response options |
| Prepare amendment/response strategy | Patent professional | Proposed amendments and argument outline |
| Compare claims to references or products | Attorney / analyst | Claim chart with source links |
| Research patent law and USPTO practice | Patent professional | Cited research memo with authority hierarchy |
| Review a portfolio | In-house / founder | Family map, coverage gaps, filing priorities |
| Perform model-based QA | Patent professional | Separate critic report, unsupported-claim list |
| Meet with patent counsel | Inventor / founder | Counsel consultation, issue list, recommended protection path |
| Prepare and file through counsel | Engaged legal client | Attorney-approved application and filing receipt |

## 2.3 Revenue model

### Recommended launch plans

| Plan | Suggested price | Included platform value | Included usage credit | Best for |
|---|---:|---|---:|---|
| Explore | $0 or 7-day trial | Limited demo workspace; no confidential uploads; capped exports | Small one-time trial credit | Evaluation |
| Solo | $49/month | 3 active projects, public patent RAG, DOCX export, standard templates | $10 retail usage credit | Inventors and occasional users |
| Professional | $149/month | Unlimited projects, advanced workflows, model comparison, citation verifier, reusable templates | $30 retail usage credit | Patent attorneys/agents |
| Team | $499/month | 5 seats, shared workspaces, roles, audit log, retention settings, pooled usage | $100 retail usage credit | Boutiques/in-house teams |
| Enterprise | Custom | SSO/SAML, SCIM, private deployment options, DPA, custom retention, volume pricing | Negotiated | Firms and legal departments |

**Pricing is a starting hypothesis, not a final conclusion.** Validate willingness to pay with 10–15 design partners before locking it.

### Usage pricing rule

For every provider usage event:

```text
retail_usage_charge = actual_provider_token_cost × 1.50
```

Track input, cached input, output, reasoning, batch, and tool charges separately where the provider exposes them. Store the provider price version used for each event.

**Important economic distinction:** A 50% markup on cost produces a **33.3% gross margin on usage revenue**, before payment fees and infrastructure.

```text
cost = $1.00
customer charge = $1.50
usage gross profit = $0.50
gross margin = $0.50 / $1.50 = 33.3%
```

The subscription—not token resale—should carry most of the software gross margin and fund retrieval, storage, document rendering, support, and product development.

### Illustrative model menu and rates as of July 30, 2026

The product should generate this table from the live, effective-dated price registry rather than hard-code it. Prices below are standard first-party API rates per 1 million tokens; customer rates apply the requested 1.50× multiplier.

| Provider/model | Context | Provider input / cached / output | Customer input / cached / output | Suggested product tier |
|---|---:|---:|---:|---|
| OpenAI GPT-5.6 Sol | 1.05M | $5 / $0.50 / $30 | $7.50 / $0.75 / $45 | Frontier strategy and final review |
| OpenAI GPT-5.6 Terra | 1.05M | $2 / $0.20 / $12 | $3 / $0.30 / $18 | Default drafting and revision |
| OpenAI GPT-5.6 Luna | 1.05M | $0.20 / $0.02 / $1.20 | $0.30 / $0.03 / $1.80 | Extraction, classification, formatting |
| Anthropic Claude Fable 5 | 1M | $10 / $1 / $50 | $15 / $1.50 / $75 | Highest-priced complex review |
| Anthropic Claude Opus 5 | 1M | $5 / $0.50 / $25 | $7.50 / $0.75 / $37.50 | Premium drafting and claim strategy |
| Anthropic Claude Sonnet 5 | 1M | $2 / $0.20 / $10 | $3 / $0.30 / $15 | Default production tier while introductory pricing applies |
| Anthropic Claude Haiku 4.5 | 200K | $1 / $0.10 / $5 | $1.50 / $0.15 / $7.50 | Fast intake and document routing |
| xAI Grok 4.5 | 500K | $2 / $0.30 / $6 | $3 / $0.45 / $9 | Premium Grok reasoning and multimodal work |
| xAI Grok 4.3 | 1M | $1.25 / $0.20 / $2.50 | $1.875 / $0.30 / $3.75 | Lower-cost long-context Grok option |

Pricing qualifications that must be represented in the registry and pre-run estimate:

- OpenAI publishes higher long-context rates: Sol $10 / $1 / $45; Terra $4 / $0.40 / $18; Luna $0.40 / $0.04 / $1.80. Confirm the official threshold before implementation.
- OpenAI separately prices cache writes: Sol $6.25, Terra $2.50, and Luna $0.25 at short context, with doubled long-context cache-write rates.
- Anthropic cache writes cost 1.25× base input for five-minute caching and 2× for one-hour caching; cache reads cost 0.1× base input.
- Claude Sonnet 5's $2 / $0.20 / $10 introductory pricing ends August 31, 2026; on September 1, 2026, provider rates become $3 / $0.30 / $15, making customer rates $4.50 / $0.45 / $22.50.
- xAI long-context rates apply to all request tokens at 200K prompt tokens: Grok 4.5 becomes $4 / $0.60 / $12 provider and $6 / $0.90 / $18 customer; Grok 4.3 becomes $2.50 / $0.40 / $5 provider and $3.75 / $0.60 / $7.50 customer.
- Apply the 1.50× markup to cache writes, long-context premiums, regional/data-residency uplifts, tools, and other provider charges—not only base text tokens.
- OpenAI and Anthropic list 50% batch discounts for many models; xAI lists a 20% batch discount for Grok 4.3. Decide whether customer rates pass through those savings or preserve part as platform margin, and disclose the rule.

Official sources:

- [OpenAI API pricing](https://platform.openai.com/docs/pricing) and [OpenAI model catalog](https://platform.openai.com/api/docs/models)
- [Anthropic Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [model overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [xAI API pricing](https://docs.x.ai/developers/pricing) and [model catalog](https://docs.x.ai/developers/models)

These rates are snapshots. Provider terms, availability, context thresholds, data handling, and model capabilities must be versioned and rechecked before enabling a model.

### Recommended billing mechanism

**MVP:** subscription plus a prepaid usage wallet.

- User subscribes through Stripe.
- Included monthly usage credit is deposited into the workspace wallet.
- Additional usage is purchased in $20/$50/$100/$250 top-ups.
- Before a run, show a range estimate and verify wallet balance.
- After the run, debit the exact calculated retail charge from the immutable usage ledger.
- Team plans pool wallet balances across seats.
- Optional auto-reload requires explicit customer opt-in and a configurable threshold.

This avoids bad debt and is easier to reconcile than sending millions of token events directly to Stripe. A later enterprise version can support monthly postpaid invoicing and spending commitments.

### Non-token workflow fees

Token markup alone will underprice valuable workflows and may not cover non-model costs. Consider fixed fees shown before execution:

| Workflow | Suggested additional fee |
|---|---:|
| Full application drafting orchestration | $10–$40/run |
| Office action analysis package | $5–$20/run |
| Citation/quotation verification | $2–$10/run |
| Multi-model second opinion | Token usage + $2–$10 orchestration |
| Large document ingestion/OCR | Per page or per GB |
| Connected patent counsel | Separately quoted; conflict check and lawyer engagement required |

Do not hide these charges inside token rates. Display them as workflow, retrieval, or review fees.

### Connected patent counsel revenue

Add a separately presented legal-services lane:

| Offering | Commercial structure | Notes |
|---|---|---|
| Patent counsel evaluation | Fixed consultation fee, optionally credited to an engagement | Conflict check before substantive advice |
| Patentability/filing strategy | Fixed fee or scoped estimate | Search and written opinion priced separately when appropriate |
| Provisional preparation and filing | Separate counsel engagement and fixed/scoped legal fee | Government fees, drawings, and special work itemized |
| Nonprovisional preparation and filing | Separate counsel engagement and fixed/scoped legal fee | Scope driven by complexity, claim strategy, and disclosure readiness |
| Prosecution and later filings | Separate matter phases or subscription outside the SaaS plan | Office actions, continuations, PCT/foreign, IDS, appeals, and maintenance are separate scopes |

Keep three money flows distinct in the ledger and customer-facing documents:

1. **Software subscription revenue** paid to Lex Patent Studio.
2. **AI/model and workflow usage revenue** paid to Lex Patent Studio.
3. **Legal fees and official disbursements** paid under the connected lawyer/law firm's engagement terms and handled in accordance with applicable trust-account, fee-sharing, refund, and professional-responsibility rules.

Do not take a percentage of counsel's legal fee or commingle legal retainers with the SaaS wallet unless ethics counsel has approved the exact entity, ownership, referral, and payment structure. For the initial Jeff-led version, the cleanest launch structure is a direct engagement between the customer and Jeff's disclosed law firm, with Lex providing the intake, drafting workspace, status interface, and authorized technology support.

## 2.4 Unit economics to instrument

| Metric | Target or purpose |
|---|---|
| Subscription gross margin | >80% before support at maturity |
| Usage gross margin | ~33.3% by design before ancillary costs |
| Blended gross margin | >65% initially; >75% at scale |
| Provider cost as % of revenue | <25% blended |
| Contribution margin by workflow | Positive for every production workflow |
| Activation | First grounded deliverable exported within 24 hours |
| Professional retention | >85% monthly logo retention after fit |
| Expansion | Seats, wallet reloads, and premium workflows |
| Reliability | Unsupported legal proposition rate and citation validity |
| Time saved | User-reported and sampled task-time delta |

---

# 3. Product positioning and legal boundary

## 3.1 Recommended positioning

### Lex Patent Studio — professional product

**Primary headline:** “Your next patent associate.”

**Supporting promise:** “Turn invention facts, prosecution records, and primary authorities into structured, source-grounded patent work product—under the review and control of your responsible practitioner.”

The phrase is a marketing metaphor, not an assertion that the software is a licensed person, employee, attorney, agent, or autonomous legal-service provider. Substantiate performance claims with workflow-specific evaluations; do not claim human-attorney equivalence.

### wepatent — non-lawyer product

**Primary headline:** “Turn invention work into counsel-ready materials.”

**Supporting promise:** “Organize technical facts, contributors, disclosure history, and draft documents so qualified patent counsel can review the record and advise you.”

The non-lawyer product must use education, organization, issue spotting, and user-directed drafting—not individualized legal conclusions or autonomous filing strategy.

Avoid public claims such as:

- “AI patent lawyer.”
- “Get a patent without an attorney.”
- “Guaranteed allowance.”
- “A clone of Grok.”
- “All patent knowledge.”

Use defensible language such as:

- “Public patent authorities and selected licensed sources.”
- “Drafting and analysis assistance.”
- “Attorney review recommended/required for legal work.”
- “Sources and effective dates shown where available.”

## 3.2 Non-negotiable product controls

- Clear separation between (a) use of the software, which does not itself create an attorney-client relationship, and (b) an accepted connected-counsel engagement, which does create the relationship described in the engagement letter.
- Jurisdiction selector, with U.S.-only functionality at launch unless a workflow is expressly supported.
- Prominent warnings before any deadline, filing, legal conclusion, or reliance-sensitive output.
- No filing, client communication, signature, certification, fee authorization, or submission without the responsible lawyer's review and the client's required approval. Automation may prepare and transmit a reviewed filing package through counsel-controlled credentials, but it may not make the filing decision autonomously.
- Source citations beside legal propositions; snippets are not sufficient.
- Exact-quote verification against the underlying source.
- Separate “model generated” and “source retrieved” layers in the UI.
- User confirmation that they have rights to uploaded material.
- Tenant-isolated storage and retrieval; no cross-customer learning.
- No training on customer content by Lex Patent Studio.
- Provider configurations that disable model training/data retention where contractually available.
- Retention controls and hard deletion workflow.
- Licensed sources must not be redistributed or embedded in a public corpus unless the license expressly permits it.
- Public patent corpus and private customer workspaces must be physically/logically separated.
- Collect the minimum party/adverse-party data needed for conflict screening before inviting substantive invention disclosure.
- Do not provide substantive legal advice until conflicts clear and counsel accepts the engagement.
- Keep rejected/prospective-client intake subject to a short, documented retention policy and restricted access.
- Record the responsible attorney, engagement scope, client authorization, signatures, official fees, submission event, and filing receipt for each counsel-led filing.

## 3.3 Recommended launch boundary

Launch with **two expressly separated lanes**:

1. **Self-service software:** supervised drafting and analysis; no attorney-client relationship; outputs remain drafts.
2. **Meet with Patent Counsel — Evaluate, Prepare & File:** a connected-counsel workflow in which the user submits limited conflict/intake information, Jeff performs the initial conflict and suitability review, the user signs the disclosed law firm's engagement letter, and counsel supervises preparation and filing.

The platform can automate intake, scheduling, fact extraction, draft assembly, review routing, signature collection, fee calculation, filing-package generation, status updates, and receipt storage. Jeff remains responsible for legal advice, scope, claims, certifications, signature posture, filing authorization, and use of Patent Center credentials. The client must approve the final application and all required declarations/authorizations before filing.

Have ethics/product counsel review the entity structure, ownership, marketing, fee flows, referral arrangements, conflicts procedure, prospective-client confidentiality, engagement documents, disclaimers, privacy policy, provider terms, malpractice coverage, and jurisdiction coverage before public release.

## 3.4 Non-lawyer clickwrap and output controls

Before a non-lawyer can enter invention facts, run a legal-adjacent workflow, export a patent document, or request filing support, require unchecked-box clickwrap that records the exact terms version, user, organization, timestamp, and product lane. The acceptance should cover, in plain language:

1. The software operator is not acting as the user’s lawyer and the self-service product does not provide legal advice.
2. Account creation, payment, chat, uploading, document generation, or support contact does not create an attorney-client relationship.
3. Outputs are automated working drafts that may be inaccurate, incomplete, outdated, unsuitable for a jurisdiction, or harmful if relied on without review.
4. The user—not the software—selects inputs and remains responsible for accuracy, completeness, deadlines, disclosure decisions, inventorship/ownership facts, and use of outputs.
5. Patent-related documents must be reviewed and approved by qualified patent counsel before filing, legal reliance, disclosure, fundraising/diligence use, or other consequential action.
6. The service does not monitor deadlines, guarantee patentability, clearance, validity, enforceability, ownership, noninfringement, allowance, or any outcome.
7. Self-service communications are not promised to be privileged or confidential as attorney-client communications; sensitive, export-controlled, classified, and third-party-confidential material is restricted as described in the data policy.
8. Counsel access is separate: representation begins only after conflict and eligibility review, express attorney acceptance, and a signed engagement letter identifying the law firm and scope.
9. The user has authority to upload the materials and will not misuse the service.
10. The Terms include appropriately drafted warranty disclaimers, liability limitations, exclusions of consequential damages, indemnity for user misuse, dispute procedures, governing law, severability, survival, and consumer-law savings clauses—but only to the extent permitted by applicable law.

Repeat a short version at the chat header, workflow start, generated output, export screen, and counsel handoff. Store the full acknowledgement with every exported document’s provenance. A disclaimer is a control, not a cure: it does not legitimize unauthorized practice, deceptive marketing, negligence, professional misconduct, or a product flow that functionally gives individualized legal advice.

This structure is informed by the categories used in LegalZoom’s public Terms of Use—self-help software/not-a-law-firm boundary, no individualized legal conclusions, no attorney-client relationship, attorney-consultation separation, “as is/as available” warranties, liability limits, indemnity, and dispute terms—but the language must be independently drafted for this product and reviewed for launch jurisdictions. Do not copy LegalZoom’s text or assume its clauses fit this operator, patent practice, AI outputs, or current consumer-law limits.

## 3.5 Legal/ethics issue map

The companion issue-spotting memo is [`docs/legal-ethics-risk-memo.md`](legal-ethics-risk-memo.md). Its principal implications for this proposal are:

- **Unauthorized patent practice:** 37 CFR 11.5 expressly reaches consulting/advising in contemplation of filing and drafting specifications, claims, amendments, and replies. Keep individualized inventor-facing strategy inside the conflict-checked, accepted counsel engagement.
- **Prospective-client duties:** warnings and disclaimers help but are not dispositive. Treat counsel requests as restricted prospective-client information under a limited intake and retention regime.
- **Filing certifications:** 37 CFR 11.18 and USPTO AI guidance require human reasonable inquiry and responsibility for submissions. The software may assemble and verify; Jeff must review, authorize, and control submission.
- **Confidentiality and AI vendors:** use no-training terms, shortest feasible retention, U.S.-only storage/inference where required, documented subprocessors, access controls, tested deletion, and no prompt-body logging by default.
- **Export, foreign filing, and sanctions:** screen for U.S.-made inventions, sensitive technology, relevant parties, geography, and foreign routing. High-risk defense/controlled-technology answers stop automated processing and route to qualified review; a foreign-filing license is not a blanket export authorization.
- **Reliance and marketing:** label unreviewed outputs as drafts, validate citations/patent numbers, run deterministic patent checks, maintain attorney-reviewed regression tests, and avoid unsubstantiated “AI lawyer,” lawyer-equivalence, allowance-rate, or “filing-ready” claims. The FTC's DoNotPay order makes this a product and substantiation issue, not merely disclaimer drafting.
- **Corpus licensing:** maintain a source/license registry and excerpt controls. Publicly accessible does not necessarily mean public domain or commercially redistributable.
- **Entity, fees, and insurance:** separately review professional-entity rules, Rule 5.4/state equivalents, advertising/solicitation, trust accounting/refunds, malpractice/cyber coverage, and multijurisdictional practice before charging for connected legal services.

Primary authorities and official guidance are cited in the companion memo, including 37 CFR 11.5, 11.18, and 11.106; USPTO AI guidance; ABA Formal Opinions 512 and 10-457; 35 U.S.C. § 184; EAR/OFAC materials; and the FTC DoNotPay order.

---

# 4. Product and website structure

## 4.1 Public marketing site

```text
/
├── /product
│   ├── /invention-disclosures
│   ├── /application-drafting
│   ├── /office-actions
│   ├── /claim-strategy
│   ├── /patent-research
│   ├── /portfolio-analysis
│   └── /prepare-and-file
├── /patent-counsel
│   ├── /meet-counsel
│   ├── /how-it-works
│   ├── /services-and-fees
│   └── /engagement-boundary
├── /models
│   ├── quality/cost comparison
│   ├── model data practices
│   └── current usage rates
├── /security
│   ├── tenant isolation
│   ├── encryption and retention
│   ├── model-provider handling
│   └── trust/status links
├── /pricing
├── /professionals
├── /teams
├── /resources
│   ├── guides
│   ├── sample outputs
│   ├── methodology
│   └── authority coverage
├── /about
├── /login
├── /signup
└── /legal
    ├── terms
    ├── privacy
    ├── acceptable-use
    ├── AI disclosure
    └── legal-services disclaimer
```

### Homepage sections

1. Hero: source-grounded patent work product with model choice.
2. Interactive workflow selector: Draft / Respond / Research / Strategize.
3. Output examples with synthetic, non-client data.
4. “Choose your reasoning engine” comparison.
5. Source-grounding and authority hierarchy explanation.
6. Security and confidentiality architecture.
7. “Meet with Patent Counsel to Evaluate, Prepare & File,” featuring Jeff as the initial connected patent lawyer and clearly identifying the law firm that would be engaged.
8. Professional review and approval controls.
9. Separate software pricing and legal-services pathways.
10. FAQ covering data use, accuracy, legal status, conflicts, engagement, filing, and model billing.
11. CTAs: “Start with Lex,” “Meet Patent Counsel,” and “Request Team Demo.”

## 4.2 Authenticated application

```text
/app
├── /home                  dashboard and recent projects
├── /projects              tenant-isolated matters/workspaces
│   └── /[projectId]
│       ├── /chat          grounded conversational workspace
│       ├── /facts         canonical invention/matter facts
│       ├── /sources       uploads, patents, authorities, URLs
│       ├── /workflows     guided patent tasks
│       ├── /documents     generated versions and exports
│       ├── /claims        claim tree and claim history
│       ├── /citations     authority/reference verification
│       ├── /reviews       model critic and human approvals
│       ├── /counsel       conflict status, engagement, meeting, messages
│       ├── /filing        filing checklist, signatures, fees, receipt
│       └── /activity      audit trail
├── /counsel               counsel requests and scheduled consultations
├── /templates             personal/team workflow templates
├── /knowledge             approved public and private sources
├── /usage                 wallet, model spend, estimates, invoices
├── /team                  members, roles, workspace settings
└── /settings
    ├── models
    ├── privacy-retention
    ├── integrations
    └── billing
```

## 4.3 Core interaction design

A blank prompt box is not enough. The main composer should include:

- **Task:** draft, analyze, compare, research, revise, or review.
- **Jurisdiction and as-of date.**
- **Selected project/fact record.**
- **Selected sources.**
- **Model tier:** Fast, Advanced, or Frontier, plus an explicit provider/model selector.
- **Deliverable:** chat response, memo, claim set, response outline, claim chart, DOCX, or PDF.
- **Quality controls:** source-required, second-model review, quotation verification.
- **Estimated charge:** range shown before the run.

### Response layout

Use a three-pane professional interface:

1. **Left:** project facts, source library, workflow stages.
2. **Center:** prompt and generated work product, with trackable revisions.
3. **Right:** sources, authority level, effective dates, warnings, token cost, and review status.

Every answer should display:

- model used and model version;
- source list and citation links;
- unsupported assumptions or missing facts;
- jurisdiction/as-of date;
- generation cost;
- draft/review/approved status;
- export and create-version controls.

## 4.4 Guided workflows

### Invention disclosure to application draft

1. Upload or conduct structured invention interview.
2. Extract facts into a user-editable fact ledger.
3. Identify missing embodiments and terminology conflicts.
4. Generate architecture/process figures as optional aids.
5. Build claim concepts and fallback tree.
6. Draft sections from approved facts only.
7. Run written-description and antecedent-basis checks.
8. Run second-model critique.
9. Export DOCX with a review checklist.

### Office action response

1. Upload office action, pending claims, specification, and cited references.
2. Parse rejections by claim/statute/reference.
3. Create evidence-linked rejection matrix.
4. Identify factual and legal response paths.
5. Draft proposed amendments separately from arguments.
6. Show tradeoffs and potential estoppel/scope effects.
7. Verify quotations and pinpoint citations.
8. Export response outline or attorney-edited draft.

### Strategy/research

1. Select jurisdiction and effective date.
2. Convert question into issues.
3. Retrieve primary authority first.
4. Add public patent/practice materials.
5. Generate memo with authority hierarchy and uncertainty.
6. Run citation verifier and update/supersession check.

### Meet with Patent Counsel — Evaluate, Prepare & File

Use a gated state machine rather than treating this as another chat prompt:

```text
SOFTWARE_USER
  → COUNSEL_REQUESTED
  → LIMITED_CONFLICT_INTAKE
  → CONFLICTS_PENDING
  → CLEARED / DECLINED
  → CONSULTATION_SCHEDULED
  → ENGAGEMENT_OFFERED
  → ENGAGED
  → FULL_INVENTION_INTAKE
  → STRATEGY_APPROVED
  → DRAFTING
  → COUNSEL_REVIEW
  → CLIENT_REVIEW
  → SIGNATURES_AND_FEES_APPROVED
  → READY_TO_FILE
  → COUNSEL_AUTHORIZED_SUBMISSION
  → FILED
  → RECEIPT_AND_DOCKET_CONFIRMED
```

1. User clicks **Meet Patent Counsel** from a project or the public site.
2. Platform explains that submitting a request does not yet create an attorney-client relationship.
3. Collect only names, entities, adverse/related parties, general technology category, jurisdiction, and known deadlines for conflicts and suitability screening; avoid soliciting the complete confidential disclosure at this stage.
4. Jeff clears, declines, or requests limited additional information.
5. If cleared, schedule a paid or credited consultation.
6. After the consultation, deliver a proposed scope, responsible attorney, legal fee, official-fee estimate, exclusions, and engagement letter.
7. Once engaged, convert or open a counsel-controlled matter workspace and collect the full invention disclosure, inventorship/ownership facts, disclosure/public-use/sale history, funding/government-rights facts, and foreign-filing objectives.
8. Lex extracts a fact ledger, identifies missing information, and drafts from counsel-approved facts.
9. Jeff selects strategy and claims, reviews the complete application and required filing papers, and routes them to the client for review and signatures.
10. Display a final filing authorization screen listing the exact documents, applicant/inventor data, entity status, official fees, signatures/certifications, priority claims, and filing deadline.
11. Only after client approval and Jeff's explicit submission authorization may a counsel-controlled filing worker upload through USPTO Patent Center.
12. Capture submission confirmation, application number, payment receipt, filed-document checksums, and docket tasks; add the formal filing receipt when issued and flag discrepancies for human review.

The initial version should support Jeff only. The later network version needs lawyer onboarding, jurisdiction/registration verification, malpractice coverage verification, availability, conflicts routing, engagement templates, service-level expectations, and controls against improper fee sharing or misleading endorsements.

---

# 5. Technical architecture: Vercel + Supabase

## 5.1 Recommended stack

| Layer | Recommended technology | Responsibility |
|---|---|---|
| Web application | Next.js/React on Vercel | SSR, app UI, marketing pages, API facade |
| Authentication | Supabase Auth in private application project | Email, magic link, OAuth; enterprise SSO later |
| Private application database | Supabase Postgres project A | Tenants, projects, facts, legal matters, jobs, billing ledger, audit records |
| Public patent-corpus database | Supabase Postgres project B | Public patent documents, authority metadata, chunks, FTS, and vectors only |
| Row security | Supabase RLS in project A | Tenant/workspace isolation at the database boundary |
| Vector retrieval | `pgvector` in both projects | Tenant-private vectors in project A; public corpus vectors in project B |
| Private object storage | Supabase Storage in project A | Uploads, generated DOCX/PDF, counsel files, receipts |
| Public corpus storage | Supabase Storage in project B | Immutable public source snapshots and corpus releases |
| Billing | Stripe Billing + Checkout + Customer Portal | Subscriptions, top-ups, invoices, tax support |
| Model gateway | Server-only TypeScript service behind Vercel routes | Provider abstraction, policy, retries, cost accounting |
| Async workflows | Durable queue/workflow layer | Long drafting runs, OCR, indexing, exports, retries |
| Document processing | Sandboxed worker service | PDF/DOCX parsing, OCR, DOCX/PDF generation |
| Observability | OpenTelemetry + structured logs + error monitoring | Latency, spend, job tracing, reliability |
| Product analytics | Privacy-conscious events | Funnel, activation, retention; never capture document bodies |

Keep all provider keys server-side. The browser never calls OpenAI, Anthropic, or xAI directly. Use Vercel as the web/control plane—not as the only compute substrate. Long OCR, embeddings, document rendering, filing-packet preparation, and reconciliation run in bounded, idempotent workers.

Use **two Supabase projects** as a hard blast-radius boundary:

1. **Private application project:** authentication, tenant workspaces, private uploads, legal matters, billing, private embeddings, audit data, and generated artifacts.
2. **Public patent-corpus project:** public statutes/authorities, patents, prosecution records, corpus releases, public chunks, FTS, and vectors only. Access it through a read-only backend identity; “public corpus” does not mean anonymous database access.

Never perform a cross-database SQL join. Retrieve public and private evidence through separate clients and credentials, then merge labeled results only inside the authorized AI orchestrator.

## 5.2 High-level flow

```text
Browser
  → Vercel Next.js application / BFF
    → authenticated API boundary
      → Supabase private application project
        → Auth + RLS
        → tenant-private projects, embeddings, legal matters, billing, audit
      → Supabase public-corpus project through read-only backend identity
        → public patent/authority FTS + vector retrieval
      → durable job orchestrator
        → source ingestion / OCR / chunking
        → retrieval policy engine
        → model gateway
          → OpenAI
          → Anthropic
          → xAI
        → citation verifier / critic
        → DOCX/PDF renderer
      → immutable usage ledger
        → wallet debit
        → Stripe subscription/top-up reconciliation
      → connected-counsel gateway
        → limited conflict intake
        → Jeff review and engagement
        → counsel-controlled matter workspace
        → final filing authorization
        → attorney-assisted Patent Center submission
        → receipt capture and docket handoff
```

## 5.3 Service boundaries

### Model gateway

One internal interface should normalize provider differences without pretending all providers are identical.

```ts
type ModelRequest = {
  tenantId: string;
  projectId: string;
  jobId: string;
  modelKey: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxOutputTokens?: number;
  dataPolicy: 'PUBLIC_ONLY' | 'PRIVATE_PROJECT';
  idempotencyKey: string;
};

type ModelResult = {
  content: ContentBlock[];
  providerRequestId?: string;
  modelVersion: string;
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
    reasoningTokens?: number;
  };
  finishReason: string;
};
```

Provider adapters validate all responses. The price calculator applies the price version active at the event timestamp and writes one immutable charge record.

### Retrieval service

Separate namespaces/partitions:

- `public_authority`: statutes, regulations, current/historical MPEP, official court/agency materials.
- `public_patents`: published patents/applications and public prosecution records.
- `tenant_private`: customer-created reusable sources, isolated by tenant.
- `project_private`: uploads and generated project material, isolated by project.

Never put customer content into the public index. Never expose internal firm/client knowledge or licensed material to public subscribers unless it is expressly cleared and licensed for that use.

### Document service

- Parse PDF/DOCX/images in a sandbox.
- Malware scan uploads.
- Preserve page/paragraph coordinates for citations.
- Generate DOCX from controlled templates.
- Render PDF asynchronously.
- Store checksums, provenance, parent version, and generator version.

### Connected-counsel and filing service

- Maintain a strict boundary between a software project, a prospective-client intake, and an accepted legal matter.
- Collect limited conflict-screening data before substantive invention files.
- Route all accept/decline decisions to Jeff initially; the system must never imply acceptance automatically.
- Generate engagement documents and collect signatures only from approved templates associated with the disclosed law firm.
- After engagement, create a counsel-controlled private matter partition with role-based access for client, responsible lawyer, and authorized staff.
- Build deterministic filing checklists for application data, inventorship, ownership, entity status, domestic/foreign priority, declarations, assignments, fees, drawings, sequence listings, or other special artifacts.
- Produce a version-locked filing manifest with hashes for every document the client and Jeff approved.
- Treat filing as attorney-controlled automation. Do not expose or share Patent Center credentials, bypass MFA, or submit merely because a workflow reached `READY_TO_FILE`.
- Initial implementation should prepare the complete upload packet and open a supervised filing session for Jeff. Add deeper browser automation only after confirming USPTO terms, security controls, credential handling, MFA, training-mode validation, and reliable receipt reconciliation.
- Store the electronic acknowledgement, application number, payment confirmation, filed-document manifest, and later filing receipt; create docket tasks and discrepancy alerts.

## 5.4 Core database schema

| Table | Purpose |
|---|---|
| `users` | Profile linked to Supabase Auth |
| `organizations` | Billing/tenant boundary |
| `memberships` | User role within organization |
| `projects` | Patent matter/workspace; no client-data mixing |
| `project_facts` | User-approved canonical fact ledger |
| `sources` | Private source metadata, confidentiality, jurisdiction, effective date (project A) |
| `source_chunks` | Tenant-private retrieval units and vectors (project A) |
| `public_patents` / `public_sections` / `public_chunks` | Public patent/authority metadata, exact locators, FTS, and vectors (project B) |
| `corpus_releases` | Source, release date, checksum, and ingestion version for public corpus (project B) |
| `conversations` | Project conversation containers |
| `messages` | User/model messages with version metadata |
| `jobs` | Long-running workflow state and idempotency |
| `model_catalog` | User-facing model names and capability metadata |
| `provider_prices` | Effective-dated provider token prices |
| `usage_events` | Raw immutable provider usage |
| `usage_reservations` | Atomic pre-run allowance/cost reservations and release status |
| `ledger_entries` | Wallet credits/debits and adjustments |
| `billing_outbox` | Transactional, idempotent export of canonical usage to Stripe/reconciliation |
| `stripe_events` | Signature-verified, deduplicated webhook receipt and processing state |
| `subscriptions` | Stripe subscription state |
| `documents` | Generated artifacts and versions |
| `citations` | Claims-to-source anchors and verification state |
| `reviews` | Model and human review decisions |
| `audit_events` | Security and material user actions |
| `retention_policies` | Tenant-specific deletion configuration |
| `counsel_profiles` | Connected lawyer identity, registration/jurisdiction metadata, firm, status |
| `counsel_requests` | Prospective-client request and non-engagement status |
| `conflict_parties` | Restricted conflict-screening names/entities; separated from general analytics |
| `conflict_decisions` | Lawyer decision, timestamp, scope, and access log |
| `engagements` | Responsible lawyer, client, scope, firm, signed terms, effective status |
| `legal_service_orders` | Legal scope, fixed/estimated fees, exclusions, and official-fee estimates |
| `filing_matters` | Counsel-controlled patent matter and filing state |
| `filing_tasks` | Required item, owner, deadline, completion, and hard-stop status |
| `authorizations` | Client and attorney approvals tied to exact document manifests |
| `filing_submissions` | Submission event, document hashes, receipts, identifiers, reconciliation status |
| `docket_events` | Post-filing deadlines and human-verified docket handoff |

### Required database invariants

- Every private row carries `organization_id`; project rows also carry `project_id`.
- RLS is enabled and tested for every tenant-bearing table.
- Service-role access is confined to server jobs and logged.
- Usage and ledger records are append-only; adjustments use compensating entries.
- Provider pricing is effective-dated and never overwritten retroactively.
- Jobs have idempotency keys to prevent duplicate model charges.
- Source confidentiality and license class are required, not optional.
- A `counsel_request` is not an `engagement`; no code path may infer an attorney-client relationship from account creation, upload, payment to the SaaS, or consultation request alone.
- Conflict data is encrypted/restricted separately, never embedded, and never used for model training or product analytics.
- An engagement must identify the responsible lawyer, law firm, client, scope, signed terms, and effective timestamp.
- A filing submission requires an immutable final-document manifest plus separate client and responsible-attorney authorizations.
- Legal-fee and official-fee records are distinct from the SaaS/model wallet.

## 5.5 API structure

```text
GET    /api/models
GET    /api/models/prices
POST   /api/estimates
POST   /api/projects
GET    /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
POST   /api/projects/:projectId/sources
GET    /api/projects/:projectId/sources
POST   /api/projects/:projectId/jobs
GET    /api/jobs/:jobId
POST   /api/jobs/:jobId/cancel
GET    /api/projects/:projectId/documents
POST   /api/documents/:documentId/export
POST   /api/counsel/requests
GET    /api/counsel/requests/:requestId
POST   /api/counsel/requests/:requestId/schedule
POST   /api/counsel/requests/:requestId/decision        # lawyer-only
POST   /api/engagements/:engagementId/sign
GET    /api/projects/:projectId/filing
POST   /api/projects/:projectId/filing/checklist
POST   /api/projects/:projectId/filing/client-approval
POST   /api/projects/:projectId/filing/counsel-approval # lawyer-only
POST   /api/projects/:projectId/filing/session          # lawyer-only
POST   /api/projects/:projectId/filing/reconcile        # lawyer/staff-only
GET    /api/usage
POST   /api/billing/checkout
POST   /api/billing/topups
POST   /api/webhooks/stripe
```

Use consistent structured errors, boundary validation, pagination, idempotency keys, and additive API changes.

## 5.6 Asynchronous execution

Full document work should not depend on one long HTTP request. A job state machine should support:

```text
QUEUED → INGESTING → RETRIEVING → GENERATING → VERIFYING → RENDERING → COMPLETED
                                                           ↘ FAILED / CANCELLED
```

Each stage checkpoints its result. Retries must not repeat a billable model call unless the prior provider outcome is known. Stream chat responses for short jobs; use queued execution and progress events for larger workflows.

## 5.7 Security baseline

- Never trust a client-supplied `organization_id`, `workspace_id`, `project_id`, or matter ID without deriving/verifying membership server-side.
- RLS unit/integration tests with cross-tenant attack cases.
- Use a non-`BYPASSRLS` worker role and transaction-local tenant context where practical; never expose a Supabase service-role key to browsers.
- Encryption in transit and at rest.
- Server-only provider credentials in managed secrets.
- Short-lived signed storage URLs.
- Strict content-security policy.
- Malware scanning and file-type validation.
- Rate limits by user, tenant, IP, model, and spend.
- Per-run and monthly spend caps.
- Prompt-injection defenses: treat uploaded/retrieved text as evidence, never as system instructions.
- Separate retrieval content from model instructions.
- Full audit log for uploads, exports, deletions, model runs, billing changes, and admin access.
- Separate privileged/prospective-client access logs; no support impersonation into a legal matter without authorization and audit.
- Counsel-only permissions for conflict decisions, matter acceptance, legal advice, filing approval, submission initiation, and receipt reconciliation.
- No Patent Center password or MFA secret in browser storage, product analytics, ordinary application logs, or customer-accessible records.
- Version-locked filing manifests, document hashes, and dual approval before submission.
- No raw patent/project text in analytics, traces, support tools, or error logs.
- Security review, privacy review, and incident-response plan before public launch.
- SOC 2 readiness after product-market fit; enterprise buyers will expect it.

## 5.8 Vercel/Supabase implementation constraints

- Vercel currently documents a **4.5 MB Function request/response body limit**. Upload and download large patent files directly between the browser and private Supabase Storage using short-lived signed URLs; do not proxy them through a Function.
- Fluid Compute remains bounded by plan/runtime duration. Streaming improves perceived responsiveness but does not create unlimited execution time. Verify current plan limits at implementation.
- Put OCR, archive expansion, embeddings, large retrieval jobs, DOCX/PDF rendering, filing-packet assembly, and daily reconciliation in durable workers. Each step must be bounded, checkpointed, idempotent, and retry-safe.
- Use Supabase's transaction-mode pooler for temporary/serverless database clients and do not rely on Vercel local disk for durable artifacts or state.
- Postgres, FTS, and `pgvector` share compute. Keeping the public corpus in project B prevents corpus ingestion/indexing from degrading private transactions.
- Filtered approximate-vector search can under-return results. Benchmark over-fetching, iterative scans, partitioning, or tenant-specific indexes before relying on a global private HNSW/IVFFlat index.
- Stripe webhook processing must verify the raw-body signature, deduplicate event IDs, tolerate retries and out-of-order delivery, and reconcile against the local immutable ledger. Stripe is not the real-time admission-control source of truth.
- Recheck [Vercel limits](https://vercel.com/docs/functions/limitations), [Fluid Compute](https://vercel.com/docs/functions/fluid-compute), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres) when implementation begins.

---

# 6. Model catalog and routing

## 6.1 User-facing tiers

| Tier | UI promise | Typical use |
|---|---|---|
| Fast | Lowest cost and latency | Extraction, formatting, brainstorming, simple summaries |
| Advanced | Strong drafting/reasoning balance | Most patent drafting and analysis |
| Frontier | Best available reasoning with higher cost | Claim strategy, difficult legal analysis, final critique |

Let users choose a specific provider/model, but offer an “Auto” router that explains the chosen model before execution.

## 6.2 Routing policy

Route by:

- task type;
- context length;
- source count;
- output format;
- tool/function support;
- user’s data-policy setting;
- provider availability;
- estimated charge;
- quality benchmark for that patent workflow.

Do not rank models using generic benchmarks alone. Maintain a patent-specific evaluation suite covering factual extraction, claim dependencies, antecedent basis, written-description support, office-action mapping, authority citation validity, quote accuracy, and unsupported legal conclusions.

## 6.3 Price display

Maintain a public `/models` and `/pricing` rate table generated from the effective-dated `provider_prices` registry. Show:

- model name and provider;
- input, cached-input, and output retail rates;
- date the rate became effective;
- context/output limits;
- typical workflow cost ranges;
- data handling notes;
- status and fallback behavior.

If provider prices change, new events use the new price version; historical invoices remain tied to the old version.

---

# 7. MVP and phased launch

## Phase 0 — design partner validation (2–4 weeks)

**Objective:** prove that patent professionals will pay for supervised, source-grounded drafting and that prospective users will complete a compliant Jeff-led counsel conversion path.

- Interview 10–15 patent attorneys/agents and 10 prospective inventor/founder users.
- Test three software workflows: invention disclosure, office-action analysis, cited research memo.
- Test the counsel funnel with a Jeff-only prototype: limited conflict intake → consultation → engagement offer → full intake.
- Use synthetic or expressly authorized data for software evaluation; use real legal matters only after conflicts clear and an engagement is effective.
- Measure time saved, revision burden, source reliability, willingness to pay, counsel-request conversion, conflict-screening burden, and model preference.
- No public self-service legal claims and no implication that requesting a consultation creates representation.

**Stop condition:** do not build the full platform if fewer than five design partners repeatedly use the software workflows, if review burden consumes most of the claimed time savings, or if the counsel funnel cannot maintain clean conflict/engagement/data boundaries.

## Phase 1 — professional MVP (6–10 weeks after validation)

- Next.js/Vercel application.
- Supabase Auth/Postgres/RLS/Storage/pgvector.
- Stripe subscription and prepaid wallet.
- Project isolation and uploads.
- Public U.S. patent authority retrieval.
- Three guided workflows.
- OpenAI + Anthropic initially; add xAI after gateway/billing tests.
- DOCX export.
- Citation panel, cost estimate, usage ledger, audit log.
- Admin model/price registry and provider kill switches.
- Jeff-only **Meet Patent Counsel** funnel with limited conflict intake, accept/decline control, consultation scheduling, engagement status, and secure conversion to a legal matter.
- Counsel-guided preparation workflow with client/counsel review gates and a version-locked filing packet.
- Supervised Patent Center filing checklist and receipt capture for a small private pilot; Jeff performs the actual authenticated submission.

## Phase 2 — team product and counsel filing automation

- Team roles and pooled billing.
- Reusable firm templates.
- Comparison/critic workflows.
- Configurable retention and deletion.
- SSO and enterprise agreements.
- Expanded public prosecution data.
- Portfolio dashboards.
- Counsel dashboard for conflicts, engagements, matter status, signatures, official fees, and filing authorizations.
- Attorney-assisted Patent Center session automation only after terms/security/MFA review and training-mode validation.
- Automated receipt reconciliation and docket handoff with human verification.

## Phase 3 — broader inventor market and attorney network

- Structured inventor intake.
- Jurisdiction-aware educational flows.
- Vetted connected-counsel network expanding beyond Jeff, with lawyer registration, conflicts, engagement, malpractice-coverage, jurisdiction, and availability controls.
- Separate legal-fee arrangements that do not create improper fee sharing or misleading lawyer endorsements.
- Carefully reviewed consumer marketing and UPL controls.

---

# 8. Pilot operating contract

## Objective

Create a repeatable patent-drafting, counsel-engagement, preparation, and filing workflow that reduces professional time while preserving attorney control, client authorization, confidentiality, and source reliability.

## Human-owned decisions

- Legal advice and conclusions.
- Conflict clearance, engagement acceptance, and scope.
- Claim scope and filing strategy.
- Whether a document is complete or accurate.
- Client communication and final client approval.
- Filing decision, certifications, signature posture, official-fee authorization, and submission authorization.
- Use of confidential or licensed material.

## Agent work

- Extraction and organization.
- Draft generation from approved facts.
- Public authority retrieval.
- Citation and consistency checking.
- Alternative strategies and risk flags.
- Document formatting and versioning.
- Conflict-intake packet preparation without making the conflict decision.
- Engagement workflow administration from approved counsel templates.
- Filing checklist, application-data validation, version-locked upload packet, and fee estimate preparation.
- Supervised upload assistance after dual authorization.
- Receipt reconciliation and docket-handoff preparation for human verification.

## Acceptance tests

- Every legal proposition is either cited to a retrievable source or marked as analysis.
- No invented quotation or patent/reference identifier.
- Claim dependencies and antecedent basis pass deterministic checks.
- All private data stays within the correct tenant/project.
- Run cost reconciles to provider usage and the wallet ledger.
- Exported DOCX opens and preserves required formatting.
- A second reviewer can reproduce the source trail.
- Conflict/suitability intake is limited and segregated before engagement.
- The engagement record precedes substantive counsel work and identifies Jeff, the actual law firm, client, and scope.
- Client and Jeff approvals reference the same immutable filing manifest.
- No upload occurs before every filing hard stop is cleared.
- The electronic acknowledgement, submitted files, fee confirmation, application identifier, and docket handoff reconcile after filing.

## Baseline to capture with design partners

| Metric | Baseline source |
|---|---|
| Human minutes per workflow | User time study |
| Number of revision cycles | Document history |
| Unsupported proposition rate | Attorney review sample |
| Citation validity | Automated + human audit |
| Cost per completed deliverable | Provider and infrastructure ledger |
| User willingness to pay | Interview and conversion behavior |
| Repeat use within 30 days | Product analytics |

---

# 9. Key decisions before implementation

1. **Primary buyer:** professionals first, with a connected-counsel path for inventor/founder users. Recommendation: yes.
2. **Public corpus:** exactly which public and licensed sources may be offered commercially?
3. **Brand:** whether “Lex” is clear for trademark/domain use and sufficiently distinct from legal-information incumbents.
4. **Launch jurisdictions:** recommendation: U.S. patent practice only at first.
5. **Billing:** prepaid SaaS/model wallet, with legal fees and official fees handled separately.
6. **Provider sequence:** recommendation: OpenAI + Anthropic MVP, xAI after gateway validation.
7. **Initial counsel:** Jeff only; identify the exact firm/entity through which the client will engage him.
8. **Legal-service scope:** which initial offerings—evaluation, provisional, nonprovisional, search/strategy—and the fixed/scoped fee schedule.
9. **Entity and ethics structure:** SaaS ownership, law-firm relationship, marketing, payment flows, trust-account treatment, referral restrictions, malpractice coverage, and conflicts procedure.
10. **Filing automation boundary:** supervised packet preparation/manual Jeff submission first; deeper Patent Center automation only after technical, terms, MFA, and ethics validation.
11. **Data retention:** separate defaults for ordinary software projects, prospective-client intake, declined matters, and engaged legal matters.
12. **Quality bar:** benchmark and filing-checklist thresholds required before each workflow becomes public.
13. **Commercial boundary:** whether any Schell IP playbook content will be offered; default should be no unless deidentified, privilege-reviewed, licensed, and expressly approved.

---

# 10. Ranked next actions

1. **Approve the two-lane structure:** self-service software plus “Meet with Patent Counsel — Evaluate, Prepare & File.”
2. **Identify Jeff's engaging law firm/entity** and approve the exact customer-facing relationship language.
3. **Choose the initial counsel service menu and fee structure:** evaluation, search/strategy, provisional, and/or nonprovisional preparation and filing.
4. **Design the limited conflict intake and engagement flow** before accepting substantive invention disclosures from counsel prospects.
5. **Commission a corpus/license audit** separating public authorities, public patent data, internal know-how, licensed materials, and client-confidential content.
6. **Recruit design partners** for both the software workflows and a 3–5 matter Jeff-led counsel pilot.
7. **Choose a working brand/domain** after trademark/domain screening; do not market it as a Grok clone.
8. **Build a clickable prototype** of the three-pane workspace plus the counsel request, engagement, review, and filing-status experience.
9. **Create a provider price registry and cost simulator** using live OpenAI, Anthropic, and xAI API rates.
10. **Draft the contract-first API, RLS policies, counsel roles, filing state machine, and threat model** before implementing uploads or retrieval.
11. **Have ethics/privacy/product counsel review** the entity, fee, referral, conflicts, engagement, confidentiality, malpractice, marketing, provider, and Patent Center automation structure.
12. **Run a 30-day private pilot** with measured software, counsel-conversion, preparation-time, filing-accuracy, and reconciliation baselines.
13. **Only then begin public beta.**

---

# 11. Founder decision requested

Approve or revise these default choices:

- **Market:** patent professionals first, with an inventor/founder path to connected counsel.
- **Product:** two separate lanes—self-service source-grounded software and an accepted connected-counsel legal engagement.
- **Initial counsel:** Jeff only, through the specifically disclosed law firm/entity.
- **Pricing:** $49 / $149 / $499 SaaS subscriptions plus provider token cost × 1.50 through a prepaid wallet; legal fees and official fees remain separate.
- **MVP workflows:** invention disclosure, office-action analysis, cited research memo, plus Meet Counsel → conflict check → consultation → engagement → counsel-guided preparation → supervised filing.
- **Filing boundary:** the platform automates intake, drafting, checklists, signatures, final manifests, supervised upload assistance, receipt capture, and docket handoff; Jeff controls legal decisions and authenticated submission.
- **Infrastructure:** Next.js on Vercel; separate Supabase private-application and public-corpus projects; Supabase Auth/Postgres/RLS/Storage/pgvector; Stripe Billing; server-side multi-provider model gateway; durable asynchronous jobs; restricted counsel and filing services.
- **Knowledge boundary:** public and expressly licensed sources only for the public product; engaged client matters remain isolated and are never added to the shared corpus.
