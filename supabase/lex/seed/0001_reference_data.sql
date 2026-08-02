-- Lex Patent Studio private project — reference-data seed (idempotent).
--
-- Local mode serves these as in-memory code constants; production databases
-- must carry them as rows. Every value below is copied from the code's
-- authoritative definitions — nothing here is invented:
--
--   * model_registry / model_prices ← src/lib/domain/pricing.ts
--       (MODEL_CATALOG, 8 models; provider USD/Mtok rates; markup 1.50;
--        effective 2026-07-01). src/lib/adapters/production/gateway.ts:
--        "the code catalog is the seed for those tables".
--   * workflow_definitions ← src/lib/domain/tiers.ts (WORKFLOW_KEYS +
--       WORKFLOW_TIER_FLOOR, platform policy, Invariant 15) and
--       src/lib/domain/workflow-meta.ts (COMPOSER_WORKFLOWS metadata).
--       Version tag 'local-0.2' is the version string the code emits today
--       (src/lib/adapters/local/index.ts: `${workflowKey}@local-0.2`);
--       bump it when a production workflow versioning scheme is decided.
--
-- enabled_for_customers: ONLY OpenAI models are enabled — OpenAI is the only
-- provider with a live API key. Anthropic and xAI rows are present
-- (effective-dated reference data) but disabled; xAI is additionally
-- approval-gated per PRD §20.13.
--
-- NOT seeded here, deliberately:
--   * style_profiles — organization-scoped (organization_id/created_by NOT
--     NULL). The platform-default "neutral-professional" profile must be
--     inserted per tenant at organization provisioning (see README).
--   * terms_versions — no Lex code path reads or validates a Lex terms
--     version yet (professional-lane clickwrap is approval-gated; the signup
--     page shows static copy only). Seeding one would invent a version and
--     content_sha256 that exist nowhere in code.
--
-- Safe to re-run at any time (ON CONFLICT DO NOTHING / WHERE NOT EXISTS).

begin;

-- ---------------------------------------------------------------------------
-- model_registry — MODEL_CATALOG (src/lib/domain/pricing.ts)
-- ---------------------------------------------------------------------------
insert into model_registry (model_id, provider, display_name, model_tier, enabled_for_customers)
values
  ('gpt-5-mini',        'openai',    'GPT-5 mini',        'fast',     true),
  ('claude-haiku-4-5',  'anthropic', 'Claude Haiku 4.5',  'fast',     false),
  ('grok-4-fast',       'xai',       'Grok 4 Fast',       'fast',     false), -- approval-gated (PRD §20.13)
  ('gpt-5',             'openai',    'GPT-5',             'advanced', true),
  ('claude-sonnet-4-5', 'anthropic', 'Claude Sonnet 4.5', 'advanced', false),
  ('grok-4',            'xai',       'Grok 4',            'advanced', false), -- approval-gated (PRD §20.13)
  ('claude-opus-4-1',   'anthropic', 'Claude Opus 4.1',   'frontier', false),
  ('gpt-5-pro',         'openai',    'GPT-5 Pro',         'frontier', true)
on conflict (model_id) do nothing;

-- ---------------------------------------------------------------------------
-- model_prices — provider USD/Mtok exactly as coded; markup 1.50 (FR-9,
-- charge = provider cost × 1.50); effective 2026-07-01.
-- model_prices has no natural unique key, so idempotency is via NOT EXISTS
-- on (model, effective_from).
-- ---------------------------------------------------------------------------
insert into model_prices (model_registry_id, input_per_mtok_usd, output_per_mtok_usd, markup, effective_from)
select r.id, v.input_usd, v.output_usd, 1.50, date '2026-07-01'
from (
  values
    ('gpt-5-mini',          0.25::numeric,   2.0::numeric),
    ('claude-haiku-4-5',    1.0,             5.0),
    ('grok-4-fast',         0.2,             0.5),
    ('gpt-5',               1.25,           10.0),
    ('claude-sonnet-4-5',   3.0,            15.0),
    ('grok-4',              3.0,            15.0),
    ('claude-opus-4-1',    15.0,            75.0),
    ('gpt-5-pro',          15.0,           120.0)
) as v (model_id, input_usd, output_usd)
join model_registry r on r.model_id = v.model_id
where not exists (
  select 1 from model_prices p
  where p.model_registry_id = r.id and p.effective_from = date '2026-07-01'
);

