-- Model registry, generation jobs, usage reservations/events, wallet ledger,
-- Stripe events, and billing outbox (FR-5, FR-6).
--
-- Money rules encoded here:
-- - Wallet ledger is append-only (immutable trigger).
-- - Every settled usage event retains rate version, provider cost, markup,
--   and customer charge; charge = provider cost × 1.50 enforced by check.
-- - All writes happen through trusted server logic; application roles are
--   read-only on money tables.

create table public.model_registry (
  id text primary key,
  provider text not null check (provider in ('openai', 'anthropic', 'xai', 'local-synthetic')),
  display_name text not null,
  enabled boolean not null default false,
  max_output_tokens integer not null check (max_output_tokens > 0),
  created_at timestamptz not null default now()
);

create table public.model_prices (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public.model_registry (id),
  rate_version text not null unique,
  input_cents_per_million_tokens integer not null check (input_cents_per_million_tokens >= 0),
  output_cents_per_million_tokens integer not null check (output_cents_per_million_tokens >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  check (effective_to is null or effective_to > effective_from)
);
create index on public.model_prices (model_id, effective_from desc);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invention_id uuid not null references public.inventions (id) on delete cascade,
  workflow text not null,
  model_id text not null references public.model_registry (id),
  status public.generation_job_status not null default 'queued',
  idempotency_key text not null,
  correlation_id uuid not null default gen_random_uuid(),
  error_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (organization_id, idempotency_key)
);
create index on public.generation_jobs (organization_id, status);

create table public.wallet_accounts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  balance_cents bigint not null default 0,
  reserved_cents bigint not null default 0 check (reserved_cents >= 0),
  updated_at timestamptz not null default now(),
  check (reserved_cents <= greatest(balance_cents, 0))
);

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  generation_job_id uuid references public.generation_jobs (id),
  idempotency_key text not null,
  amount_cents integer not null check (amount_cents > 0),
  rate_version text not null references public.model_prices (rate_version),
  status public.reservation_status not null default 'held',
  settled_provider_cost_cents integer,
  settled_customer_charge_cents integer,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (organization_id, idempotency_key),
  -- Customer charge = provider cost × 1.50, rounded up (FR-6), and never
  -- more than the reserved budget cap.
  constraint usage_reservations_markup check (
    settled_customer_charge_cents is null
    or settled_customer_charge_cents = ceil(settled_provider_cost_cents * 1.5)::integer
  ),
  constraint usage_reservations_cap check (
    settled_customer_charge_cents is null
    or settled_customer_charge_cents <= amount_cents
  )
);
create index on public.usage_reservations (organization_id, status);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.usage_reservations (id),
  model_id text not null references public.model_registry (id),
  rate_version text not null references public.model_prices (rate_version),
  provider_cost_cents integer not null check (provider_cost_cents >= 0),
  customer_charge_cents integer not null check (customer_charge_cents >= 0),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  constraint usage_events_markup check (
    customer_charge_cents = ceil(provider_cost_cents * 1.5)::integer
  )
);
create index on public.usage_events (organization_id, created_at desc);

create table public.wallet_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.ledger_entry_kind not null,
  amount_cents bigint not null,
  reservation_id uuid references public.usage_reservations (id),
  stripe_reference text,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index on public.wallet_ledger_entries (organization_id, created_at desc);

create table public.stripe_events (
  id text primary key, -- Stripe event id; primary key gives webhook idempotency
  type text not null,
  payload jsonb not null,
  signature_verified boolean not null default false,
  processed_at timestamptz,
  received_at timestamptz not null default now()
);

create table public.billing_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  stripe_event_id text references public.stripe_events (id),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on public.billing_outbox (status, created_at);

-- ---------------------------------------------------------------------------
-- RLS: money tables are read-only for members of the organization; all
-- writes go through trusted server logic. Registry/prices are server-only
-- (rates never ship to the browser — FR-6).
-- ---------------------------------------------------------------------------
alter table public.model_registry enable row level security;
alter table public.model_prices enable row level security;
-- No policies: service-role/server access only.

do $$
declare
  t text;
begin
  foreach t in array array[
    'generation_jobs', 'wallet_accounts', 'usage_reservations', 'usage_events',
    'wallet_ledger_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select using (organization_id in (select app.user_org_ids()))',
      t || '_member_select', t
    );
  end loop;
end
$$;

alter table public.stripe_events enable row level security;
alter table public.billing_outbox enable row level security;
-- No policies: webhook/service processing only.

-- The ledger and usage events are immutable, append-only records.
create trigger wallet_ledger_entries_immutable
  before update or delete on public.wallet_ledger_entries
  for each row execute function app.reject_mutation();
create trigger usage_events_immutable
  before update or delete on public.usage_events
  for each row execute function app.reject_mutation();
