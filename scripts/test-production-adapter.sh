#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Production-adapter integration suite (credential-free).
#
# Provisions a throwaway PostgreSQL 16 database with the full migration set
# (same shim/grants as the RLS harness) and runs the PgDataAdapter
# integration tests against it via LEX_PG_TEST_URL. This is the "tested to
# the extent possible without credentials" evidence for the production seam.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-lex_admin}"
export PGPASSWORD="${PGPASSWORD:-lex}"
DB="${PROD_ADAPTER_TEST_DB:-lex_prod_adapter_test}"

echo "== Recreating $DB"
psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DB};" \
  -c "create database ${DB};"

echo "== Applying auth shim + migrations"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/lex/tests/helpers/local_auth_shim.sql
for f in supabase/lex/migrations/0*.sql; do
  echo "   -> $f"
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "== Running integration suite"
LEX_PG_TEST_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}" \
  npx vitest run src/lib/adapters/production

echo "== Production-adapter suite passed"
