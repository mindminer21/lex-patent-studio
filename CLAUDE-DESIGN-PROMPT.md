# Claude Design Assignment — Lex Patent Studio

## Repository

Use this public GitHub repository as the source code and source of truth:

**https://github.com/mindminer21/lex-patent-studio**

Clone or import the repository and inspect it before designing. Work in the repository’s actual Next.js/React/TypeScript stack; do not produce an unrelated standalone HTML artifact.

Read these files first:

1. `README.md`
2. `docs/DESIGN-HANDOFF.md`
3. `docs/business-and-product-proposal.md`
4. `docs/legal-ethics-risk-memo.md`
5. `src/app/page.tsx`
6. `src/app/globals.css`
7. `src/app/layout.tsx`

## Objective

Design and implement a production-quality frontend concept for **Lex Patent Studio**, a source-grounded, multi-model patent drafting and strategy workspace with a separate connected-patent-counsel pathway.

The result should make two product lanes unmistakably different:

1. **Self-service patent software** — patent research, fact organization, drafting, office-action analysis, claim strategy, citations, multi-model review, and document export. Use of this lane does not create an attorney-client relationship.
2. **Meet with Patent Counsel — Evaluate, Prepare & File** — limited conflict intake, attorney clearance, consultation, separate engagement, counsel-guided preparation, client/attorney approval, supervised filing, and receipt/docket status. Jeff is the initial connected patent lawyer.

This is a frontend design implementation and realistic product prototype—not permission to implement live legal advice, real billing, live model calls, confidential-data processing, or autonomous USPTO filing.

## Users

### Primary

- Registered patent attorneys and agents
- Small IP boutiques
- In-house patent teams
- Sophisticated technical founders already working with counsel

### Secondary

- Inventors/founders who need educational organization tools and a clear way to request connected patent counsel

## Surface decisions

Commit to these compositions before styling:

- **Public homepage:** `Decide / Learn`. One idea per section. Strong narrative and evidence, not a generic feature-card template.
- **Patent workspace:** primarily `Operate`, secondarily `Command / Inspect`. Dense, fast, professional, and document-centered. Do not put a marketing hero inside the app.
- **Counsel intake:** `Configure`. Progressive disclosure with explicit relationship/confidentiality state at every step.
- **Filing status:** `Monitor / Operate`. Exact documents, approvals, fees, deadlines, discrepancies, and receipt state; no fake business metrics.
- **Pricing/model selection:** `Compare`. Aligned options, transparent model-quality/cost differences, and clear separation of SaaS/model charges from legal and official fees.

## Required routes and screens

Implement at least these responsive routes or route-equivalent prototype surfaces:

### 1. `/` — Public marketing homepage

- Original, editorial hero
- Clear statement of the product and audience
- Demonstrate the three-pane workspace with a realistic synthetic matter
- Explain source-grounding and multi-model choice
- Explain the self-service/counsel separation
- Prominent but careful counsel CTA
- Pricing overview
- Trust/data-handling section without unsupported compliance badges
- Final conversion CTA

### 2. `/workspace` — Authenticated workspace prototype

Build a three-pane professional workbench:

- **Left rail:** project facts, sources, claim tree, documents, and workflow stage
- **Center:** prompt/editor, structured draft, fact confirmations, and version comparison
- **Right inspector:** citations, exact source locators, selected model, pre-run cost, warnings, review state, and output provenance

Include realistic interactive states using synthetic content:

- Default loaded project
- Empty/new project
- Generating/loading
- Missing-fact validation
- Citation conflict or unsupported proposition
- Successful export/review-ready state
- Counsel-only control disabled for a software-only user

### 3. `/patent-counsel` — Counsel pathway

Show the controlled state progression:

```text
Counsel requested
→ Limited conflict intake
→ Conflicts pending
→ Cleared or declined
→ Consultation
→ Engagement offered
→ Engaged
→ Full invention intake
→ Strategy approved
→ Drafting and counsel review
→ Client review
→ Signatures and fees approved
→ Ready to file
→ Attorney-authorized submission
→ Filed
→ Receipt and docket confirmed
```

The interface must make clear:

- A counsel request is not an engagement.
- Do not solicit the full invention disclosure before conflict clearance.
- Representation begins only under the signed engagement and attorney acceptance.
- Client and responsible attorney approvals are separate hard gates.
- Patent Center credentials/MFA never appear in ordinary product UI.
- Filing is supervised and attorney controlled.

### 4. `/pricing` — Subscription and model comparison

