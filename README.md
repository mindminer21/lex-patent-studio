# Lex Patent Studio

Design-stage Next.js codebase for a multi-model, source-grounded patent drafting and strategy workspace with a separate connected-counsel pathway.

## Product lanes

1. **Self-service software** — drafting, analysis, research, model choice, citations, and document exports. Software use does not create an attorney-client relationship.
2. **Meet with Patent Counsel — Evaluate, Prepare & File** — limited conflict intake, attorney review, consultation, separate engagement, counsel-guided preparation, supervised filing, and receipt/docket handoff. Jeff is the initial connected patent lawyer.

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

- [`docs/DESIGN-HANDOFF.md`](docs/DESIGN-HANDOFF.md)
- [`docs/business-and-product-proposal.md`](docs/business-and-product-proposal.md)
- [`docs/legal-ethics-risk-memo.md`](docs/legal-ethics-risk-memo.md)

## Status

This repository is an initial design handoff and product shell, not production legal software. It does not authenticate users, process confidential inventions, provide legal advice, or submit filings.
