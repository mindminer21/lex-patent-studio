-- Role-scoped read policies + matter-level ACL (FR-2; PRD §3 contributor
-- boundary; §5.4 playbook restriction; FR-9 billing detail restriction).
begin;
select plan(16);

-- ===========================================================================
-- Chen (contributor, org A): sees ONLY the ACL-shared matter A1, never A2.
-- ===========================================================================
select tests.authenticate_as('a0000000-0000-4000-8000-000000000004');

select is((select count(*) from public.matters where id = '1a000000-0000-4000-8000-000000000001'), 1::bigint, 'contributor sees the shared matter A1');
select is((select count(*) from public.matters where id = '1a000000-0000-4000-8000-000000000002'), 0::bigint, 'contributor cannot see unshared matter A2');
select is((select count(*) from public.matter_facts where matter_id = '1a000000-0000-4000-8000-000000000001'), 1::bigint, 'contributor sees facts of the shared matter');
select is((select count(*) from public.matter_facts where matter_id = '1a000000-0000-4000-8000-000000000002'), 0::bigint, 'contributor cannot see facts of the unshared matter');
select is((select count(*) from public.playbook_entries), 0::bigint, 'contributor NEVER reads playbook content');
select is((select count(*) from public.wallet_ledger_entries), 0::bigint, 'contributor cannot read billing detail');

-- ===========================================================================
-- Vera (viewer, org A): shared matter only; no playbook.
-- ===========================================================================
select tests.clear_auth();
select tests.authenticate_as('a0000000-0000-4000-8000-000000000005');

select is((select count(*) from public.matters where id = '1a000000-0000-4000-8000-000000000001'), 1::bigint, 'viewer sees the shared matter A1');
select is((select count(*) from public.matters where id = '1a000000-0000-4000-8000-000000000002'), 0::bigint, 'viewer cannot see unshared matter A2');
select is((select count(*) from public.playbook_entries), 0::bigint, 'viewer cannot read playbook content');

-- ===========================================================================
-- Oscar (agent_operator, org A): all tenant matters; playbook readable;
-- billing detail still restricted to owner/practitioner_admin.
-- ===========================================================================
select tests.clear_auth();
select tests.authenticate_as('a0000000-0000-4000-8000-000000000003');

select is((select count(*) from public.matters where organization_id = '0a000000-0000-4000-8000-00000000000a'), 2::bigint, 'operator sees all tenant matters');
select is((select count(*) from public.playbook_entries where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'operator reads playbook');
select is((select count(*) from public.wallet_ledger_entries), 0::bigint, 'operator cannot read billing detail');
select is((select count(*) from public.wallet_accounts where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'operator sees the wallet account row');

-- ===========================================================================
-- Ana (practitioner_admin): billing detail readable; invitations readable.
-- ===========================================================================
select tests.clear_auth();
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001');

select is((select count(*) from public.wallet_ledger_entries where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'admin reads own billing ledger');
select is((select count(*) from public.invitations where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'admin reads own invitations');

-- Pia (practitioner, not admin) cannot read invitations (admin-only policy).
select tests.clear_auth();
select tests.authenticate_as('a0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.invitations), 0::bigint, 'practitioner (non-admin) cannot read invitations');

select tests.clear_auth();
select * from finish();
rollback;
