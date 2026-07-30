# Lex Patent Studio

Design-stage Next.js codebase for a multi-model, source-grounded patent drafting and strategy workspace with a separate connected-counsel pathway.

## Product and brand architecture

1. **Lex Patent Studio** — the professional product in this repository, for law firms, patent attorneys/agents, in-house legal teams, and supervised patent operations. Marketed as **“Your next patent associate”** with an immediate responsible-practitioner supervision qualifier.
2. **wepatent** — for VCs, founders, early-stage companies, R&D departments, and innovation teams. It must use a different brand, domain/deployment, visual identity, onboarding, terms, support, billing descriptor, analytics property, prompt policy, and output permissions. The `/wepatent` and `/wepatent/terms` routes are design proofs and must not be merged into Lex navigation or identity.
3. **Connected-counsel administration** — a separately gated Lex context for limited conflict intake, attorney accept/decline, engagement, counsel-guided preparation, supervised filing, and receipt/docket handoff. A request, upload, schedule action, or payment is not representation.

The shared technology may eventually include a model gateway, public source corpus, evaluation harness, and document engine, but public positioning and legal boundaries must remain separate.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Planned: Vercel, separate Supabase private-application and public-corpus projects, Stripe, OpenAI, Anthropic, and xAI

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Repository

- Public source: [github.com/mindminer21/lex-patent-studio](https://github.com/mindminer21/lex-patent-studio)
- Claude Design assignment: [`CLAUDE-DESIGN-PROMPT.md`](CLAUDE-DESIGN-PROMPT.md)

## Design and product context

- [`docs/PRD-wepatent.md`](docs/PRD-wepatent.md)
- [`docs/DESIGN-HANDOFF.md`](docs/DESIGN-HANDOFF.md)
- [`docs/business-and-product-proposal.md`](docs/business-and-product-proposal.md)
- [`docs/legal-ethics-risk-memo.md`](docs/legal-ethics-risk-memo.md)

## Status

This repository is an initial design handoff and product shell, not production legal software. It does not authenticate users, process confidential inventions, provide legal advice, or submit filings.
