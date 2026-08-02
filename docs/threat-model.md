# wepatent threat model

**Scope:** the wepatent application in this repository (PRD `docs/PRD-wepatent.md` §11).
**Method:** per trust boundary, the primary threats and the concrete controls in code, with
verification pointers. Residual risks and production-only items are listed at the end.

## Assets

1. Customer invention content (facts, uploads, drafts, exports) — confidentiality and integrity.
2. Tenant boundaries (organization isolation).
3. Money (wallet balances, reservations, Stripe events).
4. Legal-boundary state (counsel request ≠ engagement; nothing implies representation or filing).
5. Credentials (Supabase service keys, Stripe keys, provider API keys, session secret).
6. Audit trail integrity (clickwrap, counsel transitions, purge evidence).

## Trust boundaries and controls

### 1. Browser ↔ Next.js BFF

| Threat | Control | Verified by |
|---|---|---|
| Session forgery | HMAC-signed HTTP-only cookie; tenant/role always derived server-side from membership, never from client input (§5.6) | `tests/services-flow.test.ts`, e2e cross-tenant test |
| XSS / clickjacking / MIME sniffing | CSP, frame denial, nosniff, referrer + permissions policies in `next.config.ts` | `e2e/quality-gates.spec.ts` (headers) |
| CSRF | Server Actions (same-site POST w/ Next origin checks) + `sameSite=lax` cookies; JSON APIs require session cookie | route tests |
| Credential stuffing / brute force | Two-layer sign-in rate limit per hashed IP (`src/lib/server/rate-limit.ts`) | `tests/rate-limit.test.ts` |
| Oversized/malformed input | Zod on every mutation; `readJsonBody` size cap; webhook body cap | unit + route tests |
| Information leakage | Generic external errors; raw provider/Stripe/storage detail confined to `internalDetail` + redacted structured logs | `tests/model-gateway.test.ts`, `tests/stripe-billing.test.ts`, `tests/observability.test.ts` |

### 2. BFF ↔ private Supabase (production)

- Service-role key server-only (`src/lib/env`, never `NEXT_PUBLIC_`).
- RLS on every tenant table; allow/deny matrix of 105 pgTAP assertions (`./scripts/test-rls-wepatent.sh`).
- Immutability policies for terms acceptances / audit events (`supabase/wepatent/tests/03_immutability.sql`).
- Explicit service-boundary authorization (`can(role, action)`) in addition to RLS (FR-2).

### 3. BFF/worker ↔ public corpus (separate project)

- Separate credentials enforced at boot: production refuses identical URLs (`loadEnv`).
- Corpus adapter fails closed without recorded `rag` license provenance; excerpts hard-capped
  (legal memo §6); outage degrades to "no references" instead of blocking (`tests/corpus.test.ts`).
- No tenant data ever flows to the corpus project (read-only queries).

### 4. Worker ↔ model providers

- Keys server-side only; kill switch; per-provider circuit breaker; timeout; bounded retry;
  pre-flight cost cap; reservation ceiling means a run can never exceed its reserved budget (§5.10).
- Prompt-injection posture (§11): invention content is wrapped in explicit "untrusted data"
  delimiters; system instruction forbids treating it as commands; model output is stored as text
  with a fixed `working_draft` label — it cannot mutate facts, approve itself, or trigger actions
  (§5.9); the model-actor guard rejects model-set provenance (`tests/facts.test.ts`).
- No raw provider error or key reaches the browser (`tests/model-gateway.test.ts`).

### 5. Stripe ↔ webhook endpoint

- HMAC signature verification (constant-time), replay tolerance window, event-id idempotency
  (PK on `stripe_events`), billing outbox with `stripeReference` ledger guard — a crash between
  credit and outbox-done cannot double-credit (`tests/stripe-billing.test.ts`, `e2e/billing.spec.ts`).
- Money is integer cents; ledger append-only; legal fees are structurally impossible to record
  as platform revenue (no ledger kind for them; §7.6).

### 6. Upload client ↔ private storage/quarantine

- Short-lived HMAC-signed upload tokens; extension + MIME allowlist; magic-byte validation;
  size caps; everything lands in `quarantined` and can only leave via the scan step (the state
  machine has no bypass transition) (`tests/uploads.test.ts`).
- Production storage is a private bucket accessed with service credentials only; paths are
  tenant-prefixed and segment-encoded (`tests/supabase-storage.test.ts`).

### 7. Self-service app ↔ connected-counsel administration

- Counsel roles never grantable via membership/invitations (schema + service + tests).
- Separate session surface (`requireCounsel`), separate audit trail (`counsel_audit_events`),
  MFA required in production (FR-1), state-machine adjacency + role guards for every transition
  (`tests/counsel-lane.test.ts`); filing packages have no "submitted" state — the platform
  cannot file (§16).

### 8. Operator / support

- `platform_support` has zero standing grants; break-glass requires a server-side env flag,
  is metadata-only, and audits both uses and refused attempts (`tests/retention.test.ts`).

## Residual risks / production-only items

1. In-memory rate limiting and metrics are per-instance; a multi-instance deployment moves the
   same interfaces onto a shared store (call sites unchanged). Tracked in the ledger.
2. Local `scanBytes` is a deterministic scanner (EICAR-style + structural checks); a commercial
   malware-scanning service is part of production activation (§17.1).
3. Real Supabase Auth flows (email verification, password reset, MFA enrollment) are hosted by
   Supabase and activate with credentials (§17.1); enforcement points are already in code.
4. Embedding-based corpus retrieval requires a provider account (§17.4); keyword retrieval is
   the launch path.
5. Export-controlled / sanctioned-user screening (legal memo §5) is a launch-gate policy item
   requiring external data services; the intake collects no defense-classified categories and
   the terms prohibit them, but automated screening is not yet wired.
