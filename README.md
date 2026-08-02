# Lex Patent Studio / wepatent

This repository contains **wepatent** — a subscription invention-documentation and
counsel-readiness application (implemented here per `docs/PRD-wepatent.md`) — alongside the
design-stage shell of **Lex Patent Studio**, the separate practitioner product.

## Product and brand architecture

1. **wepatent** — for VCs, founders, early-stage companies, R&D departments, and innovation
   teams: structured invention records, source-grounded working drafts, counsel-ready exports,
   and an optional connected-counsel request lane. Not a law firm; no legal advice; a request,
   upload, schedule action, or payment is not representation; drafts require counsel review.
2. **Lex Patent Studio** — the professional product for law firms and supervised patent
   operations. Kept behind a separate identity; design proof only in this repository.
3. **Connected-counsel administration** — a separately gated context (`/counsel/**`) for
   limited conflict intake, attorney accept/decline, engagement, matter transfer, and a
   supervised filing-package workflow with **no** submission capability.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- Adapter ports for Supabase (private app + separate public corpus), Stripe, and
  OpenAI/Anthropic/xAI — production adapters implemented; **activation is approval-gated**
  (PRD §17) and every external is replaced by a credential-free local implementation in
  `APP_MODE=local` (the default)

## Run locally

```bash
npm ci
npm run dev     # http://localhost:3000 — synthetic in-memory data, no credentials
```

## Quality gates (PRD §13)

```bash
npm run lint && npm run typecheck && npm test && npm run build
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e
npm run audit:prod && npm run scan:secrets
./scripts/test-rls.sh          # RLS allow/deny matrix (PostgreSQL 16 + pgTAP)
```

## Documentation

- [`docs/PRD-wepatent.md`](docs/PRD-wepatent.md) — implementation source of truth
- [`docs/LEDGER-wepatent.md`](docs/LEDGER-wepatent.md) — requirements traceability + status
- [`docs/threat-model.md`](docs/threat-model.md) — trust boundaries and controls
- [`docs/runbooks.md`](docs/runbooks.md) — verification, production activation, incident controls
- [`docs/legal-ethics-risk-memo.md`](docs/legal-ethics-risk-memo.md)
- [`docs/business-and-product-proposal.md`](docs/business-and-product-proposal.md)
- [`tasks/implementation-plan.md`](tasks/implementation-plan.md)

## Status

wepatent is implemented and verified end-to-end in credential-free local mode with synthetic
data. It is **not deployed and not public**: creating external accounts, storing real customer
data, publishing terms, live billing, provider usage, deployment, outreach, connected-counsel
activation, and any Patent Center interaction all require Jeff's explicit approval first
(PRD §17). The software provides no legal advice and submits no filings in any mode.
