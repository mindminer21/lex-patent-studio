# RLS allow/deny matrix (PRD §13, §5.7)

pgTAP test suite for the private application schema. **These tests run for
real** — they are not placeholders.

## Files

| File | Coverage |
|---|---|
| `01_cross_tenant_matrix.sql` | Member of org A cannot select/insert/update/delete any org B row across every tenant table; anonymous sessions see nothing |
| `02_role_and_write_policies.sql` | Viewer read-only; owner allowed/forbidden writes; `counsel_reviewed` reserved for the counsel lane; money tables read-only; model rates hidden; counsel-lane separation |
| `03_immutability.sql` | Append-only tables (terms acceptances, ledger, usage/audit events, draft versions, exports, counsel audit) are immutable at both the policy layer and the trigger layer |
| `04_counsel_transitions_and_money.sql` | In-database counsel-request adjacency guard, signed-engagement evidence rule, markup/cap check constraints, no counsel roles via invitations, `working_draft`-only labels |
| `helpers/local_auth_shim.sql` | **Test harness only** — recreates `auth.uid()`, `auth.users`, and the anon/authenticated/service_role roles on plain PostgreSQL |
| `helpers/grants.sql` | **Test harness only** — mirrors Supabase's default table grants (RLS is the enforcement layer) |
| `helpers/seed.sql` | Two synthetic tenants with rows in every guarded table, plus `tests.authenticate_as()` impersonation helpers |

## Running without Docker (this container, plain PostgreSQL 16 + pgTAP)

```bash
./scripts/test-rls.sh
# == Running pgTAP suite → 4 files, 105 assertions, Result: PASS
```

Requires `postgresql-16`, `postgresql-16-pgtap`, `pg_prove`, and a superuser
(defaults: `wepatent_admin`/`wepatent` on localhost:5432; override with
PGHOST/PGPORT/PGUSER/PGPASSWORD/RLS_TEST_DB).

## Running with the Supabase local stack (Docker available)

```bash
npx supabase start
psql "$(npx supabase status -o json | jq -r .DB_URL)" \
  -f supabase/tests/helpers/seed.sql       # fixture (auth shim/grants not needed)
npx supabase test db                        # runs supabase/tests/*.sql with pgTAP
```

Note: on the real stack, skip `helpers/local_auth_shim.sql` and
`helpers/grants.sql` — the platform provides that surface. The fixture only
touches `auth.users(id, email)`, which exists identically there.

## Never against production

This suite creates throwaway databases and synthetic fixtures. Applying the
harness or fixture to a real Supabase project is prohibited (PRD §17).
