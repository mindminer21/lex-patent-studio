# Lex Patent Studio + wepatent (reconciled monorepo)

One repository, two separable products (distinct deployments/identities in production,
shared implementation tree for convenience):

1. **Lex Patent Studio** — the professional patent workspace for law firms, patent
   attorneys/agents, in-house legal teams, and supervised patent operations
   (`docs/PRD-lex-patent-studio.md`). Marketed as **"Your next patent associate"** with an
   immediate responsible-practitioner supervision qualifier.
2. **wepatent** — the self-service invention-documentation and counsel-readiness product for
   founders, VCs, R&D departments, and innovation teams (`docs/PRD-wepatent.md`). Not a law
   firm; no legal advice; drafts require counsel review.
3. **Connected-counsel administration** — wepatent's separately gated `/counsel/**` lane for
   limited conflict intake, attorney accept/decline, engagement, and a supervised
   filing-package workflow with **no** submission capability.

Both products must keep different brands, domains/deployments, visual identities, onboarding,
terms, billing descriptors, and output permissions. Public positioning and legal boundaries
remain separate.

## Route ownership

| Surface | Owner | Routes |
| --- | --- | --- |
| Root marketing + legal | Lex | `/`, `/product/**`, `/pricing`, `/legal/**`, `/login`, `/signup`, … |
| Lex workspace | Lex | `/app/**` |
| wepatent public | wepatent | `/wepatent/**` (`/venture` and `/self-service-terms` 308-redirect here) |
| wepatent workspace | wepatent | `/wepatent/app/**` (guarded by `src/proxy.ts`) |
| Counsel admin lane | wepatent | `/counsel/**` |
| APIs | both | `/api/**` — Lex: matters/runs/exports/knowledge…; wepatent: inventions/jobs/stripe/… |

## Library ownership

- Lex: `src/lib/env`, `src/lib/domain`, `src/lib/adapters`, `src/lib/api`, `src/lib/eval`,
  `src/lib/export`, `src/lib/knowledge`.
- wepatent: `src/lib/wepatent/env`, `src/lib/wepatent/domain`, `src/lib/server/**`,
  `src/lib/config/redirects.ts`, `src/components/wepatent/**`.
- Supabase (separate projects per product in production): `supabase/lex/**` and
  `supabase/wepatent/**` (each with its own migrations, corpus-project SQL, and pgTAP tests).

Both env contracts are independent (`LEX_*` variables vs wepatent's unprefixed set); local
mode boots with zero credentials for both products.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- Adapter ports for Supabase (private app + separate public corpus per product), Stripe, and
  OpenAI/Anthropic/xAI — every external is replaced by a credential-free local implementation
  in local mode (the default); production activation is approval-gated in both PRDs.

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000 — synthetic in-memory data, no credentials
```

Lex lives at `/` and `/app`; wepatent at `/wepatent` and `/wepatent/app`.

## Quality checks

```bash
npm run lint                     # ESLint (0 errors)
npm run typecheck                # tsc --noEmit
npm run test:lex                 # Lex unit/integration suite (vitest.lex.config.mts)
npm run test:wepatent            # wepatent unit suite (vitest.wepatent.config.ts)
npm test                         # both unit suites
npm run build                    # production build (both products)
npm run test:e2e:lex             # 14 Playwright journeys (build first; port 4123)
npm run test:e2e:wepatent        # 32 Playwright journeys (build first; port 3300)
npm run test:rls:lex             # 96 pgTAP assertions vs PostgreSQL 16 (supabase/lex)
npm run test:rls:wepatent        # 105 pgTAP assertions vs PostgreSQL 16 (supabase/wepatent)
npm run test:production-adapter  # Lex production Postgres adapter vs a throwaway database
npm run audit:prod               # wepatent §13 gate
npm run scan:secrets             # wepatent §13 gate
npm run verify                   # lint + typecheck + both unit suites + build
```

## Documentation

- [`docs/PRD-lex-patent-studio.md`](docs/PRD-lex-patent-studio.md) — Lex source of truth
- [`docs/PRD-wepatent.md`](docs/PRD-wepatent.md) — wepatent source of truth
- [`docs/LEDGER-lex.md`](docs/LEDGER-lex.md) / [`docs/LEDGER-wepatent.md`](docs/LEDGER-wepatent.md) — traceability + reconciliation notes
- [`docs/threat-model.md`](docs/threat-model.md), [`docs/runbooks.md`](docs/runbooks.md) (wepatent)
- [`docs/DESIGN-HANDOFF.md`](docs/DESIGN-HANDOFF.md), [`docs/business-and-product-proposal.md`](docs/business-and-product-proposal.md), [`docs/legal-ethics-risk-memo.md`](docs/legal-ethics-risk-memo.md)

## Status

Both products are implemented and verified end-to-end in credential-free local mode with
synthetic data. Neither is deployed or public: external accounts, real customer data, live
billing, provider usage, deployment, outreach, connected-counsel activation, and any Patent
Center interaction all require Jeff's explicit approval first (Lex PRD §20; wepatent PRD §17).
This software never provides legal advice and never submits filings in any mode.
