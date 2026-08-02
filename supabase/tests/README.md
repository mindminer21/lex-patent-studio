# RLS allow/deny matrix (real PostgreSQL)

`scripts/test-rls.sh` applies every migration to throwaway databases on a
plain PostgreSQL 16 server (Supabase auth shimmed) and runs these pgTAP
suites via pg_prove:

- `01_cross_tenant_matrix.sql` — Invariant 18: absolute cross-tenant
  isolation on every guarded table, URL-tampering-style direct-id fetches,
  write denial (all writes are service-role only), anon denial, and
  service-only tables (stripe_events, billing_outbox).
- `02_roles_and_matter_acl.sql` — FR-2 role-scoped reads: contributor/viewer
  seats see only ACL-shared matters; playbook is unreadable for contributor
  and viewer; billing detail restricted to owner/practitioner_admin.
- `03_immutability_and_invariants.sql` — append-only triggers (audit,
  playbook, review decisions, wallet ledger, usage events, export manifests)
  hold even for the service role; deadline disclaimer flag cannot be false
  (Invariant 20); critic model must differ from drafting model (FR-6);
  markup floor.
- `corpus/01_license_gate.sql` — corpus project: retrievable_documents view
  structurally excludes non-commercial-clear classes; ingestion refuses
  missing license basis; releases are immutable.

Run: `npm run test:rls` (requires postgresql-16, postgresql-16-pgtap,
pg_prove; superuser defaults lex_admin/lex, override via PG* env vars).

The helpers in `helpers/` are TEST HARNESS ONLY — never apply them to a real
Supabase project.
