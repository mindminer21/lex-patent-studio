# Tenant-isolation and policy tests

Placeholder for the RLS allow/deny matrix required by PRD §13 ("RLS
cross-tenant suite: all denials pass") and §5.7.

These tests run with `supabase start` (local stack) + pgTAP or the SQL test
harness, and are approval-gated only in the sense that they need a local
Supabase CLI environment — no remote project. Planned coverage:

- For every tenant table: member of org A cannot select/insert/update rows of
  org B (deny matrix).
- `terms_acceptances`, `wallet_ledger_entries`, `usage_events`,
  `audit_events`, `counsel_request_events`, `draft_versions`, `exports` are
  immutable from application roles.
- `counsel_requests` transition trigger rejects every non-adjacent state jump
  and rejects `engagement_signed` without a signed engagement record.
- `invention_facts` restrictive policies reject `counsel_reviewed` writes
  from application roles.
- Money math checks: usage settlement rows violating charge = ceil(cost×1.5)
  or charge > reservation are rejected.

The in-application equivalents of these guards are covered today by the
vitest suite in `/tests`.
