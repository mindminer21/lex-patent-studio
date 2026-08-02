-- RLS allow/deny matrix — cross-tenant isolation (PRD §5.7, §13).
-- Runs as pgTAP inside a rolled-back transaction against the seeded fixture.
begin;
select plan(47);

-- ===========================================================================
-- Alice (owner, org A) sees exactly her tenant's rows and none of org B's.
-- ===========================================================================
select tests.authenticate_as('a11ce000-0000-4000-8000-000000000001');

-- organizations
select is((select count(*) from public.organizations where id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own organization');
select is((select count(*) from public.organizations where id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B');

-- organization_memberships
select is((select count(*) from public.organization_memberships where organization_id = '0a600000-0000-4000-8000-00000000000a'), 2::bigint, 'A sees own memberships');
select is((select count(*) from public.organization_memberships where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B memberships');

-- terms_acceptances
select is((select count(*) from public.terms_acceptances where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own terms acceptances');
select is((select count(*) from public.terms_acceptances where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B terms acceptances');

-- invitations
select is((select count(*) from public.invitations where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A admin sees own invitations');
select is((select count(*) from public.invitations where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B invitations');

-- inventions (URL-tampering equivalent: direct lookup by foreign id)
select is((select count(*) from public.inventions where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own inventions');
select is((select count(*) from public.inventions where id = '1b000000-0000-4000-8000-000000000001'), 0::bigint, 'A cannot fetch org B invention by id');

-- invention_facts
select is((select count(*) from public.invention_facts where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own facts');
select is((select count(*) from public.invention_facts where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B facts');

-- contributors
select is((select count(*) from public.contributors where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own contributors');
select is((select count(*) from public.contributors where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B contributors');

-- disclosure_events
select is((select count(*) from public.disclosure_events where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own disclosure events');
select is((select count(*) from public.disclosure_events where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B disclosure events');

-- private_sources
select is((select count(*) from public.private_sources where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own sources');
select is((select count(*) from public.private_sources where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B sources');

-- drafts / draft_versions
select is((select count(*) from public.drafts where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own drafts');
select is((select count(*) from public.drafts where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B drafts');
select is((select count(*) from public.draft_versions where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own draft versions');
select is((select count(*) from public.draft_versions where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B draft versions');

-- exports / export_manifests
select is((select count(*) from public.exports where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own exports');
select is((select count(*) from public.exports where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B exports');
select is((select count(*) from public.export_manifests where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B export manifests');

-- counsel_requests / events / engagements
select is((select count(*) from public.counsel_requests where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own counsel requests');
select is((select count(*) from public.counsel_requests where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B counsel requests');
select is((select count(*) from public.counsel_request_events where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B counsel request events');
select is((select count(*) from public.engagements where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own engagement');

-- billing
select is((select count(*) from public.wallet_accounts where organization_id = '0a600000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own wallet');
select is((select count(*) from public.wallet_accounts where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B wallet');
select is((select count(*) from public.usage_reservations where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B reservations');
select is((select count(*) from public.usage_events where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B usage events');
select is((select count(*) from public.wallet_ledger_entries where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B ledger');

-- audit, jobs, retention
select is((select count(*) from public.audit_events where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B audit events');
select is((select count(*) from public.app_jobs where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B jobs');
select is((select count(*) from public.retention_policies where organization_id = '0b600000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B retention policy');

-- ===========================================================================
-- Cross-tenant writes are rejected outright (42501), not silently scoped.
-- ===========================================================================
select throws_ok(
  $$insert into public.inventions (organization_id, title, summary)
    values ('0b600000-0000-4000-8000-00000000000b', 'Injected into org B', 'x')$$,
  '42501', null, 'A cannot insert an invention into org B');

select throws_ok(
  $$insert into public.invention_facts (organization_id, invention_id, category, statement)
    values ('0b600000-0000-4000-8000-00000000000b', '1b000000-0000-4000-8000-000000000001', 'technical', 'Injected fact')$$,
  '42501', null, 'A cannot insert a fact into org B');

-- Update/delete against org B silently target zero rows (RLS filtering)…
select lives_ok(
  $$update public.inventions set title = 'Hijacked title'
    where id = '1b000000-0000-4000-8000-000000000001'$$,
  'A update against org B invention runs without effect');
select lives_ok(
  $$delete from public.contributors
    where organization_id = '0b600000-0000-4000-8000-00000000000b'$$,
  'A delete against org B contributors runs without effect');

-- ===========================================================================
-- Bob (owner, org B) is equally blind to org A.
-- ===========================================================================
select tests.clear_auth();
select tests.authenticate_as('b0b00000-0000-4000-8000-000000000001');

-- …and verified from B's side: org B data was untouched by A's attempts.
select is((select count(*) from public.inventions where title = 'Hijacked title'), 0::bigint, 'org B invention title was not changed by A');
select is((select count(*) from public.contributors where organization_id = '0b600000-0000-4000-8000-00000000000b'), 1::bigint, 'org B contributors were not deleted by A');
select is((select count(*) from public.inventions where organization_id = '0a600000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A inventions');
select is((select count(*) from public.counsel_requests where organization_id = '0a600000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A counsel requests');

-- ===========================================================================
-- Anonymous sessions see nothing in tenant tables.
-- ===========================================================================
select tests.clear_auth();
select tests.authenticate_anon();
select is((select count(*) from public.inventions), 0::bigint, 'anon sees zero inventions');
select is((select count(*) from public.organizations), 0::bigint, 'anon sees zero organizations');

select tests.clear_auth();
select * from finish();
rollback;
