-- RLS allow/deny matrix — absolute cross-tenant isolation (PRD Invariant 18,
-- FR-2, §16). Runs as pgTAP in a rolled-back transaction against the fixture.
begin;
select plan(54);

-- ===========================================================================
-- Ana (practitioner_admin, org A) sees org A and NOTHING of org B.
-- ===========================================================================
select tests.authenticate_as('a0000000-0000-4000-8000-000000000001');

select is((select count(*) from public.organizations where id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own organization');
select is((select count(*) from public.organizations where id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B');
select is((select count(*) from public.organization_memberships where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B memberships');
select is((select count(*) from public.invitations where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'A admin sees own invitations');
select is((select count(*) from public.invitations where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B invitations');
select is((select count(*) from public.terms_acceptances where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B terms acceptances');

-- Matters (URL-tampering equivalent: direct fetch by foreign id)
select is((select count(*) from public.matters where organization_id = '0a000000-0000-4000-8000-00000000000a'), 2::bigint, 'A sees both org A matters');
select is((select count(*) from public.matters where id = '1b000000-0000-4000-8000-000000000001'), 0::bigint, 'A cannot fetch org B matter by id');
select is((select count(*) from public.matter_acl where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B ACLs');

-- Facts / events / sources / extractions
select is((select count(*) from public.matter_facts where organization_id = '0a000000-0000-4000-8000-00000000000a'), 2::bigint, 'A sees own facts');
select is((select count(*) from public.matter_facts where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B facts');
select is((select count(*) from public.fact_events where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B fact events');
select is((select count(*) from public.private_sources where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B sources');
select is((select count(*) from public.source_extractions where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B extractions');

-- Styles / playbooks (no cross-tenant playbook access, EVER — §5.4)
select is((select count(*) from public.style_profiles where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B style profiles');
select is((select count(*) from public.playbook_entries where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own playbook');
select is((select count(*) from public.playbook_entries where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B playbook');

-- Runs / stages / checks
select is((select count(*) from public.workflow_runs where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B runs');
select is((select count(*) from public.run_stages where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B run stages');
select is((select count(*) from public.deterministic_check_results where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B check results');

-- Claims
select is((select count(*) from public.claims where organization_id = '0a000000-0000-4000-8000-00000000000a'), 2::bigint, 'A sees own claims');
select is((select count(*) from public.claims where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B claims');
select is((select count(*) from public.claim_versions where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B claim versions');
select is((select count(*) from public.claim_tree_edges where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B claim edges');

-- Prosecution artifacts
select is((select count(*) from public.rejections where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B rejections');
select is((select count(*) from public.rejection_matrix_cells where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B matrix cells');
select is((select count(*) from public.search_reports where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B search reports');
select is((select count(*) from public.search_references where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B search references');
select is((select count(*) from public.ids_packets where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B IDS packets');
select is((select count(*) from public.ids_citations where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B IDS citations');

-- QC / review
select is((select count(*) from public.critic_reports where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B critic reports');
select is((select count(*) from public.verification_results where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B verification results');
select is((select count(*) from public.review_items where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B review items');
select is((select count(*) from public.review_decisions where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B review decisions');

-- Documents / exports / deadlines
select is((select count(*) from public.documents where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B documents');
select is((select count(*) from public.document_versions where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B document versions');
select is((select count(*) from public.exports where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B exports');
select is((select count(*) from public.export_manifests where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B export manifests');
select is((select count(*) from public.deadline_observations where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B deadline observations');

-- Billing
select is((select count(*) from public.wallet_accounts where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B wallet');
select is((select count(*) from public.wallet_ledger_entries where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B ledger');
select is((select count(*) from public.usage_reservations where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B reservations');
select is((select count(*) from public.usage_events where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B usage events');

-- Chat (matter-isolated conversations)
select is((select count(*) from public.chat_messages where organization_id = '0a000000-0000-4000-8000-00000000000a'), 1::bigint, 'A sees own chat thread');
select is((select count(*) from public.chat_messages where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B chat');

-- Audit
select is((select count(*) from public.audit_events where organization_id = '0b000000-0000-4000-8000-00000000000b'), 0::bigint, 'A cannot see org B audit events');

-- Service-only tables are invisible to ALL clients (no policies).
select is((select count(*) from public.stripe_events), 0::bigint, 'clients cannot read stripe_events');
select is((select count(*) from public.billing_outbox), 0::bigint, 'clients cannot read billing_outbox');

-- ===========================================================================
-- Cross-tenant and same-tenant client WRITES are rejected outright (42501):
-- ALL writes flow through the service role.
-- ===========================================================================
select throws_ok(
  $$insert into public.matters (organization_id, matter_number, title, technology_area, created_by)
    values ('0b000000-0000-4000-8000-00000000000b', 'X-1', 'Cross-tenant write', 'X',
            'a0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'A cannot insert a matter into org B');
select throws_ok(
  $$insert into public.matters (organization_id, matter_number, title, technology_area, created_by)
    values ('0a000000-0000-4000-8000-00000000000a', 'X-2', 'Client-side write', 'X',
            'a0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'even same-tenant client inserts are denied (service-only writes)');
-- UPDATE without an update policy matches zero rows (RLS filters rather
-- than throwing): the row must remain byte-identical after the attempt.
update public.matter_facts set text = 'tampered'
  where id = '61000000-0000-4000-8000-00000000000a';
select is(
  (select text from public.matter_facts where id = '61000000-0000-4000-8000-00000000000a'),
  'Synthetic fact A1',
  'client updates are denied (zero rows affected under RLS)');

-- ===========================================================================
-- Bea (org B) and anon
-- ===========================================================================
select tests.clear_auth();
select tests.authenticate_as('b0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.matters where organization_id = '0a000000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A matters');
select is((select count(*) from public.playbook_entries where organization_id = '0a000000-0000-4000-8000-00000000000a'), 0::bigint, 'B cannot see org A playbook');

select tests.clear_auth();
select tests.authenticate_anon();
select is((select count(*) from public.matters), 0::bigint, 'anon sees no matters at all');

select tests.clear_auth();
select * from finish();
rollback;
