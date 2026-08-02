-- Append-only triggers and schema-level invariants (FR-10; §5.4; §9.2;
-- Invariant 20; FR-6 critic independence). These hold even for the service
-- role — immutability is a trigger, not a policy.
begin;
select plan(11);

select tests.clear_auth();

-- audit_events is append-only (FR-10)
select throws_like(
  $$update public.audit_events set action = 'tampered'
    where organization_id = '0a000000-0000-4000-8000-00000000000a'$$,
  '%append-only%', 'audit events cannot be updated');
select throws_like(
  $$delete from public.audit_events
    where organization_id = '0a000000-0000-4000-8000-00000000000a'$$,
  '%append-only%', 'audit events cannot be deleted');

-- playbook_entries immutable after publication (§5.4)
select throws_like(
  $$update public.playbook_entries set body = 'tampered'
    where id = '51000000-0000-4000-8000-00000000000a'$$,
  '%append-only%', 'playbook entries cannot be altered after publication');

-- review_decisions immutable (Invariant 16 record integrity)
select throws_like(
  $$update public.review_decisions set decision = 'approve'
    where organization_id = '0b000000-0000-4000-8000-00000000000b'$$,
  '%append-only%', 'review decisions cannot be rewritten');

-- wallet ledger + usage events immutable (FR-9)
select throws_like(
  $$update public.wallet_ledger_entries set amount_usd = 999
    where idempotency_key = 'seed-credit-a'$$,
  '%append-only%', 'wallet ledger entries cannot be altered');
select throws_like(
  $$delete from public.usage_events
    where organization_id = '0a000000-0000-4000-8000-00000000000a'$$,
  '%append-only%', 'usage events cannot be deleted');

-- export manifests immutable (§9.2: exports never mutate)
select throws_like(
  $$update public.export_manifests set manifest = '{"tampered":true}'
    where organization_id = '0a000000-0000-4000-8000-00000000000a'$$,
  '%append-only%', 'export manifests cannot be altered');

-- Exports are immutable once created (§9.2, migration 0006).
select throws_like(
  $$update public.exports set watermark = null
    where organization_id = '0a000000-0000-4000-8000-00000000000a'$$,
  '%append-only%', 'export rows cannot be altered after creation');

-- Invariant 20: the deadline disclaimer flag cannot be turned off.
select throws_ok(
  $$insert into public.deadline_observations
      (organization_id, matter_id, label, observed_date, window_kind, disclaimer_required)
    values ('0a000000-0000-4000-8000-00000000000a', '1a000000-0000-4000-8000-000000000001',
            'No-disclaimer attempt', '2026-12-01', 'test', false)$$,
  '23514', null, 'disclaimer_required cannot be false');

-- FR-6: critic model must differ from the drafting model (schema check).
select throws_ok(
  $$insert into public.critic_reports
      (organization_id, run_id, critic_model_id, drafting_model_id, summary)
    values ('0a000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a',
            'gpt-5', 'gpt-5', 'Same-model critique attempt')$$,
  '23514', null, 'critic model cannot equal the drafting model');

-- §20.14 analog: markup floor — usage events cannot record sub-1.0 markup.
select throws_ok(
  $$insert into public.model_prices
      (model_registry_id, input_per_mtok_usd, output_per_mtok_usd, markup, effective_from)
    values ('70000000-0000-4000-8000-000000000001', 1.0, 2.0, 0.90, '2026-08-01')$$,
  '23514', null, 'model price markup below 1.00 is rejected');

select * from finish();
rollback;
