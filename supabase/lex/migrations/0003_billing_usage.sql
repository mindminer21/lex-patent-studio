-- Lex Patent Studio — private application project
-- Migration 0003: model registry, wallet, usage, Stripe plumbing (FR-9,
-- PRD-wepatent FR-6). Reservation-before-run; charge = provider cost × 1.50
-- with effective-dated rates; immutable ledger.

-- ---------------------------------------------------------------------------
-- Model registry (platform tables; effective-dated prices)
-- ---------------------------------------------------------------------------

create table model_registry (
  id uuid primary key default gen_random_uuid(),
  model_id text not null unique,
  provider text not null check (provider in ('openai','anthropic','xai')),
  display_name text not null,
  model_tier text not null check (model_tier in ('fast','advanced','frontier')),
  -- Customer enablement is approval-gated (e.g., xAI per PRD §20.13).
  enabled_for_customers boolean not null default false,
  created_at timestamptz not null default now()
);

create table model_prices (
  id uuid primary key default gen_random_uuid(),
  model_registry_id uuid not null references model_registry (id) on delete cascade,
  input_per_mtok_usd numeric(12,6) not null check (input_per_mtok_usd > 0),
  output_per_mtok_usd numeric(12,6) not null check (output_per_mtok_usd > 0),
  markup numeric(4,2) not null default 1.50 check (markup >= 1.00),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index model_prices_model_effective_idx
  on model_prices (model_registry_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- Wallet and usage (immutable ledger; reservation → settlement)
-- ---------------------------------------------------------------------------

create table wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  currency text not null default 'usd',
  created_at timestamptz not null default now(),
  unique (organization_id)
);

create table wallet_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  wallet_account_id uuid not null references wallet_accounts (id) on delete restrict,
  entry_type text not null check (entry_type in (
    'top_up','included_credit','reservation_hold','reservation_release',
    'settlement','refund','adjustment'
  )),
  amount_usd numeric(12,4) not null,
  usage_reservation_id uuid,
  stripe_event_id uuid,
  idempotency_key text unique,
  note text,
  created_at timestamptz not null default now()
);

create index wallet_ledger_org_idx
  on wallet_ledger_entries (organization_id, created_at desc);

create trigger wallet_ledger_immutable
  before update or delete on wallet_ledger_entries
  for each row execute function app_forbid_mutation();

create table usage_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  run_id uuid,
  model_id text not null,
  reserved_high_usd numeric(12,4) not null check (reserved_high_usd >= 0),
  state text not null default 'held' check (state in (
    'held','settled','released','expired'
  )),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index usage_reservations_org_idx on usage_reservations (organization_id);

-- Settled from provider-reported usage; retains the effective rate version,
-- provider cost, markup, and customer charge (never hard-coded client-side).
create table usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete restrict,
  usage_reservation_id uuid not null references usage_reservations (id),
  run_id uuid,
  model_price_id uuid not null references model_prices (id),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  provider_cost_usd numeric(12,6) not null check (provider_cost_usd >= 0),
  markup numeric(4,2) not null,
  customer_charge_usd numeric(12,4) not null check (customer_charge_usd >= 0),
  provider_request_id text,
  created_at timestamptz not null default now()
);

create index usage_events_org_idx on usage_events (organization_id, created_at desc);

create trigger usage_events_immutable
  before update or delete on usage_events
  for each row execute function app_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Stripe plumbing (verified, idempotent webhook processing via outbox)
-- ---------------------------------------------------------------------------

create table stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table billing_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete restrict,
  kind text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index billing_outbox_pending_idx
  on billing_outbox (next_attempt_at) where completed_at is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table model_registry enable row level security;
alter table model_prices enable row level security;
alter table wallet_accounts enable row level security;
alter table wallet_ledger_entries enable row level security;
alter table usage_reservations enable row level security;
alter table usage_events enable row level security;
alter table stripe_events enable row level security;
alter table billing_outbox enable row level security;

-- Platform pricing is readable by any authenticated user (transparent
-- per-model pricing in the composer).
create policy model_registry_select on model_registry
  for select to authenticated using (true);

create policy model_prices_select on model_prices
  for select to authenticated using (true);

create policy wallet_accounts_select on wallet_accounts
  for select to authenticated
  using (app_is_org_member(organization_id));

-- Billing detail is limited to billing-managing roles.
create policy wallet_ledger_select on wallet_ledger_entries
  for select to authenticated
  using (app_org_role(organization_id) in ('owner','practitioner_admin'));

create policy usage_reservations_select on usage_reservations
  for select to authenticated
  using (app_is_org_member(organization_id));

create policy usage_events_select on usage_events
  for select to authenticated
  using (app_is_org_member(organization_id));

-- stripe_events and billing_outbox are service-only: RLS enabled with no
-- policies means no client access; the service role bypasses RLS.
