#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# RLS allow/deny matrix runner (PRD §13 "RLS cross-tenant suite").
#
# Preferred path (Docker available):
#   npx supabase start
#   npx supabase test db        # runs supabase/tests/*.sql with pgTAP
#
# This script is the Docker-free equivalent: it applies the migrations to a
# throwaway database on a plain PostgreSQL 16 server (with a minimal
# Supabase auth shim) and runs the same pgTAP files via pg_prove.
#
# Requirements: postgresql-16, postgresql-16-pgtap, pg_prove.
# Environment: PGHOST, PGPORT, PGUSER, PGPASSWORD for a superuser
#              (defaults: localhost:5432, wepatent_admin/wepatent).
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-wepatent_admin}"
export PGPASSWORD="${PGPASSWORD:-wepatent}"
DB="${RLS_TEST_DB:-wepatent_rls_test}"

echo "== Recreating $DB"
psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DB};" \
  -c "create database ${DB};"

echo "== Applying Supabase auth shim (test harness only)"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/helpers/local_auth_shim.sql

echo "== Applying migrations"
for f in supabase/migrations/0*.sql; do
  echo "   -> $f"
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "== Applying Supabase-equivalent grants + pgTAP + fixture"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/helpers/grants.sql
psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "create extension if not exists pgtap;"
psql -d "$DB" -q -v ON_ERROR_STOP=1 \
  -c "grant execute on all functions in schema public to anon, authenticated, service_role;"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/helpers/seed.sql

echo "== Running pgTAP suite"
pg_prove -d "$DB" --ext .sql supabase/tests/0*.sql
