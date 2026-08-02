# wepatent seed — reference data

`0001_reference_data.sql` inserts the platform reference rows that local mode
seeds in memory but a fresh production database lacks:

- `terms_versions` — the current clickwrap version
  (`CURRENT_TERMS_VERSION` in `src/lib/wepatent/domain/clickwrap.ts`).
  Without it, `terms_acceptances` inserts fail their FK and the app cannot
  record clickwrap acceptance.
- `model_registry` + `model_prices` — the model tiers the estimate/reserve
  path writes (`src/lib/server/model-registry.ts`) and the provider price
  registry (`PROVIDER_PRICE_REGISTRY` in
  `src/lib/server/adapters/production/model-gateway.ts`). Without them,
  `usage_reservations` / `usage_events` inserts fail their FKs and no
  generation can even reserve.

## When to run

- Once against every new environment/database, after migrations.
- Again whenever the code bumps `CURRENT_TERMS_VERSION`, adds a model tier,
  or adds a rate version (add the new rows here first, keeping values
  identical to the code).

The file is idempotent (`INSERT ... ON CONFLICT DO NOTHING`) — re-running it
is always safe and never mutates existing rows.

## How to run

Supabase SQL editor, `psql "$DATABASE_URL" -f 0001_reference_data.sql`, or the
management API `POST /v1/projects/{ref}/database/query`.

## Notes

- Only the OpenAI model (`gpt-4.1`) is `enabled` — the only provider with a
  live API key. Anthropic/xAI rows are present but disabled. No code reads
  the flag today (the gateway refuses keyless providers on its own), so this
  is documentation-by-data until a registry read lands.
- Live model pricing/markup changes require Jeff's explicit approval
  (PRD FR-6); this file only mirrors what the code already declares.