-- ---------------------------------------------------------------------------
-- workflow_definitions — platform policy rows (no organization_id).
-- Keys + tier floors: src/lib/domain/tiers.ts. Composer metadata (label,
-- description, deliverable types, workload planning profile):
-- src/lib/domain/workflow-meta.ts. Non-composer workflows carry the minimal
-- policy definition (key + floor) — they have no composer metadata in code.
-- ---------------------------------------------------------------------------
insert into workflow_definitions (workflow_key, version, tier_floor, definition)
values
  ('ids_packet', 'local-0.2', 'A', '{"label":"IDS packet preparation","description":"Reference extraction, citation classification, SB/08 field validation.","deliverableTypes":["IDS packet (SB/08 fields)"],"workload":{"inputTokens":40000,"outputTokens":8000,"variance":0.25},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('formalities_check', 'local-0.2', 'A', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb),
  ('dependent_claim_draft', 'local-0.2', 'A', '{"label":"Dependent claims (established strategy)","description":"Routine dependent-claim drafting per an approved strategy.","deliverableTypes":["Dependent claim additions"],"workload":{"inputTokens":45000,"outputTokens":9000,"variance":0.25},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('status_digest', 'local-0.2', 'A', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb),
  ('invention_intake', 'local-0.2', 'B', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb),
  ('fact_extraction', 'local-0.2', 'B', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb),
  ('section_draft', 'local-0.2', 'B', '{"label":"Section drafting","description":"Draft specification sections from the approved fact ledger only.","deliverableTypes":["Background & summary","Detailed description","Abstract"],"workload":{"inputTokens":90000,"outputTokens":18000,"variance":0.35},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('claim_tree_draft', 'local-0.2', 'B', '{"label":"Claim tree with fallbacks","description":"Independent/dependent claim tree with planned-retreat fallback hierarchy.","deliverableTypes":["Claim set draft","Claim strategy skeleton"],"workload":{"inputTokens":70000,"outputTokens":14000,"variance":0.35},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('oa_analysis', 'local-0.2', 'B', '{"label":"Office-action analysis","description":"Parse rejections into an evidence-linked rejection matrix.","deliverableTypes":["Rejection matrix","Rejection matrix + response-path options"],"workload":{"inputTokens":120000,"outputTokens":16000,"variance":0.3},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('oa_response_draft', 'local-0.2', 'B', '{"label":"OA response drafting","description":"Amendments with MPEP-compliant markup, separate from arguments.","deliverableTypes":["Amendment draft","Argument outline","Response shell"],"workload":{"inputTokens":110000,"outputTokens":22000,"variance":0.35},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('search_report', 'local-0.2', 'B', '{"label":"Search report","description":"Public-data search orchestration with per-reference relevance rationale.","deliverableTypes":["Search report (house style)"],"workload":{"inputTokens":150000,"outputTokens":20000,"variance":0.4},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('research_memo', 'local-0.2', 'B', '{"label":"Cited research memo","description":"Primary-authority-first research with as-of dating and supersession checks.","deliverableTypes":["Research memo with source trail"],"workload":{"inputTokens":130000,"outputTokens":15000,"variance":0.35},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('declaration_132', 'local-0.2', 'B', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb),
  ('response_path_options', 'local-0.2', 'C', '{"label":"Response-path options","description":"Options, tradeoffs, and estoppel flags. The practitioner decides.","deliverableTypes":["Decision-support brief (options only)"],"workload":{"inputTokens":100000,"outputTokens":12000,"variance":0.3},"source":"src/lib/domain/workflow-meta.ts"}'::jsonb),
  ('claim_scope_strategy', 'local-0.2', 'C', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb),
  ('filing_strategy_options', 'local-0.2', 'C', '{"source":"src/lib/domain/tiers.ts","composer":false}'::jsonb)
on conflict (workflow_key, version) do nothing;

commit;