- Solo, Professional, Team, and Enterprise plans from the proposal
- Included usage credits
- Transparent `provider cost × 1.50` explanation
- Model menu grouped into Fast, Advanced, and Frontier
- Use the effective-dated rate table in `docs/business-and-product-proposal.md`; label it as a snapshot rather than a permanent promise
- Separate sections for platform/model charges, connected-counsel legal fees, and government/third-party filing costs

## Product components to design

- Project switcher
- Matter status and relationship-status badge
- Workflow rail
- Fact ledger and “needs confirmation” state
- Source/citation inspector with exact locators
- Model picker with cost/latency/quality posture
- Pre-run cost estimate
- Prompt/editor surface
- Claim tree and support mapping
- Draft version comparison
- Attorney/client approval controls
- Filing-manifest checklist
- Receipt and discrepancy status
- Empty, loading, error, and success states
- Responsive navigation and mobile review mode

## Visual direction

Aim for **serious, editorial, precise, calm, and technically credible**.

- Patent practice and professional judgment—not sci-fi AI
- Typography should establish hierarchy before boxes or decoration
- Warm paper neutrals, deep ink/green, and one restrained signal color are a useful starting point, but improve the existing system if a stronger original direction emerges
- Use density where professional work requires it and whitespace where decisions require clarity
- Treat documents, sources, and workflow state as the visual material
- Build an original identity; do not copy another legal-tech company, Claude, ChatGPT, or Grok

Avoid:

- Blue/violet “AI” gradients
- Glassmorphism
- Equal-weight icon feature grids
- Oversized rounded cards everywhere
- Fake dashboards and invented performance numbers
- Stock-photo legal heroes
- Decorative robot/brain imagery
- Placeholder testimonials or customer logos
- Generic labels such as “Insights,” “Optimize,” or “Scale” without concrete meaning
- Hero-plus-three-cards compositions inside operational screens

## Content and legal constraints

Preserve and reinforce these boundaries from the repository documents:

- Never call Lex an “AI patent lawyer,” “Grok clone,” lawyer replacement, or autonomous filing service.
- Never promise patentability, allowance, filing success, deadline accuracy, or “USPTO compliant” output without substantiation.
- Self-service output is draft work product and is not legal representation.
- Connected legal services begin only after conflict clearance, attorney acceptance, and signed engagement.
- Jeff controls legal advice, claim strategy, certifications, filing authorization, and authenticated submission.
- Use synthetic inventions, people, entities, citations, and matters only.
- Do not invent testimonials, allowance rates, time savings, customers, certifications, or security claims.
- Distinguish public patent knowledge from tenant-private materials.
- Do not expose or reproduce secrets, environment variables, access tokens, or provider credentials.

## Technical constraints

- Follow the existing Next.js App Router structure.
- Use TypeScript and accessible semantic markup.
- Reuse or improve the repository’s components and tokens rather than replacing the app with a monolithic file.
- Keep dependencies minimal and justified.
- Mobile touch targets must be at least 44px.
- Include visible focus states and keyboard-accessible controls.
- Respect `prefers-reduced-motion`.
- Keep the product functional without animation.
- Do not proxy large-file upload concepts through a Next.js Function; the architecture uses signed direct-to-Supabase Storage uploads.
- Do not implement real auth, Stripe checkout, model APIs, email, calendaring, file upload, or Patent Center automation in this design pass. Prototype those states safely.

## Verification requirements

Before declaring completion:

1. Run `npm install` if needed.
2. Run `npm run lint`.
3. Run `npx tsc --noEmit`.
4. Run `npm run build`.
5. Open every implemented route in a browser.
6. Check desktop and mobile layouts.
7. Check the browser console for errors.
8. Exercise the key prototype interactions.
9. Run an explicit design-slop audit using these ten tells: tech gradient, generic tech hue, feature-tile grid, accent rail, unearned blur, monument stat, icon topper, center stack, default type, and wrong surface.
10. Repair compositional violations before polishing colors or typography.

Report the routes/files changed, tests run, remaining placeholders, and any assumptions. If your environment cannot push to GitHub, return a complete, repository-relative patch or downloadable project files rather than an unrelated mockup.

## Acceptance criteria

The implementation is successful when:

- The public product story is understandable in under 30 seconds.
- A patent practitioner can identify the primary workflow and evidence controls immediately.
- A founder can find counsel without mistaking software signup or an intake request for representation.
- The workspace feels like a professional document-and-evidence tool, not a generic chatbot.
- Model selection makes cost/quality differences comprehensible before execution.
- The counsel and filing flows visibly preserve attorney/client authorization gates.
- No screen implies autonomous legal judgment or filing.
- The result is responsive, accessible, original, and buildable in the repository’s actual stack.
