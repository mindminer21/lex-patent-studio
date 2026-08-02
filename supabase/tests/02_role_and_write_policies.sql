-- RLS allow/deny matrix — role-based write policies (PRD FR-2, FR-3, FR-6).
begin;
select plan(24);

-- ===========================================================================
-- Viewer: read-only inside the tenant.
-- ===========================================================================
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000002'); -- avery, viewer org A

select is((select count(*) from public.inventions where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'viewer can read tenant inventions');
select throws_ok(
  $$insert into public.inventions (organization_id, title, summary)
    values ('0a600000-0000-4000-8000-00000000000a', 'Viewer-created invention', 'x')$$,
  '42501', null, 'viewer cannot create inventions');
select throws_ok(
  $$insert into public.invention_facts (organization_id, invention_id, category, statement)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'technical', 'Viewer fact')$$,
  '42501', null, 'viewer cannot create facts');
select lives_ok(
  $$update public.inventions set title = 'Viewer rename'
    where id = '1a000000-0000-4000-8000-000000000001'$$,
  'viewer update runs without effect');
select is((select count(*) from public.inventions where title = 'Viewer rename'), 0::bigint,
  'viewer update changed nothing');
select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role)
    values ('0a600000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000002', 'admin')$$,
  '42501', null, 'viewer cannot self-escalate membership');

select tests.clear_auth();

-- ===========================================================================
-- Owner: allowed writes work; forbidden writes still fail.
-- ===========================================================================
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001'); -- alice, owner org A

select lives_ok(
  $$insert into public.invention_facts (organization_id, invention_id, category, statement, provenance)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'technical', 'Owner-added synthetic fact', 'user_asserted')$$,
  'owner can add a fact');

-- counsel_reviewed provenance is reserved for the counsel lane (restrictive policy)
select throws_ok(
  $$insert into public.invention_facts (organization_id, invention_id, category, statement, provenance)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'technical', 'Fake reviewed fact', 'counsel_reviewed')$$,
  '42501', null, 'application roles cannot insert counsel_reviewed facts');
select throws_ok(
  $$update public.invention_facts set provenance = 'counsel_reviewed'
    where id = '2a000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'application roles cannot mark facts counsel_reviewed');

-- money tables are read-only for application roles
select throws_ok(
  $$insert into public.wallet_ledger_entries (organization_id, kind, amount_cents, note)
    values ('0a600000-0000-4000-8000-00000000000a', 'top_up', 100000, 'self-credit')$$,
  '42501', null, 'members cannot write the wallet ledger');
select throws_ok(
  $$insert into public.usage_events (organization_id, reservation_id, model_id, rate_version, provider_cost_cents, customer_charge_cents, input_tokens, output_tokens)
    values ('0a600000-0000-4000-8000-00000000000a', '7a000000-0000-4000-8000-000000000001', 'synthetic-model', 'rv-test', 0, 0, 0, 0)$$,
  '42501', null, 'members cannot write usage events');
select lives_ok(
  $$update public.wallet_accounts set balance_cents = 9999999
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'member wallet-balance update runs without effect');
select is((select count(*) from public.wallet_accounts where balance_cents = 9999999), 0::bigint,
  'member cannot change their wallet balance');
select throws_ok(
  $$insert into public.app_jobs (organization_id, kind, idempotency_key)
    values ('0a600000-0000-4000-8000-00000000000a', 'generation', 'member-made-job')$$,
  '42501', null, 'members cannot enqueue raw job rows');

-- provider rates never reach application roles (FR-6)
select is((select count(*) from public.model_registry), 0::bigint, 'model registry hidden from application roles');
select is((select count(*) from public.model_prices), 0::bigint, 'model prices hidden from application roles');

-- drafts/draft_versions/exports are written only by trusted server logic
select throws_ok(
  $$insert into public.draft_versions (organization_id, draft_id, version, content, model_id, rate_version, estimate_customer_high_cents, actual_provider_cost_cents, actual_customer_charge_cents)
    values ('0a600000-0000-4000-8000-00000000000a', '4a000000-0000-4000-8000-000000000001', 2, 'forged', 'synthetic-model', 'rv-test', 1, 1, 2)$$,
  '42501', null, 'members cannot forge draft versions');
select throws_ok(
  $$insert into public.exports (organization_id, invention_id, checksum)
    values ('0a600000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001', 'forged')$$,
  '42501', null, 'members cannot forge export records');

-- counsel requests: insert must be own draft
select throws_ok(
  $$insert into public.counsel_requests (organization_id, created_by, state, request_summary, jurisdiction, contact_email)
    values ('0a600000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000001', 'submitted', 'Skipping straight to submitted', 'CO', 'a@example.test')$$,
  '42501', null, 'counsel requests cannot be created past draft state');
select throws_ok(
  $$insert into public.counsel_requests (organization_id, created_by, state, request_summary, jurisdiction, contact_email)
    values ('0a600000-0000-4000-8000-00000000000a', 'b0b00000-0000-4000-8000-000000000001', 'draft', 'Forged creator identity', 'CO', 'b@example.test')$$,
  '42501', null, 'counsel request creator cannot be forged');
select lives_ok(
  $$update public.counsel_requests set state = 'conflict_review'
    where id = '3a000000-0000-4000-8000-000000000001'$$,
  'member counsel-state update runs without effect');
select is((select count(*) from public.counsel_requests
           where id = '3a000000-0000-4000-8000-000000000001' and state = 'submitted'), 1::bigint,
  'members cannot move counsel request state directly');

select tests.clear_auth();

-- ===========================================================================
-- Counsel lane separation: assignments are self-visible only.
-- ===========================================================================
select tests.authenticate_as('c0700000-0000-4000-8000-000000000001'); -- carol, counsel_attorney
select is((select count(*) from public.counsel_assignments), 1::bigint, 'counsel user sees own assignment only');
select tests.clear_auth();

select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');
select is((select count(*) from public.counsel_audit_events), 0::bigint, 'ordinary users cannot read the counsel audit trail');
select tests.clear_auth();

select * from finish();
rollback;
