# Lex Patent Studio — Design Handoff

## Assignment

Turn this repository into a high-fidelity, responsive product concept for Lex Patent Studio while preserving its actual Next.js/React/TypeScript stack and the legal/product boundaries in the accompanying documents.

## Audience

- Primary: registered patent practitioners, small IP boutiques, and in-house patent teams.
- Secondary: sophisticated inventors and founders who may use educational/organizational tools and then engage connected patent counsel.

## Product architecture

Lex has two visibly separate lanes:

1. **Self-service patent workspace**
   - Public patent and primary-authority research
   - Invention fact ledger
   - Claim strategy and source mapping
   - Office-action analysis
   - Multi-model drafting/review
   - Citation verification
   - DOCX/PDF exports
   - Subscription plus metered model usage

2. **Connected patent counsel**
   - “Meet with Patent Counsel — Evaluate, Prepare & File”
   - Limited conflict intake before substantive disclosure
   - Attorney accept/decline
   - Consultation and separate engagement
   - Full invention intake only after engagement
   - Counsel-guided strategy and drafting
   - Client and attorney review/authorization
   - Supervised filing and receipt/docket status
   - Jeff is the initial connected patent lawyer

## Surface choices

- **Public homepage:** Decide/Learn. Lead with the product distinction and let one idea land per section.
- **Authenticated workspace:** Operate with Command/Inspect as a secondary surface. It should feel like a serious professional workbench, not a marketing dashboard.
- **Counsel intake:** Configure. Progressive disclosure, clear gates, plain-language relationship status, and conservative handling of confidential information.
- **Filing status:** Monitor/Operate. Show exact documents, approvals, deadlines, discrepancies, and receipt state without fake analytics.

## Required design outputs

1. High-fidelity public homepage.
2. Authenticated three-pane patent workspace:
   - left: facts, sources, claim tree, workflow state;
   - center: prompt/editor and draft work product;
   - right: citations, model, cost, warnings, and review state.
3. Connected-counsel intake and state flow.
4. Pricing/model selector with transparent provider/model costs.
5. Responsive mobile behavior for the public site and essential workspace review actions.
6. Key states: default, loading, empty, validation/error, success, and restricted/counsel-only.

## Visual posture

- Serious, editorial, precise, and calm.
- Patent practice, professional judgment, and technical depth—not sci-fi AI.
- Typography should carry hierarchy before cards, icons, or decoration.
- Prefer warm paper neutrals, deep ink/green, and one restrained signal color.
- Dense where professionals need density; spacious where decisions need clarity.
- Avoid generic blue/violet gradients, glassmorphism, equal-weight feature-card grids, fake metrics, stock-photo heroes, and decorative AI imagery.
- Do not copy another legal-tech or model provider's proprietary UI.

## Content and legal constraints

- Never call the product an “AI patent lawyer,” a “Grok clone,” or a lawyer replacement.
- Never claim guaranteed allowance, guaranteed patentability, or autonomous filing.
- Self-service outputs are drafts and do not create representation.
- Connected legal services begin only after conflict clearance, attorney acceptance, and signed engagement.
- The filing interface may prepare and verify a packet, but attorney and client authorization remain explicit hard gates.
- Do not invent testimonials, allowance metrics, customer logos, or performance claims.
- Use synthetic matter names and facts only.

## Implementation constraints

- Work in this repository rather than producing an unrelated standalone HTML file.
- Inspect existing source, `docs/business-and-product-proposal.md`, and `docs/legal-ethics-risk-memo.md` before modifying the UI.
- Keep components accessible and responsive; mobile hit targets must be at least 44px.
- Respect `prefers-reduced-motion`.
- Avoid unnecessary dependencies.
- Preserve buildability with `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

## Acceptance criteria

- The two lanes are unmistakably separate.
- A practitioner can understand the primary workspace in under 30 seconds.
- A founder can find the counsel pathway without mistaking software signup for representation.
- The model selector shows meaningful price/quality differences and pre-run cost estimates.
- No screen implies autonomous legal judgment or filing.
- The layout does not collapse into generic hero-plus-three-cards patterns for operational surfaces.
- The result passes a design-slop audit with no compositional violations.
