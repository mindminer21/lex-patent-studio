-- wepatent private project — reference-data seed (idempotent).
--
-- Local mode seeds these rows in memory; production databases must carry
-- them so FK-constrained flows (terms acceptance, usage reservation,
-- usage-event settlement) resolve. Every value below is copied from the
-- code's authoritative definitions — nothing here is invented:
--
--   * terms_versions        ← src/lib/wepatent/domain/clickwrap.ts
--                             (CURRENT_TERMS_VERSION = "2026-07-30.1")
--   * model_registry        ← src/lib/server/model-registry.ts (MODEL_TIERS,
--                             the tiers the estimate/reserve path writes) and
--                             src/lib/server/adapters/production/model-gateway.ts
--                             (PROVIDER_PRICE_REGISTRY provider models)
--   * model_prices          ← rate versions and cents-per-Mtok exactly as in
--                             those two modules (effective 2026-07-01)
--
-- enabled flag: ONLY the OpenAI model is enabled — OpenAI is the only
-- provider with a live API key. Anthropic/xAI rows are present (reference
-- data with effective dates) but disabled. The local-synthetic tier rows are
-- also disabled; they exist because the production reservation path
-- (src/lib/server/services/generation.ts) records their model ids and rate
-- versions, which are FK targets. No code currently reads the enabled flag;
-- the gateway independently refuses providers without keys.
--
-- max_output_tokens: tiers carry coded values (4000/8000). Provider models
-- have no per-model cap in code; 8000 is used — the maximum any coded tier
-- ever requests (generation requests are capped at tier.maxOutputTokens).
--
-- Safe to re-run at any time (INSERT ... ON CONFLICT DO NOTHING).

begin;

-- ---------------------------------------------------------------------------
-- terms_versions (PRD §7.2 clickwrap). Row for CURRENT_TERMS_VERSION.
-- ---------------------------------------------------------------------------
insert into public.terms_versions (version, summary, material_change)
values (
  '2026-07-30.1',
  'Initial self-service terms: not a law firm; no legal advice; automated working drafts require counsel review; no attorney-client relationship via software use (design-stage text pending final legal review).',
  true
)
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- model_registry
-- ---------------------------------------------------------------------------
insert into public.model_registry (id, provider, display_name, enabled, max_output_tokens)
values
  -- Tiers used by the estimate/reserve path (src/lib/server/model-registry.ts)
  ('wepatent-local-standard', 'local-synthetic', 'Standard drafting model (synthetic local)', false, 4000),
  ('wepatent-local-advanced', 'local-synthetic', 'Advanced drafting model (synthetic local)', false, 8000),
  -- Provider models from PROVIDER_PRICE_REGISTRY (production model gateway)
  ('gpt-4.1',            'openai',    'GPT-4.1',            true,  8000),  -- only provider with a live key
  ('claude-sonnet-4-5',  'anthropic', 'Claude Sonnet 4.5',  false, 8000),
  ('claude-opus-4-1',    'anthropic', 'Claude Opus 4.1',    false, 8000),
  ('grok-4',             'xai',       'Grok 4',             false, 8000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- model_prices — rate versions and cents/Mtok exactly as coded.
-- ---------------------------------------------------------------------------
insert into public.model_prices
  (model_id, rate_version, input_cents_per_million_tokens, output_cents_per_million_tokens, effective_from)
values
  -- src/lib/server/model-registry.ts (MODEL_TIERS)
  ('wepatent-local-standard', '2026-07-01.local.standard',                300,  1500, '2026-07-01T00:00:00Z'),
  ('wepatent-local-advanced', '2026-07-01.local.advanced',               1500,  7500, '2026-07-01T00:00:00Z'),
  -- src/lib/server/adapters/production/model-gateway.ts (PROVIDER_PRICE_REGISTRY)
  ('gpt-4.1',           '2026-07-01.openai.gpt-4.1',                      200,   800, '2026-07-01T00:00:00Z'),
  ('claude-sonnet-4-5', '2026-07-01.anthropic.claude-sonnet-4-5',         300,  1500, '2026-07-01T00:00:00Z'),
  ('claude-opus-4-1',   '2026-07-01.anthropic.claude-opus-4-1',          1500,  7500, '2026-07-01T00:00:00Z'),
  ('grok-4',            '2026-07-01.xai.grok-4',                          300,  1500, '2026-07-01T00:00:00Z')
on conflict (rate_version) do nothing;

commit;
