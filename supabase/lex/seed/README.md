# Lex seed — reference data

`0001_reference_data.sql` inserts the platform reference rows that local mode
serves from code constants but a fresh production database lacks:

- `model_registry` + `model_prices` — the 8-model catalog from
  `src/lib/domain/pricing.ts` (`MODEL_CATALOG`), provider rates exactly as
  coded, markup 1.50, effective 2026-07-01. The production gateway comments
  say it explicitly: "the code catalog is the seed for those tables".
- `workflow_definitions` — all 16 platform workflow keys with their tier
  floors (`src/lib/domain/tiers.ts`, Invariant 15) plus composer metadata
  where it exists (`src/lib/domain/workflow-meta.ts`). Version tag
  `local-0.2` matches the version string the code emits on runs today.

## When to run

- Once against every new environment/database, after migrations.
- Again when the code adds models, changes effective-dated rates (add new
  effective rows, don't edit old ones), or adds workflow keys.

The file is idempotent — re-running is always safe.

## How to run

Supabase SQL editor, `psql "$DATABASE_URL" -f 0001_reference_data.sql`, or the
management API `POST /v1/projects/{ref}/database/query`.

## Deliberately NOT seeded

- `style_profiles` — organization-scoped (`organization_id` and `created_by`
  are NOT NULL). Insert the platform-default profile **per tenant at
  organization provisioning**, using the rules from the local seed
  (`SEED_STYLE_PROFILES` in `src/lib/adapters/local/seed.ts`):

  ```sql
  insert into style_profiles
    (organization_id, name, kind, version, rules, created_by, platform_default)
  values (
    '<org-uuid>', 'neutral-professional', 'application_drafting', 1,
    '["Prefer ''configured to'' over means-plus-function phrasing unless §112(f) treatment is intended.",
      "Introduce every claim element in the specification before first claim use.",
      "One embodiment per paragraph in the detailed description; alternatives follow the primary embodiment.",
      "State advantages as technical effects tied to structure, never as marketing claims."]'::jsonb,
    '<provisioning-admin-uuid>', true);
  ```

  There are currently no organizations in the Lex production database, so
  there is nothing to attach it to yet.
- `terms_versions` — no Lex code path reads a Lex terms version
  (professional-lane clickwrap is approval-gated; the signup page shows
  static copy). Seeding one would invent a version and `content_sha256` that
  exist nowhere in code.

## Notes

- `enabled_for_customers` is true ONLY for OpenAI models (`gpt-5-mini`,
  `gpt-5`, `gpt-5-pro`) — the only provider with a live API key. Anthropic
  rows await key provisioning; xAI enablement is approval-gated
  (PRD §20.13).
- Run execution in production remains behind the approval-gated seam
  (`createRun` refuses); these rows make the schema's reference data
  complete so enabling it later is a code/config change, not a data fix.
