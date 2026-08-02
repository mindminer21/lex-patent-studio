-- Append-only guarantees (PRD §7.2, FR-3, FR-6, FR-7).
--
-- Two layers are tested:
--  1. Application roles have no update/delete policies on append-only tables
--     (mutations affect zero rows or raise 42501).
--  2. The immutability triggers reject mutations even from trusted roles —
--     defense in depth against server-logic bugs (superuser here stands in
--     for the service role, since triggers fire regardless of RLS bypass).
begin;
select plan(21);

-- Layer 1: as org A owner, mutations against append-only tables target zero
-- rows (no update/delete policy exists), leaving the records unchanged.
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');

select lives_ok(
  $$update public.terms_acceptances set ip_hash = 'rewritten'
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'owner terms-acceptance rewrite runs without effect');
select is((select count(*) from public.terms_acceptances where ip_hash = 'rewritten'), 0::bigint,
  'terms acceptance unchanged by owner');
select lives_ok(
  $$delete from public.terms_acceptances
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'owner terms-acceptance delete runs without effect');
select is((select count(*) from public.terms_acceptances where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint,
  'terms acceptance not deleted by owner');
select lives_ok(
  $$update public.wallet_ledger_entries set amount_cents = 0
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'owner ledger rewrite runs without effect');
select is((select count(*) from public.wallet_ledger_entries where amount_cents = 0), 0::bigint,
  'ledger unchanged by owner');
select lives_ok(
  $$update public.audit_events set action = 'scrubbed'
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'owner audit rewrite runs without effect');
select is((select count(*) from public.audit_events where action = 'scrubbed'), 0::bigint,
  'audit trail unchanged by owner');
select lives_ok(
  $$update public.draft_versions set content = 'tampered'
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'owner draft-version tamper runs without effect');
select is((select count(*) from public.draft_versions where content = 'tampered'), 0::bigint,
  'draft version unchanged by owner');

select tests.clear_auth();

-- Layer 2: triggers hold even for trusted/service logic
select throws_ok(
  $$update public.terms_acceptances set ip_hash = 'rewritten' where ip_hash = 'hash-a'$$,
  'P0001', null, 'terms_acceptances immutable even for trusted roles');
select throws_ok(
  $$delete from public.terms_acceptances where ip_hash = 'hash-a'$$,
  'P0001', null, 'terms_acceptances undeletable even for trusted roles');
select throws_ok(
  $$update public.wallet_ledger_entries set amount_cents = 0 where note = 'Synthetic credit A'$$,
  'P0001', null, 'wallet ledger immutable');
select throws_ok(
  $$delete from public.wallet_ledger_entries where note = 'Synthetic credit A'$$,
  'P0001', null, 'wallet ledger undeletable');
select throws_ok(
  $$update public.usage_events set provider_cost_cents = 0
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'P0001', null, 'usage events immutable');
select throws_ok(
  $$update public.audit_events set action = 'scrubbed'
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'P0001', null, 'audit events immutable');
select throws_ok(
  $$delete from public.counsel_request_events
    where organization_id = '0a600000-0000-4000-8000-00000000000a'$$,
  'P0001', null, 'counsel request events undeletable');
select throws_ok(
  $$update public.draft_versions set content = 'tampered'
    where id = '5a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'draft versions immutable');
select throws_ok(
  $$update public.exports set checksum = 'forged'
    where id = '6a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'export records immutable');
select throws_ok(
  $$update public.export_manifests set manifest = '{}'::jsonb
    where export_id = '6a000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'export manifests immutable');
select throws_ok(
  $$update public.counsel_audit_events set action = 'scrubbed'
    where counsel_user_id = 'c0700000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'counsel audit trail immutable');

select * from finish();
rollback;
