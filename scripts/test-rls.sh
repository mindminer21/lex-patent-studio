#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# RLS allow/deny matrix runner (PRD FR-2, §16 "RLS matrix vs real Postgres").
#
# Preferred path (Docker available):
#   npx supabase start && npx supabase test db
#
# This script is the Docker-free equivalent (pattern shared with the sibling
# wepatent track): it applies the migrations to throwaway databases on a
# plain PostgreSQL 16 server (with a minimal Supabase auth shim) and runs
# the pgTAP suites via pg_prove.
#
#   1. lex_rls_test     — private application project (0001–0004 migrations)
#   2. lex_corpus_test  — public corpus project (corpus-migrations)
#
# Requirements: postgresql-16, postgresql-16-pgtap, pg_prove.
# Environment: PGHOST/PGPORT/PGUSER/PGPASSWORD for a superuser
#              (defaults: localhost:5432, lex_admin/lex).
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-lex_admin}"
export PGPASSWORD="${PGPASSWORD:-lex}"
DB="${RLS_TEST_DB:-lex_rls_test}"
CORPUS_DB="${CORPUS_TEST_DB:-lex_corpus_test}"

echo "== Recreating $DB and $CORPUS_DB"
psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DB};" \
  -c "create database ${DB};" \
  -c "drop database if exists ${CORPUS_DB};" \
  -c "create database ${CORPUS_DB};"

echo "== [private] Applying Supabase auth shim (test harness only)"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/helpers/local_auth_shim.sql

echo "== [private] Applying migrations"
for f in supabase/migrations/0*.sql; do
  echo "   -> $f"
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "== [private] Grants + pgTAP + fixture"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/helpers/grants.sql
psql -d "$DB" -q -v ON_ERROR_STOP=1 -c "create extension if not exists pgtap;"
psql -d "$DB" -q -v ON_ERROR_STOP=1 \
  -c "grant execute on all functions in schema public to anon, authenticated, service_role;"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/helpers/seed.sql

echo "== [private] Running pgTAP suite"
pg_prove -d "$DB" --ext .sql supabase/tests/0*.sql

echo "== [corpus] Applying corpus migrations (separate project, separate DB)"
for f in supabase/corpus-migrations/0*.sql; do
  echo "   -> $f"
  psql -d "$CORPUS_DB" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql -d "$CORPUS_DB" -q -v ON_ERROR_STOP=1 -c "create extension if not exists pgtap;"

echo "== [corpus] Running pgTAP suite"
pg_prove -d "$CORPUS_DB" --ext .sql supabase/tests/corpus/0*.sql

echo "== RLS + corpus suites passed"
