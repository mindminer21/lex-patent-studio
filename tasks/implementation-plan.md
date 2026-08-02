# wepatent implementation plan and task list (PRD §18)

Source of truth for scope: `docs/PRD-wepatent.md`.
Live status + evidence: `docs/LEDGER-wepatent.md` (requirements traceability table).

## Phase status (PRD §15)

| Phase | Status | Notes |
|---|---|---|
| 0 — Production foundation | done | Routes/redirects, env contract, security headers, adapter seams, domain primitives, test framework, secret scan, dependency remediation (overrides), threat model |
| 1 — Authenticated invention record MVP | done (local mode) | Tenancy, clickwrap, intake, facts/contributors/timeline, uploads, RLS + pgTAP matrix |
| 2 — Grounded generation and exports | done (local mode) | Durable jobs, model gateway (+ production provider adapters), price registry, reservations, corpus-grounded drafts with citations, DOCX/PDF exports |
| 3 — Billing and private beta | done up to activation seam | Wallet/ledger/reservations live; Stripe adapter + webhooks + outbox implemented and tested; live billing approval-gated (§17.4); beta matters require Jeff (§17.2) |
| 4 — Connected counsel | done up to activation seam | Full lane implemented + tested; enabling real intake is approval-gated (§17.7) |
| 5 — General availability | blocked on external parties | Final legal review, security assessment, a11y audit (automated scan green; formal audit external), DPAs, launch approvals |

## Standing task list

- [x] All §6.1 public routes + 308 redirects + security headers
- [x] §6.2 authenticated routes; §6.3 counsel routes
- [x] §7.1–§7.6 flows with acceptance criteria under test
- [x] FR-1 rate limiting + MFA-for-counsel enforcement seam
- [x] FR-2 roles, service-boundary authz, break-glass disabled+audited
- [x] FR-3 provenance, versions, soft delete, retention purge
- [x] FR-4 signed uploads, magic-byte validation, quarantine, async scan/extract
- [x] FR-5 provider gateway (OpenAI/Anthropic/xAI), price registry, caps, breaker, kill switch
- [x] FR-6 Stripe checkout/portal/webhooks/outbox, immutable ledger, ×1.50 markup
- [x] FR-7 correlation IDs, redacted structured logs, metrics
- [x] §9 full schema (8 migrations) + corpus schema; §10 all 14 endpoints
- [x] §12 automated a11y/responsive/console gates green
- [x] §13 unit (162) + RLS (105 pgTAP) + E2E (32) + release-gate tooling
- [ ] Production-only: apply migrations to live projects, live-stack `supabase test db`,
      Stripe test-mode end-to-end, provider smoke run, deploy gates (all approval-gated — §17)

## Working agreement

Follow `docs/LEDGER-wepatent.md` → "Next action" when resuming. Never push, deploy, create
external accounts, or use real credentials without Jeff's explicit approval.
